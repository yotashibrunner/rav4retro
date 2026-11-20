# RAV4 Retro — rav4retro.com

Parts store for first-gen (1996–2000) RAV4s. Node + Express + SQLite, Stripe Checkout, Resend email. No build step.

## Run locally
    npm install
    ADMIN_PASSWORD=test SESSION_SECRET=dev node src/server.js   # http://localhost:3000, admin at /admin

## Deploy (Railway)
1. Push this folder to a new GitHub repo (e.g. `rav4retro`).
2. Railway: New Project → Deploy from GitHub → the repo. Attach a Volume at `/data`.
3. Variables: `DATA_DIR=/data`, `ADMIN_PASSWORD`, `SESSION_SECRET` (long random), `ADMIN_EMAIL`, `BASE_URL=https://rav4retro.com`,
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`.
4. Stripe webhook: `https://rav4retro.com/webhook/stripe`, event `checkout.session.completed`.
5. Settings → Domains → add rav4retro.com and set the DNS record at your registrar.

## Adding a product (Admin → Add a product)
Name, price, category, photos (phone photos are fine; they're resized and GPS-stripped), description, Save.
"More options" holds colors, stock, OEM #, and an optional STL file to sell as a download.
Tick "Feature on home page" to put it in the Featured row. Use "Duplicate" on an existing product to make a variant fast.

## Other admin pages
- Orders: mark printing/shipped and add tracking (the customer is emailed).
- Requests: part requests from /request; send a quote and the customer pays from a link.
- Photos: site photos (hero, garage, trail, install, close-up, broken-vs-new). Placeholders show until uploaded.
- Settings: store name, tagline, intro, about, categories, shipping, contact email, Facebook link, announcement bar.

## Shipping labels (Shippo)
Set `SHIPPO_API_KEY` in Railway (a `shippo_test_...` key makes free fake labels; `shippo_live_...` buys real postage) and fill in the return address in Admin → Settings.
On a paid order: Shipping label → Get rates → pick one → Buy label. Tracking is saved, the order is marked shipped, the customer gets the tracking email, and a 4x6 PDF label opens to print. International orders get the customs form filled in automatically.

## Merch (Printify print-on-demand)
Set `PRINTIFY_TOKEN` and `PRINTIFY_SHOP_ID` (10322062) in Railway, and make sure `BASE_URL` is `https://www.rav4retro.net`.
- Products: build them in Printify. They copy into the shop under Merch automatically every 30 minutes (or Admin → Products → **Sync Printify now**), with mockups, sizes, colors and the retail price you set in Printify. Hide or delete a product in Printify to take it off the site.
- Orders: checkout, shipping charge and emails work like every other item. When Stripe confirms payment, the merch lines are sent to Printify automatically (order number = Printify external id). If one fails you get an email and a **Send to Printify** button on the order.
- Tracking: click **Connect shipping updates** once (Admin → Products). When Printify ships, all-merch orders are marked shipped and the customer gets the usual tracking email; mixed orders get Printify's tracking added to your notes.
- Printify charges your card on file for its base cost + shipping on each order, separate from what Stripe collects.
