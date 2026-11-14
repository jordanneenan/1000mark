// What gets measured, how it is grouped, and how raw results turn into points.
// A test's score is 1000 x result / reference, so the scale is linear and has no ceiling:
// a machine ten times faster scores ten times higher. A part's score is the weighted
// geometric mean of its tests, and the overall score is the weighted geometric mean of the parts.
//
// THE SCALE IS FROZEN. The reference values below are the scale. Do not edit them:
// results stay comparable for years only if 1000 keeps meaning the same thing. New or changed
// tests get new ids with their own references; they never change an existing one.
// Scale 2 (2026-11-13): storage space no longer counts towards any score (a browser cannot see it,
// and it is not speed). Test references are unchanged from scale 1.
// Scale 3 (2026-11-14): memory size and drive size count again, in a fifth part, Capacity, which
// only the computer test can measure (a browser cannot see either). Browser storage tests are no longer
// scored: browsers serve them from memory and their own databases, so a faster drive could score lower.
// The computer test's sequential tests moved to 64 MB requests under new ids (n_sto_big_*).
// Existing references are unchanged.
export const SCALE = 3;
export const REF_DEVICE = 'a Ryzen 9 5950X + RTX 3080 desktop, November 2026';

export const CATS = [
  { id: 'cpu', name: 'CPU speed', short: 'CPU', weight: 0.35, ink: 'sun', blurb: 'How fast the processor works through different kinds of calculation, on one core and on all of them.' },
  { id: 'gpu', name: 'GPU speed', short: 'GPU', weight: 0.25, ink: 'pink', blurb: 'Graphics chip: number-crunching, drawing, moving data, and video encoding and decoding.' },
  { id: 'memory', name: 'Memory speed', short: 'Memory', weight: 0.15, ink: 'mint', blurb: 'How fast RAM can be filled, read, copied and jumped around in.' },
  { id: 'storage-speed', name: 'Storage speed', short: 'Storage', weight: 0.25, ink: 'ink', blurb: 'How fast the device can write and read files, in big streams and in small scattered pieces.' },
  { id: 'capacity', name: 'Capacity', short: 'Size', weight: 0.10, ink: 'mint', blurb: 'How much memory and storage the computer has. Measured by the computer test only: a browser cannot see either.' },
];

// div turns the raw rate into the display unit. scale 'sqrt' is for sizes: four times the memory
// or drive scores twice the points, so size counts without swamping speed.
export const TESTS = {
  cpu_int:      { cat: 'cpu', group: 'One core', name: 'Integer maths', unit: 'M ops/s', div: 1e6, ref: 730, what: 'Shifts, xors and multiplies: everyday program logic.' },
  cpu_float:    { cat: 'cpu', group: 'One core', name: 'Floating point', unit: 'M iter/s', div: 1e6, ref: 490, what: 'A Mandelbrot set in double precision.' },
  cpu_matrix:   { cat: 'cpu', group: 'One core', name: 'Matrix multiply', unit: 'MFLOP/s', div: 1e6, ref: 2120, what: 'Linear algebra, the shape of science and AI work.' },
  cpu_sort:     { cat: 'cpu', group: 'One core', name: 'Sorting', unit: 'M items/s', div: 1e6, ref: 14, what: 'Sorting random numbers: branches and cache.' },
  cpu_sha:      { cat: 'cpu', group: 'One core', name: 'Hashing', unit: 'MB/s', div: 1e6, ref: 182, what: 'SHA-256 written in plain code: bit twiddling.' },
  cpu_crypto:   { cat: 'cpu', group: 'One core', name: 'Hardware crypto', unit: 'MB/s', div: 1e6, ref: 1610, what: 'SHA-256 through the CPU\'s built-in crypto instructions.' },
  cpu_compress: { cat: 'cpu', group: 'One core', name: 'Compression', unit: 'MB/s', div: 1e6, ref: 455, what: 'LZ-style compression of text.' },
  cpu_json:     { cat: 'cpu', group: 'One core', name: 'Text and JSON', unit: 'MB/s', div: 1e6, ref: 295, what: 'Building and parsing text data.' },
  cpu_bigint:   { cat: 'cpu', group: 'One core', name: 'Big-number maths', unit: 'ops/s', div: 1, ref: 15400, what: 'The maths behind public-key encryption.' },
  cpu_mt_int:    { cat: 'cpu', group: 'All cores', name: 'Integer maths', unit: 'M ops/s', div: 1e6, ref: 16000, pair: 'cpu_int', what: 'The same test on every core at once.' },
  cpu_mt_float:  { cat: 'cpu', group: 'All cores', name: 'Floating point', unit: 'M iter/s', div: 1e6, ref: 12650, pair: 'cpu_float', what: 'The same test on every core at once.' },
  cpu_mt_matrix: { cat: 'cpu', group: 'All cores', name: 'Matrix multiply', unit: 'MFLOP/s', div: 1e6, ref: 27000, pair: 'cpu_matrix', what: 'The same test on every core at once.' },
  cpu_mt_sha:    { cat: 'cpu', group: 'All cores', name: 'Hashing', unit: 'MB/s', div: 1e6, ref: 2400, pair: 'cpu_sha', what: 'The same test on every core at once.' },

  // ---- Native app (the downloadable Pressmark). Different code from the browser tests, so separate ids. ----
  n_cpu_int:      { cat: 'cpu', group: 'One core', name: 'Integer maths', unit: 'M ops/s', div: 1e6, ref: 737, what: 'Shifts, xors and multiplies: everyday program logic.' },
  n_cpu_float:    { cat: 'cpu', group: 'One core', name: 'Floating point', unit: 'M iter/s', div: 1e6, ref: 483, what: 'A Mandelbrot set in double precision.' },
  n_cpu_matrix:   { cat: 'cpu', group: 'One core', name: 'Matrix multiply', unit: 'GFLOP/s', div: 1e9, ref: 13, what: 'Linear algebra, the shape of science and AI work.' },
  n_cpu_simd:     { cat: 'cpu', group: 'One core', name: 'Vector maths (SIMD)', unit: 'GFLOP/s', div: 1e9, ref: 7.03, what: 'Array maths that uses the wide SSE, AVX or NEON units.' },
  n_cpu_sort:     { cat: 'cpu', group: 'One core', name: 'Sorting', unit: 'M items/s', div: 1e6, ref: 45.5, what: 'Sorting a million random numbers: branches and cache.' },
  n_cpu_sha:      { cat: 'cpu', group: 'One core', name: 'Hashing', unit: 'MB/s', div: 1e6, ref: 340, what: 'SHA-256 in plain code: bit twiddling.' },
  n_cpu_crypto:   { cat: 'cpu', group: 'One core', name: 'Hardware crypto', unit: 'MB/s', div: 1e6, ref: 2375, what: 'SHA-256 through the CPU\'s built-in crypto instructions.' },
  n_cpu_compress: { cat: 'cpu', group: 'One core', name: 'Compression', unit: 'MB/s', div: 1e6, ref: 619, what: 'LZ-style compression of text.' },
  n_cpu_mt_int:      { cat: 'cpu', group: 'All cores', name: 'Integer maths', unit: 'M ops/s', div: 1e6, ref: 15580, pair: 'n_cpu_int', what: 'The same test on every thread at once.' },
  n_cpu_mt_float:    { cat: 'cpu', group: 'All cores', name: 'Floating point', unit: 'M iter/s', div: 1e6, ref: 12600, pair: 'n_cpu_float', what: 'The same test on every thread at once.' },
  n_cpu_mt_matrix:   { cat: 'cpu', group: 'All cores', name: 'Matrix multiply', unit: 'GFLOP/s', div: 1e9, ref: 134.6, pair: 'n_cpu_matrix', what: 'The same test on every thread at once.' },
  n_cpu_mt_simd:     { cat: 'cpu', group: 'All cores', name: 'Vector maths (SIMD)', unit: 'GFLOP/s', div: 1e9, ref: 153.5, pair: 'n_cpu_simd', what: 'The same test on every thread at once.' },
  n_cpu_mt_sort:     { cat: 'cpu', group: 'All cores', name: 'Sorting', unit: 'M items/s', div: 1e6, ref: 494, pair: 'n_cpu_sort', what: 'The same test on every thread at once.' },
  n_cpu_mt_sha:      { cat: 'cpu', group: 'All cores', name: 'Hashing', unit: 'MB/s', div: 1e6, ref: 5215, pair: 'n_cpu_sha', what: 'The same test on every thread at once.' },
  n_cpu_mt_crypto:   { cat: 'cpu', group: 'All cores', name: 'Hardware crypto', unit: 'MB/s', div: 1e6, ref: 47790, pair: 'n_cpu_crypto', what: 'The same test on every thread at once.' },
  n_cpu_mt_compress: { cat: 'cpu', group: 'All cores', name: 'Compression', unit: 'MB/s', div: 1e6, ref: 12610, pair: 'n_cpu_compress', what: 'The same test on every thread at once.' },

  n_mem_write:   { cat: 'memory', group: 'Bandwidth', name: 'Fill', unit: 'GB/s', div: 1e9, ref: 24.9, what: 'Writing one value across a 256 MB block.' },
  n_mem_read:    { cat: 'memory', group: 'Bandwidth', name: 'Read', unit: 'GB/s', div: 1e9, ref: 35.8, what: 'Reading a 256 MB block end to end.' },
  n_mem_copy:    { cat: 'memory', group: 'Bandwidth', name: 'Copy', unit: 'GB/s', div: 1e9, ref: 20, what: 'Copying one 256 MB block onto another.' },
  n_mem_mt_copy: { cat: 'memory', group: 'Bandwidth', name: 'Copy on all threads', unit: 'GB/s', div: 1e9, ref: 36.2, what: 'Every thread copying at once: the total the memory channels can carry.' },
  n_mem_random:  { cat: 'memory', group: 'Latency', name: 'Random jumps', unit: 'M hops/s', div: 1e6, ref: 14.45, what: 'Chasing pointers through 128 MB: one cache miss per hop.' },
  n_mem_alloc:   { cat: 'memory', group: 'Allocation', name: 'Make and drop objects', unit: 'M allocs/s', div: 1e6, ref: 55.6, what: 'Lots of small short-lived allocations.' },

  n_sto_big_write:  { cat: 'storage-speed', group: 'Big files', name: 'Sequential write', unit: 'MB/s', ref: 2300, what: 'Writing a 2 GB file in 64 MB pieces, cache bypassed.' },
  n_sto_big_read:   { cat: 'storage-speed', group: 'Big files', name: 'Sequential read', unit: 'MB/s', ref: 6750, what: 'Reading it back from the drive in 64 MB pieces, cache bypassed.' },
  // Computer test 0.2 and older: 4 MB pieces, which held fast drives back.
  n_sto_seq_write:  { cat: 'storage-speed', group: 'Big files', name: 'Sequential write (4 MB pieces)', unit: 'MB/s', ref: 1940, what: 'Writing a 1 GB file start to finish, cache bypassed.' },
  n_sto_seq_read:   { cat: 'storage-speed', group: 'Big files', name: 'Sequential read (4 MB pieces)', unit: 'MB/s', ref: 4612, what: 'Reading it back from the drive, cache bypassed.' },
  n_sto_rand_write: { cat: 'storage-speed', group: 'Small pieces', name: 'Random 4K write', unit: 'IOPS', ref: 21090, what: 'Small writes scattered across the file, one at a time.' },
  n_sto_rand_read:  { cat: 'storage-speed', group: 'Small pieces', name: 'Random 4K read', unit: 'IOPS', ref: 20680, what: 'Small reads scattered across the file, one at a time.' },
  n_sto_files:      { cat: 'storage-speed', group: 'Small pieces', name: 'Small files', unit: 'files/s', ref: 26530, what: 'Creating, writing and deleting many little files.' },

  n_mem_size:  { cat: 'capacity', group: 'Memory', name: 'Memory size', unit: 'GB', ref: 32, scale: 'sqrt', what: 'Installed RAM. More keeps big projects, many apps and local AI models in memory.' },
  n_sto_total: { cat: 'capacity', group: 'Storage', name: 'Drive size', unit: 'GB', ref: 4000, scale: 'sqrt', what: 'Total size of the drive that was tested.' },

  mem_write:  { cat: 'memory', group: 'Bandwidth', name: 'Fill', unit: 'GB/s', div: 1e9, ref: 25, what: 'Writing one value across a big block.' },
  mem_read:   { cat: 'memory', group: 'Bandwidth', name: 'Scan', unit: 'GB/s', div: 1e9, ref: 4.8, what: 'Reading a big block end to end.' },
  mem_copy:   { cat: 'memory', group: 'Bandwidth', name: 'Copy', unit: 'GB/s', div: 1e9, ref: 23.5, what: 'Copying one big block onto another.' },
  mem_random: { cat: 'memory', group: 'Latency', name: 'Random jumps', unit: 'M hops/s', div: 1e6, ref: 19.8, what: 'Chasing pointers through a block bigger than the cache.' },
  mem_alloc:  { cat: 'memory', group: 'Allocation', name: 'Make and drop objects', unit: 'M allocs/s', div: 1e6, ref: 102, what: 'Lots of small short-lived objects.' },

  sto_seq_write:  { cat: 'storage-speed', group: 'Big files', name: 'Sequential write', unit: 'MB/s', ref: 2200, unscored: true, what: 'Writing one large file start to finish.' },
  sto_seq_read:   { cat: 'storage-speed', group: 'Big files', name: 'Sequential read', unit: 'MB/s', ref: 3900, unscored: true, what: 'Reading it back. The system may serve this from memory.' },
  sto_rand_write: { cat: 'storage-speed', group: 'Small pieces', name: 'Random 4K write', unit: 'IOPS', ref: 17500, unscored: true, what: 'Small writes scattered across the file.' },
  sto_rand_read:  { cat: 'storage-speed', group: 'Small pieces', name: 'Random 4K read', unit: 'IOPS', ref: 37000, unscored: true, what: 'Small reads scattered across the file.' },
  sto_files:      { cat: 'storage-speed', group: 'Small pieces', name: 'Small files', unit: 'files/s', ref: 5800, unscored: true, what: 'Creating, writing and deleting many little files.' },

  sto_space: { cat: 'storage-speed', group: 'Capacity', name: 'Space available', unit: 'GB', unscored: true, hidden: true, what: 'Old browser runs only: room the browser would give one site.' },

  gpu_matmul:    { cat: 'gpu', group: 'Compute', name: 'Matrix compute', unit: 'GFLOP/s', ref: 1260, what: 'A 512x512 matrix multiply in a compute shader.' },
  gpu_particles: { cat: 'gpu', group: 'Compute', name: 'Particle compute', unit: 'M updates/s', ref: 9000, what: 'Moving a million particles per step.' },
  gpu_fill:      { cat: 'gpu', group: 'Drawing', name: 'Pixel shading', unit: 'Mpix/s', ref: 24700, what: 'Layered noise shaded over a 1080p frame.' },
  gpu_geom:      { cat: 'gpu', group: 'Drawing', name: 'Triangle throughput', unit: 'M tris/s', ref: 1290, what: '400,000 small triangles per frame.' },
  gpu_upload:    { cat: 'gpu', group: 'Transfer', name: 'Upload to GPU', unit: 'MB/s', ref: 7700, what: 'Sending data from memory to the graphics chip.' },
  gpu_readback:  { cat: 'gpu', group: 'Transfer', name: 'Read back from GPU', unit: 'MB/s', ref: 10300, what: 'Fetching data back from the graphics chip.' },
  gl_fill:       { cat: 'gpu', group: 'Drawing', name: 'Pixel shading (WebGL)', unit: 'Mpix/s', ref: 25000, what: 'Layered noise shaded over a 1080p frame.' },
  gl_geom:       { cat: 'gpu', group: 'Drawing', name: 'Triangle throughput (WebGL)', unit: 'M tris/s', ref: 775, what: '200,000 small triangles per frame.' },
  vid_enc_h264:  { cat: 'gpu', group: 'Video', name: 'H.264 encode 1080p', unit: 'fps', ref: 160, what: 'Compressing 1080p video, on the hardware encoder if there is one.' },
  vid_dec_h264:  { cat: 'gpu', group: 'Video', name: 'H.264 decode 1080p', unit: 'fps', ref: 1045, what: 'Unpacking the same video.' },
  // Shown but not scored, because not every device has these codecs.
  vid_enc_hevc: { cat: 'gpu', group: 'Video', name: 'HEVC encode 1080p', unit: 'fps', unscored: true },
  vid_dec_hevc: { cat: 'gpu', group: 'Video', name: 'HEVC decode 1080p', unit: 'fps', unscored: true },
  vid_enc_vp9:  { cat: 'gpu', group: 'Video', name: 'VP9 encode 1080p', unit: 'fps', unscored: true },
  vid_dec_vp9:  { cat: 'gpu', group: 'Video', name: 'VP9 decode 1080p', unit: 'fps', unscored: true },
  vid_enc_av1:  { cat: 'gpu', group: 'Video', name: 'AV1 encode 1080p', unit: 'fps', unscored: true },
  vid_dec_av1:  { cat: 'gpu', group: 'Video', name: 'AV1 decode 1080p', unit: 'fps', unscored: true },
};

// Installed memory in GB from the byte count the computer test reports (the system keeps a little back).
export const ramGB = bytes => { const g = bytes / 2 ** 30; return g >= 6 ? Math.round(g / 2) * 2 : Math.round(g); };
// Computer-test runs from before 0.3 carry the memory size only in device.memoryBytes; give them the test too.
export function addSizes(run) {
  const d = run.device || {};
  if ((run.native || d.native) && d.memoryBytes > 0 && run.tests && run.tests.n_mem_size == null) run.tests.n_mem_size = ramGB(d.memoryBytes);
  return run;
}

export function scoreTest(id, value) {
  const t = TESTS[id];
  if (!t || t.unscored || !(value > 0)) return null;
  if (t.scale === 'sqrt') return 1000 * Math.sqrt(value / t.ref);
  if (t.scale === 'log') return 1000 * Math.log2(1 + value) / Math.log2(1 + t.ref);
  return 1000 * value / t.ref;
}

// Use cases. Each one re-weights the parts, and can lean on some groups of tests inside a
// part (a group not listed counts as 1). "General use" is the plain system score.
export const PROFILES = [
  { id: 'general', name: 'General use', score: 'System score', blurb: 'An even mix of everything.',
    weights: { cpu: 0.35, gpu: 0.25, memory: 0.15, 'storage-speed': 0.25, capacity: 0.10 }, groups: {} },
  { id: 'gaming', name: 'Gaming', score: 'Gaming score', blurb: 'Mostly the graphics chip drawing frames, then fast single cores.',
    weights: { cpu: 0.25, gpu: 0.55, memory: 0.08, 'storage-speed': 0.12, capacity: 0.08 },
    groups: { gpu: { Drawing: 3, Compute: 1, Transfer: 1, Video: 0.5 }, cpu: { 'One core': 2 } } },
  { id: 'ai', name: 'AI and machine learning', score: 'AI score', blurb: 'GPU compute first, then how much memory there is for models, matrix maths on every core and memory bandwidth.',
    weights: { cpu: 0.20, gpu: 0.55, memory: 0.15, 'storage-speed': 0.10, capacity: 0.25 },
    groups: { gpu: { Compute: 4, Transfer: 1.5, Drawing: 0.5, Video: 0.25 }, cpu: { 'All cores': 2 }, memory: { Bandwidth: 2 }, capacity: { Memory: 3 } } },
  { id: 'design', name: 'Graphic design and photo', score: 'Design score', blurb: 'A balance of processor, graphics and plenty of fast memory.',
    weights: { cpu: 0.35, gpu: 0.25, memory: 0.20, 'storage-speed': 0.20, capacity: 0.12 },
    groups: { gpu: { Drawing: 2, Compute: 1.5 }, cpu: { 'One core': 1.5 } } },
  { id: 'video', name: 'Video editing', score: 'Video editing score', blurb: 'Every core, video encoding on the graphics chip, and fast big-file storage.',
    weights: { cpu: 0.30, gpu: 0.30, memory: 0.12, 'storage-speed': 0.28, capacity: 0.15 },
    groups: { cpu: { 'All cores': 2.5 }, gpu: { Video: 3, Compute: 1.5 }, 'storage-speed': { 'Big files': 2.5 }, capacity: { Storage: 2 } } },
  { id: 'office', name: 'Office work', score: 'Office score', blurb: 'Snappy single cores, quick small-file storage and responsive memory. The graphics chip barely matters.',
    weights: { cpu: 0.45, gpu: 0.07, memory: 0.20, 'storage-speed': 0.28, capacity: 0.05 },
    groups: { cpu: { 'One core': 3 }, 'storage-speed': { 'Small pieces': 2.5 }, memory: { Latency: 2, Allocation: 2 } } },
  { id: 'dev', name: 'Software development', score: 'Development score', blurb: 'Compiling on every core, and lots of small files.',
    weights: { cpu: 0.45, gpu: 0.05, memory: 0.20, 'storage-speed': 0.30, capacity: 0.10 },
    groups: { cpu: { 'All cores': 2 }, 'storage-speed': { 'Small pieces': 3 } } },
];

export function scoreRun(run, profile = PROFILES[0]) {
  const tests = {}, sums = {};
  for (const [id, v] of Object.entries(run.tests || {})) {
    const s = scoreTest(id, v); if (s == null) continue;
    const t = TESTS[id], w = profile.groups?.[t.cat]?.[t.group] ?? 1;
    tests[id] = s; const c = (sums[t.cat] ||= { lw: 0, w: 0 }); c.lw += w * Math.log(s); c.w += w;
  }
  const cats = {}; let lw = 0, w = 0;
  for (const c of CATS) {
    cats[c.id] = sums[c.id] && sums[c.id].w ? Math.exp(sums[c.id].lw / sums[c.id].w) : null;
    const cw = profile.weights[c.id] ?? c.weight;
    if (cats[c.id]) { lw += cw * Math.log(cats[c.id]); w += cw; }
  }
  return { tests, cats, system: w ? Math.exp(lw / w) : null, covered: w };
}
