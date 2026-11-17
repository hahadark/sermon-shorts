// Electron 의 교인 자료 순수 함수(src/shared/materials.js)를 돌려 tests/fixtures/materials_cases.json 을 만든다.
// node tests/gen_materials.js <sermon-shorts-app 경로>
'use strict';
const path = require('path');
const fs = require('fs');
const APP = process.argv[2] || 'F:/aside/sermon-shorts-app';
const M = require(path.join(APP, 'src/shared/materials.js'));
const tryv = (f) => { try { return { ok: f() }; } catch (e) { return { err: e.message }; } };

const ids = M.TYPES.map((t) => t.id);
const out = { types: M.TYPES.map((t) => [t.id, t.label, t.kind]) };
// 선택지
const optList = [{}, { audience: '청소년', smallgroup: '공부형', qtDays: 3, qtFocus: '본문 중심', qtForm: '적용형', quiz: 'OX', summary: '길게', cardTone: '위로', cardCount: 5, newsCount: 8, leaderTime: 90, slideCount: 12 },
  { audience: '없는값', qtDays: '5', cardCount: 9, quiz: '객관식', summary: '짧게', qtFocus: '확장 묵상', qtForm: '기본형', slideCount: 4, newsCount: 4 }];
out.options = optList.map((o) => ({ o, norm: M.normOptions(o), req: ids.map((t) => M.buildRequest(t, o)) }));
out.system = [
  { church: '사랑교회', title: '하나님 *중심의* / 기도', verse: '마 6:13', speaker: '홍길동', date: '2026년 11월 15일', options: { audience: '어린이' }, sermon: '  설교 본문 ' + '가'.repeat(30) },
  { sermon: '' }, { title: '제목만', options: { audience: '유아·유치' } },
].map((c) => ({ ctx: c, out: M.buildSystem(c) }));
// AI 답
const raw = {
  summary: ['{"title":"제목","verse":"롬 1:16","theme":"핵심","points":[{"heading":"첫째","body":"내용\\n둘째 줄"},{"heading":"","body":""},null,"문자열",{"body":"본문만"}],"application":"적용","prayer":"기도"}',
    '```json\n{"title":12,"points":[],"theme":""}\n```', '{"points":[{"heading":"' + '가'.repeat(100) + '"}],}'],
  smallgroup: ['{"title":"소그룹","questions":["문자열 질문",{"q":"객체 질문","note":"도움말"},{"q":""},{"note":"q 없음"}],"summary":"요약","icebreaker":"얼음","action":"실천","prayer":"기도"}', '{"questions":[]}'],
  qt: ['{"title":"QT","days":[{"day":9,"title":"첫날","passage":"마 6:1-4","meditation":"묵상","keyline":"한 줄","question":"질문","action":"","prayer":"기도"},{"title":"둘째"},null]}'],
  quiz: ['{"title":"퀴즈","items":[{"type":"ox","q":"문제1","answer":"x","explain":"해설"},{"type":"mc","q":"문제2","choices":["가","나","다","라","마","바"],"answer":"3번","explain":"e"},{"q":"문제3","choices":["a","b"],"answer":7},{"q":"문제4","answer":"O"},{"q":""},null,{"type":"mc","q":"문제5","choices":["1","2"],"answer":2.9}]}'],
  cards: ['{"cards":[{"headline":"카드1","body":"본문","source":"마 6:13"},{"headline":"","body":""},{"body":"본문만"}],"caption":"캡션","hashtags":["#주일 설교","말씀묵상","#주일설교","", "#' + 'a'.repeat(31) + '","!특수?"]}',
    '{"cards":[{"headline":"하나"}],"hashtags":"#가 나, 다 #가"}'],
  family: ['{"title":"가정","verse":"창 1:1","opening":"찬양","story":"이야기","questions":["질문1","",null,"질문2"],"activity":"활동","prayer":"기도","blessing":"축복"}', '{"story":""}'],
  cardnews: ['{"title":"표지","subtitle":"부제","verse":"요 3:16","slides":[{"heading":"하나","body":"하나님은 세상을 사랑하셨다","highlight":"세상을 사랑"},{"heading":"둘","body":"본문","highlight":"없는 말"},{}],"action":"실천","closing":"마무리","caption":"캡","hashtags":["#a"]}'],
  leader: ['{"title":"리더","verse":"마 5","goal":"목표","prepare":"준비","flow":[{"part":"열기","minutes":"10분","guide":"g"},{"part":"","guide":""},{"part":"나눔","minutes":300}],"questions":["문자열",{"q":"q2","intent":"i","expected":"e","followup":"f"}],"tips":["팁1",""],"prayer":"기도"}'],
  slides: ['{"title":"PPT","verse":"마 6","slides":[{"heading":"h1","lines":["l1","","l2","l3","l4","l5"],"ref":"r"},{"heading":"","lines":[]},{"lines":["only"]}],"closing":"끝"}', 'JSON 없음'],
};
out.parse = [];
for (const t of Object.keys(raw)) for (const r of raw[t]) out.parse.push({ type: t, text: r, out: tryv(() => M.parse(t, r)) });
// 직접 normalize (이상한 입력)
out.normalize = [];
for (const t of ids) for (const o of [null, 5, 'x', [], { title: null, verse: undefined }]) out.normalize.push({ type: t, o, out: M.normalize(t, o) });
// 글로 바꾸기
const metas = [{}, { church: '사랑교회' }];
out.text = [];
for (const p of out.parse) if (p.out.ok) for (const m of metas) out.text.push({ type: p.type, d: p.out.ok, meta: m, out: M.toText(p.type, p.out.ok, m) });
out.tags = [['#a #b', 'x'], [null], [['#가', '#가', '나다']], ['a,b,,c d']].map((a) => [a[0], M.tags(a[0])]);
out.sermonText = M.sermonText([{ text: '안녕하세요.', start: 0, end: 1 }, { text: '오늘', start: 3, end: 3.4 }, null, { text: '' }].concat(Array.from({ length: 30 }, (_, i) => ({ text: '말' + i + (i === 27 ? '.' : ''), start: 4 + i * 0.3, end: 4.2 + i * 0.3 }))).concat([{ text: '끝', start: 20, end: 20.5 }]));
out.sermonWords = null;
out.iso = ['2026년 11월 5일', '2026-1-2', '2026.12.25', ' 2026 - 03 - 4 '].map((s) => [s, M.isoDate(s)]);
const sum = out.parse.find((p) => p.type === 'summary' && p.out.ok).out.ok;
out.home = [{ title: '제목 *강조* / 둘', date: '2026년 11월 15일', service: 'friday', series: '시리즈', verse: '롬 1', speaker: '홍길동' }, { date: '2026-11-15', service: 'nope' }].map((m) => ({ meta: m, d: sum, out: M.toHomepage(sum, m) }));
out.check = ids.map((t) => { const p = out.parse.find((x) => x.type === t && x.out.ok); return p ? { type: t, d: p.out.ok, req: M.buildCheckRequest(t, p.out.ok) } : null; }).filter(Boolean);
const chk = '```json\n{"issues":[{"quote":"핵심","problem":"설교에 없음","fix":"빼기"},{"quote":"없는 문장","problem":"p2","fix":""},{"quote":"x","problem":""},null]}\n```';
out.parseCheck = (() => { const r = M.parseCheck(chk, sum, 'summary'); delete r.at; return { text: chk, out: r }; })();
// 아래 sermonWords 는 Rust 쪽에서 같은 단어로 다시 만든다
fs.writeFileSync(path.join(__dirname, 'fixtures', 'materials_cases.json'), JSON.stringify(out, null, 1));
console.log('materials_cases.json', out.parse.length, 'parse', out.text.length, 'text');
