'use strict';
// 칸을 끌어 설교 내용 순서 바꾸기: 출력 순서 모델 (src/shared/edl.js orderPieces / moveRange / buildSegments(order) / buildLines)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/shared/edl.js');
// 0~11초에 한 단어씩, 문장은 4단어마다 끝난다 (줄이 문장마다 나뉘게)
const W = () => Array.from({ length: 12 }, (_, i) => ({ id: i, text: '말' + i + (i % 4 === 3 ? '.' : ''), start: i, end: i + 0.8 }));
const S = { padBefore: 0, padAfter: 0, maxLineChars: 14 };
const texts = (ws, order) => E.buildLines(ws, E.buildSegments(ws, S, {}, 100, order), S).map((l) => l.text);

test('순서를 바꾸지 않으면 예전과 똑같다', () => {
  const ws = W();
  assert.deepEqual(E.orderPieces(ws, null), [{ a: 0, b: 12 }]);
  assert.deepEqual(E.buildSegments(ws, S, {}, 100, null), E.buildSegments(ws, S, {}, 100));
  assert.deepEqual(E.buildSegments(ws, S, {}, 100, []), E.buildSegments(ws, S, {}, 100));
  assert.equal(E.hasOrder(ws, null), false);
});

test('셋째 문장을 둘째 앞으로: 구간·자막이 바뀐 순서로', () => {
  const ws = W();
  const order = E.moveRange(ws, null, 8, 12, 4);
  assert.deepEqual(order, [0, 8, 4]);
  assert.deepEqual(E.orderPieces(ws, order), [{ a: 0, b: 4 }, { a: 8, b: 12 }, { a: 4, b: 8 }]);
  const segs = E.buildSegments(ws, S, {}, 100, order);
  assert.deepEqual(segs.map((s) => [s.start, s.end]), [[0, 3.8], [8, 11.8], [4, 7.8]]);
  assert.deepEqual(texts(ws, order), ['말0 말1 말2 말3.', '말8 말9 말10 말11.', '말4 말5 말6 말7.']);
  const lines = E.buildLines(ws, segs, S);
  for (let i = 1; i < lines.length; i++) assert.ok(lines[i].outStart >= lines[i - 1].outStart, '자막 시각은 출력 순서로 늘어난다');
  assert.ok(Math.abs(E.segmentsDuration(segs) - 3 * 3.8) < 1e-9, '길이는 그대로');
});

test('원본 시각 ↔ 출력 시각이 바뀐 순서를 따른다', () => {
  const ws = W(), segs = E.buildSegments(ws, S, {}, 100, [0, 8, 4]);
  assert.ok(Math.abs(E.srcToOut(segs, 9) - (3.8 + 1)) < 1e-9);
  assert.ok(Math.abs(E.srcToOut(segs, 5) - (7.6 + 1)) < 1e-9);
  assert.ok(Math.abs(E.outToSrc(segs, 3.8 + 1).t - 9) < 1e-9);
});

test('다시 제자리로 옮기면 순서 기록이 사라진다 (원본과 같음)', () => {
  const ws = W();
  const o1 = E.moveRange(ws, null, 8, 12, 4);
  assert.equal(E.moveRange(ws, o1, 8, 12, null), null, '맨 끝으로 돌려놓기');
  assert.equal(E.moveRange(ws, o1, 4, 8, 8), null, '둘째 문장을 셋째 앞으로 = 원래');
  assert.equal(E.moveRange(ws, null, 4, 8, 5), null, '자기 자신 안으로는 그대로');
});

test('맨 끝으로, 맨 앞으로', () => {
  const ws = W();
  assert.deepEqual(texts(ws, E.moveRange(ws, null, 0, 4, null)), ['말4 말5 말6 말7.', '말8 말9 말10 말11.', '말0 말1 말2 말3.']);
  assert.deepEqual(texts(ws, E.moveRange(ws, null, 8, 12, 0)), ['말8 말9 말10 말11.', '말0 말1 말2 말3.', '말4 말5 말6 말7.']);
});

test('여러 번 옮기기가 쌓인다', () => {
  const ws = W();
  let o = E.moveRange(ws, null, 8, 12, 0);          // 3 1 2
  const o2 = E.moveRange(ws, o, 4, 8, 0);           // 둘째를 첫째(0번 단어) 앞에 → 3 2 1
  assert.deepEqual(texts(ws, o2), ['말8 말9 말10 말11.', '말4 말5 말6 말7.', '말0 말1 말2 말3.']);
  o = E.moveRange(ws, o, 4, 8, 8);                  // 둘째를 셋째(맨 앞 칸) 앞에 → 2 3 1
  assert.deepEqual(texts(ws, o), ['말4 말5 말6 말7.', '말8 말9 말10 말11.', '말0 말1 말2 말3.']);
});

test('조각 경계에서는 문장이 이어져도 줄을 꼭 바꾼다 (다른 내용이 한 줄에 섞이지 않게)', () => {
  const ws = W().map((w) => ({ ...w, text: '말' + w.id }));   // 문장 끝 없음
  const order = E.moveRange(ws, null, 2, 3, 6);               // 말2 를 말6 앞으로
  const lines = texts(ws, order);
  const where = lines.findIndex((t) => t.split(' ').includes('말2'));
  assert.ok(where >= 0);
  assert.equal(lines[where].split(' ')[0], '말2', '옮긴 칸은 줄 처음에서 시작');
  assert.ok(!lines.some((t) => /말1 말2|말2 말3/.test(t)));
});

test('지운 단어·패딩·미세 조정은 조각 안에서 그대로', () => {
  const ws = W(); ws[9].del = true;
  const order = E.moveRange(ws, null, 8, 12, 4);
  const segs = E.buildSegments(ws, { padBefore: 0.1, padAfter: 0.1 }, { 'e:8': 8.6 }, 100, order);
  assert.deepEqual(segs.map((s) => [+s.start.toFixed(2), +s.end.toFixed(2)]), [[0, 3.9], [7.9, 8.6], [9.9, 11.9], [3.9, 7.9]]);
  assert.deepEqual([...new Set(segs.map((s) => s.piece))], [0, 1, 2]);
});

test('잘못된 순서 기록(없는 단어 id)은 무시하고 원본 순서', () => {
  const ws = W();
  assert.deepEqual(E.orderPieces(ws, [999, 'x']), [{ a: 0, b: 12 }]);
  assert.deepEqual(texts(ws, [999]), texts(ws, null));
});

test('순서를 바꾼 경계에서는 이웃 말소리가 새지 않게 패딩을 두 단어 사이 가운데까지만', () => {
  const ws = Array.from({ length: 8 }, (_, i) => ({ id: i, text: '말' + i + (i % 4 === 3 ? '.' : ''), start: i, end: i + 0.8 }));
  const pad = { padBefore: 0.3, padAfter: 0.3 };
  const order = E.moveRange(ws, null, 4, 8, 0);   // 둘째 문장을 앞으로
  const segs = E.buildSegments(ws, pad, {}, 100, order);
  assert.deepEqual(segs.map((s) => [+s.start.toFixed(2), +s.end.toFixed(2)]), [[3.9, 8.1], [0, 3.9]]);
  assert.ok(segs[0].start >= 3.8 + 0.1 - 1e-9 && segs[1].end <= 4 - 0.1 + 1e-9, '옮긴 칸 앞뒤 단어 소리가 섞이지 않는다');
  // 미세 조정으로 정한 값은 그대로
  const segs2 = E.buildSegments(ws, pad, { 'e:3': 4.05 }, 100, order);
  assert.equal(segs2[1].end, 4.05);
  // 원래 순서에서는 예전처럼 하나로 이어진다
  assert.deepEqual(E.buildSegments(ws, pad, {}, 100, null).map((s) => [s.start, s.end]), [[0, 7.8 + 0.3]]);
});
