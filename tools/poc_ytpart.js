const { execFileSync, execFile } = require('child_process');
const fs = require('fs');
const yt = require('../src/main/youtube.js');
(async () => {
  const t0 = Date.now();
  const rt = await yt.getJsRuntime();
  const args = ['--js-runtimes', rt.arg || rt, '-g', '-f', '299,140', 'https://www.youtube.com/watch?v=9Tmjg3ESEyc'];
  const env = { ...process.env, ...(rt.env || {}) };
  const out = execFileSync('bin/yt-dlp.exe', args, { env, encoding: 'utf8' }).trim().split(/\r?\n/);
  console.log('urls', out.length, ((Date.now()-t0)/1000).toFixed(1)+'s');
  const get = async (url, a, b) => { const r = await fetch(url + '&range=' + a + '-' + b); if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); };
  // parse top-level boxes from the first 64KB
  async function index(url) {
    const head = await get(url, 0, 65535);
    let p = 0, boxes = {};
    while (p + 8 <= head.length) { const size = head.readUInt32BE(p); const type = head.toString('latin1', p+4, p+8); boxes[type] = { off: p, size }; if (type === 'sidx') break; if (size < 8) break; p += size; }
    const s = boxes.sidx; if (!s) throw new Error('no sidx: ' + Object.keys(boxes).join(','));
    const b = head.subarray(s.off, s.off + s.size);
    const ver = b[8]; const timescale = b.readUInt32BE(16);
    let q = 20; let ept, first; if (ver === 0) { ept = b.readUInt32BE(q); first = b.readUInt32BE(q+4); q += 8; } else { ept = Number(b.readBigUInt64BE(q)); first = Number(b.readBigUInt64BE(q+8)); q += 16; }
    q += 2; const count = b.readUInt16BE(q); q += 2;
    let off = s.off + s.size + first, t = ept; const refs = [];
    for (let i = 0; i < count; i++) { const size = b.readUInt32BE(q) & 0x7fffffff; const dur = b.readUInt32BE(q+4); refs.push({ start: t/timescale, end: (t+dur)/timescale, a: off, b: off+size-1 }); off += size; t += dur; q += 12; }
    return { initEnd: s.off - 1, refs };
  }
  async function part(url, T0, T1, file) {
    const ix = await index(url);
    const sel = ix.refs.filter(r => r.end > T0 && r.start < T1);
    const init = await get(url, 0, ix.initEnd);
    const a = sel[0].a, b = sel[sel.length-1].b;
    const chunks = [init]; const CH = 9_000_000;
    for (let x = a; x <= b; x += CH) chunks.push(await get(url, x, Math.min(b, x + CH - 1)));
    fs.writeFileSync(file, Buffer.concat(chunks));
    return { segs: sel.length, from: sel[0].start, to: sel[sel.length-1].end, mb: ((b-a)/1e6).toFixed(1), segDur: (ix.refs[1].start - ix.refs[0].start).toFixed(2) };
  }
  const T0 = 1415, T1 = 1525; // 23:35 ~ 25:25 (110s)
  let t = Date.now();
  const v = await part(out[0], T0, T1, 'cache/parttest/v.mp4'); console.log('video', JSON.stringify(v), ((Date.now()-t)/1000).toFixed(1)+'s');
  t = Date.now();
  const au = await part(out[1], T0, T1, 'cache/parttest/a.m4a'); console.log('audio', JSON.stringify(au), ((Date.now()-t)/1000).toFixed(1)+'s');
  console.log('total', ((Date.now()-t0)/1000).toFixed(1)+'s');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
