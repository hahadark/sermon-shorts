/* 미리보기용 영상(main/preview-proxy.js)을 뒤에서 만들고, 준비되면 미리보기만 그 영상으로 바꾼다.
 * 재생 중이면 멈출 때 바꾼다 (재생이 끊기지 않게). 내보내기·자막 만들기는 늘 원본(SS.state.source.path). */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  let cur = null;        // { src, ready: path|null, state }
  let waiting = null;    // 재생 중이라 멈추면 바꿀 경로
  const enabled = () => !(SS.appSettings && SS.appSettings.previewProxy === false);
  function el() {
    let e = document.getElementById('proxyStatus');
    if (!e) {
      const host = document.getElementById('fileName'); if (!host || !host.parentElement) return null;
      e = document.createElement('span'); e.id = 'proxyStatus'; e.className = 'proxy-status';
      host.insertAdjacentElement('afterend', e);
    }
    return e;
  }
  function status(text, title, cls) {
    const e = el(); if (!e) return;
    e.hidden = !text; e.textContent = text || ''; e.title = title || ''; e.className = 'proxy-status' + (cls ? ' ' + cls : '');
  }
  async function swapNow(p) {
    try {
      await SS.preview.useMedia(p);
      cur.state = 'ready';
      status('부드러운 미리보기', '지운 곳을 건너뛸 때 끊기지 않도록 미리보기용 영상(기준 화면 0.5초마다)을 씁니다. 내보내기는 원본으로 합니다.', 'ok');
      window.dispatchEvent(new CustomEvent('ss:proxy-ready', { detail: { src: cur.src, path: p } }));
    } catch (e) { status('', ''); console.warn('[proxy] 바꾸지 못함', e); }
  }
  function trySwap() {
    if (!waiting || !cur || !SS.preview) return;
    const v = SS.preview.video;
    if (!v.paused) return;              // 멈출 때 다시 (pause 이벤트)
    const p = waiting; waiting = null;
    swapNow(p);
  }
  let testSkip = null;   // 다른 자동 시험 중에는 바꾸지 않는다 (시험 도중 영상이 바뀌면 결과가 흔들림)
  async function start(src) {
    cur = { src, ready: null, state: 'idle' }; waiting = null;
    if (testSkip == null) { try { const l = await api.getLaunchInfo(); testSkip = !!(l.testScript && l.testScript !== 'smoothpreview'); } catch (_) { testSkip = false; } }
    if (testSkip || !enabled() || !src || !api.proxyEnsure) { status(''); return; }
    status('미리보기 준비 중', '건너뛸 때 끊기지 않게 미리보기용 영상을 만들고 있습니다. 그동안에도 편집할 수 있습니다.', 'busy');
    const mine = cur;
    try {
      const r = await api.proxyEnsure(src);
      if (cur !== mine) return;
      if (r && r.path) { mine.ready = r.path; waiting = r.path; trySwap(); if (waiting) status('미리보기 준비됨 · 멈추면 바뀜', '재생을 멈추면 미리보기용 영상으로 바꿉니다.', 'busy'); }
      else { mine.state = r && r.skipped || 'skipped'; status(''); }
    } catch (e) {
      if (cur !== mine) return;
      mine.state = 'error';
      status('미리보기 준비 못 함', '미리보기용 영상을 만들지 못해 원본으로 미리 봅니다 (건너뛸 때 조금 끊길 수 있음). ' + String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err');
    }
  }
  function init() {
    if (!SS.preview || !SS.preview.video) { setTimeout(init, 100); return; }
    SS.preview.video.addEventListener('pause', () => setTimeout(trySwap, 0));
    if (api.onProgress) api.onProgress((info) => {
      if (!info || info.task !== 'proxy' || !cur || info.src !== cur.src || cur.ready) return;
      status('미리보기 준비 중 ' + Math.round(info.pct || 0) + '%', '건너뛸 때 끊기지 않게 미리보기용 영상을 만들고 있습니다. 그동안에도 편집할 수 있습니다.', 'busy');
    });
    window.addEventListener('ss:video-opened', (e) => start(e.detail && e.detail.path));
  }
  SS.previewProxy = { start, get state() { return cur && cur.state; }, get ready() { return cur && cur.ready; }, get pending() { return waiting; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);
})();
