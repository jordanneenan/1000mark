//! Storage tests on real files. Where the system allows it the files are opened
//! with the cache bypassed (O_DIRECT / F_NOCACHE / FILE_FLAG_NO_BUFFERING), so the
//! numbers are the drive's, not the RAM's. Every phase is time-limited so slow
//! drives (USB sticks, hard disks) do not hang the run.
use crate::cpu::Lcg;
use std::alloc::{alloc_zeroed, dealloc, Layout};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::Path;
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};
use crate::cpu::median;

const MB: usize = 1 << 20;
/// Sequential tests move 64 MB per request. At 4 MB a request a fast NVMe drive is held back by the
/// gaps between requests (2.2 GB/s against 6.8 GB/s for a 990 PRO), which measures the request size
/// more than the drive.
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

/// Random 4K requests from `threads` threads at once, each with its own file handle (a queue of 32
/// is where NVMe drives pull away from SATA ones). Returns requests per second in total.
fn rand_many(path: &Path, blocks: u64, write: bool, threads: usize, span: Duration) -> io::Result<f64> {
    let gate = Arc::new(Barrier::new(threads));
    let hs: Vec<_> = (0..threads).map(|i| { let (g, path) = (gate.clone(), path.to_path_buf()); std::thread::spawn(move || -> io::Result<f64> {
        let (f, direct) = open_direct(&path, false)?;
        let mut rng = Lcg(1000 + i as u32); let mut buf = Aligned::new(4096);
        for b in buf.buf().chunks_exact_mut(4) { b.copy_from_slice(&rng.next().to_le_bytes()); }
        g.wait();
        let t0 = Instant::now(); let mut n = 0u64;
        while t0.elapsed() < span {
            let o = (rng.unit() * blocks as f64) as u64 * 4096;
            if write { write_at(&f, buf.buf(), o)?; n += 1; if !direct && n % 64 == 0 { f.sync_data()?; } } else { read_at(&f, buf.buf(), o)?; n += 1; }
        }
        if write { f.sync_data()?; }
        Ok(n as f64 / t0.elapsed().as_secs_f64()) }) }).collect();
    let mut total = 0.0;
    for h in hs { total += h.join().map_err(|_| io::Error::other("a storage thread crashed"))??; }
    Ok(total)
}
fn thrice(mut f: impl FnMut() -> io::Result<f64>) -> io::Result<f64> { Ok(median(vec![f()?, f()?, f()?])) }

/// `free` is the free space on the drive: the test file is 4 GB, or a quarter of the free space if that is less.
pub fn run(dir: &Path, free: u64, mut put: impl FnMut(&str, f64), mut say: impl FnMut(&str)) -> io::Result<Outcome> {
    let tmp = dir.join(".1000mark-tmp");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp)?;
    let res = (|| -> io::Result<Outcome> {
        let path = tmp.join("seq.bin");
        let (f, direct) = open_direct(&path, true)?;
        let mut rng = Lcg(4242);
        let mut chunk = Aligned::new(CH);
        for b in chunk.buf().chunks_exact_mut(4) { b.copy_from_slice(&rng.next().to_le_bytes()); }   // incompressible
        // Three equal parts, each timed with its own flush to the drive; the middle one is the result.
        let part = (((free / 4).min(4096 * MB as u64) / 3) / CH as u64).max(1) * CH as u64;
        let limit = Duration::from_secs(7);

        say("Storage · sequential write");
        let (mut written, mut rates) = (0u64, Vec::new());
        for _ in 0..3 {
            let t0 = Instant::now(); let start = written;
            while written - start < part && t0.elapsed() < limit { write_at(&f, chunk.buf(), written)?; written += CH as u64; }
            f.sync_all()?;
            rates.push((written - start) as f64 / MB as f64 / t0.elapsed().as_secs_f64());
        }
        put("s_seq_write", median(rates));

        say("Storage · sequential read");
        put("s_seq_read", thrice(|| {
            let t0 = Instant::now(); let mut read = 0u64;
            while read < written && t0.elapsed() < limit { read_at(&f, chunk.buf(), read)?; read += CH as u64; }
            Ok(read as f64 / MB as f64 / t0.elapsed().as_secs_f64()) })?);

        let blocks = written / 4096;
        let span = Duration::from_millis(1000);
        let mut small = Aligned::new(4096);
        for b in small.buf().chunks_exact_mut(4) { b.copy_from_slice(&rng.next().to_le_bytes()); }

        say("Storage · random 4K write");
        put("s_rand_write", thrice(|| {
            let t0 = Instant::now(); let mut n = 0u64;
            while t0.elapsed() < span { write_at(&f, small.buf(), (rng.unit() * blocks as f64) as u64 * 4096)?; n += 1; if !direct && n % 64 == 0 { f.sync_data()?; } }
            f.sync_data()?;
            Ok(n as f64 / t0.elapsed().as_secs_f64()) })?);

        say("Storage · random 4K read");
        put("s_rand_read", thrice(|| {
            let t0 = Instant::now(); let mut n = 0u64;
            while t0.elapsed() < span { read_at(&f, small.buf(), (rng.unit() * blocks as f64) as u64 * 4096)?; n += 1; }
            Ok(n as f64 / t0.elapsed().as_secs_f64()) })?);
        drop(f);

        say("Storage · random 4K write, 32 at once");
        put("s_rand32_write", thrice(|| rand_many(&path, blocks, true, 32, span))?);
        say("Storage · random 4K read, 32 at once");
        put("s_rand32_read", thrice(|| rand_many(&path, blocks, false, 32, span))?);

        say("Storage · small files");
        let data = vec![7u8; 4096];
        put("s_files", thrice(|| {
            let t0 = Instant::now(); let mut made = 0usize;
            while made < 3000 && t0.elapsed() < span { fs::write(tmp.join(format!("f{made}")), &data)?; made += 1; }
            for i in 0..made { fs::remove_file(tmp.join(format!("f{i}")))?; }
            Ok(made as f64 / t0.elapsed().as_secs_f64()) })?);
        Ok(Outcome { file_bytes: written, direct })
    })();
    let _ = fs::remove_dir_all(&tmp);
    res
}
