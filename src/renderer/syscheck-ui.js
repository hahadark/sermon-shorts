'use strict';
// 시스템 점검 창: 상단 [점검] 버튼, 첫 실행 때, 꼭 필요한 도구가 없을 때 자동으로 연다.
(function () {
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  let overlay = null;

  // 점검·설정 창 스타일 (styles.css는 다른 작업과 겹치지 않게 건드리지 않음)
  if (!document.getElementById('ss-syscheck-style')) {
    const st = document.createElement('style');
    st.id = 'ss-syscheck-style';
    st.textContent = "/* 시스템 점검 */\n.btn.sm { height: 26px; padding: 0 10px; font-size: 12px; }\n.syscheck-dialog { width: 720px; }\n.syscheck-sub { color: var(--muted); font-size: 12px; margin: -6px 0 10px; }\n.syscheck-list { display: flex; flex-direction: column; gap: 6px; max-height: 66vh; overflow-y: auto; margin-bottom: 14px; }\n.syscheck-loading { padding: 30px; text-align: center; color: var(--muted); }\n.syscheck-item { background: #f6f8fb; border: 1px solid #e6ebf2; border-left: 4px solid #d5dde8; border-radius: 6px; padding: 8px 12px; }\n.syscheck-item.ok { border-left-color: #16a34a; }\n.syscheck-item.warn { border-left-color: #d97706; }\n.syscheck-item.error { border-left-color: #dc2626; }\n.syscheck-main { display: flex; align-items: center; gap: 10px; min-height: 26px; }\n.syscheck-item .icon { width: 18px; text-align: center; font-weight: 800; font-size: 15px; }\n.syscheck-item.ok .icon { color: #15803d; }\n.syscheck-item.warn .icon { color: #b45309; }\n.syscheck-item.error .icon { color: #dc2626; }\n.syscheck-item .name { font-weight: 700; flex: 0 0 160px; }\n.syscheck-item .value { flex: 1; color: #334155; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: text; }\n.syscheck-item .actions { display: flex; gap: 6px; }\n.syscheck-item .hint { font-size: 11.5px; color: var(--muted); margin: 4px 0 0 28px; user-select: text; word-break: break-all; }\n.syscheck-item.error .hint { color: #dc2626; }\n.syscheck-item .result { font-size: 12px; margin: 4px 0 0 28px; user-select: text; }\n.syscheck-item .result:empty { display: none; }\n.result.ok, .test-result.ok { color: #15803d; }\n.result.error, .test-result.error { color: #dc2626; }\n.result.busy, .test-result.busy { color: var(--muted); }\n\n/* 설정 */\n.settings-dialog { width: 600px; }\n.settings-tabs { display: flex; border-bottom: 1px solid #e6ebf2; margin-bottom: 16px; }\n.settings-tab { padding: 8px 18px; cursor: pointer; border-bottom: 2px solid transparent; color: #64748b; }\n.settings-tab:hover { color: #334155; }\n.settings-tab.active { border-bottom-color: var(--accent2); color: #0f172a; font-weight: 700; }\n.settings-content { min-height: 340px; }\n.settings-pane { display: none; }\n.settings-pane.active { display: block; }\n.settings-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }\n.settings-row.inline { flex-direction: row; align-items: center; gap: 10px; }\n.settings-row label { font-size: 12px; font-weight: 700; color: #64748b; }\n.settings-row input[type=text], .settings-row input[type=password], .settings-row select { background: #f8fafc; border: 1px solid #e6ebf2; color: #0f172a; padding: 7px 8px; border-radius: 4px; font-family: var(--font); font-size: 13px; user-select: text; }\n.settings-note { font-size: 11.5px; color: var(--muted); user-select: text; }\n.settings-note b { color: #334155; }\n.test-result { font-size: 12.5px; user-select: text; }\n.logo-preview-container { display: flex; align-items: center; gap: 14px; }\n.logo-preview { width: 150px; height: 110px; background: #1e293b; border: 1px solid #1e293b; border-radius: 12px; display: flex; align-items: center; justify-content: center; padding: 6px; }\n.logo-preview img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; display: block; }\n.logo-buttons { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }\n.speaker-list-editor { display: flex; flex-direction: column; gap: 6px; }\n.speaker-item { display: flex; gap: 6px; align-items: center; }\n.speaker-item input { flex: 1; }\n.add-speaker { align-self: flex-start; }";
    document.head.appendChild(st);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = { ok: '✓', warn: '!', error: '✗' };
  const ACTION_LABEL = {
    'update-ytdlp': '업데이트',
    'test-youtube': '유튜브 확인',
    'test-ai': '연결 확인',
    'open-settings': '설정 열기',
    'clear-cache': '캐시 정리',
    'install-engine': '엔진 설치',
    'reinstall-engine': '엔진 다시 설치',
    'download-model': '지금 받기',
    'install-ffmpeg': '설치',
    'install-ytdlp': '설치',
    'open:python': '다운로드 페이지',
    'open:ffmpeg': '다운로드 페이지',
    'open:ytdlp': '다운로드 페이지',
    'open:node': 'Node.js 받기',
    'open:gemini': '키 발급 페이지',
  };
  const INSTALL = {
    'install-engine': { confirm: '자막 엔진을 설치할까요?\nPython 3.12가 없으면 함께 설치하고, PyTorch와 음성 인식 라이브러리 약 3GB를 내려받습니다. 10분 이상 걸릴 수 있으며, 끝날 때까지 앱을 닫지 마세요.', busy: '자막 엔진 설치 준비 중...', run: () => api.sysInstallEngine(false) },
    'reinstall-engine': { confirm: '기존 엔진을 지우고 다시 설치할까요?\nPyTorch와 음성 인식 라이브러리 약 3GB를 다시 내려받습니다. 10분 이상 걸릴 수 있습니다.', busy: '자막 엔진 다시 설치 준비 중...', run: () => api.sysInstallEngine(true) },
    'download-model': { confirm: 'Whisper 모델을 지금 받을까요? (GPU: large-v3 약 3GB, CPU: medium 약 1.5GB)', busy: 'Whisper 모델 받기 준비 중...', run: () => api.sysDownloadModel() },
    'install-ffmpeg': { busy: 'ffmpeg 받는 중...', run: () => api.sysInstallFfmpeg() },
    'install-ytdlp': { busy: 'yt-dlp 받는 중...', run: () => api.sysUpdateYtdlp() },
  };
  // [필요한 것 모두 설치] 순서와 크기 안내 (작은 것부터)
  const ALL_ORDER = [['install-ffmpeg', 'ffmpeg (약 100MB)'], ['install-ytdlp', 'yt-dlp (약 20MB)'], ['install-engine', '자막 엔진 (약 3GB, 10분 이상)'], ['reinstall-engine', '자막 엔진 다시 설치 (약 3GB)'], ['download-model', 'Whisper 모델 (1.5~3GB)']];
  let lastRows = [];
  // 설치 진행 상황 (점검 창을 닫았다 열어도 다시 보이게 행 id별로 보관)
  const setupStatus = {};
  let installing = false;
  function showSetupStatus(id) {
    const box = overlay && overlay.querySelector(`.syscheck-item[data-id="${id}"] .result`);
    if (box && setupStatus[id]) { box.className = 'result busy'; box.textContent = setupStatus[id]; }
  }
  if (api.onProgress) api.onProgress((info) => {
    if (!info || info.task !== 'setup' || !info.id) return;
    setupStatus[info.id] = (Number.isFinite(info.pct) ? info.pct + '% · ' : '') + (info.message || '');
    showSetupStatus(info.id);
  });

  function close() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  async function open() {
    close();
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay syscheck-overlay';
    overlay.innerHTML = `
      <div class="modal-dialog syscheck-dialog">
        <div class="modal-header">
          <h3>시스템 점검</h3>
          <button class="modal-close" title="닫기">&times;</button>
        </div>
        <div class="syscheck-sub">이 PC에서 SermonShorts에 필요한 도구를 확인합니다.</div>
        <div class="syscheck-list"><div class="syscheck-loading">점검 중...</div></div>
        <div class="modal-footer">
          <button class="btn" data-act="install-all" disabled>필요한 것 모두 설치</button>
          <button class="btn" data-act="refresh">다시 점검</button>
          <button class="btn primary" data-act="close">닫기</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick = close;
    overlay.querySelector('[data-act="close"]').onclick = close;
    overlay.querySelector('[data-act="refresh"]').onclick = refresh;
    overlay.querySelector('[data-act="install-all"]').onclick = installAll;
    await refresh();
    if (api.sysMarkSeen) api.sysMarkSeen();
  }

  async function refresh() {
    if (!overlay) return;
    const list = overlay.querySelector('.syscheck-list');
    list.innerHTML = '<div class="syscheck-loading">점검 중... (Python 엔진 확인에 몇 초 걸립니다)</div>';
    let res;
    try {
      res = await api.sysCheck();
    } catch (e) {
      list.innerHTML = '<div class="syscheck-loading">점검 실패: ' + esc(e.message) + '</div>';
      return;
    }
    if (!overlay) return;
    lastRows = res.rows;
    const allBtn = overlay.querySelector('[data-act="install-all"]');
    if (allBtn) allBtn.disabled = installing || !pendingInstalls().length;
    list.innerHTML = res.rows.map((r) => `
      <div class="syscheck-item ${r.status}" data-id="${r.id}">
        <div class="syscheck-main">
          <span class="icon">${ICON[r.status] || '?'}</span>
          <span class="name">${esc(r.name)}</span>
          <span class="value">${esc(r.value)}</span>
          <span class="actions">${(r.actions || []).map((a) => `<button class="btn sm" data-action="${a}" data-model="${esc(r.model || '')}">${ACTION_LABEL[a] || a}</button>`).join('')}</span>
        </div>
        ${r.hint ? `<div class="hint">${esc(r.hint)}</div>` : ''}
        <div class="result"></div>
      </div>`).join('');
    list.querySelectorAll('button[data-action]').forEach((b) => {
      b.onclick = () => runAction(b);
      if (installing && INSTALL[b.dataset.action]) b.disabled = true;
    });
    Object.keys(setupStatus).forEach(showSetupStatus);
    return res;
  }

  function setResult(btn, ok, msg) {
    const box = btn.closest('.syscheck-item').querySelector('.result');
    box.className = 'result ' + (ok === null ? 'busy' : ok ? 'ok' : 'error');
    box.textContent = msg;
  }

  async function runAction(btn) {
    const act = btn.dataset.action;
    if (act.startsWith('open:')) {
      let r;
      try { r = await api.sysOpenLink(act.slice(5)); } catch (e) { r = { ok: false, message: e.message }; }
      setResult(btn, !!(r && r.ok), (r && r.message) || '');
      return;
    }
    if (INSTALL[act]) return runInstall(btn, act);
    if (act === 'open-settings') {
      close();
      if (SS.openSettings) SS.openSettings('ai');
      return;
    }
    if (act === 'clear-cache') {
      if (!confirm('유튜브에서 받은 영상과 자막 결과(캐시)를 모두 지울까요?\n지운 영상은 다음에 다시 내려받습니다.')) return;
    }
    btn.disabled = true;
    const busy = { 'update-ytdlp': 'yt-dlp 업데이트 중...', 'test-youtube': '유튜브에서 영상 정보를 받는 중...', 'test-ai': 'Gemini에 연결하는 중...', 'clear-cache': '정리 중...' };
    setResult(btn, null, busy[act] || '...');
    let r;
    try {
      if (act === 'update-ytdlp') r = await api.sysUpdateYtdlp();
      else if (act === 'test-youtube') r = await api.sysTestYoutube();
      else if (act === 'test-ai') r = await api.testAiConnection(btn.dataset.model || undefined);
      else if (act === 'clear-cache') r = await api.sysClearCache();
    } catch (e) {
      r = { ok: false, message: e.message };
    }
    btn.disabled = false;
    if (!overlay) return;
    setResult(btn, !!(r && r.ok), (r && r.message) || '완료');
    if (act === 'update-ytdlp' || act === 'clear-cache') {
      const msg = r && r.message;
      const ok = !!(r && r.ok);
      await refresh();
      const again = overlay && overlay.querySelector(`.syscheck-item[data-id="${act === 'clear-cache' ? 'cache' : 'ytdlp'}"] .result`);
      if (again) { again.className = 'result ' + (ok ? 'ok' : 'error'); again.textContent = msg || ''; }
    }
  }

  /** 지금 점검 결과에서 설치할 수 있는 것들 [{ id, act, label }] */
  function pendingInstalls() {
    const out = [];
    for (const r of lastRows) {
      const hit = ALL_ORDER.find(([a]) => (r.actions || []).includes(a));
      if (hit && r.status !== 'ok') out.push({ id: r.id, act: hit[0], label: hit[1] });
    }
    return out.sort((a, b) => ALL_ORDER.findIndex(([x]) => x === a.act) - ALL_ORDER.findIndex(([x]) => x === b.act));
  }

  async function installAll() {
    if (installing) return;
    let todo = pendingInstalls();
    if (!todo.length) return;
    if (!confirm('다음을 차례로 설치합니다. 끝날 때까지 앱을 닫지 마세요.\n\n' + todo.map((t) => '· ' + t.label).join('\n'))) return;
    const allBtn = overlay && overlay.querySelector('[data-act="install-all"]');
    if (allBtn) allBtn.disabled = true;
    while (todo.length && overlay) {
      const t = todo.shift();
      const btn = overlay.querySelector(`.syscheck-item[data-id="${t.id}"] button[data-action="${t.act}"]`);
      if (!btn) continue;
      const r = await runInstall(btn, t.act, true);
      if (!r || !r.ok) break;
      // 엔진을 깐 뒤에야 모델 받기가 생기므로 점검 결과로 다시 고른다
      todo = pendingInstalls().filter((x) => x.act !== t.act);
    }
  }

  async function runInstall(btn, act, skipConfirm) {
    const job = INSTALL[act];
    if (installing) return;
    if (!skipConfirm && job.confirm && !confirm(job.confirm)) return;
    const id = btn.closest('.syscheck-item').dataset.id;
    installing = true;
    overlay.querySelectorAll('button[data-action]').forEach((b) => { if (INSTALL[b.dataset.action]) b.disabled = true; });
    setupStatus[id] = job.busy;
    showSetupStatus(id);
    let r;
    try { r = await job.run(); } catch (e) { r = { ok: false, message: e.message }; }
    installing = false;
    delete setupStatus[id];
    if (r && r.ok && SS.toast) SS.toast(r.message, 6000);
    if (!overlay) { if (r && !r.ok && SS.toast) SS.toast(r.message, 8000); return r; }
    await refresh();
    const box = overlay && overlay.querySelector(`.syscheck-item[data-id="${id}"] .result`);
    if (box) { box.className = 'result ' + (r && r.ok ? 'ok' : 'error'); box.textContent = (r && r.message) || ''; }
    return r;
  }

  SS.openSysCheck = open;
  SS.refreshSysCheck = refresh;

  const btn = document.getElementById('btnSysCheck');
  if (btn) btn.addEventListener('click', open);

  // 시작할 때: 첫 실행이거나 꼭 필요한 도구가 없으면 자동으로 연다 (테스트/스크린샷 모드는 제외)
  (async () => {
    try {
      const launch = await api.getLaunchInfo();
      if (launch && (launch.screenshot || launch.testScript)) return;
      const [s, quick] = await Promise.all([api.getSettings(), api.sysCheck({ quick: true })]);
      if (quick.critical) open();
      else if (!s.aiProvider && SS.openAiConnect) SS.openAiConnect(); // 처음에는 AI 연결부터 안내 (자막 엔진은 대화 편집에 필요 없음)
    } catch (e) { console.error('sysCheck auto', e); }
  })();

  // 테스트 훅: SS_TEST_SCRIPT=syscheck → 점검 창(연결 확인·유튜브 확인 포함)과 설정 '교회 정보' 탭을 캡처
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { const v = fn(); if (v) return v; await wait(200); }
    return null;
  }
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'syscheck') return;
    try {
      await open();
      for (const a of ['test-ai', 'test-youtube']) {
        const b = overlay.querySelector(`button[data-action="${a}"]`);
        if (b) b.click();
      }
      await waitFor(() => overlay && [...overlay.querySelectorAll('.result')].filter((x) => x.textContent && !x.classList.contains('busy')).length >= 2, 120000);
      const rows = [...overlay.querySelectorAll('.syscheck-item')].map((x) => x.className.replace('syscheck-item ', '') + ' | ' + x.querySelector('.name').textContent + ' | ' + x.querySelector('.value').textContent + ' | ' + (x.querySelector('.result').textContent || ''));
      console.log('[syscheck] ' + JSON.stringify(rows));
      await wait(300);
      await api.testScreenshot('cache/syscheck.png');
      close();
      if (SS.openSettings) {
        await SS.openSettings('church');
        await wait(800);
        await api.testScreenshot('cache/settings_church.png');
        const m = await SS.openSettings('ai');
        const tb = m && m.querySelector('#btnTestAi');
        if (tb) {
          tb.click();
          await waitFor(() => { const r = m.querySelector('#testAiResult'); return r && r.textContent && !r.classList.contains('busy'); }, 60000);
          console.log('[settings-ai] ' + m.querySelector('#testAiResult').textContent);
        }
        await wait(300);
        console.log('[settings-ai] active tab: ' + (document.querySelector('.settings-tab.active') || {}).textContent + ', overlays: ' + document.querySelectorAll('.settings-overlay').length);
        await api.testScreenshot('cache/settings_ai.png');
      }
      api.notifyTestReady({ syscheck: true });
    } catch (err) {
      api.notifyTestError(err && err.stack ? err.stack : String(err));
    }
  });
})();
