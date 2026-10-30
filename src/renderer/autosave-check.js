/* SS_TEST_SCRIPT=autosave-a / autosave-b / autosave-c : 자동 저장과 갑자기 꺼진 뒤 불러오기 (같은 SS_USER_DATA_DIR 로 차례로)
 * a: 편집 → 자동 저장·작업본 → app.exit (= 갑자기 꺼짐)
 * b: 켜자마자 "지난 작업을 불러올까요?" → 불러오기 → 메뉴로 과거 작업본 열기 → 편집하고 바로 창 닫기(정상 종료, 닫을 때 저장)
 * c: 정상 종료 뒤엔 묻지 않음 + 닫기 직전 편집이 저장되어 있음 */
(function () {
  'use strict';
  const SS = window.SS;
  window.addEventListener('ss:run-test-script', async (e) => {
    const phase = (/^autosave-([abc])$/.exec(e.detail) || [])[1];
    if (!phase) return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const report = { phase, checks: [] };
    const check = (name, ok, info) => { report.checks.push({ name, ok: !!ok, info: info === undefined ? null : info }); if (!ok) throw new Error(name + ': ' + JSON.stringify(info)); };
    const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('시간 초과: ' + what); await sleep(100); } };
    const kept = () => SS.state.words.filter((w) => !w.del).length;
    const del = (a, b) => { SS.pushUndo(); for (let i = a; i < b; i++) SS.state.words[i].del = true; SS.renderTranscript(); };
    let dir = '', closing = false;
    try {
      const launch = await window.api.getLaunchInfo();
      dir = launch.cache + '/autosave_test'; await window.api.mkdir(dir);
      document.querySelectorAll('.modal-close').forEach((b) => b.click());
      const shot = (n) => SS.testShot(dir + '/' + phase + '_' + n + '.png');
      await waitFor(() => SS.state.words && SS.state.words.length > 60, 20000, '자막');
      const A = phase !== 'a' ? await window.api.readJson(dir + '/a.json') : null;

      if (phase === 'a') {
        await window.api.saveSettings({ sysCheckSeen: true });
        const st = await window.api.autosaveStatus();
        check('처음 실행: 묻지 않음', !st.crashed);
        del(5, 10); const kept1 = kept();
        const w0 = SS.autosave.stats.writes;
        await waitFor(() => SS.autosave.stats.writes > w0, 9000, '편집 뒤 자동 저장');
        check('편집 4초 뒤 자동 저장', true, { writes: SS.autosave.stats.writes });
        const skip = await SS.autosave.saveNow();
        check('바뀐 것 없으면 안 씀', skip === null);
        const same = await SS.autosave.saveNow({ force: true });
        check('같은 내용이면 작업본 또 안 남김', same && !same.versioned, same);
        await sleep(1100);
        del(20, 30); const kept2 = kept();
        const w1 = SS.autosave.stats.writes;
        await waitFor(() => SS.autosave.stats.writes > w1, 9000, '두 번째 자동 저장');
        const rv = await SS.autosave.saveNow({ force: true });
        check('작업본 남김', rv && rv.versioned, rv);
        await waitFor(() => $('asvStatus') && /자동 저장됨/.test($('asvStatus').textContent), 2000, '상단 표시');
        const list = await window.api.autosaveList();
        check('자동 저장 목록', list.length === 1 && list[0].summary.kept === kept2 && list[0].versions.length >= 2, list.map((x) => ({ kept: x.summary && x.summary.kept, v: x.versions.length })));
        report.kept1 = kept1; report.kept2 = kept2; report.full = SS.state.words.length;
        await shot('status');
        await window.api.writeText(dir + '/a.json', JSON.stringify(report));
      }

      if (phase === 'b') {
        check('새로 연 영상은 다 남아 있음', kept() === A.full, kept());
        await waitFor(() => $('asvModal') && !$('asvModal').hidden, 9000, '불러오기 물음');
        check('갑자기 꺼짐 물음', $('asvModal').classList.contains('crash') && /불러올까요/.test($('asvTitle').textContent));
        const first = $('asvList').querySelector('.asv-item');
        check('마지막 저장 요약', new RegExp('남긴 단어 ' + A.kept2 + '/').test(first.textContent), first.textContent);
        await shot('crash_prompt');
        first.querySelector('[data-open="current.sshorts"]').click();
        await waitFor(() => $('asvModal').hidden && kept() === A.kept2, 15000, '불러오기');
        check('불러온 편집 = 꺼지기 전 편집', SS.state.words.slice(20, 30).every((w) => w.del) && SS.state.words.slice(5, 10).every((w) => w.del));
        check('불러온 뒤 편집 단축키 막히지 않음', SS.state.dialogOpen === false);
        // 메뉴: 파일 > 자동 저장본 열기 → 과거 작업본
        document.querySelector('[data-cmd="autosaves"]').click();
        await waitFor(() => !$('asvModal').hidden && $('asvList').querySelector('.asv-item [data-more]'), 5000, '자동 저장본 창');
        check('목록 모드', !$('asvModal').classList.contains('crash') && $('asvTitle').textContent === '자동 저장본');
        const item = $('asvList').querySelector('.asv-item');
        item.querySelector('[data-more]').click();
        const vers = Array.from(item.querySelectorAll('.asv-ver'));
        const old = vers.find((v) => new RegExp('남긴 단어 ' + A.kept1 + '/').test(v.textContent));
        check('과거 작업본 목록에 앞선 상태', !!old, vers.map((v) => v.textContent));
        await shot('versions');
        old.querySelector('[data-open]').click();
        await waitFor(() => $('asvModal').hidden && kept() === A.kept1, 15000, '과거 작업본 열기');
        check('과거 작업본 = 앞선 편집', SS.state.words.slice(5, 10).every((w) => w.del) && !SS.state.words.slice(20, 30).some((w) => w.del));
        // Esc 닫기
        SS.openAutosaves(); await waitFor(() => !$('asvModal').hidden, 3000, '다시 열기');
        document.activeElement && document.activeElement.blur();
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await sleep(150);
        check('Esc 로 닫힘', $('asvModal').hidden && SS.state.dialogOpen === false);
        // 편집하고 기다리지 않고 바로 닫기 → 닫을 때 저장
        del(40, 45); report.kept3 = kept();
        report.success = true;
        await window.api.writeText(dir + '/b.json', JSON.stringify(report, null, 2));
        closing = true;
        window.api.testCloseWindow();
        return;
      }

      if (phase === 'c') {
        const B = await window.api.readJson(dir + '/b.json');
        await sleep(2500);
        check('정상 종료 뒤엔 묻지 않음', $('asvModal') == null || $('asvModal').hidden);
        const st = await window.api.autosaveStatus();
        check('갑자기 꺼짐 아님', !st.crashed, st);
        const list = await window.api.autosaveList();
        check('닫기 직전 편집도 저장됨', list[0] && list[0].summary.kept === B.kept3, { saved: list[0] && list[0].summary, want: B.kept3 });
      }
      report.success = true;
    } catch (err) { report.success = false; report.error = err.stack || String(err); try { await SS.testShot(dir + '/' + phase + '_error.png'); } catch (_) { /* */ } }
    if (closing) return;
    if (dir) await window.api.writeText(dir + '/' + phase + '.json', JSON.stringify(report, null, 2));
    if (report.success) window.api.notifyTestReady({ success: true }); else window.api.notifyTestError(report.error);
  });
})();
