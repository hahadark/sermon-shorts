/* 내보내기 뒤 완성 영상 창: 만든 MP4 를 앱 안에서 바로 틀어 보고, 점검한 뒤 유튜브에 올린다.
 *  - 왼쪽: 완성 영상 (다시 재생·폴더에서 보기·닫기)
 *  - 오른쪽: 유튜브에 올리기 (점검 목록 → 제목·설명·공개 범위 → 올리기 → 링크)
 *    점검 목록을 모두 체크해야 [유튜브에 올리기]가 켜진다. 끝까지 재생하면 '처음부터 끝까지 봤어요'는 저절로 체크된다.
 *    설정 → 유튜브 → '영상을 만든 뒤': review(점검하고 올리기, 기본) / auto(바로 올리기) / off(이 칸을 접어 둠)
 * SS.showExportPlayer(outPath, { duration, srtPath, autoUpload }) */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cleanIpc = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const NAMES = { unlisted: '일부공개', private: '비공개', public: '공개' };
  const CHECKS = [
    { id: 'watched', label: '처음부터 끝까지 재생해 봤어요', note: '끝까지 재생하면 저절로 체크됩니다' },
    { id: 'text', label: '제목·자막에 틀린 글자가 없어요' },
    { id: 'sound', label: '말소리·배경음악 크기가 알맞아요' },
  ];
  let wasDialog = false;
  const uploaded = new Map();   // outPath → { url, studio, privacy } (같은 영상을 두 번 올리지 않게)
  let busyPath = '';            // 올리는 중인 영상
  let watchedSec = 0;

  function build() {
    let m = $('expPlayer');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'expPlayer'; m.className = 'modal-overlay exp-player'; m.hidden = true;
    m.innerHTML = `<div class="modal-dialog exp-dialog" role="dialog" aria-modal="true" aria-labelledby="expTitle">
      <div class="exp-head"><div><h3 id="expTitle">완성 영상</h3><p id="expInfo"></p></div>
        <button class="btn ghost icon-only ico i-x" type="button" data-close title="닫기 (Esc)" aria-label="닫기"></button></div>
      <div class="exp-body">
        <div class="exp-left">
          <div class="exp-stage"><video id="expVideo" controls playsinline preload="auto"></video></div>
          <div class="exp-foot">
            <button class="btn sm ico i-rotate-ccw" type="button" id="expReplay">처음부터 다시</button>
            <button class="btn sm ico i-folder-open" type="button" id="expFolder">폴더에서 보기</button>
            <button class="btn sm ico i-square-play" type="button" id="expYtShow" hidden>유튜브에 올리기…</button>
            <span class="exp-spacer"></span>
            <button class="btn sm primary" type="button" data-close>닫기</button>
          </div>
        </div>
        <section class="exp-yt" id="expYt" aria-label="유튜브에 올리기" hidden>
          <h4 class="ico i-square-play">유튜브에 올리기</h4>
          <div id="expYtBody"></div>
        </section>
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) close(); });
    m.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === ' ' && !typing && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'VIDEO') { e.preventDefault(); const v = $('expVideo'); if (v.paused) v.play().catch(() => {}); else v.pause(); }
      e.stopPropagation();
    });
    $('expReplay').addEventListener('click', () => { const v = $('expVideo'); v.currentTime = 0; v.play().catch(() => {}); });
    $('expFolder').addEventListener('click', () => { const p = m.dataset.path; if (p && api.materialsOpenPath) api.materialsOpenPath(p); });
    $('expYtShow').addEventListener('click', () => { $('expYt').hidden = false; $('expYtShow').hidden = true; m.querySelector('.exp-dialog').classList.add('with-yt'); });
    const v = $('expVideo');
    v.addEventListener('error', () => { $('expInfo').textContent = '영상을 재생하지 못했습니다. [폴더에서 보기]로 열어 보세요.'; });
    // 끝까지 봤는지: 재생이 끝나거나, 실제로 재생한 시간이 영상의 95% 이상이면
    let lastT = 0;
    v.addEventListener('timeupdate', () => {
      const d = v.duration || 0, t = v.currentTime || 0;
      if (!v.paused && !v.seeking && t > lastT && t - lastT < 1.5) watchedSec += t - lastT;
      lastT = t;
      if (d > 0 && watchedSec >= d * 0.95) markWatched();
    });
    v.addEventListener('ended', markWatched);
    return m;
  }
  function markWatched() { const c = $('expChk_watched'); if (c && !c.checked) { c.checked = true; refreshGo(); } }

  // ---------------- 유튜브 칸 ----------------
  function metaNow() {
    const meta = (SS.state && SS.state.meta) || {};
    return { title: meta.title || '', verse: meta.verse || '', speaker: meta.speaker || (SS.appSettings && SS.appSettings.defaultSpeaker) || '', church: (SS.appSettings && SS.appSettings.template && SS.appSettings.template.churchName) || '', credits: SS.state && SS.state.bgm && SS.bgmCredit ? SS.bgmCredit() : '' };
  }
  function refreshGo() {
    const go = $('expYtGo'); if (!go) return;
    const all = CHECKS.every((c) => $('expChk_' + c.id) && $('expChk_' + c.id).checked);
    const title = ($('expYtTitle') && $('expYtTitle').value.trim()) || '';
    go.disabled = !all || !title || !!busyPath;
    const hint = $('expYtHint');
    if (hint) hint.textContent = busyPath ? '' : !all ? '점검 목록을 모두 체크하면 올릴 수 있습니다.' : !title ? '제목을 넣어 주세요.' : '';
  }
  function doneView(outPath, r) {
    const body = $('expYtBody'); if (!body) return;
    body.innerHTML = `<div class="exp-yt-done"><b>유튜브에 올렸습니다</b> · ${esc(NAMES[r.privacy] || r.privacy || '')}
      <a href="#" id="expYtLink">${esc(r.url)}</a>
      <div class="exp-yt-row"><button class="btn sm" id="expYtCopy">링크 복사</button><button class="btn sm primary" id="expYtStudio">유튜브 스튜디오에서 보기</button></div>
      ${r.privacy !== 'public' ? '<p class="exp-yt-note">공개로 바꾸려면 유튜브 스튜디오에서 공개 범위를 바꾸세요.</p>' : ''}</div>`;
    $('expYtLink').onclick = (e) => { e.preventDefault(); api.ytupOpenUrl(r.url); };
    $('expYtCopy').onclick = async () => { try { await navigator.clipboard.writeText(r.url); SS.toast('링크를 복사했습니다'); } catch (_) { /* */ } };
    $('expYtStudio').onclick = () => api.ytupOpenUrl(r.studio);
  }
  async function renderYt(outPath, opt) {
    const box = $('expYt'), body = $('expYtBody'), dlg = $('expPlayer').querySelector('.exp-dialog');
    let st = null;
    try { st = await api.ytupStatus(); } catch (_) { st = null; }
    if ($('expPlayer').dataset.path !== outPath) return;   // 그 사이 다른 영상을 열었음
    const mode = (st && st.uploadMode) || 'review';
    const show = (on) => { box.hidden = !on; dlg.classList.toggle('with-yt', on); $('expYtShow').hidden = on || !st; };
    if (!st) { show(false); $('expYtShow').hidden = true; return; }
    if (uploaded.has(outPath)) { show(true); doneView(outPath, uploaded.get(outPath)); return; }
    if (!st.loggedIn) {
      body.innerHTML = '<p class="exp-yt-note">유튜브에 올리려면 먼저 로그인해 주세요.</p><button class="btn sm" id="expYtLogin">설정 → 유튜브 열기</button>';
      $('expYtLogin').onclick = () => { close(); if (SS.openSettings) SS.openSettings('youtube'); };
      show(mode !== 'off'); return;
    }
    let d = { title: '', description: '', privacy: st.privacy };
    try { d = await api.ytupDefaults(metaNow()); } catch (_) { /* 기본값 없이 */ }
    if ($('expPlayer').dataset.path !== outPath) return;
    body.innerHTML = `
      <p class="exp-yt-note">채널: <b>${esc(st.channel || '내 채널')}</b></p>
      <fieldset class="exp-yt-checks"><legend>점검</legend>
        ${CHECKS.map((c) => `<label><input type="checkbox" id="expChk_${c.id}"> ${esc(c.label)}${c.note ? `<small>${esc(c.note)}</small>` : ''}</label>`).join('')}
      </fieldset>
      <label class="exp-yt-field">제목 <span id="expYtCount"></span><input id="expYtTitle" maxlength="100" value="${esc(d.title)}"></label>
      <label class="exp-yt-field">설명<textarea id="expYtDesc" rows="5" maxlength="5000">${esc(d.description)}</textarea></label>
      <label class="exp-yt-field">공개 범위<select id="expYtPrivacy">
        <option value="unlisted">일부공개 (링크가 있는 사람만)</option><option value="private">비공개 (나만)</option><option value="public">공개</option></select></label>
      <div class="exp-yt-row"><button class="btn primary ico i-upload" id="expYtGo" disabled>유튜브에 올리기</button></div>
      <div class="exp-yt-prog" id="expYtProg" hidden><div><i id="expYtBar"></i></div><span id="expYtPct"></span></div>
      <p class="exp-yt-hint" id="expYtHint" aria-live="polite"></p>`;
    $('expYtPrivacy').value = d.privacy || st.privacy || 'unlisted';
    const count = () => { $('expYtCount').textContent = $('expYtTitle').value.length + '/100'; };
    count();
    CHECKS.forEach((c) => $('expChk_' + c.id).addEventListener('change', refreshGo));
    $('expYtTitle').addEventListener('input', () => { count(); refreshGo(); });
    if (watchedSec > 0 && $('expVideo').duration && watchedSec >= $('expVideo').duration * 0.95) $('expChk_watched').checked = true;
    $('expYtGo').onclick = () => upload(outPath);
    refreshGo();
    show(mode !== 'off');
    if (mode === 'auto' && opt && opt.autoUpload) { CHECKS.forEach((c) => { $('expChk_' + c.id).checked = true; }); refreshGo(); upload(outPath); }
  }
  async function upload(outPath) {
    if (busyPath || uploaded.has(outPath)) return;
    const title = $('expYtTitle').value.trim(); if (!title) return;
    const meta = { ...metaNow(), title, description: $('expYtDesc').value, privacy: $('expYtPrivacy').value };
    busyPath = outPath; refreshGo();
    ['expYtTitle', 'expYtDesc', 'expYtPrivacy'].forEach((id) => { $(id).disabled = true; });
    $('expYtProg').hidden = false; $('expYtPct').textContent = '준비 중…';
    const off = api.onProgress((p) => {
      if (!p || p.task !== 'ytupload' || !Number.isFinite(p.pct)) return;
      if ($('expYtBar')) { $('expYtBar').style.width = p.pct + '%'; $('expYtPct').textContent = p.pct + '%'; }
    });
    try {
      const r = await SS.ytUploadNow(outPath, meta);
      uploaded.set(outPath, r);
      if ($('expPlayer').dataset.path === outPath && !$('expPlayer').hidden) doneView(outPath, r);
      else SS.toast('유튜브에 올렸습니다: ' + r.url, 9000);
    } catch (e) {
      SS.toast('유튜브 업로드 실패: ' + cleanIpc(e), 9000);
      if ($('expYtHint')) $('expYtHint').textContent = '올리지 못했습니다: ' + cleanIpc(e);
      ['expYtTitle', 'expYtDesc', 'expYtPrivacy'].forEach((id) => { if ($(id)) $(id).disabled = false; });
      if ($('expYtProg')) $('expYtProg').hidden = true;
    } finally { off(); busyPath = ''; refreshGo(); }
  }

  function open(outPath, info) {
    if (!outPath) return;
    const m = build();
    info = info || {};
    if (SS.preview && !SS.preview.paused) SS.preview.pause();
    if (SS.bgmUi && SS.bgmUi.mix && !SS.bgmUi.mix.paused) SS.bgmUi.mix.pause();
    const name = String(outPath).split(/[\\/]/).pop();
    m.dataset.path = outPath;
    watchedSec = 0;
    $('expTitle').textContent = '완성 영상 · ' + name;
    const dur = Number(info.duration);
    $('expInfo').innerHTML = esc((Number.isFinite(dur) && dur > 0 ? '길이 ' + SS.fmtTime(dur).replace(/\.\d+$/, '') + ' · ' : '') + 'MP4' + (info.srtPath ? '와 자막(SRT)' : '') + '을 저장했습니다.') + ' <span class="exp-path">' + esc(outPath) + '</span>';
    const v = $('expVideo');
    v.src = (SS.toFileUrl ? SS.toFileUrl(outPath) : 'file:///' + String(outPath).replace(/\\/g, '/')) + '?t=' + Date.now();
    if (m.hidden) wasDialog = !!(SS.state && SS.state.dialogOpen); // 이미 열린 채 다시 열면(연속 내보내기) 처음 상태를 기억해 둔다
    if (SS.state) SS.state.dialogOpen = true;
    $('expYt').hidden = true; $('expYtShow').hidden = true; m.querySelector('.exp-dialog').classList.remove('with-yt');
    $('expYtBody').innerHTML = '';   // 앞 영상의 결과(올렸습니다 등)가 잠깐이라도 남지 않게
    m.hidden = false;
    v.currentTime = 0;
    v.play().catch(() => {});
    renderYt(outPath, info);
    setTimeout(() => { try { m.querySelector('[data-close].primary').focus({ preventScroll: true }); } catch (_) { /* */ } }, 0);
  }

  function close() {
    const m = $('expPlayer');
    if (!m || m.hidden) return;
    const v = $('expVideo');
    v.pause(); v.removeAttribute('src'); v.load();
    m.hidden = true;
    if (SS.state) SS.state.dialogOpen = wasDialog;
    if (busyPath) SS.toast('유튜브 업로드는 계속 진행됩니다. 끝나면 알려 드립니다.', 5000);
  }

  SS.showExportPlayer = open;
  SS.closeExportPlayer = close;
  SS._exportPlayerTest = { get uploaded() { return uploaded; }, refreshGo, markWatched, get busy() { return busyPath; } };
})();
