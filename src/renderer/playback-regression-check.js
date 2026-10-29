/* 테스트 훅: SS_TEST_SCRIPT=playback-regression — 복합 편집 후 재생/시크 안정성 (실제 영상·실제 SS.preview/playback, AI·인터넷 없음)
 * 결과: cache/playback-regression/report.json */
(function () {
  'use strict';
  const SS = window.SS;
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'playback-regression') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const report = { startedAt: new Date().toISOString(), checks: [] };
    const check = (name, ok, extra) => { report.checks.push({ name, ok: !!ok, extra }); console.log('[PBR] ' + (ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + JSON.stringify(extra))); };
    let dir = '';
    const finish = async (err) => {
      report.error = err ? String(err && err.stack || err) : null;
      report.pass = report.checks.filter((c) => c.ok).length; report.fail = report.checks.filter((c) => !c.ok).length + (err ? 1 : 0);
      try { await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2)); } catch (_) {}
      console.log('[PBR] DONE pass=' + report.pass + ' fail=' + report.fail);
      try { SS.preview.pause(); } catch (_) {}
      if (report.fail === 0) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError('fail=' + report.fail);
    };
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/playback-regression';
      await window.api.mkdir(dir);
      const t0 = Date.now();
      while (!(SS.state && SS.state.words && SS.state.words.length > 100 && SS.preview && SS.preview.loaded)) { if (Date.now() - t0 > 60000) throw new Error('영상/자막이 열리지 않았습니다'); await sleep(200); }
      SS.preview.pause(); await sleep(100);
      const v = SS.preview.video;
      const ws = () => SS.state.words;
      const setDel = (fn) => { SS.pushUndo(); ws().forEach((w, i) => { w.del = !!fn(i, w); }); SS.pushUndo(); SS.renderTranscript(); };
      const segs = () => SS.getSegments();
      const waitFor = async (fn, ms) => { const e0 = Date.now(); while (Date.now() - e0 < ms) { if (fn()) return true; await sleep(20); } return !!fn(); };
      const inGap = (t) => { const s = segs(); return s.length > 0 && !s.some((x) => t >= x.start - 0.06 && t <= x.end + 0.06); };
      const sampleRun = async (ms) => { const out = []; const e1 = Date.now() + ms; while (Date.now() < e1) { out.push(+v.currentTime.toFixed(3)); await sleep(20); } return out; };
      const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))]);
      SS.setEditedPlayMode(true);
      let focusCalls = []; const origFocus = SS.focusPlaybackCaption;
      SS.focusPlaybackCaption = (t) => { focusCalls.push(t); if (origFocus) return origFocus(t); };

      // 1~3) 같은 자리 seek / 연타 seek
      await SS.preview.seek(5);
      check('1 같은 자리 seek 가 끝남', (await withTimeout(SS.preview.seek(5), 1500)) !== 'TIMEOUT');
      check('2 현재 위치 그대로 seek', (await withTimeout(SS.preview.seek(v.currentTime), 1500)) !== 'TIMEOUT');
      const rapid = [];
      for (let i = 0; i < 12; i++) rapid.push(SS.preview.seek(2 + (i % 5) * 3.1));
      check('3 연타 seek 모두 끝남', (await withTimeout(Promise.all(rapid), 5000)) !== 'TIMEOUT');
      check('4 연타 seek 뒤 seeking 해제', v.seeking === false);
      await SS.preview.seek(0); await SS.preview.seek(79.99); await SS.preview.seek(200);
      check('5 범위 밖 seek 도 끝나고 길이 안', v.currentTime <= SS.preview.duration + 0.05, v.currentTime);

      // 복합 편집: 삭제 → 되돌리기 → 다시 → 다른 삭제
      const n = ws().length;
      setDel((i) => i < 5 || (i >= 40 && i < 70) || (i >= 120 && i < 140) || i >= n - 20);
      let s1 = segs().length;
      check('6 삭제 후 구간 3개 이상', s1 >= 3, s1);
      const first = segs()[0];
      await SS.preview.seek(first.end - 1.0);
      SS.preview.play();
      let sm = await sampleRun(3500);
      SS.preview.pause(); await sleep(150);
      const bad = sm.filter(inGap);
      check('7 재생이 지운 곳을 건너뛰고 계속 감', bad.length === 0 && sm[sm.length - 1] > first.end + 0.5, { bad: bad.slice(0, 4), last: sm[sm.length - 1] });
      check('8 건너뛴 뒤 소리 켜짐', v.muted === false);
      check('9 멈추면 포커스 호출', focusCalls.length >= 1, focusCalls);

      SS.undo(); await sleep(100);
      const sUndo = segs().length;
      SS.redo(); await sleep(100);
      check('10 undo/redo 뒤 구간 갱신', segs().length === s1 && sUndo !== s1 || segs().length === s1, [sUndo, segs().length, s1]);
      await SS.preview.seek(segs()[0].start + 0.1);
      SS.preview.play(); sm = await sampleRun(2500); SS.preview.pause(); await sleep(100);
      check('11 redo 뒤 재생도 건너뜀', sm.filter(inGap).length === 0 && sm[sm.length - 1] > sm[0] + 1, sm.slice(-3));

      // 재생 도중 편집 (구간이 바뀜)
      await SS.preview.seek(segs()[0].start + 0.1);
      SS.preview.play(); await sleep(400);
      setDel((i) => i < 5 || (i >= 40 && i < 90) || i >= n - 20);   // 재생 중 삭제 범위 변경
      sm = await sampleRun(2500);
      check('12 재생 중 편집해도 멈추지 않음', !SS.preview.paused && sm[sm.length - 1] > sm[0] + 0.8, [sm[0], sm[sm.length - 1], SS.preview.paused]);
      check('13 재생 중 편집 뒤 새 지운 곳을 안 틂', sm.filter(inGap).length === 0, sm.filter(inGap).slice(0, 4));
      SS.preview.pause(); await sleep(100);

      // 끝 재시작
      const last = () => segs()[segs().length - 1];
      await SS.preview.seek(last().end - 0.4);
      SS.preview.play(); await waitFor(() => SS.preview.paused, 3000);
      check('14 마지막 구간 끝에서 멈춤', SS.preview.paused && Math.abs(v.currentTime - last().end) < 0.15, [v.currentTime, last().end]);
      SS.preview.play(); await sleep(500);
      check('15 끝에서 재생 → 처음 구간부터', Math.abs(v.currentTime - segs()[0].start) < 1, [v.currentTime, segs()[0].start]);
      SS.preview.pause(); await sleep(100);
      for (let k = 0; k < 3; k++) {   // 반복 재시작
        await SS.preview.seek(last().end - 0.3); SS.preview.play(); await waitFor(() => SS.preview.paused, 3000);
        SS.preview.play(); await sleep(300); SS.preview.pause(); await sleep(80);
      }
      check('16 끝 재시작 3회 반복 후 정상', v.muted === false && Math.abs(v.currentTime - segs()[0].start) < 1.2, v.currentTime);

      // 지운 곳 한복판에서 재생 / 지운 곳으로 시크
      const gapMid = (segs()[0].end + segs()[1].start) / 2;
      await SS.preview.seek(gapMid); SS.preview.play(); await sleep(450);
      check('17 지운 곳에서 재생 → 다음 구간', Math.abs(v.currentTime - segs()[1].start) < 1.0 && !inGap(v.currentTime), [v.currentTime, segs()[1].start]);
      SS.preview.pause(); await sleep(100);
      // 재생 중 시크 연타
      SS.preview.play(); await sleep(150);
      for (let i = 0; i < 8; i++) { SS.preview.seek(segs()[i % segs().length].start + 0.1); await sleep(30); }
      sm = await sampleRun(1200);
      check('18 재생 중 시크 연타 뒤 계속 재생', !SS.preview.paused && sm[sm.length - 1] !== sm[0], [sm[0], sm[sm.length - 1]]);
      check('19 시크 연타 뒤 소리 켜짐', v.muted === false);
      SS.preview.pause(); await sleep(100);

      // playOutRange (미세 조정 미리듣기)
      const total = SS.edl.segmentsDuration(segs());
      SS.playback.playOutRange(1.0, 1.8);
      await sleep(300);
      check('20 playOutRange 시작', !SS.preview.paused);
      await waitFor(() => SS.preview.paused, 3000);
      const outNow = SS.edl.srcToOut(segs(), v.currentTime);
      check('21 playOutRange 가 끝 지점에서 멈춤', SS.preview.paused && outNow != null && Math.abs(outNow - 1.8) < 0.25, outNow);
      SS.preview.play(); await sleep(1500);
      check('22 이후 일반 재생에 정지 지점 안 남음', !SS.preview.paused, v.currentTime);
      SS.preview.pause(); await sleep(100);
      // playOutRange 연속 호출, 재생 중 호출
      SS.playback.playOutRange(0.2, 0.6); SS.playback.playOutRange(2, 2.5); await sleep(200);
      SS.playback.playOutRange(3, 3.4);
      await waitFor(() => SS.preview.paused, 3000);
      const o2 = SS.edl.srcToOut(segs(), v.currentTime);
      check('23 playOutRange 연속 호출은 마지막 범위로', SS.preview.paused && o2 != null && Math.abs(o2 - 3.4) < 0.25, o2);
      // 재생 중 구간 변경 후 playOutRange 정지 지점 폐기
      SS.playback.playOutRange(4, 4.4); await sleep(100);
      setDel((i) => i < 5 || (i >= 40 && i < 60) || i >= n - 20);
      await sleep(1200);
      SS.preview.pause(); await sleep(100);
      SS.preview.play(); await sleep(1200);
      check('24 구간 변경 뒤에도 재생 계속', !SS.preview.paused && v.muted === false);
      SS.preview.pause(); await sleep(100);

      // 원본 재생 한 번 + 편집 모드 끄기
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', shiftKey: true, bubbles: true }));
      await sleep(500);
      check('25 Shift+Space 원본 재생', !SS.preview.paused && SS.playback.isRaw());
      SS.preview.pause(); await sleep(150);
      check('26 멈추면 편집 재생 복귀', !SS.playback.isRaw() && SS.playback.active());
      SS.setEditedPlayMode(false);
      await SS.preview.seek(gapMid); SS.preview.play(); await sleep(500);
      check('27 편집 재생 끄면 지운 곳도 그대로 재생', !SS.preview.paused && Math.abs(v.currentTime - gapMid) < 1.5, v.currentTime);
      SS.preview.pause(); SS.setEditedPlayMode(true); await sleep(100);

      // 재생 중 영상 다시 불러오기(같은 경로) 직후 seek
      const p = SS.preview.path;
      SS.preview.play(); await sleep(200);
      const lp = SS.preview.load(p, { fps: SS.preview.fps, duration: SS.preview.duration });
      const sk = SS.preview.seek(10);
      check('28 load 직후 seek 도 영구 대기 안 함', (await withTimeout(Promise.all([lp, sk]), 6000)) !== 'TIMEOUT');
      SS.preview.pause(); await sleep(100);
      check('29 모든 시험 뒤 소리 켜짐', v.muted === false);
      await finish(null);
    } catch (err) { console.log('[PBR] ERROR ' + (err && err.stack || err)); await finish(err); }
  });
})();


