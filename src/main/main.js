'use strict';
// Electron 메인 프로세스: 창, IPC 등록, 테스트용 명령줄 처리
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
app.setName('SermonShorts');
if(process.env.SS_SCREENSHOT && process.env.SS_USER_DATA_DIR) app.setPath('userData',path.resolve(process.env.SS_USER_DATA_DIR));
const fs = require('fs');
const tools = require('./tools');
const media = require('./media');
const youtube = require('./youtube');
const ytpart = require('./ytpart');
const engine = require('./engine');
const settingsMod = require('./settings');
const { initSettings, getGeminiApiKey } = settingsMod;
const { initThemeIpc } = require('./theme-storage');
const { initRender } = require('./render');
const ai = require('./ai');
const syscheck = require('./syscheck-logic');
const guard = require('./fs-guard');
const setup = require('./setup');
const { initLlm } = require('./llm');

ai.setKeyProvider(() => {
  const k = getGeminiApiKey();
  if (k) return k;
  return process.env.GEMINI_API_KEY || '';
});

// ---- 명령줄 / 환경변수 ----
function parseArgs(argv) {
  const out = { open: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--open' && argv[i + 1]) { out.open = argv[i + 1]; i++; }
    else if (argv[i].startsWith('--open=')) out.open = argv[i].slice(7);
    else if (argv[i] === '--transcript' && argv[i + 1]) { out.transcript = argv[i + 1]; i++; }
    else if (argv[i].startsWith('--transcript=')) out.transcript = argv[i].slice(13);
  }
  if (out.open) out.open = path.resolve(out.open);
  if (out.transcript) out.transcript = path.resolve(out.transcript);
  if (!out.transcript && process.env.SS_TRANSCRIPT) out.transcript = path.resolve(process.env.SS_TRANSCRIPT);
  return out;
}
const launch = parseArgs(process.argv.slice(1));
guard.allowRoot(tools.cache);
guard.allowFile(launch.open);
guard.allowFile(launch.transcript);
const SCREENSHOT = process.env.SS_SCREENSHOT ? path.resolve(process.env.SS_SCREENSHOT) : null;
// 테스트 캡처: 다른 창에 가려져도 화면을 계속 그리게 한다
if (SCREENSHOT) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let mainWindow = null;

function log(...a) { console.log('[SermonShorts]', ...a); }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#15171a',
    title: '설교쇼츠편집기',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: !SCREENSHOT,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (SCREENSHOT) {
    mainWindow.webContents.on('console-message', (e) => { log('renderer:', e.message); });
    // 안전장치: 10분 안에 끝나지 않으면 종료
    setTimeout(() => { log('스크린샷 시간 초과'); app.exit(2); }, 10 * 60 * 1000).unref();
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---- IPC ----
function registerIpc() {
  ipcMain.handle('app:openGuide',async()=>{const file=path.join(tools.root,'docs','USER_GUIDE.pdf');if(!fs.existsSync(file))throw Error('사용 설명서 파일이 없습니다. GitHub 릴리스에서 PDF를 내려받아 주세요.');const error=await require('electron').shell.openPath(file);if(error)throw Error(error);return true;});
  ipcMain.handle('app:launch', () => ({
    open: launch.open,
    transcript: launch.transcript,
    screenshot: !!SCREENSHOT,
    testScript: process.env.SS_TEST_SCRIPT || null,
    testUrl: process.env.SS_TEST_URL || null,
    testProvider: process.env.SS_TEST_PROVIDER || null,
    waveView: process.env.SS_WAVE_VIEW || null,
    root: tools.root,
    cache: tools.cache,
    dataRoot: tools.dataRoot,
    isPackaged: app.isPackaged,
    userData: app.getPath('userData'),
    engineReady: fs.existsSync(tools.python),
    guideAvailable: fs.existsSync(path.join(tools.root,'docs','USER_GUIDE.pdf')),
  }));

  ipcMain.handle('dialog:openVideo', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '영상 열기',
      properties: ['openFile'],
      filters: [
        { name: '영상 파일', extensions: ['mp4', 'mov', 'mkv', 'webm'] },
        { name: '모든 파일', extensions: ['*'] },
      ],
    });
    if (r.canceled || !r.filePaths.length) return null;
    return guard.allowFile(r.filePaths[0]);
  });

  ipcMain.handle('media:probe', (_e, p) => media.probe(p));

  ipcMain.handle('media:peaks', async (_e, p) => {
    const { peaks, bucketSec, hash } = await media.computePeaks(p);
    // 정확한 크기의 ArrayBuffer로 전달
    const ab = peaks.buffer.byteLength === peaks.byteLength
      ? peaks.buffer
      : peaks.buffer.slice(peaks.byteOffset, peaks.byteOffset + peaks.byteLength);
    return { buffer: ab, bucketSec, hash };
  });

  ipcMain.handle('media:pcm', async (_e, p, start, end, rate) => {
    const pcm = await media.extractPcm(p, start, end, rate || 48000);
    return pcm.buffer; // extractPcm은 항상 새 ArrayBuffer를 만든다
  });

  // JSON 파일 읽기 (트랜스크립트·프로젝트용). 고른 파일과 캐시 폴더만
  ipcMain.handle('fs:readJson', (_e, p) => {
    const file = guard.check(p);
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
  });

  // 유튜브
  ipcMain.handle('yt:info', (_e, url) => youtube.fetchInfo(url));
  ipcMain.handle('yt:autoSubs', (_e, url) => youtube.fetchAutoSubs(url));
  ipcMain.handle('yt:resolve', (_e, url) => ytpart.resolveFormats(url));
  ipcMain.handle('yt:fetchPart', async (event, url, start, end) => {
    return ytpart.fetchPart(url, start, end, {}, (info) => {
      event.sender.send('progress', info);
    });
  });
  ipcMain.handle('yt:download', async (event, url, start, end) => {
    return youtube.downloadSection(url, start, end, {}, (pct) => {
      event.sender.send('progress', { task: 'youtube', stage: 'download', pct });
    });
  });

  // AI
  ipcMain.handle('ai:analyze', async (event, lines, opts) => {
    return ai.analyzeSermon(lines, opts);
  });
  
  ipcMain.handle('ai:correct', async (event, words, context) => {
    return ai.correctTerms(words, context);
  });

  // API 연결 확인 (키는 반환하지 않음)
  ipcMain.handle('ai:testConnection', async (_e, model) => {
    return ai.testConnection(model || settingsMod.loadSettings().template.aiModel || ai.DEFAULT_MODEL);
  });

  // 엔진
  ipcMain.handle('engine:transcribe', async (event, path, start, end) => {
    return engine.transcribe(path, { start, end }, (msg) => {
      event.sender.send('progress', { task: 'engine', ...msg });
    });
  });

  ipcMain.on('engine:cancel', () => {
    engine.cancelTask();
  });

  // 시스템 점검
  ipcMain.handle('sys:check', (_e, opts) => syscheck.checkSystem(settingsMod, opts || {}));
  ipcMain.handle('sys:updateYtdlp', () => syscheck.updateYtdlp());
  ipcMain.handle('sys:testYoutube', (_e, url) => syscheck.testYoutube(url));
  ipcMain.handle('sys:clearCache', () => syscheck.clearCache());
  // 설치 버튼: 진행 상황은 progress(task: 'setup', id: 점검 행 id)로 보낸다
  const setupProgress = (event, id) => (info) => { if (!event.sender.isDestroyed()) event.sender.send('progress', { task: 'setup', id, ...info }); };
  ipcMain.handle('sys:openLink', (_e, key) => setup.openLink(key));
  ipcMain.handle('sys:installEngine', (event, force) => setup.installEngine(!!force, setupProgress(event, 'python')));
  ipcMain.handle('sys:downloadModel', (event) => setup.downloadModel(setupProgress(event, 'model')));
  ipcMain.handle('sys:markSeen', () => { settingsMod.saveSettings({ sysCheckSeen: true }); return true; });

  // 테스트: 렌더러가 준비되면 창을 캡처하고 종료
  ipcMain.on('test:ready', async (_e, info) => {
    if (!SCREENSHOT || !mainWindow) return;
    try {
      log('준비 완료', JSON.stringify(info || {}));
      await new Promise((r) => setTimeout(r, 500));
      const img = await capture();
      fs.mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
      fs.writeFileSync(SCREENSHOT, img.toPNG());
      log('스크린샷 저장:', SCREENSHOT);
      app.exit(0);
    } catch (err) {
      log('스크린샷 실패:', err && err.stack);
      app.exit(1);
    }
  });

  // capturePage가 가끔 UnknownVizError로 실패해서 몇 번 다시 시도한다
  async function capture() {
    let err;
    for (let i = 0; i < 4; i++) {
      try {
        mainWindow.webContents.invalidate(); // 가려진 창은 화면이 늦게 갱신되므로 다시 그리게 한 뒤 캡처
        await new Promise((r) => setTimeout(r, 250));
        return await mainWindow.webContents.capturePage();
      } catch (e) { err = e; await new Promise((r) => setTimeout(r, 700)); }
    }
    throw err;
  }

  ipcMain.handle('test:screenshot', async (_e, customPath) => {
    if (!mainWindow) return;
    try {
      const img = await capture();
      const p = guard.check(path.resolve(tools.dataRoot, String(customPath)));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, img.toPNG());
      log('커스텀 스크린샷 저장:', p);
      return p;
    } catch (err) {
      log('스크린샷 실패:', err && err.stack);
      throw err;
    }
  });

  ipcMain.on('test:error', (_e, msg) => {
    log('렌더러 오류:', msg);
    if (SCREENSHOT) app.exit(1);
  });
}

// macOS 메뉴: 기본 메뉴의 Cmd+Z(실행 취소)·Cmd+R(새로고침)이 앱 단축키를 가로채거나 작업을 날리지 않게
// 복사·붙여넣기와 종료만 남긴다. 실행 취소는 앱 단축키(Cmd/Ctrl+Z)가 처리한다.
function setMacMenu() {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about', label: '설교쇼츠편집기 정보' }, { type: 'separator' }, { role: 'hide', label: '가리기' }, { role: 'hideOthers', label: '기타 가리기' }, { type: 'separator' }, { role: 'quit', label: '종료' }] },
    { label: '편집', submenu: [{ role: 'cut', label: '잘라내기' }, { role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '모두 선택' }] },
    { label: '윈도우', submenu: [{ role: 'minimize', label: '최소화' }, { role: 'togglefullscreen', label: '전체 화면' }] },
  ]));
}

app.whenReady().then(() => {
  setMacMenu();
  initSettings();
  initThemeIpc();
  initRender();
  initLlm();
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });
