'use strict';
// 원본 다시 받기 (src/shared/source-fetch.js): 받는 방법 짐작·시각 옮기기·예전 AI 대화 편집 위치 되찾기
const test = require('node:test');
const assert = require('node:assert/strict');
const SF = require('../src/shared/source-fetch.js');
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);

test('plan: 새 프로젝트는 저장된 받는 방법을 그대로', () => {
  const p = SF.plan({ path: '/c/yt/x/part_100_200.mp4', url: 'https://youtu.be/x', offset: 92.4, duration: 116, fetch: { kind: 'part', start: 100, end: 200 } });
  assert.equal(p.kind, 'part'); assert.equal(p.start, 100); assert.equal(p.end, 200);
  near(SF.fileToSrcByMap(p.map, 10), 102.4);
  const c = SF.plan({ path: '/c/chat/clips_ab.mp4', url: 'u', offset: 0, fetch: { kind: 'clips', spans: [{ start: 10, end: 20 }], map: [{ src0: 8, src1: 23, file0: 0 }] } });
  assert.equal(c.kind, 'clips'); assert.deepEqual(c.spans, [{ start: 10, end: 20 }]);
});

test('plan: 예전 프로젝트는 파일 이름과 offset 으로 짐작', () => {
  assert.equal(SF.plan({ path: '/c/yt/x/part_100_200.mp4', url: 'u', offset: 92.4, duration: 116 }).kind, 'part');
  const legacyChat = SF.plan({ path: '/c/chat/clips_0123abcd.mp4', url: 'u', offset: 0 });
  assert.equal(legacyChat.kind, 'clips'); assert.equal(legacyChat.needsSubs, true);
  assert.equal(SF.plan({ path: '/c/yt/x/part_98_230.mp4', url: 'u', offset: 0 }).needsSubs, true, 'AI 대화의 한 조각(offset 0)');
  assert.equal(SF.plan({ path: '/c/yt/x/x_full.mp4', url: 'u', offset: 0, duration: 3600 }).kind, 'section');
  assert.ok(SF.plan({ path: '/Users/me/설교.mp4', offset: 0 }).error, '내 파일은 다시 받을 수 없다');
});

test('remapProject: 키프레임이 달라 offset 이 바뀌어도 원본 시각이 같게 옮긴다', () => {
  const oldOff = 92.4, newOff = 94.1;
  const data = { words: [{ text: 'a', start: 10, end: 10.5 }, { text: 'b', start: 11, end: 12 }], overrides: { 's:1': 10.9, 'e:1': 12.2 }, playhead: 11.5 };
  const r = SF.remapProject(data, (f) => f + oldOff, (s) => s - newOff);
  near(r.data.words[0].start + newOff, 10 + oldOff); near(r.data.words[1].end + newOff, 12 + oldOff);
  near(r.data.overrides['s:1'] + newOff, 10.9 + oldOff); near(r.data.playhead + newOff, 11.5 + oldOff);
  assert.equal(r.missing, 0);
  assert.equal(data.words[0].start, 10, '원본 데이터는 그대로');
});

// AI 대화가 만든 파일을 흉내: 유튜브 자막 단어(원본 시각) 중 두 묶음을 받아 이어 붙임
function chatFixture() {
  const vocab = '오늘 우리가 함께 읽은 말씀은 사도행전 오장 입니다 하나님 께서 우리 에게 주신 은혜 를 기억 하며 감사 합시다'.split(' ');
  const subs = [];
  for (let i = 0; i < 600; i++) subs.push({ text: vocab[(i * 7) % vocab.length] + (i % 5 === 0 ? i : ''), start: 100 + i * 0.6 });
  const pick = [[50, 120], [400, 470]];
  const map = []; let f0 = 0;
  for (const [a, b] of pick) { const s0 = subs[a].start - 3.1, s1 = subs[b].start + 3.4; map.push({ src0: s0, src1: s1, file0: f0 }); f0 += s1 - s0; }
  const words = [];
  for (const [a, b] of pick) for (let i = a; i <= b; i++) {
    const f = SF.srcToFileByMap(map, subs[i].start);
    words.push({ text: subs[i].text + (i % 9 === 0 ? '!' : ''), sttText: subs[i].text, start: f, end: f + 0.4, del: i % 4 === 0 });
  }
  return { subs, map, words };
}

test('recoverClipMap: 예전 AI 대화 편집의 파일 위치를 유튜브 자막으로 되찾는다', () => {
  const { subs, map, words } = chatFixture();
  // 미세 조정으로 몇 단어 시각이 바뀌어 있어도
  words[10].start += 0.2; words[80].start -= 0.15;
  const got = SF.recoverClipMap(words, subs);
  assert.ok(got && got.length === 2, JSON.stringify(got));
  for (const w of words) {
    if (w === words[10] || w === words[80]) continue;
    near(SF.fileToSrcByMap(got, w.start), SF.fileToSrcByMap(map, w.start), 1e-6, w.text);
  }
});

test('예전 AI 대화 편집 → 다시 받은 새 파일(조각 길이가 다름)로 정확히 옮긴다', () => {
  const { subs, map, words } = chatFixture();
  const old = SF.recoverClipMap(words, subs);
  const f2s = (f) => SF.fileToSrcByMap(old, f);
  const spans = SF.spansFromWords(words, f2s);
  assert.equal(spans.length, 2);
  // 새로 받은 파일: 키프레임 때문에 조각 시작이 조금 다르다
  const nmap = []; let f0 = 0;
  for (const s of spans) { const s0 = s.start - 2.7, s1 = s.end + 2.2; nmap.push({ src0: s0, src1: s1, file0: f0 }); f0 += s1 - s0; }
  const r = SF.remapProject({ words, overrides: {}, playhead: 0 }, f2s, (s) => SF.srcToFileByMap(nmap, s));
  assert.equal(r.missing, 0);
  r.data.words.forEach((w, i) => near(SF.fileToSrcByMap(nmap, w.start), SF.fileToSrcByMap(map, words[i].start), 1e-6, 'word ' + i));
});

test('recoverClipMap: 자막과 맞지 않으면 null (엉뚱하게 옮기지 않는다)', () => {
  const { subs } = chatFixture();
  const words = [{ sttText: '전혀', start: 1, end: 2 }, { sttText: '다른', start: 2, end: 3 }, { sttText: '말', start: 3, end: 4 }];
  assert.equal(SF.recoverClipMap(words, subs), null);
});

test('normalizeFetch: 잘못된 값은 버린다', () => {
  assert.equal(SF.normalizeFetch({ kind: 'part', start: 5, end: 1 }), null);
  assert.equal(SF.normalizeFetch({ kind: 'clips', spans: [], map: [] }), null);
  assert.deepEqual(SF.normalizeFetch({ kind: 'section', start: 0, end: 10, junk: 1 }), { kind: 'section', start: 0, end: 10 });
});
