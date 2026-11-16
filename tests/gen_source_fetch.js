// 원본 다시 받기 순수 함수 비교용 기준값 (Electron src/shared/source-fetch.js · chat-plan.js · llm/clips.js 를 그대로 돌린다)
//   node tests/gen_source_fetch.js [실제 json3 경로]
//   → tests/fixtures/source_fetch_cases.json (합성 자료), target/sf_real.json (실제 자막, 저장소에 넣지 않음)
'use strict';
const fs = require('fs');
const path = require('path');
const APP = 'F:/aside/sermon-shorts-app';
const SF = require(APP + '/src/shared/source-fetch.js');
const CP = require(APP + '/src/shared/chat-plan.js');
const { clusterRanges } = (() => { try { return require(APP + '/src/main/llm/clips.js'); } catch (_) {
  // clips.js 는 Electron 모듈을 부르므로 순수 함수만 복사해 쓴다 (같은 코드)
  return { clusterRanges: function (spans, gap = 45, pad = 2) {
    const s = spans.map((x) => ({ start: Math.max(0, x.start - pad), end: x.end + pad })).sort((a, b) => a.start - b.start);
    const out = [];
    for (const r of s) { const last = out[out.length - 1]; if (last && r.start - last.end < gap) last.end = Math.max(last.end, r.end); else out.push({ ...r }); }
    return out;
  } };
} })();

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const r2 = (x) => Math.round(x * 1000) / 1000;

// ---- 합성 json3 ----
const texts = ['그러한 삶을 살았으면', '좋겠습니다.', '>> 아멘', '하나님은  우리를\n사랑하십니다', '예수 그리스도', 'God is love 123', '😀 기쁨', '', '  ', '세상 사람들이 다 알고 있는', '말씀을 붙들고', '기도합시다'];
function synthJson3(n) {
  const events = [];
  let t = 1000;
  for (let i = 0; i < n; i++) {
    const segs = [];
    const k = 1 + Math.floor(rnd() * 4);
    for (let s = 0; s < k; s++) segs.push(rnd() < 0.15 ? { utf8: texts[Math.floor(rnd() * texts.length)] } : { utf8: texts[Math.floor(rnd() * texts.length)], tOffsetMs: Math.floor(rnd() * 3000) });
    const ev = { tStartMs: t, dDurationMs: Math.floor(1500 + rnd() * 4000), segs };
    if (rnd() < 0.08) delete ev.segs;
    if (rnd() < 0.05) delete ev.dDurationMs;
    events.push(ev);
    t += Math.floor(800 + rnd() * 3500);
  }
  return { events };
}

// ---- 예전 AI 대화 편집 흉내: 자막 단어 몇 조각을 이어 붙인 파일 시각 ----
function fakeClipWords(subs, pieces) {
  const words = [];
  let f0 = 0;
  for (const [from, to, jitter] of pieces) {
    const src0 = subs[from].start - 1.5;
    for (let i = from; i <= to && i < subs.length; i++) {
      const w = subs[i];
      const j = jitter ? (rnd() - 0.5) * 0.1 : 0;
      const garble = rnd() < 0.08;
      words.push({ id: words.length, text: garble ? '고친말' : w.text, sttText: garble && rnd() < 0.5 ? '다른말' : w.text, start: r2(f0 + (w.start - src0) + j), end: r2(f0 + (w.end - src0) + j), del: rnd() < 0.1 });
    }
    f0 += (subs[Math.min(to, subs.length - 1)].end - src0) + 1.0;
  }
  return words;
}

function build(json3) {
  const out = {};
  const { words: subs, lines } = CP.wordsFromJson3(json3);
  out.json3 = json3;
  out.subWords = subs.map((w) => ({ text: w.text, start: w.start, end: w.end }));
  out.subLines = lines;
  // 되찾기
  out.recover = [];
  const N = subs.length;
  const mk = (pieces) => { const words = fakeClipWords(subs, pieces); return { words, map: SF.recoverClipMap(words, out.subWords) }; };
  if (N > 60) {
    out.recover.push(mk([[5, 40, false]]));
    out.recover.push(mk([[5, 30, true], [Math.floor(N / 2), Math.floor(N / 2) + 25, false]]));
    out.recover.push(mk([[2, 12, false], [30, 45, true], [N - 30, N - 2, false]]));
    out.recover.push(mk([[0, 3, false]]));
    out.recover.push({ words: [], map: SF.recoverClipMap([], out.subWords) });
  }
  return out;
}

const fx = {};
fx.synthetic = build(synthJson3(400));
// plan
const sources = [
  { path: '/c/yt/x/part_100_200.mp4', url: 'https://youtu.be/x', offset: 92.4, duration: 116, fetch: { kind: 'part', start: 100, end: 200 } },
  { path: '/c/chat/clips_ab.mp4', url: 'u', offset: 0, fetch: { kind: 'clips', spans: [{ start: 10, end: 20 }, { start: 5, end: 4 }], map: [{ src0: 8, src1: 23, file0: 0 }, { src0: 30, src1: 29, file0: 2 }] } },
  { path: '/c/yt/x/part_100_200.mp4', url: 'u', offset: 92.4, duration: 116 },
  { path: '/c/yt/x/part_100_200.mp4', url: 'u', offset: 92.4 },
  { path: '/c/chat/clips_0123abcd.mp4', url: 'u', offset: 0 },
  { path: '/c/yt/x/part_98_230.mp4', url: 'u', offset: 0 },
  { path: 'C:\\c\\yt\\x\\PART_98_230.MP4', url: ' u ', offset: -3 },
  { path: '/c/yt/x/x_full.mp4', url: 'u', offset: 0, duration: 3600 },
  { path: '/c/yt/x/x_full.mp4', url: 'u', offset: 12.5 },
  { path: '/Users/me/설교.mp4', offset: 0 },
  { path: '/c/yt/x/part_1_2.mp4', url: 'u', offset: '5', duration: -1, fetch: { kind: 'section', start: 10, end: 5 } },
  { path: '/c/yt/x/a.mp4', url: 'u', offset: 1403.9666666666667, duration: 63.767007, fetch: { kind: 'section', start: 1415, end: 1450 } },
  { path: '/c/yt/x/a.mp4', url: 'u', offset: 1500, fetch: { kind: 'part', start: 1415, end: 1450 } },
  { path: '/c/yt/x/a.mp4', url: 'u', fetch: { kind: 'clips', spans: [], map: [{ src0: 1, src1: 2, file0: 0 }] } },
  {},
];
fx.plan = sources.map((s) => ({ source: s, plan: SF.plan(s), fetch: SF.normalizeFetch(s.fetch) }));
// 지도 변환
const maps = [[{ src0: 92.4, src1: 208.4, file0: 0 }], [{ src0: 100, src1: 120, file0: 0 }, { src0: 300, src1: 330, file0: 20 }, { src0: 500, src1: 505, file0: 50 }]];
fx.maps = maps.map((m) => { const ts = []; for (let i = 0; i < 60; i++) ts.push(r2(-10 + rnd() * 600)); ts.push(0, 20, 20.0005, 50, 55, 55.002, 100, 120.001, 300, 505.0009); return { map: m, f2s: ts.map((t) => [t, SF.fileToSrcByMap(m, t)]), s2f: ts.map((t) => [t, SF.srcToFileByMap(m, t)]) }; });
// spansFromWords · remapProject
const words = []; let t = 0;
for (let i = 0; i < 120; i++) { t += rnd() < 0.08 ? 4 + rnd() * 30 : 0.1 + rnd() * 0.6; const d = 0.1 + rnd() * 0.5; words.push({ id: i, text: 'w' + i, start: r2(t), end: r2(t + d) }); t += d; }
words.push({ id: 999, text: 'x', start: 'a', end: 3 });
fx.spans = maps.map((m) => SF.spansFromWords(words, (f) => SF.fileToSrcByMap(m, f)));
const overrides = { 's:3': 1.25, 'e:3': 1.9, 's:40': 30.5, 'x': 'str', 'n': null };
fx.remap = [
  { oldOff: 92.4, newOff: 94.1 },
  { oldOff: 0, newOff: 0, cut: 40 },
].map(({ oldOff, newOff, cut }) => {
  const data = { words, overrides, playhead: 11.5, other: { a: 1 } };
  const f2s = (f) => f + oldOff;
  const s2f = cut ? (s) => (s < cut ? s - newOff : null) : (s) => s - newOff;
  return { oldOff, newOff, cut: cut || null, result: SF.remapProject(data, f2s, s2f) };
});
fx.remapData = { words, overrides, playhead: 11.5, other: { a: 1 } };
// 구간 묶기
const sp = []; for (let i = 0; i < 25; i++) { const a = r2(rnd() * 3000); sp.push({ start: a, end: r2(a + 1 + rnd() * 60) }); }
fx.cluster = { spans: sp, out: clusterRanges(sp), outGap: clusterRanges(sp, 10, 0.5) };

fs.writeFileSync(path.join(__dirname, 'fixtures', 'source_fetch_cases.json'), JSON.stringify(fx));
console.log('합성: 자막 단어', fx.synthetic.subWords.length, '줄', fx.synthetic.subLines.length, '되찾기', fx.synthetic.recover.map((r) => (r.map ? r.map.length : 'null')).join(','));
const real = process.argv[2];
if (real && fs.existsSync(real)) {
  const r = build(JSON.parse(fs.readFileSync(real, 'utf8')));
  fs.writeFileSync(path.join(__dirname, '..', 'target', 'sf_real.json'), JSON.stringify(r));
  console.log('실제: 자막 단어', r.subWords.length, '줄', r.subLines.length, '되찾기', r.recover.map((x) => (x.map ? x.map.length : 'null')).join(','));
}
