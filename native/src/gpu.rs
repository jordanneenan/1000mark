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

pub struct Info { pub name: String, pub backend: String, pub kind: String, pub driver: String, pub others: Vec<String>, pub vram: Option<(f64, bool)> }

// The newer shaders are read out of tests/gpu.js, so the browser and the computer test cannot drift apart.
const GPU_JS: &str = include_str!("../../tests/gpu.js");
fn js_shader(name: &str) -> String {
    let start = GPU_JS.find(&format!("const {name} = ")).unwrap_or_else(|| panic!("{name} missing from gpu.js"));
    let body = &GPU_JS[start..]; let open = body.find('`').unwrap() + 1; let close = body[open..].find("`;").unwrap();
    body[open..open + close].to_string()
}
fn rt_common() -> String { js_shader("RT_COMMON") }
fn rays_shader() -> String { rt_common() + &js_shader("RAYS") }
const SCENE_OBJS: u32 = 2000; const SCENE_VERTS: u32 = 32 * 32 * 6; const TEX: u32 = 512; const TEX_MIPS: u32 = 10;

/// Same as sceneObjects() in gpu.js: position, radius and colour of each object, 256 bytes apart.
fn scene_objects() -> Vec<f32> {
    let mut f = vec![0f32; SCENE_OBJS as usize * 64];
    for k in 0..SCENE_OBJS as usize {
        let (gx, gy, gz) = (k % 50, (k / 50) % 8, k / 400);
        let v = [(gx as f32 - 24.5) * 1.25, (gy as f32 - 3.5) * 2.6, 22.0 + gz as f32 * 9.0 + (gx % 3) as f32, 1.2,
            0.6 + 0.4 * ((k * 7) % 5) as f32 / 4.0, 0.6 + 0.4 * ((k * 3) % 7) as f32 / 6.0, 0.7, 1.0];
        f[k * 64..k * 64 + 8].copy_from_slice(&v);
    }
    f
}
/// Same as texLevel() in gpu.js.
fn tex_level(l: u32) -> Vec<u8> {
    let s = TEX >> l; let mut d = vec![0u8; (s * s * 4) as usize];
    for y in 0..s { for x in 0..s {
        let (xx, yy) = (x << l, y << l); let c = ((xx >> 5) ^ (yy >> 5)) & 1; let g = ((xx + yy) >> 2) & 7; let i = ((y * s + x) * 4) as usize;
        d[i] = (120 + c * 100 + g * 4) as u8; d[i + 1] = (90 + c * 60 + g * 8) as u8; d[i + 2] = (160 - c * 70 + g * 6) as u8; d[i + 3] = 255;
    } }
    d
}

pub struct RtScene { pub nodes: Vec<u32>, pub tris: Vec<f32>, pub verts: Vec<f32>, pub count: u32 }
/// Same as rtScene() in gpu.js: a 256 x 256 landscape and a bounding-volume tree made by halving the grid.
pub fn rt_scene() -> RtScene {
    const G: usize = 256;
    let mut h = vec![0f32; (G + 1) * (G + 1)];
    for z in 0..=G { for x in 0..=G { let (xf, zf) = (x as f64, z as f64);
        h[z * (G + 1) + x] = (6.0 * (xf * 0.05).sin() * (zf * 0.07).cos() + 3.0 * (xf * 0.13 + zf * 0.11).sin() + 1.5 * (xf * 0.31 - zf * 0.27).sin()) as f32; } }
    let p = |x: usize, z: usize| [x as f32, h[z * (G + 1) + x], z as f32];
    struct B<'a> { p: &'a dyn Fn(usize, usize) -> [f32; 3], nodes: Vec<u32>, tris: Vec<f32>, verts: Vec<f32>, nt: u32 }
    fn emit(b: &mut B, a: [f32; 3], c1: [f32; 3], c2: [f32; 3]) {
        b.verts.extend_from_slice(&[a[0], a[1], a[2], c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]]);
        b.tris.extend_from_slice(&[a[0], a[1], a[2], 0.0, c1[0] - a[0], c1[1] - a[1], c1[2] - a[2], 0.0, c2[0] - a[0], c2[1] - a[1], c2[2] - a[2], 0.0]); b.nt += 1;
    }
    fn build(b: &mut B, x0: usize, z0: usize, x1: usize, z1: usize) -> usize {
        let ni = b.nodes.len() / 8; b.nodes.extend_from_slice(&[0; 8]);
        let (mut lo, mut hi) = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
        if (x1 - x0) * (z1 - z0) <= 2 {
            let first = b.nt;
            for z in z0..z1 { for x in x0..x1 {
                let (a, c, d, e) = ((b.p)(x, z), (b.p)(x + 1, z), (b.p)(x + 1, z + 1), (b.p)(x, z + 1));
                emit(b, a, c, d); emit(b, a, d, e);
            } }
            for z in z0..=z1 { for x in x0..=x1 { let q = (b.p)(x, z); for k in 0..3 { lo[k] = lo[k].min(q[k]); hi[k] = hi[k].max(q[k]); } } }
            b.nodes[ni * 8 + 3] = first; b.nodes[ni * 8 + 7] = b.nt - first;
        } else {
            let r = if x1 - x0 >= z1 - z0 { let m = (x0 + x1) >> 1; build(b, x0, z0, m, z1); build(b, m, z0, x1, z1) }
                    else { let m = (z0 + z1) >> 1; build(b, x0, z0, x1, m); build(b, x0, m, x1, z1) };
            let l = ni + 1; let f = |i: usize| f32::from_bits(b.nodes[i]);
            for k in 0..3 { lo[k] = f(l * 8 + k).min(f(r * 8 + k)); hi[k] = f(l * 8 + 4 + k).max(f(r * 8 + 4 + k)); }
            b.nodes[ni * 8 + 3] = r as u32; b.nodes[ni * 8 + 7] = 0;
        }
        for k in 0..3 { b.nodes[ni * 8 + k] = lo[k].to_bits(); b.nodes[ni * 8 + 4 + k] = hi[k].to_bits(); }
        ni
    }
    let mut b = B { p: &p, nodes: Vec::new(), tris: Vec::new(), verts: Vec::new(), nt: 0 };
    build(&mut b, 0, 0, G, G);
    RtScene { nodes: b.nodes, tris: b.tris, verts: b.verts, count: b.nt }
}

/// The ray-tracing scene through the GPU's ray-tracing hardware (ray queries). Same rays as RAYS.
const RT_HW: &str = r#"
@group(0) @binding(0) var acc: acceleration_structure;
@group(0) @binding(1) var<storage, read_write> outp: array<u32>;
fn shoot(o: vec3<f32>, d: vec3<f32>, flags: u32) -> f32 {
  var rq: ray_query;
  rayQueryInitialize(&rq, acc, RayDesc(flags, 0xFFu, 1e-4, 1e30, o, d));
  rayQueryProceed(&rq);
  let h = rayQueryGetCommittedIntersection(&rq);
  if (h.kind == 0u) { return 1e30; }
  return h.t;
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= W || id.y >= H) { return; }
  let d = camRay(id.xy);
  let t = shoot(CAM, d, 1u);
  let p = CAM + d * min(t, 1000.0) + vec3<f32>(0.0, 0.01, 0.0);
  let s = shoot(p, SUN, 5u);
  outp[id.y * W + id.x] = select(0u, 1u, t < 1e29) + select(0u, 2u, s < 1e29);
}"#;

/// batch(k) submits k units of work, waits for the GPU and returns the work done. k doubles
/// until a batch takes about 40 ms so the round trip to the GPU does not cap the result.
fn gloop(ms: u64, max_k: u32, batch: &mut dyn FnMut(u32) -> u64) -> f64 {
    batch(1);
    let mut k = 1u32;
    // Double k until a batch takes 40 ms, timing each size twice and trusting the quicker go, so one
    // hiccup cannot stop the search early and leave the test measuring round trips.
    loop { let mut el = u128::MAX; for _ in 0..2 { let t = Instant::now(); batch(k); el = el.min(t.elapsed().as_millis()); } if el >= 40 || k >= max_k { break; } k *= 2; }
    let t0 = Instant::now(); let mut units = 0u64;
    loop { units += batch(k); let el = t0.elapsed(); if el.as_millis() as u64 >= ms { return units as f64 / el.as_secs_f64(); } }
}

fn wait(d: &wgpu::Device) { let _ = d.poll(wgpu::Maintain::Wait); }

fn f32_bytes(v: &[f32]) -> Vec<u8> { v.iter().flat_map(|x| x.to_le_bytes()).collect() }

fn storage_buf(d: &wgpu::Device, size: u64) -> wgpu::Buffer {
    d.create_buffer(&wgpu::BufferDescriptor { label: None, size, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: false })
}

/// The shaders are our own, check their own bounds and have bounded loops, so wgpu need not add
/// bounds checks. On Metal it otherwise wraps every buffer read in one, which made matrix compute
/// run at a third of the browser's speed on Apple GPUs (Vulkan and DX12 check in hardware).
fn shader(d: &wgpu::Device, code: &str) -> wgpu::ShaderModule {
    unsafe { d.create_shader_module_trusted(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(code.into()) }, wgpu::ShaderRuntimeChecks::unchecked()) }
}

fn compute_pipe(d: &wgpu::Device, code: &str) -> wgpu::ComputePipeline {
    let module = shader(d, code);
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
    let module = shader(d, code);
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

fn scene(d: &wgpu::Device, q: &wgpu::Queue, ms: u64) -> f64 {
    let fmt = wgpu::TextureFormat::Rgba8Unorm;
    let tex2d = |w: u32, h: u32, format, mips, usage| d.create_texture(&wgpu::TextureDescriptor { label: None, size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 }, mip_level_count: mips, sample_count: 1, dimension: wgpu::TextureDimension::D2, format, usage, view_formats: &[] });
    let color = tex2d(W, H, fmt, 1, wgpu::TextureUsages::RENDER_ATTACHMENT);
    let depth = tex2d(W, H, wgpu::TextureFormat::Depth32Float, 1, wgpu::TextureUsages::RENDER_ATTACHMENT);
    let tex = tex2d(TEX, TEX, fmt, TEX_MIPS, wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST);
    for l in 0..TEX_MIPS { let s = TEX >> l;
        q.write_texture(wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: l, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All }, &tex_level(l),
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(s * 4), rows_per_image: None }, wgpu::Extent3d { width: s, height: s, depth_or_array_layers: 1 }); }
    let ubuf = d.create_buffer(&wgpu::BufferDescriptor { label: None, size: SCENE_OBJS as u64 * 256, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
    q.write_buffer(&ubuf, 0, &f32_bytes(&scene_objects()));
    let smp = d.create_sampler(&wgpu::SamplerDescriptor { mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, mipmap_filter: wgpu::FilterMode::Linear,
        address_mode_u: wgpu::AddressMode::Repeat, address_mode_v: wgpu::AddressMode::Repeat, anisotropy_clamp: 8, ..Default::default() });
    let vf = wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT;
    let bgl = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: None, entries: &[
        wgpu::BindGroupLayoutEntry { binding: 0, visibility: vf, ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: true, min_binding_size: std::num::NonZeroU64::new(32) }, count: None },
        wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None },
        wgpu::BindGroupLayoutEntry { binding: 2, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None }] });
    let tv = tex.create_view(&Default::default());
    let bg = d.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &bgl, entries: &[
        wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer: &ubuf, offset: 0, size: std::num::NonZeroU64::new(32) }) },
        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&tv) }, wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&smp) }] });
    let module = shader(d, &js_shader("SCENE"));
    let layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[&bgl], push_constant_ranges: &[] });
    let pipe = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor { label: None, layout: Some(&layout),
        vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), buffers: &[], compilation_options: Default::default() },
        fragment: Some(wgpu::FragmentState { module: &module, entry_point: Some("fs"), compilation_options: Default::default(), targets: &[Some(fmt.into())] }),
        primitive: wgpu::PrimitiveState { cull_mode: Some(wgpu::Face::Back), front_face: wgpu::FrontFace::Cw, ..Default::default() },
        depth_stencil: Some(wgpu::DepthStencilState { format: wgpu::TextureFormat::Depth32Float, depth_write_enabled: true, depth_compare: wgpu::CompareFunction::Less, stencil: Default::default(), bias: Default::default() }),
        multisample: Default::default(), multiview: None, cache: None });
    let (cv, dv) = (color.create_view(&Default::default()), depth.create_view(&Default::default()));
    gloop(ms, 64, &mut |k| {
        let mut enc = d.create_command_encoder(&Default::default());
        for _ in 0..k {
            let mut p = enc.begin_render_pass(&wgpu::RenderPassDescriptor { label: None, timestamp_writes: None, occlusion_query_set: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &cv, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.5, g: 0.6, b: 0.7, a: 1.0 }), store: wgpu::StoreOp::Store } })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &dv, depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }), stencil_ops: None }) });
            p.set_pipeline(&pipe);
            for o in 0..SCENE_OBJS { p.set_bind_group(0, &bg, &[o * 256]); p.draw(0..SCENE_VERTS, 0..1); }
        }
        q.submit(Some(enc.finish())); wait(d); k as u64
    })
}

fn rays(d: &wgpu::Device, q: &wgpu::Queue, ms: u64, sc: &RtScene) -> f64 {
    let u32_bytes = |v: &[u32]| v.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>();
    let (nodes, tris, out) = (storage_buf(d, sc.nodes.len() as u64 * 4), storage_buf(d, sc.tris.len() as u64 * 4), storage_buf(d, W as u64 * H as u64 * 4));
    q.write_buffer(&nodes, 0, &u32_bytes(&sc.nodes)); q.write_buffer(&tris, 0, &f32_bytes(&sc.tris));
    let pipe = compute_pipe(d, &rays_shader());
    let bg = bind(d, &pipe.get_bind_group_layout(0), &[&nodes, &tris, &out]);
    gloop(ms, 256, &mut |k| {
        let mut enc = d.create_command_encoder(&Default::default());
        { let mut p = enc.begin_compute_pass(&Default::default()); p.set_pipeline(&pipe); p.set_bind_group(0, &bg, &[]); for _ in 0..k { p.dispatch_workgroups(W / 8, H.div_ceil(8), 1); } }
        q.submit(Some(enc.finish())); wait(d); k as u64 * 2 * W as u64 * H as u64
    }) / 1e6
}

const RT_FEATURES: wgpu::Features = wgpu::Features::EXPERIMENTAL_RAY_QUERY.union(wgpu::Features::EXPERIMENTAL_RAY_TRACING_ACCELERATION_STRUCTURE);

/// The same scene through ray queries on a device made with the ray-tracing features.
fn rays_hw(adapter: &wgpu::Adapter, ms: u64, sc: &RtScene) -> Result<f64, String> {
    let (d, q) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { label: None, required_features: RT_FEATURES, required_limits: wgpu::Limits::default(), memory_hints: Default::default() }, None)).map_err(|e| e.to_string())?;
    let err = std::sync::Arc::new(std::sync::Mutex::new(None::<String>));
    { let e = err.clone(); d.on_uncaptured_error(Box::new(move |x| { e.lock().unwrap().get_or_insert(x.to_string()); })); }
    let vbuf = d.create_buffer(&wgpu::BufferDescriptor { label: None, size: sc.verts.len() as u64 * 4, usage: wgpu::BufferUsages::BLAS_INPUT | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
    q.write_buffer(&vbuf, 0, &f32_bytes(&sc.verts));
    // An index buffer although every vertex is used once: from unindexed triangles wgpu 24 built a
    // structure that hit phantom geometry in front of the camera (checked against the compute tracer).
    let ibuf = d.create_buffer(&wgpu::BufferDescriptor { label: None, size: sc.count as u64 * 12, usage: wgpu::BufferUsages::BLAS_INPUT | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
    q.write_buffer(&ibuf, 0, &(0..sc.count * 3).flat_map(|i| i.to_le_bytes()).collect::<Vec<u8>>());
    let size = wgpu::BlasTriangleGeometrySizeDescriptor { vertex_format: wgpu::VertexFormat::Float32x3, vertex_count: sc.count * 3, index_format: Some(wgpu::IndexFormat::Uint32), index_count: Some(sc.count * 3), flags: wgpu::AccelerationStructureGeometryFlags::OPAQUE };
    let blas = d.create_blas(&wgpu::CreateBlasDescriptor { label: None, flags: wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE, update_mode: wgpu::AccelerationStructureUpdateMode::Build },
        wgpu::BlasGeometrySizeDescriptors::Triangles { descriptors: vec![size.clone()] });
    let tlas = d.create_tlas(&wgpu::CreateTlasDescriptor { label: None, max_instances: 1, flags: wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE, update_mode: wgpu::AccelerationStructureUpdateMode::Build });
    let mut pkg = wgpu::TlasPackage::new(tlas);
    pkg[0] = Some(wgpu::TlasInstance::new(&blas, [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0], 0, 0xff));
    let mut enc = d.create_command_encoder(&Default::default());
    enc.build_acceleration_structures(std::iter::once(&wgpu::BlasBuildEntry { blas: &blas, geometry: wgpu::BlasGeometries::TriangleGeometries(vec![wgpu::BlasTriangleGeometry {
        size: &size, vertex_buffer: &vbuf, first_vertex: 0, vertex_stride: 12, index_buffer: Some(&ibuf), first_index: Some(0), transform_buffer: None, transform_buffer_offset: None }]) }), std::iter::once(&pkg));
    q.submit(Some(enc.finish())); wait(&d);
    let out = storage_buf(&d, W as u64 * H as u64 * 4);
    let module = shader(&d, &(rt_common() + RT_HW));
    let pipe = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor { label: None, layout: None, module: &module, entry_point: Some("main"), compilation_options: Default::default(), cache: None });
    let bg = d.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &pipe.get_bind_group_layout(0), entries: &[
        wgpu::BindGroupEntry { binding: 0, resource: pkg.as_binding() }, wgpu::BindGroupEntry { binding: 1, resource: out.as_entire_binding() }] });
    if let Some(e) = err.lock().unwrap().take() { return Err(e); }
    let r = gloop(ms, 256, &mut |k| {
        let mut enc = d.create_command_encoder(&Default::default());
        { let mut p = enc.begin_compute_pass(&Default::default()); p.set_pipeline(&pipe); p.set_bind_group(0, &bg, &[]); for _ in 0..k { p.dispatch_workgroups(W / 8, H.div_ceil(8), 1); } }
        q.submit(Some(enc.finish())); wait(&d); k as u64 * 2 * W as u64 * H as u64
    }) / 1e6;
    if let Some(e) = err.lock().unwrap().take() { return Err(e); }
    Ok(r)
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

pub const TESTS: &[(&str, &str)] = &[
    ("gpu_matmul", "GPU · matrix compute"), ("gpu_particles", "GPU · particle compute"), ("gpu_fill", "GPU · pixel shading"),
    ("gpu_scene", "GPU · game-like scene"), ("gpu_rays", "GPU · ray tracing (compute)"), ("gpu_upload", "GPU · upload"), ("gpu_readback", "GPU · readback"),
];
fn crash(e: Box<dyn std::any::Any + Send>) -> String { e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_else(|| "GPU test crashed".into()) }

pub struct Gpu { instance: wgpu::Instance, adapter: wgpu::Adapter, device: wgpu::Device, queue: wgpu::Queue, ai: wgpu::AdapterInfo, scene: RtScene }
impl Gpu {
    /// Ok(None): no graphics adapter at all. Err: an adapter that would not give a device.
    pub fn open() -> Result<Option<Gpu>, String> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let Some(adapter) = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, compatible_surface: None, force_fallback_adapter: false })) else { return Ok(None) };
        let ai = adapter.get_info();
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor { label: None, required_features: wgpu::Features::empty(), required_limits: wgpu::Limits::default(), memory_hints: Default::default() }, None)).map_err(|e| e.to_string())?;
        Ok(Some(Gpu { instance, adapter, device, queue, ai, scene: rt_scene() }))
    }
    pub fn info(&self, ram: u64) -> Info {
        let ai = &self.ai;
        let others = self.instance.enumerate_adapters(wgpu::Backends::all()).into_iter().map(|a| a.get_info()).filter(|i| i.name != ai.name).map(|i| format!("{} ({:?})", i.name, i.backend)).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
        Info { name: ai.name.clone(), backend: format!("{:?}", ai.backend), kind: format!("{:?}", ai.device_type), driver: format!("{} {}", ai.driver, ai.driver_info).trim().to_string(), others, vram: vram(ai, ram) }
    }
    /// One timing of one test.
    pub fn once(&self, id: &str, ms: u64) -> Result<f64, String> {
        let (d, q) = (&self.device, &self.queue);
        catch_unwind(AssertUnwindSafe(|| match id {
            "gpu_matmul" => matmul(d, q, ms), "gpu_particles" => particles(d, q, ms),
            "gpu_fill" => render(d, q, ms, FILL, 4, true, 4 * W as u64 * H as u64),
            "gpu_scene" => scene(d, q, ms), "gpu_rays" => rays(d, q, ms, &self.scene),
            "gpu_upload" => upload(d, q, ms), "gpu_readback" => readback(d, q, ms), _ => 0.0,
        })).map_err(crash)
    }
    /// The middle of three timings.
    pub fn test(&self, id: &str, ms: u64) -> Result<f64, String> { Ok(crate::cpu::median(vec![self.once(id, ms)?, self.once(id, ms)?, self.once(id, ms)?])) }
    /// Ray-tracing hardware: on this adapter if its driver offers ray queries, else the same chip
    /// through Vulkan (DirectX 12 and Metal do not offer them in wgpu yet). Returns the result and how
    /// it was reached; None means there is no such hardware within reach and the compute result stands in.
    pub fn hardware_rays(&self, ms: u64) -> (Option<f64>, String) {
        let found = if self.adapter.features().contains(RT_FEATURES) { Some(self.adapter.clone()) } else {
            self.instance.enumerate_adapters(wgpu::Backends::VULKAN).into_iter().find(|a| a.get_info().name == self.ai.name && a.features().contains(RT_FEATURES)) };
        let Some(a) = found else { return (None, "compute".into()) };
        let mut v = Vec::new();
        for _ in 0..3 { match catch_unwind(AssertUnwindSafe(|| rays_hw(&a, ms, &self.scene))) {
            Ok(Ok(x)) => v.push(x), Ok(Err(e)) => return (None, format!("compute (ray queries failed: {e})")), Err(e) => return (None, format!("compute (ray queries crashed: {})", crash(e))) } }
        (Some(crate::cpu::median(v)), format!("hardware ({:?})", a.get_info().backend))
    }
}

/// Memory the graphics chip can use, in GB, and whether it is shared with the system. A chip with
/// its own memory reports it through the driver; a chip that shares the system's (integrated
/// graphics, Apple silicon) is counted as half of RAM.
fn vram(ai: &wgpu::AdapterInfo, ram: u64) -> Option<(f64, bool)> {
    let gb = |bytes: f64| (bytes / (1u64 << 30) as f64).round();
    let shared = Some(((ram as f64 / (1u64 << 30) as f64 / 2.0).round().max(1.0), true));
    if ai.device_type == wgpu::DeviceType::IntegratedGpu || (cfg!(target_os = "macos") && cfg!(target_arch = "aarch64")) { return shared; }
    if ai.device_type != wgpu::DeviceType::DiscreteGpu { return None; }
    let run = |cmd: &str, args: &[&str]| std::process::Command::new(cmd).args(args).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).to_string());
    #[cfg(target_os = "linux")]
    {
        if ai.vendor == 0x10de { if let Some(out) = run("nvidia-smi", &["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]) {
            let rows: Vec<(String, f64)> = out.lines().filter_map(|l| { let (n, m) = l.rsplit_once(',')?; Some((n.trim().to_string(), m.trim().parse().ok()?)) }).collect();
            if let Some((_, mib)) = rows.iter().find(|(n, _)| ai.name.contains(n.as_str()) || n.contains(&ai.name)).or(rows.first()) { return Some((gb(mib * 1048576.0), false)); } } }
        if let Ok(rd) = std::fs::read_dir("/sys/class/drm") { for e in rd.flatten() {
            let rd = |f: &str| std::fs::read_to_string(e.path().join("device").join(f)).unwrap_or_default();
            let hex = |s: String| u32::from_str_radix(s.trim().trim_start_matches("0x"), 16).unwrap_or(0);
            if hex(rd("vendor")) == ai.vendor && hex(rd("device")) == ai.device { if let Ok(b) = rd("mem_info_vram_total").trim().parse::<f64>() { if b > 0.0 { return Some((gb(b), false)); } } }
        } }
    }
    #[cfg(target_os = "windows")]
    if let Some(out) = run("powershell", &["-NoProfile", "-Command", "Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | ForEach-Object { $_.DriverDesc + '|' + $_.'HardwareInformation.qwMemorySize' }"]) {
        let rows: Vec<(String, f64)> = out.lines().filter_map(|l| { let (n, m) = l.rsplit_once('|')?; Some((n.trim().to_string(), m.trim().parse().ok()?)) }).collect();
        if let Some((_, b)) = rows.iter().find(|(n, _)| ai.name.contains(n.as_str()) || n.contains(&ai.name)).or(rows.iter().max_by(|a, b| a.1.total_cmp(&b.1))) { if *b > 0.0 { return Some((gb(*b), false)); } }
    }
    #[cfg(target_os = "macos")]
    if let Some(out) = run("system_profiler", &["SPDisplaysDataType"]) {
        for l in out.lines() { if let Some((k, v)) = l.split_once(':') { if k.trim().starts_with("VRAM") { let mut w = v.split_whitespace();
            if let (Some(n), Some(u)) = (w.next().and_then(|n| n.parse::<f64>().ok()), w.next()) { return Some((if u.starts_with("MB") { (n / 1024.0).round() } else { n }, false)); } } } }
    }
    let _ = (run, gb);
    None
}

#[cfg(test)]
mod tests {
    /// rtScene() in gpu.js gives these hashes (node and vertex words, h = h * 31 + x); the scenes must match.
    #[test]
    fn scene_matches_browser() {
        let s = super::rt_scene();
        let hash = |v: &mut dyn Iterator<Item = u32>| v.fold(0u32, |h, x| h.wrapping_mul(31).wrapping_add(x));
        assert_eq!(s.count, 131072);
        assert_eq!(hash(&mut s.nodes.iter().copied()), 3379745270);
        assert_eq!(hash(&mut s.verts.iter().map(|f| f.to_bits())), 768807800);
    }

    /// The GPU tests alone, for measuring: `cargo test --release gpu_only -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn gpu_only() {
        let g = super::Gpu::open().unwrap().unwrap();
        for (id, _) in super::TESTS { println!("{id} {:?}", g.test(id, 700)); }
        println!("gpu_rt {:?}", g.hardware_rays(700));
        let i = g.info(32 << 30); println!("{} · vram {:?}", i.name, i.vram);
    }
}
