// Cart stored in localStorage; server re-prices everything at checkout.
window.RRCart = {
  get() { try { return JSON.parse(localStorage.getItem('rr_cart')) || []; } catch (e) { return []; } },
  set(items) { try { localStorage.setItem('rr_cart', JSON.stringify(items)); } catch (e) {} this.badge(); },
  add(item) {
    const items = this.get();
    item.key = [item.kind || 'p', item.productId, item.variant, item.size, item.w, item.d, item.h, item.fill, item.magnets, item.color, item.style, item.notes, item.pv].join('|');
    const existing = items.find(i => i.key === item.key);
    if (item.variant === 'digital' && existing) return;
    if (existing) existing.qty = Math.min(item.kind === 'bin' ? 200 : 50, (existing.qty || 1) + (item.qty || 1));
    else items.push(item);
    this.set(items);
  },
  badge() {
    const el = document.getElementById('cart-count');
    if (el) el.textContent = this.get().reduce((s, i) => s + (i.qty || 1), 0);
  },
};
document.addEventListener('DOMContentLoaded', () => RRCart.badge());
