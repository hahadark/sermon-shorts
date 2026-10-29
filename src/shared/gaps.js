/*
 * gaps.js - 말 사이 공백 없애기 계획 (순수 함수, 테스트 가능).
 * 실제 소리에서 찾은 무음 구간을 지금 편집의 구간(edl.buildSegments)에 맞춰,
 *  - 단어 사이 무음: 그 자리에서 잘라 두 구간으로 (뒤 단어에 cutBefore, 앞 구간 끝·뒤 구간 시작은 overrides)
 *  - 구간 첫 단어 앞·마지막 단어 뒤 무음: 구간 시작·끝을 당긴다
 * 자막 단어 시각은 어림값이라 단어 '시작' 시각만 써서 무음이 어느 단어 사이인지 정한다.
 * UMD: 렌더러에서는 SS.gaps, Node 에서는 require().
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) { root.SS = root.SS || {}; root.SS.gaps = api; }
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function num(x, d) { return isNum(x) ? x : d; }

  /**
   * @param words  편집기 단어 [{ id, start, end, del }]
   * @param segs   지금 구간 [{ firstWordId, lastWordId, start, end }]
   * @param silences 무음 [{ start, end }] (단어와 같은 파일 시각)
   * @param opts   { padBefore: 말 다시 시작하기 전 남길 초(0.05), padAfter: 말 끝난 뒤 남길 초(0.07), minCut: 이보다 짧게 줄면 안 자름(0.08) }
   * @returns { cutBefore: [단어 번호], overrides: { 's:id'|'e:id': 초 }, cuts, savedSec }
   */
  function planGapCuts(words, segs, silences, opts) {
    opts = opts || {};
    var padBefore = num(opts.padBefore, 0.05), padAfter = num(opts.padAfter, 0.07), minCut = num(opts.minCut, 0.08);
    var out = { cutBefore: [], overrides: {}, cuts: 0, savedSec: 0 };
    if (!Array.isArray(words) || !Array.isArray(segs) || !Array.isArray(silences)) return out;
    var idIndex = new Map();
    for (var i = 0; i < words.length; i++) if (words[i]) idIndex.set(words[i].id, i);
    var sil = silences.filter(function (s) { return s && isNum(s.start) && isNum(s.end) && s.end > s.start; })
      .sort(function (a, b) { return a.start - b.start; });

    segs.forEach(function (sg) {
      var a = idIndex.get(sg.firstWordId), b = idIndex.get(sg.lastWordId);
      if (a == null || b == null || !(sg.end > sg.start)) return;
      var kept = [];
      for (var j = a; j <= b; j++) {
        var w = words[j];
        if (w && !w.del && isNum(w.start) && isNum(w.end)) kept.push(j);
      }
      if (!kept.length) return;
      // 이 구간 안에 들어온 무음만 (구간 밖 부분은 잘라 냄).
      // 무음 가운데가 몇 번째 단어 시작 앞인지 → 그 단어 앞 자리(k). 무음끼리는 합치지 않는다(사이에 말소리가 있으므로)
      var byGap = new Map();
      sil.forEach(function (s) {
        var s0 = Math.max(s.start, sg.start), s1 = Math.min(s.end, sg.end);
        if (!(s1 > s0)) return;
        var mid = (s0 + s1) / 2, k = 0;
        while (k < kept.length && words[kept[k]].start < mid) k++;
        var item = { start: s0, end: s1 };
        if (k === 0) { if (s0 > sg.start + 0.01) return; }                 // 첫 단어 앞: 구간 시작에 붙은 무음만
        else if (k === kept.length) { if (s1 < sg.end - 0.01) return; }  // 마지막 단어 뒤: 구간 끝에 붙은 무음만 (끝 단어 소리를 자르지 않게)
        var g = byGap.get(k);
        // 같은 단어 사이에 무음이 여럿이면 가장 긴 것만 자른다
        if (!g || item.end - item.start > g.end - g.start) byGap.set(k, item);
      });
      var newStart = sg.start, newEnd = sg.end;
      byGap.forEach(function (s, k) {
        if (k === 0) {
          var ns = s.end - padBefore;
          if (ns - newStart >= minCut) { out.savedSec += ns - newStart; newStart = ns; out.cuts++; }
        } else if (k === kept.length) {
          var ne = s.start + padAfter;
          if (newEnd - ne >= minCut) { out.savedSec += newEnd - ne; newEnd = ne; out.cuts++; }
        } else {
          var e0 = s.start + padAfter, s1 = s.end - padBefore;
          if (s1 - e0 < minCut) return;
          var A = words[kept[k - 1]], B = words[kept[k]];
          out.cutBefore.push(kept[k]);
          out.overrides['e:' + A.id] = e0;
          out.overrides['s:' + B.id] = s1;
          out.savedSec += s1 - e0;
          out.cuts++;
        }
      });
      if (newStart !== sg.start) out.overrides['s:' + sg.firstWordId] = newStart;
      if (newEnd !== sg.end) out.overrides['e:' + sg.lastWordId] = newEnd;
    });
    out.cutBefore.sort(function (x, y) { return x - y; });
    return out;
  }

  return { planGapCuts: planGapCuts };
}));
