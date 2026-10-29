'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const tools = require('./tools');
const { python, root, paths, ensureDir } = tools;

function getCachePath(inputPath, start, end) {
  const hash = crypto.createHash('md5').update(`${inputPath}_${start}_${end}`).digest('hex');
  const dir = path.join(paths.cache, hash);
  ensureDir(dir);
  return path.join(dir, `transcript_${start}_${end}.json`);
}

let currentProcess = null;

async function transcribe(inputPath, range = {}, onProgress) {
  const { start, end } = range;
  const outPath = getCachePath(inputPath, start, end);

  if (fs.existsSync(outPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (onProgress) onProgress({ stage: 'done', pct: 100 });
      return data;
    } catch (e) {
      console.error('Failed to read cached transcript:', e);
    }
  }

  if (!fs.existsSync(python)) {
    throw new Error('자막 엔진(Python)이 설치되지 않았습니다. [점검] 창에서 [엔진 설치]를 누르세요.');
  }

  return new Promise((resolve, reject) => {
    const args = [path.join(root, 'engine', 'transcribe.py'), '--input', inputPath, '--out', outPath, '--ffmpeg', tools.ffmpeg];
    let terms = '';
    try { terms = String(require('./settings').loadSettings().churchTerms || '').trim(); } catch (_) { /* 설정 없음 */ }
    if (terms) args.push('--terms', terms);
    if (start !== undefined) args.push('--start', start.toString());
    if (end !== undefined) args.push('--end', end.toString());

    const env = { ...process.env };
    delete env.PYTHONHOME;
    delete env.PYTHONPATH;
    delete env.PIP_PREFIX;
    env.PYTHONIOENCODING = 'utf-8';
    env.SS_ENGINE_DIR = paths.engineDir;
    env.SS_CACHE_DIR = paths.cache;
    env.HF_HOME = path.join(paths.engineDir, 'hf-cache');

    const proc = spawn(python, args, { cwd: root, env, windowsHide: true });
    currentProcess = proc;

    let result = null;
    let errorMsg = '';

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'progress') {
            if (onProgress) onProgress(msg);
          } else if (msg.type === 'done') {
            // Transcript is written to outPath
          } else if (msg.type === 'warn') {
            if (onProgress) onProgress({ stage: 'warn', message: msg.message });
          } else if (msg.type === 'error') {
            errorMsg = msg.message;
          }
        } catch (e) {
          // Non-JSON output (maybe debug logs)
          if (line.includes('Error')) errorMsg += line;
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const line = data.toString();
      console.log(`[transcribe py] ${line}`);
      if (line.toLowerCase().includes('error')) {
        errorMsg += line;
      }
    });

    proc.on('error', (err) => {
      currentProcess = null;
      reject(new Error('자막 엔진 실행 실패: ' + err.message));
    });

    proc.on('close', (code) => {
      currentProcess = null;
      if (code !== 0) {
        return reject(new Error(errorMsg || `Transcription process exited with code ${code}`));
      }
      if (fs.existsSync(outPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
          resolve(data);
        } catch (e) {
          reject(new Error('Failed to parse transcription output'));
        }
      } else {
        reject(new Error('Transcription output file not found'));
      }
    });
  });
}

function cancelTask() {
  if (currentProcess) {
    currentProcess.kill();
    currentProcess = null;
    return true;
  }
  return false;
}

module.exports = { transcribe, cancelTask };
