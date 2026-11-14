// Blocky, screen-print style charts. Colours come from the CSS tokens.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = v => v == null || !isFinite(v) ? '–' : v >= 100 ? Math.round(v).toLocaleString('en-AU') : v >= 10 ? v.toFixed(1) : v.toFixed(2);
export const pts = v => v == null ? '–' : Math.round(v).toLocaleString('en-AU');

// Horizontal bars. rows: [{label, sub, value, text, cmp, ink}]. ref draws a tick (the 1000-point line).
export function bars(rows, { ref = null, max = null, cmpLabel = '', refText = '' } = {}) {
  const top = max || Math.max(ref ? ref * 1.5 : 0, ...rows.map(r => Math.max(r.value || 0, r.cmp || 0))) * 1.04 || 1;
  const pc = v => Math.max(0, Math.min(100, (v || 0) / top * 100)).toFixed(2);
  return `<div class="bars${rows.length >= 12 ? ' many' : ''}">${rows.map(r => `
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
  // On a phone the chart is drawn smaller with two-line labels, so the type stays readable.
  const compact = typeof matchMedia === 'function' && matchMedia('(max-width: 620px)').matches;
  const [W, H, cx, cy, R, gap] = compact ? [380, 384, 190, 196, 98, 14] : [760, 600, 380, 306, 215, 22], n = items.length;
  // Log scale: each heavy ring is double the one inside it, so one very high part cannot flatten the rest.
  // Four fine rings sit between each pair (fifths of the way, like log paper) so a score can be read off.
  const LOW = 125, hi = Math.max(2000, ...items.map(i => Math.max(i.value || 0, i.cmp || 0)));
  const top = LOW * 2 ** Math.ceil(Math.log2(hi / LOW));
  const frac = v => Math.max(0.02, Math.min(1, Math.log2(Math.max(v || 0, LOW) / LOW) / Math.log2(top / LOW)));
  const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n, r = R * frac(v); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  const poly = (key, v) => items.map((it, i) => pt(i, v ?? it[key]).map(x => x.toFixed(1)).join(',')).join(' ');
  const majors = [], minors = [];
  for (let v = LOW * 2; v <= top; v *= 2) majors.push(v);
  for (let v = LOW; v < top; v *= 2) for (let k = 1; k < 5; k++) minors.push(v * (1 + k / 5));
  const labels = items.map((it, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n, x = (cx + Math.cos(a) * (R + gap)).toFixed(1), y = cy + Math.sin(a) * (R + gap);
    const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
    const up = Math.sin(a) < -0.3, down = Math.sin(a) > 0.3;
    const lines = compact ? it.label.split(' ') : [it.label], lh = 12, extra = (lines.length - 1) * lh;
    // Label lines, then the score under them; the stack sits above, below or beside its corner.
    const y0 = y + (down ? 14 : up ? -(compact ? 24 : 34) - extra : -8 - extra / 2);
    return `${lines.map((l, k) => `<text x="${x}" y="${(y0 + k * lh).toFixed(1)}" text-anchor="${anchor}" class="rl">${esc(l)}</text>`).join('')}
            <text x="${x}" y="${(y0 + extra + (compact ? 20 : 28)).toFixed(1)}" text-anchor="${anchor}" class="rv">${pts(it.value)}</text>`;
  }).join('');
  return `<svg class="radar${compact ? ' compact' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance of the part scores: ${esc(items.map(i => `${i.label} ${pts(i.value)}`).join(', '))}">
    ${minors.map(v => `<polygon points="${poly(null, v)}" class="ring minor"/>`).join('')}
    ${majors.map(v => `<polygon points="${poly(null, v)}" class="${v === 1000 ? 'ring ref' : 'ring'}"/>`).join('')}
    ${items.map((_, i) => { const [x, y] = pt(i, top); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="axis"/>`; }).join('')}
    <polygon points="${poly('value')}" class="shape"/>
    ${items.some(i => i.cmp) ? `<polygon points="${poly('cmp')}" class="cmp"/>` : ''}
    ${items.map((it, i) => { const [x, y] = pt(i, it.value); return it.value ? `<rect x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="8" height="8" class="dot"><title>${esc(it.label)}: ${pts(it.value)}</title></rect>` : ''; }).join('')}
    ${labels}
    ${majors.map(v => `<text x="${cx + 6}" y="${(cy - R * frac(v) - 4).toFixed(1)}" class="rk">${v.toLocaleString('en-AU')}</text>`).join('')}
  </svg><div class="bar-key"><span><b class="ring-key"></b>1,000 = reference machine. Each heavy ring is double the one inside it.</span>${cmpLabel ? `<span><u class="cmp-key"></u>${esc(cmpLabel)}</span>` : ''}</div>`;
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
