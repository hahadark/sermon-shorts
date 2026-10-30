'use strict';
// 교인 자료 새 종류: 카드뉴스 · 소그룹 리더 가이드 · 설교 PPT, 홈페이지 말씀 요약 글
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/materials.js');

test('새 종류 3가지가 목록·옵션에 있다', () => {
  for (const id of ['cardnews', 'leader', 'slides']) assert.ok(M.typeOf(id), id);
  const o = M.normOptions({ newsCount: 7, leaderTime: 45, slideCount: 99 });
  assert.strictEqual(o.newsCount, 7); assert.strictEqual(o.leaderTime, 45); assert.strictEqual(o.slideCount, 8);
  assert.match(M.buildRequest('cardnews', { newsCount: 7 }), /7장.*가운데 5장/);
  assert.match(M.buildRequest('leader', { leaderTime: 45 }), /45분/);
  assert.match(M.buildRequest('slides', {}), /16:9/);
});

test('카드뉴스: 강조 구절이 본문에 없으면 지운다', () => {
  const d = M.parse('cardnews', JSON.stringify({ title: 't', slides: [{ heading: 'h', body: '하나님의 나라는 우리 안에', highlight: '우리 안에' }, { heading: 'h2', body: 'abc', highlight: '없는 말' }], action: 'a' }));
  assert.strictEqual(d.slides[0].highlight, '우리 안에');
  assert.strictEqual(d.slides[1].highlight, '');
  assert.match(M.toText('cardnews', d, {}), /\[이번 주 실천\] a/);
});

test('리더 가이드: 분·질문 정리와 글 복사', () => {
  const d = M.parse('leader', JSON.stringify({ title: 't', flow: [{ part: '마음 열기', minutes: '10', guide: 'g' }, { part: '나눔', minutes: -3 }], questions: ['질문만 글자로', { q: 'Q', intent: 'i', expected: 'e' }], tips: ['팁'] }));
  assert.deepStrictEqual(d.flow.map((f) => f.minutes), [10, 0]);
  assert.strictEqual(d.questions[0].q, '질문만 글자로');
  const t = M.toText('leader', d, {});
  assert.match(t, /의도: i/); assert.match(t, /예상 답: e/); assert.match(t, /\[진행 팁\]/);
  assert.throws(() => M.parse('leader', JSON.stringify({ title: 't', questions: [] })), /비어/);
});

test('설교 PPT: 줄은 4개까지, 빈 장은 뺀다', () => {
  const d = M.parse('slides', JSON.stringify({ title: 't', slides: [{ heading: 'a', lines: ['1', '2', '3', '4', '5'] }, { heading: '', lines: [] }], closing: 'c' }));
  assert.strictEqual(d.slides.length, 1); assert.strictEqual(d.slides[0].lines.length, 4);
});

test('홈페이지 글: 앞머리·날짜·예배 종류, 묵상 질문 없이', () => {
  const d = M.normalize('summary', { title: 't', verse: '행 6:1-7', theme: '원망이 "섬김"으로', points: [{ heading: '하나', body: '내용' }], application: '적용', prayer: '기도문' });
  const h = M.toHomepage(d, { title: '식탁에서 / *빠진* 사람들', date: '2026. 10. 30', speaker: '김택근 사관', service: 'friday' });
  assert.strictEqual(h.name, '2026-10-30-friday.md');
  assert.match(h.text, /^---\ntitle: "식탁에서 빠진 사람들"\ndate: 2026-10-30\nservice: friday\npassage: "행 6:1-7"\npreacher: "김택근 사관"\nsummary: "원망이 \\"섬김\\"으로"\npublished: false\n---\n/);
  assert.match(h.text, /### 하나\n\n내용/);
  assert.doesNotMatch(h.text, /기도문|질문/);
  assert.strictEqual(M.isoDate('2026년 1월 4일'), '2026-01-04');
});
