// 자막 나누기·합치기 비교 자료 (Electron caption-edit.js split·merge·unmerge)
const C = require('F:/aside/sermon-shorts-app/src/shared/caption-edit.js');
const E = require('F:/aside/sermon-shorts-app/src/shared/edl.js');
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('F:/aside/sermon-shorts-app/cache/theme_check/words_4955.json', 'utf8'));
const words0 = (Array.isArray(raw) ? raw : raw.words).map((w, i) => ({ ...w, id: i, del: false }));
const settings = { padBefore: 0.1, padAfter: 0.15, fadeMs: 10, maxLineChars: 14, splitLongWords: true, semanticBreaks: true };
const lines = (ws) => E.buildLines(ws, E.buildSegments(ws, settings, {}, 156, null), settings);
const pick = (ws) => ws.map((w) => ({ id: w.id, text: w.text, br: !!w.br, captionSplits: w.captionSplits || null, captionMerges: w.captionMerges || null }));
const cases = [];
const L0 = lines(words0);
// 나누기: 앞 12줄의 모든 글자 자리
for (let li = 0; li < 12; li++) {
  const line = L0[li];
  for (let caret = 0; caret <= line.text.length; caret++) {
    const r = C.split(words0, line, caret);
    cases.push({ kind: 'split', li, caret, ok: !!r, words: r ? pick(r.words) : null, anchor: r ? r.anchor : null });
  }
}
// 합치기: 이웃한 줄 10쌍, 합친 뒤 다시 나누기·다시 글자 수대로
for (let li = 1; li <= 10; li++) {
  const r = C.merge(words0, L0[li - 1], L0[li]);
  const c = { kind: 'merge', li, ok: !!r, words: r ? pick(r.words) : null, text: r ? r.text : null, caret: r ? r.caret : null, anchor: r ? r.anchor : null };
  if (r) {
    const L1 = lines(r.words);
    const merged = L1.find((l) => l.parts[0] && l.parts[0].id === r.anchor.id && l.parts[0].from === r.anchor.from);
    c.mergedText = merged ? merged.text : null; c.manual = merged ? !!merged.manualMerge : null;
    if (merged) {
      const s = C.split(r.words, merged, Math.floor(merged.text.length / 2));
      c.resplit = s ? { words: pick(s.words), anchor: s.anchor } : null;
      c.unmerged = pick(C.unmerge(r.words, merged));
    }
  }
  cases.push(c);
}
fs.writeFileSync('tests/fixtures/caption_split_cases.json', JSON.stringify({ settings, cases }));
console.log('cases', cases.length, 'split ok', cases.filter((c) => c.kind === 'split' && c.ok).length, 'merge ok', cases.filter((c) => c.kind === 'merge' && c.ok).length);
