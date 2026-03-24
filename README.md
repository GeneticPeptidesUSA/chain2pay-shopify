# Chain2Pay — Shopify Payment App

Integrates [Chain2Pay](https://chain2pay.cloud) as a credit-card payment method on **rushpeptides.myshopify.com**.

## How it works

```
Customer → Shopify Checkout
    → Shopify calls POST /payment on this server
    → Server calls Chain2Pay API → gets a payment link
    → Customer is redirected to Chain2Pay to pay by card
    → Chain2Pay redirects back to GET /confirm
    → Server notifies Shopify (resolve / reject)
    → Shopify completes the order
```

---

## Setup

### 1. Shopify Partners — create the app

1. Go to https://partners.shopify.com → **Apps → Create app → Custom app**
2. Set the App URL to your deployed server URL (e.g. `https://your-app.up.railway.app`)
3. Copy the **API key** and **API secret** into `.env`

### 2. Register the payment extension

In your Shopify Partner dashboard, open your app → **Extensions → Payments**:

| Field | Value |
|---|---|
| Extension name | Chain2Pay |
| Merchant label | Pay by card via Chain2Pay |
| Payment session URL | `https://your-app-url.com/payment` |
| Refund session URL | `https://your-app-url.com/refund` |
| Void session URL | `https://your-app-url.com/void` |
| Supported payment methods | Credit card / debit card |
| Encryption certificate | Leave blank for offsite redirect flow |

Save and **publish** the extension.

### 3. Install the app on your store

From the Partner dashboard → **Select store → rushpeptides.myshopify.com → Install**.

Copy the resulting offline access token into `.env` as `SHOPIFY_ACCESS_TOKEN`.

### 4. Configure environment variables

```bash
cp .env.example .env
# Edit .env — fill in all values including WALLET_ADDRESS
```

### 5. Deploy the server

#### Option A — Railway (recommended, free tier available)
```bash
# Install Railway CLI
npm install -g @railway/cli
railway login
railway init
railway up
# Copy the generated URL → set APP_URL in Railway env vars
```

#### Option B — Render
1. Push this folder to a GitHub repo
2. New Web Service on render.com → connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add env vars in the Render dashboard

#### Option C — Local dev with ngrok (for testing)
```bash
npm install
cp .env.example .env   # fill in values
npx ngrok http 3000    # copy the https URL → APP_URL in .env
npm start
```

---

## Environment variables

| Variable | Description |
|---|---|
| `SHOPIFY_API_KEY` | From Shopify Partners app settings |
| `SHOPIFY_API_SECRET` | From Shopify Partners app settings (used for HMAC) |
| `SHOPIFY_ACCESS_TOKEN` | Store-level offline token (shpat_…) |
| `SHOPIFY_STORE_DOMAIN` | `rushpeptides.myshopify.com` |
| `WALLET_ADDRESS` | Your wallet address for Chain2Pay payouts |
| `APP_URL` | Public HTTPS URL of this server (no trailing slash) |
| `PORT` | HTTP port (default 3000; set automatically on Railway/Heroku) |

---

## Project structure

```
chain2pay-shopify/
├── server.js           # Express entry point + env validation
├── routes/
│   └── payment.js      # Shopify Payments Apps API handlers
├── lib/
│   └── chain2pay.js    # Chain2Pay API client
├── .env.example        # Environment variable template
└── package.json
```

---

## Chain2Pay API response mapping

`lib/chain2pay.js` looks for the payment URL in `data.url`, `data.payment_url`, `data.link`, or `data.checkout_url`. If Chain2Pay uses a different field name, add it to the `paymentUrl` fallback chain in that file.

Similarly, `routes/payment.js → handleConfirm()` checks `?status=success`, `?result=paid`, `?paid=1`, and `?payment_status=completed` on the redirect back. Adjust to match whatever query params Chain2Pay actually sends.

---

## Production checklist

- [ ] Deploy server to a public HTTPS URL
- [ ] Set all env vars (especially `WALLET_ADDRESS`)
- [ ] Register and publish the Payments extension in Shopify Partners
- [ ] Install the app on `rushpeptides.myshopify.com`
- [ ] Test with a Shopify test order (use test mode in Partners dashboard)
- [ ] Confirm Chain2Pay redirect params match the logic in `handleConfirm()`
- [ ] Replace in-memory `sessions` Map with Redis or a database for production
