/**
 * SermonShorts Keyboard Shortcut System
 * Centralized key bindings and global listener.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory();
  } else {
    root.SS = root.SS || {};
    root.SS.Keymap = factory();
  }
}(this, function () {
  'use strict';

  const SS = window.SS || {};

  const DEFAULT_BINDINGS = [
    { id: 'play_toggle', keys: ['Space'], mode: 'global', label: '재생/정지', group: '재생' },
    { id: 'play_raw', keys: ['Shift+Space'], mode: 'global', label: '원본 재생/정지', group: '재생' },
    { id: 'stop', keys: ['k', 'K'], mode: 'global', label: '정지', group: '재생' },
    { id: 'seek_backward_2s', keys: ['j', 'J'], mode: 'global', label: '2초 뒤로', group: '재생' },
    { id: 'seek_forward_2s', keys: ['l', 'L'], mode: 'global', label: '2초 앞으로', group: '재생' },
    { id: 'seek_backward_5s', keys: ['Shift+J'], mode: 'global', label: '5초 뒤로', group: '재생' },
    { id: 'seek_forward_5s', keys: ['Shift+L'], mode: 'global', label: '5초 앞으로', group: '재생' },
    { id: 'frame_prev', keys: [','], mode: 'global', label: '1프레임 뒤로', group: '재생' },
    { id: 'frame_next', keys: ['.'], mode: 'global', label: '1프레임 앞으로', group: '재생' },
    { id: 'step_10ms_prev', keys: ['Shift+,'], mode: 'global', label: '10ms 뒤로', group: '재생' },
    { id: 'step_10ms_next', keys: ['Shift+.'], mode: 'global', label: '10ms 앞으로', group: '재생' },
    { id: 'seek_home', keys: ['Home', 'Shift+Home', 'Ctrl+Home', 'Ctrl+Shift+Home'], mode: 'editor', label: '줄 처음으로', group: '재생' },
    { id: 'seek_end', keys: ['End', 'Shift+End', 'Ctrl+End', 'Ctrl+Shift+End'], mode: 'editor', label: '줄 끝으로', group: '재생' },
    { id: 'word_prev', keys: ['ArrowLeft'], mode: 'editor', label: '이전 단어', group: '이동' },
    { id: 'word_next', keys: ['ArrowRight'], mode: 'editor', label: '다음 단어', group: '이동' },
    { id: 'para_prev', keys: ['ArrowUp'], mode: 'editor', label: '윗줄', group: '이동' },
    { id: 'para_next', keys: ['ArrowDown'], mode: 'editor', label: '아랫줄', group: '이동' },
    { id: 'extend_sel_left', keys: ['Shift+ArrowLeft'], mode: 'editor', label: '선택 넓히기(좌)', group: '이동' },
    { id: 'extend_sel_right', keys: ['Shift+ArrowRight'], mode: 'editor', label: '선택 넓히기(우)', group: '이동' },
    { id: 'extend_sel_para_prev', keys: ['Shift+ArrowUp'], mode: 'editor', label: '선택 넓히기(상)', group: '이동' },
    { id: 'extend_sel_para_next', keys: ['Shift+ArrowDown'], mode: 'editor', label: '선택 넓히기(하)', group: '이동' },
    { id: 'select_all', keys: ['Ctrl+A'], mode: 'editor', label: '전체 선택', group: '이동' },
    { id: 'find_bar', keys: ['Ctrl+F'], mode: 'editor', label: '찾기', group: '이동' },
    { id: 'delete_back', keys: ['Backspace'], mode: 'editor', label: '앞 지우기', group: '편집' },
    { id: 'delete_fwd', keys: ['d', 'D', 'Delete'], mode: 'editor', label: '뒤 지우기', group: '편집' },
    { id: 'delete_sent_back', keys: ['Ctrl+Backspace'], mode: 'editor', label: '앞 문장 끝까지 지우기', group: '편집' },
    { id: 'delete_sent_fwd', keys: ['Ctrl+Delete'], mode: 'editor', label: '뒤 문장 끝까지 지우기', group: '편집' },
    { id: 'restore', keys: ['r', 'R'], mode: 'editor', label: '되살리기', group: '편집' },
    { id: 'toggle_hide', keys: ['h', 'H'], mode: 'editor', label: '지운 부분 숨기기', group: '편집' },
    { id: 'mark_in', keys: ['i', 'I'], mode: 'editor', label: '시작점 설정', group: '편집' },
    { id: 'mark_out', keys: ['o', 'O'], mode: 'editor', label: '끝점 설정', group: '편집' },
    { id: 'keep_selection', keys: ['Ctrl+K'], mode: 'editor', label: '선택만 남기기', group: '편집' },
    { id: 'cut_before_toggle', keys: ['x', 'X'], mode: 'editor', label: '앞에서 끊기', group: '편집' },
    { id: 'br_toggle', keys: ['Enter'], mode: 'editor', label: '줄바꿈 토글', group: '편집' },
    { id: 'edit_word', keys: ['e', 'E', 'F2'], mode: 'editor', label: '단어 수정', group: '편집' },
    { id: 'undo', keys: ['Ctrl+Z'], mode: 'global', label: '실행 취소', group: '편집' },
    { id: 'redo', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], mode: 'global', label: '다시 실행', group: '편집' },
    { id: 'auto_clean', keys: ['Ctrl+Shift+C'], mode: 'editor', label: '자동 정리', group: '편집' },
    { id: 'ai_term_correct', keys: ['Ctrl+Shift+T'], mode: 'editor', label: 'AI 용어 교정', group: '편집' },
    { id: 'cut_prev', keys: ['['], mode: 'editor', label: '이전 컷 이동', group: '컷' },
    { id: 'cut_next', keys: [']'], mode: 'editor', label: '다음 컷 이동', group: '컷' },
    { id: 'trim_open', keys: ['t', 'T'], mode: 'editor', label: '트림 패널 열기', group: '컷' },
    { id: 'file_save', keys: ['Ctrl+S'], mode: 'global', label: '프로젝트 저장', group: '파일' },
    { id: 'file_save_as', keys: ['Ctrl+Shift+S'], mode: 'global', label: '다른 이름으로 저장', group: '파일' },
    { id: 'file_open', keys: ['Ctrl+O'], mode: 'global', label: '프로젝트 열기', group: '파일' },
    { id: 'file_open_video', keys: ['Ctrl+Shift+O'], mode: 'global', label: '영상 파일 열기', group: '파일' },
    { id: 'file_import_yt', keys: ['Ctrl+U'], mode: 'global', label: '유튜브 가져오기', group: '파일' },
    { id: 'ai_recommend', keys: ['Ctrl+Shift+U'], mode: 'global', label: 'AI 추천', group: '파일' },
    { id: 'file_export', keys: ['Ctrl+E'], mode: 'global', label: '내보내기', group: '파일' },
    { id: 'settings_open', keys: ['Ctrl+,'], mode: 'global', label: '설정', group: '파일' },
    { id: 'help', keys: ['F1', '?'], mode: 'global', label: '도움말', group: '파일' },
    { id: 'trim_step_prev', keys: ['ArrowLeft'], mode: 'trim', label: '1프레임 이동', group: '트림' },
    { id: 'trim_step_next', keys: ['ArrowRight'], mode: 'trim', label: '1프레임 이동', group: '트림' },
    { id: 'trim_step_10ms_prev', keys: ['Shift+ArrowLeft'], mode: 'trim', label: '10ms 이동', group: '트림' },
    { id: 'trim_step_10ms_next', keys: ['Shift+ArrowRight'], mode: 'trim', label: '10ms 이동', group: '트림' },
    { id: 'trim_step_1ms_prev', keys: ['Alt+ArrowLeft'], mode: 'trim', label: '1ms 이동', group: '트림' },
    { id: 'trim_step_1ms_next', keys: ['Alt+ArrowRight'], mode: 'trim', label: '1ms 이동', group: '트림' },
    { id: 'trim_handle_switch', keys: ['Tab', '1', '2'], mode: 'trim', label: '손잡이 전환', group: '트림' },
    { id: 'trim_loop_toggle', keys: ['Space'], mode: 'trim', label: '반복 재생', group: '트림' },
    { id: 'trim_snap_silence', keys: ['s', 'S'], mode: 'trim', label: '무음 지점 스냅', group: '트림' },
    { id: 'trim_snap_zero', keys: ['Alt+s', 'Alt+S'], mode: 'trim', label: '제로 크로싱 스냅', group: '트림' },
    { id: 'trim_reset', keys: ['r', 'R'], mode: 'trim', label: '초기화', group: '트림' },
    { id: 'trim_cut_prev', keys: ['['], mode: 'trim', label: '이전 컷', group: '트림' },
    { id: 'trim_cut_next', keys: [']'], mode: 'trim', label: '다음 컷', group: '트림' },
    { id: 'trim_confirm', keys: ['Enter'], mode: 'trim', label: '확인 및 닫기', group: '트림' },
    { id: 'trim_cancel', keys: ['Escape'], mode: 'trim', label: '취소 및 닫기', group: '트림' },
  ];

  class Keymap {
    constructor() {
      this.bindings = DEFAULT_BINDINGS.slice();
      this.handlers = {};
      this.overrides = {};
    }
    init(overrides) {
      this.overrides = overrides || {};
      window.addEventListener('keydown', this.onKeyDown.bind(this), true);
    }
    setHandler(id, fn) { this.handlers[id] = fn; }
    normalize(e) {
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');
      let key = e.key;
      if (e.code && /^(Key[A-Z]|Digit[0-9]|Comma|Period|BracketLeft|BracketRight|Slash|Equal|Minus|Semicolon|Quote|Backquote)$/.test(e.code)) {
        if (e.code.indexOf('Key') === 0) key = e.code.slice(3);
        else if (e.code.indexOf('Digit') === 0) key = e.code.slice(5);
        else if (e.code === 'Comma') key = ',';
        else if (e.code === 'Period') key = '.';
        else if (e.code === 'BracketLeft') key = '[';
        else if (e.code === 'BracketRight') key = ']';
        else if (e.code === 'Slash') key = '/';
      }
      if (key === ' ') key = 'Space';
      if (key.length === 1) key = key.toUpperCase();
      return { mods: parts.join('+'), key: key, code: e.code };
    }
    match(e) {
      const norm = this.normalize(e);
      let mode = 'editor';
      if (SS.state && SS.state.trimOpen) mode = 'trim';
      else if (SS.state && SS.state.dialogOpen) mode = 'dialog';
      for (let i = 0; i < this.bindings.length; i++) {
        const b = this.bindings[i];
        if (b.mode !== 'global' && b.mode !== mode) continue;
        const keys = this.overrides[b.id] || b.keys;
        for (let j = 0; j < keys.length; j++) {
          if (this.keyMatches(keys[j], norm.mods, norm.key, norm.code)) return b;
        }
      }
      return null;
    }
    keyMatches(k, mods, key, code) {
      const parts = k.split('+');
      const kKey = parts.pop();
      const kMods = parts.join('+');
      if (mods !== kMods) return false;
      if (key.toLowerCase() === kKey.toLowerCase()) return true;
      if (kKey === 'Space' && key === ' ') return true;
      const codeMap = { 'J': 'KeyJ', 'K': 'KeyK', 'L': 'KeyL', 'I': 'KeyI', 'O': 'KeyO', 'D': 'KeyD', 'X': 'KeyX', 'T': 'KeyT', 'S': 'KeyS', 'R': 'KeyR', 'E': 'KeyE', ',': 'Comma', '.': 'Period', '[': 'BracketLeft', ']': 'BracketRight', '/': 'Slash' };
      if (codeMap[kKey.toUpperCase()] === code) return true;
      if (kKey.indexOf('Digit') === 0 && code === kKey) return true;
      if (kKey === 'Enter' && (code === 'Enter' || code === 'NumpadEnter')) return true;
      return false;
    }
    onKeyDown(e) {
      // 대화상자(구간 고르기 등)가 열려 있으면 전역 단축키는 쉬고, 대화상자가 자기 키를 처리한다
      if (SS.state && SS.state.dialogOpen) return;
      if (e.target?.dataset?.inlineEdit) return;
      const tag = (e.target && e.target.tagName) || '';
      const isInput = (tag === 'INPUT' && e.target.type !== 'range') || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
      const b = this.match(e);
      if (!b) return;
      if (isInput) {
        const allow = ['help', 'file_save', 'trim_confirm', 'trim_cancel'];
        if (allow.indexOf(b.id) === -1 && e.key !== 'Escape') return;
      }
      if (this.handlers[b.id]) {
        e.preventDefault(); e.stopPropagation();
        this.handlers[b.id](e);
      }
    }
    
    formatKeyString(k) {
      return k.replace(/ArrowLeft/g, '←').replace(/ArrowRight/g, '→').replace(/ArrowUp/g, '↑').replace(/ArrowDown/g, '↓');
    }

    getDisplayKeys(b) {
      const keys = this.overrides[b.id] || b.keys;
      const seen = {};
      const result = [];
      keys.forEach(k => {
        let display = this.formatKeyString(k);
        if (display.length === 1) display = display.toUpperCase();
        let norm = display.toUpperCase();
        if (!seen[norm]) {
          seen[norm] = true;
          result.push(display);
        }
      });
      if (b.id === 'redo' && result.length >= 2) {
         return result[0] + ' / ' + result[1];
      }
      return result.join(', ');
    }

    getTooltips() {
      const tips = {};
      for (let i = 0; i < this.bindings.length; i++) {
        const b = this.bindings[i];
        tips[b.id] = b.label + ' (' + this.getDisplayKeys(b).split(', ')[0] + ')';
      }
      return tips;
    }
  }
  return new Keymap();
}));

(function() {
  const SS = window.SS;
  SS.initKeymap = function (overrides) {
    const keymap = SS.Keymap; keymap.init(overrides);
    const $ = (id) => document.getElementById(id);
    const preview = SS.preview;
    function showHelp() {
      let modal = $('keyhelpModal');
      if (!modal) {
        modal = document.createElement('div'); modal.id = 'keyhelpModal'; modal.className = 'modal-overlay'; modal.style.zIndex = '2000';
        modal.innerHTML = '<div class="modal-dialog" style="max-width: 800px; width: 90%; max-height: 85vh; display: flex; flex-direction: column; padding: 15px;"><div class="modal-header" style="margin-bottom: 10px;"><h3>단축키 도움말</h3><button class="modal-close">&times;</button></div><div class="modal-body" id="keyhelpBody" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px 30px; overflow-y: auto; flex: 1; padding-right: 10px;"></div></div>';
        document.body.appendChild(modal);
        modal.querySelector('.modal-close').onclick = function() { modal.classList.add('hidden'); };
        modal.onclick = function(e) { if (e.target === modal) modal.classList.add('hidden'); };
      }
      const body = $('keyhelpBody'), groups = {};
      keymap.bindings.forEach(function(b) { if (!groups[b.group]) groups[b.group] = []; groups[b.group].push(b); });
      let html = '';
      const groupOrder = ['재생', '이동', '편집', '컷', '파일', '트림'];
      groupOrder.forEach(function(g) {
        if (!groups[g]) return;
        let rows = '';
        groups[g].forEach(function(b) { rows += '<tr><td style="color: #aaa; padding: 2px 0;">' + b.label + '</td><td style="text-align: right; font-family: monospace;">' + keymap.getDisplayKeys(b) + '</td></tr>'; });
        html += '<div style="margin-bottom: 15px;"><h4 style="border-bottom: 1px solid #444; padding-bottom: 4px; margin-bottom: 8px; color: #39FF5A;">' + g + '</h4><table style="width: 100%; font-size: 13px;">' + rows + '</table></div>';
      });
      body.innerHTML = html; modal.classList.remove('hidden');
    }
    keymap.setHandler('play_toggle', function() { preview.toggle(); });
    keymap.setHandler('play_raw', function() { SS.setEditedPlayMode(false); preview.toggle(); });
    keymap.setHandler('stop', function() { preview.pause(); });
    keymap.setHandler('seek_backward_2s', function(e) { preview.seek(preview.currentTime - (e.shiftKey ? 5 : 2)); });
    keymap.setHandler('seek_forward_2s', function(e) { preview.seek(preview.currentTime + (e.shiftKey ? 5 : 2)); });
    keymap.setHandler('seek_backward_5s', function() { preview.seek(preview.currentTime - 5); });
    keymap.setHandler('seek_forward_5s', function() { preview.seek(preview.currentTime + 5); });
    keymap.setHandler('frame_prev', function() { preview.stepFrames(-1); });
    keymap.setHandler('frame_next', function() { preview.stepFrames(1); });
    keymap.setHandler('step_10ms_prev', function() { preview.stepSeconds(-0.01); });
    keymap.setHandler('step_10ms_next', function() { preview.stepSeconds(0.01); });
    keymap.setHandler('seek_home', function(e) { SS.moveLine(-1,e.shiftKey,true,e.ctrlKey||e.metaKey); });
    keymap.setHandler('seek_end', function(e) { SS.moveLine(1,e.shiftKey,true,e.ctrlKey||e.metaKey); });
    keymap.setHandler('word_prev', function() { SS.moveCursor(-1); });
    keymap.setHandler('word_next', function() { SS.moveCursor(1); });
    keymap.setHandler('para_prev', function() { SS.movePara(-1); });
    keymap.setHandler('para_next', function() { SS.movePara(1); });
    keymap.setHandler('extend_sel_left', function() { SS.moveCursor(-1, true); });
    keymap.setHandler('extend_sel_right', function() { SS.moveCursor(1, true); });
    keymap.setHandler('extend_sel_para_prev', function() { SS.movePara(-1, true); });
    keymap.setHandler('extend_sel_para_next', function() { SS.movePara(1, true); });
    keymap.setHandler('select_all', function() { SS.state.selAnchor = 0; SS.state.caret = SS.state.words.length; SS.state.selection = [0, SS.state.caret]; SS.renderTranscript(); });
    keymap.setHandler('find_bar', function() { if (SS.openFindBar) SS.openFindBar(); });
    keymap.setHandler('delete_back', function() { SS.handleDelete(-1, false); });
    keymap.setHandler('delete_fwd', function() { SS.handleDelete(1, false); });
    keymap.setHandler('delete_sent_back', function() { SS.handleDelete(-1, true); });
    keymap.setHandler('delete_sent_fwd', function() { SS.handleDelete(1, true); });
    keymap.setHandler('restore', function() { SS.handleRestore(); });
    keymap.setHandler('toggle_hide', function() { SS.toggleHideDeleted(); });
    keymap.setHandler('mark_in', function() { SS.markIn(); });
    keymap.setHandler('mark_out', function() { SS.markOut(); });
    keymap.setHandler('keep_selection', function() { SS.keepSelection(); });
    keymap.setHandler('cut_before_toggle', function() { SS.toggleCutBefore(); });
    keymap.setHandler('br_toggle', function() { SS.toggleBr(); });
    keymap.setHandler('edit_word', function() { SS.editWord(-1); });
    keymap.setHandler('undo', function() { SS.undo(); });
    keymap.setHandler('redo', function() { SS.redo(); });
    keymap.setHandler('auto_clean', function() { const b = $('btnAutoClean'); if (b) b.click(); });
    keymap.setHandler('ai_term_correct', function() { const b = $('btnAiCorrect'); if (b) b.click(); });
    keymap.setHandler('cut_prev', function() { const cuts = SS.getCuts(), curT = preview.currentTime; let prev = null; for(let i=cuts.length-1; i>=0; i--) if (SS.state.words[cuts[i].a].start < curT - 0.5) { prev = cuts[i]; break; } if (prev) preview.seek(SS.state.words[prev.a].start); });
    keymap.setHandler('cut_next', function() { const cuts = SS.getCuts(), curT = preview.currentTime; let next = null; for(let i=0; i<cuts.length; i++) if (SS.state.words[cuts[i].a].start > curT + 0.5) { next = cuts[i]; break; } if (next) preview.seek(SS.state.words[next.a].start); });
    keymap.setHandler('trim_open', function() { const cuts = SS.getCuts(), curT = preview.currentTime; let best = null, minDist = Infinity; cuts.forEach(function(c) { const d = Math.abs(SS.state.words[c.a].start - curT); if (d < minDist) { minDist = d; best = c; } }); if (best) SS.openTrimPanel(best.a, best.b); });
    keymap.setHandler('file_save', function() { const b = $('btnSave'); if (b) b.click(); });
    keymap.setHandler('file_save_as', function() { if (SS.saveProjectAs) SS.saveProjectAs(); });
    keymap.setHandler('file_open', function() { const b = $('btnOpenProject'); if (b) b.click(); });
    keymap.setHandler('file_open_video', function() { const b = $('btnOpen'); if (b) b.click(); });
    keymap.setHandler('file_import_yt', function() { if (SS.openYoutubeImport) SS.openYoutubeImport(); });
    keymap.setHandler('ai_recommend', function() { const b = $('btnAiRecommend'); if (b) b.click(); });
    keymap.setHandler('file_export', function() { const b = $('btnExport'); if (b) b.click(); });
    keymap.setHandler('settings_open', function() { const b = $('btnSettings'); if (b) b.click(); });
    keymap.setHandler('help', function() { const m = $('keyhelpModal'); if (m && !m.classList.contains('hidden')) m.classList.add('hidden'); else showHelp(); });
    keymap.setHandler('trim_step_prev', function() { SS.updateTrimValue(SS.getTrimState().activeHandle, (SS.getTrimState().activeHandle === 'A' ? SS.getAEnd() : SS.getBStart()) - 1 / (preview.fps || 30)); });
    keymap.setHandler('trim_step_next', function() { SS.updateTrimValue(SS.getTrimState().activeHandle, (SS.getTrimState().activeHandle === 'A' ? SS.getAEnd() : SS.getBStart()) + 1 / (preview.fps || 30)); });
    keymap.setHandler('trim_step_10ms_prev', function() { SS.updateTrimValue(SS.getTrimState().activeHandle, (SS.getTrimState().activeHandle === 'A' ? SS.getAEnd() : SS.getBStart()) - 0.01); });
    keymap.setHandler('trim_step_10ms_next', function() { SS.updateTrimValue(SS.getTrimState().activeHandle, (SS.getTrimState().activeHandle === 'A' ? SS.getAEnd() : SS.getBStart()) + 0.01); });
    keymap.setHandler('trim_step_1ms_prev', function() { SS.updateTrimValue(SS.getTrimState().activeHandle, (SS.getTrimState().activeHandle === 'A' ? SS.getAEnd() : SS.getBStart()) - 0.001); });
    keymap.setHandler('trim_step_1ms_next', function() { SS.updateTrimValue(SS.getTrimState().activeHandle, (SS.getTrimState().activeHandle === 'A' ? SS.getAEnd() : SS.getBStart()) + 0.001); });
    keymap.setHandler('trim_handle_switch', function(e) { if (e.key === '1') SS.switchTrimHandle('A'); else if (e.key === '2') SS.switchTrimHandle('B'); else SS.switchTrimHandle(); });
    keymap.setHandler('trim_loop_toggle', function() { SS.toggleTrimLoop(); });
    keymap.setHandler('trim_snap_silence', function() { SS.snapTrim('silence'); });
    keymap.setHandler('trim_snap_zero', function() { SS.snapTrim('zero'); });
    keymap.setHandler('trim_reset', function() { SS.resetTrim(); });
    keymap.setHandler('trim_cut_prev', function() { SS.trimPrevCut(); });
    keymap.setHandler('trim_cut_next', function() { SS.trimNextCut(); });
    keymap.setHandler('trim_confirm', function() { const st = SS.getTrimState(); SS.closeTrim(); if (st) { preview.seek(SS.getAEnd() - 1); preview.play(); } });
    keymap.setHandler('trim_cancel', function() { SS.closeTrim(); });
    const tips = keymap.getTooltips();
    const btnMap = { 'btnSave':'file_save', 'btnOpen':'file_open_video', 'btnOpenProject':'file_open', 'btnExport':'file_export', 'btnSettings':'settings_open', 'btnAiRecommend':'ai_recommend', 'btnAutoClean':'auto_clean', 'btnAiCorrect':'ai_term_correct' };
    for (const id in btnMap) { const b = $(id); if (b) b.title = tips[btnMap[id]]; }
    const tb = $('topbar'); const h = document.createElement('div'); h.style.cssText = 'font-size:11px; color:#888; margin-left:auto; margin-right:10px;'; h.textContent = '단축키 도움말: F1'; tb.insertBefore(h, $('fileName'));
  };
})();
