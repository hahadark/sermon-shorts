'use strict';
const { app, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const themeLib = require('../shared/theme');

function getBuiltinDir() {
  return path.join(app.getAppPath(), 'assets', 'themes');
}

function getUserDir() {
  return path.join(app.getPath('userData'), 'themes');
}

function getFontsDir() {
  return path.join(app.getPath('userData'), 'fonts');
}

function listThemes() {
  const builtinDir = getBuiltinDir();
  let builtin = [];
  if (fs.existsSync(builtinDir)) {
    builtin = fs.readdirSync(builtinDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const t = JSON.parse(fs.readFileSync(path.join(builtinDir, f), 'utf8'));
          return themeLib.normalizeTheme(t);
        } catch (e) { return null; }
      }).filter(Boolean);
  }

  const userDir = getUserDir();
  let user = [];
  if (fs.existsSync(userDir)) {
    user = fs.readdirSync(userDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const t = JSON.parse(fs.readFileSync(path.join(userDir, f), 'utf8'));
          return themeLib.normalizeTheme(t);
        } catch (e) { return null; }
      }).filter(Boolean);
  }
  
  const map = new Map();
  builtin.forEach(t => map.set(t.id, t));
  user.forEach(t => map.set(t.id, t));
  return Array.from(map.values());
}

function getTheme(id) {
  const all = listThemes();
  return all.find(t => t.id === id) || null;
}

// 테마 id를 파일 이름으로 쓰므로 폴더를 벗어나는 id(../ 등)는 받지 않는다
function themeFile(id) {
  const name = String(id || '');
  if (!name || name !== path.basename(name) || name.startsWith('.')) throw new Error('테마 id가 올바르지 않습니다: ' + name);
  return path.join(getUserDir(), name + '.json');
}

function saveTheme(json) {
  const userDir = getUserDir();
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  const theme = themeLib.normalizeTheme(json);
  if (!theme.id) theme.id = 'user-' + Date.now();
  fs.writeFileSync(themeFile(theme.id), JSON.stringify(theme, null, 2), 'utf8');
  return theme;
}

function deleteTheme(id) {
  const p = themeFile(id);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    return true;
  }
  return false;
}

async function exportTheme(json) {
  const win = require('electron').BrowserWindow.getFocusedWindow();
  const r = await dialog.showSaveDialog(win, {
    title: '테마 내보내기',
    defaultPath: `theme_${json.id || 'export'}.json`,
    filters: [{ name: 'JSON 파일', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, JSON.stringify(json, null, 2), 'utf8');
  return true;
}

async function importTheme() {
  const win = require('electron').BrowserWindow.getFocusedWindow();
  const r = await dialog.showOpenDialog(win, {
    title: '테마 가져오기',
    filters: [{ name: 'JSON 파일', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  try {
    const json = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    return themeLib.normalizeTheme(json);
  } catch (e) {
    console.error('Theme import failed', e);
    return null;
  }
}

async function addFont() {
  const win = require('electron').BrowserWindow.getFocusedWindow();
  const r = await dialog.showOpenDialog(win, {
    title: '글꼴 추가',
    filters: [{ name: '글꼴 파일', extensions: ['ttf', 'otf'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  
  const src = r.filePaths[0];
  const name = path.basename(src);
  const destDir = getFontsDir();
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, name);
  fs.copyFileSync(src, dest);
  
  // Use filename without extension as family name for now
  const family = path.basename(name, path.extname(name));
  return { family, file: name };
}

const KNOWN_FONTS = {
  'YeonSung-Regular_fixed.ttf': 'Yeon Sung',
  'YeonSung-Regular.ttf': 'Yeon Sung',
  'NotoSansKR-Variable.ttf': 'Noto Sans KR',
  'BlackHanSans-Regular.ttf': 'Black Han Sans',
  'DoHyeon-Regular.ttf': 'Do Hyeon',
  'NanumPenScript-Regular.ttf': 'Nanum Pen Script'
};

function listFonts() {
  const builtinDir = path.join(app.getAppPath(), 'assets', 'fonts');
  const builtin = fs.existsSync(builtinDir) ? fs.readdirSync(builtinDir).filter(f => /\.(ttf|otf)$/i.test(f)) : [];
  
  const userDir = getFontsDir();
  const user = fs.existsSync(userDir) ? fs.readdirSync(userDir).filter(f => /\.(ttf|otf)$/i.test(f)) : [];
  
  const fonts = [];
  builtin.forEach(f => {
    const name = KNOWN_FONTS[f] || path.basename(f, path.extname(f));
    fonts.push({ family: name, file: f, builtin: true });
  });
  user.forEach(f => {
    const name = KNOWN_FONTS[f] || path.basename(f, path.extname(f));
    fonts.push({ family: name, file: f, builtin: false });
  });
  return fonts;
}

function getFontDataUrl(fontName) {
  const builtinDir = path.join(app.getAppPath(), 'assets', 'fonts');
  const userDir = getFontsDir();
  // 글꼴 폴더 안의 .ttf/.otf 파일 이름만 받는다
  const name = String(fontName || '');
  if (name !== path.basename(name) || !/\.(ttf|otf)$/i.test(name)) return null;

  let p = path.join(builtinDir, name);
  if (!fs.existsSync(p)) p = path.join(userDir, name);
  if (!fs.existsSync(p)) return null;
  
  const ext = path.extname(p).toLowerCase();
  const mime = ext === '.otf' ? 'font/otf' : 'font/ttf';
  return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');
}

function initThemeIpc() {
  ipcMain.handle('theme:list', () => listThemes());
  ipcMain.handle('theme:get', (_e, id) => getTheme(id));
  ipcMain.handle('theme:save', (_e, json) => saveTheme(json));
  ipcMain.handle('theme:delete', (_e, id) => deleteTheme(id));
  ipcMain.handle('theme:export', (_e, json) => exportTheme(json));
  ipcMain.handle('theme:import', () => importTheme());
  ipcMain.handle('font:add', () => addFont());
  ipcMain.handle('font:list', () => listFonts());
  ipcMain.handle('font:dataUrl', (_e, fontName) => getFontDataUrl(fontName));
}

module.exports = { initThemeIpc, listThemes, getTheme, saveTheme };
