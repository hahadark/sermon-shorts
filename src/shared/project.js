/* Persistent project schema. Keep runtime promises, API settings and history out of files. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.SS = root.SS || {}; root.SS.project = api; }
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const number = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  function normalize(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('프로젝트 형식이 올바르지 않습니다.');
    if (data.version !== undefined && data.version !== 1) throw Error('지원하지 않는 프로젝트 버전입니다.');
    if (!data.source || typeof data.source.path !== 'string' || !data.source.path.trim()) throw Error('원본 영상 경로가 없습니다.');
    if (!Array.isArray(data.words)) throw Error('자막 데이터가 없습니다.');
    const words = data.words.map((word, i) => {
      if (!word || typeof word.text !== 'string' || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end < word.start) throw Error(`${i + 1}번째 단어 시각이 올바르지 않습니다.`);
      return { ...clone(word), sttText: typeof word.sttText === "string" ? word.sttText : (word._oldText ?? word.text), id: i, del: !!word.del };
    });
    const settings = data.settings || {};
    const overrides = {};
    for (const [key, value] of Object.entries(data.overrides || {})) if (/^[se]:\d+$/.test(key) && Number.isFinite(value)) overrides[key] = value;
    const index = (v, fallback = 0) => clamp(Math.trunc(number(v, fallback)), 0, words.length);
    const source = {};
    for (const key of ['path','offset','url','title','duration','fps','width','height']) if (data.source[key] !== undefined) source[key] = clone(data.source[key]);
    const crop = data.crop || {};
    const meta = data.meta || {};
    return {
      version: 1, source, words, overrides,
      settings: { padBefore: clamp(number(settings.padBefore, .1), 0, 5), padAfter: clamp(number(settings.padAfter, .15), 0, 5), fadeMs: clamp(number(settings.fadeMs, 10), 0, 1000), maxLineChars: Math.trunc(clamp(number(settings.maxLineChars, 14), 1, 200)), splitLongWords: settings.splitLongWords === true, semanticBreaks: settings.semanticBreaks !== false },
      meta: { title: String(meta.title || ''), verse: String(meta.verse || ''), speaker: String(meta.speaker || '') },
      crop: { scale: clamp(number(crop.scale, 1), 1, 3), x: clamp(number(crop.x, .5), 0, 1), y: clamp(number(crop.y, .5), 0, 1) },
      activeTheme: data.activeTheme ? clone(data.activeTheme) : null,
      caret: index(data.caret), selAnchor: index(data.selAnchor, number(data.caret, 0)),
      selection: Array.isArray(data.selection) && data.selection.length === 2 ? data.selection.map(v => index(v)).sort((a,b) => a-b) : null,
      hideDeleted: !!data.hideDeleted,
      markI: Number.isInteger(data.markI) && data.markI >= 0 && data.markI < words.length ? data.markI : -1,
      markO: Number.isInteger(data.markO) && data.markO >= 0 && data.markO <= words.length ? data.markO : -1,
      playhead: Math.max(0, number(data.playhead, 0))
    };
  }
  function snapshot(state, playhead) { return normalize({ ...state, version: 1, playhead: number(playhead, 0) }); }
  return { normalize, snapshot };
});
