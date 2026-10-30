/* 자동 저장: 편집이 멈추고 4초 뒤(그리고 30초마다 확인) 지금 편집을 자동 저장한다 (main/autosave.js).
 * 바뀐 것이 없으면 쓰지 않는다. 2분에 하나씩 과거 작업본을 남긴다. 창을 닫을 때도 한 번 저장한다.
 * 편집기가 갑자기 꺼졌으면 다음에 켤 때 "지난 작업 불러오기"를 묻고, [파일 > 자동 저장본 열기]로 언제든 과거 작업본을 연다. */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const DEBOUNCE_MS = Number(window.__ssAutosaveDebounce) || 4000;
  const two = (n) => String(n).padStart(2, '0');
  const hm = (t) => { const d = new Date(t); return two(d.getHours()) + ':' + two(d.getMinutes()); };
  function when(t) {
    if (!t) return '';
    const d = new Date(t), now = new Date();
    const day = d.toDateString() === now.toDateString() ? '오늘' : new Date(now - 864e5).toDateString() === d.toDateString() ? '어제' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
    return `${day} ${hm(t)}`;
  }
  const fmtDur = (s) => { s = Math.round(s || 0); return Math.floor(s / 60) + '분 ' + two(s % 60) + '초'; };

  // 켜자마자는 '지난 작업 불러오기'를 확인할 때까지 멈춰 둔다 (같은 영상을 열어도 꺼지기 전 저장본을 덮어쓰지 않게)
  let lastCmp = '', lastAt = 0, timer = null, saving = null, paused = 1, crashHold = true;
  const stats = { writes: 0, skips: 0, versions: 0 };

  function canSave() {
    const st = SS.state;
    return !!(st && st.source && st.source.path && Array.isArray(st.words) && st.words.length && SS.project && !paused);
  }
  function build() {
    if (SS.readProjectMeta) { try { SS.readProjectMeta(); } catch (_) { /* */ } }
    return SS.project.snapshot(SS.state, SS.preview ? SS.preview.currentTime : 0);
  }
  function summaryOf(st) {
    let dur = 0, segs = [];
    try { segs = SS.getSegments ? SS.getSegments() : []; dur = segs.reduce((a, s) => a + Math.max(0, s.end - s.start), 0); } catch (_) { /* */ }
    return { dur: Math.round(dur * 10) / 10, cuts: segs.length, kept: st.words.filter((w) => !w.del).length, total: st.words.length };
  }
  /** 지금 편집을 자동 저장. 바뀐 것이 없으면 건너뜀 (force 면 작업본도 하나 남김) */
  async function saveNow(opt) {
    opt = opt || {};
    if (saving) { await saving; }
    if (!canSave()) return null;
    const snap = build(), st = SS.state;
    const cmp = JSON.stringify({ ...snap, playhead: 0 }) + '|' + (SS.projectPath || '');
    if (cmp === lastCmp && !opt.force) { stats.skips++; return null; }
    const src = st.source || {};
    const name = String(src.path || '').split(/[\\/]/).pop();
    const payload = {
      sourceKey: (src.url || src.path) + '|' + (Number(src.offset) || 0),
      title: (st.meta && st.meta.title) || src.title || name || '편집', sourcePath: src.path || '', sourceName: src.title || name, sourceUrl: src.url || '',
      projectPath: SS.projectPath || '', summary: summaryOf(st), data: JSON.stringify(snap), forceVersion: !!opt.force,
    };
    saving = (async () => {
      try {
        const r = await api.autosaveWrite(payload);
        lastCmp = cmp; lastAt = r.at; stats.writes++; if (r.versioned) stats.versions++;
        showStatus();
        return r;
      } catch (e) { console.warn('[autosave] 저장 실패', e); showStatus(cleanErr(e)); return null; }
    })();
    try { return await saving; } finally { saving = null; }
  }
  function schedule() { if (!canSave()) return; clearTimeout(timer); timer = setTimeout(() => { timer = null; saveNow(); }, DEBOUNCE_MS); }
  /** 다른 작업본을 여는 동안처럼 상태가 바뀌는 중에는 저장하지 않는다 */
  async function quiet(fn) { paused++; clearTimeout(timer); try { return await fn(); } finally { paused--; } }

  // ---------------- 상단 표시: "자동 저장됨 14:32" ----------------
  function showStatus(err) {
    let el = $('asvStatus');
    if (!el) {
      const host = $('fileName'); if (!host || !host.parentElement) return;
      el = document.createElement('button');
      el.id = 'asvStatus'; el.type = 'button'; el.className = 'asv-status';
      el.addEventListener('click', () => openBrowser());
      host.insertAdjacentElement('afterend', el);
    }
    el.hidden = false;
    el.classList.toggle('err', !!err);
    el.innerHTML = err ? '<span class="ico xs i-info"></span>자동 저장 실패' : `<span class="ico xs i-history"></span>자동 저장됨 ${hm(lastAt)}`;
    el.title = err ? '자동 저장하지 못했습니다: ' + err : '편집은 자동으로 저장됩니다. 눌러서 과거 작업본 보기';
  }

  // ---------------- 자동 저장본 창 ----------------
  function buildModal() {
    let m = $('asvModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'asvModal'; m.className = 'modal-overlay asv-modal'; m.hidden = true;
    m.innerHTML = `<div class="modal-dialog asv-dialog" role="dialog" aria-modal="true" aria-labelledby="asvTitle">
      <div class="asv-head"><div><h3 id="asvTitle">자동 저장본</h3><p id="asvLead"></p></div>
        <button class="btn ghost icon-only ico i-x" data-close title="닫기 (Esc)" aria-label="닫기"></button></div>
      <div class="asv-list" id="asvList"></div>
      <div class="asv-foot"><span>편집하는 동안 몇 초마다 자동 저장되고, 2분마다 작업본이 하나씩(영상마다 최근 30개) 남습니다.</span><button class="bm-link" id="asvDir" type="button">폴더 열기</button></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeBrowser(); });
    m.addEventListener('keydown', (e) => e.stopPropagation());
    $('asvDir').addEventListener('click', () => api.autosaveOpenDir());
    return m;
  }
  let wasDialog = false, browserMode = 'list';
  async function openBrowser(opt) {
    opt = opt || {};
    const m = buildModal();
    if (m.hidden) wasDialog = !!(SS.state && SS.state.dialogOpen);
    if (SS.state) SS.state.dialogOpen = true;
    browserMode = opt.crash ? 'crash' : 'list';
    m.classList.toggle('crash', !!opt.crash);
    $('asvTitle').textContent = opt.crash ? '지난 작업을 불러올까요?' : '자동 저장본';
    $('asvLead').textContent = opt.crash
      ? `편집기가 지난번(${when(opt.crashedAt)}에 시작한 편집)에 제대로 닫히지 않았습니다. 자동 저장된 작업을 다시 열 수 있습니다.`
      : '저장하지 않고 닫았거나 갑자기 꺼졌을 때, 자동 저장된 작업을 다시 엽니다. 작업본을 펼치면 그보다 앞선 상태로도 돌아갈 수 있습니다.';
    m.hidden = false;
    let entries = opt.entries;
    if (!entries) { $('asvList').innerHTML = '<div class="asv-empty">불러오는 중…</div>'; try { entries = await api.autosaveList(); } catch (e) { entries = []; } }
    render(entries, opt);
    setTimeout(() => { const b = m.querySelector('[data-open]'); if (b) b.focus(); }, 0);
  }
  function releaseCrashHold() { if (crashHold) { crashHold = false; paused--; schedule(); } }
  function closeBrowser() {
    const m = $('asvModal'); if (!m || m.hidden) return;
    m.hidden = true;
    releaseCrashHold();
    if (SS.state) SS.state.dialogOpen = wasDialog;
  }
  function sumText(s) { return s ? `결과 ${fmtDur(s.dur)} · ${s.cuts}컷 · 남긴 단어 ${s.kept}/${s.total}` : ''; }
  function render(entries, opt) {
    const box = $('asvList');
    if (!entries.length) { box.innerHTML = '<div class="asv-empty"><b>자동 저장본이 없습니다</b>영상을 열고 편집하면 자동으로 저장됩니다.</div>'; return; }
    box.innerHTML = entries.map((e, i) => `<div class="asv-item${opt.crash && i === 0 ? ' first' : ''}" data-key="${esc(e.key)}">
      <div class="asv-main">
        <div class="asv-info"><b>${esc(e.title || e.sourceName || '편집')}</b>
          <span>${esc(when(e.updatedAt))} 자동 저장 · ${esc(sumText(e.summary))}</span>
          <span class="asv-src" title="${esc(e.sourcePath)}">${e.sourceMissing ? '<b class="asv-miss">원본 영상을 찾을 수 없음</b> · ' : ''}${esc(e.sourceName || '')}${e.projectPath ? ' · 프로젝트 ' + esc(e.projectPath.split(/[\\/]/).pop()) : ''}</span></div>
        <button class="btn ${i === 0 ? 'primary' : ''} sm" data-open="current.sshorts"${e.sourceMissing ? ' disabled title="원본 영상이 없어 열 수 없습니다"' : ''}>${opt.crash && i === 0 ? '불러오기' : '열기'}</button>
        <button class="btn sm ghost asv-more" data-more aria-expanded="false">작업본 ${e.versions.length - 1}개</button>
        <button class="btn sm ghost icon-only ico i-trash-2" data-del title="이 영상의 자동 저장본 지우기" aria-label="지우기"></button>
      </div>
      <div class="asv-vers" hidden>${e.versions.slice(1).map((v) => `<div class="asv-ver"><span class="asv-vt">${esc(when(v.at))}:${two(new Date(v.at).getSeconds())}</span><span class="asv-vs">${esc(sumText(v.summary))}</span><button class="btn sm" data-open="${esc(v.file)}"${e.sourceMissing ? ' disabled' : ''}>이 상태로 열기</button></div>`).join('') || '<div class="asv-ver"><span class="asv-vs">아직 남은 작업본이 없습니다.</span></div>'}</div>
    </div>`).join('');
    box.querySelectorAll('.asv-item').forEach((it) => {
      const key = it.dataset.key;
      it.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openSaved(key, b.dataset.open)));
      it.querySelector('[data-more]').addEventListener('click', (ev) => { const v = it.querySelector('.asv-vers'); v.hidden = !v.hidden; ev.currentTarget.setAttribute('aria-expanded', String(!v.hidden)); });
      it.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('이 영상의 자동 저장본(작업본 포함)을 모두 지울까요?')) return;
        await api.autosaveRemove(key); it.remove();
        if (!box.querySelector('.asv-item')) render([], opt);
      });
    });
  }
  /** 자동 저장본 열기: 지금 편집을 먼저 저장해 두고 연다 */
  async function openSaved(key, file) {
    const m = $('asvModal');
    m.querySelectorAll('button').forEach((b) => { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; });
    try {
      if (canSave()) await saveNow({ force: true }); // 지금 상태를 작업본으로 남겨 두고 연다
      const r = await api.autosaveRead(key, file);
      await quiet(async () => { await SS.importProjectState(r.data); });
      releaseCrashHold();
      SS.projectPath = r.projectPath || null;
      lastCmp = JSON.stringify({ ...build(), playhead: 0 }) + '|' + (SS.projectPath || '');
      closeBrowser();
      if (SS.toast) SS.toast(file === 'current.sshorts' ? '자동 저장된 작업을 열었습니다' + (r.projectPath ? ' (저장하면 원래 프로젝트 파일에 저장됩니다)' : '') : '과거 작업본을 열었습니다. 지금부터 편집하면 이 상태에서 이어서 자동 저장됩니다', 6000);
      window.dispatchEvent(new CustomEvent('ss:autosave-opened', { detail: { key, file } }));
    } catch (e) {
      if (SS.toast) SS.toast('열지 못했습니다: ' + cleanErr(e), 8000);
    } finally {
      if (m) m.querySelectorAll('button').forEach((b) => { if (b.dataset.wasDisabled !== undefined) { b.disabled = b.dataset.wasDisabled === '1'; delete b.dataset.wasDisabled; } });
    }
  }

  // ---------------- 연결 ----------------
  function wrap(name) {
    const f = SS[name]; if (typeof f !== 'function' || f.__asv) return;
    const g = function () { const r = f.apply(this, arguments); schedule(); return r; };
    g.__asv = true; SS[name] = g;
  }
  function init() {
    // 편집 신호: 실행 취소 기록이 쌓일 때, 단어·디자인이 바뀔 때, 입력칸을 고칠 때
    wrap('pushUndo');
    ['ss:words-changed', 'ss:template-changed', 'ss:theme-edited', 'ss:transcript-ready', 'ss:source-loaded'].forEach((ev) => window.addEventListener(ev, schedule));
    document.addEventListener('input', (e) => { if (!e.target.closest || !e.target.closest('#asvModal, #bgmMgr, #mnStudio')) schedule(); }, true);
    document.addEventListener('change', (e) => { if (!e.target.closest || !e.target.closest('#asvModal, #bgmMgr, #mnStudio')) schedule(); }, true);
    setInterval(() => { if (!timer) saveNow(); }, 30000);
    // 직접 저장하면 프로젝트 파일 위치를 자동 저장본에도 적어 둔다
    const sp = SS.saveProjectTo;
    if (sp && !sp.__asv) { SS.saveProjectTo = async function (p) { const r = await sp.apply(this, arguments); saveNow(); return r; }; SS.saveProjectTo.__asv = true; }
    // 창을 닫을 때 마지막으로 한 번
    if (api.onAutosaveFlush) api.onAutosaveFlush(async () => { try { clearTimeout(timer); await saveNow(); } finally { api.autosaveFlushed(); } });
    // 지난번에 갑자기 꺼졌으면 묻기
    setTimeout(checkCrash, 1200);
  }
  async function checkCrash() {
    try {
      const launch = await api.getLaunchInfo();
      if (launch.testScript && !/^autosave/.test(launch.testScript)) { releaseCrashHold(); return; } // 다른 자동 시험 중에는 묻지 않음
      const st = await api.autosaveStatus();
      if (!st.crashed || !st.entries.length) { releaseCrashHold(); return; }
      if ((SS.state && SS.state.dialogOpen) || document.querySelector('.settings-overlay:not(.hidden), .syscheck-overlay:not(.hidden)')) { setTimeout(checkCrash, 2000); return; }
      openBrowser({ crash: true, entries: st.entries, crashedAt: st.crashedAt });
    } catch (e) { console.warn('[autosave] 확인 실패', e); releaseCrashHold(); }
  }
  window.addEventListener('keydown', (e) => {
    const m = $('asvModal');
    if (e.key !== 'Escape' || e.defaultPrevented || !m || m.hidden) return;
    e.preventDefault(); e.stopPropagation(); closeBrowser();
  }, true);

  SS.autosave = { saveNow, schedule, stats, openBrowser, closeBrowser, openSaved, checkCrash, get lastAt() { return lastAt; } };
  SS.openAutosaves = () => openBrowser();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0)); else setTimeout(init, 0);
})();
