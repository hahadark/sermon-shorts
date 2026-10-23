'use strict';

/**
 * import.js - 유튜브 가져오기 (스트림 미리보기 + 구간 선택) + 자막 생성 모달
 */
(function() {
  const SS = window.SS = window.SS || {};
  const api = window.api;
  const edl = SS.edl;

  let currentSource = null;

  function init() {
    const btnYoutube = document.getElementById('btnYoutube');
    if (btnYoutube) {
      btnYoutube.disabled = false;
      btnYoutube.addEventListener('click', openYoutubeDialog);
    }
    const btnTranscribe = document.getElementById('btnTranscribe');
    if (btnTranscribe) {
      btnTranscribe.disabled = false;
      btnTranscribe.addEventListener('click', () => {
        const source = (SS.state && SS.state.source) || currentSource;
        if (!source || !source.path) { SS.toast('먼저 영상을 열거나 유튜브에서 가져와 주세요.'); return; }
        runTranscribe(source);
      });
    }

    injectStyles();

    window.addEventListener('ss:source-loaded', (e) => { currentSource = e.detail; });
    window.addEventListener('ss:video-opened', (e) => {
      currentSource = (SS.state && SS.state.source) || { path: e.detail.path };
    });

    // AI 추천에서 후보 선택 시
    window.addEventListener('ss:import-yt-req', (e) => {
      const { url, start, end, title } = e.detail || {};
      importYoutubePart({ url, start, end, title }).catch((err) => console.error(err));
    });
  }

  // ---------- 구간 가져오기 (fetchPart) ----------
  async function importYoutubePart(req, opt) {
    opt = opt || {};
    const ui = opt.progressUi || progressModal('유튜브 구간 가져오기');
    const removeListener = api.onProgress((info) => {
      if (info.task === 'youtube') {
        const pct = info.pct || 0;
        const stage = info.stage === 'part-video' ? '영상 받는 중' : (info.stage === 'part-audio' ? '오디오 받는 중' : '처리 중');
        ui.set(pct, `${stage}… ${pct}%`);
      }
    });
    
    let result;
    try {
      ui.set(0, '준비 중…');
      result = await api.ytFetchPart(req.url, req.start, req.end);
    } catch (err) {
      removeListener();
      ui.close();
      SS.toast('가져오기 실패: ' + err.message, 6000);
      throw err;
    }
    removeListener();

    const detail = {
      path: result.path,
      offset: result.offset || 0,
      url: req.url,
      title: req.title || result.title,
      duration: result.duration || req.duration,
      range: { start: req.start, end: req.end },
    };
    const ev = new CustomEvent('ss:source-loaded', { detail });
    window.dispatchEvent(ev);
    const opened = detail.done ? await detail.done : false;
    ui.close();
    if (!opened) throw new Error('영상을 열지 못했습니다');

    const source = (SS.state && SS.state.source) || { path: detail.path, offset: detail.offset };
    if (SS.preview) {
      try { SS.preview.seek(Math.max(0, req.start - (detail.offset || 0))); } catch (_) {}
    }
    
    const rangeText = edl.formatTime(req.start, false) + ' ~ ' + edl.formatTime(Math.ceil(req.end), false);
    await runTranscribe(source, rangeText, true);
  }

  // ---------- 진행 표시 모달 ----------
  function progressModal(title) {
    const { overlay, close } = createModal(title, `
      <div class="ss-progress-container">
        <div class="ss-progress-bg"><div class="ss-progress-bar"></div></div>
        <div class="ss-progress-text">준비 중…</div>
      </div>`);
    const bar = overlay.querySelector('.ss-progress-bar');
    const txt = overlay.querySelector('.ss-progress-text');
    return {
      set(pct, text) { if (pct != null) bar.style.width = Math.max(0, Math.min(100, pct)) + '%'; if (text) txt.textContent = text; },
      close,
    };
  }

  function injectStyles() {
    if (document.getElementById('ss-import-styles')) return;
    const style = document.createElement('style');
    style.id = 'ss-import-styles';
    style.textContent = `
      .ss-modal-overlay {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center;
        z-index: 9999;
      }
      .ss-modal {
        background: #25282c; color: #eee; width: 520px; padding: 24px; border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5); border: 1px solid #3a3d42;
      }
      .ss-modal.wide { width: 900px; }
      .ss-modal h2 { margin: 0 0 20px 0; font-size: 1.2rem; font-weight: 600; color: #fff; }
      .ss-form-group { margin-bottom: 16px; }
      .ss-label { display: block; margin-bottom: 6px; font-size: 0.9rem; color: #aaa; }
      .ss-input {
        width: 100%; background: #1a1c1e; border: 1px solid #3a3d42; color: #fff;
        padding: 10px 12px; border-radius: 4px; box-sizing: border-box; font-size: 0.95rem; font-family: inherit;
      }
      .ss-input:focus { outline: none; border-color: #4a90e2; }
      .ss-input:disabled { opacity: 0.6; }
      .ss-info-box {
        background: #1a1c1e; padding: 12px; border-radius: 4px; margin-bottom: 16px;
        font-size: 0.9rem; line-height: 1.4; border-left: 4px solid #4a90e2;
      }
      .ss-progress-container { margin-top: 12px; }
      .ss-progress-bg { background: #1a1c1e; height: 10px; border-radius: 5px; overflow: hidden; margin-bottom: 8px; }
      .ss-progress-bar { background: #4a90e2; height: 100%; width: 0; transition: width 0.2s; }
      .ss-progress-text { font-size: 0.9rem; color: #ccc; text-align: center; }
      .ss-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
      .ss-btn { padding: 8px 20px; border-radius: 4px; border: none; cursor: pointer; font-size: 0.95rem; font-weight: 500; font-family: inherit; }
      .ss-btn-cancel { background: #3a3d42; color: #eee; }
      .ss-btn-cancel:hover { background: #45494f; }
      .ss-btn-primary { background: #4a90e2; color: #fff; }
      .ss-btn-primary:hover { background: #5da0eb; }
      .ss-btn-primary:disabled { background: #2c3e50; color: #7f8c8d; cursor: not-allowed; }
      
      .ss-yt-picker { display: grid; grid-template-columns: 1fr 300px; gap: 20px; }
      .ss-yt-player-box { background: #000; position: relative; aspect-ratio: 16/9; }
      .ss-yt-player-box video { width: 100%; height: 100%; }
      .ss-yt-subs-box { background: #1a1c1e; height: 400px; overflow-y: auto; border: 1px solid #333; }
      .ss-yt-sub-line { padding: 6px 10px; font-size: 0.85rem; cursor: pointer; border-bottom: 1px solid #222; color: #aaa; }
      .ss-yt-sub-line:hover { background: #2a2e33; color: #fff; }
      .ss-yt-sub-line.active { background: #313a44; color: #4a90e2; border-left: 3px solid #4a90e2; }
      .ss-yt-time { font-family: monospace; color: #666; margin-right: 8px; }
      .ss-yt-range-ui { margin-top: 12px; display: flex; align-items: center; gap: 8px; }
      .ss-yt-range-ui .ss-btn { white-space: nowrap; padding: 8px 12px; background: #3a3d42; color: #eee; }
      .ss-yt-timeline { margin-top: 8px; display: flex; align-items: center; gap: 10px; font-size: 0.85rem; }
      .ss-yt-range-input { width: 100px; text-align: center; }
      .ss-hidden { display: none; }
    `;
    document.head.appendChild(style);
  }

  function createModal(title, contentHtml) {
    const overlay = document.createElement('div');
    overlay.className = 'ss-modal-overlay';
    overlay.innerHTML = `<div class="ss-modal"><h2></h2><div class="ss-modal-content">${contentHtml}</div></div>`;
    overlay.querySelector('h2').textContent = title;
    document.body.appendChild(overlay);
    let closed = false;
    const close = () => { 
      if (closed) return; 
      closed = true; 
      if (SS.state) SS.state.dialogOpen = false;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay); 
    };
    if (SS.state) SS.state.dialogOpen = true;
    return { overlay, close };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 유튜브 가져오기 대화상자 ----------
  async function openYoutubeDialog() {
    const content = `
      <div class="ss-form-group">
        <label class="ss-label">유튜브 주소</label>
        <input type="text" id="yt-url" class="ss-input" placeholder="https://www.youtube.com/watch?v=...">
      </div>
      <div id="yt-info" class="ss-info-box ss-hidden"></div>
      <div class="ss-actions">
        <button id="yt-cancel" class="ss-btn ss-btn-cancel">취소</button>
        <button id="yt-ok" class="ss-btn ss-btn-primary" disabled>불러오기</button>
      </div>
    `;
    const { overlay, close } = createModal('유튜브에서 가져오기', content);
    const inputUrl = overlay.querySelector('#yt-url');
    const infoBox = overlay.querySelector('#yt-info');
    const btnOk = overlay.querySelector('#yt-ok');
    const btnCancel = overlay.querySelector('#yt-cancel');
    setTimeout(() => inputUrl.focus(), 0);

    let videoInfo = null;
    let infoSeq = 0;

    const updateInfo = async () => {
      const url = inputUrl.value.trim();
      const parsed = edl.parseYoutubeUrl(url);
      const seq = ++infoSeq;
      videoInfo = null;
      if (!parsed) { infoBox.classList.add('ss-hidden'); btnOk.disabled = true; return; }
      try {
        infoBox.classList.remove('ss-hidden');
        infoBox.textContent = '영상 정보를 불러오는 중…';
        const info = await api.ytResolve(url);
        if (seq !== infoSeq) return;
        videoInfo = info;
        infoBox.innerHTML = `<strong>${escapeHtml(info.title)}</strong><br>길이: ${edl.formatTime(info.duration, false)}`;
        btnOk.disabled = false;
      } catch (e) {
        if (seq !== infoSeq) return;
        infoBox.textContent = '정보를 불러오지 못했습니다: ' + e.message;
        btnOk.disabled = true;
      }
    };
    inputUrl.addEventListener('input', debounce(updateInfo, 400));
    inputUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btnOk.disabled) btnOk.click(); });
    btnCancel.addEventListener('click', close);

    btnOk.addEventListener('click', () => {
      if (!videoInfo) return;
      openSectionPicker(inputUrl.value.trim(), videoInfo, close);
    });
  }

  async function openSectionPicker(url, info, closeParent, preset) {
    if (closeParent) closeParent();
    preset = preset || {};
    const content = `
      <div class="ss-yt-picker">
        <div class="ss-yt-main">
          <div class="ss-yt-player-box">
            <video id="yt-preview" src="${info.preview.url}" preload="auto"></video>
          </div>
          <div class="ss-yt-timeline">
            <button id="yt-play" class="ss-btn ss-btn-cancel" style="padding:4px 12px;">재생</button>
            <input type="range" id="yt-seek" min="0" max="${Math.round(info.duration * 10)}" step="1" value="0" style="flex:1;">
            <span id="yt-cur" style="font-family:monospace;">00:00 / ${edl.formatTime(info.duration, false)}</span>
          </div>
          <div class="ss-yt-range-ui">
            <button id="yt-set-in" class="ss-btn sm">시작 지정 (I)</button>
            <input type="text" id="yt-start" class="ss-input ss-yt-range-input" value="00:00">
            <span>~</span>
            <input type="text" id="yt-end" class="ss-input ss-yt-range-input" value="00:00">
            <button id="yt-set-out" class="ss-btn sm">끝 지정 (O)</button>
            <div id="yt-range-dur" style="margin-left: 10px; color: #4a90e2; font-weight: bold;">선택: 0:00</div>
          </div>
          <div style="margin-top: 10px; font-size: 0.85rem; color: #888;">
            단축키: Space(재생), I(시작), O(끝), ←/→(±5초)
          </div>
          <label style="margin-top: 15px; display: block; font-size: 0.9rem;">
            <input type="checkbox" id="yt-full-download"> 영상 전체 받기 (느림)
          </label>
        </div>
        <div class="ss-yt-subs-box" id="yt-subs">
          <div style="padding: 20px; text-align: center; color: #666;">자막 불러오는 중…</div>
        </div>
      </div>
      <div class="ss-actions">
        <button id="yt-picker-cancel" class="ss-btn ss-btn-cancel">취소</button>
        <button id="yt-picker-ok" class="ss-btn ss-btn-primary">이 구간 가져오기</button>
      </div>
    `;
    const { overlay, close } = createModal('구간 고르기', content);
    overlay.querySelector('.ss-modal').classList.add('wide');
    
    const video = overlay.querySelector('#yt-preview');
    const inputStart = overlay.querySelector('#yt-start');
    const inputEnd = overlay.querySelector('#yt-end');
    const labelDur = overlay.querySelector('#yt-range-dur');
    const subsBox = overlay.querySelector('#yt-subs');
    const btnIn = overlay.querySelector('#yt-set-in');
    const btnOut = overlay.querySelector('#yt-set-out');
    const btnOk = overlay.querySelector('#yt-picker-ok');
    const btnCancel = overlay.querySelector('#yt-picker-cancel');
    const checkFull = overlay.querySelector('#yt-full-download');

    let startTime = 0, endTime = info.duration;
    const parsedUrl = edl.parseYoutubeUrl(url);
    let initialSeek = null;
    if (typeof preset.start === 'number') {
      startTime = preset.start; initialSeek = preset.start;
      if (typeof preset.end === 'number') endTime = preset.end;
    } else if (parsedUrl && parsedUrl.t) {
      startTime = parsedUrl.t; initialSeek = parsedUrl.t;
    }
    if (initialSeek != null) {
      video.addEventListener('loadedmetadata', () => { video.currentTime = initialSeek; }, { once: true });
    }
    
    const updateRangeLabel = () => {
      inputStart.value = edl.formatTime(startTime, false);
      inputEnd.value = edl.formatTime(endTime, false);
      labelDur.textContent = `선택: ${edl.formatTime(endTime - startTime, false)} (${Math.round(endTime - startTime)}초)`;
    };
    updateRangeLabel();

    btnIn.onclick = () => { startTime = video.currentTime; updateRangeLabel(); };
    btnOut.onclick = () => { endTime = video.currentTime; updateRangeLabel(); };
    inputStart.onchange = () => { const t = edl.parseTimecode(inputStart.value); if (t !== null) startTime = t; updateRangeLabel(); };
    inputEnd.onchange = () => { const t = edl.parseTimecode(inputEnd.value); if (t !== null) endTime = t; updateRangeLabel(); };

    // Subtitles
    api.ytAutoSubs(url).then(res => {
      if (!res || !res.lines || res.lines.length === 0) {
        subsBox.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">자막이 없습니다.</div>';
        return;
      }
      subsBox.innerHTML = '';
      res.lines.forEach(line => {
        const div = document.createElement('div');
        div.className = 'ss-yt-sub-line';
        div.innerHTML = `<span class="ss-yt-time">${edl.formatTime(line.start, false)}</span>${escapeHtml(line.text)}`;
        div.onclick = () => { video.currentTime = line.start; video.play(); };
        div.dataset.start = line.start;
        div.dataset.end = line.end;
        subsBox.appendChild(div);
      });
    });

    const seekBar = overlay.querySelector('#yt-seek');
    const curLabel = overlay.querySelector('#yt-cur');
    const btnPlay = overlay.querySelector('#yt-play');
    let dragging = false;
    seekBar.oninput = () => { dragging = true; video.currentTime = Number(seekBar.value) / 10; };
    seekBar.onchange = () => { dragging = false; seekBar.blur(); };
    btnPlay.onclick = () => { if (video.paused) video.play(); else video.pause(); btnPlay.blur(); };
    video.onplay = () => { btnPlay.textContent = '일시정지'; };
    video.onpause = () => { btnPlay.textContent = '재생'; };
    video.onseeked = () => video.ontimeupdate();

    video.ontimeupdate = () => {
      const t = video.currentTime;
      if (!dragging) seekBar.value = String(Math.round(t * 10));
      curLabel.textContent = `${edl.formatTime(t, false)} / ${edl.formatTime(info.duration, false)}`;
      const lines = subsBox.querySelectorAll('.ss-yt-sub-line');
      let active = null;
      lines.forEach(l => {
        const s = parseFloat(l.dataset.start), e = parseFloat(l.dataset.end);
        if (t >= s && t <= e) {
          l.classList.add('active');
          active = l;
        } else {
          l.classList.remove('active');
        }
      });
      if (active && !video.paused) {
        const top = active.offsetTop - subsBox.offsetTop;
        if (top < subsBox.scrollTop || top > subsBox.scrollTop + subsBox.clientHeight - 40) {
          subsBox.scrollTop = top - subsBox.clientHeight / 2;
        }
      }
    };

    // Keyboard handling
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); if (video.paused) video.play(); else video.pause(); }
      if (e.key.toLowerCase() === 'i') { btnIn.click(); }
      if (e.key.toLowerCase() === 'o') { btnOut.click(); }
      if (e.key === 'ArrowLeft') { video.currentTime -= 5; }
      if (e.key === 'ArrowRight') { video.currentTime += 5; }
      if (e.key === 'Escape') { close(); }
      if (e.key === 'Enter') { btnOk.click(); }
    };
    window.addEventListener('keydown', onKey);
    const oldClose = close;
    const newClose = () => { window.removeEventListener('keydown', onKey); oldClose(); };
    btnCancel.onclick = newClose;

    btnOk.onclick = async () => {
      if (endTime <= startTime) { SS.toast('구간이 올바르지 않습니다.'); return; }
      newClose();
      if (checkFull.checked) {
        importYoutubeFull({ url, start: startTime, end: endTime, title: info.title, duration: info.duration });
      } else {
        importYoutubePart({ url, start: startTime, end: endTime, title: info.title, duration: info.duration });
      }
    };
  }

  async function importYoutubeFull(req) {
    const ui = progressModal('유튜브에서 가져오기');
    const removeListener = api.onProgress((info) => {
      if (info.task === 'youtube' && info.stage === 'download') {
        const pct = info.pct || 0;
        ui.set(pct, `영상 전체 받는 중… ${pct}%`);
      }
    });
    try {
      const result = await api.ytDownload(req.url, req.start, req.end);
      removeListener();
      const detail = { path: result.path, offset: result.offset || 0, url: req.url, title: req.title, duration: req.duration };
      window.dispatchEvent(new CustomEvent('ss:source-loaded', { detail }));
      await detail.done;
      ui.close();
      await runTranscribe(SS.state.source, edl.formatTime(req.start, false) + ' ~ ' + edl.formatTime(req.end, false), true);
    } catch (e) {
      removeListener();
      ui.close();
      SS.toast('실패: ' + e.message);
    }
  }

  // ---------- 자막 생성 모달 ----------
  function runTranscribe(source, presetRange, autoStart) {
    return new Promise((resolveOuter) => {
      const content = `
        <div class="ss-form-group">
          <label class="ss-label">자막 만들 구간 (원본 영상 시각)</label>
          <input type="text" id="tr-range" class="ss-input" placeholder="전체 구간 (예: 14:30 ~ 16:00)">
          <div style="margin-top: 4px; font-size: 0.8rem; color: #888;">영상은 이미 열려 있습니다. 취소해도 영상은 그대로 남습니다.</div>
        </div>
        <div id="tr-progress-box" class="ss-progress-container ss-hidden">
          <div class="ss-progress-bg"><div id="tr-progress-bar" class="ss-progress-bar"></div></div>
          <div id="tr-progress-text" class="ss-progress-text">준비 중…</div>
        </div>
        <div class="ss-actions">
          <button id="tr-cancel" class="ss-btn ss-btn-cancel">취소</button>
          <button id="tr-ok" class="ss-btn ss-btn-primary">자막 생성 시작</button>
        </div>
      `;
      const { overlay, close } = createModal('자막 생성', content);
      const inputRange = overlay.querySelector('#tr-range');
      const btnOk = overlay.querySelector('#tr-ok');
      const btnCancel = overlay.querySelector('#tr-cancel');
      const progressBox = overlay.querySelector('#tr-progress-box');
      const progressBar = overlay.querySelector('#tr-progress-bar');
      const progressText = overlay.querySelector('#tr-progress-text');

      let isRunning = false;
      let cancelled = false;
      if (presetRange) inputRange.value = presetRange;

      const doCancel = () => {
        if (isRunning) { cancelled = true; try { api.cancelTask(); } catch (_) {} }
        close();
        window.dispatchEvent(new CustomEvent('ss:transcribe-cancelled', { detail: { path: source.path } }));
        resolveOuter(null);
      };
      btnCancel.onclick = doCancel;

      btnOk.onclick = async () => {
        if (isRunning) return;
        const rangeStr = inputRange.value.trim();
        const off = source.offset || 0;
        let start = 0, end;
        if (rangeStr) {
          const pr = edl.parseRange(rangeStr);
          if (pr) { start = pr.start - off; end = pr.end - off; }
          else {
            const t = edl.parseTimecode(rangeStr);
            if (t === null) { SS.toast('구간 형식이 올바르지 않습니다.'); return; }
            start = t - off;
          }
        }
        start = Math.max(0, start);

        isRunning = true;
        inputRange.disabled = true; btnOk.disabled = true;
        progressBox.classList.remove('ss-hidden');
        
        const stageMap = { extract: '오디오 추출 중', stt: '음성 인식 중', align: '단어 정렬 중', done: '완료' };
        const removeListener = api.onProgress((info) => {
          if (info.task !== 'engine') return;
          const pct = info.pct || 0;
          progressBar.style.width = pct + '%';
          progressText.textContent = `${stageMap[info.stage] || info.stage}… ${pct.toFixed(0)}%`;
        });
        
        try {
          const result = await api.transcribe(source.path, start, end);
          removeListener();
          if (cancelled) return;
          close();
          window.dispatchEvent(new CustomEvent('ss:transcript-ready', {
            detail: { path: source.path, offset: source.offset || 0, words: result.words, language: result.language },
          }));
          resolveOuter(result);
        } catch (e) {
          removeListener();
          if (cancelled) return;
          isRunning = false;
          inputRange.disabled = false; btnOk.disabled = false;
          progressText.textContent = '실패: ' + e.message;
        }
      };
      if (autoStart) setTimeout(() => btnOk.click(), 0);
    });
  }

  function debounce(fn, ms) {
    let timeout;
    return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => fn(...args), ms); };
  }

  SS.importer = { openYoutubeDialog, runTranscribe, importYoutubePart, openSectionPicker };
  SS.openYoutubeImport = openYoutubeDialog;

  // ---------- 테스트 훅: SS_TEST_SCRIPT=ytpart ----------
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'ytpart') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(200); } };
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: 'Key' + k.toUpperCase(), bubbles: true }));
    try {
      const T0 = Date.now();
      console.log('[Test] ytpart: fresh start, path=' + (SS.state && SS.state.path));
      document.getElementById('btnYoutube').click();
      await waitFor(() => document.getElementById('yt-url'), 3000, 'dialog');
      const inputUrl = document.getElementById('yt-url');
      inputUrl.value = 'https://www.youtube.com/watch?v=9Tmjg3ESEyc';
      inputUrl.dispatchEvent(new Event('input'));
      await waitFor(() => !document.getElementById('yt-ok').disabled, 60000, 'ytResolve');
      console.log('[Test] resolved in ' + ((Date.now() - T0) / 1000).toFixed(1) + 's');
      document.getElementById('yt-ok').click();
      await waitFor(() => document.getElementById('yt-preview'), 3000, 'picker');
      const video = document.getElementById('yt-preview');
      await waitFor(() => video.readyState >= 1, 30000, 'preview metadata');
      const seekTo = async (t) => { const p = new Promise((r) => video.addEventListener('seeked', r, { once: true })); video.currentTime = t; await p; await waitFor(() => video.readyState >= 2, 20000, 'frame'); };
      // 재생 확인
      await seekTo(1400);
      await video.play();
      await sleep(2500);
      const playedTo = video.currentTime;
      video.pause();
      console.log('[Test] preview played 1400 -> ' + playedTo.toFixed(2));
      await seekTo(1415); key('i');
      await seekTo(1522); key('o');
      await waitFor(() => document.querySelectorAll('.ss-yt-sub-line').length > 0 || /없습니다/.test(document.getElementById('yt-subs').textContent), 90000, 'auto subs');
      video.ontimeupdate();
      const active = document.querySelector('.ss-yt-sub-line.active');
      if (active) active.scrollIntoView({ block: 'center' });
      const rangeLabel = document.getElementById('yt-range-dur').textContent;
      console.log(`[Test] range: ${document.getElementById('yt-start').value} ~ ${document.getElementById('yt-end').value} ${rangeLabel} subs=${document.querySelectorAll('.ss-yt-sub-line').length} active=${active ? active.textContent.slice(0, 30) : '-'}`);
      await sleep(500);
      await SS.testShot('cache/ytpart_dialog.png');

      const tReady = new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('Transcription timeout')), 300000);
        window.addEventListener('ss:transcript-ready', () => { clearTimeout(to); resolve(); }, { once: true });
      });
      const T1 = Date.now();
      document.getElementById('yt-picker-ok').click();
      await waitFor(() => SS.state.source && /part_\d+_\d+\.mp4$/.test(SS.state.source.path || ''), 120000, 'part open');
      console.log('[Test] part fetched+opened in ' + ((Date.now() - T1) / 1000).toFixed(1) + 's');
      await tReady;
      await sleep(1500);
      const src = SS.state.source, words = SS.state.words || [];
      const first = words[0], off = src.offset || 0;
      const v = document.getElementById('video');
      const firstOrig = first ? first.start + off : NaN;
      const okFile = /part_\d+_\d+\.mp4$/.test(src.path);
      const okOffset = off > 1380 && off <= 1415;
      const okFirst = firstOrig >= 1413 && firstOrig < 1425;
      const okSeek = first && Math.abs(v.currentTime - first.start) < 1.0;
      console.log(`[Test] file=${src.path} offset=${off.toFixed(3)} words=${words.length} first='${first && first.text}' file=${first && first.start.toFixed(2)} orig=${firstOrig.toFixed(2)} videoCur=${v.currentTime.toFixed(2)} (orig ${(v.currentTime + off).toFixed(2)}) dur=${v.duration.toFixed(2)} curLabel=${document.getElementById('curTime').textContent}`);
      console.log(`[Test] ASSERT file=${okFile} offset=${okOffset} firstWord=${okFirst} seek=${!!okSeek}`);
      await SS.testShot('cache/ytpart_result.png');
      if (!(okFile && okOffset && okFirst && okSeek && words.length > 0)) throw new Error('ytpart assertions failed');
      api.notifyTestReady({ ok: true });
    } catch (err) {
      api.notifyTestError(err.stack || err.message);
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

