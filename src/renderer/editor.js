(function() {
  'use strict';
  const SS = (window.SS = window.SS || {});
  SS.state = SS.state || {};
  const edl = SS.edl;
  const $ = id => document.getElementById(id);

  SS.state.settings = { padBefore: 0.10, padAfter: 0.15, fadeMs: 10, maxLineChars: 14, splitLongWords: true, semanticBreaks: true };
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
    const st = JSON.parse(JSON.stringify({ words: SS.state.words, overrides: SS.state.overrides, markI: SS.state.markI, markO: SS.state.markO, captionSettings: { maxLineChars: SS.state.settings.maxLineChars, splitLongWords: SS.state.settings.splitLongWords, semanticBreaks: SS.state.settings.semanticBreaks }, bgm: SS.state.bgm || null }));
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
      if ('bgm' in history[historyIdx]) { SS.state.bgm = history[historyIdx].bgm ? JSON.parse(JSON.stringify(history[historyIdx].bgm)) : null; if (SS.bgmUi) { SS.bgmUi.render(); SS.bgmUi.drawWave(); } }
      SS.syncCaptionUI();
      renderTranscript(false); if (SS.updateTemplatePreview) SS.updateTemplatePreview(); if (trimState) { renderTrim(); trimHeader(); }
    }
  }

  function redo() {
    if (historyIdx < history.length - 1) {
      historyIdx++;
      SS.state.words = JSON.parse(JSON.stringify(history[historyIdx].words));
      SS.state.overrides = JSON.parse(JSON.stringify(history[historyIdx].overrides));
      SS.state.markI = history[historyIdx].markI; SS.state.markO = history[historyIdx].markO;
      if (history[historyIdx].captionSettings) Object.assign(SS.state.settings, history[historyIdx].captionSettings);
      if ('bgm' in history[historyIdx]) { SS.state.bgm = history[historyIdx].bgm ? JSON.parse(JSON.stringify(history[historyIdx].bgm)) : null; if (SS.bgmUi) { SS.bgmUi.render(); SS.bgmUi.drawWave(); } }
      SS.syncCaptionUI();
      renderTranscript(false); if (SS.updateTemplatePreview) SS.updateTemplatePreview(); if (trimState) { renderTrim(); trimHeader(); }
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

  // 자막이 없을 때 보여 줄 시작 안내 (버튼은 layout.js 의 data-cmd 로 동작)
  function emptyStateHtml() {
    return '<div class="empty-state">'
      + '<div class="es-title">설교 영상을 불러와 시작하세요</div>'
      + '<div class="es-cards">'
      + '<div class="es-card"><span class="ico xl i-sparkles" aria-hidden="true"></span><b>유튜브 주소로 AI 편집</b><p>오른쪽 AI 편집 대화에 설교 영상 주소를 넣으면 구간 추천부터 편집까지 해 줍니다.</p><button class="btn sm primary" data-cmd="focus-chat">주소 넣기</button></div>'
      + '<div class="es-card"><span class="ico xl i-film" aria-hidden="true"></span><b>내 컴퓨터의 영상</b><p>영상 파일을 열고 자막 메뉴의 [자막 만들기]로 음성을 글자로 바꿔 직접 편집합니다.</p><button class="btn sm" data-cmd="open-video">영상 파일 열기</button></div>'
      + '<div class="es-card"><span class="ico xl i-folder-open" aria-hidden="true"></span><b>저장한 프로젝트</b><p>전에 저장한 편집(.sshorts)을 이어서 합니다.</p><button class="btn sm" data-cmd="open-project">프로젝트 열기</button></div>'
      + '</div></div>';
  }
  SS.emptyStateHtml = emptyStateHtml;

  // Editor UI
  const panel = $('transcriptPanel');
  panel.innerHTML = `
    <div class="ed-head">
      <div class="ed-title"><span class="ico i-captions" aria-hidden="true"></span>자막 편집
        <span class="ed-stats"><span id="lblCaptionStats">자막 0개</span> · 결과 <span id="lblDuration">00:00</span> · <span id="lblCuts">0</span>컷<span id="lblTidy" class="tidy-stat"></span></span>
      </div>
      <label class="ed-switch" title="지운 부분은 건너뛰고 편집 결과대로 재생합니다"><input type="checkbox" id="chkEditedPlay" checked> 편집 결과로 재생</label>
    </div>
    <div class="ed-toolbar" role="toolbar" aria-label="자막 편집 도구">
      <div class="tb-group">
        <button id="btnToggleHide" class="btn sm ico i-eye-off" title="지운 부분 숨기기·보이기 (H)">지운 부분 숨기기</button>
        <button id="btnRestoreSel" class="btn sm ico i-rotate-ccw" title="선택한 지운 부분 되살리기 (R)">되살리기</button>
        <button id="btnKeepSel" class="btn sm ico i-crop" title="선택한 부분만 남기고 나머지 지우기 (Ctrl+K)">선택만 남기기</button>
      </div>
      <div class="tb-group">
        <button id="btnAutoClean" class="btn sm ico i-wand-sparkles" title="자동 정리: 군말(음·어·아)·되풀이한 말·말 사이 공백 지우기, 지운 곳은 노란 표시 (Ctrl+Shift+C)">자동 정리</button>
        <button id="btnAiCorrect" class="btn sm ico i-spell-check" title="AI 용어 교정: 교회 용어·고유명사 오타 고치기, 제미나이 키 필요 (Ctrl+Shift+T)" disabled>용어 교정</button>
      </div>
      <div class="tb-group">
        <button id="btnCheckAllCaptions" class="btn sm ico i-list-checks" title="모든 자막 구간 선택">전체 선택</button>
        <button id="btnUncheckCaptions" class="btn sm ico i-x" disabled>선택 해제</button>
        <button id="btnDeleteCheckedCaptions" class="btn sm danger ico i-trash-2" disabled>선택 구간 삭제</button>
        <span id="lblCheckedCaptions" class="sr-only">0개 선택</span>
      </div>
      <span class="tb-spacer"></span>
      <button id="btnEdSettings" class="btn sm ghost ico i-sliders-horizontal" aria-expanded="false" aria-controls="edSettings" title="자막 한 줄 길이·컷 여백·페이드">설정</button>
    </div>
    <div id="edSettings" class="ed-settings" hidden>
      <div id="captionLengthControls" class="ed-set-row">
        <label for="inpMaxLineChars">자막 한 줄 최대</label>
        <input id="inpMaxLineChars" aria-label="자막 한 줄 최대 글자 수" type="number" min="1" max="200" step="1" value="14" title="1~200자, 공백 제외·문장부호 포함. 단어 경계를 우선합니다.">
        <span>자 <span class="muted">(공백 제외)</span></span>
        <select id="selCaptionLength" aria-label="자막 길이 프리셋"><option value="">직접 설정</option><option value="8">8자</option><option value="12">12자</option><option value="14" selected>14자</option><option value="16">16자</option><option value="20">20자</option></select>
        <label class="ed-check" title="글자 수만 채워 끊지 않고 문장 끝·쉼표·말 사이 쉼·이음말(~고, ~는데, ~할 때) 뒤에서 끊습니다. '하나님의', '그런', '할 수'처럼 붙어 다니는 말은 한 줄에 둡니다."><input id="chkSemanticBreaks" type="checkbox" checked> 의미 단위로 나누기</label>
        <label class="ed-check" title="한 단어가 제한보다 길면 글자 수에 맞춰 나눕니다. 분할 시각은 단어 안에서 글자 수 비례로 배분하며 영상은 바꾸지 않습니다."><input id="chkSplitLongWords" type="checkbox" checked> 긴 단어도 나누기</label>
      </div>
      <div class="ed-set-row">
        <span>컷 여백</span>
        <label class="ed-num">앞 <input type="number" id="inpPadB" value="0.10" step="0.01"></label>
        <label class="ed-num">뒤 <input type="number" id="inpPadA" value="0.15" step="0.01"></label>
        <span class="muted">초</span>
        <span class="ed-sep"></span>
        <label class="ed-num">페이드 <input type="number" id="inpFade" value="10" step="1"></label>
        <span class="muted">ms</span>
      </div>
      <div class="ed-set-row">
        <label class="ed-check" title="음성 인식(자막 만들기)이 끝나면 군말(음·어·아)과 0.3초 넘는 말 사이 공백을 바로 지웁니다. 지운 곳은 노란 표시로 보이고 누르면 되살립니다."><input type="checkbox" id="chkAutoTidy" checked> 음성 인식 뒤 군말·말 사이 공백 자동으로 지우기</label>
      </div>
    </div>
    <div class="ed-hint">두 번 누르기: 시작·끝 미세 조정 · STT 원문: 단어 클릭 → Backspace 지우기 · 출력 자막: Enter 나누기 · 맨 앞 Backspace 합치기 · Ctrl+Z 취소 · F1 단축키</div>

    <div id="transcriptBody">${emptyStateHtml()}</div>
    <div id="trimPanel" class="trim-panel" style="display:none;" role="region" aria-label="미세 조정">
      <div class="trim-head">
        <span id="trimTitle" class="trim-title">컷 미세 조정</span>
        <button id="btnPrevCut" class="btn sm ghost">이전 컷 ([)</button>
        <button id="btnNextCut" class="btn sm ghost">다음 컷 (])</button>
        <span class="trim-sep"></span>
        <span class="trim-handle">움직일 곳 <b id="trimHandleName">시작</b></span>
        <button class="btn sm" data-nudge="-0.1" title="0.1초 앞으로">−0.1</button>
        <button class="btn sm" data-nudge="-0.01" title="0.01초 앞으로 (Shift+←)">−0.01</button>
        <button class="btn sm" data-nudge="0.01" title="0.01초 뒤로 (Shift+→)">+0.01</button>
        <button class="btn sm" data-nudge="0.1" title="0.1초 뒤로">+0.1</button>
        <button id="btnTrimReset" class="btn sm ghost ico i-rotate-ccw" title="자동 위치로 (R)">원래대로</button>
        <button id="btnPreviewLoop" class="btn sm primary ico i-play" title="편집 결과로 들어 보기 (Space)">미리듣기</button>
        <span class="tb-spacer"></span>
        <button id="btnCloseTrim" class="btn sm ghost ico i-x" title="닫기 (Esc)">닫기</button>
      </div>
      <div class="trim-help">파형을 누르거나 끌어서 옮기기 · ←/→ 1프레임 · Shift 10ms · Alt 1ms · Tab 시작↔끝 · S 무음에 맞추기 · Enter 적용하고 들어 보기 · 초록=남는 소리, 빨강=잘려 나가는 소리</div>
      <div class="trim-body"><canvas id="trimCanvas"></canvas></div>
    </div>
  `;

  if (SS.autoTidyEnabled) $('chkAutoTidy').checked = SS.autoTidyEnabled();
  $('chkAutoTidy').addEventListener('change', e => { if (SS.setAutoTidy) SS.setAutoTidy(e.target.checked); });
  $('inpPadB').addEventListener('change', e => { SS.state.settings.padBefore = parseFloat(e.target.value); updateOutput(); });
  $('inpPadA').addEventListener('change', e => { SS.state.settings.padAfter = parseFloat(e.target.value); updateOutput(); });
  $('inpFade').addEventListener('change', e => { SS.state.settings.fadeMs = parseInt(e.target.value); updateOutput(); });
  $('chkEditedPlay').addEventListener('change', e => { editedPlayMode = e.target.checked; if (SS.updateTimeUI) SS.updateTimeUI(); });
  // 자막 길이·컷 여백 설정 펼치기
  SS.toggleCaptionSettings = (open) => {
    const box = $('edSettings'), btn = $('btnEdSettings');
    const show = open == null ? box.hidden : !!open;
    box.hidden = !show; btn.setAttribute('aria-expanded', String(show)); btn.classList.toggle('active', show);
    if (show) $('inpMaxLineChars').focus();
  };
  $('btnEdSettings').addEventListener('click', () => SS.toggleCaptionSettings());

  SS.syncCaptionUI = function() {
    const cfg = SS.state.settings;
    $('inpMaxLineChars').value = cfg.maxLineChars;
    $('chkSplitLongWords').checked = cfg.splitLongWords === true;
    $('chkSemanticBreaks').checked = cfg.semanticBreaks !== false;
    $('selCaptionLength').value = [8,12,14,16,20].includes(cfg.maxLineChars) ? String(cfg.maxLineChars) : '';
  };
  function applyCaptionLength(commit) {
    const input = $('inpMaxLineChars');
    if (input.value === '' || !Number.isFinite(Number(input.value))) { if (commit) SS.syncCaptionUI(); return; }
    const max = Math.max(1, Math.min(200, Math.trunc(Number(input.value))));
    const split = $('chkSplitLongWords').checked, semantic = $('chkSemanticBreaks').checked;
    if (SS.state.settings.maxLineChars !== max || SS.state.settings.splitLongWords !== split || (SS.state.settings.semanticBreaks !== false) !== semantic) {
      pushHistory(); SS.state.settings.maxLineChars = max; SS.state.settings.splitLongWords = split; SS.state.settings.semanticBreaks = semantic; pushHistory();
      renderTranscript(); if (SS.updateTemplatePreview) SS.updateTemplatePreview();
    }
    if (commit) SS.syncCaptionUI();
    else $('selCaptionLength').value = [8,12,14,16,20].includes(max) ? String(max) : '';
  }
  $('inpMaxLineChars').addEventListener('input', () => applyCaptionLength(false));
  $('inpMaxLineChars').addEventListener('change', () => applyCaptionLength(true));
  $('chkSplitLongWords').addEventListener('change', () => applyCaptionLength(true));
  $('chkSemanticBreaks').addEventListener('change', () => applyCaptionLength(true));
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
      segments = []; lines = []; $('lblCaptionStats').textContent = '자막 0개'; $('lblDuration').textContent = '00:00'; $('lblCuts').textContent = '0'; if ($('lblTidy')) $('lblTidy').textContent = ''; return;
    }
    segments = edl.buildSegments(SS.state.words, SS.state.settings, SS.state.overrides, SS.preview.duration);
    lines = edl.buildLines(SS.state.words, segments, SS.state.settings);
    $('lblCaptionStats').textContent = '자막 ' + lines.length + '개';

    let duration = 0;
    for (let s of segments) duration += (s.end - s.start);
    $('lblDuration').textContent = SS.fmtTime(duration).split('.')[0];

    let cuts = edl.cutPoints(segments).length;
    $('lblCuts').textContent = cuts;
    // 지운 군말·잘라 낸 공백 요약
    const tl = $('lblTidy');
    if (tl && SS.disfluency) {
      const s = SS.disfluency.summary(SS.state.words, segments), parts = [];
      if (s.fillers) parts.push('군말 ' + s.fillers);
      if (s.gaps) parts.push('공백 ' + s.gaps + '곳 −' + s.gapSec.toFixed(1) + '초');
      tl.textContent = parts.length ? ' · ' + parts.join(' · ') : '';
      tl.title = '지운 군말(음·어·아)과 잘라 낸 말 사이 공백 · 자막 편집의 노란 표시를 누르면 되살립니다';
    }
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
    if (!SS.state.words?.length) { body.innerHTML = emptyStateHtml(); return; }
    SS.renderCaptionBlocks(body, SS.state.words, lines, segments);
    if (SS.markFineBlock && SS.state.trimOpen) SS.markFineBlock();
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


  // STT 원문·출력 자막을 두 번 누르면 그 자막의 시작·끝 미세 조정 (단어 글자 고치기는 F2·E 또는 출력 자막 칸)
  $('transcriptBody').addEventListener('dblclick', e => {
    const blk = e.target.closest && e.target.closest('.caption-block');
    if (!blk || e.target.closest('button, input[type=checkbox]')) return;
    if (e.target.closest('.caption-source') || e.target.classList.contains('caption-output')) { e.preventDefault(); SS.openFineTuneBlock(blk); }
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
    input.style.background = '#fff';
    input.style.color = '#0f172a';
    input.style.border = '1px solid #3b82f6';
    input.style.borderRadius = '6px';
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
    // 새로 음성 인식한 자막이면 군말·공백을 바로 지우고 표시한다 (설정에서 끌 수 있음)
    if (e.detail.autoTidy && SS.tidy && SS.autoTidyEnabled && SS.autoTidyEnabled()) setTimeout(() => SS.tidy({ auto: true }), 0);

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

  let lastUpdate = 0, wasPlaying = false, lastFollowScroll = 0;
  function playbackLoop() {
    requestAnimationFrame(playbackLoop);
    const playing = SS.preview && !SS.preview.paused;
    if (playing && !wasPlaying) SS.state.manualCaret = false; wasPlaying = playing;
    if (!SS.preview || SS.preview.paused || !SS.state.words || SS.state.words.length === 0) return;
    let t = SS.preview.currentTime;
    const outT = edl.srcToOut(segments, t);
    let curLine = outT == null ? null : lines.find(l => outT >= l.outStart && outT < l.outEnd);
    if ($('tplSubtitle')) $('tplSubtitle').textContent = curLine ? curLine.text : '';
    // 지운 부분 건너뛰기는 playback.js 가 맡는다
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
        if (r && wid >= r[0] && wid <= r[1]) color = (wid === SS.state.caret) ? 'rgba(37,99,235,.26)' : 'rgba(37,99,235,.14)';
        if (wid === SS.state.markI || wid === SS.state.markO) color = (r && wid >= r[0] && wid <= r[1]) ? 'rgba(245,158,11,.35)' : 'rgba(245,158,11,.22)';
        s.style.backgroundColor = color;
      });
      if (SS.state.caret !== -1 && followPlay) {
        const activeSpan = $('transcriptBody').querySelector(`span[data-wid="${SS.state.caret}"]`);
        if (activeSpan) {
           const rect = activeSpan.getBoundingClientRect(), parentRect = $('transcriptBody').getBoundingClientRect();
           // 화면 밖이면 따라간다. 멀리 떨어졌으면 바로(가운데로), 가까우면 부드럽게. 부드러운 이동은 끝날 틈을 준다
           if (rect.top < parentRect.top || rect.bottom > parentRect.bottom) {
             const far = rect.bottom < parentRect.top - parentRect.height || rect.top > parentRect.bottom + parentRect.height;
             if (far) { activeSpan.scrollIntoView({ block: 'center', behavior: 'auto' }); lastFollowScroll = performance.now(); }
             else if (performance.now() - lastFollowScroll > 450) { activeSpan.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); lastFollowScroll = performance.now(); }
           }
        }
      }
    }
  }
  requestAnimationFrame(playbackLoop);

  // 재생 중 자막 목록 따라가기. 사용자가 직접 스크롤(휠·스크롤 막대·PageUp/Down·터치)하면 따라가기를 멈추고
  // [재생 위치로] 단추를 띄운다. 다시 재생을 시작하거나 단추를 누르면 다시 따라간다.
  let followPlay = true;
  const followBtn = document.createElement('button');
  followBtn.id = 'btnFollowPlay'; followBtn.type = 'button';
  followBtn.className = 'btn sm follow-btn ico i-locate-fixed';
  followBtn.textContent = '재생 위치로';
  followBtn.title = '지금 재생 중인 자막으로 돌아가 다시 따라가기';
  followBtn.hidden = true;
  panel.appendChild(followBtn);
  function setFollow(on) {
    followPlay = !!on;
    followBtn.hidden = followPlay || !SS.preview || SS.preview.paused;
  }
  SS.setFollowPlay = setFollow;
  SS.isFollowPlay = () => followPlay;
  function userScrolled() { if (SS.preview && !SS.preview.paused && followPlay) setFollow(false); }
  const tbody = $('transcriptBody');
  tbody.addEventListener('wheel', userScrolled, { passive: true });
  tbody.addEventListener('touchmove', userScrolled, { passive: true });
  tbody.addEventListener('mousedown', e => { if (e.target === tbody && (e.offsetX >= tbody.clientWidth || e.offsetY >= tbody.clientHeight)) userScrolled(); });
  tbody.addEventListener('keydown', e => { if (e.key === 'PageUp' || e.key === 'PageDown') userScrolled(); });
  followBtn.addEventListener('click', () => {
    setFollow(true);
    const span = tbody.querySelector(`span[data-wid="${SS.state.caret}"]`);
    if (span) span.scrollIntoView({ block: 'center', behavior: 'auto' });
  });
  (function hookVideo() {
    const v = SS.preview && SS.preview.video;
    if (!v) { setTimeout(hookVideo, 100); return; }
    v.addEventListener('play', () => setFollow(true));
    v.addEventListener('pause', () => { followBtn.hidden = true; });
  })();

  // ================= 미세 조정 패널 =================
  // kind 'cut'  : 컷(두 구간 사이) — 왼쪽 A=앞 구간 끝, 오른쪽 B=뒤 구간 시작 (자막 목록의 가위 표시·T 키)
  // kind 'range': 자막 하나 — 왼쪽 B=자막 시작, 오른쪽 A=자막 끝 (STT 원문·출력 자막 더블클릭)
  //   자막 시작·끝이 이웃 말과 붙어 있으면(가운데 자막) 그 사이를 잘라야 움직일 수 있으므로,
  //   안쪽으로 당기면 그 자리에 컷을 만들고(fineCut 표시) 원래 자리로 돌려놓으면 컷을 없앤다.
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

  const isRange = () => !!trimState && trimState.kind === 'range';
  function prevLiveIdx(i) { const ws = SS.state.words; for (let k = i - 1; k >= 0; k--) if (!ws[k].del) return k; return -1; }
  function nextLiveIdx(i) { const ws = SS.state.words; for (let k = i + 1; k < ws.length; k++) if (!ws[k].del) return k; return -1; }
  function joinedBefore(a) { const ws = SS.state.words, p = prevLiveIdx(a); return p >= 0 && p === a - 1 && (!ws[a].cutBefore || !!ws[a].fineCut); }
  function joinedAfter(b) { const ws = SS.state.words, n = nextLiveIdx(b); return n >= 0 && n === b + 1 && (!ws[n].cutBefore || !!ws[n].fineCut); }
  function boundary(x, y) { const ws = SS.state.words, e = ws[x].end, s = ws[y].start; return e <= s ? (e + s) / 2 : s; }
  function leftHandle() { return isRange() ? 'B' : 'A'; }
  // 손잡이마다 화면에 보이는 시간 범위
  function viewOf(h) {
    const c = h === 'A' ? trimState.centerA : trimState.centerB;
    if (isRange()) return [c - 1.0, c + 1.0];
    return h === 'A' ? [c - 1.5, c + 0.5] : [c - 0.5, c + 1.5];
  }

  function trimHeader() {
    const title = $('trimTitle');
    if (!trimState || !title) return;
    if (isRange()) {
      const ws = SS.state.words, off = (SS.state.source && SS.state.source.offset) || 0;
      const li = lines.findIndex(l => l.words.includes(ws[trimState.idxB].id));
      title.textContent = (li >= 0 ? String(li + 1).padStart(3, '0') + '번 자막 ' : '자막 ') + '미세 조정 · ' + SS.fmtTime(SS.getBStart() + off) + ' ~ ' + SS.fmtTime(SS.getAEnd() + off);
      $('btnPrevCut').textContent = '이전 자막 ([)'; $('btnNextCut').textContent = '다음 자막 (])';
    } else {
      title.textContent = '컷 미세 조정 · 잘라 낸 길이 ' + Math.max(0, SS.getBStart() - SS.getAEnd()).toFixed(2) + '초';
      $('btnPrevCut').textContent = '이전 컷 ([)'; $('btnNextCut').textContent = '다음 컷 (])';
    }
    const h = trimState.activeHandle;
    $('trimHandleName').textContent = isRange() ? (h === 'B' ? '시작' : '끝') : (h === 'A' ? '앞 끝' : '뒤 시작');
  }

  // 조정 중인 자막이 패널에 가리면 그만큼만 올린다
  function ensureFineVisible() {
    if (!isRange()) return;
    const body = $('transcriptBody'), el = body.querySelector('.caption-block.fine-active');
    if (!el) return;
    const r = el.getBoundingClientRect(), pr = $('trimPanel').getBoundingClientRect(), br = body.getBoundingClientRect();
    if (r.bottom > pr.top - 8) body.scrollTop += Math.min(r.bottom - pr.top + 16, r.top - br.top - 8);
    else if (r.top < br.top) body.scrollTop -= br.top - r.top + 8;
  }
  function markFineBlock() {
    const body = $('transcriptBody');
    body.querySelectorAll('.caption-block.fine-active').forEach(el => el.classList.remove('fine-active'));
    if (!isRange()) return null;
    const i = trimState.idxB;
    const el = Array.from(body.querySelectorAll('.caption-block')).find(b => +b.dataset.from <= i && i < +b.dataset.to);
    if (el) el.classList.add('fine-active');
    return el;
  }
  SS.markFineBlock = markFineBlock;

  function showPanel() {
    SS.state.trimOpen = true;
    $('trimPanel').style.display = 'flex';
    $('transcriptBody').classList.add('trim-open');
  }

  async function openTrimPanel(idxA, idxB) {
    showPanel();
    trimState = { kind: 'cut', idxA, idxB, activeHandle: 'B' };
    trimBufA = null; trimBufB = null; trimPcmA = null; trimPcmB = null;
    stopLoop(); markFineBlock(); await fetchTrimBuffers(); renderTrim(); trimHeader();
  }
  SS.openTrimPanel = openTrimPanel;

  /** 자막(단어 a..b) 미세 조정 열기. 지운 단어는 빼고 남은 첫·끝 단어로 */
  async function openFineTune(a, b) {
    const ws = SS.state.words;
    a = Math.max(0, a); b = Math.min(ws.length - 1, b);
    while (a <= b && ws[a].del) a++;
    while (b >= a && ws[b].del) b--;
    if (a > b) { if (SS.toast) SS.toast('지운 구간이라 조정할 소리가 없습니다. 먼저 되살려 주세요.'); return false; }
    if (SS.flushCaptionEdit) SS.flushCaptionEdit(false);
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('caption-output')) { document.activeElement.blur(); $('transcriptBody').focus({ preventScroll: true }); }
    SS.preview.pause();
    showPanel();
    trimState = { kind: 'range', idxA: b, idxB: a, activeHandle: 'B' };
    trimBufA = null; trimBufB = null; trimPcmA = null; trimPcmB = null;
    stopLoop();
    markFineBlock(); ensureFineVisible();
    await fetchTrimBuffers(); renderTrim(); trimHeader(); ensureFineVisible();
    return true;
  }
  SS.openFineTune = openFineTune;
  /** 자막 목록의 n번째 묶음(caption-block) 미세 조정 */
  SS.openFineTuneBlock = (el) => el ? openFineTune(+el.dataset.from, +el.dataset.to - 1) : false;

  function closeTrimPanel() {
    $('trimPanel').style.display = 'none'; SS.state.trimOpen = false; trimState = null; stopLoop();
    $('transcriptBody').classList.remove('trim-open');
    markFineBlock();
  }
  $('btnCloseTrim').addEventListener('click', closeTrimPanel);
  SS.closeTrim = () => $('btnCloseTrim').click();

  function stepRange(dir) {
    const li = lines.findIndex(l => l.words.includes(SS.state.words[trimState.idxB].id));
    const next = lines[li + dir];
    if (!next) return;
    const ids = next.words.map(id => SS.state.words.findIndex(w => w.id === id)).filter(i => i >= 0);
    if (ids.length) openFineTune(Math.min(...ids), Math.max(...ids));
  }
  $('btnPrevCut').addEventListener('click', () => {
    if (!trimState) return;
    if (isRange()) { stepRange(-1); return; }
    const cuts = getCuts();
    const idx = cuts.findIndex(c => c.keyEnd === 'e:'+trimState.idxA && c.keyStart === 's:'+trimState.idxB);
    if (idx > 0) { const p = cuts[idx-1]; openTrimPanel(parseInt(p.keyEnd.split(':')[1]), parseInt(p.keyStart.split(':')[1])); }
  });
  SS.trimPrevCut = () => $('btnPrevCut').click();
  $('btnNextCut').addEventListener('click', () => {
    if (!trimState) return;
    if (isRange()) { stepRange(1); return; }
    const cuts = getCuts();
    const idx = cuts.findIndex(c => c.keyEnd === 'e:'+trimState.idxA && c.keyStart === 's:'+trimState.idxB);
    if (idx >= 0 && idx < cuts.length - 1) { const n = cuts[idx+1]; openTrimPanel(parseInt(n.keyEnd.split(':')[1]), parseInt(n.keyStart.split(':')[1])); }
  });
  SS.trimNextCut = () => $('btnNextCut').click();
  $('btnPreviewLoop').addEventListener('click', toggleLoop);
  SS.toggleTrimLoop = toggleLoop;
  $('trimPanel').querySelectorAll('[data-nudge]').forEach(btn => btn.addEventListener('click', () => {
    if (!trimState) return;
    const h = trimState.activeHandle;
    updateTrimValue(h, (h === 'A' ? SS.getAEnd() : SS.getBStart()) + Number(btn.dataset.nudge));
  }));
  $('btnTrimReset').addEventListener('click', () => SS.resetTrim());

  async function fetchTrimBuffers() {
    if (!trimState) return;
    const ws = SS.state.words, st = SS.state.settings;
    if (isRange()) {
      const a = trimState.idxB, b = trimState.idxA;
      trimState.centerB = joinedBefore(a) ? boundary(a - 1, a) : Math.max(0, ws[a].start - st.padBefore);
      trimState.centerA = joinedAfter(b) ? boundary(b, b + 1) : ws[b].end + st.padAfter;
    } else {
      trimState.centerA = ws[trimState.idxA].end + st.padAfter;
      trimState.centerB = ws[trimState.idxB].start - st.padBefore;
    }
    trimBufA = await window.api.getPcm(SS.state.path, trimState.centerA - 2, trimState.centerA + 2, 48000);
    trimBufB = await window.api.getPcm(SS.state.path, trimState.centerB - 2, trimState.centerB + 2, 48000);
    trimPcmA = new Float32Array(trimBufA); trimPcmB = new Float32Array(trimBufB);
  }
  SS.getAEnd = () => (typeof SS.state.overrides['e:' + trimState.idxA] === 'number' ? SS.state.overrides['e:' + trimState.idxA] : trimState.centerA);
  SS.getBStart = () => (typeof SS.state.overrides['s:' + trimState.idxB] === 'number' ? SS.state.overrides['s:' + trimState.idxB] : trimState.centerB);

  // 자막 미세 조정: 시작(B)·끝(A) 값을 넣는다. 이웃 말과 붙어 있으면 안쪽으로 당길 때만 컷을 만든다
  function setRangeValue(handle, val) {
    const ws = SS.state.words, ov = SS.state.overrides;
    if (handle === 'B') {
      const a = trimState.idxB;
      if (joinedBefore(a)) {
        const p = a - 1, nat = trimState.centerB;
        if (val > nat + 0.004) { ws[a].cutBefore = true; ws[a].fineCut = true; ov['e:' + ws[p].id] = nat; ov['s:' + ws[a].id] = val; }
        else { if (ws[a].fineCut) { ws[a].cutBefore = false; delete ws[a].fineCut; delete ov['e:' + ws[p].id]; } delete ov['s:' + ws[a].id]; }
      } else ov['s:' + ws[a].id] = Math.max(0, val);
    } else {
      const b = trimState.idxA;
      if (joinedAfter(b)) {
        const n = b + 1, nat = trimState.centerA;
        if (val < nat - 0.004) { ws[n].cutBefore = true; ws[n].fineCut = true; ov['s:' + ws[n].id] = nat; ov['e:' + ws[b].id] = val; }
        else { if (ws[n].fineCut) { ws[n].cutBefore = false; delete ws[n].fineCut; delete ov['s:' + ws[n].id]; } delete ov['e:' + ws[b].id]; }
      } else ov['e:' + ws[b].id] = val;
    }
  }
  function updateTrimValue(handle, val) {
    if (!trimState || !isFinite(val)) return;
    if (isRange()) {
      // 시작은 끝보다 0.05초 앞, 끝은 시작보다 0.05초 뒤까지만
      if (handle === 'B') val = Math.min(val, SS.getAEnd() - 0.05); else val = Math.max(val, SS.getBStart() + 0.05);
      setRangeValue(handle, val);
    } else if (handle === 'A') SS.state.overrides['e:' + trimState.idxA] = val; else SS.state.overrides['s:' + trimState.idxB] = val;
    if (!dragging) { pushHistory(); createAfterTrim(); } else updateOutput();
    renderTrim(); trimHeader();
    if (loopPlaying) { stopLoop(); startLoop(); }
  }
  SS.updateTrimValue = updateTrimValue;
  // 자막 목록도 새로 (가위 표시·시간 바뀜). 미세 조정 중인 자막 표시는 유지
  function createAfterTrim() { updateOutput(); createTranscriptDOMFull(); markFineBlock(); ensureFineVisible(); }
  SS.snapTrim = (mode) => {
    if (!trimState || !trimPcmA || !trimPcmB) return;
    let handle = trimState.activeHandle, pcm = handle === 'A' ? trimPcmA : trimPcmB, center = handle === 'A' ? trimState.centerA : trimState.centerB, t = handle === 'A' ? SS.getAEnd() : SS.getBStart();
    let offset = t - (center - 2), newOffset = edl.snap(pcm, 48000, offset, mode, 0.05);
    updateTrimValue(handle, (center - 2) + newOffset);
  };
  SS.resetTrim = () => {
    if (!trimState) return;
    const h = trimState.activeHandle;
    if (isRange()) { setRangeValue(h, h === 'A' ? trimState.centerA : trimState.centerB); }
    else if (h === 'A') delete SS.state.overrides['e:' + trimState.idxA]; else delete SS.state.overrides['s:' + trimState.idxB];
    pushHistory(); createAfterTrim(); renderTrim(); trimHeader();
    if (loopPlaying) { stopLoop(); startLoop(); }
  };
  SS.switchTrimHandle = (h) => {
    if (!trimState) return;
    // 숫자 1·2 는 화면의 왼쪽·오른쪽 (자막 미세 조정은 왼쪽이 시작)
    if (h && isRange()) h = h === 'A' ? 'B' : 'A';
    trimState.activeHandle = h || (trimState.activeHandle === 'A' ? 'B' : 'A');
    renderTrim(); trimHeader();
  };
  let dragging = false;
  $('trimCanvas').addEventListener('mousedown', e => {
    if (!trimState) return;
    const rect = e.target.getBoundingClientRect(), x = e.clientX - rect.left, w = rect.width;
    const left = leftHandle();
    trimState.activeHandle = x < w / 2 ? left : (left === 'A' ? 'B' : 'A');
    dragging = true; handleDrag(e);
  });
  function handleDrag(e) {
    if (!dragging || !trimState) return;
    const rect = $('trimCanvas').getBoundingClientRect(), x = e.clientX - rect.left, w = rect.width;
    const h = trimState.activeHandle, onLeft = h === leftHandle();
    const [minT, maxT] = viewOf(h);
    const p = Math.max(0, Math.min(1, (x - (onLeft ? 0 : w / 2)) / (w / 2)));
    updateTrimValue(h, minT + p * (maxT - minT));
  }
  window.addEventListener('mousemove', handleDrag);
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; pushHistory(); if (trimState) { createAfterTrim(); renderTrim(); trimHeader(); } } });

  // 미리듣기: 컷은 앞 2초+뒤 2초를 이어서 반복, 자막은 편집 결과로 앞뒤 조금 붙여 재생
  function fineRangeOut() {
    const segs = segments, ws = SS.state.words;
    const s = edl.srcToOut(segs, SS.getBStart() + 0.002), e = edl.srcToOut(segs, SS.getAEnd() - 0.002);
    const a = s != null ? s : (edl.srcToOut(segs, ws[trimState.idxB].start) || 0);
    const b = e != null ? e : (edl.srcToOut(segs, ws[trimState.idxA].end) || a);
    return { from: a, to: Math.max(a, b) };
  }
  SS.fineRangeOut = () => (isRange() ? fineRangeOut() : null);
  async function toggleLoop() {
    if (isRange()) {
      if (!SS.preview.paused) { SS.preview.pause(); return; }
      const r = fineRangeOut();
      if (SS.playback) SS.playback.playOutRange(r.from - 1.0, r.to + 0.8);
      requestAnimationFrame(renderTrim);
      return;
    }
    if (loopPlaying) stopLoop(); else startLoop();
  }
  function stopLoop() { loopPlaying = false; if (trimSourceA) { try { trimSourceA.stop(); } catch(e){} trimSourceA = null; } if (trimSourceB) { try { trimSourceB.stop(); } catch(e){} trimSourceB = null; } }
  async function startLoop() {
    if (isRange()) return;
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
    if (!w || !h) return;
    canvas.width = w * window.devicePixelRatio; canvas.height = h * window.devicePixelRatio; ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, w, h);
    const range = isRange();
    let endA = SS.getAEnd(), startB = SS.getBStart();
    function drawPane(pcm, handle, xOffset, width) {
      const isA = handle === 'A';
      const [minT, maxT] = viewOf(handle);
      const bufStart = (isA ? trimState.centerA : trimState.centerB) - 2, sp = 48000;
      const X = t => xOffset + ((t - minT) / (maxT - minT)) * width;
      // 남는 곳(초록)·잘려 나가는 곳(빨강): 지금 편집 결과의 구간 그대로
      ctx.fillStyle = '#fdecec'; ctx.fillRect(xOffset, 0, width, h);
      ctx.fillStyle = '#e8f6ee';
      segments.forEach(s => { const a = Math.max(minT, s.start), b = Math.min(maxT, s.end); if (b > a) ctx.fillRect(X(a), 0, X(b) - X(a), h); });
      let samplesPerPixel = (maxT - minT) * sp / width; ctx.beginPath(); ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1;
      for (let px = 0; px < width; px++) {
        let t = minT + (px / width) * (maxT - minT), sIdx = Math.floor((t - bufStart) * sp);
        if (sIdx >= 0 && sIdx < pcm.length) {
          let chunk = Math.max(1, Math.floor(samplesPerPixel)), minV = 0, maxV = 0;
          for (let j = 0; j < chunk && sIdx + j < pcm.length; j++) { let v = pcm[sIdx + j]; if (v < minV) minV = v; if (v > maxV) maxV = v; }
          ctx.moveTo(xOffset + px, h/2 - maxV * (h/2)); ctx.lineTo(xOffset + px, h/2 - minV * (h/2));
        }
      }
      ctx.stroke(); ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textBaseline = 'top';
      let startTick = Math.ceil(minT * 10) / 10; for (let tk = startTick; tk < maxT; tk += 0.1) { let x = X(tk); ctx.fillRect(x, h - 15, 1, 15); if (Math.abs(Math.round(tk * 10) % 5) === 0) ctx.fillText(tk.toFixed(1), x + 2, h - 15); }
      // 단어 이름과 시작선 (지운 단어는 흐리게)
      const ws = SS.state.words;
      const from = Math.max(0, (isA ? trimState.idxA : trimState.idxB) - 6), to = Math.min(ws.length - 1, (isA ? trimState.idxA : trimState.idxB) + 6);
      ctx.font = '12px sans-serif';
      for (let i = from; i <= to; i++) {
        if (!ws[i] || ws[i].start < minT || ws[i].start > maxT) continue;
        const wx = X(ws[i].start);
        ctx.fillStyle = ws[i].del ? '#d46a6a' : '#0f172a'; ctx.fillText(ws[i].text, wx + 2, 6 + (i % 2) * 14);
        ctx.fillStyle = '#cbd5e1'; ctx.fillRect(wx, 22, 1, h / 2 - 22);
      }
      const handleT = isA ? endA : startB, hx = X(handleT), isActive = trimState.activeHandle === handle;
      ctx.strokeStyle = isActive ? '#2563eb' : '#94a3b8'; ctx.lineWidth = isActive ? 3 : 2; ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke();
      const delta = handleT - (isA ? trimState.centerA : trimState.centerB);
      const name = range ? (isA ? '끝' : '시작') : (isA ? '앞 끝' : '뒤 시작');
      const label = `${name} ${handleT.toFixed(3)}초 (자동 대비 ${delta > 0 ? '+' : ''}${delta.toFixed(3)})`;
      ctx.font = '11px sans-serif'; const lw = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(15,27,51,0.86)'; ctx.fillRect(xOffset + 8, h - 40, lw, 20); ctx.fillStyle = isActive ? '#bfdbfe' : '#fff'; ctx.fillText(label, xOffset + 14, h - 35);
    }
    const left = leftHandle(), right = left === 'A' ? 'B' : 'A';
    drawPane(left === 'A' ? trimPcmA : trimPcmB, left, 0, w / 2);
    ctx.fillStyle = '#cbd5e1'; ctx.fillRect(w/2 - 1, 0, 2, h);
    drawPane(right === 'A' ? trimPcmA : trimPcmB, right, w / 2, w / 2);
    if (loopPlaying && actCtx) {
      const [aMin, aMax] = viewOf('A'), [bMin, bMax] = viewOf('B');
      let elap = actCtx.currentTime - loopStartTime, px = 0, aDur = 2.0;
      if (elap < aDur) { let curA = (endA - 2) + elap; px = ((curA - aMin) / (aMax - aMin)) * (w/2); }
      else { let curB = startB + (elap - aDur); px = w/2 + ((curB - bMin) / (bMax - bMin)) * (w/2); }
      ctx.fillStyle = '#f59e0b'; ctx.fillRect(px - 1, 0, 2, h); requestAnimationFrame(renderTrim);
    } else if (range && SS.preview && !SS.preview.paused) {
      // 자막 미리듣기 중: 영상 재생 위치를 노란 선으로
      const t = SS.preview.currentTime;
      [[left, 0], [right, w / 2]].forEach(([hd, xo]) => { const [mn, mx] = viewOf(hd); if (t >= mn && t <= mx) { ctx.fillStyle = '#f59e0b'; ctx.fillRect(xo + ((t - mn) / (mx - mn)) * (w / 2) - 1, 0, 2, h); } });
      requestAnimationFrame(renderTrim);
    }
  }

  let findQuery = '', findMatches = [], findIdx = -1;
  SS.openFindBar = () => {
    let bar = $('findBar'); if (!bar) {
      bar = document.createElement('div'); bar.id = 'findBar'; bar.style.cssText = 'padding:8px 10px; background:var(--panel2); border:1px solid var(--border); border-radius:12px; display:flex; gap:8px; align-items:center;';
      bar.innerHTML = `<span style="font-size:12px; font-weight:600; color:var(--muted);">찾기</span><input type="text" id="inpFind" style="flex:1; height:30px;"><span id="lblFindCount" style="font-size:11.5px; color:var(--muted);">0/0</span><button id="btnFindPrev" class="btn sm">이전</button><button id="btnFindNext" class="btn sm">다음</button><button id="btnFindClose" class="btn sm">닫기</button>`;
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
    if (activeSpan) { activeSpan.scrollIntoView({ block: 'center', behavior: 'smooth' }); const spans = $('transcriptBody').querySelectorAll('span[data-wid]'); spans.forEach(s => { const swid = parseInt(s.dataset.wid); if (findMatches.includes(swid)) s.style.border = (swid === wid) ? '2px solid #2563eb' : '1px solid #93b4f5'; else s.style.border = 'none'; }); }
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
