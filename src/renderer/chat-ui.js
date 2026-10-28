// 대화형 AI 편집 패널 + AI 연결(챗GPT·클로드·제미나이) 안내 창
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NAMES = { chatgpt: '챗GPT', claude: '클로드', gemini: '제미나이' };

  let status = null;           // llm 상태
  let video = null;            // { url, title, duration, words:[{text,start,end}] }
  let busy = false;
  let lastFetch = null;        // { url, path, map:[{src0,src1,file0}] }
  const srcToFile = (map, t) => { for (const m of map) if (t >= m.src0 - 0.001 && t <= m.src1 + 0.001) return m.file0 + (t - m.src0); return null; };

  // ---------------- 스타일 ----------------
  function injectStyles() {
    if ($('ss-chat-styles')) return;
    const st = document.createElement('style');
    st.id = 'ss-chat-styles';
    st.textContent = `
#chatCol{flex:0 0 380px;width:380px;display:flex;flex-direction:column;border-left:1px solid var(--border);background:var(--panel);min-height:0}
#chatCol.collapsed{flex-basis:44px;width:44px}
#chatCol.collapsed .chat-body,#chatCol.collapsed .chat-compose,#chatCol.collapsed .chat-head .grow{display:none}
.chat-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border)}
.chat-head .grow{flex:1;display:flex;align-items:center;gap:8px}
.chat-head b{font-size:14px}
.chat-chip{font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid var(--border);background:var(--panel2);color:var(--muted);cursor:pointer;white-space:nowrap}
.chat-chip.ok{color:#9ff0ad;border-color:#2a8c45}
.chat-chip.warn{color:#ffd27a;border-color:#8a6a1f}
.chat-body{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px;min-height:0}
.msg{max-width:92%;padding:9px 12px;border-radius:12px;font-size:13.5px;line-height:1.55;white-space:pre-wrap;word-break:keep-all}
.msg.user{align-self:flex-end;background:#1f4f8f;color:#fff;border-bottom-right-radius:4px}
.msg.ai{align-self:flex-start;background:var(--panel2);border:1px solid var(--border);border-bottom-left-radius:4px}
.msg.sys{align-self:center;background:transparent;color:var(--muted);font-size:12.5px;text-align:center}
.msg .meta{display:block;margin-top:6px;font-size:11.5px;color:var(--muted)}
.msg.err{border-color:#8a2f2f;color:#ffb4b4}
.chat-start{display:flex;flex-direction:column;gap:8px;padding:6px 2px}
.chat-start p{margin:0;color:var(--muted);font-size:13px;line-height:1.6}
.chat-input{width:100%;box-sizing:border-box;background:#121417;border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 10px;font-family:var(--font);font-size:13.5px}
.chat-input:focus{outline:none;border-color:var(--accent2)}
.chat-quick{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px}
.chat-compose{border-top:1px solid var(--border);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.chat-compose textarea{resize:none;height:64px}
.chat-actions{display:flex;gap:6px;justify-content:space-between}
.ai-conn.ss-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:9999}
.ai-conn .ss-modal{background:#25282c;color:#eee;padding:22px 24px;border-radius:10px;border:1px solid #3a3d42;box-shadow:0 8px 32px rgba(0,0,0,.5)}
.ai-conn .ss-modal h2{margin:0 0 14px;font-size:1.2rem}
.ai-conn .ss-modal{width:760px;max-height:86vh;overflow:auto}
.ai-card{border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px;background:#1b1e22}
.ai-card.active{border-color:#2a8c45;box-shadow:0 0 0 1px #2a8c45 inset}
.ai-card h3{margin:0 0 4px;font-size:15px;display:flex;align-items:center;gap:8px}
.ai-card .state{font-size:12.5px;padding:2px 8px;border-radius:999px;background:#2b2f35;color:var(--muted)}
.ai-card .state.ok{background:#16351f;color:#9ff0ad}
.ai-card p,.ai-card li{font-size:13px;color:#c9ced4;line-height:1.6}
.ai-card ol{margin:6px 0 8px 18px;padding:0}
.ai-card .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
.ai-card .note{font-size:12px;color:var(--muted)}
.ai-card input[type=password]{flex:1;min-width:220px}
`;
    document.head.appendChild(st);
  }

  // ---------------- 패널 ----------------
  function buildPanel() {
    const ws = $('workspace');
    if (!ws || $('chatCol')) return;
    const col = document.createElement('section');
    col.id = 'chatCol';
    col.innerHTML = `
      <div class="chat-head">
        <div class="grow"><b>AI 편집 대화</b><span id="chatProvider" class="chat-chip warn">AI 연결 필요</span></div>
        <button id="chatNew" class="btn sm" title="다른 영상으로 새로 시작">새로</button>
      </div>
      <div id="chatBody" class="chat-body"></div>
      <div id="chatQuick" class="chat-quick" style="display:none"></div>
      <div class="chat-compose">
        <textarea id="chatText" class="chat-input" placeholder="예: 결론 부분으로 2분 정도 만들어 줘" disabled></textarea>
        <div class="chat-actions">
          <button id="chatExport" class="btn" disabled title="완성 영상(MP4)과 자막(SRT) 만들기">영상 만들기</button>
          <button id="chatSend" class="btn primary" disabled>보내기 (Enter)</button>
        </div>
      </div>`;
    ws.appendChild(col);
    $('chatProvider').addEventListener('click', openConnect);
    $('chatNew').addEventListener('click', resetChat);
    $('chatSend').addEventListener('click', () => send());
    $('chatExport').addEventListener('click', () => { const b = $('btnExport'); if (b && !b.disabled) b.click(); else SS.toast && SS.toast('먼저 편집을 만들어 주세요'); });
    $('chatText').addEventListener('keydown', (e) => {
      e.stopPropagation(); // 편집기 단축키가 가로채지 않게
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    $('chatText').addEventListener('keyup', (e) => e.stopPropagation());
    showStart();
  }

  function addMsg(kind, html, meta) {
    const body = $('chatBody');
    const el = document.createElement('div');
    el.className = 'msg ' + kind;
    el.innerHTML = html + (meta ? `<span class="meta">${esc(meta)}</span>` : '');
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  function showStart() {
    const body = $('chatBody');
    body.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'chat-start';
    box.innerHTML = `
      <p><b>1.</b> 오른쪽 위 <b>AI 연결</b>에서 챗GPT·클로드·제미나이 중 하나를 연결합니다. (처음 한 번)</p>
      <p><b>2.</b> 유튜브에 올린 <b>설교 영상 주소</b>를 넣고 [불러오기]를 누릅니다.</p>
      <p><b>3.</b> "결론 위주로 2분 정도"처럼 말로 부탁하고, 화면에서 재생해 보며 계속 고쳐 달라고 하면 됩니다.</p>
      <input id="chatUrl" class="chat-input" placeholder="https://youtube.com/live/... 또는 https://youtu.be/...">
      <button id="chatLoad" class="btn primary">불러오기</button>`;
    body.appendChild(box);
    const inp = $('chatUrl');
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') loadVideo(); });
    inp.addEventListener('keyup', (e) => e.stopPropagation());
    $('chatLoad').addEventListener('click', loadVideo);
    $('chatQuick').style.display = 'none';
    setCompose(false);
  }

  function setCompose(on) {
    $('chatText').disabled = !on || busy;
    $('chatSend').disabled = !on || busy;
  }

  async function resetChat() {
    if (busy) return;
    await api.chatReset();
    video = null;
    showStart();
  }

  function renderQuick() {
    const q = $('chatQuick');
    const items = video && video.edited
      ? ['더 짧게 줄여 줘', '조금 더 길게', '회중에게 묻는 말 빼 줘', '말 사이를 더 빠르게', '마지막을 축복으로 끝내 줘', '제목 다시 지어 줘']
      : ['결론 위주로 2분 정도 만들어 줘', '1분 안쪽으로 핵심만', '삶의 적용 부분으로 1분 30초', '쇼츠로 쓸 만한 부분 3곳 추천해 줘'];
    q.innerHTML = items.map((t) => `<button class="chat-chip">${esc(t)}</button>`).join('');
    q.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { $('chatText').value = b.textContent; send(); }));
    q.style.display = '';
  }

  // ---------------- 영상 불러오기 ----------------
  async function loadVideo() {
    const url = ($('chatUrl') && $('chatUrl').value || '').trim();
    if (!url) { SS.toast && SS.toast('유튜브 주소를 넣어 주세요'); return; }
    if (!/youtu\.?be/.test(url)) { SS.toast && SS.toast('유튜브 주소가 아닌 것 같습니다'); return; }
    const btn = $('chatLoad'); btn.disabled = true; btn.textContent = '자막 불러오는 중…';
    try {
      video = await api.chatLoad(url);
      video.edited = false;
      $('chatBody').innerHTML = '';
      addMsg('sys', esc(`「${video.title || '설교 영상'}」 자막 ${video.words.length.toLocaleString()}단어를 불러왔습니다.`));
      addMsg('ai', '어떤 쇼츠를 만들까요? 길이나 원하는 내용을 말씀해 주세요.\n예: "결론 부분으로 2분 정도", "질문하는 부분은 빼고"');
      renderQuick();
      setCompose(true);
      if (!status || !status.active) addMsg('sys', '먼저 위의 [AI 연결]을 눌러 AI 를 연결해 주세요.');
      $('chatText').focus();
    } catch (e) {
      btn.disabled = false; btn.textContent = '불러오기';
      SS.toast && SS.toast('불러오기 실패: ' + cleanErr(e), 7000);
    }
  }

  function cleanErr(e) { return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }

  // ---------------- 대화 ----------------
  async function send(textArg) {
    const ta = $('chatText');
    const text = (textArg || ta.value || '').trim();
    if (!text || busy || !video) return;
    if (!status || !status.active) { openConnect(); return; }
    ta.value = '';
    addMsg('user', esc(text));
    busy = true; setCompose(true);
    const wait = addMsg('ai', `<i>${esc(NAMES[status.active])}가 편집을 생각하는 중…</i>`);
    let chars = 0;
    const off = api.onChatDelta((d) => { chars += String(d || '').length; wait.innerHTML = `<i>${esc(NAMES[status.active])}가 답을 쓰는 중… (${chars}자)</i>`; });
    try {
      const r = await api.chatSend(text);
      off();
      wait.remove();
      const dur = Math.round(r.durationSec);
      addMsg('ai', esc(r.reply), `${r.ranges.length}개 구간 · 약 ${Math.floor(dur / 60)}분 ${dur % 60}초${r.title ? ' · 제목: ' + r.title.replace(/\n/g, ' ') : ''}`);
      if (r.questions && r.questions.length) addMsg('sys', esc(`물음표로 끝나는 문장이 ${r.questions.length}개 남아 있어요: “${r.questions[0]}”${r.questions.length > 1 ? ' 등' : ''}. 빼려면 "질문 빼 줘"라고 하세요.`));
      if (r.ranges.length) {
        const applying = addMsg('sys', '편집기에 반영하는 중…');
        await applyPlan(r, applying);
        video.edited = true;
        renderQuick();
      }
    } catch (e) {
      off();
      wait.remove();
      const msg = cleanErr(e);
      addMsg('ai err', esc(msg));
      if (/연결|로그인|키|설치/.test(msg)) addMsg('sys', '<a href="#" id="chatFix">[AI 연결] 열기</a>').querySelector('a').addEventListener('click', (ev) => { ev.preventDefault(); openConnect(); });
    } finally {
      busy = false; setCompose(true); ta.focus();
    }
  }

  // ---------------- 편집기에 반영 ----------------
  async function applyPlan(r, note) {
    const words = video.words;
    const kept = new Uint8Array(words.length), starts = new Uint8Array(words.length);
    const spans = [];
    for (const g of r.ranges) {
      starts[g.from] = 1;
      for (let i = g.from; i <= g.to; i++) kept[i] = 1;
      spans.push({ start: words[g.from].start, end: words[g.to].end });
    }
    // 필요한 구간이 모두 이미 받은 영상 안에 있으면 다시 받지 않는다
    const covered = lastFetch && lastFetch.url === video.url && spans.every((s) => srcToFile(lastFetch.map, s.start - 0.5) != null && srcToFile(lastFetch.map, s.end + 0.5) != null);
    if (!covered) {
      note.textContent = '필요한 영상 부분만 받는 중… 0%';
      const offP = api.onProgress((info) => { if (info.task === 'youtube') note.textContent = `필요한 영상 부분만 받는 중… ${Math.round(info.pct || 0)}%`; });
      let res;
      try { res = await api.chatFetchClips(video.url, spans); } finally { offP(); }
      const detail = { path: res.path, offset: 0, url: video.url, title: video.title, duration: res.duration };
      window.dispatchEvent(new CustomEvent('ss:source-loaded', { detail }));
      const opened = detail.done ? await detail.done : false;
      if (!opened) throw new Error('영상을 열지 못했습니다');
      lastFetch = { url: video.url, path: res.path, map: res.map };
    }
    const corr = new Map((r.corrections || []).map((c) => [c.id, c.text]));
    const ew = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const fs0 = srcToFile(lastFetch.map, w.start), fe0 = srcToFile(lastFetch.map, w.end);
      if (fs0 == null || fe0 == null) continue; // 받지 않은 부분의 단어는 빼다
      const text = corr.get(i) || w.text;
      const prev = ew[ew.length - 1];
      // 조각이 바뀌는 곳에서는 항상 컷
      const jump = prev && Math.abs((fs0 - prev.start) - (w.start - prev._src)) > 0.5;
      ew.push({ text, sttText: w.text, start: fs0, end: Math.max(fs0 + 0.05, fe0), score: 1, del: !kept[i], br: false, cutBefore: !!starts[i] || !!jump, _src: w.start });
    }
    ew.forEach((w) => { delete w._src; });
    window.dispatchEvent(new CustomEvent('ss:transcript-ready', { detail: { path: lastFetch.path, offset: 0, words: ew } }));
    const st = SS.state;
    // 말 사이 공백 줄이기
    st.settings = st.settings || {};
    if (r.tighten === 'strong') { st.words = SS.edl.autoClean(st.words, { maxGap: 0.25 }); st.settings.padBefore = 0.06; st.settings.padAfter = 0.08; }
    else if (r.tighten === 'normal') { st.words = SS.edl.autoClean(st.words, { maxGap: 0.45 }); st.settings.padBefore = 0.08; st.settings.padAfter = 0.12; }
    else { st.settings.padBefore = 0.1; st.settings.padAfter = 0.15; }
    // 제목·본문·설교자
    st.meta = st.meta || {};
    if (r.title) { st.meta.title = r.title; const t = $('inpTitle'); if (t) t.value = r.title; }
    if (r.verse) { st.meta.verse = r.verse; const v = $('inpVerse'); if (v) v.value = r.verse; }
    if (!st.meta.speaker) {
      const s = SS.appSettings || {};
      const sp = s.defaultSpeaker || (s.speakers && s.speakers[0]) || '';
      if (sp) { st.meta.speaker = sp; const sel = $('selSpeaker'); if (sel) sel.value = sp; }
    }
    window.dispatchEvent(new Event('ss:template-changed'));
    window.dispatchEvent(new Event('ss:words-changed'));
    const first = st.words.find((w) => !w.del);
    if (first && SS.preview) SS.preview.seek(first.start);
    note.textContent = '편집기에 반영했습니다. 왼쪽 화면에서 [재생]으로 확인해 보세요.';
    $('chatExport').disabled = false;
  }

  // ---------------- AI 연결 창 ----------------
  async function refreshStatus() {
    try { status = await api.llmStatus(); } catch (e) { status = null; }
    const chip = $('chatProvider');
    if (!chip) return status;
    if (status && status.active && isReady(status.active)) { chip.textContent = NAMES[status.active] + ' 연결됨'; chip.className = 'chat-chip ok'; }
    else { chip.textContent = 'AI 연결 필요'; chip.className = 'chat-chip warn'; }
    return status;
  }
  function isReady(name) {
    if (!status) return false;
    if (name === 'chatgpt') return !!(status.chatgpt && status.chatgpt.connected && status.chatgpt.planEnabled);
    if (name === 'claude') return !!(status.claude && status.claude.loggedIn);
    if (name === 'gemini') return !!(status.gemini && status.gemini.hasKey);
    return false;
  }

  let connOverlay = null;
  async function openConnect() {
    injectStyles();
    if (connOverlay) connOverlay.remove();
    connOverlay = document.createElement('div');
    connOverlay.className = 'ss-modal-overlay ai-conn';
    connOverlay.innerHTML = `<div class="ss-modal"><h2>AI 연결</h2><div id="aiCards"><p style="color:#aaa">상태를 확인하는 중…</p></div>
      <div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn" id="aiClose">닫기</button></div></div>`;
    document.body.appendChild(connOverlay);
    connOverlay.addEventListener('keydown', (e) => e.stopPropagation());
    $('aiClose').addEventListener('click', () => { connOverlay.remove(); connOverlay = null; refreshStatus(); });
    await renderCards();
  }

  async function renderCards() {
    await refreshStatus();
    const box = $('aiCards'); if (!box) return;
    const s = status || { chatgpt: {}, claude: {}, gemini: {} };
    const act = s.active;
    const g = s.chatgpt || {}, c = s.claude || {}, m = s.gemini || {};
    const useBtn = (name) => isReady(name) ? (act === name ? `<span class="state ok">대화에 사용 중</span>` : `<button class="btn primary" data-use="${name}">이 AI 로 대화하기</button>`) : '';
    box.innerHTML = `
      <p style="color:#aaa;font-size:13px;margin:0 0 12px">셋 중 <b>하나만</b> 연결하면 됩니다. 이미 쓰고 있는 AI 가 있다면 그것을 고르세요.</p>
      <div class="ai-card ${act === 'chatgpt' ? 'active' : ''}">
        <h3>챗GPT <span class="state ${g.connected && g.planEnabled ? 'ok' : ''}">${g.connected ? (g.planEnabled ? '연결됨 · ' + esc(g.email || '') : '요금제 사용 허용 필요') : '연결 안 됨'}</span></h3>
        <p>챗GPT 계정으로 로그인합니다. <b>Plus·Go·Pro 요금제</b>가 있으면 그 사용량 안에서 쓰고, 따로 돈이 들지 않습니다.</p>
        <ol><li>[ChatGPT로 계속하기]를 누르면 브라우저가 열립니다.</li><li>챗GPT에 로그인하고 <b>"Use your ChatGPT plan(요금제 사용)"을 허용</b>합니다.</li><li>"로그인이 끝났습니다" 화면이 나오면 이 창으로 돌아옵니다.</li></ol>
        <div class="row">${g.connected
          ? `<button class="btn" data-act="gptOut">연결 끊기</button><button class="btn" data-link="chatgptUsage">사용량 관리</button>${g.planEnabled ? '' : '<button class="btn primary" data-act="gptIn">다시 연결 (요금제 허용)</button>'}`
          : `<button class="btn primary" data-act="gptIn">ChatGPT로 계속하기</button>`}${useBtn('chatgpt')}</div>
      </div>
      <div class="ai-card ${act === 'claude' ? 'active' : ''}">
        <h3>클로드 <span class="state ${c.loggedIn ? 'ok' : ''}">${c.loggedIn ? '연결됨' : (c.installed ? '로그인 필요' : '설치 필요')}</span></h3>
        <p>클로드는 Anthropic 공식 프로그램 <b>Claude Code</b>를 통해 연결합니다. 로그인은 Anthropic 공식 화면에서만 하고, 이 앱은 계정 정보를 받지 않습니다.
        <b>클로드 Pro 이상 요금제</b>가 필요합니다(무료 요금제는 Claude Code 를 쓸 수 없습니다).</p>
        <ol><li${c.installed ? ' style="opacity:.55"' : ''}>[Claude Code 설치]를 누르면 검은 창이 열려 설치합니다. 끝날 때까지 기다립니다(1~2분).</li>
            <li${c.loggedIn ? ' style="opacity:.55"' : ''}>[클로드 로그인]을 누르고, 열리는 브라우저에서 클로드 계정으로 로그인합니다.</li>
            <li>끝나면 [다시 확인]을 누릅니다.</li></ol>
        <div class="row">${c.installed ? '' : '<button class="btn primary" data-act="clInstall">Claude Code 설치</button>'}
          ${c.installed && !c.loggedIn ? '<button class="btn primary" data-act="clLogin">클로드 로그인</button>' : ''}
          <button class="btn" data-act="refresh">다시 확인</button><button class="btn" data-link="claudeSetup">설치 안내 페이지</button>${useBtn('claude')}</div>
        <p class="note">요금은 사용자의 클로드 요금제 사용량에서 차감됩니다. Anthropic 정책이 바뀌면 이 방식이 막힐 수 있습니다.</p>
      </div>
      <div class="ai-card ${act === 'gemini' ? 'active' : ''}">
        <h3>제미나이 <span class="state ${m.hasKey ? 'ok' : ''}">${m.hasKey ? '키 저장됨 (…' + esc(m.suffix) + ')' : '키 필요'}</span></h3>
        <p>유료 구독이 없어도 구글 계정만 있으면 <b>무료 키</b>로 쓸 수 있습니다.</p>
        <ol><li>[키 발급 페이지 열기] → 구글 계정으로 로그인합니다.</li><li><b>Create API key</b>(API 키 만들기)를 눌러 나온 키를 복사합니다.</li><li>아래 칸에 붙여 넣고 [저장]을 누릅니다.</li></ol>
        <div class="row"><button class="btn" data-link="geminiKey">키 발급 페이지 열기</button>
          <input type="password" id="geminiKey" class="chat-input" placeholder="AIza… 로 시작하는 키"><button class="btn primary" data-act="gmSave">저장</button>${useBtn('gemini')}</div>
        <p class="note">키는 이 컴퓨터에 암호화되어 저장됩니다. 무료 사용량을 넘으면 잠시 쉬었다가 다시 쓰면 됩니다.</p>
      </div>
      <div id="aiConnMsg" class="note" style="min-height:18px"></div>`;
    box.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', async () => { await api.llmSetActive(b.dataset.use); await renderCards(); }));
    box.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', () => api.llmOpenLink(b.dataset.link)));
    box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act_(b.dataset.act, b)));
  }

  function msg(t) { const el = $('aiConnMsg'); if (el) el.textContent = t || ''; }

  async function act_(what, btn) {
    try {
      if (what === 'gptIn') {
        btn.disabled = true; msg('브라우저에서 챗GPT 로그인을 마쳐 주세요… (5분 안에)');
        const r = await api.llmChatgptSignIn();
        msg(r.planEnabled ? '챗GPT 가 연결되었습니다. 이제 요금제 사용량으로 대화합니다.' : '로그인은 되었지만 "요금제 사용"이 허용되지 않았습니다. [다시 연결]에서 허용해 주세요.');
        if (r.planEnabled) await api.llmSetActive('chatgpt');
      } else if (what === 'gptOut') {
        await api.llmChatgptSignOut(); msg('챗GPT 연결을 끊었습니다.');
        if (status.active === 'chatgpt') await api.llmSetActive(null);
      } else if (what === 'clInstall') {
        await api.llmClaudeInstall(); msg('설치 창이 열렸습니다. 설치가 끝나면 [클로드 로그인]으로 넘어가세요. (화면이 바뀌지 않으면 [다시 확인])');
      } else if (what === 'clLogin') {
        await api.llmClaudeLogin(); msg('로그인 창이 열렸습니다. 브라우저에서 로그인을 마친 뒤 [다시 확인]을 누르세요.');
      } else if (what === 'gmSave') {
        const k = ($('geminiKey').value || '').trim();
        if (!/^AIza[0-9A-Za-z_\-]{20,}$/.test(k)) { msg('키 모양이 이상합니다. AIza 로 시작하는 키 전체를 붙여 넣어 주세요.'); return; }
        await api.saveSettings({ geminiApiKey: k });
        msg('저장했습니다. 연결을 확인하는 중…');
        const t = await api.llmTest('gemini').catch((e) => ({ ok: false, text: cleanErr(e) }));
        msg(t.ok ? '제미나이가 연결되었습니다.' : '키를 저장했지만 연결 확인에 실패했습니다: ' + t.text);
        if (t.ok) await api.llmSetActive('gemini');
      }
      const prev = status && status.active;
      await renderCards();
      // 하나만 준비된 경우 자동으로 고른다
      if (!status.active || !isReady(status.active)) {
        const ready = ['chatgpt', 'claude', 'gemini'].filter(isReady);
        if (ready.length === 1 && ready[0] !== prev) { await api.llmSetActive(ready[0]); await renderCards(); }
      }
    } catch (e) {
      msg(cleanErr(e));
      if (btn) btn.disabled = false;
    }
  }

  SS.openAiConnect = openConnect;

  // ---------- 테스트 훅: SS_TEST_SCRIPT=chat (실제 AI · 실제 유튜브를 씁니다) ----------
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'chat') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(300); } };
    const log = (m) => console.log('[Test] ' + m);
    try {
      const launch = await api.getLaunchInfo();
      const url = (launch.testUrl || 'https://www.youtube.com/watch?v=uSE5pZB3gtQ');
      await api.llmSetActive(launch.testProvider || 'claude');
      await openConnect(); await sleep(1500);
      await SS.testShot('cache/chat_test/1_connect.png');
      $('aiClose').click();
      $('chatUrl').value = url; $('chatLoad').click();
      await waitFor(() => video && !$('chatText').disabled, 120000, 'load');
      log('loaded words=' + video.words.length);
      const ask = async (text, shot) => {
        const t0 = Date.now();
        const before = $('chatBody').children.length;
        $('chatText').value = text; send();
        await waitFor(() => !busy && $('chatBody').children.length > before + 1, 600000, 'reply ' + text);
        await waitFor(() => !/반영하는 중|받는 중/.test($('chatBody').textContent.slice(-200)), 300000, 'apply');
        await sleep(2500);
        const kept = (SS.state.words || []).filter((w) => !w.del).length;
        const segs = SS.edl.buildSegments(SS.state.words, SS.state.settings, SS.state.overrides, SS.preview && SS.preview.duration);
        const outDur = segs.reduce((a, s) => a + (s.end - s.start), 0);
        log(`${text} → ${((Date.now() - t0) / 1000).toFixed(0)}s kept=${kept} segs=${segs.length} out=${outDur.toFixed(1)}s title=${JSON.stringify(SS.state.meta && SS.state.meta.title)}`);
        log('last: ' + $('chatBody').lastElementChild.textContent.slice(0, 160));
        await SS.testShot(shot);
        return outDur;
      };
      await ask('결론 위주로 2분 정도 만들어 줘', 'cache/chat_test/2_first.png');
      await ask('회중에게 묻는 말은 빼고 1분 30초로 줄이고 말 사이를 더 빠르게 해 줘', 'cache/chat_test/3_second.png');
      if (SS.doExport) {
        const out = launch.cache.replace(/\\/g, '/') + '/chat_test/output.mp4';
        await api.mkdir(launch.cache + '/chat_test');
        await SS.doExport(out);
        log('exported ' + out);
      }
      api.notifyTestReady({ ok: true });
    } catch (err) {
      console.error(err);
      api.notifyTestError(err && err.stack || err);
    }
  });

  function init() {
    injectStyles();
    buildPanel();
    refreshStatus();
    const tb = document.querySelector('#topbar .toolbar');
    if (tb && !$('btnAiConnect')) {
      const b = document.createElement('button');
      b.id = 'btnAiConnect'; b.className = 'btn'; b.textContent = 'AI 연결';
      b.addEventListener('click', openConnect);
      tb.insertBefore(b, tb.firstChild);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
