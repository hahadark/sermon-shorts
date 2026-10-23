const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const tools = require('./tools');
const { spawn } = require('child_process');
const { normalizeTheme } = require('../shared/theme');
const guard = require('./fs-guard');

/** 내보낸 MP4 옆에 쓰는 SRT 경로 (확장자가 .mp4가 아니어도 영상 파일을 덮지 않는다) */
function srtPathOf(outPath) { return String(outPath).replace(/\.mp4$/i, '') + '.srt'; }

function initRender() {
  ipcMain.handle('export:start', async (event, params) => runExport(event, params));
  ipcMain.handle('fs:writeImage', (event, { dataUrl, filename }) => {
    fs.writeFileSync(guard.check(filename), String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64');
    return true;
  });
  ipcMain.handle('dialog:saveProject', async (event, { defaultPath }) => {
    const w = require('electron').BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showSaveDialog(w, { title: '프로젝트 저장', defaultPath: defaultPath || '설교쇼츠.sshorts', filters: [{ name: 'Sermon Shorts Project', extensions: ['sshorts'] }, { name: 'All Files', extensions: ['*'] }] });
    return r.canceled ? null : guard.allowFile(r.filePath);
  });
  ipcMain.handle('dialog:openProject', async (event) => {
    const w = require('electron').BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(w, { title: '프로젝트 열기', properties: ['openFile'], filters: [{ name: 'Sermon Shorts Project', extensions: ['sshorts'] }, { name: 'All Files', extensions: ['*'] }] });
    return r.canceled || r.filePaths.length === 0 ? null : guard.allowFile(r.filePaths[0]);
  });
  ipcMain.handle('fs:writeText', (event, p, text) => { fs.writeFileSync(guard.check(p), String(text), 'utf8'); return true; });
  ipcMain.handle('fs:mkdir', (event, p) => { fs.mkdirSync(guard.check(p), { recursive: true }); return true; });
  ipcMain.handle('dialog:saveExport', async (event, { defaultPath }) => {
    const w = require('electron').BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showSaveDialog(w, { title: '영상 내보내기', defaultPath, filters: [{ name: 'MP4 Video', extensions: ['mp4'] }] });
    if (r.canceled || !r.filePath) return null;
    guard.allowFile(srtPathOf(r.filePath));
    return guard.allowFile(r.filePath);
  });
}

// 영상 인코더: Windows는 NVENC, macOS는 VideoToolbox를 먼저 쓰고 실패하면 libx264
const VIDEO_ENCODERS = {
  nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0'],
  videotoolbox: ['-c:v', 'h264_videotoolbox', '-b:v', '12M', '-allow_sw', '1'],
  x264: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18'],
};
function defaultEncoder(platform = process.platform) { return platform === 'darwin' ? 'videotoolbox' : 'nvenc'; }

function buildExportArgs({ sourcePath, outPath, segments, lines, crop, fadeMs, tempDir, theme, encoder }) {
  if (!segments?.length) throw Error('남은 영상 구간이 없습니다.');
  if (segments.some(s => !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start)) throw Error('영상 구간 시각이 올바르지 않습니다.');
  const t = normalizeTheme(theme);
  if (![t.video.x,t.video.y,t.video.width,t.video.height].every(Number.isFinite) || t.video.width <= 0 || t.video.height <= 0) throw Error('테마 영상 영역이 올바르지 않습니다.');
  fadeMs = Number.isFinite(fadeMs) ? Math.max(0, fadeMs) : 10;
  const startT = Math.max(0, segments[0].start - 1);
  const endT = segments[segments.length - 1].end + 1;
  let concatTxt = '';
  let lastTime = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.outStart > lastTime) {
      concatTxt += `file 'empty.png'\nduration ${(l.outStart - lastTime).toFixed(3)}\n`;
    }
    concatTxt += `file 'line_${i}.png'\nduration ${(l.outEnd - l.outStart).toFixed(3)}\n`;
    lastTime = l.outEnd;
  }
  concatTxt += `file 'empty.png'\nduration 9999\n`;
  fs.writeFileSync(path.join(tempDir, 'lines.txt'), concatTxt, 'utf8');

  const args = ['-y', '-ss', startT.toFixed(3), '-to', endT.toFixed(3), '-i', sourcePath];
  args.push('-loop', '1', '-t', (endT - startT).toFixed(3), '-i', path.join(tempDir, 'top.png'));
  args.push('-loop', '1', '-t', (endT - startT).toFixed(3), '-i', path.join(tempDir, 'footer.png'));
  args.push('-f', 'concat', '-safe', '0', '-i', path.join(tempDir, 'lines.txt'));

  let fg = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i], s = Math.max(0, seg.start - startT).toFixed(3), e = Math.max(0, seg.end - startT).toFixed(3), fade = Math.min(fadeMs / 1000, (seg.end - seg.start) / 2), F = fade.toFixed(3), fadeOutSt = (seg.end - seg.start - fade).toFixed(3);
    fg += `[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]; `;
    fg += `[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS,afade=t=in:d=${F},afade=t=out:st=${fadeOutSt}:d=${F}[a${i}]; `;
  }
  let concatIns = '';
  for (let i = 0; i < segments.length; i++) concatIns += `[v${i}][a${i}]`;
  fg += `${concatIns}concat=n=${segments.length}:v=1:a=1[vcat][acat]; `;

  // Target aspect ratio from theme
  const v = t.video;
  const targetAspect = v.width / v.height;

  const baseW = `min(in_w,in_h*${targetAspect.toFixed(4)})`;
  const cropW = `(${baseW}/${(crop && crop.scale) || 1.0})`;
  const cropH = `(${cropW}/${targetAspect.toFixed(4)})`;
  const cropX = `(in_w*${(crop && crop.x) ?? 0.5}-${cropW}/2)`;
  const cropY = `(in_h*${(crop && crop.y) ?? 0.5}-${cropH}/2)`;
  fg += `[vcat]crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',scale=${v.width}:${v.height}[vcrop]; `;

  const bgColor = (t.canvas.background || '#000000').replace('#', '0x');
  fg += `color=c=${bgColor}:s=1080x1920:d=1[base]; [base][vcrop]overlay=x=${v.x}:y=${v.y}[basev]; `;

  // Fade duration for footer
  const fadeInD = t.fadeInSec ?? 1.0;
  const footerFilter = fadeInD > 0 ? `format=rgba,fade=t=in:st=0:d=${fadeInD}:alpha=1` : "format=rgba";
  fg += `[basev][1:v]overlay=x=0:y=0:shortest=1[ovl1]; [2:v]${footerFilter}[footer]; [ovl1][footer]overlay=x=0:y=0:shortest=1[ovl2]; `;
  fg += `[ovl2][3:v]overlay=x=0:y=0:shortest=1,format=yuv420p[vout]`;
  args.push('-filter_complex', fg, '-map', '[vout]', '-map', '[acat]');
  args.push('-t', segments.reduce((n,s)=>n+s.end-s.start,0).toFixed(6));
  args.push(...(VIDEO_ENCODERS[encoder] || VIDEO_ENCODERS[defaultEncoder()]), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-r', '30', '-movflags', '+faststart', '-progress', 'pipe:1', outPath);
  return { args, filtergraph: fg };
}

async function runExport(event, params) {
  params = { ...params, outPath: guard.check(params.outPath), tempDir: guard.check(params.tempDir) };
  let { args } = buildExportArgs(params);
  const run = (currentArgs) => new Promise((resolve) => {
    let totalDur = params.segments.reduce((sum, s) => sum + (s.end - s.start), 0);
    const p = spawn(tools.ffmpeg, currentArgs, { windowsHide: true });
    p.stdout.on('data', (d) => {
      const m = d.toString().match(/out_time_ms=(\d+)/);
      if (m) event.sender.send('progress', { task: 'export', pct: Math.min(100, Math.max(0, (parseInt(m[1])/1000000 / totalDur) * 100)) });
    });
    let errLog = ''; p.stderr.on('data', d => errLog += d.toString());
    p.on('error', err => resolve({code: -1, error: err.message}));
    p.on('close', code => resolve({ code, error: errLog }));
  });

  let result = await run(args);
  if (result.code !== 0 && !args.includes('libx264')) {
    console.log('하드웨어 인코딩 실패, libx264로 재시도...');
    result = await run(buildExportArgs({ ...params, encoder: 'x264' }).args);
    if (result.code !== 0) console.error('libx264 실패:', result.error);
  } else if (result.code !== 0) {
    console.error('ffmpeg 실패:', result.error);
  }
  return result.code === 0 ? { success: true } : { success: false, error: result.error };
}
module.exports = { initRender, buildExportArgs, srtPathOf, defaultEncoder };