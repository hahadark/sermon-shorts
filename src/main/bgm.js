'use strict';
// 배경음악: 목록(src/shared/bgm-catalog.js)에 있는 곡만 다룬다. 설치 파일에는 음악을 넣지 않는다.
//  - 듣기: 렌더러가 원래 사이트 주소에서 바로 스트리밍 (이 파일과 상관없음)
//  - 파형 그리기·영상 내보내기: 그때만 사용자 캐시(…/cache/bgm)에 한 번 받아 둔다
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ipcMain } = require('electron');
const tools = require('./tools');
const catalog = require('../shared/bgm-catalog');
const bundled = require('../shared/bgm-peaks');
const { open } = require('./fetch-parts');

const MAX_BYTES = 60 * 1024 * 1024;
const UA = 'SermonShorts/1.0 (+https://github.com/hahadark/sermon-shorts; sermon shorts editor)';

function dir() { return tools.ensureDir(path.join(tools.cache, 'bgm')); }
// ---------------- 직접 넣은 음악 (내 파일·유튜브 링크) ----------------
// 사용자 캐시 bgm/custom 에 복사해 두고 index.json 에 적는다. id 는 'custom-' 으로 시작한다.
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'webm', 'mp4'];
function customDir() { return tools.ensureDir(path.join(dir(), 'custom')); }
function loadCustom() { try { return JSON.parse(fs.readFileSync(path.join(customDir(), 'index.json'), 'utf8')) || {}; } catch (_) { return {}; } }
function saveCustom(m) { fs.writeFileSync(path.join(customDir(), 'index.json'), JSON.stringify(m, null, 2)); }
function customTrack(id) {
  const e = loadCustom()[id];
  if (!e) return null;
  const { pathToFileURL } = require('url');
  return { id, custom: true, kind: e.kind, title: e.title, artist: e.artist || (e.kind === 'youtube' ? '유튜브' : '내 파일'), mood: '내 음악', tags: [],
    durationSec: e.durationSec, file: e.file, source: e.source, url: pathToFileURL(e.file).href,
    license: e.kind === 'youtube' ? '유튜브에서 가져옴' : '내 파일', attribution: null, licenseQuote: '직접 넣은 음악입니다. 저작권은 직접 확인해 주세요.', contentIdRisk: 'unknown', addedAt: e.addedAt || 0 };
}
function listCustom() { return Object.keys(loadCustom()).map(customTrack).filter(Boolean).sort((a, b) => b.addedAt - a.addedAt); }
function probeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { windowsHide: true });
    let out = ''; p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(0)); p.on('close', () => resolve(parseFloat(out) || 0));
  });
}
async function addCustom(id, entry) {
  const dur = await probeDuration(entry.file);
  if (!(dur > 1)) { try { if (entry.file.startsWith(customDir())) fs.unlinkSync(entry.file); } catch (_) { /* */ } throw new Error('소리를 읽을 수 없는 파일입니다. mp3·m4a·wav 같은 음악 파일을 골라 주세요.'); }
  const m = loadCustom();
  m[id] = { ...entry, durationSec: Math.round(dur * 100) / 100, addedAt: Date.now() };
  saveCustom(m);
  return customTrack(id);
}
async function importFile(src) {
  src = String(src || '');
  const ext = (path.extname(src).slice(1) || '').toLowerCase();
  if (!AUDIO_EXT.includes(ext)) throw new Error('음악 파일(mp3·m4a·wav·ogg·flac 등)을 골라 주세요.');
  const st = fs.statSync(src);
  if (st.size > 200 * 1024 * 1024) throw new Error('음악 파일이 너무 큽니다(200MB 넘음).');
  const hash = require('crypto').createHash('sha1').update(src + '|' + st.size + '|' + st.mtimeMs).digest('hex').slice(0, 12);
  const file = path.join(customDir(), 'f-' + hash + '.' + ext);
  if (!fs.existsSync(file)) fs.copyFileSync(src, file);
  return addCustom('custom-f-' + hash, { kind: 'file', title: path.basename(src, path.extname(src)), artist: '내 파일', file, source: src });
}
async function importYoutube(url, onProgress) {
  url = String(url || '').trim();
  if (!/^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be)\//i.test(url)) throw new Error('유튜브 주소를 넣어 주세요 (https://youtu.be/... 또는 https://www.youtube.com/...).');
  const r = await require('./youtube').downloadAudio(url, customDir(), onProgress);
  return addCustom('custom-yt-' + r.id, { kind: 'youtube', title: r.title, artist: r.uploader || '유튜브', file: r.file, source: url });
}
function removeCustom(id) {
  const m = loadCustom(); const e = m[id]; if (!e) return false;
  delete m[id]; saveCustom(m);
  try { if (e.file && e.file.startsWith(customDir())) fs.unlinkSync(e.file); } catch (_) { /* */ }
  return true;
}

function trackOf(id) {
  const t = catalog.tracks.find((x) => x.id === id) || (String(id).startsWith('custom-') ? customTrack(id) : null);
  if (!t) throw new Error(String(id).startsWith('custom-') ? '직접 넣은 음악을 찾을 수 없습니다. 음악을 다시 넣어 주세요.' : '목록에 없는 음악입니다. 다시 골라 주세요.');
  return t;
}
function extOf(t) {
  const m = /\.(mp3|ogg|oga|opus|m4a|wav|flac|aac|webm|mp4)(?:$|[?#])/i.exec(t.custom ? t.file : t.url);
  return m ? m[1].toLowerCase() : 'mp3';
}
function fileOf(t) { return t.custom ? t.file : path.join(dir(), t.id + '.' + extOf(t)); }

// ---------------- 받기 (곡마다 한 번, 여러 곳이 같은 작업을 나눠 씀) ----------------
function cachedFile(id) {
  const file = fileOf(trackOf(id));
  try { if (fs.statSync(file).size > 2048) return file; } catch (_) { /* 없음 */ }
  return null;
}
function friendly(e) {
  if (e && e.status) return new Error('음악을 받지 못했습니다 (HTTP ' + e.status + '). 잠시 뒤 다시 해 주세요.');
  if (e && /너무 큽니다/.test(e.message)) return new Error('음악 파일이 너무 큽니다.');
  return new Error('음악을 받지 못했습니다. 인터넷 연결을 확인해 주세요. (' + (e && e.message || e) + ')');
}
const jobs = new Map(); // id → 받는 중인 작업
function startJob(id) {
  let j = jobs.get(id);
  if (j) return j;
  const t = trackOf(id), file = fileOf(t);
  j = { id, o: null, error: null, waiters: new Set(), watchers: new Set(), last: 0, pinned: false, ac: new AbortController() };
  j.wake = () => { const w = [...j.waiters]; j.waiters.clear(); w.forEach((f) => f()); };
  j.wait = () => new Promise((r) => j.waiters.add(r));
  j.tell = () => {
    if (!j.o || !j.o.len) return;
    const got = j.o.got(), total = j.o.len, now = Date.now();
    if (now - j.last < 150 && got < total) return; j.last = now;
    for (const f of j.watchers) { try { f(got, total); } catch (_) { /* 창이 닫힘 */ } }
  };
  j.opened = open(t.url, { headers: { 'User-Agent': UA }, parts: 6, maxBytes: MAX_BYTES, signal: j.ac.signal, onData: () => { j.wake(); j.tell(); } })
    .then((o) => { j.o = o; j.wake(); return o; });
  j.file = j.opened.then((o) => o.done).then((buf) => {
    if (buf.length < 2048 || buf.length > MAX_BYTES) throw new Error('음악 파일이 올바르지 않습니다.');
    const tmp = file + '.' + process.pid + '.part';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
    for (const f of j.watchers) { try { f(buf.length, buf.length); } catch (_) { /* */ } }
    return file;
  }).catch((e) => { j.error = /음악/.test(e.message) ? e : friendly(e); throw j.error; })
    .finally(() => { jobs.delete(id); j.wake(); });
  j.opened.catch(() => {}); j.file.catch(() => {});
  jobs.set(id, j);
  return j;
}
/** 곡 파일을 캐시에 받아 두고 경로를 돌려준다 (이미 있으면 바로). onProgress(got, total) 는 받는 동안 */
function ensure(id, onProgress) {
  const have = cachedFile(id);
  if (have) return Promise.resolve(have);
  if (trackOf(id).custom) return Promise.reject(new Error('직접 넣은 음악 파일이 없어졌습니다. 음악을 다시 넣어 주세요.'));
  const j = startJob(id);
  j.pinned = true; // 쓰기로 한 곡·내보내기: 끝까지 받는다
  if (onProgress) j.watchers.add(onProgress);
  return j.file;
}
/** 미리 듣기로만 받던 다른 곡은 멈춘다 (여러 곡을 연달아 들을 때 연결이 몰려 느려지지 않게) */
function dropPreviewJobs(keepId) {
  for (const [id, j] of jobs) if (id !== keepId && !j.pinned) { j.ac.abort(); }
}

// ---------------- 재생 통로 ssbgm://track/<id> ----------------
// 미리 듣기·미리보기 재생은 원래 사이트에 직접 가지 않고 이 통로로 듣는다.
// 받은 파일이 있으면 그 파일에서, 없으면 여러 갈래로 받는 중인 데이터에서 받은 만큼 바로 넘겨준다.
// (incompetech 는 한 연결이 느려서 브라우저가 직접 받으면 소리 나기까지 1~9초 걸렸다)
const SCHEME = 'ssbgm';
function registerScheme() {
  const { protocol } = require('electron');
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
}
function mimeOf(t) {
  const e = extOf(t);
  return { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm' }[e] || 'application/octet-stream';
}
/** Range 머리 → [시작, 끝] (포함). 없으면 null, 잘못되면 false */
function parseRange(h, len) {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(h).trim());
  if (!m || (!m[1] && !m[2])) return false;
  let a, b;
  if (!m[1]) { const n = Number(m[2]); a = Math.max(0, len - n); b = len - 1; }
  else { a = Number(m[1]); b = m[2] ? Math.min(Number(m[2]), len - 1) : len - 1; }
  if (a > b || a >= len) return false;
  return [a, b];
}
function headersFor(t, len, r) {
  const h = { 'Content-Type': mimeOf(t), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Length': String(r ? r[1] - r[0] + 1 : len) };
  if (r) h['Content-Range'] = `bytes ${r[0]}-${r[1]}/${len}`;
  return h;
}
const CHUNK = 256 * 1024;
/** 파일 맨 앞 ID3v2 태그 길이 (없으면 0). incompetech 곡은 앞에 앨범 그림(약 120KB)이 들어 있어서
 *  Chromium 이 그것을 영상 줄기로 보고 2MB 넘게 읽은 뒤에야 소리를 냈다 → 재생 통로에서는 건너뛰고 소리부터 준다 */
function id3Size(h) {
  if (!h || h.length < 10 || h[0] !== 0x49 || h[1] !== 0x44 || h[2] !== 0x33) return 0; // 'ID3'
  if ((h[6] | h[7] | h[8] | h[9]) & 0x80) return 0;
  const size = (h[6] << 21) | (h[7] << 14) | (h[8] << 7) | h[9];
  return 10 + size + ((h[5] & 0x10) ? 10 : 0);
}
function rangeReply(t, total, skip, rangeH, readAt) {
  const len = Math.max(0, total - skip);
  const r = parseRange(rangeH, len);
  if (r === false) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${len}` } });
  const [a, b] = r || [0, len - 1];
  let pos = a;
  const body = new ReadableStream({
    async pull(c) {
      if (pos > b) { c.close(); return; }
      const chunk = await readAt(pos + skip, Math.min(CHUNK, b - pos + 1));
      if (!chunk || !chunk.length) { c.close(); return; }
      pos += chunk.length; c.enqueue(chunk);
    },
  });
  return new Response(body, { status: r ? 206 : 200, headers: headersFor(t, len, r) });
}
async function serve(req) {
  let t;
  try {
    const u = new URL(req.url);
    t = trackOf(decodeURIComponent(u.pathname.replace(/^\/+/, '')));
  } catch (_) { return new Response('not found', { status: 404 }); }
  const rangeH = req.headers.get('range');
  const file = cachedFile(t.id);
  if (process.env.SS_BGM_TRACE) console.log('[bgm-trace]', Date.now(), t.id, rangeH || '-', file ? 'file' : (jobs.has(t.id) ? 'job' : 'new'));
  const strip = extOf(t) === 'mp3';
  if (file) {
    const total = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(10); fs.readSync(fd, head, 0, 10, 0);
    const skip = strip ? Math.min(id3Size(head), total) : 0;
    fs.closeSync(fd);
    return rangeReply(t, total, skip, rangeH, async (at, n) => {
      const buf = Buffer.allocUnsafe(n);
      const h = await fs.promises.open(file, 'r');
      try { const { bytesRead } = await h.read(buf, 0, n, at); return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead); } finally { await h.close(); }
    });
  }
  dropPreviewJobs(t.id);
  const j = startJob(t.id);
  let o;
  try { o = await j.opened; } catch (e) { return new Response(String(e.message || e), { status: 502 }); }
  if (!o.len) { try { await j.file; } catch (e) { return new Response(String(e.message || e), { status: 502 }); } return serve(req); }
  // 받는 중인 데이터에서: at 부터 받아 둔 만큼 (없으면 올 때까지 기다림)
  const readAt = async (at, n) => {
    for (;;) {
      const avail = o.availableFrom(at);
      if (avail > at) return new Uint8Array(o.buf.subarray(at, Math.min(avail, at + n))); // 복사해서 넘김
      if (j.error) throw j.error;
      if (at >= o.len) return null;
      await j.wait();
    }
  };
  let skip = 0;
  if (strip) { while (o.availableFrom(0) < 10 && !j.error) await j.wait(); skip = Math.min(id3Size(o.buf.subarray(0, 10)), o.len); }
  return rangeReply(t, o.len, skip, rangeH, readAt);
}

/** 파형용 봉우리 값 (0~1, n개)과 길이. 한 번 계산하면 캐시에 json 으로 */
async function peaks(id, n) {
  n = Math.max(50, Math.min(2000, Math.round(n || 600)));
  const t = trackOf(id);
  const pre = bundled.get(id, n); // 앱에 넣어 둔 파형: 음악을 받지 않아도 바로
  if (pre) return pre;
  const cacheFile = path.join(dir(), t.id + '.peaks' + n + '.json');
  try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) { /* 새로 */ }
  const file = await ensure(id);
  const RATE = 4000;
  const pcm = await new Promise((resolve, reject) => {
    const chunks = [];
    const p = spawn(tools.ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { windowsHide: true });
    p.stdout.on('data', (d) => chunks.push(d));
    let err = ''; p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('음악 파형을 읽지 못했습니다: ' + err.slice(0, 200))));
  });
  const samples = Math.floor(pcm.length / 2);
  const duration = samples / RATE;
  const per = Math.max(1, Math.floor(samples / n));
  const out = new Array(n).fill(0);
  let max = 1;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = i * per, b = Math.min(samples, a + per);
    for (let k = a; k < b; k++) { const v = Math.abs(pcm.readInt16LE(k * 2)); if (v > m) m = v; }
    out[i] = m; if (m > max) max = m;
  }
  const res = { duration, peaks: out.map((v) => Math.round((v / max) * 1000) / 1000) };
  try { fs.writeFileSync(cacheFile, JSON.stringify(res)); } catch (_) { /* 캐시 못 써도 됨 */ }
  return res;
}

function initBgm() {
  const { protocol } = require('electron');
  protocol.handle(SCHEME, (req) => serve(req).catch((e) => new Response(String(e && e.message || e), { status: 500 })));
  // 받기: 끝나면 캐시 파일 경로. 받는 동안 그 창에 'bgm:progress' {id, got, total}
  ipcMain.handle('bgm:fetch', async (e, id) => {
    id = String(id);
    const wc = e.sender;
    return ensure(id, (got, total) => { if (!wc.isDestroyed()) wc.send('bgm:progress', { id, got, total }); });
  });
  ipcMain.handle('bgm:cached', (_e, id) => { try { return cachedFile(String(id)); } catch (_) { return null; } });
  // 직접 넣은 음악
  ipcMain.handle('bgm:customList', () => listCustom());
  ipcMain.handle('bgm:track', (_e, id) => { try { return trackOf(String(id)); } catch (_) { return null; } });
  ipcMain.handle('bgm:customRemove', (_e, id) => removeCustom(String(id)));
  ipcMain.handle('bgm:importFile', async (e, p) => {
    let src = p;
    if (!src) {
      const { dialog, BrowserWindow } = require('electron');
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: '배경음악 파일 고르기', properties: ['openFile'], filters: [{ name: '음악 파일', extensions: AUDIO_EXT }, { name: '모든 파일', extensions: ['*'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      src = r.filePaths[0];
    }
    return importFile(src);
  });
  ipcMain.handle('bgm:importYoutube', (e, url) => {
    const wc = e.sender;
    return importYoutube(url, (pct) => { if (!wc.isDestroyed()) wc.send('bgm:progress', { id: 'import', got: pct, total: 100 }); });
  });
  ipcMain.handle('bgm:peaks', (_e, id, n) => peaks(String(id), n));
}

module.exports = { initBgm, registerScheme, ensure, peaks, trackOf, cachedFile, parseRange, id3Size, SCHEME, importFile, importYoutube, listCustom, removeCustom };
