// Email via Resend (https://resend.com). If RESEND_API_KEY isn't set, emails are logged instead.
const { db, getSetting } = require('./db');

const money = c => '$' + (Number(c || 0) / 100).toFixed(2);
// accepts "orders@x.net", "Name <orders@x.net>", with or without stray quotes
function fromAddress() {
  const raw = String(process.env.EMAIL_FROM || '').trim().replace(/^["']|["']$/g, '').trim();
  const m = raw.match(/[^\s<>"']+@[^\s<>"']+\.[a-z]{2,}/i);
  if (!m) return 'RAV4 Retro <orders@rav4retro.net>';
  const name = raw.slice(0, raw.indexOf(m[0])).replace(/[<"']/g, '').trim();
  return `${name || 'RAV4 Retro'} <${m[0]}>`;
}
const base = () => (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function send(to, subject, html) {
  if (!to) return;
  if (!process.env.RESEND_API_KEY) { console.log(`[email skipped — no RESEND_API_KEY] to=${to} subject="${subject}"`); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddress(), to, subject, html, reply_to: process.env.ADMIN_EMAIL || undefined }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

function wrap(body) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1d1a16">
  <div style="height:4px;background:#24453a"></div>
  <h2 style="margin:18px 0 6px">${esc(getSetting('store_name'))}</h2>${body}
  <p style="color:#777;font-size:12px;margin-top:30px">Questions? Just reply to this email.</p></div>`;
}

function itemsTable(order) {
  const lines = JSON.parse(order.items);
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${lines.map(l => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(l.title)}${l.variant === 'digital' ? ' (STL)' : ''} × ${l.qty}<br><small style="color:#777">${esc(l.desc || '')}</small></td><td style="text-align:right;border-bottom:1px solid #eee">${money(l.unit * l.qty)}</td></tr>`).join('')}
  <tr><td style="padding:6px 0">Shipping</td><td style="text-align:right">${money(order.shipping)}</td></tr>
  ${order.discount ? `<tr><td style="padding:6px 0">Discount${order.promo_code ? ` (${esc(order.promo_code)})` : ''}</td><td style="text-align:right">−${money(order.discount)}</td></tr>` : ''}
  <tr><td style="padding:6px 0"><b>Total</b></td><td style="text-align:right"><b>${money(order.total)}</b></td></tr></table>`;
}

const orderUrl = o => `${base()}/order/${o.number}?k=${o.access_key}`;

async function orderConfirmation(order) {
  const dls = db.prepare('SELECT * FROM downloads WHERE order_id = ?').all(order.id);
  const dlHtml = dls.length ? `<h3>Your downloads</h3><ul>${dls.map(d => `<li><a href="${base()}/download/${d.token}">${esc(d.file_name)}</a></li>`).join('')}</ul><p style="font-size:13px;color:#666">Files are licensed for your personal, non-commercial use only. Please don't share or sell the files or prints made from them. <a href="${base()}/license">File license</a></p>
    <p style="font-size:13px;color:#555">Links work ${d0(dls).max_count} times and expire ${new Date(d0(dls).expires_at).toLocaleDateString()}.</p>` : '';
  await send(order.email, `Order ${order.number} confirmed`, wrap(`<p>Thank you${order.name ? ', ' + esc(order.name.split(' ')[0]) : ''}. Your order <b>${order.number}</b> has been received.</p>
    ${itemsTable(order)}${dlHtml}
    ${order.has_physical ? '<p>Printed items are made to order. You\'ll get another email with tracking when it ships.</p>' : ''}
    <p><a href="${orderUrl(order)}">View your order</a></p>`));
}
const d0 = a => a[0];

async function adminNewOrder(order) {
  await send(process.env.ADMIN_EMAIL, `New order ${order.number} — ${money(order.total)}`, wrap(`${itemsTable(order)}<p>${esc(order.name || '')} · ${esc(order.email || '')}</p><p><a href="${base()}/admin/orders/${order.id}">Open in admin</a></p>`));
}

async function orderShipped(order) {
  await send(order.email, `Order ${order.number} shipped`, wrap(`<p>Your order <b>${order.number}</b> is on the way.</p>
    ${order.tracking ? `<p>${esc(order.carrier || 'Tracking')}: <b>${esc(order.tracking)}</b></p>` : ''}<p><a href="${orderUrl(order)}">View your order</a></p>`));
}

async function requestReceived(r) {
  const url = `${base()}/request/${r.id}?k=${r.access_key}`;
  await send(r.email, `Request ${r.number} received`, wrap(`<p>We received your request <b>${esc(r.title || r.number)}</b>. We'll review it and send a quote, typically within 1–2 business days.</p><p><a href="${url}">Check status</a></p>`));
  await send(process.env.ADMIN_EMAIL, `New request ${r.number}: ${r.title || r.type}`, wrap(`<p><b>${esc(r.type)}</b> from ${esc(r.name)} (${esc(r.email)})</p><p>${esc(r.details).slice(0, 800)}</p><p><a href="${base()}/admin/requests/${r.id}">Open in admin</a></p>`));
}

async function requestQuoted(r) {
  const url = `${base()}/request/${r.id}?k=${r.access_key}`;
  await send(r.email, `Quote ready: ${r.title || r.number}`, wrap(`<p>Your quote for <b>${esc(r.title || r.number)}</b>:</p>
    <p style="font-size:22px"><b>${money((r.quote_price || 0) + (r.quote_shipping || 0))}</b>${r.quote_shipping ? ` <small>(incl. ${money(r.quote_shipping)} shipping)</small>` : ''}</p>
    ${r.quote_lead ? `<p>Lead time: ${esc(r.quote_lead)}</p>` : ''}${r.quote_message ? `<p>${esc(r.quote_message).replace(/\n/g, '<br>')}</p>` : ''}
    <p><a href="${url}" style="background:#24453a;color:#fff;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px">Review &amp; pay</a></p>`));
}

module.exports = { send, orderConfirmation, adminNewOrder, orderShipped, requestReceived, requestQuoted };
