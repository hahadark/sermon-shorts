'use strict';
// yt-dlp 를 앱이 직접 관리한다.
// 유튜브가 바뀌면 오래된 yt-dlp 는 "HTTP Error 403" 등으로 바로 실패한다. 그래서
//  - 앱 데이터 폴더(bin/)에 공식 단일 실행 파일을 두고 (설치본에 든 것을 복사하거나 GitHub 에서 받음)
//  - 하루에 한 번, 그리고 유튜브 오류가 났을 때 최신으로 바꾼 뒤 한 번 더 시도한다.
// PATH 에 있는 pip 설치본처럼 앱이 고칠 수 없는 yt-dlp 에는 기대지 않는다.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const tools = require('./tools');

const ASSET = process.platform === 'win32' ? 'yt-dlp.exe' : (process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp');
const LATEST_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}`;
const DAY = 24 * 3600 * 1000;
const MIN_FORCE_GAP = 10 * 60 * 1000; // 오류가 연달아 나도 10분 안에는 다시 업데이트하지 않는다

/** 오래된 yt-dlp 때문에 생기는 오류인지 (업데이트 후 다시 해 볼 만한지) — 순수 함수 */
function isStaleError(text) {
  return /HTTP Error 403|403: Forbidden|Sign in to confirm|Requested format is not available|nsig extraction failed|Unable to extract|Precondition check failed|Some formats may be missing|older than 90 days|page needs to be reloaded/i.test(String(text || ''));
}

let running = null;
let log = () => {};
function setLogger(fn) { log = fn || (() => {}); }

function stateFile() { return path.join(tools.cache, 'ytdlp-update.json'); }
function readState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (_) { return {}; } }
function writeState(s) { try { fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2)); } catch (_) { /* 무시 */ } }

function run(bin, args, timeout = 120000) {
  return new Promise((resolve) => {
    let out = '', done = false;
    let proc;
    try { proc = spawn(bin, args, { windowsHide: true }); } catch (e) { resolve({ code: -1, out: e.message }); return; }
    const timer = setTimeout(() => { if (!done) { try { proc.kill(); } catch (_) {} resolve({ code: -1, out: out + '\n(시간 초과)' }); done = true; } }, timeout);
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, out: e.message }); } });
    proc.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, out }); } });
  });
}

async function versionOf(bin) {
  if (!bin || !fs.existsSync(bin)) return '';
  const r = await run(bin, ['--version'], 30000);
  if (r.code !== 0) return '';
  const v = r.out.trim().split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d{4}\.\d{2}\.\d{2}/.test(s)).pop();
  return v || '';
}

/** 이전 업데이트에서 남은 파일 정리 (실행 중이면 다음에 지운다) */
function cleanupOld(dest) {
  const dir = path.dirname(dest), base = path.basename(dest);
  let files = [];
  try { files = fs.readdirSync(dir); } catch (_) { return; }
  for (const f of files) {
    if (f !== base && f.startsWith(base) && /\.(old|download)(-\d+)?$/.test(f)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* 사용 중 */ }
    }
  }
}

/** GitHub 에서 최신 공식 실행 파일을 받아 바꿔 끼운다 */
async function downloadLatest(dest) {
  const tmp = dest + '.download';
  const res = await fetch(LATEST_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error('yt-dlp 내려받기 실패 (HTTP ' + res.status + ')');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000000) throw new Error('받은 yt-dlp 파일이 올바르지 않습니다');
  fs.writeFileSync(tmp, buf);
  if (process.platform !== 'win32') fs.chmodSync(tmp, 0o755);
  if (fs.existsSync(dest)) {
    // 실행 중인 파일은 덮어쓸 수 없지만 이름은 바꿀 수 있다
    try { fs.renameSync(dest, dest + '.old-' + Date.now()); } catch (_) { try { fs.unlinkSync(dest); } catch (_) {} }
  }
  fs.renameSync(tmp, dest);
}

/** 설치본에 들어 있는 공식 실행 파일 (앱 폴더 bin/). PATH 의 pip 설치본은 쓰지 않는다 */
function bundledPath() {
  const p = path.join(tools.root, 'bin', 'yt-dlp' + tools.EXE);
  return fs.existsSync(p) ? p : null;
}

/**
 * 관리용 yt-dlp 를 준비하고(없으면 복사·다운로드) 필요하면 최신으로 바꾼다.
 * opts.force: 하루가 안 지났어도 업데이트 확인 (단, 10분 안에 이미 했으면 건너뜀)
 * @returns {Promise<{path, version, before, updated, checked}>}
 */
function ensure(opts = {}) {
  if (running) return running;
  running = (async () => {
    const dest = tools.managedYtdlp;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    cleanupOld(dest);
    const st = readState();
    let fresh = false;
    if (!fs.existsSync(dest)) {
      const bundled = bundledPath();
      if (bundled && path.resolve(bundled) !== path.resolve(dest)) {
        fs.copyFileSync(bundled, dest);
        if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
        log('yt-dlp 설치본 복사: ' + dest);
      } else {
        log('yt-dlp 최신 버전 받는 중…');
        await downloadLatest(dest);
        fresh = true;
      }
    }
    const before = await versionOf(dest);
    const since = Date.now() - (st.checkedAt || 0);
    const due = fresh ? false : (opts.force ? since > (opts.minGap != null ? opts.minGap : MIN_FORCE_GAP) : since > DAY);
    if (!due) {
      if (fresh || !st.version) writeState({ checkedAt: fresh ? Date.now() : (st.checkedAt || 0), version: before });
      return { path: dest, version: before, before, updated: fresh, checked: fresh };
    }
    log('yt-dlp 업데이트 확인 중… (현재 ' + (before || '알 수 없음') + ')');
    const r = await run(dest, ['-U'], 180000);
    let after = await versionOf(dest);
    if ((r.code !== 0 && after === before) || !after) {
      // 자체 업데이트가 안 되면 최신 파일을 직접 받는다
      try { await downloadLatest(dest); after = await versionOf(dest); }
      catch (e) { log('yt-dlp 업데이트 실패: ' + e.message); if (!after) throw e; }
    }
    writeState({ checkedAt: Date.now(), version: after });
    if (after !== before) log('yt-dlp 업데이트: ' + before + ' → ' + after);
    return { path: dest, version: after, before, updated: after !== before, checked: true };
  })().finally(() => { running = null; });
  return running;
}

/** yt-dlp 를 쓰기 전에: 처음 준비·업데이트가 진행 중이면 끝날 때까지(최대 2분) 기다린다 */
async function ready() {
  const needInstall = !fs.existsSync(tools.managedYtdlp);
  const p = running || (needInstall ? ensure() : null);
  if (!p) return;
  await Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 120000))]);
}

/**
 * yt-dlp 를 쓰는 작업을 실행하고, 오래된 yt-dlp 때문으로 보이는 오류면 최신으로 바꾼 뒤 한 번 더 해 본다.
 * fn 은 실패할 때 err.stderr(또는 message)에 yt-dlp 출력을 담아 던진다.
 */
async function withUpdateRetry(fn) {
  await ready();
  try {
    return await fn();
  } catch (err) {
    if (!isStaleError((err && err.stderr) || (err && err.message))) throw err;
    let r = null;
    try { r = await ensure({ force: true }); } catch (_) { throw err; }
    if (!r || !r.updated) throw err; // 바꾼 것이 없으면 다시 해 봐도 같다
    log('yt-dlp 를 바꾼 뒤 다시 시도합니다');
    return fn();
  }
}

module.exports = { ensure, ready, withUpdateRetry, isStaleError, versionOf, setLogger, LATEST_URL, ASSET };
