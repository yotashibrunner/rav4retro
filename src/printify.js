// Printify print-on-demand: product sync, order hand-off and shipment updates.
// Needs PRINTIFY_TOKEN and PRINTIFY_SHOP_ID. Prices, sizes, colors and mockups are managed in Printify;
// they are copied into the local products table (category "merch") so the existing shop, cart and checkout just work.
const crypto = require('crypto');
const { db, getSetting, slugify } = require('./db');
const email = require('./email');

const API = process.env.PRINTIFY_API_BASE || 'https://api.printify.com/v1';
const enabled = () => !!(process.env.PRINTIFY_TOKEN && process.env.PRINTIFY_SHOP_ID);
const SHOP = () => process.env.PRINTIFY_SHOP_ID;

async function call(path, body, method) {
  const res = await fetch(API + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      Authorization: `Bearer ${process.env.PRINTIFY_TOKEN}`,
      'Content-Type': 'application/json;charset=utf-8',
      'User-Agent': 'rav4retro-site',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Printify ${res.status}: ${JSON.stringify(j.errors || j.message || j).slice(0, 400)}`);
  return j;
}

// Printify descriptions are HTML; the shop renders plain text with line breaks.
function plainText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h\d)\s*>/gi, '\n\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Turn a Printify product into what the shop stores: option lists (e.g. Color, Size) and enabled variants.
function shape(p) {
  const variants = (p.variants || []).filter(v => v.is_enabled && v.is_available !== false);
  const valueTitle = new Map();
  for (const o of p.options || []) for (const v of o.values || []) valueTitle.set(v.id, v.title);
  const used = new Set(variants.flatMap(v => v.options || []));
  const options = (p.options || [])
    .map(o => ({ name: o.name, values: (o.values || []).filter(v => used.has(v.id)).map(v => v.title) }))
    .filter(o => o.values.length);
  const vs = variants.map(v => ({
    id: v.id,
    price: v.price,          // Printify retail price (replaced below when auto-pricing is on)
    cost: v.cost ?? null,    // Printify base cost, cents
    title: v.title,
    opts: (v.options || []).map(id => valueTitle.get(id)).filter(Boolean),
  }));
  const seen = new Set();
  const images = [...(p.images || [])]
    .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0))
    .map(i => i.src)
    .filter(src => src && !seen.has(src) && seen.add(src))
    .slice(0, 8);
  return { options, variants: vs, images };
}

function uniqueSlug(title, exceptId) {
  const base = slugify(title);
  let slug = base, n = 2;
  while (db.prepare('SELECT id FROM products WHERE slug = ? AND id IS NOT ?').get(slug, exceptId ?? null)) slug = `${base}-${n++}`;
  return slug;
}

// ---------- auto-pricing ----------
// Price = (Printify base cost + Printify US shipping + Stripe fee) marked up so `merch_margin`% of what the
// customer pays is profit, rounded up to .99. Shipping is built in so free-shipping orders still make money.
const STRIPE_PCT = 0.029, STRIPE_FIXED = 30;
const margin = () => {
  const m = parseFloat(getSetting('merch_margin'));
  return Number.isFinite(m) && m > 0 && m < 60 ? m / 100 : 0; // 0 = use the prices set in Printify
};
const up99 = c => Math.max(99, Math.ceil((c + 1) / 100) * 100 - 1);
function autoPrice(cost, ship, m) {
  return up99((cost + ship + STRIPE_FIXED) / (1 - m - STRIPE_PCT));
}
async function shippingTable(bp, pp, cache) {
  const key = `${bp}/${pp}`;
  if (!cache.has(key)) {
    cache.set(key, call(`/catalog/blueprints/${bp}/print_providers/${pp}/shipping.json`)
      .then(r => r.profiles || [])
      .catch(e => { console.error('Printify shipping lookup failed', key, e.message); return []; }));
  }
  return cache.get(key);
}
function usShipping(profiles, variantId) {
  const hit = profiles.find(p => (p.variant_ids || []).includes(variantId) && (p.countries || []).includes('US'))
    || profiles.find(p => (p.variant_ids || []).includes(variantId));
  return hit?.first_item?.cost ?? null;
}

let lastSync = { at: null, count: 0, error: null };

// Copy every Printify product into the shop. Prices/titles/photos always follow Printify;
// featured, sort order and category you set in admin are kept.
async function sync() {
  if (!enabled()) throw new Error('Set PRINTIFY_TOKEN and PRINTIFY_SHOP_ID first.');
  const all = [];
  for (let page = 1; page < 50; page++) {
    const r = await call(`/shops/${SHOP()}/products.json?page=${page}&limit=50`);
    all.push(...(r.data || []));
    if (!r.last_page || page >= r.last_page) break;
  }
  const m = margin();
  const shipCache = new Map();
  const shaped = new Map();
  for (const p of all) {
    const s = shape(p);
    if (m) {
      const profiles = p.blueprint_id && p.print_provider_id ? await shippingTable(p.blueprint_id, p.print_provider_id, shipCache) : [];
      for (const v of s.variants) {
        const ship = usShipping(profiles, v.id);
        v.ship = ship;
        if (v.cost != null && ship != null) v.price = autoPrice(v.cost, ship, m);
        else console.warn(`Printify: no cost/shipping for ${p.title} / ${v.title}; using Printify price`);
      }
    }
    shaped.set(p.id, s);
  }
  const seenIds = [];
  const tx = db.transaction(() => {
    for (const p of all) {
      const s = shaped.get(p.id);
      const show = p.visible !== false && s.variants.length > 0;
      const minPrice = s.variants.length ? Math.min(...s.variants.map(v => v.price)) : 0;
      const pod = JSON.stringify({ options: s.options, variants: s.variants });
      const existing = db.prepare('SELECT id, title FROM products WHERE printify_id = ?').get(p.id);
      if (existing) {
        db.prepare(`UPDATE products SET title = ?, slug = CASE WHEN title = ? THEN slug ELSE ? END, description = ?, images = ?, physical_price = ?,
          printify_variants = ?, active = ? WHERE id = ?`)
          .run(p.title, p.title, uniqueSlug(p.title, existing.id), plainText(p.description), JSON.stringify(s.images), minPrice, pod, show ? 1 : 0, existing.id);
      } else {
        db.prepare(`INSERT INTO products (slug, title, category, description, images, pricing_mode, physical_enabled, physical_price, stock, lead_time,
          digital_enabled, active, fitment, printify_id, printify_variants) VALUES (?, ?, 'merch', ?, ?, 'fixed', 1, ?, NULL, '3–7 business days', 0, ?, '', ?, ?)`)
          .run(uniqueSlug(p.title), p.title, plainText(p.description), JSON.stringify(s.images), minPrice, show ? 1 : 0, p.id, pod);
      }
      seenIds.push(p.id);
    }
    // deleted in Printify -> hide here (past orders keep their records)
    const gone = db.prepare('SELECT id, printify_id FROM products WHERE printify_id IS NOT NULL').all().filter(r => !seenIds.includes(r.printify_id));
    for (const g of gone) db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(g.id);
  });
  tx();
  lastSync = { at: new Date().toISOString(), count: all.length, error: null, margin: m };
  return lastSync;
}

function startAutoSync() {
  if (!enabled()) return;
  const run = () => sync().then(r => console.log(`Printify sync: ${r.count} products`)).catch(e => { lastSync.error = e.message; console.error('Printify sync failed:', e.message); });
  setTimeout(run, 5000);
  setInterval(run, 30 * 60 * 1000).unref();
}

// Send the Printify lines of a paid order. Safe to call twice: skips orders already sent.
async function submit(order) {
  if (!enabled()) return null;
  const lines = JSON.parse(order.items).filter(l => l.printify_id && l.pv);
  if (!lines.length || order.printify_order_id) return null;
  const ship = order.shipping_address ? JSON.parse(order.shipping_address) : null;
  const a = ship?.address;
  if (!a) throw new Error('No shipping address on the order.');
  const parts = String(ship.name || order.name || '').trim().split(/\s+/);
  try {
    const r = await call(`/shops/${SHOP()}/orders.json`, {
      external_id: order.number,
      label: order.number,
      line_items: lines.map(l => ({ product_id: l.printify_id, variant_id: Number(l.pv), quantity: l.qty })),
      shipping_method: 1,
      send_shipping_notification: false, // the site emails tracking itself
      address_to: {
        first_name: parts[0] || 'Customer',
        last_name: parts.slice(1).join(' ') || '-',
        email: order.email || '',
        phone: order.phone || '',
        country: a.country || order.ship_country || 'US',
        region: a.state || '',
        address1: a.line1 || '',
        address2: a.line2 || '',
        city: a.city || '',
        zip: a.postal_code || '',
      },
    });
    db.prepare("UPDATE orders SET printify_order_id = ?, printify_status = 'sent' WHERE id = ?").run(r.id, order.id);
    return r.id;
  } catch (e) {
    db.prepare('UPDATE orders SET printify_status = ? WHERE id = ?').run(('error: ' + e.message).slice(0, 500), order.id);
    email.send(process.env.ADMIN_EMAIL, `Printify order failed: ${order.number}`,
      `<p>Order ${order.number} was paid but could not be sent to Printify:</p><pre>${String(e.message).replace(/</g, '&lt;')}</pre><p>Fix it, then use "Send to Printify" on the order in admin.</p>`).catch(() => {});
    throw e;
  }
}

// Shipment webhooks: the URL carries a key derived from SESSION_SECRET, and the order is re-read from Printify
// rather than trusting the posted body.
const hookKey = () => crypto.createHmac('sha256', process.env.SESSION_SECRET || process.env.PRINTIFY_TOKEN || '').update('printify-webhook').digest('hex').slice(0, 32);
const hookUrl = () => `${(process.env.BASE_URL || '').replace(/\/$/, '')}/webhook/printify?k=${hookKey()}`;

async function connectWebhooks() {
  const existing = await call(`/shops/${SHOP()}/webhooks.json`);
  const want = ['order:shipment:created', 'order:updated'];
  for (const topic of want) {
    if ((existing || []).some(w => w.topic === topic && w.url === hookUrl())) continue;
    await call(`/shops/${SHOP()}/webhooks.json`, { topic, url: hookUrl() });
  }
  return hookUrl();
}

async function handleWebhook(body) {
  const pfId = body?.resource?.id;
  if (!pfId) return;
  const order = db.prepare('SELECT * FROM orders WHERE printify_order_id = ?').get(String(pfId));
  if (!order) return;
  const po = await call(`/shops/${SHOP()}/orders/${pfId}.json`);
  if (po.external_id && po.external_id !== order.number) return;
  db.prepare('UPDATE orders SET printify_status = ? WHERE id = ?').run(String(po.status || 'sent').slice(0, 60), order.id);
  const s = (po.shipments || []).find(x => x.number);
  if (!s) return;
  const carrier = String(s.carrier || 'Carrier').toUpperCase();
  const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  const allPod = JSON.parse(fresh.items).every(l => l.printify_id);
  if (allPod) {
    if (fresh.tracking === s.number) return;
    db.prepare(`UPDATE orders SET carrier = ?, tracking = ?, status = CASE WHEN status IN ('paid','printing') THEN 'shipped' ELSE status END,
      shipped_at = COALESCE(shipped_at, CURRENT_TIMESTAMP) WHERE id = ?`).run(carrier, s.number, order.id);
    email.orderShipped(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)).catch(e => console.error('email error', e.message));
  } else {
    // mixed order: you still ship your own parts, so just record Printify's tracking for you
    const note = `Printify shipped merch: ${carrier} ${s.number}`;
    if (!String(fresh.admin_notes || '').includes(s.number)) {
      db.prepare('UPDATE orders SET admin_notes = TRIM(COALESCE(admin_notes, \'\') || char(10) || ?) WHERE id = ?').run(note, order.id);
      email.send(process.env.ADMIN_EMAIL, `Printify shipped part of ${order.number}`, `<p>${note}</p><p>Your own parts on this order still need shipping.</p>`).catch(() => {});
    }
  }
}

module.exports = { enabled, sync, startAutoSync, submit, connectWebhooks, handleWebhook, hookKey, status: () => lastSync };
