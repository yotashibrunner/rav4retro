const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads'); // public images
const FILE_DIR = path.join(DATA_DIR, 'files');     // private STL files
const REQUEST_DIR = path.join(DATA_DIR, 'requests'); // private customer uploads
for (const d of [DATA_DIR, UPLOAD_DIR, FILE_DIR, REQUEST_DIR]) fs.mkdirSync(d, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'store.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'misc',
  description TEXT DEFAULT '',
  images TEXT DEFAULT '[]',
  colors TEXT DEFAULT '',
  pricing_mode TEXT DEFAULT 'fixed',       -- fixed | sqft
  physical_enabled INTEGER DEFAULT 1,
  physical_price INTEGER DEFAULT 0,        -- cents
  sqft_price INTEGER DEFAULT 0,            -- cents per sq ft
  min_price INTEGER DEFAULT 0,             -- cents, sqft minimum
  stock INTEGER,                           -- NULL = made to order
  lead_time TEXT DEFAULT '',
  digital_enabled INTEGER DEFAULT 0,
  digital_price INTEGER DEFAULT 0,
  stl_path TEXT,
  stl_name TEXT,
  featured INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  access_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | printing | shipped | complete | cancelled
  email TEXT, name TEXT, phone TEXT,
  items TEXT NOT NULL,
  subtotal INTEGER, shipping INTEGER, total INTEGER,
  has_physical INTEGER DEFAULT 0,
  request_id INTEGER,
  stripe_session TEXT, stripe_payment_intent TEXT,
  shipping_address TEXT,
  carrier TEXT, tracking TEXT, admin_notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT, shipped_at TEXT
);
CREATE TABLE IF NOT EXISTS downloads (
  token TEXT PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  max_count INTEGER DEFAULT 5,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  access_key TEXT NOT NULL,
  type TEXT NOT NULL,                      -- custom_print | organizer | part_request | scan | design
  status TEXT NOT NULL DEFAULT 'new',      -- new | reviewing | quoted | accepted | paid | in_progress | done | declined
  name TEXT, email TEXT, phone TEXT,
  title TEXT, details TEXT,
  vehicle TEXT, dimensions TEXT, material TEXT, color TEXT, quantity INTEGER DEFAULT 1,
  deadline TEXT, budget TEXT, delivery TEXT DEFAULT 'ship',
  files TEXT DEFAULT '[]',
  quote_price INTEGER, quote_shipping INTEGER, quote_message TEXT, quote_lead TEXT,
  admin_notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  quoted_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

// migrations for columns added after first release
const pcols = db.prepare('PRAGMA table_info(products)').all().map(c => c.name);
if (!pcols.includes('fitment')) db.exec("ALTER TABLE products ADD COLUMN fitment TEXT DEFAULT ''");
if (!pcols.includes('oem_part')) db.exec("ALTER TABLE products ADD COLUMN oem_part TEXT DEFAULT ''");

const DEFAULTS = {
  store_name: 'RAV4 Retro',
  tagline: 'Parts for the first-gen RAV4.',
  announcement: '',
  categories: "interior|Interior\nexterior|Exterior\naudio|Audio\nlighting|Lighting\nrecovery|Trail & Recovery\nmerch|Stickers & Merch",
  shipping_flat: '800',
  free_shipping_over: '7500',
  download_days: '30',
  download_max: '5',
  local_pickup: 'Ohio',
  about: "I've owned first-gen RAV4s for the last ten years, and for the past few I've been parting them out and selling what I pull to other owners. Every year that gets harder. Good used parts are drying up, and most of the aftermarket stuff made for these is long gone.\n\nRAV4 Retro is my way of keeping these on the road and keeping the community going. I make the parts that are getting hard to find, test-fit them on my own vehicles, and sell them to the people who still drive and wrench on these. If you need something that isn't here yet, send me a photo. Chances are someone else needs it too.",
  intro: "Reproduction and upgrade parts for 1996–2000 Toyota RAV4s, printed in Ohio and test-fit on our own vehicles.",
  contact_email: '',
  facebook_url: '',
  next_drop: '',
};
const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULTS)) ins.run(k, v);
// replace the first-draft About text if it was never edited
db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').run(DEFAULTS.about, 'about', "RAV4 Retro is one guy in Ohio with too many first-gen RAV4s. When a part on mine broke and Toyota stopped making it, I scanned it, fixed the design and printed a better one.\n\nEverything here is made to order in UV-resistant ASA or PETG, test-fit on my own vehicles before it goes up for sale. If you need a part that isn't listed, send a photo and I'll see what I can do.");

function getSetting(k) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
  return r ? r.value : DEFAULTS[k];
}
function setSetting(k, v) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
}
function getCategories() {
  return getSetting('categories').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [key, label] = l.split('|');
    return { key: key.trim(), label: (label || key).trim() };
  });
}
function parseProduct(p) {
  if (!p) return p;
  return {
    ...p,
    images: JSON.parse(p.images || '[]'),
    colors: (p.colors || '').split(',').map(s => s.trim()).filter(Boolean),
  };
}
function token(n = 24) { return crypto.randomBytes(n).toString('base64url'); }
function shortCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(6)) s += chars[b % chars.length];
  return `${prefix}-${s}`;
}
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item';
}

module.exports = { db, DATA_DIR, UPLOAD_DIR, FILE_DIR, REQUEST_DIR, getSetting, setSetting, getCategories, parseProduct, token, shortCode, slugify };
