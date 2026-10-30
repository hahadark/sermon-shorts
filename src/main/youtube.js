'use strict';

const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const tools = require('./tools');
const { cacheDir, ensureDir, root, IS_WIN, EXE } = tools;
const ytdlpManager = require('./ytdlp-manager');

/** yt-dlp 실패 → 알기 쉬운 한국어 오류 (원래 출력은 err.stderr 에 남긴다) */
function ytError(code, stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const last = (lines.filter((l) => /^ERROR/.test(l)).pop() || lines.filter((l) => !/^WARNING|^\s/.test(l)).pop() || '').replace(/^ERROR:\s*/, '');
  let msg = '유튜브에서 영상을 받지 못했습니다';
  if (/Private video|private/i.test(last)) msg = '비공개 영상이라 받을 수 없습니다. 유튜브에서 공개 또는 일부공개로 바꿔 주세요';
  else if (/Sign in to confirm/i.test(last)) msg = '유튜브가 로그인 확인을 요구합니다. 잠시 뒤 다시 해 주세요';
  else if (/403/.test(last)) msg = '유튜브가 다운로드를 거부했습니다(403). 다운로드 프로그램을 최신으로 바꿨는데도 안 되면 잠시 뒤 다시 해 주세요';
  else if (/not a valid URL|Unsupported URL|Incomplete YouTube ID/i.test(last)) msg = '유튜브 주소가 올바르지 않습니다';
  else if (/unavailable|not available/i.test(last)) msg = '이 영상을 볼 수 없습니다(삭제됐거나 지역 제한)';
  const e = new Error(msg + (last ? ` (자세히: ${last.slice(0, 160)})` : ` (코드 ${code})`));
  e.stderr = stderr; e.code = 'youtube';
  return e;
}

// ---- yt-dlp용 JS 런타임 찾기 (YouTube 서명 해독에 필요) ----
// 1) 지금 실행 중인 Electron/Node 바이너리 (Electron이면 ELECTRON_RUN_AS_NODE=1 로 node처럼 동작)
// 2) PATH의 node (Windows: where node, macOS: which node)
// 3) bin/deno(.exe)
// 처음 한 번 실제로 실행해 보고 되는 것을 캐시한다.
let jsRuntimeCache = null;

function tryRuntime(exe, env, args) {
  try {
    const out = execFileSync(exe, args, { env, encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim();
  } catch (e) {
    return null;
  }
}

function getJsRuntime() {
  if (jsRuntimeCache) return jsRuntimeCache;
  const candidates = [];
  const isElectron = !!process.versions.electron;
  candidates.push({
    kind: 'node',
    label: isElectron ? 'Electron 내장 Node' : 'Node (현재 실행 중)',
    path: process.execPath,
    env: isElectron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : { ...process.env },
  });
  try {
    const out = execFileSync(IS_WIN ? 'where' : 'which', ['node'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const p = out.split(/\r?\n/).map(s => s.trim()).find(s => s && fs.existsSync(s));
    if (p && p !== process.execPath) candidates.push({ kind: 'node', label: '시스템 Node', path: p, env: { ...process.env } });
  } catch (e) { /* node 없음 */ }
  const deno = path.join(root, 'bin', 'deno' + EXE);
  if (fs.existsSync(deno)) candidates.push({ kind: 'deno', label: 'Deno', path: deno, env: { ...process.env } });

  for (const c of candidates) {
    const args = c.kind === 'deno' ? ['--version'] : ['-e', 'process.stdout.write(process.version)'];
    const v = tryRuntime(c.path, c.env, args);
    if (v) {
      c.version = c.kind === 'deno' ? v.split(/\r?\n/)[0] : v;
      jsRuntimeCache = c;
      return c;
    }
  }
  jsRuntimeCache = { kind: null, label: '없음', path: null, env: { ...process.env } };
  return jsRuntimeCache;
}

/** yt-dlp 인자에 붙일 --js-runtimes */
function runtimeArgs() {
  const rt = getJsRuntime();
  return rt.path ? ['--js-runtimes', `${rt.kind}:${rt.path}`] : [];
}
function getSpawnOptions() {
  return { windowsHide: true, env: getJsRuntime().env };
}

async function fetchInfo(url) {
  return ytdlpManager.withUpdateRetry(() => fetchInfoOnce(url));
}

function fetchInfoOnce(url) {
  return new Promise((resolve, reject) => {
    // URL 앞의 '--': '-'로 시작하는 입력을 옵션으로 읽지 않게 한다
    const args = ['-J', '--no-playlist', ...runtimeArgs(), '--', url];

    const proc = spawn(tools.ytdlp, args, getSpawnOptions());
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });
    proc.on('error', reject);

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(ytError(code, stderr));
      }
      try {
        const info = JSON.parse(stdout);
        resolve({
          id: info.id,
          title: info.title,
          duration: info.duration,
          uploadDate: info.upload_date,
          description: info.description
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function fetchAutoSubs(url, opts = {}) {
  const info = await fetchInfo(url);
  const id = info.id;
  const targetDir = path.join(root, 'cache', 'yt', id);
  ensureDir(targetDir);

  return ytdlpManager.withUpdateRetry(() => new Promise((resolve, reject) => {
    const args = [
      '--skip-download',
      '--write-auto-subs',
      '--write-subs',
      '--sub-langs', 'ko.*,ko',
      '--sub-format', 'json3',
      '-o', path.join(targetDir, '%(id)s.%(ext)s'),
      ...runtimeArgs(),
      '--', url
    ];

    const proc = spawn(tools.ytdlp, args, getSpawnOptions());
    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data; });
    proc.on('error', reject);

    proc.on('close', async (code) => {
      // Find the json3 file
      const files = fs.readdirSync(targetDir);
      const subFile = files.find(f => f.endsWith('.json3'));
      
      if (!subFile) {
        // yt-dlp 자체가 실패한 것이면 오류로 (오래된 yt-dlp 면 업데이트 후 다시), 자막이 없는 것이면 null
        if (code !== 0) return reject(ytError(code, stderr));
        return resolve(null);
      }

      try {
        const content = JSON.parse(fs.readFileSync(path.join(targetDir, subFile), 'utf8'));
        const lines = [];
        let plainText = '';

        if (content.events) {
          for (const ev of content.events) {
            if (!ev.segs) continue;
            const start = ev.tStartMs / 1000;
            const duration = ev.dDurationMs / 1000;
            const text = ev.segs.map(s => s.utf8).join('').trim();
            if (!text) continue;

            lines.push({
              start,
              end: start + duration,
              text
            });
            plainText += text + ' ';
          }
        }

        resolve(opts.raw ? { lines, plainText: plainText.trim(), raw: content, info } : { lines, plainText: plainText.trim() });
      } catch (e) {
        reject(e);
      }
    });
  }));
}

// Download the whole video once (cached per video id) and cut locally.
// yt-dlp --download-sections (ffmpeg seeking into DASH) stalls on this channel's streams,
// while a full 1080p download takes about 1 minute and can be reused for several shorts.
async function downloadSection(url, start, end, options = {}, onProgress) {
  const info = await fetchInfo(url);
  const id = info.id;
  const targetDir = path.join(root, 'cache', 'yt', id);
  ensureDir(targetDir);
  const outputPath = path.join(targetDir, `${id}_full.mp4`);
  const result = { path: outputPath, offset: 0, start, end, title: info.title, duration: info.duration };
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    if (onProgress) onProgress(100);
    return result;
  }

  return ytdlpManager.withUpdateRetry(() => new Promise((resolve, reject) => {
    const args = [
      '--newline', '--no-playlist', '-N', '4',
      '-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', path.dirname(tools.ffmpeg),
      ...runtimeArgs(),
      '-o', path.join(targetDir, `${id}_full.%(ext)s`),
      '--', url
    ];
    const proc = spawn(tools.ytdlp, args, getSpawnOptions());
    let stderr = '';
    let part = 0; // 0 = video track, 1 = audio track
    proc.stdout.on('data', (data) => {
      for (const line of data.toString().split(/\r?\n/)) {
        if (/\[download\] Destination:/.test(line) && /\.f\d+\.m4a/.test(line)) part = 1;
        const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (m && onProgress) {
          const pct = parseFloat(m[1]);
          onProgress(part === 0 ? pct * 0.9 : 90 + pct * 0.1);
        }
      }
    });
    proc.stderr.on('data', (data) => { stderr += data; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(outputPath)) {
        return reject(ytError(code, stderr.slice(-4000)));
      }
      if (onProgress) onProgress(100);
      resolve(result);
    });
  }));
}
/** 배경음악용: 유튜브 영상의 소리만 받는다 (m4a 우선). 돌려줌 { file, id, title, uploader, duration } */
async function downloadAudio(url, outDir, onProgress) {
  const info = await fetchInfo(url);
  const id = info.id;
  ensureDir(outDir);
  const found = () => fs.readdirSync(outDir).filter((f) => f.startsWith('yt-' + id + '.') && !/\.(part|ytdl|json)$/i.test(f)).map((f) => path.join(outDir, f))[0];
  const have = found();
  const result = (file) => ({ file, id, title: info.title || id, uploader: info.uploader || info.channel || '', duration: info.duration || 0 });
  if (have && fs.statSync(have).size > 2048) { if (onProgress) onProgress(100); return result(have); }
  return ytdlpManager.withUpdateRetry(() => new Promise((resolve, reject) => {
    const args = ['--newline', '--no-playlist', '-N', '4', '-f', 'bestaudio[ext=m4a]/bestaudio',
      ...runtimeArgs(), '-o', path.join(outDir, 'yt-' + id + '.%(ext)s'), '--', url];
    const proc = spawn(tools.ytdlp, args, getSpawnOptions());
    let stderr = '';
    proc.stdout.on('data', (d) => {
      for (const line of d.toString().split(/\r?\n/)) { const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/); if (m && onProgress) onProgress(parseFloat(m[1])); }
    });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      const f = found();
      if (code !== 0 || !f) return reject(ytError(code, stderr.slice(-4000)));
      if (onProgress) onProgress(100);
      resolve(result(f));
    });
  }));
}
/** 재생목록 주소면 곡 목록(최대 max개), 영상 주소면 그 하나. 돌려줌 [{ url, title, id }] */
async function listPlaylist(url, max = 50) {
  url = String(url || '').trim();
  const isList = /[?&]list=/.test(url) && !/[?&]v=|youtu\.be\/|shorts\//.test(url);
  if (!isList) return [{ url, title: '', id: (url.match(/(?:youtu\.be\/|[?&]v=|shorts\/|live\/)([\w-]{11})/) || [])[1] || '' }];
  return new Promise((resolve, reject) => {
    const args = ['--flat-playlist', '-J', '--playlist-end', String(max), ...runtimeArgs(), '--', url];
    const proc = spawn(tools.ytdlp, args, getSpawnOptions());
    let out = '', err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(ytError(code, err.slice(-4000)));
      try {
        const j = JSON.parse(out);
        resolve((j.entries || []).filter((x) => x && x.id).slice(0, max).map((x) => ({ id: x.id, title: x.title || '', url: 'https://www.youtube.com/watch?v=' + x.id })));
      } catch (e) { reject(new Error('재생목록을 읽지 못했습니다.')); }
    });
  });
}
module.exports = { fetchInfo, fetchAutoSubs, downloadSection, getJsRuntime, downloadAudio, listPlaylist };
