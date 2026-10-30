/* 배경음악 관리: 유튜브 주소(여러 줄·재생목록)나 내 파일로 음악을 받아 보관함 폴더에 저장하고,
 * 미리 듣기·이름 바꾸기·분위기 정하기·검색·쓰기·삭제·폴더 열기를 한곳에서 한다.
 * 저장은 main/bgm.js (보관함 폴더: 문서\SermonShorts\배경음악). 바뀌면 'ss:bgm-library-changed' 를 알린다. */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const MOODS = () => ['내 음악'].concat((SS.bgmCatalog && SS.bgmCatalog.MOODS) || []);

  let lib = { dir: '', tracks: [] };
  let queue = [];          // { key, url, title, state: 'wait'|'busy'|'done'|'err', pct, msg }
  let running = false;
  let filter = { q: '', mood: '전체' };
  let wasDialog = false;
  const player = new Audio(); player.preload = 'none';
  let playingId = null;

  function changed() { window.dispatchEvent(new Event('ss:bgm-library-changed')); }
  function toast(m, ms) { if (SS.toast) SS.toast(m, ms || 3500); }

  function build() {
    let m = $('bgmMgr');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'bgmMgr'; m.className = 'modal-overlay bgm-mgr'; m.hidden = true;
    m.innerHTML = `<div class="modal-dialog bgm-mgr-dialog" role="dialog" aria-modal="true" aria-label="배경음악 관리">
      <div class="bm-head"><div><h3>배경음악 관리</h3><p>유튜브 주소나 내 파일로 음악을 받아 보관함에 모아 둡니다. 쇼츠의 배경음악으로 바로 쓸 수 있습니다.</p>
        <div class="bm-dir"><span class="ico xs i-folder"></span><span id="bmDir"></span><button class="bm-link" id="bmOpenDir" type="button">폴더 열기</button></div></div>
        <button class="btn ghost icon-only ico i-x" data-close title="닫기 (Esc)" aria-label="닫기"></button></div>
      <div class="bm-add">
        <textarea id="bmUrls" rows="3" spellcheck="false" placeholder="유튜브 주소를 한 줄에 하나씩 붙여 넣으세요. 재생목록 주소도 됩니다(최대 50곡).&#10;예: https://youtu.be/xxxxxxxxxxx"></textarea>
        <div class="bm-add-act"><button class="btn primary ico i-download" id="bmGet" type="button">받아서 저장</button><button class="btn ico i-upload" id="bmFile" type="button">내 파일 추가</button></div>
      </div>
      <div class="bm-note">유튜브 음악은 대부분 저작권이 있습니다. 저작권이 공개된 곡(퍼블릭 도메인·CC)이나 사용 허락을 받은 곡만 쇼츠에 쓰세요.</div>
      <div class="bm-queue" id="bmQueue" hidden></div>
      <div class="bm-tools"><input id="bmSearch" type="search" placeholder="제목·채널 검색" spellcheck="false"><select id="bmMood"></select><span class="bm-count" id="bmCount"></span></div>
      <div class="bm-list" id="bmList"></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) close(); });
    m.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (e.target.classList && e.target.classList.contains('bm-title-in')) return; e.preventDefault(); close(); }
      e.stopPropagation();
    });
    $('bmGet').addEventListener('click', addUrls);
    $('bmUrls').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addUrls(); } });
    $('bmFile').addEventListener('click', addFile);
    $('bmOpenDir').addEventListener('click', () => api.bgmLibReveal(''));
    $('bmSearch').addEventListener('input', () => { filter.q = $('bmSearch').value.trim(); renderList(); });
    $('bmMood').addEventListener('change', () => { filter.mood = $('bmMood').value; renderList(); });
    player.addEventListener('ended', () => { playingId = null; renderList(); });
    player.addEventListener('pause', () => renderPlayButtons());
    player.addEventListener('play', () => renderPlayButtons());
    return m;
  }

  async function refresh() {
    try { lib = await api.bgmLibrary(); } catch (e) { lib = { dir: '', tracks: [] }; toast('보관함을 읽지 못했습니다: ' + cleanErr(e), 6000); }
    $('bmDir').textContent = lib.dir || '';
    $('bmMood').innerHTML = ['전체'].concat(MOODS()).map((x) => `<option${x === filter.mood ? ' selected' : ''}>${esc(x)}</option>`).join('');
    renderList();
  }

  function shown() {
    const q = filter.q.toLowerCase();
    return lib.tracks.filter((t) => (filter.mood === '전체' || t.mood === filter.mood)
      && (!q || (t.title + ' ' + t.artist).toLowerCase().includes(q)));
  }
  function renderList() {
    const list = shown(), sel = SS.state && SS.state.bgm && SS.state.bgm.id;
    $('bmCount').textContent = lib.tracks.length ? `${list.length} / ${lib.tracks.length}곡` : '';
    if (!lib.tracks.length) { $('bmList').innerHTML = '<div class="bm-empty"><b>보관함이 비어 있습니다</b>위에 유튜브 주소를 넣거나 내 파일을 추가하세요.</div>'; return; }
    if (!list.length) { $('bmList').innerHTML = '<div class="bm-empty">찾는 곡이 없습니다.</div>'; return; }
    const moods = MOODS();
    $('bmList').innerHTML = list.map((t) => `<div class="bm-row${t.id === sel ? ' sel' : ''}${t.missing ? ' missing' : ''}" data-id="${esc(t.id)}">
      <button class="btn icon-only bm-play ico i-play" data-play title="미리 듣기" aria-label="${esc(t.title)} 듣기"${t.missing ? ' disabled' : ''}></button>
      <div class="bm-info"><div class="bm-title" data-rename title="눌러서 이름 바꾸기">${esc(t.title)}</div>
        <div class="bm-meta">${t.artist && t.artist !== '유튜브' && t.artist !== '내 파일' ? esc(t.artist) + ' · ' : ''}${t.kind === 'youtube' ? `<a href="#" data-src="${esc(t.source)}">유튜브</a>` : '내 파일'} · ${new Date(t.addedAt || 0).toLocaleDateString('ko-KR')}${t.missing ? ' · <b class="bm-miss">파일 없음</b>' : ''}</div></div>
      <span class="bm-dur">${fmt(t.durationSec)}</span>
      <select class="bm-mood" data-mood title="분위기">${moods.map((x) => `<option${x === t.mood ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <button class="btn sm ${t.id === sel ? '' : 'primary'}" data-use${t.missing ? ' disabled' : ''}>${t.id === sel ? '쓰는 중' : '쓰기'}</button>
      <button class="btn sm ghost icon-only ico i-folder-open" data-reveal title="폴더에서 보기" aria-label="폴더에서 보기"></button>
      <button class="btn sm ghost icon-only ico i-trash-2" data-del title="보관함에서 지우기" aria-label="지우기"></button>
    </div>`).join('');
    $('bmList').querySelectorAll('.bm-row').forEach((row) => {
      const id = row.dataset.id, t = lib.tracks.find((x) => x.id === id);
      row.querySelector('[data-play]').addEventListener('click', () => play(t));
      row.querySelector('[data-rename]').addEventListener('click', () => rename(row, t));
      row.querySelector('[data-mood]').addEventListener('change', async (e) => { try { await api.bgmLibUpdate(id, { mood: e.target.value }); await refresh(); changed(); } catch (err) { toast('바꾸지 못했습니다: ' + cleanErr(err)); } });
      row.querySelector('[data-use]').addEventListener('click', () => use(t));
      row.querySelector('[data-reveal]').addEventListener('click', () => api.bgmLibReveal(id));
      row.querySelector('[data-del]').addEventListener('click', () => remove(t));
      const a = row.querySelector('[data-src]'); if (a) a.addEventListener('click', (e) => { e.preventDefault(); if (api.ytupOpenUrl) api.ytupOpenUrl(a.dataset.src); });
    });
    renderPlayButtons();
  }
  function renderPlayButtons() {
    document.querySelectorAll('#bmList .bm-row').forEach((row) => {
      const on = playingId === row.dataset.id && !player.paused, b = row.querySelector('[data-play]');
      b.classList.toggle('i-play', !on); b.classList.toggle('i-pause', on); b.classList.toggle('playing', on);
    });
  }
  function play(t) {
    if (playingId === t.id && !player.paused) { player.pause(); return; }
    if (playingId !== t.id) { player.src = 'ssbgm://track/' + encodeURIComponent(t.id); playingId = t.id; }
    player.volume = 0.8;
    player.play().catch((e) => toast('재생하지 못했습니다: ' + e.message));
  }
  function rename(row, t) {
    const box = row.querySelector('[data-rename]');
    if (box.querySelector('input')) return;
    box.innerHTML = `<input class="bm-title-in" value="${esc(t.title)}" maxlength="120">`;
    const inp = box.querySelector('input'); inp.focus(); inp.select();
    let done = false;
    const finish = async (save) => {
      if (done) return; done = true;
      const v = inp.value.trim();
      if (save && v && v !== t.title) { try { await api.bgmLibUpdate(t.id, { title: v }); changed(); } catch (e) { toast('이름을 바꾸지 못했습니다: ' + cleanErr(e)); } }
      await refresh();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
    inp.addEventListener('blur', () => finish(true));
  }
  function use(t) {
    if (SS.bgmImport && SS.bgmImport.custom) SS.bgmImport.custom.set(t.id, t);
    if (SS.useBgm) SS.useBgm(t.id);
    close();
    if (SS.showBgmTab) SS.showBgmTab();
  }
  async function remove(t) {
    if (SS.state && SS.state.bgm && SS.state.bgm.id === t.id) { toast('지금 쓰는 음악은 지울 수 없습니다. 다른 음악으로 바꾼 뒤 지워 주세요.', 5000); return; }
    if (!confirm(`"${t.title}"을(를) 보관함에서 지울까요? 보관함 폴더의 음악 파일도 함께 지워집니다.`)) return;
    if (playingId === t.id) { player.pause(); playingId = null; }
    await api.bgmCustomRemove(t.id); await refresh(); changed();
  }

  // ---------------- 받기 (줄마다 한 곡, 재생목록은 펼쳐서 차례로) ----------------
  async function addUrls() {
    const lines = ($('bmUrls').value || '').split(/[\r\n\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) { toast('유튜브 주소를 넣어 주세요.'); $('bmUrls').focus(); return; }
    const bad = lines.filter((u) => !/^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be)\//i.test(u));
    if (bad.length) { toast('유튜브 주소가 아닌 줄이 있습니다: ' + bad[0], 6000); return; }
    $('bmUrls').value = '';
    const isList = (u) => /[?&]list=/.test(u) && !/[?&]v=|youtu\.be\/|shorts\//.test(u);
    // 낱곡은 바로 받기 시작하고, 재생목록은 펼치는 대로 뒤에 붙인다
    lines.filter((u) => !isList(u)).forEach((url) => queue.push({ key: 'k' + Date.now() + Math.random(), url, title: url, state: 'wait', pct: 0 }));
    renderQueue(); run();
    for (const url of lines.filter(isList)) {
      {
        const item = { key: 'k' + Date.now() + Math.random(), url, title: '재생목록 펼치는 중…', state: 'busy', pct: 0 };
        queue.push(item); renderQueue();
        try {
          const items = await api.bgmExpandUrl(url);
          queue.splice(queue.indexOf(item), 1);
          items.forEach((x) => queue.push({ key: 'k' + Date.now() + Math.random(), url: x.url, title: x.title || x.url, state: 'wait', pct: 0 }));
          if (!items.length) toast('재생목록에 곡이 없습니다.');
        } catch (e) { item.state = 'err'; item.msg = cleanErr(e); }
      }
      renderQueue(); run();
    }
  }
  async function run() {
    if (running) return; running = true;
    try {
      for (;;) {
        const item = queue.find((x) => x.state === 'wait'); if (!item) break;
        item.state = 'busy'; item.pct = 0; renderQueue();
        try {
          const t = await api.bgmImportYoutube(item.url, item.key);
          item.state = 'done'; item.title = t.title; item.pct = 100; item.existed = !!t.existed;
          await refresh(); changed();
        } catch (e) { item.state = 'err'; item.msg = cleanErr(e); }
        renderQueue();
      }
    } finally { running = false; }
  }
  function renderQueue() {
    const q = $('bmQueue'); if (!q) return;
    q.hidden = !queue.length;
    const left = queue.filter((x) => x.state === 'wait' || x.state === 'busy').length;
    q.innerHTML = `<div class="bm-q-head"><b>받기 목록</b><span>${left ? left + '곡 남음' : '모두 끝남'}</span>${left ? '' : '<button class="bm-link" id="bmQClear" type="button">목록 지우기</button>'}</div>`
      + queue.map((x) => `<div class="bm-q ${x.state}"><span class="bm-q-st">${{ wait: '대기', busy: x.pct ? Math.round(x.pct) + '%' : '받는 중', done: x.existed ? '이미 있음' : '완료', err: '실패' }[x.state]}</span><span class="bm-q-t">${esc(x.title)}</span>${x.state === 'busy' ? `<span class="bm-q-bar"><i style="width:${Math.max(4, Math.round(x.pct || 0))}%"></i></span>` : ''}${x.state === 'err' ? `<span class="bm-q-err">${esc(x.msg || '')}</span>` : ''}</div>`).join('');
    const c = $('bmQClear'); if (c) c.addEventListener('click', () => { queue = []; renderQueue(); });
  }
  if (api && api.onBgmProgress) api.onBgmProgress((p) => {
    if (p.id !== 'import' || !p.key) return;
    const item = queue.find((x) => x.key === p.key); if (!item || item.state !== 'busy') return;
    item.pct = p.got; const row = document.querySelector('#bmQueue .bm-q.busy'); if (row) renderQueue();
  });

  async function addFile() {
    try {
      const t = await api.bgmImportFile();
      if (!t) return;
      toast(`"${t.title}"을(를) 보관함에 넣었습니다.`);
      await refresh(); changed();
    } catch (e) { toast('넣지 못했습니다: ' + cleanErr(e), 6000); }
  }

  function open() {
    const m = build();
    // 고르기 창에서 넘어오면 그 창을 먼저 닫고 나서 원래 상태를 기억한다 (닫은 뒤 편집 단축키가 막히지 않게)
    if (SS.bgmUi && SS.bgmUi.closeLib) { const l = $('bgmLib'); if (l && !l.hidden) SS.bgmUi.closeLib(); }
    if (m.hidden) wasDialog = !!(SS.state && SS.state.dialogOpen);
    if (SS.state) SS.state.dialogOpen = true;
    m.hidden = false;
    refresh(); renderQueue();
    setTimeout(() => $('bmUrls').focus(), 0);
  }
  function close() {
    const m = $('bgmMgr'); if (!m || m.hidden) return;
    player.pause(); playingId = null;
    m.hidden = true;
    if (SS.state) SS.state.dialogOpen = wasDialog;
  }
  // 포커스가 창 밖(본문)에 있어도 Esc 로 닫히게
  window.addEventListener('keydown', (e) => {
    const m = $('bgmMgr');
    if (e.key !== 'Escape' || e.defaultPrevented || !m || m.hidden) return;
    if (e.target && e.target.classList && e.target.classList.contains('bm-title-in')) return; // 이름 바꾸기 취소가 먼저
    e.preventDefault(); e.stopPropagation(); close();
  }, true);
  document.addEventListener('DOMContentLoaded', wire);
  if (document.readyState !== 'loading') wire();
  function wire() { const b = $('btnBgmMgr'); if (b && !b.dataset.wired) { b.dataset.wired = '1'; b.addEventListener('click', open); } }
  SS.openBgmManager = open;
  SS.closeBgmManager = close;
  SS.bgmManager = { open, close, refresh, get lib() { return lib; }, get queue() { return queue; }, addUrls, player };
})();
