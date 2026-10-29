'use strict';
// 사용자 설정: userData/settings.json. API 키는 safeStorage로 암호화해 저장하고 렌더러에는 절대 보내지 않는다.
const { app, ipcMain, safeStorage, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const tools = require('./tools');

const themeLib = require('../shared/theme');

const DEFAULT_CHURCH = '우리 교회';
const DEFAULT_LOGO = 'assets/images/logo-default.png'; // 앱 폴더 기준 상대경로
const DEFAULT_SPEAKERS = []; // 처음에는 비워 둔다. 사용자가 [설정 → 교회 정보]에서 넣는다

let settingsCache = null;

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function logosDir() {
  return path.join(app.getPath('userData'), 'logos');
}
function userThemesDir() {
  return path.join(app.getPath('userData'), 'themes');
}

function defaults() {
  return {
    activeThemeId: '', 
    template: {
      titleY: 205,
      verseY: 280,
      videoY: 353,
      videoH: 958,
      subtitleY: 1390,
      footerY: 1620,
      fontTitleVerse: 'Yeon Sung',
      fontSubtitleFooter: 'Noto Sans KR',
      colorTitleVerse: '#39FF5A',
      colorSubtitle: '#ffffff',
      fadeMs: 10,
      churchName: DEFAULT_CHURCH,
      logoPath: DEFAULT_LOGO,
      // 예전 버전 호환: template 안에도 설교자 목록을 같이 둔다 (최상위 speakers가 기준)
      speakers: DEFAULT_SPEAKERS.slice(),
      defaultSpeaker: DEFAULT_SPEAKERS[0],
      aiModel: 'gemini-3.5-flash',
    },
    speakers: DEFAULT_SPEAKERS.slice(),
    defaultSpeaker: DEFAULT_SPEAKERS[0],
    lastExportDir: '',
    sysCheckSeen: false,
    churchTerms: '', // 자주 나오는 교회 용어 (쉼표로 구분). 음성 인식·AI 에 알려 준다
    geminiApiKeyEnc: '',
    openrouterApiKeyEnc: '',
    openrouterModel: '',
    // 유튜브 업로드 (토큰·비밀번호는 암호화, 렌더러로 보내지 않음)
    ytClientId: '',
    ytClientSecretEnc: '',
    ytRefreshEnc: '',
    ytChannel: '',
    ytPrivacy: 'unlisted',
    ytAutoUpload: false,
  };
}

function normalize(s) {
  const d = defaults();
  const out = { ...d, ...s, template: { ...d.template, ...(s.template || {}) } };
  
  // 테마 마이그레이션
  if (!out.activeThemeId) {
    const hasLegacy = s.template && (s.template.titleY || s.template.fontTitleVerse || s.template.colorTitleVerse);
    if (hasLegacy) {
      // 레거시 설정에서 'daegu-sarang' 테마 생성 (사용자 테마)
      const theme = themeLib.themeFromLegacyTemplate(out.template);
      theme.id = 'daegu-sarang';
      theme.userPreset = true;
      const dir = userThemesDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'daegu-sarang.json'), JSON.stringify(theme, null, 2), 'utf8');
      out.activeThemeId = 'daegu-sarang';
    } else {
      // 신규 설치
      out.activeThemeId = 'basic-blank';
    }
  }

  // 설교자: 최상위가 없으면 예전 template.speakers 에서 가져온다
  if (!Array.isArray(s.speakers)) out.speakers = Array.isArray(out.template.speakers) ? out.template.speakers.slice() : d.speakers;
  if (typeof s.defaultSpeaker !== 'string') out.defaultSpeaker = out.template.defaultSpeaker || out.speakers[0] || '';
  out.speakers = out.speakers.map(x => String(x).trim()).filter(Boolean);
  if (out.defaultSpeaker && !out.speakers.includes(out.defaultSpeaker)) out.defaultSpeaker = out.speakers[0] || '';
  out.template.speakers = out.speakers.slice();
  out.template.defaultSpeaker = out.defaultSpeaker;
  if (!out.template.churchName) out.template.churchName = DEFAULT_CHURCH;
  if (!out.template.logoPath) out.template.logoPath = DEFAULT_LOGO;
  return out;
}

function loadSettings() {
  if (settingsCache) return settingsCache;
  let data = {};
  const p = getSettingsPath();
  if (fs.existsSync(p)) {
    try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { data = {}; }
  }
  settingsCache = normalize(data);
  return settingsCache;
}

function broadcast(pub) {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('settings:changed', pub); } catch (e) { /* 창 닫힘 */ }
  }
}

function saveSettings(newSettings = {}) {
  const cur = loadSettings();
  const incoming = { ...newSettings };
  const key = incoming.geminiApiKey;
  const orKey = incoming.openrouterApiKey;
  delete incoming.geminiApiKey;
  delete incoming.openrouterApiKey;
  delete incoming.geminiApiKeyEnc; // 렌더러가 암호문을 덮어쓰지 못하게
  delete incoming.openrouterApiKeyEnc;
  delete incoming.hasApiKey;
  delete incoming.apiKeySuffix;

  const merged = { ...cur, ...incoming, template: { ...cur.template, ...(incoming.template || {}) } };
  // template 안의 설교자만 바뀐 경우(예전 UI)도 반영
  if (!incoming.speakers && incoming.template && Array.isArray(incoming.template.speakers)) merged.speakers = incoming.template.speakers;
  if (incoming.defaultSpeaker === undefined && incoming.template && typeof incoming.template.defaultSpeaker === 'string') merged.defaultSpeaker = incoming.template.defaultSpeaker;

  if (typeof key === 'string' && key.trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('이 PC에서는 키 암호화를 쓸 수 없습니다. 환경변수 GEMINI_API_KEY를 사용하세요.');
    merged.geminiApiKeyEnc = safeStorage.encryptString(key.trim()).toString('base64');
  } else if (key === '') {
    merged.geminiApiKeyEnc = '';
  }
  if (typeof orKey === 'string' && orKey.trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('이 PC에서는 키 암호화를 쓸 수 없습니다.');
    merged.openrouterApiKeyEnc = safeStorage.encryptString(orKey.trim()).toString('base64');
  } else if (orKey === '') {
    merged.openrouterApiKeyEnc = '';
  }

  settingsCache = normalize(merged);
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settingsCache, null, 2), 'utf8');
  const pub = getPublicSettings();
  broadcast(pub);
  return pub;
}

function decryptField(field) {
  const s = loadSettings();
  if (s[field] && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(s[field], 'base64'));
    } catch (e) {
      return '';
    }
  }
  return '';
}
function getGeminiApiKey() { return decryptField('geminiApiKeyEnc'); }
function getOpenrouterApiKey() { return decryptField('openrouterApiKeyEnc') || process.env.OPENROUTER_API_KEY || ''; }

function getPublicSettings() {
  const s = loadSettings();
  const pub = JSON.parse(JSON.stringify(s));
  delete pub.geminiApiKeyEnc;
  delete pub.openrouterApiKeyEnc;
  delete pub.ytClientSecretEnc;
  delete pub.ytRefreshEnc;
  const orKey = getOpenrouterApiKey();
  pub.hasOpenrouterKey = !!orKey;
  pub.openrouterKeySuffix = orKey ? orKey.slice(-4) : '';
  const key = s.geminiApiKeyEnc ? getGeminiApiKey() : '';
  pub.hasApiKey = !!key;
  pub.apiKeySuffix = key ? key.slice(-4) : '';
  pub.hasEnvApiKey = !!process.env.GEMINI_API_KEY;
  pub.logosDir = logosDir();
  return pub;
}

// ---- 로고 ----
/** 저장된 logoPath(앱 폴더 상대경로 또는 userData/logos 의 절대경로)를 실제 파일 경로로 */
function resolveLogoPath(p) {
  if (!p) p = DEFAULT_LOGO;
  const abs = path.isAbsolute(p) ? path.normalize(p) : path.join(tools.root, p);
  // 앱 폴더나 userData/logos 밖의 파일은 읽지 않는다
  const allowed = [path.join(tools.root, 'assets'), logosDir()].map(d => path.normalize(d).toLowerCase() + path.sep);
  if (!allowed.some(d => abs.toLowerCase().startsWith(d))) return null;
  return fs.existsSync(abs) ? abs : null;
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

/** 렌더러용 data: URL. 파일이 없으면 기본 로고. */
function getLogoDataUrl(p) {
  let abs = resolveLogoPath(p);
  if (!abs) abs = resolveLogoPath(DEFAULT_LOGO);
  if (!abs) return null;
  const mime = MIME[path.extname(abs).toLowerCase()] || 'image/png';
  return 'data:' + mime + ';base64,' + fs.readFileSync(abs).toString('base64');
}

/** 파일 선택 → userData/logos 로 복사 → { path, dataUrl } (취소하면 null) */
async function chooseLogo(win) {
  const r = await dialog.showOpenDialog(win, {
    title: '교회 로고 이미지 선택',
    properties: ['openFile'],
    filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const src = r.filePaths[0];
  fs.mkdirSync(logosDir(), { recursive: true });
  const ext = path.extname(src).toLowerCase() || '.png';
  const dest = path.join(logosDir(), 'logo_' + Date.now() + ext);
  fs.copyFileSync(src, dest);
  return { path: dest, dataUrl: getLogoDataUrl(dest) };
}

function initSettings() {
  ipcMain.handle('get-settings', () => getPublicSettings());
  ipcMain.handle('save-settings', (_e, s) => {
    // 유튜브 로그인 정보는 youtube-upload.js 만 바꾼다 (렌더러가 덮어쓰지 못하게)
    const incoming = { ...(s || {}) };
    for (const k of ['ytClientId', 'ytClientSecretEnc', 'ytRefreshEnc', 'ytChannel']) delete incoming[k];
    return saveSettings(incoming);
  });
  ipcMain.handle('settings:logoDataUrl', (_e, p) => getLogoDataUrl(p));
  ipcMain.handle('settings:chooseLogo', (e) => chooseLogo(BrowserWindow.fromWebContents(e.sender)));
}

module.exports = { initSettings, loadSettings, saveSettings, getGeminiApiKey, getOpenrouterApiKey, getPublicSettings, getLogoDataUrl, DEFAULT_LOGO };
