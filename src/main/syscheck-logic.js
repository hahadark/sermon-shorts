'use strict';
// 시스템 점검: 다른 PC에서도 필요한 도구가 다 있는지 확인한다. API 키는 절대 반환하지 않는다.
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const tools = require('./tools');
const ai = require('./ai');
const youtube = require('./youtube');
const setup = require('./setup');

const TEST_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // 유튜브 첫 영상 ("Me at the zoo"), 어느 교회와도 상관없는 공개 영상

function run(exe, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(exe, args, { encoding: 'utf8', windowsHide: true, timeout: opts.timeout || 30000, env: opts.env || process.env, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '', error: err }));
  });
}

function pyEnv() {
  const env = { ...process.env };
  delete env.PYTHONHOME; delete env.PYTHONPATH; delete env.PIP_PREFIX;
  env.PYTHONIOENCODING = 'utf-8';
  return env;
}

function fmtBytes(n) {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + ' GB';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(0) + ' MB';
  return Math.round(n / 1024) + ' KB';
}

function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += dirSize(p);
      else total += fs.statSync(p).size;
    } catch (_) { /* 무시 */ }
  }
  return total;
}

/** 지울 수 있는 캐시: cache/yt (유튜브 다운로드), cache/<32자 hash> (자막 결과, 파형) */
function clearableCacheDirs() {
  const out = [];
  // cache/yt/<id>/ 통째로 지운다: <id>_full.mp4, part_*.mp4 (+ .json 사이드카, 받다 남은 .v.mp4/.a.m4a), 자동자막 json3
  const yt = path.join(tools.cache, 'yt');
  if (fs.existsSync(yt)) out.push(yt);
  for (const e of fs.readdirSync(tools.cache, { withFileTypes: true })) {
    if (e.isDirectory() && /^[a-f0-9]{16,64}$/i.test(e.name)) out.push(path.join(tools.cache, e.name));
  }
  return out;
}

async function checkFfmpeg() {
  if (autoRunning) await autoRunning.catch(() => {}); // 시작할 때 자동으로 받는 중이면 끝난 뒤 본다
  const a = await run(tools.ffmpeg, ['-hide_banner', '-version']);
  const b = await run(tools.ffprobe, ['-hide_banner', '-version']);
  const ver = (a.stdout.match(/ffmpeg version (\S+)/) || [])[1];
  if (a.ok && b.ok) return { id: 'ffmpeg', name: 'ffmpeg / ffprobe', status: 'ok', value: ver || '설치됨' };
  const missing = [!a.ok && 'ffmpeg' + tools.EXE, !b.ok && 'ffprobe' + tools.EXE].filter(Boolean).join(', ');
  return { id: 'ffmpeg', name: 'ffmpeg / ffprobe', status: 'error', critical: true, value: missing + ' 없음',
    hint: tools.IS_WIN ? '[설치]를 누르면 공식 빌드(gyan.dev, 약 100MB)를 받아 넣습니다.' : 'Homebrew로 설치하세요: brew install ffmpeg', actions: tools.IS_WIN ? ['install-ffmpeg', 'open:ffmpeg'] : ['open:ffmpeg'] };
}

async function checkYtdlp() {
  // 없으면 앱이 공식 최신판을 받아 넣는다 (시작할 때 이미 받는 중이면 끝날 때까지 기다린다)
  await require('./ytdlp-manager').ready().catch(() => {});
  const r = await run(tools.ytdlp, ['--version']);
  if (r.ok) return { id: 'ytdlp', name: 'yt-dlp', status: 'ok', value: r.stdout.trim(), actions: ['update-ytdlp'],
    hint: '유튜브 가져오기가 갑자기 안 되면 [업데이트]를 누르세요.' };
  return { id: 'ytdlp', name: 'yt-dlp', status: 'error', critical: true, value: '없음',
    hint: '[설치]를 누르면 공식 최신판(GitHub)을 받아 넣습니다.', actions: ['install-ytdlp', 'open:ytdlp'] };
}

function checkJsRuntime() {
  const rt = youtube.getJsRuntime();
  if (!rt.path) return { id: 'jsruntime', name: '유튜브용 JS 런타임', status: 'error', value: '없음',
    hint: 'Node.js를 설치하거나 bin 폴더에 deno.exe를 넣으세요.', actions: ['open:node'] };
  return { id: 'jsruntime', name: '유튜브용 JS 런타임', status: 'ok', value: rt.label + ' ' + (rt.version || ''),
    hint: rt.path, actions: ['test-youtube'] };
}

async function checkPython() {
  if (!fs.existsSync(tools.python)) {
    const py312 = await setup.findPython312();
    if (py312) return { id: 'python', name: '자막 엔진 (Python)', status: 'warn', value: '설치 안 됨',
      hint: 'Python 3.12 찾음: ' + py312 + '. [엔진 설치]를 누르면 PyTorch와 음성 인식 라이브러리를 설치합니다 (약 3GB, 10분 이상).', actions: ['install-engine'] };
    return { id: 'python', name: '자막 엔진 (Python)', status: 'warn', value: '설치 안 됨 · Python 3.12 없음',
      hint: '[엔진 설치]를 누르면 Python 3.12' + (tools.IS_WIN ? '(python.org 공식 설치 파일)' : '') + '와 엔진을 함께 설치합니다 (약 3GB, 10분 이상). 직접 설치하려면 [다운로드 페이지].',
      actions: ['install-engine', 'open:python'] };
  }
  const code = 'import json,sys\ntry:\n import torch\n c=torch.cuda.is_available()\n print(json.dumps({"py":sys.version.split()[0],"torch":torch.__version__,"cuda":c,"gpu":torch.cuda.get_device_name(0) if c else None}))\nexcept Exception as e:\n print(json.dumps({"py":sys.version.split()[0],"err":str(e)}))';
  const r = await run(tools.python, ['-c', code], { env: pyEnv(), timeout: 60000 });
  let info = null;
  try { info = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()); } catch (e) { /* */ }
  if (!info) return { id: 'python', name: '자막 엔진 (Python)', status: 'warn', value: '실행 실패',
    hint: '엔진 가상환경이 깨졌습니다. [엔진 다시 설치]를 누르세요. ' + (r.stderr || '').slice(-200), actions: ['reinstall-engine'] };
  if (info.err) return { id: 'python', name: '자막 엔진 (Python)', status: 'warn', value: 'Python ' + info.py + ', torch 없음',
    hint: '[엔진 다시 설치]를 누르세요. (' + info.err.slice(0, 120) + ')', actions: ['reinstall-engine'] };
  let gpu = info.gpu;
  if (!info.cuda) {
    const smi = tools.IS_WIN ? await run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { timeout: 10000 }) : { ok: false, stdout: '' };
    if (smi.ok && smi.stdout.trim()) gpu = smi.stdout.trim().split(/\r?\n/)[0] + ' (torch에서 CUDA 사용 불가)';
  }
  return {
    id: 'python', name: '자막 엔진 (Python)', status: info.cuda ? 'ok' : 'warn',
    value: 'Python ' + info.py + ' · torch ' + info.torch + ' · ' + (info.cuda ? 'GPU: ' + gpu : 'CPU 모드'),
    hint: info.cuda ? '' : (gpu ? gpu + '. [엔진 다시 설치]를 누르면 CUDA용 torch를 설치합니다.' : (tools.IS_WIN ? 'NVIDIA GPU가 없어' : 'Mac은') + ' CPU로 변환합니다 (medium 모델, 느림: 30분 설교에 약 10~30분).'),
    actions: !info.cuda && gpu ? ['reinstall-engine'] : [],
  };
}

function checkModel() {
  const dir = tools.models;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { /* */ }
  const has = (n) => names.some(f => f.includes('faster-whisper-' + n));
  if (has('large-v3')) return { id: 'model', name: 'Whisper 모델', status: 'ok', value: 'large-v3 받음' };
  if (has('medium')) return { id: 'model', name: 'Whisper 모델', status: 'ok', value: 'medium 받음 (CPU용)' };
  return { id: 'model', name: 'Whisper 모델', status: 'warn', value: '아직 안 받음',
    hint: '첫 자막 생성 때 자동으로 내려받습니다. [지금 받기]로 미리 받아 둘 수 있습니다 (' + (tools.IS_WIN ? 'GPU: large-v3 약 3GB, CPU: ' : '') + 'medium 약 1.5GB).',
    actions: fs.existsSync(tools.python) ? ['download-model'] : [] };
}

function checkAiKey(settingsApi) {
  const fromSettings = !!(settingsApi && settingsApi.getGeminiApiKey && settingsApi.getGeminiApiKey());
  const fromEnv = !!process.env.GEMINI_API_KEY;
  const model = (settingsApi && settingsApi.loadSettings && settingsApi.loadSettings().template.aiModel) || ai.DEFAULT_MODEL;
  if (!fromSettings && !fromEnv) return { id: 'ai', name: 'Gemini API 키', status: 'warn', value: '없음',
    hint: 'AI 추천을 쓰려면 https://aistudio.google.com/apikey 에서 키를 만들어 [설정 → AI]에 넣으세요.', actions: ['open:gemini', 'open-settings'] };
  return { id: 'ai', name: 'Gemini API 키', status: 'ok', value: (fromSettings ? '설정에 저장됨' : '환경변수 GEMINI_API_KEY') + ' · 모델 ' + model,
    hint: '[연결 확인]으로 실제 호출을 시험합니다.', actions: ['test-ai'], model };
}

function checkDisk() {
  try {
    const st = fs.statfsSync(tools.cache);
    const free = st.bavail * st.bsize;
    const drive = path.parse(tools.cache).root;
    const gb = free / 1024 ** 3;
    return { id: 'disk', name: '디스크 여유 공간', status: gb >= 10 ? 'ok' : (gb >= 3 ? 'warn' : 'error'), value: drive + ' ' + fmtBytes(free) + ' 남음',
      hint: gb >= 10 ? '' : '영상 1편 다운로드에 약 1~2GB가 필요합니다. 캐시를 정리하거나 공간을 비우세요.' };
  } catch (e) {
    return { id: 'disk', name: '디스크 여유 공간', status: 'warn', value: '확인 실패', hint: e.message };
  }
}

function checkCache() {
  const size = clearableCacheDirs().reduce((s, d) => s + dirSize(d), 0);
  return { id: 'cache', name: '캐시 (다운로드·자막)', status: 'ok', value: fmtBytes(size), hint: tools.cache, actions: size > 0 ? ['clear-cache'] : [] };
}

/** opts.quick: 시작할 때 쓰는 빠른 점검 (Python 실행 생략) */
async function checkSystem(settingsApi, opts = {}) {
  const rows = await Promise.all([
    checkFfmpeg(),
    checkYtdlp(),
    Promise.resolve(checkJsRuntime()),
    opts.quick ? Promise.resolve(fs.existsSync(tools.python)
      ? { id: 'python', name: '자막 엔진 (Python)', status: 'ok', value: '설치됨' }
      : { id: 'python', name: '자막 엔진 (Python)', status: 'warn', value: '설치 안 됨' }) : checkPython(),
    Promise.resolve(checkModel()),
    Promise.resolve(checkAiKey(settingsApi)),
    Promise.resolve(checkDisk()),
    Promise.resolve(opts.quick ? { id: 'cache', name: '캐시', status: 'ok', value: '' } : checkCache()),
  ]);
  return { rows, critical: rows.some(r => r.critical && r.status === 'error'), root: tools.root };
}

/** 빠진 필수 도구(ffmpeg·yt-dlp)를 조용히 설치한다. 시작할 때 부른다. 엔진(3GB)은 묻고 설치하므로 여기서 하지 않는다 */
let autoRunning = null;
function autoInstallMissing(log = () => {}) {
  if (!autoRunning) autoRunning = autoInstallOnce(log).finally(() => { autoRunning = null; });
  return autoRunning;
}
async function autoInstallOnce(log) {
  const done = [];
  if (tools.IS_WIN && !(await run(tools.ffmpeg, ['-hide_banner', '-version'])).ok) {
    log('ffmpeg 없음 → 자동 설치');
    const r = await setup.installFfmpeg(() => {});
    log(r.message);
    if (r.ok) done.push('ffmpeg');
  }
  return done;
}

async function updateYtdlp() {
  try {
    const r = await require('./ytdlp-manager').ensure({ force: true, minGap: 0 });
    return { ok: true, message: r.updated ? `최신으로 바꿨습니다: ${r.before || '없음'} → ${r.version}` : `이미 최신입니다: ${r.version}` };
  } catch (e) {
    return { ok: false, message: 'yt-dlp 업데이트 실패: ' + e.message };
  }
}

/** 실제로 유튜브 정보를 가져와 JS 런타임이 쓰이는지 확인 */
async function testYoutube(url = TEST_URL) {
  const rt = youtube.getJsRuntime();
  const args = ['-J', '--no-playlist', '--skip-download'];
  if (rt.path) args.push('--js-runtimes', rt.kind + ':' + rt.path);
  args.push('--', url);
  const t0 = Date.now();
  const r = await run(tools.ytdlp, args, { env: rt.env, timeout: 90000 });
  const ms = Date.now() - t0;
  const noRuntime = /No supported JavaScript runtime/i.test(r.stderr);
  if (!r.ok) return { ok: false, message: '유튜브 확인 실패: ' + (r.stderr.trim().split(/\r?\n/).pop() || r.code) };
  let title = '';
  try { title = JSON.parse(r.stdout).title; } catch (e) { /* */ }
  if (noRuntime) return { ok: false, message: '영상 정보는 받았지만 JS 런타임이 인식되지 않았습니다 (' + rt.label + ')' };
  return { ok: true, message: '유튜브 확인 성공 (' + ms + 'ms): ' + title };
}

function clearCache() {
  const dirs = clearableCacheDirs();
  let freed = 0;
  for (const d of dirs) {
    freed += dirSize(d);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 사용 중이면 건너뜀 */ }
  }
  return { ok: true, removed: dirs.length, freed, message: fmtBytes(freed) + ' 정리됨' };
}

module.exports = { checkSystem, updateYtdlp, testYoutube, clearCache, autoInstallMissing };
