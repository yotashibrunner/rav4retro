// Site photo slots. Each slot is uploaded in Admin → Photos; until then a branded placeholder shows.
const path = require('path');
const fs = require('fs');
const { UPLOAD_DIR, getSetting, setSetting, token } = require('./db');

const SLOTS = [
  { key: 'hero', label: 'Your RAV, hero shot', hint: 'Low three-quarter front angle outdoors, trail or woods behind. Wide, landscape.', ratio: '16/9' },
  { key: 'installed', label: 'Part installed', hint: 'A RAV4 Retro part on the vehicle, close enough to see it.', ratio: '4/3' },
  { key: 'trail', label: 'On the trail', hint: 'The vehicle on the trail: mud, gravel, two-track.', ratio: '4/3' },
  { key: 'detail', label: 'Part close-up', hint: 'A printed part on the bench, good light, sharp edges.', ratio: '1/1' },
  { key: 'garage', label: 'The garage', hint: 'Wide shot: the vehicles, the printers, the bench.', ratio: '4/3' },
  { key: 'before_after', label: 'Request section photo', hint: 'A parts vehicle, or a broken original next to the printed one.', ratio: '4/3' },
  { key: 'step_scan', label: 'How it\'s made 1: scan', hint: 'An original part on the scanner.', ratio: '1/1' },
  { key: 'step_model', label: 'How it\'s made 2: CAD model', hint: 'The part on screen in CAD.', ratio: '1/1' },
  { key: 'step_print', label: 'How it\'s made 3: printed', hint: 'The finished print on the bed.', ratio: '1/1' },
  { key: 'step_fit', label: 'How it\'s made 4: fitted', hint: 'The part installed on the vehicle.', ratio: '1/1' },
];
const byKey = Object.fromEntries(SLOTS.map(s => [s.key, s]));

// stored as "/uploads/site-<key>-<id>" ; files are <base>-1200.webp and <base>-2400.webp
const get = key => getSetting('photo_' + key) || '';

async function save(key, filePath) {
  const sharp = require('sharp');
  const base = `site-${key}-${token(5)}`;
  // .rotate() applies EXIF orientation; output carries no EXIF (GPS stripped) since withMetadata is not used
  for (const w of [1200, 2400]) {
    await sharp(filePath).rotate().resize({ width: w, withoutEnlargement: true })
      .webp({ quality: w > 1200 ? 72 : 76 }).toFile(path.join(UPLOAD_DIR, `${base}-${w}.webp`));
  }
  remove(key);
  setSetting('photo_' + key, '/uploads/' + base);
  fs.unlink(filePath, () => {});
}

function remove(key) {
  const cur = get(key);
  if (cur) for (const w of [1200, 2400]) fs.unlink(path.join(UPLOAD_DIR, path.basename(cur) + `-${w}.webp`), () => {});
  setSetting('photo_' + key, '');
}

module.exports = { SLOTS, byKey, get, save, remove };
