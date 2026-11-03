'use strict';
// Mac 자동 업데이트 (src/main/updater-mac.js): 버전 비교·릴리스 고르기·해시·바꿔 끼우기 스크립트
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const m = require('../src/main/updater-mac.js');

const release = (tag, names, extra = {}) => ({
  tag_name: tag, draft: false, prerelease: false,
  assets: names.map((n) => ({ name: n, browser_download_url: 'https://example.com/' + n, size: 10 })), ...extra,
});

test('버전 비교', () => {
  assert.ok(m.compareVersions('0.3.19', '0.3.18') > 0);
  assert.ok(m.compareVersions('v0.4.0', '0.3.99') > 0);
  assert.ok(m.compareVersions('0.3.18', 'v0.3.18') === 0);
  assert.ok(m.compareVersions('0.3.9', '0.3.10') < 0);
  assert.equal(m.parseVersion('abc'), null);
});

test('릴리스에서 내 칩에 맞는 ZIP 고르기', () => {
  const names = ['SermonShorts-0.3.19-mac-arm64.zip', 'SermonShorts-0.3.19-mac-intel.zip', 'SermonShorts-0.3.19-mac-arm64.dmg', 'SHA256SUMS.txt'];
  assert.equal(m.pickRelease(release('v0.3.19', names), 'arm64').zip.name, 'SermonShorts-0.3.19-mac-arm64.zip');
  assert.equal(m.pickRelease(release('v0.3.19', names), 'x64').zip.name, 'SermonShorts-0.3.19-mac-intel.zip');
  assert.equal(m.pickRelease(release('v0.3.19', names), 'arm64').version, '0.3.19');
  assert.equal(m.pickRelease(release('v0.3.19', names.slice(0, 3)), 'arm64'), null, '해시 목록이 없으면 받지 않는다');
  assert.equal(m.pickRelease(release('v0.3.19', names, { prerelease: true }), 'arm64'), null);
  assert.equal(m.pickRelease(release('v0.3.19', ['SermonShorts-Setup-0.3.19-x64.exe', 'SHA256SUMS.txt']), 'arm64'), null);
});

test('SHA256SUMS.txt 에서 해시 찾기', () => {
  const h = 'a'.repeat(64), g = 'B'.repeat(64);
  const txt = `${h}  SermonShorts-0.3.19-mac-arm64.zip\n${g} *SermonShorts-0.3.19-mac-intel.zip\r\n`;
  assert.equal(m.sumFor(txt, 'SermonShorts-0.3.19-mac-arm64.zip'), h);
  assert.equal(m.sumFor(txt, 'SermonShorts-0.3.19-mac-intel.zip'), 'b'.repeat(64));
  assert.equal(m.sumFor(txt, 'none.zip'), null);
});

test('앱 묶음 경로와 바꿀 수 있는 자리', { skip: process.platform === 'win32' ? 'POSIX 경로·bash·권한 검증은 Windows에서 실행할 수 없음' : false }, () => {
  assert.equal(m.bundleOf('/Applications/SermonShorts.app/Contents/MacOS/SermonShorts'), '/Applications/SermonShorts.app');
  assert.equal(m.bundleOf('/usr/local/bin/node'), null);
  const ok = () => {};
  const deny = () => { throw new Error('EACCES'); };
  assert.equal(m.canReplace('/Applications/SermonShorts.app', ok).ok, true);
  assert.equal(m.canReplace('/Volumes/SermonShorts 0.3.18/SermonShorts.app', ok).ok, false);
  assert.equal(m.canReplace('/private/var/folders/x/AppTranslocation/Y/d/SermonShorts.app', ok).ok, false);
  assert.equal(m.canReplace('/Applications/SermonShorts.app', deny).ok, false);
  assert.equal(m.canReplace(null, ok).ok, false);
});

function swapFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-swap-'));
  const dest = path.join(dir, 'Apps', 'SermonShorts.app');
  const neu = path.join(dir, 'stage', 'SermonShorts.app');
  fs.mkdirSync(path.join(dest, 'Contents'), { recursive: true });
  fs.mkdirSync(path.join(neu, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'Contents', 'v'), 'old');
  fs.writeFileSync(path.join(neu, 'Contents', 'v'), 'new');
  const script = path.join(dir, 'swap.sh');
  fs.writeFileSync(script, m.swapScript(), { mode: 0o755 });
  return { dir, dest, neu, script };
}

test('바꿔 끼우기: 앱이 끝날 때까지 기다렸다가 새 앱을 넣고 옛 앱은 지운다', { skip: process.platform === 'win32' ? 'POSIX 경로·bash·권한 검증은 Windows에서 실행할 수 없음' : false }, async () => {
  const f = swapFixture();
  const app = spawn('sleep', ['30']);
  const sw = spawn('/bin/bash', [f.script, String(app.pid), f.neu, f.dest, '0']);
  let out = ''; sw.stdout.on('data', (d) => { out += d; });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(fs.readFileSync(path.join(f.dest, 'Contents', 'v'), 'utf8'), 'old', '앱이 살아 있는 동안은 건드리지 않는다');
  app.kill();
  const code = await new Promise((r) => sw.on('exit', r));
  assert.equal(code, 0, out);
  assert.equal(fs.readFileSync(path.join(f.dest, 'Contents', 'v'), 'utf8'), 'new');
  assert.equal(fs.existsSync(f.neu), false);
  assert.deepEqual(fs.readdirSync(path.dirname(f.dest)), ['SermonShorts.app'], '옛 앱 찌꺼기가 남지 않는다');
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test('바꿔 끼우기: 새 앱이 없으면 기존 앱을 그대로 둔다', { skip: process.platform === 'win32' ? 'POSIX 경로·bash·권한 검증은 Windows에서 실행할 수 없음' : false }, () => {
  const f = swapFixture();
  fs.rmSync(f.neu, { recursive: true });
  const r = spawnSync('/bin/bash', [f.script, '999999', f.neu, f.dest, '0'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(path.join(f.dest, 'Contents', 'v'), 'utf8'), 'old');
  fs.rmSync(f.dir, { recursive: true, force: true });
});

function fakeApp(version, dir) {
  const handlers = {};
  return { getVersion: () => version, getPath: () => dir, on: (ev, fn) => { handlers[ev] = fn; }, quit() {}, handlers };
}
const jsonFetch = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('확인: 최신이면 latest, 새 버전인데 바꿀 수 없는 자리면 portable(알림·내려받기 페이지)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-upd-'));
  const names = ['SermonShorts-0.3.19-mac-arm64.zip', 'SermonShorts-0.3.19-mac-intel.zip', 'SHA256SUMS.txt'];
  const states = [];
  let status = {};
  const setStatus = (s) => { status = s; states.push(s); };
  const same = m.start({ app: fakeApp('0.3.19', dir), setStatus, getStatus: () => status, log() {}, fetch: jsonFetch(release('v0.3.19', names)) });
  await same.check();
  assert.equal(status.state, 'latest');
  // 테스트의 node 는 .app 이 아니므로 스스로 바꿀 수 없는 자리
  const old = m.start({ app: fakeApp('0.3.18', dir), setStatus, getStatus: () => status, log() {}, fetch: jsonFetch(release('v0.3.19', names)) });
  await old.check();
  assert.equal(status.state, 'portable');
  assert.equal(status.version, '0.3.19');
  assert.ok(status.reason);
  assert.equal(old.install(), false, '받아 둔 새 앱이 없으면 다시 시작하지 않는다');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('확인: GitHub 오류는 error 상태로 (앱은 멈추지 않는다)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-upd-'));
  let status = {};
  const u = m.start({ app: fakeApp('0.3.18', dir), setStatus: (s) => { status = s; }, getStatus: () => status, log() {}, fetch: async () => ({ ok: false, status: 403 }) });
  await u.check();
  assert.equal(status.state, 'error');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('바꿔 끼우기가 막히면(쓰기 권한 없음) 기존 앱을 지키고 last-swap 에 실패를 남긴다', { skip: process.platform === 'win32' ? 'POSIX 경로·bash·권한 검증은 Windows에서 실행할 수 없음' : false }, async () => {
  if (process.getuid && process.getuid() === 0) return;   // root 는 권한을 무시하므로 건너뜀
  const f = swapFixture();
  const apps = path.dirname(f.dest);
  fs.chmodSync(apps, 0o555);
  const r = spawnSync('/bin/bash', [f.script, '999999', f.neu, f.dest, '0'], { encoding: 'utf8' });
  fs.chmodSync(apps, 0o755);
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(path.join(f.dest, 'Contents', 'v'), 'utf8'), 'old');
  assert.equal(m.readLastSwapFailed(f.dir), true, '실패 기록');
  assert.equal(fs.existsSync(path.join(f.dir, 'last-swap')), false, '읽은 뒤 지운다');
  assert.equal(m.readLastSwapFailed(f.dir), false);
  fs.rmSync(f.dir, { recursive: true, force: true });
});
