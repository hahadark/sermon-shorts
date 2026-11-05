'use strict';
// 설정 창: [일반] 최근 유튜브 링크·원본 없을 때·자동 저장·업데이트·폴더, [편집] 새 편집 기본값, [AI 대화] 편집 조건 기본값,
//         [AI] 키·모델·연결 확인, [교회 정보] 교회 이름·로고·설교자 목록·기본 설교자, [디자인], [유튜브] 업로드
(function () {
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  let modal = null;
  let offUpdate = null;   // 업데이트 상태 구독 (창을 닫을 때 끊는다)

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MODELS = [
    ['gemini-3.5-flash', 'gemini-3.5-flash (빠르고 저렴, 추천)'],
    ['gemini-3.1-pro-preview', 'gemini-3.1-pro-preview (더 정확, 느림)'],
  ];

  function close() {
    if (offUpdate) { try { offUpdate(); } catch (_) { /* */ } offUpdate = null; }
    if (modal) modal.remove();
    modal = null;
  }

  /** 탭이 늘어 창을 넓히고, 내용이 길면 창 안에서 스크롤 */
  function injectStyles() {
    if (document.getElementById('ss-settings-extra')) return;
    const st = document.createElement('style');
    st.id = 'ss-settings-extra';
    st.textContent = `
.settings-overlay .settings-dialog { width: 720px; max-width: calc(100vw - 40px); }
.settings-overlay .settings-tabs { flex-wrap: wrap; }
.settings-overlay .settings-tab { padding: 8px 13px; white-space: nowrap; }
.settings-overlay .settings-content { min-height: 360px; max-height: calc(100vh - 230px); overflow-y: auto; padding-right: 4px; }
.settings-overlay input[type=number] { background: #f8fafc; border: 1px solid #e6ebf2; color: #0f172a; padding: 5px 6px; border-radius: 4px; font-family: var(--font); font-size: 13px; }
.settings-overlay .settings-row.inline label { font-weight: 400; }`;
    document.head.appendChild(st);
  }

  async function openSettings(tab) {
    injectStyles();
    const s = await api.getSettings();
    close();
    const t = s.template || {};
    const speakers = (Array.isArray(s.speakers) ? s.speakers : t.speakers || []).slice();
    let defaultSpeaker = s.defaultSpeaker || t.defaultSpeaker || speakers[0] || '';
    let logoPath = t.logoPath || '';
    const curModel = t.aiModel || MODELS[0][0];
    const keyState = s.hasApiKey ? '저장됨 (••••' + esc(s.apiKeySuffix) + ')' : (s.hasEnvApiKey ? '환경변수 GEMINI_API_KEY 사용 중' : '없음');
    const modelOpts = MODELS.some((m) => m[0] === curModel) ? MODELS : MODELS.concat([[curModel, curModel]]);
    const asv = s.autosave || {}, ed = s.editDefaults || {};
    const cp = SS.chatPlan, chat = SS.chatPrefs ? SS.chatPrefs.get() : null;
    const opt = (v, cur, label) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
    const chk = (id, on, label, note) => `<div class="settings-row inline"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><label for="${id}" style="font-size:13px; color:var(--text-2)">${label}</label></div>${note ? `<div class="settings-note" style="margin:-4px 0 8px 24px">${note}</div>` : ''}`;
    const numIn = (id, v, min, max, step, unit, w) => `<input type="number" id="${id}" value="${esc(v)}" min="${min}" max="${max}" step="${step}" style="width:${w || 80}px"> <span class="settings-note" style="display:inline">${unit || ''}</span>`;

    modal = document.createElement('div');
    modal.className = 'modal-overlay settings-overlay';
    modal.innerHTML = `
      <div class="modal-dialog settings-dialog">
        <div class="modal-header">
          <h3>설정</h3>
          <button class="modal-close" title="닫기">&times;</button>
        </div>
        <div class="settings-tabs">
          <div class="settings-tab" data-tab="general">일반</div>
          <div class="settings-tab" data-tab="edit">편집</div>
          ${chat ? '<div class="settings-tab" data-tab="chat">AI 대화</div>' : ''}
          <div class="settings-tab" data-tab="ai">AI</div>
          <div class="settings-tab" data-tab="church">교회 정보</div>
          <div class="settings-tab" data-tab="design">디자인</div>
          <div class="settings-tab" data-tab="youtube">유튜브</div>
        </div>
        <div class="settings-content">
          <div class="settings-pane" data-pane="general">
            <div class="settings-row">
              <label>최근 작업한 유튜브 링크</label>
              <div>보존 개수 ${numIn('setRecentMax', s.recentYoutubeMax != null ? s.recentYoutubeMax : 5, 0, 50, 1, '개 (0 = 보존 안 함)')}</div>
              <div id="recentList" class="recent-list" style="margin-top:6px"></div>
              <div class="settings-note">AI 편집 대화의 시작 화면과 [유튜브에서 가져오기] 창에 최근 영상이 보여 바로 다시 불러올 수 있습니다.</div>
            </div>
            <div class="settings-row">
              <label>원본 영상이 없을 때 (캐시를 지웠거나 파일을 옮김)</label>
              <select id="setSourceMissing">${opt('auto', s.sourceMissing, '유튜브 영상이면 자동으로 다시 받기 (기본)')}${opt('ask', s.sourceMissing, '다시 받기 전에 묻기 (다시 받기 / 파일 찾기)')}</select>
              <div class="settings-note">유튜브에서 받은 영상은 같은 부분을 다시 받아 자막·컷을 그대로 이어서 편집합니다. 다운로드에 실패하거나 유튜브 주소가 없으면 파일을 직접 찾을 수 있습니다.</div>
            </div>
            <div class="settings-row">
              <label>자동 저장</label>
              ${chk('setAsvOn', asv.enabled !== false, '편집을 자동으로 저장하기 (갑자기 꺼져도 다시 열기)')}
              <div class="settings-grid" style="display:grid; grid-template-columns:auto 1fr; gap:6px 10px; align-items:center; font-size:13px">
                <span>작업본 남기는 간격</span><span>${numIn('setAsvEvery', asv.everyMin || 2, 1, 60, 1, '분마다')}</span>
                <span>영상마다 작업본</span><span>${numIn('setAsvVersions', asv.maxVersions || 30, 1, 200, 1, '개까지')}</span>
                <span>보관할 영상</span><span>${numIn('setAsvVideos', asv.maxVideos || 40, 1, 500, 1, '개까지')}</span>
                <span>보관 기간</span><span>${numIn('setAsvDays', asv.keepDays || 60, 1, 3650, 1, '일 지나면 지움')}</span>
              </div>
              <div style="margin-top:6px"><button class="btn sm" id="btnOpenAsvDir">자동 저장 폴더 열기</button></div>
            </div>
            <div class="settings-row">
              <label>앱 업데이트</label>
              ${chk('setAutoUpdate', s.autoUpdate !== false, '새 버전을 자동으로 확인하고 받아 두기', '끄면 아래 [지금 확인]을 눌렀을 때만 확인합니다.')}
              <div style="display:flex; gap:8px; align-items:center"><button class="btn sm" id="btnUpdCheck">지금 확인</button><span id="updState" class="settings-note" style="margin:0"></span></div>
            </div>
            <div class="settings-row">
              <label>폴더</label>
              <div style="display:flex; gap:6px; align-items:center; font-size:13px"><span style="flex:none">배경음악 보관함</span><span id="bgmDirLabel" class="settings-note" style="flex:1; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap"></span>
                <button class="btn sm" id="btnBgmDirOpen">열기</button><button class="btn sm" id="btnBgmDirChange">바꾸기</button></div>
              <div style="margin-top:6px"><button class="btn sm" id="btnOpenUserData">설정·데이터 폴더 열기</button></div>
            </div>
          </div>

          <div class="settings-pane" data-pane="edit">
            <div class="settings-note" style="margin-bottom:10px">새로 자막을 만들거나 AI 대화로 편집을 시작할 때 쓰는 기본값입니다. 지금 편집만 바꾸려면 자막 편집 칸의 [설정]을 쓰세요.</div>
            <div class="settings-row">
              <label>자막 한 줄 최대 글자 수</label>
              <div>${numIn('setEdMax', ed.maxLineChars || 14, 1, 200, 1, '자 (공백 제외)')}</div>
              ${chk('setEdSemantic', ed.semanticBreaks !== false, '의미 단위로 나누기', '글자 수만 채워 끊지 않고 문장 끝·쉼·이음말에서 끊습니다.')}
              ${chk('setEdSplit', ed.splitLongWords !== false, '긴 단어도 나누기')}
              ${chk('setPreviewProxy', s.previewProxy !== false, '부드러운 미리보기 (미리보기용 영상을 뒤에서 만들어 지운 곳을 건너뛸 때 끊기지 않게 · 내보내기는 원본)')}
            </div>
            <div class="settings-row">
              <label>컷 여백·페이드</label>
              <div style="font-size:13px">앞 ${numIn('setEdPadB', ed.padBefore != null ? ed.padBefore : 0.1, 0, 5, 0.01, '초', 70)} &nbsp; 뒤 ${numIn('setEdPadA', ed.padAfter != null ? ed.padAfter : 0.15, 0, 5, 0.01, '초', 70)} &nbsp; 페이드 ${numIn('setEdFade', ed.fadeMs != null ? ed.fadeMs : 10, 0, 1000, 1, 'ms', 70)}</div>
              <div class="settings-note">컷 앞뒤로 남길 소리 여백과, 컷 사이 소리가 튀지 않게 하는 짧은 페이드입니다.</div>
            </div>
            <div class="settings-row">
              <label>음성 인식 뒤</label>
              ${chk('setEdTidy', ed.autoTidy !== false, '군말(음·어·아)·말 사이 공백을 자동으로 지우기', '지운 곳은 노란 표시로 보이고 누르면 되살립니다.')}
            </div>
            ${chk('setEdApplyNow', false, '지금 열린 편집에도 바로 적용하기')}
          </div>

          ${chat ? `<div class="settings-pane" data-pane="chat">
            <div class="settings-note" style="margin-bottom:10px">AI 편집 대화의 [편집 조건] 기본값입니다. 대화 화면에서 버튼으로 바꾸면 여기에도 그대로 반영됩니다.</div>
            <div class="settings-row"><label>쇼츠 길이</label><select id="setChatLen">${(cp ? cp.LENGTHS : [[120, '2분']]).map(([v, l]) => opt(v, chat.length, l)).join('')}</select></div>
            <div class="settings-row"><label>추천받을 후보 수</label><select id="setChatCount">${(cp ? cp.COUNTS : [3]).map((v) => opt(v, chat.count || 3, v + '곳')).join('')}</select></div>
            <div class="settings-row"><label>보는 사람</label><select id="setChatAud">${(cp ? cp.AUDIENCES : [['all', '모두']]).map(([v, l]) => opt(v, chat.audience || 'all', l)).join('')}</select></div>
            <div class="settings-row"><label>다듬기 (켜 둔 것은 매번 지킵니다)</label>
              ${(cp ? cp.STYLES : []).map(([k, l]) => chk('setChat_' + k, chat[k] !== false, esc(l), esc((SS.chatPrefs.tips()[k]) || ''))).join('')}
            </div>
          </div>` : ''}

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
    showTab(['general', 'edit', 'chat', 'ai', 'church', 'design', 'youtube'].includes(tab) && modal.querySelector(`[data-tab="${tab}"]`) ? tab : 'general');

    // ---- 일반: 최근 링크 (지우기는 바로 적용) ----
    function renderRecent(items) {
      const box = $('#recentList');
      if (!items || !items.length) { box.innerHTML = '<div class="settings-note" style="margin:0">아직 보존된 링크가 없습니다.</div>'; return; }
      box.innerHTML = items.map((r, i) => `<div style="display:flex; gap:6px; align-items:center; padding:3px 0; font-size:13px; border-bottom:1px solid var(--line, #eee)">
          <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${esc(r.url)}">${esc(r.title || r.url)}</span>
          <button class="btn sm ghost" data-rm="${i}" title="이 링크 지우기">지우기</button></div>`).join('') +
        '<div style="margin-top:6px"><button class="btn sm" id="btnRecentClear">모두 지우기</button></div>';
      box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => renderRecent(await api.recentRemove(items[+b.dataset.rm].url)); });
      $('#btnRecentClear').onclick = async () => { if (confirm('최근 유튜브 링크를 모두 지울까요?')) renderRecent(await api.recentClear()); };
    }
    renderRecent(s.recentYoutube || []);
    // ---- 일반: 폴더 ----
    const showBgmDir = async () => { try { const d = await api.getBgmDir(); $('#bgmDirLabel').textContent = d; $('#bgmDirLabel').title = d; } catch (_) { /* */ } };
    showBgmDir();
    $('#btnBgmDirOpen').onclick = () => api.openAppPath('bgm');
    $('#btnBgmDirChange').onclick = async () => { const d = await api.chooseBgmDir(); if (d) showBgmDir(); };
    $('#btnOpenAsvDir').onclick = () => api.openAppPath('autosave');
    $('#btnOpenUserData').onclick = () => api.openAppPath('userData');
    // ---- 일반: 업데이트 ----
    const UPD = { idle: '확인 전', checking: '확인 중…', latest: '최신 버전입니다', downloading: '새 버전 받는 중', ready: '새 버전이 준비됐습니다 (닫을 때 설치)', portable: '새 버전이 나왔습니다', error: '확인하지 못했습니다', off: '개발 실행 중이라 확인하지 않습니다' };
    const showUpd = (st) => { if (!st || !modal) return; $('#updState').textContent = `지금 버전 ${st.current || ''} · ${UPD[st.state] || st.state}${st.version ? ' ' + st.version : ''}${st.percent && st.state === 'downloading' ? ' ' + st.percent + '%' : ''}${st.state === 'error' && st.message ? ' (' + st.message + ')' : ''}`; };
    api.updateGet().then(showUpd).catch(() => {});
    offUpdate = api.onUpdateStatus ? api.onUpdateStatus(showUpd) : null;
    $('#btnUpdCheck').onclick = async () => { $('#updState').textContent = '확인 중…'; try { showUpd(await api.updateCheck()); } catch (e) { $('#updState').textContent = '확인하지 못했습니다: ' + cleanIpc(e); } };

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
        // 일반
        recentYoutubeMax: Number($('#setRecentMax').value),
        sourceMissing: $('#setSourceMissing').value,
        autoUpdate: $('#setAutoUpdate').checked,
        previewProxy: $('#setPreviewProxy').checked,
        autosave: { enabled: $('#setAsvOn').checked, everyMin: Number($('#setAsvEvery').value), maxVersions: Number($('#setAsvVersions').value), maxVideos: Number($('#setAsvVideos').value), keepDays: Number($('#setAsvDays').value) },
        // 편집 기본값
        editDefaults: { maxLineChars: Number($('#setEdMax').value), semanticBreaks: $('#setEdSemantic').checked, splitLongWords: $('#setEdSplit').checked,
          padBefore: Number($('#setEdPadB').value), padAfter: Number($('#setEdPadA').value), fadeMs: Number($('#setEdFade').value), autoTidy: $('#setEdTidy').checked },
      };
      const applyNow = $('#setEdApplyNow').checked;
      // AI 대화 기본 조건 (이 PC 에 기억)
      if (SS.chatPrefs && $('#setChatLen')) {
        const next = { length: Number($('#setChatLen').value), count: Number($('#setChatCount').value), audience: $('#setChatAud').value };
        ((SS.chatPlan && SS.chatPlan.STYLES) || []).forEach(([k]) => { const el = $('#setChat_' + k); if (el) next[k] = el.checked; });
        SS.chatPrefs.set(next);
      }
      const key = $('#setGeminiKey').value.trim();
      if (key) newS.geminiApiKey = key;
      try {
        const pub = await api.saveSettings(newS);
        SS.appSettings = pub;
        if (SS.autosave && SS.autosave.refreshSettings) SS.autosave.refreshSettings();
        if (applyNow && SS.applyEditDefaults && SS.applyEditDefaults()) {
          if (SS.renderTranscript) SS.renderTranscript();
          if (SS.updateOutput) SS.updateOutput();
          if (SS.updateTemplatePreview) SS.updateTemplatePreview();
        }
        if (SS.toast) SS.toast('설정을 저장했습니다.'); else if (SS.showToast) SS.showToast('설정이 저장되었습니다.');
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
