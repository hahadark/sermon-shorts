'use strict';
// 클로드: 사용자 PC에 설치된 공식 Claude Code(수정하지 않은 claude 실행 파일)를 불러 쓴다.
// 로그인은 Claude Code 의 공식 화면에서만 한다. 이 앱은 클로드 계정 정보나 토큰을 받거나 저장하지 않는다.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INSTALL = {
  win32: 'irm https://claude.ai/install.ps1 | iex',
  other: 'curl -fsSL https://claude.ai/install.sh | bash',
};

function candidates() {
  const home = os.homedir();
  const list = [];
  if (process.platform === 'win32') {
    list.push(path.join(home, '.local', 'bin', 'claude.exe'));
    if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'claude.exe'));
    if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, 'npm', 'claude.cmd'));
  } else {
    list.push(path.join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(home, '.npm-global', 'bin', 'claude'));
  }
  const exe = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) for (const e of exe) if (dir) list.push(path.join(dir, e));
  return list;
}

function findClaude() {
  for (const p of candidates()) { try { if (fs.statSync(p).isFile()) return p; } catch (_) {} }
  return null;
}

function run(bin, args, { input, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const shell = /\.cmd$/i.test(bin); // npm 설치본(claude.cmd)은 셸로 실행해야 한다
    const proc = spawn(bin, args, { windowsHide: true, shell, env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('클로드 응답 시간이 너무 깁니다. 잠시 뒤 다시 해 주세요.')); }, timeout);
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    if (input != null) { proc.stdin.write(input); }
    proc.stdin.end();
  });
}

/** { installed, loggedIn, method, version, path } */
async function status() {
  const bin = findClaude();
  if (!bin) return { installed: false, loggedIn: false };
  let version = '';
  try { version = (await run(bin, ['--version'], { timeout: 15000 })).out.trim(); } catch (_) {}
  let info = {};
  try {
    const r = await run(bin, ['auth', 'status'], { timeout: 20000 });
    info = JSON.parse(r.out.trim() || '{}');
  } catch (_) {}
  const method = info.authMethod || 'none';
  return { installed: true, loggedIn: !!info.loggedIn && method !== 'none', method, version, path: bin };
}

/** 공식 설치 명령을 새 터미널 창에서 실행 (사용자가 창에서 진행 상황을 본다) */
function openInstall() {
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '"Claude Code 설치"', 'powershell.exe', '-NoExit', '-NoProfile', '-Command',
      `Write-Host 'Claude Code 공식 설치를 시작합니다...'; ${INSTALL.win32}; Write-Host ''; Write-Host '설치가 끝났습니다. 이 창을 닫고 설교쇼츠편집기에서 [다시 확인]을 누르세요.'`],
    { detached: true, windowsHide: false, shell: false }).unref();
  } else if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script "${INSTALL.other}; echo; echo 설치가 끝났습니다. 설교쇼츠편집기에서 [다시 확인]을 누르세요."`;
    execFile('osascript', ['-e', script, '-e', 'tell application "Terminal" to activate']);
  } else {
    throw new Error('이 운영체제에서는 터미널에서 직접 설치해 주세요: ' + INSTALL.other);
  }
  return true;
}

/** 공식 로그인(claude auth login)을 새 터미널 창에서 실행 */
function openLogin() {
  const bin = findClaude();
  if (!bin) throw new Error('Claude Code 가 설치되어 있지 않습니다. 먼저 설치해 주세요.');
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '"Claude 로그인"', 'cmd.exe', '/k', `"${bin}" auth login && echo. && echo 로그인이 끝났습니다. 이 창을 닫고 설교쇼츠편집기에서 [다시 확인]을 누르세요.`],
      { detached: true, windowsHide: false, windowsVerbatimArguments: true }).unref();
  } else if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script "'${bin.replace(/'/g, "'\\''")}' auth login"`;
    execFile('osascript', ['-e', script, '-e', 'tell application "Terminal" to activate']);
  } else {
    throw new Error('터미널에서 다음을 실행해 로그인해 주세요: claude auth login');
  }
  return true;
}

/**
 * 한 번 묻고 답 받기. 도구(파일·명령 실행)는 모두 끈다.
 * messages: [{role:'user'|'assistant', content}] → 하나의 대화 글로 합쳐 표준 입력으로 보낸다.
 */
async function complete(opts) {
  try { return await completeOnce(opts); }
  catch (e) {
    if (e.code === 'not_installed' || e.code === 'auth' || e.code === 'usage_limit') throw e;
    return completeOnce(opts); // 일시적인 오류(서버 혼잡 등)는 한 번 더 시도
  }
}

async function completeOnce({ system, messages, model }) {
  const bin = findClaude();
  if (!bin) throw Object.assign(new Error('Claude Code 가 설치되어 있지 않습니다. [AI 연결]에서 설치해 주세요.'), { code: 'not_installed' });
  const tmp = path.join(os.tmpdir(), `ss-claude-system-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(tmp, system || '', 'utf8');
  const convo = (messages || []).map((m) => (m.role === 'assistant' ? '[편집자(이전 답)]\n' : '[사용자]\n') + m.content).join('\n\n');
  const args = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--system-prompt-file', tmp];
  if (model) args.push('--model', model);
  try {
    const r = await run(bin, args, { input: convo, timeout: 6 * 60 * 1000 });
    let data = null;
    try { data = JSON.parse(r.out.trim()); } catch (_) {}
    if (!data) {
      const msg = (r.err || r.out || '').trim();
      if (/login|log in|auth|인증|로그인/i.test(msg)) throw Object.assign(new Error('클로드에 로그인되어 있지 않습니다. [AI 연결]에서 로그인해 주세요.'), { code: 'auth' });
      throw new Error('클로드 실행 실패: ' + msg.slice(0, 300));
    }
    if (data.is_error || (data.subtype && data.subtype !== 'success')) {
      const msg = String(data.result || data.error || (Array.isArray(data.errors) ? data.errors.join(' ') : '') || data.subtype || '알 수 없는 오류');
      if (/limit|한도|usage/i.test(msg)) throw Object.assign(new Error('클로드 사용 한도에 도달했습니다. 잠시 뒤 다시 하거나 다른 AI 로 바꿔 주세요.'), { code: 'usage_limit' });
      if (/login|auth|credential/i.test(msg)) throw Object.assign(new Error('클로드에 로그인되어 있지 않습니다. [AI 연결]에서 로그인해 주세요.'), { code: 'auth' });
      throw new Error('클로드 오류: ' + msg.slice(0, 300));
    }
    return { text: String(data.result || '') };
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

module.exports = { status, openInstall, openLogin, complete, findClaude, INSTALL };
