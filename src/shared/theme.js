/*
 * theme.js - SermonShorts 테마 엔진 순수 함수 모음 (의존성 없음).
 * UMD: Node/Electron 메인에서는 require(), 렌더러에서는 일반 <script>로 window.SS.theme.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SS = root.SS || {};
    root.SS.theme = api;
  }
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {
  'use strict';

  var DEFAULTS = {
    canvas: { background: '#000000' },
    title: { show: true, align: 'center', x: 540, y: 205, width: 1000, font: 'Noto Sans KR', size: 70, color: '#FFFFFF', weight: 700, maxLines: 2, stroke: 0, strokeColor: null, shadow: null },
    verse: { show: true, align: 'center', x: 540, y: 280, width: 1000, font: 'Noto Sans KR', size: 44, color: '#FFFFFF', weight: 400, band: null },
    video: { show: true, x: 0, y: 353, width: 1080, height: 958, fit: 'cover', radius: 0, border: null, fade: null },
    subtitle: { show: true, align: 'center', x: 540, y: 1400, width: 1000, font: 'Noto Sans KR', size: 60, color: '#FFFFFF', weight: 700, stroke: 0, strokeColor: '#000000', box: null, maxChars: 14, highlightColor: null, lineGap: 1.2 },
    churchName: { show: true, align: 'center', x: 540, y: 1700, width: 1000, font: 'Noto Sans KR', size: 40, color: '#FFFFFF', letterSpacing: 0, text: '' },
    speaker: { show: true, align: 'center', x: 540, y: 1770, width: 1000, font: 'Noto Sans KR', size: 44, color: '#FFFFFF', text: '', format: '{speaker}' },
    logo: { show: true, x: 540, y: 1620, height: 120, path: '' },
    fadeInSec: 1,
    fallbackFont: 'Noto Sans KR'
  };

  function merge(target, source) {
    if (!source) return target;
    for (var key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        target[key] = merge(target[key] || {}, source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  function normalizeTheme(json) {
    var theme = JSON.parse(JSON.stringify(DEFAULTS));
    if (!json) return theme;
    merge(theme, json);
    if (json.id) theme.id = json.id;
    if (json.name) theme.name = json.name;
    return theme;
  }

  function themeFromLegacyTemplate(t) {
    if (!t) return normalizeTheme(null);
    return normalizeTheme({
      id: 'daegu-sarang',
      name: '이전 설정 (사용자 프리셋)',
      userPreset: true,
      canvas: { background: '#000000' },
      title: { y: t.titleY || 205, font: t.fontTitleVerse || 'Yeon Sung', color: t.colorTitleVerse || '#39FF5A', stroke: 2, strokeColor: t.colorTitleVerse || '#39FF5A' },
      verse: { y: t.verseY || 280, font: t.fontTitleVerse || 'Yeon Sung', color: t.colorTitleVerse || '#39FF5A', band: { color: '#000000', paddingY: 10 } },
      video: { y: t.videoY || 353, height: t.videoH || 958 },
      subtitle: { y: t.subtitleY || 1390, font: t.fontSubtitleFooter || 'Noto Sans KR', color: t.colorSubtitle || '#ffffff', stroke: 3, strokeColor: '#000000' },
      churchName: { y: (t.footerY || 1620) + 80, font: t.fontSubtitleFooter || 'Noto Sans KR', text: t.churchName || '우리 교회', letterSpacing: 0.35, size: 40 },
      speaker: { y: (t.footerY || 1620) + 150, font: t.fontSubtitleFooter || 'Noto Sans KR', size: 58 },
      logo: { y: t.footerY || 1620, height: 120, path: t.logoPath || 'assets/images/logo-default.png' },
      fadeInSec: (t.fadeMs || 1000) / 1000
    });
  }

  /** align에 따른 x 좌표 해석: 'center'면 중심, 'left'면 왼쪽 끝, 'right'면 오른쪽 끝. */
  function getAnchorX(el) {
    if (!el) return 0;
    return el.x || 0;
  }

  return {
    normalizeTheme: normalizeTheme,
    themeFromLegacyTemplate: themeFromLegacyTemplate,
    getAnchorX: getAnchorX
  };
}));
