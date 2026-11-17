// Electron ai.js 의 순수 부분(자막 줄이기·시스템 글·추천 요청 글·교정 요청 글)을 돌려 tests/fixtures/ai_cases.json 을 만든다.
// node tests/gen_ai.js <sermon-shorts-app 경로>
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');
const APP = process.argv[2] || 'F:/aside/sermon-shorts-app';
const origLoad = Module._load;
let TERMS = '';
Module._load = function (req) {
  if (req === './settings') return { loadSettings: () => ({ churchTerms: TERMS }) };
  return origLoad.apply(this, arguments);
};
const ai = require(path.join(APP, 'src/main/ai.js'));
const lines = [];
let t = 3.2;
const txt = ['여러분  안녕하십니까', '', '오늘 말씀은', '  마태복음 6장', '기도에 대한 말씀입니다', '우리가 기도할 때', '무엇을 구합니까?', '하나님은 들으십니다', '아멘'];
for (let i = 0; i < 40; i++) { lines.push({ start: Math.round(t * 100) / 100, text: txt[i % txt.length] }); t += 2.7 + (i % 5) * 1.3; }
lines.push({ start: 3725.5, text: '한 시간 넘은 줄' });
const out = { lines: lines.map((l) => [l.start, l.text]) };
out.compact = [8, 5, 20].map((b) => [b, ai.compactTranscript(lines, b)]);
// buildSystem 은 내보내지 않으므로 analyzeSermon 의 프롬프트를 callGemini 를 가로채 받는다
const sent = [];
ai.setKeyProvider(() => 'k');
global.fetch = async (url, o) => { sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"sermon":{},"candidates":[{"score":3},{"score":9},{"score":5}]}' }] } }], usageMetadata: { promptTokenCount: 5 } }) }; };
const optsList = [
  {}, { videoTitle: '주일 예배', description: '설명 '.repeat(200), churchName: '사랑교회', count: 3, minSec: 30, maxSec: 60, intensity: 5, types: ['story', 'nope', 'core'], audience: 'seekers', extra: '우영우 이야기' },
  { intensity: 0, audience: 'youth', types: [] }, { audience: 'weird', intensity: 2 },
];
(async () => {
  out.analyze = [];
  for (const [i, o] of optsList.entries()) {
    TERMS = i % 2 ? '구세군, 사관' : '';
    sent.length = 0;
    const r = await ai.analyzeSermon(lines, o);
    out.analyze.push({ opts: o, terms: TERMS, system: sent[0].systemInstruction.parts[0].text, prompt: sent[0].contents[0].parts[0].text, scores: r.candidates.map((c) => c.score), model: r.model, schema: sent[0].generationConfig.responseSchema });
  }
  sent.length = 0;
  global.fetch = async (url, o) => { sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }) }; };
  await ai.correctTerms([{ id: 3, text: '하나님' }, { id: 10, text: '"따옴표"' }], { title: '제목', scripture: '마 6:13' });
  out.correct = { words: [[3, '하나님'], [10, '"따옴표"']], title: '제목', scripture: '마 6:13', system: sent[0].systemInstruction.parts[0].text, prompt: sent[0].contents[0].parts[0].text, temp: sent[0].generationConfig.temperature };
  fs.writeFileSync(path.join(__dirname, 'fixtures', 'ai_cases.json'), JSON.stringify(out, null, 1));
  console.log('ai_cases.json', out.analyze.length);
})();