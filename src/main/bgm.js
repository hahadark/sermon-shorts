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

const MAX_BYTES = 60 * 1024 * 1024;
const UA = 'SermonShorts/1.0 (+https://github.com/hahadark/sermon-shorts; sermon shorts editor)';

function dir() { return tools.ensureDir(path.join(tools.cache, 'bgm')); }
function trackOf(id) {
  const t = catalog.tracks.find((x) => x.id === id);
  if (!t) throw new Error('목록에 없는 음악입니다. 다시 골라 주세요.');
  return t;
}
function extOf(t) {
  const m = /\.(mp3|ogg|oga|opus|m4a|wav|flac)(?:$|[?#])/i.exec(t.url);
  return m ? m[1].toLowerCase() : 'mp3';
}
function fileOf(t) { return path.join(dir(), t.id + '.' + extOf(t)); }

const pending = new Map();
/** 곡 파일을 캐시에 받아 두고 경로를 돌려준다 (이미 있으면 바로) */
function ensure(id) {
  const t = trackOf(id);
  const file = fileOf(t);
  try { if (fs.statSync(file).size > 2048) return Promise.resolve(file); } catch (_) { /* 없음 */ }
  if (pending.has(id)) return pending.get(id);
  const job = (async () => {
    let res;
    try { res = await fetch(t.url, { redirect: 'follow', headers: { 'User-Agent': UA } }); }
    catch (e) { throw new Error('음악을 받지 못했습니다. 인터넷 연결을 확인해 주세요. (' + e.message + ')'); }
    if (!res.ok) throw new Error('음악을 받지 못했습니다 (HTTP ' + res.status + '). 잠시 뒤 다시 해 주세요.');
    const len = Number(res.headers.get('content-length')) || 0;
    if (len > MAX_BYTES) throw new Error('음악 파일이 너무 큽니다.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2048 || buf.length > MAX_BYTES) throw new Error('음악 파일이 올바르지 않습니다.');
    const tmp = file + '.part';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
    return file;
  })().finally(() => pending.delete(id));
  pending.set(id, job);
  return job;
}

/** 파형용 봉우리 값 (0~1, n개)과 길이. 한 번 계산하면 캐시에 json 으로 */
async function peaks(id, n) {
  n = Math.max(50, Math.min(2000, Math.round(n || 600)));
  const t = trackOf(id);
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
  ipcMain.handle('bgm:fetch', async (_e, id) => { await ensure(String(id)); return true; });
  ipcMain.handle('bgm:peaks', (_e, id, n) => peaks(String(id), n));
}

module.exports = { initBgm, ensure, peaks, trackOf };
