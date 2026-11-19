const { db, getSetting, parseProduct, token, shortCode } = require('./db');
const email = require('./email');

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const BASE_URL = () => (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const money = c => '$' + (Number(c || 0) / 100).toFixed(2);

function priceLine(p, it) {
  if (!p || !p.active) return { error: 'Item no longer available' };
  const variant = it.variant === 'digital' ? 'digital' : 'physical';
  const base = { product_id: p.id, slug: p.slug, title: p.title, variant, image: p.images[0] || null };
  if (variant === 'digital') {
    if (!p.digital_enabled || !p.stl_path) return { error: `${p.title}: file download not available` };
    return { ...base, qty: 1, unit: p.digital_price, desc: 'STL file download' };
  }
  if (!p.physical_enabled) return { error: `${p.title}: printed version not available` };
  const qty = Math.min(50, Math.max(1, parseInt(it.qty, 10) || 1));
  if (p.stock != null && qty > p.stock) return { error: `${p.title}: only ${p.stock} in stock` };
  let unit = p.physical_price;
  const opts = [];
  const extra = {};
  if (p.pricing_mode === 'sqft') {
    const w = Math.round(Number(it.w) * 4) / 4, d = Math.round(Number(it.d) * 4) / 4;
    if (!(w >= 1 && w <= 72 && d >= 1 && d <= 72)) return { error: `${p.title}: enter drawer width and depth (1–72 in)` };
    const area = (w * d) / 144;
    unit = Math.max(p.min_price || 0, Math.round(p.sqft_price * area));
    opts.push(`${w}" × ${d}" (${area.toFixed(2)} sq ft)`);
    Object.assign(extra, { w, d });
  }
  if (p.colors.length) {
    const c = p.colors.includes(it.color) ? it.color : p.colors[0];
    opts.push(`Color: ${c}`);
    extra.color = c;
  }
  if (it.notes) { const n = String(it.notes).slice(0, 200); opts.push(`Notes: ${n}`); extra.notes = n; }
  return { ...base, ...extra, qty, unit, desc: opts.join(' · ') || '3D printed' };
}

function quoteCart(items) {
  const lines = [], errors = [];
  const get = db.prepare('SELECT * FROM products WHERE id = ?');
  for (const it of (Array.isArray(items) ? items : []).slice(0, 50)) {
    const r = it.kind ? { error: 'Unknown item' }
      : priceLine(parseProduct(get.get(parseInt(it.productId, 10))), it);
    if (r.error) errors.push(r.error); else lines.push({ ...r, line_total: r.unit * r.qty, key: it.key });
  }
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const hasPhysical = lines.some(l => l.variant === 'physical');
  const physSub = lines.filter(l => l.variant === 'physical').reduce((s, l) => s + l.line_total, 0);
  const flat = parseInt(getSetting('shipping_flat'), 10) || 0;
  const freeOver = parseInt(getSetting('free_shipping_over'), 10) || 0;
  const shipping = hasPhysical ? (freeOver && physSub >= freeOver ? 0 : flat) : 0;
  return { lines, errors, subtotal, shipping, total: subtotal + shipping, hasPhysical };
}

function createOrder({ lines, subtotal, shipping, total, hasPhysical, requestId = null, emailAddr = null, name = null }) {
  const number = shortCode('RR');
  const info = db.prepare(`INSERT INTO orders (number, access_key, items, subtotal, shipping, total, has_physical, request_id, email, name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(number, token(18), JSON.stringify(lines), subtotal, shipping, total, hasPhysical ? 1 : 0, requestId, emailAddr, name);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
}

async function stripeCheckout(order, { pickup = false } = {}) {
  if (!stripe) throw new Error('Payments are not configured yet (STRIPE_SECRET_KEY missing).');
  const lines = JSON.parse(order.items);
  const base = BASE_URL();
  const params = {
    mode: 'payment',
    line_items: lines.map(l => ({
      quantity: l.qty,
      price_data: {
        currency: 'usd',
        unit_amount: l.unit,
        product_data: {
          name: l.title + (l.variant === 'digital' ? ' (STL file)' : ''),
          ...(l.desc ? { description: l.desc.slice(0, 500) } : {}),
          ...(l.image && base.startsWith('https') ? { images: [base + l.image] } : {}),
        },
      },
    })),
    client_reference_id: String(order.id),
    metadata: { order_id: String(order.id), order_number: order.number },
    success_url: `${base}/order/${order.number}?k=${order.access_key}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: order.request_id
      ? `${base}/request/${order.request_id}?k=${db.prepare('SELECT access_key FROM requests WHERE id = ?').get(order.request_id)?.access_key || ''}`
      : `${base}/cart`,
    phone_number_collection: { enabled: true },
    // discount codes are created in the Stripe dashboard (Product catalog → Coupons)
    allow_promotion_codes: true,
  };
  if (order.email) params.customer_email = order.email;
  if (order.has_physical && !pickup) {
    params.shipping_address_collection = { allowed_countries: ['US'] };
    params.shipping_options = [{
      shipping_rate_data: {
        type: 'fixed_amount',
        display_name: order.shipping === 0 ? 'Free shipping' : 'Standard shipping',
        fixed_amount: { amount: order.shipping, currency: 'usd' },
      },
    }];
  }
  const session = await stripe.checkout.sessions.create(params);
  db.prepare('UPDATE orders SET stripe_session = ? WHERE id = ?').run(session.id, order.id);
  return session.url;
}

function promoCode(session) {
  const d = (session.discounts || [])[0];
  const pc = d && d.promotion_code;
  return (pc && typeof pc === 'object' ? pc.code : '') || '';
}

// Idempotent — called from webhook and from the success page.
async function fulfill(orderId, session) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'pending') return order;
  if (session.payment_status !== 'paid') return order;

  // webhook sessions don't include the promo code text; fetch it when a discount was used
  if (session.total_details?.amount_discount && stripe && !promoCode(session)) {
    try { session = await stripe.checkout.sessions.retrieve(session.id, { expand: ['discounts.promotion_code'] }); } catch (e) { console.error('promo lookup', e.message); }
  }
  const cd = session.customer_details || {};
  const ship = session.collected_information?.shipping_details || session.shipping_details || null;
  const days = parseInt(getSetting('download_days'), 10) || 30;
  const max = parseInt(getSetting('download_max'), 10) || 5;
  const expires = new Date(Date.now() + days * 864e5).toISOString();
  const lines = JSON.parse(order.items);

  const tx = db.transaction(() => {
    const changed = db.prepare(`UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP, email = COALESCE(?, email), name = COALESCE(?, name),
      phone = ?, stripe_payment_intent = ?, shipping_address = ? WHERE id = ? AND status = 'pending'`)
      .run(cd.email || null, ship?.name || cd.name || null, cd.phone || null, session.payment_intent || null, ship ? JSON.stringify(ship) : null, order.id).changes;
    if (!changed) return false;
    const disc = session.total_details?.amount_discount || 0;
    if (disc > 0 || (session.amount_total != null && session.amount_total !== order.total)) {
      db.prepare('UPDATE orders SET discount = ?, promo_code = ?, total = ? WHERE id = ?')
        .run(disc, promoCode(session), session.amount_total ?? order.total - disc, order.id);
    }
    for (const l of lines) {
      if (l.variant === 'digital' && l.product_id) {
        const p = db.prepare('SELECT stl_path, stl_name FROM products WHERE id = ?').get(l.product_id);
        if (p?.stl_path) db.prepare('INSERT INTO downloads (token, order_id, product_id, file_path, file_name, max_count, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(token(24), order.id, l.product_id, p.stl_path, p.stl_name || 'model.stl', max, expires);
      } else if (l.product_id) {
        db.prepare('UPDATE products SET stock = MAX(stock - ?, 0) WHERE id = ? AND stock IS NOT NULL').run(l.qty, l.product_id);
      }
    }
    if (order.request_id) db.prepare("UPDATE requests SET status = 'paid' WHERE id = ?").run(order.request_id);
    return true;
  });
  if (!tx()) return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);

  const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  email.orderConfirmation(fresh).catch(e => console.error('email error', e.message));
  email.adminNewOrder(fresh).catch(e => console.error('email error', e.message));
  return fresh;
}

module.exports = { stripe, money, priceLine, quoteCart, createOrder, stripeCheckout, fulfill, BASE_URL };
