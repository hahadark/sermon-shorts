/*
 * layout.js - 메뉴(상단 파일·편집·자막·AI·도움말, 테마 편집기 더보기), 빠른 실행, data-cmd 명령, 재생 단추 아이콘.
 * 원래 단추(id)는 그대로 두고 메뉴 안으로만 옮겼다. 각 단추의 동작은 원래 모듈이 붙인 것을 쓴다.
 * 메뉴는 문서 전체에 위임해서 처리하므로 나중에 만든 화면(테마 편집기)의 .menu 도 똑같이 동작한다.
 */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const $ = (id) => document.getElementById(id);
  const click = (id) => { const b = $(id); if (b && !b.disabled) b.click(); };
  const hasWords = () => !!(SS.state && SS.state.words && SS.state.words.length);
  function toast(msg) { if (SS.toast) SS.toast(msg, 4000); }

  // ---------------- data-cmd 명령 ----------------
  const CMDS = {
    save: () => SS.saveProject && SS.saveProject(),
    'save-as': () => SS.saveProjectAs && SS.saveProjectAs(),
    export: () => click('btnExport'),
    undo: () => SS.undo && SS.undo(),
    redo: () => SS.redo && SS.redo(),
    'toggle-hide': () => click('btnToggleHide'),
    'auto-clean': () => click('btnAutoClean'),
    'ai-correct': () => { const b = $('btnAiCorrect'); if (!b || b.disabled) { toast('먼저 자막이 있는 영상을 열어 주세요'); return; } b.click(); },
    gaps: async () => {
      if (!SS.removeGaps) return;
      try {
        const g = await SS.removeGaps();
        toast(g.cuts ? `말 사이 공백 ${g.cuts}곳을 줄였습니다 (${(g.before - g.after).toFixed(1)}초 짧아짐, Ctrl+Z 되돌리기)` : '더 줄일 말 사이 공백이 없습니다');
      } catch (e) { toast('공백 없애기: ' + (e && e.message ? e.message : e)); }
    },
    'caption-settings': () => SS.toggleCaptionSettings && SS.toggleCaptionSettings(true),
    'toggle-chat': () => SS.toggleChat && SS.toggleChat(),
    'focus-chat': () => SS.focusChat && SS.focusChat(),
    'open-video': () => click('btnOpen'),
    'open-project': () => click('btnOpenProject'),
    shortcuts: () => SS.showShortcuts && SS.showShortcuts(),
    settings: () => click('btnSettings'),
    materials: () => SS.openMaterials && SS.openMaterials(),
  };
  SS.runCommand = (name) => { const f = CMDS[name]; if (f) f(); };

  // ---------------- 왼쪽 막대 ----------------
  const RAIL = {
    editor: () => { if (SS.closeMaterials) SS.closeMaterials(); if (SS.showDesignTab) SS.showDesignTab(); },
    music: () => { if (SS.closeMaterials) SS.closeMaterials(); if (SS.showBgmTab) SS.showBgmTab(); },
    theme: () => click('btnEditTheme'),
    ai: () => click('btnAiConnect'),
    guide: () => click('btnUserGuide'),
  };
  document.querySelectorAll('#rail [data-rail]').forEach((b) => b.addEventListener('click', () => { const f = RAIL[b.dataset.rail]; if (f) f(); }));
  // 지금 보이는 작업 공간을 왼쪽 막대에 표시: 교인 자료 > 배경음악 탭 > 쇼츠 편집
  SS.syncRail = () => {
    const studio = document.getElementById('mnStudio');
    const tab = document.getElementById('tabMusic');
    const cur = studio && !studio.hidden ? document.getElementById('btnMaterials')
      : document.querySelector(tab && tab.classList.contains('on') ? '#rail [data-rail="music"]' : '#rail [data-rail="editor"]');
    document.querySelectorAll('#rail .rail-item').forEach((b) => {
      const on = b === cur;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  };

  // ---------------- 메뉴 ----------------
  const allMenus = () => Array.from(document.querySelectorAll('.menu'));
  const itemsOf = (menu) => Array.from(menu.querySelectorAll('.menu-item')).filter((b) => !b.disabled && b.offsetParent !== null);
  function closeAll(except) {
    allMenus().forEach((m) => {
      if (m === except) return;
      m.classList.remove('open');
      const b = m.querySelector('.menu-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  }
  /** 메뉴를 열기 직전에 실제 단추 상태에 맞춰 대리 명령을 켜고 끈다 */
  function syncStates() {
    const exp = document.querySelector('.menu-item[data-cmd="export"]');
    if (exp && $('btnExport')) exp.disabled = $('btnExport').disabled;
    document.querySelectorAll('.menu-item[data-cmd="gaps"], .menu-item[data-cmd="auto-clean"], .menu-item[data-cmd="toggle-hide"]').forEach((b) => { b.disabled = !hasWords(); });
    const ai = document.querySelector('.menu-item[data-cmd="ai-correct"]');
    if (ai && $('btnAiCorrect')) ai.disabled = $('btnAiCorrect').disabled;
  }
  function openMenu(menu, focusFirst) {
    closeAll(menu);
    syncStates();
    menu.classList.add('open');
    const b = menu.querySelector('.menu-btn');
    if (b) b.setAttribute('aria-expanded', 'true');
    if (focusFirst) { const first = itemsOf(menu)[0]; if (first) first.focus(); }
  }
  SS.closeMenus = () => closeAll();

  document.addEventListener('click', (e) => {
    const t = e.target;
    const mbtn = t.closest && t.closest('.menu-btn');
    if (mbtn) {
      const m = mbtn.closest('.menu');
      if (m.classList.contains('open')) closeAll(); else openMenu(m, e.detail === 0);
      return;
    }
    const cmd = t.closest && t.closest('[data-cmd]');
    const inPop = t.closest && t.closest('.menu-pop');
    const item = t.closest && t.closest('.menu-item');
    if (!inPop || (item && !item.disabled)) closeAll();
    if (cmd && !cmd.disabled && CMDS[cmd.dataset.cmd]) { e.preventDefault(); CMDS[cmd.dataset.cmd](); }
  });
  // 상단 메뉴 하나가 열려 있으면 마우스만 옮겨도 옆 메뉴가 열린다 (일반 프로그램 메뉴처럼)
  document.addEventListener('mouseover', (e) => {
    const mbtn = e.target.closest && e.target.closest('.menubar .menu-btn');
    if (!mbtn) return;
    const m = mbtn.closest('.menu');
    if (!m.classList.contains('open') && document.querySelector('.menubar .menu.open')) openMenu(m, false);
  });
  document.addEventListener('keydown', (e) => {
    const m = e.target.closest && e.target.closest('.menu');
    if (!m) {
      if (e.key === 'Escape' && document.querySelector('.menu.open')) { closeAll(); e.stopPropagation(); e.preventDefault(); }
      return;
    }
    const list = itemsOf(m), i = list.indexOf(document.activeElement);
    const bar = m.closest('.menubar'), btn = m.querySelector('.menu-btn');
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!m.classList.contains('open')) openMenu(m, true); else (list[(i + 1) % list.length] || list[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!m.classList.contains('open')) openMenu(m, true); const l2 = itemsOf(m); (l2[(i - 1 + l2.length) % l2.length] || l2[l2.length - 1]).focus(); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && bar) {
      e.preventDefault();
      const ms = Array.from(bar.querySelectorAll('.menu')), k = ms.indexOf(m);
      const next = ms[(k + (e.key === 'ArrowRight' ? 1 : -1) + ms.length) % ms.length];
      openMenu(next, true);
      if (!itemsOf(next).length) next.querySelector('.menu-btn').focus();
    } else if (e.key === 'Escape') { e.preventDefault(); closeAll(); if (btn) btn.focus(); }
    else if (e.key === 'Tab') closeAll();
    else if (e.key !== 'Enter' && e.key !== ' ') return; // 다른 키는 그대로 (단축키 등)
    e.stopPropagation(); // 편집기 단축키가 화살표·Enter 를 가로채지 않게
  }, true);
  window.addEventListener('blur', () => closeAll());

  // ---------------- 재생 단추 아이콘 (재생 ↔ 일시정지) ----------------
  function initPlayIcon() {
    const v = $('video'), b = $('btnPlay');
    if (!v || !b) return;
    v.addEventListener('play', () => b.classList.replace('i-play', 'i-pause'));
    v.addEventListener('pause', () => b.classList.replace('i-pause', 'i-play'));
  }

  // 자막이 생기면 'AI 용어 교정'을 켠다 (예전에는 유튜브에서 받은 영상일 때만 켜졌다)
  function syncAiCorrect() { const b = $('btnAiCorrect'); if (b && hasWords()) b.disabled = false; }

  function init() {
    initPlayIcon();
    const ai = $('btnAiConnect');
    if (ai) ai.addEventListener('click', () => { if (SS.openAiConnect) SS.openAiConnect(); });
    for (const ev of ['ss:transcript-ready', 'ss:video-opened', 'ss:source-loaded', 'ss:words-changed']) window.addEventListener(ev, () => setTimeout(syncAiCorrect, 0));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
