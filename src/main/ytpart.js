'use strict';
// 유튜브 "구간만" 가져오기.
// 1) yt-dlp 로 직접 재생 주소(googlevideo)를 얻는다: 1080p 이하 DASH 영상(avc1 mp4 우선), m4a 오디오, 360p 미리보기(itag 18).
// 2) DASH 파일 앞부분의 sidx 상자를 읽어 시각 → 바이트 범위를 계산한다.
// 3) init + 필요한 조각만 &range=a-b (9MB 이하 조각) 로 받는다. (HTTP Range 헤더는 느려지거나 멈춤)
// 4) ffmpeg 스트림 복사로 하나의 mp4 로 합친다. 파일 시각 0 == 원본 시각 offset (정확히).
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const yt = require('./youtube');
const tools = require('./tools');
const { ffmpeg, ensureDir, root } = tools;
const ytdlpManager = require('./ytdlp-manager');

const CACHE_ROOT = path.join(root, 'cache', 'yt');
const CHUNK = 9_000_000;
const infoCache = new Map(); // id -> data

function videoIdOf(url) {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url);
    if (/youtu\.be$/i.test(u.hostname)) return u.pathname.split('/').filter(Boolean)[0] || null;
    const v = u.searchParams.get('v');
    if (v) return v;
    const p = u.pathname.split('/').filter(Boolean);
    if (['shorts', 'live', 'embed', 'v'].includes(p[0])) return p[1] || null;
  } catch (_) { /* ignore */ }
  return null;
}

function runYtdlp(args) {
  return ytdlpManager.withUpdateRetry(() => new Promise((resolve, reject) => {
    const rt = yt.getJsRuntime();
    const rtArgs = rt.path ? ['--js-runtimes', `${rt.kind}:${rt.path}`] : [];
    const proc = spawn(tools.ytdlp, [...rtArgs, ...args], { windowsHide: true, env: rt.env });
    let out = '', err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve(out);
      const e = new Error(`yt-dlp ${code}: ${err.slice(-500)}`);
      e.stderr = err;
      reject(e);
    });
  }));
}

function expireOf(u) {
  const m = /[?&/]expire[=/](\d+)/.exec(u || '');
  return m ? Number(m[1]) * 1000 : Date.now() + 3600 * 1000;
}

/** 형식 고르기 (순수 함수, 테스트용). formats = yt-dlp -J 의 formats. */
function pickFormats(formats) {
  const direct = (f) => f && f.url && /^https?$/.test(f.protocol || 'https') && !/manifest/.test(f.url);
  const vids = formats.filter((f) => direct(f) && f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none') && (f.height || 0) <= 1080 && f.ext === 'mp4');
  vids.sort((a, b) => ((b.height || 0) - (a.height || 0))
    || ((/^avc1/.test(b.vcodec) ? 1 : 0) - (/^avc1/.test(a.vcodec) ? 1 : 0))
    || ((b.fps || 0) - (a.fps || 0)) || ((b.tbr || 0) - (a.tbr || 0)));
  const auds = formats.filter((f) => direct(f) && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && (f.ext === 'm4a' || f.format_id === '140'));
  auds.sort((a, b) => ((b.format_id === '140') - (a.format_id === '140')) || ((b.abr || 0) - (a.abr || 0)));
  const prev = formats.find((f) => direct(f) && f.format_id === '18')
    || formats.find((f) => direct(f) && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && f.ext === 'mp4');
  return { video: vids[0] || null, audio: auds[0] || null, preview: prev || null };
}

/**
 * @returns {Promise<{id,title,duration,description,video:{url,itag,fps,width,height},audio:{url,itag},preview:{url},expiresAt}>}
 */
async function resolveFormats(url, opts = {}) {
  const id = videoIdOf(url);
  const cached = id && infoCache.get(id);
  if (cached && !opts.force && cached.expiresAt - Date.now() > 10 * 60 * 1000) return cached;

  const info = JSON.parse(await runYtdlp(['-J', '--no-playlist', '--', url]));
  let { video, audio, preview } = pickFormats(info.formats || []);
  // -J 결과가 HLS 주소만 줄 때가 있다 (클라이언트에 따라). 그럴 때는 -g 로 직접 주소를 받는다.
  if (!video || !audio) {
    const fmt = `bv*[height<=1080][vcodec^=avc1][ext=mp4][protocol=https]/bv*[height<=1080][ext=mp4][protocol=https],ba[ext=m4a][protocol=https],18/b[ext=mp4][protocol=https]`;
    const lines = (await runYtdlp(['-g', '-f', fmt, '--no-playlist', '--', url])).trim().split(/\r?\n/);
    const itagOf = (u) => (/[?&]itag=(\d+)/.exec(u) || [])[1];
    const byItag = (u) => (info.formats || []).find((f) => f.format_id === itagOf(u)) || {};
    if (lines[0]) video = { ...byItag(lines[0]), url: lines[0], format_id: itagOf(lines[0]) };
    if (lines[1]) audio = { ...byItag(lines[1]), url: lines[1], format_id: itagOf(lines[1]) };
    if (lines[2]) preview = { url: lines[2], format_id: itagOf(lines[2]) };
  }
  if (!video || !audio) throw new Error('DASH 영상/오디오 주소를 찾지 못했습니다');
  const data = {
    id: info.id,
    title: info.title,
    duration: info.duration,
    description: info.description,
    uploadDate: info.upload_date,
    video: { url: video.url, itag: String(video.format_id), fps: video.fps, width: video.width, height: video.height, vcodec: video.vcodec },
    audio: { url: audio.url, itag: String(audio.format_id) },
    preview: { url: preview ? preview.url : null, itag: preview ? String(preview.format_id) : null },
    previewUrl: preview ? preview.url : null,
    expiresAt: Math.min(expireOf(video.url), expireOf(audio.url)),
  };
  infoCache.set(info.id, data);
  return data;
}

class HttpError extends Error { constructor(status) { super('HTTP ' + status); this.status = status; } }

// 조각 하나를 받는다. 일시적인 네트워크 오류·5xx·429는 잠깐 쉬고 3번까지 다시 시도한다.
// 403/410(주소 만료)은 바로 올려보내서 위에서 주소를 새로 받게 한다.
async function getRange(url, a, b) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url + '&range=' + a + '-' + b);
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      lastErr = new HttpError(r.status);
      if (r.status === 403 || r.status === 410 || (r.status >= 400 && r.status < 500 && r.status !== 429)) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && (e.status === 403 || e.status === 410)) throw e;
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  throw lastErr;
}

/**
 * 순수 함수: 파일 앞부분 버퍼에서 sidx 를 찾아 조각 목록을 만든다.
 * @returns {{ initEnd:number, timescale:number, refs:[{start,end,a,b}] }} 또는 null (sidx 없음)
 */
function parseSidx(head) {
  let p = 0, s = null;
  while (p + 8 <= head.length) {
    let size = head.readUInt32BE(p);
    const type = head.toString('latin1', p + 4, p + 8);
    let hdr = 8;
    if (size === 1 && p + 16 <= head.length) { size = Number(head.readBigUInt64BE(p + 8)); hdr = 16; }
    if (type === 'sidx') { s = { off: p, size, hdr }; break; }
    if (size < 8) break;
    p += size;
  }
  if (!s || s.off + s.size > head.length) return null;
  const b = head.subarray(s.off, s.off + s.size);
  let q = s.hdr;
  const ver = b[q]; q += 4;            // version + flags
  q += 4;                              // reference_ID
  const timescale = b.readUInt32BE(q); q += 4;
  let ept, first;
  if (ver === 0) { ept = b.readUInt32BE(q); first = b.readUInt32BE(q + 4); q += 8; }
  else { ept = Number(b.readBigUInt64BE(q)); first = Number(b.readBigUInt64BE(q + 8)); q += 16; }
  q += 2;                              // reserved
  const count = b.readUInt16BE(q); q += 2;
  let off = s.off + s.size + first, t = ept;
  const refs = [];
  for (let i = 0; i < count; i++) {
    const size = b.readUInt32BE(q) & 0x7fffffff;
    const dur = b.readUInt32BE(q + 4);
    refs.push({ start: t / timescale, end: (t + dur) / timescale, a: off, b: off + size - 1 });
    off += size; t += dur; q += 12;
  }
  return { initEnd: s.off - 1, timescale, refs };
}

/** 조각 고르기 (순수): [T0, T1] 을 덮는 연속 조각 */
function selectRefs(refs, T0, T1) {
  return refs.filter((r) => r.end > T0 && r.start < T1);
}

async function indexTrack(url) {
  const head = await getRange(url, 0, 262143);
  const ix = parseSidx(head);
  if (!ix) throw new Error('sidx 없음');
  return { head, ix };
}

async function downloadTrack(url, track, T0, T1, file, onBytes) {
  const { head, ix } = track;
  const sel = selectRefs(ix.refs, T0, T1);
  if (!sel.length) throw new Error('구간에 해당하는 조각이 없습니다');
  const a = sel[0].a, b = sel[sel.length - 1].b;
  const parts = [head.subarray(0, ix.initEnd + 1)];
  for (let x = a; x <= b; x += CHUNK) {
    const y = Math.min(b, x + CHUNK - 1);
    parts.push(await getRange(url, x, y));
    if (onBytes) onBytes(y - x + 1);
  }
  fs.writeFileSync(file, Buffer.concat(parts));
  return { start: sel[0].start, end: sel[sel.length - 1].end, bytes: b - a + 1, segs: sel.length };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg ' + code + ': ' + err.slice(-400))));
  });
}

/**
 * [start-pad, end+pad] 구간만 1080p 로 받아 mp4 하나로 만든다.
 * @returns {Promise<{path, offset, start, end, itag, method:'part'|'full', title, duration, ms}>}
 */
async function fetchPart(url, start, end, opts = {}, onProgress) {
  const pad = opts.pad != null ? opts.pad : 8;
  const t0 = Date.now();
  const report = (pct, stage = 'part') => { if (onProgress) onProgress({ task: 'youtube', stage, pct: Math.max(0, Math.min(100, pct)) }); };
  let info;
  try {
    info = await resolveFormats(url);
    const dir = path.join(CACHE_ROOT, info.id);
    ensureDir(dir);
    const s = Math.floor(start), e = Math.ceil(end);
    const base = path.join(dir, `part_${s}_${e}`);
    const out = base + '.mp4', side = base + '.json';
    if (fs.existsSync(out) && fs.existsSync(side)) {
      const j = JSON.parse(fs.readFileSync(side, 'utf8'));
      report(100);
      return { ...j, path: out, title: info.title, duration: info.duration, method: 'part', cached: true, ms: Date.now() - t0 };
    }
    const T0 = Math.max(0, start - pad), T1 = Math.min(info.duration || Infinity, end + pad);
    const vFile = base + '.v.mp4', aFile = base + '.a.m4a';

    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // 대략 전체 바이트 수를 모르므로 영상(약 95%) 기준으로 진행률 계산: 받은 바이트 / 추정 바이트
        const estBytes = Math.max(1, (T1 - T0) * 450_000);
        let got = 0;
        const onBytes = (n) => { got += n; report(Math.min(95, (got / estBytes) * 95)); };
        const [vt, at] = await Promise.all([indexTrack(info.video.url), indexTrack(info.audio.url)]);
        // 영상 조각은 키프레임에서 시작하므로 영상 첫 조각 시작 = offset 으로 쓰고,
        // 오디오는 그보다 앞에서 시작하는 조각부터 받아 앞부분만 잘라낸다 (영상은 자르지 않음 → 스트림 복사 OK).
        const vSel = selectRefs(vt.ix.refs, T0, T1);
        const vStart = vSel.length ? vSel[0].start : T0;
        r = await Promise.all([
          downloadTrack(info.video.url, vt, T0, T1, vFile, onBytes),
          downloadTrack(info.audio.url, at, Math.min(T0, vStart), T1, aFile, onBytes),
        ]);
        break;
      } catch (err) {
        if (attempt === 0 && err instanceof HttpError && (err.status === 403 || err.status === 410)) {
          info = await resolveFormats(url, { force: true }); // 주소 만료 → 다시 받기
          continue;
        }
        if (attempt === 1 && err instanceof HttpError && err.status === 403) {
          // 새 주소도 거부되면 yt-dlp 가 오래된 것 → 최신으로 바꾼 뒤 주소를 다시 받는다
          const u = await ytdlpManager.ensure({ force: true }).catch(() => null);
          if (u && u.updated) {
            report(0, 'update');
            info = await resolveFormats(url, { force: true });
            continue;
          }
        }
        throw err;
      }
    }
    const [v, a] = r;
    const offset = Math.max(v.start, a.start); // 보통 v.start (오디오를 더 앞에서부터 받으므로)
    // 각 입력의 시작 시각(=첫 조각 tfdt)은 v.start / a.start. 입력 -ss 는 그 시작 기준 상대 위치.
    // 영상 vSeek=0 (키프레임 그대로), 오디오는 offset-a.start 만큼 잘라 출력 0초 = 원본 offset.
    report(96);
    await runFfmpeg(['-y',
      '-ss', (offset - v.start).toFixed(6), '-i', vFile,
      '-ss', (offset - a.start).toFixed(6), '-i', aFile,
      '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', out + '.tmp.mp4']);
    fs.renameSync(out + '.tmp.mp4', out);
    try { fs.unlinkSync(vFile); fs.unlinkSync(aFile); } catch (_) {}
    const meta = { offset, start, end, pad, itag: info.video.itag, videoStart: v.start, audioStart: a.start,
      videoBytes: v.bytes, audioBytes: a.bytes, createdAt: new Date().toISOString() };
    fs.writeFileSync(side, JSON.stringify(meta, null, 2));
    report(100);
    return { ...meta, path: out, title: info.title, duration: info.duration, method: 'part', ms: Date.now() - t0 };
  } catch (err) {
    if (opts.noFallback) throw err;
    console.warn('[ytpart] 구간 받기 실패, 전체 다운로드로 대체:', err && err.stack ? err.stack : err);
    const full = await yt.downloadSection(url, start, end, {}, (pct) => report(pct, 'download'));
    return { ...full, method: 'full', fallbackReason: err.message, ms: Date.now() - t0 };
  }
}

module.exports = { resolveFormats, fetchPart, parseSidx, selectRefs, pickFormats, videoIdOf };
