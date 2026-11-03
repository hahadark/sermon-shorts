'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/materials.js');

test('카드: 인스타 캡션·해시태그 정리 (# 붙이기·겹침·띄어쓰기)', () => {
  const d = M.normalize('cards', { cards: [{ headline: '평강이 지키십니다', body: '기도할 때' }], caption: '이번 주 말씀', hashtags: '#주일설교 말씀 묵상, #주일설교' });
  assert.deepStrictEqual(d.hashtags, ['#주일설교', '#말씀', '#묵상']);
  assert.strictEqual(d.caption, '이번 주 말씀');
  const t = M.toText('cards', d);
  assert.match(t, /\[인스타 캡션\]\n이번 주 말씀\n#주일설교 #말씀 #묵상/);
  const n = M.normalize('cardnews', { title: 't', slides: [{ heading: 'h', body: 'b' }], hashtags: ['#a b', '#c'] });
  assert.deepStrictEqual(n.hashtags, ['#ab', '#c']);
  assert.match(M.buildRequest('cardnews', M.normOptions({})), /hashtags/);
  assert.match(M.buildRequest('cards', M.normOptions({})), /caption/);
});

test('충실도 검사: 요청에 자료 글이 들어가고, 결과를 읽어 자료 속 위치를 확인', () => {
  const d = M.normalize('summary', { title: '염려를 기도로', oneline: '염려 대신 기도합니다', points: [{ heading: '하나', body: '메림나오는 찢긴 마음입니다' }] });
  const req = M.buildCheckRequest('summary', d);
  assert.match(req, /설교 요약/);
  assert.match(req, /\[자료\]/);
  assert.match(req, /신학적 옳고 그름/);
  const r = M.parseCheck('```json\n{"issues":[{"quote":"메림나오는 찢긴 마음입니다","problem":"설교에 없는 원어 풀이","fix":"빼기"},{"quote":"없는 문장","problem":"x"}]}\n```', d, 'summary');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.issues.length, 2);
  assert.strictEqual(r.issues[0].found, true);
  assert.strictEqual(r.issues[1].found, false);
  assert.strictEqual(M.parseCheck('{"issues":[]}', d, 'summary').ok, true);
  assert.throws(() => M.parseCheck('엉뚱한 답', d, 'summary'), /검사 결과/);
});
