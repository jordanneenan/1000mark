// Storage tests. A web page cannot touch the disk directly, so these use the
// browser's private file system (OPFS) with synchronous access handles: real
// files on the device's own storage, written and read from this worker.
const MB = 1048576, CH = 4 * MB;
let seed = 4242;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
const msg = e => String(e && e.message || e);

self.onmessage = async e => {
  const { id, quick } = e.data;
  const out = { id, values: {}, errors: {}, quota: 0, usage: 0 };
  const say = label => self.postMessage({ id, progress: label });
  try { const est = await navigator.storage.estimate(); out.quota = est.quota || 0; out.usage = est.usage || 0; }
  catch (err) { out.errors.sto_space = msg(err); }

  let root, h;
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) throw new Error('This browser has no private file system (OPFS). It needs a secure (https) page.');
    root = await navigator.storage.getDirectory();
    try { await root.removeEntry('pressmark-tmp', { recursive: true }); } catch {}
    const dir = await root.getDirectoryHandle('pressmark-tmp', { create: true });
    const fh = await dir.getFileHandle('seq.bin', { create: true });
    if (!fh.createSyncAccessHandle) throw new Error('This browser cannot open files for fast access (no OPFS sync handles).');
    h = await fh.createSyncAccessHandle();

    let total = (quick ? 32 : 128) * MB;
    const free = out.quota - out.usage;
    if (free > 0 && free < total * 3) total = Math.max(2 * CH, Math.floor(free / 6 / CH) * CH);
    out.fileBytes = total;

    const chunk = new Uint8Array(CH);                 // incompressible data, so compressing drives get no free ride
    for (let i = 0; i < CH; i += 4) { const v = (rnd() * 4294967296) >>> 0; chunk[i] = v; chunk[i+1] = v >>> 8; chunk[i+2] = v >>> 16; chunk[i+3] = v >>> 24; }

    say('Storage · sequential write');
    let t0 = performance.now();
    for (let at = 0; at < total; at += CH) h.write(chunk, { at });
    h.flush();
    out.values.sto_seq_write = total / MB / ((performance.now() - t0) / 1000);

    say('Storage · sequential read');
    const rbuf = new Uint8Array(CH);
    t0 = performance.now();
    for (let at = 0; at < total; at += CH) h.read(rbuf, { at });
    out.values.sto_seq_read = total / MB / ((performance.now() - t0) / 1000);

    say('Storage · random 4K write');
    const small = chunk.subarray(0, 4096), blocks = total / 4096;
    let n = quick ? 400 : 1500;
    t0 = performance.now();
    for (let i = 0; i < n; i++) { h.write(small, { at: ((rnd() * blocks) | 0) * 4096 }); if (i % 50 === 49) h.flush(); }
    h.flush();
    out.values.sto_rand_write = n / ((performance.now() - t0) / 1000);

    say('Storage · random 4K read');
    const sbuf = new Uint8Array(4096);
    n = quick ? 2000 : 8000;
    t0 = performance.now();
    for (let i = 0; i < n; i++) h.read(sbuf, { at: ((rnd() * blocks) | 0) * 4096 });
    out.values.sto_rand_read = n / ((performance.now() - t0) / 1000);
    h.close(); h = null;

    say('Storage · small files');
    n = quick ? 60 : 200;
    t0 = performance.now();
    for (let i = 0; i < n; i++) { const f = await dir.getFileHandle('f' + i, { create: true }); const s = await f.createSyncAccessHandle(); s.write(small, { at: 0 }); s.flush(); s.close(); }
    for (let i = 0; i < n; i++) await dir.removeEntry('f' + i);
    out.values.sto_files = n / ((performance.now() - t0) / 1000);
  } catch (err) { out.errors.storage = msg(err); }
  try { if (h) h.close(); } catch {}
  try { if (root) await root.removeEntry('pressmark-tmp', { recursive: true }); } catch {}
  self.postMessage(out);
};
