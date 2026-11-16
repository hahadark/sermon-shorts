// youtube-upload.js buildMetadata 비교 자료 (electron 은 가짜로)
const Module = require('module'); const orig = Module._load;
Module._load = function (req, ...a) { if (req === 'electron') return { ipcMain: { handle() {} }, shell: {}, safeStorage: {}, app: { getPath: () => '.' } }; return orig.call(this, req, ...a); };
const Y = require('F:/aside/sermon-shorts-app/src/main/youtube-upload.js');
const long = '가'.repeat(120);
const metas = [
  { title: '오늘의 말씀 / 하나님 중심의 *기도*', verse: '마태복음 6:13', church: '구세군대구사랑교회', speaker: '차재수 사관', privacy: 'unlisted', credits: '음악: Kevin MacLeod (CC BY 4.0)' },
  { title: '', verse: '', church: '', speaker: '', privacy: 'public', credits: '' },
  { title: '이미 #shorts 있음', verse: '요 3:16', church: '교회', speaker: '', privacy: 'weird' },
  { title: long, verse: '시 23편', church: '', speaker: '목사', privacy: 'private' },
  { title: '<태그> 제목', description: '  직접 쓴 설명 <b>  ', privacy: 'unlisted' },
  { title: 'A / B / C', verse: '창 1:1', church: 'X', speaker: 'Y', credits: '  ' },
];
require('fs').writeFileSync('tests/fixtures/ytmeta_cases.json', JSON.stringify(metas.map((m) => ({ meta: m, out: Y.buildMetadata(m) }))));
console.log('ytmeta', metas.length);
