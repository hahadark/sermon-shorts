/*
 * 테스트 훅: SS_TEST_SCRIPT=themes
 * 테마마다 편집 화면 미리보기를 캡처하고 짧은 MP4 를 내보낸다 (cache/theme_check).
 * SS_TEST_URL=테마id,테마id 로 일부만 고를 수 있다. 실행: --open 영상 --transcript 단어.json
 */
(function () {
  'use strict';
  const SS = window.SS;
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
