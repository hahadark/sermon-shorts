/*
 * 테스트 훅: SS_TEST_SCRIPT=preview-edit
 * 미리보기 직접 편집(preview-edit.js)을 실제 Electron 화면에서 검증한다. 외부 AI·STT 호출 없음.
 *   - 인공 자막(synthetic) + 기존 영상 하나. 사용자 설정·테마 파일은 건드리지 않는다.
 *   - PointerEvent/KeyboardEvent 를 오버레이에 직접 보내 드래그·클릭·Esc 를 실제 핸들러로 통과시킨다.
 * 실행: $env:SS_TEST_SCRIPT='preview-edit'; $env:SS_SCREENSHOT="$PWD\cache\preview_edit\final.png"
 *       node node_modules\electron\cli.js . --open "$PWD\cache\guide_src\guide_sample.mp4"
 * 결과: cache/preview_edit/report.json, 화면 *.png, 내보낸 out.mp4
 */
(function () {
  'use strict';
  const SS = window.SS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.addEventListener('ss:run-test-script', async (ev) => {
    if (ev.detail !== 'preview-edit') return;
    const report = { startedAt: new Date().toISOString(), checks: [] };
    const check = (name, ok, extra) => { report.checks.push({ name, ok: !!ok, extra }); if (!ok) throw new Error('FAIL ' + name + ' ' + JSON.stringify(extra || '')); };
    const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1.5 : tol);
    let dir = null;
    try {
      const launch = await window.api.getLaunchInfo();
      dir = (launch.cache || launch.root + '/cache') + '/preview_edit';
      await window.api.mkdir(dir);
      const t0 = Date.now();
      while (!(SS.state && SS.state.source && SS.preview && SS.preview.loaded)) { if (Date.now() - t0 > 60000) throw new Error('영상이 열리지 않았습니다'); await sleep(200); }
      SS.preview.pause();
      const PE = SS.previewEdit;
      check('API 와 단추', !!PE && !!document.getElementById('btnPreviewEdit') && !!document.getElementById('peOverlay'));
      const overlay = document.getElementById('peOverlay');
      const panel = document.getElementById('pePanel');
      const st = SS.state;
      const shot = async (n) => { await SS.testShot(dir + '/' + n + '.png'); };
      const settle = async () => { await sleep(150); await SS.updateTemplatePreview(); await sleep(250); };

      // ---- 인공 자막·메타 ----
      const spans = [[0, .7], [.9, 1.6], [1.7, 2.2], [2.3, 2.8], [3, 3.5]];
      st.words = spans.map(([a, b], id) => ({ id, text: ['하나님의', '은혜가', '충분합니다.', '믿음으로', '살아갑니다.'][id], sttText: ['하나님의', '은혜가', '충분합니다.', '믿음으로', '살아갑니다.'][id], start: .3 + a, end: .3 + b, del: false, br: id === 2 }));
      st.settings = { padBefore: 0, padAfter: 0, fadeMs: 10, maxLineChars: 14, splitLongWords: true };
      st.overrides = {}; st.caret = 0; st.selection = null; st.crop = { scale: 1, x: .5, y: .5 };
      st.meta = { title: '합성 시험 제목', verse: '마태복음 6:13', speaker: '홍길동 목사' };
      document.getElementById('inpTitle').value = st.meta.title; document.getElementById('inpVerse').value = st.meta.verse;
      document.getElementById('selSpeaker').value = '직접 입력'; document.getElementById('inpSpeaker').value = st.meta.speaker;
      SS.syncCaptionUI(); SS.resetEditorHistory();
      await SS.preview.seek(.5);

      // ---- 0) 기본 테마 객체 보존: 목록의 실제 테마를 그대로 활성화하고 수정해도 원본은 불변 ----
      const themes = await window.api.listThemes();
      const real = themes.find((t) => t.id === 'daegu-sarang') || themes[0];
      const realJson = JSON.stringify(real);
      st.activeTheme = real;
      await settle();
      SS.resetEditorHistory(); SS.pushUndo();
      PE.setActive(true); await settle();
      const rx = real.title.x;
      PE.moveTo('title', rx + 40, real.title.y + 30); await settle();
      check('기본 테마 객체는 그대로(복제 후 수정)', JSON.stringify(real) === realJson && st.activeTheme !== real && st.activeTheme.title.x === rx + 40, { id: real.id });
      SS.undo(); await settle();
      check('복제 수정도 실행 취소됨', st.activeTheme.title.x === rx, st.activeTheme.title.x);

      // ---- 시험용 테마: 교회·로고 표시, 이름표 끔 ----
      st.activeTheme = SS.theme.normalizeTheme({ id: 'pe-synthetic', name: '직접 편집 시험', canvas: { background: '#142838' }, churchName: { show: true, text: '우리 교회' }, logo: { show: true }, title: { size: 70 }, subtitle: { y: 1400 } });
      SS.resetEditorHistory(); SS.pushUndo();
      await settle();
      const orig = JSON.parse(JSON.stringify(st.activeTheme));
      const hitKeys = PE.hits().map((h) => h.key).sort();
      for (const k of ['title', 'verse', 'subtitle', 'churchName', 'speaker', 'logo', 'video']) check('hit 목록에 ' + k, hitKeys.includes(k), hitKeys);
      check('끈 개체(badge)는 hit 없음', !hitKeys.includes('badge'));
      await shot('1_edit_mode');

      // ---- 포인터 도우미 ----
      const fire = (type, x, y, o) => {
        const r = overlay.getBoundingClientRect();
        overlay.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + x * r.width / 1080, clientY: r.top + y * r.height / 1920 }, o || {})));
      };
      const hit = (k) => PE.hits().find((h) => h.key === k);
      const center = (k) => { const h = hit(k); return { x: (h.x0 + h.x1) / 2, y: (h.y0 + h.y1) / 2 }; };
      const dragBy = async (k, dx, dy, o) => {
        const c = center(k);
        fire('pointerdown', c.x, c.y);
        for (let i = 1; i <= 5; i++) { fire('pointermove', c.x + dx * i / 5, c.y + dy * i / 5, o); await sleep(30); }
        fire('pointerup', c.x + dx, c.y + dy);
        await settle();
      };
      const click = async (x, y) => { fire('pointerdown', x, y); fire('pointerup', x, y); await sleep(200); };

      // ---- 1) 제목 드래그 ----
      const hTitle0 = hit('title');
      await dragBy('title', -100, 80);
      const T1 = JSON.parse(JSON.stringify(st.activeTheme));
      check('제목 드래그 좌표', near(T1.title.x, orig.title.x - 100) && near(T1.title.y, orig.title.y + 80), { x: T1.title.x, y: T1.title.y });
      check('드래그 후 선택됨', PE.selected === 'title');
      check('hit 영역이 따라 움직임', near(hit('title').x0, hTitle0.x0 - 100, 3) && near(hit('title').y0, hTitle0.y0 + 80, 3));
      const box = document.querySelector('#peOverlay .pe-box');
      check('선택 테두리 표시', box && box.style.display !== 'none' && near(parseFloat(box.style.left), hit('title').x0, 1.5));
      await shot('2_title_dragged');

      // ---- 2) 제목 색·글꼴 크기, 자막 크기·색 (속성 칸) ----
      const setInput = async (sel, v, evs) => { const i = panel.querySelector(sel); i.value = v; for (const e of (evs || ['input', 'change'])) i.dispatchEvent(new Event(e, { bubbles: true })); await settle(); };
      check('속성 칸 표시', !panel.hidden && !panel.querySelector('.pe-row-size').hidden && !panel.querySelector('.pe-row-color').hidden);
      await setInput('.pe-hex', '#FF3366', ['change']);
      check('제목 색', st.activeTheme.title.color.toLowerCase() === '#ff3366', st.activeTheme.title.color);
      await setInput('.pe-size', '90');
      check('제목 크기', st.activeTheme.title.size === 90, st.activeTheme.title.size);
      const T2 = JSON.parse(JSON.stringify(st.activeTheme));
      // 캔버스에 실제로 그 색이 그려졌나
      const cvs = document.getElementById('tplCanvas'), cctx = cvs.getContext('2d');
      const countColor = (c2, r, rgb) => {
        const x0 = Math.max(0, Math.floor(r.x0)), y0 = Math.max(0, Math.floor(r.y0)), w = Math.max(1, Math.min(1080 - x0, Math.ceil(r.x1 - r.x0))), h = Math.max(1, Math.min(1920 - y0, Math.ceil(r.y1 - r.y0)));
        const d = c2.getImageData(x0, y0, w, h).data; let n = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) < 6 && Math.abs(d[i + 1] - rgb[1]) < 6 && Math.abs(d[i + 2] - rgb[2]) < 6 && d[i + 3] > 240) n++;
        return n;
      };
      check('미리보기에 새 제목 색 픽셀', countColor(cctx, hit('title'), [255, 51, 102]) > 200, countColor(cctx, hit('title'), [255, 51, 102]));
      const c = center('subtitle'); await click(c.x, c.y);
      check('자막 선택', PE.selected === 'subtitle');
      await setInput('.pe-size-range', '84');
      await setInput('.pe-color', '#22cc88');
      check('자막 크기·색', st.activeTheme.subtitle.size === 84 && st.activeTheme.subtitle.color.toLowerCase() === '#22cc88', { s: st.activeTheme.subtitle.size, c: st.activeTheme.subtitle.color });
      const fonts = await window.api.listFonts();
      const otherFont = fonts.map((f) => f.family).find((f) => f !== st.activeTheme.subtitle.font);
      if (otherFont) { await setInput('.pe-font', otherFont, ['change']); check('자막 글꼴', st.activeTheme.subtitle.font === otherFont, st.activeTheme.subtitle.font); }
      await dragBy('subtitle', 0, -150);
      const T3 = JSON.parse(JSON.stringify(st.activeTheme));
      check('자막 드래그(수직)', near(T3.subtitle.y, T2.subtitle.y - 150), T3.subtitle.y);
      await shot('3_props_changed');

      // ---- 3) 로고/교회 이름(묶음)·영상 ----
      const rc = (k) => { const h = hit(k); return { x0: h.x0, y0: h.y0, x1: h.x1, y1: h.y1 }; };
      const rb = { church: rc('churchName'), speaker: rc('speaker'), logo: rc('logo') };
      check('묶음 배치로 시작', !st.activeTheme.logo.free);
      await dragBy('churchName', 60, -40);
      const ra = { church: rc('churchName'), speaker: rc('speaker'), logo: rc('logo') };
      check('교회 이름만 움직임(묶음 해제)', st.activeTheme.logo.free === true && near(ra.church.x0, rb.church.x0 + 60, 4) && near(ra.church.y0, rb.church.y0 - 40, 4), { rb: rb.church, ra: ra.church });
      check('설교자·로고는 그 자리 그대로(굳히기 후 같은 모습)', near(ra.speaker.x0, rb.speaker.x0, 4) && near(ra.speaker.y0, rb.speaker.y0, 4) && near(ra.logo.x0, rb.logo.x0, 4) && near(ra.logo.y0, rb.logo.y0, 4), { rb: rb.speaker, ra: ra.speaker, lb: rb.logo, la: ra.logo });
      await dragBy('logo', -30, 20);
      const rl = rc('logo');
      check('로고만 따로 이동', near(rl.x0, ra.logo.x0 - 30, 4) && near(rl.y0, ra.logo.y0 + 20, 4) && near(rc('churchName').x0, ra.church.x0, 4) && near(rc('speaker').y0, ra.speaker.y0, 4));
      await dragBy('speaker', 0, 30);
      check('설교자만 따로 이동', near(rc('speaker').y0, ra.speaker.y0 + 30, 4) && near(rc('churchName').y0, ra.church.y0, 4));
      await shot('3b_footer_independent');
      const vy0 = st.activeTheme.video.y;
      await dragBy('video', 0, 40);
      check('영상 드래그', near(st.activeTheme.video.y, vy0 + 40) && document.getElementById('tplVideoBox').style.top === st.activeTheme.video.y + 'px', { y: st.activeTheme.video.y, top: document.getElementById('tplVideoBox').style.top });
      const T4 = JSON.parse(JSON.stringify(st.activeTheme));

      // ---- 4) 선택 해제: 빈 곳 클릭, Esc ----
      await click(15, 1550);
      check('빈 곳 클릭으로 선택 해제', PE.selected === null);
      const c2 = center('verse'); await click(c2.x, c2.y);
      check('구절 선택', PE.selected === 'verse');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      check('Esc 로 선택 해제(모드는 유지)', PE.selected === null && PE.active);
      // 화살표 이동
      await click(c2.x, c2.y);
      const vx = st.activeTheme.verse.x;
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
      await sleep(900); await settle();
      check('화살표 Shift 10px', near(st.activeTheme.verse.x, vx + 10, .5), st.activeTheme.verse.x);
      PE.select(null);

      // ---- 5) 영상 자르기(crop) 드래그와 충돌 없음 ----
      const vc = center('video');
      const rect = overlay.getBoundingClientRect();
      const px = rect.left + vc.x * rect.width / 1080, py = rect.top + vc.y * rect.height / 1920;
      const mouseDrag = (target) => {
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: px, clientY: py, button: 0 }));
        window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: px - 60, clientY: py - 30 }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: px - 60, clientY: py - 30 }));
      };
      const topEl = document.elementFromPoint(px, py);
      check('편집 모드에서는 오버레이가 영상 위를 덮음', topEl && topEl.id === 'peOverlay', topEl && (topEl.id || topEl.tagName));
      st.crop = { scale: 1.5, x: .5, y: .5 };
      mouseDrag(topEl);
      check('편집 모드: crop 변하지 않음', st.crop.x === .5 && st.crop.y === .5, st.crop);
      PE.setActive(false); await settle();
      const topOff = document.elementFromPoint(px, py);
      check('편집 끄면 영상이 직접 받음(crop 가능)', topOff && topOff.id !== 'peOverlay', topOff && (topOff.id || topOff.tagName));
      mouseDrag(topOff);
      check('편집 끄면 crop 드래그 동작', st.crop.x !== .5 || st.crop.y !== .5, st.crop);
      st.crop = { scale: 1, x: .5, y: .5 }; SS.applyCrop();
      PE.setActive(true); await settle();

      // ---- 6) 실행 취소·다시 실행 (공유 Undo) ----
      const pick = (t) => ({ tx: t.title.x, ty: t.title.y, tc: t.title.color.toLowerCase(), ts: t.title.size, ss: t.subtitle.size, sc: t.subtitle.color.toLowerCase(), sy: t.subtitle.y, lx: t.logo.x, ly: t.logo.y, lf: !!t.logo.free, vy: t.video.y, vx: t.verse.x });
      const finalPick = pick(st.activeTheme);
      const seen = [finalPick];
      let still = 0;
      for (let i = 0; i < 40 && still < 4; i++) { const before = JSON.stringify(pick(st.activeTheme)); SS.undo(); await sleep(120); const after = JSON.stringify(pick(st.activeTheme)); if (after === before) still++; else { still = 0; seen.push(pick(st.activeTheme)); } }
      const o = pick(orig);
      check('실행 취소를 반복하면 편집 전 값', JSON.stringify(pick(st.activeTheme)) === JSON.stringify(o), { now: pick(st.activeTheme), want: o });
      check('중간 단계가 여러 번에 나뉘어 되돌아감', seen.length >= 7, seen.length);
      check('실행 취소하면 묶음 배치 복귀', st.activeTheme.logo.free !== true);
      await settle(); await shot('4_undo_all');
      still = 0;
      for (let i = 0; i < 40 && still < 4; i++) { const before = JSON.stringify(pick(st.activeTheme)); SS.redo(); await sleep(120); if (JSON.stringify(pick(st.activeTheme)) === before) still++; else still = 0; }
      await settle();
      check('다시 실행하면 최종 값', JSON.stringify(pick(st.activeTheme)) === JSON.stringify(finalPick), { now: pick(st.activeTheme), want: finalPick });
      { const th = hit('title'); check('다시 실행 후 hit 영역이 테마 좌표와 일치', th && near((th.x0 + th.x1) / 2, st.activeTheme.title.x, 3), th); }

      // ---- 7) 잠금·숨김 개체 제외 ----
      PE.edit((t) => { t.speaker.locked = true; t.churchName.hidden = true; t.verse.show = false; }); await settle();
      const k2 = PE.hits().map((h) => h.key);
      check('locked/hidden/show:false 개체는 hit 제외', !k2.includes('speaker') && !k2.includes('churchName') && !k2.includes('verse') && k2.includes('title'), k2);
      check('잠긴 개체 클릭은 선택 안 됨', (await (async () => { PE.select(null); const h = { x: 540, y: 1770 }; await click(h.x, h.y); return PE.selected !== 'speaker'; })()));
      SS.undo(); await settle();
      check('잠금 되돌리면 다시 잡힘', PE.hits().some((h) => h.key === 'speaker'));

      // ---- 8) 프로젝트 저장·복원 ----
      const want = pick(st.activeTheme);
      const snap = JSON.parse(JSON.stringify(SS.project.snapshot(st, SS.preview.currentTime)));
      check('프로젝트 스냅샷에 편집 테마', snap.activeTheme && snap.activeTheme.title.x === want.tx && snap.activeTheme.subtitle.size === 84 && snap.activeTheme.id === 'pe-synthetic');
      const projPath = dir + '/edited.sshorts';
      await SS.saveProjectTo(projPath);
      st.activeTheme = SS.theme.normalizeTheme(null); await settle();
      await SS.openProjectFrom(projPath); await settle();
      check('파일 저장→열기 후 같은 테마', JSON.stringify(pick(st.activeTheme)) === JSON.stringify(want), { got: pick(st.activeTheme), want });
      const onDisk = await window.api.readJson(projPath);
      check('저장 파일에 좌표·크기·색', onDisk.activeTheme.title.y === want.ty && onDisk.activeTheme.subtitle.color.toLowerCase() === '#22cc88');
      await shot('5_after_project_open');

      // ---- 9) 내보내기 반영: exportLayers 와 내보내기용 그리기가 같은 테마를 쓴다 ----
      const exTheme = SS.theme.normalizeTheme(st.activeTheme);
      const layers = SS.theme.exportLayers(exTheme);
      check('exportLayers 가 편집된 테마 기준', layers.mode === 'solid' && layers.mask === false && layers.under === false, layers);
      const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920;
      const cx = cv.getContext('2d');
      await SS.ensureFonts(exTheme);
      SS.drawTemplate(cx, ['top'], { title: st.meta.title, verse: st.meta.verse, speaker: st.meta.speaker, theme: exTheme, churchName: '' });
      const tw = SS.previewEdit.hits().find((h) => h.key === 'title');
      check('내보내기 top 층: 새 위치에 새 색 제목', countColor(cx, { x0: tw.x0, y0: tw.y0, x1: tw.x1, y1: tw.y1 }, [255, 51, 102]) > 200);
      const oldRegion = { x0: orig.title.x - 40, y0: orig.title.y - 40, x1: orig.title.x + 40, y1: orig.title.y + 20 };
      check('내보내기 top 층: 옛 위치에는 제목이 없음', countColor(cx, { x0: 0, y0: 0, x1: 0, y1: 0 }, [0, 0, 0]) >= 0 && countColor(cx, oldRegion, [255, 51, 102]) < 5, countColor(cx, oldRegion, [255, 51, 102]));
      cx.clearRect(0, 0, 1080, 1920);
      SS.drawTemplate(cx, ['subtitle'], { subtitleText: '내보내기 자막', theme: exTheme });
      check('내보내기 subtitle 층: 새 색·크기', countColor(cx, { x0: 0, y0: exTheme.subtitle.y - 60, x1: 1080, y1: exTheme.subtitle.y + 60 }, [34, 204, 136]) > 200);

      // 실제 MP4 내보내기 (편집된 activeTheme 로)
      st.words.forEach((w) => { w.del = false; });
      const out = dir + '/out.mp4';
      const res = await SS.doExport(out);
      check('MP4 내보내기 성공', res && res.success !== false && !res.error, res);
      report.exportedTheme = pick(st.activeTheme);
      report.ok = true;
      await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2));
      await shot('6_final');
      window.api.notifyTestReady({ ok: true, checks: report.checks.length });
    } catch (err) {
      console.error(err);
      report.error = String(err && err.stack || err);
      try { if (dir) { await window.api.writeText(dir + '/report.json', JSON.stringify(report, null, 2)); await SS.testShot(dir + '/error.png'); } } catch (_) { /* */ }
      window.api.notifyTestError(err && err.stack ? err.stack : String(err));
    }
  });
})();
