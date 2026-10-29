/*
 * edl.js - SermonShorts 편집 모델 순수 함수 모음 (의존성 없음).
 * 모든 시간은 초(float), 원본 파일 기준. 출력 시각(out)은 구간을 이어붙인 결과 기준.
 * UMD: Node/Electron 메인에서는 require(), 렌더러에서는 일반 <script>로 window.SS.edl.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SS = root.SS || {};
    root.SS.edl = api;
  }
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {
  'use strict';

  var SENTENCE_END = /[.?!。？！]["'”’」』)\]]*$/;
  var LINE_PAUSE = 0.6;      // 단어 사이 무음이 이보다 길면 줄바꿈
  var LINE_GAP = 0.8;        // 줄 사이 공백이 이 이상이면 줄 끝을 단어 end + LINE_TAIL 로
  var LINE_TAIL = 0.3;
  var EPS = 1e-9;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  // ---------------------------------------------------------------- 구간

  /**
   * 지워지지 않은 연속 단어 묶음 → 구간.
   * @returns [{ id, firstWordId, lastWordId, start, end }]
   */
  function buildSegments(words, settings, overrides, duration) {
    if (!Array.isArray(words) || words.length === 0) return [];
    settings = settings || {};
    overrides = overrides || {};
    var padBefore = isNum(settings.padBefore) ? settings.padBefore : 0;
    var padAfter = isNum(settings.padAfter) ? settings.padAfter : 0;
    var dur = isNum(duration) && duration > 0 ? duration : Infinity;

    // 1) 연속된 남은 단어 묶기
    var groups = [];
    var cur = null;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || w.del || !isNum(w.start) || !isNum(w.end)) {
        if (w && w.del && cur) { groups.push(cur); cur = null; }
        continue;
      }
      if (w.cutBefore && cur) { groups.push(cur); cur = null; }

      if (!cur) {
        cur = { firstWordId: w.id, lastWordId: w.id, start: w.start, end: w.end };
      } else {
        cur.lastWordId = w.id;
        if (w.start < cur.start) cur.start = w.start;
        if (w.end > cur.end) cur.end = w.end;
      }
    }
    if (cur) groups.push(cur);

    // 2) 패딩, overrides, 클램프
    var segs = [];
    for (var g = 0; g < groups.length; g++) {
      var gr = groups[g];
      var start = gr.start - padBefore;
      var end = gr.end + padAfter;
      var os = overrides['s:' + gr.firstWordId];
      var oe = overrides['e:' + gr.lastWordId];
      if (isNum(os) && os < end) start = os;           // start>=end 되는 override는 무시
      if (isNum(oe) && oe > start) end = oe;
      start = clamp(start, 0, dur);
      end = clamp(end, 0, dur);
      if (!(end > start)) continue;                      // 클램프 후 길이 0이면 버림
      segs.push({
        id: 'seg:' + gr.firstWordId,
        firstWordId: gr.firstWordId,
        lastWordId: gr.lastWordId,
        start: start,
        end: end
      });
    }

    // 3) 겹치면 합치기 (단어 순서 유지, id는 앞 구간 것)
    var merged = [];
    for (var k = 0; k < segs.length; k++) {
      var s = segs[k];
      var prev = merged[merged.length - 1];
      if (prev && s.start <= prev.end) {
        prev.start = Math.min(prev.start, s.start);
        prev.end = Math.max(prev.end, s.end);
        prev.lastWordId = s.lastWordId;
      } else {
        merged.push(s);
      }
    }
    return merged;
  }

  function segmentsDuration(segs) {
    var sum = 0;
    if (!segs) return 0;
    for (var i = 0; i < segs.length; i++) sum += segs[i].end - segs[i].start;
    return sum;
  }

  /** 원본 시각 → 출력 시각. 구간 밖이면 null. */
  function srcToOut(segs, t) {
    if (!segs || !isNum(t)) return null;
    var off = 0;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (t >= s.start - EPS && t <= s.end + EPS) return off + clamp(t - s.start, 0, s.end - s.start);
      off += s.end - s.start;
    }
    return null;
  }

  /** 출력 시각 → { segIndex, t(원본) }. 범위 밖이면 양끝으로 클램프. 구간 없으면 null. */
  function outToSrc(segs, outT) {
    if (!segs || segs.length === 0 || !isNum(outT)) return null;
    if (outT <= 0) return { segIndex: 0, t: segs[0].start };
    var off = 0;
    for (var i = 0; i < segs.length; i++) {
      var d = segs[i].end - segs[i].start;
      // 경계(off+d)는 다음 구간 시작으로 본다. 마지막 구간은 끝 포함.
      if (outT < off + d || i === segs.length - 1) {
        return { segIndex: i, t: segs[i].start + clamp(outT - off, 0, d) };
      }
      off += d;
    }
    return null;
  }

  /** 트림 UI용 이음새 목록. */
  function cutPoints(segs) {
    var res = [];
    if (!segs) return res;
    for (var i = 0; i < segs.length - 1; i++) {
      res.push({
        index: i,
        outEnd: segs[i].end,
        inStart: segs[i + 1].start,
        keyEnd: 'e:' + segs[i].lastWordId,
        keyStart: 's:' + segs[i + 1].firstWordId
      });
    }
    return res;
  }

  // ---------------------------------------------------------------- 자막 줄

  function charCount(text) {
    return Array.from(String(text == null ? '' : text).replace(/\s+/g, '')).length;
  }

  /**
   * 자막 줄 만들기. @returns [{ text, words:[ids], outStart, outEnd }]
   */
  function buildLines(words, segs, settings) {
    if (!Array.isArray(words) || words.length === 0 || !segs || segs.length === 0) return [];
    settings = settings || {};
    var maxChars = isNum(settings.maxLineChars) && settings.maxLineChars > 0 ? Math.max(1, Math.min(200, Math.floor(settings.maxLineChars))) : 14;
    var total = segmentsDuration(segs);

    // 구간별 출력 시작 오프셋
    var segOff = [];
    var acc = 0;
    for (var s = 0; s < segs.length; s++) { segOff.push(acc); acc += segs[s].end - segs[s].start; }

    // 남은 단어마다 소속 구간 찾기 (firstWordId..lastWordId 범위를 단어 순서로 훑음)
    var items = [];
    var si = 0;
    var inSeg = false;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w) continue;
      // 구간 시작 전 단어(또는 클램프로 버려진 구간의 단어)는 segIdx = -1
      if (si < segs.length && !inSeg && w.id === segs[si].firstWordId) inSeg = true;
      var segIdx = inSeg ? si : -1;
      if (inSeg && w.id === segs[si].lastWordId) { inSeg = false; si++; }
      if (segIdx < 0 || w.del || !isNum(w.start) || !isNum(w.end) || !charCount(w.text)) continue;
      var sg = segs[segIdx];
      var a = clamp(w.start, sg.start, sg.end);
      var b = clamp(w.end, sg.start, sg.end);
      if (b < a) b = a;
      items.push({
        w: w,
        outStart: segOff[segIdx] + (a - sg.start),
        outEnd: segOff[segIdx] + (b - sg.start),
        len: charCount(w.text), textFrom: 0, textTo: Array.from(String(w.text || "")).length
      });
    }
    if (items.length === 0) return [];

    // 손으로 나눈 자리(출력 자막 칸에서 Enter): 단어 글자 위치 captionSplits 에서 조각으로 나누고 앞 조각 뒤에서 줄을 바꾼다.
    // 표시만 나눌 뿐 원문 단어·편집 시각은 바꾸지 않는다. 조각 시각은 글자 수로 나눈다.
    var manualItems = [];
    items.forEach(function (item) {
      var marks = Array.isArray(item.w.captionSplits) ? item.w.captionSplits : null;
      var chars = Array.from(String(item.w.text || ''));
      var pts = [];
      if (marks) marks.forEach(function (c) { c = Math.round(Number(c)); if (c > 0 && c < chars.length && pts.indexOf(c) < 0) pts.push(c); });
      pts.sort(function (a, b) { return a - b; });
      var pieces = [];
      if (pts.length) {
        var bounds = [0].concat(pts, [chars.length]);
        for (var k = 0; k < bounds.length - 1; k++) {
          var t = chars.slice(bounds[k], bounds[k + 1]).join('');
          if (t.trim()) pieces.push({ text: t, from: bounds[k], to: bounds[k + 1] });
        }
      }
      if (pieces.length < 2) { manualItems.push(item); return; }
      var total = 0;
      pieces.forEach(function (p) { total += charCount(p.text); });
      var used = 0;
      pieces.forEach(function (p, idx) {
        var len = charCount(p.text);
        var begin = item.outStart + (item.outEnd - item.outStart) * (total ? used / total : idx / pieces.length);
        used += len;
        var finish = item.outStart + (item.outEnd - item.outStart) * (total ? used / total : (idx + 1) / pieces.length);
        manualItems.push({ w: Object.assign({}, item.w, { text: p.text, br: idx === pieces.length - 1 ? item.w.br : true }),
          outStart: begin, outEnd: finish, len: len, textFrom: p.from, textTo: p.to });
      });
    });
    items = manualItems;

    // Optional strict limit: split only display items, never source words or edit timing.
    if (settings.splitLongWords === true) {
      var splitItems = [];
      items.forEach(function(item) {
        if (item.len <= maxChars) { splitItems.push(item); return; }
        var parts = [], text = '', count = 0;
        Array.from(String(item.w.text || '').trim()).forEach(function(ch) {
          var visible = !/\s/.test(ch);
          if (visible && count >= maxChars) {
            var boundary = text.match(/\s+(?=\S*$)/);
            if (boundary && boundary.index > 0) { parts.push(text.slice(0, boundary.index).trim()); text = text.slice(boundary.index + boundary[0].length); count = charCount(text); }
            else { parts.push(text.trim()); text = ''; count = 0; }
          }
          text += ch; if (visible) count++;
        });
        if (text.trim()) parts.push(text.trim());
        var consumed = 0, sourceChars = Array.from(String(item.w.text || '')), textOffset = 0, base = item.textFrom || 0;
        parts.forEach(function(part, index) {
          while (textOffset < sourceChars.length && /\s/.test(sourceChars[textOffset])) textOffset++;
          var textFrom = base + textOffset, textTo = base + textOffset + Array.from(part).length; textOffset += Array.from(part).length;
          var len = charCount(part);
          var begin = item.outStart + (item.outEnd - item.outStart) * consumed / item.len;
          consumed += len;
          splitItems.push({ w: Object.assign({}, item.w, { text: part, br: index === parts.length - 1 && item.w.br }),
            outStart: begin, outEnd: item.outStart + (item.outEnd - item.outStart) * consumed / item.len, len: len, textFrom: textFrom, textTo: textTo });
        });
      });
      items = splitItems;
    }

    // 줄 나누기
    var groups = [];
    var cur = [];
    var curLen = 0;
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      if (cur.length > 0) {
        var prev = cur[cur.length - 1];
        var brk = false;
        if (prev.w.br) brk = true;
        else if (SENTENCE_END.test(String(prev.w.text || '').trim())) brk = true;
        else if (it.outStart - prev.outEnd > LINE_PAUSE) brk = true;
        else if (curLen + it.len > maxChars) brk = true;
        if (brk) { groups.push(cur); cur = []; curLen = 0; }
      }
      cur.push(it);
      curLen += it.len;
    }
    if (cur.length) groups.push(cur);

    var lines = groups.map(function (g) {
      return {
        text: g.map(function (x) { return String(x.w.text == null ? '' : x.w.text).trim(); })
          .filter(function (t) { return t.length > 0; }).join(' '),
        words: g.map(function (x) { return x.w.id; }),
        parts: g.map(function (x) { return { id: x.w.id, text: String(x.w.text || "").trim(), from: x.textFrom, to: x.textTo }; }),
        outStart: g[0].outStart,
        outEnd: 0,
        _lastEnd: g[g.length - 1].outEnd
      };
    });

    for (var n = 0; n < lines.length; n++) {
      var L = lines[n];
      var next = lines[n + 1];
      if (next) {
        if (next.outStart - L._lastEnd >= LINE_GAP) L.outEnd = Math.min(next.outStart, L._lastEnd + LINE_TAIL);
        else L.outEnd = next.outStart;
      } else {
        L.outEnd = Math.min(total, L._lastEnd + LINE_TAIL);
      }
      if (L.outEnd < L.outStart) L.outEnd = L.outStart;
      delete L._lastEnd;
    }
    // Explicit user merges override automatic character/sentence/pause boundaries only for their anchored range.
    var mergeRanges=[];
    words.forEach(function(w){(Array.isArray(w.captionMerges)?w.captionMerges:[]).forEach(function(m){
      var start=lines.findIndex(function(l){return l.parts.some(function(p){return p.id===m.startId&&p.from<=m.startOffset&&p.to>m.startOffset;});});
      var end=-1;
      for(var i=0;i<lines.length;i++)if(lines[i].parts.some(function(p){return p.id===m.endId&&(m.endOffset==null||p.from<m.endOffset&&p.to>=m.endOffset);}))end=i;
      if(start>=0&&end>start)mergeRanges.push([start,end]);
    });});
    mergeRanges.sort(function(a,b){return a[0]-b[0];});var ranges=[];
    mergeRanges.forEach(function(r){var prev=ranges[ranges.length-1];if(prev&&r[0]<=prev[1])prev[1]=Math.max(prev[1],r[1]);else ranges.push(r.slice());});
    for(var r=ranges.length-1;r>=0;r--){var range=ranges[r], selected=lines.slice(range[0],range[1]+1), first=selected[0], text=first.text, joinedParts=first.parts.slice();
      for(var q=1;q<selected.length;q++){var last=joinedParts[joinedParts.length-1], nextPart=selected[q].parts[0];text+=(last.id===nextPart.id&&last.to===nextPart.from?'':' ')+selected[q].text;joinedParts=joinedParts.concat(selected[q].parts);}
      lines.splice(range[0],range[1]-range[0]+1,{text:text,words:joinedParts.map(function(p){return p.id;}),parts:joinedParts,outStart:first.outStart,outEnd:selected[selected.length-1].outEnd,manualMerge:true});
    }
    return lines;
  }

  // ---------------------------------------------------------------- SRT / 시간 표시

  function splitMs(sec) {
    var totalMs = Math.round(Math.max(0, isNum(sec) ? sec : 0) * 1000);
    var ms = totalMs % 1000;
    var totalS = (totalMs - ms) / 1000;
    var s = totalS % 60;
    var m = Math.floor(totalS / 60) % 60;
    var h = Math.floor(totalS / 3600);
    return { h: h, m: m, s: s, ms: ms };
  }

  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  function srtTime(sec) {
    var p = splitMs(sec);
    return pad(p.h, 2) + ':' + pad(p.m, 2) + ':' + pad(p.s, 2) + ',' + pad(p.ms, 3);
  }

  function toSRT(lines) {
    if (!lines || lines.length === 0) return '';
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      // 자막의 *강조* 표시는 화면에서만 쓰고 SRT 에는 별표를 뺀다
      out.push((i + 1) + '\n' + srtTime(l.outStart) + ' --> ' + srtTime(l.outEnd) + '\n' + String(l.text).replace(/\*/g, '') + '\n');
    }
    return out.join('\n');
  }

  /** "MM:SS.mmm" 또는 1시간 이상이면 "H:MM:SS.mmm". withMs=false면 밀리초 생략. */
  function formatTime(sec, withMs) {
    if (withMs === undefined) withMs = true;
    var p = withMs ? splitMs(sec) : splitMs(Math.floor(Math.max(0, isNum(sec) ? sec : 0)));
    var str = p.h > 0 ? p.h + ':' + pad(p.m, 2) + ':' + pad(p.s, 2) : pad(p.m, 2) + ':' + pad(p.s, 2);
    if (withMs) str += '.' + pad(p.ms, 3);
    return str;
  }

  // ---------------------------------------------------------------- 입력 파서

  /** "870", "14:30", "1:14:30", "14:30.5" → 초. 잘못된 입력은 null. */
  function parseTimecode(str) {
    if (isNum(str)) return str >= 0 ? str : null;
    if (typeof str !== 'string') return null;
    var s = str.trim();
    if (!s) return null;
    var m = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(s);
    if (!m) return null;
    var h = 0, mi = 0;
    if (m[1] !== undefined && m[2] !== undefined) { h = +m[1]; mi = +m[2]; }
    else if (m[1] !== undefined) { mi = +m[1]; }
    var sec = +m[3];
    var hasColon = s.indexOf(':') >= 0;
    if (hasColon && sec >= 60) return null;
    if (m[2] !== undefined && mi >= 60) return null;
    return h * 3600 + mi * 60 + sec;
  }

  /** "14:30 ~ 38:50", "14:30-38:50", "14:30 - 38:50" → { start, end } 또는 null. */
  function parseRange(str) {
    if (typeof str !== 'string') return null;
    var parts = str.split(/\s*[~\-–—]\s*/);
    if (parts.length !== 2) return null;
    var a = parseTimecode(parts[0]);
    var b = parseTimecode(parts[1]);
    if (a === null || b === null || !(b > a)) return null;
    return { start: a, end: b };
  }

  /** "870", "870s", "14m30s", "1h2m3s" → 초 또는 null. */
  function parseYtTime(v) {
    if (v == null) return null;
    var s = String(v).trim().toLowerCase();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return +s;
    var m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(s);
    if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
    return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
  }

  /** 유튜브 URL → { id, t } (t는 초 또는 null). 인식 못하면 null. */
  function parseYoutubeUrl(url) {
    if (typeof url !== 'string') return null;
    var raw = url.trim();
    if (!raw) return null;
    if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(raw)) raw = 'https://' + raw;
    var u;
    try { u = new URL(raw); } catch (e) { return null; }
    var host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
    var id = null;
    var path = u.pathname.split('/').filter(Boolean);
    if (host === 'youtu.be') {
      id = path[0] || null;
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (path[0] === 'watch') id = u.searchParams.get('v');
      else if (path[0] === 'shorts' || path[0] === 'live' || path[0] === 'embed' || path[0] === 'v') id = path[1] || null;
    } else {
      return null;
    }
    if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
    var tv = u.searchParams.get('t');
    if (tv == null) tv = u.searchParams.get('start');
    if (tv == null && u.hash) {
      var hm = /[#&]t=([^&]+)/.exec(u.hash);
      if (hm) tv = hm[1];
    }
    return { id: id, t: parseYtTime(tv) };
  }

  // ---------------------------------------------------------------- 스냅

  /**
   * pcm: Float32Array mono. mode 'zero': windowSec 안에서 t에 가장 가까운 부호 변화 지점.
   * mode 'silence': ±0.15s 안에서 RMS 최저인 10ms 창의 중심. 못 찾으면 t 그대로.
   */
  function snap(pcm, rate, t, mode, windowSec) {
    if (!pcm || !pcm.length || !isNum(rate) || rate <= 0 || !isNum(t)) return t;
    if (windowSec === undefined || !isNum(windowSec)) windowSec = 0.05;
    var n = pcm.length;
    var c = Math.round(t * rate);

    if (mode === 'zero') {
      var win = Math.max(1, Math.round(windowSec * rate));
      var lo = Math.max(0, c - win);
      var hi = Math.min(n - 1, c + win);
      if (lo >= hi) return t;
      var best = -1, bestDist = Infinity;
      for (var i = lo; i < hi; i++) {
        var a = pcm[i], b = pcm[i + 1];
        var cand = -1;
        if (a === 0) cand = i;
        else if (b === 0) cand = i + 1;
        else if ((a < 0) !== (b < 0)) cand = Math.abs(a) <= Math.abs(b) ? i : i + 1;
        if (cand < 0) continue;
        var d = Math.abs(cand - c);
        if (d < bestDist) { bestDist = d; best = cand; }
      }
      return best < 0 ? t : best / rate;
    }

    if (mode === 'silence') {
      var range = Math.round(0.15 * rate);
      var w = Math.max(1, Math.round(0.01 * rate));
      if (w > n) return t;
      var half = Math.floor(w / 2);
      // 창 시작 인덱스 범위 (창 중심이 t±0.15 안)
      var sLo = Math.max(0, c - range - half);
      var sHi = Math.min(n - w, c + range - half);
      if (sLo > sHi) return t;
      // 누적 제곱합
      var pre = new Float64Array(n + 1);
      for (var k = 0; k < n; k++) pre[k + 1] = pre[k] + pcm[k] * pcm[k];
      var bestS = -1, bestE = Infinity, bestD = Infinity;
      for (var st = sLo; st <= sHi; st++) {
        var e = pre[st + w] - pre[st];
        var dd = Math.abs(st + half - c);
        if (e < bestE - 1e-12 || (Math.abs(e - bestE) <= 1e-12 && dd < bestD)) {
          bestE = e; bestS = st; bestD = dd;
        }
      }
      return bestS < 0 ? t : (bestS + half) / rate;
    }

    return t;
  }

  // ---------------------------------------------------------------- 자동 정리

  /**
   * 군말 삭제, 중복 삭제, 긴 공백 자르기.
   * 원본 배열을 얕은 복사(객체 단위)하여 새 배열 반환.
   */
  function autoClean(words, opts) {
    if (!Array.isArray(words)) return [];
    var fillers = (opts && opts.fillers) || ['어', '음', '아', '으', '에', '엄'];
    var maxGap = isNum(opts && opts.maxGap) ? opts.maxGap : 0.6;

    var out = [];
    for (var i = 0; i < words.length; i++) {
      out.push(Object.assign({}, words[i]));
    }

    // 1. 군말 확인
    for (var i = 0; i < out.length; i++) {
      var w = out[i];
      if (w.del) continue;
      var raw = (w.text || '').replace(/[.?!。？！,、"'\”\’\」\』\)\\]+/g, '').trim();
      if (fillers.indexOf(raw) >= 0) {
        w.del = true;
      }
    }

    // 2. 중복 단어 및 긴 공백 확인 (지워지지 않은 단어들 사이에서만)
    var prevIdx = -1;
    for (var i = 0; i < out.length; i++) {
      var w = out[i];
      if (w.del) continue;

      if (prevIdx >= 0) {
        var pw = out[prevIdx];
        var rawW = (w.text || '').replace(/[.?!。？！,、"'\”\’\」\』\)\\]+/g, '').trim();
        var rawPW = (pw.text || '').replace(/[.?!。？！,、"'\”\’\」\』\)\\]+/g, '').trim();

        if (rawW === rawPW && rawW.length > 0) {
          pw.del = true;
          prevIdx = i; // 현재 단어가 이전 유효 단어가 됨
          continue;
        }

        if (w.start - pw.end > maxGap) {
          w.cutBefore = true;
        }
      }
      prevIdx = i;
    }
    return out;
  }

  return {
    buildSegments: buildSegments,
    segmentsDuration: segmentsDuration,
    srcToOut: srcToOut,
    outToSrc: outToSrc,
    cutPoints: cutPoints,
    buildLines: buildLines,
    toSRT: toSRT,
    snap: snap,
    formatTime: formatTime,
    parseTimecode: parseTimecode,
    parseRange: parseRange,
    parseYoutubeUrl: parseYoutubeUrl,
    autoClean: autoClean
  };
}));
