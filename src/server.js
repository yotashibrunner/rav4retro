const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, UPLOAD_DIR, FILE_DIR, REQUEST_DIR, parseProduct, token, shortCode } = require('./db');
const views = require('./views');
const commerce = require('./commerce');
const email = require('./email');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Stripe webhook needs the raw body — register before json parser.
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!commerce.stripe) return res.sendStatus(400);
  let event;
  try {
    event = commerce.stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('webhook signature failed', e.message);
    return res.status(400).send('bad signature');
  }
  try {
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
      const s = event.data.object;
      const id = parseInt(s.metadata?.order_id || s.client_reference_id, 10);
      if (id) await commerce.fulfill(id, s);
    }
    res.json({ received: true });
  } catch (e) {
    console.error('webhook handler error', e);
    res.sendStatus(500);
  }
});

// Printify shipment updates (merch). Key in the URL; the order is re-read from Printify, not taken from the body.
const printify = require('./printify');
app.post('/webhook/printify', express.json({ limit: '200kb' }), (req, res) => {
  if (!printify.enabled() || req.query.k !== printify.hookKey()) return res.sendStatus(404);
  res.json({ received: true });
  printify.handleWebhook(req.body).catch(e => console.error('Printify webhook', e.message));
});
printify.startAutoSync();

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// ---------- storefront ----------
const activeProducts = (where = '', params = [], limit = 500) =>
  db.prepare(`SELECT * FROM products WHERE active = 1 ${where} ORDER BY sort ASC, id DESC LIMIT ${limit | 0}`).all(...params).map(parseProduct);

app.get('/', (req, res) => {
  // featured first, then newest
  const all = activeProducts('', [], 200).sort((a, b) => b.featured - a.featured);
  res.send(views.home(all));
});

app.get('/shop', (req, res) => {
  const { c, type, q } = req.query;
  let where = '', params = [];
  if (c) { where += ' AND category = ?'; params.push(String(c)); }
  if (type === 'stl') where += ' AND digital_enabled = 1 AND stl_path IS NOT NULL';
  if (q) { where += ' AND (title LIKE ? OR description LIKE ? OR fitment LIKE ? OR oem_part LIKE ?)'; params.push(...Array(4).fill(`%${q}%`)); }
  res.send(views.shop(activeProducts(where, params), { c, type, q }));
});

app.get('/p/:slug', (req, res) => {
  const p = parseProduct(db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1').get(req.params.slug));
  if (!p) return res.status(404).send(views.message('Not found', '<p>That item isn\'t available. <a href="/shop">Back to shop</a></p>'));
  res.send(views.product(p));
});


app.get('/cart', (req, res) => res.send(views.cart()));
app.get(['/terms', '/license', '/returns', '/privacy'], (req, res) => {
  const p = require('./legal').page(req.path.slice(1));
  res.send(views.layout(p.title, p.html));
});

app.post('/api/cart/quote', (req, res) => {
  const q = commerce.quoteCart(req.body.items, { country: req.body.country });
  res.json(q);
});

app.post('/api/checkout', async (req, res) => {
  try {
    const q = commerce.quoteCart(req.body.items, { country: req.body.country });
    if (q.errors.length) return res.status(400).json({ error: q.errors.join('; ') });
    if (!q.lines.length) return res.status(400).json({ error: 'Cart is empty' });
    if (!commerce.stripe) return res.status(503).json({ error: 'Checkout is not set up yet.' });
    const order = commerce.createOrder(q);
    const url = await commerce.stripeCheckout(order);
    res.json({ url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/order/:number', async (req, res) => {
  let o = db.prepare('SELECT * FROM orders WHERE number = ?').get(req.params.number);
  if (!o || o.access_key !== req.query.k) return res.status(404).send(views.message('Not found', '<p>Order not found.</p>'));
  let flash = '';
  if (req.query.session_id && o.status === 'pending' && commerce.stripe && req.query.session_id === o.stripe_session) {
    try { o = await commerce.fulfill(o.id, await commerce.stripe.checkout.sessions.retrieve(o.stripe_session)); } catch (e) { console.error(e); }
  }
  if (req.query.session_id && o.status !== 'pending') flash = 'Payment received — thank you! <script>try{localStorage.removeItem("rr_cart")}catch(e){}</script>';
  const downloads = db.prepare('SELECT * FROM downloads WHERE order_id = ?').all(o.id);
  res.send(views.orderPage(o, downloads, flash));
});

app.get('/download/:token', (req, res) => {
  const d = db.prepare('SELECT d.*, o.status FROM downloads d JOIN orders o ON o.id = d.order_id WHERE token = ?').get(req.params.token);
  if (!d || d.status === 'cancelled') return res.status(404).send(views.message('Link not valid', '<p>This download link is invalid.</p>'));
  if (new Date(d.expires_at) < new Date()) return res.status(410).send(views.message('Link expired', '<p>This link has expired. Reply to your order email and we\'ll send a new one.</p>'));
  if (d.count >= d.max_count) return res.status(410).send(views.message('Download limit reached', '<p>Download limit reached. Reply to your order email if you need another.</p>'));
  const full = path.join(FILE_DIR, path.basename(d.file_path));
  if (!fs.existsSync(full)) return res.status(404).send(views.message('File missing', '<p>File not found — please reply to your order email and we\'ll resolve it.</p>'));
  db.prepare('UPDATE downloads SET count = count + 1 WHERE token = ?').run(d.token);
  res.download(full, d.file_name);
});

// ---------- custom requests ----------
const reqUpload = multer({
  storage: multer.diskStorage({
    destination: REQUEST_DIR,
    filename: (req, f, cb) => cb(null, `${Date.now()}-${token(6)}${path.extname(f.originalname).toLowerCase().slice(0, 10)}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 10 },
  fileFilter: (req, f, cb) => cb(null, /\.(jpe?g|png|gif|webp|heic|stl|step|stp|3mf|obj|f3d|pdf|zip)$/i.test(f.originalname)),
});

// simple in-memory rate limit for the request form
const hits = new Map();
const limited = ip => {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 8;
};

app.get('/request', (req, res) => res.send(views.requestForm({ type: req.query.type, title: req.query.title })));

app.post('/request', (req, res, next) => reqUpload.array('files', 10)(req, res, err => {
  if (err) return res.status(400).send(views.requestForm(req.body || {}, err.code === 'LIMIT_FILE_SIZE' ? 'A file is over 100 MB.' : err.message));
  next();
}), async (req, res) => {
  const b = req.body;
  const cleanup = () => (req.files || []).forEach(f => fs.unlink(f.path, () => {}));
  if (b.website) { cleanup(); return res.redirect('/'); } // honeypot
  if (limited(req.ip)) { cleanup(); return res.status(429).send(views.requestForm(b, 'Too many requests — try again later.')); }
  if (!b.name || !b.email || !b.title || !b.details || !/^\S+@\S+\.\S+$/.test(b.email)) {
    cleanup(); return res.status(400).send(views.requestForm(b, 'Name, valid email, title, and details are required.'));
  }
  const type = views.REQUEST_TYPES[b.type] ? b.type : 'custom_print';
  const files = (req.files || []).map(f => ({ name: f.originalname.slice(0, 150), stored: f.filename, size: f.size, mime: f.mimetype }));
  const s = (v, n) => String(v || '').slice(0, n);
  const info = db.prepare(`INSERT INTO requests (number, access_key, type, name, email, phone, title, details, vehicle, dimensions, material, color, quantity, deadline, budget, delivery, files)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(shortCode('REQ'), token(18), type, s(b.name, 100), s(b.email, 200), s(b.phone, 40), s(b.title, 120), s(b.details, 5000),
    s(b.vehicle, 120), s(b.dimensions, 200), s(b.material, 60), s(b.color, 60), Math.max(1, Math.min(10000, parseInt(b.quantity, 10) || 1)), s(b.deadline, 20), s(b.budget, 60),
    b.delivery === 'pickup' ? 'pickup' : 'ship', JSON.stringify(files));
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(info.lastInsertRowid);
  email.requestReceived(r).catch(e => console.error('email error', e.message));
  res.redirect(`/request/${r.id}?k=${r.access_key}&new=1`);
});

const loadRequest = (req, res) => {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!r || r.access_key !== req.query.k) { res.status(404).send(views.message('Not found', '<p>Request not found.</p>')); return null; }
  return r;
};

app.get('/request/:id', (req, res) => {
  const r = loadRequest(req, res); if (!r) return;
  res.send(views.requestStatus(r, req.query.new ? `Request received — you'll get a confirmation email at ${views.esc(r.email)}.` : ''));
});

app.post('/request/:id/pay', async (req, res) => {
  const r = loadRequest(req, res); if (!r) return;
  if (!['quoted', 'accepted'].includes(r.status) || !r.quote_price) return res.redirect(`/request/${r.id}?k=${r.access_key}`);
  if (!commerce.stripe) return res.status(503).send(views.message('Checkout not set up', '<p>Online payment isn\'t configured yet — reply to your quote email and we\'ll send a payment link.</p>'));
  try {
    // collect a shipping address unless it's pickup or a files-only job with no shipping charge
    const physical = r.delivery !== 'pickup' && (!['design', 'scan'].includes(r.type) || r.quote_shipping > 0);
    const line = { product_id: null, title: `Custom job: ${r.title || r.number}`, variant: 'physical', qty: 1, unit: r.quote_price, desc: `${r.number}${r.quote_lead ? ' · lead time ' + r.quote_lead : ''}` };
    const order = commerce.createOrder({ lines: [line], subtotal: r.quote_price, shipping: r.quote_shipping || 0, total: r.quote_price + (r.quote_shipping || 0), hasPhysical: physical, requestId: r.id, emailAddr: r.email, name: r.name });
    db.prepare("UPDATE requests SET status = 'accepted' WHERE id = ?").run(r.id);
    res.redirect(303, await commerce.stripeCheckout(order));
  } catch (e) {
    console.error(e);
    res.status(500).send(views.message('Checkout error', `<p>${views.esc(e.message)}</p>`));
  }
});

app.post('/request/:id/decline', (req, res) => {
  const r = loadRequest(req, res); if (!r) return;
  db.prepare("UPDATE requests SET status = 'declined' WHERE id = ? AND status IN ('quoted','accepted')").run(r.id);
  email.send(process.env.ADMIN_EMAIL, `Quote declined: ${r.number}`, `<p>${views.esc(r.name)} declined the quote for ${views.esc(r.title)}.</p>`).catch(() => {});
  res.redirect(`/request/${r.id}?k=${r.access_key}`);
});

// ---------- admin ----------
app.use('/admin', require('./admin'));

app.get('/healthz', (req, res) => res.send('ok'));
app.use((req, res) => res.status(404).send(views.message('Not found', '<p><a href="/">Back home</a></p>')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`rav4retro listening on :${PORT}`));
