/*
 * bgm.js - 배경음악 배치 계산 (순수 함수). 미리보기(재생 맞추기)와 내보내기(ffmpeg)가 같은 계산을 쓴다.
 *
 * bgm (프로젝트에 저장): {
 *   id, trackStart, trackEnd   곡에서 쓸 구간(초)
 *   duration                   곡 전체 길이(초)
 *   align: 'start' | 'end'     'start' = 영상 처음에 음악 시작을 맞춤, 'end' = 영상 끝에 음악 끝을 맞춤
 *   fadeIn, fadeOut            초
 *   volume                     0~1 (말소리 대비 음악 크기)
 * }
 * outDur: 완성 영상 길이(초)
 *
 * plan() 결과: { from: 곡 안에서 쓰기 시작하는 시각, length: 쓰는 길이, delay: 영상 안에서 음악이 시작하는 시각,
 *               fadeIn, fadeOut, volume }
 *  - 고른 구간이 영상보다 길면: 'start'는 구간 앞부분, 'end'는 구간 뒷부분을 영상 길이만큼 쓴다
 *  - 고른 구간이 영상보다 짧으면: 'start'는 영상 처음부터, 'end'는 영상 끝에서 끝나도록 늦게 시작한다
 * UMD: 렌더러에서는 SS.bgm, Node 에서는 require().
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) { root.SS = root.SS || {}; root.SS.bgm = api; }
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {
  'use strict';

  var DEFAULTS = { volume: 0.2, fadeIn: 1, fadeOut: 2, align: 'start' };
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function num(x, d) { return isNum(x) ? x : d; }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  /** 저장된 값 다듬기 (모르는 값은 기본값, 구간은 곡 길이 안으로) */
  function normalize(b) {
    if (!b || typeof b !== 'object' || typeof b.id !== 'string' || !b.id) return null;
    var dur = isNum(b.duration) && b.duration > 0 ? b.duration : null;
    var top = dur || 36000;
    var a = clamp(num(b.trackStart, 0), 0, top), e = clamp(num(b.trackEnd, top), 0, top);
    if (!(e - a >= 0.5)) { a = 0; e = top; }
    return {
      id: b.id, duration: dur,
      trackStart: a, trackEnd: e,
      align: b.align === 'end' ? 'end' : 'start',
      fadeIn: clamp(num(b.fadeIn, DEFAULTS.fadeIn), 0, 30),
      fadeOut: clamp(num(b.fadeOut, DEFAULTS.fadeOut), 0, 30),
      volume: clamp(num(b.volume, DEFAULTS.volume), 0, 1),
    };
  }

  function plan(bgm, outDur) {
    var b = normalize(bgm);
    if (!b || !(outDur > 0)) return null;
    var sel = b.trackEnd - b.trackStart;
    var length = Math.min(sel, outDur);
    if (!(length > 0)) return null;
    var from, delay;
    if (b.align === 'end') { from = b.trackEnd - length; delay = outDur - length; }
    else { from = b.trackStart; delay = 0; }
    return {
      from: from, length: length, delay: delay,
      fadeIn: Math.min(b.fadeIn, length / 2), fadeOut: Math.min(b.fadeOut, length / 2),
      volume: b.volume,
    };
  }

  /** 영상 시각 outT 에서의 음악 크기 (0~volume) */
  function gainAt(p, outT) {
    if (!p) return 0;
    var x = outT - p.delay;
    if (!(x >= 0 && x <= p.length)) return 0;
    var g = 1;
    if (p.fadeIn > 0 && x < p.fadeIn) g = x / p.fadeIn;
    if (p.fadeOut > 0 && x > p.length - p.fadeOut) g = Math.min(g, (p.length - x) / p.fadeOut);
    return p.volume * clamp(g, 0, 1);
  }

  /** 영상 시각 outT 에 곡의 몇 초가 나와야 하는지 (음악이 없는 때면 null) */
  function trackTimeAt(p, outT) {
    if (!p) return null;
    var x = outT - p.delay;
    return x >= 0 && x <= p.length ? p.from + x : null;
  }

  function f3(x) { return (Math.round(x * 1000) / 1000).toFixed(3); }

  /**
   * ffmpeg 오디오 필터: 음악 입력(inputIndex)을 [bgm] 으로 만들고, 말소리(speechLabel)와 섞어 [aout].
   * 말소리 크기는 그대로 두고(normalize=0) 음악만 줄여서 얹는다.
   */
  function ffmpegFilter(p, inputIndex, speechLabel) {
    var chain = '[' + inputIndex + ':a]atrim=start=' + f3(p.from) + ':end=' + f3(p.from + p.length) + ',asetpts=PTS-STARTPTS'
      + ',aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
    if (p.fadeIn > 0.001) chain += ',afade=t=in:st=0:d=' + f3(p.fadeIn);
    if (p.fadeOut > 0.001) chain += ',afade=t=out:st=' + f3(Math.max(0, p.length - p.fadeOut)) + ':d=' + f3(p.fadeOut);
    chain += ',volume=' + f3(p.volume);
    var ms = Math.round(p.delay * 1000);
    if (ms > 0) chain += ',adelay=' + ms + '|' + ms;
    chain += '[bgm]; ';
    chain += speechLabel + 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[speech]; ';
    chain += '[speech][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]';
    return chain;
  }

  /** 초 → 1:05 */
  function fmt(sec) {
    if (!isNum(sec) || sec < 0) sec = 0;
    var s = Math.round(sec), m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  return { DEFAULTS: DEFAULTS, normalize: normalize, plan: plan, gainAt: gainAt, trackTimeAt: trackTimeAt, ffmpegFilter: ffmpegFilter, fmt: fmt };
}));
