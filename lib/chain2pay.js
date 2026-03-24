/**
 * Chain2Pay API client
 * Endpoint: https://chain2pay.cloud/api/generate
 */

const CHAIN2PAY_API = 'https://chain2pay.cloud/api/generate';

/**
 * Generate a Chain2Pay payment link.
 *
 * @param {object} opts
 * @param {number}  opts.amount        - Order total (e.g. 49.99)
 * @param {string}  opts.currency      - ISO currency code (e.g. "USD")
 * @param {string}  opts.walletAddress - Your crypto wallet address
 * @param {string}  opts.orderId       - Shopify order/payment-session ID (used as reference)
 * @param {string}  opts.redirectUrl   - URL Chain2Pay sends the customer to after payment
 * @param {string}  opts.cancelUrl     - URL if the customer cancels
 * @returns {Promise<{paymentUrl: string, paymentId: string}>}
 */
async function generatePaymentLink({ amount, currency, walletAddress, orderId, redirectUrl, cancelUrl }) {
  const { default: fetch } = await import('node-fetch');

  const payload = {
    amount: Number(amount).toFixed(2),
    currency: currency || 'USD',
    wallet: walletAddress,
    order_id: orderId,
    redirect_url: redirectUrl,
    cancel_url: cancelUrl,
  };

  const response = await fetch(CHAIN2PAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chain2Pay API error ${response.status}: ${text}`);
  }

  const data = await response.json();

  // Normalise the response — adjust field names if Chain2Pay uses different keys.
  // Common patterns: data.url / data.payment_url / data.link / data.checkout_url
  const paymentUrl =
    data.url || data.payment_url || data.link || data.checkout_url || data.paymentUrl;

  if (!paymentUrl) {
    throw new Error(`Chain2Pay did not return a payment URL. Response: ${JSON.stringify(data)}`);
  }

  return {
    paymentUrl,
    paymentId: data.id || data.payment_id || data.transaction_id || orderId,
    raw: data,
  };
}

module.exports = { generatePaymentLink };
