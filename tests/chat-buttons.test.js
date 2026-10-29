// 편집 대화 버튼(v0.3.10): 편집 조건 글, 구간 추천 후보, 말 사이 공백 없애기 계획
const test = require('node:test');
const assert = require('node:assert');
const cp = require('../src/shared/chat-plan.js');
const gaps = require('../src/shared/gaps.js');
const silence = require('../src/main/silence.js');
const edl = require('../src/shared/edl.js');

const ALL = { length: 120, tight: true, filler: true, questions: true, notices: true, gaps: true, ending: true };

test('편집 조건: 길이는 공백을 줄일 몫까지 넉넉히, 켠 다듬기만 담는다', () => {
  const c = cp.buildConditions(ALL);
  assert.ok(c.startsWith('[편집 조건]'));
  assert.ok(c.includes('약 2분 15초'), c); // 120 / 0.88 = 136 → 135초
  assert.ok(c.includes('완성 길이가 약 2분'));
  for (const k of ['늘어지지 않게', '군말 빼기', '질문 빼기', '진행 안내 빼기', '끝맺음']) assert.ok(c.includes(k), k);
  const off = cp.buildConditions({ length: 90, questions: false });
  assert.ok(off.includes('약 1분 30초 (1분 20초~1분 40초)'), off);
  assert.ok(off.includes('남겨도 됩니다'));
  assert.ok(!off.includes('늘어지지 않게'));
  assert.ok(!cp.buildConditions({}).includes('길이:')); // 조건을 다 끄면 기본 원칙만 풀어 준다
  assert.strictEqual(cp.conditionsSummary(ALL), '2분 · 늘어지지 않게 · 군말·반복 빼기 · 질문·대답 빼기 · 진행 안내 빼기 · 공백 없애기 · 결론으로 끝내기');
  assert.deepStrictEqual([cp.fmtLen(60), cp.fmtLen(90), cp.fmtLen(45), cp.fmtLen(0)], ['1분', '1분 30초', '45초', '0초']);
});

test('버튼 요청: 추천·만들기·후보 고르기에는 조건이 붙고, 다듬기 버튼은 짧은 지시만', () => {
  const rec = cp.actionRequest('recommend', ALL);
  assert.ok(rec.label.startsWith('구간 3곳 추천'));
  assert.ok(rec.text.startsWith('[편집 조건]') && rec.text.includes('3곳') && rec.text.includes('아직 편집은 하지 마'));
  const pick = cp.actionRequest('pick', ALL, { no: 2, from: 4501, to: 4720, title: '기도의 결론' });
  assert.ok(pick.text.includes('2번 후보(#4501~#4720, 「기도의 결론」) 범위 안에서만'));
  assert.ok(pick.text.startsWith('[편집 조건]'));
  const tight = cp.actionRequest('tight', ALL);
  assert.ok(!tight.text.includes('[편집 조건]') && tight.text.includes('늘어지지 않게'));
  const len = cp.actionRequest('length', ALL, 90);
  assert.ok(len.text.includes('완성 약 1분 30초') && len.text.includes('약 1분 40초'), len.text); // 90/0.88=102 → 100초
  for (const k of ['make', 'again', 'filler', 'questions', 'notices', 'shorter', 'longer', 'ending', 'title', 'typos']) assert.ok(cp.actionRequest(k, ALL), k);
  assert.strictEqual(cp.actionRequest('nope', ALL), null);
});

test('AI 답의 후보: 단어 범위로 풀고 길이·자막 미리보기를 붙이며 짧은 것은 버린다', () => {
  const words = Array.from({ length: 200 }, (_, i) => ({ text: 'w' + i, start: i * 0.5, end: i * 0.5 + 0.4 }));
  const plan = cp.parsePlan(JSON.stringify({ reply: '세 곳입니다', segments: [], candidates: [
    { title: '첫째', from: 10, fromText: 'w10', to: 60, toText: 'w60', summary: '요약', why: '이유' },
    { title: '짧음', from: 70, to: 72 },
    { title: '둘째', from: 150, fromText: 'w150', to: 100, toText: 'w100' },
    null,
  ] }));
  assert.strictEqual(plan.candidates.length, 3);
  const c = cp.resolveCandidates(plan.candidates, words);
  assert.deepStrictEqual(c.map((x) => [x.no, x.title, x.from, x.to]), [[1, '첫째', 10, 60], [2, '둘째', 100, 150]]);
  assert.strictEqual(c[0].start, 5);
  assert.ok(Math.abs(c[0].durationSec - 25.4) < 1e-9);
  assert.ok(c[0].excerpt.startsWith('w10 w11'));
  assert.deepStrictEqual(cp.parsePlan('{"reply":"x","segments":[]}').candidates, []);
  assert.ok(cp.buildSystemPrompt({}).includes('"candidates"'));
});

test('공백 없애기 계획: 단어 사이 무음은 잘라 두 구간으로, 앞뒤 무음은 구간을 당긴다', () => {
  const words = [
    { id: 0, text: '하나님', start: 1.0, end: 1.5 },
    { id: 1, text: '만이', start: 1.55, end: 1.9 },
    { id: 2, text: '영광을', start: 2.8, end: 3.3 },   // 1.9~2.75 사이 쉼
    { id: 3, text: '받으십니다', start: 3.35, end: 4.0 },
    { id: 4, text: '지운말', start: 4.5, end: 4.9, del: true },
  ];
  const settings = { padBefore: 0.1, padAfter: 0.15 };
  const segs = edl.buildSegments(words, settings, {}, 10);
  assert.strictEqual(segs.length, 1);
  const silences = [{ start: 0.5, end: 0.98 }, { start: 1.92, end: 2.0 }, { start: 2.05, end: 2.74 }, { start: 3.6, end: 3.7 }, { start: 3.95, end: 6 }];
  const plan = gaps.planGapCuts(words, segs, silences, { padBefore: 0.05, padAfter: 0.07, minCut: 0.08 });
  assert.deepStrictEqual(plan.cutBefore, [2]);
  // 1.9~2.75 사이 무음 둘 중 긴 것(2.05~2.74)만 자른다 (사이 소리는 남김)
  assert.ok(Math.abs(plan.overrides['e:1'] - 2.12) < 1e-9 && Math.abs(plan.overrides['s:2'] - 2.69) < 1e-9, JSON.stringify(plan.overrides));
  // 앞(0.9~0.98→0.93)은 너무 짧아 그대로. 3.6~3.7 은 끝 단어 소리 중간이라 안 자르고, 끝에 붙은 3.95~ 만 끝을 4.02 로
  assert.strictEqual(plan.overrides['s:0'], undefined);
  assert.ok(Math.abs(plan.overrides['e:3'] - 4.02) < 1e-9, JSON.stringify(plan.overrides));
  assert.strictEqual(plan.cuts, 2);
  // 계획대로 적용하면 구간이 둘로 나뉘고 길이가 줄어든다
  const w2 = words.map((w, i) => Object.assign({}, w, plan.cutBefore.includes(i) ? { cutBefore: true } : {}));
  const after = edl.buildSegments(w2, settings, plan.overrides, 10);
  assert.strictEqual(after.length, 2);
  assert.ok(Math.abs(edl.segmentsDuration(segs) - edl.segmentsDuration(after) - plan.savedSec) < 1e-9);
  // 같은 무음으로 다시 해도 더 자를 것이 없다
  const again = gaps.planGapCuts(w2, after, silences, { padBefore: 0.05, padAfter: 0.07, minCut: 0.08 });
  assert.strictEqual(again.cuts, 0);
});

test('ffmpeg 무음 로그 읽기와 무음 기준', () => {
  const log = '[silencedetect @ 0x1] silence_start: 1.234\n[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.266\nsilence_start: 7.9\n';
  assert.deepStrictEqual(silence.parseSilences(log, 10, 9), [{ start: 11.234, end: 12.5 }, { start: 17.9, end: 19 }]);
  assert.deepStrictEqual(silence.parseSilences(log), [{ start: 1.234, end: 2.5 }]);
  assert.strictEqual(silence.parseMeanVolume('[Parsed_volumedetect_0 @ 0x] mean_volume: -24.3 dB'), -24.3);
  assert.strictEqual(silence.noiseFloorFor(-24.3), -38);
  assert.strictEqual(silence.noiseFloorFor(-5), -28);
  assert.strictEqual(silence.noiseFloorFor(-70), -50);
  assert.strictEqual(silence.noiseFloorFor(null), -35);
});
