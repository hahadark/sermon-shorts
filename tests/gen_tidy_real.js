// Electron tidy.js 와 같은 순서로 (군말 → 되풀이 → 소리로 공백) 정리한 결과를 쓴다
const D = require('F:/aside/sermon-shorts-app/src/shared/disfluency.js');
const G = require('F:/aside/sermon-shorts-app/src/shared/gaps.js');
const E = require('F:/aside/sermon-shorts-app/src/shared/edl.js');
const S = require('F:/aside/sermon-shorts-app/src/main/silence.js');
const fs = require('fs');
const guard = require('F:/aside/sermon-shorts-app/src/main/fs-guard.js');
(async () => {
  const src = 'F:/aside/sermon-shorts-app/cache/yt/uSE5pZB3gtQ/part_4955_5100.mp4';
  if (guard.allowFile) guard.allowFile(src);
  const raw = JSON.parse(fs.readFileSync('F:/aside/sermon-shorts-app/cache/theme_check/words_4955.json', 'utf8'));
  const words = (Array.isArray(raw) ? raw : raw.words).map((w, i) => ({ ...w, id: i, del: !!w.del }));
  const settings = { padBefore: 0.1, padAfter: 0.15, fadeMs: 10, maxLineChars: 14, splitLongWords: true, semanticBreaks: true };
  let overrides = {};
  let fillers = 0, dups = 0;
  words.forEach((w) => { if (!w.del && D.isFiller(w.text)) { w.del = true; fillers++; } });
  let prev = -1;
  for (let i = 0; i < words.length; i++) { const w = words[i]; if (w.del) continue; if (prev >= 0) { const a = D.core(words[prev].text), b = D.core(w.text); if (a && a === b && w.start - words[prev].end < 1) { words[prev].del = true; dups++; } } prev = i; }
  const dur = parseFloat(process.argv[2]);
  const segs = E.buildSegments(words, settings, overrides, dur, null);
  const found = await S.detectSilences(src, { start: Math.max(0, segs[0].start - 0.5), end: segs[segs.length - 1].end + 0.5, minDur: 0.3 });
  const plan = G.planGapCuts(words, segs, found.silences || [], { padBefore: 0.08, padAfter: 0.12, minCut: 0.15 });
  plan.cutBefore.forEach((i) => { words[i].cutBefore = true; words[i].gapCut = true; });
  overrides = Object.assign({}, overrides, plan.overrides);
  const after = E.buildSegments(words, settings, overrides, dur, null);
  fs.writeFileSync(process.argv[3], JSON.stringify({ fillers, dups, cuts: plan.cuts, savedSec: plan.savedSec, noiseDb: found.noiseDb, meanDb: found.meanDb, silences: found.silences.length, del: words.filter((w) => w.del).map((w) => w.id), cutBefore: plan.cutBefore, overrides, durAfter: E.segmentsDuration(after), segsAfter: after.length }, null, 1));
  console.log('fillers', fillers, 'dups', dups, 'cuts', plan.cuts, 'saved', plan.savedSec.toFixed(3), 'noise', found.noiseDb, 'durAfter', E.segmentsDuration(after).toFixed(3));
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });

