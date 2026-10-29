'use strict';

(function() {
  let modal = null;

  const TYPE_KEYS = ['core', 'story', 'exposition', 'application', 'comfort', 'challenge', 'gospel', 'prayer'];
  const TYPE_LABELS = {
    core: '핵심 메시지', story: '예화·이야기', exposition: '본문 해설', application: '삶의 적용',
    comfort: '위로·격려', challenge: '도전·결단', gospel: '복음 제시', prayer: '기도·축복'
  };
  const AUDIENCE_KEYS = ['all', 'members', 'seekers', 'youth'];
  const INTENSITY_LABELS = ['', '아주 잔잔(위로·묵상)', '잔잔', '균형', '힘 있게', '아주 강렬(선포·도전)'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function closeModal() {
    if (modal) {
      document.body.removeChild(modal);
      modal = null;
    }
  }

  async function openAiRecommend() {
    closeModal();
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('ss_ai_cond') || '{}') || {}; } catch (_) { saved = {}; }
    const defaultCond = {
      lengthRange: '60~90', minSec: 60, maxSec: 90, count: 4,
      intensity: 3, intensityNone: false, types: [], audience: 'all', extra: ''
    };
    const cond = { ...defaultCond, ...saved };
    if (!AUDIENCE_KEYS.includes(cond.audience)) cond.audience = 'all';
    if (!Array.isArray(cond.types)) cond.types = [];
    cond.types = cond.types.filter((t) => TYPE_KEYS.includes(t));

    modal.innerHTML = `
      <div class="modal-dialog ai-dialog">
        <h2>AI 쇼츠 추천</h2>
        <div class="modal-body ai-body">
          <div class="ai-conditions">
            <div class="ai-row">
              <span class="ai-row-label">길이 (초)</span>
              <div class="ai-chips" id="cond-length-chips">
                <div class="ai-chip ${cond.lengthRange === '30~60' ? 'active' : ''}" data-val="30~60">30~60</div>
                <div class="ai-chip ${cond.lengthRange === '60~90' ? 'active' : ''}" data-val="60~90">60~90</div>
                <div class="ai-chip ${cond.lengthRange === '90~120' ? 'active' : ''}" data-val="90~120">90~120</div>
                <div class="ai-chip ${cond.lengthRange === 'direct' ? 'active' : ''}" data-val="direct">직접</div>
              </div>
              <span id="cond-length-direct" class="ai-input-row" style="display:${cond.lengthRange === 'direct' ? 'flex' : 'none'};">
                <input type="number" id="cond-min-sec" class="ai-num-input" min="10" max="600" value="${cond.minSec}"> ~
                <input type="number" id="cond-max-sec" class="ai-num-input" min="10" max="600" value="${cond.maxSec}">
              </span>
              <span class="ai-row-label ai-row-label-inline">개수</span>
              <input type="number" id="cond-count" class="ai-num-input" min="2" max="8" value="${cond.count}">
              <span class="ai-row-label ai-row-label-inline">대상</span>
              <select id="cond-audience" class="ai-select">
                <option value="all" ${cond.audience === 'all' ? 'selected' : ''}>누구나</option>
                <option value="members" ${cond.audience === 'members' ? 'selected' : ''}>성도</option>
                <option value="seekers" ${cond.audience === 'seekers' ? 'selected' : ''}>새신자·전도</option>
                <option value="youth" ${cond.audience === 'youth' ? 'selected' : ''}>청년</option>
              </select>
            </div>
            <div class="ai-row">
              <span class="ai-row-label">강도</span>
              <input type="range" id="cond-intensity" class="ai-slider" min="1" max="5" step="1" value="${cond.intensity}" ${cond.intensityNone ? 'disabled' : ''}>
              <span id="cond-intensity-val" class="ai-slider-val"></span>
              <label class="ai-check"><input type="checkbox" id="cond-intensity-none" ${cond.intensityNone ? 'checked' : ''}> 상관없음</label>
            </div>
            <div class="ai-row">
              <span class="ai-row-label">내용 유형</span>
              <div class="ai-chips" id="cond-type-chips">
                ${TYPE_KEYS.map((k) => `<div class="ai-chip ${cond.types.includes(k) ? 'active' : ''}" data-val="${k}">${TYPE_LABELS[k]}</div>`).join('')}
              </div>
            </div>
            <div class="ai-row">
              <span class="ai-row-label">추가 요청</span>
              <input type="text" id="cond-extra" class="ss-input ai-text" placeholder="예: 우영우 이야기 부분" value="">
            </div>
            <div class="ai-row ai-url-row">
              <span class="ai-row-label">유튜브 주소</span>
              <input type="text" id="aiYoutubeUrl" class="ss-input ai-text" placeholder="https://www.youtube.com/watch?v=...">
              <button id="btnAiAnalyze" class="btn primary ai-analyze">분석</button>
            </div>
          </div>
          <div id="aiProgress" class="ai-progress"></div>
          <div id="aiResult" style="display:none; flex-direction:column; gap:10px;">
            <div id="aiUsageInfo" class="ai-usage"></div>
            <div id="aiSermonInfo" class="ai-sermon"></div>
            <div id="aiCandidates" style="display:flex; flex-direction:column; gap:10px;"></div>
          </div>
        </div>
        <div class="modal-footer" style="border-top: 1px solid #3c4048; padding-top: 15px; margin-top: 5px;">
          <button id="btnAiCancel" class="btn">닫기</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const btnAnalyze = modal.querySelector('#btnAiAnalyze');
    const inputUrl = modal.querySelector('#aiYoutubeUrl');
    const prog = modal.querySelector('#aiProgress');
    const resDiv = modal.querySelector('#aiResult');
    const sermonInfo = modal.querySelector('#aiSermonInfo');
    const usageInfo = modal.querySelector('#aiUsageInfo');
    const candDiv = modal.querySelector('#aiCandidates');
    
    // Condition event listeners
    const lengthChips = modal.querySelector('#cond-length-chips');
    lengthChips.addEventListener('click', e => {
      if (e.target.classList.contains('ai-chip')) {
        lengthChips.querySelectorAll('.ai-chip').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        const val = e.target.dataset.val;
        modal.querySelector('#cond-length-direct').style.display = (val === 'direct') ? 'flex' : 'none';
      }
    });

    const typeChips = modal.querySelector('#cond-type-chips');
    typeChips.addEventListener('click', e => {
      if (e.target.classList.contains('ai-chip')) {
        e.target.classList.toggle('active');
      }
    });

    const intensitySlider = modal.querySelector('#cond-intensity');
    const intensityVal = modal.querySelector('#cond-intensity-val');
    const intensityNone = modal.querySelector('#cond-intensity-none');
    const updIntensity = () => {
      intensitySlider.disabled = intensityNone.checked;
      intensityVal.textContent = intensityNone.checked ? '상관없음' : `${intensitySlider.value} ${INTENSITY_LABELS[intensitySlider.value]}`;
      intensityVal.classList.toggle('off', intensityNone.checked);
    };
    intensitySlider.oninput = updIntensity;
    intensityNone.onchange = updIntensity;
    updIntensity();
    modal.querySelector('#cond-extra').value = cond.extra || '';

    let currentUrl = '';

    modal.querySelector('#btnAiCancel').onclick = closeModal;
    inputUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btnAnalyze.disabled) btnAnalyze.click(); });
    const typeLabelMap = TYPE_LABELS;

    btnAnalyze.onclick = async () => {
      const url = inputUrl.value.trim();
      if (!url) return window.SS.toast('URL을 입력하세요.');
      currentUrl = url;

      // Save conditions
      const activeChip = lengthChips.querySelector('.ai-chip.active');
      const activeLength = activeChip ? activeChip.dataset.val : '60~90';
      let minS = 60, maxS = 90;
      if (activeLength === 'direct') {
        minS = parseInt(modal.querySelector('#cond-min-sec').value, 10);
        maxS = parseInt(modal.querySelector('#cond-max-sec').value, 10);
        if (!(minS > 0)) minS = 60;
        if (!(maxS > 0)) maxS = minS + 30;
        if (maxS < minS) { const t = minS; minS = maxS; maxS = t; }
        if (maxS === minS) maxS = minS + 10;
        modal.querySelector('#cond-min-sec').value = minS;
        modal.querySelector('#cond-max-sec').value = maxS;
      } else {
        const parts = activeLength.split('~');
        minS = parseInt(parts[0], 10);
        maxS = parseInt(parts[1], 10);
      }
      let cnt = parseInt(modal.querySelector('#cond-count').value, 10);
      if (!(cnt >= 2)) cnt = cnt > 0 ? 2 : 4;
      cnt = Math.min(8, cnt);
      modal.querySelector('#cond-count').value = cnt;

      const currentCond = {
        lengthRange: activeLength,
        minSec: minS,
        maxSec: maxS,
        count: cnt,
        intensity: parseInt(intensitySlider.value),
        intensityNone: intensityNone.checked,
        types: Array.from(typeChips.querySelectorAll('.ai-chip.active')).map(c => c.dataset.val),
        audience: modal.querySelector('#cond-audience').value,
        extra: modal.querySelector('#cond-extra').value.trim()
      };
      localStorage.setItem('ss_ai_cond', JSON.stringify(currentCond));

      btnAnalyze.disabled = true;
      resDiv.style.display = 'none';
      
      try {
        prog.textContent = '영상 정보를 불러오고 있습니다...';
        const info = await window.api.ytInfo(url);
        
        prog.textContent = '자동 자막을 분석하고 있습니다...';
        const subs = await window.api.ytAutoSubs(url);
        if (!subs || !subs.lines || subs.lines.length === 0) {
          prog.textContent = '';
          window.SS.toast('한국어 자동 자막이 없습니다. 영상 열기로 직접 작업하세요.');
          btnAnalyze.disabled = false;
          return;
        }

        prog.textContent = 'AI가 설교의 핵심 구간을 찾고 있습니다...';
        const s = await window.api.getSettings();
        const tpl = s.template || {};
        const model = s.aiModel || tpl.aiModel || undefined; // 없으면 ai.js 기본 모델
        prog.textContent = `AI가 설교의 핵심 구간을 찾고 있습니다… (자막 ${subs.lines.length}줄, 보통 10~30초)`;
        const res = await window.api.aiAnalyze(subs.lines, {
          videoTitle: info.title,
          description: info.description,
          model,
          churchName: tpl.churchName || '우리 교회',
          count: currentCond.count,
          minSec: currentCond.minSec,
          maxSec: currentCond.maxSec,
          intensity: currentCond.intensityNone ? 0 : currentCond.intensity,
          types: currentCond.types,
          audience: currentCond.audience,
          extra: currentCond.extra
        });

        prog.textContent = '';
        const usage = res.usage || {};
        usageInfo.textContent = `분석 모델: ${res.model || model || '기본'} · 토큰 ${usage.promptTokenCount || 0}/${usage.candidatesTokenCount || 0}`;
        const fmt = (t) => window.SS.edl.formatTime(t, false);
        const sm = res.sermon || {};
        sermonInfo.innerHTML = `
          <div><strong class="ai-accent">설교</strong> ${esc(sm.title)} · ${esc(sm.scripture)} · ${fmt(sm.start)} ~ ${fmt(sm.end)}</div>
          <div class="ai-sermon-msg">${esc(sm.mainMessage)}</div>
        `;

        candDiv.innerHTML = `<div><strong class="ai-accent">쇼츠 추천 후보 ${(res.candidates || []).length}개</strong></div>`;
        res.candidates.forEach(c => {
          const card = document.createElement('div');
          card.className = 'ai-card';
          const tagsHtml = (c.types || []).map(t => `<span class="ai-tag">${esc(typeLabelMap[t] || t)}</span>`).join('');
          const intensityHtml = c.intensity ? `<span class="ai-intensity">강도 ${Math.round(c.intensity)}/5</span>` : '';
          card.innerHTML = `
            <div class="ai-card-head">
              <span class="ai-score">${esc(c.score)}</span>
              <strong class="ai-card-title">${esc(c.shortsTitle)}</strong>
              <div style="display:flex; gap:5px;">
                <button class="btn sm preview-cand">미리보기</button>
                <button class="btn sm select-cand primary">이 구간으로 만들기</button>
              </div>
            </div>
            <div class="ai-card-meta">
              <span>${fmt(c.start)} ~ ${fmt(c.end)} <span class="ai-dim">(${Math.round(c.end - c.start)}초)</span></span>
              ${intensityHtml}${tagsHtml}
            </div>
            <div class="ai-card-quote">시작: ${esc(c.firstSentence)}<br>끝: ${esc(c.lastSentence)}</div>
            <div class="ai-card-reason">${esc(c.reason)}</div>
          `;
          card.querySelector('.select-cand').onclick = () => onSelectCandidate(c, res.sermon, s);
          card.querySelector('.preview-cand').onclick = () => onPreviewCandidate(c);
          candDiv.appendChild(card);
        });
        resDiv.style.display = 'flex';
      } catch (err) {
        prog.textContent = '분석 중 오류가 발생했습니다.';
        window.SS.toast('오류: ' + err.message);
        console.error(err);
      }
      btnAnalyze.disabled = false;
    };

    async function onPreviewCandidate(cand) {
      if (!currentUrl) return;
      try {
        const info = await window.api.ytResolve(currentUrl);
        // 유튜브 가져오기의 '구간 고르기' 플레이어를 그대로 쓴다 (후보 구간으로 미리 설정)
        if (window.SS.importer && window.SS.importer.openSectionPicker) {
          window.SS.importer.openSectionPicker(currentUrl, info, null, { start: cand.start, end: cand.end });
        }
      } catch (err) {
        window.SS.toast('미리보기 오류: ' + err.message);
      }
    }

    async function onSelectCandidate(cand, sermon, allSettings) {
      closeModal();
      
      const detail = { 
        url: currentUrl, 
        start: cand.start, 
        end: cand.end,
        title: cand.shortsTitle
      };
      
      // Use importYoutubePart if available
      if (window.SS.importer && window.SS.importer.importYoutubePart) {
        window.SS.importer.importYoutubePart(detail).catch(err => console.error(err));
      } else {
        window.dispatchEvent(new CustomEvent('ss:import-yt-req', { detail }));
      }

      // Wait for transcript-ready to do the cut and metadata
      const onReady = () => {
        window.removeEventListener('ss:transcript-ready', onReady);
        window.removeEventListener('ss:transcribe-cancelled', onCancel);
        
        // Push undo snapshot manually before massive changes
        if (window.SS.pushUndo) window.SS.pushUndo();

        const words = window.SS.state.words;
        const srcOff = (window.SS.state.source && window.SS.state.source.offset) || 0; // 단어 시각(파일 기준) + srcOff = 원본 시각
        
        // 후보의 첫 문장/끝 문장을 실제 단어와 맞춰 문장 경계에서 자르기 (자동 자막 시각은 대략적이라 ±10초 안에서 찾음)
        const norm = (t) => (t || '').replace(/[\s.,!?~…"'“”‘’·:;()\[\]-]/g, '');
        const bigrams = (t) => { const s = new Map(); for (let k = 0; k < t.length - 1; k++) { const g = t.slice(k, k + 2); s.set(g, (s.get(g) || 0) + 1); } return s; };
        const dice = (x, y) => { if (x.length < 2 || y.length < 2) return x === y ? 1 : 0; const A = bigrams(x), B = bigrams(y); let inter = 0; for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0); return (2 * inter) / (x.length - 1 + y.length - 1); };
        const first = norm(cand.firstSentence), last = norm(cand.lastSentence);
        let startIdx = -1, endIdx = -1, best = -1;
        for (let i = 0; i < words.length; i++) {
          if (Math.abs(words[i].start + srcOff - cand.start) > 10) continue;
          let t = ''; for (let k = i; k < words.length && t.length < first.length; k++) t += norm(words[k].text);
          const sc = dice(t.slice(0, first.length), first);
          if (sc > best) { best = sc; startIdx = i; }
        }
        if (best < 0.35) { startIdx = words.findIndex(w => w.start + srcOff >= cand.start - 1); }
        best = -1;
        for (let j = words.length - 1; j >= 0; j--) {
          if (Math.abs(words[j].end + srcOff - cand.end) > 10 || j < startIdx) continue;
          let t = ''; for (let k = j; k >= 0 && t.length < last.length; k--) t = norm(words[k].text) + t;
          const sc = dice(t.slice(-last.length), last);
          if (sc > best) { best = sc; endIdx = j; }
        }
        if (best < 0.35) { for (let j = words.length - 1; j >= 0; j--) if (words[j].end + srcOff <= cand.end + 1) { endIdx = j; break; } }
        if (startIdx < 0) startIdx = 0;
        if (endIdx < startIdx) endIdx = words.length - 1;
        const startWordId = words[startIdx].id, endWordId = words[endIdx].id;
        let inRange = false;
        let firstKeptWordIdx = -1;
        for (let i = 0; i < words.length; i++) {
          const w = words[i];
          if (w.id === startWordId) inRange = true;
          if (!inRange) {
            w.del = true;
          } else {
            if (firstKeptWordIdx === -1) firstKeptWordIdx = i;
          }
          if (w.id === endWordId) inRange = false;
        }

        // Apply autoclean
        window.SS.state.words = window.SS.edl.autoClean(window.SS.state.words, { maxGap: 1.0 });
        
        window.SS.state.meta = window.SS.state.meta || {};
        window.SS.state.meta.title = cand.shortsTitle;
        window.SS.state.meta.verse = sermon.scripture;
        
        // Speaker logic
        const speakers = allSettings.speakers || [];
        let speaker = allSettings.defaultSpeaker;
        if (!speaker && speakers.length > 0) speaker = speakers[0];
        window.SS.state.meta.speaker = speaker;
        
        document.getElementById('inpTitle').value = window.SS.state.meta.title;
        document.getElementById('inpVerse').value = window.SS.state.meta.verse;
        const selSpeaker = document.getElementById('selSpeaker');
        if (speaker) {
            selSpeaker.value = speaker;
            if (selSpeaker.value !== speaker) { // Not in list
                selSpeaker.value = '직접 입력';
                const inpSpeaker = document.getElementById('inpSpeaker');
                if (inpSpeaker) {
                  inpSpeaker.style.display = '';
                  inpSpeaker.value = speaker;
                }
            }
        }
        
        window.dispatchEvent(new Event('ss:template-changed'));
        window.dispatchEvent(new Event('ss:words-changed'));
        
        // Seek to first kept word
        if (firstKeptWordIdx !== -1) {
            const firstWord = words[firstKeptWordIdx];
            window.SS.preview.seek(firstWord.start);
            
            // Scroll transcript
            setTimeout(() => {
                const body = document.getElementById('transcriptBody');
                const span = body.querySelector(`span[data-wid="${firstWord.id}"]`);
                if (span) span.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }

        window.SS.toast('AI 편집 반영 완료');
      };
      const onCancel = () => {
        window.removeEventListener('ss:transcript-ready', onReady);
        window.removeEventListener('ss:transcribe-cancelled', onCancel);
      };
      window.addEventListener('ss:transcript-ready', onReady);
      window.addEventListener('ss:transcribe-cancelled', onCancel);
    }
  }

  function doAutoClean() {
    if (!window.SS.state.words) return;
    if (window.SS.tidy) { window.SS.tidy({ duplicates: true }); return; }   // 군말·되풀이·말 사이 공백 (지운 곳 표시)
    if (window.SS.pushUndo) window.SS.pushUndo();
    window.SS.state.words = window.SS.edl.autoClean(window.SS.state.words, { maxGap: 1.0 });
    window.dispatchEvent(new Event('ss:words-changed'));
    window.SS.toast('자동 정리 완료');
  }

  async function doAiCorrect() {
    if (!window.SS.state.words) return;
    const kept = window.SS.state.words.filter(w => !w.del);
    if (kept.length === 0) return window.SS.toast('교정할 단어가 없습니다.');
    if (kept.length > 400) return window.SS.toast('400단어 이내만 교정 가능합니다.'); // Chunking can be complex, let's keep it simple for now or split. Actually instruction says "chunks of <= 400 words".
    
    // Chunking
    const chunks = [];
    for (let i = 0; i < kept.length; i += 400) {
      chunks.push(kept.slice(i, i + 400));
    }

    try {
      window.SS.toast('AI 용어 교정 중...');
      const correctedChunks = [];
      for (const chunk of chunks) {
        const payload = chunk.map(w => ({ id: w.id, text: w.text }));
        const res = await window.api.aiCorrect(payload, window.SS.state.meta);
        correctedChunks.push(...res);
      }
      
      if (window.SS.pushUndo) window.SS.pushUndo();
      
      const changeMap = new Map();
      correctedChunks.forEach(c => changeMap.set(c.id, c.text));

      let changeCount = 0;
      for (const w of window.SS.state.words) {
        if (!w.del && changeMap.has(w.id)) {
          const newText = changeMap.get(w.id);
          if (w.text !== newText) {
            w._oldText = w.text;
            w.text = newText;
            changeCount++;
          }
        }
      }
      
      window.dispatchEvent(new Event('ss:words-changed'));
      window.SS.toast(`교정 완료 (${changeCount} 단어 수정됨)`);
    } catch(err) {
      window.SS.toast('교정 오류: ' + err.message);
      console.error(err);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btnAi = document.getElementById('btnAiRecommend');
    if (btnAi) btnAi.addEventListener('click', openAiRecommend);
    
    const btnAutoClean = document.getElementById('btnAutoClean');
    if (btnAutoClean) btnAutoClean.addEventListener('click', doAutoClean);

    const btnAiCorrect = document.getElementById('btnAiCorrect');
    if (btnAiCorrect) btnAiCorrect.addEventListener('click', doAiCorrect);

    window.addEventListener('ss:source-loaded', () => {
      if (btnAutoClean) btnAutoClean.disabled = false;
      if (btnAiCorrect) btnAiCorrect.disabled = false;
    });
  });
})();

  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail === 'ai') {
      try {
        console.log("Running AI automation...");
        document.getElementById('btnAiRecommend').click();
        await new Promise(r => setTimeout(r, 800));
        
        // Set conditions: 60~90초
        const chips = document.getElementById('cond-length-chips');
        const chip6090 = Array.from(chips.children).find(c => c.dataset.val === '60~90');
        if (chip6090) chip6090.click();

        // 강도 5
        const slider = document.getElementById('cond-intensity');
        slider.value = 5;
        slider.dispatchEvent(new Event('input'));

        // 유형: 도전·복음
        const typeChips = document.getElementById('cond-type-chips');
        const chipChallenge = Array.from(typeChips.children).find(c => c.textContent.includes('도전'));
        const chipGospel = Array.from(typeChips.children).find(c => c.textContent.includes('복음'));
        if (chipChallenge) chipChallenge.click();
        if (chipGospel) chipGospel.click();

        const inputUrl = document.getElementById('aiYoutubeUrl');
        inputUrl.value = 'https://www.youtube.com/watch?v=9Tmjg3ESEyc';
        document.getElementById('btnAiAnalyze').click();
        
        // Wait until candidates appear
        console.log("Waiting for AI candidates...");
        const candDiv = document.getElementById('aiCandidates');
        let attempts = 0;
        while (candDiv.children.length <= 1 && attempts < 120) { // candidates + header
          await new Promise(r => setTimeout(r, 1000));
          attempts++;
        }
        
        if (candDiv.children.length <= 1) throw new Error("AI Candidates failed to load in time");

        console.log("Taking dialog screenshot...");
        await window.SS.testShot('cache/step8_ai_dialog.png');
        
        // Choose top candidate (first card after header)
        const candBtn = candDiv.querySelector('.select-cand');
        console.log("Selecting candidate...");
        candBtn.click();
        
        // Wait for transcript ready (transcribing 2 min range)
        console.log("Waiting for transcription...");
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Transcription timeout")), 180000);
          const onR = () => {
            clearTimeout(timeout);
            window.removeEventListener('ss:transcript-ready', onR);
            resolve();
          };
          window.addEventListener('ss:transcript-ready', onR);
        });
        
        // Wait for composition to finish and UI to settle
        await new Promise(r => setTimeout(r, 2000));
        
        const vEl = document.getElementById('video');
        console.log(`[Test] AI path opened video: src=${decodeURIComponent(vEl.src)} duration=${vEl.duration.toFixed(1)} words=${window.SS.state.words.length} kept=${window.SS.state.words.filter(w => !w.del).length} speaker=${(window.SS.state.meta || {}).speaker}`);
        console.log("Taking result screenshot...");
        await window.SS.testShot('cache/step8_result.png');
        
        window.api.notifyTestReady({ info: 'done' });
      } catch(e) {
         window.api.notifyTestError(e.stack);
      }
    }
  });
