/*
 * source-fetch.js - 원본 영상을 다시 받기 위한 순수 함수 (의존성 없음, UMD: Node require / 렌더러 SS.sourceFetch).
 *
 * 유튜브에서 받은 원본은 캐시 폴더에 있어서 '캐시 지우기' 등으로 사라질 수 있다. 같은 구간을 다시 받으면
 * 키프레임·화질이 달라 파일 안의 시각이 조금 어긋날 수 있으므로, 모든 시각을 '유튜브 원본 시각(src)'으로
 * 바꿨다가 새 파일 시각으로 다시 옮긴다.
 *
 * source.fetch (v0.3.20 부터 프로젝트에 저장):
 *   { kind: 'part',    start, end }              구간 가져오기 (ytFetchPart). 파일 0초 = source.offset
 *   { kind: 'section', start, end }              전체 받기 (ytDownload). 파일 0초 = source.offset
 *   { kind: 'clips',   spans:[{start,end}], map:[{src0,src1,file0}] }   AI 대화에서 여러 구간을 이어 붙인 것
 * 예전 프로젝트에는 fetch 가 없으므로 파일 이름(part_S_E.mp4, clips_….mp4, <id>_full.mp4)과 offset 으로 짐작한다.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) { root.SS = root.SS || {}; root.SS.sourceFetch = api; }
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function baseName(p) { return String(p || '').split(/[\\/]/).pop(); }
  function cleanMap(map) {
    if (!Array.isArray(map)) return null;
    var out = [];
    for (var i = 0; i < map.length; i++) {
      var m = map[i];
      if (m && isNum(m.src0) && isNum(m.src1) && isNum(m.file0) && m.src1 > m.src0) out.push({ src0: m.src0, src1: m.src1, file0: m.file0 });
    }
    return out.length ? out : null;
  }
  function cleanSpans(spans) {
    if (!Array.isArray(spans)) return null;
    var out = [];
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i];
      if (s && isNum(s.start) && isNum(s.end) && s.end > s.start) out.push({ start: s.start, end: s.end });
    }
    return out.length ? out : null;
  }

  /** 저장할 수 있게 다듬은 fetch (잘못되면 null) */
  function normalizeFetch(f) {
    if (!f || typeof f !== 'object') return null;
    if ((f.kind === 'part' || f.kind === 'section') && isNum(f.start) && isNum(f.end) && f.end > f.start) return { kind: f.kind, start: f.start, end: f.end };
    if (f.kind === 'clips') {
      var spans = cleanSpans(f.spans), map = cleanMap(f.map);
      if (spans && map) return { kind: 'clips', spans: spans, map: map };
    }
    return null;
  }

  /** 지도에서 파일 시각 → 원본 시각 (조각 밖이면 가장 가까운 조각 기준으로 늘려서) */
  function fileToSrcByMap(map, f) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < map.length; i++) {
      var m = map[i], len = m.src1 - m.src0;
      if (f >= m.file0 - 0.001 && f <= m.file0 + len + 0.001) return m.src0 + (f - m.file0);
      var d = f < m.file0 ? m.file0 - f : f - (m.file0 + len);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best ? best.src0 + (f - best.file0) : null;
  }
  /** 지도에서 원본 시각 → 파일 시각 (받은 조각 밖이면 null) */
  function srcToFileByMap(map, s) {
    for (var i = 0; i < map.length; i++) {
      var m = map[i];
      if (s >= m.src0 - 0.001 && s <= m.src1 + 0.001) return m.file0 + (s - m.src0);
    }
    return null;
  }

  /**
   * 다시 받을 방법. source = 프로젝트의 source.
   * → { kind, url, start?, end?, spans?, map?(옛 파일 지도), legacy?:bool, needsSubs?:bool } 또는 { error }
   */
  function plan(source) {
    source = source || {};
    var url = String(source.url || '').trim();
    if (!url) return { error: '유튜브에서 받은 영상이 아니라 다시 받을 수 없습니다. 원본 파일을 직접 찾아 주세요.' };
    var off = isNum(source.offset) ? source.offset : 0;
    var dur = isNum(source.duration) && source.duration > 0 ? source.duration : 0;
    var f = normalizeFetch(source.fetch);
    if (f && f.kind === 'clips') return { kind: 'clips', url: url, spans: f.spans, map: f.map };
    if (f) return { kind: f.kind, url: url, start: f.start, end: f.end, map: [{ src0: off, src1: off + (dur || Math.max(1, f.end - off)), file0: 0 }] };
    // ---- 예전 프로젝트: 파일 이름으로 짐작 ----
    var name = baseName(source.path);
    var part = /^part_(\d+)_(\d+)\.mp4$/i.exec(name);
    if (part && off > 0) {
      // 구간 가져오기로 받은 파일: 파일 0초 = offset. 같은 범위를 다시 받으면 된다
      var end = dur ? off + dur : +part[2];
      return { kind: 'part', url: url, start: off, end: end, map: [{ src0: off, src1: end, file0: 0 }], legacy: true };
    }
    if (/^clips_[0-9a-f]+\.mp4$/i.test(name) || (part && off === 0)) {
      // AI 대화에서 받은 것: 파일 안의 위치를 유튜브 자막과 맞춰 되찾아야 한다
      return { kind: 'clips', url: url, needsSubs: true, legacy: true };
    }
    // 그 밖(전체 받기 <id>_full.mp4 등): 파일 0초 = offset 부터 같은 길이를 다시 받는다
    var to = dur ? off + dur : off + 24 * 3600;
    return { kind: 'section', url: url, start: off, end: to, map: [{ src0: off, src1: to, file0: 0 }], legacy: true };
  }

  /**
   * 예전 AI 대화 편집: 편집 단어(sttText = 유튜브 자막 낱말, start = 파일 시각)를 유튜브 자막 단어와 맞춰
   * 파일 조각마다 '원본 시각 - 파일 시각' 차이를 되찾는다.
   * → map [{src0,src1,file0}] (조각마다) 또는 null
   */
  function recoverClipMap(words, subs) {
    if (!Array.isArray(words) || !Array.isArray(subs) || !words.length || !subs.length) return null;
    var norm = function (t) { return String(t == null ? '' : t).replace(/\s+/g, '').replace(/[.,?!…"'“”‘’]/g, ''); };
    var sw = subs.map(function (w) { return { t: norm(w.text), s: w.start }; });
    var pw = words.map(function (w) { return { t: norm(w.sttText != null ? w.sttText : w.text), f: w.start, e: w.end }; });
    var same = function (i, k) { return i < pw.length && k < sw.length && pw[i].t && pw[i].t === sw[k].t; };
    var pairs = [], j = 0, d = null;
    for (var i = 0; i < pw.length; i++) {
      if (!pw[i].t || !isNum(pw[i].f)) continue;
      var found = -1, k;
      if (d != null) { // 같은 조각이 이어지는지: 예상 위치 근처에서 같은 낱말
        for (k = j; k < Math.min(sw.length, j + 12); k++) if (same(i, k) && Math.abs(sw[k].s - (pw[i].f + d)) < 0.35) { found = k; break; }
      }
      if (found < 0) { // 새 조각: 이 낱말부터 세 낱말이 잇달아 맞는 곳
        for (k = j; k < sw.length; k++) if (same(i, k) && same(i + 1, k + 1) && same(i + 2, k + 2)) { found = k; break; }
      }
      if (found < 0) continue;
      d = sw[found].s - pw[i].f;
      pairs.push({ f: pw[i].f, e: isNum(pw[i].e) ? pw[i].e : pw[i].f, d: d });
      j = found + 1;
    }
    if (pairs.length < 3 || pairs.length < Math.min(20, pw.length * 0.3)) return null;
    // 차이가 같은 것끼리 조각으로 묶는다 (미세 조정으로 몇 단어만 어긋난 것은 버림)
    var pieces = [];
    for (var p = 0; p < pairs.length; p++) {
      var last = pieces[pieces.length - 1];
      if (last && Math.abs(pairs[p].d - last.ds[0]) < 0.35) { last.ds.push(pairs[p].d); last.f1 = Math.max(last.f1, pairs[p].e); }
      else pieces.push({ ds: [pairs[p].d], f0: pairs[p].f, f1: pairs[p].e });
    }
    var map = [];
    for (var q = 0; q < pieces.length; q++) {
      var pc = pieces[q];
      if (pc.ds.length < 2 && pieces.length > 1) continue;
      var ds = pc.ds.slice().sort(function (a, b) { return a - b; });
      var dm = ds[Math.floor(ds.length / 2)];
      // 조각 경계: 앞뒤 조각 사이 가운데까지 넓힌다 (지운 말·여백도 같은 조각으로)
      map.push({ src0: pc.f0 + dm, src1: pc.f1 + dm, file0: pc.f0, _d: dm });
    }
    if (!map.length) return null;
    for (var r = 0; r < map.length; r++) {
      var a = map[r], b = map[r + 1];
      var lo = r === 0 ? 0 : (map[r - 1].file0 + (map[r - 1].src1 - map[r - 1].src0) + a.file0) / 2;
      var hi = b ? (a.file0 + (a.src1 - a.src0) + b.file0) / 2 : a.file0 + (a.src1 - a.src0) + 600;
      a._lo = lo; a._hi = hi;
    }
    return map.map(function (m) { return { src0: m._lo + m._d, src1: m._hi + m._d, file0: m._lo }; });
  }

  /** 다시 받을 원본 구간: 지도의 조각들 (단어가 있는 곳만, 조금 넉넉히) */
  function spansFromWords(words, f2s) {
    var spans = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || !isNum(w.start) || !isNum(w.end)) continue;
      var a = f2s(w.start), b = f2s(w.end);
      if (!isNum(a) || !isNum(b)) continue;
      var last = spans[spans.length - 1];
      if (last && a - last.end < 3) last.end = Math.max(last.end, b);
      else spans.push({ start: a, end: b });
    }
    return spans;
  }

  /**
   * 프로젝트 시각 옮기기: 옛 파일 시각 → 원본 시각(f2s) → 새 파일 시각(s2f)
   * 단어 start/end, 미세 조정(overrides), 재생 위치. → { data(복사본), moved, missing }
   */
  function remapProject(data, f2s, s2f) {
    var out = JSON.parse(JSON.stringify(data));
    var moved = 0, missing = 0;
    var mv = function (t) {
      if (!isNum(t)) return t;
      var s = f2s(t), n = isNum(s) ? s2f(s) : null;
      if (!isNum(n)) { missing++; return t; }
      moved++;
      return Math.max(0, n);
    };
    (out.words || []).forEach(function (w) {
      var a = mv(w.start), b = mv(w.end);
      w.start = a; w.end = Math.max(a, b);
    });
    var ov = out.overrides || {};
    Object.keys(ov).forEach(function (k) { if (isNum(ov[k])) ov[k] = mv(ov[k]); });
    if (isNum(out.playhead)) { var s = f2s(out.playhead), n = isNum(s) ? s2f(s) : null; out.playhead = isNum(n) ? Math.max(0, n) : 0; }
    return { data: out, moved: moved, missing: missing };
  }

  return {
    normalizeFetch: normalizeFetch, plan: plan, fileToSrcByMap: fileToSrcByMap, srcToFileByMap: srcToFileByMap,
    recoverClipMap: recoverClipMap, spansFromWords: spansFromWords, remapProject: remapProject,
  };
}));
