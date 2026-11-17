// Electron 의 대화형 편집 순수 함수(src/shared/chat-plan.js, llm/index.js whisperWordsToLines)를 돌려
// tests/fixtures/chat_cases.json 을 만든다. node tests/gen_chat.js <sermon-shorts-app 경로>
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');
const APP = process.argv[2] || 'F:/aside/sermon-shorts-app';
const cp = require(path.join(APP, 'src/shared/chat-plan.js'));
// llm/index.js 는 electron 을 부르므로 가짜로 바꿔 끼운다
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return { ipcMain: { handle() {} }, shell: {}, app: { isPackaged: false, getPath: () => require('os').tmpdir() }, safeStorage: {} };
  return origLoad.apply(this, arguments);
};
const llm = require(path.join(APP, 'src/main/llm/index.js'));

// 꾸며 낸 설교 자막 (실제 설교 아님)
const TEXT = ('여러분 오늘 말씀은 마태복음 6장 13절입니다. 그 어 우리가 기도할 때 무엇을 구합니까? 시험에 들지 않게 해 달라고 구합니다. ' +
  '음 하나님은 우리를 악에서 구하시는 분이십니다! 그렇지 않습니까? 아멘. 이제 마무리하겠습니다. 기도란 시작도 하나님이요 끝도 하나님입니다. ' +
  '우리 삶의 모든 순간에 주님을 의지하십시오. 그러면 주님께서 “평안”을 주십니다. 오늘도 승리하시기를 축복합니다.').split(' ');
TEXT.push(...TEXT.slice(), ...TEXT.slice());
const words = [], lines = [];
let t = 3600 - 40.35;
for (let i = 0; i < TEXT.length; i++) {
  const w = TEXT[i];
  const st = Math.round(t * 1000) / 1000;
  const en = Math.round((t + 0.12 + w.length * 0.13) * 1000) / 1000;
  words.push({ text: w, start: st, end: en });
  t = en + (i % 7 === 6 ? 0.9 : 0.08);
}
for (let i = 0; i < words.length; i += 6) lines.push({ start: words[i].start, from: i, to: Math.min(words.length - 1, i + 5) });
const tryv = (f) => { try { return { ok: f() }; } catch (e) { return { err: e.code || 'error', msg: e.message }; } };

const out = { words, lines };
out.fmtTime = [0, 0.04, 9.96, 12.25, 12.35, 59.95, 61.05, 600.75, 3599.95, 3725.35, 4501.5, -3].map((x) => [x, cp.fmtTime(x)]);
out.transcript = [null, { start: 3570, end: 3590 }, { start: 0, end: 10 }].map((r) => ({ range: r, out: cp.transcriptText(words, lines, r) }));
out.system = [{}, { church: '사랑교회', speaker: '홍길동 목사', terms: '구세군, 영문, 사관', videoTitle: '주일 예배' }, { church: '', speaker: '김사관' }]
  .map((c) => ({ ctx: c, out: cp.buildSystemPrompt(c) }));
const cur = { title: '기도의\n시작', verse: '마태복음 6:13', tighten: 'normal', segments: cp.describeRanges([{ from: 2, to: 40 }, { from: 45, to: 50 }], words), remainingQuestions: cp.questionsIn([{ from: 0, to: 30 }], words) };
out.user = [
  { req: '결론 위주로 2분', cur: null, dur: 0 },
  { req: '더 짧게 "따옴표"', cur, dur: 92.5 },
  { req: '질문만', cur, dur: 61.49 },
].map((c) => ({ ...c, out: cp.buildUserMessage(c.req, { current: c.cur, durationSec: c.dur }) }));
out.repair = ['{"a": "줄\n바꿈\t탭", "b": [1,2,],}', '{“reply”: “똑똑한 따옴표”}', '{"a":1, // 주석\n"b":"x // 문자열 안"}', '{"s":"끝, ]"}', '{"a":"\\"이스케이프\\""}']
  .map((s) => [s, cp.repairJson(s)]);
const answers = [
  '{"reply":"했습니다","title":"기도의\\n시작","verse":"마태복음 6:13","sermon":{"from":0,"to":60},"segments":[{"from":2,"fromText":"오늘","to":20,"toText":"구합니다."},{"from":40,"to":44}],"corrections":[{"id":5,"text":"고침"},{"id":999,"text":"x"},{"id":3}],"tighten":"strong"}',
  '설명입니다\n```json\n{"reply":"코드 블록", "segments":[{"from":"10","to":"15"}],}\n```\n끝',
  '{"reply": "줄\n바꿈", "title": 12, "tighten": "fast", "segments": [{"from": 30, "to": 25, "fromText": "축복합니다."}, {"to": 3}], "candidates": [1, {"title":" 후보 하나 ","from":5,"to":30,"summary":"요약","why":"까닭"}, {"from":40,"to":42}, {"title":"후보 둘\n줄","from":50,"to":10,"fromText":"기도란","toText":"주님을"}]}',
  '그냥 글만 있는 답',
  '{"reply": "깨진" "json"}',
  '{"reply":null,"title":null,"verse":null,"segments":null,"sermon":null}',
  '[1,2]',
  '{"reply":0,"title":"","segments":[{"from":0,"to":0,"fromText":"없는말","toText":"여러분"},{"from":12.5,"to":14.4},{"from":13,"to":60}]}',
];
out.plans = answers.map((a) => {
  const p = tryv(() => cp.parsePlan(a));
  const r = { text: a, plan: p };
  if (p.ok) {
    r.resolved = cp.resolvePlan(p.ok, words);
    r.candidates = cp.resolveCandidates(p.ok.candidates, words);
  }
  return r;
});
const prefsList = [
  {}, { length: 120 }, { length: 90, gaps: true }, { length: 60, gaps: true, contents: ['story', 'core', 'nope'], audience: 'seekers', intensity: 4 },
  { length: 150, audience: 'all', intensity: 0, tight: true, filler: true, questions: true, notices: true, gaps: true, ending: true, count: 5 },
  { audience: 'youth', intensity: 2.6, count: 9, contents: [] }, { length: '180', count: '4', questions: false },
];
const keys = ['recommend', 'again', 'make', 'pick', 'length', 'tight', 'filler', 'questions', 'notices', 'shorter', 'longer', 'ending', 'title', 'typos', 'nope'];
const args = { pick: { no: 2, from: 120, to: 340, title: '하나님의\n 평안' }, length: 90 };
out.prefs = prefsList.map((p) => ({ prefs: p, cond: cp.buildConditions(p), sum: cp.conditionsSummary(p), count: cp.countOf(p),
  actions: keys.map((k) => [k, args[k] == null ? null : args[k], cp.actionRequest(k, p, args[k])]).concat([['length', 0, cp.actionRequest('length', p, 0)], ['pick', { no: 1, from: 3, to: 9 }, cp.actionRequest('pick', p, { no: 1, from: 3, to: 9 })]]) }));
out.fmtLen = [0, -5, 9.4, 59.5, 60, 61, 90, 120.4, 3600, 3661].map((x) => [x, cp.fmtLen(x)]);
out.withRo = ['2분', '1분 30초', '3분', 'abc', '10초', '물', '말'].map((x) => [x, cp.withRo(x)]);
const rg = [{ from: 0, to: 30 }, { from: 33, to: words.length - 1 }];
out.ranges = { ranges: rg, dur: cp.rangesDuration(rg, words), desc: cp.describeRanges(rg, words), qs: cp.questionsIn(rg, words) };
const raw = [{ text: ' 여러분 ', start: 1, end: 1.2 }, { text: '오늘', start: 1.25, end: 1.24 }, { text: '', start: 2, end: 3 }, { text: '말씀은', start: 2.1 }, { text: '좋습니다.', start: 2.2, end: 2.6 },
  { text: '그런데', start: 3.5, end: 3.8 }].concat(Array.from({ length: 20 }, (_, i) => ({ text: '단어' + i, start: 4 + i * 0.3, end: 4.2 + i * 0.3 })));
out.whisper = { raw, out: llm.whisperWordsToLines(raw) };
fs.writeFileSync(path.join(__dirname, 'fixtures', 'chat_cases.json'), JSON.stringify(out, null, 1));
console.log('chat_cases.json', out.plans.length, 'plans', out.prefs.length, 'prefs');
process.exit(0);
