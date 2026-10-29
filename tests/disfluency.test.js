'use strict';
// 군말·말 사이 쉼 찾기 (disfluency.js)
const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/shared/disfluency.js');
const edl = require('../src/shared/edl.js');

test('혼자 쓰인 음·어·아는 군말, 낱말 속이나 꾸밈말은 아님', () => {
  for (const t of ['음', '음...', '어', '어,', '아', '에', '으음', '어어', '음음.', '그...', '이~']) assert.equal(D.isFiller(t), true, t);
  for (const t of ['그', '이', '아멘', '어머니', '음식', '아버지', '에서', '하나님', '']) assert.equal(D.isFiller(t), false, t);
});

function ws(spec) { // [[text,start,end,del?]]
  return spec.map((s, i) => ({ id: i, text: s[0], start: s[1], end: s[2], del: !!s[3] }));
}

test('같은 구간 안 긴 쉼 찾기 (지운 단어 너머는 아님)', () => {
  const w = ws([['하나님은', 0, 0.6], ['우리를', 1.4, 1.9], ['음', 2.0, 2.3, true], ['사랑하십니다', 3.2, 4.0]]);
  const segs = edl.buildSegments(w, {}, {}, 10);
  const p = D.pauses(w, segs, 0.5);
  assert.deepEqual(p.map((x) => [x.prev, x.i]), [[0, 1]]);
  assert.ok(Math.abs(p[0].gap - 0.8) < 1e-9);
});

test('단어 시각으로 공백 자르기 계획: 말 끝·시작 여유를 남긴다', () => {
  const w = ws([['하나님은', 0, 0.6], ['우리를', 1.4, 1.9], ['사랑하십니다', 2.0, 3.0]]);
  const segs = edl.buildSegments(w, {}, {}, 10);
  const plan = D.gapCutsByTiming(w, segs, { minGap: 0.3, padBefore: 0.08, padAfter: 0.12 });
  assert.deepEqual(plan.cutBefore, [1]);
  assert.ok(Math.abs(plan.overrides['e:0'] - 0.72) < 1e-9 && Math.abs(plan.overrides['s:1'] - 1.32) < 1e-9);
  // 계획대로 자르면 구간이 둘로, 요약에 공백 1곳
  w[1].cutBefore = true;
  const after = edl.buildSegments(w, {}, plan.overrides, 10);
  assert.equal(after.length, 2);
  const s = D.summary(w, after);
  assert.equal(s.gaps, 1);
  assert.ok(Math.abs(s.gapSec - 0.6) < 1e-9);
});

test('요약: 지운 군말 수와 지운 단어 때문에 생긴 컷은 공백으로 세지 않음', () => {
  const w = ws([['음', 0, 0.3, true], ['오늘', 0.5, 0.9], ['어', 1.0, 1.2, true], ['말씀은', 1.3, 1.8]]);
  const segs = edl.buildSegments(w, {}, {}, 10);
  assert.deepEqual(D.summary(w, segs), { fillers: 2, gaps: 0, gapSec: 0 });
});
