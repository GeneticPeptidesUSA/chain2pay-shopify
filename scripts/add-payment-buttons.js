/**
 * add-payment-buttons.js
 *
 * Appends a cyan "Pay with Credit Card" button to the description of each
 * mapped product on rushpeptides.myshopify.com via the Shopify Admin REST API.
 *
 * Usage:
 *   node scripts/add-payment-buttons.js
 *
 * Requires in .env:
 *   SHOPIFY_ACCESS_TOKEN=shpat_...
 *   SHOPIFY_STORE_DOMAIN=rushpeptides.myshopify.com
 */

'use strict';

require('dotenv').config();

const { default: fetch } = require('node-fetch');  // node-fetch v3 is ESM-only via import, use dynamic require wrapper below

const STORE   = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN   = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VER = '2024-01';

// Sentinel embedded in the button markup — used to skip products already updated.
const SENTINEL = 'data-chain2pay-button';

// Map of product title fragments (lowercase) → Chain2Pay payment URL.
// The match is case-insensitive and uses String.includes(), so partial titles work.
const PRODUCT_MAP = [
  { title: 'bpc-157/tb-500',       url: 'https://chain2pay.cloud/pay/2IJFMjDS3M' },
  { title: 'bpc-157',              url: 'https://chain2pay.cloud/pay/1xSJnKUi8n' },
  { title: 'tb-500',               url: 'https://chain2pay.cloud/pay/j5mT9LNGBk' },
  { title: 'nad+',                 url: 'https://chain2pay.cloud/pay/Qs6aVy9zGa' },
  { title: 'nad',                  url: 'https://chain2pay.cloud/pay/Qs6aVy9zGa' },
  { title: 'glp-3',                url: 'https://chain2pay.cloud/pay/9LkIdzx8te' },
  { title: 'cjc-1295',             url: 'https://chain2pay.cloud/pay/EIpwqiHoae' },
  { title: 'ipamorelin',           url: 'https://chain2pay.cloud/pay/EIpwqiHoae' },
  { title: 'epithalon',            url: 'https://chain2pay.cloud/pay/rHqFGeRrLe' },
  { title: 'kisspeptin',           url: 'https://chain2pay.cloud/pay/4eVdbDkoCr' },
  { title: 'dsip',                 url: 'https://chain2pay.cloud/pay/gKjy0WSDtJ' },
  { title: 'kpv',                  url: 'https://chain2pay.cloud/pay/UuX8hOFDXW' },
  { title: 'glow',                 url: 'https://chain2pay.cloud/pay/4YFiH0SYnn' },
  { title: 'selank',               url: 'https://chain2pay.cloud/pay/ODRsJN1l6r' },
  { title: 'semax',                url: 'https://chain2pay.cloud/pay/3BI3rbAS8t' },
  { title: 'bacteriostatic water', url: 'https://chain2pay.cloud/pay/IEgaKJ1ich' },
  { title: 'mots-c',               url: 'https://chain2pay.cloud/pay/k8Wn7C8GUs' },
  { title: 'ghk-cu',               url: 'https://chain2pay.cloud/pay/uQpGIhVoyN' },
  { title: 'tesamorelin',          url: 'https://chain2pay.cloud/pay/4cxQiViZmS' },
  { title: '5-amino-1mq',          url: 'https://chain2pay.cloud/pay/QR7eKghElh' },
  { title: 'ss-31',                url: 'https://chain2pay.cloud/pay/g8ZirG48JW' },
  { title: 'hexarelin',            url: 'https://chain2pay.cloud/pay/JSS0jab05E' },
];

function buttonHtml(url) {
  return (
    `\n<div style="margin-top:24px;text-align:center;" ${SENTINEL}>` +
    `<a href="${url}" target="_blank" rel="noopener noreferrer" ` +
    `style="display:inline-block;padding:14px 32px;background-color:#00bcd4;` +
    `color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;` +
    `border-radius:6px;letter-spacing:0.3px;">Pay with Credit Card</a></div>`
  );
}

function matchUrl(productTitle) {
  const lower = productTitle.toLowerCase();
  // Sort longest title first so "bpc-157/tb-500" matches before "bpc-157"
  const sorted = [...PRODUCT_MAP].sort((a, b) => b.title.length - a.title.length);
  const match = sorted.find(entry => lower.includes(entry.title));
  return match ? match.url : null;
}

async function shopifyGet(path) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VER}${path}`, {
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function shopifyPut(path, body) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VER}${path}`, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function getAllProducts() {
  const products = [];
  let url = `/products.json?limit=250&fields=id,title,body_html`;

  while (url) {
    const data = await shopifyGet(url);
    products.push(...data.products);

    // Shopify paginates via Link header — not available through shopifyGet wrapper.
    // 250 per page is the max; if you have more than 250 products add cursor support.
    url = null;
  }
  return products;
}

async function main() {
  if (!STORE || !TOKEN || TOKEN === 'shpat_xxxxxxxxxxxxxxxxxxxx') {
    console.error('ERROR: Set SHOPIFY_ACCESS_TOKEN and SHOPIFY_STORE_DOMAIN in your .env file first.');
    process.exit(1);
  }

  console.log(`Fetching products from ${STORE}...`);
  const products = await getAllProducts();
  console.log(`Found ${products.length} products.\n`);

  let updated = 0;
  let skipped = 0;
  let unmatched = 0;

  for (const product of products) {
    const payUrl = matchUrl(product.title);

    if (!payUrl) {
      console.log(`  [NO MATCH]  "${product.title}"`);
      unmatched++;
      continue;
    }

    if ((product.body_html || '').includes(SENTINEL)) {
      console.log(`  [SKIP]      "${product.title}" — button already present`);
      skipped++;
      continue;
    }

    const newHtml = (product.body_html || '') + buttonHtml(payUrl);

    await shopifyPut(`/products/${product.id}.json`, {
      product: { id: product.id, body_html: newHtml },
    });

    console.log(`  [UPDATED]   "${product.title}" → ${payUrl}`);
    updated++;

    // Stay well within Shopify's 2 req/s bucket for the Admin REST API.
    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`\nDone. Updated: ${updated} | Already had button: ${skipped} | No match: ${unmatched}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
