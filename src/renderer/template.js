(function() {
  'use strict';
  const SS = (window.SS = window.SS || {});

  // Dynamic font loader
  const loadedFonts = new Set();
  let fontMapCache = null;

  async function getFontMap() {
    if (fontMapCache) return fontMapCache;
    const fonts = await window.api.listFonts();
    fontMapCache = {};
    fonts.forEach(f => {
      fontMapCache[f.family] = f.file;
    });
    return fontMapCache;
  }

  async function ensureFonts(theme) {
    const fontMap = await getFontMap();
    const fontsToLoad = [];
    const elements = ['title', 'verse', 'subtitle', 'churchName', 'speaker', 'badge'];
    elements.forEach(key => {
      if (theme[key] && theme[key].show) {
        fontsToLoad.push(theme[key].font);
        if (theme[key].fallbackFont) fontsToLoad.push(theme[key].fallbackFont);
      }
    });
    if (theme.fallbackFont) fontsToLoad.push(theme.fallbackFont);

    const uniqueFonts = [...new Set(fontsToLoad)].filter(f => f && !loadedFonts.has(f));
    const tasks = uniqueFonts.map(async name => {
      let fileName = fontMap[name];
      if (!fileName) return;

      try {
        console.log(`Loading font: ${name} via dataUrl`);
        const dataUrl = await window.api.getFontDataUrl(fileName);
        if (!dataUrl) return;
        // 가변 글꼴(파일 이름에 Variable)은 굵기 범위를 알려 줘야 700·900 이 진짜 굵기로 그려진다
        const face = new FontFace(name, `url("${dataUrl}")`, /variable/i.test(fileName) ? { weight: '100 900' } : {});
        const loaded = await face.load();
        document.fonts.add(loaded);
        loadedFonts.add(name);
        console.log(`Font loaded: ${name}`);
      } catch (e) {
        console.error(`Font ${name} load failed`, e);
      }
    });

    if (uniqueFonts.length > 0) {
      await Promise.all(tasks);
      await document.fonts.ready;
      // 새 글꼴을 불렀을 때만 캔버스가 글꼴을 쓸 수 있게 잠깐 기다린다
      await new Promise(function(r) { setTimeout(r, 100); });
    } else {
      await document.fonts.ready;
    }
  }

  let logoImg = null;
  const logo = new Image();
  logo.onload = () => {
    logoImg = logo;
    SS.updateTemplatePreview && SS.updateTemplatePreview();
  };

  async function loadLogoFromPath(path) {
    return new Promise((resolve) => {
      const onDone = () => {
        logoImg = logo;
        SS.updateTemplatePreview && SS.updateTemplatePreview();
        resolve();
      };
      logo.onload = onDone;
      logo.onerror = onDone;

      if (!path) {
        logo.src = '../../assets/images/logo-default.png';
        return;
      }
      if (/^assets[\\/]/.test(path)) { logo.src = '../../' + path.replace(/\\/g, '/'); return; }
      try {
        if (window.api && window.api.getLogoDataUrl) {
          window.api.getLogoDataUrl(path).then(dataUrl => {
            if (dataUrl) logo.src = dataUrl;
            else logo.src = '../../assets/images/logo-default.png';
          });
          return;
        }
        logo.src = 'file://' + encodeURI(path.replace(/\\/g, '/'));
      } catch (e) {
        console.error('Logo load failed:', e);
        logo.src = '../../assets/images/logo-default.png';
      }
    });
  }

  // ---------------- 글자 그리기 ----------------
  // 여러 줄(\n·자동 줄바꿈), 줄마다 색, *강조*, 단어 강조(가라오케), 상자·띠, 그림자·외곽선을 한 곳에서 처리한다.
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fontOf(el, theme) {
    const font = el.font || theme.fallbackFont || 'sans-serif';
    return `${el.italic ? 'italic ' : ''}${el.weight || 400} ${el.size}px "${font}", "${theme.fallbackFont || 'Noto Sans KR'}", sans-serif`;
  }

  function setSpacing(ctx, el) {
    if ('letterSpacing' in ctx) ctx.letterSpacing = el.letterSpacing ? (el.size * el.letterSpacing) + 'px' : '0px';
  }

  /** 글 → 줄 배치. opts.groups 가 있으면 그 묶음이 단어(가라오케용) */
  function layoutText(ctx, el, text, theme, opts) {
    const fx = SS.textfx;
    ctx.font = fontOf(el, theme);
    setSpacing(ctx, el);
    const maxW = el.width || 1080;
    const maxLines = el.maxLines > 0 ? el.maxLines : 1;
    const gap = ctx.measureText(' ').width;
    const measure = (s) => ctx.measureText(s).width;
    let lines = [];
    if (opts && Array.isArray(opts.groups) && opts.groups.length) {
      const toks = fx.tokenize('', opts.groups.map((g) => fx.transformText(g, el.transform)));
      toks.forEach((t) => { t.k = t.group; });
      lines = el.wrap === false ? [toks] : fx.wrapTokens(toks, measure, maxW, gap, maxLines);
    } else {
      const paras = fx.transformText(String(text), el.transform).split('\n');
      let k = 0;
      paras.forEach((p, pi) => {
        const toks = fx.tokenize(p);
        toks.forEach((t) => { t.k = k++; });
        if (!toks.length) return;
        // 최대 줄 수를 넘는 줄바꿈은 마지막 줄에 붙인다 (그릴 때 좁힘)
        if (lines.length >= maxLines) { lines[lines.length - 1].push(...toks); return; }
        const left = Math.max(1, maxLines - lines.length - (paras.length - pi - 1));
        const wrapped = el.wrap === false || !toks.length ? [toks] : fx.wrapTokens(toks, measure, maxW, gap, left);
        lines.push(...wrapped);
      });
    }
    lines = lines.filter((l) => l.length);
    const out = lines.map((toks) => {
      const widths = toks.map((t) => measure(t.text));
      const w = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, toks.length - 1);
      return { toks, widths, w, scale: w > maxW ? maxW / w : 1 };
    });
    return { lines: out, gap };
  }

  /**
   * 글자 블록 그리기. 그린 영역 { top, bottom } 을 돌려준다.
   * opts: { groups, karaokeIndex, part: 'bg'(띠·상자만) | 'fg'(글자만) }
   */
  function drawText(ctx, el, text, theme, opts) {
    if (text == null || text === '' || !el || !el.show) return null;
    const fx = SS.textfx;
    const doBg = !opts || opts.part !== 'fg', doFg = !opts || opts.part !== 'bg';
    ctx.save();
    const L = layoutText(ctx, el, text, theme, opts);
    if (!L.lines.length) { ctx.restore(); return null; }
    const lineH = el.size * (el.lineGap || 1.2);
    const n = L.lines.length;
    const anchor = el.anchor || 'center';
    const firstY = anchor === 'top' ? el.y : anchor === 'bottom' ? el.y - (n - 1) * lineH : el.y - (n - 1) * lineH / 2;
    const align = el.align || 'center';
    const startX = (ln) => { const w = ln.w * ln.scale; return align === 'left' ? el.x : align === 'right' ? el.x - w : el.x - w / 2; };
    const top = firstY - el.size / 2, bottom = firstY + (n - 1) * lineH + el.size / 2;

    // 띠 (화면 가로 전체)
    if (doBg && el.band) {
      const py = el.band.paddingY != null ? el.band.paddingY : 10;
      ctx.fillStyle = el.band.color || '#000000';
      ctx.fillRect(0, top - py, 1080, bottom - top + py * 2);
    }
    // 상자: block(전체를 하나로) | line(줄마다)
    if (doBg && el.box) {
      const b = el.box;
      const padX = b.padX != null ? b.padX : (b.padding != null ? b.padding : 10);
      const padY = b.padY != null ? b.padY : (b.padding != null ? b.padding : 10);
      ctx.fillStyle = b.color || '#000000AA';
      if (b.mode === 'block') {
        const wMax = Math.max(...L.lines.map((ln) => ln.w * ln.scale));
        const x0 = align === 'left' ? el.x : align === 'right' ? el.x - wMax : el.x - wMax / 2;
        roundRectPath(ctx, x0 - padX, top - padY, wMax + padX * 2, bottom - top + padY * 2, b.radius || 0);
        ctx.fill();
      } else {
        L.lines.forEach((ln, i) => {
          const cy = firstY + i * lineH;
          roundRectPath(ctx, startX(ln) - padX, cy - el.size / 2 - padY, ln.w * ln.scale + padX * 2, el.size + padY * 2, b.radius || 0);
          ctx.fill();
        });
      }
    }

    if (!doFg) { ctx.restore(); return { top, bottom }; }
    ctx.font = fontOf(el, theme);
    setSpacing(ctx, el);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const kIndex = opts && opts.karaokeIndex != null ? opts.karaokeIndex : null;
    const each = (fn) => L.lines.forEach((ln, li) => {
      const cy = firstY + li * lineH;
      ctx.save();
      ctx.translate(startX(ln), cy);
      if (ln.scale !== 1) ctx.scale(ln.scale, 1);
      let x = 0;
      ln.toks.forEach((tok, ti) => { fn(tok, x, li); x += ln.widths[ti] + L.gap; });
      ctx.restore();
    });
    const shadow = el.shadow && (el.shadow.blur || el.shadow.offsetX || el.shadow.offsetY) ? el.shadow : null;
    const setShadow = (on) => {
      ctx.shadowColor = on && shadow ? (shadow.color || '#000000') : 'transparent';
      ctx.shadowBlur = on && shadow ? (shadow.blur || 0) : 0;
      ctx.shadowOffsetX = on && shadow ? (shadow.offsetX || 0) : 0;
      ctx.shadowOffsetY = on && shadow ? (shadow.offsetY || 0) : 0;
    };
    if (el.stroke > 0) {
      setShadow(true);
      ctx.strokeStyle = el.strokeColor || '#000000';
      ctx.lineWidth = el.stroke * 2;
      ctx.lineJoin = 'round';
      each((tok, x) => ctx.strokeText(tok.text, x, 0));
    }
    setShadow(!(el.stroke > 0));
    each((tok, x, li) => {
      if (!tok.parts) {
        ctx.fillStyle = fx.tokenColor(tok, tok.k, el, li, kIndex);
        ctx.fillText(tok.text, x, 0);
        return;
      }
      // '*은혜*를' 처럼 단어 일부만 강조
      let px = x;
      tok.parts.forEach((p) => {
        ctx.fillStyle = fx.tokenColor(p, tok.k, el, li, kIndex);
        ctx.fillText(p.text, px, 0);
        px += ctx.measureText(p.text).width;
      });
    });
    ctx.restore();
    return { top, bottom };
  }

  function drawBadge(ctx, b, vals, theme) {
    if (!b || !b.show) return;
    const text = SS.textfx.fillFormat(b.text, vals);
    if (!text) return;
    ctx.save();
    ctx.font = fontOf(b, theme);
    setSpacing(ctx, b);
    const w = ctx.measureText(text).width, padX = b.padX != null ? b.padX : 20, padY = b.padY != null ? b.padY : 8;
    const bw = w + padX * 2, bh = b.size + padY * 2;
    const align = b.align || 'center';
    const x0 = align === 'left' ? b.x : align === 'right' ? b.x - bw : b.x - bw / 2;
    if (b.bg) { ctx.fillStyle = b.bg; roundRectPath(ctx, x0, b.y - bh / 2, bw, bh, b.radius != null ? b.radius : bh / 2); ctx.fill(); }
    ctx.fillStyle = b.color || '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x0 + padX, b.y);
    ctx.restore();
  }

  /** 배경 칠하기: 단색 / 그라데이션 / 흐린 영상(src 가 있으면 그 화면을 흐리게) */
  function drawBackground(ctx, t, src) {
    const c = t.canvas || {};
    if (c.mode === 'gradient') {
      const g = c.gradient || {};
      const a = ((g.angle != null ? g.angle : 180) - 90) * Math.PI / 180;
      const dx = Math.cos(a) * 960, dy = Math.sin(a) * 960;
      const grad = ctx.createLinearGradient(540 - dx, 960 - dy, 540 + dx, 960 + dy);
      grad.addColorStop(0, g.from || '#1B2A4A');
      grad.addColorStop(1, g.to || '#05070C');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1080, 1920);
      return;
    }
    if (c.mode === 'blur') {
      // 미리보기에서는 뒤의 <video id="videoBg"> 가 보이도록 비워 둔다. 편집기처럼 src 를 주면 흐린 화면을 그린다.
      if (src && (src.videoWidth || src.naturalWidth)) {
        const sw = src.videoWidth || src.naturalWidth, sh = src.videoHeight || src.naturalHeight;
        const s = Math.max(1080 / sw, 1920 / sh), b = c.blur || {};
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 1080, 1920);
        ctx.filter = `blur(${b.amount != null ? b.amount : 30}px) brightness(${1 - (b.dim != null ? b.dim : 0.55)})`;
        ctx.drawImage(src, (1080 - sw * s) / 2, (1920 - sh * s) / 2, sw * s, sh * s);
        ctx.restore();
      } else if (src === 'placeholder') {
        const grad = ctx.createLinearGradient(0, 0, 0, 1920);
        grad.addColorStop(0, '#3A4A66'); grad.addColorStop(1, '#151A24');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 1080, 1920);
      }
      return;
    }
    ctx.fillStyle = c.background || '#000000';
    ctx.fillRect(0, 0, 1080, 1920);
  }

  /**
   * 층(layers): background(배경) · under(영상 밑: 흐림 색 덮기·영상 그림자) · top(제목·구절·이름표·테두리) · subtitle · footer
   * params: { title, verse, speaker, subtitleText, subtitleGroups, karaokeIndex, theme, churchName, blurSource }
   */
  function drawTemplate(ctx, layers, params) {
    const { title, verse, speaker, subtitleText, theme, churchName } = params;
    const t = theme || (SS.theme ? SS.theme.normalizeTheme(null) : {});
    const has = (k) => layers.includes('all') || layers.includes(k);
    const v = t.video || {};
    const church = churchName || (t.churchName && t.churchName.text) || '';
    // 제목의 ' / ' 는 줄바꿈 (입력칸이 한 줄이므로)
    const titleText = String(title || '').replace(/\s+\/\s+/g, '\n');
    const vals = { speaker: speaker || (t.speaker && t.speaker.text) || '', church, title: titleText.replace(/\n/g, ' ').replace(/\*/g, ''), verse: verse || '' };

    if (has('background')) drawBackground(ctx, t, params.blurSource);

    if (has('under')) {
      const c = t.canvas || {};
      if (c.mode === 'blur' && c.blur && c.blur.tint) { ctx.fillStyle = c.blur.tint; ctx.fillRect(0, 0, 1080, 1920); }
      if (v.show && v.shadow) {
        ctx.save();
        ctx.shadowColor = v.shadow.color || '#00000099';
        ctx.shadowBlur = v.shadow.blur != null ? v.shadow.blur : 30;
        ctx.shadowOffsetX = v.shadow.offsetX || 0;
        ctx.shadowOffsetY = v.shadow.offsetY != null ? v.shadow.offsetY : 12;
        ctx.fillStyle = '#000000';
        roundRectPath(ctx, v.x, v.y, v.width, v.height, v.radius || 0);
        ctx.fill();
        ctx.restore();
      }
    }

    if (has('top')) {
      if (v.show && v.border) {
        ctx.save();
        ctx.strokeStyle = v.border.color || '#FFFFFF';
        ctx.lineWidth = v.border.width || 1;
        roundRectPath(ctx, v.x, v.y, v.width, v.height, v.radius || 0);
        ctx.stroke();
        ctx.restore();
      }
      if (v.show && v.fade) {
        const f = v.fade;
        let grad;
        if (f.edge === 'bottom') grad = ctx.createLinearGradient(0, v.y + v.height - f.length, 0, v.y + v.height);
        else if (f.edge === 'top') grad = ctx.createLinearGradient(0, v.y + f.length, 0, v.y);
        if (grad) {
          const to = f.toColor || t.canvas.background || '#000000';
          grad.addColorStop(0, to.slice(0, 7) + '00');
          grad.addColorStop(1, to);
          ctx.fillStyle = grad;
          if (f.edge === 'bottom') ctx.fillRect(v.x, v.y + v.height - f.length, v.width, f.length);
          else ctx.fillRect(v.x, v.y, v.width, f.length);
        }
      }
      // 띠·상자를 먼저 모두 그린 뒤 글자를 그린다 (제목을 구절 띠 위로 옮겨도 띠가 제목을 덮지 않게)
      if (titleText) drawText(ctx, t.title, titleText, t, { part: 'bg' });
      if (verse) drawText(ctx, t.verse, verse, t, { part: 'bg' });
      if (titleText) drawText(ctx, t.title, titleText, t, { part: 'fg' });
      if (verse) drawText(ctx, t.verse, verse, t, { part: 'fg' });
      drawBadge(ctx, t.badge, vals, t);
    }

    if (has('subtitle') && subtitleText && t.subtitle && t.subtitle.show) {
      drawText(ctx, t.subtitle, subtitleText, t, { groups: params.subtitleGroups, karaokeIndex: params.karaokeIndex });
    }

    if (has('footer')) {
      ctx.save();
      const spkText = t.speaker.format ? SS.textfx.fillFormat(t.speaker.format, vals) : vals.speaker;
      const hasLogo = t.logo.show && logoImg && logoImg.complete && logoImg.naturalHeight > 0;
      const hasChurch = t.churchName.show && church;
      const hasSpeaker = t.speaker.show && spkText;

      // 로고 + 교회 이름 + 설교자를 한 덩어리로 가운데 정렬
      if (t.churchName.align === 'center' && t.speaker.align === 'center' && hasLogo) {
        const boxHeight = t.logo.height;
        const ratio = logoImg.naturalWidth / logoImg.naturalHeight;
        const crestW = boxHeight * ratio;
        ctx.font = fontOf(t.churchName, t);
        setSpacing(ctx, t.churchName);
        const churchW = hasChurch ? ctx.measureText(church).width : 0;
        ctx.font = fontOf(t.speaker, t);
        setSpacing(ctx, t.speaker);
        const speakerW = hasSpeaker ? ctx.measureText(spkText).width : 0;
        setSpacing(ctx, {});
        // 긴 교회 이름은 요소 너비로 좁혀 그리므로 묶음 너비도 그만큼만. 묶음이 화면 밖으로 나가지 않게 안쪽으로 민다
        const textBlockW = Math.max(Math.min(churchW, t.churchName.width || churchW), Math.min(speakerW, t.speaker.width || speakerW));
        const gap = textBlockW > 0 ? 30 : 0;
        const totalW = crestW + gap + textBlockW;
        const startX = Math.max(30, Math.min(1050 - totalW, t.logo.x - totalW / 2));
        const fy = t.logo.y;
        ctx.drawImage(logoImg, startX, fy, crestW, boxHeight);
        const textCenterX = startX + crestW + gap + textBlockW / 2;
        if (hasChurch) drawText(ctx, Object.assign({}, t.churchName, { x: textCenterX, y: fy + t.churchName.size / 2 + 5, maxLines: 1, wrap: false }), church, t);
        if (hasSpeaker) drawText(ctx, Object.assign({}, t.speaker, { x: textCenterX, y: fy + boxHeight - t.speaker.size / 2, maxLines: 1, wrap: false }), spkText, t);
      } else if (hasLogo && t.logo.inline) {
        // 머리띠형: 로고(왼쪽 위 기준) 오른쪽에 교회 이름·설교자를 왼쪽 정렬로 붙인다 (로고가 넓어도 안 겹침)
        const h = t.logo.height, w = h * (logoImg.naturalWidth / logoImg.naturalHeight);
        ctx.drawImage(logoImg, t.logo.x, t.logo.y, w, h);
        const tx = t.logo.x + w + 18;
        if (hasChurch) drawText(ctx, Object.assign({}, t.churchName, { align: 'left', x: tx, y: hasSpeaker ? t.logo.y + h * 0.3 : t.logo.y + h / 2, maxLines: 1, wrap: false }), church, t);
        if (hasSpeaker) drawText(ctx, Object.assign({}, t.speaker, { align: 'left', x: tx, y: hasChurch ? t.logo.y + h * 0.76 : t.logo.y + h / 2, maxLines: 1, wrap: false }), spkText, t);
      } else {
        if (hasLogo) {
          const ratio = logoImg.naturalWidth / logoImg.naturalHeight;
          const w = t.logo.height * ratio;
          ctx.drawImage(logoImg, t.logo.x - w / 2, t.logo.y, w, t.logo.height);
        }
        if (hasChurch) drawText(ctx, Object.assign({}, t.churchName, { maxLines: 1, wrap: false }), church, t);
        if (hasSpeaker) drawText(ctx, Object.assign({}, t.speaker, { maxLines: 1, wrap: false }), spkText, t);
      }
      ctx.restore();
    }
  }

  /** 영상 상자의 둥근 모서리 마스크 (내보내기용: 흰색=보임) */
  function drawVideoMask(ctx, v) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, v.width, v.height);
    ctx.fillStyle = '#FFFFFF';
    roundRectPath(ctx, 0, 0, v.width, v.height, v.radius || 0);
    ctx.fill();
  }

  /** 테마가 단어 강조(가라오케)를 쓰는지 */
  function usesKaraoke(theme) {
    const k = theme && theme.subtitle && theme.subtitle.karaoke;
    return !!(theme && theme.subtitle && theme.subtitle.show && k && k.mode && k.mode !== 'none');
  }
  SS.usesKaraoke = usesKaraoke;

  /** 줄의 가라오케 장면: 단어마다 원본 시각 → 출력 시각 (잘린 단어는 글자 위치만큼 나눠 계산). 줄 객체별로 기억한다 */
  const karaokeCache = new WeakMap();
  function karaokeOf(line, words, segs) {
    let k = karaokeCache.get(line);
    if (k) return k;
    const ids = new Set((line.parts || []).map((p) => p.id));
    const byId = new Map();
    (words || []).forEach((w) => { if (w && ids.has(w.id)) byId.set(w.id, w); });
    k = SS.textfx.lineKaraoke(line, (u) => {
      const w = byId.get(u.id);
      if (!w || !Number.isFinite(w.start)) return NaN;
      const len = Array.from(String(w.text || '')).length || 1;
      const end = Number.isFinite(w.end) ? w.end : w.start;
      const o = SS.edl.srcToOut(segs, w.start + (end - w.start) * Math.min(1, (u.from || 0) / len));
      return o == null ? NaN : o;
    });
    karaokeCache.set(line, k);
    return k;
  }
  SS.karaokeOf = karaokeOf;
  SS.drawVideoMask = drawVideoMask;
  SS.drawBackground = drawBackground;
  SS.roundRectPath = roundRectPath;

  SS.drawTemplate = drawTemplate;
  SS.loadLogoFromPath = loadLogoFromPath;

  // Video Crop Setup
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let cropStart = { x: 0.5, y: 0.5 };

  SS.initCropUI = function(videoBoxId, videoId, onCropChange) {
    const box = document.getElementById(videoBoxId);
    const vid = document.getElementById(videoId);
    box.style.overflow = 'hidden';
    box.style.position = 'absolute';
    box.style.left = '0';
    box.style.width = '1080px';

    vid.style.position = 'absolute';
    vid.style.transformOrigin = 'center';

    const applyCrop = () => {
      if (!SS.state) return;
      if (!SS.state.crop) SS.state.crop = { scale:1, x:.5, y:.5 };
      const theme = SS.state.activeTheme || (SS.theme ? SS.theme.normalizeTheme(null) : {});
      const v = theme.video;

      box.style.left = v.x + 'px';
      box.style.top = v.y + 'px';
      box.style.width = v.width + 'px';
      box.style.height = v.height + 'px';

      const c = SS.state.crop;
      const source = SS.state.source || {};
      const p = SS.cropGeometry.placement(vid.videoWidth || source.width, vid.videoHeight || source.height, v, c);
      if (!p) return;
      vid.style.width = p.width + 'px'; vid.style.height = p.height + 'px';
      vid.style.left = p.left + 'px'; vid.style.top = p.top + 'px';
      vid.style.objectFit = 'fill'; vid.style.transform = 'none';
    };

    box.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!SS.state.crop) SS.state.crop = { scale: 1, x: 0.5, y: 0.5 };
      const zoomSpeed = 0.05;
      let ns = SS.state.crop.scale - (e.deltaY > 0 ? zoomSpeed : -zoomSpeed);
      SS.state.crop.scale = Math.max(1.0, Math.min(3.0, ns));
      applyCrop();
      onCropChange && onCropChange();
    });

    box.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      if (!SS.state.crop) SS.state.crop = { scale: 1, x: 0.5, y: 0.5 };
      cropStart = { x: SS.state.crop.x, y: SS.state.crop.y };
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = (e.clientX - dragStart.x) / (box.clientWidth * SS.state.crop.scale);
      const dy = (e.clientY - dragStart.y) / (box.clientHeight * SS.state.crop.scale);
      SS.state.crop.x = cropStart.x - dx;
      SS.state.crop.y = cropStart.y - dy;

      // Clamp bounds approximately
      SS.state.crop.x = Math.max(0, Math.min(1, SS.state.crop.x));
      SS.state.crop.y = Math.max(0, Math.min(1, SS.state.crop.y));
      applyCrop();
      onCropChange && onCropChange();
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    SS.applyCrop = applyCrop;
  };

  SS.updateTemplatePreview = async function() {
    if (!SS.state || !SS.drawTemplate) return;

    if (!SS.state.activeTheme && window.api) {
      const themes = await window.api.listThemes();
      const settings = await window.api.getSettings();
      if (!SS.state.activeTheme) SS.state.activeTheme = themes.find(t => t.id === settings.activeThemeId) || themes[0];
    }

    const theme = SS.state.activeTheme || (SS.theme ? SS.theme.normalizeTheme(null) : {});
    await ensureFonts(theme);

    const canvas = document.getElementById('tplCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let subtitleText = '', subtitleGroups = null, karaokeIndex = null;
    if (SS.preview && SS.state.words && SS.state.source && SS.state.settings) {
      const curT = SS.preview.currentTime;
      // 편집할 때마다 바뀌므로 매번 다시 계산한다 (2천 단어 기준 1ms 이하)
      const segsNow = SS.edl.buildSegments(SS.state.words, SS.state.settings, SS.state.overrides, SS.state.source.duration);
      SS._cachedLines = SS.edl.buildLines(SS.state.words, segsNow, SS.state.settings);
      SS._cachedSegs = segsNow;
      // 자막 줄 시각은 '편집 결과' 기준이므로 현재 원본(파일) 시각을 변환해서 찾는다
      const outT = SS.edl.srcToOut(segsNow, curT);
      const line = outT == null ? null : SS._cachedLines.find(l => outT >= l.outStart && outT < l.outEnd);
      if (line) {
        subtitleText = line.text;
        if (usesKaraoke(theme)) {
          const k = karaokeOf(line, SS.state.words, segsNow);
          subtitleGroups = k.groups;
          karaokeIndex = SS.textfx.karaokeIndexAt(k.frames, outT);
        }
      }
    }
    lastKaraokeKey = karaokeIndex == null ? '' : subtitleText + '|' + karaokeIndex;

    const meta = SS.state.meta || {};
    const params = {
      title: meta.title || '',
      verse: meta.verse || '',
      speaker: meta.speaker || (SS.appSettings && (SS.appSettings.defaultSpeaker || (SS.appSettings.speakers || [])[0])) || '',
      subtitleText: subtitleText,
      subtitleGroups: subtitleGroups,
      karaokeIndex: karaokeIndex,
      theme: theme,
      churchName: (SS.appSettings && SS.appSettings.template && SS.appSettings.template.churchName) || ''
    };

    // 미리보기: 캠버스는 <video> 위에 겹쳐 있다. 배경을 칠한 뒤 영상 자리를 뚫어야 아래 영상이 보인다.
    // 흐린 배경(blur)은 뒤의 작은 캠버스(tplBgCanvas)가 영상을 따라 그린다.
    setBlurPreview(theme);
    ctx.clearRect(0, 0, 1080, 1920);
    SS.drawTemplate(ctx, ['background', 'under'], params);
    const vb = theme.video || {};
    if (vb.show !== false && vb.width > 0 && vb.height > 0) {
      ctx.save();
      roundRectPath(ctx, vb.x || 0, vb.y || 0, vb.width, vb.height, vb.radius || 0);
      ctx.clip();
      ctx.clearRect(vb.x || 0, vb.y || 0, vb.width, vb.height);
      ctx.restore();
      // <video> 상자도 테마의 영상 영역에 맞춘다 (내보내기와 같은 위치·크기·둥근 모서리)
      const box = document.getElementById('tplVideoBox');
      if (box) { box.style.left = (vb.x || 0) + 'px'; box.style.top = (vb.y || 0) + 'px'; box.style.width = vb.width + 'px'; box.style.height = vb.height + 'px'; box.style.borderRadius = (vb.radius || 0) + 'px'; box.style.display = ''; }
    } else {
      const box = document.getElementById('tplVideoBox');
      if (box) box.style.display = 'none';
    }
    if (SS.applyCrop) SS.applyCrop();
    SS.drawTemplate(ctx, ['top', 'footer', 'subtitle'], params);
  };

  // ---------------- 흐린 배경 미리보기 ----------------
  // 내보내기(ffmpeg)와 같은 방식: 영상 화면 전체를 1/4 크기로 꽉 채우고 흐리게·어둡게 한 뒤 키운다.
  let blurTheme = null, blurLoop = 0, lastKaraokeKey = '';
  function bgCanvas() {
    let c = document.getElementById('tplBgCanvas');
    if (c) return c;
    const inner = document.getElementById('stageInner');
    if (!inner) return null;
    c = document.createElement('canvas');
    c.id = 'tplBgCanvas'; c.width = 270; c.height = 480;
    c.style.cssText = 'position:absolute;left:0;top:0;width:1080px;height:1920px;pointer-events:none;display:none;';
    inner.insertBefore(c, inner.firstChild);
    return c;
  }
  function paintBlur() {
    const c = bgCanvas(), vid = document.getElementById('video');
    if (!c || !blurTheme) return;
    const g = c.getContext('2d'), b = blurTheme.canvas.blur || {};
    g.save();
    g.fillStyle = '#000000';
    g.fillRect(0, 0, 270, 480);
    if (vid && vid.videoWidth) {
      const s = Math.max(270 / vid.videoWidth, 480 / vid.videoHeight);
      g.filter = `blur(${(b.amount != null ? b.amount : 30) / 4}px) brightness(${1 - (b.dim != null ? b.dim : 0.55)})`;
      g.drawImage(vid, (270 - vid.videoWidth * s) / 2, (480 - vid.videoHeight * s) / 2, vid.videoWidth * s, vid.videoHeight * s);
    }
    g.restore();
  }
  function setBlurPreview(theme) {
    const on = !!(theme && theme.canvas && theme.canvas.mode === 'blur');
    blurTheme = on ? theme : null;
    const c = bgCanvas();
    if (c) c.style.display = on ? '' : 'none';
    if (on) paintBlur();
    if (on && !blurLoop) {
      const tick = () => {
        if (!blurTheme) { blurLoop = 0; return; }
        const vid = document.getElementById('video');
        if (vid && !vid.paused) paintBlur();
        blurLoop = requestAnimationFrame(tick);
      };
      blurLoop = requestAnimationFrame(tick);
    }
  }
  // 재생 중 단어 강조(가라오케)는 timeupdate(초당 4번)보다 자주 바꿔야 하므로 따로 살핀다
  let karaokeBusy = false;
  (function karaokeTick() {
    requestAnimationFrame(karaokeTick);
    const theme = SS.state && SS.state.activeTheme;
    if (karaokeBusy || !theme || !usesKaraoke(theme) || !SS.preview || SS.preview.paused || !SS._cachedLines || !SS._cachedSegs || !SS.state.words) return;
    const segs = SS._cachedSegs;
    const outT = SS.edl.srcToOut(segs, SS.preview.currentTime);
    const line = outT == null ? null : SS._cachedLines.find(l => outT >= l.outStart && outT < l.outEnd);
    if (!line) return;
    const key = line.text + '|' + SS.textfx.karaokeIndexAt(karaokeOf(line, SS.state.words, segs).frames, outT);
    if (key === lastKaraokeKey) return;
    karaokeBusy = true;
    Promise.resolve(SS.updateTemplatePreview()).finally(() => { karaokeBusy = false; });
  })();

  // 설정의 로고 경로 적용 (없으면 기본 logo-default.png)
  let currentLogoPath = null; // null = 아직 한 번도 안 불러옴 (빈 문자열 = 기본 로고)
  async function applyLogoSetting(s) {
    let p = (s && s.template && s.template.logoPath) || '';
    // 예전 기본 로고(sa-crest.png, crest.png)는 새 기본 로고로 보낸다
    if (/^assets[\\/]images[\\/](sa-)?crest\.png$/i.test(p)) p = '';
    if (p === currentLogoPath) return;
    currentLogoPath = p;
    await loadLogoFromPath(p);
  }
  SS.loadLogoFromPath = loadLogoFromPath;
  SS.applyLogoSetting = applyLogoSetting;
  SS.ensureFonts = ensureFonts;
  (async () => {
    try { if (window.api && window.api.getSettings) await applyLogoSetting(await window.api.getSettings()); }
    catch (e) { console.error(e); }
  })();

  if (window.api && window.api.onSettingsChanged) {
    window.api.onSettingsChanged(async (newSettings) => {
      SS.appSettings = newSettings;
      await applyLogoSetting(newSettings);
      SS.updateTemplatePreview && SS.updateTemplatePreview();
    });
  }
})();
