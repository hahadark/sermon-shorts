/*
 * 테스트 훅: SS_TEST_SCRIPT=qa-ui
 * 화면 배치(넘침·겹침·잘린 글자)·왼쪽 막대·다이얼로그 열기/닫기·미리보기 편집(테마별 테두리 위치)·콘솔 오류를 실제 Electron 화면에서 측정한다.
 * 결과: cache/qa_ui/report.json (+ 화면 png). 외부 AI·STT 호출 없음. 실패해도 끝까지 돌며 problems 에 모은다.
 */
(function () {
  'use strict';
  const SS = window.SS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push('error: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
  const origErr = console.error;
  console.error = function () { errors.push('console.error: ' + Array.from(arguments).map(String).join(' ').slice(0, 200)); return origErr.apply(console, arguments); };

  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) + '"';

  function measure() {
    const out = [];
    const all = Array.from(document.body.querySelectorAll('*')).filter((e) => !e.closest('svg') && !e.closest('#peOverlay') && !e.closest('video') && !e.classList.contains('sr-only') && vis(e));
    for (const el of all) {
      const cs = getComputedStyle(el);
      // 잘린 글자: 말줄임 없이 가로로 잘리는 글자 요소
      if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && /inline-block|block|flex|inline-flex|grid/.test(cs.display) && cs.overflowX === 'hidden' && cs.textOverflow !== 'ellipsis') out.push({ t: 'clipped-text', el: desc(el), sw: el.scrollWidth, cw: el.clientWidth });
      if (el.matches('button,.btn,.rail-item,select,input')) {
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth + 1) out.push({ t: 'offscreen-x', el: desc(el), right: Math.round(r.right), vw: window.innerWidth });
      }
      // 부모(overflow 숨김)에 가로로 잘리는 단추·입력칸
      if (el.matches('button,.btn,input,select')) {
        const r = el.getBoundingClientRect();
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const pc = getComputedStyle(p);
          if (/hidden|clip/.test(pc.overflowX)) { const pr = p.getBoundingClientRect(); if (r.right > pr.right + 1.5 && pr.width > 0 && !p.closest('#peOverlay')) out.push({ t: 'child-clipped', el: desc(el), parent: desc(p), over: Math.round(r.right - pr.right) }); break; }
          if (/auto|scroll/.test(pc.overflowX)) break;
        }
      }      // 세로로 잘려 스크롤도 안 되는 영역
      if (el.scrollHeight > el.clientHeight + 3 && el.clientHeight > 40 && cs.overflowY === 'hidden' && el.children.length > 0 && !/^(CANVAS|BODY|HTML)$/.test(el.tagName)) out.push({ t: 'hidden-vclip', el: desc(el), sh: el.scrollHeight, ch: el.clientHeight });
    }
    const btns = all.filter((e) => e.matches('button,.btn,select,input:not([type=hidden]):not([type=range]):not([type=checkbox]):not([type=radio])'));
    const byParent = new Map();
    for (const b of btns) { const p = b.parentElement; if (!byParent.has(p)) byParent.set(p, []); byParent.get(p).push(b); }
    for (const [, list] of byParent) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i].getBoundingClientRect(), b = list[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2 && getComputedStyle(list[i]).position !== 'absolute' && getComputedStyle(list[j]).position !== 'absolute') out.push({ t: 'overlap', a: desc(list[i]), b: desc(list[j]), ox: Math.round(ox), oy: Math.round(oy) });
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push({ t: 'page-hscroll', sw: document.documentElement.scrollWidth, vw: window.innerWidth });
    if (document.documentElement.scrollHeight > window.innerHeight + 1) out.push({ t: 'page-vscroll', sh: document.documentElement.scrollHeight, vh: window.innerHeight });
    return out;
  }

  window.addEventListener('ss:run-test-script', async (ev) => {
    if (ev.detail !== 'qa-ui') return;
    const report = { startedAt: new Date().toISOString(), problems: [], notes: [], sizes: {} };
    const prob = (name, extra) => report.problems.push({ name, extra });
    let dir = null;
    try {
      const launch = await window.api.getLaunchInfo();
      dir = (launch.cache || launch.root + '/cache') + '/qa_ui';
      await window.api.mkdir(dir);
      const t0 = Date.now();
      while (!(SS.state && SS.state.source && SS.preview && SS.preview.loaded)) { if (Date.now() - t0 > 60000) throw new Error('영상이 열리지 않았습니다'); await sleep(200); }
      SS.preview.pause();
      const shot = async (n) => { try { await SS.testShot(dir + '/' + n + '.png'); } catch (e) { report.notes.push('shot ' + n + ' ' + e.message); } };
      const settle = async () => { await sleep(150); try { await SS.updateTemplatePreview(); } catch (e) { /* */ } await sleep(250); };
      const esc = () => { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); };
      const $ = (id) => document.getElementById(id);

      // ---- 1) 창 크기별 측정 ----
      report.initial = { w: window.innerWidth, h: window.innerHeight };
      for (const [w, h] of [[1280, 720], [1366, 768], [1600, 900], [1920, 1080]]) {
        try { window.resizeTo(w + (window.outerWidth - window.innerWidth), h + (window.outerHeight - window.innerHeight)); } catch (e) { /* */ }
        await sleep(600);
        report.sizes[w + 'x' + h] = { inner: [window.innerWidth, window.innerHeight], issues: measure() };
        await shot('size_' + w + 'x' + h);
      }

      // ---- 2) 왼쪽 막대 ----
      report.rail = {};
      for (const b of document.querySelectorAll('#rail .rail-item')) {
        b.click(); await sleep(500);
        const k = b.dataset.rail || b.id;
        report.rail[k] = measure();
        await shot('rail_' + k);
        esc(); await sleep(200);
        const rb = document.querySelector('#rail [data-rail="editor"]'); if (rb) { rb.click(); await sleep(250); }
      }

      // ---- 3) 다이얼로그 ----
      const layers = () => Array.from(document.body.children).filter((e) => vis(e) && ['fixed', 'absolute'].includes(getComputedStyle(e).position) && !/^(SCRIPT|STYLE)$/.test(e.tagName) && e.id !== 'peOverlay');
      const base = new Set(layers());
      const dlgs = [
        ['설정', () => $('btnSettings').click()],
        ['AI 연결', () => $('btnAiConnect').click()],
        ['시스템 점검', () => $('btnSysCheck').click()],
        ['유튜브', () => $('btnYoutube').click()],
        ['F1 도움말', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true }))],
        ['교회 더보기', () => $('btnChurchMore').click()],
        ['교인 자료', () => $('btnMaterials').click()]
      ];
      report.dialogs = {};
      for (const [name, open] of dlgs) {
        try {
          open(); await sleep(800);
          const added = layers().filter((e) => !base.has(e));
          const info = { opened: added.length > 0, layers: added.map(desc), issues: measure() };
          await shot('dlg_' + name.replace(/\s/g, '_'));
          esc(); await sleep(400);
          let still = layers().filter((e) => !base.has(e));
          info.closedByEsc = still.length === 0;
          if (!info.opened) prob('다이얼로그 안 열림: ' + name);
          if (!info.closedByEsc) { prob('Esc 로 안 닫힘: ' + name, still.map(desc)); still.forEach((e) => { const x = e.querySelector('[aria-label*="닫기"],.close,button'); if (x) x.click(); }); await sleep(300); }
          report.dialogs[name] = info;
        } catch (e) { prob('다이얼로그 오류 ' + name, e.message); }
      }

      // ---- 4) 미리보기 편집: 테마별 테두리 위치 ----
      const PE = SS.previewEdit;
      const st = SS.state;
      st.words = [[0, .7], [.9, 1.6], [1.7, 2.2]].map(([a, b], id) => ({ id, text: ['하나님의', '은혜가', '충분합니다.'][id], sttText: ['하나님의', '은혜가', '충분합니다.'][id], start: .3 + a, end: .3 + b, del: false, br: false }));
      st.settings = { padBefore: 0, padAfter: 0, fadeMs: 10, maxLineChars: 14, splitLongWords: true };
      st.overrides = {}; st.caret = 0; st.selection = null; st.crop = { scale: 1, x: .5, y: .5 };
      st.meta = { title: '합성 시험 제목', verse: '마태복음 6:13', speaker: '홍길동 목사' };
      $('inpTitle').value = st.meta.title; $('inpVerse').value = st.meta.verse;
      SS.syncCaptionUI(); SS.resetEditorHistory();
      await SS.preview.seek(.5);
      const themes = await window.api.listThemes();
      report.themes = {};
      for (const th of themes) {
        const r = { problems: [] };
        try {
          st.activeTheme = JSON.parse(JSON.stringify(th));
          SS.resetEditorHistory(); SS.pushUndo();
          PE.setActive(true); await settle();
          const hits = PE.hits();
          r.hitKeys = hits.map((h) => h.key);
          const ov = $('peOverlay'); let orect = ov.getBoundingClientRect();
          const box = ov.querySelector('.pe-box');
          for (const h0 of hits) {
            PE.select(h0.key); await sleep(250);
            const h = PE.hits().find((x) => x.key === h0.key) || h0;
            if (!box || box.style.display === 'none') { r.problems.push('선택 테두리 없음 ' + h.key); continue; }
            const bs = [parseFloat(box.style.left), parseFloat(box.style.top), parseFloat(box.style.width), parseFloat(box.style.height)];
            const hs = [h.x0, h.y0, h.x1 - h.x0, h.y1 - h.y0];
            if (bs.some((v, i) => Math.abs(v - hs[i]) > 1)) r.problems.push('테두리≠hit ' + h.key + ' ' + JSON.stringify([bs, hs]));
            orect = ov.getBoundingClientRect(); const br = box.getBoundingClientRect(); const sx = orect.width / 1080, sy = orect.height / 1920;
            const d = [br.left - (orect.left + h.x0 * sx), br.top - (orect.top + h.y0 * sy), br.width - (h.x1 - h.x0) * sx, br.height - (h.y1 - h.y0) * sy];
            if (d.some((v) => Math.abs(v) > 3)) r.problems.push('테두리 화면위치 불일치 ' + h.key + ' ' + JSON.stringify(d.map((v) => Math.round(v))) + ' orect=' + JSON.stringify([orect.width, orect.height, orect.left, orect.top]) + ' br=' + JSON.stringify([br.left, br.top, br.width, br.height].map(Math.round)) + ' tf=' + getComputedStyle(ov).transform + ' pt=' + getComputedStyle(ov.parentElement).transform + ' bw=' + box.style.borderWidth);
          }
          // 화살표/되돌리기
          const k0 = hits.find((h) => h.key === 'title');
          if (k0) {
            PE.select('title'); const y0 = st.activeTheme.title.y;
            PE.moveBy('title', 0, 10); PE.commit(); await settle();
            if (st.activeTheme.title.y !== y0 + 10) r.problems.push('moveBy 반영 안 됨 ' + y0 + '→' + st.activeTheme.title.y);
            SS.undo(); await settle();
            if (st.activeTheme.title.y !== y0) r.problems.push('되돌리기 실패 ' + st.activeTheme.title.y + ' vs ' + y0);
          }
          await shot('theme_' + th.id);
          $('btnEditTheme').click(); await sleep(500);
          const open1 = layers().filter((e) => !base.has(e)).length;
          esc(); await sleep(300);
          const open2 = layers().filter((e) => !base.has(e)).length;
          if (!open1) r.problems.push('테마 편집기 안 열림');
          if (open2) r.problems.push('테마 편집기 Esc 로 안 닫힘 dialogOpen=' + SS.dialogOpen + ' layers=' + JSON.stringify(layers().filter((e) => !base.has(e)).map(desc)) + ' active=' + desc(document.activeElement) + ' ed=' + (document.getElementById('themeEditor') || {}).className);
          if (!$('peOverlay').classList.contains('on')) r.notes = '편집기 닫은 뒤 미리보기 편집 꺼짐';
          PE.setActive(false); await sleep(100);
        } catch (e) { r.problems.push('예외 ' + e.message); }
        report.themes[th.id] = r;
      }
      // ---- 5) 자막이 있는 상태·미리보기 편집 켠 상태로 작은 창 측정 ----
      report.withWords = {};
      st.activeTheme = JSON.parse(JSON.stringify(themes.find((t) => t.id === 'bold-title-color') || themes[0]));
      PE.setActive(true); await settle(); PE.select('title');
      for (const [w, h] of [[1100, 680], [1280, 720], [1366, 768], [1920, 1080]]) {
        try { window.resizeTo(w + (window.outerWidth - window.innerWidth), h + (window.outerHeight - window.innerHeight)); } catch (e) { /* */ }
        await sleep(700);
        report.withWords[w + 'x' + h] = { inner: [window.innerWidth, window.innerHeight], cols: ['leftCol', 'rightCol', 'chatCol', 'stageWrap', 'stage'].map((i) => { const e = document.getElementById(i); if (!e) return i + ':none'; const c = getComputedStyle(e); return i + ' w=' + Math.round(e.getBoundingClientRect().width) + ' h=' + Math.round(e.getBoundingClientRect().height) + ' flex=' + c.flex + ' min=' + c.minWidth + ' ovY=' + c.overflowY + ' sh=' + e.scrollHeight; }), issues: measure() };
        await shot('words_' + w + 'x' + h);
      }
      PE.setActive(false);
      report.success = true;    } catch (e) {
      report.success = false; report.error = String((e && e.stack) || e);
    }
    report.errors = errors.slice();
    try { await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 1)); } catch (e) { /* */ }
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error);
  });
})();
