/* 배경음악: 추천 목록에서 고르고(원래 사이트에서 바로 스트리밍 재생·일시정지), 곡의 쓸 구간·페이드 인/아웃·
 * 맞추기(영상 처음에 시작 / 영상 끝에 끝남)·크기를 정한다. 미리보기 재생 때 영상과 함께 들리고, 내보낼 때 섞인다.
 * 계산은 SS.bgm(shared/bgm.js)로 미리보기와 내보내기가 똑같이 한다. 음악 파일은 앱에 들어 있지 않다. */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const B = () => SS.bgm;
  const CAT = () => SS.bgmCatalog;

  const mix = new Audio();      // 영상과 함께 나오는 음악
  mix.preload = 'auto';
  const lib = new Audio();      // 목록·구간 듣기
  lib.preload = 'none';
  let libId = null, libStop = null, peaks = null, peaksFor = null, drag = null;
  let libLoading = null, libGen = 0; // 누르고 소리 나기 전인 곡 / 듣기 요청 번호 (멈추면 앞 요청 무시)
  // 음악 파일 받기: 곡을 고르면 바로 뒤에서 받는다(내보내기에 필요). 받은 뒤엔 미리보기도 내 컴퓨터 파일로 재생해
  // 영상을 앞뒤로 옮겨도 음악이 바로 따라온다. 받기 전에는 원래 사이트에서 스트리밍.
  const local = {};               // id → file:// 주소
  const dl = {};                  // id → { got, total, state: 'loading'|'done'|'error', error }
  // 듣기는 앱 안 통로로: 받은 파일이 있으면 그것, 없으면 여러 갈래로 받는 대로 바로 (main/bgm.js serve)
  const srcOf = (t) => 'ssbgm://track/' + encodeURIComponent(t.id);
  function showDl() {
    const el = $('bgmDl'); const b = cur(); if (!el) return;
    const d = b && dl[b.id];
    if (!d || d.state === 'done') { el.hidden = true; return; }
    el.hidden = false;
    if (d.state === 'error') { el.className = 'bgm-row bgm-dl err'; el.innerHTML = '음악 파일을 받지 못했습니다. 들어 보기는 되고, 내보낼 때 다시 받습니다. <a href="#" id="bgmDlRetry">다시 받기</a>'; $('bgmDlRetry').onclick = (e) => { e.preventDefault(); delete dl[b.id]; prefetch(b.id); }; return; }
    const pct = d.total ? Math.min(99, Math.floor((d.got / d.total) * 100)) : 0;
    el.className = 'bgm-row bgm-dl';
    el.innerHTML = `<span class="bgm-dl-bar"><i style="width:${pct}%"></i></span><span>음악 파일 받는 중 ${d.total ? pct + '%' : '…'} <small>· 편집은 그대로 하셔도 됩니다</small></span>`;
  }
  function prefetch(id) {
    if (!id || local[id] || (dl[id] && dl[id].state !== 'error')) return;
    dl[id] = { got: 0, total: 0, state: 'loading' }; showDl();
    api.bgmFetch(id).then((file) => {
      if (typeof file === 'string' && file) local[id] = SS.toFileUrl ? SS.toFileUrl(file) : 'file:///' + file.replace(/\\/g, '/');
      dl[id] = { ...dl[id], state: 'done' }; showDl();
    }).catch((e) => { dl[id] = { ...dl[id], state: 'error', error: String(e && e.message || e) }; showDl(); });
  }
  if (api.onBgmProgress) api.onBgmProgress((p) => { const d = dl[p.id]; if (d && d.state === 'loading') { d.got = p.got; d.total = p.total; showDl(); } });
  SS.bgmDl = { prefetch, local, dl, srcOf: (id) => { const t = track(id); return t ? srcOf(t) : ''; } };

  const custom = new Map();   // 직접 넣은 음악 (내 파일·유튜브) id → 곡 정보 (main/bgm.js customTrack)
  const track = (id) => (CAT() ? CAT().tracks.find((t) => t.id === id) : null) || custom.get(id) || null;
  let customAsked = '';
  async function loadCustom() { try { (await api.bgmCustomList() || []).forEach((t) => custom.set(t.id, t)); } catch (_) { /* */ } }
  /** 프로젝트에 직접 넣은 음악이 있는데 목록에 아직 없으면 main 에 물어본다 */
  function askCustom(id) {
    if (!id || !String(id).startsWith('custom-') || custom.has(id) || customAsked === id) return;
    customAsked = id;
    api.bgmTrack(id).then((t) => { if (t) { custom.set(t.id, t); render(); drawWave(); } else { const n = $('bgmDl'); if (n) { n.hidden = false; n.className = 'bgm-row bgm-dl err'; n.textContent = '직접 넣은 음악 파일을 찾을 수 없습니다. [바꾸기]에서 음악을 다시 넣어 주세요.'; } } }).catch(() => {});
  }
  const cur = () => (SS.state && SS.state.bgm ? SS.state.bgm : null);
  const outDur = () => (SS.getSegments ? SS.edl.segmentsDuration(SS.getSegments()) : 0);
  const planNow = () => { const b = cur(); return b ? B().plan(b, outDur()) : null; };

  function toast(m, ms) { if (SS.toast) SS.toast(m, ms || 3500); }

  // ---------------- 카드 탭 (디자인 / 배경음악) ----------------
  function setTab(which) {
    const music = which === 'music';
    $('designPane').hidden = music; $('bgmPane').hidden = !music;
    $('tabDesign').classList.toggle('on', !music); $('tabMusic').classList.toggle('on', music);
    $('tabDesign').setAttribute('aria-selected', String(!music)); $('tabMusic').setAttribute('aria-selected', String(music));
    $('btnChurchMore').hidden = music;
    if (music) { render(); drawWave(); }
    if (SS.syncRail) SS.syncRail();
  }
  SS.showBgmTab = () => setTab('music');
  SS.showDesignTab = () => setTab('design');

  // ---------------- 고른 음악 표시 ----------------
  function render() {
    const b = cur(), t = b && track(b.id);
    if (b && !t) askCustom(b.id);
    $('bgmNone').hidden = !!t; $('bgmOn').hidden = !t;
    $('tabMusic').classList.toggle('has', !!t);
    if (!t) return;
    prefetch(t.id); showDl();
    $('bgmTitle').textContent = t.title;
    $('bgmSub').textContent = `${t.artist} · ${t.mood} · ${B().fmt(t.durationSec)}`;
    const p = planNow();
    $('bgmA').value = B().fmt(b.trackStart); $('bgmB').value = B().fmt(b.trackEnd);
    const sel = b.trackEnd - b.trackStart, od = outDur();
    $('bgmLen').textContent = `${B().fmt(sel)} 구간` + (od ? (sel > od + 0.5 ? ` · 영상(${B().fmt(od)})보다 길어 ${b.align === 'end' ? '뒷부분' : '앞부분'}만 씀` : sel < od - 0.5 ? ` · 영상보다 짧아 ${b.align === 'end' ? '끝에 맞춰 늦게 시작' : '처음부터 나오고 먼저 끝남'}` : '') : '');
    document.querySelectorAll('#bgmAlign [data-align]').forEach((x) => x.classList.toggle('on', x.dataset.align === b.align));
    $('bgmFi').value = b.fadeIn; $('bgmFo').value = b.fadeOut;
    $('bgmVol').value = Math.round(b.volume * 100); $('bgmVolLbl').textContent = Math.round(b.volume * 100) + '%';
    const credit = t.custom ? `직접 넣은 음악 · 저작권은 직접 확인해 주세요${t.kind === 'youtube' ? ' (유튜브 음악은 대부분 저작권이 있습니다)' : ''}` : t.attribution ? `출처 표시 필요 (${t.license}): ${t.attribution}` : `${t.license} · 출처 표시 없이 써도 됩니다`;
    $('bgmCredit').innerHTML = `<span class="bgm-lic">${esc(t.license)}</span> ${esc(credit)} <a href="#" id="bgmCopy">복사</a>`;
    $('bgmCopy').onclick = (e) => { e.preventDefault(); navigator.clipboard.writeText(creditText()).then(() => toast('음악 출처를 복사했습니다. 영상 설명란에 붙여 넣으세요.')); };
    void p;
  }

  /** 영상 설명란에 넣을 음악 출처 (CC BY 는 꼭) */
  function creditText() {
    const b = cur(), t = b && track(b.id);
    if (!t) return '';
    if (t.custom) return t.kind === 'youtube' ? `음악: "${t.title}" - ${t.artist} (${t.source})` : `음악: "${t.title}"`;
    return t.attribution ? `음악: ${t.attribution}` : `음악: "${t.title}" - ${t.artist} (${t.license})`;
  }
  SS.bgmCredit = creditText;

  function change(patch, record) {
    const b = cur(); if (!b) return;
    SS.state.bgm = B().normalize({ ...b, ...patch, duration: (track(b.id) || {}).durationSec || b.duration });
    if (record !== false && SS.pushUndo) SS.pushUndo();
    render(); drawWave(); sync(true);
  }

  // ---------------- 파형 (곡 전체, 쓸 구간 손잡이) ----------------
  async function loadPeaks() {
    const b = cur(); if (!b || peaksFor === b.id) return;
    peaksFor = b.id; peaks = null;
    const pre = SS.bgmPeaks && SS.bgmPeaks.get(b.id, 420); // 앱에 넣어 둔 파형: 받지 않고 바로
    if (pre) { peaks = pre.peaks; $('bgmWaveMsg').hidden = true; drawWave(); return; }
    $('bgmWaveMsg').textContent = '파형 불러오는 중… (처음 한 번 음악을 받습니다)'; $('bgmWaveMsg').hidden = false;
    try {
      const r = await api.bgmPeaks(b.id, 420);
      if (peaksFor !== b.id) return;
      peaks = r.peaks; $('bgmWaveMsg').hidden = true;
      const t = track(b.id);
      if (t && r.duration && Math.abs((t.durationSec || 0) - r.duration) > 2) t.durationSec = r.duration;
    } catch (e) {
      $('bgmWaveMsg').textContent = '파형을 불러오지 못했습니다 (인터넷 연결 확인). 구간은 숫자로 정할 수 있어요.';
      peaksFor = null;
    }
    drawWave();
  }
  function drawWave() {
    const c = $('bgmWave'), b = cur(), t = b && track(b.id);
    if (!c || !t || $('bgmPane').hidden) return;
    if (peaksFor !== b.id) loadPeaks();
    const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w || !h) return;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    const dur = t.durationSec || 1, X = (s) => (s / dur) * w;
    const p = planNow();
    // 고른 구간 · 실제로 쓰는 부분
    g.fillStyle = 'rgba(37,99,235,.08)'; g.fillRect(X(b.trackStart), 0, X(b.trackEnd) - X(b.trackStart), h);
    if (p) { g.fillStyle = 'rgba(37,99,235,.16)'; g.fillRect(X(p.from), 0, X(p.from + p.length) - X(p.from), h); }
    if (peaks) {
      const n = peaks.length, bw = w / n;
      for (let i = 0; i < n; i++) {
        const s = (i / n) * dur, inSel = s >= b.trackStart && s <= b.trackEnd;
        const v = Math.max(1, peaks[i] * (h * 0.42));
        g.fillStyle = inSel ? '#60a5fa' : '#d5dde8';
        g.fillRect(i * bw, h / 2 - v, Math.max(1, bw - 0.6), v * 2);
      }
    }
    // 페이드 모양
    if (p) {
      const a = X(p.from), e = X(p.from + p.length), fi = X(p.from + p.fadeIn) - a, fo = e - X(p.from + p.length - p.fadeOut);
      g.strokeStyle = '#f59e0b'; g.lineWidth = 1.5; g.beginPath();
      g.moveTo(a, h - 3); g.lineTo(a + fi, 4); g.lineTo(e - fo, 4); g.lineTo(e, h - 3); g.stroke();
    }
    // 손잡이
    [b.trackStart, b.trackEnd].forEach((s) => { const x = X(s); g.fillStyle = '#2563eb'; g.fillRect(x - 1.5, 0, 3, h); g.fillRect(x - 5, 0, 10, 8); g.fillRect(x - 5, h - 8, 10, 8); });
    // 재생 위치
    const now = !mix.paused ? mix.currentTime : (!lib.paused && libId === b.id ? lib.currentTime : null);
    if (now != null) { g.fillStyle = '#0f172a'; g.fillRect(X(now) - 0.5, 0, 1.5, h); }
  }
  function waveTime(e) {
    const c = $('bgmWave'), r = c.getBoundingClientRect(), t = track(cur().id);
    return Math.max(0, Math.min(t.durationSec, ((e.clientX - r.left) / r.width) * t.durationSec));
  }

  // ---------------- 영상과 함께 재생 (미리보기) ----------------
  let lastSrc = '', mixDirect = null;
  const syncStats = { seeks: 0, nudges: 0, log: [] }; // 시험용: 강제로 옮긴 횟수·속도로 맞춘 횟수
  function sync(force) {
    const b = cur(), t = b && track(b.id);
    const v = SS.preview && SS.preview.video;
    const playing = v && !v.paused && SS.playback && SS.playback.active();
    if (!t || !playing) { if (!mix.paused) mix.pause(); return; }
    const want = mixDirect === t.id ? t.url : srcOf(t);
    if (lastSrc !== want) { mix.src = want; lastSrc = want; }
    const p = planNow(), info = SS.playback.timeInfo();
    const tt = B().trackTimeAt(p, info.cur);
    if (tt == null) { if (!mix.paused) mix.pause(); return; }
    mix.volume = Math.max(0, Math.min(1, B().gainAt(p, info.cur)));
    if (mix.paused) { try { mix.currentTime = tt; } catch (_) {} mix.playbackRate = 1; mix.play().catch(() => {}); return; }
    // 지운 곳을 건너뛰느라 영상이 잠깐 멈춘 동안은 음악을 건드리지 않는다 (편집 결과 시간은 이어지므로 곧 다시 맞는다)
    if (!force && (v.seeking || (SS.playback.isSkipping && SS.playback.isSkipping()) || mix.seeking)) return;
    const d = mix.currentTime - tt;
    // 사용자가 옮긴 자리(seeked)·설정을 바꾼 때만 바로 맞춘다. 지운 곳을 건너뛰며 생긴 차이는 속도로 천천히 (배경음악은 0.5초쯤 어긋나도 티가 안 나지만 끊기면 거슬린다)
    if (force || Math.abs(d) > 2) { if (syncStats.log.length < 30) syncStats.log.push({ d: +d.toFixed(3), tt: +tt.toFixed(3), mix: +mix.currentTime.toFixed(3), v: +v.currentTime.toFixed(3), out: +info.cur.toFixed(3), force: !!force, ready: mix.readyState }); try { mix.currentTime = tt; } catch (_) {} mix.playbackRate = 1; syncStats.seeks++; }
    else if (Math.abs(d) > 0.05) { const r = 1 - Math.sign(d) * Math.min(0.08, Math.max(0.02, Math.abs(d) * 0.2)); if (Math.abs(mix.playbackRate - r) > 0.005) { mix.playbackRate = r; syncStats.nudges++; } }
    else if (mix.playbackRate !== 1) mix.playbackRate = 1;
  }
  (function loop() {
    sync(false);
    if (!$('bgmPane') || !$('bgmPane').hidden) { if (!mix.paused || !lib.paused) drawWave(); }
    requestAnimationFrame(loop);
  })();

  // 구간만 듣기 (영상 없이, 페이드 넣어서)
  function listen() {
    const b = cur(), t = b && track(b.id);
    if (!t) return;
    if (!lib.paused && libId === b.id) { lib.pause(); return; }
    playLib(t, b.trackStart, b.trackEnd, b);
  }
  function playLib(t, from, to, fade) {
    stopLib();
    libId = t.id; libLoading = t.id; lib.src = srcOf(t); lib.volume = 0.8;
    refreshLibButtons();
    const gen = libGen;
    const startAt = () => { if (gen !== libGen) return; try { lib.currentTime = from || 0; } catch (_) {} lib.play().catch((e) => { if (gen === libGen) toast('재생하지 못했습니다: ' + e.message); }); };
    if (lib.readyState >= 1) startAt(); else lib.addEventListener('loadedmetadata', startAt, { once: true });
    lib.load && lib.readyState === 0 && lib.load();
    libStop = () => {
      if (lib.paused || libId !== t.id) return;
      const x = lib.currentTime;
      if (to && x >= to) { lib.pause(); return; }
      if (fade) { const fi = fade.fadeIn || 0, fo = fade.fadeOut || 0; let g = 1; if (fi && x - from < fi) g = (x - from) / fi; if (fo && to - x < fo) g = Math.min(g, (to - x) / fo); lib.volume = Math.max(0, Math.min(1, g)) * 0.8; }
      requestAnimationFrame(libStop);
    };
    lib.addEventListener('playing', () => requestAnimationFrame(libStop), { once: true });
    refreshLibButtons();
  }
  // 멈추기: 불러오는 중이던 것도 취소 (다 불러온 뒤 저절로 재생되지 않게)
  function stopLib() { libGen++; if (libLoading) { libLoading = null; refreshLibButtons(); } if (!lib.paused) lib.pause(); }
  lib.addEventListener('pause', refreshLibButtons);
  lib.addEventListener('play', refreshLibButtons);
  // 앱 안 통로가 안 되면 한 번은 원래 사이트에서 바로 듣기 (mixDirect 는 위에)
  lib.addEventListener('error', () => {
    const t = libId && track(libId);
    if (t && /^ssbgm:/.test(lib.currentSrc || lib.src)) { lib.src = t.url; lib.play().catch(() => {}); return; }
    if (libId) toast('음악을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'); libLoading = null; refreshLibButtons();
  });
  mix.addEventListener('error', () => {
    const b = cur();
    if (b && /^ssbgm:/.test(mix.currentSrc || mix.src) && mixDirect !== b.id) { mixDirect = b.id; sync(true); return; }
    if (b) toast('배경음악을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
  });

  // ---------------- 음악 고르기 (목록) ----------------
  let mood = '전체';
  function openLib() {
    let m = $('bgmLib');
    if (!m) {
      m = document.createElement('div'); m.id = 'bgmLib'; m.className = 'modal-overlay bgm-lib';
      m.innerHTML = `<div class="modal-dialog bgm-dialog" role="dialog" aria-label="배경음악 고르기">
        <div class="bgm-lib-head"><div><h3>배경음악 고르기</h3><p>설교 쇼츠에 많이 쓰는 분위기로 골랐습니다. <b>퍼블릭 도메인과 CC BY</b>처럼 저작권이 공개된 곡만 넣었고, 음악은 앱에 들어 있지 않아 원래 사이트에서 바로 재생합니다.</p></div>
        <button class="btn ghost icon-only ico i-x" data-close title="닫기"></button></div>
        <div class="bgm-own">
          <button class="btn sm ico i-folder-open" id="bgmAddFile" type="button" title="내 컴퓨터의 mp3·m4a·wav 등 음악 파일 넣기">내 파일로 넣기</button>
          <div class="bgm-yt"><input id="bgmYtUrl" type="text" spellcheck="false" placeholder="유튜브 링크 붙여넣기 (https://youtu.be/...)"><button class="btn sm ico i-square-play" id="bgmAddYt" type="button">유튜브에서 넣기</button></div>
          <div class="bgm-own-msg" id="bgmImportMsg">직접 넣은 음악은 저작권을 꼭 확인하세요. 유튜브 음악은 대부분 저작권이 있어 올린 영상에 문제가 생길 수 있습니다.</div>
        </div>
        <div class="bgm-moods" id="bgmMoods"></div>
        <div class="bgm-list" id="bgmList"></div>
        <div class="bgm-lib-foot">CC BY 곡은 영상 설명란에 출처를 적어야 합니다 (유튜브로 바로 올리면 자동으로 넣습니다). 같은 곡을 쓴 다른 영상 때문에 유튜브 저작권 알림이 드물게 올 수 있습니다.</div>
      </div>`;
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeLib(); });
      m.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLib(); if (e.key === 'Enter' && e.target.id === 'bgmYtUrl') importYt(); e.stopPropagation(); });
      $('bgmAddFile').addEventListener('click', importFile);
      $('bgmAddYt').addEventListener('click', importYt);
    }
    m.classList.remove('hidden'); m.hidden = false;
    if (SS.state) SS.state.dialogOpen = true;
    renderLib();
  }
  let importing = false;
  function importMsg(text, kind) { const n = $('bgmImportMsg'); if (n) { n.textContent = text; n.className = 'bgm-own-msg' + (kind ? ' ' + kind : ''); } }
  function importBusy(on) { importing = on; ['bgmAddFile', 'bgmAddYt', 'bgmYtUrl'].forEach((id) => { const e = $(id); if (e) e.disabled = on; }); }
  async function afterImport(t) {
    custom.set(t.id, t); mood = '내 음악'; renderLib();
    importMsg(`"${t.title}" (${B().fmt(t.durationSec)})을(를) 넣었습니다.`, 'ok');
    use(t.id);
  }
  async function importFile(p) {
    if (importing) return;
    importBusy(true); importMsg(typeof p === 'string' ? '음악 파일을 넣는 중…' : '음악 파일을 고르세요…');
    try { const t = await api.bgmImportFile(typeof p === 'string' ? p : undefined); if (t) await afterImport(t); else importMsg('취소했습니다.'); }
    catch (e) { importMsg('넣지 못했습니다: ' + cleanErr(e), 'err'); }
    finally { importBusy(false); }
  }
  async function importYt() {
    if (importing) return;
    const url = ($('bgmYtUrl').value || '').trim();
    if (!url) { importMsg('유튜브 링크를 붙여 넣어 주세요.', 'err'); $('bgmYtUrl').focus(); return; }
    importBusy(true); importMsg('유튜브에서 소리만 받는 중…');
    const off = api.onBgmProgress ? api.onBgmProgress((p) => { if (p.id === 'import') importMsg(`유튜브에서 소리만 받는 중… ${Math.round(p.got)}%`); }) : () => {};
    try { const t = await api.bgmImportYoutube(url); $('bgmYtUrl').value = ''; await afterImport(t); }
    catch (e) { importMsg('넣지 못했습니다: ' + cleanErr(e), 'err'); }
    finally { off(); importBusy(false); }
  }
  const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  SS.bgmImport = { file: importFile, youtube: importYt, custom }; // 시험용
  function closeLib() { const m = $('bgmLib'); if (m) m.hidden = true; stopLib(); if (SS.state) SS.state.dialogOpen = false; }
  function renderLib() {
    const C = CAT();
    const mine = Array.from(custom.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const moods = ['전체'].concat(mine.length ? ['내 음악'] : [], C.MOODS);
    if (mood === '내 음악' && !mine.length) mood = '전체';
    const countOf = (x) => x === '전체' ? C.tracks.length + mine.length : x === '내 음악' ? mine.length : C.tracks.filter((t) => t.mood === x).length;
    $('bgmMoods').innerHTML = moods.map((x) => `<button class="bgm-mood${x === mood ? ' on' : ''}" data-mood="${esc(x)}">${esc(x)}<span>${countOf(x)}</span></button>`).join('');
    $('bgmMoods').querySelectorAll('[data-mood]').forEach((b) => b.addEventListener('click', () => { mood = b.dataset.mood; renderLib(); }));
    const list = mood === '내 음악' ? mine : (mood === '전체' ? mine : []).concat(C.tracks.filter((t) => mood === '전체' || t.mood === mood));
    const sel = cur() && cur().id;
    $('bgmList').innerHTML = list.length ? list.map((t) => `<div class="bgm-item${t.id === sel ? ' sel' : ''}" data-id="${esc(t.id)}">
        <button class="btn icon-only bgm-play ico i-play" data-play="${esc(t.id)}" title="듣기 / 일시정지" aria-label="${esc(t.title)} 듣기"></button>
        <div class="bgm-info"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span><div class="bgm-tags">${(t.tags || []).slice(0, 3).map((x) => `<i>${esc(x)}</i>`).join('')}</div></div>
        <span class="bgm-dur">${B().fmt(t.durationSec)}</span>
        <span class="bgm-lic" title="${esc(t.licenseQuote || '')}">${esc(t.license)}</span>
        <button class="btn sm ${t.id === sel ? '' : 'primary'}" data-use="${esc(t.id)}">${t.id === sel ? '쓰는 중' : '이 음악 쓰기'}</button>${t.custom ? `<button class="btn sm ghost icon-only ico i-trash-2" data-del="${esc(t.id)}" title="내 음악 목록에서 빼기" aria-label="${esc(t.title)} 빼기"></button>` : ''}
      </div>`).join('') : '<div class="bgm-empty">이 분위기의 음악이 아직 없습니다.</div>';
    $('bgmList').querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => {
      const t = track(b.dataset.play);
      if (libLoading === t.id) { stopLib(); return; } // 불러오는 중에 다시 누르면 취소
      if (!lib.paused && libId === t.id) { lib.pause(); return; }
      playLib(t, 0, 0, null);
    }));
    $('bgmList').querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => use(b.dataset.use)));
    $('bgmList').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.del, t = custom.get(id);
      if (cur() && cur().id === id) { toast('지금 쓰는 음악은 뺄 수 없습니다. 다른 음악으로 바꾼 뒤 빼 주세요.'); return; }
      if (!confirm(`"${t ? t.title : id}"을(를) 내 음악 목록에서 뺄까요?`)) return;
      await api.bgmCustomRemove(id); custom.delete(id); renderLib();
    }));
    refreshLibButtons();
  }
  function refreshLibButtons() {
    document.querySelectorAll('[data-play]').forEach((b) => {
      const id = b.dataset.play, load = libLoading === id, on = !load && !lib.paused && libId === id;
      b.classList.toggle('i-play', !on); b.classList.toggle('i-pause', on); b.classList.toggle('playing', on); b.classList.toggle('loading', load);
      b.title = load ? '불러오는 중…' : '듣기 / 일시정지';
    });
    const lb = $('btnBgmListen');
    if (lb) { const mine = cur() && libId === cur().id, load = mine && libLoading === libId, on = !load && !lib.paused && mine; lb.classList.toggle('i-play', !on); lb.classList.toggle('i-pause', on); lb.classList.toggle('loading', !!load); lb.textContent = load ? '불러오는 중' : on ? '멈추기' : '구간 듣기'; }
  }
  // 누른 뒤 소리가 날 때까지 '불러오는 중' 표시
  const libLoaded = () => { if (libLoading) { libLoading = null; refreshLibButtons(); } };
  lib.addEventListener('playing', libLoaded);
  lib.addEventListener('emptied', () => { if (libLoading && libLoading !== libId) libLoaded(); });
  function use(id) {
    const t = track(id); if (!t) return;
    if (SS.pushUndo) SS.pushUndo();
    const prev = cur();
    SS.state.bgm = B().normalize({ ...B().DEFAULTS, ...(prev ? { volume: prev.volume, fadeIn: prev.fadeIn, fadeOut: prev.fadeOut, align: prev.align } : {}), id, duration: t.durationSec, trackStart: 0, trackEnd: t.durationSec });
    peaksFor = null; closeLib(); setTab('music'); render(); drawWave();
    if (SS.pushUndo) SS.pushUndo();
    toast(`"${t.title}"을(를) 배경음악으로 넣었습니다. [재생]으로 영상과 함께 들어 보세요.`);
  }
  SS.useBgm = use;

  // ---------------- 연결 ----------------
  function parseTime(s) {
    s = String(s || '').trim();
    const m = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(s);
    if (m) return +m[1] * 60 + +m[2];
    const n = Number(s); return isFinite(n) ? n : null;
  }
  function init() {
    loadCustom().then(() => { if (cur()) { render(); drawWave(); } });
    if (!$('bgmPane')) return;
    $('tabDesign').addEventListener('click', () => setTab('design'));
    $('tabMusic').addEventListener('click', () => setTab('music'));
    $('btnBgmPick').addEventListener('click', openLib);
    $('btnBgmChange').addEventListener('click', openLib);
    $('btnBgmRemove').addEventListener('click', () => { if (SS.pushUndo) SS.pushUndo(); SS.state.bgm = null; if (SS.pushUndo) SS.pushUndo(); mix.pause(); render(); toast('배경음악을 뺐습니다. (Ctrl+Z 로 되돌리기)'); });
    $('btnBgmPlay').addEventListener('click', () => {
      if (!SS.preview) return;
      if (!SS.preview.paused) { SS.preview.pause(); return; }
      if (SS.setEditedPlayMode) SS.setEditedPlayMode(true);
      SS.preview.play();
    });
    $('btnBgmListen').addEventListener('click', listen);
    $('bgmA').addEventListener('change', () => { const v = parseTime($('bgmA').value); if (v != null) change({ trackStart: v }); else render(); });
    $('bgmB').addEventListener('change', () => { const v = parseTime($('bgmB').value); if (v != null) change({ trackEnd: v }); else render(); });
    document.querySelectorAll('#bgmAlign [data-align]').forEach((x) => x.addEventListener('click', () => change({ align: x.dataset.align })));
    $('bgmFi').addEventListener('change', () => change({ fadeIn: Number($('bgmFi').value) }));
    $('bgmFo').addEventListener('change', () => change({ fadeOut: Number($('bgmFo').value) }));
    $('bgmVol').addEventListener('input', () => { const b = cur(); if (!b) return; b.volume = Number($('bgmVol').value) / 100; $('bgmVolLbl').textContent = $('bgmVol').value + '%'; sync(false); drawWave(); });
    $('bgmVol').addEventListener('change', () => change({ volume: Number($('bgmVol').value) / 100 }));
    const c = $('bgmWave');
    c.addEventListener('mousedown', (e) => {
      const b = cur(); if (!b) return;
      const t = waveTime(e), r = c.getBoundingClientRect(), dur = track(b.id).durationSec, px = (s) => (s / dur) * r.width;
      const dA = Math.abs(px(t) - px(b.trackStart)), dB = Math.abs(px(t) - px(b.trackEnd));
      drag = dA <= dB ? 'a' : 'b';
      if (SS.pushUndo) SS.pushUndo();
      onDrag(e);
    });
    window.addEventListener('mousemove', (e) => { if (drag) onDrag(e); });
    window.addEventListener('mouseup', () => { if (drag) { drag = null; change({}, false); } });
    new ResizeObserver(() => drawWave()).observe(c);
    // 영상 멈춤·자리 옮김에 맞춰
    const hook = () => { const v = SS.preview && SS.preview.video; if (!v) { setTimeout(hook, 100); return; } v.addEventListener('pause', () => mix.pause()); v.addEventListener('seeked', () => { if (SS.playback && SS.playback.isSkipping && SS.playback.isSkipping()) return; sync(true); }); v.addEventListener('play', () => { stopLib(); sync(true); }); };
    hook();
    window.addEventListener('ss:words-changed', () => { render(); drawWave(); });
    render();
  }
  function onDrag(e) {
    const b = cur(); if (!b) return;
    const t = waveTime(e);
    if (drag === 'a') b.trackStart = Math.min(t, b.trackEnd - 1); else b.trackEnd = Math.max(t, b.trackStart + 1);
    render(); drawWave();
  }

  SS.bgmUi = { render, drawWave, openLib, closeLib, sync, listen, mix, lib, setTab, creditText, syncStats };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
