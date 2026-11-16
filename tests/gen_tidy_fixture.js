// 자동 정리 계산 비교 자료: Electron 의 disfluency.js · gaps.js · silence.js 로 만든 결과
const D = require('F:/aside/sermon-shorts-app/src/shared/disfluency.js');
const G = require('F:/aside/sermon-shorts-app/src/shared/gaps.js');
const E = require('F:/aside/sermon-shorts-app/src/shared/edl.js');
const S = require('F:/aside/sermon-shorts-app/src/main/silence.js');
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('F:/aside/sermon-shorts-app/cache/theme_check/words_4955.json', 'utf8'));
const words0 = (Array.isArray(raw) ? raw : raw.words).map((w, i) => ({ ...w, id: i, del: !!w.del }));
const texts = ['음', '음...', '어', '어어', '아', '그', '그...', '그…', '이~', '저기', '엉', '음,', '하나님', '그리고', '흠흠', '으음', '에헴', '뭐', '뭐…', '(음)', ' 아 '];
const settings = { padBefore: 0.1, padAfter: 0.15, fadeMs: 10, maxLineChars: 14, splitLongWords: true, semanticBreaks: true };
const cases = [];
// 무음 목록: 단어 사이 틈마다 (일부는 구간 끝·앞), 무작위 대신 정해진 흔들림
function silencesFor(words) {
  const out = [];
  for (let i = 1; i < words.length; i++) { const g = words[i].start - words[i - 1].end; if (g > 0.12) out.push({ start: words[i - 1].end + 0.02 * (i % 3), end: words[i].start - 0.015 * (i % 4) }); }
  out.push({ start: words[0].start - 0.6, end: words[0].start + 0.05 });
  return out;
}
for (const [name, mut] of [['plain', () => {}], ['delEvery7', (w) => w.forEach((x, i) => { if (i % 7 === 3) x.del = true; })], ['cut', (w) => { w[20].cutBefore = true; w[40].cutBefore = true; }]]) {
  const words = JSON.parse(JSON.stringify(words0)); mut(words);
  const segs = E.buildSegments(words, settings, {}, 145, null);
  const sil = silencesFor(words);
  cases.push({ name, words, segs, silences: sil,
    pauses: D.pauses(words, segs, 0.5),
    timing: D.gapCutsByTiming(words, segs, { minGap: 0.3, padBefore: 0.08, padAfter: 0.12 }),
    plan1: G.planGapCuts(words, segs, sil, { padBefore: 0.08, padAfter: 0.12, minCut: 0.15 }),
    plan2: G.planGapCuts(words, segs, sil, { padBefore: 0.05, padAfter: 0.07, minCut: 0.08 }) });
}
const log = '[silencedetect @ 0x1] silence_start: 1.234\n[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.266\nfoo\n[silencedetect @ 0x1] silence_start: -0.01\n[silencedetect @ 0x1] silence_end: 0.4 | x\n[silencedetect @ 0x1] silence_start: 9.75\n mean_volume: -23.4 dB\n';
fs.writeFileSync('tests/fixtures/tidy_cases.json', JSON.stringify({
  fillers: texts.map((t) => ({ text: t, filler: D.isFiller(t), core: D.core(t) })),
  cases,
  log, parsed: S.parseSilences(log, 3, 10), parsedNoDur: S.parseSilences(log, 0, null), mean: S.parseMeanVolume(log),
  floors: [null, -10, -20, -23.4, -40, -70].map((m) => ({ mean: m, floor: S.noiseFloorFor(m) })),
}, null, 1));
console.log('cases', cases.length, 'plan1 cuts', cases.map((c) => c.plan1.cuts).join(','), 'timing cuts', cases.map((c) => c.timing.cuts).join(','));
