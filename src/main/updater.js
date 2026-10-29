'use strict';
// 앱 자동 업데이트 (GitHub 릴리스의 latest.yml 을 읽는다).
//  - 설치판(NSIS): 새 버전을 뒤에서 받아 두고, [지금 다시 시작] 또는 앱을 닫을 때 설치한다.
//  - 압축 해제판(zip): 스스로 바꿀 수 없으니 새 버전이 있다고만 알리고 내려받기 페이지를 연다.
//  - 개발 실행·테스트 캡처·Mac 에서는 하지 않는다. (Mac 베타는 DMG·ZIP으로 수동 교체)
const fs = require('fs');
const path = require('path');
const { app, ipcMain, shell } = require('electron');

const FEED = { provider: 'github', owner: 'hahadark', repo: 'sermon-shorts' };
const RELEASES_URL = 'https://github.com/hahadark/sermon-shorts/releases/latest';
const FIRST_CHECK_DELAY = 15 * 1000;
const CHECK_EVERY = 6 * 3600 * 1000;

let updater = null;
let getWindow = () => null;
let log = () => {};
// 화면에 보낼 상태: idle | checking | latest | available | downloading | ready | portable | error | off
let status = { state: 'off' };

/** 설치 프로그램으로 깔린 것인지 (설치 폴더에 제거 프로그램이 있으면 설치판) */
function isInstalled() {
  return fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`));
}

function setStatus(next) {
  status = { ...next, current: app.getVersion() };
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
}

function check() {
  if (!updater) return Promise.resolve(status);
  return updater.checkForUpdates().then(() => status).catch((e) => {
    log('업데이트 확인 실패:', e.message);
    setStatus({ state: 'error', message: e.message });
    return status;
  });
}

function initUpdater(opts = {}) {
  getWindow = opts.getWindow || getWindow;
  log = opts.log || log;

  ipcMain.handle('update:get', () => status);
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:install', () => {
    if (!updater || status.state !== 'ready') return false;
    // 조용히 설치하고 다시 연다 (설치 폴더는 설치 프로그램이 기억한 곳 그대로)
    setImmediate(() => updater.quitAndInstall(true, true));
    return true;
  });
  ipcMain.handle('update:openPage', () => shell.openExternal(RELEASES_URL));

  if (!app.isPackaged || opts.disabled || process.platform !== 'win32' || process.env.SS_NO_UPDATE) return;

  const { autoUpdater } = require('electron-updater');
  updater = autoUpdater;
  const installed = isInstalled();
  updater.setFeedURL(FEED);
  updater.allowPrerelease = false;
  updater.autoDownload = installed;
  updater.autoInstallOnAppQuit = installed;
  updater.logger = { info: (m) => log('[update]', m), warn: (m) => log('[update]', m), error: (m) => log('[update]', m), debug: () => {} };

  updater.on('checking-for-update', () => setStatus({ state: 'checking' }));
  updater.on('update-not-available', () => setStatus({ state: 'latest' }));
  updater.on('update-available', (info) => setStatus({ state: installed ? 'downloading' : 'portable', version: info.version, percent: 0 }));
  updater.on('download-progress', (p) => setStatus({ state: 'downloading', version: status.version, percent: Math.round(p.percent || 0) }));
  updater.on('update-downloaded', (info) => setStatus({ state: 'ready', version: info.version }));
  updater.on('error', (e) => { log('업데이트 오류:', e && e.message); setStatus({ state: 'error', message: e && e.message }); });

  setStatus({ state: 'idle' });
  setTimeout(check, FIRST_CHECK_DELAY).unref();
  setInterval(() => { if (status.state !== 'ready' && status.state !== 'downloading') check(); }, CHECK_EVERY).unref();
}

module.exports = { initUpdater, isInstalled };
