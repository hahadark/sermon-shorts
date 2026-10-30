// 목소리 크기 재기: 편집한 구간만 이어 붙여 loudnorm 으로 LUFS·최고 크기를 잰다 (소리만 읽어 빠름)
const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const tools = require('./tools');
const voiceLib = require('../shared/voice');

function analyze({ sourcePath, segments, voice }) {
  return new Promise((resolve, reject) => {
    segments = (segments || []).filter((s) => s && s.end > s.start);
    if (!sourcePath || !segments.length) return reject(new Error('잴 구간이 없습니다.'));
    const startT = Math.max(0, segments[0].start - 1), endT = segments[segments.length - 1].end + 1;
    let fg = '';
    segments.forEach((seg, i) => { fg += `[0:a]atrim=start=${Math.max(0, seg.start - startT).toFixed(3)}:end=${Math.max(0, seg.end - startT).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]; `; });
    fg += segments.map((_, i) => `[a${i}]`).join('') + `concat=n=${segments.length}:v=0:a=1[acat]; [acat]${voiceLib.analysisFilter(voice)}[out]`;
    const args = ['-hide_banner', '-nostats', '-ss', startT.toFixed(3), '-to', endT.toFixed(3), '-i', sourcePath, '-vn', '-filter_complex', fg, '-map', '[out]', '-f', 'null', '-'];
    const p = spawn(tools.ffmpeg, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 200000) err = err.slice(-100000); });
    p.on('error', reject);
    p.on('close', (code) => {
      const m = voiceLib.parseLoudnorm(err);
      if (code !== 0 || !m) return reject(new Error('목소리 크기를 재지 못했습니다. ' + err.split(/\r?\n/).filter(Boolean).slice(-2).join(' / ').slice(-200)));
      const v = voiceLib.normalize(voice);
      resolve({ i: Math.round(m.i * 10) / 10, tp: Math.round(m.tp * 10) / 10, lra: Math.round(m.lra * 10) / 10, key: voiceLib.segKey(segments), even: v.even });
    });
  });
}

function initVoice() {
  ipcMain.handle('voice:analyze', (_e, p) => analyze(p || {}));
}

module.exports = { initVoice, analyze };
