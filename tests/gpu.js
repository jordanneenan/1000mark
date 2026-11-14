// GPU tests. WebGPU where the browser has it (compute + render + transfer),
// otherwise a smaller WebGL2 render-only fallback. Everything draws off-screen.
const msg = e => String(e && e.message || e);
// Every test is timed three times and the middle result kept.
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const thrice = async fn => median([await fn(), await fn(), await fn()]);
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

// Game-like scene: 2,000 lit, textured spheres of 2,048 triangles each, one draw call apiece with
// its own uniforms (as a game sets per object), a depth buffer and a mipmapped texture, at 1080p.
const SCENE = `
struct Obj { pos: vec4<f32>, col: vec4<f32> }
@group(0) @binding(0) var<uniform> obj: Obj;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
struct VO { @builtin(position) pos: vec4<f32>, @location(0) n: vec3<f32>, @location(1) uv: vec2<f32>, @location(2) w: vec3<f32> }
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  let tri = vi / 3u; let corner = vi % 3u; let quad = tri / 2u; let second = tri % 2u;
  var seg = quad % 32u; var ring = quad / 32u;
  if (second == 0u) { if (corner == 1u) { seg = seg + 1u; } else if (corner == 2u) { ring = ring + 1u; } }
  else { if (corner == 0u) { seg = seg + 1u; } else if (corner == 1u) { seg = seg + 1u; ring = ring + 1u; } else { ring = ring + 1u; } }
  let th = f32(ring) / 32.0 * 3.14159265; let ph = f32(seg) / 32.0 * 6.2831853;
  let n = vec3<f32>(sin(th) * cos(ph), cos(th), sin(th) * sin(ph));
  let w = obj.pos.xyz + n * obj.pos.w;
  let f = 1.7320508; let near = 0.1; let far = 200.0;
  var o: VO;
  o.pos = vec4<f32>(w.x * f / 1.7777778, w.y * f, w.z * far / (far - near) - near * far / (far - near), w.z);
  o.n = n; o.uv = vec2<f32>(f32(seg) / 8.0, f32(ring) / 8.0); o.w = w;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4<f32> {
  let n = normalize(i.n); let v = normalize(-i.w);
  let t = textureSample(tex, smp, i.uv).rgb * obj.col.rgb;
  let l1 = normalize(vec3<f32>(0.5, 0.8, -0.3)); let l2 = normalize(vec3<f32>(-0.7, 0.2, -0.5));
  let d = max(dot(n, l1), 0.0) * 0.8 + max(dot(n, l2), 0.0) * 0.35 + 0.1;
  let s = pow(max(dot(n, normalize(l1 + v)), 0.0), 32.0) * 0.6;
  return vec4<f32>(t * d + vec3<f32>(s), 1.0);
}`;
const SCENE_OBJS = 2000, SCENE_VERTS = 32 * 32 * 6, TEX = 512, TEX_MIPS = 10;
// Object k: position and radius (pos.w) and a colour, the same in the browser and the computer test.
function sceneObjects() {
  const f = new Float32Array(SCENE_OBJS * 64);           // 256 bytes per object (uniform offset alignment)
  for (let k = 0; k < SCENE_OBJS; k++) {
    const gx = k % 50, gy = Math.floor(k / 50) % 8, gz = Math.floor(k / 400);
    f.set([(gx - 24.5) * 1.25, (gy - 3.5) * 2.6, 22 + gz * 9 + (gx % 3), 1.2, 0.6 + 0.4 * ((k * 7) % 5) / 4, 0.6 + 0.4 * ((k * 3) % 7) / 6, 0.7, 1], k * 64);
  }
  return f;
}
// Texture level L: a checker with a fine diagonal pattern, worked out in whole numbers so both tests match.
function texLevel(L) {
  const s = TEX >> L, d = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const X = x << L, Y = y << L, c = ((X >> 5) ^ (Y >> 5)) & 1, g = ((X + Y) >> 2) & 7, i = (y * s + x) * 4;
    d[i] = 120 + c * 100 + g * 4; d[i + 1] = 90 + c * 60 + g * 8; d[i + 2] = 160 - c * 70 + g * 6; d[i + 3] = 255;
  }
  return d;
}

// Ray tracing: a 256 x 256 landscape (131,072 triangles) with a bounding-volume tree made by halving
// the grid, so it is the same tree everywhere. One camera ray and one shadow ray per pixel at 1080p.
const RT_GRID = 256;
const terrainH = (x, z) => 6 * Math.sin(x * 0.05) * Math.cos(z * 0.07) + 3 * Math.sin(x * 0.13 + z * 0.11) + 1.5 * Math.sin(x * 0.31 - z * 0.27);
export function rtScene() {
  const G = RT_GRID, H = new Float32Array((G + 1) * (G + 1));
  for (let z = 0; z <= G; z++) for (let x = 0; x <= G; x++) H[z * (G + 1) + x] = terrainH(x, z);
  const verts = new Float32Array(G * G * 2 * 9), tris = new Float32Array(G * G * 2 * 12);
  const nodeF = new Float32Array((G * G) * 8), nodeU = new Uint32Array(nodeF.buffer);
  let nt = 0, nn = 0;
  const P = (x, z) => [x, H[z * (G + 1) + x], z];
  const emit = (a, b, c) => {
    verts.set([...a, ...b, ...c], nt * 9);
    tris.set([a[0], a[1], a[2], 0, b[0] - a[0], b[1] - a[1], b[2] - a[2], 0, c[0] - a[0], c[1] - a[1], c[2] - a[2], 0], nt * 12); nt++;
  };
  const build = (x0, z0, x1, z1) => {
    const ni = nn++;
    let lo, hi;
    if ((x1 - x0) * (z1 - z0) <= 2) {
      const first = nt;
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { emit(P(x, z), P(x + 1, z), P(x + 1, z + 1)); emit(P(x, z), P(x + 1, z + 1), P(x, z + 1)); }
      lo = [Infinity, Infinity, Infinity]; hi = [-Infinity, -Infinity, -Infinity];
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const p = new Float32Array(P(x, z)); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } }
      nodeU[ni * 8 + 3] = first; nodeU[ni * 8 + 7] = nt - first;
    } else {
      let r;
      if (x1 - x0 >= z1 - z0) { const m = (x0 + x1) >> 1; build(x0, z0, m, z1); r = build(m, z0, x1, z1); }
      else { const m = (z0 + z1) >> 1; build(x0, z0, x1, m); r = build(x0, m, x1, z1); }
      const l = ni + 1;
      lo = [0, 1, 2].map(k => Math.min(nodeF[l * 8 + k], nodeF[r * 8 + k])); hi = [0, 1, 2].map(k => Math.max(nodeF[l * 8 + 4 + k], nodeF[r * 8 + 4 + k]));
      nodeU[ni * 8 + 3] = r; nodeU[ni * 8 + 7] = 0;
    }
    nodeF.set(lo, ni * 8); nodeF.set(hi, ni * 8 + 4);
    return ni;
  };
  build(0, 0, G, G);
  return { nodes: new Uint32Array(nodeU.buffer, 0, nn * 8), tris, verts, count: nt };
}
const RT_COMMON = `
const W = 1920u; const H = 1080u;
fn camRay(id: vec2<u32>) -> vec3<f32> {
  let fwd = normalize(vec3<f32>(0.0, -60.0, 190.0)); let right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), fwd)); let up = cross(fwd, right);
  let uv = (vec2<f32>(id) + 0.5) / vec2<f32>(f32(W), f32(H)) * 2.0 - 1.0;
  let th = 0.41421356;
  return normalize(fwd + right * uv.x * th * 1.7777778 - up * uv.y * th);
}
const CAM = vec3<f32>(128.0, 60.0, -30.0);
const SUN = vec3<f32>(0.42426407, 0.56568542, 0.70710678);`;
const RAYS = RT_COMMON + `
struct Node { lo: vec4<f32>, hi: vec4<f32> }
@group(0) @binding(0) var<storage, read> nodes: array<Node>;
@group(0) @binding(1) var<storage, read> tris: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outp: array<u32>;
fn triHit(o: vec3<f32>, d: vec3<f32>, i: u32) -> f32 {
  let v0 = tris[3u * i].xyz; let e1 = tris[3u * i + 1u].xyz; let e2 = tris[3u * i + 2u].xyz;
  let p = cross(d, e2); let det = dot(e1, p);
  if (abs(det) < 1e-9) { return 1e30; }
  let inv = 1.0 / det; let s = o - v0; let u = dot(s, p) * inv;
  if (u < 0.0 || u > 1.0) { return 1e30; }
  let q = cross(s, e1); let v = dot(d, q) * inv;
  if (v < 0.0 || u + v > 1.0) { return 1e30; }
  return dot(e2, q) * inv;
}
fn trace(o: vec3<f32>, d: vec3<f32>, anyHit: bool) -> f32 {
  let inv = 1.0 / select(d, vec3<f32>(1e-9), abs(d) < vec3<f32>(1e-9));
  var stack: array<u32, 32>; var sp = 1u; stack[0] = 0u; var best = 1e30; var steps = 0u;
  loop {
    if (sp == 0u || steps >= 8192u) { break; }
    steps = steps + 1u; sp = sp - 1u;
    let ni = stack[sp]; let n = nodes[ni];
    let t0 = (n.lo.xyz - o) * inv; let t1 = (n.hi.xyz - o) * inv;
    let tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
    let tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
    if (tf < max(tn, 0.0) || tn >= best) { continue; }
    let a = bitcast<u32>(n.lo.w); let cnt = bitcast<u32>(n.hi.w);
    if (cnt > 0u) {
      for (var i = 0u; i < min(cnt, 8u); i = i + 1u) { let t = triHit(o, d, a + i); if (t > 1e-4 && t < best) { best = t; if (anyHit) { return best; } } }
    } else if (sp < 31u) { stack[sp] = a; stack[sp + 1u] = ni + 1u; sp = sp + 2u; }
  }
  return best;
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= W || id.y >= H) { return; }
  let d = camRay(id.xy);
  let t = trace(CAM, d, false);
  let p = CAM + d * min(t, 1000.0) + vec3<f32>(0.0, 0.01, 0.0);
  let s = trace(p, SUN, true);
  outp[id.y * W + id.x] = select(0u, 1u, t < 1e29) + select(0u, 2u, s < 1e29);
}`;

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

async function scene(d, ms) {
  const fmt = 'rgba8unorm';
  const color = d.createTexture({ size: [W, H], format: fmt, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const depth = d.createTexture({ size: [W, H], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const tex = d.createTexture({ size: [TEX, TEX], format: fmt, mipLevelCount: TEX_MIPS, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  for (let L = 0; L < TEX_MIPS; L++) { const s = TEX >> L; d.queue.writeTexture({ texture: tex, mipLevel: L }, texLevel(L), { bytesPerRow: s * 4 }, [s, s]); }
  const ubuf = d.createBuffer({ size: SCENE_OBJS * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  d.queue.writeBuffer(ubuf, 0, sceneObjects());
  const smp = d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 });
  const bgl = d.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
  const bind = d.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubuf, size: 32 } }, { binding: 1, resource: tex.createView() }, { binding: 2, resource: smp }] });
  const module = d.createShaderModule({ code: SCENE });
  const pipe = await d.createRenderPipelineAsync({ layout: d.createPipelineLayout({ bindGroupLayouts: [bgl] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: fmt }] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' } });
  const cv = color.createView(), dv = depth.createView();
  const r = await loop(ms, async k => {
    const enc = d.createCommandEncoder();
    for (let f = 0; f < k; f++) {
      const p = enc.beginRenderPass({ colorAttachments: [{ view: cv, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.5, g: 0.6, b: 0.7, a: 1 } }], depthStencilAttachment: { view: dv, depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'store' } });
      p.setPipeline(pipe);
      for (let o = 0; o < SCENE_OBJS; o++) { p.setBindGroup(0, bind, [o * 256]); p.draw(SCENE_VERTS); }
      p.end();
    }
    d.queue.submit([enc.finish()]); await done(d); return k;
  }, 64);
  color.destroy(); depth.destroy(); tex.destroy(); ubuf.destroy();
  return r;                                            // frames/s
}

async function rays(d, ms) {
  const sc = rtScene(), S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const nodes = d.createBuffer({ size: sc.nodes.byteLength, usage: S }), tris = d.createBuffer({ size: sc.tris.byteLength, usage: S }), out = d.createBuffer({ size: W * H * 4, usage: GPUBufferUsage.STORAGE });
  d.queue.writeBuffer(nodes, 0, sc.nodes); d.queue.writeBuffer(tris, 0, sc.tris);
  const pipe = await d.createComputePipelineAsync({ layout: 'auto', compute: { module: d.createShaderModule({ code: RAYS }), entryPoint: 'main' } });
  const bind = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [nodes, tris, out].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const r = await loop(ms, async k => {
    const enc = d.createCommandEncoder(), p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, bind);
    for (let i = 0; i < k; i++) p.dispatchWorkgroups(W / 8, Math.ceil(H / 8));
    p.end(); d.queue.submit([enc.finish()]); await done(d); return k * 2 * W * H;
  }, 256);
  nodes.destroy(); tris.destroy(); out.destroy();
  return r / 1e6;                                      // million rays/s
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

const GPU_TESTS = {
  gpu_matmul: ['GPU · matrix compute', (d, ms) => matmul(d, ms)],
  gpu_particles: ['GPU · particle compute', (d, ms) => particles(d, ms)],
  gpu_fill: ['GPU · pixel shading', (d, ms) => render(d, ms, FILL, 4, true, 4 * W * H)],
  gpu_geom: ['GPU · triangle throughput', (d, ms) => render(d, ms, GEOM, 400000, false, 400000)],
  gpu_scene: ['GPU · game-like scene', (d, ms) => scene(d, ms)],
  gpu_rays: ['GPU · ray tracing', (d, ms) => rays(d, ms)],
  gpu_upload: ['GPU · upload', (d, ms) => upload(d, ms)],
  gpu_readback: ['GPU · readback', (d, ms) => readback(d, ms)],
};
// For the heat test: time some tests once each, on a device of their own. Returns { id: value }.
export async function gpuOnce(ids, ms) {
  const out = {};
  try {
    const adapter = navigator.gpu && await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return out;
    const device = await adapter.requestDevice();
    for (const id of ids) { try { out[id] = await GPU_TESTS[id][1](device, ms); } catch {} }
    device.destroy();
  } catch {}
  return out;
}

async function runWebGPU(ms, out, progress) {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return false;
  const device = await adapter.requestDevice();
  const info = adapter.info || {};
  out.api = 'WebGPU';
  out.adapter = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' · ') || 'Unknown adapter';
  let lost = null; device.lost.then(i => { lost = i.message || 'GPU device lost'; });
  for (const [id, [label, fn]] of Object.entries(GPU_TESTS)) {
    progress(label);
    if (lost) { out.errors[id] = lost; continue; }
    try {
      device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
      const v = await thrice(() => fn(device, ms));
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
    out.values.gl_fill = await thrice(() => loop(ms, async k => { for (let i = 0; i < 4 * k; i++) gl.drawArrays(gl.TRIANGLES, 0, 3); sync(); await yieldUI(); return 4 * k * W * H; }, 256)) / 1e6;
  } catch (e) { out.errors.gl_fill = msg(e); }
  progress('GPU · triangle throughput (WebGL)');
  try {
    gl.useProgram(glProgram(gl, GL_GEOM_VS, GL_GEOM_FS));
    gl.disable(gl.BLEND);
    out.values.gl_geom = await thrice(() => loop(ms, async k => { for (let i = 0; i < k; i++) gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 200000); sync(); await yieldUI(); return k * 200000; }, 256)) / 1e6;
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
