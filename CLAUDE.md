# 1000Mark

A benchmark for any computer or phone on one fixed scale, where 1000 is a fast desktop. Two tests share the same results pages: a browser test that needs no install, and a computer test (`native/`, Rust) that reads the real hardware. The computer test is the main product; a browser cannot see everything (some browsers report false thread counts and hide the graphics chip).

The code was called Pressmark before 2026-11-14, so internal names still say pressmark: the Rust crate (Cargo forbids a leading digit), the database file, localStorage keys, the `pm_session` cookie and `pmk_` keys. Everything people see says 1000Mark.

## Look
Three-ink screen print: cool grey paper, federal-blue key ink, fluoro pink, yellow and mint spot inks, flat blocks with hard offset shadows, dot screens, stamped squares ("lanes"), Anton for display type, Space Mono for labels, Archivo for text. Tokens are at the top of `style.css`. Keep it blocky: no rounded corners, no gradients except dot screens and hatching, no soft shadows.

Colour roles (tokens in `style.css`): `--ink` text, `--line` rules and outlines, `--paper` the sheet, `--surface` printed blocks, `--mark` data drawn in the key ink, `--on-spot` text printed on a spot colour, `--hero-*` the big score stamp, `--chip-*` filled tags, `--flood-*` / `--sh-*` / `--stamp-border` the part-score stamps. Dark mode follows printing on black stock: warm soft-black sheet, tone-on-tone panels, bone text ink, muted outlines, part-score stamps as solid floods with dark type, the system score as bare yellow type. Avoid thin bright outlines and near-white text in dark. Style components through these tokens only; never write a theme-specific component rule.

## Layout
- `index.html`, `style.css`, `app.js` (UI, run orchestration, pages), `charts.js` (bars, radar, columns, lanes), `scoring.js` (test list, reference values, weights).
- `tests/cpu.worker.js`, `tests/memory.worker.js`, `tests/storage.worker.js` (OPFS sync handles), `tests/gpu.js` (WebGPU, WebGL2 fallback), `tests/media.js` (WebCodecs encode/decode).
- `server/server.mjs` (accounts, run storage, leaderboard, percentiles, hand-off from the computer test), `server/admin.mjs` (support requests and unlocking accounts).
- No build step and no dependencies. `serve.py` serves the site alone (adds COOP/COEP headers).

## Rules that matter
- Scores: test = 1000 × result / reference; part = geometric mean of its tests (each use case can weight groups of tests); system = weighted geometric mean of parts (weights in `scoring.js`). Scores are computed at display time from raw results. Speed is always linear: no diminishing returns.
- The scale is frozen. Never change a reference value. A test that measures something new gets a new id with its own reference.
- Five scored parts: CPU, GPU, memory, storage speed and capacity. Capacity (RAM size `n_mem_size`, size of the tested drive `n_sto_total`) scores through curves of `[GB, points]` anchors (`curvePoints()`, doubling scale, flat past the last anchor): `curve` on the test line is general use, and each use case in `PROFILES` has its own `sizes`. Every curve must give the reference machine's 32 GB and 4 TB exactly 1000. Capacity exists only in computer-test runs; `addSizes()` fills `n_mem_size` for runs from before 0.3. Browser storage tests are shown but not scored: browsers serve them from memory and their own databases, so they ranked drives backwards. A run's system score is the weighted mean of the parts it has.
- CPU tests run on one core, on six threads (`*_6t_*`: games and everyday apps rarely keep more busy) and on all threads.
- The computer test prints each result with its points as it finishes. It computes them from `scoring.js` itself (embedded and parsed in `main.rs`, `Scorer`, including the general `curve`), so keep that file's one-test-per-line format and the CATS weights equal to the General use weights.
- Native storage: sequential tests move 64 MB per request (`n_sto_big_*`); the 4 MB versions (`n_sto_seq_*`) held fast NVMe drives back and stay only for old runs.
- Native GPU shaders are created with `create_shader_module_trusted` and no runtime checks: on Metal wgpu otherwise bounds-checks every buffer read (matrix compute ran at a third of the browser's speed on an M1 Pro). Keep every shader's own bounds checks and loop limits.
- `sha2` needs its `asm` feature on aarch64 or it ignores the CPU's SHA instructions.
- GPU: `gpu_scene` (2,000 textured objects, one draw call each, depth buffer) and `gpu_rays` (a 131,072-triangle landscape traced in a compute shader) are shared by both tests. The computer test reads their WGSL straight out of `tests/gpu.js` (`js_shader()` in `gpu.rs`), and `rt_scene()` must build the same scene as `rtScene()` (a Rust unit test checks the hashes; `cargo test`). `n_gpu_rt` traces the same scene with ray queries (wgpu experimental, Vulkan only in wgpu 24, so on Windows it looks for the same chip through Vulkan); without ray-tracing hardware the compute result stands in. `info.rayTracing` says which.
- GPU tests scale their batch until one batch takes about 40 ms (`loop()` in `tests/gpu.js`); a fixed small batch measures the round trip to the GPU, not the GPU.
- Everything needs a secure context (https or localhost): OPFS, WebGPU, WebCodecs and crypto.subtle are blocked on plain http.
- Runs are kept in localStorage (`pressmark.runs`), newest first, 400 kept; signed in, they also live in the account.
- In the site's copy the native program is the "computer test", never "the app"; code and ids still say app/native.

## Pages
`#home` results (or the intro), `#cpu` etc. part pages, `#computer` how to run the computer test, `#devices` device names, types and the compare table, `#leaderboard`, `#signin`, `#register`, `#account`, `#support`. Account links sit at the top right; the main menu is its own bar under the logo and is where new sections go. The theme switch is in the footer.

Devices are grouped by name (`label`); a device can hold computer-test and browser runs. Renaming relabels its runs, and giving two devices the same name merges them.

Percentile view: a Points ⇄ Percentile switch. A percentile is the share of other machines a score beats, from `/api/population`: one anonymous row per machine (latest run of each account's device and test kind), scored on the server with `scoring.js`, cached 5 minutes. Compared with the same kind of test and a chosen kind of device (`device.formFactor`: phone, tablet, laptop, desktop or computer).

## Server (`server/server.mjs`)
- Node 22.13 or newer, no dependencies (built-in http, sqlite, crypto). Run it locally: `PORT=4273 HOST=127.0.0.1 DATA_DIR=<scratch folder> node server/server.mjs`. Outside production it makes its own keys file next to the data folder.
- Passwords: scrypt, at most three hashing at once. Emails: AES-256-GCM, with an HMAC fingerprint for lookups; the keys live in `KEYS_FILE`, never in the database or this repository. No IP addresses are stored.
- Sessions: random token in an HttpOnly, Secure, SameSite=Lax cookie; only its hash is stored. Bot check: a self-hosted proof-of-work puzzle on register, sign-in and support, plus a honeypot field and rate limits. Changes need JSON and a same-origin Origin header.
- Sign-in lockout: five wrong passwords lock an email for an hour, five more for a day, five more until a support request is answered (`admin.mjs unlock`). Emails without accounts lock the same way, so the lock does not reveal who has an account.
- Score checks: `implausible()` refuses runs that mix test kinds, exceed 25 times the reference on any test or 12 times on the system score, or claim more multi-core speed than the threads allow. `outliers()` holds back runs over 1.6 times the median of at least five others on the same chip from the leaderboard and percentiles.
- Security headers on every response (CSP, frame denial, HSTS). Static files: browsers revalidate (ETag), Cloudflare's edge caches for five minutes.
- The static file list is an allowlist (`ALLOWED`); add new site files there and to `SITE` in `native/src/main.rs`.
- Computer-test hand-off: the finished run is POSTed to `/api/handoff` (no sign-in, kept a day) and the site opens at `#claim=TOKEN`; the run is saved to the account now or on sign-in.

## Computer test (`native/`)
- Rust, one binary: `cpu.rs`, `mem.rs`, `storage.rs` (direct I/O), `gpu.rs` (wgpu: Vulkan/Metal/DX12, same WGSL shaders as `tests/gpu.js`), `main.rs` (hardware detection, results file, hand-off, a fallback results page on localhost:4174).
- Flags: `--name --dir PATH --server URL --local --show-data --no-open --json-only --port N --connect KEY --disconnect`.
- What it sends: hardware model names and sizes, test results, laptop or desktop. Never the computer's name, user name, folder names or volume names (`device_name()` names the device after its processor).
- Build: `cd native && cargo build --release`. The site files are embedded with `include_str!`, so rebuild after changing the UI.
- Native tests have their own ids (`n_cpu_*`, `n_mem_*`, `n_sto_*`) and references; GPU tests share the `gpu_*` ids with the browser. The binary writes raw per-second rates; `normalise()` in `app.js` converts them once (`norm: true`).
- Releases: pushing a `v*` tag builds all four platforms, attaches them with SHA-256 sums and build provenance to a GitHub release. The site's download links point at the latest release.

@private/NOTES.md
