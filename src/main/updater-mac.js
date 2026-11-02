'use strict';
// Mac 자동 업데이트 (애플 개발자 서명 없이).
// electron-updater 의 Mac 방식(Squirrel.Mac)은 Developer ID 서명이 있어야 해서 쓰지 않고 직접 한다.
//  1) GitHub 최신 릴리스에서 내 칩(arm64·intel)에 맞는 ZIP 을 찾는다
//  2) 뒤에서 받아 SHA256SUMS.txt 와 맞춰 보고, ditto 로 풀고, 버전·서명을 확인한다
//  3) 앱이 끝날 때(또는 [지금 다시 시작]) 작은 셸 스크립트가 앱이 완전히 끝나기를 기다렸다가
//     기존 앱을 옆으로 치우고 새 앱을 그 자리에 넣는다. 실패하면 기존 앱을 되돌린다.
// 바꿀 수 없는 곳(DMG 안에서 실행, 앱 격리 위치, 쓰기 권한 없음)이면 새 버전 알림과 내려받기 페이지만 준다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const LATEST_API = 'https://api.github.com/repos/hahadark/sermon-shorts/releases/latest';

// ---------------------------------------------------------------- 순수 함수 (테스트용으로 내보냄)

/** 'v0.3.18' → [0,3,18]. 숫자가 아니면 null */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}

/** a 가 b 보다 새 버전이면 양수 */
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** 이 Mac 에 맞는 ZIP 이름의 꼬리 (빌드 이름 규칙: SermonShorts-<버전>-mac-arm64.zip / -mac-intel.zip) */
function archLabel(arch) { return arch === 'arm64' ? 'arm64' : 'intel'; }

/** 릴리스 JSON → { version, zip:{name,url,size}, sums:{url} } 또는 null */
function pickRelease(rel, arch) {
  if (!rel || rel.draft || rel.prerelease) return null;
  const version = String(rel.tag_name || '').replace(/^v/, '');
  if (!parseVersion(version)) return null;
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const want = `SermonShorts-${version}-mac-${archLabel(arch)}.zip`;
  const zip = assets.find((a) => a && a.name === want);
  const sums = assets.find((a) => a && a.name === 'SHA256SUMS.txt');
  if (!zip || !sums) return null;
  return { version, zip: { name: zip.name, url: zip.browser_download_url, size: zip.size || 0 }, sums: { url: sums.browser_download_url } };
}

/** SHA256SUMS.txt 에서 파일 이름의 해시 */
function sumFor(text, name) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === name) return m[1].toLowerCase();
  }
  return null;
}

/** 실행 파일 경로 → .app 묶음 경로 (…/SermonShorts.app/Contents/MacOS/SermonShorts) */
function bundleOf(execPath) {
  const b = path.resolve(execPath, '..', '..', '..');
  return /\.app$/i.test(b) ? b : null;
}

/** 이 자리의 앱을 스스로 바꿀 수 있나. { ok, reason } */
function canReplace(bundle, access = fs.accessSync) {
  if (!bundle) return { ok: false, reason: '앱 묶음을 찾지 못했습니다' };
  if (bundle.startsWith('/Volumes/')) return { ok: false, reason: '디스크 이미지(DMG) 안에서 실행 중입니다. 응용 프로그램 폴더로 옮겨 주세요' };
  if (bundle.includes('/AppTranslocation/')) return { ok: false, reason: '격리된 위치에서 실행 중입니다. 응용 프로그램 폴더로 옮겨 주세요' };
  try {
    access(path.dirname(bundle), fs.constants.W_OK);
    access(bundle, fs.constants.W_OK);
  } catch (_) { return { ok: false, reason: '앱 폴더에 쓸 권한이 없습니다' }; }
  return { ok: true };
}

/** 앱이 끝난 뒤 바꿔 끼우는 셸 스크립트. 인자: <pid> <새 앱> <기존 앱 자리> <다시 열기 1/0> */
function swapScript() {
  return `#!/bin/bash
# SermonShorts Mac 업데이트: 앱이 끝나기를 기다렸다가 바꿔 끼운다.
PID="$1"; NEW="$2"; DEST="$3"; RELAUNCH="$4"
echo "$(date '+%F %T') 시작 pid=$PID new=$NEW dest=$DEST relaunch=$RELAUNCH"
for _ in $(seq 1 600); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$PID" 2>/dev/null; then echo "앱이 끝나지 않아 그만둡니다"; exit 1; fi
[ -d "$NEW" ] || { echo "새 앱이 없습니다"; exit 1; }
OLD="$(dirname "$DEST")/.SermonShorts-old-$$.app"
ok=0
if mv "$DEST" "$OLD"; then
  if mv "$NEW" "$DEST"; then ok=1; rm -rf "$OLD"
  else echo "새 앱을 넣지 못해 되돌립니다"; rm -rf "$DEST"; mv "$OLD" "$DEST"; fi
else echo "기존 앱을 옮기지 못했습니다"; fi
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
echo "$(date '+%F %T') 결과 ok=$ok"
echo "$ok" > "$(dirname "$0")/last-swap"   # 다음 실행 때 앱이 읽는다 (0 이면 macOS 가 막았을 수 있음)
[ "$RELAUNCH" = 1 ] && open "$DEST"
[ "$ok" = 1 ]
`;
}

/** 지난번 바꿔 끼우기가 실패했으면 화면에 보일 안내 */
const BLOCKED_REASON = 'macOS 가 앱 바꾸기를 막았습니다. 시스템 설정 > 개인정보 보호 및 보안 > 앱 관리에서 SermonShorts 를 켜 주세요';

/** last-swap 파일을 읽고 지운다. 실패였으면 true */
function readLastSwapFailed(work) {
  const f = path.join(work, 'last-swap');
  let failed = false;
  try { failed = fs.readFileSync(f, 'utf8').trim() === '0'; fs.rmSync(f, { force: true }); } catch (_) { /* 없음 */ }
  return failed;
}

// ---------------------------------------------------------------- 실제 동작

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.message += ' ' + String(stderr || '').trim(); reject(err); } else resolve(String(stdout || ''));
    });
  });
}

async function sha256File(file) {
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', resolve).on('error', reject);
  });
  return h.digest('hex');
}

/**
 * start({ app, setStatus, getStatus, log, fetch, shell }) → { check, install, info }
 * setStatus 는 updater.js 의 화면 상태 함수 (idle/checking/latest/downloading/ready/portable/error)
 */
function start(opts) {
  const { app, setStatus, getStatus, log } = opts;
  const doFetch = opts.fetch || ((url, init) => fetch(url, init));
  const current = app.getVersion();
  const bundle = bundleOf(process.execPath);
  const place = canReplace(bundle);
  const work = path.join(app.getPath('userData'), 'mac-update');
  let busy = null;          // 진행 중인 확인·받기
  let staged = null;        // { version, app } 바꿀 준비가 된 새 앱
  let relaunch = false;
  let swapped = false;
  const lastFailed = readLastSwapFailed(work);

  // 지난 업데이트 찌꺼기 정리 (지금 버전 이하)
  try {
    for (const d of fs.readdirSync(work)) if (compareVersions(d, current) <= 0) fs.rmSync(path.join(work, d), { recursive: true, force: true });
  } catch (_) { /* 폴더 없음 */ }

  async function getJson(url) {
    const r = await doFetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SermonShorts/' + current } });
    if (!r.ok) throw new Error('GitHub 응답 ' + r.status);
    return r.json();
  }

  async function download(url, file, size, onPct) {
    const r = await doFetch(url, { headers: { 'User-Agent': 'SermonShorts/' + current }, redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error('내려받기 실패 ' + r.status);
    const total = Number(r.headers.get('content-length')) || size || 0;
    const tmp = file + '.part';
    const out = fs.createWriteStream(tmp);
    const reader = r.body.getReader();
    let got = 0, last = -1;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (pct !== last) { last = pct; onPct(pct); }
      }
    } finally {
      await new Promise((res) => out.end(res));
    }
    if (total && got !== total) throw new Error(`받은 크기가 다릅니다 (${got}/${total})`);
    fs.renameSync(tmp, file);
  }

  async function prepare(rel) {
    const dir = path.join(work, rel.version);
    const appDir = path.join(dir, 'app', 'SermonShorts.app');
    const done = path.join(dir, 'ready.json');
    if (fs.existsSync(done) && fs.existsSync(appDir)) return appDir;   // 지난번에 다 받아 둔 것
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, rel.zip.name);
    setStatus({ state: 'downloading', version: rel.version, percent: 0 });
    await download(rel.zip.url, zip, rel.zip.size, (p) => setStatus({ state: 'downloading', version: rel.version, percent: p }));
    const sums = await (await doFetch(rel.sums.url, { headers: { 'User-Agent': 'SermonShorts/' + current }, redirect: 'follow' })).text();
    const want = sumFor(sums, rel.zip.name);
    const got = await sha256File(zip);
    if (!want || want !== got) throw new Error('받은 파일의 해시가 맞지 않습니다');
    await run('/usr/bin/ditto', ['-x', '-k', zip, path.join(dir, 'app')]);
    fs.rmSync(zip, { force: true });
    const ver = (await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(appDir, 'Contents', 'Info.plist')])).trim();
    if (ver !== rel.version) throw new Error(`새 앱의 버전이 다릅니다 (${ver})`);
    await run('/usr/bin/codesign', ['--verify', '--deep', appDir]);   // 풀다가 깨지지 않았는지 (ad-hoc 서명 확인)
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', appDir]).catch(() => {});
    fs.writeFileSync(done, JSON.stringify({ version: rel.version, at: Date.now() }));
    return appDir;
  }

  function check() {
    if (busy) return busy;
    if (staged) { setStatus({ state: 'ready', version: staged.version }); return Promise.resolve(getStatus()); }
    busy = (async () => {
      setStatus({ state: 'checking' });
      const rel = pickRelease(await getJson(LATEST_API), process.arch);
      if (!rel || compareVersions(rel.version, current) <= 0) { setStatus({ state: 'latest' }); return; }
      if (!place.ok) { log('[update] 스스로 바꿀 수 없음:', place.reason); setStatus({ state: 'portable', version: rel.version, reason: place.reason }); return; }
      const appDir = await prepare(rel);
      staged = { version: rel.version, app: appDir };
      log('[update] 새 버전 준비됨', rel.version);
      // 지난번에 막혔으면 안내와 내려받기 페이지를 보이고, 닫을 때는 한 번 더 바꿔 본다 (그새 권한을 켰을 수 있음)
      if (lastFailed) setStatus({ state: 'portable', version: rel.version, reason: BLOCKED_REASON });
      else setStatus({ state: 'ready', version: rel.version });
    })().catch((e) => {
      log('[update] Mac 업데이트 실패:', e.message);
      setStatus({ state: 'error', message: e.message });
    }).finally(() => { busy = null; }).then(() => getStatus());
    return busy;
  }

  function spawnSwap() {
    if (!staged || swapped) return false;
    swapped = true;
    const script = path.join(work, 'swap.sh');
    fs.writeFileSync(script, swapScript(), { mode: 0o755 });
    const logFd = fs.openSync(path.join(work, 'swap.log'), 'a');
    const child = spawn('/bin/bash', [script, String(process.pid), staged.app, bundle, relaunch ? '1' : '0'], { detached: true, stdio: ['ignore', logFd, logFd] });
    child.unref();
    log('[update] 바꿔 끼우기 시작', staged.version, relaunch ? '(다시 열기)' : '');
    return true;
  }

  // 앱이 끝날 때 바꿔 끼운다 (닫기를 취소하면 will-quit 이 오지 않으므로 그대로 둔다)
  app.on('will-quit', () => { try { spawnSwap(); } catch (e) { log('[update] 바꿔 끼우기 실패:', e.message); } });

  /** [지금 다시 시작] */
  function install() {
    if (!staged) return false;
    relaunch = true;
    setImmediate(() => app.quit());
    return true;
  }

  return { check, install, info: () => ({ bundle, place, work, staged }) };
}

module.exports = { start, parseVersion, compareVersions, archLabel, pickRelease, sumFor, bundleOf, canReplace, swapScript, readLastSwapFailed, BLOCKED_REASON };
