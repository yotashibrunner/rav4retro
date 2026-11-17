const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, UPLOAD_DIR, FILE_DIR, REQUEST_DIR, getSetting, setSetting, getCategories, parseProduct, token, slugify } = require('./db');
const { layout, esc, money, nl2br, REQUEST_TYPES, REQUEST_STATUS, ORDER_STATUS } = require('./views');
const email = require('./email');

const router = express.Router();
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET not set — admin sessions reset on every restart.');
if (!process.env.ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD not set — admin login disabled.');

// ---------- auth (signed cookie) ----------
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(a => a[0]));
function isAuthed(req) {
  const c = cookies(req).rr_admin;
  if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign('admin:' + exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
const loginAttempts = new Map();

router.get('/login', (req, res) => res.send(layout('Admin login', `<form class="form narrow" method="post" action="/admin/login">
  <h1 class="page">Admin</h1>${req.query.e ? '<div class="notice err">Wrong password.</div>' : ''}
  <label>Password<input type="password" name="password" autofocus required></label><button class="btn">Log in</button></form>`, { admin: true })));

router.post('/login', (req, res) => {
  const ip = req.ip, now = Date.now();
  const a = (loginAttempts.get(ip) || []).filter(t => now - t < 15 * 60e3);
  if (a.length >= 10) return res.status(429).send('Too many attempts, wait 15 minutes.');
  const pw = String(req.body.password || ''), real = process.env.ADMIN_PASSWORD || '';
  const ok = real && pw.length === real.length && crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(real));
  if (!ok) { a.push(now); loginAttempts.set(ip, a); return res.redirect('/admin/login?e=1'); }
  const exp = String(Date.now() + 14 * 864e5);
  res.setHeader('Set-Cookie', `rr_admin=${exp}.${sign('admin:' + exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${14 * 86400}${req.secure ? '; Secure' : ''}`);
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'rr_admin=; Path=/; Max-Age=0');
  res.redirect('/admin/login');
});

router.use((req, res, next) => (isAuthed(req) ? next() : res.redirect('/admin/login')));

const page = (title, body) => layout(title, body, { admin: true });
const statusPill = (s, map) => `<span class="pill s-${esc(s)}">${esc(map[s] || s)}</span>`;
const dt = s => (s ? new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) : '');

// ---------- dashboard ----------
router.get('/', (req, res) => {
  const count = (sql, ...p) => db.prepare(sql).get(...p).n;
  const toShip = count("SELECT COUNT(*) n FROM orders WHERE status IN ('paid','printing') AND has_physical = 1");
  const newReq = count("SELECT COUNT(*) n FROM requests WHERE status IN ('new','reviewing')");
  const rev30 = db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status NOT IN ('pending','cancelled') AND paid_at >= datetime('now','-30 days')").get().n;
  const orders30 = count("SELECT COUNT(*) n FROM orders WHERE status NOT IN ('pending','cancelled') AND paid_at >= datetime('now','-30 days')");
  const recent = db.prepare("SELECT * FROM orders WHERE status != 'pending' ORDER BY id DESC LIMIT 8").all();
  const reqs = db.prepare("SELECT * FROM requests WHERE status IN ('new','reviewing','accepted') ORDER BY id DESC LIMIT 8").all();
  res.send(page('Dashboard', `
  <p><a class="btn" href="/admin/products/new">Add a product</a></p>
  <div class="stats"><a href="/admin/orders?s=open"><b>${toShip}</b>to print / ship</a><a href="/admin/requests?s=open"><b>${newReq}</b>requests to quote</a>
  <div><b>${money(rev30)}</b>revenue, 30 days</div><div><b>${orders30}</b>orders, 30 days</div></div>
  <div class="two"><div><h2>Recent orders</h2>${ordersTable(recent)}</div><div><h2>Open requests</h2>${requestsTable(reqs)}</div></div>
  <form method="post" action="/admin/logout"><button class="linkbtn">Log out</button></form>`));
});

function ordersTable(rows) {
  if (!rows.length) return '<p class="muted">None.</p>';
  return `<table class="tbl"><tr><th>Order</th><th>Customer</th><th>Status</th><th class="r">Total</th></tr>${rows.map(o => `<tr>
    <td><a href="/admin/orders/${o.id}">${esc(o.number)}</a><br><span class="small muted">${dt(o.paid_at || o.created_at)}</span></td>
    <td>${esc(o.name || '')}<br><span class="small muted">${esc(o.email || '')}</span></td>
    <td>${statusPill(o.status, ORDER_STATUS)}${o.has_physical ? '' : ' <span class="pill">digital</span>'}${o.request_id ? ' <span class="pill">custom</span>' : ''}</td><td class="r">${money(o.total)}</td></tr>`).join('')}</table>`;
}
function requestsTable(rows) {
  if (!rows.length) return '<p class="muted">None.</p>';
  return `<table class="tbl"><tr><th>Request</th><th>Customer</th><th>Status</th></tr>${rows.map(r => `<tr>
    <td><a href="/admin/requests/${r.id}">${esc(r.title || r.number)}</a><br><span class="small muted">${esc(r.number)} · ${esc(REQUEST_TYPES[r.type]?.split(' (')[0] || r.type)} · ${dt(r.created_at)}</span></td>
    <td>${esc(r.name)}<br><span class="small muted">${esc(r.email)}</span></td><td>${statusPill(r.status, REQUEST_STATUS)}</td></tr>`).join('')}</table>`;
}

// ---------- orders ----------
router.get('/orders', (req, res) => {
  const s = req.query.s || 'open';
  const where = { open: "status IN ('paid','printing')", all: "status != 'pending'", pending: "status = 'pending'" }[s] || 'status = ?';
  const rows = db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY id DESC LIMIT 300`).all(...(where.includes('?') ? [s] : []));
  const tab = (k, l) => `<a class="${s === k ? 'on' : ''}" href="/admin/orders?s=${k}">${l}</a>`;
  res.send(page('Orders', `<h1 class="page">Orders</h1><div class="filters">${tab('open', 'To do')}${tab('shipped', 'Shipped')}${tab('complete', 'Complete')}${tab('all', 'All paid')}${tab('pending', 'Abandoned')}${tab('cancelled', 'Cancelled')}</div>${ordersTable(rows)}`));
});

router.get('/orders/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!o) return res.status(404).send(page('Not found', '<p>Order not found.</p>'));
  const lines = JSON.parse(o.items);
  const addr = o.shipping_address ? JSON.parse(o.shipping_address) : null;
  const dls = db.prepare('SELECT * FROM downloads WHERE order_id = ?').all(o.id);
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  res.send(page(`Order ${o.number}`, `
  <p><a href="/admin/orders">← Orders</a></p>
  <h1 class="page">${esc(o.number)} ${statusPill(o.status, ORDER_STATUS)}</h1>
  <div class="two"><div>
    <table class="tbl">${lines.map((l, i) => `<tr><td><b>${esc(l.title)}</b>${l.variant === 'digital' ? ' <span class="pill">STL</span>' : ''}<br><span class="small">${esc(l.desc || '')}</span></td><td>× ${l.qty}</td><td class="r">${money(l.unit * l.qty)}</td></tr>`).join('')}
    <tr><td colspan="2">Shipping</td><td class="r">${money(o.shipping)}</td></tr><tr class="tot"><td colspan="2">Total</td><td class="r">${money(o.total)}</td></tr></table>
    ${o.request_id ? `<p>From custom request <a href="/admin/requests/${o.request_id}">#${o.request_id}</a></p>` : ''}
    ${dls.length ? `<h3>Downloads</h3>${dls.map(d => `<p class="small">${esc(d.file_name)} — used ${d.count}/${d.max_count}, expires ${dt(d.expires_at)}
      <form class="inline" method="post" action="/admin/downloads/${d.token}/reset"><button class="linkbtn">reset + extend</button></form></p>`).join('')}` : ''}
  </div><div>
    <h3>Customer</h3><p>${esc(o.name || '—')}<br><a href="mailto:${esc(o.email)}">${esc(o.email || '')}</a><br>${esc(o.phone || '')}</p>
    ${addr?.address ? `<h3>Ship to</h3><p class="addr">${esc(addr.name)}<br>${esc(addr.address.line1)}${addr.address.line2 ? '<br>' + esc(addr.address.line2) : ''}<br>${esc(addr.address.city)}, ${esc(addr.address.state)} ${esc(addr.address.postal_code)}</p>` : o.has_physical ? '<p class="muted">No shipping address (pickup).</p>' : ''}
    <p class="small muted">Created ${dt(o.created_at)}${o.paid_at ? ` · Paid ${dt(o.paid_at)}` : ''}${o.shipped_at ? ` · Shipped ${dt(o.shipped_at)}` : ''}</p>
    <p class="small"><a target="_blank" href="${base}/order/${o.number}?k=${o.access_key}">Customer's order page ↗</a>${o.stripe_payment_intent ? ` · <a target="_blank" href="https://dashboard.stripe.com/payments/${esc(o.stripe_payment_intent)}">Stripe ↗</a>` : ''}</p>
    <form class="form" method="post" action="/admin/orders/${o.id}">
      <label>Status<select name="status">${Object.entries(ORDER_STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="row2"><label>Carrier<input name="carrier" value="${esc(o.carrier || '')}" placeholder="USPS"></label><label>Tracking #<input name="tracking" value="${esc(o.tracking || '')}"></label></div>
      <label>Notes (private)<textarea name="admin_notes" rows="3">${esc(o.admin_notes || '')}</textarea></label>
      <label class="check"><input type="checkbox" name="notify" checked> Email customer when marked shipped</label>
      <button class="btn">Save</button></form>
  </div></div>`));
});

router.post('/orders/:id', async (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!o) return res.sendStatus(404);
  const status = ORDER_STATUS[req.body.status] ? req.body.status : o.status;
  db.prepare(`UPDATE orders SET status = ?, carrier = ?, tracking = ?, admin_notes = ?, shipped_at = CASE WHEN ? = 'shipped' AND shipped_at IS NULL THEN CURRENT_TIMESTAMP ELSE shipped_at END WHERE id = ?`)
    .run(status, req.body.carrier || null, req.body.tracking || null, req.body.admin_notes || null, status, o.id);
  if (status === 'shipped' && o.status !== 'shipped' && req.body.notify) {
    email.orderShipped(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)).catch(e => console.error(e.message));
  }
  if (o.request_id && ['shipped', 'complete'].includes(status)) db.prepare("UPDATE requests SET status = 'done' WHERE id = ?").run(o.request_id);
  res.redirect(`/admin/orders/${o.id}`);
});

router.post('/downloads/:token/reset', (req, res) => {
  const d = db.prepare('SELECT * FROM downloads WHERE token = ?').get(req.params.token);
  if (!d) return res.sendStatus(404);
  const days = parseInt(getSetting('download_days'), 10) || 30;
  db.prepare('UPDATE downloads SET count = 0, expires_at = ? WHERE token = ?').run(new Date(Date.now() + days * 864e5).toISOString(), d.token);
  res.redirect(`/admin/orders/${d.order_id}`);
});

// ---------- requests ----------
router.get('/requests', (req, res) => {
  const s = req.query.s || 'open';
  const where = { open: "status IN ('new','reviewing')", quoted: "status IN ('quoted','accepted')", active: "status IN ('paid','in_progress')", all: '1=1' }[s] || 'status = ?';
  const rows = db.prepare(`SELECT * FROM requests WHERE ${where} ORDER BY id DESC LIMIT 300`).all(...(where.includes('?') ? [s] : []));
  const tab = (k, l) => `<a class="${s === k ? 'on' : ''}" href="/admin/requests?s=${k}">${l}</a>`;
  res.send(page('Requests', `<h1 class="page">Custom requests</h1>
  <div class="filters">${tab('open', 'Needs quote')}${tab('quoted', 'Quoted')}${tab('active', 'Paid / in progress')}${tab('done', 'Done')}${tab('declined', 'Declined')}${tab('all', 'All')}</div>${requestsTable(rows)}`));
});

router.get('/requests/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!r) return res.status(404).send(page('Not found', '<p>Request not found.</p>'));
  if (r.status === 'new') db.prepare("UPDATE requests SET status = 'reviewing' WHERE id = ?").run(r.id);
  const files = JSON.parse(r.files || '[]');
  const orders = db.prepare('SELECT * FROM orders WHERE request_id = ? ORDER BY id DESC').all(r.id);
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  const isImg = f => /\.(jpe?g|png|gif|webp)$/i.test(f.stored);
  res.send(page(`Request ${r.number}`, `
  <p><a href="/admin/requests">← Requests</a></p>
  <h1 class="page">${esc(r.title)} ${statusPill(r.status === 'new' ? 'reviewing' : r.status, REQUEST_STATUS)}</h1>
  <div class="two"><div>
    <dl class="kv"><dt>#</dt><dd>${esc(r.number)}</dd><dt>Type</dt><dd>${esc(REQUEST_TYPES[r.type] || r.type)}</dd>
    <dt>From</dt><dd>${esc(r.name)} · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a> ${esc(r.phone || '')}</dd>
    ${r.vehicle ? `<dt>Vehicle</dt><dd>${esc(r.vehicle)}</dd>` : ''}${r.dimensions ? `<dt>Dimensions</dt><dd>${esc(r.dimensions)}</dd>` : ''}
    <dt>Qty</dt><dd>${r.quantity}</dd><dt>Material</dt><dd>${esc(r.material || "—")}</dd>${r.color ? `<dt>Color</dt><dd>${esc(r.color)}</dd>` : ''}
    ${r.deadline ? `<dt>Need by</dt><dd>${esc(r.deadline)}</dd>` : ''}${r.budget ? `<dt>Budget</dt><dd>${esc(r.budget)}</dd>` : ''}
    <dt>Delivery</dt><dd>${r.delivery === 'pickup' ? 'Local pickup' : 'Ship'}</dd>
    <dt>Received</dt><dd>${dt(r.created_at)}</dd><dt>Details</dt><dd>${nl2br(r.details)}</dd></dl>
    ${files.length ? `<h3>Files</h3><div class="files">${files.map(f => `<a href="/admin/requests/${r.id}/file/${encodeURIComponent(f.stored)}" target="_blank">${isImg(f) ? `<img src="/admin/requests/${r.id}/file/${encodeURIComponent(f.stored)}" alt="">` : '📎'} ${esc(f.name)} <span class="small muted">${(f.size / 1048576).toFixed(1)} MB</span></a>`).join('')}</div>` : ''}
    ${orders.length ? `<h3>Orders</h3>${ordersTable(orders)}` : ''}
  </div><div>
    <h3>Quote</h3>
    <form class="form" method="post" action="/admin/requests/${r.id}/quote">
      <div class="row2"><label>Price ($)<input name="price" type="number" step="0.01" min="0" required value="${r.quote_price != null ? (r.quote_price / 100).toFixed(2) : ''}"></label>
      <label>Shipping ($)<input name="shipping" type="number" step="0.01" min="0" value="${r.quote_shipping != null ? (r.quote_shipping / 100).toFixed(2) : r.delivery === 'pickup' ? '0' : (getSetting('shipping_flat') / 100).toFixed(2)}"></label></div>
      <label>Lead time<input name="lead" value="${esc(r.quote_lead || '')}" placeholder="5–7 business days"></label>
      <label>Message to customer<textarea name="message" rows="5" placeholder="What's included, material choice, assumptions…">${esc(r.quote_message || '')}</textarea></label>
      <button class="btn">${r.quote_price != null ? 'Update quote & re-send' : 'Send quote'}</button></form>
    <p class="small"><a target="_blank" href="${base}/request/${r.id}?k=${r.access_key}">Customer's request page ↗</a></p>
    <form class="form" method="post" action="/admin/requests/${r.id}">
      <label>Status<select name="status">${Object.entries(REQUEST_STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Notes (private)<textarea name="admin_notes" rows="3">${esc(r.admin_notes || '')}</textarea></label>
      <button class="btn ghost">Save</button></form>
  </div></div>`));
});

router.get('/requests/:id/file/:stored', (req, res) => {
  const r = db.prepare('SELECT files FROM requests WHERE id = ?').get(parseInt(req.params.id, 10));
  const f = r && JSON.parse(r.files).find(x => x.stored === req.params.stored);
  if (!f) return res.sendStatus(404);
  const full = path.join(REQUEST_DIR, path.basename(f.stored));
  if (/\.(jpe?g|png|gif|webp)$/i.test(f.stored)) return res.sendFile(full);
  res.download(full, f.name);
});

router.post('/requests/:id/quote', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cents = v => Math.round(parseFloat(v || 0) * 100);
  db.prepare(`UPDATE requests SET quote_price = ?, quote_shipping = ?, quote_lead = ?, quote_message = ?, status = 'quoted', quoted_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(cents(req.body.price), cents(req.body.shipping), req.body.lead || null, req.body.message || null, id);
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  email.requestQuoted(r).catch(e => console.error(e.message));
  res.redirect(`/admin/requests/${id}`);
});

router.post('/requests/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = REQUEST_STATUS[req.body.status] ? req.body.status : 'reviewing';
  db.prepare('UPDATE requests SET status = ?, admin_notes = ? WHERE id = ?').run(status, req.body.admin_notes || null, id);
  res.redirect(`/admin/requests/${id}`);
});

// ---------- products ----------
const productUpload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => cb(null, f.fieldname === 'stl' ? FILE_DIR : UPLOAD_DIR),
    filename: (req, f, cb) => cb(null, `${Date.now()}-${token(6)}${path.extname(f.originalname).toLowerCase().slice(0, 10)}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, f, cb) => {
    if (f.fieldname === 'stl') return cb(null, /\.(stl|3mf|step|stp|obj|zip)$/i.test(f.originalname));
    cb(null, /\.(jpe?g|png|gif|webp)$/i.test(f.originalname));
  },
}).fields([{ name: 'images', maxCount: 12 }, { name: 'stl', maxCount: 1 }]);

router.get('/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY active DESC, sort ASC, id DESC').all().map(parseProduct);
  const cats = Object.fromEntries(getCategories().map(c => [c.key, c.label]));
  res.send(page('Products', `<h1 class="page">Products <a class="btn sm" href="/admin/products/new">Add a product</a></h1>
  <table class="tbl"><tr><th></th><th>Product</th><th>Printed</th><th>STL</th><th>Stock</th><th></th></tr>${rows.map(p => `<tr class="${p.active ? '' : 'dim'}">
    <td>${p.images[0] ? `<img class="mini" src="${esc(p.images[0])}" alt="">` : ''}</td>
    <td><a href="/admin/products/${p.id}">${esc(p.title)}</a><br><span class="small muted">${esc(cats[p.category] || p.category)}${p.featured ? ' · ★ featured' : ''}${p.active ? '' : ' · hidden'}</span></td>
    <td>${p.physical_enabled ? (p.pricing_mode === 'sqft' ? `${money(p.sqft_price)}/sq ft` : money(p.physical_price)) : '—'}</td>
    <td>${p.digital_enabled ? money(p.digital_price) + (p.stl_path ? '' : ' <span class="pill s-cancelled">no file</span>') : '—'}</td>
    <td>${p.stock == null ? 'to order' : p.stock}</td><td><a target="_blank" href="/p/${esc(p.slug)}">view ↗</a></td></tr>`).join('')}</table>
  ${rows.length ? '' : '<p class="muted">No products yet. Add one: name, price, a photo or two and save.</p>'}`));
});

function productForm(p) {
  const n = !p.id;
  const d = v => (v != null ? (v / 100).toFixed(2) : '');
  return page(n ? 'New product' : p.title, `<p><a href="/admin/products">← Products</a></p><h1 class="page">${n ? 'Add a product' : esc(p.title)}</h1>
  <form class="form" method="post" enctype="multipart/form-data" action="/admin/products/${n ? 'new' : p.id}">
    <input type="hidden" name="pricing_mode" value="fixed">
    <label>Product name<input name="title" required value="${esc(p.title || '')}" placeholder="Front door tweeter panels"></label>
    <div class="row3">
      <label>Price ($)<input name="physical_price" type="number" step="0.01" min="0" inputmode="decimal" value="${d(p.physical_price)}" placeholder="34.99"></label>
      <label>Category<select name="category">${getCategories().map(c => `<option value="${esc(c.key)}" ${c.key === p.category ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
      <label>Fits<input name="fitment" maxlength="160" value="${esc(p.fitment ?? (n ? "'96–'00 RAV4, 2- & 4-door" : ''))}"></label>
    </div>
    <label>Photos${(p.images || []).length ? ' (add more)' : ''}<input type="file" name="images" multiple accept="image/*"></label>
    <p class="small muted" style="margin-top:-10px">Straight from your phone is fine. Photos are resized and their location data is removed. The first photo is the main one.</p>
    ${(p.images || []).length ? `<div class="imgedit">${p.images.map(i => `<label><img src="${esc(i)}" alt=""><span><input type="checkbox" name="remove_images" value="${esc(i)}"> remove</span></label>`).join('')}</div>` : ''}
    <label>Description<textarea name="description" rows="6" placeholder="What it replaces or upgrades, material, what's in the box, install notes…">${esc(p.description || '')}</textarea></label>
    <div class="row3"><label class="check"><input type="checkbox" name="active" ${p.active !== 0 ? 'checked' : ''}> Show in shop</label>
    <label class="check"><input type="checkbox" name="featured" ${p.featured ? 'checked' : ''}> Feature on home page</label>
    <label class="check"><input type="checkbox" name="physical_enabled" ${p.physical_enabled !== 0 ? 'checked' : ''}> Sell the printed part</label></div>
    <details class="more" ${p.digital_enabled || p.oem_part || p.stock != null || (p.colors || []).length ? 'open' : ''}><summary>More options: colors, stock, OEM #, STL file</summary>
      <div class="row3"><label>Colors (comma-separated)<input name="colors" value="${esc((p.colors || []).join(', '))}" placeholder="Black, Gray"></label>
      <label>Stock (blank = made to order)<input name="stock" type="number" min="0" value="${p.stock ?? ''}"></label>
      <label>Ships in<input name="lead_time" value="${esc(p.lead_time || '')}" placeholder="3–5 days"></label></div>
      <div class="row3"><label>OEM part # it replaces<input name="oem_part" maxlength="60" value="${esc(p.oem_part || '')}" placeholder="e.g. 64719-42010"></label>
      <label>Sort order (low = first)<input name="sort" type="number" value="${p.sort || 0}"></label><span></span></div>
      <fieldset><legend><label class="check"><input type="checkbox" name="digital_enabled" ${p.digital_enabled ? 'checked' : ''}> Also sell the STL file</label></legend>
        <div class="row2"><label>File price ($)<input name="digital_price" type="number" step="0.01" min="0" value="${d(p.digital_price)}"></label>
        <label>File (.stl, .3mf, .step, .zip)${p.stl_name ? ` — current: <code>${esc(p.stl_name)}</code>` : ''}<input type="file" name="stl" accept=".stl,.3mf,.step,.stp,.obj,.zip"></label></div>
        <p class="small muted">Stored privately. Buyers get expiring download links.</p>
      </fieldset>
    </details>
    <button class="btn">${n ? 'Add product' : 'Save changes'}</button>
  </form>
  ${n ? '' : `<p style="margin-top:22px"><a href="/p/${esc(p.slug)}" target="_blank">View in shop</a> &nbsp; <a href="/admin/products/${p.id}/duplicate">Duplicate as a new product</a></p>
  <form method="post" action="/admin/products/${p.id}/delete" onsubmit="return confirm('Delete this product? Past orders keep their records.')"><button class="linkbtn danger">Delete product</button></form>`}`);
}

router.get('/products/new', (req, res) => res.send(productForm({ category: getCategories()[0]?.key })));
router.get('/products/:id/duplicate', (req, res) => {
  const p = parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(parseInt(req.params.id, 10)));
  if (!p) return res.redirect('/admin/products');
  res.send(productForm({ ...p, id: undefined, slug: undefined, title: p.title + ' (copy)', images: [], stl_name: null, digital_enabled: 0 }));
});
router.get('/products/:id', (req, res) => {
  const p = parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(parseInt(req.params.id, 10)));
  if (!p) return res.status(404).send(page('Not found', ''));
  res.send(productForm(p));
});

router.post('/products/:id', productUpload, async (req, res) => {
  const b = req.body;
  const isNew = req.params.id === 'new';
  const existing = isNew ? null : parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(parseInt(req.params.id, 10)));
  if (!isNew && !existing) return res.sendStatus(404);
  const cents = v => Math.round(parseFloat(v || 0) * 100) || 0;
  const removed = [].concat(b.remove_images || []);
  let images = (existing?.images || []).filter(i => !removed.includes(i));
  removed.forEach(i => fs.unlink(path.join(UPLOAD_DIR, path.basename(i)), () => {}));
  // phone photos: fix rotation, strip EXIF/GPS, cap at 1600px, save as webp
  const sharp = require('sharp');
  for (const f of req.files?.images || []) {
    const out = f.filename.replace(/\.[^.]+$/, '') + '.webp';
    try {
      await sharp(f.path).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(UPLOAD_DIR, out));
      fs.unlink(f.path, () => {}); images.push('/uploads/' + out);
    } catch (e) { console.error('image', e.message); images.push('/uploads/' + f.filename); }
  }
  let stl_path = existing?.stl_path || null, stl_name = existing?.stl_name || null;
  const stl = req.files?.stl?.[0];
  if (stl) {
    if (stl_path) fs.unlink(path.join(FILE_DIR, path.basename(stl_path)), () => {});
    stl_path = stl.filename; stl_name = stl.originalname.replace(/[^\w.\- ]/g, '_');
  }
  const row = {
    title: String(b.title || 'Untitled').slice(0, 200), category: b.category,
    fitment: String(b.fitment || '').slice(0, 160), oem_part: String(b.oem_part || '').slice(0, 60), description: b.description || '',
    images: JSON.stringify(images), colors: b.colors || '', pricing_mode: b.pricing_mode === 'sqft' ? 'sqft' : 'fixed',
    physical_enabled: b.physical_enabled ? 1 : 0, physical_price: cents(b.physical_price), sqft_price: cents(b.sqft_price), min_price: cents(b.min_price),
    stock: b.stock === '' || b.stock == null ? null : Math.max(0, parseInt(b.stock, 10) || 0), lead_time: b.lead_time || '',
    digital_enabled: b.digital_enabled ? 1 : 0, digital_price: cents(b.digital_price), stl_path, stl_name,
    featured: b.featured ? 1 : 0, active: b.active ? 1 : 0, sort: parseInt(b.sort, 10) || 0,
  };
  let id;
  if (isNew) {
    let slug = slugify(row.title), i = 1;
    while (db.prepare('SELECT 1 FROM products WHERE slug = ?').get(slug)) slug = `${slugify(row.title)}-${++i}`;
    const cols = Object.keys(row);
    id = db.prepare(`INSERT INTO products (slug, ${cols.join(',')}) VALUES (@slug, ${cols.map(c => '@' + c).join(',')})`).run({ slug, ...row }).lastInsertRowid;
  } else {
    id = existing.id;
    db.prepare(`UPDATE products SET ${Object.keys(row).map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...row, id });
  }
  res.redirect(`/admin/products/${id}`);
});

router.post('/products/:id/delete', (req, res) => {
  const p = parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(parseInt(req.params.id, 10)));
  if (p) {
    const inUse = db.prepare('SELECT 1 FROM downloads WHERE product_id = ? AND expires_at > ?').get(p.id, new Date().toISOString());
    p.images.forEach(i => fs.unlink(path.join(UPLOAD_DIR, path.basename(i)), () => {}));
    if (p.stl_path && !inUse) fs.unlink(path.join(FILE_DIR, path.basename(p.stl_path)), () => {});
    db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
  }
  res.redirect('/admin/products');
});



// ---------- site photos ----------
const photos = require('./photos');
const photoUpload = multer({
  dest: require('os').tmpdir(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(f.originalname)),
}).single('photo');

router.get('/photos', (req, res) => {
  const done = photos.SLOTS.filter(s => photos.get(s.key)).length;
  res.send(page('Photos', `<h1 class="page">Site photos <small>${done} of ${photos.SLOTS.length} added</small></h1>
  ${req.query.e ? `<div class="notice err">${esc(req.query.e)}</div>` : ''}
  <p class="muted">Upload straight from your phone. Photos are resized for the web and their location data is removed. Until a slot has a photo, the site shows a labeled placeholder. iPhone photos that won't upload: Settings → Camera → Formats → Most Compatible.</p>
  <div class="photo-admin">${photos.SLOTS.map(s => {
    const cur = photos.get(s.key);
    return `<div class="pa-item">
      <div class="pa-thumb" style="aspect-ratio:${s.ratio}">${cur ? `<img src="${cur}-1200.webp" alt="">` : '<span>No photo yet</span>'}</div>
      <b>${esc(s.label)}</b><p class="small muted">${esc(s.hint)}</p>
      <form method="post" enctype="multipart/form-data" action="/admin/photos/${s.key}" class="pa-form">
        <input type="file" name="photo" accept="image/*" required><button class="btn sm">${cur ? 'Replace' : 'Upload'}</button></form>
      ${cur ? `<form method="post" action="/admin/photos/${s.key}/clear"><button class="linkbtn danger">Remove</button></form>` : ''}
    </div>`;
  }).join('')}</div>`));
});

router.post('/photos/:key', (req, res) => photoUpload(req, res, async err => {
  const key = req.params.key;
  if (!photos.byKey[key]) return res.sendStatus(404);
  if (err || !req.file) return res.redirect('/admin/photos?e=' + encodeURIComponent(err ? err.message : 'Pick a JPG, PNG, WEBP or HEIC photo.'));
  try { await photos.save(key, req.file.path); res.redirect('/admin/photos#' + key); }
  catch (e) { console.error(e); res.redirect('/admin/photos?e=' + encodeURIComponent('Could not read that image: ' + e.message)); }
}));

router.post('/photos/:key/clear', (req, res) => {
  if (photos.byKey[req.params.key]) photos.remove(req.params.key);
  res.redirect('/admin/photos');
});

// ---------- settings ----------
const SETTINGS = [
  ['store_name', 'Store name'], ['tagline', 'Tagline (home headline)'], ['announcement', 'Announcement bar (blank = hidden)'],
  ['intro', 'Homepage intro', 'textarea'], ['about', 'About text', 'textarea'], ['contact_email', 'Public contact email (footer)'], ['facebook_url', 'Facebook page link (footer)'], ['next_drop', 'Next drop teaser on the home page (e.g. "Friday: something for the rear hatch"). Blank hides it.'], ['categories', 'Categories — one per line: key|Label', 'textarea'],
  ['shipping_flat', 'Flat shipping (cents)', 'number'], ['free_shipping_over', 'Free shipping over (cents, 0 = never)', 'number'],
  ['download_days', 'Download link lifetime (days)', 'number'], ['download_max', 'Downloads allowed per purchase', 'number'],
  ['local_pickup', 'Pickup location'],
];
router.get('/settings', (req, res) => res.send(page('Settings', `<h1 class="page">Settings</h1>${req.query.ok ? '<div class="notice">Saved.</div>' : ''}
  <form class="form" method="post" action="/admin/settings">${SETTINGS.map(([k, l, t]) => t === 'textarea'
    ? `<label>${l}<textarea name="${k}" rows="4">${esc(getSetting(k))}</textarea></label>`
    : `<label>${l}<input name="${k}" type="${t || 'text'}" value="${esc(getSetting(k))}"></label>`).join('')}
  <button class="btn">Save settings</button></form>
  <h2>Setup status</h2><ul class="small">
   <li>Stripe: ${process.env.STRIPE_SECRET_KEY ? (process.env.STRIPE_SECRET_KEY.startsWith('sk_live') ? '✅ live' : '🧪 test mode') : '❌ STRIPE_SECRET_KEY missing'}</li>
   <li>Stripe webhook secret: ${process.env.STRIPE_WEBHOOK_SECRET ? '✅' : '❌ STRIPE_WEBHOOK_SECRET missing'}</li>
   <li>Email (Resend): ${process.env.RESEND_API_KEY ? '✅' : '⚠️ RESEND_API_KEY missing — emails only logged'}</li>
   <li>BASE_URL: ${esc(process.env.BASE_URL || '❌ not set')}</li>
   <li>Data dir: <code>${esc(require('./db').DATA_DIR)}</code></li></ul>`)));

router.post('/settings', (req, res) => {
  for (const [k] of SETTINGS) if (req.body[k] != null) setSetting(k, req.body[k]);
  res.redirect('/admin/settings?ok=1');
});

module.exports = router;
