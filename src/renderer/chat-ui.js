// 대화형 AI 편집 패널 + AI 연결(챗GPT·클로드·제미나이·오픈라우터) 안내 창
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NAMES = { chatgpt: '챗GPT', claude: '클로드', gemini: '제미나이', openrouter: '오픈라우터' };

  let status = null;           // llm 상태
  let video = null;            // { url, title, duration, words:[{text,start,end}] }
  let busy = false;
  let lastFetch = null;        // { url, path, map:[{src0,src1,file0}] }
  let lastRanges = null;       // 마지막으로 편집기에 반영한 구간 (같으면 다시 반영하지 않음)
  let stub = null;             // 테스트 훅에서만: { send, fetchClips }
  const chatSendImpl = (t) => (stub && stub.send ? stub.send(t) : api.chatSend(t));
  const fetchClipsImpl = (u, s) => (stub && stub.fetchClips ? stub.fetchClips(u, s) : api.chatFetchClips(u, s));
  const CP = () => SS.chatPlan;
  const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const ytIdOf = (u) => { const m = String(u || '').match(/(?:v=|youtu\.be\/|live\/|shorts\/|embed\/)([\w-]{11})/); return m ? m[1] : ''; };

  // 버튼으로 고르는 편집 조건 (이 PC 에 기억)
  const PREF_KEY = 'ss.chatPrefs.v1';
  const DEFAULT_PREFS = { length: 120, tight: true, filler: true, questions: true, notices: true, gaps: true, ending: true, contents: [], audience: 'all', intensity: 0, count: 3 };
  const INTENSITIES = [[0, '상관없음'], [1, '1 잔잔'], [2, '2'], [3, '3'], [4, '4'], [5, '5 강하게']];
  const TIPS = {
    tight: '되풀이하는 말, 늘어지는 예화·설명을 빼고 핵심만 힘 있게',
    filler: '"그…", "어…" 말 끄는 소리와 더듬기, 같은 말 반복 빼기',
    questions: '회중에게 묻는 말과 그 대답 빼기',
    notices: '"마무리하겠습니다" 같은 예배 진행 안내 빼기',
    gaps: '말 사이 조용한 부분을 실제 소리로 찾아 자동으로 줄이기',
    ending: '마지막을 결론이나 축복의 말로 끝내기',
  };
  function loadPrefs() { try { return Object.assign({}, DEFAULT_PREFS, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { return Object.assign({}, DEFAULT_PREFS); } }
  let prefs = loadPrefs();
  let condOpen = true;
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* 저장 안 돼도 이번에는 쓴다 */ } }
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
.chat-quick{display:flex;flex-direction:column;gap:6px;padding:8px 12px;border-top:1px solid var(--border)}
.cq-head{display:flex;align-items:center;gap:8px;min-width:0}
.cq-fold{background:none;border:none;color:var(--text);font-size:12.5px;font-weight:600;cursor:pointer;padding:0;white-space:nowrap;font-family:var(--font)}
.cq-sum{flex:1;min-width:0;font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cq-cond{display:flex;flex-direction:column;gap:6px}
.cq-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.cq-label{font-size:11.5px;color:var(--muted);flex:0 0 38px}
.cq-btn{font-size:12px;padding:4px 9px;border-radius:999px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap;font-family:var(--font)}
.cq-btn:hover{border-color:#5b6470}
.cq-btn.on{background:#173a63;border-color:var(--accent2);color:#dbe9ff}
.cq-btn.tog.on::before{content:'✓ '}
.cq-btn.act{border-radius:8px}
.cq-btn.primary{background:var(--accent2);border-color:var(--accent2);color:#fff;font-weight:600}
.cq-btn:disabled{opacity:.45;cursor:default}
.msg.cand{white-space:normal;border-left:3px solid var(--accent2);max-width:96%}
.cand-head{font-size:12px;color:var(--muted)}
.cand-head b{color:var(--text)}
.cand-title{font-weight:700;margin-top:3px}
.cand-sum,.cand-why{font-size:12.5px;margin-top:3px}
.cand-why{color:#bcd3ee}
.msg.cand details{margin-top:5px;font-size:12px;color:var(--muted)}
.msg.cand summary{cursor:pointer}
.cand-text{margin-top:4px;line-height:1.5;color:#c9ced4}
.cand-act{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.msg.sys .cq-btn{margin-top:6px}
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
      <p><b>1.</b> 오른쪽 위 <b>AI 연결</b>에서 챗GPT·클로드·제미나이·오픈라우터 중 하나를 연결합니다. (처음 한 번)</p>
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
    document.querySelectorAll('#chatQuick button, #chatBody .cand-act button, #chatBody .msg.sys .cq-btn').forEach((b) => { if (!b.classList.contains('cq-fold') && !b.dataset.yt) b.disabled = busy; });
  }

  async function resetChat() {
    if (busy) return;
    await api.chatReset();
    video = null; lastRanges = null;
    showStart();
  }

  // ---------------- 버튼: 편집 조건(길이·다듬기) + 바로 하기 ----------------
  function renderQuick() {
    const q = $('chatQuick');
    if (!q) return;
    if (!video) { q.style.display = 'none'; return; }
    const cp = CP();
    const edited = !!video.edited;
    const lens = cp.LENGTHS.map(([s, l]) => `<button class="cq-btn len${Number(prefs.length) === s ? ' on' : ''}" data-len="${s}">${esc(l)}</button>`).join('');
    const togs = cp.STYLES.map(([k, l]) => `<button class="cq-btn tog${prefs[k] ? ' on' : ''}" data-tog="${k}" title="${esc(TIPS[k] || '')}">${esc(l)}</button>`).join('');
    const conts = cp.CONTENTS.map(([k, l]) => `<button class="cq-btn tog${(prefs.contents || []).includes(k) ? ' on' : ''}" data-content="${k}" title="여러 개 고를 수 있습니다. 안 고르면 상관없음">${esc(l)}</button>`).join('');
    const auds = cp.AUDIENCES.map(([k, l]) => `<button class="cq-btn len${(prefs.audience || 'all') === k ? ' on' : ''}" data-aud="${k}">${esc(l)}</button>`).join('');
    const ints = INTENSITIES.map(([n, l]) => `<button class="cq-btn len${(Number(prefs.intensity) || 0) === n ? ' on' : ''}" data-int="${n}" title="1 = 잔잔한 위로, 5 = 강한 도전">${esc(l)}</button>`).join('');
    const n = cp.countOf(prefs);
    const cnts = cp.COUNTS.map((c) => `<button class="cq-btn len${n === c ? ' on' : ''}" data-count="${c}">${c}곳</button>`).join('');
    const acts = edited
      ? [['gaps-now', '공백 없애기', 'primary'], ['tight', '늘어지지 않게'], ['filler', '군말·반복 빼기'], ['questions', '질문·대답 빼기'], ['notices', '진행 안내 빼기'],
        ['shorter', '더 짧게'], ['longer', '더 길게'], ['ending', '결론으로 끝내기'], ['title', '제목 다시'], ['typos', '자막 오타 고치기'], ['again', `다른 구간 ${n}곳 추천`]]
      : [['recommend', `① 구간 ${n}곳 추천받기`, 'primary'], ['make', '바로 만들기']];
    q.innerHTML = `
      <div class="cq-head"><button class="cq-fold" id="cqFold" title="길이·다듬기 조건 열기/접기">${condOpen ? '▾' : '▸'} 편집 조건</button><span class="cq-sum">${esc(cp.conditionsSummary(prefs))}</span></div>
      <div class="cq-cond"${condOpen ? '' : ' style="display:none"'}>
        <div class="cq-row"><span class="cq-label">길이</span>${lens}</div>
        <div class="cq-row"><span class="cq-label">다듬기</span>${togs}</div>
        <div class="cq-row"><span class="cq-label">내용</span>${conts}</div>
        <div class="cq-row"><span class="cq-label">대상</span>${auds}</div>
        <div class="cq-row"><span class="cq-label">강도</span>${ints}</div>
        <div class="cq-row"><span class="cq-label">후보</span>${cnts}</div>
      </div>
      <div class="cq-row cq-acts">${acts.map(([k, l, c]) => `<button class="cq-btn act${c ? ' ' + c : ''}" data-act="${k}" title="${esc(actTip(k))}">${esc(l)}</button>`).join('')}</div>`;
    $('cqFold').addEventListener('click', () => { condOpen = !condOpen; renderQuick(); });
    q.querySelectorAll('[data-len]').forEach((b) => b.addEventListener('click', () => {
      prefs.length = Number(b.dataset.len); savePrefs(); renderQuick();
      if (video && video.edited) doAction('length', prefs.length); // 편집한 뒤에는 바로 그 길이로 맞춘다
    }));
    q.querySelectorAll('[data-tog]').forEach((b) => b.addEventListener('click', () => { prefs[b.dataset.tog] = !prefs[b.dataset.tog]; savePrefs(); renderQuick(); }));
    q.querySelectorAll('[data-content]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.content, cs = Array.isArray(prefs.contents) ? prefs.contents.slice() : [];
      prefs.contents = cs.includes(k) ? cs.filter((x) => x !== k) : cs.concat([k]);
      savePrefs(); renderQuick();
    }));
    q.querySelectorAll('[data-aud]').forEach((b) => b.addEventListener('click', () => { prefs.audience = b.dataset.aud; savePrefs(); renderQuick(); }));
    q.querySelectorAll('[data-int]').forEach((b) => b.addEventListener('click', () => { prefs.intensity = Number(b.dataset.int); savePrefs(); renderQuick(); }));
    q.querySelectorAll('[data-count]').forEach((b) => b.addEventListener('click', () => { prefs.count = Number(b.dataset.count); savePrefs(); renderQuick(); }));
    q.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => doAction(b.dataset.act)));
    q.style.display = '';
    setCompose(true);
  }

  function actTip(k) {
    if (k === 'gaps-now') return '지금 편집에서 말 사이 조용한 부분을 실제 소리로 찾아 줄입니다 (AI 안 씀, Ctrl+Z 로 되돌리기)';
    if (k === 'recommend' || k === 'again') return '바로 만들지 않고 후보 3곳을 먼저 보여 줍니다. 마음에 드는 후보를 고르면 그 안에서 만듭니다.';
    if (k === 'make') return '편집 조건대로 결론·적용 중심으로 바로 만듭니다';
    const r = CP().actionRequest(k, prefs);
    return r ? r.text.replace(/^\[편집 조건\][\s\S]*?\n\n/, '') : '';
  }

  async function doAction(key, arg) {
    if (busy || !video) return;
    if (key === 'gaps-now') return gapsNow();
    const req = CP().actionRequest(key, prefs, arg);
    if (req) await send(req.label, req.text);
  }

  // ---------------- 영상 불러오기 ----------------
  async function loadVideo() {
    const url = ($('chatUrl') && $('chatUrl').value || '').trim();
    if (!url) { SS.toast && SS.toast('유튜브 주소를 넣어 주세요'); return; }
    if (!/youtu\.?be/.test(url)) { SS.toast && SS.toast('유튜브 주소가 아닌 것 같습니다'); return; }
    const btn = $('chatLoad'); btn.disabled = true; btn.textContent = '자막 불러오는 중…';
    try {
      video = await api.chatLoad(url);
      video.edited = false; lastRanges = null;
      $('chatBody').innerHTML = '';
      addMsg('sys', esc(`「${video.title || '설교 영상'}」 자막 ${video.words.length.toLocaleString()}단어를 불러왔습니다.`));
      addMsg('ai', '어떤 쇼츠를 만들까요? 아래 버튼으로 길이와 다듬기 조건을 고른 뒤 [구간 3곳 추천받기]를 누르거나, 원하는 내용을 말씀해 주세요.\n예: "결론 부분으로", "기도에 대한 부분으로"');
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
  /**
   * 보내기. textArg = 말풍선에 보일 글, aiTextArg = AI 에게 실제로 보낼 글(버튼).
   * 직접 쓴 첫 요청에는 버튼으로 고른 편집 조건을 붙인다.
   */
  async function send(textArg, aiTextArg) {
    const ta = $('chatText');
    const text = (textArg || ta.value || '').trim();
    if (!text || busy || !video) return;
    if (!status || !status.active) { openConnect(); return; }
    let aiText = aiTextArg;
    if (!aiText) { const cond = video.edited ? '' : CP().buildConditions(prefs); aiText = cond ? cond + '\n\n' + text : text; }
    if (!textArg) ta.value = '';
    addMsg('user', esc(text));
    busy = true; setCompose(true);
    const wait = addMsg('ai', `<i>${esc(NAMES[status.active] || 'AI')}가 편집을 생각하는 중…</i>`);
    let chars = 0;
    const off = api.onChatDelta((d) => { chars += String(d || '').length; wait.innerHTML = `<i>${esc(NAMES[status.active] || 'AI')}가 답을 쓰는 중… (${chars}자)</i>`; });
    try {
      const r = await chatSendImpl(aiText);
      off();
      wait.remove();
      const cands = Array.isArray(r.candidates) ? r.candidates : [];
      if (cands.length && !r.ranges.length) {
        // 구간 추천: 후보 카드만 보여 주고 지금 편집은 그대로
        addMsg('ai', esc(r.reply));
        showCandidates(cands);
        return;
      }
      const dur = Math.round(r.durationSec);
      addMsg('ai', esc(r.reply), `${r.ranges.length}개 구간 · 남긴 길이 약 ${CP().fmtLen(dur)}${r.title ? ' · 제목: ' + r.title.replace(/\n/g, ' / ') : ''}`);
      if (r.questions && r.questions.length) addMsg('sys', esc(`물음표로 끝나는 문장이 ${r.questions.length}개 남아 있어요: “${r.questions[0]}”${r.questions.length > 1 ? ' 등' : ''}. [질문·대답 빼기]를 눌러 보세요.`));
      if (r.ranges.length) {
        if (video.edited && sameRanges(lastRanges, r.ranges) && !(r.corrections || []).length) {
          // 구간이 그대로면 다시 반영하지 않는다 (공백 없애기 등 손본 것을 지키기)
          applyMeta(r);
          addMsg('sys', '구간은 그대로 두고 제목·본문만 반영했습니다.');
        } else {
          const applying = addMsg('sys', '편집기에 반영하는 중…');
          const firstEdit = !video.edited;
          await applyPlan(r, applying);
          video.edited = true;
          if (firstEdit) condOpen = false; // 처음 만든 뒤에는 조건 줄을 접어 대화 칸을 넓게
          lastRanges = r.ranges.map((g) => ({ from: g.from, to: g.to }));
          checkLength();
        }
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
      try { res = await fetchClipsImpl(video.url, spans); } finally { offP(); }
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
    st.settings = st.settings || {};
    st.settings.padBefore = 0.1; st.settings.padAfter = 0.15;
    // 군말(어·음)과 바로 되풀이한 단어 지우기
    if (prefs.filler) st.words = SS.edl.autoClean(st.words, { maxGap: 1e9 });
    // 공백 없애기를 끄고 AI 가 '보통'으로 줄이자고 하면 눈에 띄는 긴 틈만 자른다
    if (!prefs.gaps && r.tighten === 'normal') st.words = SS.edl.autoClean(st.words, { maxGap: 0.45, fillers: [] });
    // 제목·본문·설교자
    applyMeta(r, true);
    if (!st.meta.speaker) {
      const s = SS.appSettings || {};
      const sp = s.defaultSpeaker || (s.speakers && s.speakers[0]) || '';
      if (sp) { st.meta.speaker = sp; const sel = $('selSpeaker'); if (sel) sel.value = sp; }
    }
    window.dispatchEvent(new Event('ss:template-changed'));
    window.dispatchEvent(new Event('ss:words-changed'));
    // 말 사이 공백 없애기 (실제 소리 기준). 안 되면 자막 시각으로 긴 틈만 자른다
    let gapNote = '';
    if (prefs.gaps || r.tighten === 'strong') {
      note.textContent = '말 사이 공백을 찾는 중…';
      try {
        const g = await removeGaps();
        if (g.cuts) gapNote = ` 말 사이 공백 ${g.cuts}곳을 줄여 ${(g.before - g.after).toFixed(1)}초 짧아졌습니다.`;
      } catch (e) {
        console.warn('공백 없애기 실패, 자막 시각으로 줄임:', e);
        SS.pushUndo();
        st.words = SS.edl.autoClean(st.words, { maxGap: 0.25, fillers: [] });
        st.settings.padBefore = 0.06; st.settings.padAfter = 0.08;
        window.dispatchEvent(new Event('ss:words-changed'));
      }
    }
    const first = st.words.find((w) => !w.del);
    if (first && SS.preview) SS.preview.seek(first.start);
    note.textContent = `편집기에 반영했습니다. 완성 길이 약 ${CP().fmtLen(editedDuration())}.${gapNote} 왼쪽 화면에서 [재생]으로 확인해 보세요.`;
    $('chatExport').disabled = false;
  }

  /** AI 답의 제목·본문을 입력칸에 (두 줄 제목은 ' / ' 로: 화면에서 줄이 바뀜) */
  function applyMeta(r, quiet) {
    const st = SS.state;
    st.meta = st.meta || {};
    if (r.title) { st.meta.title = String(r.title).replace(/\s*\n\s*/g, ' / ').trim(); const t = $('inpTitle'); if (t) t.value = st.meta.title; }
    if (r.verse) { st.meta.verse = r.verse; const v = $('inpVerse'); if (v) v.value = r.verse; }
    if (!quiet) window.dispatchEvent(new Event('ss:template-changed'));
  }

  function sameRanges(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return a.every((g, i) => g.from === b[i].from && g.to === b[i].to);
  }

  /** 지금 편집 결과의 길이(초) */
  function editedDuration() {
    const st = SS.state;
    if (!st || !st.words || !st.words.length) return 0;
    const dur = (SS.preview && SS.preview.duration) || (st.source && st.source.duration);
    return SS.edl.segmentsDuration(SS.edl.buildSegments(st.words, st.settings, st.overrides, dur));
  }

  /** 목표 길이와 15초 넘게 다르면 알려 주고 맞추기 버튼 */
  function checkLength() {
    const target = Number(prefs.length), d = editedDuration();
    if (!(target > 0) || !(d > 0) || Math.abs(d - target) <= 15) return;
    const el = addMsg('sys', esc(`완성 길이 약 ${CP().fmtLen(d)} (목표 ${CP().fmtLen(target)}) `) + `<button class="cq-btn act" data-fit="1">${esc(CP().withRo(CP().fmtLen(target)))} 맞추기</button>`);
    el.querySelector('[data-fit]').addEventListener('click', () => doAction('length', target));
  }

  // ---------------- 말 사이 공백 없애기 (실제 소리에서 무음 찾기) ----------------
  async function removeGaps(opts) {
    opts = opts || {};
    const st = SS.state;
    if (!st || !st.source || !st.source.path || !st.words || !st.words.length) throw new Error('먼저 편집할 영상을 열어 주세요.');
    const dur = (SS.preview && SS.preview.duration) || st.source.duration;
    const segs = SS.edl.buildSegments(st.words, st.settings, st.overrides, dur);
    if (!segs.length) throw new Error('남은 영상 구간이 없습니다.');
    const before = SS.edl.segmentsDuration(segs);
    const found = await api.audioSilences(st.source.path, { start: Math.max(0, segs[0].start - 0.5), end: segs[segs.length - 1].end + 0.5, minDur: opts.minDur || 0.15 });
    const plan = SS.gaps.planGapCuts(st.words, segs, found.silences, { padBefore: 0.05, padAfter: 0.07, minCut: 0.08 });
    if (!plan.cuts) return { cuts: 0, before, after: before, noiseDb: found.noiseDb };
    SS.pushUndo();
    plan.cutBefore.forEach((i) => { st.words[i].cutBefore = true; });
    st.overrides = Object.assign({}, st.overrides || {}, plan.overrides);
    window.dispatchEvent(new Event('ss:words-changed'));
    if (SS.updateTemplatePreview) SS.updateTemplatePreview();
    return { cuts: plan.cuts, before, after: editedDuration(), noiseDb: found.noiseDb };
  }
  SS.removeGaps = removeGaps;

  async function gapsNow() {
    if (busy) return;
    busy = true; setCompose(true);
    const note = addMsg('sys', '말 사이 공백을 찾는 중…');
    try {
      const g = await removeGaps();
      note.textContent = g.cuts
        ? `말 사이 공백 ${g.cuts}곳을 줄였습니다. ${CP().fmtLen(g.before)} → ${CP().fmtLen(g.after)} (${(g.before - g.after).toFixed(1)}초 짧아짐). 되돌리려면 Ctrl+Z.`
        : '더 줄일 말 사이 공백이 없습니다.';
    } catch (e) {
      note.textContent = '공백 없애기 실패: ' + cleanErr(e);
    } finally {
      busy = false; setCompose(true);
    }
  }

  // ---------------- 구간 추천 카드 ----------------
  function showCandidates(list) {
    const body = $('chatBody');
    const id = ytIdOf(video && video.url);
    list.forEach((c) => {
      const el = document.createElement('div');
      el.className = 'msg ai cand';
      el.innerHTML = `<div class="cand-head"><b>후보 ${c.no}</b> · ${clock(c.start)} ~ ${clock(c.end)} · 약 ${esc(CP().fmtLen(c.durationSec))}</div>`
        + (c.title ? `<div class="cand-title">「${esc(c.title)}」</div>` : '')
        + (c.summary ? `<div class="cand-sum">${esc(c.summary)}</div>` : '')
        + (c.why ? `<div class="cand-why">${esc(c.why)}</div>` : '')
        + `<details><summary>자막 보기</summary><div class="cand-text">${esc(c.excerpt)}</div></details>`
        + `<div class="cand-act"><button class="cq-btn act primary" data-pick="${c.no}">이 구간으로 만들기</button>`
        + (id ? `<button class="cq-btn act" data-yt="${Math.floor(c.start)}" title="웹 브라우저에서 그 시각부터 재생">유튜브에서 보기</button>` : '') + '</div>';
      el.querySelector('[data-pick]').addEventListener('click', () => doAction('pick', c));
      const yb = el.querySelector('[data-yt]');
      if (yb) yb.addEventListener('click', () => { api.ytupOpenUrl(`https://youtu.be/${id}?t=${Math.floor(c.start)}`).catch(() => {}); });
      body.appendChild(el);
    });
    addMsg('sys', '마음에 드는 후보의 [이 구간으로 만들기]를 누르세요. 길이·다듬기 조건도 함께 적용됩니다.');
    body.scrollTop = body.scrollHeight;
  }

  // ---------------- AI 연결 창 ----------------
  async function refreshStatus() {
    try { const st = await api.llmStatus(); status = (stub && stub.status) || st; } catch (e) { status = (stub && stub.status) || null; }
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
    if (name === 'openrouter') return !!(status.openrouter && status.openrouter.hasKey);
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
    const s = status || { chatgpt: {}, claude: {}, gemini: {}, openrouter: {} };
    const act = s.active;
    const g = s.chatgpt || {}, c = s.claude || {}, m = s.gemini || {}, o = s.openrouter || {};
    const useBtn = (name) => isReady(name) ? (act === name ? `<span class="state ok">대화에 사용 중</span>` : `<button class="btn primary" data-use="${name}">이 AI 로 대화하기</button>`) : '';
    box.innerHTML = `
      <p style="color:#aaa;font-size:13px;margin:0 0 12px">넷 중 <b>하나만</b> 연결하면 됩니다. 이미 쓰고 있는 AI 가 있다면 그것을 고르세요.</p>
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
          <input type="password" id="geminiKey" class="chat-input" placeholder="복사한 API 키 전체를 붙여 넣으세요"><button class="btn primary" data-act="gmSave">저장</button>${useBtn('gemini')}</div>
        <p class="note">키는 이 컴퓨터에 암호화되어 저장됩니다. 무료 사용량을 넘으면 잠시 쉬었다가 다시 쓰면 됩니다.</p>
      </div>
      <div class="ai-card ${act === 'openrouter' ? 'active' : ''}">
        <h3>오픈라우터 <span class="state ${o.hasKey ? 'ok' : ''}">${o.hasKey ? '키 저장됨 (…' + esc(o.suffix) + ')' : '키 필요'}</span></h3>
        <p>openrouter.ai 의 <b>무료 모델</b>을 씁니다. 결제 정보 없이 가입만 하면 됩니다. 그때 쓸 수 있는 무료 모델을 오픈라우터가 골라 주고, 붐비면 다른 무료 모델로 바꿔 다시 해 봅니다.</p>
        <ol><li>[키 발급 페이지 열기] → 구글 계정 등으로 가입·로그인합니다.</li><li><b>Create API Key</b>(키 만들기)를 눌러 나온 키(sk-or-…)를 복사합니다.</li><li>아래 칸에 붙여 넣고 [저장]을 누릅니다.</li></ol>
        <div class="row"><button class="btn" data-link="openrouterKey">키 발급 페이지 열기</button>
          <input type="password" id="openrouterKey" class="chat-input" placeholder="sk-or- 로 시작하는 키를 붙여 넣으세요"><button class="btn primary" data-act="orSave">저장</button>${useBtn('openrouter')}</div>
        <p class="note">무료 모델은 하루 쓸 수 있는 횟수가 정해져 있고, 다른 AI 보다 편집 품질이 들쭉날쭉할 수 있습니다. 대화 내용이 무료 모델 제공 회사의 학습에 쓰일 수 있습니다.</p>
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
        if (!k || /\s/.test(k) || k.length < 20) { msg('키가 너무 짧거나 띄어쓰기가 들어 있습니다. 복사한 키 전체를 그대로 붙여 넣어 주세요.'); return; }
        await api.saveSettings({ geminiApiKey: k });
        msg('저장했습니다. 연결을 확인하는 중…');
        const t = await api.llmTest('gemini').catch((e) => ({ ok: false, text: cleanErr(e) }));
        msg(t.ok ? '제미나이가 연결되었습니다.' : '키를 저장했지만 연결 확인에 실패했습니다: ' + t.text);
        if (t.ok) await api.llmSetActive('gemini');
      } else if (what === 'orSave') {
        const k = ($('openrouterKey').value || '').trim();
        if (!k || /\s/.test(k) || k.length < 20) { msg('키가 너무 짧거나 띄어쓰기가 들어 있습니다. 복사한 키 전체를 그대로 붙여 넣어 주세요.'); return; }
        await api.saveSettings({ openrouterApiKey: k });
        msg('저장했습니다. 연결을 확인하는 중… (무료 모델은 30초쯤 걸릴 수 있습니다)');
        const t = await api.llmTest('openrouter').catch((e) => ({ ok: false, text: cleanErr(e) }));
        msg(t.ok ? '오픈라우터가 연결되었습니다.' : '키를 저장했지만 연결 확인에 실패했습니다: ' + t.text);
        if (t.ok) await api.llmSetActive('openrouter');
      }
      const prev = status && status.active;
      await renderCards();
      // 하나만 준비된 경우 자동으로 고른다
      if (!status.active || !isReady(status.active)) {
        const ready = ['chatgpt', 'claude', 'gemini', 'openrouter'].filter(isReady);
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

  // ---------- 테스트 훅: SS_TEST_SCRIPT=chatbuttons (AI 대신 정해 둔 답, 영상은 cache/yt 의 조각, 공백은 실제 소리) ----------
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'chatbuttons') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(200); } };
    const report = { sent: [], steps: [] };
    const step = (name, extra) => { const o = Object.assign({ name, dur: +editedDuration().toFixed(2), title: SS.state.meta && SS.state.meta.title, cuts: (SS.state.words || []).filter((w) => w.cutBefore).length, overrides: Object.keys(SS.state.overrides || {}).length, last: ($('chatBody').lastElementChild || {}).textContent }, extra || {}); report.steps.push(o); console.log('[chatbuttons] ' + JSON.stringify(o).slice(0, 400)); };
    try {
      const launch = await api.getLaunchInfo();
      const dir = launch.cache + '/chat_buttons';
      await api.mkdir(dir);
      const j3 = await api.readJson(launch.cache + '/yt/uSE5pZB3gtQ/uSE5pZB3gtQ.ko.json3');
      const side = await api.readJson(launch.cache + '/yt/uSE5pZB3gtQ/part_4955_5100.json');
      const words = CP().wordsFromJson3(j3).words;
      const i0 = words.findIndex((w) => w.start >= side.start + 1);
      let i1 = i0; while (i1 + 1 < words.length && words[i1 + 1].end <= side.end - 1) i1++;
      const cands = [[i0, i0 + 69, '하나님만 영광을'], [i0 + 75, i0 + 144, '영광을 돌리는 기도'], [i0 + 150, i1, '주기도문의 결론']];
      const pick = (c) => [{ from: c[0], to: c[0] + 20 }, { from: c[0] + 24, to: c[0] + 45 }, { from: c[0] + 48, to: c[1] }];
      let current = null;
      const answer = (ranges, extra) => Object.assign({ reply: '만들었습니다.', title: '하나님 중심의\n기도', verse: '마태복음 6:13', tighten: 'normal', ranges, corrections: [], warnings: [], candidates: [], questions: CP().questionsIn(ranges, words), durationSec: CP().rangesDuration(ranges, words) }, extra || {});
      stub = {
        send: async (text) => {
          report.sent.push(text);
          await sleep(300);
          if (/추천/.test(text)) {
            const list = CP().resolveCandidates(cands.map((c, k) => ({ title: c[2], from: c[0], fromText: words[c[0]].text, to: c[1], toText: words[c[1]].text, summary: '후보 ' + (k + 1) + ' 요약', why: '결론이 분명합니다' })), words);
            return answer([], { reply: '쇼츠로 쓸 만한 구간 3곳입니다.', candidates: list, durationSec: 0 });
          }
          if (/후보\(#/.test(text)) { current = pick(cands[0]); return answer(current); }
          if (/길이를/.test(text)) { current = current.slice(0, 2).concat([{ from: current[2].from, to: current[2].from + 10 }]); return answer(current, { reply: '줄였습니다.' }); }
          if (/제목/.test(text)) return answer(current, { reply: '제목을 바꿨습니다.', title: '오늘의 말씀\n하나님 중심의 기도' });
          return answer(current || pick(cands[0]));
        },
        fetchClips: async () => ({ path: launch.cache + '/yt/uSE5pZB3gtQ/part_4955_5100.mp4', duration: side.end - side.offset + 1, map: [{ src0: side.offset, src1: side.end + 0.9, file0: 0 }] }),
      };
      stub.status = { active: 'claude', claude: { loggedIn: true } };
      status = stub.status;
      prefs = Object.assign({}, DEFAULT_PREFS);
      video = { url: 'https://www.youtube.com/live/uSE5pZB3gtQ', title: '테스트 설교', duration: 6000, words: words.map((w) => ({ text: w.text, start: w.start, end: w.end })), edited: false };
      $('chatBody').innerHTML = '';
      addMsg('sys', esc(`「${video.title}」 자막 ${video.words.length.toLocaleString()}단어를 불러왔습니다.`));
      addMsg('ai', '어떤 쇼츠를 만들까요? 아래 버튼으로 길이와 다듬기 조건을 고른 뒤 [구간 3곳 추천받기]를 누르거나, 원하는 내용을 말씀해 주세요.');
      renderQuick(); setCompose(true);
      // 내용·대상·강도·후보 수 버튼
      document.querySelector('#chatQuick [data-content="application"]').click();
      document.querySelector('#chatQuick [data-content="gospel"]').click();
      document.querySelector('#chatQuick [data-aud="seekers"]').click();
      document.querySelector('#chatQuick [data-int="4"]').click();
      document.querySelector('#chatQuick [data-count="3"]').click();
      await sleep(600);
      await SS.testShot('cache/chat_buttons/1_start.png');
      document.querySelector('#chatQuick [data-act="recommend"]').click();
      await waitFor(() => !busy && document.querySelectorAll('#chatBody .msg.cand').length === 3, 20000, 'candidates');
      step('recommend', { candidates: document.querySelectorAll('#chatBody .msg.cand').length });
      for (const must of ['내용: 삶의 적용·복음 중심', '대상: 교회에 처음 온 분', '강도: 5단계 중 4', '구간 3곳을 추천']) if (!report.sent[0].includes(must)) throw new Error('추천 요청에 없음: ' + must);
      await sleep(400);
      await SS.testShot('cache/chat_buttons/2_candidates.png');
      document.querySelector('#chatBody .msg.cand [data-pick="1"]').click();
      await waitFor(() => !busy && /편집기에 반영했습니다/.test($('chatBody').textContent), 120000, 'apply');
      step('pick1');
      await sleep(1500);
      await SS.testShot('cache/chat_buttons/3_made.png');
      document.querySelector('#chatQuick [data-act="title"]').click();
      await waitFor(() => !busy && /제목·본문만 반영/.test($('chatBody').textContent), 20000, 'title');
      step('title');
      document.querySelector('#chatQuick [data-act="gaps-now"]').click();
      await waitFor(() => !busy && /공백.*(줄였습니다|없습니다|실패)/.test(($('chatBody').lastElementChild || {}).textContent || ''), 60000, 'gaps-now');
      step('gaps-now');
      document.querySelector('#chatQuick [data-len="90"]').click();
      await waitFor(() => !busy && report.sent.length >= 4 && /편집기에 반영했습니다/.test(($('chatBody').textContent || '').slice(-400)), 120000, 'length');
      step('length90');
      await sleep(1200);
      await SS.testShot('cache/chat_buttons/4_after.png');
      await api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
      stub = null;
      api.notifyTestReady({ ok: true, steps: report.steps.length });
    } catch (err) {
      console.error(err);
      try { const l = await api.getLaunchInfo(); await api.writeText(l.cache + '/chat_buttons/report.json', JSON.stringify(Object.assign(report, { error: String(err && err.stack || err) }), null, 2)); } catch (_) { /* */ }
      api.notifyTestError(err && err.stack || err);
    }
  });

  // ---------- 테스트 훅: SS_TEST_SCRIPT=chatreal (실제 AI·실제 유튜브: 구간 3곳 추천 → 1번 후보로 만들기) ----------
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'chatreal') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(300); } };
    const tail = (n) => Array.from($('chatBody').children).slice(-n).map((x) => x.textContent.slice(0, 300));
    const report = { steps: [] };
    let dir = '';
    try {
      const launch = await api.getLaunchInfo();
      dir = launch.cache + '/chat_real';
      await api.mkdir(dir);
      await api.llmSetActive(launch.testProvider || 'claude');
      await refreshStatus();
      prefs = Object.assign({}, DEFAULT_PREFS);
      $('chatUrl').value = launch.testUrl || 'https://www.youtube.com/live/uSE5pZB3gtQ';
      $('chatLoad').click();
      await waitFor(() => video && !$('chatText').disabled, 180000, 'load');
      let t0 = Date.now();
      document.querySelector('#chatQuick [data-act="recommend"]').click();
      await waitFor(() => !busy, 900000, 'recommend');
      const cards = Array.from(document.querySelectorAll('#chatBody .msg.cand'));
      report.steps.push({ name: 'recommend', sec: (Date.now() - t0) / 1000, cards: cards.map((c) => c.querySelector('.cand-head').textContent + ' ' + ((c.querySelector('.cand-title') || {}).textContent || '') + ' / ' + ((c.querySelector('.cand-why') || {}).textContent || '')), tail: tail(2) });
      console.log('[chatreal] ' + JSON.stringify(report.steps[0]).slice(0, 900));
      await SS.testShot('cache/chat_real/1_candidates.png');
      if (!cards.length) throw new Error('후보가 없습니다');
      t0 = Date.now();
      cards[0].querySelector('[data-pick]').click();
      await waitFor(() => !busy, 900000, 'pick');
      report.steps.push({ name: 'pick1', sec: (Date.now() - t0) / 1000, dur: +editedDuration().toFixed(1), title: SS.state.meta && SS.state.meta.title, verse: SS.state.meta && SS.state.meta.verse, cuts: (SS.state.words || []).filter((w) => w.cutBefore).length, tail: tail(4) });
      console.log('[chatreal] ' + JSON.stringify(report.steps[1]).slice(0, 900));
      await sleep(1500);
      await SS.testShot('cache/chat_real/2_made.png');
      await api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
      api.notifyTestReady({ ok: true });
    } catch (err) {
      console.error(err);
      try { if (dir) await api.writeText(dir + '/report.json', JSON.stringify(Object.assign(report, { error: String(err && err.stack || err), tail: tail(4) }), null, 2)); } catch (_) { /* */ }
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
