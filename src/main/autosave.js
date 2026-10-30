// 자동 저장: 편집기가 갑자기 꺼져도 지난 작업을 다시 열 수 있게 한다.
// 위치: <userData>/autosave/<영상키>/
//   current.sshorts   마지막 상태 (편집이 멈추고 몇 초 뒤마다 덮어씀, 임시 파일에 쓰고 바꿔 넣어 깨지지 않게)
//   v-YYYYMMDD-HHMMSS.sshorts  과거 작업본 (2분에 하나, 영상마다 최근 30개)
//   meta.json         제목·원본 영상·프로젝트 파일·작업본 목록(시각·요약)
// <userData>/autosave/sessions/<pid>.json : 실행 중 표시. 정상 종료면 지우고, 남아 있는데 그 프로세스가 없으면 '갑자기 꺼짐'.
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_VERSIONS = 30;          // 영상마다 남길 과거 작업본
const VERSION_EVERY_MS = 2 * 60 * 1000;
const MAX_KEYS = 40;              // 영상 몇 개까지
const KEEP_DAYS = 60;

let root = '';
let crashed = null;               // 지난번 갑자기 꺼진 실행 { pid, startedAt, keys: [] } (여러 개면 합침)
const mine = { pid: process.pid, startedAt: Date.now(), keys: [] };

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }
function rootDir() { return root || (root = ensureDir(path.join(app.getPath('userData'), 'autosave'))); }
function sessDir() { return ensureDir(path.join(rootDir(), 'sessions')); }
function keyOf(s) { return crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 16); }
function keyDir(key) { if (!/^[0-9a-f]{16}$/.test(String(key))) throw new Error('잘못된 자동 저장 키'); return path.join(rootDir(), key); }
function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return dflt; } }
/** 임시 파일에 다 쓴 뒤 바꿔 넣는다 (쓰는 중에 꺼져도 앞 파일이 남음) */
function writeAtomic(p, text) {
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, p); } catch (_) { fs.copyFileSync(tmp, p); fs.unlinkSync(tmp); }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function stamp(d) { const t = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${t(d.getMonth() + 1)}${t(d.getDate())}-${t(d.getHours())}${t(d.getMinutes())}${t(d.getSeconds())}`; }
function writeSession() { try { writeAtomic(path.join(sessDir(), process.pid + '.json'), JSON.stringify(mine)); } catch (_) { /* */ } }

/** 시작할 때: 남아 있는 다른 실행 표시 중 프로세스가 없는 것 = 갑자기 꺼짐 */
function scanSessions() {
  const found = [];
  for (const f of fs.readdirSync(sessDir())) {
    if (!/^\d+\.json$/.test(f)) continue;
    const p = path.join(sessDir(), f), s = readJson(p, null);
    const pid = Number(f.slice(0, -5));
    if (pid === process.pid) continue;
    if (s && alive(pid) && Date.now() - (s.startedAt || 0) < 7 * 864e5) continue; // 다른 편집기 창이 아직 열려 있음
    if (s && s.keys && s.keys.length) found.push(s);
    try { fs.unlinkSync(p); } catch (_) { /* */ }
  }
  if (!found.length) return null;
  return { pid: found[0].pid, startedAt: Math.min(...found.map((s) => s.startedAt || 0)), keys: [...new Set(found.flatMap((s) => s.keys))] };
}

function entryOf(key) {
  const d = keyDir(key), meta = readJson(path.join(d, 'meta.json'), null);
  if (!meta || !fs.existsSync(path.join(d, 'current.sshorts'))) return null;
  const versions = (meta.versions || []).filter((v) => fs.existsSync(path.join(d, v.file)));
  return {
    key, title: meta.title || '', sourcePath: meta.sourcePath || '', sourceName: meta.sourceName || '', sourceUrl: meta.sourceUrl || '',
    projectPath: meta.projectPath || '', updatedAt: meta.updatedAt || 0, summary: meta.summary || null,
    sourceMissing: !!meta.sourcePath && !fs.existsSync(meta.sourcePath),
    versions: [{ file: 'current.sshorts', at: meta.updatedAt || 0, summary: meta.summary || null, current: true }]
      .concat(versions.slice().reverse().map((v) => ({ file: v.file, at: v.at, summary: v.summary || null }))),
  };
}
function list() {
  const out = [];
  for (const k of fs.readdirSync(rootDir())) {
    if (!/^[0-9a-f]{16}$/.test(k)) continue;
    const e = entryOf(k); if (e) out.push(e);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
/** 오래된 것 정리: 60일 지난 영상, 40개 넘는 영상 */
function prune() {
  try {
    const all = list(), now = Date.now();
    all.forEach((e, i) => { if (i >= MAX_KEYS || now - e.updatedAt > KEEP_DAYS * 864e5) fs.rmSync(keyDir(e.key), { recursive: true, force: true }); });
  } catch (_) { /* */ }
}

/** 저장. p = { sourceKey, title, sourcePath, sourceName, sourceUrl, projectPath, summary, data(문자열) } */
function write(p) {
  if (!p || typeof p.data !== 'string' || !p.data.length) throw new Error('저장할 내용이 없습니다.');
  const key = keyOf(p.sourceKey || p.sourcePath);
  const d = ensureDir(keyDir(key));
  writeAtomic(path.join(d, 'current.sshorts'), p.data);
  const metaPath = path.join(d, 'meta.json'), meta = readJson(metaPath, {}) || {};
  const now = Date.now();
  meta.versions = (meta.versions || []).filter((v) => fs.existsSync(path.join(d, v.file)));
  const last = meta.versions[meta.versions.length - 1];
  let versioned = false;
  const hash = crypto.createHash('sha1').update(p.data).digest('hex').slice(0, 16);
  if ((p.forceVersion || !last || now - last.at >= VERSION_EVERY_MS) && !(last && last.hash === hash)) { // 앞 작업본과 같으면 또 남기지 않음
    let file = 'v-' + stamp(new Date(now)) + '.sshorts', n = 2;
    while (fs.existsSync(path.join(d, file))) file = 'v-' + stamp(new Date(now)) + '-' + (n++) + '.sshorts';
    writeAtomic(path.join(d, file), p.data);
    meta.versions.push({ file, at: now, summary: p.summary || null, hash });
    while (meta.versions.length > MAX_VERSIONS) { const old = meta.versions.shift(); try { fs.unlinkSync(path.join(d, old.file)); } catch (_) { /* */ } }
    versioned = true;
  }
  Object.assign(meta, { key, title: p.title || '', sourcePath: p.sourcePath || '', sourceName: p.sourceName || '', sourceUrl: p.sourceUrl || '', projectPath: p.projectPath || '', summary: p.summary || null, updatedAt: now });
  writeAtomic(metaPath, JSON.stringify(meta, null, 1));
  if (!mine.keys.includes(key)) { mine.keys.push(key); writeSession(); }
  return { key, at: now, versioned };
}
/** 과거 작업본을 열기 전에: 마지막 상태(current)가 작업본에 없으면 하나 남긴다 (되돌리다 최신 편집을 잃지 않게) */
function preserveCurrent(d) {
  const metaPath = path.join(d, 'meta.json'), meta = readJson(metaPath, null), cur = path.join(d, 'current.sshorts');
  if (!meta || !fs.existsSync(cur)) return;
  const last = (meta.versions || [])[meta.versions.length - 1];
  const text = fs.readFileSync(cur, 'utf8');
  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
  // 시각이 아니라 내용으로 비교 (같은 밀리초에 두 번 저장될 수 있음)
  if (last && last.hash === hash) return;
  if (last && !last.hash) { try { if (fs.readFileSync(path.join(d, last.file), 'utf8') === text) return; } catch (_) { /* */ } }
  let file = 'v-' + stamp(new Date(meta.updatedAt || Date.now())) + '.sshorts', n = 2;
  while (fs.existsSync(path.join(d, file))) file = 'v-' + stamp(new Date(meta.updatedAt || Date.now())) + '-' + (n++) + '.sshorts';
  writeAtomic(path.join(d, file), text);
  meta.versions = (meta.versions || []).concat({ file, at: meta.updatedAt || Date.now(), summary: meta.summary || null, hash });
  while (meta.versions.length > MAX_VERSIONS) { const old = meta.versions.shift(); try { fs.unlinkSync(path.join(d, old.file)); } catch (_) { /* */ } }
  writeAtomic(metaPath, JSON.stringify(meta, null, 1));
}
function read(key, file) {
  const d = keyDir(key);
  if (!/^(current|v-[\d-]+)\.sshorts$/.test(String(file))) throw new Error('잘못된 자동 저장 파일');
  if (file !== 'current.sshorts') preserveCurrent(d);
  const data = readJson(path.join(d, file), null);
  if (!data) throw new Error('자동 저장본을 읽지 못했습니다.');
  const meta = readJson(path.join(d, 'meta.json'), {}) || {};
  return { data, projectPath: meta.projectPath || '', title: meta.title || '' };
}
function remove(key) { fs.rmSync(keyDir(key), { recursive: true, force: true }); return true; }

function initAutosave() {
  try { crashed = scanSessions(); } catch (e) { console.warn('[autosave] 실행 표시 확인 실패', e.message); }
  writeSession();
  setTimeout(prune, 10000).unref();
  // 정상 종료: 실행 표시 지우기 (자동 저장본은 남겨 두어 저장하지 않고 닫아도 메뉴에서 다시 열 수 있다)
  app.on('will-quit', () => { try { fs.unlinkSync(path.join(sessDir(), process.pid + '.json')); } catch (_) { /* */ } });
  ipcMain.handle('autosave:write', (_e, p) => write(p));
  ipcMain.handle('autosave:list', () => list());
  ipcMain.handle('autosave:read', (_e, key, file) => read(String(key), String(file)));
  ipcMain.handle('autosave:remove', (_e, key) => remove(String(key)));
  ipcMain.handle('autosave:status', () => {
    const entries = crashed ? crashed.keys.map((k) => { try { return entryOf(k); } catch (_) { return null; } }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt) : [];
    return { crashed: !!(crashed && entries.length), crashedAt: crashed ? crashed.startedAt : 0, entries, dir: rootDir() };
  });
  ipcMain.handle('autosave:openDir', () => require('electron').shell.openPath(rootDir()));
}

module.exports = { initAutosave, keyOf, list, write, read, scanSessions, _setRoot: (d) => { root = d; } };
