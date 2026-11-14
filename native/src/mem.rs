//! Memory tests on blocks far bigger than the CPU caches. The workloads are in the `kernels` crate.
use crate::cpu::{multi_with, timed3};

pub const BLOCK: usize = 256 << 20;

pub fn run(ms: u64, threads: usize, ram: u64, mut put: impl FnMut(&str, f64)) {
    // Small machines get a smaller block so the test does not push them into swap.
    let block = if ram < (3u64 << 30) { 64 << 20 } else { BLOCK };
    for t in kernels::MEM { let mut w = kernels::make(t, block).unwrap(); put(&format!("m_{t}"), timed3(ms, &mut *w)); }
    // Every thread copying its own block: the total the memory channels can carry.
    // The total stays under an eighth of RAM.
    let per = ((ram / 16 / threads.max(1) as u64) as usize).clamp(8 << 20, 64 << 20);
    put("m_copy_all", multi_with(move || kernels::make("copy", per).unwrap(), ms, threads));
}
