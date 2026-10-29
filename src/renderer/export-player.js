/* 내보내기 뒤 재생 창: 만든 MP4 를 앱 안에서 바로 틀어 본다 (다시 재생·폴더에서 보기·닫기).
 * SS.showExportPlayer(outPath, { duration, srtPath }) */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let wasDialog = false;

  function build() {
    let m = $('expPlayer');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'expPlayer'; m.className = 'modal-overlay exp-player'; m.hidden = true;
    m.innerHTML = `<div class="modal-dialog exp-dialog" role="dialog" aria-modal="true" aria-labelledby="expTitle">
      <div class="exp-head"><div><h3 id="expTitle">완성 영상</h3><p id="expInfo"></p></div>
        <button class="btn ghost icon-only ico i-x" type="button" data-close title="닫기 (Esc)" aria-label="닫기"></button></div>
      <div class="exp-stage"><video id="expVideo" controls playsinline preload="auto"></video></div>
      <div class="exp-foot">
        <button class="btn sm ico i-rotate-ccw" type="button" id="expReplay">처음부터 다시</button>
        <button class="btn sm ico i-folder-open" type="button" id="expFolder">폴더에서 보기</button>
        <span class="exp-spacer"></span>
        <button class="btn sm primary" type="button" data-close>닫기</button>
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) close(); });
    m.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === ' ' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'VIDEO') { e.preventDefault(); const v = $('expVideo'); if (v.paused) v.play().catch(() => {}); else v.pause(); }
      e.stopPropagation();
    });
    $('expReplay').addEventListener('click', () => { const v = $('expVideo'); v.currentTime = 0; v.play().catch(() => {}); });
    $('expFolder').addEventListener('click', () => { const p = m.dataset.path; if (p && window.api.materialsOpenPath) window.api.materialsOpenPath(p); });
    $('expVideo').addEventListener('error', () => { $('expInfo').textContent = '영상을 재생하지 못했습니다. [폴더에서 보기]로 열어 보세요.'; });
    return m;
  }

  function open(outPath, info) {
    if (!outPath) return;
    const m = build();
    info = info || {};
    if (SS.preview && !SS.preview.paused) SS.preview.pause();
    if (SS.bgmUi && SS.bgmUi.mix && !SS.bgmUi.mix.paused) SS.bgmUi.mix.pause();
    const name = String(outPath).split(/[\\/]/).pop();
    m.dataset.path = outPath;
    $('expTitle').textContent = '완성 영상 · ' + name;
    const dur = Number(info.duration);
    $('expInfo').innerHTML = esc((Number.isFinite(dur) && dur > 0 ? '길이 ' + SS.fmtTime(dur).replace(/\.\d+$/, '') + ' · ' : '') + 'MP4' + (info.srtPath ? '와 자막(SRT)' : '') + '을 저장했습니다.') + ' <span class="exp-path">' + esc(outPath) + '</span>';
    const v = $('expVideo');
    v.src = (SS.toFileUrl ? SS.toFileUrl(outPath) : 'file:///' + String(outPath).replace(/\\/g, '/')) + '?t=' + Date.now();
    wasDialog = !!(SS.state && SS.state.dialogOpen);
    if (SS.state) SS.state.dialogOpen = true;
    m.hidden = false;
    v.currentTime = 0;
    v.play().catch(() => {});
    setTimeout(() => { try { m.querySelector('[data-close].primary').focus({ preventScroll: true }); } catch (_) { /* */ } }, 0);
  }

  function close() {
    const m = $('expPlayer');
    if (!m || m.hidden) return;
    const v = $('expVideo');
    v.pause(); v.removeAttribute('src'); v.load();
    m.hidden = true;
    if (SS.state) SS.state.dialogOpen = wasDialog;
  }

  SS.showExportPlayer = open;
  SS.closeExportPlayer = close;
})();
