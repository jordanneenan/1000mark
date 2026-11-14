// CPU and memory tests. The workloads are the computer test's own (native/kernels, a Rust crate),
// compiled to WebAssembly in kernels.wasm, so the browser and the computer test do the same work.
// The page runs one of these workers for one-core scores and several at once for the others:
// 'prep' gets a workload ready and warms it up, 'time' runs it for a set time and reports units/second.
const CPU = ['zip', 'json', 'script', 'path', 'db', 'image', 'ray', 'physics', 'matrix', 'sort'];   // the order in native/kernels/src/lib.rs
const MEM = ['fill', 'read', 'copy', 'chase', 'alloc'];
let wasm = null, run = null;

async function load() {
  if (wasm) return wasm;
  const url = new URL('kernels.wasm?v=dev', self.location.href);
  let inst;
  try { inst = (await WebAssembly.instantiateStreaming(fetch(url), {})).instance; }
  catch { inst = (await WebAssembly.instantiate(await (await fetch(url)).arrayBuffer(), {})).instance; }
  return (wasm = inst.exports);
}

// SHA-256 through the browser's built-in crypto, which uses the CPU's crypto instructions when it has them.
function cryptoTest() {
  if (!(self.crypto && crypto.subtle)) throw new Error('Built-in crypto needs a secure (https) page');
  const d = new Uint8Array(4 << 20); for (let i = 0; i < d.length; i += 4096) d[i] = i & 255;
  let sink = 0;
  return async () => { sink ^= new Uint8Array(await crypto.subtle.digest('SHA-256', d))[0]; return d.length; };
}

async function prep(test, bytes) {
  run = null;
  if (test === 'crypto') { run = cryptoTest(); }
  // Copying goes through the browser's own block copy. WebAssembly's copy instruction is a fifth of
  // that speed in Chromium, which would measure the instruction and not the memory.
  else if (test === 'copy') { if (wasm) wasm.k_free(); const src = new Uint8Array(bytes).fill(1), dst = new Uint8Array(bytes); run = () => { dst.set(src); return bytes; }; }
  else {
    const w = await load(), mem = MEM.indexOf(test), cpu = CPU.indexOf(test);
    if (mem < 0 && cpu < 0) throw new Error('Unknown test ' + test);
    if (!w.k_setup(mem >= 0 ? 1 : 0, mem >= 0 ? mem : cpu, bytes || 0)) throw new Error('Could not set up ' + test);
    run = () => w.k_run();
  }
  await run();                                         // warm up
}

async function timed(ms) {
  let units = 0, el = 0; const t0 = performance.now();
  do { units += await run(); el = performance.now() - t0; } while (el < ms);
  return units / (el / 1000);
}

self.onmessage = async e => {
  const { id, cmd, test, ms, bytes } = e.data;
  try {
    if (cmd === 'prep') { await prep(test, bytes); self.postMessage({ id, ok: true }); }
    else if (cmd === 'time') { if (!run) throw new Error('No test is ready'); self.postMessage({ id, rate: await timed(ms) }); }
    else if (cmd === 'free') { run = null; if (wasm) wasm.k_free(); self.postMessage({ id, ok: true }); }
  } catch (err) { wasm = null; run = null; self.postMessage({ id, error: String(err && err.message || err) }); }   // a crashed module is thrown away
};
