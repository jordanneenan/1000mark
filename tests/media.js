// Video transcoding tests through WebCodecs: encode 1080p frames with each codec
// the device supports, then decode the result. The browser picks the hardware
// encoder/decoder (NVENC, Quick Sync, VideoToolbox, MediaCodec...) when there is one.
const W = 1920, H = 1080;
const msg = e => String(e && e.message || e);
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const CODECS = [
  { key: 'h264', name: 'H.264', codec: 'avc1.640028' },
  { key: 'hevc', name: 'HEVC', codec: 'hvc1.1.6.L120.B0' },
  { key: 'vp9', name: 'VP9', codec: 'vp09.00.40.08' },
  { key: 'av1', name: 'AV1', codec: 'av01.0.08M.08' },
];

async function supported(Cls, cfg) { try { return !!(await Cls.isConfigSupported(cfg)).supported; } catch { return false; } }

function draw(ctx, i) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${(i * 3) % 360} 80% 50%)`); g.addColorStop(1, `hsl(${(i * 3 + 140) % 360} 80% 40%)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 60; k++) {
    ctx.fillStyle = `hsl(${(k * 37 + i * 5) % 360} 90% ${30 + (k % 5) * 12}%)`;
    const x = (k * 197 + i * (7 + k % 9)) % W, y = (k * 113 + i * (3 + k % 5)) % H;
    ctx.fillRect(x, y, 90 + (k % 7) * 30, 40 + (k % 4) * 35);
  }
}

async function encode(canvas, ctx, cfg, frames, budgetMs) {
  const chunks = []; let dcfg = null, err = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => { if (meta && meta.decoderConfig) dcfg = meta.decoderConfig; chunks.push(chunk); }, error: e => { err = e; } });
  enc.configure(cfg);
  const t0 = performance.now(); let n = 0;
  for (let i = 0; i < frames && !err; i++) {
    draw(ctx, i);
    const f = new VideoFrame(canvas, { timestamp: i * 33333 });
    enc.encode(f, { keyFrame: i % 30 === 0 }); f.close(); n++;
    while (enc.encodeQueueSize > 4 && !err) await sleep(1);
    if (performance.now() - t0 > budgetMs) break;
  }
  if (!err) await enc.flush();
  const s = (performance.now() - t0) / 1000;
  try { enc.close(); } catch {}
  if (err) throw err;
  return { fps: n / s, chunks, dcfg };
}

async function decode(dcfg, chunks, ms) {
  let n = 0, err = null;
  const dec = new VideoDecoder({ output: f => { n++; f.close(); }, error: e => { err = e; } });
  dec.configure(dcfg);
  const t0 = performance.now();
  do {                                                  // the clip starts on a keyframe, so it can be replayed
    for (const c of chunks) { if (err) break; dec.decode(c); while (dec.decodeQueueSize > 8 && !err) await sleep(1); }
    if (!err) await dec.flush();
  } while (!err && performance.now() - t0 < ms);
  const s = (performance.now() - t0) / 1000;
  try { dec.close(); } catch {}
  if (err) throw err;
  return n / s;
}

export async function runMedia({ quick, progress }) {
  const out = { values: {}, errors: {}, codecs: {} };
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof VideoFrame === 'undefined') {
    out.errors.video = 'This browser has no WebCodecs, so video encoding and decoding could not be tested.'; return out;
  }
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  for (const c of CODECS) {
    const ecfg = { codec: c.codec, width: W, height: H, bitrate: 6000000, framerate: 30 };
    const dcfg = { codec: c.codec, codedWidth: W, codedHeight: H };
    const m = out.codecs[c.key] = {
      name: c.name,
      encHW: await supported(VideoEncoder, { ...ecfg, hardwareAcceleration: 'prefer-hardware' }),
      encSW: await supported(VideoEncoder, { ...ecfg, hardwareAcceleration: 'prefer-software' }),
      decHW: await supported(VideoDecoder, { ...dcfg, hardwareAcceleration: 'prefer-hardware' }),
      decSW: await supported(VideoDecoder, { ...dcfg, hardwareAcceleration: 'prefer-software' }),
    };
    if (!m.encHW && !m.encSW) continue;
    try {
      progress(`Video · ${c.name} encode`);
      const r = await encode(canvas, ctx, ecfg, quick ? 45 : 120, quick ? 2500 : 5000);
      out.values['vid_enc_' + c.key] = r.fps;
      if (r.dcfg && r.chunks.length && (m.decHW || m.decSW)) {
        progress(`Video · ${c.name} decode`);
        out.values['vid_dec_' + c.key] = await decode(r.dcfg, r.chunks, quick ? 500 : 1200);
      }
    } catch (e) { out.errors['vid_' + c.key] = msg(e); }
  }
  return out;
}
