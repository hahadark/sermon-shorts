'use strict';
// 요약/QT 텍스트를 OS 내장 TTS(무료)로 WAV 저장하는 독립 엔진. export만 하며 IPC는 등록하지 않는다.
// Windows: System.Speech(materials-speech.ps1), macOS: say + ffmpeg. 한국어 음성이 없으면 영어로 대체하지 않고 오류.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const MAX_CHARS = 20000;
const TIMEOUT_MS = 120000;
const PS1 = path.join(__dirname, 'materials-speech.ps1');
const PREFERRED = ['heami'];
let busy = false;

function getTools() { return require('./tools'); }

function run(file, args, timeout = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(err.killed ? '음성 합성 시간이 초과되었습니다.' : `음성 합성 실행 실패: ${String(stderr || err.message).trim().slice(0, 300)}`);
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
  });
}

function isKorean(lang) { return /^ko([-_]|$)/i.test(String(lang || '')); }

/** `say -v ?` 출력 파싱: "Yuna                ko_KR    # 안녕하세요" */
function parseSayList(out) {
  const res = [];
  for (const line of String(out).split(/\r?\n/)) {
    const m = line.replace(/\s+#.*$/, '').match(/^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]{2,4})\s*$/);
    if (m) res.push({ id: m[1].trim(), name: m[1].trim(), lang: m[2].replace('_', '-') });
  }
  return res;
}

/** 탭 구분 "이름\tko-KR" 파싱 (PowerShell 출력) */
function parseWinList(out) {
  return String(out).split(/\r?\n/).map(l => l.split('\t')).filter(p => p.length >= 2 && p[0].trim())
    .map(p => ({ id: p[0].trim(), name: p[0].trim(), lang: p[1].trim() }));
}

/** 한국어 음성 우선 선택. 지정 음성이 있으면 그것만(없으면 오류), 없으면 Heami 우선 */
function pickVoice(voices, requested) {
  const ko = voices.filter(v => isKorean(v.lang));
  if (requested) {
    const v = voices.find(x => x.id === requested || x.name === requested);
    if (!v) throw new Error(`요청한 음성 "${requested}" 을(를) 찾을 수 없습니다. 설치된 한국어 음성: ${ko.map(x => x.name).join(', ') || '없음'}`);
    if (!isKorean(v.lang)) throw new Error(`"${requested}" 은(는) 한국어 음성이 아닙니다. 한국어 음성만 사용할 수 있습니다.`);
    return v;
  }
  if (!ko.length) throw new Error('설치된 한국어 음성이 없습니다. Windows는 설정 > 시간 및 언어 > 음성에서 한국어(Heami) 음성을, macOS는 시스템 설정 > 손쉬운 사용 > 말하기 콘텐츠에서 한국어(Yuna) 음성을 설치하세요. 영어 음성으로 대체하지 않습니다.');
  return ko.find(v => PREFERRED.some(p => v.name.toLowerCase().includes(p))) || ko[0];
}

function validateText(text) {
  if (typeof text !== 'string') throw new Error('읽을 텍스트가 없습니다.');
  const t = text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  if (!t) throw new Error('읽을 텍스트가 비어 있습니다.');
  if (t.length > MAX_CHARS) throw new Error(`텍스트가 너무 깁니다 (${t.length}자, 최대 ${MAX_CHARS}자).`);
  return t;
}

function validateRate(rate) {
  if (rate === undefined || rate === null || rate === '') return 0;
  const n = Number(rate);
  if (!Number.isFinite(n)) throw new Error('rate 는 -10~10 사이의 숫자여야 합니다.');
  return Math.max(-10, Math.min(10, Math.round(n)));
}

function tmpName(ext) {
  return path.join(os.tmpdir(), `materials-speech-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
}
function rmQuiet(...files) { for (const f of files) { try { if (f) fs.rmSync(f, { force: true }); } catch (_) { /* 무시 */ } } }

const backend = {
  async listWin() {
    const out = tmpName('.txt');
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Mode', 'list', '-OutFile', out], 30000);
      return parseWinList(fs.readFileSync(out, 'utf8'));
    } finally { rmQuiet(out); }
  },
  async listMac() {
    const { stdout } = await run('say', ['-v', '?'], 30000);
    return parseSayList(stdout);
  },
  async synthWin(text, voice, rate, outPath) {
    const txt = tmpName('.txt');
    try {
      fs.writeFileSync(txt, text, 'utf8');
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1,
        '-Mode', 'synth', '-TextFile', txt, '-OutFile', outPath, '-Voice', voice, '-Rate', String(rate)]);
    } finally { rmQuiet(txt); }
  },
  async synthMac(text, voice, rate, outPath) {
    const txt = tmpName('.txt'), aiff = tmpName('.aiff');
    try {
      fs.writeFileSync(txt, text.replace(/\[\[/g, '[ ['), 'utf8');
      await run('say', ['-v', voice, '-r', String(175 + rate * 15), '-o', aiff, '-f', txt]);
      await run(getTools().ffmpeg, ['-y', '-v', 'error', '-i', aiff, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outPath]);
    } finally { rmQuiet(txt, aiff); }
  },
};

async function listVoices() {
  if (process.platform === 'win32') return backend.listWin();
  if (process.platform === 'darwin') return backend.listMac();
  throw new Error('이 운영체제는 지원하지 않습니다 (Windows, macOS만 가능).');
}

async function synthesize({ text, voice, rate } = {}) {
  const clean = validateText(text);
  const r = validateRate(rate);
  if (busy) throw new Error('이미 음성 합성이 진행 중입니다. 끝난 뒤 다시 시도하세요.');
  busy = true;
  const outPath = tmpName('.wav');
  try {
    const picked = pickVoice(await listVoices(), voice);
    if (process.platform === 'win32') await backend.synthWin(clean, picked.id, r, outPath);
    else await backend.synthMac(clean, picked.id, r, outPath);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 100) throw new Error('WAV 파일이 생성되지 않았습니다.');
    return { path: outPath, format: 'wav' };
  } catch (e) {
    rmQuiet(outPath);
    throw e;
  } finally { busy = false; }
}

module.exports = { listVoices, synthesize, MAX_CHARS, _internal: { parseSayList, parseWinList, pickVoice, validateText, validateRate, backend, isBusy: () => busy } };
