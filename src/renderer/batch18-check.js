/* 교인 자료 새 종류 시험: 카드뉴스 · 소그룹 리더 가이드 · 설교 PPT · 홈페이지 글 저장
 *  SS_TEST_SCRIPT=batch18      — 정해 둔 자료로 그리기·고치기·PNG·PPTX·홈페이지 글 (AI 안 씀)
 *  SS_TEST_SCRIPT=materials-ai2 — 실제 AI(클로드)로 세 가지를 만들고 그려서 저장
 * 결과: cache/batch18/, cache/materials_ai2/ */
(function () {
  'use strict';
  const SS = window.SS;
  const META = { church: '구세군 대구사랑교회', title: '나라와 권세와 영광이 아버지께', verse: '마태복음 6:9-13', speaker: '차재수 사관', date: '2026년 10월 25일' };
  const SAMPLE = {
    summary: { title: '나라와 권세와 영광', verse: '마태복음 6:9-13', theme: '기도의 시작도 끝도 하나님이십니다.', points: [{ heading: '나라가 아버지께', body: '내 안의 나라는 하나님의 것입니다.' }, { heading: '권세가 아버지께', body: '권능은 하나님께 있습니다.' }], application: '나 중심의 기도에서 하나님 중심의 기도로.', prayer: '아버지, 영광을 받으소서.' },
    cardnews: { title: '기도의 끝도 하나님', subtitle: '주기도문 마지막 고백', verse: '마태복음 6:13', slides: [{ heading: '시작도 끝도 하나님', body: '주기도문은 하늘에 계신 아버지로 시작해 아버지께 영원히 있사옵나이다로 끝납니다.', highlight: '아버지께 영원히' }, { heading: '나라가 아버지께', body: '내 안의 나라는 내 것이 아니라 하나님의 것입니다.', highlight: '하나님의 것' }, { heading: '권세가 아버지께', body: '기적보다 하나님의 능력을 신뢰하는 믿음이 더 귀합니다.', highlight: '신뢰하는 믿음' }, { heading: '아멘의 뜻', body: '아멘은 그렇게 살겠다는 결단입니다.', highlight: '그렇게 살겠다는 결단' }], action: '하루 한 번 주기도문을 천천히 드리기', closing: '나의 기도가 하나님 중심이 되게 하소서' },
    leader: { title: '하나님 중심의 기도', verse: '마태복음 6:9-13', goal: '내 기도의 중심이 누구인지 돌아보고 하나님 중심의 기도로 나아갑니다.', prepare: '설교를 다시 듣고 마태복음 6:9-13 을 세 번 읽기', flow: [{ part: '마음 열기', minutes: 10, guide: '한 주 동안 가장 많이 한 기도 제목을 나눕니다.' }, { part: '말씀 되새기기', minutes: 15, guide: '설교의 세 대지를 함께 정리합니다.' }, { part: '나눔', minutes: 25, guide: '질문 3~4개로 나눕니다.' }, { part: '적용·기도', minutes: 10, guide: '이번 주 실천을 정하고 함께 기도합니다.' }], questions: [{ q: '내 기도의 주제는 주로 무엇이었나요?', intent: '나 중심 기도를 스스로 발견하게', expected: '건강·가족·일 — 설교의 "나 중심 신앙" 부분과 연결', followup: '그 기도에 하나님 나라는 어디에 있었나요?' }, { q: '아멘을 결단으로 고백한 적이 있나요?', intent: '아멘의 뜻을 삶과 잇기', expected: '설교 4대지 "그렇게 살겠습니다"', followup: '' }], tips: ['말이 없는 분께는 짧은 질문부터 먼저 묻습니다.', '정답을 고쳐 주기보다 설교의 문장으로 돌아갑니다.'], prayer: '아버지, 우리의 기도가 하나님 나라를 구하게 하소서.' },
    slides: { title: '나라와 권세와 영광', verse: '마태복음 6:9-13', slides: [{ heading: '기도의 시작도 끝도 하나님', lines: ['하늘에 계신 우리 아버지로 시작', '아버지께 영원히 있사옵나이다로 끝'], ref: '마태복음 6:9' }, { heading: '나라가 아버지께 있습니다', lines: ['내 안의 나라는 하나님의 것', '복음은 삶으로 더 크게 전해진다'], ref: '고린도전서 15:31' }, { heading: '아멘, 그렇게 살겠습니다', lines: ['아멘은 믿음과 결단의 고백'], ref: '' }], closing: '나 중심의 기도에서 하나님 중심의 기도로' },
  };

  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'batch18') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const report = { checks: [], files: {} };
    const check = (name, ok, info) => { report.checks.push({ name, ok: !!ok, info: info === undefined ? null : info }); if (!ok) throw new Error(name + ': ' + JSON.stringify(info)); };
    let dir = '';
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/batch18'; await window.api.mkdir(dir);
      const shot = (n) => SS.testShot(dir + '/' + n + '.png');
      SS.openMaterials('make'); await sleep(400);
      const tiles = Array.from(document.querySelectorAll('#mnTiles .mn-tile')).map((b) => b.dataset.type);
      check('새 타일 3개', ['cardnews', 'leader', 'slides'].every((t) => tiles.includes(t)), tiles);
      await shot('0_tiles');
      const st = SS._materialsTest.store();
      for (const [k, v] of Object.entries(SAMPLE)) st.results[k] = { data: SS.materials.normalize(k, v), options: st.options, meta: META, made: Date.now() };
      SS._materialsTest.show('results'); await sleep(300);
      // 카드뉴스
      document.querySelector('#mnTabs [data-tab="cardnews"]').click(); await sleep(300);
      const cards = document.querySelectorAll('#mnStage .mcard.news');
      check('카드뉴스 6장 (표지+4+실천)', cards.length === 6, cards.length);
      check('강조 구절 형광펜', document.querySelectorAll('#mnStage .mcard.news mark').length === 4);
      check('쪽 번호', /1 \/ 6/.test(cards[0].textContent) && /6 \/ 6/.test(cards[5].textContent));
      await shot('1_cardnews_navy');
      for (const d of ['paper', 'sky']) { document.querySelector(`#mnBar [data-design="${d}"]`).click(); await sleep(250); await shot('1_cardnews_' + d); }
      const edH = document.querySelector('#mnStage [data-path="slides.1.heading"]');
      edH.focus(); edH.innerText = '나라는 하나님의 것'; edH.dispatchEvent(new Event('input', { bubbles: true }));
      check('카드뉴스 글 고치기 반영', st.results.cardnews.data.slides[1].heading === '나라는 하나님의 것');
      for (const [i, el] of Array.from(document.querySelectorAll('#mnStage .mcard.news')).entries()) {
        if (i > 1) break;
        await window.api.materialsRenderTest({ kind: 'png', body: SS.materialsDoc.cleanForExport(el), css: SS.materialsDoc.DOC_CSS, width: 1080, height: 1350, file: dir + '/news' + (i + 1) + '.png' });
      }
      // 리더 가이드
      document.querySelector('#mnTabs [data-tab="leader"]').click(); await sleep(300);
      check('리더 가이드 문서', !!document.querySelector('#mnStage .doc.doc-leader') && document.querySelectorAll('#mnStage .lq').length === 2);
      check('진행 순서 60분 합계', /60분/.test(document.querySelector('#mnStage .doc-leader').textContent));
      await shot('2_leader');
      await window.api.materialsRenderTest({ kind: 'pdf', body: SS.materialsDoc.cleanForExport(document.querySelector('#mnStage .doc')), css: SS.materialsDoc.DOC_CSS, file: dir + '/leader.pdf' });
      // 설교 PPT
      document.querySelector('#mnTabs [data-tab="slides"]').click(); await sleep(300);
      const sl = document.querySelectorAll('#mnStage .mslide');
      check('슬라이드 5장 (제목+3+마무리)', sl.length === 5, sl.length);
      check('PPT 저장 단추', !!document.querySelector('#mnBar [data-act="pptx"]'));
      await shot('3_slides_navy');
      await window.api.materialsRenderTest({ kind: 'png', body: SS.materialsDoc.cleanForExport(sl[1]), css: SS.materialsDoc.DOC_CSS, width: 1920, height: 1080, file: dir + '/slide2.png' });
      for (const d of ['paper', 'sky']) {
        const p = await window.api.materialsPptx({ data: st.results.slides.data, meta: META, design: d, name: 'x', file: dir + '/sermon_' + d + '.pptx' });
        check('PPTX 저장 ' + d, p && /\.pptx$/.test(p), p);
      }
      const pNavy = await window.api.materialsPptx({ data: st.results.slides.data, meta: META, design: 'navy', name: 'x', file: dir + '/sermon_navy.pptx' });
      report.files.pptx = pNavy;
      // 홈페이지 글
      document.querySelector('#mnTabs [data-tab="summary"]').click(); await sleep(250);
      check('요약에 홈페이지 글 단추', !!document.querySelector('#mnBar [data-act="homepage"]'));
      const out = SS.materials.toHomepage(st.results.summary.data, { ...META, service: 'sunday' });
      check('홈페이지 글 이름', out.name === '2026-10-25-sunday.md', out.name);
      check('앞머리 형식', /^---\ntitle: "나라와 권세와 영광이 아버지께"\ndate: 2026-10-25\nservice: sunday\npassage: "마태복음 6:9-13"\npreacher: "차재수 사관"\nsummary: "기도의 시작도 끝도 하나님이십니다."\npublished: false\n---/.test(out.text), out.text.slice(0, 240));
      check('묵상 질문·기도 없음', !/묵상|질문|기도문|함께 드리는 기도/.test(out.text.split('---')[2]), out.text);
      report.files.md = await window.api.materialsSaveText({ text: out.text, name: out.name, ext: 'md', file: dir + '/' + out.name });
      await shot('4_summary_bar');
      // 홈페이지 묶음 (공개 쇼츠만·나눔지 PDF·카드 문장)
      st.results.smallgroup = { data: SS.materials.normalize('smallgroup', { title: '아멘', verse: '마태복음 6:9-13', summary: '요약', icebreaker: '마음 열기', questions: [{ q: '질문 하나', note: '' }], action: '실천', prayer: '기도' }), options: st.options, meta: META, made: Date.now() };
      SS.state.uploads = [{ url: 'https://youtu.be/AAAAAAAAAAA', privacy: 'public' }, { url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB', privacy: 'unlisted' }, { url: 'https://youtu.be/AAAAAAAAAAA', privacy: 'public' }];
      const b = SS._materialsTest.bundleOf(META);
      check('묶음: 날짜·주일', b.date === '2026-10-25' && b.json.service === 'sunday', b.json);
      check('묶음: 공개 쇼츠만·중복 없이', JSON.stringify(b.json.shorts) === JSON.stringify(['https://www.youtube.com/shorts/AAAAAAAAAAA']), b.json.shorts);
      check('묶음: 카드 문장 두 줄', b.json.cardLine === '기도의 시작도 끝도\n하나님이십니다.', b.json.cardLine);
      check('묶음: 나눔지 HTML', b.handout && /질문 하나/.test(b.handout.body) && !/contenteditable/.test(b.handout.body));
      const res = await window.api.materialsBundle({ ...b, base: dir + '/bundle' });
      check('묶음 폴더·파일', res && /2026-10-25[\\/]bundle\.json$/.test(res.file) && res.bundle.handout === '나눔지.pdf', res);
      report.bundle = res.bundle;
      const again = await window.api.materialsBundle({ date: b.date, json: { ...b.json, shorts: ['https://www.youtube.com/shorts/CCCCCCCCCCC'] }, base: dir + '/bundle' });
      check('다시 보내면 쇼츠 주소 합치고 나눔지 유지', again.bundle.shorts.length === 2 && again.bundle.handout === '나눔지.pdf' && again.bundle.cardLine === b.json.cardLine, again.bundle);
      check('홈페이지 묶음 단추', !!document.querySelector('#mnBar [data-act="bundle"]'));
      const snap2 = SS.project.snapshot(SS.state, 0);
      check('업로드 기록 프로젝트 저장', snap2.uploads.length === 3 && snap2.uploads[0].privacy === 'public');
      // 옵션 창
      SS._materialsTest.show('make'); await sleep(200);
      document.querySelector('#mnOptOpen, [data-act="options"], #mnOptBtn') && document.querySelector('#mnOptOpen, [data-act="options"], #mnOptBtn').click();
      await sleep(200);
      const optText = ($('mnOptBody') || {}).textContent || '';
      report.optText = optText.slice(0, 400);
      // 프로젝트에 저장
      const snap = SS.project.snapshot(SS.state, 0);
      check('프로젝트에 새 자료 저장', snap.materials && snap.materials.results.cardnews && snap.materials.results.slides && snap.materials.results.leader);
      SS.closeMaterials();
      report.success = true;
    } catch (err) { report.success = false; report.error = err.stack || String(err); }
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error);
  });

  // 실제 AI 로 새 세 종류 만들기
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'materials-ai2') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const report = { startedAt: new Date().toISOString(), runs: [] };
    let dir = '';
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/materials_ai2'; await window.api.mkdir(dir);
      const raw = await window.api.readJson(launch.cache + '/yt/uSE5pZB3gtQ/uSE5pZB3gtQ.ko.json3');
      const words = SS.chatPlan.wordsFromJson3(raw).words.filter((w) => w.start >= 3300 && w.end <= 5200);
      const sermon = SS.materials.sermonText(words);
      report.sermonChars = sermon.length;
      await window.api.llmSetActive('claude');
      const ctx = { church: META.church, title: '하나님 중심의 기도', verse: '마태복음 6:9-13', speaker: META.speaker, date: META.date, sermon };
      const types = (launch.testUrl || 'cardnews,leader,slides').split(',');
      await Promise.all(types.map(async (type) => {
        const t0 = Date.now();
        try { const r = await window.api.materialsGenerate(type, { audience: '장년' }, ctx); report.runs.push({ type, ok: true, ms: Date.now() - t0, data: r.data }); }
        catch (err) { report.runs.push({ type, ok: false, ms: Date.now() - t0, error: String(err.message || err) }); }
      }));
      SS.openMaterials('make'); await sleep(300);
      const st = SS._materialsTest.store();
      report.runs.filter((r) => r.ok).forEach((r) => { st.results[r.type] = { data: r.data, options: st.options, meta: { ...META, title: '하나님 중심의 기도' }, made: Date.now() }; });
      SS._materialsTest.show('results'); await sleep(300);
      for (const r of report.runs.filter((x) => x.ok)) {
        document.querySelector(`#mnTabs [data-tab="${r.type}"]`).click(); await sleep(400);
        await SS.testShot(dir + '/' + r.type + '.png');
        if (r.type === 'slides') await window.api.materialsPptx({ data: r.data, meta: { ...META, title: '하나님 중심의 기도' }, design: 'navy', name: 'x', file: dir + '/sermon.pptx' });
        if (r.type === 'cardnews') { const els = document.querySelectorAll('#mnStage .mcard'); for (let i = 0; i < els.length; i++) await window.api.materialsRenderTest({ kind: 'png', body: SS.materialsDoc.cleanForExport(els[i]), css: SS.materialsDoc.DOC_CSS, width: 1080, height: 1350, file: dir + '/news' + (i + 1) + '.png' }); }
        if (r.type === 'leader') await window.api.materialsRenderTest({ kind: 'pdf', body: SS.materialsDoc.cleanForExport(document.querySelector('#mnStage .doc')), css: SS.materialsDoc.DOC_CSS, file: dir + '/leader.pdf' });
      }
      SS.closeMaterials();
      report.success = report.runs.every((r) => r.ok);
    } catch (err) { report.success = false; report.error = err.stack || String(err); }
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error || 'AI 생성 실패');
  });
})();
