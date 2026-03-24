'use strict';

require('dotenv').config();

const express = require('express');
const crypto = require('crypto');

const paymentRouter = require('./routes/payment');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Raw body capture — required for HMAC verification
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    try {
      req.body = data ? JSON.parse(data) : {};
    } catch {
      req.body = {};
    }
    next();
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ---------------------------------------------------------------------------
// Payment routes
//   POST /payment         — Shopify initiates a payment session
//   GET  /confirm         — Chain2Pay redirects customer back
//   POST /refund          — Shopify requests a refund
//   POST /void            — Shopify requests a void
// ---------------------------------------------------------------------------
app.use('/payment', paymentRouter);

// /confirm is mounted on paymentRouter but Shopify/Chain2Pay call it at root level
app.get('/confirm', (req, res) => {
  // Delegate to the router handler
  req.url = '/confirm';
  paymentRouter(req, res, () => res.status(404).send('Not found'));
});

// ---------------------------------------------------------------------------
// Validate required env vars on startup
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET',
  'SHOPIFY_ACCESS_TOKEN',
  'SHOPIFY_STORE_DOMAIN',
  'STORE_CUSTOMER_DOMAIN',
  'WALLET_ADDRESS',
  'APP_URL',
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[startup] Missing required environment variables: ${missing.join(', ')}`);
  console.error('[startup] Copy .env.example to .env and fill in all values.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[server] Chain2Pay-Shopify running on port ${PORT}`);
  console.log(`[server] App URL: ${process.env.APP_URL}`);
  console.log(`[server] Store:   ${process.env.STORE_CUSTOMER_DOMAIN} (${process.env.SHOPIFY_STORE_DOMAIN})`);
});
