// GPU tests. WebGPU where the browser has it (compute + render + transfer),
// otherwise a smaller WebGL2 render-only fallback. Everything draws off-screen.
const msg = e => String(e && e.message || e);
const W = 1920, H = 1080;

// batch(k) submits k units of work in one go, waits for the GPU to finish and returns how much
// work that was. k is doubled until one batch takes about 40 ms, so the result measures the GPU
// and not the fixed cost of a round trip to it (which would cap fast GPUs).
async function loop(ms, batch, maxK = 1024) {
  await batch(1);
  let k = 1;
  for (;;) { const t = performance.now(); await batch(k); if (performance.now() - t >= 40 || k >= maxK) break; k *= 2; }
  let units = 0, el = 0; const t0 = performance.now();
  do { units += await batch(k); el = performance.now() - t0; } while (el < ms);
  return units / (el / 1000);
}

// ---------- WGSL ----------
const MATMUL = `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> c: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = 512u;
  if (id.x >= n || id.y >= n) { return; }
  var s = 0.0;
  for (var k = 0u; k < n; k = k + 1u) { s = s + a[id.y * n + k] * b[k * n + id.x]; }
  c[id.y * n + id.x] = s;
}`;

const PARTICLES = `
struct Pt { pos: vec4<f32>, vel: vec4<f32> }
@group(0) @binding(0) var<storage, read_write> p: array<Pt>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= arrayLength(&p)) { return; }
  var q = p[i];
  let d = -q.pos.xyz;
  let r2 = dot(d, d) + 0.01;
  let v = q.vel.xyz + d * (0.0001 / (r2 * sqrt(r2)));
  let s = sin(q.pos.x * 3.0) * cos(q.pos.y * 3.0);
  q.vel = vec4<f32>(v, 0.0);
  q.pos = vec4<f32>(q.pos.xyz + v * 0.01 + vec3<f32>(s) * 0.0001, 1.0);
  p[i] = q;
}`;

const FILL = `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
fn hash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2<f32>(1.0, 0.0)), u.x), mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
@fragment fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  var p = pos.xy / 200.0; var v = 0.0; var a = 0.5;
  for (var i = 0; i < 8; i = i + 1) { v = v + a * noise(p); p = p * 2.03 + vec2<f32>(1.7, 9.2); a = a * 0.5; }
  return vec4<f32>(v, v * v, 1.0 - v, 0.5);
}`;

const GEOM = `
struct VO { @builtin(position) pos: vec4<f32>, @location(0) c: vec3<f32> }
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) inst: u32) -> VO {
  let fi = f32(inst);
  let cx = fract(fi * 0.6180339) * 2.0 - 1.0;
  let cy = fract(fi * 0.7548776) * 2.0 - 1.0;
  let ang = fi * 0.1 + f32(v) * 2.0943951;
  var o: VO;
  o.pos = vec4<f32>(cx + cos(ang) * 0.004, cy + sin(ang) * 0.004, 0.5, 1.0);
  o.c = vec3<f32>(fract(fi * 0.13), fract(fi * 0.71), 0.5);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4<f32> { return vec4<f32>(i.c, 1.0); }`;

// ---------- WebGPU tests ----------
const done = d => d.queue.onSubmittedWorkDone();

async function matmul(d, ms) {
  const n = 512, bytes = n * n * 4, S = GPUBufferUsage.STORAGE;
  const a = d.createBuffer({ size: bytes, usage: S | GPUBufferUsage.COPY_DST }), b = d.createBuffer({ size: bytes, usage: S | GPUBufferUsage.COPY_DST }), c = d.createBuffer({ size: bytes, usage: S });
  const data = new Float32Array(n * n); for (let i = 0; i < data.length; i++) data[i] = (i % 97) / 97;
  d.queue.writeBuffer(a, 0, data); d.queue.writeBuffer(b, 0, data);
  const pipe = await d.createComputePipelineAsync({ layout: 'auto', compute: { module: d.createShaderModule({ code: MATMUL }), entryPoint: 'main' } });
  const bind = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [a, b, c].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const r = await loop(ms, async k => {
    const enc = d.createCommandEncoder(), p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, bind);
    for (let i = 0; i < k; i++) p.dispatchWorkgroups(n / 8, n / 8);
    p.end(); d.queue.submit([enc.finish()]); await done(d); return k * 2 * n * n * n;
  });
  a.destroy(); b.destroy(); c.destroy();
  return r / 1e9;                                      // GFLOP/s
}

async function particles(d, ms) {
  const N = 1 << 20, data = new Float32Array(N * 8);
  for (let i = 0; i < N; i++) { data[i * 8] = Math.random() * 2 - 1; data[i * 8 + 1] = Math.random() * 2 - 1; data[i * 8 + 2] = Math.random() * 2 - 1; data[i * 8 + 3] = 1; }
  const buf = d.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  d.queue.writeBuffer(buf, 0, data);
  const pipe = await d.createComputePipelineAsync({ layout: 'auto', compute: { module: d.createShaderModule({ code: PARTICLES }), entryPoint: 'main' } });
  const bind = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
  const r = await loop(ms, async k => {
    const enc = d.createCommandEncoder(), p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, bind);
    for (let i = 0; i < k; i++) p.dispatchWorkgroups(N / 256);
    p.end(); d.queue.submit([enc.finish()]); await done(d); return k * N;
  });
  buf.destroy();
  return r / 1e6;                                      // million particle updates/s
}

async function render(d, ms, code, instances, blend, unitsPerDraw) {
  const tex = d.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const view = tex.createView(), module = d.createShaderModule({ code });
  const target = { format: 'rgba8unorm' };
  if (blend) target.blend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const pipe = await d.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [target] }, primitive: { topology: 'triangle-list' } });
  const r = await loop(ms, async k => {
    const enc = d.createCommandEncoder();
    const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    p.setPipeline(pipe); for (let i = 0; i < k; i++) p.draw(3, instances); p.end();
    d.queue.submit([enc.finish()]); await done(d); return k * unitsPerDraw;
  });
  tex.destroy();
  return r / 1e6;
}

async function upload(d, ms) {
  const bytes = 16 * 1048576, data = new Uint8Array(bytes); for (let i = 0; i < bytes; i += 4096) data[i] = i & 255;
  const buf = d.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE });
  const r = await loop(ms, async k => { for (let i = 0; i < k; i++) d.queue.writeBuffer(buf, 0, data); await done(d); return k * bytes; }, 4);
  buf.destroy();
  return r / 1048576;                                  // MB/s
}

async function readback(d, ms) {
  const bytes = 64 * 1048576;
  const src = d.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const dst = d.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let sink = 0;
  const r = await loop(ms, async () => {
    const enc = d.createCommandEncoder(); enc.copyBufferToBuffer(src, 0, dst, 0, bytes); d.queue.submit([enc.finish()]);
    await dst.mapAsync(GPUMapMode.READ); const m = new Uint8Array(dst.getMappedRange()); for (let i = 0; i < bytes; i += 4096) sink += m[i]; dst.unmap(); return bytes;
  }, 1);
  src.destroy(); dst.destroy();
  return r / 1048576;
}

async function runWebGPU(ms, out, progress) {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return false;
  const device = await adapter.requestDevice();
  const info = adapter.info || {};
  out.api = 'WebGPU';
  out.adapter = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' · ') || 'Unknown adapter';
  let lost = null; device.lost.then(i => { lost = i.message || 'GPU device lost'; });
  const tests = [
    ['gpu_matmul', 'GPU · matrix compute', () => matmul(device, ms)],
    ['gpu_particles', 'GPU · particle compute', () => particles(device, ms)],
    ['gpu_fill', 'GPU · pixel shading', () => render(device, ms, FILL, 4, true, 4 * W * H)],
    ['gpu_geom', 'GPU · triangle throughput', () => render(device, ms, GEOM, 400000, false, 400000)],
    ['gpu_upload', 'GPU · upload', () => upload(device, ms)],
    ['gpu_readback', 'GPU · readback', () => readback(device, ms)],
  ];
  for (const [id, label, fn] of tests) {
    progress(label);
    if (lost) { out.errors[id] = lost; continue; }
    try {
      device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
      const v = await fn();
      const oom = await device.popErrorScope(), val = await device.popErrorScope();
      if (oom || val) throw new Error((oom || val).message);
      out.values[id] = v;
    } catch (e) { out.errors[id] = msg(e); }
  }
  device.destroy();
  return true;
}

// ---------- WebGL2 fallback ----------
const GL_FILL_VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const GL_FILL_FS = `#version 300 es
precision highp float; out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
void main(){ vec2 p = gl_FragCoord.xy / 200.0; float v = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  o = vec4(v, v * v, 1.0 - v, 0.5); }`;
const GL_GEOM_VS = `#version 300 es
out vec3 c;
void main(){ float fi = float(gl_InstanceID);
  float cx = fract(fi * 0.6180339) * 2.0 - 1.0, cy = fract(fi * 0.7548776) * 2.0 - 1.0;
  float ang = fi * 0.1 + float(gl_VertexID) * 2.0943951;
  gl_Position = vec4(cx + cos(ang) * 0.004, cy + sin(ang) * 0.004, 0.5, 1.0);
  c = vec3(fract(fi * 0.13), fract(fi * 0.71), 0.5); }`;
const GL_GEOM_FS = `#version 300 es
precision highp float; in vec3 c; out vec4 o; void main(){ o = vec4(c, 1.0); }`;

function glProgram(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export function glRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { return ''; }
}

async function runWebGL(ms, out, progress) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  if (!gl) return false;
  out.api = 'WebGL2';
  out.adapter = glRenderer() || 'Unknown adapter';
  gl.bindVertexArray(gl.createVertexArray());
  gl.viewport(0, 0, W, H);
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // forces the GPU to finish
  const yieldUI = () => new Promise(r => setTimeout(r, 0));
  progress('GPU · pixel shading (WebGL)');
  try {
    gl.useProgram(glProgram(gl, GL_FILL_VS, GL_FILL_FS));
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    out.values.gl_fill = await loop(ms, async k => { for (let i = 0; i < 4 * k; i++) gl.drawArrays(gl.TRIANGLES, 0, 3); sync(); await yieldUI(); return 4 * k * W * H; }, 256) / 1e6;
  } catch (e) { out.errors.gl_fill = msg(e); }
  progress('GPU · triangle throughput (WebGL)');
  try {
    gl.useProgram(glProgram(gl, GL_GEOM_VS, GL_GEOM_FS));
    gl.disable(gl.BLEND);
    out.values.gl_geom = await loop(ms, async k => { for (let i = 0; i < k; i++) gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 200000); sync(); await yieldUI(); return k * 200000; }, 256) / 1e6;
  } catch (e) { out.errors.gl_geom = msg(e); }
  const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  return true;
}

export async function runGpu({ ms, progress }) {
  const out = { api: null, adapter: '', values: {}, errors: {} };
  try { if (navigator.gpu && await runWebGPU(ms, out, progress)) return out; }
  catch (e) { out.errors.webgpu = msg(e); }
  try { if (await runWebGL(ms, out, progress)) return out; }
  catch (e) { out.errors.webgl = msg(e); }
  if (!out.api) out.errors.gpu = 'This browser offers neither WebGPU nor WebGL2, so the GPU could not be tested.';
  return out;
}
