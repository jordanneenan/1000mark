//! Power drawn by the processor and the graphics chip, where the system will say without admin
//! rights. These are the chips' own estimates, not measurements at the wall, and they leave out
//! memory, drives and the power supply. Never part of a score: reported beside it.
//!
//! - Linux: the processor's energy counter (powercap/RAPL; some systems keep it for root), NVIDIA
//!   through nvidia-smi, AMD through the card's hwmon sensor.
//! - macOS on Apple silicon: the system's energy counters (IOReport, "Energy Model").
//! - Windows: NVIDIA through nvidia-smi. Nothing reports processor power there without a driver.
//!
//! Everything is kept as joules counted up since the start, so the average power over any stretch
//! is the difference between two readings divided by the time between them.
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub struct Power {
    #[cfg(target_os = "linux")]
    rapl: Mutex<Vec<Rapl>>,
    #[cfg(target_os = "macos")]
    mac: Option<mac::Energy>,
    /// Joules counted up by a background reader of an instantaneous watts figure.
    gpu_sampled: Option<Arc<Mutex<f64>>>,
    /// The nvidia-smi process doing that reading, stopped when the test ends.
    helper: Option<Arc<Mutex<std::process::Child>>>,
    pub cpu_source: &'static str,
    pub gpu_source: &'static str,
}
#[cfg(target_os = "linux")]
struct Rapl { path: std::path::PathBuf, max: f64, last: f64, total: f64 }

/// A point in time to measure from.
pub struct Mark { at: Instant, cpu: Option<f64>, gpu: Option<f64> }

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    std::process::Command::new(cmd).args(args).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).to_string())
}

/// Add up watts read every so often into joules, on a thread of its own.
#[allow(dead_code)]
fn sample(mut read: impl FnMut() -> Option<f64> + Send + 'static) -> Arc<Mutex<f64>> {
    let total = Arc::new(Mutex::new(0.0)); let t = total.clone();
    std::thread::spawn(move || { let mut last = Instant::now(); loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let Some(w) = read() else { continue };
        let now = Instant::now(); *t.lock().unwrap() += w * (now - last).as_secs_f64(); last = now;
    } });
    total
}

/// nvidia-smi printing the card's draw twice a second for as long as the test runs.
fn nvidia(name: &str) -> Option<(Arc<Mutex<f64>>, Arc<Mutex<std::process::Child>>)> {
    use std::io::{BufRead, BufReader};
    let list = run("nvidia-smi", &["--query-gpu=index,name,power.draw", "--format=csv,noheader,nounits"])?;
    let rows: Vec<Vec<&str>> = list.lines().map(|l| l.split(',').map(|x| x.trim()).collect()).filter(|r: &Vec<&str>| r.len() == 3 && r[2].parse::<f64>().is_ok()).collect();
    let row = rows.iter().find(|r| name.contains(r[1]) || r[1].contains(name)).or(rows.first())?;
    let mut cmd = std::process::Command::new("nvidia-smi");
    cmd.args(["-i", row[0], "--query-gpu=power.draw", "--format=csv,noheader,nounits", "-lms", "500"]).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).stdin(std::process::Stdio::null());
    // If the test is killed outright, the system stops the helper with it.
    #[cfg(target_os = "linux")]
    unsafe { use std::os::unix::process::CommandExt; cmd.pre_exec(|| { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL); Ok(()) }); }
    let mut child = cmd.spawn().ok()?;
    let out = child.stdout.take()?;
    let total = Arc::new(Mutex::new(0.0)); let t = total.clone();
    std::thread::spawn(move || { let mut last = Instant::now();
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            let now = Instant::now(); if let Ok(w) = line.trim().parse::<f64>() { *t.lock().unwrap() += w * (now - last).as_secs_f64(); } last = now;
        }
    });
    Some((total, Arc::new(Mutex::new(child))))
}

impl Power {
    /// `vendor` and `device` are the graphics chip's PCI ids, `name` its name.
    pub fn new(vendor: u32, device: u32, name: &str) -> Power {
        let _ = (vendor, device);
        let (mut gpu_sampled, mut gpu_source, mut helper) = (None, "", None);
        if vendor == 0x10de && cfg!(any(target_os = "linux", target_os = "windows")) { if let Some((s, c)) = nvidia(name) { gpu_sampled = Some(s); helper = Some(c); gpu_source = "nvidia-smi"; } }
        #[cfg(target_os = "linux")]
        {
            // A card with a power sensor of its own (AMD): /sys/class/drm/cardN/device/hwmon/hwmonM/power1_average, in microwatts.
            if gpu_sampled.is_none() { if let Ok(rd) = std::fs::read_dir("/sys/class/drm") { for e in rd.flatten() {
                let dev = e.path().join("device");
                let hex = |f: &str| u32::from_str_radix(std::fs::read_to_string(dev.join(f)).unwrap_or_default().trim().trim_start_matches("0x"), 16).unwrap_or(0);
                if hex("vendor") != vendor || hex("device") != device { continue; }
                let Ok(hw) = std::fs::read_dir(dev.join("hwmon")) else { continue };
                for h in hw.flatten() { for f in ["power1_average", "power1_input"] {
                    let p = h.path().join(f);
                    if std::fs::read_to_string(&p).ok().and_then(|s| s.trim().parse::<f64>().ok()).is_some() && gpu_sampled.is_none() {
                        gpu_sampled = Some(sample(move || std::fs::read_to_string(&p).ok()?.trim().parse::<f64>().ok().map(|uw| uw / 1e6))); gpu_source = "the card's sensor";
                    }
                } }
            } } }
            // Whole-processor energy counters: intel-rapl:0, intel-rapl:1, ... (one per socket; the name is Intel's, AMD uses it too).
            let mut rapl = Vec::new();
            if let Ok(rd) = std::fs::read_dir("/sys/class/powercap") { for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if !n.starts_with("intel-rapl:") || n.matches(':').count() != 1 { continue; }
                let rd = |f: &str| std::fs::read_to_string(e.path().join(f)).ok().and_then(|s| s.trim().parse::<f64>().ok());
                if let Some(last) = rd("energy_uj") { rapl.push(Rapl { path: e.path().join("energy_uj"), max: rd("max_energy_range_uj").unwrap_or(0.0), last, total: 0.0 }); }
            } }
            let cpu_source = if rapl.is_empty() { "" } else { "the processor's energy counter" };
            return Power { rapl: Mutex::new(rapl), gpu_sampled, helper, cpu_source, gpu_source };
        }
        #[cfg(target_os = "macos")]
        {
            let mac = mac::Energy::new(); let has = mac.as_ref().map(|m| m.read()).unwrap_or((None, None));
            return Power { mac, gpu_sampled, helper, cpu_source: if has.0.is_some() { "the system's energy counters" } else { "" }, gpu_source: if has.1.is_some() { "the system's energy counters" } else { gpu_source } };
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        { let _ = &mut gpu_sampled; Power { gpu_sampled, helper, cpu_source: "", gpu_source } }
    }

    /// Joules since the start: (processor, graphics chip).
    fn joules(&self) -> (Option<f64>, Option<f64>) {
        let sampled = self.gpu_sampled.as_ref().map(|s| *s.lock().unwrap());
        #[cfg(target_os = "linux")]
        {
            let mut r = self.rapl.lock().unwrap();
            if r.is_empty() { return (None, sampled); }
            let mut sum = 0.0;
            for d in r.iter_mut() {
                // The counter wraps (every eight minutes or so on a busy desktop chip), so add up the steps.
                if let Some(now) = std::fs::read_to_string(&d.path).ok().and_then(|s| s.trim().parse::<f64>().ok()) { d.total += if now >= d.last { now - d.last } else { now + d.max - d.last }; d.last = now; }
                sum += d.total;
            }
            return (Some(sum / 1e6), sampled);
        }
        #[cfg(target_os = "macos")]
        { let (c, g) = self.mac.as_ref().map(|m| m.read()).unwrap_or((None, None)); return (c, g.or(sampled)); }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        (None, sampled)
    }
    /// Stop the helper process. Also called when the test is interrupted.
    pub fn stopper(&self) -> impl Fn() + Send + 'static { let h = self.helper.clone(); move || { if let Some(h) = &h { if let Ok(mut c) = h.lock() { let _ = c.kill(); let _ = c.wait(); } } } }
    pub fn mark(&self) -> Mark { let (cpu, gpu) = self.joules(); Mark { at: Instant::now(), cpu, gpu } }
    /// Average watts since `m`: (processor, graphics chip), rounded to a tenth.
    pub fn since(&self, m: &Mark) -> (Option<f64>, Option<f64>) {
        let (c, g) = self.joules(); let s = m.at.elapsed().as_secs_f64().max(1e-3);
        let w = |a: Option<f64>, b: Option<f64>| Some(((a? - b?) / s * 10.0).round() / 10.0).filter(|w| *w >= 0.0 && *w < 5000.0);
        (w(c, m.cpu), w(g, m.gpu))
    }
}

/// Apple silicon keeps energy counters for the processor and the graphics chip, readable through
/// IOReport (the same source as Activity Monitor's energy figures) without admin rights.
#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void, CStr, CString};
    type Cf = *const c_void;
    const UTF8: u32 = 0x0800_0100;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(alloc: Cf, s: *const c_char, enc: u32) -> Cf;
        fn CFStringGetCString(s: Cf, buf: *mut c_char, len: isize, enc: u32) -> u8;
        fn CFDictionaryGetValue(d: Cf, key: Cf) -> Cf;
        fn CFDictionaryCreateMutableCopy(alloc: Cf, cap: isize, d: Cf) -> Cf;
        fn CFArrayGetCount(a: Cf) -> isize;
        fn CFArrayGetValueAtIndex(a: Cf, i: isize) -> Cf;
        fn CFRelease(x: Cf);
    }
    #[link(name = "IOReport", kind = "dylib")]
    extern "C" {
        fn IOReportCopyChannelsInGroup(group: Cf, subgroup: Cf, a: u64, b: u64, c: u64) -> Cf;
        fn IOReportCreateSubscription(a: Cf, channels: Cf, out: *mut Cf, id: u64, b: Cf) -> Cf;
        fn IOReportCreateSamples(sub: Cf, channels: Cf, a: Cf) -> Cf;
        fn IOReportChannelGetChannelName(ch: Cf) -> Cf;
        fn IOReportChannelGetUnitLabel(ch: Cf) -> Cf;
        fn IOReportSimpleGetIntegerValue(ch: Cf, a: i32) -> i64;
    }
    fn cfstr(s: &str) -> Cf { let c = CString::new(s).unwrap(); unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8) } }
    fn string(s: Cf) -> String {
        if s.is_null() { return String::new(); }
        let mut buf = [0 as c_char; 128];
        if unsafe { CFStringGetCString(s, buf.as_mut_ptr(), 128, UTF8) } == 0 { return String::new(); }
        unsafe { CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().trim().to_string()
    }
    pub struct Energy { sub: Cf, channels: Cf, key: Cf }
    impl Energy {
        pub fn new() -> Option<Energy> { unsafe {
            let group = cfstr("Energy Model");
            let found = IOReportCopyChannelsInGroup(group, std::ptr::null(), 0, 0, 0);
            CFRelease(group);
            if found.is_null() { return None; }
            let channels = CFDictionaryCreateMutableCopy(std::ptr::null(), 0, found);
            CFRelease(found);
            if channels.is_null() { return None; }
            let mut subbed: Cf = std::ptr::null();
            let sub = IOReportCreateSubscription(std::ptr::null(), channels, &mut subbed, 0, std::ptr::null());
            if sub.is_null() { CFRelease(channels); return None; }
            Some(Energy { sub, channels, key: cfstr("IOReportChannels") })
        } }
        /// Joules counted so far: (processor, graphics chip).
        pub fn read(&self) -> (Option<f64>, Option<f64>) { unsafe {
            let s = IOReportCreateSamples(self.sub, self.channels, std::ptr::null());
            if s.is_null() { return (None, None); }
            let list = CFDictionaryGetValue(s, self.key);
            let (mut cpu, mut gpu) = (None, None);
            if !list.is_null() { for i in 0..CFArrayGetCount(list) {
                let ch = CFArrayGetValueAtIndex(list, i);
                let name = string(IOReportChannelGetChannelName(ch));
                if name != "CPU Energy" && name != "GPU Energy" { continue; }
                let per = match string(IOReportChannelGetUnitLabel(ch)).as_str() { "mJ" => 1e-3, "uJ" | "µJ" => 1e-6, "nJ" => 1e-9, _ => continue };
                let j = IOReportSimpleGetIntegerValue(ch, 0) as f64 * per;
                if name == "CPU Energy" { cpu = Some(cpu.unwrap_or(0.0) + j); } else { gpu = Some(gpu.unwrap_or(0.0) + j); }
            } }
            CFRelease(s);
            (cpu, gpu)
        } }
    }
}

impl Drop for Power { fn drop(&mut self) { (self.stopper())() } }
