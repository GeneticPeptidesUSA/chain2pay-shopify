/**
 * Shopify Payments Apps API routes
 *
 * Shopify calls these endpoints during the checkout payment flow.
 * Docs: https://shopify.dev/docs/apps/payments/processing-a-payment
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { generatePaymentLink } = require('../lib/chain2pay');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verify the HMAC signature Shopify attaches to every Payment Apps request.
 * Shopify signs the raw JSON body with your app's client secret.
 */
function verifyShopifyHmac(req) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  if (!hmacHeader) return false;

  const secret = process.env.SHOPIFY_API_SECRET;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody) // rawBody is attached by the bodyParser middleware in server.js
    .digest('base64');

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
}

/**
 * Call the Shopify Admin GraphQL API to resolve or reject a payment session.
 */
async function notifyShopify(shop, accessToken, mutation, variables) {
  const { default: fetch } = await import('node-fetch');

  const response = await fetch(`https://${shop}/admin/api/2024-04/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  const json = await response.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

const RESOLVE_MUTATION = `
  mutation PaymentSessionResolve($id: ID!) {
    paymentSessionResolve(id: $id) {
      paymentSession {
        id
        state { ... on PaymentSessionStateResolved { code } }
      }
      userErrors { field message }
    }
  }
`;

const REJECT_MUTATION = `
  mutation PaymentSessionReject($id: ID!, $reason: PaymentSessionRejectionReasonInput!) {
    paymentSessionReject(id: $id, reason: $reason) {
      paymentSession {
        id
        state { ... on PaymentSessionStateRejected { code reason } }
      }
      userErrors { field message }
    }
  }
`;

const REFUND_RESOLVE_MUTATION = `
  mutation RefundSessionResolve($id: ID!) {
    refundSessionResolve(id: $id) {
      refundSession { id }
      userErrors { field message }
    }
  }
`;

const VOID_RESOLVE_MUTATION = `
  mutation VoidSessionResolve($id: ID!) {
    voidSessionResolve(id: $id) {
      voidSession { id }
      userErrors { field message }
    }
  }
`;

// In-memory store for active payment sessions.
// Replace with a database (Redis/Postgres) in production.
const sessions = new Map();

// ---------------------------------------------------------------------------
// POST /payment  — Shopify initiates a payment session
// ---------------------------------------------------------------------------
router.post('/', (req, res) => {
  if (!verifyShopifyHmac(req)) {
    console.warn('[payment] HMAC verification failed');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Run async logic without blocking the route handler return.
  handlePayment(req, res).catch((err) => {
    console.error('[payment] Unhandled error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });
});

async function handlePayment(req, res) {
  const body = req.body;
  /*
   * Shopify payment session body includes:
   *   id              — the payment session GID
   *   gid             — same as id
   *   group           — payment group GID
   *   amount          — { amount: "49.99", currencyCode: "USD" }
   *   test            — boolean
   *   merchantLocale  — e.g. "en-US"
   *   paymentMethod   — { type, data }
   *   proposedAt      — ISO timestamp
   *   cancelUrl       — URL to send customer on cancel
   *   kind            — "sale" or "authorization"
   *   shop            — myshopify domain
   *   shopifyPaymentsAccountId
   *   customer        — { billingAddress, shippingAddress, email, … }
   *   lineItems       — []
   */

  const sessionId = body.id;
  const shop = body.shop;
  const amount = body.amount?.amount || '0.00';
  const currency = body.amount?.currencyCode || 'USD';
  const cancelUrl = body.cancelUrl;

  // Persist session so the confirm callback can find it.
  sessions.set(sessionId, {
    sessionId,
    shop,
    amount,
    currency,
    createdAt: Date.now(),
  });

  const confirmUrl = `${process.env.APP_URL}/confirm?session_id=${encodeURIComponent(sessionId)}`;

  let paymentUrl;
  try {
    const result = await generatePaymentLink({
      amount,
      currency,
      walletAddress: process.env.WALLET_ADDRESS,
      orderId: sessionId,
      redirectUrl: confirmUrl,
      cancelUrl,
    });

    paymentUrl = result.paymentUrl;
    sessions.get(sessionId).chain2payId = result.paymentId;
    console.log(`[payment] Chain2Pay link generated for session ${sessionId}: ${paymentUrl}`);
  } catch (err) {
    console.error('[payment] Failed to generate Chain2Pay link:', err.message);
    return res.status(500).json({ error: 'Failed to generate payment link' });
  }

  // Shopify expects a 201 with a redirect_url to send the customer offsite.
  res.status(201).json({ redirect_url: paymentUrl });
}

// ---------------------------------------------------------------------------
// GET /confirm  — Chain2Pay redirects customer back here after payment
// ---------------------------------------------------------------------------
router.get('/confirm', (req, res) => {
  handleConfirm(req, res).catch((err) => {
    console.error('[confirm] Unhandled error:', err);
    if (!res.headersSent) res.status(500).send('Payment confirmation failed');
  });
});

async function handleConfirm(req, res) {
  const sessionId = req.query.session_id;
  const status = req.query.status; // e.g. "success" | "failed" | "cancelled"

  if (!sessionId) {
    return res.status(400).send('Missing session_id');
  }

  const session = sessions.get(sessionId);
  if (!session) {
    console.warn(`[confirm] Unknown session: ${sessionId}`);
    // Still redirect the customer to Shopify so checkout can recover.
    return res.redirect(`https://${process.env.STORE_CUSTOMER_DOMAIN}/`);
  }

  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const shop = session.shop || process.env.SHOPIFY_STORE_DOMAIN;

  // Determine success/failure from Chain2Pay's redirect query params.
  // Chain2Pay may use: ?status=success, ?result=paid, ?paid=1, etc.
  // Adjust the condition below to match Chain2Pay's actual param name/value.
  const paid =
    status === 'success' ||
    req.query.result === 'paid' ||
    req.query.paid === '1' ||
    req.query.payment_status === 'completed';

  try {
    if (paid) {
      await notifyShopify(shop, accessToken, RESOLVE_MUTATION, { id: sessionId });
      console.log(`[confirm] Payment resolved for session ${sessionId}`);
    } else {
      await notifyShopify(shop, accessToken, REJECT_MUTATION, {
        id: sessionId,
        reason: {
          code: 'PAYMENT_METHOD_DECLINED',
          merchantMessage: `Payment was not completed (status: ${status || 'unknown'})`,
        },
      });
      console.log(`[confirm] Payment rejected for session ${sessionId}`);
    }
  } catch (err) {
    console.error('[confirm] Failed to notify Shopify:', err.message);
  }

  sessions.delete(sessionId);

  // Redirect customer back to Shopify's post-payment page.
  // Shopify provides the return URL via the paymentSession — for simplicity
  // we send them to the store home; in production, persist the Shopify returnUrl.
  const customerDomain = process.env.STORE_CUSTOMER_DOMAIN;
  const destination = paid
    ? `https://${customerDomain}/checkout/thank-you`
    : `https://${customerDomain}/checkout`;

  res.redirect(destination);
}

// ---------------------------------------------------------------------------
// POST /refund  — Shopify requests a refund
// ---------------------------------------------------------------------------
router.post('/refund', (req, res) => {
  if (!verifyShopifyHmac(req)) return res.status(401).json({ error: 'Unauthorized' });

  handleRefund(req, res).catch((err) => {
    console.error('[refund] Error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });
});

async function handleRefund(req, res) {
  const { id, gid, shop } = req.body;
  console.log(`[refund] Refund requested for session ${id || gid}`);

  // TODO: Call Chain2Pay refund API if available.
  // For now, auto-resolve the refund session to keep Shopify flow moving.
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  await notifyShopify(shop || process.env.SHOPIFY_STORE_DOMAIN, accessToken, REFUND_RESOLVE_MUTATION, {
    id: id || gid,
  });

  res.status(200).json({ status: 'resolved' });
}

// ---------------------------------------------------------------------------
// POST /void  — Shopify requests a void (cancel authorization)
// ---------------------------------------------------------------------------
router.post('/void', (req, res) => {
  if (!verifyShopifyHmac(req)) return res.status(401).json({ error: 'Unauthorized' });

  handleVoid(req, res).catch((err) => {
    console.error('[void] Error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });
});

async function handleVoid(req, res) {
  const { id, gid, shop } = req.body;
  console.log(`[void] Void requested for session ${id || gid}`);

  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  await notifyShopify(shop || process.env.SHOPIFY_STORE_DOMAIN, accessToken, VOID_RESOLVE_MUTATION, {
    id: id || gid,
  });

  res.status(200).json({ status: 'resolved' });
}

module.exports = router;
