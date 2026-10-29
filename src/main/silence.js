'use strict';
// 말 사이 공백 찾기: ffmpeg 로 실제 소리를 들어 조용한 부분을 찾는다 (자막 시각은 어림값이라 소리로 확인)
const { spawn } = require('child_process');
const tools = require('./tools');
const guard = require('./fs-guard');

/** ffmpeg silencedetect 로그 → [{ start, end }] (offset 만큼 더함, 끝나지 않은 무음은 duration 까지) */
function parseSilences(text, offset = 0, duration = null) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    let m = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (m) { cur = { start: Math.max(0, parseFloat(m[1])) + offset }; continue; }
    m = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (m && cur) {
      cur.end = parseFloat(m[1]) + offset;
      if (cur.end > cur.start) out.push(cur);
      cur = null;
    }
  }
  if (cur && Number.isFinite(duration) && duration + offset > cur.start) out.push({ start: cur.start, end: duration + offset });
  return out;
}

/** volumedetect 로그 → 평균 음량(dB) */
function parseMeanVolume(text) {
  const m = String(text || '').match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  return m ? parseFloat(m[1]) : null;
}

/** 무음 기준: 평균 음량보다 14dB 낮게 (-50 ~ -28 dB). 모르면 -35 dB */
function noiseFloorFor(meanDb) {
  if (!Number.isFinite(meanDb)) return -35;
  return Math.max(-50, Math.min(-28, Math.round(meanDb - 14)));
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(tools.ffmpeg, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 4e6) err = err.slice(-2e6); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error('ffmpeg 오류 (' + code + '): ' + err.split(/\r?\n/).filter(Boolean).slice(-2).join(' / ')))));
  });
}

/**
 * file 의 [start, end] 범위에서 무음 찾기.
 * opts: { start, end, minDur(초, 기본 0.15), noiseDb(없으면 평균 음량으로 정함) }
 * @returns { noiseDb, meanDb, silences: [{ start, end }] } (파일 시각)
 */
async function detectSilences(file, opts = {}) {
  const f = guard.check(String(file || ''));
  const start = Number.isFinite(opts.start) && opts.start > 0 ? opts.start : 0;
  const end = Number.isFinite(opts.end) && opts.end > start ? opts.end : null;
  const minDur = Number.isFinite(opts.minDur) && opts.minDur > 0 ? opts.minDur : 0.15;
  const range = ['-ss', start.toFixed(3)].concat(end ? ['-to', end.toFixed(3)] : []);
  const base = ['-hide_banner', '-nostats'].concat(range, ['-i', f, '-map', '0:a:0', '-vn', '-sn']);
  let meanDb = null, noise = opts.noiseDb;
  if (!Number.isFinite(noise)) {
    meanDb = parseMeanVolume(await runFfmpeg(base.concat(['-af', 'volumedetect', '-f', 'null', '-'])));
    noise = noiseFloorFor(meanDb);
  }
  const log = await runFfmpeg(base.concat(['-af', `silencedetect=noise=${noise}dB:d=${minDur}`, '-f', 'null', '-']));
  return { noiseDb: noise, meanDb, silences: parseSilences(log, start, end ? end - start : null) };
}

module.exports = { parseSilences, parseMeanVolume, noiseFloorFor, detectSilences };
