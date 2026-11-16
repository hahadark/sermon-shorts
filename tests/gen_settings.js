// 설정 정리 규칙 비교용 기준값: Electron src/main/settings.js 의 loadSettings(normalize)·saveSettings 를 그대로 돌린다
//   node tests/gen_settings.js  → tests/fixtures/settings_cases.json
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const APP = 'F:/aside/sermon-shorts-app';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-settings-'));
const electronStub = {
  app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0.0.0' },
  ipcMain: { handle() {}, on() {} },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {}, shell: {},
};
const origLoad = Module._load;
Module._load = function (req, parent, isMain) { if (req === 'electron') return electronStub; return origLoad.apply(this, arguments); };
const settingsPath = require.resolve(APP + '/src/main/settings.js');
const fresh = () => { delete require.cache[settingsPath]; return require(settingsPath); };
const file = path.join(tmp, 'settings.json');

const raws = [
  {},
  { activeThemeId: 'channel-header-blur', template: { churchName: '', logoPath: '' }, speakers: [' 차재수 사관 ', '', '김택근 사관'], defaultSpeaker: '없는 사람' },
  { activeThemeId: 'x', template: { speakers: ['갑 목사', '을 전도사'], defaultSpeaker: '을 전도사', aiModel: 'm' } },
  { activeThemeId: 'x', template: { speakers: ['갑 목사'] }, defaultSpeaker: 3 },
  { activeThemeId: 'x', recentYoutubeMax: '7.6', recentYoutube: [{ url: ' https://youtu.be/a ', title: 'A', at: 5 }, { url: 'https://youtu.be/a', title: 'dup' }, { url: '', title: 'x' }, { title: 'no url' }, null, { url: 'https://youtu.be/b', title: 'x'.repeat(250), at: 'abc' }, { url: 'https://youtu.be/c', at: 1e16 }] },
  { activeThemeId: 'x', recentYoutubeMax: -3, sourceMissing: 'ASK', autoUpdate: 0, previewProxy: null },
  { activeThemeId: 'x', recentYoutubeMax: 99, sourceMissing: 'ask', autoUpdate: false, previewProxy: false },
  { activeThemeId: 'x', autosave: { enabled: false, everyMin: 0.5, maxVersions: 1000, keepDays: '12', maxVideos: 'abc' } },
  { activeThemeId: 'x', autosave: 'bad', editDefaults: [1] },
  { activeThemeId: 'x', editDefaults: { maxLineChars: 14.5, semanticBreaks: 0, splitLongWords: false, padBefore: -1, padAfter: '0.3', fadeMs: 2000.4, autoTidy: false } },
  { activeThemeId: 'x', editDefaults: { maxLineChars: null, padBefore: true, fadeMs: '' } },
  { activeThemeId: 'x', ytPrivacy: 'public', ytUploadMode: 'review', extraKey: { a: [1, 2] }, churchTerms: '구역장, 셀모임' },
];
const out = { load: [], save: [] };
for (const r of raws) {
  fs.writeFileSync(file, JSON.stringify(r));
  out.load.push({ raw: r, out: fresh().loadSettings() });
}
const saves = [
  [raws[1], { template: { churchName: '대구사랑', logoPath: 'C:/x/logo.png' }, speakers: ['a', ' b '], defaultSpeaker: 'b' }],
  [raws[2], { template: { speakers: ['새 사람'], defaultSpeaker: '새 사람' } }],
  [raws[2], { template: { churchName: '' } }],
  [raws[0], { recentYoutubeMax: 2, recentYoutube: [{ url: 'u1', title: 't1', at: 1 }, { url: 'u2', at: 2 }, { url: 'u3', at: 3 }] }],
  [raws[0], { autosave: { enabled: false }, editDefaults: { padBefore: 0.25 } }],
  [raws[6], { sourceMissing: 'auto', autoUpdate: true, hasApiKey: true, apiKeySuffix: 'abcd', geminiApiKeyEnc: 'hack' }],
  [raws[0], { geminiApiKey: '', openrouterApiKey: '' }],
];
for (const [r, patch] of saves) {
  fs.writeFileSync(file, JSON.stringify(r));
  const s = fresh();
  s.saveSettings(patch);
  out.save.push({ raw: r, patch, out: JSON.parse(fs.readFileSync(file, 'utf8')) });
}
fs.writeFileSync(path.join(__dirname, 'fixtures', 'settings_cases.json'), JSON.stringify(out, null, 1));
console.log('읽기', out.load.length, '저장', out.save.length, '(임시 폴더 ' + tmp + ')');
fs.rmSync(tmp, { recursive: true, force: true });
