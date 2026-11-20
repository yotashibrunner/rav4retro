(function () {
  const box = document.getElementById('buybox');
  if (!box) return;
  const P = window.PRODUCT;
  const $ = id => document.getElementById(id);
  const mode = box.dataset.mode;
  const n = k => Number(box.dataset[k]) || 0;
  const fmt = c => '$' + (c / 100).toFixed(2);
  const variant = () => (box.querySelector('input[name=variant]:checked') || box.querySelector('input[name=variant]')).value;
  // Printify merch: find the variant matching the chosen size/color
  const podPick = () => {
    if (!P.pod) return null;
    const picked = [...box.querySelectorAll('.pod-opt')].map(s => s.value);
    return P.pod.variants.find(v => picked.every(x => v.opts.includes(x))) || null;
  };

  function price() {
    if (variant() === 'digital') return { cents: n('dig') };
    if (mode === 'sqft') {
      const w = Number($('w').value), d = Number($('d').value);
      if (!(w > 0 && d > 0)) return { cents: null, label: `${fmt(n('sqft'))}/sq ft` };
      const area = (w * d) / 144;
      return { cents: Math.max(n('min'), Math.round(n('sqft') * area)), sub: `${area.toFixed(2)} sq ft` };
    }
    const q = Math.max(1, Number(($('qty') || {}).value) || 1);
    if (P.pod) {
      const v = podPick();
      if (!v) return { cents: null, label: 'Not available' };
      return { cents: v.price * q, sub: q > 1 ? `${q} × ${fmt(v.price)}` : '' };
    }
    return { cents: n('phys') * q, sub: q > 1 ? `${q} × ${fmt(n('phys'))}` : '' };
  }

  function render() {
    const v = variant();
    box.querySelector('.phys-opts').hidden = v !== 'physical';
    box.querySelector('.dig-opts').hidden = v !== 'digital';
    const p = price();
    $('price').innerHTML = p.cents == null ? p.label : fmt(p.cents) + (p.sub ? ` <small>${p.sub}</small>` : '');
    $('add').disabled = (v === 'physical' && P.out) || (P.pod && !podPick());
    if ($('pod-na')) $('pod-na').hidden = !P.pod || !!podPick();
  }

  box.addEventListener('input', render);
  box.addEventListener('change', render);
  $('add').addEventListener('click', () => {
    const v = variant();
    const item = { productId: P.id, variant: v, qty: 1 };
    if (v === 'physical') {
      if (mode === 'sqft') {
        item.w = Number($('w').value); item.d = Number($('d').value);
        if (!(item.w >= 1 && item.d >= 1)) { alert('Enter your drawer width and depth in inches.'); return; }
      } else item.qty = Math.max(1, Number($('qty').value) || 1);
      if (P.pod) { const pv = podPick(); if (!pv) return; item.pv = pv.id; }
      if ($('color')) item.color = $('color').value;
      if ($('notes') && $('notes').value.trim()) item.notes = $('notes').value.trim();
    }
    RRCart.add(item);
    $('added').hidden = false;
  });
  render();
})();
