/*
 * 미리보기 직접 편집: [미리보기 편집] 을 켜면 미리보기 창의 제목·구절·자막·교회 이름·설교자·이름표·로고·영상을
 * 마우스로 끌어 옮기고, 아래 속성 칸에서 글꼴·크기·색을 바꾼다.
 *
 * 저장 방식: 고친 값은 SS.state.activeTheme (프로젝트 테마) 에만 들어간다.
 *   - 첫 수정 때 활성 테마를 복제하므로 assets/themes 의 기본 테마 파일과 목록 객체는 바뀌지 않는다.
 *   - 프로젝트 저장(.sshorts)·내보내기(exporter, SS.theme.exportLayers)가 같은 activeTheme 를 쓴다.
 *   - 실행 취소: 수정 전·후에 SS.pushUndo() 를 부른다 (editor.js 가 activeTheme 를 스냅샷에 넣는다).
 *     되돌리면 editor.js 가 'ss:theme-history' 를 알리고, 여기서는 선택 테두리·속성 칸만 다시 그린다.
 * 영상 위치 조정 드래그는 편집 모드에서만 가로채므로, 평소의 영상 자르기(crop) 드래그·휠과 충돌하지 않는다.
 * 테마에 locked:true 또는 hidden:true 가 있는 개체와 show:false 개체는 잡히지 않는다.
 */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const $ = (id) => document.getElementById(id);
  const W = 1080, H = 1920;
  const LABEL = { title: '제목', verse: '성경 구절', subtitle: '자막', churchName: '교회 이름', speaker: '설교자', badge: '이름표', logo: '로고', video: '영상' };
  const TEXT_KEYS = ['title', 'verse', 'subtitle', 'churchName', 'speaker', 'badge'];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let active = false, selKey = null, hoverKey = null;
  let sess = false, commitTimer = 0, repaintBusy = false, repaintAgain = false;
  let drag = null;
  let overlay = null, box = null, guideV = null, panel = null, toggleBtn = null, fontList = null;

  const theme = () => SS.state && SS.state.activeTheme;
  const el = (k) => { const t = theme(); return t && t[k]; };

  // ---------- 잡을 수 있는 개체 목록 ----------
  function lockedOrHidden(k) { const e = el(k); return !e || e.locked === true || e.hidden === true || e.show === false; }
  function hitsNow() {
    const out = [];
    (SS.previewHits || []).forEach((h) => {
      if (lockedOrHidden(h.key)) return;
      out.push(h);
    });
    const v = el('video');
    if (v && v.show !== false && v.width > 0 && v.height > 0 && v.locked !== true && v.hidden !== true) {
      out.push({ key: 'video', x0: v.x || 0, y0: v.y || 0, x1: (v.x || 0) + v.width, y1: (v.y || 0) + v.height });
    }
    return out;
  }
  function pick(x, y) {
    const M = 8;
    let best = null, bestA = Infinity;
    hitsNow().forEach((h) => {
      if (x < h.x0 - M || x > h.x1 + M || y < h.y0 - M || y > h.y1 + M) return;
      const a = (h.x1 - h.x0) * (h.y1 - h.y0);
      if (a <= bestA) { best = h; bestA = a; }
    });
    return best;
  }

  // ---------- 좌표 ----------
  function scale() { const r = overlay.getBoundingClientRect(); return r.width / W || 1; }
  function toCanvas(e) { const r = overlay.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }

  // ---------- 수정 세션 (실행 취소 한 덩어리) ----------
  const FOOTER = ['logo', 'churchName', 'speaker'];
  /** 묶음 배치(로고+교회 이름+설교자)를 개별 좌표로 굳힌다: 보이는 모습은 그대로, 이후 각자 움직인다 */
  function bakeFree(t) {
    if (!t.logo || t.logo.free) return;
    const hs = (SS.previewHits || []).filter((h) => h.mode);
    if (!hs.length) return;
    hs.forEach((h) => {
      if (h.key === 'logo') { t.logo.x = Math.round((h.x0 + h.x1) / 2); t.logo.y = Math.round(h.y0); return; }
      const e = t[h.key]; if (!e) return;
      if (h.mode === 'inline') { e.align = 'left'; e.x = Math.round(h.x0); } else { e.align = 'center'; e.x = Math.round((h.x0 + h.x1) / 2); }
      e.y = Math.round((h.y0 + h.y1) / 2);
    });
    t.logo.free = true;
  }
  function beginEdit(k) {
    if (sess) return;
    if (SS.pushUndo) SS.pushUndo();
    SS.state.activeTheme = SS.theme.normalizeTheme(clone(theme() || SS.theme.normalizeTheme(null)));
    if (FOOTER.includes(k)) bakeFree(SS.state.activeTheme);
    sess = true;
  }
  function commitEdit() {
    clearTimeout(commitTimer); commitTimer = 0;
    if (!sess) return;
    sess = false;
    if (SS.pushUndo) SS.pushUndo();
    window.dispatchEvent(new CustomEvent('ss:theme-edited', { detail: { key: selKey } }));
  }
  function commitSoon() { clearTimeout(commitTimer); commitTimer = setTimeout(commitEdit, 600); }
  function repaint() {
    if (repaintBusy) { repaintAgain = true; return; }
    repaintBusy = true;
    Promise.resolve(SS.updateTemplatePreview && SS.updateTemplatePreview()).catch(() => {}).finally(() => {
      repaintBusy = false;
      if (repaintAgain) { repaintAgain = false; repaint(); }
    });
  }
  /** 테마를 고치는 유일한 길목: fn(theme) 안에서만 값을 바꾼다 */
  function edit(fn, soon, k) { beginEdit(k); fn(theme()); repaint(); if (soon) commitSoon(); }

  // ---------- 위치 ----------
  function sizeOf(k) {
    const h = hitsNow().find((x) => x.key === k) || {};
    return { w: (h.x1 || 0) - (h.x0 || 0), h: (h.y1 || 0) - (h.y0 || 0) };
  }
  function setPos(k, x, y) {
    const e = el(k); if (!e) return;
    let nx = clamp(Math.round(x), 0, W), ny = clamp(Math.round(y), 0, H);
    if (k === 'video') { nx = clamp(Math.round(x), 0, Math.max(0, W - e.width)); ny = clamp(Math.round(y), 0, Math.max(0, H - e.height)); }
    e.x = nx; e.y = ny;
  }
  /** 프로그램에서 옮기기 (테스트·키보드용). 실행 취소 한 번에 묶인다 */
  function moveTo(k, x, y) { edit((t) => setPos(k, x, y), false, k); commitEdit(); }
  function moveBy(k, dx, dy) { const e = el(k); if (e) edit(() => setPos(k, el(k).x + dx, el(k).y + dy), true, k); }

  // ---------- 선택 ----------
  function select(k) {
    selKey = k || null;
    renderBox(); renderPanel();
    window.dispatchEvent(new CustomEvent('ss:preview-select', { detail: { key: selKey } }));
  }
  function renderBox() {
    if (!box) return;
    const h = selKey && active ? hitsNow().find((x) => x.key === selKey) : null;
    if (!h) { box.style.display = 'none'; return; }
    const s = scale(), bw = Math.max(2, 2.5 / s);
    box.style.display = '';
    box.style.left = h.x0 + 'px'; box.style.top = h.y0 + 'px';
    box.style.width = (h.x1 - h.x0) + 'px'; box.style.height = (h.y1 - h.y0) + 'px';
    box.style.borderWidth = bw + 'px';
    box.dataset.label = LABEL[selKey] || '';
    box.style.setProperty('--pe-s', String(1 / s));
  }

  // ---------- 마우스 ----------
  function onDown(e) {
    if (!active || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    try { overlay.focus({ preventScroll: true }); } catch (_) { /* */ }
    const p = toCanvas(e), h = pick(p.x, p.y);
    if (!h) { commitEdit(); select(null); return; }
    select(h.key);
    const mk = h.key, t = el(mk);
    drag = { key: mk, sx: e.clientX, sy: e.clientY, p0: p, ox: t.x || 0, oy: t.y || 0, moved: false, started: false, pid: e.pointerId };
    try { overlay.setPointerCapture(e.pointerId); } catch (_) { /* */ }
  }
  function onMove(e) {
    if (!active) return;
    if (!drag) {
      const p = toCanvas(e), h = pick(p.x, p.y);
      hoverKey = h ? h.key : null;
      overlay.style.cursor = h ? 'move' : 'default';
      return;
    }
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
    drag.moved = true;
    const p = toCanvas(e);
    let dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (!drag.started) { beginEdit(drag.key); drag.started = true; drag.fresh = true; }
    if (drag.fresh) { const t3 = el(drag.key); drag.ox = t3.x || 0; drag.oy = t3.y || 0; drag.fresh = false; }
    let nx = drag.ox + dx;
    // 가운데 정렬 개체는 화면 가운데(540)에 붙인다 (Alt 를 누르면 끔)
    const e2 = el(drag.key);
    let snap = false;
    if (!e.altKey && e2 && drag.key !== 'video' && (e2.align || 'center') === 'center' && Math.abs(nx - W / 2) < 8) { nx = W / 2; snap = true; }
    setPos(drag.key, nx, drag.oy + dy);
    guideV.style.display = snap ? '' : 'none';
    repaint();
  }
  function onUp(e) {
    if (!drag) return;
    try { overlay.releasePointerCapture(drag.pid); } catch (_) { /* */ }
    const started = drag.started;
    drag = null; guideV.style.display = 'none';
    if (started) commitEdit();
  }

  // ---------- 키보드 ----------
  function typing(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function onKey(e) {
    if (!active) return;
    // 자막 원문 편집·구간 다듬기·대화상자에서는 원래 단축키를 그대로 둔다
    if (e.target && e.target.closest && e.target.closest('#transcriptBody')) return;
    if (SS.state && SS.state.trimOpen) return;
    if (Array.from(document.querySelectorAll('.modal-close')).some((b) => b.offsetParent)) return;
    const inPanel = panel && panel.contains(e.target);
    if (e.key === 'Escape') {
      if (typing(e.target) && !inPanel) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (inPanel && e.target.blur) e.target.blur();
      commitEdit();
      if (selKey) select(null); else setActive(false);
      return;
    }
    if (!selKey || typing(e.target)) return;
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); e.stopImmediatePropagation();
    moveBy(selKey, d[0], d[1]);
  }

  // ---------- 속성 칸 ----------
  const hex6 = (c) => (/^#[0-9a-f]{6}/i.test(c || '') ? c.slice(0, 7) : '#ffffff');
  function renderPanel() {
    if (!panel) return;
    const k = active ? selKey : null;
    panel.hidden = !active;
    panel.classList.toggle('has-sel', !!k);
    const name = panel.querySelector('.pe-name');
    if (!k) { name.textContent = active ? '개체를 눌러 고르세요 (빈 곳 클릭·Esc 로 선택 해제)' : ''; return; }
    const e = el(k) || {};
    const isText = TEXT_KEYS.includes(k), isLogo = k === 'logo';
    const h = hitsNow().find((x) => x.key === k) || {};
    name.textContent = LABEL[k];
    const set = (id, v) => { const i = panel.querySelector(id); if (i && document.activeElement !== i) i.value = v == null ? '' : v; };
    panel.querySelector('.pe-row-font').hidden = !isText;
    panel.querySelector('.pe-row-size').hidden = !(isText || isLogo);
    panel.querySelector('.pe-row-color').hidden = !isText;
    panel.querySelector('.pe-size-label').textContent = isLogo ? '높이' : '크기';
    set('.pe-font', e.font || ''); set('.pe-size', isLogo ? e.height : e.size); set('.pe-size-range', isLogo ? e.height : e.size);
    set('.pe-color', hex6(e.color)); set('.pe-hex', e.color || '');
    set('.pe-x', Math.round(e.x || 0)); set('.pe-y', Math.round(e.y || 0));
  }
  function setProp(k, prop, val) {
    edit((t) => {
      const e = t[k]; if (!e) return;
      if (prop === 'color') {
        const old = String(e.color || ''), alpha = /^#[0-9a-f]{8}$/i.test(old) ? old.slice(7) : '';
        e.color = String(val).slice(0, 7) + alpha;
        if (e.lineColors) e.lineColors = null; // 줄별 색이 새 색을 덮지 않게
      } else e[prop] = val;
    }, true);
  }
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'pePanel'; panel.className = 'pe-panel'; panel.hidden = true;
    panel.innerHTML = '<div class="pe-name"></div>' +
      '<div class="pe-grid">' +
      '<label class="pe-row pe-row-font"><span>글꼴</span><select class="pe-font"></select></label>' +
      '<label class="pe-row pe-row-size"><span class="pe-size-label">크기</span><input class="pe-size" type="number" min="10" max="400" step="1"><input class="pe-size-range" type="range" min="10" max="240" step="1"></label>' +
      '<label class="pe-row pe-row-color"><span>색</span><input class="pe-color" type="color"><input class="pe-hex" type="text" maxlength="9" spellcheck="false"></label>' +
      '<label class="pe-row pe-row-pos"><span>위치</span>X <input class="pe-x" type="number" step="1"> Y <input class="pe-y" type="number" step="1"></label>' +
      '</div><div class="pe-hint">끌어서 이동 · 화살표 1px(Shift 10px) · Shift 끌기 한 방향 · Alt 끌기 가운데 붙임 끄기 · Ctrl+Z 되돌리기</div>';
    const left = $('leftCol'), after = $('stageWrap');
    if (left && after) left.insertBefore(panel, after.nextSibling);
    const q = (s) => panel.querySelector(s);
    const num = (inp, prop) => {
      inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (Number.isFinite(v) && selKey) setProp(selKey, prop(), clamp(Math.round(v), 1, 600)); });
      inp.addEventListener('change', () => { commitEdit(); renderPanel(); });
    };
    const sizeProp = () => (selKey === 'logo' ? 'height' : 'size');
    num(q('.pe-size'), sizeProp); num(q('.pe-size-range'), sizeProp);
    const col = q('.pe-color'), hex = q('.pe-hex');
    col.addEventListener('input', () => { if (selKey) { setProp(selKey, 'color', col.value); hex.value = (el(selKey) || {}).color || col.value; } });
    col.addEventListener('change', () => { commitEdit(); renderPanel(); });
    hex.addEventListener('change', () => {
      const v = hex.value.trim();
      if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) && selKey) { edit((t) => { t[selKey].color = v; if (t[selKey].lineColors) t[selKey].lineColors = null; }); commitEdit(); }
      renderPanel();
    });
    q('.pe-font').addEventListener('change', (ev) => { if (selKey && ev.target.value) { setProp(selKey, 'font', ev.target.value); commitEdit(); } });
    const pos = () => {
      const mk = selKey;
      const x = parseFloat(q('.pe-x').value), y = parseFloat(q('.pe-y').value);
      if (selKey && Number.isFinite(x) && Number.isFinite(y)) edit(() => setPos(mk, x, y), true, mk);
    };
    q('.pe-x').addEventListener('input', pos); q('.pe-y').addEventListener('input', pos);
    q('.pe-x').addEventListener('change', () => { commitEdit(); renderPanel(); });
    q('.pe-y').addEventListener('change', () => { commitEdit(); renderPanel(); });
    panel.addEventListener('mousedown', (ev) => ev.stopPropagation());
    loadFonts();
  }
  async function loadFonts() {
    try {
      if (!window.api || !window.api.listFonts) return;
      fontList = (await window.api.listFonts()).map((f) => f.family);
      const s = panel.querySelector('.pe-font');
      s.innerHTML = fontList.map((f) => '<option value="' + String(f).replace(/"/g, '&quot;') + '">' + String(f).replace(/</g, '&lt;') + '</option>').join('');
      renderPanel();
    } catch (_) { /* 글꼴 목록이 없으면 글꼴 칸만 비어 있다 */ }
  }

  // ---------- 모드 켜고 끄기 ----------
  function setActive(on) {
    on = !!on;
    if (on === active) return;
    commitEdit();
    active = on;
    overlay.classList.toggle('on', on);
    if (toggleBtn) { toggleBtn.classList.toggle('active', on); toggleBtn.setAttribute('aria-pressed', String(on)); }
    if (!on) { select(null); drag = null; }
    renderPanel(); renderBox();
    if (SS.updateTemplatePreview) SS.updateTemplatePreview(); // 켜면 예시 자막, 끄면 원래대로
    window.dispatchEvent(new CustomEvent('ss:preview-edit-mode', { detail: { active: on } }));
  }

  function init() {
    const inner = $('stageInner');
    if (!inner) return;
    overlay = document.createElement('div');
    overlay.id = 'peOverlay'; overlay.className = 'pe-overlay'; overlay.tabIndex = 0;
    box = document.createElement('div'); box.className = 'pe-box'; box.style.display = 'none';
    guideV = document.createElement('div'); guideV.className = 'pe-guide'; guideV.style.display = 'none';
    overlay.appendChild(guideV); overlay.appendChild(box);
    inner.appendChild(overlay);
    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
    overlay.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('ss:preview-drawn', () => {
      if (selKey && active && !drag && !hitsNow().some((h) => h.key === selKey)) select(null);
      renderBox(); renderPanel();
    });
    window.addEventListener('ss:theme-history', () => { sess = false; clearTimeout(commitTimer); renderBox(); renderPanel(); });
    window.addEventListener('resize', renderBox);

    buildPanel();
    const btn = $('btnEditTheme');
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'btnPreviewEdit'; toggleBtn.type = 'button';
    toggleBtn.className = 'btn sm ico i-pencil pe-toggle';
    toggleBtn.textContent = '미리보기 편집';
    toggleBtn.title = '미리보기에서 제목·자막·로고 등을 끌어 옮기고 크기·색을 바꿉니다 (이 프로젝트에만 적용)';
    toggleBtn.setAttribute('aria-pressed', 'false');
    toggleBtn.addEventListener('click', () => setActive(!active));
    if (btn && btn.parentNode) btn.parentNode.appendChild(toggleBtn);
  }

  SS.previewEdit = {
    get active() { return active; },
    get selected() { return selKey; },
    setActive, select, pick, moveTo, moveBy, setProp, commit: commitEdit,
    hits: () => hitsNow().map((h) => Object.assign({}, h)),
    edit: (fn) => { edit(fn); commitEdit(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
