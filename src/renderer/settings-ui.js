'use strict';
// 설정 창: [AI] 키·모델·연결 확인, [교회 정보] 교회 이름·로고·설교자 목록·기본 설교자
(function () {
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  let modal = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MODELS = [
    ['gemini-3.5-flash', 'gemini-3.5-flash (빠르고 저렴, 추천)'],
    ['gemini-3.1-pro-preview', 'gemini-3.1-pro-preview (더 정확, 느림)'],
  ];

  function close() {
    if (modal) modal.remove();
    modal = null;
  }

  async function openSettings(tab) {
    const s = await api.getSettings();
    close();
    const t = s.template || {};
    const speakers = (Array.isArray(s.speakers) ? s.speakers : t.speakers || []).slice();
    let defaultSpeaker = s.defaultSpeaker || t.defaultSpeaker || speakers[0] || '';
    let logoPath = t.logoPath || '';
    const curModel = t.aiModel || MODELS[0][0];
    const keyState = s.hasApiKey ? '저장됨 (••••' + esc(s.apiKeySuffix) + ')' : (s.hasEnvApiKey ? '환경변수 GEMINI_API_KEY 사용 중' : '없음');
    const modelOpts = MODELS.some((m) => m[0] === curModel) ? MODELS : MODELS.concat([[curModel, curModel]]);

    modal = document.createElement('div');
    modal.className = 'modal-overlay settings-overlay';
    modal.innerHTML = `
      <div class="modal-dialog settings-dialog">
        <div class="modal-header">
          <h3>설정</h3>
          <button class="modal-close" title="닫기">&times;</button>
        </div>
        <div class="settings-tabs">
          <div class="settings-tab" data-tab="ai">AI</div>
          <div class="settings-tab" data-tab="church">교회 정보</div>
          <div class="settings-tab" data-tab="design">디자인</div>
        </div>
        <div class="settings-content">
          <div class="settings-pane" data-pane="ai">
            <div class="settings-row">
              <label>Gemini API 키</label>
              <input type="password" id="setGeminiKey" autocomplete="off" placeholder="${s.hasApiKey ? '새 키로 바꿀 때만 입력' : '복사한 API 키를 붙여넣으세요'}">
              <div class="settings-note">현재: ${keyState} · 키 만들기: https://aistudio.google.com/apikey</div>
            </div>
            <div class="settings-row">
              <label>AI 모델</label>
              <select id="setAiModel">${modelOpts.map((m) => `<option value="${esc(m[0])}">${esc(m[1])}</option>`).join('')}</select>
              <div class="settings-note">현재 사용 모델: <b id="curModelLabel">${esc(curModel)}</b></div>
            </div>
            <div class="settings-row inline">
              <button id="btnTestAi" class="btn sm">연결 확인</button>
              <span id="testAiResult" class="test-result"></span>
            </div>
          </div>

          <div class="settings-pane" data-pane="church">
            <div class="settings-row">
              <label>교회 이름 (쇼츠 아래쪽에 표시)</label>
              <input type="text" id="setChurchName" value="${esc(t.churchName || '')}" placeholder="예: 은혜교회">
            </div>
            <div class="settings-row">
              <label>로고 이미지</label>
              <div class="logo-preview-container">
                <div class="logo-preview"><img id="logoImg" alt=""></div>
                <div class="logo-buttons">
                  <button id="btnSelectLogo" class="btn sm">이미지 선택</button>
                  <button id="btnResetLogo" class="btn sm">기본 로고</button>
                  <div class="settings-note" id="logoName"></div>
                </div>
              </div>
            </div>
            <div class="settings-row">
              <label>설교자 목록 (이름 직분)</label>
              <div id="speakerList" class="speaker-list-editor"></div>
              <button id="btnAddSpeaker" class="btn sm add-speaker">+ 설교자 추가</button>
            </div>
            <div class="settings-row">
              <label>기본 설교자</label>
              <select id="setDefaultSpeaker"></select>
            </div>
          </div>

          <div class="settings-pane" data-pane="design">
            <div class="settings-row">
              <label>쇼츠 테마</label>
              <div style="display:flex; gap: 8px;">
                <select id="setThemeSelect" style="flex:1;"></select>
                <button id="btnSetEditTheme" class="btn sm">테마 편집기 열기</button>
              </div>
              <div class="settings-note">각 교회만의 디자인을 직접 편집할 수 있습니다.</div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="btnSetCancel" class="btn">취소</button>
          <button id="btnSetSave" class="btn primary">저장</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const $ = (sel) => modal.querySelector(sel);

    // 탭
    function showTab(name) {
      modal.querySelectorAll('.settings-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
      modal.querySelectorAll('.settings-pane').forEach((x) => x.classList.toggle('active', x.dataset.pane === name));
    }
    modal.querySelectorAll('.settings-tab').forEach((x) => { x.onclick = () => showTab(x.dataset.tab); });
    showTab(tab === 'church' ? 'church' : (tab === 'design' ? 'design' : 'ai'));

    // 디자인
    const themeSel = $('#setThemeSelect');
    const themes = await api.listThemes();
    themeSel.innerHTML = themes.map(t => `<option value="${esc(t.id)}" ${t.id === s.activeThemeId ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    $('#btnSetEditTheme').onclick = () => {
      close();
      if (SS.openThemeEditor) SS.openThemeEditor(themeSel.value);
    };

    // AI
    const modelSel = $('#setAiModel');
    modelSel.value = curModel;
    $('#btnTestAi').onclick = async () => {
      const out = $('#testAiResult');
      const btn = $('#btnTestAi');
      btn.disabled = true;
      out.className = 'test-result busy';
      out.textContent = '확인 중...';
      try {
        const typed = $('#setGeminiKey').value.trim();
        if (typed) {
          // 새로 입력한 키는 먼저 암호화해 저장한 뒤 시험한다
          await api.saveSettings({ geminiApiKey: typed, template: { aiModel: modelSel.value } });
          $('#setGeminiKey').value = '';
          $('#setGeminiKey').placeholder = '저장됨';
        }
        const r = await api.testAiConnection(modelSel.value);
        out.className = 'test-result ' + (r.ok ? 'ok' : 'error');
        out.textContent = (r.ok ? '✓ ' : '✗ ') + r.message;
      } catch (e) {
        out.className = 'test-result error';
        out.textContent = '✗ ' + e.message;
      }
      btn.disabled = false;
    };

    // 로고
    async function showLogo(p, dataUrl) {
      const url = dataUrl || (await api.getLogoDataUrl(p));
      if (!modal) return;
      $('#logoImg').src = url || '';
      const name = p ? String(p).split(/[\\/]/).pop() : '';
      $('#logoName').textContent = !p || /^assets[\\/]/.test(p) ? '기본 로고 (' + name + ')' : name;
    }
    showLogo(logoPath);
    $('#btnSelectLogo').onclick = async () => {
      const r = await api.chooseLogo();
      if (r && r.path) { logoPath = r.path; showLogo(r.path, r.dataUrl); }
    };
    $('#btnResetLogo').onclick = () => { logoPath = 'assets/images/logo-default.png'; showLogo(logoPath); };

    // 설교자
    const list = $('#speakerList');
    const defSel = $('#setDefaultSpeaker');
    function renderSpeakers() {
      list.innerHTML = '';
      speakers.forEach((sp, i) => {
        const row = document.createElement('div');
        row.className = 'speaker-item';
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = sp;
        inp.placeholder = '예: 홍길동 사관';
        inp.oninput = () => {
          const wasDefault = defaultSpeaker === speakers[i];
          speakers[i] = inp.value;
          if (wasDefault) defaultSpeaker = inp.value;
          renderDefault();
        };
        const del = document.createElement('button');
        del.className = 'btn sm';
        del.textContent = '삭제';
        del.onclick = () => { speakers.splice(i, 1); renderSpeakers(); };
        row.append(inp, del);
        list.appendChild(row);
      });
      renderDefault();
    }
    function renderDefault() {
      const names = speakers.map((x) => x.trim()).filter(Boolean);
      if (!names.includes(defaultSpeaker)) defaultSpeaker = names[0] || '';
      defSel.innerHTML = names.length ? names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('') : '<option value="">(설교자를 추가하세요)</option>';
      defSel.value = defaultSpeaker;
    }
    defSel.onchange = () => { defaultSpeaker = defSel.value; };
    $('#btnAddSpeaker').onclick = () => {
      speakers.push('');
      renderSpeakers();
      const inputs = list.querySelectorAll('input');
      inputs[inputs.length - 1].focus();
    };
    renderSpeakers();

    // 닫기 / 저장
    $('#btnSetCancel').onclick = close;
    $('.modal-close').onclick = close;
    $('#btnSetSave').onclick = async () => {
      const names = speakers.map((x) => x.trim()).filter(Boolean);
      const newS = {
        template: {
          aiModel: modelSel.value,
          churchName: $('#setChurchName').value.trim() || '우리 교회',
          logoPath,
        },
        speakers: names,
        defaultSpeaker: names.includes(defaultSpeaker) ? defaultSpeaker : names[0] || '',
      };
      const key = $('#setGeminiKey').value.trim();
      if (key) newS.geminiApiKey = key;
      try {
        await api.saveSettings(newS);
        if (SS.showToast) SS.showToast('설정이 저장되었습니다.');
        close();
      } catch (e) {
        alert('저장 실패: ' + e.message);
      }
    };
    return modal;
  }

  SS.openSettings = openSettings;
  const btn = document.getElementById('btnSettings');
  if (btn) btn.addEventListener('click', () => openSettings());
})();
