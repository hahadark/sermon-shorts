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

  // 배경 mode: solid(단색) | gradient(그라데이션) | blur(영상을 흐리게 키워 배경으로)
  // 글자 anchor: center(여러 줄이면 가운데를 y 에) | top(첫 줄이 y) | bottom(마지막 줄이 y)
  // lineColors: 줄마다 다른 색 ['#FFE14D', '#FFFFFF'] / highlightColor: *강조* 한 말의 색
  // subtitle.karaoke: { mode: 'current'(지금 단어만) | 'progressive'(지나간 단어까지), color, futureColor }
  var DEFAULTS = {
    canvas: { background: '#000000', mode: 'solid', gradient: { from: '#1B2A4A', to: '#05070C', angle: 180 }, blur: { amount: 30, dim: 0.55, tint: null } },
    title: { show: true, align: 'center', x: 540, y: 205, width: 1000, font: 'Noto Sans KR', size: 70, color: '#FFFFFF', weight: 700, maxLines: 2, stroke: 0, strokeColor: null, shadow: null, anchor: 'bottom', lineGap: 1.15, lineColors: null, highlightColor: null, box: null, band: null, italic: false, transform: null },
    verse: { show: true, align: 'center', x: 540, y: 280, width: 1000, font: 'Noto Sans KR', size: 44, color: '#FFFFFF', weight: 400, band: null, anchor: 'center', maxLines: 2, lineGap: 1.2, box: null, italic: false },
    video: { show: true, x: 0, y: 353, width: 1080, height: 958, fit: 'cover', radius: 0, border: null, fade: null, shadow: null },
    subtitle: { show: true, align: 'center', x: 540, y: 1400, width: 1000, font: 'Noto Sans KR', size: 60, color: '#FFFFFF', weight: 700, stroke: 0, strokeColor: '#000000', box: null, maxChars: 14, highlightColor: null, lineGap: 1.2, anchor: 'center', maxLines: 2, karaoke: null, italic: false, transform: null, shadow: null },
    badge: { show: false, text: '{speaker}', align: 'center', x: 540, y: 140, width: 420, font: 'Noto Sans KR', size: 36, weight: 700, color: '#FFFFFF', bg: '#E2416B', radius: 999, padX: 24, padY: 10 },
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

  /**
   * 내보내기에 필요한 추가 층. 렌더러(그림 만들기)와 메인(ffmpeg)이 같은 판단을 쓰도록 여기에 둔다.
   *  bgImage: 그라데이션 배경 그림(bg.png) / blur: 영상을 흐려 배경으로
   *  under: 영상 밑 층(under.png: 색 덮기·영상 그림자) / mask: 둥근 모서리(mask.png)
   */
  function exportLayers(t) {
    t = t || {};
    var c = t.canvas || {}, v = t.video || {};
    var mode = c.mode === 'gradient' || c.mode === 'blur' ? c.mode : 'solid';
    return {
      mode: mode,
      bgImage: mode === 'gradient',
      blur: mode === 'blur',
      under: !!((mode === 'blur' && c.blur && c.blur.tint) || (v.show !== false && v.shadow && (Number(v.shadow.blur) > 0 || Number(v.shadow.offsetX) || Number(v.shadow.offsetY)))),
      mask: v.show !== false && Number(v.radius) > 0
    };
  }

  /** align에 따른 x 좌표 해석: 'center'면 중심, 'left'면 왼쪽 끝, 'right'면 오른쪽 끝. */
  function getAnchorX(el) {
    if (!el) return 0;
    return el.x || 0;
  }

  return {
    normalizeTheme: normalizeTheme,
    themeFromLegacyTemplate: themeFromLegacyTemplate,
    exportLayers: exportLayers,
    getAnchorX: getAnchorX
  };
}));
