'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cp = require('../src/shared/chat-plan');
const { clusterRanges, srcToFile } = require('../src/main/llm/clips');

const json3 = { events: [
  { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: '>> 기도란' }, { utf8: ' 시작도', tOffsetMs: 800 }, { utf8: ' 하나님이요', tOffsetMs: 1600 }] },
  { tStartMs: 5000, dDurationMs: 2000, segs: [{ utf8: '끝도' }, { utf8: ' 하나님이심을', tOffsetMs: 500 }] },
  { tStartMs: 7000, dDurationMs: 100, segs: [{ utf8: '\n' }] },
] };

test('json3 → 단어: >> 표시는 빼고, 끝 시각은 다음 단어 전·글자 수 어림', () => {
  const { words, lines } = cp.wordsFromJson3(json3);
  assert.deepStrictEqual(words.map((w) => w.text), ['기도란', '시작도', '하나님이요', '끝도', '하나님이심을']);
  assert.strictEqual(lines.length, 2);
  for (let i = 0; i < words.length; i++) {
    assert.ok(words[i].end > words[i].start);
    if (i + 1 < words.length) assert.ok(words[i].end <= words[i + 1].start);
  }
  assert.ok(words[0].end < 1.8, '세 글자 단어는 다음 단어까지 늘이지 않는다');
  const tx = cp.transcriptText(words, lines);
  assert.match(tx, /^#0 \[0:01\.0\] 기도란 시작도 하나님이요\n#3 \[0:05\.0\] 끝도 하나님이심을$/);
});

test('AI 답 해석: 코드 블록·앞뒤 글이 있어도 JSON 을 꺼낸다', () => {
  const p = cp.parsePlan('좋습니다.\n```json\n{"reply":"했습니다","segments":[{"from":0,"to":2}],"tighten":"strong"}\n```');
  assert.strictEqual(p.reply, '했습니다');
  assert.strictEqual(p.tighten, 'strong');
  assert.throws(() => cp.parsePlan('그냥 글'), /읽지 못했습니다/);
  assert.strictEqual(cp.parsePlan('{"segments":[]}').tighten, 'normal');
});

test('계획 → 범위: 번호가 조금 틀려도 글자로 맞추고, 시간 순으로 합친다', () => {
  const { words } = cp.wordsFromJson3(json3);
  const r = cp.resolvePlan({ segments: [
    { from: 4, fromText: '끝도', to: 4, toText: '하나님이심을' },   // from 번호가 하나 틀림 → 3
    { from: 0, fromText: '기도란', to: 1, toText: '시작도' },
    { from: 2, to: 2 },
  ], corrections: [{ id: 2, text: '하나님이요' }, { id: 99, text: 'x' }] }, words);
  assert.deepStrictEqual(r.ranges, [{ from: 0, to: 4 }]);
  assert.strictEqual(r.corrections.length, 1);
  assert.ok(cp.rangesDuration(r.ranges, words) > 5);
  assert.strictEqual(cp.describeRanges(r.ranges, words)[0].text, '기도란 시작도 하나님이요 끝도 하나님이심을');
});

test('시스템 프롬프트에 편집 원칙과 답 형식이 들어 있다', () => {
  const s = cp.buildSystemPrompt({ church: '우리교회' });
  assert.match(s, /회중에게 묻는 말/);
  assert.match(s, /"segments"/);
  assert.match(s, /교회: 우리교회/);
});

test('조각 묶기와 원본→파일 시각 변환', () => {
  const c = clusterRanges([{ start: 100, end: 110 }, { start: 130, end: 140 }, { start: 600, end: 620 }]);
  assert.deepStrictEqual(c, [{ start: 98, end: 142 }, { start: 598, end: 622 }]);
  const map = [{ src0: 97.5, src1: 143, file0: 0 }, { src0: 597, src1: 623, file0: 45.5 }];
  assert.strictEqual(srcToFile(map, 100), 2.5);
  assert.strictEqual(srcToFile(map, 600), 48.5);
  assert.strictEqual(srcToFile(map, 300), null);
});

test('조금 어긋난 JSON 도 읽는다 (문자열 속 줄바꿈, 끝 쉼표, 주석)', () => {
  const bad = '{\n  "reply": "결론으로\n줄였습니다", // 설명\n  "title": "기도의\n중심",\n  "segments": [{"from": 1, "to": 2},],\n}';
  const p = cp.parsePlan(bad);
  assert.strictEqual(p.title, '기도의\n중심');
  assert.strictEqual(p.segments.length, 1);
  assert.throws(() => cp.parsePlan('{"reply": "질문 "누구입니까" 를 뺐습니다"}'), (e) => e.code === 'format');
});
