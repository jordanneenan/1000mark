//! Memory tests on blocks far bigger than the CPU caches.
use crate::cpu::Lcg;

/// Memory speed is easily disturbed by whatever else is running, so take the better of two goes.
fn timed(ms: u64, f: &mut dyn FnMut() -> u64) -> f64 { crate::cpu::timed(ms, f).max(crate::cpu::timed(ms, f)) }
use std::hint::black_box;
use std::sync::{Arc, Barrier};

pub const BLOCK: usize = 256 << 20;

pub fn run(ms: u64, threads: usize, ram: u64, mut put: impl FnMut(&str, f64)) {
    let mut src = vec![1u8; BLOCK];
    let mut dst = vec![0u8; BLOCK];
    let mut v = 0u8;
    put("n_mem_write", timed(ms, &mut || { v = v.wrapping_add(1); src.fill(v); black_box(src[77]); BLOCK as u64 }));
    put("n_mem_read", timed(ms, &mut || {
        let s: u64 = black_box(&src).chunks_exact(8).fold(0u64, |a, c| a.wrapping_add(u64::from_ne_bytes(c.try_into().unwrap())));
        black_box(s); BLOCK as u64 }));
    put("n_mem_copy", timed(ms, &mut || { dst.copy_from_slice(black_box(&src)); black_box(dst[99]); BLOCK as u64 }));
    drop(dst); drop(src);

    // Random pointer chase through 128 MB: one cache miss per hop, so this is latency.
    let n = 32usize << 20; let mut rng = Lcg(99991);
    let mut perm: Vec<u32> = (0..n as u32).collect();
    for i in (1..n).rev() { let j = (rng.unit() * i as f64) as usize; perm.swap(i, j); }
    let mut p = 0u32;
    put("n_mem_random", timed(ms, &mut || { for _ in 0..5_000_000 { p = perm[p as usize]; } black_box(p); 5_000_000 }));
    drop(perm);

    put("n_mem_alloc", timed(ms, &mut || {
        let mut keep: Vec<Box<[u64; 8]>> = Vec::new();
        for i in 0..1_000_000u64 { keep.push(Box::new([i; 8])); if keep.len() > 1000 { keep.clear(); } }
        black_box(keep.len()); 1_000_000 }));

    // Every thread copying its own block: total bandwidth of all memory channels.
    let gate = Arc::new(Barrier::new(threads));
    // Keep the total under an eighth of RAM so small machines are not pushed into swap.
    let per = ((ram / 16 / threads.max(1) as u64) as usize).clamp(8 << 20, 64 << 20);
    let hs: Vec<_> = (0..threads).map(|_| { let g = gate.clone(); std::thread::spawn(move || {
        let a = vec![1u8; per]; let mut b = vec![0u8; per]; g.wait();
        timed(ms, &mut || { b.copy_from_slice(black_box(&a)); black_box(b[5]); per as u64 }) }) }).collect();
    put("n_mem_mt_copy", hs.into_iter().map(|h| h.join().unwrap_or(0.0)).sum());
}
