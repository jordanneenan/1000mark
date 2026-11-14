//! Storage tests on real files. Where the system allows it the files are opened
//! with the cache bypassed (O_DIRECT / F_NOCACHE / FILE_FLAG_NO_BUFFERING), so the
//! numbers are the drive's, not the RAM's. Every phase is time-limited so slow
//! drives (USB sticks, hard disks) do not hang the run.
use crate::cpu::Lcg;
use std::alloc::{alloc_zeroed, dealloc, Layout};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::Path;
use std::time::{Duration, Instant};

const MB: usize = 1 << 20;
/// Sequential tests move 64 MB per request. At 4 MB a request a fast NVMe drive is held back by the
/// gaps between requests (2.2 GB/s against 6.8 GB/s for a 990 PRO), so the old n_sto_seq_* tests
/// measured the request size more than the drive. Those ids stay for old runs.
const CH: usize = 64 * MB;

struct Aligned { ptr: *mut u8, len: usize, layout: Layout }
impl Aligned {
    fn new(len: usize) -> Self { let layout = Layout::from_size_align(len, 4096).unwrap(); let ptr = unsafe { alloc_zeroed(layout) }; assert!(!ptr.is_null()); Aligned { ptr, len, layout } }
    fn buf(&mut self) -> &mut [u8] { unsafe { std::slice::from_raw_parts_mut(self.ptr, self.len) } }
}
impl Drop for Aligned { fn drop(&mut self) { unsafe { dealloc(self.ptr, self.layout) } } }

#[cfg(unix)]
fn write_at(f: &File, b: &[u8], o: u64) -> io::Result<()> { use std::os::unix::fs::FileExt; f.write_all_at(b, o) }
#[cfg(unix)]
fn read_at(f: &File, b: &mut [u8], o: u64) -> io::Result<()> { use std::os::unix::fs::FileExt; f.read_exact_at(b, o) }
#[cfg(windows)]
fn write_at(f: &File, b: &[u8], o: u64) -> io::Result<()> { use std::os::windows::fs::FileExt; let mut d = 0; while d < b.len() { d += f.seek_write(&b[d..], o + d as u64)?; } Ok(()) }
#[cfg(windows)]
fn read_at(f: &File, b: &mut [u8], o: u64) -> io::Result<()> { use std::os::windows::fs::FileExt; let mut d = 0; while d < b.len() { let n = f.seek_read(&mut b[d..], o + d as u64)?; if n == 0 { return Err(io::ErrorKind::UnexpectedEof.into()); } d += n; } Ok(()) }

/// Open for read+write with the OS cache bypassed if possible. Returns (file, bypassed).
fn open_direct(path: &Path, create: bool) -> io::Result<(File, bool)> {
    let mut o = OpenOptions::new(); o.read(true).write(true).create(create);
    #[cfg(any(target_os = "linux", target_os = "android"))]
    { use std::os::unix::fs::OpenOptionsExt; let mut d = o.clone(); d.custom_flags(libc::O_DIRECT); if let Ok(f) = d.open(path) { return Ok((f, true)); } }
    #[cfg(windows)]
    { use std::os::windows::fs::OpenOptionsExt; let mut d = o.clone(); d.custom_flags(0x2000_0000 | 0x8000_0000); if let Ok(f) = d.open(path) { return Ok((f, true)); } }
    let f = o.open(path)?;
    #[cfg(target_os = "macos")]
    { use std::os::unix::io::AsRawFd; if unsafe { libc::fcntl(f.as_raw_fd(), libc::F_NOCACHE, 1) } == 0 { return Ok((f, true)); } }
    Ok((f, false))
}

pub struct Outcome { pub file_bytes: u64, pub direct: bool }

pub fn run(dir: &Path, quick: bool, mut put: impl FnMut(&str, f64), mut say: impl FnMut(&str)) -> io::Result<Outcome> {
    let tmp = dir.join(".pressmark-tmp");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp)?;
    let res = (|| -> io::Result<Outcome> {
        let path = tmp.join("seq.bin");
        let (f, direct) = open_direct(&path, true)?;
        let mut rng = Lcg(4242);
        let mut chunk = Aligned::new(CH);
        for b in chunk.buf().chunks_exact_mut(4) { b.copy_from_slice(&rng.next().to_le_bytes()); }   // incompressible
        let target = if quick { 256 * MB } else { 2048 * MB } as u64;
        let limit = Duration::from_secs(if quick { 4 } else { 10 });

        say("Storage · sequential write");
        let t0 = Instant::now(); let mut written = 0u64;
        while written < target && t0.elapsed() < limit { write_at(&f, chunk.buf(), written)?; written += CH as u64; }
        f.sync_all()?;
        put("n_sto_big_write", written as f64 / MB as f64 / t0.elapsed().as_secs_f64());

        say("Storage · sequential read");
        let mut best = 0f64;
        for _ in 0..3 {                                   // read speed wobbles from run to run, so take the best of three passes
            let t0 = Instant::now(); let mut read = 0u64;
            while read < written && t0.elapsed() < limit { read_at(&f, chunk.buf(), read)?; read += CH as u64; }
            best = best.max(read as f64 / MB as f64 / t0.elapsed().as_secs_f64());
        }
        put("n_sto_big_read", best);

        let blocks = written / 4096;
        let span = Duration::from_millis(if quick { 1000 } else { 2500 });
        let mut small = Aligned::new(4096);
        for b in small.buf().chunks_exact_mut(4) { b.copy_from_slice(&rng.next().to_le_bytes()); }

        say("Storage · random 4K write");
        let t0 = Instant::now(); let mut n = 0u64;
        while t0.elapsed() < span { write_at(&f, small.buf(), (rng.unit() * blocks as f64) as u64 * 4096)?; n += 1; if !direct && n % 64 == 0 { f.sync_data()?; } }
        f.sync_data()?;
        put("n_sto_rand_write", n as f64 / t0.elapsed().as_secs_f64());

        say("Storage · random 4K read");
        let t0 = Instant::now(); let mut n = 0u64;
        while t0.elapsed() < span { read_at(&f, small.buf(), (rng.unit() * blocks as f64) as u64 * 4096)?; n += 1; }
        put("n_sto_rand_read", n as f64 / t0.elapsed().as_secs_f64());
        drop(f);

        say("Storage · small files");
        let t0 = Instant::now(); let mut made = 0usize;
        let data = vec![7u8; 4096];
        while made < 5000 && t0.elapsed() < span { fs::write(tmp.join(format!("f{made}")), &data)?; made += 1; }
        for i in 0..made { fs::remove_file(tmp.join(format!("f{i}")))?; }
        put("n_sto_files", made as f64 / t0.elapsed().as_secs_f64());
        Ok(Outcome { file_bytes: written, direct })
    })();
    let _ = fs::remove_dir_all(&tmp);
    res
}
