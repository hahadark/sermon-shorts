'use strict';
// 의미 단위 자막 나누기 (linebreak.js + edl.buildLines semanticBreaks)
const test = require('node:test');
const assert = require('node:assert');
const edl = require('../src/shared/edl.js');
const lb = require('../src/shared/linebreak.js');

function words(text, gaps) {
  let t = 0;
  return text.split(' ').map((w, i) => { t += (gaps && gaps[i]) || 0; const s = t; t += 0.3; return { id: i, text: w, start: s, end: t - 0.02 }; });
}
function lines(text, max, opts) {
  const ws = words(text, opts && opts.gaps);
  const cfg = Object.assign({ maxLineChars: max || 14, splitLongWords: true, semanticBreaks: true }, opts && opts.cfg);
  return edl.buildLines(ws, edl.buildSegments(ws, cfg, {}, 1e6), cfg).map((l) => l.text);
}

test('~의 뒤에서 끊지 않고 조사 뒤에서 끊는다', () => {
  assert.deepEqual(lines('하나님의 은혜가 우리에게 충분합니다'), ['하나님의 은혜가', '우리에게 충분합니다']);
});
test('~할 때 처럼 이어지는 말 뒤에서 끊는다', () => {
  assert.deepEqual(lines('우리가 기도할 때 하나님께서 응답하십니다'), ['우리가 기도할 때', '하나님께서 응답하십니다']);
});
test('꾸밈말 뒤·의존 명사 앞에서 끊지 않는다', () => {
  assert.deepEqual(lines('그런 사람은 하나님 앞에 설 수 없습니다'), ['그런 사람은', '하나님 앞에 설 수 없습니다']);
  assert.deepEqual(lines('모든 사람이 구원을 받을 수 있습니다', 10), ['모든 사람이 구원을', '받을 수 있습니다']);
});
test('보조 용언 앞에서 끊지 않는다 (하고 있습니다)', () => {
  const out = lines('지금 우리는 함께 기도하고 있습니다 아멘', 12);
  assert.ok(out.some((l) => /기도하고 있습니다/.test(l)), JSON.stringify(out));
});
test('문장부호가 없어도 ~습니다·~요 에서는 줄을 바꾼다', () => {
  assert.deepEqual(lines('감사합니다 그리고 우리는 기도합니다'), ['감사합니다', '그리고 우리는 기도합니다']);
  assert.deepEqual(lines('필요 없습니다'), ['필요 없습니다']);
});
test('말 사이 쉼이 있는 곳을 고른다', () => {
  // 하나님께서 / (0.45초 쉼) 우리를 ... : 쉼 뒤에서 끊는다
  const out = lines('하나님께서 오늘도 우리를 지키시고 인도하십니다', 14, { gaps: [0, 0, 0.45, 0, 0] });
  assert.equal(out[0], '하나님께서 오늘도');
});
test('한 줄 최대 글자를 넘지 않는다', () => {
  const out = lines('예수님께서 십자가에서 우리를 위하여 죽으시고 다시 사셨습니다', 10);
  for (const l of out) assert.ok(l.replace(/\s/g, '').length <= 10, l);
  assert.equal(out.join(' '), '예수님께서 십자가에서 우리를 위하여 죽으시고 다시 사셨습니다');
});
test('끄면 예전처럼 글자 수로 채운다', () => {
  assert.deepEqual(lines('하나님의 은혜가 우리에게 충분합니다', 14, { cfg: { semanticBreaks: false } }), ['하나님의 은혜가 우리에게', '충분합니다']);
});
test('끊기 값: 좋은 자리는 음수, 나쁜 자리는 양수', () => {
  assert.ok(lb.breakCost('기도하고,', '찬양합니다', 0) < 0);
  assert.ok(lb.breakCost('하나님의', '사랑', 0) > 0);
  assert.ok(lb.breakCost('할', '수', 0) > 0);
  assert.ok(lb.breakCost('3', '장', 0) > 0);
  assert.ok(lb.breakCost('은혜를', '그리고', 0) < lb.breakCost('그리고', '은혜를', 0));
  assert.equal(lb.isSentenceEnd('합니까'), true);
  assert.equal(lb.isSentenceEnd('하니까'), false);
});
