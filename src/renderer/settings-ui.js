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
          <div class="settings-tab" data-tab="youtube">유튜브</div>
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
            <div class="settings-row">
              <label>우리 교회에서 자주 쓰는 말 (쉼표로 구분, 선택)</label>
              <input type="text" id="setChurchTerms" value="${esc(s.churchTerms || '')}" placeholder="예: 구역장, 셀모임, 권사, 사관, 영문">
              <div class="settings-note">교단 직분·교회 이름처럼 자동 자막이 자주 틀리는 말을 넣으면 음성 인식과 AI 편집이 더 정확해집니다.</div>
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

          <div class="settings-pane" data-pane="youtube">
            <div class="settings-row">
              <label>유튜브 계정</label>
              <div style="display:flex; gap:8px; align-items:center;">
                <span id="ytState" class="settings-note" style="flex:1">확인 중…</span>
                <button id="btnYtSignIn" class="btn sm primary">구글로 로그인</button>
                <button id="btnYtSignOut" class="btn sm">로그아웃</button>
              </div>
              <div class="settings-note">브라우저에서 구글 공식 화면으로 로그인합니다. 이 앱은 비밀번호를 받지 않습니다.<br>
                지금은 시험 운영 중이라 <b>미리 등록한 구글 계정만</b> 로그인됩니다. 브라우저에 '액세스 차단됨'이 나오면 개발자에게 구글 이메일 등록을 요청하거나, 아래 [고급]에 우리 교회 클라이언트를 넣으세요.<br>
                교회 채널에 올리려면 계정 선택 화면에서 그 채널(브랜드 계정)을 고르세요. 목록에 없으면 채널 소유자가 로그인해야 합니다.</div>
            </div>
            <div class="settings-row inline">
              <input type="checkbox" id="ytAuto">
              <label for="ytAuto" style="font-size:13px; color:var(--text-2)">영상을 만들면 바로 유튜브에 올리기</label>
            </div>
            <div class="settings-row">
              <label>공개 범위</label>
              <select id="ytPrivacy">
                <option value="unlisted">일부공개 (링크가 있는 사람만, 확인 후 공개로 바꾸기 권장)</option>
                <option value="private">비공개 (나만)</option>
                <option value="public">공개</option>
              </select>
            </div>
            <details class="settings-row">
              <summary style="cursor:pointer; font-size:12px; color:var(--muted)">고급: 내 구글 OAuth 클라이언트 쓰기</summary>
              <div class="settings-note" style="margin:6px 0">앱에 기본 클라이언트가 없거나, 업로드한 영상이 계속 '비공개'로 묶이면 교회 구글 계정으로 만든 클라이언트를 넣으세요.
                Google Cloud 에서 <b>YouTube Data API v3</b> 사용 설정 → 사용자 인증 정보 → OAuth 클라이언트 ID(<b>데스크톱 앱</b>) 만들기.</div>
              <div style="display:flex; gap:6px; margin-bottom:6px"><button class="btn sm" id="btnYtApi">API 사용 설정 페이지</button><button class="btn sm" id="btnYtConsole">사용자 인증 정보 페이지</button></div>
              <input type="text" id="ytClientId" placeholder="클라이언트 ID (….apps.googleusercontent.com)" style="width:100%; margin-bottom:6px">
              <input type="password" id="ytClientSecret" placeholder="클라이언트 보안 비밀번호" style="width:100%; margin-bottom:6px">
              <button class="btn sm" id="btnYtClientSave">클라이언트 저장</button>
            </details>
            <div id="ytMsg" class="test-result"></div>
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
    showTab(['church', 'design', 'youtube'].includes(tab) ? tab : 'ai');

    // 유튜브 (이 탭의 바꾼 값은 [저장]을 누르지 않아도 바로 적용된다)
    const cleanIpc = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    const ytMsg = (t, ok) => { const el = $('#ytMsg'); el.textContent = t || ''; el.className = 'test-result' + (ok === true ? ' ok' : ok === false ? ' error' : ' busy'); };
    const ytRender = (st) => {
      $('#ytState').textContent = !st.hasClient ? '클라이언트 없음 (아래 고급에서 넣어 주세요)' : st.loggedIn ? '로그인됨' + (st.channel ? ' · ' + st.channel : '') : '로그인 안 됨';
      $('#btnYtSignIn').style.display = st.loggedIn ? 'none' : '';
      $('#btnYtSignIn').disabled = !st.hasClient;
      $('#btnYtSignOut').style.display = st.loggedIn ? '' : 'none';
      $('#ytAuto').checked = st.autoUpload;
      $('#ytPrivacy').value = st.privacy;
      if (st.ownClient && !$('#ytClientId').value) $('#ytClientId').placeholder = '저장됨: ' + st.clientIdSuffix + '…';
    };
    api.ytupStatus().then(ytRender).catch((e) => ytMsg(cleanIpc(e), false));
    $('#btnYtSignIn').onclick = async () => {
      ytMsg('브라우저에서 구글 로그인을 마쳐 주세요… (5분 안에)');
      try { ytRender(await api.ytupSignIn()); ytMsg('유튜브에 로그인했습니다.', true); } catch (e) { ytMsg(cleanIpc(e), false); }
    };
    $('#btnYtSignOut').onclick = async () => { ytRender(await api.ytupSignOut()); ytMsg('로그아웃했습니다.', true); };
    $('#ytAuto').onchange = async (e) => ytRender(await api.ytupSetOptions({ autoUpload: e.target.checked }));
    $('#ytPrivacy').onchange = async (e) => ytRender(await api.ytupSetOptions({ privacy: e.target.value }));
    $('#btnYtApi').onclick = () => api.ytupOpenLink('api');
    $('#btnYtConsole').onclick = () => api.ytupOpenLink('console');
    $('#btnYtClientSave').onclick = async () => {
      try {
        ytRender(await api.ytupSetOptions({ clientId: $('#ytClientId').value, clientSecret: $('#ytClientSecret').value }));
        $('#ytClientSecret').value = '';
        ytMsg('클라이언트를 저장했습니다. 이제 [구글로 로그인]을 누르세요.', true);
      } catch (e) { ytMsg(cleanIpc(e), false); }
    };

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
        inp.placeholder = '예: 홍길동 목사';
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
        churchTerms: $('#setChurchTerms').value.split(/[,，]/).map((x) => x.trim()).filter(Boolean).join(', '),
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
