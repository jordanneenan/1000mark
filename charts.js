// Blocky, screen-print style charts. Colours come from the CSS tokens.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = v => v == null || !isFinite(v) ? '–' : v >= 100 ? Math.round(v).toLocaleString('en-AU') : v >= 10 ? v.toFixed(1) : v.toFixed(2);
export const pts = v => v == null ? '–' : Math.round(v).toLocaleString('en-AU');

// Horizontal bars. rows: [{label, sub, value, text, cmp, ink}]. ref draws a tick (the 1000-point line).
export function bars(rows, { ref = null, max = null, cmpLabel = '', refText = '' } = {}) {
  const top = max || Math.max(ref ? ref * 1.5 : 0, ...rows.map(r => Math.max(r.value || 0, r.cmp || 0))) * 1.04 || 1;
  const pc = v => Math.max(0, Math.min(100, (v || 0) / top * 100)).toFixed(2);
  return `<div class="bars">${rows.map(r => `
    <div class="bar-row">
      <div class="bn">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div>
      <div class="track">
        ${r.value > 0 ? `<i class="ink-${r.ink || 'ink'}" style="width:${pc(r.value)}%"></i>` : '<em>not measured</em>'}
        ${r.cmp > 0 ? `<u style="width:${pc(r.cmp)}%" title="${esc(cmpLabel)}"></u>` : ''}
        ${ref ? `<b class="ref" style="left:${pc(ref)}%"></b>` : ''}
      </div>
      <div class="bv"><b>${esc(r.text ?? fmt(r.value))}</b>${r.note ? `<small>${esc(r.note)}</small>` : ''}</div>
    </div>`).join('')}
    ${ref ? `<div class="bar-key"><span><b class="ref-key"></b>${refText ? esc(refText) : `${pts(ref)} points = reference machine`}</span>${cmpLabel ? `<span><u class="cmp-key"></u>${esc(cmpLabel)}</span>` : ''}</div>` : (cmpLabel ? `<div class="bar-key"><span><u class="cmp-key"></u>${esc(cmpLabel)}</span></div>` : '')}
  </div>`;
}

// Radar of the part scores. items: [{label, value, cmp}]
export function radar(items, cmpLabel = '') {
  const W = 440, H = 380, cx = 220, cy = 196, R = 112, n = items.length;
  // Log scale: each ring is double the one inside it, so one very high part cannot flatten the rest.
  const LOW = 125, hi = Math.max(2000, ...items.map(i => Math.max(i.value || 0, i.cmp || 0)));
  const top = LOW * 2 ** Math.ceil(Math.log2(hi / LOW));
  const frac = v => Math.max(0.04, Math.min(1, Math.log2(Math.max(v || 0, LOW) / LOW) / Math.log2(top / LOW)));
  const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n, r = R * frac(v); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  const poly = (key, v) => items.map((it, i) => pt(i, v ?? it[key]).map(x => x.toFixed(1)).join(',')).join(' ');
  const rings = []; for (let v = LOW * 2; v <= top; v *= 2) rings.push(v);
  const labels = items.map((it, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n, x = cx + Math.cos(a) * (R + 16), y = cy + Math.sin(a) * (R + 16);
    const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
    const up = Math.sin(a) < -0.3, down = Math.sin(a) > 0.3;
    return `<text x="${x.toFixed(1)}" y="${(y + (down ? 10 : up ? -24 : -8)).toFixed(1)}" text-anchor="${anchor}" class="rl">${esc(it.label)}</text>
            <text x="${x.toFixed(1)}" y="${(y + (down ? 32 : up ? -2 : 14)).toFixed(1)}" text-anchor="${anchor}" class="rv">${pts(it.value)}</text>`;
  }).join('');
  return `<svg class="radar" viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance of the part scores">
    ${rings.map(v => `<polygon points="${poly(null, v)}" class="${v === 1000 ? 'ring ref' : 'ring'}"/>`).join('')}
    ${items.map((_, i) => { const [x, y] = pt(i, top); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="axis"/>`; }).join('')}
    <polygon points="${poly('value')}" class="shadow" transform="translate(6 6)"/>
    <polygon points="${poly('value')}" class="shape"/>
    ${items.some(i => i.cmp) ? `<polygon points="${poly('cmp')}" class="cmp"/>` : ''}
    ${items.map((it, i) => { const [x, y] = pt(i, it.value); return `<rect x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10" class="dot"/>`; }).join('')}
    ${labels}
    ${rings.map(v => `<text x="${cx + 4}" y="${(cy - R * frac(v) - 3).toFixed(1)}" class="rk">${v}</text>`).join('')}
  </svg>${cmpLabel ? `<div class="bar-key"><span><u class="cmp-key"></u>${esc(cmpLabel)}</span></div>` : ''}`;
}

// Column chart of system scores over past runs. runs: [{label, value, sel}] oldest first.
export function columns(runs) {
  const W = 640, H = 210, pad = 34, top = Math.max(1200, ...runs.map(r => r.value || 0)) * 1.1;
  const bw = Math.min(64, (W - pad - 10) / Math.max(runs.length, 1) - 10);
  const y = v => H - 30 - (H - 50) * (v / top);
  const grid = []; for (let v = 500; v < top; v += 500) grid.push(v);
  return `<svg class="cols" viewBox="0 0 ${W} ${H}" role="img" aria-label="System score for each saved run">
    ${grid.map(v => `<line x1="${pad}" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${v === 1000 ? 'g ref' : 'g'}"/><text x="${pad - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="gt">${v}</text>`).join('')}
    ${runs.map((r, i) => { const x = pad + 10 + i * (bw + 10), h = H - 30 - y(r.value || 0);
      return `<rect x="${x + 5}" y="${(y(r.value || 0) + 5).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h - 5).toFixed(1)}" class="sh"/>
              <rect x="${x}" y="${y(r.value || 0).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" class="${r.sel ? 'col sel' : 'col'}"/>
              <text x="${(x + bw / 2).toFixed(1)}" y="${(y(r.value || 0) - 6).toFixed(1)}" text-anchor="middle" class="cv">${pts(r.value)}</text>
              <text x="${(x + bw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="gt">${esc(r.label)}</text>`; }).join('')}
    <line x1="${pad}" x2="${W}" y1="${H - 30}" y2="${H - 30}" class="base"/>
  </svg>`;
}

// A row of squares, one per thread, filled to show how many "cores' worth" of speed-up was reached.
export function lanes(total, filled) {
  let out = '';
  for (let i = 0; i < total; i++) { const f = Math.max(0, Math.min(1, filled - i)); out += `<span class="lane"><i style="height:${(f * 100).toFixed(0)}%"></i></span>`; }
  return `<div class="lanes">${out}</div>`;
}
