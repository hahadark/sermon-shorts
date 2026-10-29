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
  ffmpeg: findTool('ffmpeg'),
  ffprobe: findTool('ffprobe'),
  dataRoot: DATA_ROOT,
  engineDir: path.join(DATA_ROOT, 'engine'),
  models: path.join(DATA_ROOT, 'engine', 'models'),
  python: IS_WIN ? path.join(DATA_ROOT, 'engine', '.venv', 'Scripts', 'python.exe') : path.join(DATA_ROOT, 'engine', '.venv', 'bin', 'python'),
  cache: path.join(DATA_ROOT, 'cache'),
  assets: path.join(ROOT, 'assets'),
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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

module.exports = { ...paths, paths, ensureDir, cacheDir, IS_WIN, EXE, ytdlpPath };
Object.defineProperty(module.exports, 'ytdlp', { get: ytdlpPath, enumerable: true });
Object.defineProperty(paths, 'ytdlp', { get: ytdlpPath, enumerable: true });
