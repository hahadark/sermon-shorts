/* 앱 진입점: UI 연결, 영상 열기, 키보드, 테스트 모드 */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  const $ = (id) => document.getElementById(id);

  const state = SS.state || {};
  state.path = null;
  state.info = null;     // probe 결과
  state.peaksReady = false;
  SS.state = state;

  const preview = new SS.Preview();
  const wave = new SS.Waveform($('waveCanvas'), {
    onSeek: (t) => { preview.seek(t).then(updateTimeUI); },
  });
  SS.preview = preview;
  SS.wave = wave;

  document.getElementById('btnUserGuide').onclick=()=>api.openGuide().catch(e=>SS.toast(e.message,5000));

  // ---- 공통 UI ----
  let toastTimer = 0;
  function toast(msg, ms = 2500) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }
  SS.toast = toast;

  // 창(모달) 바깥 어두운 곳을 누르면 닫는다: 그 창의 닫기·취소 버튼을 대신 눌러 각 창의 정리 코드가 돌게 한다.
  // 닫기·취소 버튼이 없는 창(진행 중 표시 등)은 닫지 않는다. 창 안에서 끌다가 바깥에서 놓은 경우도 닫지 않는다.
  const isBackdrop = (el) => !!(el && el.classList && (el.classList.contains('modal-overlay') || el.classList.contains('ss-modal-overlay')));
  let backdropDown = null;
  document.addEventListener('mousedown', (e) => { backdropDown = isBackdrop(e.target) ? e.target : null; }, true);
  document.addEventListener('click', (e) => {
    const overlay = e.target;
    if (!isBackdrop(overlay) || overlay !== backdropDown) return;
    backdropDown = null;
    const btn = overlay.querySelector('.modal-close, #btnAiCancel, #aiClose, [data-act="close"], .ss-btn-cancel')
      || [...overlay.querySelectorAll('button')].find((b) => /^(닫기|취소)$/.test(b.textContent.trim()));
    if (btn && !btn.disabled) btn.click();
  });

  // 테스트용: 창이 가려져 있으면 capturePage 가 이전 프레임을 줄 때가 있어 두 번 찍는다
  SS.testShot = async (p) => { await api.testScreenshot(p); await new Promise((r) => setTimeout(r, 400)); return api.testScreenshot(p); };

  function basename(p) { return String(p).split(/[\\/]/).pop(); }

  function setWaveStatus(msg) {
    const el = $('waveStatus');
    if (!el) return;
    if (msg) { el.textContent = msg; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  }

  let seeking = false; // 슬라이더 드래그 중
  function updateTimeUI() {
    const t = preview.currentTime;
    const curTimeEl = $('curTime');
    if (curTimeEl) curTimeEl.textContent = SS.fmtTime(t + ((state.source && state.source.offset) || 0));
    const d = preview.duration;
    const seekEl = $('seek');
    if (!seeking && d > 0 && seekEl) seekEl.value = String(Math.round((t / d) * 1000));
    wave.setPlayhead(t, !preview.paused);
  }

  function updatePlayButton() {
    const btn = $('btnPlay');
    if (btn) btn.textContent = preview.paused ? '재생' : '일시정지';
  }

  function loop() {
    if (!preview.paused) updateTimeUI();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  const v = preview.video;
  v.addEventListener('play', updatePlayButton);
  v.addEventListener('pause', () => { updatePlayButton(); updateTimeUI(); });
  v.addEventListener('ended', updatePlayButton);
  v.addEventListener('seeked', updateTimeUI);
  v.addEventListener('timeupdate', () => { if (preview.paused) updateTimeUI(); });

  // opts: { offset, url, title } (유튜브 가져오기). 성공하면 true.
  async function openVideo(path, opts) {
    opts = opts || {};
    try {

      preview.pause();
      const fnEl = $('fileName');
      if (fnEl) fnEl.textContent = basename(path) + ' (불러오는 중…)';
      setWaveStatus('영상 정보 확인 중…');
      const info = await api.probe(path);
      // 기존 편집은 새 영상이 실제로 열릴 때까지 유지한다.
      await preview.load(path, info);
      if (state.path && state.path !== path && state.words && state.words.length) {
        // 다른 영상: 이전 자막/편집 상태 비우기
        state.words = []; state.overrides = {}; state.markI = -1; state.markO = -1;
        state.caret = 0; state.selAnchor = 0; state.selection = null; state.hideDeleted = false; SS.projectPath = null;
        if (SS.resetEditorHistory) SS.resetEditorHistory(); else if (SS.renderTranscript) SS.renderTranscript();
      }
      state.path = path;
      state.info = info;
      state.source = { path: path, offset: opts.offset || 0, url: opts.url || null, title: opts.title || null,
        duration: info.duration, fps: info.fps, width: info.width, height: info.height };
      const ve = $('videoEmpty'); if (ve) ve.style.display = 'none';
      state.peaksReady = false;

      if (fnEl) { fnEl.textContent = basename(path); fnEl.title = path; }
      const durEl = $('durTime');
      if (durEl) durEl.textContent = SS.fmtTime(preview.duration);
      const playBtn = $('btnPlay'); if (playBtn) playBtn.disabled = false;
      const seekInp = $('seek'); if (seekInp) seekInp.disabled = false;
      wave.setData(null, 0.01, preview.duration);
      updateTimeUI();

      window.dispatchEvent(new CustomEvent('ss:video-opened', { detail: { path } }));
      if (SS.updateTemplatePreview) SS.updateTemplatePreview();
      if (!info.hasAudio) {
        setWaveStatus('오디오가 없는 영상입니다');
        return true;
      }
      // 파형은 뒤에서 계산 (자막 생성이 바로 이어질 수 있도록)
      setWaveStatus('파형 계산 중…');
      state.peaksPromise = api.getPeaks(path).then((res) => {
        if (state.path !== path) return;
        const peaks = new Float32Array(res.buffer);
        wave.setData(peaks, res.bucketSec, preview.duration);
        wave.setPlayhead(preview.currentTime, false);
        state.peaksReady = true;
        setWaveStatus(null);
      }).catch((err) => { console.error(err); setWaveStatus('파형을 계산하지 못했습니다'); });
      return true;
    } catch (err) {
      console.error(err);
      setWaveStatus(null);
      const fnEl = $('fileName'); if (fnEl) fnEl.textContent = '열기 실패: ' + basename(path);
      toast('영상을 열 수 없습니다', 5000);
      return false;
    }
  }
  SS.openVideo = openVideo;

  // 유튜브 등에서 받은 소스를 연다. 파형까지 기다리지 않고 플레이어가 준비되면 resolve.
  // dispatch 한 쪽은 e.detail.done (Promise<boolean>) 을 await 할 수 있다.
  window.addEventListener('ss:source-loaded', (e) => {
    const d = e.detail || {};
    if (!d.path) return;
    if (d.done) return; // 이미 다른 리스너가 처리
    d.done = openVideo(d.path, { offset: d.offset || 0, url: d.url, title: d.title });
  });

  const bOpen = $('btnOpen'); if (bOpen) bOpen.addEventListener('click', async () => { const p = await api.openVideoDialog(); if (p) openVideo(p).catch(() => {}); });
  const bPlay = $('btnPlay'); if (bPlay) bPlay.addEventListener('click', (e) => { preview.toggle(); e.currentTarget.blur(); });

  async function initThemePicker() {
    const sel = $('selTheme');
    if (!sel) return;
    const updateList = async () => {
      const themes = await api.listThemes();
      const settings = await api.getSettings();
      sel.innerHTML = '';
      themes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name;
        if (t.id === settings.activeThemeId) opt.selected = true;
        sel.appendChild(opt);
      });
      state.activeTheme = themes.find(t => t.id === sel.value) || themes[0];
      return themes;
    };
    let themes = await updateList();
    SS.updateThemeList = updateList;

    sel.addEventListener('change', async () => {
      const theme = themes.find(t => t.id === sel.value) || SS.projectThemes?.get(sel.value);
      if (!theme) return;
      state.activeTheme = theme;
      if (themes.some(t => t.id === sel.value)) await api.saveSettings({ activeThemeId: sel.value });
      if (SS.updateTemplatePreview) SS.updateTemplatePreview();
      if (SS.applyCrop) SS.applyCrop();
    });

    const btnEdit = document.getElementById('btnEditTheme');
    if (btnEdit) {
      console.log('btnEditTheme initialized');
      btnEdit.onclick = () => {
        console.log('btnEditTheme clicked');
        if (SS.openThemeEditor) SS.openThemeEditor(sel.value);
      };
    }
  }

  const seekEl = $('seek');
  if (seekEl) {
    seekEl.addEventListener('input', () => { seeking = true; const t = (Number(seekEl.value) / 1000) * preview.duration; const ct = $('curTime'); if (ct) ct.textContent = SS.fmtTime(t); preview.seek(t); });
    seekEl.addEventListener('change', () => { seeking = false; seekEl.blur(); updateTimeUI(); });
  }

  (async () => {
    await document.fonts.ready;
    await initThemePicker();
    if (SS.initProjectUI) SS.initProjectUI();
    if (SS.initExporter) SS.initExporter();
    if (SS.initCropUI) SS.initCropUI('tplVideoBox', 'video', function() { if (SS.updateTemplatePreview) SS.updateTemplatePreview(); });

    const settings = await api.getSettings();
    SS.appSettings = settings;
    if (SS.initKeymap) SS.initKeymap(settings.keymap || {});

    v.addEventListener('timeupdate', function() { if (SS.updateTemplatePreview) SS.updateTemplatePreview(); });

    window.addEventListener('ss:run-test-script', async (e) => {
      const script = e.detail;
      if (script === 'ytimport' || script === 'template' || script === 'ytcancel' || script === 'themeedit') {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(200); } };
        try {
          if (script === 'template') {
            await document.fonts.ready; await sleep(1500);
            const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
            const cx = c.getContext('2d');
            const s = await api.getSettings();
            const tpl = (s && s.template) || {};
            SS.drawTemplate(cx, ['all'], { title: '증인들', verse: '행 5:27-32', speaker: s.defaultSpeaker || (s.speakers && s.speakers[0]) || '김택근 사관', subtitleText: '우리가 이 일에 증인이요', settings: tpl });
            const out = document.createElement('canvas'); out.width = 1080; out.height = 1920;
            const ox = out.getContext('2d'); ox.fillStyle = '#000'; ox.fillRect(0, 0, 1080, 1920);
            ox.fillStyle = '#333'; ox.fillRect(0, 353, 1080, 958); ox.drawImage(c, 0, 0);
            ox.strokeStyle = '#f0f'; ox.lineWidth = 1; ox.beginPath(); ox.moveTo(540, 1580); ox.lineTo(540, 1780); ox.stroke();
            const launch2 = await api.getLaunchInfo();
            await api.writeImage({ dataUrl: out.toDataURL('image/png'), filename: launch2.cache + '/template_check.png' });
            console.log('[Test] template_check.png written, churchName=' + (tpl.churchName || '(default)') + ' logoPath=' + (tpl.logoPath || '(default)'));
            api.notifyTestReady({ success: true });
            return;
          }
          if (script === 'themeedit') {
            try {
              console.log('[Test] Starting themeedit test...');
              const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              const oldPrompt = window.prompt;
              const oldConfirm = window.confirm;
              const oldAlert = window.alert;
              window.prompt = () => "테마 (복사본)";
              window.confirm = () => true;
              window.alert = () => {};

              await sleep(1000);

              const sel = document.getElementById('selTheme');
              if (!sel) throw new Error('selTheme not found');
              const originalThemeId = sel.value;
              console.log('[Test] selTheme found, original value=' + originalThemeId);

              sel.value = 'daegu-sarang';
              sel.dispatchEvent(new Event('change'));
              await sleep(500);

              console.log('[Test] Opening Theme Editor');
              const btnEdit = document.getElementById('btnEditTheme');
              if (!btnEdit) throw new Error('btnEditTheme not found');
              btnEdit.click();
              await sleep(1500);

              console.log('[Test] Cloning theme');
              const btnClone = document.getElementById('teBtnClone');
              if (!btnClone) throw new Error('teBtnClone not found');
              btnClone.click();
              await sleep(1000);

              console.log('[Test] Selecting title element');
              const elItem = document.querySelector('.te-el-item:nth-child(2)'); // 제목
              if (!elItem) throw new Error('Title element list item not found');
              elItem.click();
              await sleep(500);

              console.log('[Test] Moving title +60px down');
              for(let i=0; i<6; i++) {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', shiftKey: true, bubbles: true }));
                await sleep(50);
              }

              console.log('[Test] Changing title color to #FFD54A');
              const theme = SS.teGetCurrentTheme();
              if (theme && theme.title) {
                theme.title.color = '#FFD54A';
                SS.tePushHistory();
                await SS.teRender();
              }

              console.log('[Test] Toggling safe-area');
              const btnSafe = document.getElementById('teBtnToggleSafe');
              if (btnSafe) btnSafe.click();
              await sleep(500);

              console.log('[Test] Taking screenshot cache/themeedit.png');
              await SS.testShot('cache/themeedit.png');

              console.log('[Test] Exporting theme JSON to cache/theme_export.json');
              const launchInfo = await api.getLaunchInfo();
              await api.writeText(launchInfo.cache + '/theme_export.json', JSON.stringify(theme, null, 2));

              console.log('[Test] Saving and Applying theme');
              document.getElementById('teBtnSave').click();
              await sleep(500);
              document.getElementById('teBtnApply').click();
              await sleep(500);

              console.log('[Test] Closing Theme Editor');
              document.getElementById('teBtnClose').click();
              await sleep(500);

              const clonedId = sel.value;
              console.log('[Test] Cloned theme applied with ID=' + clonedId);

              // 3-second export and frame grab
              // We need some words to export. If none, we'll mock some.
              // We need some words to export. If none, we'll mock some.
              SS.state.words = [{ id: 'w1', text: '테스트', start: 1416, end: 1419, score: 1, del: false, br: false }];
              SS.state.settings = { padBefore: 0, padAfter: 0, fadeMs: 0, maxLineChars: 14 };
              SS.state.overrides = {};
              SS.state.source = SS.state.source || { duration: 1500, fps: 30, width: 1920, height: 1080 };
              SS.state.meta = { title: "세상이 교인에게 바라는 것", verse: "행 5:27-32", speaker: "김택근 사관" };

              console.log('[Test] Starting 3-second export at 1416s');
              const exportPath = launchInfo.cache + '/themeedit_test.mp4';
              if (SS.doExport) {
                const res = await SS.doExport(exportPath, [1416, 1419]);
                console.log('[Test] Export finished: ' + JSON.stringify(res));

                console.log('[Test] Extracting frame at 1.5s to cache/themeedit_frame.png');
                const vid = document.createElement('video');
                vid.src = 'file:///' + exportPath.replace(/\\/g, '/');
                vid.muted = true;
                await new Promise(r => { vid.onloadeddata = r; vid.load(); });
                vid.currentTime = 1.5;
                await new Promise(r => { vid.onseeked = r; });
                const fc = document.createElement('canvas');
                fc.width = 1080; fc.height = 1920;
                const fcx = fc.getContext('2d');
                fcx.drawImage(vid, 0, 0, 1080, 1920);
                await api.writeImage({ dataUrl: fc.toDataURL('image/png'), filename: launchInfo.cache + '/themeedit_frame.png' });
                console.log('[Test] themeedit_frame.png created.');

                console.log('[Test] Verifying imported theme JSON');
                const importedJson = await window.api.readJson(launchInfo.cache + '/theme_export.json');
                const t1 = JSON.stringify({ ...importedJson, id: null });
                const t2 = JSON.stringify({ ...theme, id: null });
                const isEqual = (t1 === t2);
                console.log('[Test] Import verify equal: ' + isEqual);

                console.log('[Test] Cleaning up cloned theme');
                await window.api.deleteTheme(clonedId);

                console.log('[Test] Restoring original theme');
                sel.value = originalThemeId;
                sel.dispatchEvent(new Event('change'));
                await sleep(500);

              } else {
                console.log('[Test] SS.doExport not available');
              }

              window.prompt = oldPrompt;
              window.confirm = oldConfirm;
              window.alert = oldAlert;

              console.log('[Test] themeedit finished');
              api.notifyTestReady({ success: true });
            } catch (err) {
              console.error('[Test] Error in themeedit:', err);
              api.notifyTestError(err.stack || err.message);
            }
            return;
          }
          console.log('[Test] ytimport: fresh state, path=' + state.path);
          const btnYoutube = $('btnYoutube');
          if (!btnYoutube) throw new Error('btnYoutube not found');
          btnYoutube.click();
          await waitFor(() => document.getElementById('yt-url'), 3000, 'dialog');
          const inputUrl = document.getElementById('yt-url');
          const inputRange = document.getElementById('yt-range');
          const btnOk = document.getElementById('yt-ok');
          inputUrl.value = 'https://www.youtube.com/watch?v=9Tmjg3ESEyc';
          inputUrl.dispatchEvent(new Event('input'));
          inputRange.value = script === 'ytcancel' ? (() => { const m = 40 + (Math.floor(Date.now() / 1000) % 9); return m + ':00 ~ ' + m + ':40'; })() : '23:35 ~ 25:22';
          await waitFor(() => !btnOk.disabled, 60000, 'ytInfo');
          const tReady = new Promise((resolve, reject) => {
            const to = setTimeout(() => reject(new Error('Transcription timeout')), 300000);
            window.addEventListener('ss:transcript-ready', () => { clearTimeout(to); resolve(); }, { once: true });
          });
          btnOk.click();
          // 영상이 자막 생성 전에 열려야 한다
          await waitFor(() => state.source && /9Tmjg3ESEyc/.test(state.source.path || ''), 120000, 'video open');
          let tDone = false; tReady.then(() => { tDone = true; }, () => {});
          await waitFor(() => tDone || (document.getElementById('tr-progress-text') && (script === 'ytcancel' || /%/.test(document.getElementById('tr-progress-text').textContent))), 60000, 'transcribe progress');
          await sleep(1500);
          console.log('[Test] video opened before transcript: src=' + v.src + ' progress=' + (document.getElementById('tr-progress-text') ? document.getElementById('tr-progress-text').textContent : '(done)'));
          if (script === 'ytcancel') {
            document.getElementById('tr-cancel').click();
            await sleep(1500);
            const stillOpen = /9Tmjg3ESEyc_full\.mp4$/.test(decodeURIComponent(v.src)) && Math.abs(v.duration - 3026) < 3 && state.source && state.source.path;
            const modalGone = !document.getElementById('tr-cancel');
            console.log(`[Test] ASSERT cancel: videoStillOpen=${!!stillOpen} modalGone=${modalGone} words=${(state.words || []).length}`);
            await SS.testShot('cache/ytcancel_result.png');
            if (!stillOpen || !modalGone) throw new Error('ytcancel assertions failed');
            api.notifyTestReady({ success: true });
            return;
          }
          if (!tDone) await SS.testShot('cache/ytimport_progress.png'); else console.log('[Test] transcript was cached; no progress screenshot');
          await tReady;
          await sleep(1500);
          const words = state.words || [];
          const spans = document.querySelectorAll('#transcriptBody span[data-wid]').length;
          const okSrc = /9Tmjg3ESEyc_full\.mp4$/.test(decodeURIComponent(v.src));
          const okDur = Math.abs(v.duration - 3026) < 3;
          const first = words[0];
          const okRange = first && first.start >= 1415 - 2 && first.start < 1425;
          const okSeek = first && Math.abs(v.currentTime - first.start) < 0.5;
          console.log(`[Test] src=${decodeURIComponent(v.src)} duration=${v.duration.toFixed(2)} words=${words.length} spans=${spans} first=${first && first.start.toFixed(2)} '${first && first.text}' cur=${v.currentTime.toFixed(2)} source.offset=${state.source.offset}`);
          console.log(`[Test] ASSERT src=${okSrc} duration=${okDur} words=${words.length > 0 && spans > 0} range=${!!okRange} seek=${!!okSeek}`);
          await SS.testShot('cache/ytimport_result.png');
          if (!(okSrc && okDur && words.length > 0 && spans > 0 && okRange && okSeek)) throw new Error('ytimport assertions failed');
          api.notifyTestReady({ success: true });
        } catch (err) {
          api.notifyTestError(err.stack || err.message);
        }
      } else if (script === 'keys') {
        try {
          console.log('[Test] Starting keys test script...');
          const sleep = (ms) => new Promise(function(r) { setTimeout(r, ms); });
          const logState = (step) => {
             const cuts = SS.getCuts();
             console.log(`[Step: ${step}] Result: ${$('lblDuration').textContent} (${cuts.length}컷)`, {
                cursor: SS.state.cursorIdx, anchor: SS.state.selAnchorIdx,
                markI: SS.state.markI, markO: SS.state.markO,
                overrides: Object.keys(SS.state.overrides).length
             });
             return cuts.length;
          };

          // 1. Initial State
          SS.state.cursorIdx = 100; SS.state.selAnchorIdx = 100;
          SS.preview.seek(SS.state.words[100].start);
          await sleep(200);
          logState('Init');

          // 2. Mark I
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', code: 'KeyI', bubbles: true }));
          await sleep(100);
          logState('Mark I');

          // 3. Move cursor and Mark O
          for(let i=0; i<50; i++) SS.moveCursor(1);
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', bubbles: true }));
          await sleep(100);
          logState('Mark O (Keep 100..150)');

          // 4. Delete a word inside kept range
          SS.state.cursorIdx = 140; SS.state.selAnchorIdx = 140;
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));
          await sleep(100);
          logState('Delete word 140');

          // Delete 134 to ensure 135 cutBefore shows scissors
          SS.state.cursorIdx = 134; SS.state.selAnchorIdx = 134;
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));
          await sleep(100);

          // 5. Toggle cutBefore (X)
          // Look for a word with a bit more gap if possible, or just force pads to 0 for test
          SS.state.settings.padBefore = 0.05; SS.state.settings.padAfter = 0.05;
          SS.state.cursorIdx = 135; SS.state.selAnchorIdx = 135;
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true }));
          await sleep(100);
          logState('Toggle X on word 135');

          // 6. Toggle br (Enter)
          SS.state.cursorIdx = 130; SS.state.selAnchorIdx = 130;
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          await sleep(100);
          logState('Toggle Br on word 130');

          // 7. Selection with Shift+ArrowRight
          SS.state.cursorIdx = 120; SS.state.selAnchorIdx = 120;
          for(let i=0; i<5; i++) {
             window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true, bubbles: true }));
             await sleep(50);
          }
          logState('Select 120..125');

          // 8. T (trim) on nearest cut
          SS.preview.seek(SS.state.words[135].start);
          await sleep(100);
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }));
          await sleep(2000); // wait for PCM
          logState('Trim open');
          await api.testScreenshot('cache/keys_editor.png');

          if (SS.state.trimOpen) {
            const v0 = SS.getAEnd();
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true, bubbles: true }));
            await sleep(200);
            const v1 = SS.getAEnd();
            console.log(`Trim Shift+Right: ${v0.toFixed(3)} -> ${v1.toFixed(3)}`);

            window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true }));
            await sleep(200);
            const v2 = SS.getAEnd();
            console.log(`Trim Snap: ${v1.toFixed(3)} -> ${v2.toFixed(3)}`);

            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            await sleep(200);
            logState('Trim closed');
          } else {
            console.error('Trim panel failed to open!');
          }

          // 12. F1 (help)
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true }));
          await sleep(500);
          await api.testScreenshot('cache/keys_help.png');

          console.log('[Test] Keys test finished.');
          api.notifyTestReady({ success: true });
        } catch(err) { api.notifyTestError(err.stack || err.message); }
      }
    });

    let launch = null;
    try {
      launch = await api.getLaunchInfo();
      if (!launch) return;

      // Dispatch early for scripts that don't need full video/peaks loading
      if (launch.testScript === 'themeedit' || launch.testScript === 'template') {
        window.dispatchEvent(new CustomEvent('ss:run-test-script', { detail: launch.testScript }));
      }

      if (!launch.open) {
        if (launch.testScript && launch.testScript !== 'themeedit' && launch.testScript !== 'template') {
          window.dispatchEvent(new CustomEvent('ss:run-test-script', { detail: launch.testScript }));
        }
        return;
      }
      await openVideo(launch.open);
      if (state.peaksPromise) await state.peaksPromise;
      if (launch.transcript) {
        const json = await api.readJson(launch.transcript);
        if (json) {
          const w = Array.isArray(json) ? json : (json.words || []);
          window.dispatchEvent(new CustomEvent('ss:transcript-ready', { detail: { path: launch.open, offset: 0, words: w } }));
        }
      }
      if (launch.testScript && launch.testScript !== 'themeedit' && launch.testScript !== 'template') {
        window.dispatchEvent(new CustomEvent('ss:run-test-script', { detail: launch.testScript }));
      }
    } catch (err) {
      if (launch && launch.screenshot) api.notifyTestError(err && err.stack ? err.stack : err);
    }
  })();
})();
