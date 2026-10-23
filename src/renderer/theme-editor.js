(function() {
  'use strict';
  const SS = (window.SS = window.SS || {});
  // 가져온 테마·사용자 글꼴 값이 HTML 속성을 깨지 않게 한다
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  
  let editorEl = null;
  let canvas = null;
  let ctx = null;
  let currentTheme = null;
  let originalThemeId = null;
  let selectedElKey = null; // 'title', 'verse', etc.
  let isDirty = false;
  let history = [];
  let historyIndex = -1;
  let fonts = [];
  
  // Drag state
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let elStartPos = { x: 0, y: 0 };
  
  const ELEMENTS = [
    { key: 'canvas', label: '배경' },
    { key: 'title', label: '제목' },
    { key: 'verse', label: '성경 구절' },
    { key: 'video', label: '영상' },
    { key: 'subtitle', label: '자막' },
    { key: 'churchName', label: '교회 이름' },
    { key: 'speaker', label: '설교자' },
    { key: 'logo', label: '로고' }
  ];

  async function init() {
    if (editorEl) return;
    
    editorEl = document.createElement('div');
    editorEl.id = 'themeEditor';
    editorEl.className = 'hidden';
    editorEl.innerHTML = `
      <div class="te-header">
        <div class="app-title">테마 편집기</div>
        <div id="teThemeName" style="color: var(--muted); font-size: 14px;"></div>
        <div style="flex: 1;"></div>
        <button id="teBtnClose" class="modal-close">&times;</button>
      </div>
      <div class="te-body">
        <div class="te-left">
          <div class="te-canvas-wrap" id="teCanvasWrap" style="width: 360px; height: 640px; overflow: hidden; position: relative;">
            <canvas id="teCanvas" width="1080" height="1920"></canvas>
            <div id="teInteraction" class="te-interaction-layer"></div>
            <div id="teSafeArea" class="te-safe-area hidden">
              <div class="te-safe-bottom" style="height: 21.875%;">유튜브 UI에 가려질 수 있음</div>
              <div class="te-safe-right" style="width: 14.8148%;">유튜브 UI</div>
            </div>
            <div id="teSelection" class="te-selection-outline hidden"></div>
            <div id="teGuideX" class="te-guide-x hidden" style="left: 540px;"></div>
            <div id="teGuideY" class="te-guide-y hidden"></div>
          </div>
        </div>
        <div class="te-right">
          <div class="te-section-title">요소 목록</div>
          <div class="te-el-list" id="teElList"></div>
          <div class="te-section-title">속성</div>
          <div class="te-props" id="teProps"></div>
        </div>
      </div>
      <div class="te-footer">
        <button id="teBtnNew" class="btn">새 테마</button>
        <button id="teBtnClone" class="btn">복제</button>
        <button id="teBtnRename" class="btn">이름 변경</button>
        <button id="teBtnDelete" class="btn">삭제</button>
        <div style="flex: 1;"></div>
        <button id="teBtnAddFont" class="btn">글꼴 추가</button>
        <button id="teBtnToggleSafe" class="btn">세이프 존</button>
        <button id="teBtnExport" class="btn">JSON 내보내기</button>
        <button id="teBtnImport" class="btn">가져오기</button>
        <button id="teBtnUndo" class="btn sm">Undo</button>
        <button id="teBtnRedo" class="btn sm">Redo</button>
        <button id="teBtnSave" class="btn primary">저장</button>
        <button id="teBtnApply" class="btn primary">이 테마 사용</button>
      </div>
    `;
    document.body.appendChild(editorEl);
    
    canvas = document.getElementById('teCanvas');
    ctx = canvas.getContext('2d');
    
    // UI Events
    document.getElementById('teBtnClose').onclick = close;
    document.getElementById('teBtnToggleSafe').onclick = () => {
      document.getElementById('teSafeArea').classList.toggle('hidden');
    };
    document.getElementById('teBtnNew').onclick = createNew;
    document.getElementById('teBtnClone').onclick = cloneCurrent;
    document.getElementById('teBtnRename').onclick = renameCurrent;
    document.getElementById('teBtnDelete').onclick = deleteCurrent;
    document.getElementById('teBtnExport').onclick = exportCurrent;
    document.getElementById('teBtnImport').onclick = importNew;
    document.getElementById('teBtnAddFont').onclick = addFont;
    document.getElementById('teBtnUndo').onclick = undo;
    document.getElementById('teBtnRedo').onclick = redo;
    document.getElementById('teBtnSave').onclick = save;
    document.getElementById('teBtnApply').onclick = apply;
    
    // Interaction
    const inter = document.getElementById('teInteraction');
    inter.onmousedown = onMouseDown;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    
    renderElList();
    
    // Scale canvas to fit
    const resize = () => {
      const wrap = document.querySelector('.te-left');
      const availW = wrap.clientWidth - 40;
      const availH = wrap.clientHeight - 40;
      const scale = Math.min(availW / 1080, availH / 1920);
      const cw = document.getElementById('teCanvasWrap');
      cw.style.width = (1080 * scale) + 'px';
      cw.style.height = (1920 * scale) + 'px';
      SS.teScale = scale;
    };
    window.addEventListener('resize', resize);
    resize();
  }

  async function open(themeId) {
    await init();
    editorEl.classList.remove('hidden');
    SS.dialogOpen = true; // Block global keymap
    
    fonts = await window.api.listFonts();
    const list = await window.api.listThemes();
    originalThemeId = themeId || list[0].id;
    const theme = list.find(t => t.id === originalThemeId) || list[0];
    
    currentTheme = JSON.parse(JSON.stringify(theme));
    if (!currentTheme.userPreset && !currentTheme.id.startsWith('user-') && originalThemeId !== 'daegu-sarang') {
      // Built-in theme: we will prompt to clone if saved
    }
    
    history = [JSON.parse(JSON.stringify(currentTheme))];
    historyIndex = 0;
    isDirty = false;
    
    selectElement('title');
    updateUI();
    render();
  }

  function close() {
    if (isDirty && !confirm('변경사항이 저장되지 않았습니다. 닫으시겠습니까?')) return;
    editorEl.classList.add('hidden');
    SS.dialogOpen = false;
    if (window.SS.updateThemeList) window.SS.updateThemeList();
  }

  function updateUI() {
    document.getElementById('teThemeName').textContent = `${currentTheme.name} (${currentTheme.id})`;
    renderElList();
    renderProps();
  }

  function renderElList() {
    const list = document.getElementById('teElList');
    list.innerHTML = '';
    ELEMENTS.forEach(el => {
      const div = document.createElement('div');
      div.className = 'te-el-item' + (selectedElKey === el.key ? ' active' : '');
      div.textContent = el.label;
      div.onclick = () => selectElement(el.key);
      list.appendChild(div);
    });
  }

  function selectElement(key) {
    selectedElKey = key;
    renderElList();
    renderProps();
    updateSelectionOutline();
  }

  function renderProps() {
    const props = document.getElementById('teProps');
    props.innerHTML = '';
    if (!selectedElKey) return;
    
    const theme = currentTheme;
    const el = theme[selectedElKey];
    
    if (selectedElKey === 'canvas') {
      addPropColor('배경색', 'background', theme.canvas.background, (v) => theme.canvas.background = v);
      return;
    }

    addPropCheck('표시', 'show', el.show, (v) => el.show = v);
    
    if (el.x !== undefined) addPropNum('X', 'x', el.x, (v) => el.x = v);
    if (el.y !== undefined) addPropNum('Y', 'y', el.y, (v) => el.y = v);
    if (el.width !== undefined) addPropNum('너비', 'width', el.width, (v) => el.width = v);
    if (el.height !== undefined) addPropNum('높이', 'height', el.height, (v) => el.height = v);
    
    if (el.align !== undefined) addPropSelect('정렬', 'align', el.align, ['left', 'center', 'right'], (v) => el.align = v);
    
    if (el.font !== undefined) {
      const fontNames = fonts.map(f => f.family);
      addPropSelect('글꼴', 'font', el.font, fontNames, (v) => el.font = v);
    }
    
    if (el.weight !== undefined) addPropSelect('굵기', 'weight', el.weight, [100, 200, 300, 400, 500, 600, 700, 800, 900], (v) => el.weight = parseInt(v));
    if (el.size !== undefined) addPropNum('크기', 'size', el.size, (v) => el.size = v);
    if (el.color !== undefined) addPropColor('색', 'color', el.color, (v) => el.color = v);
    
    if (el.stroke !== undefined) {
      addPropNum('외곽선 두께', 'stroke', el.stroke, (v) => el.stroke = v);
      addPropColor('외곽선 색', 'strokeColor', el.strokeColor || '#000000', (v) => el.strokeColor = v);
    }
    
    if (el.shadow !== undefined) {
      if (!el.shadow) el.shadow = { color: '#000000', blur: 0, offsetX: 0, offsetY: 0 };
      addPropColor('그림자 색', 'shadowColor', el.shadow.color, (v) => el.shadow.color = v);
      addPropNum('그림자 흐림', 'shadowBlur', el.shadow.blur, (v) => el.shadow.blur = v);
      addPropNum('그림자 X', 'shadowX', el.shadow.offsetX, (v) => el.shadow.offsetX = v);
      addPropNum('그림자 Y', 'shadowY', el.shadow.offsetY, (v) => el.shadow.offsetY = v);
    }

    if (selectedElKey === 'subtitle') {
      addPropCheck('배경 박스', 'hasBox', !!el.box, (v) => {
        if (v) el.box = el.box || { color: '#000000AA', radius: 4, padding: 10 };
        else el.box = null;
        renderProps();
      });
      if (el.box) {
        addPropColor('박스 색', 'boxColor', el.box.color, (v) => el.box.color = v);
        addPropNum('박스 모서리', 'boxRadius', el.box.radius, (v) => el.box.radius = v);
        addPropNum('박스 여백', 'boxPadding', el.box.padding, (v) => el.box.padding = v);
      }
      addPropNum('자간', 'letterSpacing', el.letterSpacing || 0, (v) => el.letterSpacing = v, 0.01);
      addPropNum('최대 글자수', 'maxChars', el.maxChars, (v) => el.maxChars = v);
      addPropNum('줄 간격', 'lineGap', el.lineGap, (v) => el.lineGap = v, 0.1);
    }
    
    if (selectedElKey === 'verse') {
      addPropCheck('밴드 배경', 'hasBand', !!el.band, (v) => {
        if (v) el.band = el.band || { color: '#000000', paddingY: 10 };
        else el.band = null;
        renderProps();
      });
      if (el.band) {
        addPropColor('밴드 색', 'bandColor', el.band.color, (v) => el.band.color = v);
        addPropNum('밴드 여백', 'bandPadding', el.band.paddingY, (v) => el.band.paddingY = v);
      }
    }
    
    if (selectedElKey === 'video') {
      addPropSelect('Fit', 'fit', el.fit, ['cover', 'contain'], (v) => el.fit = v);
      addPropNum('모서리 둥글기', 'radius', el.radius, (v) => el.radius = v);
      addPropCheck('테두리', 'hasBorder', !!el.border, (v) => {
        if (v) el.border = el.border || { color: '#FFFFFF', width: 1 };
        else el.border = null;
        renderProps();
      });
      if (el.border) {
        addPropColor('테두리 색', 'borderColor', el.border.color, (v) => el.border.color = v);
        addPropNum('테두리 두께', 'borderWidth', el.border.width, (v) => el.border.width = v);
      }
      addPropCheck('가장자리 페이드', 'hasFade', !!el.fade, (v) => {
        if (v) el.fade = el.fade || { edge: 'bottom', length: 100, toColor: '#000000' };
        else el.fade = null;
        renderProps();
      });
      if (el.fade) {
        addPropSelect('페이드 방향', 'fadeEdge', el.fade.edge, ['top', 'bottom'], (v) => el.fade.edge = v);
        addPropNum('페이드 길이', 'fadeLength', el.fade.length, (v) => el.fade.length = v);
        addPropColor('페이드 색', 'fadeColor', el.fade.toColor, (v) => el.fade.toColor = v);
      }
    }
    
    if (selectedElKey === 'logo') {
      addPropText('경로', 'path', el.path, (v) => el.path = v);
      const btn = document.createElement('button');
      btn.className = 'btn sm';
      btn.textContent = '이미지 선택';
      btn.onclick = async () => {
        const r = await window.api.chooseLogo();
        if (r) {
          el.path = r.path;
          pushHistory();
          renderProps();
          SS.loadLogoFromPath(r.path).then(render);
        }
      };
      props.appendChild(btn);
    }
    
    if (selectedElKey === 'speaker') {
      addPropText('포맷', 'format', el.format, (v) => el.format = v);
    }
    
    if (selectedElKey === 'churchName') {
      addPropNum('자간', 'letterSpacing', el.letterSpacing || 0, (v) => el.letterSpacing = v, 0.01);
    }
  }

  function addPropNum(label, id, val, onChange, step = 1) {
    const row = document.createElement('div');
    row.className = 'te-prop-row';
    row.innerHTML = `<span class="te-prop-label">${esc(label)}</span><input type="number" step="${esc(step)}" class="te-prop-input" value="${esc(val)}">`;
    const input = row.querySelector('input');
    input.onchange = (e) => { onChange(parseFloat(e.target.value)); pushHistory(); render(); };
    document.getElementById('teProps').appendChild(row);
  }
  function addPropCheck(label, id, val, onChange) {
    const row = document.createElement('div');
    row.className = 'te-prop-row';
    row.innerHTML = `<span class="te-prop-label">${esc(label)}</span><input type="checkbox" class="te-prop-input" ${val ? 'checked' : ''}>`;
    const input = row.querySelector('input');
    input.onchange = (e) => { onChange(e.target.checked); pushHistory(); render(); };
    document.getElementById('teProps').appendChild(row);
  }
  function addPropColor(label, id, val, onChange) {
    const row = document.createElement('div');
    row.className = 'te-prop-row';
    
    let hex = '#000000';
    let alpha = 1.0;
    if (val && val.startsWith('#')) {
      if (val.length === 9) {
        hex = val.substring(0, 7);
        alpha = parseInt(val.substring(7, 9), 16) / 255.0;
      } else {
        hex = val;
      }
    }
    
    row.innerHTML = `
      <span class="te-prop-label">${esc(label)}</span>
      <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
        <div style="display:flex; gap:4px;">
          <input type="color" class="te-prop-color" value="${esc(hex)}" style="width:30px; height:24px; padding:0; border:none;">
          <input type="text" class="te-prop-input" value="${esc(val || '#000000')}" style="flex:1;">
        </div>
        <div style="display:flex; align-items:center; gap:4px; font-size:11px; color:#aaa;">
          A: <input type="range" class="te-prop-alpha" min="0" max="1" step="0.01" value="${esc(alpha)}" style="flex:1;">
        </div>
      </div>
    `;
    const cInput = row.querySelector('.te-prop-color');
    const tInput = row.querySelector('input[type="text"]');
    const aInput = row.querySelector('.te-prop-alpha');
    
    const update = (newHex, newAlpha) => {
      let out = newHex;
      if (newAlpha < 1.0) {
        let aHex = Math.round(newAlpha * 255).toString(16).padStart(2, '0').toUpperCase();
        out += aHex;
      }
      out = out.toUpperCase();
      tInput.value = out;
      onChange(out);
      pushHistory();
      render();
    };
    
    cInput.onchange = (e) => update(e.target.value, parseFloat(aInput.value));
    aInput.onchange = (e) => update(cInput.value, parseFloat(e.target.value));
    tInput.onchange = (e) => {
      let v = e.target.value;
      if (v.match(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/)) {
        let h = v.substring(0, 7);
        let a = v.length === 9 ? parseInt(v.substring(7, 9), 16) / 255.0 : 1.0;
        cInput.value = h;
        aInput.value = a;
        onChange(v.toUpperCase());
        pushHistory();
        render();
      }
    };
    
    document.getElementById('teProps').appendChild(row);
  }
  function addPropSelect(label, id, val, options, onChange) {
    const row = document.createElement('div');
    row.className = 'te-prop-row';
    const opts = options.map(o => `<option value="${esc(o)}" ${o == val ? 'selected' : ''}>${esc(o)}</option>`).join('');
    row.innerHTML = `<span class="te-prop-label">${esc(label)}</span><select class="te-prop-input">${opts}</select>`;
    const input = row.querySelector('select');
    input.onchange = (e) => { onChange(e.target.value); pushHistory(); render(); };
    document.getElementById('teProps').appendChild(row);
  }
  function addPropText(label, id, val, onChange) {
    const row = document.createElement('div');
    row.className = 'te-prop-row';
    row.innerHTML = `<span class="te-prop-label">${esc(label)}</span><input type="text" class="te-prop-input" value="${esc(val || '')}">`;
    const input = row.querySelector('input');
    input.onchange = (e) => { onChange(e.target.value); pushHistory(); render(); };
    document.getElementById('teProps').appendChild(row);
  }

  function pushHistory() {
    history = history.slice(0, historyIndex + 1);
    history.push(JSON.parse(JSON.stringify(currentTheme)));
    historyIndex++;
    isDirty = true;
  }

  function undo() {
    if (historyIndex > 0) {
      historyIndex--;
      currentTheme = JSON.parse(JSON.stringify(history[historyIndex]));
      updateUI();
      render();
    }
  }
  function redo() {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      currentTheme = JSON.parse(JSON.stringify(history[historyIndex]));
      updateUI();
      render();
    }
  }

  async function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, 1080, 1920);
    const params = {
      title: '설교 제목 샘플',
      verse: '성경 구절 샘플 1:1',
      speaker: '설교자 샘플',
      subtitleText: '자막 샘플입니다. 최대 글자수를 확인하세요.',
      theme: currentTheme,
      churchName: '교회 이름 샘플'
    };
    await SS.ensureFonts(currentTheme);
    
    // 1. Draw background
    SS.drawTemplate(ctx, ['background'], params);
    
    // 2. Draw placeholder/video
    const v = currentTheme.video;
    if (v && v.show) {
      ctx.save();
      if (v.radius > 0) {
        ctx.beginPath();
        const r = v.radius;
        ctx.moveTo(v.x + r, v.y);
        ctx.arcTo(v.x + v.width, v.y, v.x + v.width, v.y + v.height, r);
        ctx.arcTo(v.x + v.width, v.y + v.height, v.x, v.y + v.height, r);
        ctx.arcTo(v.x, v.y + v.height, v.x, v.y, r);
        ctx.arcTo(v.x, v.y, v.x + v.width, v.y, r);
        ctx.closePath();
        ctx.clip();
      } else {
        ctx.beginPath();
        ctx.rect(v.x, v.y, v.width, v.height);
        ctx.clip();
      }
      
      const vidEl = document.getElementById('video');
      if (vidEl && vidEl.videoWidth) {
         const scale = Math.max(v.width / vidEl.videoWidth, v.height / vidEl.videoHeight);
         const dw = vidEl.videoWidth * scale;
         const dh = vidEl.videoHeight * scale;
         const dx = v.x + (v.width - dw)/2;
         const dy = v.y + (v.height - dh)/2;
         ctx.drawImage(vidEl, dx, dy, dw, dh);
      } else {
         ctx.fillStyle = '#666666';
         ctx.fillRect(v.x, v.y, v.width, v.height);
         ctx.fillStyle = '#999999';
         ctx.font = '40px sans-serif';
         ctx.textAlign = 'center';
         ctx.textBaseline = 'middle';
         ctx.fillText('영상 영역', v.x + v.width/2, v.y + v.height/2);
      }
      ctx.restore();
    }
    
    // 3. Draw top layer (borders, fades, texts) and footer
    SS.drawTemplate(ctx, ['top', 'subtitle', 'footer'], params);
    
    updateSelectionOutline();
  }

  function updateSelectionOutline() {
    const outline = document.getElementById('teSelection');
    if (!selectedElKey || selectedElKey === 'canvas') {
      outline.classList.add('hidden');
      return;
    }
    const el = currentTheme[selectedElKey];
    if (!el || !el.show) {
      outline.classList.add('hidden');
      return;
    }
    
    outline.classList.remove('hidden');
    let x = el.x, y = el.y, w = el.width, h = el.size || el.height;
    
    if (selectedElKey === 'logo') h = el.height;
    if (selectedElKey === 'video') h = el.height;
    
    if (el.align === 'center') x -= w / 2;
    else if (el.align === 'right') x -= w;
    
    // For text, y is baseline/center, so we adjust
    if (selectedElKey !== 'video' && selectedElKey !== 'logo') {
      y -= h / 2;
    }

    const s = SS.teScale;
    outline.style.left = (x * s) + 'px';
    outline.style.top = (y * s) + 'px';
    outline.style.width = (w * s) + 'px';
    outline.style.height = (h * s) + 'px';
    outline.style.border = '2px dashed var(--accent2)';
    
    const labelText = ELEMENTS.find(e=>e.key===selectedElKey)?.label || selectedElKey;
    outline.innerHTML = `<div style="position:absolute; top:-20px; left:-2px; background:var(--accent2); color:#fff; font-size:12px; padding:2px 4px; white-space:nowrap;">${esc(labelText)}</div>`;
    outline.style.height = (h * s) + 'px';
  }

  function onMouseDown(e) {
    const s = SS.teScale;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / s;
    const my = (e.clientY - rect.top) / s;
    
    // Hit test elements in reverse order
    const keys = ELEMENTS.map(e => e.key).filter(k => k !== 'canvas').reverse();
    let found = null;
    for (const key of keys) {
      const el = currentTheme[key];
      if (!el || !el.show) continue;
      
      let x = el.x, y = el.y, w = el.width, h = el.size || el.height;
      if (key === 'logo' || key === 'video') h = el.height;
      
      if (el.align === 'center') x -= w / 2;
      else if (el.align === 'right') x -= w;
      if (key !== 'video' && key !== 'logo') y -= h / 2;
      
      if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
        found = key;
        break;
      }
    }
    
    if (found) {
      selectElement(found);
      isDragging = true;
      dragStart = { x: mx, y: my };
      elStartPos = { x: currentTheme[found].x, y: currentTheme[found].y };
    }
  }

  function onMouseMove(e) {
    if (!isDragging || !selectedElKey) return;
    const s = SS.teScale;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / s;
    const my = (e.clientY - rect.top) / s;
    
    let dx = mx - dragStart.x;
    let dy = my - dragStart.y;
    
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    
    const el = currentTheme[selectedElKey];
    el.x = Math.round(elStartPos.x + dx);
    el.y = Math.round(elStartPos.y + dy);
    
    // Snapping to center
    if (Math.abs(el.x - 540) < 10 && el.align === 'center') {
      el.x = 540;
      document.getElementById('teGuideX').classList.remove('hidden');
    } else {
      document.getElementById('teGuideX').classList.add('hidden');
    }
    
    render();
    renderProps();
  }

  function onMouseUp() {
    if (isDragging) {
      isDragging = false;
      pushHistory();
      document.getElementById('teGuideX').classList.add('hidden');
    }
  }

  function onKeyDown(e) {
    if (!SS.dialogOpen || editorEl.classList.contains('hidden')) return;
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;
    
    const el = currentTheme[selectedElKey];
    if (!el) return;
    
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { el.x -= step; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { el.x += step; e.preventDefault(); }
    else if (e.key === 'ArrowUp') { el.y -= step; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { el.y += step; e.preventDefault(); }
    else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      if (e.shiftKey) redo();
      else undo();
      e.preventDefault();
    }
    
    if (e.key.startsWith('Arrow')) {
      render();
      renderProps();
      // debounce pushHistory if needed, but for now just push
    }
  }

  async function createNew() {
    const name = prompt('새 테마 이름:', '새 테마');
    if (!name) return;
    const newTheme = SS.theme.normalizeTheme({ name });
    newTheme.id = 'user-' + Date.now();
    currentTheme = newTheme;
    pushHistory();
    updateUI();
    render();
  }

  async function cloneCurrent() {
    const name = prompt('복제된 테마 이름:', currentTheme.name + ' (복사본)');
    if (!name) return;
    const newTheme = JSON.parse(JSON.stringify(currentTheme));
    newTheme.name = name;
    newTheme.id = 'user-' + Date.now();
    currentTheme = newTheme;
    pushHistory();
    updateUI();
    render();
  }

  async function renameCurrent() {
    const name = prompt('테마 이름 변경:', currentTheme.name);
    if (!name) return;
    currentTheme.name = name;
    pushHistory();
    updateUI();
  }

  async function deleteCurrent() {
    if (!currentTheme.id.startsWith('user-') && !currentTheme.userPreset) {
      alert('기본 테마는 삭제할 수 없습니다.');
      return;
    }
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await window.api.deleteTheme(currentTheme.id);
    const list = await window.api.listThemes();
    open(list[0].id);
  }

  async function exportCurrent() {
    await window.api.exportTheme(currentTheme);
  }

  async function importNew() {
    const theme = await window.api.importTheme();
    if (theme) {
      theme.id = 'user-' + Date.now(); // Ensure unique ID
      currentTheme = theme;
      pushHistory();
      updateUI();
      render();
    }
  }

  async function addFont() {
    const r = await window.api.addFont();
    if (r) {
      fonts = await window.api.listFonts();
      renderProps();
      alert(`글꼴 '${r.family}'가 추가되었습니다.`);
    }
  }

  async function save() {
    if (!currentTheme.id.startsWith('user-') && !currentTheme.userPreset) {
      if (confirm('기본 테마는 수정할 수 없습니다. 복제해서 편집하시겠습니까?')) {
        await cloneCurrent();
      } else {
        return;
      }
    }
    await window.api.saveTheme(currentTheme);
    isDirty = false;
    alert('저장되었습니다.');
  }

  async function apply() {
    if (isDirty) await save();
    const settings = await window.api.getSettings();
    settings.activeThemeId = currentTheme.id;
    await window.api.saveSettings(settings);
    SS.state.activeTheme = currentTheme;
    SS.updateTemplatePreview && SS.updateTemplatePreview();
    if (window.SS.updateThemeList) window.SS.updateThemeList();
    alert('테마가 적용되었습니다.');
  }

  SS.openThemeEditor = open;
  SS.teSelectElement = selectElement;
  SS.tePushHistory = pushHistory;
  SS.teRender = render;
  SS.teGetCurrentTheme = () => currentTheme;
  console.log('theme-editor.js loaded');
})();
