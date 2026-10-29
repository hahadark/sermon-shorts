/* 테스트 훅: SS_TEST_SCRIPT=batch15 — 배경음악(스트리밍 재생·구간·맞추기·미리보기 함께 재생·내보내기 섞기)과
 * 교인 자료 스튜디오(만나로식 화면·자료 6종 그리기·글 고치기·PDF·PNG). AI 는 부르지 않고 정해 둔 자료로 시험한다.
 * 결과: cache/batch15/report.json, 화면 cache/batch15/*.png, 파일 bgm.mp4·nobgm.mp4·summary.pdf·card1.png */
(function () {
  'use strict';
  const SS = window.SS;
  const SAMPLE = {
    summary: { title: '아멘으로 드리는 응답', verse: '마태복음 6:9-13', theme: '주기도문의 아멘은 "진실로 그렇게 살겠습니다"라는 결단입니다.', points: [{ heading: '아멘의 뜻', body: '아멘은 진실로 그러합니다, 꼭 그렇게 될 줄 믿습니다라는 고백입니다.' }, { heading: '믿음과 결단', body: '아멘 안에는 믿음과 결단, 의지가 담긴 반응이 있습니다.' }, { heading: '가르침대로 사는 삶', body: '주기도문에서 배운 대로 나도 그렇게 살겠다고 하나님 앞에 반응합니다.' }], application: '이번 주 기도를 마칠 때마다 "아멘"을 그렇게 살겠다는 결단으로 고백해 봅시다.', prayer: '하나님, 우리의 아멘이 입술이 아니라 삶의 고백이 되게 하소서.' },
    smallgroup: { title: '아멘, 그렇게 살겠습니다', verse: '마태복음 6:9-13', summary: '주기도문은 아멘으로 끝납니다. 아멘은 믿음과 결단이 담긴 반응입니다.', icebreaker: '오늘 예배에서 "아멘"을 가장 크게 한 순간은 언제였나요?', questions: [{ q: '아멘의 뜻을 설교에서 어떻게 설명했나요?', note: '진실로 그러합니다 · 꼭 그렇게 될 줄로 믿습니다' }, { q: '내가 쉽게 아멘 하고 잊어버린 결단이 있다면 나눠 봅시다.', note: '' }, { q: '주기도문의 가르침 가운데 이번 주에 살아 내고 싶은 한 가지는?', note: '' }], action: '하루 한 번 주기도문으로 기도하고 마지막 아멘을 결단으로 고백하기', prayer: '우리의 아멘이 삶으로 이어지게 하소서.' },
    qt: { title: '아멘의 삶 5일', days: [1, 2, 3, 4, 5].map((n) => ({ day: n, title: n + '일째 묵상', passage: '마태복음 6:' + (8 + n) + '-' + (10 + n), meditation: '주기도문의 한 구절을 천천히 읽고 그 뜻을 생각합니다.', keyline: '진실로 그렇게 살겠습니다', question: '오늘 내가 아멘으로 응답할 말씀은 무엇인가요?', action: n % 2 ? '감사 한 가지 적기' : '', prayer: '주님 뜻대로 살게 하소서.' })) },
    quiz: { title: '주기도문과 아멘 퀴즈', items: [{ type: 'ox', q: '아멘은 "진실로 그러합니다"라는 뜻이다.', answer: 'O', explain: '설교에서 아멘의 뜻으로 소개했습니다.' }, { type: 'mc', q: '주기도문은 어느 복음서 6장에 있나요?', choices: ['마가복음', '마태복음', '요한복음', '사도행전'], answer: 2, explain: '마태복음 6:9-13' }, { type: 'ox', q: '아멘은 결단 없이 습관처럼 하면 된다.', answer: 'X', explain: '아멘에는 믿음과 결단이 담겨 있습니다.' }] },
    cards: { cards: [{ headline: '아멘은 결단입니다', body: '진실로 그렇게 살겠습니다라는 고백', source: '마태복음 6:13' }, { headline: '꼭 그렇게 될 줄 믿습니다', body: '아멘 안에 믿음이 담겨 있습니다', source: '설교: 아멘으로 드리는 응답' }, { headline: '가르침대로 살겠습니다', body: '주기도문의 가르침이 오늘 나의 삶으로', source: '마태복음 6:9-13' }] },
    family: { title: '우리 가족의 아멘', verse: '마태복음 6:9-13', opening: '주 예수 내 맘에 들어와', story: '예수님은 제자들에게 기도를 가르쳐 주셨어요. 그 기도는 아멘으로 끝나요. 아멘은 정말 그래요, 꼭 그렇게 살게요라는 약속이에요.', questions: ['우리 가족이 이번 주에 아멘으로 약속할 것은 무엇일까요?', '기도할 때 아멘을 어떤 마음으로 해야 할까요?'], activity: '식사 기도 때 온 가족이 한목소리로 아멘 하기', prayer: '하나님, 우리 가족의 아멘이 진짜 약속이 되게 해 주세요.', blessing: '주님이 우리 가정에 평안을 주시기를 축복합니다.' },
  };

  // 실제 AI 로 2종 만들어 보기 (SS_TEST_SCRIPT=materials-ai): 유튜브 자막에서 설교 30분쯤을 원고로
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'materials-ai') return;
    const report = { startedAt: new Date().toISOString(), runs: [] };
    let dir = '';
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/materials_ai'; await window.api.mkdir(dir);
      const raw = await window.api.readJson(launch.cache + '/yt/uSE5pZB3gtQ/uSE5pZB3gtQ.ko.json3');
      const words = SS.chatPlan.wordsFromJson3(raw).words.filter((w) => w.start >= 3300 && w.end <= 5200);
      const sermon = SS.materials.sermonText(words);
      report.sermonChars = sermon.length;
      await window.api.llmSetActive('claude');
      const st = await window.api.llmStatus(); report.provider = st.active;
      const ctx = { church: '구세군 대구사랑영문', title: '하나님 중심의 기도', verse: '마태복음 6:13', speaker: '차재수 사관', date: '2026년 10월 25일', sermon };
      for (const type of ['summary', 'smallgroup']) {
        const t0 = Date.now();
        try { const r = await window.api.materialsGenerate(type, { audience: '장년' }, ctx); report.runs.push({ type, ok: true, ms: Date.now() - t0, data: r.data }); }
        catch (err) { report.runs.push({ type, ok: false, ms: Date.now() - t0, error: String(err.message || err) }); }
      }
      report.success = report.runs.every((r) => r.ok);
    } catch (err) { report.success = false; report.error = err.stack || String(err); }
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error || 'AI 생성 실패');
  });

  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'batch15') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const report = { startedAt: new Date().toISOString(), checks: [] };
    const check = (name, ok, extra) => { report.checks.push({ name, ok: !!ok, extra }); if (!ok) throw new Error(name + ' ' + JSON.stringify(extra === undefined ? '' : extra)); };
    let dir = '';
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/batch15';
      await window.api.mkdir(dir);
      const shot = (n) => SS.testShot(dir + '/' + n + '.png');
      const t0 = Date.now();
      while (!(SS.state && SS.state.words && SS.state.words.length && document.querySelector('.caption-output'))) { if (Date.now() - t0 > 60000) throw new Error('자막이 열리지 않았습니다'); await sleep(200); }
      SS.preview.pause();
      const ws = SS.state.words;
      SS.pushUndo();
      for (let i = 0; i < ws.length; i++) ws[i].del = i < 3 || (i >= 30 && i < 45) || i >= 120;
      SS.renderTranscript();
      const outDur = SS.edl.segmentsDuration(SS.getSegments());

      // ---------- 배경음악 ----------
      check('추천 목록 24곡', SS.bgmCatalog.tracks.length >= 20, SS.bgmCatalog.tracks.length);
      document.getElementById('tabMusic').click(); await sleep(150);
      check('배경음악 탭', !$('bgmPane').hidden && $('designPane').hidden && !$('bgmNone').hidden);
      await shot('1_bgm_empty');
      $('btnBgmPick').click(); await sleep(300);
      check('음악 고르기 창', !$('bgmLib').hidden && document.querySelectorAll('#bgmList .bgm-item').length === SS.bgmCatalog.tracks.length);
      document.querySelector('#bgmMoods [data-mood="찬송가 연주"]').click(); await sleep(150);
      const hymnRows = document.querySelectorAll('#bgmList .bgm-item').length;
      check('분위기 거르기', hymnRows === SS.bgmCatalog.tracks.filter((t) => t.mood === '찬송가 연주').length, hymnRows);
      // 스트리밍 듣기 (CC BY 피아노 = incompetech) → 일시정지
      document.querySelector('#bgmMoods [data-mood="잔잔한 피아노"]').click(); await sleep(150);
      const playBtn = document.querySelector('#bgmList [data-play]');
      playBtn.click();
      const lib = SS.bgmUi.lib; let tw = Date.now();
      while (!(lib.currentTime > 0.5)) { if (Date.now() - tw > 20000) throw new Error('스트리밍 재생 안 됨 ' + (lib.error && lib.error.code)); await sleep(200); }
      check('목록에서 스트리밍 재생', !lib.paused && lib.currentTime > 0.5, lib.currentTime);
      check('재생 단추가 일시정지로', document.querySelector('#bgmList [data-play]').classList.contains('i-pause'));
      await shot('2_bgm_library');
      document.querySelector('#bgmList [data-play]').click(); await sleep(200);
      check('일시정지', lib.paused);
      // 퍼블릭 도메인 찬송가(짧은 ogg) 쓰기
      const pick = 'amazing-grace-usaf-strings';
      SS.useBgm(pick); await sleep(200);
      check('음악 넣기', SS.state.bgm && SS.state.bgm.id === pick && $('bgmLib').hidden && !$('bgmOn').hidden);
      tw = Date.now(); while ($('bgmWaveMsg').hidden === false) { if (Date.now() - tw > 40000) throw new Error('파형 안 옴: ' + $('bgmWaveMsg').textContent); await sleep(300); }
      check('파형(캐시에 받아 그림)', true);
      // 구간·맞추기·페이드
      $('bgmA').value = '0:10'; $('bgmA').dispatchEvent(new Event('change')); await sleep(80);
      $('bgmB').value = '0:50'; $('bgmB').dispatchEvent(new Event('change')); await sleep(80);
      document.querySelector('#bgmAlign [data-align="end"]').click(); await sleep(80);
      $('bgmFi').value = '1.5'; $('bgmFi').dispatchEvent(new Event('change'));
      $('bgmFo').value = '3'; $('bgmFo').dispatchEvent(new Event('change'));
      $('bgmVol').value = '30'; $('bgmVol').dispatchEvent(new Event('input')); $('bgmVol').dispatchEvent(new Event('change')); await sleep(100);
      const b = SS.state.bgm;
      check('구간 0:10~0:50, 끝에 맞춤, 페이드, 크기', b.trackStart === 10 && b.trackEnd === 50 && b.align === 'end' && b.fadeIn === 1.5 && b.fadeOut === 3 && Math.abs(b.volume - 0.3) < 1e-9, b);
      const p = SS.bgm.plan(b, outDur);
      report.plan = p; report.outDur = outDur;
      check('영상보다 짧은 구간은 끝에 맞춰 늦게 시작', Math.abs(p.length - 40) < 1e-6 && Math.abs(p.delay - (outDur - 40)) < 1e-6, p);
      await shot('3_bgm_set');
      // 되돌리기
      SS.undo(); await sleep(80);
      check('되돌리기 (크기)', Math.abs(SS.state.bgm.volume - 0.2) < 1e-9, SS.state.bgm.volume);
      SS.redo(); await sleep(80);
      // 미리보기와 함께 재생: 음악이 시작하는 곳 조금 뒤로 가서 재생
      const mix = SS.bgmUi.mix;
      const startSrc = SS.edl.outToSrc(SS.getSegments(), p.delay + 5).t;
      await SS.preview.seek(startSrc);
      SS.preview.play();
      tw = Date.now(); while (!(mix.currentTime > 0 && !mix.paused)) { if (Date.now() - tw > 20000) throw new Error('미리보기 음악 안 나옴 ' + (mix.error && mix.error.code)); await sleep(150); }
      await sleep(1500);
      const info = SS.playback.timeInfo(), expect = SS.bgm.trackTimeAt(p, info.cur);
      report.sync = { mix: mix.currentTime, expect, vol: mix.volume };
      check('영상과 함께 음악 재생 (위치 맞음)', Math.abs(mix.currentTime - expect) < 0.45, report.sync);
      check('음악 크기 = 설정 크기', Math.abs(mix.volume - 0.3) < 0.02, mix.volume);
      SS.preview.pause(); await sleep(250);
      check('영상 멈추면 음악도 멈춤', mix.paused);
      // 음악 시작 전(늦게 시작)에서는 조용
      await SS.preview.seek(SS.edl.outToSrc(SS.getSegments(), 1).t); SS.preview.play(); await sleep(900);
      check('음악 시작 전에는 음악 없음', mix.paused || mix.volume === 0, { paused: mix.paused, vol: mix.volume });
      SS.preview.pause(); await sleep(200);
      // 내보내기: 음악 넣은 것 · 뺀 것
      const r1 = await SS.doExport(dir + '/bgm.mp4');
      check('음악 넣어 내보내기', r1.success, r1.error);
      const keep = SS.state.bgm; SS.state.bgm = null;
      const r2 = await SS.doExport(dir + '/nobgm.mp4');
      SS.state.bgm = keep;
      check('음악 없이 내보내기', r2.success, r2.error);
      check('유튜브 설명용 출처 (PD 곡)', /Amazing Grace/.test(SS.bgmCredit()), SS.bgmCredit());

      // ---------- 교인 자료 스튜디오 ----------
      SS.state.meta = { title: '하나님 중심의 기도 / 아멘', verse: '마태복음 6:9-13', speaker: '김택근 사관' };
      await SS.openMaterials();
      await sleep(400);
      check('스튜디오 열림', !$('mnStudio').hidden && document.querySelectorAll('#mnTiles .mn-tile').length === 6);
      check('기본 선택 5종', document.querySelectorAll('#mnTiles .mn-tile.on').length === 5);
      check('이 영상의 설교 원고', $('mnSermon').value.length > 500 && /자막/.test($('mnSrcInfo').textContent), $('mnSrcInfo').textContent);
      check('제목·본문 채움', $('mnTitle').value === '하나님 중심의 기도 아멘' && $('mnVerse').value === '마태복음 6:9-13', $('mnTitle').value);
      document.querySelector('#mnTiles [data-type="family"]').click(); await sleep(80);
      check('타일 고르기 (6)', /\(6\)/.test($('mnGo').textContent), $('mnGo').textContent);
      await shot('4_studio_make');
      $('mnOptBtn').click(); await sleep(200);
      document.querySelector('#mnOptBody [data-k="qtDays"][data-v="7"]').click();
      document.querySelector('#mnOptBody [data-k="audience"][data-v="청년"]').click(); await sleep(80);
      await shot('5_studio_options');
      document.querySelector('[data-close-opt]').click(); await sleep(100);
      check('상세 설정 반영', SS.state.materials.options.qtDays === 7 && /청년 · 7일/.test(document.querySelector('#mnTiles [data-type="qt"] small').textContent));
      // 정해 둔 자료로 결과 화면
      const st = SS._materialsTest.store();
      for (const [k, v] of Object.entries(SAMPLE)) st.results[k] = { data: SS.materials.normalize(k, v), options: st.options, meta: { church: '구세군 대구사랑영문', title: '하나님 중심의 기도', verse: '마태복음 6:9-13', speaker: '김택근 사관', date: '2026년 10월 25일' }, made: new Date().toISOString(), provider: 'test' };
      SS._materialsTest.show('results'); await sleep(300);
      const tabs = document.querySelectorAll('#mnTabs .mn-tab');
      check('만든 자료 탭 6개', tabs.length === 6, tabs.length);
      for (const t of ['summary', 'smallgroup', 'qt', 'quiz', 'family']) {
        document.querySelector(`#mnTabs [data-tab="${t}"]`).click(); await sleep(250);
        check(t + ' 문서', !!document.querySelector('#mnStage .doc.doc-' + t));
        await shot('6_doc_' + t);
      }
      // 글 고치기 → 데이터 반영
      document.querySelector('#mnTabs [data-tab="summary"]').click(); await sleep(200);
      const edEl = document.querySelector('#mnStage [data-path="points.1.heading"]');
      edEl.focus(); edEl.innerText = '믿음과 결단의 고백'; edEl.dispatchEvent(new Event('input', { bubbles: true }));
      check('글 고치기 반영', st.results.summary.data.points[1].heading === '믿음과 결단의 고백');
      // PDF (A4)
      const body = SS.materialsDoc.cleanForExport(document.querySelector('#mnStage .doc'));
      check('내보낼 HTML 에 편집 표시 없음', !/contenteditable|mn-ed/.test(body));
      await window.api.materialsRenderTest({ kind: 'pdf', body, css: SS.materialsDoc.DOC_CSS, file: dir + '/summary.pdf' });
      // 카드: 디자인 4종 + PNG
      document.querySelector('#mnTabs [data-tab="cards"]').click(); await sleep(250);
      check('카드 3장', document.querySelectorAll('#mnStage .mcard').length === 3);
      await shot('7_cards_navy');
      for (const d of ['paper', 'sky', 'scene']) { document.querySelector(`#mnBar [data-design="${d}"]`).click(); await sleep(300); await shot('7_cards_' + d); }
      check('영상 장면 배경', /background-image/.test(document.querySelector('#mnStage .mcard').getAttribute('style') || ''));
      document.querySelector('#mnBar [data-design="navy"]').click(); await sleep(250);
      const cardBody = SS.materialsDoc.cleanForExport(document.querySelector('#mnStage .mcard'));
      await window.api.materialsRenderTest({ kind: 'png', body: cardBody, css: SS.materialsDoc.DOC_CSS, width: 1080, height: 1350, file: dir + '/card1.png' });
      document.querySelector('#mnBar [data-design="scene"]').click(); await sleep(250);
      await window.api.materialsRenderTest({ kind: 'png', body: SS.materialsDoc.cleanForExport(document.querySelector('#mnStage .mcard')), css: SS.materialsDoc.DOC_CSS, width: 1080, height: 1350, file: dir + '/card_scene.png' });
      // 카톡용 글
      report.kakao = SS.materials.toText('smallgroup', st.results.smallgroup.data, { church: '구세군 대구사랑영문' });
      // 프로젝트 저장·불러오기에 자료와 음악이 남는지
      const snap = SS.project.snapshot(SS.state, 0);
      check('프로젝트에 교인 자료 저장', snap.materials && snap.materials.results.summary.data.points[1].heading === '믿음과 결단의 고백');
      check('프로젝트에 배경음악 저장', snap.bgm && snap.bgm.id === pick && snap.bgm.align === 'end');
      SS.closeMaterials(); await sleep(100);
      check('스튜디오 닫기', $('mnStudio').hidden && !SS.state.dialogOpen);
      document.getElementById('tabDesign').click();
      report.success = true;
    } catch (err) {
      report.success = false; report.error = err.stack || String(err);
    }
    try { SS.preview.pause(); SS.bgmUi.lib.pause(); } catch (_) {}
    report.finishedAt = new Date().toISOString();
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error);
  });
  // 만나로식 화면 (SS_TEST_SCRIPT=rail): 왼쪽 막대 단추가 맞는 화면을 열고 선택 표시가 따라가는지, 밝은 색인지
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'rail') return;
    const report = { startedAt: new Date().toISOString(), checks: [] };
    const check = (name, ok, info) => report.checks.push({ name, ok: !!ok, info: info === undefined ? null : info });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const vis = (el) => { if (!el || el.hidden || !el.isConnected) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const onOf = () => Array.from(document.querySelectorAll('#rail .rail-item.on')).map((b) => b.textContent.trim());
    const rb = (k) => document.querySelector('#rail [data-rail="' + k + '"]');
    const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    let dir = '';
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/rail'; await window.api.mkdir(dir);
      const rail = $('rail').getBoundingClientRect();
      check('왼쪽 막대 84px·전체 높이', Math.round(rail.width) === 84 && Math.round(rail.height) === window.innerHeight, [rail.width, rail.height]);
      check('처음엔 쇼츠 편집 선택', onOf().join() === '쇼츠 편집', onOf());
      const bg = getComputedStyle(document.body).backgroundColor;
      check('밝은 바탕', /241, 243, 247/.test(bg), bg);
      check('가로 넘침 없음', document.documentElement.scrollWidth <= window.innerWidth, [document.documentElement.scrollWidth, window.innerWidth]);
      const tb = $('topbar').getBoundingClientRect();
      check('윗막대가 막대 오른쪽', Math.round(tb.left) === 84, tb.left);
      $('btnMaterials').click(); await sleep(300);
      check('교인 자료 열림', vis($('mnStudio')));
      check('교인 자료 선택 표시', onOf().join() === '교인 자료', onOf());
      await SS.testShot('cache/rail/materials.png');
      rb('editor').click(); await sleep(250);
      check('쇼츠 편집으로 돌아옴', $('mnStudio').hidden && !$('designPane').hidden, null);
      check('쇼츠 편집 선택 표시', onOf().join() === '쇼츠 편집', onOf());
      rb('music').click(); await sleep(300);
      check('배경음악 탭 열림', !$('bgmPane').hidden && $('tabMusic').classList.contains('on'));
      check('배경음악 선택 표시', onOf().join() === '배경음악', onOf());
      $('tabDesign').click(); await sleep(150);
      check('디자인 탭 누르면 쇼츠 편집 표시', onOf().join() === '쇼츠 편집', onOf());
      rb('music').click(); await sleep(150);
      $('btnMaterials').click(); await sleep(250); rb('editor').click(); await sleep(200);
      check('자료→편집 시 디자인 탭', !$('designPane').hidden && onOf().join() === '쇼츠 편집', onOf());
      rb('theme').click(); await sleep(500);
      check('테마 편집기 열림', vis($('themeEditor')));
      $('teBtnClose').click(); await sleep(300);
      check('테마 편집기 닫힘', !vis($('themeEditor')));
      rb('ai').click(); await sleep(400);
      const conn = document.querySelector('.ai-conn');
      check('AI 연결 창 열림', vis(conn));
      await SS.testShot('cache/rail/ai.png');
      if (conn) { esc(); await sleep(200); if (vis(conn)) { const x = conn.querySelector('.ss-btn-cancel, [data-close], .close, button[aria-label="닫기"]'); if (x) x.click(); else conn.remove(); await sleep(200); } }
      check('AI 연결 창 닫힘', !vis(document.querySelector('.ai-conn')));
      $('btnSettings').click(); await sleep(400);
      const ov = Array.from(document.querySelectorAll('.modal-overlay')).find(vis);
      check('설정 창 열림', !!ov);
      if (ov) { esc(); await sleep(200); }
      check('설명서 단추 연결', !!$('btnUserGuide') && typeof $('btnUserGuide').onclick === 'function');
      const icons = Array.from(document.querySelectorAll('#rail .rail-item')).map((b) => getComputedStyle(b, '::before').maskImage || getComputedStyle(b, '::before').webkitMaskImage || getComputedStyle(b, '::before').backgroundImage);
      check('레일 아이콘 모두 있음', icons.every((v) => v && v !== 'none'), icons.map((v) => (v || '').slice(0, 40)));
      await SS.testShot('cache/rail/editor.png');
      report.success = report.checks.every((c) => c.ok);
      if (!report.success) report.error = '실패: ' + report.checks.filter((c) => !c.ok).map((c) => c.name).join(', ');
    } catch (err) { report.success = false; report.error = err.stack || String(err); }
    report.finishedAt = new Date().toISOString();
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error);
  });
})();

