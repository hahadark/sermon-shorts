'use strict';
// 교인 자료: AI 답 읽기·모양 맞추기·글로 바꾸기, Word 파일 글 꺼내기
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/materials.js');

test('종류·선택지 기본값 (만나로와 같은 기본: 장년·나눔형·5일·혼합형·묵상형)', () => {
  assert.deepEqual(M.TYPES.map((t) => t.id), ['smallgroup', 'qt', 'quiz', 'summary', 'cards', 'family', 'cardnews', 'leader', 'slides']);
  const o = M.normOptions({ qtDays: 9, audience: '청년', cardCount: 2 });
  assert.equal(o.qtDays, 5); assert.equal(o.audience, '청년'); assert.equal(o.cardCount, 2); assert.equal(o.smallgroup, '나눔형');
});
test('지시문에 설교·원칙·대상·JSON 모양', () => {
  const sys = M.buildSystem({ church: '대구사랑영문', title: '하나님 중심의 *기도* / 결론', verse: '마태복음 6:13', sermon: '오늘 말씀은 ...', options: { audience: '청소년' } });
  assert.match(sys, /설교 제목: 하나님 중심의 기도 결론/);
  assert.match(sys, /청소년/);
  assert.match(sys, /\[설교\]\n오늘 말씀은/);
  for (const t of M.TYPES) assert.match(M.buildRequest(t.id, { qtDays: 3, cardCount: 4 }), /JSON:/);
  assert.match(M.buildRequest('qt', { qtDays: 3 }), /^3일치/);
});
test('코드 블록·줄바꿈 섞인 답 읽기와 빠진 칸 채우기', () => {
  const ans = '자료입니다\n```json\n{"title":"기도의 결론","points":[{"heading":"나라","body":"첫째\n줄"}],"theme":"아멘으로 응답합니다",}\n```';
  const d = M.parse('summary', ans);
  assert.equal(d.points[0].body, '첫째\n줄');
  assert.equal(d.application, '');
  const q = M.parse('quiz', '{"items":[{"type":"ox","q":"아멘은 진실로라는 뜻이다","answer":"o"},{"q":"주기도문은 몇 장?","choices":["5","6","7","8"],"answer":"2"}]}');
  assert.deepEqual(q.items.map((x) => [x.type, x.answer]), [['ox', 'O'], ['mc', 2]]);
  assert.throws(() => M.parse('cards', '{"cards":[]}'), /비어/);
  assert.throws(() => M.parse('summary', '그냥 글'), /읽지 못했/);
});
test('카톡용 글', () => {
  const t = M.toText('smallgroup', M.normalize('smallgroup', { title: '나눔', questions: [{ q: '첫 질문' }, '둘째 질문'], action: '매일 기도' }), { church: '우리 교회' });
  assert.match(t, /^우리 교회\n■ 나눔/);
  assert.match(t, /Q2\. 둘째 질문/);
  assert.match(t, /\[이번 주 실천\] 매일 기도/);
});
test('자막 단어 → 문단', () => {
  const w = [{ text: '하나님은', start: 0, end: .5 }, { text: '사랑입니다.', start: .6, end: 1 }, { text: '그리고', start: 3, end: 3.3 }];
  assert.equal(M.sermonText(w), '하나님은 사랑입니다.\n그리고');
});
test('Word(.docx) 파일에서 글 꺼내기', () => {
  // 작은 docx 를 직접 만든다 (zip: word/document.xml 하나, deflate)
  const zlib = require('zlib');
  const xml = Buffer.from('<w:document><w:body><w:p><w:r><w:t>첫 문단 &amp; 은혜</w:t></w:r></w:p><w:p><w:r><w:t>둘째</w:t></w:r></w:p></w:body></w:document>', 'utf8');
  const data = zlib.deflateRawSync(xml), name = Buffer.from('word/document.xml');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(xml.length, 22); local.writeUInt16LE(name.length, 26);
  const cdOff = 30 + name.length + data.length;
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(xml.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOff, 16);
  const buf = Buffer.concat([local, name, data, cd, name, end]);
  // electron 없이 함수만 불러 쓰기
  const Module = require('module'); const orig = Module._load;
  Module._load = function (req, ...rest) { if (req === 'electron') return { ipcMain: { handle() {} }, dialog: {}, BrowserWindow: function () {}, shell: {}, app: { isPackaged: false, getPath: () => require('os').tmpdir() } }; return orig.call(this, req, ...rest); };
  try { const { docxText } = require('../src/main/materials.js'); assert.equal(docxText(buf), '첫 문단 & 은혜\n둘째'); }
  finally { Module._load = orig; }
});
