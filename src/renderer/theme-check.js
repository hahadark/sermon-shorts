/*
 * 테스트 훅: SS_TEST_SCRIPT=themes
 * 테마마다 편집 화면 미리보기를 캡처하고 짧은 MP4 를 내보낸다 (cache/theme_check).
 * SS_TEST_URL=테마id,테마id 로 일부만 고를 수 있다. 실행: --open 영상 --transcript 단어.json
 */
(function () {
  'use strict';
  const SS = window.SS;

  // 테스트 훅: SS_TEST_SCRIPT=caption-split — 출력 자막 칸에서 Enter 로 자막 나누기 (단어 사이·단어 가운데·맨 끝·되돌리기)
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'caption-split') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const report = { checks: [] };
    const check = (name, ok, extra) => { report.checks.push({ name, ok: !!ok, extra }); if (!ok) throw new Error(name + ' ' + JSON.stringify(extra || '')); };
    try {
      const launch = await window.api.getLaunchInfo();
      const dir = launch.cache + '/caption_split';
      await window.api.mkdir(dir);
      const t0 = Date.now();
      while (!(SS.state && SS.state.words && SS.state.words.length && document.querySelector('.caption-output'))) { if (Date.now() - t0 > 60000) throw new Error('자막이 열리지 않았습니다'); await sleep(200); }
      SS.preview.pause();
      const body = document.getElementById('transcriptBody');
      const outs = () => Array.from(body.querySelectorAll('.caption-output'));
      const enter = (el, opts) => el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: 'Enter', bubbles: true, cancelable: true }, opts || {})));
      // 1) 단어 사이에서 나누기
      let el = outs().find((x) => / /.test(x.value) && x.value.split(' ').length >= 3);
      check('띄어쓰기 있는 자막', el);
      const before = el.value, n0 = outs().length, idx = +el.dataset.captionEditor;
      const cut = before.indexOf(' ', Math.floor(before.length / 3));
      el.focus(); el.setSelectionRange(cut, cut);
      enter(el);
      await sleep(300);
      let list = outs();
      check('자막이 하나 늘었다', list.length === n0 + 1, { n0, n1: list.length });
      check('앞 자막', list[idx].value === before.slice(0, cut).trim(), { got: list[idx].value, want: before.slice(0, cut).trim() });
      check('뒤 자막', list[idx + 1].value === before.slice(cut).trim(), { got: list[idx + 1].value });
      check('커서가 뒤 자막 맨 앞으로', document.activeElement === list[idx + 1] && list[idx + 1].selectionStart === 0);
      // 2) 단어 가운데에서 나누기
      el = list.find((x) => x.value.split(' ').some((t) => t.length >= 4));
      const v2 = el.value, i2 = +el.dataset.captionEditor, tok = v2.split(' ').find((t) => t.length >= 4), at = v2.indexOf(tok) + 2;
      el.focus(); el.setSelectionRange(at, at); enter(el);
      await sleep(300);
      list = outs();
      check('단어 가운데 앞', list[i2].value === v2.slice(0, at).trim(), { got: list[i2].value, want: v2.slice(0, at) });
      check('단어 가운데 뒤', list[i2 + 1].value === v2.slice(at).trim(), { got: list[i2 + 1].value });
      check('단어에 나눈 자리 기록', SS.state.words.some((w) => Array.isArray(w.captionSplits) && w.captionSplits.length));
      await SS.testShot('cache/caption_split/1_split.png');
      // 3) 맨 끝 Enter: 다음 자막으로
      el = list[i2 + 1]; const n2 = list.length;
      el.focus(); el.setSelectionRange(el.value.length, el.value.length); enter(el);
      await sleep(200);
      check('맨 끝은 다음 칸으로', outs().length === n2 && document.activeElement === outs()[i2 + 2]);
      // 4) 되돌리기 두 번 → 처음 개수
      document.activeElement.blur(); await sleep(100);
      SS.undo(); await sleep(150); SS.undo(); await sleep(250);
      check('되돌리기', outs().length === n0, { n: outs().length, n0 });
      // 5) 내보내는 자막(SRT)도 나뉜 대로
      SS.redo(); await sleep(250);
      const srt = SS.edl.toSRT(SS.getLines());
      check('SRT 에 나뉜 자막', srt.includes('\n' + before.slice(cut).trim() + '\n'));
      await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
      window.api.notifyTestReady({ ok: true, checks: report.checks.length });
    } catch (err) {
      console.error(err);
      try { const l = await window.api.getLaunchInfo(); await window.api.writeText(l.cache + '/caption_split/report.json', JSON.stringify(Object.assign(report, { error: String(err && err.stack || err) }), null, 2)); } catch (_) { /* */ }
      window.api.notifyTestError(err && err.stack ? err.stack : String(err));
    }
  });
  window.addEventListener('ss:run-test-script', async (e) => {
    if (e.detail !== 'themes') return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const report = { startedAt: new Date().toISOString(), themes: [] };
    try {
      const launch = await window.api.getLaunchInfo();
      const dir = (launch.cache || launch.root + '/cache') + '/theme_check';
      await window.api.mkdir(dir);
      const t0wait = Date.now();
      while (!(SS.state && SS.state.source && SS.state.words && SS.state.words.length)) {
        if (Date.now() - t0wait > 60000) throw Error('영상·자막이 열리지 않았습니다');
        await sleep(200);
      }
      const st = SS.state;
      SS.preview.pause();
      const first = st.words.find((w) => w.start >= st.words[0].start + 1.5) || st.words[0];
      const range = [first.start - 0.05, first.start + 8];
      const pick = String(launch.testUrl || '').split(',').map((s) => s.trim()).filter(Boolean);
      const themes = (await window.api.listThemes()).filter((t) => !pick.length || pick.includes(t.id));
      st.meta = { title: '오늘의 말씀 / 하나님 중심의 *기도*', verse: '마태복음 6:13', speaker: '차재수 담임사관' };
      document.getElementById('inpTitle').value = st.meta.title;
      document.getElementById('inpVerse').value = st.meta.verse;
      const at = range[0] + 2.4;
      for (const theme of themes) {
        st.activeTheme = theme;
        st.crop = { scale: 1, x: 0.5, y: 0.5 };
        if (SS.applyCrop) SS.applyCrop();
        await SS.preview.seek(at);
        await SS.updateTemplatePreview();
        await sleep(700);
        const r = document.getElementById('stage').getBoundingClientRect();
        const shot = await window.api.testScreenshot('cache/theme_check/preview_' + theme.id + '.png');
        const out = dir + '/export_' + theme.id + '.mp4';
        const t1 = performance.now();
        const res = await SS.doExport(out, range);
        report.themes.push({
          id: theme.id, name: theme.name, preview: shot,
          stage: { x: r.x, y: r.y, w: r.width, h: r.height, dpr: window.devicePixelRatio },
          export: res.success ? out : null, error: res.success ? null : String(res.error || '').slice(-1500),
          exportSec: +((performance.now() - t1) / 1000).toFixed(1), previewAt: at - range[0]
        });
        console.log('[themes] ' + theme.id + ' ' + (res.success ? 'ok' : 'FAIL') + ' ' + report.themes[report.themes.length - 1].exportSec + 's');
      }
      report.range = range;
      // 테마 편집기: 배경·자막 속성 패널 캡처
      const sel = document.getElementById('selTheme');
      const editId = themes.some((t) => t.id === 'channel-header-blur') ? 'channel-header-blur' : (themes[0] && themes[0].id);
      if (sel && editId && document.getElementById('btnEditTheme')) {
        sel.value = editId; sel.dispatchEvent(new Event('change')); await sleep(500);
        document.getElementById('btnEditTheme').click(); await sleep(1800);
        report.editor = [];
        for (const label of ['배경', '자막', '이름표']) {
          const item = Array.from(document.querySelectorAll('#teElList .te-el-item')).find((x) => x.textContent === label);
          if (!item) continue;
          item.click(); await sleep(700);
          report.editor.push(await window.api.testScreenshot('cache/theme_check/editor_' + label + '.png'));
        }
      }
      await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
      window.api.notifyTestReady({ success: true, themes: report.themes.length });
    } catch (err) {
      console.error(err);
      window.api.notifyTestError(err && err.stack ? err.stack : String(err));
    }
  });
})();
