// Shippo: get rates and buy labels for an order. Needs SHIPPO_API_KEY.
// Test keys (shippo_test_...) return fake labels at no cost; live keys buy real postage.
const { getSetting } = require('./db');

const API = 'https://api.goshippo.com';
const enabled = () => !!process.env.SHIPPO_API_KEY;
const isTest = () => String(process.env.SHIPPO_API_KEY || '').startsWith('shippo_test_');

async function call(path, body) {
  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shippo ${res.status}: ${JSON.stringify(j.detail || j).slice(0, 300)}`);
  return j;
}

function fromAddress() {
  return {
    name: getSetting('ship_from_name') || getSetting('store_name'),
    street1: getSetting('ship_from_street'),
    city: getSetting('ship_from_city'),
    state: getSetting('ship_from_state'),
    zip: getSetting('ship_from_zip'),
    country: 'US',
    phone: getSetting('ship_from_phone') || '',
    email: getSetting('contact_email') || process.env.ADMIN_EMAIL || '',
  };
}

function missingFrom() {
  const f = fromAddress();
  return ['street1', 'city', 'state', 'zip'].filter(k => !f[k]);
}

function toAddress(order) {
  const a = order.shipping_address ? JSON.parse(order.shipping_address) : null;
  if (!a?.address) return null;
  return {
    name: a.name || order.name || '',
    street1: a.address.line1, street2: a.address.line2 || '',
    city: a.address.city, state: a.address.state || '', zip: a.address.postal_code,
    country: a.address.country || order.ship_country || 'US',
    phone: order.phone || '', email: order.email || '',
  };
}

// Customs form for international packages: one line per physical item.
async function customs(order, weightLb) {
  const lines = JSON.parse(order.items).filter(l => l.variant !== 'digital');
  const totalQty = lines.reduce((n, l) => n + l.qty, 0) || 1;
  const decl = await call('/customs/declarations/', {
    contents_type: 'MERCHANDISE', non_delivery_option: 'RETURN', certify: true,
    certify_signer: getSetting('ship_from_name') || getSetting('store_name'),
    items: lines.map(l => ({
      description: `Plastic automotive trim part (${l.title})`.slice(0, 100),
      quantity: l.qty,
      net_weight: String(Math.max(0.05, (weightLb * l.qty) / totalQty).toFixed(2)), mass_unit: 'lb',
      value_amount: String(((l.unit * l.qty) / 100).toFixed(2)), value_currency: 'USD',
      origin_country: 'US', tariff_number: '8708.29',
    })),
  });
  return decl.object_id;
}

async function rates(order, parcel) {
  const to = toAddress(order);
  if (!to) throw new Error('This order has no shipping address.');
  const body = {
    address_from: fromAddress(), address_to: to, async: false,
    parcels: [{ length: String(parcel.l), width: String(parcel.w), height: String(parcel.h), distance_unit: 'in', weight: String(parcel.lb), mass_unit: 'lb' }],
  };
  if (to.country !== 'US') body.customs_declaration = await customs(order, Number(parcel.lb));
  const s = await call('/shipments/', body);
  const list = (s.rates || []).map(r => ({
    id: r.object_id, amount: Number(r.amount), carrier: r.provider, service: r.servicelevel?.name || '', days: r.estimated_days,
  })).sort((a, b) => a.amount - b.amount);
  if (!list.length) throw new Error('No rates came back. ' + (s.messages || []).map(m => m.text).join(' '));
  return list;
}

async function buy(rateId) {
  const t = await call('/transactions/', { rate: rateId, label_file_type: 'PDF_4x6', async: false });
  if (t.status !== 'SUCCESS') throw new Error('Label failed: ' + (t.messages || []).map(m => m.text).join(' '));
  return { label: t.label_url, tracking: t.tracking_number, trackingUrl: t.tracking_url_provider };
}

module.exports = { enabled, isTest, rates, buy, missingFrom, toAddress };
