//! 1000Mark computer test (crate name pressmark, from the old name): runs the tests directly on the hardware, saves the results as a
//! JSON file, then serves the 1000Mark results pages on localhost and opens the browser.
mod cpu;
mod gpu;
mod mem;
mod storage;

use serde_json::{json, Map, Value};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, System};

const SITE: &[(&str, &str, &[u8])] = &[
    ("/", "text/html; charset=utf-8", include_bytes!("../../index.html")),
    ("/index.html", "text/html; charset=utf-8", include_bytes!("../../index.html")),
    ("/style.css", "text/css; charset=utf-8", include_bytes!("../../style.css")),
    ("/app.js", "text/javascript; charset=utf-8", include_bytes!("../../app.js")),
    ("/charts.js", "text/javascript; charset=utf-8", include_bytes!("../../charts.js")),
    ("/scoring.js", "text/javascript; charset=utf-8", include_bytes!("../../scoring.js")),
    ("/icon.svg", "image/svg+xml", include_bytes!("../../icon.svg")),
    ("/manifest.webmanifest", "application/manifest+json", include_bytes!("../../manifest.webmanifest")),
    ("/tests/cpu.worker.js", "text/javascript; charset=utf-8", include_bytes!("../../tests/cpu.worker.js")),
    ("/tests/kernels.wasm", "application/wasm", include_bytes!("../../tests/kernels.wasm")),
    ("/tests/storage.worker.js", "text/javascript; charset=utf-8", include_bytes!("../../tests/storage.worker.js")),
    ("/tests/gpu.js", "text/javascript; charset=utf-8", include_bytes!("../../tests/gpu.js")),
    ("/tests/media.js", "text/javascript; charset=utf-8", include_bytes!("../../tests/media.js")),
];

fn iso_now() -> (String, u64) {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rem) = ((secs / 86400) as i64, secs % 86400);
    // civil-from-days (Howard Hinnant)
    let z = days + 719468; let era = z.div_euclid(146097); let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153; let d = doy - (153 * mp + 2) / 5 + 1; let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.000Z", rem / 3600, rem % 3600 / 60, rem % 60), secs)
}

const DEFAULT_SERVER: &str = "https://1000mark.com";

/// Where the account key is kept: %APPDATA%\\1000mark on Windows, ~/.config/1000mark elsewhere (older builds used "pressmark", still read).
fn account_file() -> Option<PathBuf> {
    let base = std::env::var_os("APPDATA").map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    let new = base.join("1000mark").join("account.json");
    let old = base.join("pressmark").join("account.json");
    Some(if !new.exists() && old.exists() { old } else { new })
}
fn account() -> Option<(String, String)> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(account_file()?).ok()?).ok()?;
    Some((v["key"].as_str()?.to_string(), v["server"].as_str().unwrap_or(DEFAULT_SERVER).trim_end_matches('/').to_string()))
}
fn connect(key: &str, server: &str) -> Result<PathBuf, String> {
    if !key.starts_with("pmk_") || key.len() < 24 { return Err("That does not look like a 1000Mark key. Copy it from your account page.".into()); }
    let file = account_file().ok_or("Could not find a folder to keep the key in.")?;
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&file, json!({ "key": key, "server": server.trim_end_matches('/') }).to_string()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)); }
    Ok(file)
}
/// Send a finished run to the account this computer is connected to.
fn upload(text: &str, key: &str, server: &str) -> Result<(), String> {
    match ureq::post(&format!("{server}/api/upload")).timeout(std::time::Duration::from_secs(20))
        .set("Authorization", &format!("Bearer {key}")).set("Content-Type", "application/json").send_string(text) {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(code, resp)) => { let body = resp.into_string().unwrap_or_default();
            Err(serde_json::from_str::<Value>(&body).ok().and_then(|v| v["error"].as_str().map(String::from)).unwrap_or_else(|| format!("the server answered {code}"))) }
        Err(e) => Err(format!("could not reach {server} ({e})")),
    }
}

/// Physical drives with their model names. Linux only for now (read from /sys/block).
#[cfg(target_os = "linux")]
fn drives() -> Vec<Value> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir("/sys/block") else { return out };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if ["loop", "ram", "zram", "dm-", "md", "sr", "nbd"].iter().any(|p| name.starts_with(p)) { continue; }
        let rd = |f: &str| std::fs::read_to_string(e.path().join(f)).map(|s| s.trim().to_string()).unwrap_or_default();
        let bytes = rd("size").parse::<u64>().unwrap_or(0) * 512;
        if bytes == 0 { continue; }
        let kind = if name.starts_with("nvme") { "NVMe SSD" } else if rd("queue/rotational") == "1" { "Hard disk" } else if rd("removable") == "1" { "Removable" } else { "SSD" };
        out.push(json!({ "name": name, "model": rd("device/model"), "bytes": bytes, "kind": kind }));
    }
    out
}
#[cfg(not(target_os = "linux"))]
fn drives() -> Vec<Value> { Vec::new() }

/// Laptop or desktop: a laptop has a system battery.
fn form_factor() -> &'static str {
    #[cfg(target_os = "linux")]
    let battery = std::fs::read_dir("/sys/class/power_supply").map(|rd| rd.flatten().any(|e| {
        let r = |f: &str| std::fs::read_to_string(e.path().join(f)).unwrap_or_default();
        r("type").trim() == "Battery" && r("scope").trim() != "Device"
    })).unwrap_or(false);
    #[cfg(target_os = "macos")]
    let battery = std::process::Command::new("pmset").args(["-g", "batt"]).output().map(|o| String::from_utf8_lossy(&o.stdout).contains("InternalBattery")).unwrap_or(false);
    #[cfg(target_os = "windows")]
    let battery = std::process::Command::new("powershell").args(["-NoProfile", "-Command", "(Get-CimInstance Win32_Battery | Measure-Object).Count"]).output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u32>().unwrap_or(0) > 0).unwrap_or(false);
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    let battery = false;
    if battery { "laptop" } else { "desktop" }
}

fn say(label: &str) { print!("\r\x1b[2K  ▓ {label}"); let _ = std::io::stdout().flush(); }

// ---------- scoring, read from the site's own scoring.js so the two never disagree ----------
const SCORING: &str = include_str!("../../scoring.js");
struct TestDef { cat: String, group: String, name: String, unit: String, div: f64, rf: Option<f64>, curve: Vec<(f64, f64)> }
/// A size test's general-use curve, `curve: [[GB, points], ...]` on its line in scoring.js.
fn curve(line: &str) -> Vec<(f64, f64)> {
    let Some(i) = line.find(" curve: [[") else { return Vec::new() };
    let rest = &line[i + 10..]; let rest = &rest[..rest.find("]]").unwrap_or(rest.len())];
    rest.split("], [").filter_map(|p| { let (a, b) = p.split_once(',')?; Some((a.trim().parse().ok()?, b.trim().parse().ok()?)) }).collect()
}
/// Same as curvePoints() in scoring.js: straight lines between anchors on a doubling scale, flat past the last.
fn curve_points(c: &[(f64, f64)], v: f64) -> f64 {
    let a: Vec<(f64, f64)> = c.iter().map(|(s, p)| (s.log2(), *p)).collect(); let x = v.log2();
    let last = a[a.len() - 1]; if x >= last.0 { return last.1; }
    let mut i = 1; while i < a.len() - 1 && x > a[i].0 { i += 1; }
    let ((x0, p0), (x1, p1)) = (a[i - 1], a[i]);
    (p0 + (p1 - p0) * (x - x0) / (x1 - x0)).max(10.0)
}
fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let i = line.find(&format!(" {key}: "))? + key.len() + 3;
    let rest = &line[i..];
    if let Some(r) = rest.strip_prefix('\'') { return r.find('\'').map(|j| &r[..j]); }
    let j = rest.find(|c: char| c == ',' || c == ' ' || c == '}').unwrap_or(rest.len());
    Some(&rest[..j])
}
struct Scorer { tests: std::collections::HashMap<String, TestDef>, cats: Vec<(String, String, f64)>, got: Vec<(String, f64)>, last: (String, String) }
impl Scorer {
    fn new() -> Self {
        let mut tests = std::collections::HashMap::new(); let mut cats = Vec::new();
        for line in SCORING.lines() {
            let t = line.trim();
            if t.starts_with("{ id:") && t.contains(" weight: ") {
                if let (Some(id), Some(name), Some(w)) = (field(t, "id"), field(t, "name"), field(t, "weight").and_then(|w| w.parse().ok())) { cats.push((id.into(), name.into(), w)); }
                continue;
            }
            let Some((id, rest)) = t.split_once(':') else { continue };
            if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') || !rest.trim_start().starts_with("{ cat:") { continue; }
            let rest = format!(" {}", rest.trim_start().trim_start_matches('{'));
            let rf = if rest.contains("unscored: true") { None } else { field(&rest, "ref").and_then(|v| v.parse().ok()) };
            tests.insert(id.to_string(), TestDef { cat: field(&rest, "cat").unwrap_or("").into(), group: field(&rest, "group").unwrap_or("").into(), name: field(&rest, "name").unwrap_or(id).into(),
                unit: field(&rest, "unit").unwrap_or("").into(), div: field(&rest, "div").and_then(|v| v.parse().ok()).unwrap_or(1.0), rf, curve: curve(&rest) });
        }
        Scorer { tests, cats, got: Vec::new(), last: (String::new(), String::new()) }
    }
    fn points(&self, id: &str, v: f64) -> Option<f64> { let t = self.tests.get(id)?; let r = t.rf?; if !(v > 0.0) { return None; } if t.curve.len() > 1 { return Some(curve_points(&t.curve, v)); } Some(1000.0 * v / t.div / r) }
    /// Print one finished test as a permanent line, under a heading for its part and group.
    fn show(&mut self, id: &str, v: f64) {
        self.got.push((id.to_string(), v));
        let Some(t) = self.tests.get(id) else { return };
        let cat = self.cats.iter().find(|c| c.0 == t.cat).map(|c| c.1.clone()).unwrap_or_default();
        print!("\r\x1b[2K");
        if self.last != (t.cat.clone(), t.group.clone()) { println!("\n  {} · {}", cat.to_uppercase(), t.group.to_lowercase()); self.last = (t.cat.clone(), t.group.clone()); }
        let p = self.points(id, v).map(|p| format!("{:>6.0} pts", p)).unwrap_or_else(|| "  (not scored)".into());
        println!("    {:<26} {:>10} {:<11}{p}", t.name, fmt(v / t.div), t.unit);
    }
    /// Part scores (geometric mean of each part's tests) and the system score (weighted geometric mean of the parts).
    fn summary(&self) {
        println!("\n  ════════════════════════════════════════════════════");
        let (mut lw, mut w) = (0.0, 0.0);
        for (id, name, weight) in &self.cats {
            let ps: Vec<f64> = self.got.iter().filter(|(t, _)| self.tests.get(t).map(|d| &d.cat == id).unwrap_or(false)).filter_map(|(t, v)| self.points(t, *v)).collect();
            if ps.is_empty() { println!("    {:<38} {:>10}", name.to_uppercase(), "not tested"); continue; }
            let g = (ps.iter().map(|p| p.ln()).sum::<f64>() / ps.len() as f64).exp();
            lw += weight * g.ln(); w += weight;
            println!("    {:<38} {:>10.0}", name.to_uppercase(), g);
        }
        if w > 0.0 { println!("  ────────────────────────────────────────────────────\n    {:<38} {:>10.0}\n", "SYSTEM SCORE", (lw / w).exp()); }
    }
}
/// A device name made from the hardware, so the computer's own name (often a person's name) is never sent.
fn device_name(cpu: &str, form: &str) -> String {
    let mut c = cpu.replace("(R)", "").replace("(TM)", "").replace("(tm)", "");
    for cut in [" CPU @", " @ ", " with Radeon", " w/ Radeon"] { if let Some(i) = c.find(cut) { c.truncate(i); } }
    let words: Vec<&str> = c.split_whitespace().filter(|w| !["AMD", "Intel", "Processor", "CPU"].contains(w) && !w.ends_with("-Core")).collect();
    let c = words.join(" ");
    if c.is_empty() { format!("My {form}") } else { format!("{c} {form}") }
}
/// Installed memory in GB: the system keeps a little for itself, so round up to the size on the box.
fn ram_gb(bytes: u64) -> f64 { let g = bytes as f64 / (1u64 << 30) as f64; if g >= 6.0 { (g / 2.0).round() * 2.0 } else { g.round() } }
fn fmt(v: f64) -> String { if v >= 100.0 { format!("{:.0}", v) } else if v >= 10.0 { format!("{:.1}", v) } else { format!("{:.2}", v) } }

/// Post the run to the site and get a token the results page can claim it with.
fn handoff(text: &str, server: &str) -> Result<String, String> {
    match ureq::post(&format!("{server}/api/handoff")).timeout(std::time::Duration::from_secs(20)).set("Content-Type", "application/json").send_string(text) {
        Ok(r) => { let v: Value = serde_json::from_str(&r.into_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?; v["token"].as_str().map(String::from).ok_or_else(|| "no token in the answer".into()) }
        Err(ureq::Error::Status(code, resp)) => { let body = resp.into_string().unwrap_or_default();
            Err(serde_json::from_str::<Value>(&body).ok().and_then(|v| v["error"].as_str().map(String::from)).unwrap_or_else(|| format!("the server answered {code}"))) }
        Err(e) => Err(format!("could not reach {server} ({e})")),
    }
}

/// Heat. The scores above come from short bursts on a cool machine. This runs a few CPU and GPU
/// tests again at the end and reports the share of their speed that is left. With `soak` it first
/// loads every core and the graphics chip for that many minutes, sampling the speed as it goes, so
/// a machine that slows down when hot shows it. Scores never change: this is reported beside them.
const HEAT_CPU: &[&str] = &["zip", "physics", "matrix"];
const HEAT_GPU: &[&str] = &["gpu_scene", "gpu_rays"];
fn heat(sc: &Scorer, g: Option<&gpu::Gpu>, threads: usize, soak: Option<u64>, started: std::time::Instant) -> Value {
    let cold = |id: &str| sc.got.iter().find(|(k, _)| k == id).map(|(_, v)| *v).filter(|v| *v > 0.0);
    let mut series: Vec<Value> = Vec::new();
    if let Some(minutes) = soak {
        let t0 = std::time::Instant::now(); let (mut c0, mut g0) = (0.0, 0.0);
        while t0.elapsed().as_secs() < minutes * 60 {
            let (c, gf) = std::thread::scope(|s| {
                let hs: Vec<_> = (0..threads).map(|_| s.spawn(|| { let mut w = cpu::make("matrix"); cpu::timed(4000, &mut *w) })).collect();
                let gf = g.and_then(|g| g.once("gpu_scene", 4000).ok());
                (hs.into_iter().map(|h| h.join().unwrap_or(0.0)).sum::<f64>(), gf)
            });
            if c0 == 0.0 { c0 = c; g0 = gf.unwrap_or(0.0); }
            let (cr, gr) = (c / c0, gf.filter(|_| g0 > 0.0).map(|x| x / g0));
            let el = t0.elapsed().as_secs();
            series.push(json!([el, (cr * 1000.0).round() / 1000.0, gr.map(|x| (x * 1000.0).round() / 1000.0)]));
            say(&format!("Heat test · {}:{:02} of {minutes}:00 · CPU at {:.0}%{}", el / 60, el % 60, cr * 100.0, gr.map(|x| format!(", GPU at {:.0}%", x * 100.0)).unwrap_or_default()));
        }
    }
    say("Heat · measuring again");
    let geo = |v: Vec<f64>| if v.is_empty() { None } else { Some(((v.iter().map(|x| x.ln()).sum::<f64>() / v.len() as f64).exp() * 1000.0).round() / 1000.0) };
    let cpu_r = geo(HEAT_CPU.iter().filter_map(|t| { let c = cold(&format!("ca_{t}"))?; let t: &'static str = t; Some(cpu::multi(t, 400, threads) / c) }).collect());
    let gpu_r = geo(HEAT_GPU.iter().filter_map(|id| { let c = cold(id)?; Some(g?.once(id, 700).ok()? / c) }).collect());
    json!({ "mode": if soak.is_some() { "soak" } else { "end" }, "soak": soak, "minutes": (started.elapsed().as_secs_f64() / 6.0).round() / 10.0, "cpu": cpu_r, "gpu": gpu_r, "series": series })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let has = |f: &str| args.iter().any(|a| a == f);
    let val = |f: &str| args.iter().position(|a| a == f).and_then(|i| args.get(i + 1)).cloned();
    if has("--help") || has("-h") {
        println!("1000Mark {}\n\nTests this computer, lists each result as it finishes, then opens the results page.\n\n  --name NAME    what to call this device (default: named after its processor)\n  --dir PATH     folder on the drive to test (default: your home folder)\n  --server URL   the 1000Mark site to show results on (default {DEFAULT_SERVER})\n  --local        show the results on this computer only, without sending them to the site\n  --show-data    print exactly what is sent before sending it\n  --no-open      do not open the browser\n  --connect KEY  send every run straight to your account (key from the account page)\n  --disconnect   stop sending runs to an account\n  --heat         also heat-soak the computer for 12 minutes and measure the speed it keeps
  --minutes N    length of the heat soak (with --heat)
  --json-only    save the results file and exit\n  --port N       port for the local results page (default 4174)", env!("CARGO_PKG_VERSION"));
        return;
    }
    if let Some(key) = val("--connect") {
        let server = val("--server").unwrap_or_else(|| DEFAULT_SERVER.into());
        match connect(&key, &server) { Ok(f) => println!("Connected. Runs on this computer will be sent to your account at {server}.\nKey saved in {}", f.display()), Err(e) => println!("Not connected: {e}") }
        return;
    }
    if has("--disconnect") {
        match account_file().map(std::fs::remove_file) { Some(Ok(_)) => println!("Disconnected. Runs stay on this computer from now on."), _ => println!("This computer was not connected to an account.") }
        return;
    }
    let ms: u64 = 700;        // each test is timed three times for this long and the middle result kept

    // ---------- what is this machine ----------
    let mut sys = System::new_all(); sys.refresh_all();
    let threads = sys.cpus().len().max(1);
    let cores = sys.physical_core_count().unwrap_or(threads);
    let cpu_name = sys.cpus().first().map(|c| c.brand().trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "Unknown processor".into());
    let ram = sys.total_memory();
    let os = System::long_os_version().or_else(System::name).unwrap_or_else(|| std::env::consts::OS.into());
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
    let dir = val("--dir").map(PathBuf::from).or_else(|| home.clone()).unwrap_or_else(|| PathBuf::from("."));
    let dir = dir.canonicalize().unwrap_or(dir);
    // Results are shared with the site, so keep the user's folder names out of them.
    let home_c = home.as_ref().and_then(|h| h.canonicalize().ok());
    let shown_dir = match &home_c { Some(h) if dir.starts_with(h) => format!("~{}", dir.strip_prefix(h).map(|r| if r.as_os_str().is_empty() { String::new() } else { format!("/{}", r.display()) }).unwrap_or_default()), _ => dir.display().to_string() };
    let user = home_c.as_ref().and_then(|h| h.file_name()).map(|u| u.to_string_lossy().to_string()).filter(|u| u.len() > 1);
    let private = |m: &str| -> String { match &home_c { Some(h) if std::path::Path::new(m).starts_with(h) => "~".into(),
        _ => match &user { Some(u) => m.replace(&format!("/{u}/"), "/~/").replace(&format!("\\{u}\\"), "\\~\\"), None => m.into() } } };
    let disks = Disks::new_with_refreshed_list();
    // Volumes: type and size only. Their names and mount points can carry personal names.
    let _ = &private;
    let disk_json: Vec<Value> = disks.iter().filter(|d| d.total_space() > 0).map(|d| json!({ "fs": d.file_system().to_string_lossy(), "kind": format!("{:?}", d.kind()), "total": d.total_space(), "free": d.available_space(), "removable": d.is_removable() })).collect();
    let here = disks.iter().filter(|d| dir.starts_with(d.mount_point())).max_by_key(|d| d.mount_point().as_os_str().len());

    println!("\n  1000MARK {} · computer test\n  {cpu_name} · {cores} cores, {threads} threads · {:.0} GB RAM\n  Testing the drive that holds {shown_dir}\n  Leave the computer alone until it finishes (about four minutes; with --heat, about sixteen).", env!("CARGO_PKG_VERSION"), ram_gb(ram));

    let mut sc = Scorer::new();
    let mut errors = Map::new();
    let started = std::time::Instant::now();

    // ---------- CPU: one core, six threads (about what a game or a busy app keeps working), every thread ----------
    let six = threads.min(6);
    for t in cpu::TESTS { say(&format!("CPU · {t} · one core")); let v = cpu::single(t, ms); sc.show(&format!("c1_{t}"), v); }
    for t in cpu::TESTS { say(&format!("CPU · {t} · {six} threads")); let v = cpu::multi(t, ms, six); sc.show(&format!("c6_{t}"), v); }
    for t in cpu::TESTS { say(&format!("CPU · {t} · all {threads} threads")); let v = cpu::multi(t, ms, threads); sc.show(&format!("ca_{t}"), v); }

    // ---------- memory ----------
    say("Memory");
    mem::run(ms, threads, ram, |id, v| { sc.show(id, v); say("Memory"); });

    // ---------- storage ----------
    let mut info = Map::new();
    match storage::run(&dir, here.map(|d| d.available_space()).unwrap_or(u64::MAX), |id, v| sc.show(id, v), say) {
        Ok(o) => { info.insert("fileBytes".into(), json!(o.file_bytes)); info.insert("direct".into(), json!(o.direct)); }
        Err(e) => { errors.insert("storage".into(), json!(format!("{e} (testing in {shown_dir})"))); }
    }
    if let Some(d) = here {
        info.insert("quota".into(), json!(d.total_space())); info.insert("usage".into(), json!(d.total_space() - d.available_space()));
        info.insert("disk".into(), json!({ "fs": d.file_system().to_string_lossy(), "kind": format!("{:?}", d.kind()) }));
    }
    info.insert("diskPath".into(), json!(shown_dir));
    info.insert("memBlock".into(), json!(mem::BLOCK));

    // ---------- GPU ----------
    say("GPU");
    let g = match gpu::Gpu::open() {
        Ok(Some(g)) => Some(g),
        Ok(None) => { errors.insert("gpu".into(), json!("No graphics adapter was found that supports Vulkan, Metal or DirectX 12.")); None }
        Err(e) => { errors.insert("gpu".into(), json!(e)); None }
    };
    let (mut gpu_name, mut gpus, mut vram) = (String::new(), vec![], None);
    if let Some(g) = &g {
        let mut compute_rays = None;
        for (id, label) in gpu::TESTS {
            say(label);
            match g.test(id, ms) { Ok(v) => { if *id == "gpu_rays" { compute_rays = Some(v); } sc.show(id, v) } Err(e) => { errors.insert((*id).into(), json!(e)); } }
        }
        // Without ray-tracing hardware within reach the compute result stands in, so the chip scores what it can do.
        say("GPU · ray tracing (hardware)");
        let (hw, how) = g.hardware_rays(ms);
        if let Some(v) = hw.or(compute_rays) { sc.show("gpu_rt", v); }
        let i = g.info(ram);
        info.insert("gpuApi".into(), json!(format!("{} (native)", i.backend))); info.insert("gpuAdapter".into(), json!(format!("{} · {}", i.name, i.driver))); info.insert("gpuKind".into(), json!(i.kind)); info.insert("rayTracing".into(), json!(how));
        if let Some((_, shared)) = i.vram { info.insert("vramShared".into(), json!(shared)); }
        gpu_name = i.name; gpus = i.others; vram = i.vram;
    }
    // ---------- capacity (computer test only: a browser cannot see these) ----------
    sc.show("sz_ram", ram_gb(ram));
    if let Some((gb, _)) = vram { sc.show("sz_vram", gb); }
    if let Some(d) = here { sc.show("sz_drive", d.total_space() as f64 / 1e9); }

    // ---------- heat: how much speed is left once the computer is hot ----------
    let soak = if has("--heat") { Some(val("--minutes").and_then(|m| m.parse().ok()).unwrap_or(12u64)) } else { None };
    let heat = heat(&sc, g.as_ref(), threads, soak, started);
    print!("\r\x1b[2K");
    for (k, v) in &errors { println!("    ✗ {k}: {}", v.as_str().unwrap_or("")); }
    sc.summary();
    if let (Some(c), Some(m)) = (heat["cpu"].as_f64(), heat["minutes"].as_f64()) {
        let gpu = heat["gpu"].as_f64().map(|g| format!(", the GPU {:.0}%", g * 100.0)).unwrap_or_default();
        println!("  Heat: after {m:.0} minutes{} the CPU keeps {:.0}% of its speed{gpu}.{}\n", if soak.is_some() { " under full load" } else { " of testing" }, c * 100.0, if soak.is_some() { "" } else { "\n  Run with --heat for the 15-minute heat test." });
    }

    // ---------- results ----------
    let mut tests = Map::new();
    for (k, v) in &sc.got { tests.insert(k.clone(), json!(v)); }
    let (time, secs) = iso_now();
    let form = form_factor();
    let run = json!({
        "pressmark": 1, "suite": 1, "native": true, "id": format!("n{secs:x}"), "time": time, "mode": "full",
        "label": val("--name").unwrap_or_else(|| device_name(&cpu_name, form)),
        "device": { "native": true, "cpu": cpu_name, "physCores": cores, "cores": threads, "memoryBytes": ram, "memory": null,
                    "os": os, "arch": System::cpu_arch(), "browser": format!("1000Mark computer test {}", env!("CARGO_PKG_VERSION")), "model": cpu_name,
                    "gpu": gpu_name, "gpus": gpus, "disks": disk_json, "drives": drives(), "screen": "", "formFactor": form, "secure": true, "webgpu": true, "webcodecs": false },
        "tests": tests, "errors": errors, "info": info, "heat": heat,
    });
    let text = serde_json::to_string_pretty(&run).unwrap();
    if has("--show-data") { println!("  This is everything that is sent:\n\n{text}\n"); }
    let file = format!("1000mark-{}.json", &time[..19].replace(':', "-"));
    match std::fs::write(&file, &text) { Ok(_) => println!("  Results saved to {file}"), Err(e) => println!("  Could not save {file}: {e}") }
    let acct = account();
    if let Some((key, server)) = &acct {
        match upload(&text, key, server) { Ok(_) => println!("  Saved to your 1000Mark account."), Err(e) => println!("  Not saved to your account: {e}") }
    }
    if has("--json-only") { return; }

    // ---------- results page: on the site if it can be reached, otherwise served from here ----------
    if !has("--local") {
        let server = val("--server").or_else(|| acct.map(|a| a.1)).unwrap_or_else(|| DEFAULT_SERVER.into());
        let server = server.trim_end_matches('/').to_string();
        match handoff(&text, &server) {
            Ok(token) => {
                let url = format!("{server}/#claim={token}");
                println!("  Results page: {url}\n  Sign in there to keep this run in your account.\n");
                if !has("--no-open") && open::that(&url).is_err() { println!("  Could not open the browser. Open the address above yourself."); }
                return;
            }
            Err(e) => println!("  Could not send the results to {server}: {e}\n  Showing them from this computer instead."),
        }
    }
    // Use the asked-for port, or the next free one after it (another copy may already be showing results).
    let first: u16 = val("--port").and_then(|p| p.parse().ok()).unwrap_or(4174);
    let Some((server, port)) = (first..first.saturating_add(10)).find_map(|p| tiny_http::Server::http(("127.0.0.1", p)).ok().map(|s| (s, p))) else {
        println!("  Could not start the results page on ports {first} to {}.\n  Load {file} into the 1000Mark site instead.", first.saturating_add(9)); return; };
    let url = format!("http://localhost:{port}/");
    println!("  Results page: {url}   (Ctrl+C to quit)\n");
    if !has("--no-open") { let _ = open::that(&url); }
    for req in server.incoming_requests() {
        let path = req.url().split('?').next().unwrap_or("/").to_string();
        let (ctype, body) = if path == "/native-run.json" { ("application/json", text.as_bytes()) }
            else if let Some((_, c, b)) = SITE.iter().find(|(p, _, _)| *p == path) { (*c, *b) }
            else { let _ = req.respond(tiny_http::Response::from_string("Not found").with_status_code(404)); continue; };
        let mut resp = tiny_http::Response::from_data(body);
        for (k, v) in [("Content-Type", ctype), ("Cache-Control", "no-store"), ("Cross-Origin-Opener-Policy", "same-origin"), ("Cross-Origin-Embedder-Policy", "credentialless")] {
            resp.add_header(tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap());
        }
        let _ = req.respond(resp);
    }
}
