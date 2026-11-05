'use strict';
// 외부 도구/폴더 경로. 모두 앱 폴더(이 파일 기준 ../..) 기준이라 어느 PC, 어느 드라이브에 두어도 동작한다.
// bin/ 에 없으면 PATH에서 찾는다 (예: ffmpeg를 따로 설치한 PC). Windows는 .exe, macOS는 확장자 없는 실행 파일.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';
// macOS 앱은 셸 PATH를 물려받지 않으므로 Homebrew 경로도 직접 본다
const EXTRA_DIRS = IS_WIN ? [] : ['/opt/homebrew/bin', '/usr/local/bin'];
let electronApp=null;try{electronApp=require('electron').app;}catch(_){}
const DATA_ROOT=electronApp?.isPackaged?path.join(electronApp.getPath('userData'),'runtime'):ROOT;

function findTool(name) {
  const local = path.join(ROOT, 'bin', name + EXE);
  if (fs.existsSync(local)) return local;
  for (const d of EXTRA_DIRS) { const p = path.join(d, name); if (fs.existsSync(p)) return p; }
  try {
    const out = execFileSync(IS_WIN ? 'where' : 'which', [name], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const p = out.split(/\r?\n/).map(s => s.trim()).find(s => s && fs.existsSync(s));
    if (p) return p;
  } catch (e) { /* 없음 */ }
  return local; // 없으면 bin 경로를 돌려줘서 오류 메시지에 어디에 넣어야 하는지 보이게 한다
}

const paths = {
  root: ROOT,
  dataRoot: DATA_ROOT,
  engineDir: path.join(DATA_ROOT, 'engine'),
  models: path.join(DATA_ROOT, 'engine', 'models'),
  python: IS_WIN ? path.join(DATA_ROOT, 'engine', '.venv', 'Scripts', 'python.exe') : path.join(DATA_ROOT, 'engine', '.venv', 'bin', 'python'),
  cache: path.join(DATA_ROOT, 'cache'),
  assets: path.join(ROOT, 'assets'),
};

/** 폴더 만들기 (없는 상위 폴더도). fs.mkdirSync(..., { recursive: true }) 는 Windows '제어된 폴더 액세스'가 막으면
 *  오류 없이 끝없이 다시 시도해 앱이 멈춘다(문서 폴더 등). 그래서 한 단계씩 만들고, 막히면 바로 알기 쉬운 오류를 낸다. */
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } }
function blockedError(dir, e) {
  const code = e && e.code;
  const why = code === 'ENOENT' || code === 'EPERM' || code === 'EACCES'
    ? '이 위치에 쓸 수 없습니다. Windows 보안의 "제어된 폴더 액세스"가 막았거나 권한이 없을 수 있습니다. 다른 폴더를 고르거나, Windows 보안 → 랜섬웨어 방지 → 앱 허용에 SermonShorts 를 추가해 주세요.'
    : String((e && e.message) || e);
  return Object.assign(new Error('폴더를 만들지 못했습니다: ' + dir + '\n' + why), { code: code || 'EMKDIR', path: dir, blocked: code === 'ENOENT' || code === 'EPERM' || code === 'EACCES' });
}
function ensureDir(dir) {
  dir = path.resolve(String(dir));
  if (isDir(dir)) return dir;
  const todo = [];
  for (let cur = dir; !isDir(cur);) {
    todo.push(cur);
    const up = path.dirname(cur);
    if (up === cur) break;   // 드라이브 맨 위
    cur = up;
    if (todo.length > 256) throw blockedError(dir, new Error('경로가 너무 깁니다'));
  }
  for (const p of todo.reverse()) {
    try { fs.mkdirSync(p); } catch (e) { if (!(e && e.code === 'EEXIST' && isDir(p))) throw blockedError(p, e); }
  }
  if (!isDir(dir)) throw blockedError(dir, Object.assign(new Error('만든 뒤에도 폴더가 없습니다'), { code: 'ENOENT' }));
  return dir;
}
/** 실제로 파일을 쓸 수 있는 폴더인지 (만들 수 있으면 만들고, 시험 파일을 썼다 지운다) */
function canWriteDir(dir) {
  try {
    ensureDir(dir);
    const f = path.join(dir, '.ss-write-test-' + process.pid + '-' + Date.now());
    fs.writeFileSync(f, 'ok'); fs.unlinkSync(f);
    return true;
  } catch (_) { return false; }
}

ensureDir(paths.cache);

/** cache/<hash>/ 폴더 (없으면 생성) */
function cacheDir(hash) {
  return ensureDir(path.join(paths.cache, hash));
}

// yt-dlp: 앱이 관리하는 최신본(데이터 폴더 bin/) → 설치본 bin/ → PATH 순서 (ytdlp-manager.js 가 최신으로 유지)
const managedYtdlp = path.join(DATA_ROOT, 'bin', 'yt-dlp' + EXE);
let fallbackYtdlp = null;
function ytdlpPath() {
  if (fs.existsSync(managedYtdlp)) return managedYtdlp;
  if (!fallbackYtdlp) fallbackYtdlp = findTool('yt-dlp');
  return fallbackYtdlp;
}
paths.managedYtdlp = managedYtdlp;

// ffmpeg·ffprobe: 점검 창에서 자동 설치한 것(데이터 폴더 bin/) → 설치본 bin/ → PATH 순서. 설치 직후에도 바로 쓰이게 매번 본다
const managedBin = path.join(DATA_ROOT, 'bin');
const found = {};
function toolPath(name) {
  const managed = path.join(managedBin, name + EXE);
  if (fs.existsSync(managed)) return managed;
  if (!found[name] || !fs.existsSync(found[name])) found[name] = findTool(name);
  return found[name];
}
paths.managedBin = managedBin;

module.exports = { ...paths, paths, ensureDir, canWriteDir, isDir, cacheDir, IS_WIN, EXE, ytdlpPath };
for (const [key, get] of [['ytdlp', ytdlpPath], ['ffmpeg', () => toolPath('ffmpeg')], ['ffprobe', () => toolPath('ffprobe')]]) {
  Object.defineProperty(module.exports, key, { get, enumerable: true });
  Object.defineProperty(paths, key, { get, enumerable: true });
}
