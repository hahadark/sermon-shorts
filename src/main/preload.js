'use strict';
// 렌더러에 window.api 노출 (contextIsolation: true)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /** 시작 인자: { open: string|null, screenshot: boolean, root: string } */
  openGuide: () => ipcRenderer.invoke('app:openGuide'),
  getLaunchInfo: () => ipcRenderer.invoke('app:launch'),
  autosaveWrite: (p) => ipcRenderer.invoke('autosave:write', p),
  autosaveList: () => ipcRenderer.invoke('autosave:list'),
  autosaveRead: (key, file) => ipcRenderer.invoke('autosave:read', key, file),
  autosaveRemove: (key) => ipcRenderer.invoke('autosave:remove', key),
  autosaveStatus: () => ipcRenderer.invoke('autosave:status'),
  autosaveOpenDir: () => ipcRenderer.invoke('autosave:openDir'),
  onAutosaveFlush: (cb) => { const l = () => cb(); ipcRenderer.on('autosave:flush', l); return () => ipcRenderer.removeListener('autosave:flush', l); },
  autosaveFlushed: () => ipcRenderer.send('autosave:flushed'),
  testCloseWindow: () => ipcRenderer.send('test:closeWindow'),
  /** 영상 파일 선택 대화상자 → 경로 또는 null */
  openVideoDialog: () => ipcRenderer.invoke('dialog:openVideo'),
  /** { duration, fps, width, height, hasAudio } */
  probe: (path) => ipcRenderer.invoke('media:probe', path),
  /** { buffer: ArrayBuffer(Float32 [min,max] 쌍), bucketSec: 0.01, hash } */
  getPeaks: (path) => ipcRenderer.invoke('media:peaks', path),
  /** ArrayBuffer (Float32 mono PCM) */
  getPcm: (path, start, end, rate) => ipcRenderer.invoke('media:pcm', path, start, end, rate),
  readJson: (path) => ipcRenderer.invoke('fs:readJson', path),
  // 유튜브
  ytInfo: (url) => ipcRenderer.invoke('yt:info', url),
  ytAutoSubs: (url) => ipcRenderer.invoke('yt:autoSubs', url),
  ytResolve: (url) => ipcRenderer.invoke('yt:resolve', url),
  ytFetchPart: (url, start, end) => ipcRenderer.invoke('yt:fetchPart', url, start, end),
  ytDownload: (url, start, end) => ipcRenderer.invoke('yt:download', url, start, end),
  // 엔진
  transcribe: (path, start, end) => ipcRenderer.invoke('engine:transcribe', path, start, end),
  cancelTask: () => ipcRenderer.send('engine:cancel'),
  // 공통 진행률 구독
  onProgress: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('progress', listener);
    return () => ipcRenderer.removeListener('progress', listener);
  },
  /** 테스트 모드: 캡처 준비 완료 알림 */
  notifyTestReady: (info) => ipcRenderer.send('test:ready', info),
  notifyTestError: (msg) => ipcRenderer.send('test:error', String(msg)),
  testScreenshot: (p) => ipcRenderer.invoke('test:screenshot', p),
  // 새로 추가된 핸들러 (Settings, Project, Export)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  saveProjectDialog: (options) => ipcRenderer.invoke('dialog:saveProject', options),
  openProjectDialog: () => ipcRenderer.invoke('dialog:openProject'),
  writeText: (p, text) => ipcRenderer.invoke('fs:writeText', p, text),
  writeImage: (options) => ipcRenderer.invoke('fs:writeImage', options),
  mkdir: (p) => ipcRenderer.invoke('fs:mkdir', p),
  saveExportDialog: (options) => ipcRenderer.invoke('dialog:saveExport', options),
  startExport: (params) => ipcRenderer.invoke('export:start', params),
  // 배경음악 (목록의 곡만): 캐시에 받아 두기 · 파형
  bgmFetch: (id) => ipcRenderer.invoke('bgm:fetch', id),
  bgmPeaks: (id, n) => ipcRenderer.invoke('bgm:peaks', id, n),
  bgmCached: (id) => ipcRenderer.invoke('bgm:cached', id),
  bgmCustomList: () => ipcRenderer.invoke('bgm:customList'),
  bgmTrack: (id) => ipcRenderer.invoke('bgm:track', id),
  bgmCustomRemove: (id) => ipcRenderer.invoke('bgm:customRemove', id),
  bgmImportFile: (p) => ipcRenderer.invoke('bgm:importFile', p),
  bgmImportYoutube: (url, key) => ipcRenderer.invoke('bgm:importYoutube', url, key),
  bgmLibrary: () => ipcRenderer.invoke('bgm:library'),
  bgmLibUpdate: (id, p) => ipcRenderer.invoke('bgm:libUpdate', id, p),
  bgmLibReveal: (id) => ipcRenderer.invoke('bgm:libReveal', id),
  bgmExpandUrl: (url) => ipcRenderer.invoke('bgm:expandUrl', url),
  onBgmProgress: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('bgm:progress', listener);
    return () => ipcRenderer.removeListener('bgm:progress', listener);
  },
  // 교인 배포 자료
  materialsGenerate: (type, options, ctx) => ipcRenderer.invoke('materials:generate', type, options, ctx),
  materialsSermon: () => ipcRenderer.invoke('materials:sermon'),
  materialsReadFile: () => ipcRenderer.invoke('materials:readFile'),
  materialsPdf: (o) => ipcRenderer.invoke('materials:pdf', o),
  materialsPng: (o) => ipcRenderer.invoke('materials:png', o),
  materialsPrint: (o) => ipcRenderer.invoke('materials:print', o),
  materialsOpenPath: (p) => ipcRenderer.invoke('materials:openPath', p),
  materialsPptx: (o) => ipcRenderer.invoke('materials:pptx', o),
  materialsSaveText: (o) => ipcRenderer.invoke('materials:saveText', o),
  materialsBundle: (o) => ipcRenderer.invoke('materials:bundle', o),
  materialsRenderTest: (o) => ipcRenderer.invoke('materials:renderTest', o),
  // AI
  aiAnalyze: (lines, opts) => ipcRenderer.invoke('ai:analyze', lines, opts),
  aiCorrect: (words, ctx) => ipcRenderer.invoke('ai:correct', words, ctx),
  /** { ok, code, message } - 키는 오지 않는다 */
  testAiConnection: (model) => ipcRenderer.invoke('ai:testConnection', model),
  // 시스템 점검
  sysCheck: (opts) => ipcRenderer.invoke('sys:check', opts),
  sysUpdateYtdlp: () => ipcRenderer.invoke('sys:updateYtdlp'),
  sysTestYoutube: (url) => ipcRenderer.invoke('sys:testYoutube', url),
  sysClearCache: () => ipcRenderer.invoke('sys:clearCache'),
  sysMarkSeen: () => ipcRenderer.invoke('sys:markSeen'),
  /** 고정된 안내 페이지 열기 (python, ffmpeg, ytdlp, node, gemini) */
  sysOpenLink: (key) => ipcRenderer.invoke('sys:openLink', key),
  sysInstallEngine: (force) => ipcRenderer.invoke('sys:installEngine', force),
  sysDownloadModel: () => ipcRenderer.invoke('sys:downloadModel'),
  sysInstallFfmpeg: () => ipcRenderer.invoke('sys:installFfmpeg'),
  // AI 연결(챗GPT·클로드·제미나이) — 토큰·키는 오지 않는다
  llmStatus: () => ipcRenderer.invoke('llm:status'),
  llmSetActive: (name) => ipcRenderer.invoke('llm:setActive', name),
  llmOpenLink: (key) => ipcRenderer.invoke('llm:openLink', key),
  llmChatgptSignIn: () => ipcRenderer.invoke('llm:chatgptSignIn'),
  llmChatgptSignOut: () => ipcRenderer.invoke('llm:chatgptSignOut'),
  llmClaudeInstall: () => ipcRenderer.invoke('llm:claudeInstall'),
  llmClaudeLogin: () => ipcRenderer.invoke('llm:claudeLogin'),
  llmTest: (name) => ipcRenderer.invoke('llm:test', name),
  // 대화형 편집
  chatLoad: (url) => ipcRenderer.invoke('chat:load', url),
  chatSend: (text) => ipcRenderer.invoke('chat:send', text),
  chatCancel: () => ipcRenderer.invoke('chat:cancel'),
  onChatStage: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('chat:stage', listener);
    return () => ipcRenderer.removeListener('chat:stage', listener);
  },
  chatReset: () => ipcRenderer.invoke('chat:reset'),
  chatFetchClips: (url, spans) => ipcRenderer.invoke('chat:fetchClips', url, spans),
  // 무음 구간 찾기: opts { start, end, minDur, noiseDb } → { noiseDb, meanDb, silences:[{start,end}] }
  audioSilences: (file, opts) => ipcRenderer.invoke('audio:silences', file, opts),
  onChatDelta: (callback) => {
    const listener = (_event, d) => callback(d);
    ipcRenderer.on('chat:delta', listener);
    return () => ipcRenderer.removeListener('chat:delta', listener);
  },
  // 유튜브 업로드 — 토큰은 오지 않는다. 상태 { hasClient, ownClient, loggedIn, channel, privacy, autoUpload }
  ytupStatus: () => ipcRenderer.invoke('ytup:status'),
  ytupSignIn: () => ipcRenderer.invoke('ytup:signIn'),
  ytupSignOut: () => ipcRenderer.invoke('ytup:signOut'),
  ytupSetOptions: (o) => ipcRenderer.invoke('ytup:setOptions', o),
  ytupOpenLink: (key) => ipcRenderer.invoke('ytup:openLink', key),
  ytupOpenUrl: (url) => ipcRenderer.invoke('ytup:openUrl', url),
  /** meta: { title, verse, church, speaker, privacy? } → { ok, id, url, studio, privacy, title } */
  ytupUpload: (filePath, meta) => ipcRenderer.invoke('ytup:upload', filePath, meta),
  // 앱 자동 업데이트: 상태 { state, version, percent, current }
  updateGet: () => ipcRenderer.invoke('update:get'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateOpenPage: () => ipcRenderer.invoke('update:openPage'),
  onUpdateStatus: (callback) => {
    const listener = (_event, s) => callback(s);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  // 테마
  listThemes: () => ipcRenderer.invoke('theme:list'),
  getTheme: (id) => ipcRenderer.invoke('theme:get', id),
  saveTheme: (json) => ipcRenderer.invoke('theme:save', json),
  deleteTheme: (id) => ipcRenderer.invoke('theme:delete', id),
  exportTheme: (json) => ipcRenderer.invoke('theme:export', json),
  importTheme: () => ipcRenderer.invoke('theme:import'),
  addFont: () => ipcRenderer.invoke('font:add'),
  listFonts: () => ipcRenderer.invoke('font:list'),
  getFontDataUrl: (name) => ipcRenderer.invoke('font:dataUrl', name),
  // 교회 로고: 저장된 logoPath → data: URL (앱 assets 또는 userData/logos 만 허용)
  getLogoDataUrl: (logoPath) => ipcRenderer.invoke('settings:logoDataUrl', logoPath),
  /** 파일 선택 → userData/logos 로 복사 → { path, dataUrl } 또는 null */
  chooseLogo: () => ipcRenderer.invoke('settings:chooseLogo'),
  /** 설정 저장 시 호출됨 (공개 설정 객체) */
  onSettingsChanged: (callback) => {
    const listener = (_event, s) => callback(s);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
});
