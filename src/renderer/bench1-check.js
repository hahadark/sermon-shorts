/* SS_TEST_SCRIPT=bench1 : 설교와 대조(충실도 검사) 표시·노란 표시·인스타 캡션/해시태그 (AI 없이)
 * SS_TEST_SCRIPT=bench1-ai : 실제 AI(클로드)로 카드뉴스 만들기(캡션·해시태그) + 일부러 지어낸 문장을 넣은 요약을 대조해 잡아내는지 */
(function () {
  'use strict';
  const SS = window.SS;
  const META = { church: '구세군 대구사랑교회', title: '하나님 중심의 기도', verse: '마태복음 6:9-13', speaker: '차재수 사관', date: '2026년 10월 25일' };
  const NEWS = { title: '기도의 끝도 하나님', subtitle: '주기도문 마지막 고백', verse: '마태복음 6:13', slides: [{ heading: '시작도 끝도 하나님', body: '주기도문은 아버지로 시작해 아버지께 영원히 있사옵나이다로 끝납니다.', highlight: '아버지께 영원히' }, { heading: '나라가 아버지께', body: '내 안의 나라는 하나님의 것입니다.', highlight: '하나님의 것' }], action: '하루 한 번 주기도문을 천천히', closing: '하나님 중심의 기도로', caption: '이번 주일 말씀은 주기도문의 마지막 고백입니다.', hashtags: ['#주일설교', '#주기도문', '#마태복음6장'] };
  const SUM = { title: '나라와 권세와 영광', verse: '마태복음 6:9-13', theme: '기도의 시작도 끝도 하나님이십니다.', points: [{ heading: '나라가 아버지께', body: '내 안의 나라는 하나님의 것입니다.' }, { heading: '권세가 아버지께', body: '권능은 하나님께 있습니다.' }], application: '나 중심의 기도에서 하나님 중심의 기도로.', prayer: '아버지, 영광을 받으소서.' };

  async function run(e) {
    const mode = e.detail;
    if (mode !== 'bench1' && mode !== 'bench1-ai') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const report = { mode, checks: [] };
    const check = (name, ok, info) => { report.checks.push({ name, ok: !!ok, info: info === undefined ? null : info }); if (!ok) throw new Error(name + ': ' + JSON.stringify(info)); };
    let dir = '';
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/' + mode.replace('-', '_'); await window.api.mkdir(dir);
      await window.api.saveSettings({ sysCheckSeen: true });
      const shot = (n) => SS.testShot(dir + '/' + n + '.png');
      await SS.openMaterials('make'); await sleep(400);
      const st = SS._materialsTest.store();

      if (mode === 'bench1') {
        check('설교와 대조 선택(기본 켬)', $('mnVerify') && $('mnVerify').checked);
        $('mnVerify').click(); check('끄면 저장', st.verify === false); $('mnVerify').click(); check('다시 켬', st.verify === true);
        st.results.cardnews = { data: SS.materials.normalize('cardnews', NEWS), options: st.options, meta: META, made: Date.now(), check: { ok: true, issues: [] } };
        const sum = SS.materials.normalize('summary', { ...SUM, points: SUM.points.concat([{ heading: '통계가 말합니다', body: '한국 성도의 87%가 기도를 어려워한다는 조사가 있습니다.' }]) });
        st.results.summary = { data: sum, options: st.options, meta: META, made: Date.now(), check: SS.materials.parseCheck(JSON.stringify({ issues: [{ quote: '한국 성도의 87%가 기도를 어려워한다', problem: '설교에 없는 통계입니다', fix: '이 문장을 빼거나 설교의 예로 바꾸세요' }, { quote: '자료에 없는 문장', problem: '찾을 수 없는 인용' }] }), sum, 'summary') };
        SS._materialsTest.show('make'); SS._materialsTest.tiles(); await sleep(200);
        const tile = document.querySelector('#mnTiles [data-type="summary"] .mn-state');
        check('타일에 확인할 곳 표시', tile && /확인할 곳 2/.test(tile.textContent), tile && tile.textContent);
        SS._materialsTest.show('results'); await sleep(300);
        // 카드뉴스: 캡션
        document.querySelector('#mnTabs [data-tab="cardnews"]').click(); await sleep(300);
        check('대조 통과 표시', $('mnCheck').classList.contains('ok') && /설교와 대조했습니다/.test($('mnCheck').textContent));
        const cap = document.querySelector('#mnStage .mn-caption');
        check('캡션 칸', cap && /주기도문의 마지막 고백/.test(cap.textContent) && /#주일설교 #주기도문 #마태복음6장/.test(cap.textContent));
        const tg = cap.querySelector('[data-tags]');
        tg.focus(); tg.innerText = '#주일설교 말씀 묵상 #주일설교'; tg.dispatchEvent(new Event('input', { bubbles: true }));
        check('해시태그 고치기 반영(# 붙이고 겹침 빼기)', JSON.stringify(st.results.cardnews.data.hashtags) === JSON.stringify(['#주일설교', '#말씀', '#묵상']), st.results.cardnews.data.hashtags);
        const ct = cap.querySelector('[data-path="caption"]');
        ct.focus(); ct.innerText = '고친 캡션'; ct.dispatchEvent(new Event('input', { bubbles: true }));
        check('캡션 고치기 반영', st.results.cardnews.data.caption === '고친 캡션');
        check('글 복사에 캡션 포함', /\[인스타 캡션\]\n고친 캡션\n#주일설교 #말씀 #묵상/.test(SS.materials.toText('cardnews', st.results.cardnews.data)));
        check('캡션 복사 단추 연결', !!cap.querySelector('[data-act="caption"]'));
        await shot('1_cardnews_caption');
        // 요약: 확인할 곳
        document.querySelector('#mnTabs [data-tab="summary"]').click(); await sleep(300);
        const box = $('mnCheck');
        check('확인할 곳 2 목록', box.classList.contains('warn') && box.querySelectorAll('li').length === 2, box.textContent);
        check('찾은 문장만 눌러 이동', box.querySelectorAll('li.found').length === 1);
        check('노란 표시 (CSS Highlight)', CSS.highlights && CSS.highlights.has('mn-flag') && CSS.highlights.get('mn-flag').size === 1);
        box.querySelector('li.found').click(); await sleep(400);
        check('누르면 그 문장 선택', /87%/.test(String(getSelection())), String(getSelection()));
        const pdfBody = SS.materialsDoc.cleanForExport($('mnStage').querySelector('.doc'));
        check('PDF 로 내보낼 글엔 표시가 없음', !/mn-flag|<mark/.test(pdfBody));
        await shot('2_summary_flags');
        // 탭을 바꾸면 표시가 사라짐
        document.querySelector('#mnTabs [data-tab="cardnews"]').click(); await sleep(200);
        check('다른 자료로 가면 노란 표시 지움', !CSS.highlights.has('mn-flag'));
      }

      if (mode === 'bench1-ai') {
        const raw = await window.api.readJson(launch.cache + '/yt/uSE5pZB3gtQ/uSE5pZB3gtQ.ko.json3');
        const words = SS.chatPlan.wordsFromJson3(raw).words.filter((w) => w.start >= 3300 && w.end <= 5200);
        const sermon = SS.materials.sermonText(words);
        await window.api.llmSetActive('claude');
        const ctx = { ...META, sermon };
        const t0 = Date.now();
        const fake = SS.materials.normalize('summary', { ...SUM, points: SUM.points.concat([{ heading: '통계가 말합니다', body: '갤럽 조사에 따르면 한국 성도의 87%가 매일 기도하지 못한다고 답했습니다. 마르틴 루터는 바쁠수록 세 시간을 기도했습니다.' }]) });
        const [gen, ck] = await Promise.all([
          window.api.materialsGenerate('cardnews', { audience: '장년' }, ctx),
          window.api.materialsCheck('summary', fake, { audience: '장년' }, ctx),
        ]);
        report.ms = Date.now() - t0;
        report.cardnews = { caption: gen.data.caption, hashtags: gen.data.hashtags };
        report.check = ck;
        check('카드뉴스 캡션 만들어짐', gen.data.caption.length > 20, gen.data.caption);
        check('해시태그 5개 이상', gen.data.hashtags.length >= 5 && gen.data.hashtags.every((h) => /^#\S+$/.test(h)), gen.data.hashtags);
        check('지어낸 통계·인용을 잡아냄', !ck.ok && ck.issues.some((it) => /87%|갤럽|루터/.test(it.quote + it.problem)), ck.issues);
        const ck2 = await window.api.materialsCheck('cardnews', gen.data, { audience: '장년' }, ctx);
        report.check2 = ck2;
        check('AI 가 만든 카드뉴스 대조 결과 읽힘', Array.isArray(ck2.issues), ck2);
        st.results.cardnews = { data: gen.data, options: st.options, meta: META, made: Date.now(), check: ck2 };
        st.results.summary = { data: fake, options: st.options, meta: META, made: Date.now(), check: ck };
        SS._materialsTest.show('results'); await sleep(300);
        document.querySelector('#mnTabs [data-tab="cardnews"]').click(); await sleep(400); await shot('1_ai_cardnews');
        document.querySelector('#mnTabs [data-tab="summary"]').click(); await sleep(400); await shot('2_ai_summary_check');
      }
      SS.closeMaterials();
      report.success = true;
    } catch (err) { report.success = false; report.error = err.stack || String(err); try { await SS.testShot(dir + '/error.png'); } catch (_) { /* */ } }
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error);
  }
  window.addEventListener('ss:run-test-script', run);
})();
