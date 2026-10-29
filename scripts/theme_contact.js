const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const themeLib = require(path.join(root, 'src/shared/theme'));
const renderMod = require(path.join(root, 'src/main/render'));
const tools = require(path.join(root, 'src/main/tools'));

async function run() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  await win.loadFile(path.join(root, 'src/renderer/index.html'));
  
  const themesDir = path.join(root, 'assets/themes');
  const themeFiles = fs.readdirSync(themesDir).filter(f => f.endsWith('.json'));
  const themes = themeFiles.map(f => themeLib.normalizeTheme(JSON.parse(fs.readFileSync(path.join(themesDir, f), 'utf8'))));

  const testVideo = path.join(root, 'cache/test_261016.mp4');
  const tempDir = path.join(root, 'cache/contact_temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const results = [];

  for (const theme of themes) {
    console.log(`Rendering theme: ${theme.id}`);
    const themeDir = path.join(tempDir, theme.id);
    if (!fs.existsSync(themeDir)) fs.mkdirSync(themeDir, { recursive: true });

    const params = {
      title: "세상이 교인에게 바라는 것",
      verse: "행 5:27-32",
      speaker: "홍길동 목사",
      churchName: "우리 교회",
      subtitleText: "우리가 세상 속에서 증인으로 살아가는",
      theme: theme
    };

    // Render PNGs in browser
    const data = await win.webContents.executeJavaScript(`
      (async () => {
        const theme = ${JSON.stringify(theme)};
        const params = ${JSON.stringify(params)};
        params.theme = theme;
        
        await SS.loadLogoFromPath(theme.logo.path);
        await SS.ensureFonts(theme);
        
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1920;
        const ctx = canvas.getContext('2d');
        
        // top.png
        SS.drawTemplate(ctx, ['top'], params);
        const topData = canvas.toDataURL('image/png');
        
        // footer.png
        ctx.clearRect(0,0,1080,1920);
        SS.drawTemplate(ctx, ['footer'], params);
        const footerData = canvas.toDataURL('image/png');
        
        // line_0.png
        ctx.clearRect(0,0,1080,1920);
        SS.drawTemplate(ctx, ['subtitle'], params);
        const lineData = canvas.toDataURL('image/png');
        
        // empty.png
        ctx.clearRect(0,0,1080,1920);
        const emptyData = canvas.toDataURL('image/png');

        return { topData, footerData, lineData, emptyData };
      })()
    `);
    
    fs.writeFileSync(path.join(themeDir, 'top.png'), data.topData.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync(path.join(themeDir, 'footer.png'), data.footerData.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync(path.join(themeDir, 'line_0.png'), data.lineData.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync(path.join(themeDir, 'empty.png'), data.emptyData.replace(/^data:image\/png;base64,/, ''), 'base64');

    const exportParams = {
      sourcePath: testVideo,
      outPath: path.join(themeDir, 'out.mp4'),
      segments: [{ start: 1416, end: 1419 }],
      lines: [{ outStart: 0, outEnd: 3, text: params.subtitleText }],
      crop: { scale: 1.0, x: 0.5, y: 0.5 },
      fadeMs: 10,
      tempDir: themeDir,
      theme: theme
    };

    const { args } = renderMod.buildExportArgs(exportParams);
    const fastArgs = args.map(a => a === 'h264_nvenc' ? 'libx264' : a);
    const cqIdx = fastArgs.indexOf('-cq');
    if (cqIdx >= 0) { fastArgs[cqIdx] = '-crf'; fastArgs[cqIdx+1] = '23'; }
    const presetIdx = fastArgs.indexOf('-preset');
    if (presetIdx >= 0) fastArgs[presetIdx+1] = 'ultrafast';
    
    await new Promise((resolve) => {
      spawn(tools.ffmpeg, fastArgs).on('close', resolve);
    });

    const framePath = path.join(root, `cache/frame_${theme.id}.png`);
    await new Promise((resolve) => {
      spawn(tools.ffmpeg, ['-y', '-ss', '1.5', '-i', path.join(themeDir, 'out.mp4'), '-vframes', '1', framePath]).on('close', resolve);
    });
    results.push({ id: theme.id, path: framePath });
  }

  const contactPath = path.join(root, 'cache/themes_contact.png');
  const tileArgs = ['-y'];
  results.forEach(r => tileArgs.push('-i', r.path));
  let filter = '';
  results.forEach((r, i) => { filter += `[${i}:v]scale=270:480[v${i}]; `; });
  filter += `[v0][v1][v2][v3][v4][v5]xstack=inputs=6:layout=0_0|270_0|540_0|0_480|270_480|540_480[out]`;
  tileArgs.push('-filter_complex', filter, '-map', '[out]', '-update', '1', contactPath);
  await new Promise((resolve) => {
    spawn(tools.ffmpeg, tileArgs).on('close', resolve);
  });

  console.log(`Contact sheet created: ${contactPath}`);
  app.quit();
}

app.whenReady().then(run);
