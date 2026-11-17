const { getSetting, getCategories } = require('./db');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => '$' + (Number(c || 0) / 100).toFixed(2);
const nl2br = s => esc(s).replace(/\n/g, '<br>');

const REQUEST_TYPES = {
  part_request: 'A RAV4 part you can\'t find',
  custom_print: 'Custom version of a listed part',
  other: 'Something else',
};
const REQUEST_STATUS = {
  new: 'Received', reviewing: 'Reviewing', quoted: 'Quote ready', accepted: 'Accepted', paid: 'Paid, in queue',
  in_progress: 'In progress', done: 'Complete', declined: 'Declined',
};
const ORDER_STATUS = { pending: 'Awaiting payment', paid: 'Paid', printing: 'Printing', shipped: 'Shipped', complete: 'Complete', cancelled: 'Cancelled' };

// ---------- brand bits ----------
// Simple geometric mark: spare tire ring with a forward slash.
const mark = (size = 28) => `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
  <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="3.2"/>
  <circle cx="16" cy="16" r="5.5" fill="none" stroke="currentColor" stroke-width="2.2" opacity=".55"/>
  <path d="M21 4.5 L11 27.5" stroke="var(--amber)" stroke-width="3.2" stroke-linecap="round"/></svg>`;

const ICONS = {
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 18v-6M9 15l3 3 3-3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L2 10l8-8z" transform="scale(.9) translate(1 1)"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
  car: '<path d="M5 17h14M3 13l2-6h14l2 6v5h-3M3 13v5h3M3 13h18"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
};
const icon = (n, s = 22) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

const img = (name, alt, { sizes = '100vw', cls = '', eager = false, widths = [900, 1600] } = {}) =>
  `<img class="${cls}" src="/static/img/${name}-${widths[widths.length - 1]}.webp" srcset="${widths.map(w => `/static/img/${name}-${w}.webp ${w}w`).join(', ')}" sizes="${sizes}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;

const navLabel = l => l.replace(/\s*\(.*\)\s*/, '').trim();
const years = l => (l.match(/\((.*)\)/) || [])[1] || '';
const partNo = p => `RR-${String(p.id).padStart(4, '0')}`;

const stripe = (cls = '') => `<div class="stripe ${cls}" aria-hidden="true"><i></i><i></i><i></i></div>`;

function layout(title, body, { admin = false, bare = false, home = false } = {}) {
  const name = getSetting('store_name');
  const ann = getSetting('announcement');
  const cats = getCategories();
  const contact = getSetting('contact_email');
  const fb = getSetting('facebook_url');
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title ? `${title} | ${name}` : `${name}: ${getSetting('tagline')}`)}</title>
<meta name="description" content="${esc(getSetting('intro'))}">
<meta name="theme-color" content="#151515">
<meta property="og:title" content="${esc(title || name)}"><meta property="og:description" content="${esc(getSetting('intro'))}">
<meta property="og:image" content="${base}/static/brand/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,400..900;1,62..125,400..900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/style.css">
${admin ? '' : '<script src="/static/cart.js"></script>'}
</head><body class="${admin ? 'admin' : ''}">
<a class="skip" href="#main">Skip to content</a>
${ann && !admin ? `<div class="announce">${esc(ann)}</div>` : ''}
<header class="top"><div class="wrap nav">
  <a class="logo" href="${admin ? '/admin' : '/'}" aria-label="${esc(name)}, home"><img src="/static/brand/rr-logo-reverse.svg" alt="${esc(name)}" width="200" height="34">${admin ? '<span class="admin-tag">Admin</span>' : ''}</a>
  <nav aria-label="Main">${admin ? `
    <a href="/admin/products">Products</a><a href="/admin/orders">Orders</a><a href="/admin/requests">Requests</a><a href="/admin/photos">Photos</a><a href="/admin/settings">Settings</a><a href="/" target="_blank">View site</a>
  ` : `
    <a href="/shop">Shop</a><a class="hide-sm" href="/request">Request a part</a><a class="hide-sm" href="/#about">About</a>
    <a href="/cart" class="cart-link">Cart <span id="cart-count">0</span></a>`}
  </nav>
</div>${admin || home ? '' : stripe('thin')}</header>
<main id="main"${bare ? '' : ' class="wrap page"'}>${body}</main>
${admin ? '' : `<footer class="foot">${stripe()}<div class="foot-word" aria-hidden="true">RAV4 RETRO</div><div class="wrap foot-grid">
  <div class="foot-brand"><img src="/static/brand/rr-logo-reverse.svg" alt="${esc(name)}" width="240" height="41">
    <p>${esc(getSetting('tagline'))} Printed in Ohio.</p>
    ${contact ? `<p><a href="mailto:${esc(contact)}">${esc(contact)}</a></p>` : ''}${fb ? `<p><a href="${esc(fb)}" rel="noopener">Facebook</a></p>` : ''}</div>
  <div><h2>Shop</h2>${cats.map(c => `<a href="/shop?c=${esc(c.key)}">${esc(navLabel(c.label))}</a>`).join('')}<a href="/shop?type=stl">Printable files</a></div>
  <div><h2>Help</h2><a href="/request">Request a part</a><a href="/#about">About</a><a href="/cart">Cart</a></div>
</div><div class="wrap legal"><span>© ${new Date().getFullYear()} ${esc(name)}</span><span>Not affiliated with Toyota. RAV4 is a trademark of Toyota Motor Corporation and is used here only to describe fitment. All parts are aftermarket.</span></div></footer>`}
</body></html>`;
}

function cardPrice(p) {
  if (p.physical_enabled) return money(p.physical_price);
  return money(p.digital_price);
}
function productCard(p) {
  const cat = getCategories().find(c => c.key === p.category);
  const extra = p.physical_enabled && p.digital_enabled ? `or file ${money(p.digital_price)}` : (!p.physical_enabled ? 'Printable file' : '');
  return `<a class="card" href="/p/${esc(p.slug)}">
    <div class="card-tag"><span>${partNo(p)}</span><span>${esc(cat ? navLabel(cat.label) : '')}</span></div>
    <div class="thumb">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="" loading="lazy">` : '<div class="noimg">Photo coming</div>'}</div>
    <div class="card-body">
      <h3>${esc(p.title)}</h3>
      <p class="card-sub">${esc(p.fitment || "'96–'00 RAV4")}</p>
      <p class="card-price"><b>${cardPrice(p)}</b>${extra ? `<span>${extra}</span>` : ''}</p>
    </div>
  </a>`;
}

const photos = require('./photos');
const BUNDLED = new Set((() => { try { return require('fs').readdirSync(require('path').join(__dirname, '..', 'public', 'img')).filter(f => f.endsWith('-1200.webp')).map(f => f.replace('-1200.webp', '')); } catch { return []; } })());

// A site photo, or a quiet placeholder naming the shot until it's uploaded in Admin > Photos.
function photo(key, alt, { cls = '', sizes = '100vw', eager = false } = {}) {
  // an uploaded photo wins; otherwise use the one shipped with the site in public/img
  const base = photos.get(key) || (BUNDLED.has(key) ? `/static/img/${key}` : '');
  const slot = photos.byKey[key] || { label: key };
  if (base) return `<img class="${cls}" src="${base}-2400.webp" srcset="${base}-1200.webp 1200w, ${base}-2400.webp 2400w" sizes="${sizes}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
  return `<div class="ph ${cls}" role="img" aria-label="${esc(alt)}"><span>Photo to add: ${esc(slot.label)}</span></div>`;
}

function home(products) {
  const cats = getCategories();
  const featured = products.filter(p => p.featured);
  const drop = [...products].sort((x, y) => y.id - x.id)[0];
  const rest = (featured.length ? featured : products).filter(p => !drop || p.id !== drop.id).slice(0, 6);
  const next = getSetting('next_drop');
  const count = k => products.filter(p => p.category === k).length;
  return layout('', `
  <section class="hero">
    <div class="hero-bg" aria-hidden="true"><span>RAV4</span></div>
    <div class="hero-band" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="wrap hero-grid">
      <div class="hero-copy">
        <p class="hero-years"><b>'96</b><span></span><b>'00</b></p>
        <h1>${esc(getSetting('tagline'))}</h1>
        <p class="hero-lede">${nl2br(getSetting('intro'))}</p>
        <p class="hero-cta"><a class="btn" href="/shop">Shop parts</a><a class="btn ghost" href="/request">Request a part</a></p>
      </div>
      <div class="hero-shot">${photo('hero', 'A first-gen RAV4 on a gravel trail', { eager: true, sizes: '(max-width:900px) 100vw, 55vw' })}</div>
    </div>
  </section>

  ${drop ? `<section class="drop">
    <div class="wrap drop-grid">
      <a class="drop-img" href="/p/${esc(drop.slug)}">${drop.images[0] ? `<img src="${esc(drop.images[0])}" alt="${esc(drop.title)}">` : '<div class="noimg">Photo coming</div>'}</a>
      <div class="drop-copy">
        <p class="kicker">Latest drop</p>
        <h2><a href="/p/${esc(drop.slug)}">${esc(drop.title)}</a></h2>
        <dl class="drop-spec">
          <div><dt>Part</dt><dd>${partNo(drop)}</dd></div>
          <div><dt>Fits</dt><dd>${esc(drop.fitment || "'96–'00 RAV4")}</dd></div>
          ${drop.oem_part ? `<div><dt>Replaces</dt><dd>${esc(drop.oem_part)}</dd></div>` : ''}
        </dl>
        <p class="drop-price">${cardPrice(drop)}</p>
        <p><a class="btn" href="/p/${esc(drop.slug)}">See the part</a></p>
        ${next ? `<div class="next"><span>Next drop</span><b>${esc(next)}</b></div>` : ''}
      </div>
    </div>
  </section>` : ''}

  <section class="wrap sec" id="shop">
    <div class="sec-row"><h2>${rest.length ? 'In the shop' : 'The shop'}</h2><a class="text-link" href="/shop">See everything</a></div>
    ${rest.length ? `<div class="grid">${rest.map(productCard).join('')}</div>`
      : drop ? '' : `<div class="empty"><p>First parts drop soon. Tell us what you need in the meantime.</p><a class="btn" href="/request">Request a part</a></div>`}
    <div class="cats">${cats.map(c => `<a href="/shop?c=${esc(c.key)}"><b>${esc(navLabel(c.label))}</b><span>${count(c.key) ? `${count(c.key)} part${count(c.key) > 1 ? 's' : ''}` : 'Coming soon'}</span></a>`).join('')}</div>
  </section>

  <section class="wrap sec how">
    <p class="kicker">How a part gets made</p>
    <h2>From a broken original to a part that fits.</h2>
    <ol class="steps">
      <li><figure>${photo('step_scan', 'An original part on the scanner with marker stands', { sizes: '(max-width:900px) 50vw, 25vw' })}</figure><h3><span>01</span>Scan</h3><p>The original part goes on the scanner. A slow lap around it captures every lip, rib and tab.</p></li>
      <li><figure>${photo('step_model', 'A scanned trim piece in Fusion', { sizes: '(max-width:900px) 50vw, 25vw' })}</figure><h3><span>02</span>Model</h3><p>The scan gets rebuilt as a real CAD model, true to size, with the worn and broken spots fixed.</p></li>
      <li><figure>${photo('step_print', 'A printed gauge pod on the printer bed', { sizes: '(max-width:900px) 50vw, 25vw' })}</figure><h3><span>03</span>Print</h3><p>Printed in ASA or PETG so it holds up to sun, heat and the trail.</p></li>
      <li><figure>${photo('step_fit', 'The printed gauge pod fitted in a first-gen RAV4 dash', { sizes: '(max-width:900px) 50vw, 25vw' })}</figure><h3><span>04</span>Fit</h3><p>It goes on my own RAV4 first. If it doesn't fit right, it doesn't go in the shop.</p></li>
    </ol>
  </section>

  <section class="ask">
    <div class="wrap ask-grid">
      <div>
        <h2>Toyota stopped making it.<br>We didn't.</h2>
        <p>Cracked trim, missing clips, broken brackets. Send a photo of what's busted and your year. If we can make it, you get a price, and the part usually lands in the shop for everyone else.</p>
        <p><a class="btn" href="/request">Request a part</a></p>
      </div>
      <figure class="ask-img">${photo('before_after', 'A first-gen RAV4 being parted out in the garage', { sizes: '(max-width:900px) 100vw, 45vw' })}<figcaption><span>Parting one out in the garage</span></figcaption></figure>
    </div>
  </section>

  <section class="wrap sec about" id="about">
    <div class="about-img">${photo('garage', 'The garage with the vehicles and printers', { sizes: '(max-width:900px) 100vw, 50vw' })}</div>
    <div class="about-text">
      <p class="kicker">Who's behind this</p>
      <h2>Ten years in a first-gen RAV4.</h2>
      <p>${nl2br(getSetting('about'))}</p>
      <dl class="facts">
        <div><dt>Fits</dt><dd>1996–2000 RAV4, 2- and 4-door, unless a listing says otherwise</dd></div>
        <div><dt>Material</dt><dd>ASA and PETG. They take UV, heat and fuel</dd></div>
        <div><dt>Ships</dt><dd>Made to order in Ohio. Usually out in 3–5 days</dd></div>
        <div><dt>Fit</dt><dd>Doesn't fit your vehicle? Send it back for a refund or a reprint</dd></div>
      </dl>
    </div>
  </section>

  <section class="reel" aria-label="On the trail">${photo('trail', 'A first-gen RAV4 with a roof box on a leaf-covered trail', { sizes: '100vw' })}</section>`, { bare: true, home: true });
}

function shop(products, { c, type, q }) {
  const cats = getCategories();
  const cur = cats.find(x => x.key === c);
  const tab = (href, label, on) => `<a class="${on ? 'on' : ''}" href="${href}">${esc(label)}</a>`;
  return layout(cur ? cur.label : 'Shop', `
  <div class="page-head"><h1>${esc(cur ? navLabel(cur.label) : type === 'stl' ? 'Printable files' : q ? `Results for "${q}"` : 'Shop')}</h1></div>
  <div class="filters"><div class="chips">${tab('/shop', 'All', !c && !type)}${cats.map(x => tab(`/shop?c=${x.key}`, navLabel(x.label), c === x.key)).join('')}${tab('/shop?type=stl', 'Printable files', type === 'stl')}</div>
  <form action="/shop" class="search"><input name="q" value="${esc(q || '')}" placeholder="Search parts or OEM #" aria-label="Search parts"></form></div>
  <p class="count muted small">${products.length} item${products.length === 1 ? '' : 's'}</p>
  ${products.length ? `<div class="grid">${products.map(productCard).join('')}</div>` : `<div class="empty"><p>Nothing here yet.</p><a class="btn" href="/request?type=part_request">Request a part</a></div>`}`);
}

function product(p) {
  const cats = getCategories();
  const cat = cats.find(c => c.key === p.category);
  const both = p.physical_enabled && p.digital_enabled;
  const outOfStock = p.stock != null && p.stock <= 0;
  return layout(p.title, `
  <p class="crumbs"><a href="/shop">Shop</a>${cat ? ` / <a href="/shop?c=${esc(cat.key)}">${esc(navLabel(cat.label))}</a>` : ''}</p>
  <div class="pdp">
    <div class="gallery">${p.images.length ? `<img id="main-img" src="${esc(p.images[0])}" alt="${esc(p.title)}">
      ${p.images.length > 1 ? `<div class="thumbs">${p.images.map(i => `<img src="${esc(i)}" alt="" onclick="document.getElementById('main-img').src=this.src">`).join('')}</div>` : ''}` : '<div class="noimg big">Photo coming</div>'}</div>
    <div class="buy" id="buybox" data-id="${p.id}" data-mode="${esc(p.pricing_mode)}" data-phys="${p.physical_price}" data-sqft="${p.sqft_price}" data-min="${p.min_price}" data-dig="${p.digital_price}">
      <h1>${esc(p.title)}</h1>
      <div class="specs">
        <div><span>Part no.</span><b>${partNo(p)}</b></div>
        ${p.oem_part ? `<div><span>OEM ref</span><b>${esc(p.oem_part)}</b></div>` : ''}
        ${p.fitment ? `<div class="wide"><span>Fits</span><b>${esc(p.fitment)}</b></div>` : ''}
      </div>
      <div class="price big" id="price"></div>
      ${both ? `<div class="variant">
        <label><input type="radio" name="variant" value="physical" checked ${outOfStock ? 'disabled' : ''}> Printed part</label>
        <label><input type="radio" name="variant" value="digital" ${outOfStock ? 'checked' : ''}> STL file</label></div>`
      : `<input type="hidden" name="variant" value="${p.physical_enabled ? 'physical' : 'digital'}">`}
      <div class="phys-opts" ${!p.physical_enabled ? 'hidden' : ''}>
        ${p.pricing_mode === 'sqft' ? `<div class="dims"><label>Drawer width (in)<input type="number" id="w" min="1" max="72" step="0.25" placeholder="16"></label>
          <label>Drawer depth (in)<input type="number" id="d" min="1" max="72" step="0.25" placeholder="20"></label></div>
          <p class="small muted">Measure the inside of the drawer. ${money(p.sqft_price)}/sq ft${p.min_price ? `, ${money(p.min_price)} minimum` : ''}.</p>` : ''}
        <div class="row-opts">
        ${p.colors.length ? `<label>Color<select id="color">${p.colors.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>` : ''}
        ${p.pricing_mode !== 'sqft' ? `<label class="qty-l">Qty<input type="number" id="qty" value="1" min="1" max="${p.stock != null ? Math.max(p.stock, 1) : 50}"></label>` : ''}
        </div>
        <label>Notes <span class="muted">(optional)</span><input id="notes" maxlength="200" placeholder="Special instructions"></label>
        <p class="small muted">${outOfStock ? '<b>Out of stock.</b> The file is still available.' : p.stock != null ? `${p.stock} in stock` : 'Printed to order'}${p.lead_time ? ` · ships in ${esc(p.lead_time)}` : ''}</p>
      </div>
      <div class="dig-opts" ${p.physical_enabled ? 'hidden' : ''}><p class="small muted">Instant download after checkout${p.stl_name ? ` · <code>${esc(p.stl_name)}</code>` : ''}. Personal use only.</p></div>
      <button class="btn full" id="add">Add to cart</button>
      <p id="added" class="ok" hidden>Added. <a href="/cart">Go to cart</a></p>
      <div class="desc">${nl2br(p.description)}</div>
      ${p.fitment ? `<p class="small muted">Not sure it fits? <a href="/request?type=part_request&title=${encodeURIComponent('Fitment question: ' + p.title)}">Ask before you buy</a>.</p>` : ''}
    </div>
  </div>
  <script>window.PRODUCT=${JSON.stringify({ id: p.id, physical: !!p.physical_enabled, digital: !!p.digital_enabled, out: outOfStock }).replace(/</g, '\\u003c')}</script>
  <script src="/static/product.js"></script>`);
}

function cart() {
  return layout('Cart', `<div class="page-head"><h1>Cart</h1></div>
  <div id="cart-root"><p class="muted">Loading…</p></div>
  <script src="/static/cart-page.js"></script>`);
}

function orderPage(o, downloads, flash) {
  const lines = JSON.parse(o.items);
  const addr = o.shipping_address ? JSON.parse(o.shipping_address) : null;
  return layout(`Order ${o.number}`, `
  ${flash ? `<div class="notice">${flash}</div>` : ''}
  <h1 class="page">Order ${esc(o.number)}</h1>
  <p class="status s-${esc(o.status)}">${esc(ORDER_STATUS[o.status] || o.status)}</p>
  ${o.tracking ? `<p>Tracking (${esc(o.carrier || 'carrier')}): <b>${esc(o.tracking)}</b></p>` : ''}
  ${downloads.length ? `<div class="downloads"><h2>Your files</h2>${downloads.map(d => `<a class="btn" href="/download/${d.token}">⬇ ${esc(d.file_name)}</a> <span class="small muted">${d.max_count - d.count} downloads left · expires ${new Date(d.expires_at).toLocaleDateString()}</span><br>`).join('')}</div>` : ''}
  <table class="tbl">${lines.map(l => `<tr><td>${esc(l.title)}${l.variant === 'digital' ? ' <span class="pill">STL</span>' : ''}<br><span class="small muted">${esc(l.desc || '')}</span></td><td>× ${l.qty}</td><td class="r">${money(l.unit * l.qty)}</td></tr>`).join('')}
  <tr><td colspan="2">Shipping</td><td class="r">${money(o.shipping)}</td></tr><tr class="tot"><td colspan="2">Total</td><td class="r">${money(o.total)}</td></tr></table>
  ${addr?.address ? `<p class="small">Shipping to: ${esc(addr.name)}, ${esc(addr.address.line1)} ${esc(addr.address.line2 || '')}, ${esc(addr.address.city)}, ${esc(addr.address.state)} ${esc(addr.address.postal_code)}</p>` : ''}
  <p class="small muted">Bookmark this page. It's your order receipt${o.email ? ` (also emailed to ${esc(o.email)})` : ''}.</p>`);
}

function requestForm(prefill = {}, error = '') {
  const t = prefill.type || 'part_request';
  return layout('Request a part', `
  <h1 class="page">Request a part</h1>
  <p class="lede">Tell us what's broken or missing. Photos of the part (or the empty spot where it goes) help most. If we can make it, you'll get a price by email. Nothing is charged until you approve it.</p>
  ${error ? `<div class="notice err">${esc(error)}</div>` : ''}
  <form class="form" method="post" action="/request" enctype="multipart/form-data">
    <label>What kind of job?<select name="type" id="rtype">${Object.entries(REQUEST_TYPES).map(([k, v]) => `<option value="${k}" ${k === t ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <label>Short title<input name="title" required maxlength="120" value="${esc(prefill.title)}" placeholder="e.g. Rear cargo cover clip"></label>
    <label>Details<textarea name="details" required rows="6" maxlength="5000" placeholder="Where it goes on the vehicle, what broke, OEM part # if you know it…">${esc(prefill.details)}</textarea></label>
    <div class="row3">
      <label>Your RAV4<input name="vehicle" maxlength="120" value="${esc(prefill.vehicle)}" placeholder="e.g. 1998 4-door, manual"></label>
      <label>Dimensions<input name="dimensions" maxlength="200" value="${esc(prefill.dimensions)}" placeholder="L × W × H, or rough size"></label>
      <label>Quantity<input name="quantity" type="number" min="1" max="10000" value="${esc(prefill.quantity || 1)}"></label>
    </div>
    <div class="row3">
      <label>Material<select name="material">${['No preference', 'PLA', 'PETG', 'ABS/ASA (heat/UV)', 'TPU (flexible)', 'Nylon / CF', 'Not sure, recommend one'].map(m => `<option ${prefill.material === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label>Color<input name="color" maxlength="60" value="${esc(prefill.color)}" placeholder="Black, match original…"></label>
      <label>Need it by<input name="deadline" type="date" value="${esc(prefill.deadline)}"></label>
    </div>
    <div class="row3">
      <label>Budget (optional)<input name="budget" maxlength="60" value="${esc(prefill.budget)}" placeholder="$"></label>
      <label>Delivery<select name="delivery"><option value="ship">Ship it</option><option value="pickup" ${prefill.delivery === 'pickup' ? 'selected' : ''}>Local pickup (${esc(getSetting('local_pickup'))})</option></select></label>
      <span></span>
    </div>
    <label>Photos or files (up to 10)<input type="file" name="files" multiple accept="image/*,.stl,.step,.stp,.3mf,.obj,.f3d,.pdf,.zip"></label>
    <div class="row3">
      <label>Name<input name="name" required maxlength="100" value="${esc(prefill.name)}"></label>
      <label>Email<input name="email" type="email" required maxlength="200" value="${esc(prefill.email)}"></label>
      <label>Phone (optional)<input name="phone" maxlength="40" value="${esc(prefill.phone)}"></label>
    </div>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off">
    <button class="btn">Send request</button>
  </form>`);
}

function requestStatus(r, flash) {
  const files = JSON.parse(r.files || '[]');
  const total = (r.quote_price || 0) + (r.quote_shipping || 0);
  return layout(`Request ${r.number}`, `
  ${flash ? `<div class="notice">${flash}</div>` : ''}
  <h1 class="page">${esc(r.title || 'Request')} <small class="muted">${esc(r.number)}</small></h1>
  <p class="status s-${esc(r.status)}">${esc(REQUEST_STATUS[r.status] || r.status)}</p>
  ${['quoted', 'accepted'].includes(r.status) ? `<div class="quote">
     <h2>Your quote: ${money(total)}</h2>
     ${r.quote_shipping ? `<p class="small">${money(r.quote_price)} + ${money(r.quote_shipping)} shipping</p>` : ''}
     ${r.quote_lead ? `<p>Lead time: <b>${esc(r.quote_lead)}</b></p>` : ''}
     ${r.quote_message ? `<p>${nl2br(r.quote_message)}</p>` : ''}
     <form method="post" action="/request/${r.id}/pay?k=${esc(r.access_key)}"><button class="btn">Approve &amp; pay ${money(total)}</button></form>
     <form method="post" action="/request/${r.id}/decline?k=${esc(r.access_key)}" onsubmit="return confirm('Decline this quote?')"><button class="linkbtn">No thanks, decline</button></form>
   </div>` : ''}
  ${['new', 'reviewing'].includes(r.status) ? '<p>Your request is being reviewed. You\'ll receive an email when the quote is ready.</p>' : ''}
  <dl class="kv">
    <dt>Type</dt><dd>${esc(REQUEST_TYPES[r.type] || r.type)}</dd>
    ${r.vehicle ? `<dt>Vehicle</dt><dd>${esc(r.vehicle)}</dd>` : ''}${r.dimensions ? `<dt>Dimensions</dt><dd>${esc(r.dimensions)}</dd>` : ''}
    <dt>Qty</dt><dd>${r.quantity}</dd><dt>Material</dt><dd>${esc(r.material || "—")}</dd>${r.color ? `<dt>Color</dt><dd>${esc(r.color)}</dd>` : ''}
    <dt>Details</dt><dd>${nl2br(r.details)}</dd>
    ${files.length ? `<dt>Files</dt><dd>${files.map(f => esc(f.name)).join(', ')}</dd>` : ''}
  </dl>
  <p class="small muted">Bookmark this page to check on your request.</p>`);
}

function message(title, html) {
  return layout(title, `<h1 class="page">${esc(title)}</h1><div class="lede">${html}</div>`);
}


// ---------- Gridfinity: single bins + custom drawers ----------
const SWATCH = { red: '#B8322A', blue: '#2F5DA8', gray: '#8C918D', grey: '#8C918D', white: '#F7F7F4', black: '#202322', orange: '#E8742A', green: '#2E4A3B', yellow: '#E6B422', tan: '#CDBA8E' };
const swatch = c => SWATCH[String(c).toLowerCase()] || '#8C918D';

module.exports = { esc, money, nl2br, layout, home, shop, product, cart, orderPage, requestForm, requestStatus, message, REQUEST_TYPES, REQUEST_STATUS, ORDER_STATUS };
