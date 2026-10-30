/* 설교 목소리 크기: 키워도 깨지지 않게 (ffmpeg 내장 무료 필터만 사용)
 *  - 자동 맞춤: 편집한 말소리의 크기를 EBU R128(LUFS)로 재서 유튜브 기준(-14 LUFS)에 맞는 만큼 키우거나 줄인다 (loudnorm 으로 재기)
 *  - 직접: -12 ~ +20 dB
 *  - 작은 말소리 고르게(선택): 부드러운 압축기 (acompressor) — 큰 소리는 살짝 누르고 작은 소리를 올린다
 *  - 맨 끝 리미터(alimiter, 앞을 내다보는 방식): 키운 소리가 -1.5 dBFS 를 넘지 않게 눌러 '찢어지는' 소리(클리핑)를 막는다
 * 미리보기는 같은 순서를 Web Audio(압축기 → 크기 → 리미터)로 흉내 낸다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) { root.SS = root.SS || {}; root.SS.voice = api; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var TARGET_LUFS = -14;       // 유튜브가 맞추는 크기
  var CEIL_DB = -1.5;          // 리미터 천장 (AAC 로 바꿀 때 생기는 넘침까지 고려)
  var MIN_DB = -12, MAX_DB = 20, AUTO_MAX = 20;
  var COMP = { thresholdDb: -24, ratio: 3, kneeDb: 6, attack: 0.012, release: 0.25, makeupDb: 4 };
  var DEFAULTS = { mode: 'off', gainDb: 0, even: false, measured: null };

  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function normalize(v) {
    v = v && typeof v === 'object' ? v : {};
    var m = v.measured && typeof v.measured === 'object' && isFinite(Number(v.measured.i)) ? {
      i: r1(num(v.measured.i, -30)), tp: r1(num(v.measured.tp, 0)), lra: r1(num(v.measured.lra, 0)), key: String(v.measured.key || ''), even: !!v.measured.even,
    } : null;
    return {
      mode: v.mode === 'auto' || v.mode === 'manual' ? v.mode : 'off',
      gainDb: r1(clamp(num(v.gainDb, 0), MIN_DB, MAX_DB)),
      even: !!v.even,
      measured: m,
    };
  }
  function isOn(v) { v = normalize(v); return v.mode !== 'off' || v.even; }
  /** 편집 구간이 바뀌었는지 알기 위한 열쇠 */
  function segKey(segments) {
    var s = (segments || []).map(function (x) { return Math.round(x.start * 100) + '-' + Math.round(x.end * 100); }).join(',');
    var h = 0; for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return (segments || []).length + ':' + (h >>> 0).toString(36);
  }
  /** 잰 값이 지금 편집(구간·고르게 설정)에 맞는지 */
  function measuredFits(v, key) { v = normalize(v); return !!(v.measured && v.measured.key === key && v.measured.even === v.even); }
  /** 키울(줄일) 크기 dB. 자동인데 아직 안 쟀으면 null */
  function gainDb(v) {
    v = normalize(v);
    if (v.mode === 'manual') return v.gainDb;
    if (v.mode === 'auto') {
      if (!v.measured) return null;
      if (v.measured.i < -60) return 0; // 거의 무음: 키우면 잡음만 커짐
      return r1(clamp(TARGET_LUFS - v.measured.i, MIN_DB, AUTO_MAX));
    }
    return 0;
  }
  function f3(x) { return (Math.round(x * 1000) / 1000).toString(); }
  function dbToLin(db) { return Math.pow(10, db / 20); }
  /** 압축기 (작은 말소리 고르게) */
  function compFilter() {
    return 'acompressor=threshold=' + f3(dbToLin(COMP.thresholdDb)) + ':ratio=' + COMP.ratio + ':knee=' + f3(dbToLin(COMP.kneeDb)) +
      ':attack=' + Math.round(COMP.attack * 1000) + ':release=' + Math.round(COMP.release * 1000) + ':makeup=' + f3(dbToLin(COMP.makeupDb));
  }
  /** 4배로 늘려서(192kHz) 리미터를 걸면 샘플 사이 최고값(true peak)까지 잡힌다. 천장은 0.5 dB 더 낮춰 AAC 로 바꿀 때 넘침까지 막는다 */
  function limiterFilter() {
    return 'aresample=192000,alimiter=limit=' + f3(dbToLin(CEIL_DB - 0.5)) + ':attack=5:release=80:level=false:latency=true,aresample=48000';
  }
  /** 재기용 체인: (압축기) → loudnorm 재기 (print_format=json) */
  function analysisFilter(v) {
    v = normalize(v);
    return (v.even ? compFilter() + ',' : '') + 'loudnorm=I=' + TARGET_LUFS + ':TP=' + CEIL_DB + ':LRA=11:print_format=json';
  }
  /** loudnorm 이 stderr 에 찍은 JSON 읽기 */
  function parseLoudnorm(text) {
    var s = String(text || ''), a = s.lastIndexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b < a) return null;
    try {
      var j = JSON.parse(s.slice(a, b + 1));
      var i = Number(j.input_i), tp = Number(j.input_tp), lra = Number(j.input_lra);
      if (!isFinite(i)) return { i: -70, tp: isFinite(tp) ? tp : -70, lra: isFinite(lra) ? lra : 0 };
      return { i: i, tp: tp, lra: lra };
    } catch (e) { return null; }
  }
  /** 내보내기 체인: [in] → (압축기) → 크기 → 리미터 → [out]. 끄면 '' (그대로) */
  function ffmpegFilter(v, inLabel, outLabel) {
    v = normalize(v);
    if (!isOn(v)) return '';
    var g = gainDb(v); if (g == null) g = 0;
    var parts = [];
    if (v.even) parts.push(compFilter());
    if (Math.abs(g) >= 0.05) parts.push('volume=' + f3(g) + 'dB');
    parts.push(limiterFilter());
    return inLabel + parts.join(',') + outLabel;
  }
  /** 미리보기(Web Audio)용 값 */
  function webParams(v) {
    v = normalize(v);
    var g = gainDb(v);
    return { on: isOn(v), even: v.even, gain: dbToLin(g == null ? 0 : g), comp: COMP, ceilDb: CEIL_DB };
  }
  function describe(v) {
    v = normalize(v);
    var g = gainDb(v);
    if (v.mode === 'off') return v.even ? '작은 말소리 고르게만' : '원래 크기';
    if (g == null) return '목소리 크기를 재는 중…';
    return (g > 0 ? '+' : '') + g.toFixed(1) + ' dB';
  }
  return { TARGET_LUFS: TARGET_LUFS, CEIL_DB: CEIL_DB, MIN_DB: MIN_DB, MAX_DB: MAX_DB, DEFAULTS: DEFAULTS, COMP: COMP,
    normalize: normalize, isOn: isOn, segKey: segKey, measuredFits: measuredFits, gainDb: gainDb, analysisFilter: analysisFilter,
    parseLoudnorm: parseLoudnorm, ffmpegFilter: ffmpegFilter, webParams: webParams, describe: describe, dbToLin: dbToLin, compFilter: compFilter, limiterFilter: limiterFilter };
});
