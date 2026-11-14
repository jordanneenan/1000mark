//! 1000Mark's CPU and memory workloads. `make(name, bytes)` returns a closure that does one fixed
//! chunk of work and returns how many units of work that was. The computer test links this crate;
//! the browser test runs the very same code compiled to WebAssembly (tests/kernels.wasm), so the two
//! measure the same thing. Each workload is the kind of work real programs do, not a tight toy loop:
//! a toy loop mostly measures clock speed and undersells chips that do more per tick.
//!
//! THE WORKLOADS ARE FROZEN with suite 1. Changing what one does changes what its score means.
use std::collections::{BTreeMap, BinaryHeap, HashMap};
use std::hint::black_box;

pub type Work = Box<dyn FnMut() -> u64 + Send>;
/// CPU workloads, in the order the browser asks for them by number (CPU in tests/cpu.worker.js).
pub const CPU: &[&str] = &["zip", "json", "script", "path", "db", "image", "ray", "physics", "matrix", "sort"];
/// Memory workloads (MEM in tests/cpu.worker.js). `bytes` is the block size.
pub const MEM: &[&str] = &["fill", "read", "copy", "chase", "alloc"];

pub struct Lcg(pub u32);
impl Lcg {
    pub fn next(&mut self) -> u32 { self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223); self.0 }
    pub fn unit(&mut self) -> f64 { self.next() as f64 / 4294967296.0 }
    fn below(&mut self, n: usize) -> usize { (self.unit() * n as f64) as usize }
}

const WORDS: &str = "the of and to in is that it was for on are as with his they at be this from have or one had by word but not what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part over new sound take only little work know place year live me back give most very after thing our just name good sentence man think say great where help through much before line right too mean old any same tell boy follow came want show also around form three small set put end does another well large must big even such because turn here why ask went men read need land different home us move try kind hand picture again change off play spell air away animal house point page letter mother answer found study still learn should world high every near add food between own below country plant last school father keep tree never start city earth eye light thought head under story saw left few while along might close something seem next hard open example begin life always those both paper together got group often run important until children side feet car mile night walk white sea began grow took river four carry state once book hear stop without second later miss idea enough eat face watch far real almost let above girl sometimes mountain cut young talk soon list song being leave family";

/// English-like text: common words come up far more often than rare ones, as in real writing.
fn prose(rng: &mut Lcg, len: usize) -> Vec<u8> {
    let words: Vec<&[u8]> = WORDS.split(' ').map(|w| w.as_bytes()).collect();
    let mut out = Vec::with_capacity(len + 16); let mut in_sentence = 0;
    while out.len() < len {
        let r = rng.unit(); let w = words[(r * r * words.len() as f64) as usize];
        if in_sentence == 0 { out.push(w[0].to_ascii_uppercase()); out.extend_from_slice(&w[1..]); } else { out.extend_from_slice(w); }
        in_sentence += 1;
        if in_sentence > 6 && rng.below(8) == 0 { out.extend_from_slice(b". "); in_sentence = 0; } else if rng.below(12) == 0 { out.extend_from_slice(b", "); } else { out.push(b' '); }
    }
    out.truncate(len); out
}
fn word(rng: &mut Lcg) -> &'static str { let mut it = WORDS.split(' '); let r = rng.unit(); it.nth((r * r * 300.0) as usize).unwrap_or("the") }

// ---------- script: a small program run by a tree-walking interpreter, as scripting languages do ----------
enum E { Num(i64), Var(usize), Bin(u8, Box<E>, Box<E>), If(Box<E>, Box<E>, Box<E>), Call(usize, Vec<E>), Set(usize, Box<E>), While(Box<E>, Box<E>), Seq(Vec<E>), Get(Box<E>), Put(Box<E>, Box<E>) }
fn eval(funcs: &[E], heap: &mut [i64], steps: &mut u64, e: &E, loc: &mut [i64; 8]) -> i64 {
    *steps += 1;
    match e {
        E::Num(n) => *n,
        E::Var(i) => loc[*i],
        E::Bin(op, a, b) => { let (x, y) = (eval(funcs, heap, steps, a, loc), eval(funcs, heap, steps, b, loc));
            match op { b'+' => x.wrapping_add(y), b'-' => x.wrapping_sub(y), b'*' => x.wrapping_mul(y), b'/' => if y == 0 { 0 } else { x / y }, b'%' => if y == 0 { 0 } else { x % y }, b'<' => (x < y) as i64, b'=' => (x == y) as i64, _ => x ^ y } }
        E::If(c, a, b) => if eval(funcs, heap, steps, c, loc) != 0 { eval(funcs, heap, steps, a, loc) } else { eval(funcs, heap, steps, b, loc) },
        E::Call(f, args) => { let mut l = [0i64; 8]; for (i, a) in args.iter().enumerate() { l[i] = eval(funcs, heap, steps, a, loc); } eval(funcs, heap, steps, &funcs[*f], &mut l) }
        E::Set(i, v) => { let x = eval(funcs, heap, steps, v, loc); loc[*i] = x; x }
        E::While(c, body) => { let mut last = 0; while eval(funcs, heap, steps, c, loc) != 0 { last = eval(funcs, heap, steps, body, loc); } last }
        E::Seq(v) => { let mut last = 0; for x in v { last = eval(funcs, heap, steps, x, loc); } last }
        E::Get(i) => { let i = eval(funcs, heap, steps, i, loc) as usize; heap[i % heap.len()] }
        E::Put(i, v) => { let (i, x) = (eval(funcs, heap, steps, i, loc) as usize, eval(funcs, heap, steps, v, loc)); let n = heap.len(); heap[i % n] = x; x }
    }
}
fn program() -> Vec<E> {
    use E::*;
    let b = |e: E| Box::new(e); let bin = |op: u8, a: E, c: E| Bin(op, Box::new(a), Box::new(c));
    // 0: fib(n) = n < 2 ? n : fib(n-1) + fib(n-2)
    let fib = If(b(bin(b'<', Var(0), Num(2))), b(Var(0)), b(bin(b'+', Call(0, vec![bin(b'-', Var(0), Num(1))]), Call(0, vec![bin(b'-', Var(0), Num(2))]))));
    // 1: sieve(n): count the primes below n, crossing multiples off in the heap
    let sieve = Seq(vec![
        Set(1, b(Num(0))), While(b(bin(b'<', Var(1), Var(0))), b(Seq(vec![Put(b(Var(1)), b(Num(0))), Set(1, b(bin(b'+', Var(1), Num(1))))]))),
        Set(1, b(Num(2))), Set(2, b(Num(0))),
        While(b(bin(b'<', Var(1), Var(0))), b(Seq(vec![
            If(b(bin(b'=', Get(b(Var(1))), Num(0))), b(Seq(vec![
                Set(2, b(bin(b'+', Var(2), Num(1)))), Set(3, b(bin(b'+', Var(1), Var(1)))),
                While(b(bin(b'<', Var(3), Var(0))), b(Seq(vec![Put(b(Var(3)), b(Num(1))), Set(3, b(bin(b'+', Var(3), Var(1))))])))])), b(Num(0))),
            Set(1, b(bin(b'+', Var(1), Num(1))))]))),
        Var(2)]);
    // 2: collatz(n): the longest chain started below n
    let collatz = Seq(vec![
        Set(1, b(Num(1))), Set(4, b(Num(0))),
        While(b(bin(b'<', Var(1), Var(0))), b(Seq(vec![
            Set(2, b(Var(1))), Set(3, b(Num(0))),
            While(b(bin(b'<', Num(1), Var(2))), b(Seq(vec![
                Set(2, b(If(b(bin(b'=', bin(b'%', Var(2), Num(2)), Num(0))), b(bin(b'/', Var(2), Num(2))), b(bin(b'+', bin(b'*', Var(2), Num(3)), Num(1)))))),
                Set(3, b(bin(b'+', Var(3), Num(1))))]))),
            If(b(bin(b'<', Var(4), Var(3))), b(Set(4, b(Var(3)))), b(Num(0))),
            Set(1, b(bin(b'+', Var(1), Num(1))))]))),
        Var(4)]);
    // 3: main
    let main = bin(b'+', bin(b'+', Call(0, vec![Num(19)]), Call(1, vec![Num(12000)])), Call(2, vec![Num(1500)]));
    vec![fib, sieve, collatz, main]
}

// ---------- ray: a small ray tracer (spheres, a floor, shadows, one mirror bounce) ----------
#[derive(Clone, Copy)] struct V(f32, f32, f32);
impl V {
    fn add(self, o: V) -> V { V(self.0 + o.0, self.1 + o.1, self.2 + o.2) }
    fn sub(self, o: V) -> V { V(self.0 - o.0, self.1 - o.1, self.2 - o.2) }
    fn mul(self, k: f32) -> V { V(self.0 * k, self.1 * k, self.2 * k) }
    fn dot(self, o: V) -> f32 { self.0 * o.0 + self.1 * o.1 + self.2 * o.2 }
    fn norm(self) -> V { self.mul(1.0 / self.dot(self).sqrt()) }
}
struct Sphere { c: V, r: f32, col: V, mirror: f32 }
fn nearest(s: &[Sphere], o: V, d: V, rays: &mut u64) -> (f32, usize) {
    *rays += 1; let (mut best, mut hit) = (1e30f32, usize::MAX);
    for (i, sp) in s.iter().enumerate() {
        let oc = o.sub(sp.c); let b = oc.dot(d); let c = oc.dot(oc) - sp.r * sp.r; let disc = b * b - c;
        if disc > 0.0 { let t = -b - disc.sqrt(); if t > 1e-3 && t < best { best = t; hit = i; } }
    }
    if d.1 < -1e-6 { let t = -o.1 / d.1; if t > 1e-3 && t < best { best = t; hit = s.len(); } }
    (best, hit)
}
fn shade(s: &[Sphere], o: V, d: V, depth: u32, rays: &mut u64) -> V {
    let (t, hit) = nearest(s, o, d, rays);
    if hit == usize::MAX { return V(0.5, 0.7, 1.0).mul(0.5 + 0.5 * d.1.max(0.0)); }
    let p = o.add(d.mul(t)); let sun = V(0.42, 0.57, -0.71);
    let (n, col, mirror) = if hit == s.len() { let chk = ((p.0.floor() as i32 + p.2.floor() as i32) & 1) as f32; (V(0.0, 1.0, 0.0), V(0.3 + 0.5 * chk, 0.3 + 0.5 * chk, 0.3 + 0.4 * chk), 0.15) }
        else { (p.sub(s[hit].c).norm(), s[hit].col, s[hit].mirror) };
    let lit = if nearest(s, p, sun, rays).1 == usize::MAX { n.dot(sun).max(0.0) } else { 0.0 };
    let mut c = col.mul(0.15 + 0.85 * lit);
    if mirror > 0.0 && depth < 2 { let r = d.sub(n.mul(2.0 * d.dot(n))); c = c.mul(1.0 - mirror).add(shade(s, p, r, depth + 1, rays).mul(mirror)); }
    c
}

// ---------- matrix: dense double-precision multiply, with the wide vector units where the chip has them ----------
#[inline(always)]
fn mm(a: &[f64], b: &[f64], c: &mut [f64], n: usize) {
    c.fill(0.0);
    for i in 0..n { for k in 0..n {
        let aik = a[i * n + k]; let (row, brow) = (&mut c[i * n..(i + 1) * n], &b[k * n..(k + 1) * n]);
        for j in 0..n { row[j] += aik * brow[j]; }
    } }
}
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,fma")]
unsafe fn mm_avx2(a: &[f64], b: &[f64], c: &mut [f64], n: usize) { mm(a, b, c, n) }
fn matmul(a: &[f64], b: &[f64], c: &mut [f64], n: usize) {
    #[cfg(target_arch = "x86_64")]
    if std::is_x86_feature_detected!("avx2") && std::is_x86_feature_detected!("fma") { return unsafe { mm_avx2(a, b, c, n) }; }
    mm(a, b, c, n)
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)] struct Open(std::cmp::Reverse<u32>, u32);

pub fn make(test: &str, bytes: usize) -> Option<Work> {
    let mut rng = Lcg(12345);
    Some(match test {
        // Compressing and unpacking a mix of writing and tabular data with deflate (zip, gzip, PNG, the web).
        "zip" => {
            let mut data = prose(&mut rng, 192 << 10);
            for i in 0..16384u32 { data.extend_from_slice(&(i.wrapping_mul(37) % 1000 + rng.next() % 3).to_le_bytes()); }
            Box::new(move || {
                let z = miniz_oxide::deflate::compress_to_vec(black_box(&data), 6);
                let back = miniz_oxide::inflate::decompress_to_vec(&z).unwrap_or_default();
                black_box(back.len()); (data.len() * 2) as u64
            })
        }
        // Reading a JSON document into objects, working through it and writing it back out.
        "json" => {
            let mut s = String::from("{\"records\":[");
            for i in 0..600u32 {
                if i > 0 { s.push(','); }
                let name = format!("{} {}", word(&mut rng), word(&mut rng));
                s.push_str(&format!("{{\"id\":{i},\"name\":\"{name}\",\"email\":\"{}{i}@example.test\",\"tags\":[\"{}\",\"{}\",\"{}\"],\"score\":{:.4},\"active\":{},\"address\":{{\"street\":\"{} {} road\",\"city\":\"{}\",\"geo\":{{\"lat\":{:.6},\"lng\":{:.6}}}}},\"history\":[",
                    word(&mut rng), word(&mut rng), word(&mut rng), word(&mut rng), rng.unit() * 1000.0, i % 3 == 0, rng.below(999), word(&mut rng), word(&mut rng), rng.unit() * 180.0 - 90.0, rng.unit() * 360.0 - 180.0));
                for h in 0..4 { if h > 0 { s.push(','); } s.push_str(&format!("{{\"t\":{},\"v\":{:.3},\"note\":\"{} {}\"}}", 1700000000 + rng.next() % 9999999, rng.unit() * 50.0, word(&mut rng), word(&mut rng))); }
                s.push_str("]}");
            }
            s.push_str("],\"total\":600}");
            Box::new(move || {
                let v: serde_json::Value = serde_json::from_str(black_box(&s)).unwrap_or_default();
                let sum: f64 = v["records"].as_array().map(|a| a.iter().filter(|r| r["active"] == true).map(|r| r["score"].as_f64().unwrap_or(0.0) + r["history"][1]["v"].as_f64().unwrap_or(0.0)).sum()).unwrap_or(0.0);
                let out = serde_json::to_string(&v).unwrap_or_default();
                black_box((sum, out.len())); (s.len() * 2) as u64
            })
        }
        "script" => {
            let funcs = program(); let mut heap = vec![0i64; 16384];
            Box::new(move || { let mut steps = 0u64; let mut loc = [0i64; 8]; black_box(eval(&funcs, &mut heap, &mut steps, &funcs[3], &mut loc)); steps })
        }
        // Finding routes across a map with obstacles (A*), as games and navigation do.
        "path" => {
            const N: usize = 256;
            let mut wall = vec![false; N * N];
            for w in wall.iter_mut() { *w = rng.below(100) < 27; }
            let free = |rng: &mut Lcg| loop { let c = rng.below(N * N); if !wall[c] { return c as u32; } };
            let pairs: Vec<(u32, u32)> = (0..6).map(|_| (free(&mut rng), free(&mut rng))).collect();
            let mut g = vec![u32::MAX; N * N]; let mut stamp = vec![0u32; N * N]; let mut gen = 0u32;
            let mut open: BinaryHeap<Open> = BinaryHeap::new();
            Box::new(move || {
                let mut expanded = 0u64;
                for &(s, goal) in &pairs {
                    gen += 1; open.clear();
                    let h = |c: u32| ((c as usize % N).abs_diff(goal as usize % N) + (c as usize / N).abs_diff(goal as usize / N)) as u32;
                    g[s as usize] = 0; stamp[s as usize] = gen; open.push(Open(std::cmp::Reverse(h(s)), s));
                    while let Some(Open(std::cmp::Reverse(f), c)) = open.pop() {
                        let gc = g[c as usize]; if f > gc + h(c) { continue; }
                        expanded += 1; if c == goal { break; }
                        let (x, y) = (c as usize % N, c as usize / N);
                        for (dx, dy) in [(1i32, 0i32), (-1, 0), (0, 1), (0, -1)] {
                            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                            if nx < 0 || ny < 0 || nx >= N as i32 || ny >= N as i32 { continue; }
                            let nc = ny as usize * N + nx as usize; if wall[nc] { continue; }
                            if stamp[nc] != gen || gc + 1 < g[nc] { stamp[nc] = gen; g[nc] = gc + 1; open.push(Open(std::cmp::Reverse(gc + 1 + h(nc as u32)), nc as u32)); }
                        }
                    }
                }
                black_box(g[0]); expanded
            })
        }
        // An in-memory database: look-ups, replacements and range scans in a sorted index, plus look-ups by name.
        "db" => {
            #[derive(Clone)] struct Rec { a: u64, b: u32, name: [u8; 24] }
            let rec = |k: u64| Rec { a: k ^ 0x9e3779b97f4a7c15, b: k as u32, name: [k as u8; 24] };
            let mut keys: Vec<u64> = (0..200_000).map(|_| ((rng.next() as u64) << 32) | rng.next() as u64).collect();
            let mut map: BTreeMap<u64, Rec> = keys.iter().map(|&k| (k, rec(k))).collect();
            let names: Vec<String> = (0..50_000).map(|i| format!("user-{:06}-{}", i, word(&mut rng))).collect();
            let index: HashMap<String, u32> = names.iter().enumerate().map(|(i, n)| (n.clone(), i as u32)).collect();
            Box::new(move || {
                let mut acc = 0u64;
                for _ in 0..50_000 {
                    let j = rng.below(keys.len());
                    match rng.next() % 20 {
                        0..=10 => { if let Some(r) = map.get(&keys[j]) { acc = acc.wrapping_add(r.a ^ r.name[3] as u64); } }
                        11..=14 => { map.remove(&keys[j]); let k = ((rng.next() as u64) << 32) | rng.next() as u64; keys[j] = k; map.insert(k, rec(k)); }
                        15 | 16 => { for (_, r) in map.range(keys[j]..).take(16) { acc = acc.wrapping_add(r.b as u64); } }
                        _ => { acc = acc.wrapping_add(*index.get(&names[rng.below(names.len())]).unwrap_or(&0) as u64); }
                    }
                }
                black_box(acc); 50_000
            })
        }
        // Photo editing: blur, shrink to half size, then stretch the contrast from a histogram.
        "image" => {
            const W: usize = 1024; const H: usize = 768;
            let mut src = vec![0u8; W * H * 4];
            for y in 0..H { for x in 0..W { let i = (y * W + x) * 4; let n = (rng.next() >> 27) as usize;
                src[i] = ((x * 255 / W) + n).min(255) as u8; src[i + 1] = ((y * 255 / H) + n).min(255) as u8; src[i + 2] = (((x ^ y) & 255) / 2 + n) as u8; src[i + 3] = 255; } }
            let (mut tmp, mut blur, mut half) = (vec![0u8; W * H * 4], vec![0u8; W * H * 4], vec![0u8; W * H]);
            Box::new(move || {
                for y in 0..H { let row = &src[y * W * 4..(y + 1) * W * 4]; let out = &mut tmp[y * W * 4..(y + 1) * W * 4];
                    for x in 0..W { let (a, b, c, d, e) = (x.saturating_sub(2) * 4, x.saturating_sub(1) * 4, x * 4, (x + 1).min(W - 1) * 4, (x + 2).min(W - 1) * 4);
                        for ch in 0..4 { out[c + ch] = ((row[a + ch] as u32 + 4 * row[b + ch] as u32 + 6 * row[c + ch] as u32 + 4 * row[d + ch] as u32 + row[e + ch] as u32 + 8) >> 4) as u8; } } }
                for y in 0..H { let (a, b, d, e) = (y.saturating_sub(2) * W * 4, y.saturating_sub(1) * W * 4, (y + 1).min(H - 1) * W * 4, (y + 2).min(H - 1) * W * 4); let c = y * W * 4;
                    for i in 0..W * 4 { blur[c + i] = ((tmp[a + i] as u32 + 4 * tmp[b + i] as u32 + 6 * tmp[c + i] as u32 + 4 * tmp[d + i] as u32 + tmp[e + i] as u32 + 8) >> 4) as u8; } }
                let mut hist = [0u32; 256];
                for y in 0..H / 2 { for x in 0..W / 2 {
                    let mut l = 0u32;
                    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] { let i = ((y * 2 + dy) * W + x * 2 + dx) * 4; l += 77 * blur[i] as u32 + 150 * blur[i + 1] as u32 + 29 * blur[i + 2] as u32; }
                    let v = (l >> 10) as u8; half[y * (W / 2) + x] = v; hist[v as usize] += 1;
                } }
                let total = (W / 2 * H / 2) as u32; let (mut lo, mut hi, mut run) = (0usize, 255usize, 0u32);
                for (i, &c) in hist.iter().enumerate() { run += c; if run < total / 100 { lo = i; } if run < total - total / 100 { hi = i; } }
                let span = (hi.max(lo + 1) - lo) as u32; let mut lut = [0u8; 256];
                for (i, l) in lut.iter_mut().enumerate() { *l = ((i.saturating_sub(lo) as u32 * 255) / span).min(255) as u8; }
                for p in half.iter_mut() { *p = lut[*p as usize]; }
                black_box(half[777]); (W * H) as u64
            })
        }
        "ray" => {
            let spheres: Vec<Sphere> = (0..24).map(|i| { let (gx, gz) = ((i % 6) as f32, (i / 6) as f32); let r = 0.35 + 0.25 * rng.unit() as f32;
                Sphere { c: V(gx * 1.6 - 4.0 + rng.unit() as f32 * 0.4, r + rng.unit() as f32 * 0.5, gz * 1.7 + 3.0), r, col: V(0.3 + 0.7 * rng.unit() as f32, 0.3 + 0.7 * rng.unit() as f32, 0.3 + 0.7 * rng.unit() as f32), mirror: if i % 3 == 0 { 0.6 } else { 0.0 } } }).collect();
            const W: usize = 192; const H: usize = 144;
            let mut img = vec![0u8; W * H * 3];
            Box::new(move || {
                let mut rays = 0u64; let cam = V(0.0, 2.2, -3.5);
                for y in 0..H { for x in 0..W {
                    let d = V((x as f32 + 0.5) / W as f32 * 2.0 - 1.0, (1.0 - (y as f32 + 0.5) / H as f32 * 2.0) * 0.75 - 0.35, 1.6).norm();
                    let c = shade(&spheres, cam, d, 0, &mut rays); let i = (y * W + x) * 3;
                    img[i] = (c.0.min(1.0) * 255.0) as u8; img[i + 1] = (c.1.min(1.0) * 255.0) as u8; img[i + 2] = (c.2.min(1.0) * 255.0) as u8;
                } }
                black_box(img[999]); rays
            })
        }
        // Game physics: thousands of balls falling, bouncing off walls and off each other (grid broad phase).
        "physics" => {
            const N: usize = 3000; const R: f32 = 0.006; const G: usize = 83;      // cell = 2R
            let start: Vec<[f32; 4]> = (0..N).map(|_| [0.05 + 0.9 * rng.unit() as f32, 0.05 + 0.9 * rng.unit() as f32, (rng.unit() as f32 - 0.5) * 0.4, (rng.unit() as f32 - 0.5) * 0.4]).collect();
            let mut p = start.clone(); let mut head = vec![-1i32; G * G]; let mut next = vec![-1i32; N];
            Box::new(move || {
                p.copy_from_slice(&start); let dt = 1.0 / 240.0;
                for _ in 0..8 {
                    for q in p.iter_mut() { q[3] -= 2.0 * dt; q[0] += q[2] * dt; q[1] += q[3] * dt;
                        if q[0] < R { q[0] = R; q[2] = -q[2] * 0.8; } if q[0] > 1.0 - R { q[0] = 1.0 - R; q[2] = -q[2] * 0.8; }
                        if q[1] < R { q[1] = R; q[3] = -q[3] * 0.8; } if q[1] > 1.0 - R { q[1] = 1.0 - R; q[3] = -q[3] * 0.8; } }
                    head.fill(-1);
                    let cell = |v: f32| ((v * G as f32) as usize).min(G - 1);
                    for i in 0..N { let c = cell(p[i][1]) * G + cell(p[i][0]); next[i] = head[c]; head[c] = i as i32; }
                    for i in 0..N {
                        let (cx, cy) = (cell(p[i][0]), cell(p[i][1]));
                        for ny in cy.saturating_sub(1)..=(cy + 1).min(G - 1) { for nx in cx.saturating_sub(1)..=(cx + 1).min(G - 1) {
                            let mut j = head[ny * G + nx];
                            while j >= 0 { let ju = j as usize;
                                if ju > i { let (dx, dy) = (p[ju][0] - p[i][0], p[ju][1] - p[i][1]); let d2 = dx * dx + dy * dy;
                                    if d2 < 4.0 * R * R && d2 > 1e-12 { let d = d2.sqrt(); let (nx_, ny_) = (dx / d, dy / d); let push = (2.0 * R - d) * 0.5;
                                        p[i][0] -= nx_ * push; p[i][1] -= ny_ * push; p[ju][0] += nx_ * push; p[ju][1] += ny_ * push;
                                        let rel = (p[ju][2] - p[i][2]) * nx_ + (p[ju][3] - p[i][3]) * ny_;
                                        if rel < 0.0 { let k = rel * 0.9; p[i][2] += nx_ * k; p[i][3] += ny_ * k; p[ju][2] -= nx_ * k; p[ju][3] -= ny_ * k; } } }
                                j = next[ju]; }
                        } }
                    }
                }
                black_box(p[7][0]); (N * 8) as u64
            })
        }
        "matrix" => {
            let n = 256usize;
            let a: Vec<f64> = (0..n * n).map(|_| rng.unit()).collect(); let b: Vec<f64> = (0..n * n).map(|_| rng.unit()).collect(); let mut c = vec![0f64; n * n];
            Box::new(move || { matmul(black_box(&a), &b, &mut c, n); black_box(c[n]); (2 * n * n * n) as u64 })
        }
        // Sorting 200,000 numbers and 20,000 names.
        "sort" => {
            let mut nums = vec![0u64; 200_000];
            let names: Vec<String> = (0..20_000).map(|_| format!("{}-{}-{}", word(&mut rng), word(&mut rng), rng.below(9999))).collect();
            Box::new(move || {
                for e in nums.iter_mut() { *e = ((rng.next() as u64) << 32) | rng.next() as u64; }
                nums.sort_unstable();
                let mut s = names.clone(); s.sort();
                black_box((nums[1000], s[500].len())); 220_000
            })
        }

        // ---------- memory, on a block far bigger than the processor's caches ----------
        "fill" => { let mut buf = vec![1u8; bytes]; let mut v = 0u8; Box::new(move || { v = v.wrapping_add(1); buf.fill(v); black_box(buf[77]); bytes as u64 }) }
        "read" => { let buf = vec![1u8; bytes]; Box::new(move || {
            let s: u64 = black_box(&buf).chunks_exact(8).fold(0u64, |a, c| a.wrapping_add(u64::from_ne_bytes(c.try_into().unwrap()))); black_box(s); bytes as u64 }) }
        "copy" => { let src = vec![1u8; bytes]; let mut dst = vec![0u8; bytes]; Box::new(move || { dst.copy_from_slice(black_box(&src)); black_box(dst[99]); bytes as u64 }) }
        // Chasing pointers through half the block: one cache miss per hop, so this is latency.
        "chase" => {
            let n = (bytes / 8).max(1024); let mut rng = Lcg(99991);
            let mut perm: Vec<u32> = (0..n as u32).collect();
            for i in (1..n).rev() { let j = rng.below(i); perm.swap(i, j); }
            let mut p = 0u32;
            Box::new(move || { for _ in 0..2_000_000 { p = perm[p as usize]; } black_box(p); 2_000_000 })
        }
        "alloc" => Box::new(|| {
            let mut keep: Vec<Box<[u64; 8]>> = Vec::new();
            for i in 0..1_000_000u64 { keep.push(Box::new([i; 8])); if keep.len() > 1000 { keep.clear(); } }
            black_box(keep.len()); 1_000_000 }),
        _ => return None,
    })
}

// ---------- WebAssembly: the browser picks a workload by number, then calls k_run() in a timed loop ----------
#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::sync::Mutex;
    static CUR: Mutex<Option<super::Work>> = Mutex::new(None);
    /// kind 0 = CPU, 1 = memory. Returns 1 when the workload is ready.
    #[no_mangle]
    pub extern "C" fn k_setup(kind: u32, index: u32, bytes: u32) -> u32 {
        let mut cur = CUR.lock().unwrap(); *cur = None;
        let name = if kind == 0 { super::CPU.get(index as usize) } else { super::MEM.get(index as usize) };
        *cur = name.and_then(|n| super::make(n, bytes as usize));
        cur.is_some() as u32
    }
    #[no_mangle]
    pub extern "C" fn k_run() -> f64 { CUR.lock().unwrap().as_mut().map(|w| w() as f64).unwrap_or(0.0) }
    #[no_mangle]
    pub extern "C" fn k_free() { *CUR.lock().unwrap() = None; }
}

#[cfg(test)]
mod tests {
    /// Every workload runs, does work, and does the same amount of work each time (the browser and
    /// the computer test must be doing identical work for their scores to mean the same thing).
    #[test]
    fn all_run() {
        for t in super::CPU.iter().chain(super::MEM) {
            let mut w = super::make(t, 8 << 20).unwrap();
            let (a, b) = (w(), w());
            println!("{t}: {a} units");
            assert!(a > 0, "{t} did no work");
            if !["script", "path", "ray"].contains(t) || true { assert_eq!(a, b, "{t} is not repeatable"); }
        }
    }
}
