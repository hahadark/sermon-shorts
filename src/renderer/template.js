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
    const elements = ['title', 'verse', 'subtitle', 'churchName', 'speaker'];
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
        const face = new FontFace(name, `url("${dataUrl}")`);
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
    }
    await document.fonts.ready;
    // Extra wait for the browser to actually make fonts available for canvas
    await new Promise(function(r) { setTimeout(r, 100); });
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

  function drawText(ctx, el, text, theme) {
    if (!text || !el.show) return;
    ctx.save();

    const font = el.font || theme.fallbackFont || 'sans-serif';
    const weight = el.weight || 400;
    ctx.font = `${weight} ${el.size}px "${font}", "${theme.fallbackFont}", sans-serif`;
    ctx.fillStyle = el.color || '#FFFFFF';
    ctx.textAlign = el.align || 'center';
    ctx.textBaseline = 'middle';

    const x = el.x;
    const y = el.y;
    const maxW = el.width || 1080;

    if (el.letterSpacing) {
      const spacing = el.size * el.letterSpacing;
      let totalW = 0;
      for (let i = 0; i < text.length; i++) {
        totalW += ctx.measureText(text[i]).width + spacing;
      }
      totalW -= spacing;

      let startX = x;
      if (ctx.textAlign === 'center') startX = x - totalW / 2;
      else if (ctx.textAlign === 'right') startX = x - totalW;

      ctx.textAlign = 'left';
      let curX = startX;
      for (let i = 0; i < text.length; i++) {
        const charW = ctx.measureText(text[i]).width;
        const charCenter = curX + charW / 2;
        if (el.shadow) {
          ctx.shadowColor = el.shadow.color || '#000000';
          ctx.shadowBlur = el.shadow.blur || 0;
          ctx.shadowOffsetX = el.shadow.offsetX || 0;
          ctx.shadowOffsetY = el.shadow.offsetY || 0;
        }
        if (el.stroke > 0) {
          ctx.strokeStyle = el.strokeColor || el.color;
          ctx.lineWidth = el.stroke * 2;
          ctx.lineJoin = 'round';
          ctx.strokeText(text[i], charCenter, y);
        }
        ctx.fillText(text[i], charCenter, y);
        curX += charW + spacing;
      }
    } else {
      const lines = String(text).split('\n');
      const fullText = lines.join(' ');
      let metrics = ctx.measureText(fullText);
      if (metrics.width > maxW) {
        const scale = maxW / metrics.width;
        ctx.translate(x, y);
        ctx.scale(scale, 1);
        if (el.stroke > 0) ctx.strokeText(fullText, 0, 0);
        ctx.fillText(fullText, 0, 0);
      } else {
        ctx.translate(x, y);
        if (el.stroke > 0) ctx.strokeText(fullText, 0, 0);
        ctx.fillText(fullText, 0, 0);
      }
    }

    ctx.restore();
  }

  function drawTemplate(ctx, layers, params) {
    const { title, verse, speaker, subtitleText, theme, churchName } = params;
    const t = theme || (SS.theme ? SS.theme.normalizeTheme(null) : {});
    const cw = 1080;
    const ch = 1920;

    if (layers.includes('all') || layers.includes('background')) {
      ctx.fillStyle = t.canvas.background || '#000000';
      ctx.fillRect(0, 0, cw, ch);
    }

    // Video decorations (Overlay layer)
    if (layers.includes('all') || layers.includes('top')) {
      const v = t.video;
      if (v.show && v.radius > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, cw, ch);
        // Rounded rect hole
        const r = v.radius;
        ctx.moveTo(v.x + r, v.y);
        ctx.arcTo(v.x + v.width, v.y, v.x + v.width, v.y + v.height, r);
        ctx.arcTo(v.x + v.width, v.y + v.height, v.x, v.y + v.height, r);
        ctx.arcTo(v.x, v.y + v.height, v.x, v.y, r);
        ctx.arcTo(v.x, v.y, v.x + v.width, v.y, r);
        ctx.closePath();
        ctx.fillStyle = t.canvas.background || '#000000';
        ctx.fill('evenodd');
        ctx.restore();
      }
      if (v.show && v.border) {
        ctx.save();
        ctx.strokeStyle = v.border.color || '#FFFFFF';
        ctx.lineWidth = v.border.width || 1;
        if (v.radius > 0) {
          const r = v.radius;
          ctx.beginPath();
          ctx.moveTo(v.x + r, v.y);
          ctx.arcTo(v.x + v.width, v.y, v.x + v.width, v.y + v.height, r);
          ctx.arcTo(v.x + v.width, v.y + v.height, v.x, v.y + v.height, r);
          ctx.arcTo(v.x, v.y + v.height, v.x, v.y, r);
          ctx.arcTo(v.x, v.y, v.x + v.width, v.y, r);
          ctx.closePath();
          ctx.stroke();
        } else {
          ctx.strokeRect(v.x, v.y, v.width, v.height);
        }
        ctx.restore();
      }
      if (v.show && v.fade) {
        const f = v.fade;
        let grad;
        if (f.edge === 'bottom') grad = ctx.createLinearGradient(0, v.y + v.height - f.length, 0, v.y + v.height);
        else if (f.edge === 'top') grad = ctx.createLinearGradient(0, v.y + f.length, 0, v.y);
        if (grad) {
          grad.addColorStop(0, (f.toColor || t.canvas.background) + '00');
          grad.addColorStop(1, f.toColor || t.canvas.background);
          ctx.fillStyle = grad;
          if (f.edge === 'bottom') ctx.fillRect(v.x, v.y + v.height - f.length, v.width, f.length);
          else if (f.edge === 'top') ctx.fillRect(v.x, v.y, v.width, f.length);
        }
      }
    }

    if (layers.includes('all') || layers.includes('top')) {
      // 띠(배경)는 글자보다 먼저 그린다. 나중에 그리면 제목을 아래로 옮길 때 띠가 제목을 덮는다.
      if (verse && t.verse.band) {
        ctx.save();
        ctx.fillStyle = t.verse.band.color || '#000000';
        const py = t.verse.band.paddingY || 10;
        ctx.fillRect(0, t.verse.y - t.verse.size/2 - py, cw, t.verse.size + py*2);
        ctx.restore();
      }
      if (title) drawText(ctx, t.title, title, t);
      if (verse) drawText(ctx, t.verse, verse, t);
    }

    if (layers.includes('all') || layers.includes('subtitle')) {
      if (subtitleText && t.subtitle.show) {
        if (t.subtitle.box) {
          ctx.save();
          ctx.font = `${t.subtitle.weight || 700} ${t.subtitle.size}px "${t.subtitle.font}", sans-serif`;
          const metrics = ctx.measureText(subtitleText);
          const pad = t.subtitle.box.padding || 10;
          const bw = Math.min(t.subtitle.width, metrics.width + pad * 2);
          const bh = t.subtitle.size + pad * 2;
          ctx.fillStyle = t.subtitle.box.color || '#000000AA';
          const bx = t.subtitle.align === 'left' ? t.subtitle.x : (t.subtitle.align === 'right' ? t.subtitle.x - bw : t.subtitle.x - bw/2);
          const by = t.subtitle.y - bh/2;
          if (t.subtitle.box.radius) {
            const r = t.subtitle.box.radius;
            ctx.beginPath();
            ctx.moveTo(bx + r, by);
            ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
            ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
            ctx.arcTo(bx, by + bh, bx, by, r);
            ctx.arcTo(bx, by, bx + bw, by, r);
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.fillRect(bx, by, bw, bh);
          }
          ctx.restore();
        }
        drawText(ctx, t.subtitle, subtitleText, t);
      }
    }

    if (layers.includes('all') || layers.includes('footer')) {
      ctx.save();
      const church = churchName || t.churchName.text || '';
      const spkText = t.speaker.format ? t.speaker.format.replace('{church}', church).replace('{speaker}', speaker || t.speaker.text || '') : (speaker || t.speaker.text || '');

      const hasLogo = t.logo.show && logoImg && logoImg.complete && logoImg.naturalHeight > 0;
      console.log(`hasLogo: ${hasLogo}, show: ${t.logo.show}, logoImg: ${!!logoImg}, complete: ${logoImg ? logoImg.complete : 'n/a'}, natH: ${logoImg ? logoImg.naturalHeight : 'n/a'}`);
      const hasChurch = t.churchName.show && church;
      const hasSpeaker = t.speaker.show && spkText;

      // Special case: if align is center and multiple items, we group them
      if (t.churchName.align === 'center' && t.speaker.align === 'center' && hasLogo) {
         // Group logic
         const boxHeight = t.logo.height;
         const ratio = logoImg.naturalWidth / logoImg.naturalHeight;
         const crestW = boxHeight * ratio;
         console.log(`Logo: ${logoImg.src}, W: ${logoImg.naturalWidth}, H: ${logoImg.naturalHeight}, Ratio: ${ratio}, crestW: ${crestW}`);

         ctx.font = `${t.churchName.size}px "${t.churchName.font}", sans-serif`;
         const spacing = t.churchName.size * (t.churchName.letterSpacing || 0);
         let churchW = 0;
         for (let i = 0; i < church.length; i++) {
           churchW += ctx.measureText(church[i]).width + spacing;
         }
         churchW -= spacing;

         ctx.font = `${t.speaker.weight || 700} ${t.speaker.size}px "${t.speaker.font}", sans-serif`;
         const speakerW = ctx.measureText(spkText).width;
         const textBlockW = Math.max(churchW, speakerW);
         const gap = 30;
         const totalW = crestW + gap + textBlockW;

         // Use t.logo.x as the center of the group, or cw/2 if it's 540
         const groupCenterX = t.logo.x;
         const startX = groupCenterX - totalW / 2;
         const fy = t.logo.y;

         ctx.drawImage(logoImg, startX, fy, crestW, boxHeight);
         const textCenterX = startX + crestW + gap + textBlockW/2;

         if (hasChurch) {
           const el = Object.assign({}, t.churchName, { x: textCenterX, y: fy + t.churchName.size/2 + 5 });
           drawText(ctx, el, church, t);
         }
         if (hasSpeaker) {
           const el = Object.assign({}, t.speaker, { x: textCenterX, y: fy + boxHeight - t.speaker.size/2 });
           drawText(ctx, el, spkText, t);
         }
      } else {
        if (hasLogo) {
          const ratio = logoImg.naturalWidth / logoImg.naturalHeight;
          const w = t.logo.height * ratio;
          ctx.drawImage(logoImg, t.logo.x - w/2, t.logo.y, w, t.logo.height);
        }
        if (hasChurch) drawText(ctx, t.churchName, church, t);
        if (hasSpeaker) drawText(ctx, t.speaker, spkText, t);
      }
      ctx.restore();
    }
  }

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

    let subtitleText = '';
    if (SS.preview && SS.state.words && SS.state.source && SS.state.settings) {
      const curT = SS.preview.currentTime;
      // 편집할 때마다 바뀌므로 매번 다시 계산한다 (2천 단어 기준 1ms 이하)
      SS._cachedLines = SS.edl.buildLines(SS.state.words, SS.edl.buildSegments(SS.state.words, SS.state.settings, SS.state.overrides, SS.state.source.duration), SS.state.settings);
      // 자막 줄 시각은 '편집 결과' 기준이므로 현재 원본(파일) 시각을 변환해서 찾는다
      const segsNow = SS.edl.buildSegments(SS.state.words, SS.state.settings, SS.state.overrides, SS.state.source.duration);
      const outT = SS.edl.srcToOut(segsNow, curT);
      const line = outT == null ? null : SS._cachedLines.find(l => outT >= l.outStart && outT < l.outEnd);
      if (line) subtitleText = line.text;
    }

    const meta = SS.state.meta || {};
    const params = {
      title: meta.title || '',
      verse: meta.verse || '',
      speaker: meta.speaker || (SS.appSettings && (SS.appSettings.defaultSpeaker || (SS.appSettings.speakers || [])[0])) || '',
      subtitleText: subtitleText,
      theme: theme,
      churchName: (SS.appSettings && SS.appSettings.template && SS.appSettings.template.churchName) || ''
    };

    // 미리보기: 캠버스는 <video> 위에 겹쳐 있다. 배경을 칠한 뒤 영상 자리를 뚫어야 아래 영상이 보인다.
    ctx.clearRect(0, 0, 1080, 1920);
    SS.drawTemplate(ctx, ['background'], params);
    const vb = theme.video || {};
    if (vb.show !== false && vb.width > 0 && vb.height > 0) {
      ctx.clearRect(vb.x || 0, vb.y || 0, vb.width, vb.height);
      // <video> 상자도 테마의 영상 영역에 맞춘다 (내보내기와 같은 위치·크기)
      const box = document.getElementById('tplVideoBox');
      if (box) { box.style.left = (vb.x || 0) + 'px'; box.style.top = (vb.y || 0) + 'px'; box.style.width = vb.width + 'px'; box.style.height = vb.height + 'px'; box.style.display = ''; }
    } else {
      const box = document.getElementById('tplVideoBox');
      if (box) box.style.display = 'none';
    }
    if (SS.applyCrop) SS.applyCrop();
    SS.drawTemplate(ctx, ['top', 'footer', 'subtitle'], params);
  };

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
