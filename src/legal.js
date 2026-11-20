// Legal pages: terms, file license, returns, privacy.
// Plain-language versions of the usual small-shop policies. Edit the text here.
const { getSetting } = require('./db');

const UPDATED = 'November 19, 2026';

function contact() {
  const e = getSetting('contact_email');
  return e ? `<a href="mailto:${e}">${e}</a>` : 'the contact email in the site footer';
}

const PAGES = {
  terms: {
    title: 'Terms of sale',
    body: () => `
<p>These terms cover anything you buy or request from RAV4 Retro ("we", "us") through www.rav4retro.net. By placing an order or a request, you agree to them.</p>

<h2>Who we are</h2>
<p>RAV4 Retro is a small, independent maker of reproduction and upgrade parts for first-generation (1996–2000) Toyota RAV4s, based in Ohio. We are not affiliated with, endorsed by or sponsored by Toyota Motor Corporation. "Toyota" and "RAV4" are trademarks of Toyota Motor Corporation and are used only to describe what our parts fit. All of our parts are aftermarket.</p>

<h2>Products</h2>
<p>Our parts are 3D printed to order. Printed parts can show small layer lines, slight color variation and minor differences from photos. Fitment notes describe the vehicles we've test-fit; production variation, prior repairs and damage on your vehicle can affect fit.</p>
<p>Our parts are trim, interior, accessory and convenience parts. They are not designed, tested or sold for structural, load-bearing, safety-critical, steering, braking, suspension or occupant-protection use, and must not be used that way. Recovery and trail accessories are for light use only and are not rated recovery gear.</p>

<h2>Installation and use</h2>
<p>You are responsible for installing parts correctly, checking that they suit your vehicle and use, and following applicable laws. Installing aftermarket parts may affect any remaining warranty on your vehicle. Use our parts at your own risk.</p>

<h2>Prices and payment</h2>
<p>Prices are in US dollars and can change at any time before you order. Payment is processed by Stripe; we never see or store your full card number. We may cancel and fully refund any order, including if a price or listing was posted in error.</p>

<h2>Shipping</h2>
<p>Most orders are made to order and ship in the time shown on the product. Shipping times are estimates. Once a package is handed to the carrier, delivery times are up to the carrier; if a package is lost or arrives damaged, contact us and we'll make it right.</p>
<p>We ship to the US and to the countries offered at checkout. International orders usually take 1–3 weeks. Any import duties, taxes or customs fees are the buyer's responsibility and are collected by the carrier or customs on delivery.</p>

<h2>Custom work and part requests</h2>
<p>Quotes for custom work are valid for 30 days. Work starts after you pay the quote. Because custom parts are made for you, they can't be returned once production starts, though we'll still fix our own mistakes.</p>
<p>When you send us a part, photos or files, you confirm you have the right to do so and that copying the part doesn't infringe anyone else's rights. Unless we agree otherwise in writing, the designs, scans and models we create, including ones made from your part, belong to RAV4 Retro, and we may offer the resulting part to other customers. You receive the physical parts you paid for.</p>

<h2>Returns</h2>
<p>See our <a href="/returns">returns and refunds policy</a>.</p>

<h2>Printable files</h2>
<p>Digital files are licensed, not sold. See the <a href="/license">file license</a>.</p>

<h2>Limitation of liability</h2>
<p>To the fullest extent the law allows, our products are provided "as is" without warranties beyond those stated on this site, and our total liability for any claim relating to a purchase is limited to the amount you paid for that purchase. We are not liable for indirect, incidental or consequential damages, including damage to your vehicle, from installation, misuse or use outside a part's intended purpose. Some places don't allow these limits, so they may not fully apply to you.</p>

<h2>Our designs</h2>
<p>All content on this site, including photos, text, part designs, 3D models and files, belongs to RAV4 Retro and is protected by copyright and other laws. You may not copy, scan, reverse engineer for resale, reproduce or sell our parts or designs without written permission.</p>

<h2>Governing law</h2>
<p>These terms are governed by the laws of the State of Ohio, United States. We may update these terms; the version posted when you order applies to that order.</p>

<h2>Contact</h2>
<p>Questions: ${contact()}.</p>`,
  },

  license: {
    title: 'File license',
    body: () => `
<p>When you buy a printable file (STL, 3MF, STEP or similar) from RAV4 Retro, you are buying a license to use it, not the design itself. RAV4 Retro keeps all rights, title and ownership in every file and design.</p>

<h2>You may</h2>
<ul>
  <li>Download the file and keep a backup copy for yourself.</li>
  <li>Print the part, or have someone print it for you, for your own personal, non-commercial use on vehicles you own.</li>
  <li>Modify the file for your own personal, non-commercial use.</li>
  <li>Post photos of parts you printed. Tagging RAV4 Retro is appreciated.</li>
</ul>

<h2>You may not</h2>
<ul>
  <li>Sell, rent or give away printed parts made from the file, or print parts for anyone else, whether paid or free.</li>
  <li>Share, upload, post, email or otherwise distribute the file or any modified version, including on Thingiverse, Printables, Cults, MakerWorld, forums, Discord, Facebook groups or file-sharing services.</li>
  <li>Sell or distribute modified, remixed, rescanned or "inspired by" versions of the design.</li>
  <li>Use the file, or parts made from it, in any commercial product, service, kit or listing.</li>
  <li>Use the file or our designs to train machine-learning models or to build a competing catalog.</li>
  <li>Remove or hide any marks or notices in the file.</li>
</ul>

<h2>Licensing and the license term</h2>
<p>The license is personal to the buyer and can't be transferred or resold. If you break these terms, the license ends automatically and you must delete every copy of the file. We may take action to protect our designs, including takedown notices and legal claims.</p>
<p>Want to print or sell our parts commercially? Contact us about a commercial license: ${contact()}.</p>

<h2>No refunds on downloaded files</h2>
<p>Because files can't be returned, file purchases are final once a download has started. If a file is broken or won't open, tell us and we'll fix or replace it.</p>

<h2>Printing at your own risk</h2>
<p>Print results depend on your printer, settings and material. We recommend ASA or PETG for anything exposed to sun or heat. Parts printed from our files are subject to the same use limits as our printed parts (see <a href="/terms">terms of sale</a>).</p>`,
  },

  returns: {
    title: 'Returns and refunds',
    body: () => `
<h2>Printed parts</h2>
<ul>
  <li><b>Doesn't fit:</b> if a part doesn't fit a vehicle listed under "Fits", tell us within 30 days of delivery. We'll send a reprint or refund the part once it's back.</li>
  <li><b>Arrived broken or wrong:</b> send a photo within 14 days of delivery and we'll replace it at no cost. Usually you don't need to send the broken one back.</li>
  <li><b>Changed your mind:</b> unused parts in original condition can be returned within 30 days of delivery for a refund of the part price. Return shipping is on you.</li>
</ul>

<h2>Not returnable</h2>
<ul>
  <li>Custom parts and part requests, once production has started.</li>
  <li>Printable files once a download has started (broken files are fixed or replaced).</li>
  <li>Parts that have been modified, painted, damaged during installation or used outside their intended purpose.</li>
</ul>

<h2>How</h2>
<p>Email ${contact()} with your order number and a photo. Refunds go back to the original payment method, usually within 5–10 business days of approval.</p>`,
  },

  privacy: {
    title: 'Privacy policy',
    body: () => `
<p>This explains what information RAV4 Retro collects through www.rav4retro.net and how we use it.</p>

<h2>What we collect</h2>
<ul>
  <li><b>Orders:</b> name, email, phone (optional), shipping address and what you bought.</li>
  <li><b>Part requests:</b> what you send in the form, including photos and files.</li>
  <li><b>Payments:</b> handled by Stripe. We receive confirmation of payment and limited details such as the card brand and last four digits, never the full card number.</li>
  <li><b>Technical:</b> standard server logs (such as IP address and browser type) kept for security and troubleshooting.</li>
</ul>

<h2>How we use it</h2>
<p>To make and ship your order, send order, shipping and download emails, answer requests and questions, prevent fraud, and keep business and tax records. We don't sell or rent your information, and we don't send marketing email unless you ask to hear from us.</p>

<h2>Who we share it with</h2>
<p>Only the services we need to run the shop: Stripe (payments), Resend (sending email), Railway (hosting), and the shipping carrier for your package. Each handles your data under its own privacy terms. We may also disclose information if the law requires it.</p>

<h2>Cookies and storage</h2>
<p>The site keeps your cart in your browser's local storage. It doesn't use advertising or tracking cookies. If we add analytics later, we'll update this page.</p>

<h2>Keeping and deleting data</h2>
<p>We keep order records as long as needed for business and tax purposes. You can ask us to see, correct or delete your information, except records we must keep, by emailing ${contact()}.</p>

<h2>Children</h2>
<p>This site isn't directed to children under 13, and we don't knowingly collect their information.</p>`,
  },
};

function page(key) {
  const p = PAGES[key];
  if (!p) return null;
  return { title: p.title, html: `<article class="legal-doc"><h1 class="page">${p.title}</h1><p class="muted small">Last updated ${UPDATED}</p>${p.body()}</article>` };
}

module.exports = { page, KEYS: Object.keys(PAGES) };
