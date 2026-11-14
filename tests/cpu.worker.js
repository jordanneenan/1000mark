// CPU tests. Each test does a fixed chunk of work per run() and returns how many
// units of work that was; timed() repeats it for the requested time and reports units/second.
// The main page runs one of these workers for single-thread scores and one per
// logical core, all at once, for multi-thread scores.
let sink = 0;
let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };

const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const W = new Uint32Array(64);

// SHA-256 compression over whole 64-byte blocks (no padding: this is a speed test, not a digest).
function sha256Blocks(data) {
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const n = data.length - (data.length % 64);
  for (let off = 0; off < n; off += 64) {
    for (let i = 0; i < 16; i++) { const j = off + i * 4; W[i] = (data[j] << 24) | (data[j+1] << 16) | (data[j+2] << 8) | data[j+3]; }
    for (let i = 16; i < 64; i++) {
      const a = W[i-15], b = W[i-2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i-16] + s0 + W[i-7] + s1) | 0;
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;h4=(h4+e)|0;h5=(h5+f)|0;h6=(h6+g)|0;h7=(h7+h)|0;
  }
  return h0 ^ h7;
}

function modpow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; e >>= 1n; b = b * b % m; } return r; }

const T = {
  // Integer shifts, xors and multiplies: the bread and butter of general code.
  int: { run() { let h = 0x9e3779b9 | 0, x = 88172645; for (let i = 0; i < 2000000; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; h = Math.imul(h ^ x, 0x85ebca6b); h ^= h >>> 13; } sink ^= h; return 2000000; } },

  // Double-precision floating point: a Mandelbrot set.
  float: { run() { let total = 0; const n = 160; for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) { const x0 = px / n * 3.5 - 2.5, y0 = py / n * 2 - 1; let x = 0, y = 0, i = 0; while (i < 256 && x * x + y * y <= 4) { const t = x * x - y * y + x0; y = 2 * x * y + y0; x = t; i++; } total += i; } sink += total; return total; } },

  // Dense matrix multiply: linear algebra, the shape of most scientific and AI work.
  matrix: {
    setup() { const n = this.n = 128; this.a = new Float64Array(n * n); this.b = new Float64Array(n * n); this.c = new Float64Array(n * n); for (let i = 0; i < n * n; i++) { this.a[i] = rnd(); this.b[i] = rnd(); } },
    run() { const n = this.n, a = this.a, b = this.b, c = this.c; c.fill(0); for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) { const aik = a[i * n + k]; const io = i * n, ko = k * n; for (let j = 0; j < n; j++) c[io + j] += aik * b[ko + j]; } sink += c[n]; return 2 * n * n * n; } },

  // Sorting random numbers: branch prediction and cache behaviour.
  sort: { setup() { this.a = new Float64Array(200000); }, run() { const a = this.a; for (let i = 0; i < a.length; i++) a[i] = rnd(); a.sort(); sink += a[1000]; return a.length; } },

  // SHA-256 written in plain JavaScript: bit rotation and 32-bit adds.
  sha: { setup() { this.d = new Uint8Array(262144); for (let i = 0; i < this.d.length; i++) this.d[i] = (rnd() * 256) | 0; }, run() { sink ^= sha256Blocks(this.d); return this.d.length; } },

  // SHA-256 through the browser's built-in crypto, which uses the CPU's crypto instructions when it has them.
  crypto: {
    setup() { if (!(self.crypto && crypto.subtle)) throw new Error('Built-in crypto needs a secure (https) page'); this.d = new Uint8Array(4194304); for (let i = 0; i < this.d.length; i += 4096) this.d[i] = i & 255; },
    async run() { const h = await crypto.subtle.digest('SHA-256', this.d); sink ^= new Uint8Array(h)[0]; return this.d.length; } },

  // LZ-style compression of text: hash lookups and byte comparisons.
  compress: {
    setup() { const words = 'the quick brown fox jumps over a lazy dog while seven wizards quietly box packed jugs of liquid data stream buffer cache block index'.split(' '); const n = 262144, d = this.d = new Uint8Array(n); let p = 0; while (p < n) { const w = words[(rnd() * words.length) | 0]; for (let i = 0; i < w.length && p < n; i++) d[p++] = w.charCodeAt(i); if (p < n) d[p++] = 32; } this.table = new Int32Array(1 << 14); },
    run() { const src = this.d, n = src.length, table = this.table; table.fill(-1); let out = 0, i = 0; while (i < n - 4) { const h = Math.imul(src[i] | (src[i+1] << 8) | (src[i+2] << 16) | (src[i+3] << 24), 2654435761) >>> 18; const c = table[h]; table[h] = i; if (c >= 0 && i - c < 65535 && src[c] === src[i] && src[c+1] === src[i+1] && src[c+2] === src[i+2]) { let l = 3; while (i + l < n && src[c + l] === src[i + l] && l < 258) l++; out += 3; i += l; } else { out++; i++; } } sink += out; return n; } },

  // Building and parsing JSON text: strings, objects and the garbage collector.
  json: {
    setup() { this.recs = Array.from({ length: 2000 }, (_, i) => ({ id: i, name: 'user-' + i, email: 'user' + i + '@example.test', tags: ['a' + (i % 7), 'b' + (i % 13)], score: rnd() * 1000, active: i % 3 === 0, nested: { x: i * 2, y: 'n' + i } })); },
    run() { const s = JSON.stringify(this.recs); const o = JSON.parse(s); sink += o.length; return s.length; } },

  // Big-integer modular exponentiation: the maths behind public-key encryption.
  bigint: {
    setup() { this.b = BigInt('0x' + 'c3a5c85c97cb3127b492b66fbe98f273'.repeat(4)); this.e = BigInt('0x' + '9ae16a3b2f90404fc3a5c85c97cb3127'.repeat(2)); this.m = BigInt('0x' + 'ffffffffffffffc5b492b66fbe98f273'.repeat(4)) | 1n; },
    run() { let r = 0n; for (let i = 0; i < 10; i++) r ^= modpow(this.b + BigInt(i), this.e, this.m); sink ^= Number(r & 0xffffn); return 10; } },
};

async function timed(t, ms) {
  if (t.setup && !t.ready) { t.setup(); t.ready = true; }
  await t.run();                                   // warm up the JIT
  let units = 0, el = 0; const t0 = performance.now();
  do { units += await t.run(); el = performance.now() - t0; } while (el < ms);
  return units / (el / 1000);
}

self.onmessage = async e => {
  const { id, test, ms } = e.data;
  try {
    const t = T[test]; if (!t) throw new Error('Unknown test ' + test);
    self.postMessage({ id, rate: await timed(t, ms) });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
