(function() {
  'use strict';
  const SS = (window.SS = window.SS || {});
  SS.state = SS.state || {};
  const edl = SS.edl;
  const $ = id => document.getElementById(id);

  SS.state.settings = { padBefore: 0.10, padAfter: 0.15, fadeMs: 10, maxLineChars: 14, splitLongWords: true };
  SS.state.words = [];
  SS.state.overrides = {};
  SS.state.caret = 0;
  SS.state.hideDeleted = false;
  SS.state.selection = null;

  SS.state.markI = -1;
  SS.state.markO = -1;
  SS.state.trimOpen = false;

  let history = [];
  let historyIdx = -1;

  function pushHistory() {
    SS.captionEdit.capture(SS.state.words);
    const st = JSON.parse(JSON.stringify({ words: SS.state.words, overrides: SS.state.overrides, markI: SS.state.markI, markO: SS.state.markO, captionSettings: { maxLineChars: SS.state.settings.maxLineChars, splitLongWords: SS.state.settings.splitLongWords } }));
    if (historyIdx >= 0 && JSON.stringify(history[historyIdx]) === JSON.stringify(st)) return;
    history = history.slice(0, historyIdx + 1);
    history.push(st);
    historyIdx++;
  }
  SS.pushUndo = pushHistory;

  function undo() {
    if (historyIdx > 0) {
      historyIdx--;
      SS.state.words = JSON.parse(JSON.stringify(history[historyIdx].words));
      SS.state.overrides = JSON.parse(JSON.stringify(history[historyIdx].overrides));
      SS.state.markI = history[historyIdx].markI; SS.state.markO = history[historyIdx].markO;
      if (history[historyIdx].captionSettings) Object.assign(SS.state.settings, history[historyIdx].captionSettings);
      SS.syncCaptionUI();
      renderTranscript(false); if (SS.updateTemplatePreview) SS.updateTemplatePreview(); if (trimState) renderTrim();
    }
  }

  function redo() {
    if (historyIdx < history.length - 1) {
      historyIdx++;
      SS.state.words = JSON.parse(JSON.stringify(history[historyIdx].words));
      SS.state.overrides = JSON.parse(JSON.stringify(history[historyIdx].overrides));
      SS.state.markI = history[historyIdx].markI; SS.state.markO = history[historyIdx].markO;
      if (history[historyIdx].captionSettings) Object.assign(SS.state.settings, history[historyIdx].captionSettings);
      SS.syncCaptionUI();
      renderTranscript(false); if (SS.updateTemplatePreview) SS.updateTemplatePreview(); if (trimState) renderTrim();
    }
  }

  SS.resetEditorHistory = () => {
    if (SS.clearCheckedCaptions) SS.clearCheckedCaptions();
    history = []; historyIdx = -1; trimState = null; SS.state.trimOpen = false;
    if ($('trimPanel')) $('trimPanel').style.display = 'none';
    renderTranscript();
  };
  SS.undo = undo;
  SS.redo = redo;
  SS.renderTranscript = renderTranscript;
  SS.updateOutput = updateOutput;

  // Editor UI
  const panel = $('transcriptPanel');
  panel.innerHTML = `
    <div class="panel-header" style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid #333;">
      <div>자막 <label><input type="checkbox" id="chkEditedPlay" checked> 편집 결과 재생</label></div>
      <div style="font-size:12px; display:flex; gap:8px; align-items:center;">
        <span>결과: <span id="lblDuration">00:00</span> (<span id="lblCuts">0</span>컷)</span>
        앞<input type="number" id="inpPadB" value="0.10" step="0.01" style="width:40px">
        뒤<input type="number" id="inpPadA" value="0.15" step="0.01" style="width:40px">
        페이드<input type="number" id="inpFade" value="10" step="1" style="width:40px">
      </div>
    </div>

    <div style="padding:4px; display:flex; gap:4px; border-bottom:1px solid #333; align-items:center;">
      <button id="btnToggleHide" class="btn" style="padding:2px 8px; font-size:12px;">지운 부분 숨기기 (H)</button>
      <button id="btnRestoreSel" class="btn" style="padding:2px 8px; font-size:12px;">되살리기 (R)</button>
      <button id="btnKeepSel" class="btn" style="padding:2px 8px; font-size:12px;">선택만 남기기</button>
      <button id="btnAutoClean" class="btn" style="padding:2px 8px; font-size:12px; margin-left:auto;">자동 정리</button>
    </div>
    <div id="captionLengthControls" style="padding:7px 8px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; border-bottom:1px solid #333; font-size:12px;">
      <label for="inpMaxLineChars">자막 한 줄 최대</label>
      <input id="inpMaxLineChars" aria-label="자막 한 줄 최대 글자 수" type="number" min="1" max="200" step="1" value="14" style="width:54px;" title="1~200자, 공백 제외·문장부호 포함. 단어 경계를 우선합니다.">
      <span>자 <span style="color:#aaa;">(공백 제외)</span></span>
      <select id="selCaptionLength" aria-label="자막 길이 프리셋"><option value="">직접 설정</option><option value="8">8자</option><option value="12">12자</option><option value="14" selected>14자</option><option value="16">16자</option><option value="20">20자</option></select>
      <label title="한 단어가 제한보다 길면 글자 수에 맞춰 나눕니다. 분할 시각은 단어 안에서 글자 수 비례로 배분하며 영상은 바꾸지 않습니다."><input id="chkSplitLongWords" type="checkbox" checked> 긴 단어도 나누기</label>
      <span id="lblCaptionStats" style="color:#aaa; margin-left:auto;">자막 0개</span>
    </div>
    <div style="padding:5px 8px;display:flex;gap:6px;align-items:center;border-bottom:1px solid #333;font-size:12px;">
      <button id="btnCheckAllCaptions" class="btn">전체 선택</button><button id="btnUncheckCaptions" class="btn" disabled>선택 해제</button>
      <button id="btnDeleteCheckedCaptions" class="btn" disabled>선택 구간 삭제</button><span id="lblCheckedCaptions" style="color:#aaa">0개 선택</span>
    </div>
    <div style="font-size:11px; padding:4px 8px; color:#888; border-bottom:1px solid #333;">STT 원문에서 단어 삭제·복원 · 출력 자막에서 문장 수정 · Enter 자막 나누기 · 맨 앞 Backspace 합치기 · Ctrl+Enter 적용 · Ctrl+Z 취소</div>

    <div id="transcriptBody" style="flex:1; overflow-y:auto; padding:12px; font-size:14px; line-height:1.6; user-select:text;">
      자막 생성 후 여기에 자막이 표시됩니다
    </div>
    <div id="trimPanel" style="display:none; position:absolute; bottom:0; left:0; width:100%; height:200px; background:#1e1e1e; border-top:1px solid #444; z-index:100; flex-direction:column;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 8px; background:#2a2a2a; font-size:12px;">
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="btnPrevCut" class="btn" style="padding:2px 8px;">이전 컷 ([)</button>
          <button id="btnNextCut" class="btn" style="padding:2px 8px;">다음 컷 (])</button>
          <button id="btnPreviewLoop" class="btn" style="padding:2px 8px;">미리듣기 (Space)</button>
          <span style="color:#aaa;">S: 무음 스냅 | Alt+S: 제로 스냅 | R: 초기화 | Tab: 핸들전환 | ←/→: 이동</span>
        </div>
        <button id="btnCloseTrim" style="background:none; border:none; color:#fff; cursor:pointer;">닫기 (Esc)</button>
      </div>
      <div style="display:flex; flex:1; position:relative; overflow:hidden;">
        <canvas id="trimCanvas" style="width:100%; height:100%; cursor:crosshair;"></canvas>
      </div>
    </div>
  `;

  $('inpPadB').addEventListener('change', e => { SS.state.settings.padBefore = parseFloat(e.target.value); updateOutput(); });
  $('inpPadA').addEventListener('change', e => { SS.state.settings.padAfter = parseFloat(e.target.value); updateOutput(); });
  $('inpFade').addEventListener('change', e => { SS.state.settings.fadeMs = parseInt(e.target.value); updateOutput(); });
  $('chkEditedPlay').addEventListener('change', e => { editedPlayMode = e.target.checked; });

  SS.syncCaptionUI = function() {
    const cfg = SS.state.settings;
    $('inpMaxLineChars').value = cfg.maxLineChars;
    $('chkSplitLongWords').checked = cfg.splitLongWords === true;
    $('selCaptionLength').value = [8,12,14,16,20].includes(cfg.maxLineChars) ? String(cfg.maxLineChars) : '';
  };
  function applyCaptionLength(commit) {
    const input = $('inpMaxLineChars');
    if (input.value === '' || !Number.isFinite(Number(input.value))) { if (commit) SS.syncCaptionUI(); return; }
    const max = Math.max(1, Math.min(200, Math.trunc(Number(input.value))));
    const split = $('chkSplitLongWords').checked;
    if (SS.state.settings.maxLineChars !== max || SS.state.settings.splitLongWords !== split) {
      pushHistory(); SS.state.settings.maxLineChars = max; SS.state.settings.splitLongWords = split; pushHistory();
      renderTranscript(); if (SS.updateTemplatePreview) SS.updateTemplatePreview();
    }
    if (commit) SS.syncCaptionUI();
    else $('selCaptionLength').value = [8,12,14,16,20].includes(max) ? String(max) : '';
  }
  $('inpMaxLineChars').addEventListener('input', () => applyCaptionLength(false));
  $('inpMaxLineChars').addEventListener('change', () => applyCaptionLength(true));
  $('chkSplitLongWords').addEventListener('change', () => applyCaptionLength(true));
  $('selCaptionLength').addEventListener('change', e => { if (e.target.value) { $('inpMaxLineChars').value = e.target.value; applyCaptionLength(true); } });

  let editedPlayMode = true;
  SS.getEditedPlayMode = () => editedPlayMode;
  SS.setEditedPlayMode = (v) => { editedPlayMode = v; const el = $('chkEditedPlay'); if (el) el.checked = v; };

  let segments = [];
  let lines = [];
  SS.getSegments = () => segments;
  SS.getLines = () => lines;

  function updateOutput() {
    if (!SS.state.words || SS.state.words.length === 0) {
      segments = []; lines = []; $('lblCaptionStats').textContent = '자막 0개'; $('lblDuration').textContent = '00:00'; $('lblCuts').textContent = '0'; return;
    }
    segments = edl.buildSegments(SS.state.words, SS.state.settings, SS.state.overrides, SS.preview.duration);
    lines = edl.buildLines(SS.state.words, segments, SS.state.settings);
    $('lblCaptionStats').textContent = '자막 ' + lines.length + '개';

    let duration = 0;
    for (let s of segments) duration += (s.end - s.start);
    $('lblDuration').textContent = SS.fmtTime(duration).split('.')[0];

    let cuts = edl.cutPoints(segments).length;
    $('lblCuts').textContent = cuts;
  }

  function getSelectionRange() {
    const r = SS.state.selection;
    return r && r[0] !== r[1] ? [Math.min(...r), Math.max(...r)] : null;
  }
  SS.getSelectionRange = getSelectionRange;

  function deleteSelection() {
    const r = getSelectionRange();
    if (!r) return;
    const words = SS.state.words;
    let allDeleted = true;
    for (let i = r[0]; i <= r[1]; i++) if (!words[i].del) { allDeleted = false; break; }
    for (let i = r[0]; i <= r[1]; i++) words[i].del = !allDeleted;
    pushHistory();
    renderTranscript();
    updateOutput();
  }



  SS.handleDelete = (dir, toSentence) => {
    const ws = SS.state.words;
    if (ws.length === 0) return;

    if (SS.state.selection && SS.state.selection[0] !== SS.state.selection[1]) {
       pushHistory();
       const a = Math.min(SS.state.selection[0], SS.state.selection[1]);
       const b = Math.max(SS.state.selection[0], SS.state.selection[1]);
       for (let i = a; i < b; i++) {
         if (ws[i]) ws[i].del = true;
       }
       SS.state.caret = a;
       SS.state.selection = null;
    } else {
       let res;
       if (toSentence) {
         res = Caret.deleteToSentence(ws, SS.state.caret, dir);
       } else if (dir === -1) {
         res = Caret.backspaceAt(ws, SS.state.caret);
       } else {
         res = Caret.deleteAt(ws, SS.state.caret);
       }
       if (res.deleteIds.length > 0) {
         pushHistory();
         res.deleteIds.forEach(id => {
           const w = ws.find(ww => ww.id === id);
           if (w) w.del = true;
         });
       }
       SS.state.caret = res.newCaret;
    }
    renderTranscript();
  };

  SS.handleRestore = () => {
    const ws = SS.state.words;
    if (ws.length === 0) return;
    const ids = Caret.restoreAt(ws, SS.state.caret, SS.state.selection);
    if (ids.length > 0) {
      pushHistory();
      ids.forEach(id => {
        const w = ws.find(ww => ww.id === id);
        if (w) w.del = false;
      });
      renderTranscript();
    }
  };


  SS.toggleHideDeleted = () => {
    SS.state.hideDeleted = !SS.state.hideDeleted;
    renderTranscript();
  };

  SS.markIn = () => {
    let target = SS.state.caret;
    target = Math.max(0, Math.min(SS.state.words.length, target));
    if (target !== -1) {
      SS.state.markI = target;
      if (SS.state.markO !== -1 && SS.state.markI > SS.state.markO) SS.state.markO = -1;
      SS.state.words.forEach((w, i) => { if ((SS.state.markI >= 0 && i < SS.state.markI) || (SS.state.markO >= 0 && i >= SS.state.markO)) w.del = true; });
      renderTranscript();
    }
  };

  SS.markOut = () => {
    let target = SS.state.caret;
    target = Math.max(0, Math.min(SS.state.words.length, target));
    if (target !== -1) {
      SS.state.markO = target;
      if (SS.state.markI !== -1 && SS.state.markO < SS.state.markI) SS.state.markI = -1;
      SS.state.words.forEach((w, i) => { if ((SS.state.markI >= 0 && i < SS.state.markI) || (SS.state.markO >= 0 && i >= SS.state.markO)) w.del = true; });
      renderTranscript();
    }
  };

  SS.toggleCutBefore = () => {
    let target = SS.state.caret;
    if (target >= 0 && target < SS.state.words.length) {
      SS.state.words[target].cutBefore = !SS.state.words[target].cutBefore;
      pushHistory();
      renderTranscript();
      updateOutput();
    }
  };

  SS.toggleBr = () => {
    let target = SS.state.caret - 1; // br on the word BEFORE caret
    if (target >= 0 && target < SS.state.words.length) {
      SS.state.words[target].br = !SS.state.words[target].br;
      pushHistory();
      renderTranscript();
      updateOutput();
    }
  };

  SS.moveCursor = (dir, extend = false) => {
    if (SS.state.words.length === 0) return;
    SS.state.manualCaret = true;
    let next = SS.state.caret + dir;
    if (next < 0) next = 0;
    if (next > SS.state.words.length) next = SS.state.words.length;

    if (extend) {
      if (!SS.state.selection) SS.state.selAnchor = SS.state.caret;
      let anchor = SS.state.selAnchor ?? SS.state.caret;
      SS.state.selection = [Math.min(anchor, next), Math.max(anchor, next)];
    } else {
      SS.state.selection = null;
      SS.state.selAnchor = next;
    }
    SS.state.caret = next;

    let seekIdx = next;
    while (editedPlayMode && seekIdx < SS.state.words.length && SS.state.words[seekIdx].del) {
      seekIdx++;
    }
    if (seekIdx < SS.state.words.length) {
      if (SS.preview && SS.preview.seek) SS.preview.seek(SS.state.words[seekIdx].start);
    }
    renderTranscript();
  };


  function caretPositions() {
    const body = $('transcriptBody'); const pts = [];
    body.querySelectorAll('[data-wid]').forEach(el => { const r = el.getBoundingClientRect(); const i = +el.dataset.wid; pts.push({i, x:r.left, y:r.top}); pts.push({i:i+1, x:r.right, y:r.top}); });
    return pts;
  }
  SS.moveLine = (dir, extend = false, edge = false, whole = false) => {
    const pts = caretPositions(); const cur = pts.find(p => p.i === SS.state.caret); if (!cur) return;
    let target;
    if (whole) target = dir < 0 ? 0 : SS.state.words.length;
    else if (edge) { const row = pts.filter(p => Math.abs(p.y-cur.y)<3); target = row.reduce((a,b) => dir < 0 ? (a.x<b.x?a:b) : (a.x>b.x?a:b)).i; }
    else { const rows = [...new Set(pts.map(p=>p.y))].sort((a,b)=>a-b); const y = dir<0 ? rows.filter(y=>y<cur.y-3).pop() : rows.find(y=>y>cur.y+3); const row = pts.filter(p=>p.y===y); if (!row.length) return; target = row.reduce((a,b)=>Math.abs(a.x-cur.x)<Math.abs(b.x-cur.x)?a:b).i; }
    SS.moveCursor(target-SS.state.caret, extend);
  };
  SS.movePara = (dir, extend = false) => SS.moveLine(dir, extend);

  $('btnKeepSel').addEventListener('click', () => {
    const r = getSelectionRange(); if (!r) return;
    SS.state.words.forEach((w, i) => { if (i < r[0] || i >= r[1]) w.del = true; });
    renderTranscript();
  });
  SS.keepSelection = () => $('btnKeepSel').click();
  $('btnToggleHide').addEventListener('click', SS.toggleHideDeleted);
  $('btnRestoreSel').addEventListener('click', SS.handleRestore);

  let domCreated = false;
  let lastWordsJson = '';

  function renderTranscript(record = true) {
    if (record) pushHistory();
    updateOutput();
    createTranscriptDOMFull();
  }

  function createTranscriptDOMFull() {
    const body = $('transcriptBody'); body.tabIndex = 0;
    if (!SS.state.words?.length) { body.textContent = '자막 생성 후 여기에 14자 단위 자막 블록이 표시됩니다'; return; }
    SS.renderCaptionBlocks(body, SS.state.words, lines, segments);
  }

  window.addEventListener('ss:words-changed', () => { pushHistory(); renderTranscript(); });


  let transcriptDragging = false;
  window.addEventListener('mouseup', () => { transcriptDragging = false; });
  $('transcriptBody').addEventListener('mousemove', e => {
    if (!transcriptDragging || !e.target.dataset.wid) return;
    const rect = e.target.getBoundingClientRect();
    const next = Caret.caretFromClick(+e.target.dataset.wid, e.clientX < rect.left + rect.width / 2 ? 'left' : 'right');
    SS.state.selection = [Math.min(SS.state.selAnchor, next), Math.max(SS.state.selAnchor, next)];
    SS.state.caret = next; renderTranscript();
  });
  $('transcriptBody').addEventListener('mousedown', e => {
    if (e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT' && SS.flushCaptionEdit) SS.flushCaptionEdit(false);
    if (e.target.dataset.wid) {
      if (e.target.tagName === 'INPUT') return;
      e.preventDefault(); SS.state.manualCaret = true;
      transcriptDragging = true;
      const wid = parseInt(e.target.dataset.wid);
      const rect = e.target.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const side = clickX < rect.width / 2 ? 'left' : 'right';

      let newCaret = Caret.caretFromClick(wid, side);

      if (e.shiftKey) {
        if (!SS.state.selection) {
          let oldCaret = SS.state.caret; SS.state.selAnchor = oldCaret;
          SS.state.selection = [Math.min(oldCaret, newCaret), Math.max(oldCaret, newCaret)];
        } else {
          let anchor = SS.state.selAnchor ?? SS.state.caret;
          SS.state.selection = [Math.min(anchor, newCaret), Math.max(anchor, newCaret)];
        }
        SS.state.caret = newCaret;
      } else {
        SS.state.caret = newCaret;
        SS.state.selection = null;
        SS.state.selAnchor = newCaret;
      }

      // seek logic
      // find next alive word after newCaret
      let seekIdx = newCaret;
      while (editedPlayMode && seekIdx < SS.state.words.length && SS.state.words[seekIdx].del) {
        seekIdx++;
      }
      if (seekIdx < SS.state.words.length) {
        SS.preview.seek(SS.state.words[seekIdx].start);
      }

      renderTranscript();
    } else if (e.target.classList.contains('cut-marker')) {
      const c1 = parseInt(e.target.dataset.c1);
      const c2 = parseInt(e.target.dataset.c2);
      openTrimPanel(c1, c2);
    } else if (e.target.classList.contains('deleted-run')) {
      const runstart = parseInt(e.target.dataset.runstart);
      const ws = SS.state.words;
      let i = runstart;
      let hasDel = false;
      while (i < ws.length && ws[i].del) { hasDel = true; i++; }
      if (hasDel) {
         pushHistory();
         i = runstart;
         while (i < ws.length && ws[i].del) {
           ws[i].del = false;
           i++;
         }
         renderTranscript();
      }
    } else if (e.target.classList.contains('hide-scissors')) {
      // expand
      SS.state.hideDeleted = false;
      renderTranscript();
    }
  });


  $('transcriptBody').addEventListener('dblclick', e => {
    if (e.target.dataset.wid) {
      const wid = parseInt(e.target.dataset.wid);
      SS.state.caret = wid;
      SS.editWord(wid);
    }
  });


  SS.editWord = (wid) => {
    SS.state.manualCaret = true;
    if (wid === -1) wid = SS.state.caret;
    if (wid < 0 || wid >= SS.state.words.length) return;
    const w = SS.state.words[wid];
    if (w.del) return; // skip editing deleted words?

    // find the span
    const span = $('transcriptBody').querySelector(`span[data-wid="${wid}"]`);
    if (!span) return;

    // create input
    const input = document.createElement('input');
    input.type = 'text'; input.dataset.inlineEdit = 'true';
    input.value = w.text;
    input.style.width = Math.max(40, w.text.length * 14) + 'px';
    input.style.fontSize = '14px';
    input.style.background = '#222';
    input.style.color = '#fff';
    input.style.border = '1px solid #555';
    input.style.padding = '0 2px';

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (w.text !== input.value) { w._oldText = w._oldText || w.text; w.text = input.value; }
        pushHistory();
        renderTranscript();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderTranscript(); // abort
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (w.text !== input.value) { w._oldText = w._oldText || w.text; w.text = input.value; }
        pushHistory();
        renderTranscript();
        // find next valid word
        let next = wid + 1;
        while(next < SS.state.words.length && SS.state.words[next].del) next++;
        if (next < SS.state.words.length) {
          SS.state.caret = next; // optional: move caret
          setTimeout(() => SS.editWord(next), 10);
        }
      }
      e.stopPropagation(); // stop shortcuts
    });

    const slot = span.closest('.caption-block').querySelector('.caption-word-editor');
    slot.textContent = '출력 단어 수정: ';
    slot.appendChild(input);
    input.focus();
    input.select();
  };


  window.addEventListener('ss:transcript-ready', e => {
    SS.state.words = e.detail.words;
    for(let i=0; i<SS.state.words.length; i++) SS.state.words[i].id = i;
    history = []; historyIdx = -1; SS.state.caret = 0; SS.state.selection = null; SS.state.selAnchor = 0;
    renderTranscript();
    editedPlayMode = true;
    $('chkEditedPlay').checked = true;

    // Seek to the first word of the range (if not deleted)
    const firstWord = SS.state.words.find(w => !w.del);
    if (firstWord) {
      SS.preview.seek(firstWord.start);
      // Scroll to it
      setTimeout(() => {
        const span = $('transcriptBody').querySelector(`span[data-wid="${firstWord.id}"]`);
        if (span) span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  });

  let lastUpdate = 0, wasPlaying = false;
  function playbackLoop() {
    requestAnimationFrame(playbackLoop);
    const playing = SS.preview && !SS.preview.paused;
    if (playing && !wasPlaying) SS.state.manualCaret = false; wasPlaying = playing;
    if (!SS.preview || SS.preview.paused || !SS.state.words || SS.state.words.length === 0) return;
    let t = SS.preview.currentTime;
    const outT = edl.srcToOut(segments, t);
    let curLine = outT == null ? null : lines.find(l => outT >= l.outStart && outT < l.outEnd);
    if ($('tplSubtitle')) $('tplSubtitle').textContent = curLine ? curLine.text : '';
    if (editedPlayMode && segments.length > 0) {
      for (let i = 0; i < segments.length; i++) {
        let s = segments[i];
        if (i < segments.length - 1 && t >= s.end - 0.05 && t < segments[i+1].start) {
          SS.preview.seek(segments[i+1].start);
          break;
        }
      }
    }
    if (performance.now() - lastUpdate > 100) {
      lastUpdate = performance.now();
      const spans = $('transcriptBody').querySelectorAll('span[data-wid]');
      let activeIdx = -1;
      for (let i = 0; i < SS.state.words.length; i++) {
        let w = SS.state.words[i];
        if (t >= w.start && t <= w.end) { activeIdx = i; break; }
      }
      if (!SS.preview.paused && activeIdx !== -1 && !SS.state.manualCaret) {
         SS.state.caret = activeIdx;
         SS.state.selAnchor = activeIdx;
         createTranscriptDOMFull();
      }
      const r = getSelectionRange();
      spans.forEach(s => {
        let wid = parseInt(s.dataset.wid);
        let color = 'transparent';
        if (r && wid >= r[0] && wid <= r[1]) color = (wid === SS.state.caret) ? '#555' : '#333';
        if (wid === SS.state.markI || wid === SS.state.markO) color = (r && wid >= r[0] && wid <= r[1]) ? '#663' : '#440';
        s.style.backgroundColor = color;
      });
      if (SS.state.caret !== -1) {
        const activeSpan = $('transcriptBody').querySelector(`span[data-wid="${SS.state.caret}"]`);
        if (activeSpan) {
           const rect = activeSpan.getBoundingClientRect(), parentRect = $('transcriptBody').getBoundingClientRect();
           if (rect.top < parentRect.top || rect.bottom > parentRect.bottom) activeSpan.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }
  }
  requestAnimationFrame(playbackLoop);

  let trimState = null;
  SS.getTrimState = () => trimState;
  let trimBufA = null, trimBufB = null;
  let trimPcmA = null, trimPcmB = null;
  let actCtx = null;
  let trimSourceA = null, trimSourceB = null;
  let loopPlaying = false;
  let loopStartTime = 0;

  function getCuts() {
    const pts = edl.cutPoints(segments);
    pts.forEach(function(p) {
       p.a = parseInt(p.keyEnd.split(':')[1]);
       p.b = parseInt(p.keyStart.split(':')[1]);
    });
    return pts;
  }
  SS.getCuts = getCuts;

  async function openTrimPanel(idxA, idxB) {
    SS.state.trimOpen = true;
    $('trimPanel').style.display = 'flex';
    trimState = { idxA, idxB, activeHandle: 'B' };
    trimBufA = null; trimBufB = null; trimPcmA = null; trimPcmB = null;
    stopLoop(); await fetchTrimBuffers(); renderTrim();
  }
  SS.openTrimPanel = openTrimPanel;
  $('btnCloseTrim').addEventListener('click', () => { $('trimPanel').style.display = 'none'; SS.state.trimOpen = false; trimState = null; stopLoop(); });
  SS.closeTrim = () => $('btnCloseTrim').click();
  $('btnPrevCut').addEventListener('click', () => {
    if (!trimState) return;
    const cuts = getCuts();
    const idx = cuts.findIndex(c => c.keyEnd === 'e:'+trimState.idxA && c.keyStart === 's:'+trimState.idxB);
    if (idx > 0) { const p = cuts[idx-1]; openTrimPanel(parseInt(p.keyEnd.split(':')[1]), parseInt(p.keyStart.split(':')[1])); }
  });
  SS.trimPrevCut = () => $('btnPrevCut').click();
  $('btnNextCut').addEventListener('click', () => {
    if (!trimState) return;
    const cuts = getCuts();
    const idx = cuts.findIndex(c => c.keyEnd === 'e:'+trimState.idxA && c.keyStart === 's:'+trimState.idxB);
    if (idx >= 0 && idx < cuts.length - 1) { const n = cuts[idx+1]; openTrimPanel(parseInt(n.keyEnd.split(':')[1]), parseInt(n.keyStart.split(':')[1])); }
  });
  SS.trimNextCut = () => $('btnNextCut').click();
  $('btnPreviewLoop').addEventListener('click', toggleLoop);
  SS.toggleTrimLoop = toggleLoop;
  async function fetchTrimBuffers() {
    if (!trimState) return;
    const ws = SS.state.words;
    let autoAEnd = ws[trimState.idxA].end + SS.state.settings.padAfter, autoBStart = ws[trimState.idxB].start - SS.state.settings.padBefore;
    trimState.centerA = autoAEnd; trimState.centerB = autoBStart;
    trimBufA = await window.api.getPcm(SS.state.path, trimState.centerA - 2, trimState.centerA + 2, 48000);
    trimBufB = await window.api.getPcm(SS.state.path, trimState.centerB - 2, trimState.centerB + 2, 48000);
    trimPcmA = new Float32Array(trimBufA); trimPcmB = new Float32Array(trimBufB);
  }
  SS.getAEnd = () => (typeof SS.state.overrides['e:' + trimState.idxA] === 'number' ? SS.state.overrides['e:' + trimState.idxA] : trimState.centerA);
  SS.getBStart = () => (typeof SS.state.overrides['s:' + trimState.idxB] === 'number' ? SS.state.overrides['s:' + trimState.idxB] : trimState.centerB);
  function updateTrimValue(handle, val) {
    if (handle === 'A') SS.state.overrides['e:' + trimState.idxA] = val; else SS.state.overrides['s:' + trimState.idxB] = val;
    if (!dragging) pushHistory(); updateOutput(); renderTrim();
    if (loopPlaying) { stopLoop(); startLoop(); }
  }
  SS.updateTrimValue = updateTrimValue;
  SS.snapTrim = (mode) => {
    if (!trimState || !trimPcmA || !trimPcmB) return;
    let handle = trimState.activeHandle, pcm = handle === 'A' ? trimPcmA : trimPcmB, center = handle === 'A' ? trimState.centerA : trimState.centerB, t = handle === 'A' ? SS.getAEnd() : SS.getBStart();
    let offset = t - (center - 2), newOffset = edl.snap(pcm, 48000, offset, mode, 0.05);
    updateTrimValue(handle, (center - 2) + newOffset);
  };
  SS.resetTrim = () => {
    if (!trimState) return;
    if (trimState.activeHandle === 'A') delete SS.state.overrides['e:' + trimState.idxA]; else delete SS.state.overrides['s:' + trimState.idxB];
    pushHistory(); updateOutput(); renderTrim();
    if (loopPlaying) { stopLoop(); startLoop(); }
  };
  SS.switchTrimHandle = (h) => { if (!trimState) return; if (h) trimState.activeHandle = h; else trimState.activeHandle = trimState.activeHandle === 'A' ? 'B' : 'A'; renderTrim(); };
  let dragging = false;
  $('trimCanvas').addEventListener('mousedown', e => {
    if (!trimState) return;
    const rect = e.target.getBoundingClientRect(), x = e.clientX - rect.left, w = rect.width;
    if (x < w / 2) trimState.activeHandle = 'A'; else trimState.activeHandle = 'B';
    dragging = true; handleDrag(e);
  });
  function handleDrag(e) {
    if (!dragging || !trimState) return;
    const rect = $('trimCanvas').getBoundingClientRect(), x = e.clientX - rect.left, w = rect.width;
    if (trimState.activeHandle === 'A') {
      let center = trimState.centerA, minT = center - 1.5, maxT = center + 0.5, p = Math.max(0, Math.min(1, x / (w / 2)));
      updateTrimValue('A', minT + p * (maxT - minT));
    } else {
      let center = trimState.centerB, minT = center - 0.5, maxT = center + 1.5, p = Math.max(0, Math.min(1, (x - w/2) / (w / 2)));
      updateTrimValue('B', minT + p * (maxT - minT));
    }
  }
  window.addEventListener('mousemove', handleDrag); window.addEventListener('mouseup', () => { if (dragging) { dragging = false; pushHistory(); } });
  async function toggleLoop() { if (loopPlaying) stopLoop(); else startLoop(); }
  function stopLoop() { loopPlaying = false; if (trimSourceA) { try { trimSourceA.stop(); } catch(e){} trimSourceA = null; } if (trimSourceB) { try { trimSourceB.stop(); } catch(e){} trimSourceB = null; } }
  async function startLoop() {
    if (!actCtx) actCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    if (actCtx.state === 'suspended') await actCtx.resume();
    let endA = SS.getAEnd(), startB = SS.getBStart(), fadeMs = SS.state.settings.fadeMs / 1000;
    let aBuf = actCtx.createBuffer(1, trimPcmA.length, 48000); aBuf.getChannelData(0).set(trimPcmA);
    let bBuf = actCtx.createBuffer(1, trimPcmB.length, 48000); bBuf.getChannelData(0).set(trimPcmB);
    let aDur = 2.0, aOffset = (endA - 2) - (trimState.centerA - 2), bDur = 2.0, bOffset = startB - (trimState.centerB - 2);
    trimSourceA = actCtx.createBufferSource(); trimSourceA.buffer = aBuf;
    let gainA = actCtx.createGain(); trimSourceA.connect(gainA); gainA.connect(actCtx.destination);
    trimSourceB = actCtx.createBufferSource(); trimSourceB.buffer = bBuf;
    let gainB = actCtx.createGain(); trimSourceB.connect(gainB); gainB.connect(actCtx.destination);
    let t0 = actCtx.currentTime + 0.1; loopStartTime = t0;
    trimSourceA.start(t0, Math.max(0, aOffset), aDur); gainA.gain.setValueAtTime(1, t0); gainA.gain.setValueAtTime(1, t0 + aDur - fadeMs); gainA.gain.linearRampToValueAtTime(0, t0 + aDur);
    trimSourceB.start(t0 + aDur - fadeMs, Math.max(0, bOffset), bDur); gainB.gain.setValueAtTime(0, t0 + aDur - fadeMs); gainB.gain.linearRampToValueAtTime(1, t0 + aDur); gainB.gain.setValueAtTime(1, t0 + aDur - fadeMs + bDur);
    loopPlaying = true; let totalDur = aDur + bDur - fadeMs;
    setTimeout(() => { if (loopPlaying && loopStartTime === t0) startLoop(); }, totalDur * 1000);
  }
  function renderTrim() {
    if (!trimState || !trimPcmA || !trimPcmB) return;
    const canvas = $('trimCanvas'), ctx = canvas.getContext('2d'), w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * window.devicePixelRatio; canvas.height = h * window.devicePixelRatio; ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, w, h);
    let endA = SS.getAEnd(), startB = SS.getBStart(), viewAMin = trimState.centerA - 1.5, viewAMax = trimState.centerA + 0.5, viewBMin = trimState.centerB - 0.5, viewBMax = trimState.centerB + 1.5;
    function drawPane(pcm, minT, maxT, xOffset, width, isA) {
      let bufStart = (isA ? trimState.centerA : trimState.centerB) - 2, sp = 48000;
      if (isA) { let hX = ((endA - minT) / (maxT - minT)) * width; ctx.fillStyle = '#223822'; ctx.fillRect(xOffset, 0, hX, h); ctx.fillStyle = '#382222'; ctx.fillRect(xOffset + hX, 0, width - hX, h); }
      else { let hX = ((startB - minT) / (maxT - minT)) * width; ctx.fillStyle = '#382222'; ctx.fillRect(xOffset, 0, hX, h); ctx.fillStyle = '#223822'; ctx.fillRect(xOffset + hX, 0, width - hX, h); }
      let samplesPerPixel = (maxT - minT) * sp / width; ctx.beginPath(); ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
      for (let px = 0; px < width; px++) {
        let t = minT + (px / width) * (maxT - minT), sIdx = Math.floor((t - bufStart) * sp);
        if (sIdx >= 0 && sIdx < pcm.length) {
          let chunk = Math.max(1, Math.floor(samplesPerPixel)), minV = 0, maxV = 0;
          for (let j = 0; j < chunk && sIdx + j < pcm.length; j++) { let v = pcm[sIdx + j]; if (v < minV) minV = v; if (v > maxV) maxV = v; }
          ctx.moveTo(xOffset + px, h/2 - maxV * (h/2)); ctx.lineTo(xOffset + px, h/2 - minV * (h/2));
        }
      }
      ctx.stroke(); ctx.fillStyle = '#666'; ctx.font = '10px sans-serif'; ctx.textBaseline = 'top';
      let startTick = Math.ceil(minT * 10) / 10; for (let tk = startTick; tk < maxT; tk += 0.1) { let x = xOffset + ((tk - minT) / (maxT - minT)) * width; ctx.fillRect(x, h - 15, 1, 15); if (Math.abs(Math.round(tk * 10) % 5) === 0) ctx.fillText(tk.toFixed(1), x + 2, h - 15); }
      ctx.fillStyle = '#fff'; let ws = SS.state.words;
      for (let i = (isA ? Math.max(0, trimState.idxA - 5) : trimState.idxB); i <= (isA ? trimState.idxA : Math.min(ws.length-1, trimState.idxB + 5)); i++) {
        if (!ws[i]) continue; if (ws[i].start >= minT && ws[i].start <= maxT) { let wx = xOffset + ((ws[i].start - minT) / (maxT - minT)) * width; ctx.fillText(ws[i].text, wx, 10 + (i % 2)*12); ctx.fillStyle = '#555'; ctx.fillRect(wx, 25, 1, h/2 - 25); ctx.fillStyle = '#fff'; }
      }
      let handleT = isA ? endA : startB, hx = xOffset + ((handleT - minT) / (maxT - minT)) * width, isActive = isA ? (trimState.activeHandle === 'A') : (trimState.activeHandle === 'B');
      ctx.strokeStyle = isActive ? '#4af' : '#ccc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(xOffset + 10, h - 40, 150, 20); ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif';
      let delta = (handleT - (isA ? trimState.centerA : trimState.centerB)), label = isA ? `A끝: ${handleT.toFixed(3)}` : `B시작: ${handleT.toFixed(3)}`;
      label += ` (자동 대비 ${delta > 0 ? '+' : ''}${delta.toFixed(3)}s)`; ctx.fillText(label, xOffset + 14, h - 35);
    }
    drawPane(trimPcmA, viewAMin, viewAMax, 0, w/2, true); ctx.fillStyle = '#000'; ctx.fillRect(w/2 - 1, 0, 2, h); drawPane(trimPcmB, viewBMin, viewBMax, w/2, w/2, false);
    if (loopPlaying && actCtx) {
      let elap = actCtx.currentTime - loopStartTime, px = 0, aDur = 2.0;
      if (elap < aDur) { let curA = (endA - 2) + elap; px = ((curA - viewAMin) / (viewAMax - viewAMin)) * (w/2); }
      else { let curB = startB + (elap - aDur); px = w/2 + ((curB - viewBMin) / (viewBMax - viewBMin)) * (w/2); }
      ctx.fillStyle = '#ff0'; ctx.fillRect(px - 1, 0, 2, h); requestAnimationFrame(renderTrim);
    }
  }

  let findQuery = '', findMatches = [], findIdx = -1;
  SS.openFindBar = () => {
    let bar = $('findBar'); if (!bar) {
      bar = document.createElement('div'); bar.id = 'findBar'; bar.style.cssText = 'padding:4px 8px; background:#2a2a2a; border-bottom:1px solid #444; display:flex; gap:8px; align-items:center;';
      bar.innerHTML = `<span style="font-size:12px; color:#aaa;">찾기:</span><input type="text" id="inpFind" style="flex:1; background:#111; color:#fff; border:1px solid #444; padding:2px 4px; font-size:12px;"><span id="lblFindCount" style="font-size:11px; color:#888;">0/0</span><button id="btnFindPrev" class="btn sm">이전</button><button id="btnFindNext" class="btn sm">다음</button><button id="btnFindClose" class="btn sm">닫기</button>`;
      $('transcriptPanel').insertBefore(bar, $('transcriptBody'));
      const inp = $('inpFind'); inp.addEventListener('input', () => { findQuery = inp.value; doFind(); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { if (e.shiftKey) findPrev(); else findNext(); e.preventDefault(); } else if (e.key === 'Escape') { SS.closeFindBar(); e.preventDefault(); } });
      $('btnFindPrev').onclick = findPrev; $('btnFindNext').onclick = findNext; $('btnFindClose').onclick = SS.closeFindBar;
    }
    bar.style.display = 'flex'; $('inpFind').focus(); $('inpFind').select();
  };
  SS.closeFindBar = () => { const bar = $('findBar'); if (bar) bar.style.display = 'none'; const spans = $('transcriptBody').querySelectorAll('span[data-wid]'); spans.forEach(s => s.style.border = 'none'); };
  function doFind() { findMatches = []; findIdx = -1; const ws = SS.state.words; if (!findQuery) { updateFindUI(); return; } for (let i = 0; i < ws.length; i++) { if (ws[i].text.includes(findQuery)) findMatches.push(i); } if (findMatches.length > 0) { findIdx = 0; goToMatch(); } updateFindUI(); }
  function findNext() { if (findMatches.length === 0) return; findIdx = (findIdx + 1) % findMatches.length; goToMatch(); updateFindUI(); }
  function findPrev() { if (findMatches.length === 0) return; findIdx = (findIdx - 1 + findMatches.length) % findMatches.length; goToMatch(); updateFindUI(); }
  function goToMatch() {
    const wid = findMatches[findIdx]; SS.state.caret = wid; SS.state.selAnchorIdx = wid; const activeSpan = $('transcriptBody').querySelector(`span[data-wid="${wid}"]`);
    if (activeSpan) { activeSpan.scrollIntoView({ block: 'center', behavior: 'smooth' }); const spans = $('transcriptBody').querySelectorAll('span[data-wid]'); spans.forEach(s => { const swid = parseInt(s.dataset.wid); if (findMatches.includes(swid)) s.style.border = (swid === wid) ? '2px solid #39FF5A' : '1px solid #5c2d91'; else s.style.border = 'none'; }); }
  }
  function updateFindUI() { const el = $('lblFindCount'); if (el) el.textContent = findMatches.length > 0 ? `${findIdx + 1}/${findMatches.length}` : '0/0'; }


  window.addEventListener('ss:run-test-script', async (e) => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const logStep = (step) => {
       const keptDuration = SS.state.words.reduce((acc, w) => acc + (w.del ? 0 : w.end - w.start), 0);
       const delIds = SS.state.words.filter(w => w.del).map(w => w.id).slice(0, 30); // just some
       const cuts = document.querySelectorAll('.cut-marker').length;
       console.log(`[Test] ${step}: caret=${SS.state.caret}, delCount=${SS.state.words.filter(w=>w.del).length}, cuts=${cuts}, duration=${keptDuration.toFixed(2)}`);
    };

    if (e.detail.startsWith('step45')) {
      try {
        const ws = SS.state.words; for (let i = 0; i < ws.length; i++) if (ws[i].start < 900 || ws[i].end > 990) ws[i].del = true;
        let delCount = 0; for (let i = 0; i < ws.length && delCount < 3; i++) if (!ws[i].del && ws[i].start > 940 && ws[i].start < 960) { ws[i].del = true; delCount++; i += 10; }
        pushHistory(); renderTranscript(); await delay(1000);
        if (e.detail === 'step45_trim') { const markers = $('transcriptBody').querySelectorAll('.cut-marker'); if (markers.length >= 2) markers[1].click(); else if (markers.length > 0) markers[0].click(); await delay(1000); }
        window.api.notifyTestReady({});
      } catch (err) { window.api.notifyTestError(err.stack); }


    } else if (e.detail === 'caret') {
      const report = {startedAt:new Date().toISOString(), assertions:[], steps:[]};
      const assert = (name, actual, expected) => { const pass = JSON.stringify(actual) === JSON.stringify(expected); report.assertions.push({name,actual,expected,pass}); if (!pass) throw Error(name + ': ' + JSON.stringify(actual)); };
      const deleted = () => SS.state.words.filter(w=>w.del).map(w=>w.id);
      const log = name => { const seg=SS.getSegments(); report.steps.push({name,caret:SS.state.caret,deletedIds:deleted(),cuts:edl.cutPoints(seg).length,duration:seg.reduce((n,s)=>n+s.end-s.start,0)}); };
      const key = (key, opts={}) => window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,...opts}));
      try {
        await delay(300); SS.preview.pause();
        const original = JSON.parse(JSON.stringify(SS.state.words));
        const word = $('transcriptBody').querySelector('[data-wid="60"]'); word.scrollIntoView({block:'center'});
        let r=word.getBoundingClientRect(); word.dispatchEvent(new MouseEvent('mousedown',{clientX:r.right-1,clientY:r.top+2,bubbles:true})); window.dispatchEvent(new MouseEvent('mouseup'));
        assert('click right half',SS.state.caret,61);
        key('Backspace'); key('Backspace'); key('Backspace'); assert('backspace IDs',deleted(),[58,59,60]); log('backspace x3');
        key('Delete'); key('Delete'); assert('delete IDs',deleted(),[58,59,60,61,62]); log('delete x2');
        key('ArrowRight',{shiftKey:true}); key('ArrowRight',{shiftKey:true}); key('ArrowRight',{shiftKey:true});
        assert('selection',SS.state.selection,[58,61]);
        // Extend selection one more live word: explicit expected sixth deletion.
        key('ArrowRight',{shiftKey:true}); key('ArrowRight',{shiftKey:true}); key('ArrowRight',{shiftKey:true});
        assert('extended selection',SS.state.selection,[58,64]);
        const style=document.createElement('style'); style.textContent='.caret-blink{animation:none!important;opacity:1!important}'; document.head.appendChild(style);
        await window.api.testScreenshot('cache/caret_mid.png');
        key('Backspace'); assert('selection deletion IDs',deleted(),[58,59,60,61,62,63]); log('selection delete');
        const expected=edl.buildSegments(original.map((w,i)=>({...w,del:i>=58&&i<64})),SS.state.settings,{},SS.preview.duration);
        assert('cut count',edl.cutPoints(SS.getSegments()).length,edl.cutPoints(expected).length);
        assert('duration',SS.getSegments().reduce((n,s)=>n+s.end-s.start,0),expected.reduce((n,s)=>n+s.end-s.start,0));
        const btn=$('transcriptBody').querySelector('.restore-run'); btn.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); assert('restore whole run',deleted(),[]);
        key('r'); assert('no-op R',deleted(),[]);
        key('z',{ctrlKey:true}); assert('undo restore after no-op',deleted(),[58,59,60,61,62,63]); log('undo restore');
        await window.api.testScreenshot('cache/caret_before_hide.png');
        key('z',{ctrlKey:true,shiftKey:true}); assert('redo restore',deleted(),[]);
        key('z',{ctrlKey:true}); key('h'); assert('hide scissors',!!$('transcriptBody').querySelector('.hide-scissors'),true);
        assert('hidden deleted words',$('transcriptBody').querySelector('[data-wid="58"]'),null);
        await window.api.testScreenshot('cache/caret_hidden.png');
        $('transcriptBody').querySelector('.hide-scissors').dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); assert('expand hidden run',SS.state.hideDeleted,false);
        key('z',{ctrlKey:true,shiftKey:true});
        SS.state.caret=64; SS.renderTranscript(); key('F2'); let input=$('transcriptBody').querySelector('input[data-inline-edit]'); assert('F2 opens input',!!input,true);
        input.value='IXRH'; input.dispatchEvent(new KeyboardEvent('keydown',{key:'x',bubbles:true})); assert('typing suppressed',SS.state.words[64].cutBefore,original[64].cutBefore);
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); assert('inline commit',SS.state.words[64].text,'IXRH');
        key('z',{ctrlKey:true}); assert('inline undo',SS.state.words[64].text,original[64].text); key('z',{ctrlKey:true,shiftKey:true}); assert('inline redo',SS.state.words[64].text,'IXRH');
        key('e'); input=$('transcriptBody').querySelector('input[data-inline-edit]'); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true})); await delay(30); assert('Tab next word',SS.state.caret,65); $('transcriptBody').querySelector('input[data-inline-edit]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        SS.state.caret=0; SS.state.selection=null; SS.renderTranscript(); key('ArrowLeft'); assert('left boundary',SS.state.caret,0); key('ArrowRight',{shiftKey:true}); key('ArrowRight',{shiftKey:true}); assert('anchor zero preserved',SS.state.selection,[0,2]);
        key('End',{ctrlKey:true}); assert('CtrlEnd',SS.state.caret,SS.state.words.length); key('ArrowRight'); assert('right boundary',SS.state.caret,SS.state.words.length); key('Home',{ctrlKey:true}); assert('CtrlHome',SS.state.caret,0);
        SS.state.caret=60; SS.state.selection=null; SS.renderTranscript(); key('ArrowDown'); assert('down changes visual row',SS.state.caret>60,true); key('Home'); const home=SS.state.caret; key('End'); assert('Home End row order',SS.state.caret>=home,true);
        SS.state.caret=10; SS.state.selection=null; SS.state.selAnchor=10; SS.renderTranscript();
        let drag=$('transcriptBody').querySelector('[data-wid="10"]'); r=drag.getBoundingClientRect(); drag.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.left+1,clientY:r.top+1}));
        drag=$('transcriptBody').querySelector('[data-wid="13"]'); r=drag.getBoundingClientRect(); drag.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:r.right-1,clientY:r.top+1})); window.dispatchEvent(new MouseEvent('mouseup')); assert('mouse drag selection',SS.state.selection,[10,14]);
        // External AI/autoclean callers use pre-action pushUndo + words-changed.
        SS.state.selection=null; SS.pushUndo(); const old=SS.state.words[100].text; SS.state.words[100].text='external correction'; window.dispatchEvent(new Event('ss:words-changed')); SS.undo(); assert('external action undo once',SS.state.words[100].text,old); SS.redo(); assert('external action redo',SS.state.words[100].text,'external correction'); SS.undo();
        SS.state.caret=200; SS.state.selection=null; SS.handleDelete(1,false); const cut=SS.getCuts().find(c=>c.a<200&&c.b>200); assert('cut created for trim',!!cut,true);
        await SS.openTrimPanel(cut.a,cut.b); const before=SS.getBStart(); SS.updateTrimValue('B',before+0.01); SS.undo(); assert('trim undo once',SS.getBStart(),before); SS.redo(); assert('trim redo',SS.getBStart(),before+0.01); SS.closeTrim();
        const n=SS.state.words.length; SS.state.caret=n; SS.markOut(); assert('O at end keeps last word',!!SS.state.words[n-1].del,false); SS.undo();
        SS.state.selection=[20,24]; SS.keepSelection(); assert('keep selection exclusive end',SS.state.words.slice(20,25).map(w=>!!w.del),[false,false,false,false,true]); SS.undo(); assert('keep selection undo',!!SS.state.words[19].del,false);
        report.success=true;
      } catch(err) { report.success=false; report.error=err.stack; }
      report.finishedAt=new Date().toISOString();
      const launch = await window.api.getLaunchInfo();
      await window.api.writeText(launch.cache + '/caret_validation.json',JSON.stringify(report,null,2));
      window.api.notifyTestReady({success:report.success});
    }
  });
})();
