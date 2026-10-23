(function() {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const $ = id => document.getElementById(id);
  function readMeta() {
    SS.state.meta = { title: $('inpTitle').value, verse: $('inpVerse').value,
      speaker: $('selSpeaker').value === '직접 입력' ? $('inpSpeaker').value : $('selSpeaker').value };
  }
  function showMeta(meta) {
    $('inpTitle').value = meta.title || ''; $('inpVerse').value = meta.verse || '';
    const sel = $('selSpeaker');
    const found = Array.from(sel.options).some(opt => opt.value === meta.speaker);
    sel.value = found ? meta.speaker : '직접 입력';
    $('inpSpeaker').value = meta.speaker || '';
    $('inpSpeaker').style.display = found ? 'none' : '';
  }
  SS.saveProjectTo = async function(p) {
    if (SS.flushCaptionEdit) SS.flushCaptionEdit();
    readMeta();
    const saved = SS.project.snapshot(SS.state, SS.preview.currentTime);
    await window.api.writeText(p, JSON.stringify(saved, null, 2));
    SS.projectPath = p;
    SS.toast('프로젝트를 저장했습니다');
    return p;
  };
  async function save(asNew) {
    try {
      if (!SS.state.source) { SS.toast('영상을 먼저 열어 주세요'); return null; }
      const p = !asNew && SS.projectPath ? SS.projectPath : await window.api.saveProjectDialog({ defaultPath: (SS.state.meta?.title || '프로젝트') + '.sshorts' });
      return p ? await SS.saveProjectTo(p) : null;
    } catch(e) { SS.toast('저장 실패: ' + e.message, 5000); return null; }
  }
  SS.saveProject = () => save(false);
  SS.saveProjectAs = () => save(true);
  SS.importProjectState = async function(raw) {
    const saved = SS.project.normalize(raw);
    const live = SS.state; // app.js keeps this reference. Never replace it.
    SS.preview.pause();
    const ok = await SS.openVideo(saved.source.path, { offset:saved.source.offset, url:saved.source.url, title:saved.source.title });
    if (!ok) throw Error('프로젝트 원본 영상을 열 수 없습니다. 파일 위치를 확인해 주세요.');
    const probedSource = live.source; const previousTheme = live.activeTheme;
    Object.assign(live, saved, { source: { ...saved.source, ...probedSource }, trimOpen:false, manualCaret:true });
    live.activeTheme = SS.theme.normalizeTheme(saved.activeTheme || previousTheme);
    showMeta(saved.meta);
    if (SS.syncCaptionUI) SS.syncCaptionUI();
    $('inpPadB').value = live.settings.padBefore; $('inpPadA').value = live.settings.padAfter; $('inpFade').value = live.settings.fadeMs;
    const sel = $('selTheme');
    if (live.activeTheme.id) {
      SS.projectThemes = SS.projectThemes || new Map(); SS.projectThemes.set(live.activeTheme.id, live.activeTheme);
      if (!Array.from(sel.options).some(o => o.value === live.activeTheme.id)) {
        const opt = document.createElement('option');opt.value=live.activeTheme.id;opt.textContent=(live.activeTheme.name || '프로젝트 테마')+' (프로젝트)';sel.appendChild(opt);
      }
      sel.value = live.activeTheme.id;
    }
    if (SS.resetEditorHistory) SS.resetEditorHistory(); else SS.renderTranscript();
    SS.applyCrop();
    await SS.preview.seek(Math.min(saved.playhead, SS.preview.duration || saved.playhead));
    await SS.updateTemplatePreview();
    $('btnExport').disabled = !live.words.some(w=>!w.del);
    if (window._testHook_onProjectLoaded) window._testHook_onProjectLoaded();
    return live;
  };
  SS.openProjectFrom = async function(p) {
    const data = await window.api.readJson(p);
    await SS.importProjectState(data);
    SS.projectPath = p;
    SS.toast('프로젝트를 열었습니다');
    return SS.state;
  };
  SS.loadProject = async function() {
    const p = await window.api.openProjectDialog();
    if (!p) return;
    try { await SS.openProjectFrom(p); } catch(e) { SS.toast('프로젝트 열기 실패: '+e.message,6000); }
  };
  SS.initProjectUI = function() {
    $('btnSave').addEventListener('click', SS.saveProject);
    $('btnOpenProject').addEventListener('click', SS.loadProject);
    window.api.getSettings().then(s => {
      SS.appSettings = s;
      const spks = s.template?.speakers || s.speakers || [];
      const sel = $('selSpeaker'); sel.replaceChildren();
      for (const text of [...spks,'직접 입력']) { const opt=document.createElement('option');opt.value=text;opt.textContent=text;sel.appendChild(opt); }
      if (SS.state.meta) showMeta(SS.state.meta);
    });
    const update = () => { readMeta(); SS.updateTemplatePreview(); };
    $('selSpeaker').addEventListener('change', () => { $('inpSpeaker').style.display=$('selSpeaker').value==='직접 입력'?'':'none';update(); });
    for (const id of ['inpTitle','inpVerse','inpSpeaker']) $(id).addEventListener('input', update);
    $('btnSaveTemplate').addEventListener('click', update);
  };
})();
