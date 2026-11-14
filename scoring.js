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
// Scale 4 (2026-11-14): sizes count through per-use-case curves with diminishing returns (see
// PROFILES), not a square root. CPU tests on six threads (games and everyday apps rarely keep more
// busy), a game-like drawing scene and a ray-tracing scene were added under new ids. Four use cases
// were added. Existing references are unchanged.
export const SCALE = 4;
export const REF_DEVICE = 'a Ryzen 9 5950X + RTX 3080 desktop, November 2026';

export const CATS = [
  { id: 'cpu', name: 'CPU speed', short: 'CPU', weight: 0.35, ink: 'sun', blurb: 'How fast the processor works through different kinds of calculation: on one core, on six threads (about what games and everyday apps use) and on all of them.' },
  { id: 'gpu', name: 'GPU speed', short: 'GPU', weight: 0.25, ink: 'pink', blurb: 'Graphics chip: number-crunching, drawing (including a game-like scene), ray tracing, moving data, and video encoding and decoding.' },
  { id: 'memory', name: 'Memory speed', short: 'Memory', weight: 0.15, ink: 'mint', blurb: 'How fast RAM can be filled, read, copied and jumped around in.' },
  { id: 'storage-speed', name: 'Storage speed', short: 'Storage', weight: 0.25, ink: 'ink', blurb: 'How fast the device can write and read files, in big streams and in small scattered pieces.' },
  { id: 'capacity', name: 'Capacity', short: 'Size', weight: 0.12, ink: 'sun', blurb: 'How much memory and storage the computer has. Measured by the computer test only: a browser cannot see either.' },
];

// div turns the raw rate into the display unit. Sizes (curve) score through a curve of [GB, points]
// anchors instead of a straight ratio: more helps, less and less, and past what a use case can use it
// stops helping. The curve here is for general use; each use case in PROFILES has its own (sizes).
// Speed has no curve: twice as fast is always twice the points.
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
  cpu_6t_int:    { cat: 'cpu', group: 'Six threads', name: 'Integer maths', unit: 'M ops/s', div: 1e6, ref: 4110, what: 'The same test on six threads: about as many as a game or a busy app keeps working.' },
  cpu_6t_float:  { cat: 'cpu', group: 'Six threads', name: 'Floating point', unit: 'M iter/s', div: 1e6, ref: 2751, what: 'The same test on six threads.' },
  cpu_6t_matrix: { cat: 'cpu', group: 'Six threads', name: 'Matrix multiply', unit: 'MFLOP/s', div: 1e6, ref: 11523, what: 'The same test on six threads.' },
  cpu_6t_sha:    { cat: 'cpu', group: 'Six threads', name: 'Hashing', unit: 'MB/s', div: 1e6, ref: 1028, what: 'The same test on six threads.' },

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
  n_cpu_6t_int:      { cat: 'cpu', group: 'Six threads', name: 'Integer maths', unit: 'M ops/s', div: 1e6, ref: 4270, what: 'The same test on six threads: about as many as a game or a busy app keeps working.' },
  n_cpu_6t_float:    { cat: 'cpu', group: 'Six threads', name: 'Floating point', unit: 'M iter/s', div: 1e6, ref: 2795, what: 'The same test on six threads.' },
  n_cpu_6t_simd:     { cat: 'cpu', group: 'Six threads', name: 'Vector maths (SIMD)', unit: 'GFLOP/s', div: 1e9, ref: 39.9, what: 'The same test on six threads.' },
  n_cpu_6t_sort:     { cat: 'cpu', group: 'Six threads', name: 'Sorting', unit: 'M items/s', div: 1e6, ref: 261, what: 'The same test on six threads.' },
  n_cpu_6t_compress: { cat: 'cpu', group: 'Six threads', name: 'Compression', unit: 'MB/s', div: 1e6, ref: 3528, what: 'The same test on six threads.' },

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

  // Sizes. Computer test 0.3 scored them as a square root; old runs keep these ids and score on the curves.
  n_mem_size:  { cat: 'capacity', group: 'Memory', name: 'Memory size', unit: 'GB', ref: 32, curve: [[2, 40], [4, 150], [8, 550], [16, 880], [32, 1000], [64, 1050], [128, 1080]], what: 'Installed RAM. 8 GB is the least that runs today\'s apps comfortably; past 32 GB everyday use hardly notices.' },
  n_sto_total: { cat: 'capacity', group: 'Storage', name: 'Drive size', unit: 'GB', ref: 4000, curve: [[64, 150], [128, 330], [256, 560], [512, 780], [1000, 900], [2000, 970], [4000, 1000]], what: 'Total size of the drive that was tested.' },

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
  gpu_scene:     { cat: 'gpu', group: 'Drawing', name: 'Game-like scene', unit: 'fps', ref: 955, what: '2,000 textured, lit objects (4 million triangles) with a depth buffer at 1080p, one draw call each.' },
  gpu_rays:      { cat: 'gpu', group: 'Ray tracing', name: 'Ray tracing (compute)', unit: 'M rays/s', ref: 2540, what: 'A 131,000-triangle landscape at 1080p, a camera ray and a shadow ray per pixel, traced in a compute shader.' },
  n_gpu_rt:      { cat: 'gpu', group: 'Ray tracing', name: 'Ray tracing (hardware)', unit: 'M rays/s', ref: 8730, what: 'The same scene on the ray-tracing hardware where the GPU and driver offer it; otherwise the compute version stands in.' },
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

// Points for a size on a curve of [GB, points] anchors, read on a doubling scale: straight lines
// between anchors, flat past the last one, and the first slope carried on below the first.
export function curvePoints(curve, v) {
  const x = Math.log2(v), a = curve.map(([s, p]) => [Math.log2(s), p]);
  if (x >= a[a.length - 1][0]) return a[a.length - 1][1];
  let i = 1; while (i < a.length - 1 && x > a[i][0]) i++;
  const [x0, p0] = a[i - 1], [x1, p1] = a[i];
  return Math.max(10, p0 + (p1 - p0) * (x - x0) / (x1 - x0));
}

// profile matters only for sizes, whose curve depends on the use case (general use when left out).
export function scoreTest(id, value, profile) {
  const t = TESTS[id];
  if (!t || t.unscored || !(value > 0)) return null;
  if (t.curve) return curvePoints(profile?.sizes?.[id] || t.curve, value);
  if (t.scale === 'sqrt') return 1000 * Math.sqrt(value / t.ref);
  if (t.scale === 'log') return 1000 * Math.log2(1 + value) / Math.log2(1 + t.ref);
  return 1000 * value / t.ref;
}

// Use cases. Each one re-weights the parts, can lean on some groups of tests inside a part (a group
// not listed counts as 1), and has its own curves for memory and drive size (sizes; [GB, points]).
// Every curve gives the reference machine's 32 GB and 4 TB 1000 points, so it scores 1000 in every
// use case. The curves stop where the use case stops gaining: games barely use more than 16 GB and
// gain nothing past 32 GB; virtual machines, simulations, local AI models and a server's files keep
// using more, each doubling worth less than the last. "General use" is the plain system score.
const CPU_EVEN = { 'One core': 1, 'Six threads': 1, 'All cores': 1 };
export const PROFILES = [
  { id: 'general', name: 'General use', score: 'System score', blurb: 'An even mix of everything.',
    weights: { cpu: 0.35, gpu: 0.25, memory: 0.15, 'storage-speed': 0.25, capacity: 0.12 }, groups: { cpu: CPU_EVEN }, sizes: {} },
  { id: 'gaming', name: 'Gaming', score: 'Gaming score', blurb: 'Mostly the graphics chip drawing frames, then fast cores: games lean on one main thread and a handful of helpers, rarely more than six to eight. 16 GB of memory runs most games, 32 GB all of them.',
    weights: { cpu: 0.25, gpu: 0.55, memory: 0.08, 'storage-speed': 0.12, capacity: 0.08 },
    groups: { gpu: { Drawing: 3, 'Ray tracing': 1, Compute: 1, Transfer: 1, Video: 0.5 }, cpu: { 'One core': 2, 'Six threads': 3, 'All cores': 0.5 } },
    sizes: { n_mem_size: [[4, 80], [8, 350], [16, 850], [32, 1000]], n_sto_total: [[256, 350], [512, 650], [1000, 830], [2000, 950], [4000, 1000]] } },
  { id: 'office', name: 'Office work', score: 'Office score', blurb: 'Snappy single cores, quick small-file storage and responsive memory. The graphics chip barely matters, and 16 GB is plenty.',
    weights: { cpu: 0.45, gpu: 0.07, memory: 0.20, 'storage-speed': 0.28, capacity: 0.06 },
    groups: { cpu: { 'One core': 3, 'Six threads': 1.5, 'All cores': 0.3 }, 'storage-speed': { 'Small pieces': 2.5 }, memory: { Latency: 2, Allocation: 2 } },
    sizes: { n_mem_size: [[2, 60], [4, 300], [8, 720], [16, 950], [32, 1000]], n_sto_total: [[64, 300], [128, 560], [256, 800], [512, 950], [1000, 1000]] } },
  { id: 'design', name: 'Graphic design and photo', score: 'Design score', blurb: 'A balance of processor, graphics and plenty of fast memory for big images and many layers.',
    weights: { cpu: 0.35, gpu: 0.25, memory: 0.20, 'storage-speed': 0.20, capacity: 0.12 },
    groups: { gpu: { Drawing: 2, Compute: 1.5, 'Ray tracing': 0.5 }, cpu: { 'One core': 1.5, 'Six threads': 1.5, 'All cores': 1 } },
    sizes: { n_mem_size: [[4, 80], [8, 400], [16, 750], [32, 1000], [64, 1150], [128, 1220]], n_sto_total: [[256, 420], [512, 650], [1000, 800], [2000, 920], [4000, 1000], [8000, 1060]] } },
  { id: 'video', name: 'Video editing', score: 'Video editing score', blurb: 'Every core, video encoding on the graphics chip, fast big-file storage, and room for hours of footage.',
    weights: { cpu: 0.30, gpu: 0.30, memory: 0.12, 'storage-speed': 0.28, capacity: 0.15 },
    groups: { cpu: { 'All cores': 2.5, 'Six threads': 1, 'One core': 1 }, gpu: { Video: 3, Compute: 1.5, 'Ray tracing': 0.5 }, 'storage-speed': { 'Big files': 2.5 }, capacity: { Storage: 2 } },
    sizes: { n_mem_size: [[4, 60], [8, 320], [16, 680], [32, 1000], [64, 1180], [128, 1300]], n_sto_total: [[256, 200], [512, 350], [1000, 550], [2000, 780], [4000, 1000], [8000, 1220], [16000, 1400], [32000, 1520]] } },
  { id: 'dev', name: 'Software development', score: 'Development score', blurb: 'Compiling on every core, lots of small files, and memory for editors, browsers and containers side by side.',
    weights: { cpu: 0.45, gpu: 0.05, memory: 0.20, 'storage-speed': 0.30, capacity: 0.10 },
    groups: { cpu: { 'All cores': 2, 'Six threads': 1, 'One core': 1 }, 'storage-speed': { 'Small pieces': 3 } },
    sizes: { n_mem_size: [[4, 80], [8, 450], [16, 800], [32, 1000], [64, 1130], [128, 1200]], n_sto_total: [[128, 300], [256, 580], [512, 800], [1000, 920], [2000, 980], [4000, 1000]] } },
  { id: 'engineering', name: 'Engineering and CAD', score: 'Engineering score', blurb: 'CAD modelling runs mostly on one core while the graphics chip draws the model; simulation and rendering use every core and lots of memory.',
    weights: { cpu: 0.35, gpu: 0.30, memory: 0.12, 'storage-speed': 0.13, capacity: 0.12 },
    groups: { cpu: { 'One core': 2.5, 'Six threads': 1.5, 'All cores': 1 }, gpu: { Drawing: 3, 'Ray tracing': 1.5, Compute: 1, Video: 0.25 } },
    sizes: { n_mem_size: [[4, 60], [8, 330], [16, 700], [32, 1000], [64, 1200], [128, 1320], [256, 1380]], n_sto_total: [[256, 450], [512, 650], [1000, 820], [2000, 940], [4000, 1000], [8000, 1050]] } },
  { id: 'ai', name: 'AI and machine learning', score: 'AI score', blurb: 'GPU compute first, then how much memory there is: the size of a model you can run locally is set by memory. Matrix maths on every core and memory bandwidth follow.',
    weights: { cpu: 0.20, gpu: 0.55, memory: 0.15, 'storage-speed': 0.10, capacity: 0.25 },
    groups: { gpu: { Compute: 4, Transfer: 1.5, Drawing: 0.5, 'Ray tracing': 0.25, Video: 0.25 }, cpu: { 'All cores': 2, 'Six threads': 1, 'One core': 1 }, memory: { Bandwidth: 2 }, capacity: { Memory: 3 } },
    sizes: { n_mem_size: [[4, 40], [8, 200], [16, 500], [32, 1000], [64, 1450], [128, 1850], [256, 2150], [512, 2350]], n_sto_total: [[256, 380], [512, 620], [1000, 800], [2000, 930], [4000, 1000], [8000, 1060]] } },
  { id: 'science', name: 'Science and simulation', score: 'Science score', blurb: 'Floating-point maths on every core and the graphics chip, memory bandwidth, and enough memory to hold the whole model: research problems grow to fill whatever there is.',
    weights: { cpu: 0.40, gpu: 0.20, memory: 0.22, 'storage-speed': 0.08, capacity: 0.20 },
    groups: { cpu: { 'All cores': 3, 'Six threads': 1, 'One core': 1 }, gpu: { Compute: 4, Transfer: 1.5, Drawing: 0.25, 'Ray tracing': 0.25, Video: 0.1 }, memory: { Bandwidth: 3 }, capacity: { Memory: 3 } },
    sizes: { n_mem_size: [[4, 40], [8, 220], [16, 520], [32, 1000], [64, 1400], [128, 1750], [256, 2000], [512, 2200], [1024, 2300]], n_sto_total: [[256, 300], [512, 500], [1000, 680], [2000, 850], [4000, 1000], [8000, 1180], [16000, 1320], [32000, 1420]] } },
  { id: 'virtual', name: 'Virtual machines', score: 'Virtual machine score', blurb: 'Many systems on one computer: every one needs its own memory, so size counts most, then cores, then quick small-file storage for their disks.',
    weights: { cpu: 0.30, gpu: 0.03, memory: 0.17, 'storage-speed': 0.20, capacity: 0.30 },
    groups: { cpu: { 'All cores': 3, 'Six threads': 1, 'One core': 1 }, memory: { Bandwidth: 2 }, 'storage-speed': { 'Small pieces': 2.5 }, capacity: { Memory: 3 } },
    sizes: { n_mem_size: [[4, 30], [8, 200], [16, 480], [32, 1000], [64, 1500], [128, 1950], [256, 2300], [512, 2550], [1024, 2700], [2048, 2800]], n_sto_total: [[256, 280], [512, 480], [1000, 680], [2000, 860], [4000, 1000], [8000, 1150], [16000, 1250], [32000, 1300]] } },
  { id: 'server', name: 'Home server and NAS', score: 'Server score', blurb: 'Room for files above all, then storage speed, memory for caching and apps, cores for many small jobs, and the video encoder for streaming. Drawing speed does not matter.',
    weights: { cpu: 0.20, gpu: 0.03, memory: 0.10, 'storage-speed': 0.30, capacity: 0.37 },
    groups: { cpu: { 'All cores': 1.5, 'Six threads': 1, 'One core': 1 }, gpu: { Video: 4, Compute: 0.5, Drawing: 0.1, 'Ray tracing': 0.1, Transfer: 0.5 }, 'storage-speed': { 'Big files': 2, 'Small pieces': 1.5 }, capacity: { Storage: 3 } },
    sizes: { n_mem_size: [[2, 60], [4, 250], [8, 550], [16, 820], [32, 1000], [64, 1180], [128, 1320], [256, 1420], [512, 1480]], n_sto_total: [[256, 120], [512, 250], [1000, 420], [2000, 700], [4000, 1000], [8000, 1300], [16000, 1580], [32000, 1820], [64000, 2000], [128000, 2120], [256000, 2200]] } },
];

export function scoreRun(run, profile = PROFILES[0]) {
  const tests = {}, sums = {};
  for (const [id, v] of Object.entries(run.tests || {})) {
    const s = scoreTest(id, v, profile); if (s == null) continue;
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
