'use strict';
// 흩어진 여러 구간을 각각 필요한 만큼만 받아 하나의 영상으로 이어 붙인다.
// 반환하는 map 으로 "원본 시각 → 이어 붙인 파일 시각"을 바꾼다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const tools = require('../tools');
const ytpart = require('../ytpart');
const media = require('../media');

/** 가까운 구간끼리 묶기 (사이가 gap 초보다 짧으면 하나로) — 순수 함수 */
function clusterRanges(spans, gap = 45, pad = 2) {
  const s = spans.map((x) => ({ start: Math.max(0, x.start - pad), end: x.end + pad })).sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r.start - last.end < gap) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** map: [{ src0, src1, file0 }] 에서 원본 시각 t → 파일 시각 (해당 조각이 없으면 null) — 순수 함수 */
function srcToFile(map, t) {
  for (const m of map) if (t >= m.src0 - 0.001 && t <= m.src1 + 0.001) return m.file0 + (t - m.src0);
  return null;
}

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(tools.ffmpeg, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 8000) err = err.slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg ' + code + ': ' + err.slice(-400)))));
  });
}

/**
 * @param url 유튜브 주소, spans [{start,end}] (원본 시각)
 * @returns {path, map:[{src0,src1,file0}], duration, title}
 */
async function fetchClips(url, spans, onProgress) {
  const clusters = clusterRanges(spans);
  const parts = [];
  let title = '';
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const r = await ytpart.fetchPart(url, c.start, c.end, { pad: 1 }, (info) => {
      if (onProgress) onProgress({ ...info, pct: Math.round(((i + (info.pct || 0) / 100) / clusters.length) * 100) });
    });
    title = title || r.title;
    const pr = await media.probe(r.path);
    parts.push({ path: r.path, src0: r.offset || 0, dur: pr.duration });
  }
  if (parts.length === 1) {
    const p = parts[0];
    return { path: p.path, map: [{ src0: p.src0, src1: p.src0 + p.dur, file0: 0 }], duration: p.dur, title, single: true };
  }
  const key = crypto.createHash('sha1').update(parts.map((p) => p.path + ':' + p.src0).join('|')).digest('hex').slice(0, 16);
  const dir = tools.ensureDir(path.join(tools.cache, 'chat'));
  const out = path.join(dir, `clips_${key}.mp4`);
  if (!fs.existsSync(out)) {
    const list = path.join(dir, `clips_${key}.txt`);
    fs.writeFileSync(list, 'ffconcat version 1.0\n' + parts.map((p) => `file '${p.path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n', 'utf8');
    await run(['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', out + '.tmp.mp4']);
    fs.renameSync(out + '.tmp.mp4', out);
    try { fs.unlinkSync(list); } catch (_) {}
  }
  // 이어 붙인 뒤 실제 조각 경계는 각 조각 길이의 합
  const map = [];
  let f0 = 0;
  for (const p of parts) { map.push({ src0: p.src0, src1: p.src0 + p.dur, file0: f0 }); f0 += p.dur; }
  const pr = await media.probe(out);
  return { path: out, map, duration: pr.duration, title, single: false };
}

module.exports = { fetchClips, clusterRanges, srcToFile };
