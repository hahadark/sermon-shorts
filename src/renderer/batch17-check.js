/* SS_TEST_SCRIPT=batch17: 배경음악 재생 동기화(끊김), 내 파일·유튜브 링크로 음악 넣기, 내보내기 뒤 재생 창 */
(function () {
  'use strict';
  const SS = window.SS;
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'batch17') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const report = { checks: [], rects: {} };
    const check = (name, ok, info) => { report.checks.push({ name, ok: !!ok, info: info === undefined ? null : info }); if (!ok) throw new Error(name + ': ' + JSON.stringify(info)); };
    const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('시간 초과: ' + what); await sleep(100); } };
    let dir = '';
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/batch17'; await window.api.mkdir(dir);
      await window.api.saveSettings({ sysCheckSeen: true }); 
      document.querySelectorAll('.modal-close').forEach((b) => b.click());
      const shot = (n) => SS.testShot(dir + '/' + n + '.png');
      // 합성 자막: 0.6초 간격 60단어, 여러 곳을 지워 구간 6개 이상
      SS.preview.pause(); SS.closeTrim && SS.closeTrim();
      SS.state.words = Array.from({ length: 60 }, (_, id) => ({ id, text: ['하나님의', '은혜로', '살아갑니다.', '오늘도', '주님을', '따릅니다.'][id % 6], start: 2 + id * 0.6, end: 2 + id * 0.6 + 0.5, br: id % 3 === 2, del: (id >= 6 && id < 9) || (id >= 15 && id < 19) || (id >= 25 && id < 28) || (id >= 34 && id < 38) || (id >= 45 && id < 48) }));
      SS.state.settings = { padBefore: 0.05, padAfter: 0.05, fadeMs: 10, maxLineChars: 30, splitLongWords: true, semanticBreaks: false };
      SS.state.overrides = {}; SS.state.caret = 0; SS.state.selection = null; SS.state.meta = { title: '배경음악 시험', verse: '', speaker: '' };
      SS.resetEditorHistory(); SS.renderTranscript(); SS.updateTemplatePreview();
      SS.setEditedPlayMode(true);
      const segs = SS.getSegments();
      check('구간 6개 이상', segs.length >= 6, segs.length);

      // ---------- 1) 목록 음악으로 편집본 재생: 지운 곳을 건너뛰어도 음악이 끊기지 않는지 ----------
      const pick = 'amazing-grace-usaf-strings';
      SS.useBgm(pick);
      await waitFor(() => SS.bgmDl.local[pick], 60000, '목록 음악 받기');
      const mix = SS.bgmUi.mix, st = SS.bgmUi.syncStats;
      await SS.preview.seek(segs[0].start);
      SS.preview.play();
      await waitFor(() => !mix.paused && mix.currentTime > 0.2, 8000, '음악 시작');
      st.seeks = 0; st.nudges = 0; st.log.length = 0;
      let pauses = 0; const onPause = () => { if (!SS.preview.paused) pauses++; }; mix.addEventListener('pause', onPause);
      const drift = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 15000 && !SS.preview.paused) {
        const p = SS.bgm.plan(SS.state.bgm, SS.edl.segmentsDuration(SS.getSegments())), info = SS.playback.timeInfo();
        const want = SS.bgm.trackTimeAt(p, info.cur);
        if (want != null && !SS.preview.video.seeking && !SS.playback.isSkipping()) drift.push(Math.abs(mix.currentTime - want));
        await sleep(50);
      }
      mix.removeEventListener('pause', onPause);
      const jumps = SS.getSegments().filter((s) => s.start < SS.preview.currentTime).length - 1;
      SS.preview.pause();
      drift.sort((a, b) => a - b);
      report.syncLog = st.log.slice();
      report.sync = { jumps, seeks: st.seeks, nudges: st.nudges, pauses, median: drift[drift.length >> 1], p90: drift[Math.floor(drift.length * 0.9)], max: drift[drift.length - 1] };
      check('지운 곳을 3번 넘게 건너뜀', jumps >= 3, report.sync);
      check('재생 중 음악을 강제로 옮기지 않음 (끊김 없음)', st.seeks <= 1, report.sync);
      check('재생 중 음악이 멈추지 않음', pauses === 0, report.sync);
      check('음악 위치 어긋남 작음 (90%가 0.6초 안, 최대 1초)', report.sync.p90 < 0.6 && report.sync.max < 1, report.sync);

      // ---------- 2) 내 파일로 넣기 ----------
      const tone = launch.cache + '/batch17_tone.mp3';
      const t1 = await window.api.bgmImportFile(tone);
      check('내 파일 넣기', t1 && /^custom-f-/.test(t1.id) && Math.abs(t1.durationSec - 25) < 0.6 && t1.custom, t1);
      const libDir = (await window.api.bgmLibrary()).dir;
      check('넣은 파일은 보관함 폴더에 복사', t1.file && t1.file !== tone && t1.file.startsWith(libDir), { file: t1.file, libDir });
      SS.bgmUi.openLib(); await sleep(200);
      check('음악 고르기 창에 넣기 단추', !!$('bgmAddFile') && !!$('bgmAddYt') && !!$('bgmYtUrl'));
      SS.bgmImport.custom.set(t1.id, t1); SS.bgmUi.closeLib(); SS.useBgm(t1.id); await sleep(200);
      check('내 파일 음악 쓰기', SS.state.bgm.id === t1.id && !$('bgmOn').hidden && $('bgmTitle').textContent === t1.title, $('bgmTitle').textContent);
      check('직접 넣은 음악 출처 안내', /직접 넣은 음악/.test($('bgmCredit').textContent), $('bgmCredit').textContent);
      await waitFor(() => $('bgmWaveMsg').hidden, 20000, '내 파일 파형');
      await waitFor(() => SS.bgmDl.local[t1.id], 10000, '내 파일 준비');
      await SS.preview.seek(segs[1].start); SS.preview.play();
      await waitFor(() => !mix.paused && mix.currentTime > 0.3, 8000, '내 파일 함께 재생');
      check('내 파일 음악이 앱 안 통로로 재생', /^ssbgm:/.test(mix.currentSrc), mix.currentSrc);
      await sleep(600); SS.preview.pause();
      await shot('1_custom_panel');
      SS.bgmUi.openLib(); await sleep(250);
      check('내 음악 분위기 칸', !!document.querySelector('#bgmMoods [data-mood="내 음악"]'));
      await shot('2_library_mine');
      SS.bgmUi.closeLib();

      // ---------- 3) 내보내기 + 재생 창 ----------
      const out = dir + '/out.mp4';
      const res = await SS.doExport(out);
      check('내 파일 음악으로 내보내기', res && res.success, res);
      SS.showExportPlayer(res.outPath, { duration: res.duration, srtPath: res.srtPath });
      const pv = $('expVideo');
      await waitFor(() => pv.currentTime > 0.6 && !pv.paused, 8000, '재생 창 재생');
      check('내보낸 뒤 재생 창이 뜨고 재생', !$('expPlayer').hidden && pv.videoHeight === 1920 && pv.videoWidth === 1080, [pv.videoWidth, pv.videoHeight]);
      check('재생 창이 떠 있는 동안 편집 단축키 막힘', SS.state.dialogOpen === true);
      const r = $('expPlayer').querySelector('.exp-dialog').getBoundingClientRect(), d = window.devicePixelRatio || 1;
      report.rects.player = [r.left * d, r.top * d, r.right * d, r.bottom * d].map(Math.round);
      await shot('3_player');
      $('expPlayer').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(150);
      check('Esc 로 닫힘', $('expPlayer').hidden && pv.paused && SS.state.dialogOpen === false);

      // ---------- 4) 유튜브 링크로 넣기 (짧은 공개 영상) ----------
      const ytUrl = launch.testUrl || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
      SS.bgmUi.openLib(); await sleep(200);
      $('bgmYtUrl').value = ytUrl;
      const before = SS.state.bgm.id;
      const tY = Date.now();
      await SS.bgmImport.youtube();
      report.ytSec = (Date.now() - tY) / 1000;
      const yt = SS.state.bgm && SS.state.bgm.id !== before ? SS.bgmImport.custom.get(SS.state.bgm.id) : null;
      check('유튜브 링크로 넣고 바로 씀', yt && /^custom-yt-/.test(yt.id) && yt.durationSec > 5, { id: SS.state.bgm && SS.state.bgm.id, msg: ($('bgmImportMsg') || {}).textContent });
      check('유튜브 음악 출처 문구', /youtube\.com|youtu\.be/.test(SS.bgmCredit()), SS.bgmCredit());
      await waitFor(() => $('bgmWaveMsg').hidden, 20000, '유튜브 파형');
      await SS.preview.seek(segs[0].start); SS.preview.play();
      await waitFor(() => !mix.paused && mix.currentTime > 0.3, 8000, '유튜브 음악 재생');
      SS.preview.pause();
      await shot('4_youtube');
      // 정리: 시험으로 넣은 음악 빼기
      SS.useBgm(pick); await sleep(100);
      for (const id of [t1.id, yt.id]) await window.api.bgmCustomRemove(id);
      const left = await window.api.bgmCustomList();
      check('시험 음악 정리', !left.some((x) => x.id === t1.id || x.id === yt.id), left.map((x) => x.id));
      report.success = true;
    } catch (err) { report.success = false; report.error = err.stack || String(err); try { await SS.testShot(dir + '/error.png'); } catch (_) { /* */ } }
    try { SS.preview.pause(); SS.closeExportPlayer && SS.closeExportPlayer(); } catch (_) { /* */ }
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error);
  });
})();
