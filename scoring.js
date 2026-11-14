// What gets measured, how it is grouped, and how raw results turn into points.
// A test's score is 1000 x result / reference, so the scale is linear and has no ceiling:
// a machine ten times faster scores ten times higher. A part's score is the weighted
// geometric mean of its tests, and the overall score is the weighted geometric mean of the parts.
//
// SUITE 1 IS FROZEN (2026-11-14). The tests, their workloads and the reference values below are the
// scale. Do not edit them, and do not add scored tests: a run made today must score the same in ten
// years, next to machines that do not exist yet, without anyone having to test the old one again.
// What CAN change without touching old results: use cases, weights and size curves (scores are worked
// out from the stored raw results when they are shown), and new tests marked unscored.
// Runs from before suite 1 (no "suite: 1") used other tests and are not shown or ranked.
//
// One list serves both tests. The computer test and the browser test run the same workloads (the CPU
// and memory ones are one Rust crate, native/kernels, compiled to WebAssembly for the browser; the GPU
// ones are the same shaders). A browser adds its own overhead, so each test has two references taken
// on the same machine: ref for the computer test, bref for the browser test. The reference machine
// scores 1000 either way, and a browser score says how fast the computer is through that browser.
export const SUITE = 1;
export const REF_DEVICE = 'a Ryzen 9 5950X + RTX 3080 desktop, November 2026';

export const CATS = [
  { id: 'cpu', name: 'CPU speed', short: 'CPU', weight: 0.35, ink: 'sun', blurb: 'How fast the processor gets through the work real programs do: on one core, on six threads (about what games and everyday apps use) and on all of them.' },
  { id: 'gpu', name: 'GPU speed', short: 'GPU', weight: 0.25, ink: 'pink', blurb: 'Graphics chip: number-crunching, drawing (including a game-like scene), ray tracing, moving data, and video encoding and decoding.' },
  { id: 'memory', name: 'Memory speed', short: 'Memory', weight: 0.15, ink: 'mint', blurb: 'How fast RAM can be filled, read, copied and jumped around in.' },
  { id: 'storage-speed', name: 'Storage speed', short: 'Storage', weight: 0.25, ink: 'ink', blurb: 'How fast the drive writes and reads files: big streams, small scattered pieces one at a time and 32 at once, and lots of little files.' },
  { id: 'capacity', name: 'Capacity', short: 'Size', weight: 0.12, ink: 'sun', blurb: 'How much memory, graphics memory and storage the computer has. Measured by the computer test only: a browser cannot see them.' },
];

// div turns the raw rate into the display unit. Sizes (curve) score through a curve of [GB, points]
// anchors instead of a straight ratio: more helps, less and less, and past what a use case can use it
// stops helping. The curve here is for general use; each use case in PROFILES has its own (sizes).
// Speed has no curve: twice as fast is always twice the points.
// kind groups CPU tests by the sort of work, so a use case can lean on the ones that matter to it.
export const TESTS = {
  c1_zip: { cat: 'cpu', group: 'One core', kind: 'apps', name: 'Compression', unit: 'MB/s', div: 1e6, ref: 39.19, bref: 37.12, what: 'Packing and unpacking writing and tables with deflate: zip files, PNG images, web pages.' },
  c1_json: { cat: 'cpu', group: 'One core', kind: 'apps', name: 'Text and data', unit: 'MB/s', div: 1e6, ref: 399.9, bref: 264, what: 'Reading a JSON document into objects, working through it and writing it back out.' },
  c1_script: { cat: 'cpu', group: 'One core', kind: 'apps', name: 'Script interpreter', unit: 'M steps/s', div: 1e6, ref: 318.2, bref: 253.1, what: 'A small program run by an interpreter, the way scripting languages and web pages run.' },
  c1_db: { cat: 'cpu', group: 'One core', kind: 'apps', name: 'Database', unit: 'M ops/s', div: 1e6, ref: 7.72, bref: 6.835, what: 'Look-ups, replacements and range scans in a sorted index of 200,000 records, plus look-ups by name.' },
  c1_sort: { cat: 'cpu', group: 'One core', kind: 'apps', name: 'Sorting', unit: 'M items/s', div: 1e6, ref: 57.28, bref: 37.6, what: 'Sorting 200,000 numbers and 20,000 names.' },
  c1_crypto: { cat: 'cpu', group: 'One core', kind: 'apps', name: 'Hardware crypto', unit: 'MB/s', div: 1e6, ref: 2381, bref: 1610, what: 'SHA-256 through the CPU\'s built-in crypto instructions: https, disk encryption, checksums.' },
  c1_path: { cat: 'cpu', group: 'One core', kind: 'sim', name: 'Route finding', unit: 'K nodes/s', div: 1e3, ref: 19840, bref: 16760, what: 'Finding routes across a map full of obstacles (A*), as games and navigation do.' },
  c1_physics: { cat: 'cpu', group: 'One core', kind: 'sim', name: 'Physics', unit: 'M moves/s', div: 1e6, ref: 18.52, bref: 16.82, what: '3,000 balls falling and bouncing off the walls and each other.' },
  c1_image: { cat: 'cpu', group: 'One core', kind: 'media', name: 'Photo editing', unit: 'Mpix/s', div: 1e6, ref: 182.2, bref: 126.1, what: 'Blurring a photo, shrinking it to half size and stretching its contrast.' },
  c1_ray: { cat: 'cpu', group: 'One core', kind: 'media', name: 'Rendering', unit: 'M rays/s', div: 1e6, ref: 21.18, bref: 20.01, what: 'A ray-traced picture with shadows and mirror reflections, worked out on the processor.' },
  c1_matrix: { cat: 'cpu', group: 'One core', kind: 'maths', name: 'Matrix multiply', unit: 'GFLOP/s', div: 1e9, ref: 26.13, bref: 10.34, what: 'Dense double-precision linear algebra, the shape of science and AI work, on the wide vector units where the chip has them.' },

  c6_zip: { cat: 'cpu', group: 'Six threads', kind: 'apps', name: 'Compression', unit: 'MB/s', div: 1e6, ref: 225.0, bref: 212.2, what: 'The same on six threads: about as many as a game or a busy app keeps working.' },
  c6_json: { cat: 'cpu', group: 'Six threads', kind: 'apps', name: 'Text and data', unit: 'MB/s', div: 1e6, ref: 2168, bref: 1486, what: 'The same on six threads: about as many as a game or a busy app keeps working.' },
  c6_script: { cat: 'cpu', group: 'Six threads', kind: 'apps', name: 'Script interpreter', unit: 'M steps/s', div: 1e6, ref: 1786, bref: 1413, what: 'The same on six threads: about as many as a game or a busy app keeps working.' },
  c6_db: { cat: 'cpu', group: 'Six threads', kind: 'apps', name: 'Database', unit: 'M ops/s', div: 1e6, ref: 20.63, bref: 19.16, what: 'The same on six threads: about as many as a game or a busy app keeps working.' },
  c6_sort: { cat: 'cpu', group: 'Six threads', kind: 'apps', name: 'Sorting', unit: 'M items/s', div: 1e6, ref: 323.3, bref: 213.3, what: 'The same on six threads: about as many as a game or a busy app keeps working.' },
  c6_crypto: { cat: 'cpu', group: 'Six threads', kind: 'apps', name: 'Hardware crypto', unit: 'MB/s', div: 1e6, ref: 13720, bref: 6111, what: 'The same on six threads: about as many as a game or a busy app keeps working.' },
  c6_path: { cat: 'cpu', group: 'Six threads', kind: 'sim', name: 'Route finding', unit: 'K nodes/s', div: 1e3, ref: 113400, bref: 96120, what: 'The same on six threads: about as many as a game or a busy app keeps working.' },
  c6_physics: { cat: 'cpu', group: 'Six threads', kind: 'sim', name: 'Physics', unit: 'M moves/s', div: 1e6, ref: 105.2, bref: 96.54, what: 'The same on six threads: about as many as a game or a busy app keeps working.' },
  c6_image: { cat: 'cpu', group: 'Six threads', kind: 'media', name: 'Photo editing', unit: 'Mpix/s', div: 1e6, ref: 989.8, bref: 715.9, what: 'The same on six threads: about as many as a game or a busy app keeps working.' },
  c6_ray: { cat: 'cpu', group: 'Six threads', kind: 'media', name: 'Rendering', unit: 'M rays/s', div: 1e6, ref: 121.5, bref: 115.3, what: 'The same on six threads: about as many as a game or a busy app keeps working.' },
  c6_matrix: { cat: 'cpu', group: 'Six threads', kind: 'maths', name: 'Matrix multiply', unit: 'GFLOP/s', div: 1e9, ref: 137.4, bref: 57.4, what: 'The same on six threads: about as many as a game or a busy app keeps working.' },

  ca_zip: { cat: 'cpu', group: 'All cores', kind: 'apps', name: 'Compression', unit: 'MB/s', div: 1e6, ref: 891.5, bref: 798.7, pair: 'c1_zip', what: 'The same on every thread at once.' },
  ca_json: { cat: 'cpu', group: 'All cores', kind: 'apps', name: 'Text and data', unit: 'MB/s', div: 1e6, ref: 3442, bref: 3795, pair: 'c1_json', what: 'The same on every thread at once.' },
  ca_script: { cat: 'cpu', group: 'All cores', kind: 'apps', name: 'Script interpreter', unit: 'M steps/s', div: 1e6, ref: 5127, bref: 3352, pair: 'c1_script', what: 'The same on every thread at once.' },
  ca_db: { cat: 'cpu', group: 'All cores', kind: 'apps', name: 'Database', unit: 'M ops/s', div: 1e6, ref: 41.64, bref: 44.25, pair: 'c1_db', what: 'The same on every thread at once.' },
  ca_sort: { cat: 'cpu', group: 'All cores', kind: 'apps', name: 'Sorting', unit: 'M items/s', div: 1e6, ref: 945.7, bref: 653.8, pair: 'c1_sort', what: 'The same on every thread at once.' },
  ca_crypto: { cat: 'cpu', group: 'All cores', kind: 'apps', name: 'Hardware crypto', unit: 'MB/s', div: 1e6, ref: 64490, bref: 7684, pair: 'c1_crypto', what: 'The same on every thread at once.' },
  ca_path: { cat: 'cpu', group: 'All cores', kind: 'sim', name: 'Route finding', unit: 'K nodes/s', div: 1e3, ref: 437500, bref: 342700, pair: 'c1_path', what: 'The same on every thread at once.' },
  ca_physics: { cat: 'cpu', group: 'All cores', kind: 'sim', name: 'Physics', unit: 'M moves/s', div: 1e6, ref: 408.9, bref: 356.3, pair: 'c1_physics', what: 'The same on every thread at once.' },
  ca_image: { cat: 'cpu', group: 'All cores', kind: 'media', name: 'Photo editing', unit: 'Mpix/s', div: 1e6, ref: 1444, bref: 1403, pair: 'c1_image', what: 'The same on every thread at once.' },
  ca_ray: { cat: 'cpu', group: 'All cores', kind: 'media', name: 'Rendering', unit: 'M rays/s', div: 1e6, ref: 347.0, bref: 312.2, pair: 'c1_ray', what: 'The same on every thread at once.' },
  ca_matrix: { cat: 'cpu', group: 'All cores', kind: 'maths', name: 'Matrix multiply', unit: 'GFLOP/s', div: 1e9, ref: 237.9, bref: 125.9, pair: 'c1_matrix', what: 'The same on every thread at once.' },

  m_fill:     { cat: 'memory', group: 'Bandwidth', name: 'Fill', unit: 'GB/s', div: 1e9, ref: 25.41, bref: 25.26, what: 'Writing one value across a block far bigger than the processor\'s cache.' },
  m_read:     { cat: 'memory', group: 'Bandwidth', name: 'Read', unit: 'GB/s', div: 1e9, ref: 37.41, bref: 33.81, what: 'Reading the block end to end.' },
  m_copy:     { cat: 'memory', group: 'Bandwidth', name: 'Copy', unit: 'GB/s', div: 1e9, ref: 21.85, bref: 23.15, what: 'Copying one block onto another.' },
  m_copy_all: { cat: 'memory', group: 'Bandwidth', name: 'Copy on all threads', unit: 'GB/s', div: 1e9, ref: 19.33, bref: 12.88, what: 'Every thread copying at once: the total the memory channels can carry.' },
  m_chase:    { cat: 'memory', group: 'Latency', name: 'Random jumps', unit: 'M hops/s', div: 1e6, ref: 15.88, bref: 15.53, what: 'Chasing pointers through the block: one cache miss per hop.' },
  m_alloc:    { cat: 'memory', group: 'Allocation', name: 'Make and drop objects', unit: 'M allocs/s', div: 1e6, ref: 209.1, bref: 70.98, what: 'Lots of small short-lived allocations.' },

  s_seq_write:    { cat: 'storage-speed', group: 'Big files', name: 'Sequential write', unit: 'MB/s', ref: 2059, what: 'Writing a 4 GB file in 64 MB pieces, cache bypassed.' },
  s_seq_read:     { cat: 'storage-speed', group: 'Big files', name: 'Sequential read', unit: 'MB/s', ref: 6678, what: 'Reading it back in 64 MB pieces, cache bypassed.' },
  s_rand_write:   { cat: 'storage-speed', group: 'Small pieces', name: 'Random 4K write', unit: 'IOPS', ref: 12370, what: 'Small writes scattered across the file, one at a time: how quick the drive feels.' },
  s_rand_read:    { cat: 'storage-speed', group: 'Small pieces', name: 'Random 4K read', unit: 'IOPS', ref: 21370, what: 'Small reads scattered across the file, one at a time.' },
  s_rand32_write: { cat: 'storage-speed', group: 'Busy drive', name: 'Random 4K write, 32 at once', unit: 'IOPS', ref: 64170, what: 'The same small writes with 32 going at once: many programs or users on one drive.' },
  s_rand32_read:  { cat: 'storage-speed', group: 'Busy drive', name: 'Random 4K read, 32 at once', unit: 'IOPS', ref: 497200, what: 'The same small reads with 32 going at once.' },
  s_files:        { cat: 'storage-speed', group: 'Small pieces', name: 'Small files', unit: 'files/s', ref: 29070, what: 'Creating, writing and deleting many little files.' },
  // Browser only, shown but never scored: a browser serves these from memory and its own database.
  sto_seq_write:  { cat: 'storage-speed', group: 'Big files', name: 'Sequential write', unit: 'MB/s', unscored: true, what: 'Writing one large file start to finish.' },
  sto_seq_read:   { cat: 'storage-speed', group: 'Big files', name: 'Sequential read', unit: 'MB/s', unscored: true, what: 'Reading it back. The system may serve this from memory.' },
  sto_rand_write: { cat: 'storage-speed', group: 'Small pieces', name: 'Random 4K write', unit: 'IOPS', unscored: true, what: 'Small writes scattered across the file.' },
  sto_rand_read:  { cat: 'storage-speed', group: 'Small pieces', name: 'Random 4K read', unit: 'IOPS', unscored: true, what: 'Small reads scattered across the file.' },
  sto_files:      { cat: 'storage-speed', group: 'Small pieces', name: 'Small files', unit: 'files/s', unscored: true, what: 'Creating, writing and deleting many little files.' },

  gpu_matmul:    { cat: 'gpu', group: 'Compute', name: 'Matrix compute', unit: 'GFLOP/s', ref: 1542, bref: 811.4, what: 'A 512x512 matrix multiply in a compute shader.' },
  gpu_particles: { cat: 'gpu', group: 'Compute', name: 'Particle compute', unit: 'M updates/s', ref: 10720, bref: 10550, what: 'Moving a million particles per step.' },
  gpu_fill:      { cat: 'gpu', group: 'Drawing', name: 'Pixel shading', unit: 'Mpix/s', ref: 25550, bref: 24980, what: 'Layered noise shaded over a 1080p frame.' },
  gpu_geom:      { cat: 'gpu', group: 'Drawing', name: 'Triangle throughput', unit: 'M tris/s', ref: 1495, bref: 787.3, what: '400,000 small triangles per frame.' },
  gpu_scene:     { cat: 'gpu', group: 'Drawing', name: 'Game-like scene', unit: 'fps', ref: 1059, bref: 706.4, what: '2,000 textured, lit objects (4 million triangles) with a depth buffer at 1080p, one draw call each.' },
  gpu_rays:      { cat: 'gpu', group: 'Ray tracing', name: 'Ray tracing (compute)', unit: 'M rays/s', ref: 2967, bref: 2137, what: 'A 131,000-triangle landscape at 1080p, a camera ray and a shadow ray per pixel, traced in a compute shader.' },
  gpu_rt:        { cat: 'gpu', group: 'Ray tracing', name: 'Ray tracing (hardware)', unit: 'M rays/s', ref: 10030, what: 'The same scene on the ray-tracing hardware where the test can reach it; otherwise the compute version stands in.' },
  gpu_upload:    { cat: 'gpu', group: 'Transfer', name: 'Upload to GPU', unit: 'MB/s', ref: 8110, bref: 1892, what: 'Sending data from memory to the graphics chip.' },
  gpu_readback:  { cat: 'gpu', group: 'Transfer', name: 'Read back from GPU', unit: 'MB/s', ref: 12110, bref: 7138, what: 'Fetching data back from the graphics chip.' },
  // Browsers without WebGPU: drawing only.
  gl_fill:       { cat: 'gpu', group: 'Drawing', name: 'Pixel shading (WebGL)', unit: 'Mpix/s', bref: 25000, what: 'Layered noise shaded over a 1080p frame.' },
  gl_geom:       { cat: 'gpu', group: 'Drawing', name: 'Triangle throughput (WebGL)', unit: 'M tris/s', bref: 775, what: '200,000 small triangles per frame.' },
  // Video goes through the browser's video engine in both tests (the computer test runs it on its results page).
  vid_enc_h264:  { cat: 'gpu', group: 'Video', name: 'H.264 encode 1080p', unit: 'fps', ref: 160, bref: 160, what: 'Compressing 1080p video, on the hardware encoder if there is one.' },
  vid_dec_h264:  { cat: 'gpu', group: 'Video', name: 'H.264 decode 1080p', unit: 'fps', ref: 1045, bref: 1045, what: 'Unpacking the same video.' },
  // Shown but not scored, because not every device has these codecs.
  vid_enc_hevc: { cat: 'gpu', group: 'Video', name: 'HEVC encode 1080p', unit: 'fps', unscored: true },
  vid_dec_hevc: { cat: 'gpu', group: 'Video', name: 'HEVC decode 1080p', unit: 'fps', unscored: true },
  vid_enc_vp9:  { cat: 'gpu', group: 'Video', name: 'VP9 encode 1080p', unit: 'fps', unscored: true },
  vid_dec_vp9:  { cat: 'gpu', group: 'Video', name: 'VP9 decode 1080p', unit: 'fps', unscored: true },
  vid_enc_av1:  { cat: 'gpu', group: 'Video', name: 'AV1 encode 1080p', unit: 'fps', unscored: true },
  vid_dec_av1:  { cat: 'gpu', group: 'Video', name: 'AV1 decode 1080p', unit: 'fps', unscored: true },

  sz_ram:   { cat: 'capacity', group: 'Memory', name: 'Memory size', unit: 'GB', ref: 32, curve: [[2, 40], [4, 150], [8, 550], [16, 880], [32, 1000], [64, 1050], [128, 1080]], what: 'Installed RAM. 8 GB is the least that runs today\'s apps comfortably; past 32 GB everyday use hardly notices.' },
  sz_drive: { cat: 'capacity', group: 'Storage', name: 'Drive size', unit: 'GB', ref: 4000, curve: [[64, 150], [128, 330], [256, 560], [512, 780], [1000, 900], [2000, 970], [4000, 1000]], what: 'Total size of the drive that was tested.' },
  sz_vram:  { cat: 'capacity', group: 'Graphics memory', name: 'Graphics memory', unit: 'GB', ref: 10, curve: [[1, 250], [2, 450], [4, 700], [8, 950], [10, 1000], [16, 1060], [24, 1100]], what: 'Memory the graphics chip can use: its own, or half the system\'s where the two are shared. It decides which games and AI models fit at all.' },
};

// Installed memory in GB from the byte count the computer test reports (the system keeps a little back).
export const ramGB = bytes => { const g = bytes / 2 ** 30; return g >= 6 ? Math.round(g / 2) * 2 : Math.round(g); };
export const isNative = run => !!(run.native || (run.device && run.device.native));

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
// browser picks the browser test's reference.
export function scoreTest(id, value, profile, browser = false) {
  const t = TESTS[id];
  if (!t || t.unscored || !(value > 0)) return null;
  if (t.curve) return browser ? null : curvePoints(profile?.sizes?.[id] || t.curve, value);
  const ref = browser ? t.bref : t.ref;
  return ref ? 1000 * value / ref : null;
}

const CPU_EVEN = { 'One core': 1, 'Six threads': 1, 'All cores': 1 };
export const PROFILES = [
  { id: 'general', name: 'General use', score: 'System score', blurb: 'An even mix of everything.',
    weights: { cpu: 0.35, gpu: 0.25, memory: 0.15, 'storage-speed': 0.25, capacity: 0.12 }, groups: { cpu: CPU_EVEN }, sizes: {} },
  { id: 'gaming', name: 'Gaming', score: 'Gaming score', blurb: 'Mostly the graphics chip drawing frames, then fast cores: games lean on one main thread and a handful of helpers, rarely more than six to eight. 16 GB of memory runs most games, 32 GB all of them.',
    weights: { cpu: 0.25, gpu: 0.55, memory: 0.08, 'storage-speed': 0.12, capacity: 0.08 },
    groups: { gpu: { Drawing: 3, 'Ray tracing': 1, Compute: 1, Transfer: 1, Video: 0.5 }, cpu: { 'One core': 2, 'Six threads': 3, 'All cores': 0.5 }, capacity: { 'Graphics memory': 2.5, Memory: 1.5 }, 'storage-speed': { 'Busy drive': 0.5 } },
    kinds: { sim: 3, apps: 1, media: 1, maths: 0.5 },
    sizes: { sz_ram: [[4, 80], [8, 350], [16, 850], [32, 1000]], sz_drive: [[256, 350], [512, 650], [1000, 830], [2000, 950], [4000, 1000]], sz_vram: [[2, 150], [4, 400], [6, 620], [8, 820], [10, 1000], [12, 1120], [16, 1300], [24, 1450], [32, 1500]] } },
  { id: 'office', name: 'Office work', score: 'Office score', blurb: 'Snappy single cores, quick small-file storage and responsive memory. The graphics chip barely matters, and 16 GB is plenty.',
    weights: { cpu: 0.45, gpu: 0.07, memory: 0.20, 'storage-speed': 0.28, capacity: 0.06 },
    groups: { cpu: { 'One core': 3, 'Six threads': 1.5, 'All cores': 0.3 }, 'storage-speed': { 'Busy drive': 0.5, 'Small pieces': 2.5 }, memory: { Latency: 2, Allocation: 2 }, capacity: { 'Graphics memory': 0.2 } },
    kinds: { apps: 3, media: 1, sim: 0.5, maths: 0.3 },
    sizes: { sz_ram: [[2, 60], [4, 300], [8, 720], [16, 950], [32, 1000]], sz_drive: [[64, 300], [128, 560], [256, 800], [512, 950], [1000, 1000]], sz_vram: [[1, 600], [2, 850], [4, 950], [10, 1000]] } },
  { id: 'design', name: 'Graphic design and photo', score: 'Design score', blurb: 'A balance of processor, graphics and plenty of fast memory for big images and many layers.',
    weights: { cpu: 0.35, gpu: 0.25, memory: 0.20, 'storage-speed': 0.20, capacity: 0.12 },
    groups: { gpu: { Drawing: 2, Compute: 1.5, 'Ray tracing': 0.5 }, cpu: { 'One core': 1.5, 'Six threads': 1.5, 'All cores': 1 } },
    kinds: { media: 3 },
    sizes: { sz_ram: [[4, 80], [8, 400], [16, 750], [32, 1000], [64, 1150], [128, 1220]], sz_drive: [[256, 420], [512, 650], [1000, 800], [2000, 920], [4000, 1000], [8000, 1060]], sz_vram: [[2, 300], [4, 600], [8, 900], [10, 1000], [16, 1150], [24, 1250]] } },
  { id: 'video', name: 'Video editing', score: 'Video editing score', blurb: 'Every core, video encoding on the graphics chip, fast big-file storage, and room for hours of footage.',
    weights: { cpu: 0.30, gpu: 0.30, memory: 0.12, 'storage-speed': 0.28, capacity: 0.15 },
    groups: { cpu: { 'All cores': 2.5, 'Six threads': 1, 'One core': 1 }, gpu: { Video: 3, Compute: 1.5, 'Ray tracing': 0.5 }, 'storage-speed': { 'Big files': 2.5 }, capacity: { Storage: 2 } },
    kinds: { media: 3 },
    sizes: { sz_ram: [[4, 60], [8, 320], [16, 680], [32, 1000], [64, 1180], [128, 1300]], sz_drive: [[256, 200], [512, 350], [1000, 550], [2000, 780], [4000, 1000], [8000, 1220], [16000, 1400], [32000, 1520]], sz_vram: [[2, 250], [4, 500], [8, 850], [10, 1000], [16, 1200], [24, 1350], [48, 1450]] } },
  { id: 'dev', name: 'Software development', score: 'Development score', blurb: 'Compiling on every core, lots of small files, and memory for editors, browsers and containers side by side.',
    weights: { cpu: 0.45, gpu: 0.05, memory: 0.20, 'storage-speed': 0.30, capacity: 0.10 },
    groups: { cpu: { 'All cores': 2, 'Six threads': 1, 'One core': 1 }, 'storage-speed': { 'Busy drive': 1.5, 'Small pieces': 3 }, capacity: { 'Graphics memory': 0.2 } },
    kinds: { apps: 2.5 },
    sizes: { sz_ram: [[4, 80], [8, 450], [16, 800], [32, 1000], [64, 1130], [128, 1200]], sz_drive: [[128, 300], [256, 580], [512, 800], [1000, 920], [2000, 980], [4000, 1000]], sz_vram: [[1, 500], [2, 750], [4, 900], [10, 1000], [24, 1050]] } },
  { id: 'engineering', name: 'Engineering and CAD', score: 'Engineering score', blurb: 'CAD modelling runs mostly on one core while the graphics chip draws the model; simulation and rendering use every core and lots of memory.',
    weights: { cpu: 0.35, gpu: 0.30, memory: 0.12, 'storage-speed': 0.13, capacity: 0.12 },
    groups: { cpu: { 'One core': 2.5, 'Six threads': 1.5, 'All cores': 1 }, gpu: { Drawing: 3, 'Ray tracing': 1.5, Compute: 1, Video: 0.25 }, capacity: { 'Graphics memory': 1.5, Memory: 1.5 } },
    kinds: { maths: 2, sim: 2, media: 1.5 },
    sizes: { sz_ram: [[4, 60], [8, 330], [16, 700], [32, 1000], [64, 1200], [128, 1320], [256, 1380]], sz_drive: [[256, 450], [512, 650], [1000, 820], [2000, 940], [4000, 1000], [8000, 1050]], sz_vram: [[2, 250], [4, 550], [8, 880], [10, 1000], [16, 1200], [24, 1350], [48, 1500]] } },
  { id: 'ai', name: 'AI and machine learning', score: 'AI score', blurb: 'GPU compute first, then how much memory there is: the size of a model you can run locally is set by memory. Matrix maths on every core and memory bandwidth follow.',
    weights: { cpu: 0.20, gpu: 0.55, memory: 0.15, 'storage-speed': 0.10, capacity: 0.25 },
    groups: { gpu: { Compute: 4, Transfer: 1.5, Drawing: 0.5, 'Ray tracing': 0.25, Video: 0.25 }, cpu: { 'All cores': 2, 'Six threads': 1, 'One core': 1 }, memory: { Bandwidth: 2 }, capacity: { 'Graphics memory': 3, Memory: 2, Storage: 0.5 } },
    kinds: { maths: 3 },
    sizes: { sz_ram: [[4, 40], [8, 200], [16, 500], [32, 1000], [64, 1450], [128, 1850], [256, 2150], [512, 2350]], sz_drive: [[256, 380], [512, 620], [1000, 800], [2000, 930], [4000, 1000], [8000, 1060]], sz_vram: [[2, 80], [4, 250], [8, 750], [10, 1000], [12, 1200], [16, 1500], [24, 1950], [48, 2500], [96, 2900], [192, 3150]] } },
  { id: 'science', name: 'Science and simulation', score: 'Science score', blurb: 'Floating-point maths on every core and the graphics chip, memory bandwidth, and enough memory to hold the whole model: research problems grow to fill whatever there is.',
    weights: { cpu: 0.40, gpu: 0.20, memory: 0.22, 'storage-speed': 0.08, capacity: 0.20 },
    groups: { cpu: { 'All cores': 3, 'Six threads': 1, 'One core': 1 }, gpu: { Compute: 4, Transfer: 1.5, Drawing: 0.25, 'Ray tracing': 0.25, Video: 0.1 }, memory: { Bandwidth: 3 }, capacity: { Memory: 3, 'Graphics memory': 1.5 } },
    kinds: { maths: 3, sim: 2 },
    sizes: { sz_ram: [[4, 40], [8, 220], [16, 520], [32, 1000], [64, 1400], [128, 1750], [256, 2000], [512, 2200], [1024, 2300]], sz_drive: [[256, 300], [512, 500], [1000, 680], [2000, 850], [4000, 1000], [8000, 1180], [16000, 1320], [32000, 1420]], sz_vram: [[2, 150], [4, 400], [8, 820], [10, 1000], [16, 1300], [24, 1550], [48, 1900], [96, 2100]] } },
  { id: 'virtual', name: 'Virtual machines', score: 'Virtual machine score', blurb: 'Many systems on one computer: every one needs its own memory, so size counts most, then cores, then quick small-file storage for their disks.',
    weights: { cpu: 0.30, gpu: 0.03, memory: 0.17, 'storage-speed': 0.20, capacity: 0.30 },
    groups: { cpu: { 'All cores': 3, 'Six threads': 1, 'One core': 1 }, memory: { Bandwidth: 2 }, 'storage-speed': { 'Busy drive': 3, 'Small pieces': 2.5 }, capacity: { Memory: 3, 'Graphics memory': 0.1 } },
    kinds: { apps: 2 },
    sizes: { sz_ram: [[4, 30], [8, 200], [16, 480], [32, 1000], [64, 1500], [128, 1950], [256, 2300], [512, 2550], [1024, 2700], [2048, 2800]], sz_drive: [[256, 280], [512, 480], [1000, 680], [2000, 860], [4000, 1000], [8000, 1150], [16000, 1250], [32000, 1300]], sz_vram: [[1, 600], [4, 900], [10, 1000], [24, 1050]] } },
  { id: 'server', name: 'Home server and NAS', score: 'Server score', blurb: 'Room for files above all, then storage speed, memory for caching and apps, cores for many small jobs, and the video encoder for streaming. Drawing speed does not matter.',
    weights: { cpu: 0.20, gpu: 0.03, memory: 0.10, 'storage-speed': 0.30, capacity: 0.37 },
    groups: { cpu: { 'All cores': 1.5, 'Six threads': 1, 'One core': 1 }, gpu: { Video: 4, Compute: 0.5, Drawing: 0.1, 'Ray tracing': 0.1, Transfer: 0.5 }, 'storage-speed': { 'Busy drive': 3, 'Big files': 2, 'Small pieces': 1.5 }, capacity: { Storage: 3, 'Graphics memory': 0.1 } },
    kinds: { apps: 2.5, media: 0.5, sim: 0.5 },
    sizes: { sz_ram: [[2, 60], [4, 250], [8, 550], [16, 820], [32, 1000], [64, 1180], [128, 1320], [256, 1420], [512, 1480]], sz_drive: [[256, 120], [512, 250], [1000, 420], [2000, 700], [4000, 1000], [8000, 1300], [16000, 1580], [32000, 1820], [64000, 2000], [128000, 2120], [256000, 2200]], sz_vram: [[1, 700], [4, 950], [10, 1000]] } },
];

export function scoreRun(run, profile = PROFILES[0]) {
  const tests = {}, sums = {}, browser = !isNative(run);
  if (run.suite === SUITE) for (const [id, v] of Object.entries(run.tests || {})) {
    const s = scoreTest(id, v, profile, browser); if (s == null) continue;
    const t = TESTS[id], w = (profile.groups?.[t.cat]?.[t.group] ?? 1) * (t.kind ? profile.kinds?.[t.kind] ?? 1 : 1);
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
