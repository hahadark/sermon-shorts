#!/usr/bin/env node
'use strict';
// 배경음악 목록(src/shared/bgm-catalog.js) 곡마다 파형 모양과 정확한 길이를 미리 계산해
// src/shared/bgm-peaks.js 로 쓴다. 앱은 이 자료로 음악을 받기 전에도 파형을 바로 그린다.
// 들어가는 것은 소리가 아니라 곡마다 1000칸짜리 크기 값(0~255)뿐이다. 음악 파일은 앱에 넣지 않는다.
//
//   node scripts/make_bgm_peaks.js            (곡을 cache/bgm_src 에 받아 두고 다시 쓸 때는 그것을 쓴다)
//   FFMPEG=C:\path\ffmpeg.exe node scripts/make_bgm_peaks.js
// 곡을 목록에 넣거나 주소를 바꾸면 다시 돌린다.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const catalog = require('../src/shared/bgm-catalog');
const { download } = require('../src/main/fetch-parts');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'cache', 'bgm_src');
const OUT = path.join(ROOT, 'src', 'shared', 'bgm-peaks.js');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const BINS = 1000;
const RATE = 4000;
const UA = 'SermonShorts/1.0 (+https://github.com/hahadark/sermon-shorts; sermon shorts editor)';

fs.mkdirSync(SRC, { recursive: true });

function extOf(t) {
  const m = /\.(mp3|ogg|oga|opus|m4a|wav|flac)(?:$|[?#])/i.exec(t.url);
  return m ? m[1].toLowerCase() : 'mp3';
}

async function fileFor(t) {
  const f = path.join(SRC, t.id + '.' + extOf(t));
  try { if (fs.statSync(f).size > 2048) return f; } catch (_) { /* 받기 */ }
  const buf = await download(t.url, { headers: { 'User-Agent': UA }, parts: 6, maxBytes: 80 * 1024 * 1024 });
  fs.writeFileSync(f + '.part', buf); fs.renameSync(f + '.part', f);
  return f;
}

function pcmOf(file) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const p = spawn(FFMPEG, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { windowsHide: true });
    p.stdout.on('data', (d) => chunks.push(d));
    let err = ''; p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err.slice(0, 300)))));
  });
}

async function one(t) {
  const t0 = Date.now();
  const file = await fileFor(t);
  const pcm = await pcmOf(file);
  const samples = Math.floor(pcm.length / 2);
  const duration = Math.round((samples / RATE) * 100) / 100;
  const out = new Uint8Array(BINS);
  const raw = new Array(BINS).fill(0);
  let max = 1;
  for (let i = 0; i < BINS; i++) {
    const a = Math.floor((i * samples) / BINS), b = Math.max(a + 1, Math.floor(((i + 1) * samples) / BINS));
    let m = 0;
    for (let k = a; k < b && k < samples; k++) { const v = Math.abs(pcm.readInt16LE(k * 2)); if (v > m) m = v; }
    raw[i] = m; if (m > max) max = m;
  }
  for (let i = 0; i < BINS; i++) out[i] = Math.round((raw[i] / max) * 255);
  return { id: t.id, d: duration, p: Buffer.from(out).toString('base64'), catalogSec: t.durationSec, ms: Date.now() - t0 };
}

(async () => {
  const tracks = catalog.tracks;
  const res = {};
  let i = 0, fail = 0;
  await Promise.all([0, 1, 2].map(async () => {
    while (i < tracks.length) {
      const t = tracks[i++];
      try {
        const r = await one(t);
        res[t.id] = r;
        const diff = Math.abs((r.catalogSec || 0) - r.d);
        console.log(`${t.id}  ${r.d}s  (목록 ${r.catalogSec}s${diff > 1.5 ? '  ← 차이 ' + diff.toFixed(1) + 's' : ''})  ${r.ms}ms`);
      } catch (e) { fail++; console.error('실패', t.id, e.message); }
    }
  }));
  const lines = tracks.filter((t) => res[t.id]).map((t) => `    ${JSON.stringify(t.id)}: { d: ${res[t.id].d}, p: ${JSON.stringify(res[t.id].p)} },`);
  const src = `/*
 * bgm-peaks.js - 자동 생성 (node scripts/make_bgm_peaks.js). 손으로 고치지 마세요.
 * 배경음악 목록 곡의 파형 모양(소리가 아닌 크기 값, 곡마다 ${BINS}칸 0~255)과 실제 길이(d, 초).
 * 음악을 받기 전에도 파형을 바로 그리려고 넣어 둔다. 음악 파일 자체는 앱에 들어 있지 않다.
 * UMD: 렌더러 SS.bgmPeaks, Node require().
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) { root.SS = root.SS || {}; root.SS.bgmPeaks = api; }
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {
  'use strict';
  var BINS = ${BINS};
  var DATA = {
${lines.join('\n')}
  };
  function bytes(b64) {
    if (typeof atob === 'function') { var s = atob(b64), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  var memo = {};
  /** 곡 id 의 파형을 n 칸(0~1)으로. 자료가 없으면 null */
  function get(id, n) {
    var e = DATA[id]; if (!e) return null;
    n = Math.max(10, Math.min(4000, Math.round(n || 600)));
    var key = id + ':' + n; if (memo[key]) return memo[key];
    var a = bytes(e.p), out = new Array(n), max = 0, i;
    for (i = 0; i < n; i++) {
      var s = Math.floor((i * BINS) / n), t = Math.max(s + 1, Math.floor(((i + 1) * BINS) / n)), m = 0;
      for (var k = s; k < t && k < BINS; k++) if (a[k] > m) m = a[k];
      out[i] = m; if (m > max) max = m;
    }
    for (i = 0; i < n; i++) out[i] = max ? Math.round((out[i] / max) * 1000) / 1000 : 0;
    return (memo[key] = { duration: e.d, peaks: out, bundled: true });
  }
  return { BINS: BINS, get: get, has: function (id) { return !!DATA[id]; }, ids: function () { return Object.keys(DATA); } };
}));
`;
  fs.writeFileSync(OUT, src);
  console.log(`\n${Object.keys(res).length}/${tracks.length}곡 → ${path.relative(ROOT, OUT)} (${(src.length / 1024).toFixed(1)} KB)${fail ? '  실패 ' + fail : ''}`);
  if (fail) process.exitCode = 1;
})();
