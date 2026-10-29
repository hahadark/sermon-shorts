/* qa-media-check - SS_TEST_SCRIPT=qa-media
 * 배경음악·내보내기·재생 창·교인 자료의 복합 시나리오 시험. 한 시나리오가 실패해도 나머지는 계속 돌리고,
 * 결과는 <cache>/qa_media/report.json 에 적는다. (AI 호출 없음. 유튜브 링크 넣기는 한 번만 시도)
 * 시험용 음 파일은 cache/qa_media/fx (ffmpeg sine) 에 미리 만들어 둔다. */
(function () {
  'use strict';
  const SS = window.SS;
  const errors = [];
  window.addEventListener('error', (e) => errors.push('error: ' + (e.message || e.error) + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno + ':' + e.colno + ' ' + String(e.error && e.error.stack || '').split('\n').slice(0, 4).join(' | ')));
  window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'qa-media') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const report = { checks: [], notes: {}, fails: [] };
    const check = (name, ok, info) => { report.checks.push({ name, ok: !!ok, info: info === undefined ? null : info }); if (!ok) report.fails.push(name + ' :: ' + JSON.stringify(info === undefined ? null : info).slice(0, 300)); return !!ok; };
    const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) { check('시간 초과: ' + what, false); return false; } await sleep(80); } return true; };
    const scenario = async (name, fn) => { const n0 = report.fails.length; try { await fn(); } catch (err) { check('시나리오 예외: ' + name, false, String(err && err.stack || err).slice(0, 400)); } report.notes['s_' + name] = report.fails.length === n0 ? 'ok' : 'FAIL'; };
    const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    const setVal = (id, v, ev) => { const el = $(id); el.value = v; fire(el, ev || 'change'); };
    const key = (k, extra) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...(extra || {}) }));
    let dir = '';
    const madeIds = [];
    try {
      const launch = await window.api.getLaunchInfo();
      const root = launch.cache;
      dir = root + '/qa_media'; await window.api.mkdir(dir);
      const fx = dir + '/fx';
      await window.api.saveSettings({ sysCheckSeen: true });
      document.querySelectorAll('.modal-close').forEach((b) => b.click());
      const shot = (n) => SS.testShot(dir + '/' + n + '.png');
      SS.preview.pause(); SS.closeTrim && SS.closeTrim();
      SS.state.words = Array.from({ length: 60 }, (_, id) => ({ id, text: ['하나님의', '은혜로', '살아갑니다.', '오늘도', '주님을', '따릅니다.'][id % 6], start: 2 + id * 0.6, end: 2 + id * 0.6 + 0.5, br: id % 3 === 2, del: (id >= 6 && id < 9) || (id >= 15 && id < 19) || (id >= 25 && id < 28) || (id >= 34 && id < 38) || (id >= 45 && id < 48) }));
      SS.state.settings = { padBefore: 0.05, padAfter: 0.05, fadeMs: 10, maxLineChars: 30, splitLongWords: true, semanticBreaks: false };
      SS.state.overrides = {}; SS.state.caret = 0; SS.state.selection = null; SS.state.meta = { title: '음악·내보내기 QA', verse: '', speaker: '' };
      SS.state.bgm = null;
      SS.resetEditorHistory(); SS.renderTranscript(); SS.updateTemplatePreview();
      SS.setEditedPlayMode(true);
      const segs = SS.getSegments();
      const outD = () => SS.edl.segmentsDuration(SS.getSegments());
      report.notes.outDur = outD();
      const mix = SS.bgmUi.mix;
      SS.showBgmTab(); await sleep(150);

      // ---------- A) 내 파일 넣기: 형식·이상한 이름·오류 문구 ----------
      const imp = async (name) => {
        const before = SS.state.bgm && SS.state.bgm.id;
        const nBefore = (await window.api.bgmCustomList()).length;
        SS.bgmUi.openLib(); await sleep(60);
        await SS.bgmImport.file(fx + '/' + name);
        const msg = $('bgmImportMsg').textContent, cls = $('bgmImportMsg').className;
        const after = SS.state.bgm && SS.state.bgm.id;
        const nAfter = (await window.api.bgmCustomList()).length;
        SS.bgmUi.closeLib();
        return { msg, ok: /ok/.test(cls), changed: after !== before, id: after, added: nAfter - nBefore };
      };
      let idMp3, idWav, idM4a, idHash, idLong;
      await scenario('import', async () => {
        let r = await imp('tone25.mp3'); idMp3 = r.id; madeIds.push(idMp3);
        check('mp3 넣기', r.ok && r.changed && r.added === 1 && /^custom-f-/.test(idMp3), r);
        const again = await imp('tone25.mp3');
        check('같은 파일 두 번 넣어도 목록은 1개 (같은 곡)', again.ok && again.id === idMp3 && again.added === 0, again);
        r = await imp('short3.wav'); idWav = r.id; madeIds.push(idWav);
        check('wav 넣기 (3초)', r.ok && r.changed, r);
        r = await imp('tone12.m4a'); idM4a = r.id; madeIds.push(idM4a);
        check('m4a 넣기', r.ok && r.changed, r);
        r = await imp('한글 폴더 #1/내 찬양 #3 (최종) 100%.mp3'); idHash = r.id; madeIds.push(idHash);
        const t = SS.bgmImport.custom.get(idHash);
        check('한글·공백·#·% 이름 넣기', r.ok && r.changed && t && /내 찬양 #3 \(최종\) 100%/.test(t.title), { msg: r.msg, title: t && t.title });
        r = await imp('long60.mp3'); idLong = r.id; madeIds.push(idLong);
        check('60초 mp3 넣기', r.ok && r.changed, r);
        r = await imp('silent10.mp3');
        if (r.id) madeIds.push(r.id);
        check('무음 파일은 (소리 줄기는 있으므로) 넣어지고 오류 없음', r.ok, r);
        const bad = { 'notes.txt': /음악 파일/, 'garbage.mp3': /소리를 읽을 수 없/, 'empty.mp3': /소리를 읽을 수 없|너무 짧/, 'dir.mp3': /폴더/, 'noaudio.mp4': /소리가 들어 있지 않/, 'missing_file.mp3': /찾을 수 없/ };
        for (const [n, re] of Object.entries(bad)) {
          const keep = SS.state.bgm && SS.state.bgm.id;
          const x = await imp(n);
          check('잘못된 파일 거절: ' + n, !x.ok && /err/.test($('bgmImportMsg').className) && re.test(x.msg) && !x.changed && !/Error invoking|ENOENT|EISDIR/.test(x.msg), x);
          check('거절 뒤 음악·목록 그대로: ' + n, x.added === 0 && (SS.state.bgm && SS.state.bgm.id) === keep, x);
        }
        const list = await window.api.bgmCustomList();
        check('거절된 파일이 목록에 안 남음', !list.some((t) => /garbage|empty|noaudio|notes/.test(t.title)), list.map((t) => t.title));
      });

      // ---------- B) 구간·맞추기·페이드·크기 + 되돌리기 ----------
      await scenario('settings', async () => {
        SS.useBgm(idMp3); await sleep(200);
        SS.resetEditorHistory();
        SS.pushUndo && SS.pushUndo();
        const b0 = JSON.parse(JSON.stringify(SS.state.bgm));
        check('처음 값: 전체 구간·크기 기본', b0.trackStart === 0 && Math.abs(b0.trackEnd - 25) < 0.6 && b0.align === 'start', b0);
        setVal('bgmA', '0:05');
        check('시작 0:05', SS.state.bgm.trackStart === 5 && $('bgmA').value === '0:05', SS.state.bgm);
        setVal('bgmB', '0:02');
        check('끝을 시작보다 앞으로 적어도 전체 구간으로 풀리지 않음(시작+1초)', SS.state.bgm.trackStart === 5 && SS.state.bgm.trackEnd === 6, SS.state.bgm);
        setVal('bgmB', '0:20');
        check('끝 0:20', SS.state.bgm.trackEnd === 20, SS.state.bgm);
        setVal('bgmA', '0:30');
        check('시작을 끝보다 뒤로 적으면 끝-1초', SS.state.bgm.trackStart === 19 && SS.state.bgm.trackEnd === 20, SS.state.bgm);
        setVal('bgmA', 'abc');
        check('알 수 없는 글자는 무시하고 되돌림', SS.state.bgm.trackStart === 19 && $('bgmA').value === '0:19', [SS.state.bgm.trackStart, $('bgmA').value]);
        setVal('bgmA', '0:03.5'); setVal('bgmB', '0:15');
        check('소수점 시간', SS.state.bgm.trackStart === 3.5, SS.state.bgm);
        document.querySelector('#bgmAlign [data-align="end"]').click();
        check('맞추기 끝', SS.state.bgm.align === 'end' && document.querySelector('#bgmAlign [data-align="end"]').classList.contains('on'));
        setVal('bgmFi', '3'); setVal('bgmFo', '4');
        check('페이드 3/4', SS.state.bgm.fadeIn === 3 && SS.state.bgm.fadeOut === 4, SS.state.bgm);
        setVal('bgmFi', '-5'); setVal('bgmFo', '999');
        check('페이드 범위 안으로 (0~30)', SS.state.bgm.fadeIn === 0 && SS.state.bgm.fadeOut === 30 && $('bgmFi').value === '0' && $('bgmFo').value === '30', [SS.state.bgm.fadeIn, SS.state.bgm.fadeOut, $('bgmFi').value, $('bgmFo').value]);
        setVal('bgmFi', ''); check('페이드 빈칸 = 0', SS.state.bgm.fadeIn === 0, SS.state.bgm.fadeIn);
        setVal('bgmFi', '1'); setVal('bgmFo', '2');
        setVal('bgmVol', '100', 'input'); fire($('bgmVol'), 'change');
        check('크기 100%', SS.state.bgm.volume === 1 && $('bgmVolLbl').textContent === '100%', SS.state.bgm.volume);
        setVal('bgmVol', '0', 'input'); fire($('bgmVol'), 'change');
        check('크기 0%', SS.state.bgm.volume === 0 && $('bgmVolLbl').textContent === '0%', SS.state.bgm.volume);
        setVal('bgmVol', '35', 'input'); fire($('bgmVol'), 'change');
        const snapNow = JSON.stringify(SS.state.bgm);
        let steps = 0; while (steps < 40) { const before = JSON.stringify(SS.state.bgm); SS.undo(); steps++; if (JSON.stringify(SS.state.bgm) === before) break; }
        check('되돌리기를 끝까지 하면 처음 값(전체 구간·크기 기본)', SS.state.bgm && SS.state.bgm.trackStart === 0 && SS.state.bgm.align === 'start' && SS.state.bgm.volume === b0.volume, SS.state.bgm);
        await sleep(120);
        check('되돌린 뒤 패널 값도 따라옴', $('bgmA').value === '0:00' && $('bgmVolLbl').textContent === Math.round(b0.volume * 100) + '%', [$('bgmA').value, $('bgmVolLbl').textContent]);
        for (let i = 0; i < steps + 2; i++) SS.redo();
        check('다시하기로 마지막 값', JSON.stringify(SS.state.bgm) === snapNow, [SS.state.bgm, snapNow]);
        const keep = { v: SS.state.bgm.volume, a: SS.state.bgm.align, f: SS.state.bgm.fadeIn };
        SS.useBgm(idM4a); await sleep(120);
        check('음악 바꾸면 설정 유지·구간은 새 곡 전체', SS.state.bgm.id === idM4a && SS.state.bgm.volume === keep.v && SS.state.bgm.align === keep.a && SS.state.bgm.fadeIn === keep.f && SS.state.bgm.trackStart === 0 && Math.abs(SS.state.bgm.trackEnd - 12) < 0.6, SS.state.bgm);
        SS.undo(); await sleep(80);
        check('바꾼 음악 되돌리기', SS.state.bgm.id === idMp3, SS.state.bgm.id);
        SS.redo(); await sleep(80);
        $('btnBgmRemove').click(); await sleep(80);
        check('음악 빼기', SS.state.bgm === null && $('bgmOn').hidden && !$('bgmNone').hidden && mix.paused);
        SS.undo(); await sleep(150);
        check('빼기 되돌리기', SS.state.bgm && SS.state.bgm.id === idM4a && !$('bgmOn').hidden, SS.state.bgm);
        SS.bgmUi.openLib(); await sleep(100);
        const wasConfirm = window.confirm; window.confirm = () => true;
        const delBtn = document.querySelector('#bgmList [data-del="' + idM4a + '"]'); delBtn && delBtn.click(); await sleep(150);
        check('쓰는 중인 내 음악은 목록에서 못 뺌', (await window.api.bgmCustomList()).some((t) => t.id === idM4a));
        window.confirm = wasConfirm;
        SS.bgmUi.closeLib();
        check('목록 닫으면 편집 단축키 풀림', SS.state.dialogOpen === false, SS.state.dialogOpen);
      });

      // ---------- C) 미리보기 재생 중 음악 동기화 ----------
      await scenario('playback', async () => {
        SS.useBgm(idMp3); await sleep(150);
        await waitFor(() => SS.bgmDl.local[idMp3], 15000, '음악 준비');
        const planOf = () => SS.bgm.plan(SS.state.bgm, outD());
        const wantNow = () => SS.bgm.trackTimeAt(planOf(), SS.playback.timeInfo().cur);
        SS.state.bgm = SS.bgm.normalize({ ...SS.state.bgm, trackStart: 0, trackEnd: 25, align: 'start', fadeIn: 0, fadeOut: 0, volume: 1 });
        await SS.preview.seek(segs[0].start); SS.preview.play();
        const up = await waitFor(() => !mix.paused && mix.currentTime > 0.3, 8000, '음악 시작');
        check('재생하면 음악도 시작', up && /^ssbgm:/.test(mix.currentSrc), mix.currentSrc);
        await sleep(500);
        check('크기 100% → 소리 크기 1', Math.abs(mix.volume - 1) < 0.02, mix.volume);
        SS.state.bgm.volume = 0; SS.bgmUi.sync(true); await sleep(100);
        check('크기 0% → 소리 크기 0, 끊기지 않음', mix.volume === 0 && !mix.paused, [mix.volume, mix.paused]);
        SS.state.bgm.volume = 0.2;
        SS.preview.pause(); await sleep(150);
        check('일시정지하면 음악도 멈춤', mix.paused);
        const target = segs[Math.min(3, segs.length - 1)].start + 1;
        await SS.preview.seek(target); SS.preview.play();
        await waitFor(() => !mix.paused && mix.currentTime > 0.2, 8000, '이동 뒤 음악');
        await sleep(600);
        let w = wantNow();
        check('이동 뒤 재생 때 음악 위치가 영상과 맞음(0.5초 이내)', w != null && Math.abs(mix.currentTime - w) < 0.5, [mix.currentTime, w]);
        const t2 = segs[Math.min(5, segs.length - 1)].start + 0.5;
        await SS.preview.seek(t2); await sleep(700);
        w = wantNow();
        check('재생 중 이동해도 음악이 따라옴(0.5초 이내)', !mix.paused && w != null && Math.abs(mix.currentTime - w) < 0.5, [mix.currentTime, w, mix.paused]);
        setVal('bgmA', '0:03'); await sleep(300);
        w = wantNow();
        check('재생 중 시작 구간을 바꾸면 바로 반영', !mix.paused && w != null && Math.abs(mix.currentTime - w) < 0.6, [mix.currentTime, w]);
        SS.preview.pause(); await sleep(100);
        SS.useBgm(idWav); await sleep(150);
        await waitFor(() => SS.bgmDl.local[idWav], 15000, 'wav 준비');
        SS.state.bgm = SS.bgm.normalize({ ...SS.state.bgm, align: 'start', fadeIn: 0.5, fadeOut: 0.5, volume: 0.5 });
        await SS.preview.seek(segs[0].start); SS.preview.play();
        await waitFor(() => !mix.paused, 6000, '짧은 음악 시작');
        await sleep(3800);
        check('짧은 음악은 끝난 뒤 멈춤(영상은 계속)', mix.paused && !SS.preview.paused, [mix.paused, SS.preview.paused, mix.currentTime]);
        SS.preview.pause();
        document.querySelector('#bgmAlign [data-align="end"]').click(); await sleep(100);
        const pe = SS.bgm.plan(SS.state.bgm, outD());
        check('끝 맞추기: 늦게 시작(delay = 영상길이-곡길이)', Math.abs(pe.delay - (outD() - pe.length)) < 0.01 && pe.delay > 1, pe);
        check('영상보다 짧다는 안내 문구', /영상보다 짧아/.test($('bgmLen').textContent), $('bgmLen').textContent);
        await SS.preview.seek(segs[0].start); SS.preview.play(); await sleep(900);
        check('끝 맞추기: 시작 직후엔 음악이 아직 안 나옴', mix.paused, mix.currentTime);
        SS.preview.pause();
        SS.useBgm(idLong); await sleep(150);
        check('영상보다 길다는 안내', /영상\(.*\)보다 길어/.test($('bgmLen').textContent), $('bgmLen').textContent);
        const endT = segs[segs.length - 1].end - 0.3;
        await SS.preview.seek(endT); SS.preview.play(); await sleep(1500);
        SS.preview.pause();
        check('영상 끝까지 가도 오류 없음', true);
      });

      // ---------- D) 프로젝트 저장 → 다시 열기 ----------
      await scenario('project', async () => {
        SS.useBgm(idHash); await sleep(150);
        SS.state.bgm = SS.bgm.normalize({ ...SS.state.bgm, trackStart: 2, trackEnd: 12, align: 'end', fadeIn: 1.5, fadeOut: 2.5, volume: 0.4 });
        const want = JSON.stringify(SS.state.bgm);
        const pf = dir + '/qa_proj.sshorts';
        await SS.saveProjectTo(pf);
        const saved = await window.api.readJson(pf);
        check('프로젝트 파일에 음악 설정 저장', saved.bgm && saved.bgm.id === idHash && saved.bgm.volume === 0.4, saved.bgm);
        SS.state.bgm = null; SS.bgmUi.render();
        await SS.openProjectFrom(pf); await sleep(300);
        check('다시 열면 같은 음악·설정', JSON.stringify(SS.state.bgm) === want, [SS.state.bgm, want]);
        SS.showBgmTab(); await sleep(150);
        check('다시 열면 패널에 내 음악 이름 표시', !$('bgmOn').hidden && /내 찬양 #3/.test($('bgmTitle').textContent) && $('bgmVolLbl').textContent === '40%', [$('bgmTitle').textContent, $('bgmVolLbl').textContent]);
        SS.state.bgm = null; await SS.saveProjectTo(dir + '/qa_proj_nobgm.sshorts');
        SS.useBgm(idMp3); await sleep(100);
        await SS.openProjectFrom(dir + '/qa_proj_nobgm.sshorts'); await sleep(300);
        check('음악 없는 프로젝트를 열면 패널이 비어 있음', SS.state.bgm == null && !$('bgmNone').hidden && $('bgmOn').hidden, SS.state.bgm);
        const ghost = 'custom-f-ghost0000001';
        SS.state.bgm = SS.bgm.normalize({ id: ghost, trackStart: 0, trackEnd: 20, duration: 20 });
        await SS.saveProjectTo(dir + '/qa_proj_ghost.sshorts');
        SS.state.bgm = null; await sleep(100);
        await SS.openProjectFrom(dir + '/qa_proj_ghost.sshorts'); await sleep(600);
        SS.showBgmTab(); await sleep(200);
        const lost = $('bgmLost');
        check('사라진 내 음악: 패널에 안내 문구', lost && !lost.hidden && /찾을 수 없습니다/.test(lost.textContent), lost && lost.textContent);
        const rl = await SS.doExport(dir + '/exp_lost.mp4', [2, 10]);
        check('사라진 음악 내보내기는 한국어 안내로 실패', !rl.success && /찾을 수 없|다시 넣어/.test(rl.error) && !/Error invoking/.test(rl.error), rl.error);
        const idxPath = root + '/bgm/custom/index.json';
        let idx = {}; try { idx = await window.api.readJson(idxPath); } catch (_) { idx = {}; }
        const fakeId = 'custom-f-nofile000001';
        idx[fakeId] = { kind: 'file', title: '파일 사라진 곡', artist: '내 파일', file: root + '/bgm/custom/f-nofile000001.mp3', source: 'x', durationSec: 20, addedAt: Date.now() + 1 };
        await window.api.writeText(idxPath, JSON.stringify(idx, null, 2)); madeIds.push(fakeId);
        SS.state.bgm = null; SS.bgmUi.render();
        SS.bgmImport.custom.set(fakeId, await window.api.bgmTrack(fakeId));
        SS.useBgm(fakeId); await sleep(700);
        const dl = $('bgmDl');
        check('파일만 없어진 내 음악: 받기 실패 안내가 "다시 넣어 주세요"', !dl.hidden && /다시 넣어/.test(dl.textContent) && !/인터넷/.test(dl.textContent), dl.textContent);
        const rf = await SS.doExport(dir + '/exp_nofile.mp4', [2, 10]);
        check('파일 없는 음악 내보내기 오류 한국어', !rf.success && /없어졌|다시 넣어/.test(rf.error) && !/Error invoking/.test(rf.error), rf.error);
        await window.api.bgmCustomRemove(fakeId);
        SS.state.bgm = null; SS.bgmUi.render();
      });

      // ---------- E) 내보내기 ----------
      const R = [2, 14];
      const rangeDur = (() => { const ws = SS.state.words.filter((w) => w.start >= R[0] && w.end <= R[1]); const sg = SS.edl.buildSegments(ws, SS.state.settings, SS.state.overrides, SS.state.source.duration); return SS.edl.segmentsDuration(sg); })();
      report.notes.rangeDur = rangeDur;
      const exp = async (name, bgm) => {
        SS.state.bgm = bgm ? SS.bgm.normalize(bgm) : null; SS.bgmUi.render();
        const t0 = Date.now();
        const r = await SS.doExport(dir + '/' + name + '.mp4', R);
        report.notes['exp_' + name] = { ok: r.success, sec: Math.round((Date.now() - t0) / 100) / 10, err: r.error && r.error.slice(0, 200) };
        check('내보내기 성공: ' + name, r.success, r.error);
        return r;
      };
      await scenario('export', async () => {
        const trk = (id) => { const t = SS.bgmImport.custom.get(id); return { id, duration: t.durationSec }; };
        await exp('none', null);
        await exp('music_vol100_fade', { ...trk(idMp3), trackStart: 0, trackEnd: 25, align: 'start', fadeIn: 3, fadeOut: 3, volume: 1 });
        await exp('music_vol0', { ...trk(idMp3), trackStart: 0, trackEnd: 25, align: 'start', fadeIn: 0, fadeOut: 0, volume: 0 });
        await exp('music_short_end', { ...trk(idWav), trackStart: 0, trackEnd: 3, align: 'end', fadeIn: 0, fadeOut: 0, volume: 1 });
        await exp('music_long_from20', { ...trk(idLong), trackStart: 20, trackEnd: 60, align: 'start', fadeIn: 0, fadeOut: 0, volume: 1 });
        SS.state.bgm = null;
        const p1 = SS.doExport(dir + '/dbl1.mp4', R); const p2 = SS.doExport(dir + '/dbl2.mp4', R);
        const [a, b] = await Promise.all([p1, p2]);
        check('내보내는 중 또 내보내기는 막히고 안내', a.success && !b.success && /진행 중/.test(b.error), [a.success, b.error]);
        const c = await SS.doExport(dir + '/dbl3.mp4', R);
        check('끝난 뒤 다시 내보내기 가능', c.success, c.error);
        const bad = await SS.doExport(dir + '/notmp4.avi', R);
        check('mp4 아닌 경로는 한국어 오류', !bad.success && /MP4/.test(bad.error), bad.error);
        const bad2 = await SS.doExport(dir + '/nope_dir/x/y.mp4', R);
        report.notes.badDirResult = { success: bad2.success, error: bad2.error && bad2.error.slice(0, 200) };
        check('없는 폴더로 내보내면 실패 + 오류 문구가 짧음', !bad2.success && String(bad2.error).length < 600, bad2.error && bad2.error.slice(0, 300));
      });

      // ---------- F) 내보내기 재생 창 ----------
      await scenario('player', async () => {
        SS.state.bgm = null;
        const out = dir + '/music_vol100_fade.mp4';
        const wordsBefore = JSON.stringify(SS.state.words.map((w) => w.del));
        SS.showExportPlayer(out, { duration: rangeDur, srtPath: dir + '/music_vol100_fade.srt' });
        const pv = $('expVideo');
        await waitFor(() => pv.currentTime > 0.5 && !pv.paused, 8000, '재생 창 재생');
        check('재생 창 열림·재생', !$('expPlayer').hidden && pv.videoWidth === 1080 && SS.state.dialogOpen === true, [pv.videoWidth, SS.state.dialogOpen]);
        const ph0 = SS.preview.currentTime, caret0 = SS.state.caret, pre = SS.preview.paused;
        pv.focus();
        for (const k of ['ArrowRight', 'ArrowLeft', 'Delete', 'Backspace', 'x', 'm']) $('expPlayer').querySelector('.exp-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        key('Delete'); key('ArrowRight'); key(' ');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
        await sleep(200);
        check('창 열린 채 단축키가 편집기에 안 새어 나감', JSON.stringify(SS.state.words.map((w) => w.del)) === wordsBefore && SS.preview.paused === pre && Math.abs(SS.preview.currentTime - ph0) < 0.05 && SS.state.caret === caret0, [SS.preview.currentTime, ph0, SS.preview.paused]);
        pv.currentTime = Math.max(0, (pv.duration || 3) - 0.3); await sleep(900);
        $('expReplay').click(); await sleep(400);
        check('[처음부터 다시] → 처음에서 재생', !pv.paused && pv.currentTime < 1.5, [pv.currentTime, pv.paused]);
        check('[폴더에서 보기] 단추가 경로를 가지고 있음', $('expPlayer').dataset.path === out && typeof window.api.materialsOpenPath === 'function');
        SS.showExportPlayer(dir + '/dbl3.mp4', { duration: rangeDur, srtPath: dir + '/dbl3.srt' });
        await waitFor(() => pv.currentTime > 0.3 && !pv.paused, 8000, '두 번째 재생');
        check('열린 채 다시 열면 새 영상으로 바뀜', /dbl3/.test($('expTitle').textContent), $('expTitle').textContent);
        $('expPlayer').querySelector('[data-close].primary').click(); await sleep(150);
        check('닫으면 멈추고 편집 단축키가 풀림 (두 번 열어도 잠기지 않음)', $('expPlayer').hidden && pv.paused && SS.state.dialogOpen === false, [$('expPlayer').hidden, SS.state.dialogOpen]);
        key(' '); await sleep(300); const playedAfter = !SS.preview.paused; SS.preview.pause();
        check('닫은 뒤 편집기 Space 재생 가능', playedAfter, playedAfter);
        for (const how of ['backdrop', 'x', 'esc']) {
          SS.showExportPlayer(out, { duration: rangeDur }); await sleep(250);
          if (how === 'backdrop') $('expPlayer').dispatchEvent(new MouseEvent('click', { bubbles: true }));
          else if (how === 'x') $('expPlayer').querySelector('.exp-head [data-close]').click();
          else $('expPlayer').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(150);
          check('재생 창 닫기: ' + how, $('expPlayer').hidden && SS.state.dialogOpen === false, SS.state.dialogOpen);
        }
        SS.showExportPlayer(dir + '/없는 영상 #1.mp4', { duration: 3 }); await sleep(900);
        check('없는 영상은 안내 문구', /재생하지 못했습니다/.test($('expInfo').textContent), $('expInfo').textContent);
        SS.closeExportPlayer(); await sleep(100);
        SS.state.dialogOpen = true; SS.showExportPlayer(out, {}); await sleep(200); SS.closeExportPlayer(); await sleep(100);
        check('다른 창이 이미 열려 있던 상태는 그대로 돌아감', SS.state.dialogOpen === true); SS.state.dialogOpen = false;
        await shot('player_done');
      });

      // ---------- G) 교인 자료 스튜디오 (AI 호출 없음) ----------
      await scenario('materials', async () => {
        const T = SS._materialsTest;
        await SS.openMaterials(); await sleep(300);
        check('교인 자료 열림·편집 단축키 잠김', !$('mnStudio').hidden && SS.state.dialogOpen === true);
        key(' '); await sleep(100);
        check('열려 있는 동안 Space 가 영상을 재생하지 않음', SS.preview.paused);
        const st = T.store();
        const meta = { church: '구세군 대구사랑영문', title: '하나님 중심의 기도 <b>&"#', verse: '마태복음 6:9-13', speaker: '김택근 사관', date: '2026년 10월 25일' };
        const sample = {
          summary: { title: '아멘으로 드리는 응답 <img src=x onerror="window.__xss=1">', verse: '마태복음 6:9-13', theme: '주기도문의 아멘은 "진실로 그렇게 살겠습니다"라는 결단입니다.', points: [{ heading: '아멘의 뜻', body: '아멘은 진실로 그러합니다라는 고백입니다.' }, { heading: '믿음과 결단', body: '아멘 안에는 믿음과 결단이 담겨 있습니다.' }], application: ['오늘 한 가지 결단하기'], prayer: '주님, 아멘으로 살게 하소서.' },
          quiz: { title: '퀴즈', items: [{ type: 'ox', q: '아멘은 진실로 그러하다는 뜻이다.', answer: 'O', explain: '설교' }, { type: 'mc', q: '주기도문은 어느 복음서에?', choices: ['마가', '마태', '요한', '사도행전'], answer: 2, explain: '마태복음 6장' }] },
        };
        for (const [k, v] of Object.entries(sample)) st.results[k] = { data: SS.materials.normalize(k, v), options: st.options, meta, made: new Date().toISOString(), provider: 'test' };
        T.show('results'); await sleep(400);
        const doc = document.querySelector('#mnStage .doc');
        check('결과 화면에 문서', !!doc && /아멘/.test(doc.textContent), doc && doc.textContent.slice(0, 60));
        check('글 안의 태그가 실행되지 않음 (XSS 없음)', window.__xss === undefined && !(doc && doc.querySelector('img[onerror]')), window.__xss);
        const body = SS.materialsDoc.cleanForExport(doc);
        check('내보내기용 본문에도 스크립트 속성 없음', !/<img[^>]*onerror/i.test(body), body.slice(0, 120));
        const pdf = dir + '/qa_summary.pdf', png = dir + '/qa_card.png';
        await window.api.materialsRenderTest({ kind: 'pdf', body, css: SS.materialsDoc.DOC_CSS, file: pdf });
        const pdfBytes = new Uint8Array(await (await fetch(SS.toFileUrl(pdf))).arrayBuffer());
        check('PDF 만들어짐 (%PDF, 1KB 이상)', pdfBytes.length > 1000 && String.fromCharCode(...pdfBytes.slice(0, 4)) === '%PDF', pdfBytes.length);
        const card = document.querySelector('#mnStage .mcard');
        if (card) {
          await window.api.materialsRenderTest({ kind: 'png', body: SS.materialsDoc.cleanForExport(card), css: SS.materialsDoc.DOC_CSS, width: 1080, height: 1350, file: png });
          const im = new Image(); im.src = SS.toFileUrl(png) + '?t=' + Date.now(); await im.decode().catch(() => {});
          check('카드 PNG 1080x1350', im.naturalWidth === 1080 && im.naturalHeight === 1350, [im.naturalWidth, im.naturalHeight]);
        } else report.notes.noCard = '이 자료 종류에는 카드가 없음';
        const tabs = document.querySelectorAll('#mnTabs button, #mnTabs [data-type]'); report.notes.tabCount = tabs.length;
        for (const t of tabs) { t.click(); await sleep(150); }
        await shot('materials_results');
        SS.closeMaterials(); await sleep(150);
        check('닫으면 단축키 풀림', $('mnStudio').hidden && SS.state.dialogOpen === false, SS.state.dialogOpen);
        await SS.openMaterials(); await sleep(250);
        check('다시 열면 결과가 남아 있음', Object.keys(T.store().results).length >= 2);
        $('mnStudio').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(200);
        report.notes.escClosesMaterials = $('mnStudio').hidden;
        if (!$('mnStudio').hidden) SS.closeMaterials();
        await sleep(100);
        const snap = SS.project.snapshot(SS.state, 0);
        check('프로젝트에 교인 자료 포함', snap.materials && snap.materials.results && snap.materials.results.summary, Object.keys(snap.materials || {}));
        for (const k of Object.keys(sample)) delete st.results[k];
      });

      // ---------- H) 유튜브 링크 (네트워크 1번) ----------
      await scenario('youtube', async () => {
        SS.bgmUi.openLib(); await sleep(100);
        $('bgmYtUrl').value = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
        const t0 = Date.now();
        await SS.bgmImport.youtube();
        report.notes.ytSec = (Date.now() - t0) / 1000;
        const id = SS.state.bgm && SS.state.bgm.id;
        if (id && /^custom-yt-/.test(id)) madeIds.push(id);
        check('유튜브 링크로 음악 넣기', /^custom-yt-/.test(id || ''), $('bgmImportMsg').textContent);
        SS.bgmUi.closeLib();
        SS.bgmUi.openLib(); await sleep(60);
        $('bgmYtUrl').value = 'https://example.com/x'; await SS.bgmImport.youtube();
        check('유튜브 아닌 주소 안내', /유튜브 주소/.test($('bgmImportMsg').textContent) && /err/.test($('bgmImportMsg').className), $('bgmImportMsg').textContent);
        $('bgmYtUrl').value = ''; await SS.bgmImport.youtube();
        check('빈 링크 안내', /붙여 넣어/.test($('bgmImportMsg').textContent), $('bgmImportMsg').textContent);
        SS.bgmUi.closeLib();
      });

      // ---------- 정리 ----------
      SS.state.bgm = null; SS.bgmUi.render(); SS.preview.pause();
      for (const id of madeIds) { try { await window.api.bgmCustomRemove(id); SS.bgmImport.custom.delete(id); } catch (_) { /* */ } }
      const left = await window.api.bgmCustomList();
      check('시험 음악 정리 (남은 시험 음악 없음)', !left.some((x) => madeIds.includes(x.id)), left.map((x) => x.id));
      check('콘솔 오류 0 (window.onerror / unhandledrejection)', errors.length === 0, errors.slice(0, 6));
      report.errors = errors;
    } catch (err) { report.fails.push('예외: ' + String(err && err.stack || err)); }
    report.success = report.fails.length === 0;
    try { SS.preview.pause(); SS.closeExportPlayer && SS.closeExportPlayer(); } catch (_) { /* */ }
    if (dir) await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.fails.join('\n').slice(0, 3000));
  });
})();
