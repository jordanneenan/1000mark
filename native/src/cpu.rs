//! CPU tests. The workloads live in the `kernels` crate (shared with the browser test, which runs
//! them as WebAssembly). Each runs on one thread, on six, and on every thread at once. Every test is
//! timed three times and the middle result kept, so one hiccup from another program cannot move it.
use std::hint::black_box;
use std::sync::{Arc, Barrier};
use std::time::Instant;
pub use kernels::{Lcg, Work};

/// The shared workloads plus hardware crypto, which the browser gets from its own built-in crypto.
pub const TESTS: &[&str] = &["zip", "json", "script", "path", "db", "image", "ray", "physics", "matrix", "sort", "crypto"];
pub const REPS: usize = 3;

pub fn make(test: &str) -> Work {
    if test == "crypto" {
        // SHA-256 through the CPU's crypto instructions when it has them.
        use sha2::{Digest, Sha256};
        let d: Vec<u8> = (0..4 << 20).map(|i| (i >> 12) as u8).collect();
        return Box::new(move || { black_box(Sha256::digest(black_box(&d))); d.len() as u64 });
    }
    kernels::make(test, 0).unwrap_or_else(|| Box::new(|| 0))
}

/// Repeat `f` for `ms` and return units per second.
pub fn timed(ms: u64, f: &mut dyn FnMut() -> u64) -> f64 {
    let t0 = Instant::now();
    let mut units = 0u64;
    loop {
        units += f();
        let el = t0.elapsed();
        if el.as_millis() as u64 >= ms { return units as f64 / el.as_secs_f64(); }
    }
}
pub fn median(mut v: Vec<f64>) -> f64 { v.sort_by(|a, b| a.total_cmp(b)); v[v.len() / 2] }
/// Warm up once, then the middle of three timings.
pub fn timed3(ms: u64, f: &mut dyn FnMut() -> u64) -> f64 { f(); median((0..REPS).map(|_| timed(ms, f)).collect()) }

/// One thread (a thread of its own, so it runs under the same conditions as the other tiers).
pub fn single(test: &'static str, ms: u64) -> f64 { multi(test, ms, 1) }

/// `threads` threads at once; returns the summed rate (middle of three rounds, each started together).
pub fn multi(test: &'static str, ms: u64, threads: usize) -> f64 { multi_with(move || make(test), ms, threads) }
pub fn multi_with(mk: impl Fn() -> Work + Send + Sync + 'static, ms: u64, threads: usize) -> f64 {
    let gate = Arc::new(Barrier::new(threads)); let mk = Arc::new(mk);
    let hs: Vec<_> = (0..threads).map(|_| { let (g, mk) = (gate.clone(), mk.clone()); std::thread::spawn(move || {
        let mut w = mk(); w();
        (0..REPS).map(|_| { g.wait(); timed(ms, &mut *w) }).collect::<Vec<f64>>() }) }).collect();
    let per: Vec<Vec<f64>> = hs.into_iter().map(|h| h.join().unwrap_or_else(|_| vec![0.0; REPS])).collect();
    median((0..REPS).map(|r| per.iter().map(|t| t[r]).sum()).collect())
}
