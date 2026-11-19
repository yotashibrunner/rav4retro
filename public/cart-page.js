(function () {
  const root = document.getElementById('cart-root');
  const fmt = c => '$' + (c / 100).toFixed(2);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function load() {
    const items = RRCart.get();
    if (!items.length) { root.innerHTML = '<p class="muted">Your cart is empty. <a href="/shop">Browse the shop</a></p>'; return; }
    const res = await fetch('/api/cart/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
    const q = await res.json();
    root.innerHTML = `
      ${q.errors.length ? `<div class="notice err">${q.errors.map(esc).join('<br>')}<br><small>Those items were removed from the total.</small></div>` : ''}
      <table class="tbl cart">${q.lines.map(l => `<tr>
        <td class="ci">${l.image ? `<img src="${esc(l.image)}" alt="">` : ''}</td>
        <td><a href="${l.slug ? '/p/' + esc(l.slug) : esc(l.link || '/shop')}">${esc(l.title)}</a>${l.variant === 'digital' ? ' <span class="pill">STL</span>' : ''}<br><span class="small muted">${esc(l.desc)}</span></td>
        <td>${l.variant === 'digital' ? '1' : `<input class="qty" type="number" min="1" max="${l.kind === 'bin' ? 200 : 50}" value="${l.qty}" data-key="${esc(l.key)}">`}</td>
        <td class="r">${fmt(l.line_total)}</td>
        <td><button class="linkbtn" data-rm="${esc(l.key)}">remove</button></td></tr>`).join('')}
        <tr><td></td><td colspan="2">Subtotal</td><td class="r">${fmt(q.subtotal)}</td><td></td></tr>
        ${q.hasPhysical ? `<tr><td></td><td colspan="2">Shipping</td><td class="r">${q.shipping ? fmt(q.shipping) : 'Free'}</td><td></td></tr>` : ''}
        <tr class="tot"><td></td><td colspan="2">Total</td><td class="r">${fmt(q.total)}</td><td></td></tr></table>
      <div class="checkout"><button class="btn" id="checkout" ${q.lines.length ? '' : 'disabled'}>Checkout securely</button>
      <p class="small muted">Secure payment by Stripe: cards, Apple Pay and Google Pay. STL files download right after payment. By ordering you agree to our <a href="/terms">terms</a>, <a href="/returns">returns policy</a> and <a href="/license">file license</a>.</p>
      <p id="co-err" class="notice err" hidden></p></div>`;

    // drop items the server rejected
    if (q.errors.length) RRCart.set(items.filter(i => q.lines.some(l => l.key === i.key)));
  }

  root.addEventListener('change', e => {
    if (!e.target.classList.contains('qty')) return;
    const items = RRCart.get();
    const it = items.find(i => i.key === e.target.dataset.key);
    if (it) { it.qty = Math.max(1, Math.min(it.kind === 'bin' ? 200 : 50, Number(e.target.value) || 1)); RRCart.set(items); load(); }
  });
  root.addEventListener('click', async e => {
    if (e.target.dataset.rm) { RRCart.set(RRCart.get().filter(i => i.key !== e.target.dataset.rm)); load(); }
    if (e.target.id === 'checkout') {
      e.target.disabled = true; e.target.textContent = 'Redirecting…';
      const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: RRCart.get() }) });
      const j = await res.json();
      if (j.url) location.href = j.url;
      else { const el = document.getElementById('co-err'); el.hidden = false; el.textContent = j.error || 'Checkout failed'; e.target.disabled = false; e.target.textContent = 'Checkout securely'; }
    }
  });
  load();
})();
