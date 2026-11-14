//! CPU tests. `make(name)` returns a closure that does one fixed chunk of work and
//! returns how many units of work that was. The same closures run on one thread for
//! the one-core score and on every thread at once for the all-core score.
use std::hint::black_box;
use std::sync::{Arc, Barrier};
use std::time::Instant;

pub const TESTS: &[&str] = &["int", "float", "matrix", "simd", "sort", "sha", "crypto", "compress"];
pub type Work = Box<dyn FnMut() -> u64 + Send>;

pub struct Lcg(pub u32);
impl Lcg {
    pub fn next(&mut self) -> u32 { self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223); self.0 }
    pub fn unit(&mut self) -> f64 { self.next() as f64 / 4294967296.0 }
}

/// Run `f` once to warm up, then repeat it for `ms` and return units per second.
pub fn timed(ms: u64, f: &mut dyn FnMut() -> u64) -> f64 {
    f();
    let t0 = Instant::now();
    let mut units = 0u64;
    loop {
        units += f();
        let el = t0.elapsed();
        if el.as_millis() as u64 >= ms { return units as f64 / el.as_secs_f64(); }
    }
}

const K: [u32; 64] = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];

/// SHA-256 compression in plain code (no CPU crypto instructions).
fn sha256_plain(data: &[u8]) -> u32 {
    let mut h: [u32; 8] = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    let mut w = [0u32; 64];
    for block in data.chunks_exact(64) {
        for i in 0..16 { w[i] = u32::from_be_bytes([block[i*4], block[i*4+1], block[i*4+2], block[i*4+3]]); }
        for i in 16..64 {
            let s0 = w[i-15].rotate_right(7) ^ w[i-15].rotate_right(18) ^ (w[i-15] >> 3);
            let s1 = w[i-2].rotate_right(17) ^ w[i-2].rotate_right(19) ^ (w[i-2] >> 10);
            w[i] = w[i-16].wrapping_add(s0).wrapping_add(w[i-7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let t1 = hh.wrapping_add(s1).wrapping_add((e & f) ^ (!e & g)).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let t2 = s0.wrapping_add((a & b) ^ (a & c) ^ (b & c));
            hh = g; g = f; f = e; e = d.wrapping_add(t1); d = c; c = b; b = a; a = t1.wrapping_add(t2);
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) { *x = x.wrapping_add(y); }
    }
    h[0] ^ h[7]
}

pub fn make(test: &str) -> Work {
    let mut rng = Lcg(12345);
    match test {
        // Shifts, xors and multiplies.
        "int" => Box::new(|| {
            let (mut h, mut x) = (0x9e3779b9u32, black_box(88172645u32));
            for _ in 0..20_000_000u32 { x ^= x << 13; x ^= x >> 17; x ^= x << 5; h = (h ^ x).wrapping_mul(0x85ebca6b); h ^= h >> 13; }
            black_box(h); 20_000_000
        }),
        // Mandelbrot set in f64.
        "float" => Box::new(|| {
            let n = black_box(384usize); let mut total = 0u64;
            for py in 0..n { for px in 0..n {
                let (x0, y0) = (px as f64 / n as f64 * 3.5 - 2.5, py as f64 / n as f64 * 2.0 - 1.0);
                let (mut x, mut y, mut i) = (0.0f64, 0.0f64, 0u32);
                while i < 256 && x * x + y * y <= 4.0 { let t = x * x - y * y + x0; y = 2.0 * x * y + y0; x = t; i += 1; }
                total += i as u64;
            } }
            black_box(total)
        }),
        // Dense f64 matrix multiply (the compiler may use SIMD).
        "matrix" => {
            let n = 256usize;
            let a: Vec<f64> = (0..n * n).map(|_| rng.unit()).collect();
            let b: Vec<f64> = (0..n * n).map(|_| rng.unit()).collect();
            let mut c = vec![0f64; n * n];
            Box::new(move || {
                c.fill(0.0);
                for i in 0..n { for k in 0..n {
                    let aik = a[i * n + k]; let (row, brow) = (&mut c[i * n..(i + 1) * n], &b[k * n..(k + 1) * n]);
                    for j in 0..n { row[j] += aik * brow[j]; }
                } }
                black_box(c[n]); (2 * n * n * n) as u64
            })
        }
        // Vector maths on arrays that fit in cache: what SIMD units (SSE/AVX/NEON) are for.
        "simd" => {
            let len = 16384usize;
            let x: Vec<f32> = (0..len).map(|_| rng.unit() as f32).collect();
            let mut y: Vec<f32> = (0..len).map(|_| rng.unit() as f32).collect();
            Box::new(move || {
                let mut acc = 0f32;
                for r in 0..2000u32 {
                    let a = 1.0 + (r & 7) as f32 * 1e-4;
                    for i in 0..len { y[i] = (a * x[i] + y[i]) * 0.5; }
                    acc += y.iter().zip(&x).map(|(p, q)| p * q).sum::<f32>();
                }
                black_box(acc); (len * 2000 * 5) as u64
            })
        }
        // Sorting a million random numbers.
        "sort" => {
            let mut v = vec![0f64; 1_000_000];
            Box::new(move || { for e in v.iter_mut() { *e = rng.unit(); } v.sort_unstable_by(|p, q| p.total_cmp(q)); black_box(v[1000]); v.len() as u64 })
        }
        // SHA-256 in plain code.
        "sha" => {
            let d: Vec<u8> = (0..1 << 20).map(|_| rng.next() as u8).collect();
            Box::new(move || { black_box(sha256_plain(black_box(&d))); d.len() as u64 })
        }
        // SHA-256 using the CPU's crypto instructions when it has them.
        "crypto" => {
            use sha2::{Digest, Sha256};
            let d: Vec<u8> = (0..8 << 20).map(|i| (i >> 12) as u8).collect();
            Box::new(move || { black_box(Sha256::digest(black_box(&d))); d.len() as u64 })
        }
        // LZ-style compression of text.
        "compress" => {
            let words: Vec<&[u8]> = "the quick brown fox jumps over a lazy dog while seven wizards quietly box packed jugs of liquid data stream buffer cache block index".split(' ').map(|w| w.as_bytes()).collect();
            let n = 1usize << 20; let mut src = Vec::with_capacity(n + 64);
            while src.len() < n { src.extend_from_slice(words[(rng.unit() * words.len() as f64) as usize]); src.push(b' '); }
            src.truncate(n);
            let mut table = vec![-1i32; 1 << 14];
            Box::new(move || {
                table.fill(-1); let (mut out, mut i) = (0u64, 0usize);
                while i < n - 4 {
                    let v = u32::from_le_bytes([src[i], src[i + 1], src[i + 2], src[i + 3]]);
                    let h = (v.wrapping_mul(2654435761) >> 18) as usize; let c = table[h]; table[h] = i as i32;
                    if c >= 0 && i - (c as usize) < 65535 && src[c as usize..c as usize + 3] == src[i..i + 3] {
                        let c = c as usize; let mut l = 3; while i + l < n && src[c + l] == src[i + l] && l < 258 { l += 1; }
                        out += 3; i += l;
                    } else { out += 1; i += 1; }
                }
                black_box(out); n as u64
            })
        }
        _ => Box::new(|| 0),
    }
}

/// One thread.
pub fn single(test: &str, ms: u64) -> f64 { let mut w = make(test); timed(ms, &mut *w) }

/// Every logical thread at once; returns the summed rate.
pub fn multi(test: &'static str, ms: u64, threads: usize) -> f64 {
    let gate = Arc::new(Barrier::new(threads));
    let hs: Vec<_> = (0..threads).map(|_| { let g = gate.clone(); std::thread::spawn(move || { let mut w = make(test); w(); g.wait(); timed(ms, &mut *w) }) }).collect();
    hs.into_iter().map(|h| h.join().unwrap_or(0.0)).sum()
}
