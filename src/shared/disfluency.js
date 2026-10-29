/*
 * disfluency.js - 군말(음·어·아…)과 말 사이 쉼 찾기 (순수 함수, 의존성 없음).
 *  - isFiller(text): 혼자 쓰인 '음, 어, 아, 에, 으음, 어어…'  ('그…'처럼 말을 끄는 것도)
 *  - pauses(words, segs, min): 지우지 않고 남은 이웃 단어 사이 쉼 (같은 구간 안, min 초 이상)
 *  - gapCutsByTiming(words, segs, opts): 소리를 못 읽을 때 단어 시각으로 공백 자르기 계획 (gaps.planGapCuts 와 같은 모양)
 *  - summary(words, segs): 지운 군말 수, 잘라 낸 공백 수·초
 * UMD: 렌더러에서는 SS.disfluency, Node 에서는 require().
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) { root.SS = root.SS || {}; root.SS.disfluency = api; }
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {
  'use strict';

  // 혼자 쓰였을 때 군말인 소리 (늘어진 것 포함)
  var FILLER = /^(음+|으+음*|으+|어+|아+|에+|엄+|흠+|어음|음음|으흠|에헴|저기|어어+|아아+|에에+|엉)$/;
  // 말을 끄는 '그…' '이…' 는 말줄임표·물결이 붙었을 때만 (그 사람, 이 말씀의 '그·이'와 구별)
  var DRAG = /^(그|이|저|뭐)$/;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function core(text) { return String(text == null ? '' : text).trim().replace(/[\s.,?!~…·。？！、"'”’「」『』()\[\]-]+/g, ''); }

  function isFiller(text) {
    var raw = String(text == null ? '' : text).trim();
    var c = core(raw);
    if (!c) return false;
    if (FILLER.test(c)) return true;
    return DRAG.test(c) && /(\.\.\.|…|~)$/.test(raw);
  }

  function liveIndexMap(words) {
    var m = new Map();
    for (var i = 0; i < words.length; i++) if (words[i]) m.set(words[i].id, i);
    return m;
  }

  /** 구간마다 (첫 단어 번호, 끝 단어 번호) */
  function segRanges(words, segs) {
    var idx = liveIndexMap(words), out = [];
    (segs || []).forEach(function (s) { var a = idx.get(s.firstWordId), b = idx.get(s.lastWordId); if (a != null && b != null) out.push([a, b, s]); });
    return out;
  }

  /** 같은 구간 안에서 이웃한 남은 단어 사이 쉼: [{ i: 뒤 단어 번호, prev: 앞 단어 번호, gap }] */
  function pauses(words, segs, min) {
    min = isNum(min) ? min : 0.5;
    var out = [];
    segRanges(words, segs).forEach(function (r) {
      var prev = -1;
      for (var i = r[0]; i <= r[1]; i++) {
        var w = words[i];
        if (!w || w.del || !isNum(w.start) || !isNum(w.end)) continue;
        if (prev >= 0 && i === prev + 1) {
          var gap = w.start - words[prev].end;
          if (gap >= min) out.push({ i: i, prev: prev, gap: gap });
        }
        prev = i;
      }
    });
    return out;
  }

  /** 단어 시각만으로 공백 자르기 계획 (소리 분석이 안 될 때) */
  function gapCutsByTiming(words, segs, opts) {
    opts = opts || {};
    var min = isNum(opts.minGap) ? opts.minGap : 0.3, padBefore = isNum(opts.padBefore) ? opts.padBefore : 0.08, padAfter = isNum(opts.padAfter) ? opts.padAfter : 0.12;
    var out = { cutBefore: [], overrides: {}, cuts: 0, savedSec: 0 };
    pauses(words, segs, min).forEach(function (p) {
      var A = words[p.prev], B = words[p.i];
      var e0 = A.end + padAfter, s1 = B.start - padBefore;
      if (s1 - e0 < 0.08) return;
      out.cutBefore.push(p.i);
      out.overrides['e:' + A.id] = e0;
      out.overrides['s:' + B.id] = s1;
      out.cuts++; out.savedSec += s1 - e0;
    });
    return out;
  }

  /** 지운 군말 수 / 말 사이 공백을 잘라 낸 곳 수·초 (지운 단어 없이 이웃 단어 사이에서 잘린 곳) */
  function summary(words, segs) {
    var fillers = 0, gaps = 0, gapSec = 0;
    (words || []).forEach(function (w) { if (w && w.del && isFiller(w.text)) fillers++; });
    var idx = liveIndexMap(words || []);
    for (var k = 0; segs && k < segs.length - 1; k++) {
      var a = idx.get(segs[k].lastWordId), b = idx.get(segs[k + 1].firstWordId);
      if (a != null && b === a + 1) { gaps++; gapSec += Math.max(0, segs[k + 1].start - segs[k].end); }
    }
    return { fillers: fillers, gaps: gaps, gapSec: gapSec };
  }

  return { isFiller: isFiller, pauses: pauses, gapCutsByTiming: gapCutsByTiming, summary: summary, core: core };
}));
