/* 교인 자료 스튜디오: 설교로 소그룹 자료·QT·성경 퀴즈·설교 요약·묵상카드·가정예배지를 만들어 인쇄·PDF·이미지로 나눈다.
 * 1) 설교 원고: 이 영상의 설교(유튜브 자막 전체 또는 편집 중인 자막) · 직접 입력 · 파일(.txt .docx .srt)
 * 2) 만들 자료 고르기 (+ 상세 설정: 대상·형식·일수·분량·카드 분위기)
 * 3) 연결한 AI(챗GPT·클로드·제미나이·오픈라우터)로 만들고, 화면에서 바로 고친 뒤 내보낸다
 * 만든 자료는 프로젝트(.sshorts)에 함께 저장된다 (SS.state.materials). */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const M = () => SS.materials;
  const D = () => SS.materialsDoc;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let root = null, page = 'make', current = null, busy = false, sceneUrl = '', toastTimer = 0;

  /** 지난 주일(오늘이 주일이면 오늘) */
  function lastSunday() {
    const d = new Date(); d.setDate(d.getDate() - d.getDay());
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  function store() {
    const st = SS.state;
    if (!st.materials || typeof st.materials !== 'object') st.materials = {};
    const m = st.materials;
    m.source = m.source || 'video';
    m.sermon = typeof m.sermon === 'string' ? m.sermon : '';
    m.options = M().normOptions(m.options);
    m.selected = Array.isArray(m.selected) ? m.selected.filter((t) => M().typeOf(t)) : ['smallgroup', 'qt', 'quiz', 'summary', 'cards'];
    m.results = m.results && typeof m.results === 'object' ? m.results : {};
    m.design = D().DESIGNS.some((x) => x.id === m.design) ? m.design : 'navy';
    m.meta = m.meta || {};
    return m;
  }
  /** 예배 날짜의 요일 → 홈페이지 예배 종류 (수요일·금요일, 나머지는 주일) */
  function serviceOf(date) {
    const iso = M().isoDate(date), d = new Date(iso + 'T00:00:00');
    return { 3: 'wednesday', 5: 'friday' }[d.getDay()] || 'sunday';
  }
  function meta() {
    const m = store(), st = SS.state, s = SS.appSettings || {};
    const t = st.meta || {};
    return {
      church: m.meta.church != null ? m.meta.church : ((s.template && s.template.churchName) || ''),
      title: m.meta.title != null ? m.meta.title : String(t.title || '').replace(/\*/g, '').replace(/\s+\/\s+/g, ' '),
      verse: m.meta.verse != null ? m.meta.verse : (t.verse || ''),
      speaker: m.meta.speaker != null ? m.meta.speaker : (t.speaker || s.defaultSpeaker || ''),
      date: m.meta.date != null ? m.meta.date : lastSunday(),
    };
  }
  function toast(msg, ms) {
    const t = $('mnToast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3200);
  }
  const cleanErr = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // ---------------- 뼈대 ----------------
  function build() {
    root = document.createElement('div');
    root.id = 'mnStudio'; root.className = 'mn'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', '교인 자료 스튜디오');
    root.innerHTML = `
      <aside class="mn-side">
        <div class="mn-brand"><span class="mn-logo"></span><b>교인 자료</b><span>스튜디오</span></div>
        <div class="mn-church ico i-church"><span id="mnChurchName">우리 교회</span><span class="mn-badge">교회</span></div>
        <div class="mn-sec">자료 만들기</div>
        <nav class="mn-nav">
          <button data-page="make" class="ico i-wand-sparkles on">콘텐츠 만들기</button>
          <button data-page="results" class="ico i-book-open">만든 자료<span id="mnResultCount" class="mn-count" hidden>0</span></button>
        </nav>
        <div class="mn-sec">설교에서 함께 쓰기</div>
        <nav class="mn-nav">
          <button data-go="shorts" class="ico i-clapperboard">쇼츠 편집기</button>
        </nav>
        <div class="mn-side-foot">
          <div class="mn-side-note">만든 자료는 이 프로젝트를 저장할 때 함께 저장됩니다. 인쇄·PDF·이미지로 나눠 주세요.</div>
          <button id="mnClose" class="mn-back ico i-arrow-left">편집기로 돌아가기</button>
        </div>
      </aside>
      <section class="mn-main" id="mnMain">
        <div class="mn-page" data-page="make">
          <h1 class="mn-h1">콘텐츠 만들기</h1>
          <p class="mn-lead">설교 한 편으로 성도들에게 나눠 줄 자료를 한 번에 준비합니다.</p>
          <div class="mn-card">
            <div class="mn-card-head"><h2>1. 설교 원고</h2></div>
            <div class="mn-seg" role="tablist">
              <button data-src="video" class="ico i-film">이 영상의 설교</button>
              <button data-src="manual" class="ico i-pencil-line">직접 입력</button>
              <button data-src="file" class="ico i-upload">파일 불러오기</button>
            </div>
            <div class="mn-srcinfo ico i-info" id="mnSrcInfo"></div>
            <textarea id="mnSermon" class="mn-textarea" placeholder="설교 원고를 붙여 넣으세요. 자동 자막처럼 띄어쓰기가 틀려도 괜찮습니다."></textarea>
            <div style="display:flex;margin-top:6px"><span id="mnSermonCount" class="mn-count"></span></div>
            <div class="mn-meta">
              <label>설교 제목<input id="mnTitle" class="mn-input"></label>
              <label>본문<input id="mnVerse" class="mn-input" placeholder="예: 로마서 1:16-17"></label>
              <label>설교자<input id="mnSpeaker" class="mn-input"></label>
              <label>날짜<input id="mnDate" class="mn-input"></label>
            </div>
          </div>
          <div class="mn-card">
            <div class="mn-card-head"><h2>2. 만들 자료</h2><span class="mn-spacer"></span><span id="mnAi" class="mn-chip"></span>
              <button id="mnOptBtn" class="mn-btn ico i-sliders-horizontal">상세 설정</button></div>
            <div class="mn-tiles" id="mnTiles"></div>
            <div class="mn-go">
              <button id="mnGo" class="mn-btn blue ico i-wand-sparkles">선택한 자료 만들기</button>
              <div class="mn-note" id="mnGoNote">AI 가 설교에 있는 내용만으로 만듭니다. 만든 뒤 글자를 눌러 바로 고칠 수 있어요.</div>
            </div>
            <div id="mnErr" class="mn-err" hidden></div>
          </div>
        </div>
        <div class="mn-page" data-page="results" hidden>
          <h1 class="mn-h1">만든 자료</h1>
          <p class="mn-lead">글자를 누르면 그 자리에서 고칩니다. 다 고쳤으면 인쇄하거나 PDF·이미지로 저장하세요.</p>
          <div class="mn-tabs" id="mnTabs"></div>
          <div class="mn-bar" id="mnBar"></div>
          <div class="mn-stagebox" id="mnStage"></div>
        </div>
      </section>
      <div class="mn-modal" id="mnOpt" hidden><div class="mn-dialog">
        <div class="mn-dialog-head">생성 옵션<span class="mn-spacer"></span><button class="mn-btn" data-close-opt>닫기</button></div>
        <div class="mn-dialog-body" id="mnOptBody"></div>
        <div class="mn-dialog-foot"><button class="mn-btn" id="mnOptReset">기본값</button><button class="mn-btn blue" data-close-opt>적용</button></div>
      </div></div>
      <div class="mn-toast" id="mnToast" hidden></div>`;
    document.body.appendChild(root);
    const style = document.createElement('style'); style.id = 'mnDocCss'; style.textContent = D().DOC_CSS.replace(/body\{[^}]*\}/, '').replace(/@page\{[^}]*\}/, '');
    document.head.appendChild(style);

    root.querySelectorAll('.mn-nav [data-page]').forEach((b) => b.addEventListener('click', () => show(b.dataset.page)));
    root.querySelector('[data-go="shorts"]').addEventListener('click', close);
    $('mnClose').addEventListener('click', close);
    root.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => setSource(b.dataset.src, true)));
    $('mnSermon').addEventListener('input', () => { store().sermon = $('mnSermon').value; count(); });
    for (const [id, key] of [['mnTitle', 'title'], ['mnVerse', 'verse'], ['mnSpeaker', 'speaker'], ['mnDate', 'date']]) $(id).addEventListener('input', () => { store().meta[key] = $(id).value; });
    $('mnOptBtn').addEventListener('click', openOptions);
    root.querySelectorAll('[data-close-opt]').forEach((b) => b.addEventListener('click', () => { $('mnOpt').hidden = true; tiles(); }));
    $('mnOptReset').addEventListener('click', () => { store().options = M().normOptions({}); renderOptions(); });
    $('mnGo').addEventListener('click', generate);
    root.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 편집기 단축키가 먹지 않게
      if (e.key === 'Escape') { if (!$('mnOpt').hidden) $('mnOpt').hidden = true; else close(); }
    });
    root.addEventListener('input', onEdit);
  }

  function show(p) {
    page = p;
    root.querySelectorAll('.mn-page').forEach((x) => { x.hidden = x.dataset.page !== p; });
    root.querySelectorAll('.mn-nav [data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
    if (p === 'results') renderResults();
    $('mnMain').scrollTop = 0;
  }

  // ---------------- 1. 설교 원고 ----------------
  function count() {
    const n = ($('mnSermon').value || '').replace(/\s/g, '').length;
    $('mnSermonCount').textContent = n ? n.toLocaleString() + '자' : '';
  }
  async function setSource(kind, user) {
    const m = store();
    root.querySelectorAll('[data-src]').forEach((b) => b.classList.toggle('on', b.dataset.src === kind));
    const info = $('mnSrcInfo');
    if (kind === 'file' && user) {
      try {
        const r = await api.materialsReadFile();
        if (!r) { setSource(m.source === 'file' ? 'file' : m.source, false); return; }
        m.source = 'file'; m.sermon = r.text; m.fileName = r.name;
      } catch (e) { info.textContent = '파일을 읽지 못했습니다: ' + cleanErr(e); return; }
    } else if (kind === 'video' && (user || !m.sermon)) {
      m.source = 'video';
      let text = '', note = '';
      try {
        const src = await api.materialsSermon();
        if (src && src.text) { text = src.text; note = `AI 편집 대화에서 불러온 유튜브 자막${src.whole ? ' 전체' : '의 설교 부분'} (약 ${src.minutes}분)`; }
      } catch (_) { /* 대화 없음 */ }
      if (!text && SS.state.words && SS.state.words.length) {
        text = M().sermonText(SS.state.words);
        const w = SS.state.words;
        note = `편집 중인 영상의 자막 (약 ${Math.max(1, Math.round((w[w.length - 1].end - w[0].start) / 60))}분). 설교 전체로 만들려면 AI 편집 대화에 유튜브 주소를 넣거나 원고 파일을 불러오세요.`;
      }
      if (!text) note = '불러올 설교 자막이 없습니다. 원고를 직접 넣거나 파일을 불러오세요.';
      m.sermon = text; m.sourceNote = note;
    } else if (kind === 'manual' && user) {
      m.source = 'manual'; m.sourceNote = '';
    }
    m.source = kind === 'file' && !m.fileName ? m.source : kind;
    info.textContent = kind === 'file' ? (m.fileName ? `불러온 파일: ${m.fileName}` : '.txt · Word(.docx) · 자막(.srt) 파일을 불러옵니다')
      : kind === 'manual' ? '설교 원고를 아래에 붙여 넣거나 직접 쓰세요.' : (m.sourceNote || '');
    $('mnSermon').value = m.sermon || '';
    count();
  }

  // ---------------- 2. 만들 자료 ----------------
  function tiles(status) {
    const m = store();
    status = status || {};
    $('mnTiles').innerHTML = M().TYPES.map((t) => {
      const on = m.selected.includes(t.id), st = status[t.id];
      const state = st === 'busy' ? '<span class="mn-state busy"><span class="mn-spin"></span>만드는 중</span>'
        : st === 'done' ? '<span class="mn-state done">완성</span>' : st && st.err ? '<span class="mn-state err">실패</span>'
          : m.results[t.id] ? '<span class="mn-state done">만든 자료 있음</span>' : '';
      return `<button class="mn-tile${on ? ' on' : ''}" data-type="${t.id}" aria-pressed="${on}"><span class="mn-ic ico ${t.icon}"></span><span><b>${esc(t.label)}</b><small>${esc(optSummary(t.id))}</small></span><span class="mn-check"></span>${state}</button>`;
    }).join('');
    $('mnTiles').querySelectorAll('.mn-tile').forEach((b) => b.addEventListener('click', () => {
      if (busy) return;
      const id = b.dataset.type, sel = m.selected;
      const i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else sel.push(id);
      tiles();
    }));
    $('mnGo').textContent = `선택한 자료 만들기 (${m.selected.length})`;
    $('mnGo').disabled = busy || !m.selected.length;
  }
  function optSummary(id) {
    const o = store().options;
    const a = o.audience;
    switch (id) {
      case 'smallgroup': return `${a} · ${o.smallgroup} · 질문 5~6개`;
      case 'qt': return `${a} · ${o.qtDays}일 · ${o.qtFocus} · ${o.qtForm}`;
      case 'quiz': return `${a} · ${o.quiz} · 8문제`;
      case 'summary': return `${a} · ${o.summary}`;
      case 'cards': return `${o.cardTone} · ${o.cardCount}장 · SNS 이미지`;
      case 'family': return '부모와 자녀가 15분 · 쉬운 말';
      case 'cardnews': return `${o.newsCount}장 · 표지·핵심·이번 주 실천 · 인스타`;
      case 'leader': return `${a} · ${o.leaderTime}분 모임 · 질문 의도·예상 답`;
      case 'slides': return `${o.slideCount}장 · 16:9 · PPT 저장`;
    }
    return '';
  }
  function openOptions() { renderOptions(); $('mnOpt').hidden = false; }
  function renderOptions() {
    const o = store().options, O = M().OPTIONS;
    const group = (title, keys) => `<div class="mn-optgroup"><h3>${title}</h3>${keys.map((k) => `<div class="mn-optrow">${O[k].values.map((v) => `<button class="mn-opt${o[k] === v ? ' on' : ''}" data-k="${k}" data-v="${esc(v)}">${esc(typeof v === 'number' ? v + ({ cardCount: '장', newsCount: '장', slideCount: '장', leaderTime: '분' }[k] || '일') : v)}</button>`).join('')}</div>`).join('')}</div>`;
    $('mnOptBody').innerHTML = group('공통 설정 · 대상', ['audience']) + group('소그룹 자료', ['smallgroup']) + group('QT 자료', ['qtDays', 'qtFocus', 'qtForm'])
      + group('성경 퀴즈', ['quiz']) + group('설교 요약', ['summary']) + group('묵상카드', ['cardTone', 'cardCount'])
      + group('카드뉴스', ['newsCount']) + group('소그룹 리더 가이드', ['leaderTime']) + group('설교 PPT', ['slideCount']);
    $('mnOptBody').querySelectorAll('.mn-opt').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k, raw = b.dataset.v;
      o[k] = typeof O[k].values[0] === 'number' ? Number(raw) : raw;
      renderOptions();
    }));
  }
  async function aiChip() {
    const chip = $('mnAi');
    try {
      const s = await api.llmStatus();
      const names = { chatgpt: '챗GPT', claude: '클로드', gemini: '제미나이', openrouter: '오픈라우터' };
      if (s && s.active) { chip.className = 'mn-chip ok'; chip.textContent = 'AI: ' + (names[s.active] || s.active); chip.onclick = null; return true; }
    } catch (_) { /* 확인 실패 */ }
    chip.className = 'mn-chip warn'; chip.textContent = 'AI 연결 필요 (눌러서 연결)'; chip.style.cursor = 'pointer';
    chip.onclick = () => { close(); const b = $('btnAiConnect'); if (b) b.click(); };
    return false;
  }

  async function generate() {
    if (busy) return;
    const m = store();
    const err = $('mnErr'); err.hidden = true;
    m.sermon = $('mnSermon').value;
    if (m.sermon.replace(/\s/g, '').length < 200) { err.textContent = '설교 원고가 너무 짧습니다. 설교 자막이나 원고를 넣어 주세요 (200자 이상).'; err.hidden = false; return; }
    if (!(await aiChip())) { err.textContent = 'AI 가 연결되어 있지 않습니다. 위의 [AI 연결 필요]를 눌러 챗GPT·클로드·제미나이 중 하나를 연결해 주세요.'; err.hidden = false; return; }
    const md = meta();
    const ctx = { ...md, sermon: m.sermon };
    const queue = m.selected.slice();
    const status = {};
    queue.forEach((t) => { status[t] = 'wait'; });
    busy = true; tiles(status);
    const t0 = Date.now();
    let done = 0, failed = [];
    const worker = async () => {
      while (queue.length) {
        const type = queue.shift();
        status[type] = 'busy'; tiles(status);
        try {
          const r = await api.materialsGenerate(type, m.options, ctx);
          m.results[type] = { data: r.data, options: { ...m.options }, meta: md, made: new Date().toISOString(), provider: r.provider };
          status[type] = 'done'; done++;
        } catch (e) {
          status[type] = { err: cleanErr(e) }; failed.push(M().typeOf(type).label + ': ' + cleanErr(e));
        }
        tiles(status);
      }
    };
    $('mnGoNote').textContent = '만드는 중입니다… 자료마다 30초~1분쯤 걸립니다. 창을 닫지 마세요.';
    await Promise.all([worker(), worker()]);
    busy = false; tiles(status);
    $('mnGoNote').textContent = `${done}개를 만들었습니다 (${Math.round((Date.now() - t0) / 1000)}초).` + (failed.length ? ' 실패한 것은 다시 눌러 주세요.' : '');
    if (failed.length) { err.textContent = failed.join('\n'); err.hidden = false; }
    counts();
    if (done) { current = m.selected.find((t) => m.results[t]) || current; show('results'); toast('자료를 만들었습니다. 글자를 눌러 고칠 수 있어요.'); }
  }

  function counts() {
    const n = Object.keys(store().results).length;
    const c = $('mnResultCount'); c.hidden = !n; c.textContent = n;
  }

  // ---------------- 3. 만든 자료 ----------------
  function renderResults() {
    const m = store();
    const have = M().TYPES.filter((t) => m.results[t.id]);
    if (!have.length) {
      $('mnTabs').innerHTML = ''; $('mnBar').innerHTML = '';
      $('mnStage').innerHTML = '<div class="mn-empty"><b>아직 만든 자료가 없습니다</b>[콘텐츠 만들기]에서 자료를 골라 만들어 보세요.</div>';
      return;
    }
    if (!current || !m.results[current]) current = have[0].id;
    $('mnTabs').innerHTML = have.map((t) => `<button class="mn-tab ico ${t.icon}${t.id === current ? ' on' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`).join('');
    $('mnTabs').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { current = b.dataset.tab; renderResults(); }));
    const type = M().typeOf(current), r = m.results[current];
    const isCards = type.kind === 'cards', isSlides = type.kind === 'slides';
    let bar = '';
    if (isSlides) bar += `<div class="mn-designs">${D().DESIGNS.map((d) => `<button class="mn-design${m.design === d.id ? ' on' : ''}" data-design="${d.id}" title="${esc(d.label)}" style="background:${d.swatch}"></button>`).join('')}</div><span style="width:8px"></span>`
      + '<button class="mn-btn blue ico i-presentation" data-act="pptx">PPT 로 저장</button><button class="mn-btn ico i-image-down" data-act="png">이미지로 저장 (PNG)</button>';
    else if (isCards) bar += `<div class="mn-designs">${D().DESIGNS.map((d) => `<button class="mn-design${m.design === d.id ? ' on' : ''}" data-design="${d.id}" title="${esc(d.label)}" style="background:${d.swatch}"></button>`).join('')}</div><span style="width:8px"></span>`
      + '<button class="mn-btn blue ico i-image-down" data-act="png">이미지로 저장 (PNG)</button>';
    else bar += '<button class="mn-btn blue ico i-file-down" data-act="pdf">PDF 로 저장</button><button class="mn-btn ico i-printer" data-act="print">인쇄</button>'
      + (current === 'summary' ? '<button class="mn-btn ico i-globe" data-act="homepage" title="교회 홈페이지(말씀 요약)에 올릴 글 파일(.md)로 저장합니다">홈페이지 글 저장</button>' : '');
    bar += '<button class="mn-btn ico i-copy" data-act="copy">글 복사 (카톡용)</button><span class="mn-spacer"></span>'
      + `<span class="mn-note">${esc(r.provider ? 'AI: ' + r.provider + ' · ' : '')}${esc(new Date(r.made).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span>`
      + '<button class="mn-btn soft ico i-refresh-cw" data-act="again">다시 만들기</button>';
    $('mnBar').innerHTML = bar;
    $('mnBar').querySelectorAll('[data-design]').forEach((b) => b.addEventListener('click', () => { store().design = b.dataset.design; if (b.dataset.design === 'scene') grabScene(); renderResults(); }));
    $('mnBar').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
    const md = { ...r.meta, ...meta() };
    if (isSlides) {
      if (m.design === 'scene' && !sceneUrl) grabScene();
      $('mnStage').innerHTML = `<div class="mn-slides">${D().slides(r.data, m.design, md, sceneUrl).map((h) => `<div class="mn-slidewrap">${h}</div>`).join('')}</div>`;
    } else if (isCards) {
      if (m.design === 'scene' && !sceneUrl) grabScene();
      const cards = current === 'cardnews' ? D().newsCards(r.data, m.design, md, sceneUrl) : r.data.cards.map((c, i) => D().card(c, i, m.design, md, sceneUrl));
      $('mnStage').innerHTML = `<div class="mn-cards">${cards.map((h) => `<div class="mn-cardwrap">${h}</div>`).join('')}</div>`;
    } else {
      $('mnStage').innerHTML = `<div class="mn-paperwrap">${D().page(current, r.data, md)}</div>`;
      const doc = $('mnStage').querySelector('.doc'); doc.classList.add('mn-paper');
    }
  }

  /** 지금 미리보기 영상 장면을 카드 배경으로 (1080×1350 가운데 잘라 내기) */
  function grabScene() {
    try {
      const v = $('video');
      if (!v || !v.videoWidth) { sceneUrl = ''; return; }
      const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
      const g = c.getContext('2d'), s = Math.max(1080 / v.videoWidth, 1350 / v.videoHeight);
      g.drawImage(v, (1080 - v.videoWidth * s) / 2, (1350 - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s);
      sceneUrl = c.toDataURL('image/jpeg', 0.86);
    } catch (e) { sceneUrl = ''; console.warn('장면 가져오기 실패', e); }
  }

  /** 화면에서 고친 글을 자료 데이터에 반영 (data-path = "points.0.body") */
  function onEdit(e) {
    const el = e.target.closest && e.target.closest('[data-path]');
    if (!el || page !== 'results') return;
    const r = store().results[current]; if (!r) return;
    const keys = el.dataset.path.split('.');
    let o = r.data;
    for (let i = 0; i < keys.length - 1; i++) { o = o[/^\d+$/.test(keys[i]) ? +keys[i] : keys[i]]; if (o == null) return; }
    const last = keys[keys.length - 1];
    const text = el.innerText.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    o[/^\d+$/.test(last) ? +last : last] = text;
  }

  async function act(what) {
    const m = store(), r = m.results[current], type = M().typeOf(current);
    if (!r) return;
    const md = { ...r.meta, ...meta() };
    const name = `${type.label} - ${(md.title || '설교').slice(0, 30)}`;
    try {
      if (what === 'copy') {
        await navigator.clipboard.writeText(M().toText(current, r.data, md));
        toast('글을 복사했습니다. 카톡·문자에 붙여 넣으세요.');
      } else if (what === 'pdf') {
        const body = D().cleanForExport($('mnStage').querySelector('.doc'));
        const p = await api.materialsPdf({ body, css: D().DOC_CSS, name });
        if (p) { toast('PDF 를 저장했습니다.'); api.materialsOpenPath(p); }
      } else if (what === 'print') {
        const body = D().cleanForExport($('mnStage').querySelector('.doc'));
        await api.materialsPrint({ body, css: D().DOC_CSS });
      } else if (what === 'png') {
        const items = Array.from($('mnStage').querySelectorAll('.mcard, .mslide')).map((el) => { const wide = el.classList.contains('mslide'); return { body: D().cleanForExport(el), width: wide ? 1920 : 1080, height: wide ? 1080 : 1350 }; });
        const res = await api.materialsPng({ items, css: D().DOC_CSS, name });
        if (res) { toast(`${type.kind === 'slides' ? '슬라이드' : '카드'} ${res.files.length}장을 저장했습니다.`); api.materialsOpenPath(res.files[0]); }
      } else if (what === 'pptx') {
        if (m.design === 'scene' && !sceneUrl) grabScene();
        const p = await api.materialsPptx({ data: r.data, meta: md, design: m.design, sceneData: m.design === 'scene' ? sceneUrl : '', name });
        if (p) { toast('설교 PPT 를 저장했습니다. 파워포인트에서 글을 고칠 수 있습니다.'); api.materialsOpenPath(p); }
      } else if (what === 'homepage') {
        const out = M().toHomepage(r.data, { ...md, service: serviceOf(md.date) });
        const p = await api.materialsSaveText({ text: out.text, name: out.name, ext: 'md', title: '홈페이지 말씀 요약 글로 저장' });
        if (p) { toast('홈페이지 글(.md)을 저장했습니다. 공개 전 확인용으로 published: false 로 저장됩니다.', 6000); api.materialsOpenPath(p); }
      } else if (what === 'again') {
        if (!confirm(`${type.label}을(를) 다시 만들까요? 지금 고친 내용은 사라집니다.`)) return;
        m.selected = [current]; show('make'); tiles(); generate();
      }
    } catch (e) { toast('실패: ' + cleanErr(e), 6000); }
  }

  // ---------------- 열기·닫기 ----------------
  async function open(where) {
    if (!root) build();
    if (SS.preview) SS.preview.pause();
    if (SS.flushCaptionEdit) SS.flushCaptionEdit(false);
    const m = store(), md = meta();
    $('mnChurchName').textContent = md.church || '우리 교회';
    $('mnTitle').value = md.title; $('mnVerse').value = md.verse; $('mnSpeaker').value = md.speaker; $('mnDate').value = md.date;
    root.hidden = false;
    if (SS.syncRail) SS.syncRail();
    if (SS.state) SS.state.dialogOpen = true;
    await setSource(m.source || 'video', false);
    tiles(); counts(); aiChip();
    show(where || (Object.keys(m.results).length && page === 'results' ? 'results' : 'make'));
  }
  function close() {
    if (!root || busy && !confirm('자료를 만드는 중입니다. 닫아도 만들기는 계속되고, 다시 열면 결과를 볼 수 있습니다. 닫을까요?')) return;
    root.hidden = true;
    if (SS.state) SS.state.dialogOpen = false;
    if (SS.syncRail) SS.syncRail();
  }
  SS.openMaterials = open;
  SS.closeMaterials = close;
  SS._materialsTest = { generate, act, renderResults, show, store, setSource, grabScene, get busy() { return busy; } };

  function init() {
    const b = $('btnMaterials');
    if (b) b.addEventListener('click', () => open());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
