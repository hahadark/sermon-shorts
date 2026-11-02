'use strict';
// 설정 창 [일반]·[편집] 값 다듬기 (src/main/settings.js normalizeExtras)
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeExtras, defaults } = require('../src/main/settings.js');
const norm = (o) => normalizeExtras({ ...defaults(), ...o }, defaults());

test('기본값: 최근 링크 5개, 묻기, 자동 업데이트·자동 저장 켜짐, 편집 기본값', () => {
  const s = norm({});
  assert.equal(s.recentYoutubeMax, 5);
  assert.deepEqual(s.recentYoutube, []);
  assert.equal(s.sourceMissing, 'ask');
  assert.equal(s.autoUpdate, true);
  assert.deepEqual(s.autosave, { enabled: true, everyMin: 2, maxVersions: 30, keepDays: 60, maxVideos: 40 });
  assert.equal(s.editDefaults.maxLineChars, 14);
  assert.equal(s.editDefaults.autoTidy, true);
});

test('최근 링크: 보존 개수만큼만, 같은 주소는 하나, 빈 주소는 버림', () => {
  const list = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ url: 'https://youtu.be/v' + i, title: 't' + i, at: i }));
  assert.equal(norm({ recentYoutube: list }).recentYoutube.length, 5);
  assert.equal(norm({ recentYoutube: list, recentYoutubeMax: 3 }).recentYoutube.length, 3);
  assert.equal(norm({ recentYoutube: list, recentYoutubeMax: 0 }).recentYoutube.length, 0);
  assert.equal(norm({ recentYoutube: [list[0], { ...list[0], title: 'x' }, { url: ' ' }, null] }).recentYoutube.length, 1);
  assert.equal(norm({ recentYoutubeMax: 999 }).recentYoutubeMax, 50);
  assert.equal(norm({ recentYoutubeMax: 'abc' }).recentYoutubeMax, 5);
});

test('범위 밖 값은 고친다', () => {
  const s = norm({ sourceMissing: 'weird', autoUpdate: 0, autosave: { everyMin: 0, maxVersions: -3, keepDays: 'x' }, editDefaults: { maxLineChars: 0, padBefore: -1, fadeMs: 5000, autoTidy: false } });
  assert.equal(s.sourceMissing, 'ask');
  assert.equal(s.autoUpdate, true, 'false 로 정확히 줄 때만 끈다');
  assert.equal(s.autosave.everyMin, 1); assert.equal(s.autosave.maxVersions, 1); assert.equal(s.autosave.keepDays, 60);
  assert.equal(s.editDefaults.maxLineChars, 1); assert.equal(s.editDefaults.padBefore, 0); assert.equal(s.editDefaults.fadeMs, 1000);
  assert.equal(s.editDefaults.autoTidy, false);
  assert.equal(norm({ autoUpdate: false }).autoUpdate, false);
  assert.equal(norm({ sourceMissing: 'auto' }).sourceMissing, 'auto');
});
