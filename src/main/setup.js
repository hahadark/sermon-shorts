'use strict';
// 시스템 점검 창의 설치 버튼: 자막 엔진 설치(setup_engine.ps1, Python 3.12가 없으면 함께 설치), Whisper 모델 받기, 안내 페이지 열기
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const tools = require('./tools');

// 렌더러는 키만 보낸다. 주소는 여기 고정된 것만 연다.
const LINKS = {
  python: process.platform === 'darwin' ? 'https://www.python.org/downloads/macos/' : 'https://www.python.org/downloads/release/python-31210/',
  ffmpeg: 'https://www.gyan.dev/ffmpeg/builds/',
  ytdlp: 'https://github.com/yt-dlp/yt-dlp/releases/latest',
  node: 'https://nodejs.org/ko/download',
  gemini: 'https://aistudio.google.com/apikey',
};

let running = null; // 한 번에 하나의 설치만

function run(exe, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(exe, args, { encoding: 'utf8', windowsHide: true, timeout }, (err, stdout) => resolve({ ok: !err, stdout: stdout || '' }));
  });
}

function pyEnv() {
  const env = { ...process.env };
  for (const k of ['PYTHONHOME', 'PYTHONPATH', 'PIP_PREFIX', 'PIP_TARGET', 'PIP_USER', 'VIRTUAL_ENV']) delete env[k];
  env.PYTHONIOENCODING = 'utf-8';
  env.HF_HOME = path.join(tools.engineDir, 'hf-cache');
  return env;
}

/** setup_engine.ps1 / setup_engine.sh와 같은 순서로 Python 3.12를 찾는다. 없으면 null */
async function findPython312() {
  if (!tools.IS_WIN) {
    const mac = [
      path.join(tools.engineDir, 'python', 'bin', 'python3.12'),
      '/opt/homebrew/bin/python3.12', '/usr/local/bin/python3.12',
      '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12',
    ];
    for (const c of mac) {
      if (fs.existsSync(c) && (await run(c, ['-c', 'import sys; sys.exit(0 if sys.version_info[:2]==(3,12) else 1)'])).ok) return c;
    }
    return null;
  }
  const py = await run('py', ['-3.12', '-c', 'import sys; print(sys.executable)']);
  if (py.ok && py.stdout.trim()) return py.stdout.trim().split(/\r?\n/).pop().trim();
  const env = process.env;
  const candidates = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'python.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Python312', 'python.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Python312', 'python.exe'),
    'C:\\Python312\\python.exe',
  ];
  const found = candidates.find((c) => c && fs.existsSync(c));
  if (found) return found;
  const p = await run('python', ['-c', "import sys; print('%d.%d|' % sys.version_info[:2] + sys.executable)"]);
  const [ver, exe] = p.stdout.trim().split('|');
  return p.ok && ver === '3.12' && exe ? exe.trim() : null;
}

function openLink(key) {
  const url = LINKS[key];
  if (!url) return { ok: false, message: '알 수 없는 링크입니다.' };
  require('electron').shell.openExternal(url);
  return { ok: true, message: '브라우저에서 열었습니다: ' + url };
}

/** 줄 단위로 출력을 읽는 프로세스 실행. onLine(line) */
function spawnLines(exe, args, opts, onLine) {
  return new Promise((resolve) => {
    let proc;
    try { proc = spawn(exe, args, { windowsHide: true, ...opts }); } catch (e) { resolve({ code: -1, error: e.message }); return; }
    const tail = [];
    const feed = (stream) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (d) => {
        buf += d;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const l of lines) {
          if (!l.trim()) continue;
          tail.push(l); if (tail.length > 20) tail.shift();
          onLine(l);
        }
      });
    };
    feed(proc.stdout); feed(proc.stderr);
    proc.on('error', (e) => resolve({ code: -1, error: e.message, tail }));
    proc.on('close', (code) => resolve({ code, tail }));
  });
}

function exclusive(name, fn) {
  if (running) return Promise.resolve({ ok: false, message: '이미 다른 설치가 진행 중입니다: ' + running });
  running = name;
  return fn().finally(() => { running = null; });
}

/** 설치 스크립트 실행 (Windows: setup_engine.ps1, macOS: setup_engine.sh). force: 기존 가상환경을 지우고 새로 설치 */
function installEngine(force, onProgress) {
  return exclusive('자막 엔진', async () => {
    const script = path.join(tools.root, 'scripts', tools.IS_WIN ? 'setup_engine.ps1' : 'setup_engine.sh');
    if (!fs.existsSync(script)) return { ok: false, message: '설치 스크립트가 없습니다: ' + script };
    const [exe, args] = tools.IS_WIN
      ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DataDir', tools.dataRoot, '-InstallPython', ...(force ? ['-Force'] : [])]]
      : ['/bin/bash', [script, '--data-dir', tools.dataRoot, '--install-python', ...(force ? ['--force'] : [])]];
    let done = null, error = null;
    onProgress({ pct: 0, message: '자막 엔진 설치 시작 (PyTorch 포함 약 3GB, 10분 이상 걸릴 수 있습니다)' });
    const r = await spawnLines(exe, args, { env: pyEnv() }, (line) => {
      let m = null;
      try { m = JSON.parse(line); } catch (e) { return; }
      if (m.type === 'progress') onProgress({ pct: m.pct, message: m.message });
      else if (m.type === 'warn') onProgress({ message: m.message });
      else if (m.type === 'error') error = m.message;
      else if (m.type === 'done') done = m;
    });
    if (done && done.ok && r.code === 0) return { ok: true, message: done.message || '엔진 설치 완료' };
    return { ok: false, message: error || ('엔진 설치 실패 (코드 ' + r.code + '): ' + (r.error || (r.tail || []).slice(-3).join(' '))) };
  });
}

function dirSize(dir) {
  let n = 0;
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const d of list) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) n += dirSize(p);
    else { try { n += fs.statSync(p).size; } catch (e) { /* */ } }
  }
  return n;
}

/** transcribe.py와 같은 모델(GPU면 large-v3, CPU면 medium)을 같은 폴더에 미리 받는다 */
function downloadModel(onProgress) {
  return exclusive('Whisper 모델', async () => {
    if (!fs.existsSync(tools.python)) return { ok: false, message: '먼저 자막 엔진을 설치하세요.' };
    fs.mkdirSync(tools.models, { recursive: true });
    const code = [
      'import json, sys, torch',
      'from faster_whisper.utils import download_model',
      "name = 'large-v3' if torch.cuda.is_available() else 'medium'",
      "print(json.dumps({'model': name}), flush=True)",
      'download_model(name, cache_dir=sys.argv[1])',
      "print(json.dumps({'done': True}), flush=True)",
    ].join('\n');
    let model = '';
    let finished = false;
    const start = dirSize(tools.models);
    const timer = setInterval(() => {
      const mb = Math.round((dirSize(tools.models) - start) / 1024 / 1024);
      onProgress({ message: (model || 'Whisper') + ' 모델 받는 중... ' + mb + ' MB' });
    }, 1500);
    const r = await spawnLines(tools.python, ['-c', code, tools.models], { env: pyEnv(), cwd: tools.root }, (line) => {
      try { const m = JSON.parse(line); if (m.model) model = m.model; if (m.done) finished = true; } catch (e) { /* 진행 표시줄 */ }
    });
    clearInterval(timer);
    if (finished && r.code === 0) return { ok: true, message: model + ' 모델을 받았습니다.' };
    return { ok: false, message: '모델 받기 실패 (코드 ' + r.code + '): ' + (r.error || (r.tail || []).slice(-2).join(' ')) };
  });
}

module.exports = { LINKS, findPython312, openLink, installEngine, downloadModel };
