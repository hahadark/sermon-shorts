/* SS_TEST_SCRIPT=voice: 목소리 크기 (자동 맞춤 재기, 미리보기 리미터, 내보낸 영상의 최고 크기·LUFS, 실행 취소·프로젝트 저장) */
(function () {
  'use strict';
  const SS = window.SS;
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'voice') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const report = { checks: [], measures: {} };
    const check = (name, ok, info) => { report.checks.push({ name, ok: !!ok, info: info === undefined ? null : info }); if (!ok) throw new Error(name + ': ' + JSON.stringify(info)); };
    const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('시간 초과: ' + what); await sleep(100); } };
    let dir = '';
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/voice_test'; await window.api.mkdir(dir);
      await window.api.saveSettings({ sysCheckSeen: true });
      document.querySelectorAll('.modal-close').forEach((b) => b.click());
      const shot = (n) => SS.testShot(dir + '/' + n + '.png');
      await waitFor(() => SS.state.words && SS.state.words.length > 60, 20000, '자막');
      const VU = SS.voiceUi, V = SS.voice;
      // 앞 40초만 남기기 (내보내기를 짧게)
      SS.pushUndo(); SS.state.words.forEach((w) => { w.del = w.start > 40; }); SS.renderTranscript(); SS.pushUndo();
      const segs = SS.getSegments();
      const range = [0, 41];

      // 1) 목소리 칸
      $('tabVoice').click(); await sleep(150);
      check('목소리 칸 열림', !$('voicePane').hidden && $('designPane').hidden && $('bgmPane').hidden);
      check('기본은 원래대로', V.normalize(SS.state.voice).mode === 'off' && $('voiceMode').querySelector('[data-mode="off"]').classList.contains('on'));

      // 2) 원본 크기 재기 (끈 상태 = 원래 소리)
      const raw = await window.api.voiceAnalyze({ sourcePath: SS.state.source.path, segments: segs, voice: {} });
      report.measures.raw = raw;
      check('원본 LUFS 잼', raw.i < -5 && raw.i > -60, raw);

      // 3) 자동 맞춤 → 잰 값·키울 크기
      $('voiceMode').querySelector('[data-mode="auto"]').click();
      await waitFor(() => V.measuredFits(SS.state.voice, V.segKey(SS.getSegments())) && !VU.measuring, 20000, '자동 맞춤 재기');
      const g = V.gainDb(SS.state.voice);
      check('자동 맞춤: -14 LUFS 까지 키울 크기', Math.abs(g - Math.max(-12, Math.min(20, -14 - raw.i))) < 0.2, { g, i: SS.state.voice.measured.i });
      check('자동 맞춤 문구', /LUFS/.test($('voiceAutoMsg').textContent) && /dB/.test($('voiceAutoMsg').textContent), $('voiceAutoMsg').textContent);
      await shot('1_auto');
      // 편집이 바뀌면 다시 잰다
      SS.pushUndo(); SS.state.words.forEach((w) => { if (w.start > 30) w.del = true; }); SS.renderTranscript(); SS.pushUndo();
      await waitFor(() => !V.measuredFits(SS.state.voice, V.segKey(SS.getSegments())) || VU.measuring, 3000, '편집 바뀜 감지');
      await waitFor(() => V.measuredFits(SS.state.voice, V.segKey(SS.getSegments())) && !VU.measuring, 20000, '다시 재기');
      check('편집이 바뀌면 다시 잼', true, SS.state.voice.measured);
      SS.undo(); await sleep(100);
      await waitFor(() => V.measuredFits(SS.state.voice, V.segKey(SS.getSegments())) && !VU.measuring, 20000, '되돌린 뒤 다시 재기');

      // 4) 미리보기: 직접 +20 dB 로 크게 키워도 리미터가 -1.5 dB 근처에서 막는지 (Web Audio)
      $('voiceMode').querySelector('[data-mode="manual"]').click(); await sleep(100);
      $('voiceGain').value = '20'; $('voiceGain').dispatchEvent(new Event('input')); $('voiceGain').dispatchEvent(new Event('change'));
      check('직접 +20 dB', V.gainDb(SS.state.voice) === 20 && /\+20\.0 dB/.test($('voiceGainLbl').textContent));
      await VU.graph.ready; check('미리보기 리미터 준비', !!VU.graph.lim);
      VU.stats.maxPeakDb = -100; VU.stats.frames = 0; VU.stats.nonSilent = 0;
      await SS.preview.seek(segs[0].start + 2);
      SS.preview.play();
      await sleep(4500);
      SS.preview.pause();
      report.measures.preview = { ...VU.stats };
      check('미리보기 소리가 Web Audio 로 들림', VU.stats.nonSilent > 20, VU.stats);
      check('미리보기 +20 dB 도 리미터 아래 (≤ -1.4 dB)', VU.stats.maxPeakDb <= -1.4 && VU.stats.maxPeakDb > -12, VU.stats.maxPeakDb);
      await shot('2_manual_meter');

      // 5) 내보내기: +20 dB → 진짜 최고 크기(true peak) 가 -1 dBTP 아래, 깨지지 않음
      const out1 = dir + '/voice_plus20.mp4';
      const r1 = await SS.doExport(out1, range);
      check('내보내기 (+20 dB)', r1.success, r1.error);
      const m1 = await window.api.voiceAnalyze({ sourcePath: out1, segments: [{ start: 0, end: r1.duration }], voice: {} });
      report.measures.export20 = m1;
      check('내보낸 영상 최고 크기 ≤ -1.0 dBTP (찢어지지 않음)', m1.tp <= -1.0, m1);
      check('내보낸 영상이 원본보다 크게', m1.i > raw.i + 6, { out: m1.i, raw: raw.i });
      // 6) 자동 맞춤으로 내보내기 → -14 LUFS 근처
      $('voiceMode').querySelector('[data-mode="auto"]').click();
      await waitFor(() => V.measuredFits(SS.state.voice, V.segKey(SS.getSegments())) && !VU.measuring, 20000, '자동 맞춤 재기 2');
      const out2 = dir + '/voice_auto.mp4';
      const r2 = await SS.doExport(out2, range);
      check('내보내기 (자동 맞춤)', r2.success, r2.error);
      const m2 = await window.api.voiceAnalyze({ sourcePath: out2, segments: [{ start: 0, end: r2.duration }], voice: {} });
      report.measures.exportAuto = m2;
      check('자동 맞춤 결과 -14 LUFS 근처 (±2)', Math.abs(m2.i - (-14)) <= 2, m2);
      check('자동 맞춤 최고 크기 ≤ -1.0 dBTP', m2.tp <= -1.0, m2);
      // 7) 작은 말소리 고르게 켜면 다시 재고 결과도 -14 근처
      $('voiceEven').click();
      await waitFor(() => V.measuredFits(SS.state.voice, V.segKey(SS.getSegments())) && !VU.measuring, 20000, '고르게 재기');
      check('고르게: 압축 뒤 크기로 다시 잼', SS.state.voice.measured.even === true, SS.state.voice.measured);
      const out3 = dir + '/voice_auto_even.mp4';
      const r3 = await SS.doExport(out3, range);
      const m3 = await window.api.voiceAnalyze({ sourcePath: out3, segments: [{ start: 0, end: r3.duration }], voice: {} });
      report.measures.exportEven = m3;
      check('고르게 + 자동 맞춤 -14 LUFS 근처, 깨짐 없음', r3.success && Math.abs(m3.i + 14) <= 2 && m3.tp <= -1.0, m3);
      check('고르게 하면 크기 폭(LRA)이 줄어듦', m3.lra <= m2.lra + 0.1, { even: m3.lra, plain: m2.lra });

      // 8) 실행 취소·프로젝트 저장
      SS.undo(); await sleep(100);
      check('실행 취소로 고르게 끔', V.normalize(SS.state.voice).even === false && !$('voiceEven').checked);
      const pj = dir + '/voice.sshorts';
      await SS.saveProjectTo(pj);
      const saved = await window.api.readJson(pj);
      check('프로젝트에 목소리 설정 저장', saved.voice && saved.voice.mode === 'auto', saved.voice);
      // 9) 원래대로: 그대로 내보내면 원본과 같은 크기
      $('voiceMode').querySelector('[data-mode="off"]').click(); await sleep(100);
      const out4 = dir + '/voice_off.mp4';
      const r4 = await SS.doExport(out4, range);
      const m4 = await window.api.voiceAnalyze({ sourcePath: out4, segments: [{ start: 0, end: r4.duration }], voice: {} });
      report.measures.exportOff = m4;
      check('원래대로: 원본 크기 그대로 (±1)', r4.success && Math.abs(m4.i - raw.i) <= 1, { out: m4.i, raw: raw.i });
      $('voiceMode').querySelector('[data-mode="auto"]').click(); await sleep(300);
      await shot('3_final');
      report.success = true;
    } catch (err) { report.success = false; report.error = err.stack || String(err); try { await SS.testShot(dir + '/error.png'); } catch (_) { /* */ } }
    try { SS.preview.pause(); } catch (_) { /* */ }
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error);
  });
})();
