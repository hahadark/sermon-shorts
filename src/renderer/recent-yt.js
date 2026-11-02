/* 최근 작업한 유튜브 링크 (설정 recentYoutube, 보존 개수는 설정 [일반]의 recentYoutubeMax, 기본 5개)
 *   SS.recentYt.add(url, title)        불러오기에 성공하면 넣는다 (같은 주소는 맨 앞으로)
 *   SS.recentYt.mount(host, onPick)    주소 칸 아래에 최근 링크 목록을 붙인다 (누르면 onPick(url))
 *   SS.recentYt.datalist(input)        주소 칸에 자동 완성 목록 */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let cache = null;

  function when(t) {
    if (!t) return '';
    const d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return '오늘';
    if (new Date(now - 864e5).toDateString() === d.toDateString()) return '어제';
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  async function list() {
    try { cache = await api.recentList(); } catch (_) { cache = cache || []; }
    return cache || [];
  }
  async function add(url, title) {
    url = String(url || '').trim();
    if (!url || !api.recentAdd) return;
    try { cache = await api.recentAdd({ url, title: title || '' }); } catch (e) { console.warn('[recent] 저장 실패', e); }
    window.dispatchEvent(new CustomEvent('ss:recent-youtube', { detail: cache }));
  }

  function injectStyles() {
    if (document.getElementById('ss-recent-styles')) return;
    const st = document.createElement('style');
    st.id = 'ss-recent-styles';
    st.textContent = `
.recent-yt{display:flex;flex-direction:column;gap:4px;margin-top:2px}
.recent-yt .ry-head{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}
.recent-yt .ry-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:1px solid var(--line,#e5e7eb);background:var(--panel,#fff);border-radius:8px;padding:6px 10px;cursor:pointer;font:inherit;color:inherit}
.recent-yt .ry-item:hover{border-color:var(--accent,#2563eb);background:var(--accent-weak,rgba(37,99,235,.06))}
.recent-yt .ry-title{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.recent-yt .ry-when{font-size:11px;color:var(--muted);flex:none}`;
    document.head.appendChild(st);
  }

  /** host 안에 최근 링크 목록 (없으면 아무것도 안 붙임) */
  async function mount(host, onPick, opt) {
    opt = opt || {};
    injectStyles();
    const items = await list();
    host.querySelectorAll('.recent-yt').forEach((x) => x.remove());
    if (!items.length) return null;
    const box = document.createElement('div');
    box.className = 'recent-yt';
    box.innerHTML = `<div class="ry-head"><span class="ico xs i-history"></span>최근 작업한 영상</div>` +
      items.slice(0, opt.max || items.length).map((r, i) => `<button type="button" class="ry-item" data-i="${i}" title="${esc(r.url)}"><span class="ry-title">${esc(r.title || r.url)}</span><span class="ry-when">${esc(when(r.at))}</span></button>`).join('');
    box.querySelectorAll('.ry-item').forEach((b) => b.addEventListener('click', () => onPick(items[+b.dataset.i].url, items[+b.dataset.i])));
    host.appendChild(box);
    return box;
  }

  /** 주소 칸 자동 완성 (최근 링크) */
  async function datalist(input) {
    const items = await list();
    if (!items.length || !input) return;
    const id = input.id + '-recent';
    let dl = document.getElementById(id);
    if (!dl) { dl = document.createElement('datalist'); dl.id = id; document.body.appendChild(dl); }
    dl.innerHTML = items.map((r) => `<option value="${esc(r.url)}" label="${esc(r.title || '')}"></option>`).join('');
    input.setAttribute('list', id);
  }

  SS.recentYt = { list, add, mount, datalist };
})();
