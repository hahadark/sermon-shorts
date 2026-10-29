/* 테스트 훅: SS_TEST_SCRIPT=batch14 — v0.3.14 묶음 확인 (실제 영상·실제 재생, AI·인터넷 없음)
 *  1) 디자인 카드에서 교회 이름·설교자 저장  2) 편집 결과 재생(지운 곳 건너뛰기·끝에서 멈춤·원본 재생 한 번)
 *  6) 재생 중 스크롤 (따라가기 멈춤·재생 위치로)
 * 결과: cache/batch14/report.json, 화면: cache/batch14/*.png */
(function () {
  'use strict';
  const SS = window.SS;
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'batch14') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const report = { startedAt: new Date().toISOString(), checks: [] };
    const check = (name, ok, extra) => { report.checks.push({ name, ok: !!ok, extra }); if (!ok) throw new Error(name + ' ' + JSON.stringify(extra === undefined ? '' : extra)); };
    let dir = '';
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/batch14';
      await window.api.mkdir(dir);
      const shot = (n) => SS.testShot(dir + '/' + n + '.png');
      const t0 = Date.now();
      while (!(SS.state && SS.state.words && SS.state.words.length && document.querySelector('.caption-output'))) { if (Date.now() - t0 > 60000) throw new Error('자막이 열리지 않았습니다'); await sleep(200); }
      SS.preview.pause();
      const ws = SS.state.words;
      const v = SS.preview.video;

      // ---------- 1) 교회 정보 ----------
      const inp = $('inpChurch');
      check('교회 이름 칸 있음', !!inp);
      inp.focus(); inp.value = '사랑의교회 테스트'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur();
      check('미리보기 설정 바로 바뀜', SS.appSettings.template.churchName === '사랑의교회 테스트');
      await sleep(900);
      let st = await window.api.getSettings();
      check('설정에 저장됨', st.template.churchName === '사랑의교회 테스트', st.template.churchName);
      const sel = $('selSpeaker');
      sel.value = '직접 입력'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      $('inpSpeaker').value = '김택근 사관'; $('inpSpeaker').dispatchEvent(new Event('input', { bubbles: true }));
      check('설교자 저장 단추 보임', !$('btnSaveSpeaker').hidden);
      $('btnSaveSpeaker').click(); await sleep(700);
      st = await window.api.getSettings();
      check('설교자 목록에 저장', st.speakers.includes('김택근 사관'), st.speakers);
      check('설교자 선택됨', sel.value === '김택근 사관', sel.value);
      check('저장 단추 숨김', $('btnSaveSpeaker').hidden);
      const wasShown = !!SS.state.activeTheme.churchName.show;
      $('btnChurchShow').click(); await sleep(150);
      check('교회 이름 보이기 토글', SS.state.activeTheme.churchName.show === !wasShown, wasShown);
      check('눈 단추 상태', $('btnChurchShow').getAttribute('aria-pressed') === String(!wasShown));
      await SS.updateTemplatePreview(); await sleep(300);
      await shot('1_church');

      // ---------- 2) 편집 결과 재생 ----------
      SS.setEditedPlayMode(true);
      SS.pushUndo();
      for (let i = 0; i < ws.length; i++) ws[i].del = i < 3 || (i >= 30 && i < 45) || i >= 120;
      SS.renderTranscript();
      const segs = SS.getSegments();
      check('구간 2개 이상', segs.length >= 2, segs.length);
      const gapA = segs[0].end, gapB = segs[1].start;
      check('지운 틈이 충분함', gapB - gapA > 1, [gapA, gapB]);
      SS.updateTimeUI(); await sleep(50);
      check('시간 표시 편집본', $('timeMode').textContent === '편집본', $('timeMode').textContent);
      check('전체 시간 = 편집 길이', $('durTime').textContent === SS.fmtTime(SS.edl.segmentsDuration(segs)), $('durTime').textContent);
      // 지운 곳에서 재생을 누르면 다음 남은 곳부터
      await SS.preview.seek((gapA + gapB) / 2);
      SS.preview.play();
      await sleep(400);
      check('지운 곳에서 재생 → 다음 구간', v.currentTime >= gapB - 0.03 && v.currentTime < gapB + 1, v.currentTime);
      SS.preview.pause(); await sleep(100);
      // 구간 끝에서 지운 부분을 건너뛰는지 (20ms 간격으로 재생 위치를 살핌)
      await SS.preview.seek(gapA - 0.6);
      const samples = [];
      SS.preview.play();
      const tEnd = Date.now() + 1600;
      while (Date.now() < tEnd) { samples.push(+v.currentTime.toFixed(3)); await sleep(20); }
      SS.preview.pause();
      const inGap = samples.filter((t) => t > gapA + 0.06 && t < gapB - 0.06);
      check('지운 부분을 재생하지 않음', inGap.length === 0, { inGap: inGap.slice(0, 5), gapA, gapB });
      check('다음 구간으로 넘어감', samples.some((t) => t >= gapB), samples.slice(-3));
      check('소리 다시 켜짐', v.muted === false);
      report.skipSamples = samples.length;
      // 마지막 구간이 끝나면 멈춤 (뒤의 지운 원본을 틀지 않음)
      const last = segs[segs.length - 1];
      await SS.preview.seek(last.end - 0.5);
      SS.preview.play(); await sleep(1300);
      check('끝에서 멈춤', SS.preview.paused, v.currentTime);
      check('끝 위치', Math.abs(v.currentTime - last.end) < 0.12, [v.currentTime, last.end]);
      // 끝에서 다시 재생 → 처음부터
      SS.preview.play(); await sleep(350);
      check('끝에서 다시 재생 → 처음부터', v.currentTime >= segs[0].start - 0.03 && v.currentTime < segs[0].start + 1, [v.currentTime, segs[0].start]);
      SS.preview.pause(); await sleep(100);
      // Shift+Space: 이번만 원본 재생, 멈추면 다시 편집 결과
      await SS.preview.seek(gapA - 0.3);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', shiftKey: true, bubbles: true }));
      await sleep(700);
      check('원본 재생은 지운 곳도 재생', v.currentTime > gapA + 0.2 && v.currentTime < gapB, [v.currentTime, gapA, gapB]);
      check('원본 재생 중 표시', $('timeMode').textContent === '원본');
      SS.preview.pause(); await sleep(100);
      check('멈추면 편집 결과 재생으로', SS.playback.active() && $('chkEditedPlay').checked);
      await shot('2_playback');

      // ---------- 6) 재생 중 스크롤 ----------
      for (let i = 0; i < ws.length; i++) ws[i].del = false;
      SS.renderTranscript();
      const body = $('transcriptBody');
      await SS.preview.seek(ws[150].start);
      SS.preview.play(); await sleep(700);
      check('재생 중 따라가기 켜짐', SS.isFollowPlay());
      body.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, bubbles: true }));
      body.scrollTop = 1500;   // 재생 위치와 먼 곳을 읽는 중
      const trace = [];
      for (let k = 0; k < 18; k++) { await sleep(50); trace.push(Math.round(body.scrollTop)); }
      report.scrollTrace = trace;
      check('스크롤하면 따라가기 멈춤', !SS.isFollowPlay());
      check('스크롤 위치 유지 (재생 위치로 끌려가지 않음)', trace.every((y) => Math.abs(y - 1500) < 120), trace);
      check('재생 위치로 단추 보임', !$('btnFollowPlay').hidden);
      await shot('6_scroll_paused_follow');
      $('btnFollowPlay').click(); await sleep(400);
      const caret = body.querySelector('#the-caret') || body.querySelector(`[data-wid="${SS.state.caret}"]`);
      const r = caret.getBoundingClientRect(), br = body.getBoundingClientRect();
      check('재생 위치로 돌아감', r.top >= br.top - 2 && r.bottom <= br.bottom + 2, [r.top, br.top, br.bottom]);
      check('단추 숨김', $('btnFollowPlay').hidden);
      SS.preview.pause();
      report.success = true;
    } catch (err) {
      report.success = false; report.error = err.stack || String(err);
    }
    try { SS.preview.pause(); } catch (_) {}
    report.finishedAt = new Date().toISOString();
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error);
  });
})();
