/*
 * textfx.js - 테마 글자 효과용 순수 함수 (의존성 없음, 테스트 가능).
 *  - 강조 표시: 자막에 *말씀* 처럼 별표로 감싸면 강조색
 *  - 줄 나누기: 너비를 넘으면 단어 단위로 다음 줄로 (최대 줄 수)
 *  - 단어 강조(가라오케): 지금 말하는 단어가 바뀌는 시각 계산
 * UMD: 렌더러에서는 SS.textfx, Node 에서는 require().
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) { root.SS = root.SS || {}; root.SS.textfx = api; }
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {
  'use strict';

  /**
   * 한 줄(설명 없는 \n 제외) 글을 단어 토큰으로. *강조* 는 hl:true (별표는 지운다).
   * 별표는 켜기/끄기 표시라 여러 단어에 걸쳐도 되고, '*은혜*를' 처럼 단어 일부만 강조하면
   * parts: [{ text:'은혜', hl:true }, { text:'를', hl:false }] 로 나눠 준다.
   * groups 가 있으면 그 묶음을 한 토큰으로 (가라오케: 단어 하나 = 토큰 하나). groups: ['하나님의', '나라와', ...]
   * @returns [{ text, hl, parts|null, group }]
   */
  function tokenize(text, groups) {
    var src = Array.isArray(groups) && groups.length ? groups.map(String) : String(text == null ? '' : text).split(/\s+/);
    var out = [];
    var inHl = false;
    for (var i = 0; i < src.length; i++) {
      var t = String(src[i]).trim();
      if (!t) continue;
      var segs = [], cur = '', curHl = inHl, chars = Array.from(t);
      for (var c = 0; c < chars.length; c++) {
        if (chars[c] === '*') {
          if (cur) { segs.push({ text: cur, hl: curHl }); cur = ''; }
          inHl = !inHl; curHl = inHl;
          continue;
        }
        cur += chars[c];
      }
      if (cur) segs.push({ text: cur, hl: curHl });
      if (!segs.length) continue;
      // 같은 강조 상태로 이어진 조각은 합친다
      var merged = [];
      for (var s = 0; s < segs.length; s++) {
        var last = merged[merged.length - 1];
        if (last && last.hl === segs[s].hl) last.text += segs[s].text; else merged.push({ text: segs[s].text, hl: segs[s].hl });
      }
      out.push({
        text: merged.map(function (x) { return x.text; }).join(''),
        hl: merged.some(function (x) { return x.hl; }),
        parts: merged.length > 1 ? merged : null,
        group: i
      });
    }
    return out;
  }

  /** 대문자 변환 등 글자 바꾸기 */
  function transformText(text, transform) {
    if (transform === 'uppercase') return String(text).toUpperCase();
    return String(text);
  }

  /**
   * 토큰을 너비에 맞춰 줄로 나눈다.
   * measure(text) → px, gap = 단어 사이 너비. maxLines 를 넘으면 남은 것은 마지막 줄에 붙인다(그 줄은 그릴 때 좁힌다).
   * @returns [[token, ...], ...]
   */
  function wrapTokens(tokens, measure, maxWidth, gap, maxLines) {
    var lines = [];
    var cur = [], curW = 0;
    maxLines = maxLines > 0 ? maxLines : 99;
    for (var i = 0; i < tokens.length; i++) {
      var w = measure(tokens[i].text);
      var add = cur.length ? gap + w : w;
      if (cur.length && curW + add > maxWidth && lines.length < maxLines - 1) {
        lines.push(cur); cur = []; curW = 0; add = w;
      }
      cur.push(tokens[i]); curW += add;
    }
    if (cur.length) lines.push(cur);
    return lines;
  }

  /**
   * 가라오케 장면: 줄 [lineStart, lineEnd) 안에서 단어 i 가 시작하는 출력 시각 starts[i].
   * 너무 짧은(minDur 미만) 장면은 앞 장면에 합친다.
   * @returns [{ index, start, end }] (index = 지금 강조할 토큰 번호)
   */
  function karaokeFrames(lineStart, lineEnd, starts, minDur) {
    minDur = minDur > 0 ? minDur : 1 / 30;
    var n = starts.length;
    if (!n || !(lineEnd > lineStart)) return [];
    var t = [];
    for (var i = 0; i < n; i++) {
      var s = Number(starts[i]);
      t.push(isFinite(s) ? Math.max(lineStart, Math.min(lineEnd, s)) : NaN);
    }
    t[0] = lineStart;
    // 시각을 모르는 단어는 앞뒤 단어 사이를 고르게 나눠 채운다
    for (var u = 1; u < n; u++) {
      if (!isNaN(t[u])) continue;
      var e = u;
      while (e < n && isNaN(t[e])) e++;
      var a0 = t[u - 1], b0 = e < n ? t[e] : lineEnd, cnt = e - u + 1;
      for (var q = u; q < e; q++) t[q] = a0 + (b0 - a0) * (q - u + 1) / cnt;
      u = e - 1;
    }
    for (var m = 1; m < n; m++) if (t[m] < t[m - 1]) t[m] = t[m - 1];
    var frames = [];
    for (var j = 0; j < n; j++) {
      var a = t[j], b = j + 1 < n ? t[j + 1] : lineEnd;
      if (b - a < minDur && frames.length) { frames[frames.length - 1].end = b; continue; }
      if (b - a < minDur) continue;
      frames.push({ index: j, start: a, end: b });
    }
    if (frames.length) { frames[0].start = lineStart; frames[frames.length - 1].end = lineEnd; }
    return frames;
  }

  /**
   * 자막 줄(edl.buildLines 의 한 줄) → 가라오케 단위. 긴 단어가 잘린 조각(같은 id, 이어진 글자)은 다시 붙인다.
   * @returns [{ id, text, from, to }]
   */
  function lineUnits(line) {
    var units = [];
    var parts = line && Array.isArray(line.parts) ? line.parts : [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i] || {};
      var text = String(p.text == null ? '' : p.text).trim();
      if (!text) continue;
      var last = units[units.length - 1];
      if (last && last.id === p.id && last.to === p.from) { last.text += text; last.to = p.to; continue; }
      units.push({ id: p.id, text: text, from: p.from, to: p.to });
    }
    return units;
  }

  /**
   * 줄의 가라오케: { groups(단어 묶음), frames(장면) }.
   * timeOf(unit) → 그 단어를 말하기 시작하는 출력 시각(초). 모르면 NaN.
   */
  function lineKaraoke(line, timeOf, minDur) {
    var u = lineUnits(line);
    return {
      groups: u.map(function (x) { return x.text; }),
      frames: line ? karaokeFrames(line.outStart, line.outEnd, u.map(function (x) { var t = timeOf ? Number(timeOf(x)) : NaN; return isFinite(t) ? t : NaN; }), minDur) : []
    };
  }

  /** 출력 시각 t 에 강조할 토큰 번호 (없으면 -1) */
  function karaokeIndexAt(frames, t) {
    for (var i = 0; i < frames.length; i++) if (t >= frames[i].start && t < frames[i].end) return frames[i].index;
    return frames.length && t >= frames[frames.length - 1].end ? frames[frames.length - 1].index : -1;
  }

  /** 토큰 색 결정: 가라오케 > 줄 색 > 강조(*) > 기본 */
  function tokenColor(tok, idx, el, lineIdx, karaokeIndex) {
    var base = (Array.isArray(el.lineColors) && el.lineColors[lineIdx]) || el.color || '#FFFFFF';
    var k = el.karaoke;
    if (k && k.mode && k.mode !== 'none' && karaokeIndex != null && karaokeIndex >= 0) {
      if (idx === karaokeIndex) return k.color || el.highlightColor || '#FFE14D';
      if (idx < karaokeIndex) return k.mode === 'progressive' ? (k.color || el.highlightColor || '#FFE14D') : (k.pastColor || base);
      return k.futureColor || base;
    }
    if (tok.hl && el.highlightColor) return el.highlightColor;
    return base;
  }

  /** 강조 표시(*별표*)를 지운 글 (SRT·업로드용) */
  function stripEmphasis(text) {
    return String(text == null ? '' : text).replace(/\*/g, '');
  }

  /** 서식 문자열 채우기: {speaker} {church} {title} {verse} */
  function fillFormat(fmt, vals) {
    return String(fmt == null ? '' : fmt).replace(/\{(speaker|church|title|verse)\}/g, function (_, k) { return vals && vals[k] ? String(vals[k]) : ''; }).replace(/\s{2,}/g, ' ').trim();
  }

  return {
    tokenize: tokenize, transformText: transformText, wrapTokens: wrapTokens,
    karaokeFrames: karaokeFrames, karaokeIndexAt: karaokeIndexAt, tokenColor: tokenColor, fillFormat: fillFormat,
    lineUnits: lineUnits, lineKaraoke: lineKaraoke, stripEmphasis: stripEmphasis,
  };
}));
