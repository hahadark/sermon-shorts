const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const tools = require('./tools');
const { spawn } = require('child_process');
const { normalizeTheme, exportLayers } = require('../shared/theme');
const guard = require('./fs-guard');
const bgmLib = require('../shared/bgm');

/** 내보낸 MP4 옆에 쓰는 SRT 경로 (확장자가 .mp4가 아니어도 영상 파일을 덮지 않는다) */
function srtPathOf(outPath) { return String(outPath).replace(/\.mp4$/i, '') + '.srt'; }

function initRender() {
  ipcMain.handle('export:start', async (event, params) => runExport(event, params));
  // 말 사이 공백 없애기: 실제 소리에서 무음 구간 찾기
  ipcMain.handle('audio:silences', (_e, file, opts) => require('./silence').detectSilences(file, opts || {}));
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

/**
 * 흐린 배경 필터: 화면 전체를 꽉 채운 뒤 1/4 크기에서 상자 흐림 2번(가우스 흐림과 비슷)을 하고 키운다.
 * amount 는 미리보기의 CSS blur(px)와 같은 느낌이 나도록 표준편차를 맞춘다. dim(0~0.95)만큼 어둡게.
 */
function blurBackgroundFilter(blur) {
  const b = blur || {};
  const amount = Number.isFinite(b.amount) ? Math.max(0, b.amount) : 30;
  const dim = Number.isFinite(b.dim) ? Math.max(0, Math.min(0.95, b.dim)) : 0.55;
  const r = Math.max(1, Math.min(60, Math.round((amount / 4 / Math.SQRT2 * Math.sqrt(12) - 1) / 2)));
  let f = `scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=luma_radius=${r}:luma_power=2:chroma_radius=${Math.min(r, 60)}:chroma_power=2,scale=1080:1920`;
  if (dim > 0) { const k = (1 - dim).toFixed(3); f += `,format=gbrp,colorchannelmixer=rr=${k}:gg=${k}:bb=${k}`; }
  return f;
}

function buildExportArgs({ sourcePath, outPath, segments, lines, crop, fadeMs, tempDir, theme, encoder, bgmFile, bgmPlan }) {
  if (!segments?.length) throw Error('남은 영상 구간이 없습니다.');
  if (segments.some(s => !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start)) throw Error('영상 구간 시각이 올바르지 않습니다.');
  const t = normalizeTheme(theme);
  if (![t.video.x,t.video.y,t.video.width,t.video.height].every(Number.isFinite) || t.video.width <= 0 || t.video.height <= 0) throw Error('테마 영상 영역이 올바르지 않습니다.');
  fadeMs = Number.isFinite(fadeMs) ? Math.max(0, fadeMs) : 10;
  const startT = Math.max(0, segments[0].start - 1);
  const endT = segments[segments.length - 1].end + 1;
  // 자막 그림 순서표. 시각을 밀리초로 반올림한 뒤 빼서 길이를 구하므로 줄이 많아도 오차가 쌓이지 않는다.
  // 단어 강조(가라오케) 줄은 images: [{ name, start, end }] 로 여러 장을 이어 붙인다.
  const ms = (x) => Math.round(x * 1000);
  const entry = (file, a, b) => `file '${file}'\nduration ${((ms(b) - ms(a)) / 1000).toFixed(3)}\n`;
  let concatTxt = '';
  let lastTime = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.outStart > lastTime) concatTxt += entry('empty.png', lastTime, l.outStart);
    const imgs = Array.isArray(l.images) ? l.images.filter((im) => im && /^[\w.-]+\.png$/.test(im.name) && im.end > im.start) : [];
    if (imgs.length) {
      let at = l.outStart;
      imgs.forEach((im, j) => { const end = j === imgs.length - 1 ? l.outEnd : Math.max(at, Math.min(l.outEnd, im.end)); concatTxt += entry(im.name, at, end); at = end; });
    } else {
      concatTxt += entry(`line_${i}.png`, l.outStart, l.outEnd);
    }
    lastTime = l.outEnd;
  }
  concatTxt += `file 'empty.png'\nduration 9999\n`;
  fs.writeFileSync(path.join(tempDir, 'lines.txt'), concatTxt, 'utf8');

  const loopT = (endT - startT).toFixed(3);
  const args = ['-y', '-ss', startT.toFixed(3), '-to', endT.toFixed(3), '-i', sourcePath];
  args.push('-loop', '1', '-t', loopT, '-i', path.join(tempDir, 'top.png'));
  args.push('-loop', '1', '-t', loopT, '-i', path.join(tempDir, 'footer.png'));
  args.push('-f', 'concat', '-safe', '0', '-i', path.join(tempDir, 'lines.txt'));
  // 추가 층 입력 (필요할 때만): 4번부터 차례로
  const layers = exportLayers(t);
  let nextInput = 4;
  const addImage = (name) => { args.push('-loop', '1', '-t', loopT, '-i', path.join(tempDir, name)); return nextInput++; };
  const bgIn = layers.bgImage ? addImage('bg.png') : -1;
  const underIn = layers.under ? addImage('under.png') : -1;
  const maskIn = layers.mask ? addImage('mask.png') : -1;

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
  let vsrc = '[vcat]';
  if (layers.blur) { fg += `[vcat]split=2[vmain][vbgsrc]; `; vsrc = '[vmain]'; }
  fg += `${vsrc}crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',scale=${v.width}:${v.height}[vcrop]; `;
  let vlabel = '[vcrop]';
  if (maskIn >= 0) { fg += `[vcrop]format=rgba[vrgba]; [${maskIn}:v]scale=${v.width}:${v.height},format=gray[vmask]; [vrgba][vmask]alphamerge[vround]; `; vlabel = '[vround]'; }

  // 배경: 단색 | 그라데이션 그림 | 흐린 영상(1/4 크기에서 흐리고 어둡게 한 뒤 키움)
  if (layers.blur) {
    fg += `[vbgsrc]${blurBackgroundFilter(t.canvas.blur)}[base]; `;
  } else if (bgIn >= 0) {
    fg += `[${bgIn}:v]format=rgba[base]; `;
  } else {
    const bgColor = (t.canvas.background || '#000000').replace('#', '0x');
    fg += `color=c=${bgColor}:s=1080x1920:d=1[base]; `;
  }
  let baseLabel = '[base]';
  if (underIn >= 0) { fg += `[base][${underIn}:v]overlay=x=0:y=0[baseu]; `; baseLabel = '[baseu]'; }
  fg += `${baseLabel}${vlabel}overlay=x=${v.x}:y=${v.y}[basev]; `;

  // Fade duration for footer
  const fadeInD = t.fadeInSec ?? 1.0;
  const footerFilter = fadeInD > 0 ? `format=rgba,fade=t=in:st=0:d=${fadeInD}:alpha=1` : "format=rgba";
  fg += `[basev][1:v]overlay=x=0:y=0:shortest=1[ovl1]; [2:v]${footerFilter}[footer]; [ovl1][footer]overlay=x=0:y=0:shortest=1[ovl2]; `;
  fg += `[ovl2][3:v]overlay=x=0:y=0:shortest=1,format=yuv420p[vout]`;
  // 배경음악: 고른 구간을 자르고 페이드·크기·시작 시각(맞춤)을 적용해 말소리 위에 얹는다
  let audioOut = '[acat]';
  if (bgmFile && bgmPlan && bgmPlan.length > 0) {
    const bgmIn = nextInput++;
    args.push('-i', bgmFile);
    fg += '; ' + bgmLib.ffmpegFilter(bgmPlan, bgmIn, '[acat]');
    audioOut = '[aout]';
  }
  args.push('-filter_complex', fg, '-map', '[vout]', '-map', audioOut);
  args.push('-t', segments.reduce((n,s)=>n+s.end-s.start,0).toFixed(6));
  args.push(...(VIDEO_ENCODERS[encoder] || VIDEO_ENCODERS[defaultEncoder()]), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-r', '30', '-movflags', '+faststart', '-progress', 'pipe:1', outPath);
  return { args, filtergraph: fg };
}

async function runExport(event, params) {
  params = { ...params, outPath: guard.check(params.outPath), tempDir: guard.check(params.tempDir) };
  // 배경음악은 목록(id)으로만 받는다: 받은 파일 경로는 메인이 정한다 (렌더러가 아무 파일이나 넣지 못하게)
  delete params.bgmFile; delete params.bgmPlan;
  if (params.bgm && params.bgm.id) {
    const outDur = params.segments.reduce((n, s) => n + (s.end - s.start), 0);
    const track = require('./bgm').trackOf(params.bgm.id);
    params.bgmPlan = bgmLib.plan({ ...params.bgm, duration: track.durationSec || params.bgm.duration }, outDur);
    if (params.bgmPlan) params.bgmFile = await require('./bgm').ensure(params.bgm.id);
  }
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
module.exports = { initRender, buildExportArgs, blurBackgroundFilter, srtPathOf, defaultEncoder };