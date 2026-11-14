//! GPU tests through wgpu (Vulkan, Metal or DirectX 12). Same shaders and the same
//! workloads as the browser version in tests/gpu.js, so the scores share reference values.
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Instant;

const W: u32 = 1920;
const H: u32 = 1080;

const MATMUL: &str = r#"
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
}"#;

const PARTICLES: &str = r#"
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
}"#;

const FILL: &str = r#"
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
}"#;

const GEOM: &str = r#"
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
@fragment fn fs(i: VO) -> @location(0) vec4<f32> { return vec4<f32>(i.c, 1.0); }"#;

pub struct Info { pub name: String, pub backend: String, pub kind: String, pub driver: String, pub others: Vec<String> }

/// batch(k) submits k units of work, waits for the GPU and returns the work done. k doubles
/// until a batch takes about 40 ms so the round trip to the GPU does not cap the result.
fn gloop(ms: u64, max_k: u32, batch: &mut dyn FnMut(u32) -> u64) -> f64 {
    batch(1);
    let mut k = 1u32;
    loop { let t = Instant::now(); batch(k); if t.elapsed().as_millis() >= 40 || k >= max_k { break; } k *= 2; }
    let t0 = Instant::now(); let mut units = 0u64;
    loop { units += batch(k); let el = t0.elapsed(); if el.as_millis() as u64 >= ms { return units as f64 / el.as_secs_f64(); } }
}

fn wait(d: &wgpu::Device) { let _ = d.poll(wgpu::Maintain::Wait); }

fn f32_bytes(v: &[f32]) -> Vec<u8> { v.iter().flat_map(|x| x.to_le_bytes()).collect() }

fn storage_buf(d: &wgpu::Device, size: u64) -> wgpu::Buffer {
    d.create_buffer(&wgpu::BufferDescriptor { label: None, size, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: false })
}

fn compute_pipe(d: &wgpu::Device, code: &str) -> wgpu::ComputePipeline {
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(code.into()) });
    d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor { label: None, layout: None, module: &module, entry_point: Some("main"), compilation_options: Default::default(), cache: None })
}

fn bind(d: &wgpu::Device, layout: &wgpu::BindGroupLayout, bufs: &[&wgpu::Buffer]) -> wgpu::BindGroup {
    let entries: Vec<_> = bufs.iter().enumerate().map(|(i, b)| wgpu::BindGroupEntry { binding: i as u32, resource: b.as_entire_binding() }).collect();
    d.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout, entries: &entries })
}

fn matmul(d: &wgpu::Device, q: &wgpu::Queue, ms: u64) -> f64 {
    let n = 512u64; let bytes = n * n * 4;
    let (a, b, c) = (storage_buf(d, bytes), storage_buf(d, bytes), storage_buf(d, bytes));
    let data = f32_bytes(&(0..n * n).map(|i| (i % 97) as f32 / 97.0).collect::<Vec<_>>());
    q.write_buffer(&a, 0, &data); q.write_buffer(&b, 0, &data);
    let pipe = compute_pipe(d, MATMUL);
    let bg = bind(d, &pipe.get_bind_group_layout(0), &[&a, &b, &c]);
    gloop(ms, 1024, &mut |k| {
        let mut enc = d.create_command_encoder(&Default::default());
        { let mut p = enc.begin_compute_pass(&Default::default()); p.set_pipeline(&pipe); p.set_bind_group(0, &bg, &[]); for _ in 0..k { p.dispatch_workgroups(64, 64, 1); } }
        q.submit(Some(enc.finish())); wait(d); k as u64 * 2 * n * n * n
    }) / 1e9
}

fn particles(d: &wgpu::Device, q: &wgpu::Queue, ms: u64) -> f64 {
    let n = 1u32 << 20; let mut rng = crate::cpu::Lcg(7);
    let mut data = Vec::with_capacity(n as usize * 8);
    for _ in 0..n { for j in 0..8 { data.push(if j < 3 { rng.unit() as f32 * 2.0 - 1.0 } else if j == 3 { 1.0 } else { 0.0 }); } }
    let buf = storage_buf(d, n as u64 * 32);
    q.write_buffer(&buf, 0, &f32_bytes(&data));
    let pipe = compute_pipe(d, PARTICLES);
    let bg = bind(d, &pipe.get_bind_group_layout(0), &[&buf]);
    gloop(ms, 1024, &mut |k| {
        let mut enc = d.create_command_encoder(&Default::default());
        { let mut p = enc.begin_compute_pass(&Default::default()); p.set_pipeline(&pipe); p.set_bind_group(0, &bg, &[]); for _ in 0..k { p.dispatch_workgroups(n / 256, 1, 1); } }
        q.submit(Some(enc.finish())); wait(d); k as u64 * n as u64
    }) / 1e6
}

fn render(d: &wgpu::Device, q: &wgpu::Queue, ms: u64, code: &str, instances: u32, blend: bool, units: u64) -> f64 {
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let tex = d.create_texture(&wgpu::TextureDescriptor { label: None, size: wgpu::Extent3d { width: W, height: H, depth_or_array_layers: 1 }, mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format, usage: wgpu::TextureUsages::RENDER_ATTACHMENT, view_formats: &[] });
    let view = tex.create_view(&Default::default());
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(code.into()) });
    let pipe = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: None, layout: None,
        vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), buffers: &[], compilation_options: Default::default() },
        fragment: Some(wgpu::FragmentState { module: &module, entry_point: Some("fs"), compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState { format, blend: if blend { Some(wgpu::BlendState::ALPHA_BLENDING) } else { None }, write_mask: wgpu::ColorWrites::ALL })] }),
        primitive: Default::default(), depth_stencil: None, multisample: Default::default(), multiview: None, cache: None });
    gloop(ms, 1024, &mut |k| {
        let mut enc = d.create_command_encoder(&Default::default());
        { let mut p = enc.begin_render_pass(&wgpu::RenderPassDescriptor { label: None, depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None,
              color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &view, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store } })] });
          p.set_pipeline(&pipe); for _ in 0..k { p.draw(0..3, 0..instances); } }
        q.submit(Some(enc.finish())); wait(d); k as u64 * units
    }) / 1e6
}

fn upload(d: &wgpu::Device, q: &wgpu::Queue, ms: u64) -> f64 {
    let bytes = 16u64 << 20; let data: Vec<u8> = (0..bytes).map(|i| (i >> 12) as u8).collect();
    let buf = storage_buf(d, bytes);
    gloop(ms, 4, &mut |k| { for _ in 0..k { q.write_buffer(&buf, 0, &data); } q.submit(None); wait(d); k as u64 * bytes }) / (1u64 << 20) as f64
}

fn readback(d: &wgpu::Device, q: &wgpu::Queue, ms: u64) -> f64 {
    let bytes = 64u64 << 20;
    let src = storage_buf(d, bytes);
    let dst = d.create_buffer(&wgpu::BufferDescriptor { label: None, size: bytes, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
    let mut sink = 0u64;
    let r = gloop(ms, 1, &mut |_| {
        let mut enc = d.create_command_encoder(&Default::default());
        enc.copy_buffer_to_buffer(&src, 0, &dst, 0, bytes);
        q.submit(Some(enc.finish()));
        dst.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        wait(d);
        { let m = dst.slice(..).get_mapped_range(); for i in (0..bytes as usize).step_by(4096) { sink += m[i] as u64; } }
        dst.unmap(); bytes
    }) / (1u64 << 20) as f64;
    std::hint::black_box(sink); r
}

pub fn run(ms: u64, mut put: impl FnMut(&str, f64), mut fail: impl FnMut(&str, String), mut say: impl FnMut(&str)) -> Option<Info> {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, compatible_surface: None, force_fallback_adapter: false }))?;
    let ai = adapter.get_info();
    let others = instance.enumerate_adapters(wgpu::Backends::all()).into_iter().map(|a| a.get_info()).filter(|i| i.name != ai.name).map(|i| format!("{} ({:?})", i.name, i.backend)).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
    let info = Info { name: ai.name.clone(), backend: format!("{:?}", ai.backend), kind: format!("{:?}", ai.device_type), driver: format!("{} {}", ai.driver, ai.driver_info).trim().to_string(), others };
    let (device, queue) = match pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { label: None, required_features: wgpu::Features::empty(), required_limits: wgpu::Limits::default(), memory_hints: Default::default() }, None)) {
        Ok(x) => x, Err(e) => { fail("gpu", e.to_string()); return Some(info); } };
    let tests: [(&str, &str, &dyn Fn() -> f64); 6] = [
        ("gpu_matmul", "GPU · matrix compute", &|| matmul(&device, &queue, ms)),
        ("gpu_particles", "GPU · particle compute", &|| particles(&device, &queue, ms)),
        ("gpu_fill", "GPU · pixel shading", &|| render(&device, &queue, ms, FILL, 4, true, 4 * W as u64 * H as u64)),
        ("gpu_geom", "GPU · triangle throughput", &|| render(&device, &queue, ms, GEOM, 400_000, false, 400_000)),
        ("gpu_upload", "GPU · upload", &|| upload(&device, &queue, ms)),
        ("gpu_readback", "GPU · readback", &|| readback(&device, &queue, ms)),
    ];
    for (id, label, f) in tests {
        say(label);
        match catch_unwind(AssertUnwindSafe(f)) {
            Ok(v) => put(id, v),
            Err(e) => fail(id, e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_else(|| "GPU test crashed".into())),
        }
    }
    Some(info)
}
