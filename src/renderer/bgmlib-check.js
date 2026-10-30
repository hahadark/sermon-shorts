/* SS_TEST_SCRIPT=bgmlib: 배경음악 관리 (보관함 폴더·유튜브 여러 줄/재생목록 받기·이름/분위기·검색·미리 듣기·쓰기·지우기·옮기기) */
(function () {
  'use strict';
  const SS = window.SS;
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'bgmlib') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const report = { checks: [] };
    const check = (name, ok, info) => { report.checks.push({ name, ok: !!ok, info: info === undefined ? null : info }); if (!ok) throw new Error(name + ': ' + JSON.stringify(info)); };
    const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('시간 초과: ' + what); await sleep(100); } };
    const base = (p) => String(p || '').split(/[\\/]/).pop();
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    let dir = '';
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/bgmlib'; await window.api.mkdir(dir);
      await window.api.saveSettings({ sysCheckSeen: true });
      document.querySelectorAll('.modal-close').forEach((b) => b.click());
      const shot = (n) => SS.testShot(dir + '/' + n + '.png');
      const M = SS.bgmManager;
      window.confirm = () => true;

      // 0) 옮기기 시험(SS_BGM_MIGRATE): 예전 캐시의 곡이 보관함에 제목 이름으로 들어왔는지
      const first = await window.api.bgmLibrary();
      check('보관함 폴더 = 시험 폴더', /bgmlib/.test(first.dir), first.dir);
      const mig = first.tracks.find((t) => t.id === 'custom-f-migtest0001');
      if (launch.migrateTest) check('예전 캐시 곡 옮김', mig && mig.file.startsWith(first.dir) && base(mig.file) === '옮기기 시험 곡.mp3' && !mig.missing, mig);

      // 1) 열기: 음악 칸의 [배경음악 관리] 단추
      if (SS.showBgmTab) SS.showBgmTab();
      if (SS.state.bgm) { SS.state.bgm = null; SS.bgmUi.render(); }
      await sleep(200);
      const openBtn = $('btnBgmMgr');
      check('음악 칸에 배경음악 관리 단추', openBtn && openBtn.getBoundingClientRect().width > 0, !!openBtn);
      openBtn.click();
      await waitFor(() => !$('bgmMgr').hidden, 3000, '관리 창 열기');
      await waitFor(() => document.activeElement === $('bmUrls'), 2000, '열면 주소 칸에 포커스');
      check('대화상자 열림 표시', SS.state.dialogOpen === true);
      await waitFor(() => $('bmDir').textContent.length > 0, 3000, '폴더 표시');
      await shot('1_open_empty');

      // 2) 유튜브 아닌 줄은 거절, 입력 유지
      $('bmUrls').value = 'https://example.com/a.mp3';
      $('bmGet').click(); await sleep(150);
      check('유튜브 아닌 주소는 받지 않음', M.queue.length === 0 && $('bmUrls').value === 'https://example.com/a.mp3', M.queue.length);

      // 3) 내 파일 추가 → 제목 이름으로 보관함에
      const tone = launch.cache + '/batch17_tone.mp3';
      const tf = await window.api.bgmImportFile(tone);
      check('내 파일 → 보관함에 제목 이름', tf.file.startsWith(first.dir) && base(tf.file) === 'batch17_tone.mp3', tf.file);
      const tf2 = await window.api.bgmImportFile(tone);
      check('같은 파일 다시 넣으면 그대로', tf2.id === tf.id && tf2.file === tf.file, tf2.file);
      window.dispatchEvent(new Event('ss:bgm-library-changed'));
      await M.refresh();

      // 4) 유튜브 두 줄(같은 영상 두 번) + 재생목록 → 받기 목록
      const ytUrl = launch.testUrl || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
      $('bmUrls').value = ytUrl + '\n' + ytUrl + '\nhttps://www.youtube.com/playlist?list=UU4QobU6STFB0P71PMvOGN5A';
      const tY = Date.now();
      $('bmGet').click();
      await waitFor(() => M.queue.some((x) => x.state === 'busy'), 15000, '받기 시작');
      await sleep(400); await shot('2_downloading');
      await waitFor(() => M.queue.length >= 3 && M.queue.every((x) => x.state === 'done' || x.state === 'err'), 240000, '받기 끝');
      report.ytSec = (Date.now() - tY) / 1000;
      report.queue = M.queue.map((x) => ({ state: x.state, title: x.title, msg: x.msg }));
      check('세 곡 모두 끝남(오류 없음)', M.queue.every((x) => x.state === 'done'), report.queue);
      check('입력 칸 비움', $('bmUrls').value === '');
      check('겹친 두 곡은 이미 있음 표시', M.queue.filter((x) => x.existed).length === 2 && /이미 있음/.test($('bmQueue').textContent), report.queue);
      await M.refresh();
      const yts = M.lib.tracks.filter((t) => /^custom-yt-/.test(t.id));
      check('같은 영상은 한 곡만', yts.length === 1, yts.map((t) => t.id));
      const yt = yts[0];
      check('유튜브 곡 파일 이름 = 제목', yt.file.startsWith(first.dir) && !/^yt-/.test(base(yt.file)) && base(yt.file).startsWith(yt.title.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 20)), { file: yt.file, title: yt.title });
      check('유튜브 곡 출처 주소', /youtube\.com\/watch\?v=jNQXAC9IVRw/.test(yt.source), yt.source);
      check('목록에 곡 표시', document.querySelectorAll('#bmList .bm-row').length === M.lib.tracks.length && M.lib.tracks.length >= 2, document.querySelectorAll('#bmList .bm-row').length);
      await shot('3_done');

      // 5) 이름 바꾸기 (제목 누르기 → 입력 → Enter) → 파일 이름도
      let row = document.querySelector(`#bmList .bm-row[data-id="${yt.id}"]`);
      row.querySelector('[data-rename]').click();
      const inp = row.querySelector('.bm-title-in');
      check('이름 입력 칸', !!inp && document.activeElement === inp);
      inp.value = '시험 / 동물원: 첫 영상';
      key(inp, 'Enter');
      await waitFor(() => M.lib.tracks.some((t) => t.id === yt.id && t.title === '시험 / 동물원: 첫 영상'), 4000, '이름 바꾸기');
      const ren = M.lib.tracks.find((t) => t.id === yt.id);
      check('파일 이름도 바뀜(금지 글자 뺌)', base(ren.file) === '시험 동물원 첫 영상.' + ren.file.split('.').pop(), ren.file);
      // Esc 는 이름 바꾸기만 취소 (창은 그대로)
      row = document.querySelector(`#bmList .bm-row[data-id="${yt.id}"]`);
      row.querySelector('[data-rename]').click();
      const inp2 = row.querySelector('.bm-title-in'); inp2.value = '취소될 이름';
      key(inp2, 'Escape');
      await sleep(300);
      check('Esc 는 이름 바꾸기만 취소', !$('bgmMgr').hidden && M.lib.tracks.find((t) => t.id === yt.id).title === '시험 / 동물원: 첫 영상');

      // 6) 분위기 바꾸기 → 고르기 창의 그 분위기 칸에도
      row = document.querySelector(`#bmList .bm-row[data-id="${yt.id}"]`);
      const sel = row.querySelector('[data-mood]');
      const mood = (SS.bgmCatalog.MOODS || [])[0];
      sel.value = mood; sel.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => M.lib.tracks.some((t) => t.id === yt.id && t.mood === mood), 4000, '분위기 바꾸기');
      // 7) 검색·분위기 거르기
      $('bmSearch').value = '동물원'; $('bmSearch').dispatchEvent(new Event('input'));
      check('검색', document.querySelectorAll('#bmList .bm-row').length === 1);
      $('bmSearch').value = ''; $('bmSearch').dispatchEvent(new Event('input'));
      $('bmMood').value = mood; $('bmMood').dispatchEvent(new Event('change'));
      check('분위기로 거르기', document.querySelectorAll('#bmList .bm-row').length === 1);
      $('bmMood').value = '전체'; $('bmMood').dispatchEvent(new Event('change'));

      // 8) 미리 듣기
      row = document.querySelector(`#bmList .bm-row[data-id="${tf.id}"]`);
      row.querySelector('[data-play]').click();
      await waitFor(() => !M.player.paused && M.player.currentTime > 0.2, 8000, '미리 듣기');
      check('듣기 단추 일시정지 모양', document.querySelector(`#bmList .bm-row[data-id="${tf.id}"] [data-play]`).classList.contains('i-pause'));
      await shot('4_playing');

      // 9) 쓰기 → 창 닫히고 편집 음악으로
      document.querySelector(`#bmList .bm-row[data-id="${yt.id}"] [data-use]`).click();
      await sleep(200);
      check('쓰기 → 창 닫힘·음악 멈춤', $('bgmMgr').hidden && M.player.paused && SS.state.dialogOpen === false);
      check('편집 음악으로 씀', SS.state.bgm && SS.state.bgm.id === yt.id, SS.state.bgm);
      await waitFor(() => /시험 \/ 동물원/.test(($('bgmTitle') || {}).textContent || ''), 4000, '음악 칸 제목');
      // 고르기 창: 바꾼 분위기 칸에 내 곡이 보임
      SS.bgmUi.openLib(); await sleep(200);
      const chip = Array.from(document.querySelectorAll('#bgmMoods [data-mood]')).find((b) => b.dataset.mood === mood);
      chip.click(); await sleep(150);
      check('고르기 창의 분위기 칸에 내 곡', !!document.querySelector(`#bgmList [data-id="${yt.id}"]`));
      // 고르기 창에서 관리 창 열기
      $('bgmOpenMgr').click(); await sleep(200);
      check('고르기 창 → 관리 창', !$('bgmMgr').hidden && $('bgmLib').hidden);
      await shot('5_reopen');

      // 10) 쓰는 곡은 지우지 않음, 다른 곡은 지움
      document.querySelector(`#bmList .bm-row[data-id="${yt.id}"] [data-del]`).click(); await sleep(300);
      check('쓰는 곡은 지우지 않음', M.lib.tracks.some((t) => t.id === yt.id));
      document.querySelector(`#bmList .bm-row[data-id="${tf.id}"] [data-del]`).click();
      await waitFor(() => !M.lib.tracks.some((t) => t.id === tf.id), 4000, '지우기');
      const left = await window.api.bgmLibrary();
      check('지운 곡은 목록·파일 모두', !left.tracks.some((t) => t.id === tf.id), tf.file);

      // 11) Esc (포커스가 본문에 있어도) 닫힘
      document.activeElement && document.activeElement.blur();
      key(document.body, 'Escape'); await sleep(150);
      check('Esc 로 닫힘', $('bgmMgr').hidden && SS.state.dialogOpen === false);

      // 정리
      SS.state.bgm = null; SS.bgmUi.render(); await sleep(100);
      for (const t of (await window.api.bgmLibrary()).tracks) await window.api.bgmCustomRemove(t.id);
      report.success = true;
    } catch (err) { report.success = false; report.error = err.stack || String(err); try { await SS.testShot(dir + '/error.png'); } catch (_) { /* */ } }
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error);
  });
})();

/* SS_TEST_SCRIPT=bgmprog: 음악 고르기·배경음악 관리의 미리 듣기 재생 바 */
(function () {
  'use strict';
  const SS = window.SS;
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'bgmprog') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const report = { checks: [] };
    const check = (name, ok, info) => { report.checks.push({ name, ok: !!ok, info: info === undefined ? null : info }); if (!ok) throw new Error(name + ': ' + JSON.stringify(info)); };
    const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('시간 초과: ' + what); await sleep(100); } };
    const ptr = (el, type, f) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: r.left + r.width * f, clientY: r.top + r.height / 2 })); };
    let dir = '';
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/bgmprog'; await window.api.mkdir(dir);
      await window.api.saveSettings({ sysCheckSeen: true });
      document.querySelectorAll('.modal-close').forEach((b) => b.click());
      const shot = (n) => SS.testShot(dir + '/' + n + '.png');
      const tf = await window.api.bgmImportFile(launch.cache + '/batch17_tone.mp3');
      window.dispatchEvent(new Event('ss:bgm-library-changed')); await sleep(400);
      SS.showBgmTab && SS.showBgmTab();
      const lib = SS.bgmUi.lib;
      // 1) 음악 고르기: 내 음악 칸 → 듣기
      SS.bgmUi.openLib(); await sleep(200);
      Array.from(document.querySelectorAll('#bgmMoods [data-mood]')).find((b) => b.dataset.mood === '내 음악').click(); await sleep(150);
      const row = () => document.querySelector(`#bgmList .bgm-item[data-id="${tf.id}"]`);
      const prog = () => row().querySelector('[data-prog]');
      check('듣기 전엔 바 숨김', prog() && prog().hidden);
      row().querySelector('[data-play]').click();
      await waitFor(() => !lib.paused && lib.currentTime > 0.6, 8000, '듣기 시작');
      check('듣는 곡에 재생 바', !prog().hidden && prog().getBoundingClientRect().width > 200, prog().getBoundingClientRect().width);
      const t1 = prog().querySelector('.bgm-pt').textContent;
      await sleep(1200);
      const t2 = prog().querySelector('.bgm-pt').textContent, fill = parseFloat(prog().querySelector('.bgm-pfill').style.width);
      check('시간·막대가 움직임', t1 !== t2 && fill > 2, { t1, t2, fill });
      check('전체 길이 표시', prog().querySelector('.bgm-pd').textContent === SS.bgm.fmt(lib.duration), prog().querySelector('.bgm-pd').textContent);
      await shot('1_lib_playing');
      // 2) 눌러서 옮기기 (60% 자리)
      const bar = prog().querySelector('.bgm-pbar');
      ptr(bar, 'pointerdown', 0.6); ptr(bar, 'pointerup', 0.6);
      await sleep(300);
      check('눌러서 옮김', Math.abs(lib.currentTime - lib.duration * 0.6) < 1.2 && !lib.paused, { cur: lib.currentTime, dur: lib.duration });
      // 3) 끌기: 20% → 40%
      ptr(bar, 'pointerdown', 0.2); ptr(bar, 'pointermove', 0.3);
      check('끄는 동안 막대가 따라옴', Math.abs(parseFloat(prog().querySelector('.bgm-pfill').style.width) - 30) < 2 && prog().classList.contains('dragging'));
      ptr(bar, 'pointermove', 0.4); ptr(bar, 'pointerup', 0.4); await sleep(300);
      check('끌어서 옮김', Math.abs(lib.currentTime - lib.duration * 0.4) < 1.2, lib.currentTime);
      // 4) 키보드 → 5초
      const before = lib.currentTime; bar.focus();
      bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await sleep(200);
      check('→ 키 5초 앞으로', lib.currentTime - before > 4 && lib.currentTime - before < 6.5, { before, now: lib.currentTime });
      // 5) 멈춰도 바는 남고, 다시 누르면 그 자리부터
      row().querySelector('[data-play]').click(); await sleep(200);
      const stopAt = lib.currentTime;
      check('멈춰도 바 남음', lib.paused && !prog().hidden);
      row().querySelector('[data-play]').click(); await sleep(400);
      check('다시 누르면 이어 듣기', !lib.paused && lib.currentTime >= stopAt - 0.1 && lib.currentTime < stopAt + 1.5, { stopAt, now: lib.currentTime });
      // 6) 다른 곡을 들으면 바가 그 곡으로 (목록 음악은 인터넷)
      Array.from(document.querySelectorAll('#bgmMoods [data-mood]')).find((b) => b.dataset.mood === '전체').click(); await sleep(150);
      const other = Array.from(document.querySelectorAll('#bgmList .bgm-item')).find((r) => r.dataset.id !== tf.id);
      other.querySelector('[data-play]').click(); await sleep(100);
      check('다른 곡: 불러오는 동안 바(불러오기 표시)', !other.querySelector('[data-prog]').hidden && row().querySelector('[data-prog]').hidden, other.dataset.id);
      await waitFor(() => !lib.paused && lib.currentTime > 0.3, 20000, '다른 곡 재생');
      check('다른 곡 바가 움직임', !other.querySelector('[data-prog]').classList.contains('loading') && parseFloat(other.querySelector('[data-prog] .bgm-pfill').style.width) >= 0);
      const obar = other.querySelector('[data-prog] .bgm-pbar'); ptr(obar, 'pointerdown', 0.8); ptr(obar, 'pointerup', 0.8);
      await waitFor(() => !lib.paused && Math.abs(lib.currentTime - lib.duration * 0.8) < 3 && !lib.seeking, 20000, '인터넷 곡 80% 자리로');
      check('인터넷 곡도 안 받은 자리로 옮김', true, { cur: lib.currentTime, dur: lib.duration });
      await shot('2_lib_other');
      SS.bgmUi.closeLib(); await sleep(150);
      check('창 닫으면 멈춤', lib.paused);
      // 7) 배경음악 관리에도 같은 바
      SS.openBgmManager(); await waitFor(() => document.querySelector(`#bmList .bm-row[data-id="${tf.id}"]`), 4000, '관리 목록');
      const mrow = document.querySelector(`#bmList .bm-row[data-id="${tf.id}"]`), mp = SS.bgmManager.player;
      mrow.querySelector('[data-play]').click();
      await waitFor(() => !mp.paused && mp.currentTime > 0.5, 8000, '관리 창 듣기');
      const mprog = mrow.querySelector('[data-prog]');
      check('관리 창에도 재생 바', !mprog.hidden && mprog.getBoundingClientRect().width > 200);
      const mbar = mprog.querySelector('.bgm-pbar'); ptr(mbar, 'pointerdown', 0.5); ptr(mbar, 'pointerup', 0.5); await sleep(300);
      check('관리 창 바로 옮김', Math.abs(mp.currentTime - mp.duration * 0.5) < 1.2, mp.currentTime);
      await shot('3_mgr_playing');
      SS.closeBgmManager();
      await window.api.bgmCustomRemove(tf.id);
      report.success = true;
    } catch (err) { report.success = false; report.error = err.stack || String(err); try { await SS.testShot(dir + '/error.png'); } catch (_) { /* */ } }
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error);
  });
})();
