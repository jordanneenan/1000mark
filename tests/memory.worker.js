// Memory tests. Bandwidth tests move a block far bigger than the CPU caches, so
// they measure RAM, not the processor. Rates are bytes/second, hops/second or allocations/second.
let sink = 0, seed = 99991;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
let size = 0, src = null, dst = null, perm = null, fillV = 0, pos = 0;

function setup(bytes) {
  if (size === bytes && src) return;
  size = bytes; src = new Uint8Array(size); dst = new Uint8Array(size); perm = null;
}

const T = {
  // Fill a block with one value (the browser's memset).
  write: { run() { src.fill(fillV++ % 200); return size; } },
  // Scan a block for a byte that is not there (the browser's memchr).
  read: { run() { sink += src.indexOf(255); return size; } },
  // Copy one block onto another (memcpy).
  copy: { run() { dst.set(src); return size; } },
  // Follow a random chain of pointers through a block bigger than the cache: this is memory latency.
  random: {
    run() {
      if (!perm) { const n = size >> 2; perm = new Int32Array(n); for (let i = 0; i < n; i++) perm[i] = i; for (let i = n - 1; i > 0; i--) { const j = (rnd() * i) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; } pos = 0; }
      let p = pos; const a = perm; for (let i = 0; i < 2000000; i++) p = a[p]; pos = p; sink += p; return 2000000;
    } },
  // Make and drop lots of small objects: the allocator and garbage collector.
  alloc: { run() { let keep = []; for (let i = 0; i < 200000; i++) { keep.push({ a: i, b: [i, i + 1], c: 'x' + (i & 7) }); if (keep.length > 1000) keep = []; } sink += keep.length; return 200000; } },
};

async function timed(t, ms) {
  t.run();
  let units = 0, el = 0; const t0 = performance.now();
  do { units += t.run(); el = performance.now() - t0; } while (el < ms);
  return units / (el / 1000);
}

self.onmessage = async e => {
  const { id, test, ms, bytes } = e.data;
  try {
    if (test === 'free') { src = dst = perm = null; size = 0; self.postMessage({ id, rate: 0 }); return; }
    setup(bytes);
    self.postMessage({ id, rate: await timed(T[test], ms), bytes: size });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
