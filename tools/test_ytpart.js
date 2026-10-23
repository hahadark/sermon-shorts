'use strict';
// node tools/test_ytpart.js  → resolveFormats + fetchPart(1415..1525) 시간/크기/ffprobe + A/V 싱크 검증
// 전제: cache/yt/9Tmjg3ESEyc/9Tmjg3ESEyc_full.mp4 (원본 시각 = 파일 시각)
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const ytpart = require('../src/main/ytpart');
const { ffmpeg, ffprobe, root } = require('../src/main/tools');

const URL_ = 'https://www.youtube.com/watch?v=9Tmjg3ESEyc';
const FULL = path.join(root, 'cache', 'yt', '9Tmjg3ESEyc', '9Tmjg3ESEyc_full.mp4');
const S = 1415, E = 1525;

function pcm(file, t, len, rate = 16000) {
  // -ss 를 -i 뒤에 두어 디코딩 후 정확한 위치에서 자른다
  const buf = execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-ss', String(t), '-t', String(len),
    '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { maxBuffer: 1 << 26, windowsHide: true });
  const out = new Float32Array(buf.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}
function frame(file, t) {
  return execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, t - 3)), '-i', file, '-ss', String(Math.min(3, t)),
    '-frames:v', '1', '-vf', 'scale=160:90,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 22, windowsHide: true });
}
// 교차상관: b 를 a 에 대해 lag 샘플 밀었을 때 정규화 상관 최대
function xcorrLag(a, b, maxLag) {
  let best = -Infinity, bestLag = 0;
  const n = Math.min(a.length, b.length);
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0, ea = 0, eb = 0;
    for (let i = Math.max(0, -lag); i < n && i + lag < n; i++) { const x = a[i], y = b[i + lag]; s += x * y; ea += x * x; eb += y * y; }
    const c = s / Math.sqrt(ea * eb + 1e-12);
    if (c > best) { best = c; bestLag = lag; }
  }
  return { lag: bestLag, corr: best };
}

(async () => {
  let t = Date.now();
  const info = await ytpart.resolveFormats(URL_);
  console.log(`resolveFormats ${((Date.now() - t) / 1000).toFixed(1)}s: "${info.title}" dur=${info.duration} video itag=${info.video.itag} ${info.video.width}x${info.video.height}@${info.video.fps} audio itag=${info.audio.itag} preview itag=${info.preview.itag} expires in ${((info.expiresAt - Date.now()) / 3600000).toFixed(1)}h`);
  t = Date.now();
  const info2 = await ytpart.resolveFormats(URL_);
  console.log(`resolveFormats (cached) ${Date.now() - t}ms same=${info2 === info}`);

  // 새로 받기 위해 이전 캐시 삭제
  const dir = path.join(root, 'cache', 'yt', info.id);
  for (const f of fs.readdirSync(dir)) if (/^part_1415_1525\./.test(f)) fs.unlinkSync(path.join(dir, f));
  t = Date.now();
  let lastPct = -1;
  const r = await ytpart.fetchPart(URL_, S, E, { pad: 8, noFallback: true }, (p) => { if (p.pct - lastPct >= 25 || p.pct === 100) { lastPct = p.pct; console.log(`  progress ${p.stage} ${p.pct.toFixed(0)}%`); } });
  const ms = Date.now() - t;
  const size = fs.statSync(r.path).size;
  console.log(`fetchPart ${(ms / 1000).toFixed(1)}s method=${r.method} size=${(size / 1e6).toFixed(1)}MB offset=${r.offset.toFixed(6)} videoStart=${r.videoStart} audioStart=${r.audioStart.toFixed(6)}`);
  const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,start_time:stream=codec_name,width,height,r_frame_rate,start_time,duration', '-of', 'json', r.path], { encoding: 'utf8' }));
  console.log('ffprobe', JSON.stringify(probe));
  const fileDur = Number(probe.format.duration);
  if (!(r.offset <= S - 0 && r.offset + fileDur >= E)) throw new Error('part does not cover requested range');

  t = Date.now();
  const r2 = await ytpart.fetchPart(URL_, S, E, { pad: 8 });
  console.log(`fetchPart (cached) ${Date.now() - t}ms cached=${!!r2.cached} offset=${r2.offset.toFixed(6)}`);

  if (!fs.existsSync(FULL)) { console.log('full file missing, skip sync'); return; }
  const rate = 16000, maxLag = Math.round(0.2 * rate);
  let ok = true;
  for (const ft of [5, 50, 100]) {
    const a = pcm(r.path, ft, 10), b = pcm(FULL, r.offset + ft, 10);
    const { lag, corr } = xcorrLag(a, b, maxLag);
    const lagMs = (lag / rate) * 1000;
    const fa = frame(r.path, ft + 0.5), fb = frame(FULL, r.offset + ft + 0.5);
    let d = 0; for (let i = 0; i < fa.length; i++) d += Math.abs(fa[i] - fb[i]);
    const mad = d / fa.length;
    // 비교용: 1프레임(1/60s) 어긋난 프레임과의 차이
    const fc = frame(FULL, r.offset + ft + 0.5 + 1 / 60);
    let d2 = 0; for (let i = 0; i < fa.length; i++) d2 += Math.abs(fa[i] - fc[i]);
    console.log(`sync t=${ft}s (orig ${(r.offset + ft).toFixed(2)}): audio lag=${lagMs.toFixed(3)}ms corr=${corr.toFixed(4)} | frame MAD=${mad.toFixed(3)} (vs +1 frame: ${(d2 / fa.length).toFixed(3)})`);
    if (Math.abs(lagMs) >= 10 || mad > 2) ok = false;
  }
  console.log(ok ? 'SYNC PASS' : 'SYNC FAIL');
  if (!ok) process.exitCode = 1;
})().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
