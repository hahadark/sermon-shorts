'use strict';
// 미리보기용 영상 (프록시)
// 유튜브에서 받은 영상은 기준 화면(키프레임)이 5초에 한 번쯤뿐이라, 편집 결과로 재생하다 지운 곳을 건너뛸 때마다
// 그 사이 화면을 모두 다시 해독하느라 0.5초쯤 멈춘다. 같은 길이·같은 시각에 기준 화면만 0.5초마다 넣은 영상을
// 뒤에서 만들어 미리보기에만 쓴다. 내보내기·자막 만들기·파형은 늘 원본을 쓴다.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const tools = require('./tools');
const media = require('./media');

const TARGET_GOP_SEC = 0.5;     // 만들 영상의 기준 화면 간격
const DENSE_ENOUGH_SEC = 1.0;   // 원본이 이보다 촘촘하면 만들지 않는다
const KEEP_FILES = 8;           // 보관 개수 (오래된 것부터 지움)
const KEEP_DAYS = 30;

const dir = () => tools.ensureDir(path.join(tools.cache, 'proxy'));
let job = null;          // { src, proc, cancelled, promise }
let goodEncoder = null;  // 이 PC 에서 되는 인코더 (한 번 찾으면 기억)

function run(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: timeout || 60000, maxBuffer: 32 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) { err.stderr = errOut; reject(err); } else resolve(out);
    });
  });
}

/** 원본의 기준 화면 간격(앞 90초 기준, 초). 읽지 못하면 null */
async function keyframeGap(src) {
  try {
    const out = await run(tools.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-read_intervals', '%+90',
      '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', src], 30000);
    const t = out.split(/\r?\n/).map((s) => parseFloat(s)).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (t.length < 2) return t.length ? 90 : null;   // 90초 안에 기준 화면이 하나뿐
    return (t[t.length - 1] - t[0]) / (t.length - 1);
  } catch (_) { return null; }
}

async function streamsOf(file) {
  const out = await run(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,start_time,height,avg_frame_rate', '-of', 'json', file], 30000);
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  const fr = String((v && v.avg_frame_rate) || '30/1').split('/').map(Number);
  return {
    duration: parseFloat(j.format && j.format.duration) || 0,
    video: v ? { start: parseFloat(v.start_time) || 0, height: v.height || 0, fps: fr[1] ? fr[0] / fr[1] : 30 } : null,
    audio: a ? { start: parseFloat(a.start_time) || 0, codec: a.codec_name } : null,
  };
}

/** 하드웨어 인코더 먼저, 안 되면 CPU (libx264) */
function encoderList() {
  const list = process.platform === 'darwin' ? ['h264_videotoolbox'] : process.platform === 'win32' ? ['h264_nvenc', 'h264_qsv', 'h264_amf'] : [];
  return list.concat(['libx264']);
}
function encoderArgs(name) {
  switch (name) {
    case 'h264_nvenc': return ['-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'vbr', '-cq', '28', '-b:v', '0'];
    case 'h264_qsv': return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '28'];
    case 'h264_amf': return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '26', '-qp_p', '28'];
    case 'h264_videotoolbox': return ['-c:v', 'h264_videotoolbox', '-q:v', '55', '-realtime', '1'];
    default: return ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '26'];
  }
}

function buildArgs(src, out, info, encoder) {
  const gop = Math.max(1, Math.round((info.video.fps || 30) * TARGET_GOP_SEC));
  const args = ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', src, '-map', '0:v:0', '-map', '0:a:0?'];
  if (info.video.height > 1080) args.push('-vf', 'scale=-2:1080');
  args.push(...encoderArgs(encoder), '-g', String(gop), '-keyint_min', String(gop), '-bf', '0', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough');
  if (encoder === 'libx264') args.push('-sc_threshold', '0');
  // 소리는 그대로 복사 (시각이 바뀌지 않게). AAC 가 아니면 미리보기용으로만 다시 담는다
  if (info.audio) args.push(...(info.audio.codec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k']));
  args.push('-movflags', '+faststart', '-f', 'mp4', out);
  return args;
}

function encode(src, out, info, encoder, onPct, holder) {
  return new Promise((resolve, reject) => {
    const proc = spawn(tools.ffmpeg, buildArgs(src, out, info, encoder), { windowsHide: true });
    holder.proc = proc;
    let errText = '', buf = '';
    proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && info.duration > 0) onPct(Math.min(99, (Number(m[1]) / 1e6 / info.duration) * 100));
      }
    });
    proc.stderr.on('data', (d) => { errText = (errText + d).slice(-4000); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      holder.proc = null;
      if (holder.cancelled) return reject(Object.assign(new Error('취소됨'), { code: 'cancelled' }));
      if (code === 0) resolve(); else reject(new Error(encoder + ' 실패 (' + code + '): ' + errText.trim().split(/\r?\n/).slice(-2).join(' ')));
    });
  });
}

/** 만든 영상이 원본과 같은 길이·같은 시각인지 (어긋나면 쓰지 않는다: 자막·컷 위치가 틀어지므로) */
async function sameTimeline(src, out) {
  const [a, b] = await Promise.all([streamsOf(src), streamsOf(out)]);
  if (!a.video || !b.video) return false;
  if (Math.abs(a.duration - b.duration) > 0.15) return false;
  if (Math.abs(a.video.start - b.video.start) > 0.02) return false;
  if (a.audio && (!b.audio || Math.abs(a.audio.start - b.audio.start) > 0.02)) return false;
  return true;
}

function prune(keep) {
  try {
    const d = dir(), now = Date.now();
    const files = fs.readdirSync(d).filter((f) => /\.mp4$/i.test(f)).map((f) => ({ f: path.join(d, f), t: fs.statSync(path.join(d, f)).mtimeMs }))
      .sort((x, y) => y.t - x.t);
    files.forEach((x, i) => {
      if (x.f === keep) return;
      if (i >= KEEP_FILES || now - x.t > KEEP_DAYS * 864e5 || /\.part\.mp4$/i.test(x.f)) { try { fs.unlinkSync(x.f); } catch (_) { /* 쓰는 중 */ } }
    });
  } catch (_) { /* 정리는 실패해도 괜찮다 */ }
}

/** 진행 중인 작업 멈추기 */
function cancel() {
  if (!job) return;
  job.cancelled = true;
  try { if (job.proc) job.proc.kill(); } catch (_) { /* 이미 끝남 */ }
}

/**
 * 미리보기용 영상 준비.
 * → { path } (만든 것 또는 이미 있던 것) / { skipped: 'dense'|'no-video'|'disabled' } / 오류
 */
async function ensure(src, onPct) {
  if (!src || !fs.existsSync(src)) throw new Error('원본 영상이 없습니다.');
  if (job && job.src === src) return job.promise;
  cancel();
  const holder = { src, proc: null, cancelled: false };
  holder.promise = (async () => {
    const out = path.join(dir(), media.sourceHash(src) + '.mp4');
    if (fs.existsSync(out) && fs.statSync(out).size > 1024) { fs.utimesSync(out, new Date(), new Date()); return { path: out, cached: true }; }
    const info = await streamsOf(src);
    if (!info.video) return { skipped: 'no-video' };
    const gap = await keyframeGap(src);
    if (gap != null && gap <= DENSE_ENOUGH_SEC) return { skipped: 'dense', gap };
    const part = out.replace(/\.mp4$/i, '.part.mp4');
    const list = goodEncoder ? [goodEncoder] : encoderList();
    let lastErr = null;
    for (const enc of list) {
      if (holder.cancelled) break;
      try {
        const t0 = Date.now();
        await encode(src, part, info, enc, (p) => onPct && onPct(p), holder);
        if (!(await sameTimeline(src, part))) throw new Error('만든 영상의 시각이 원본과 어긋납니다');
        fs.renameSync(part, out);
        goodEncoder = enc;
        prune(out);
        return { path: out, encoder: enc, gap, ms: Date.now() - t0 };
      } catch (e) {
        try { fs.unlinkSync(part); } catch (_) { /* 없음 */ }
        if (e.code === 'cancelled') throw e;
        lastErr = e;
        if (goodEncoder === enc) goodEncoder = null;
      }
    }
    if (holder.cancelled) throw Object.assign(new Error('취소됨'), { code: 'cancelled' });
    throw lastErr || new Error('미리보기용 영상을 만들지 못했습니다');
  })();
  job = holder;
  try { return await holder.promise; } finally { if (job === holder) job = null; }
}

function initPreviewProxy() {
  const { ipcMain } = require('electron');
  ipcMain.handle('proxy:ensure', (event, src) => {
    const send = (pct) => { if (!event.sender.isDestroyed()) event.sender.send('progress', { task: 'proxy', src, pct }); };
    return ensure(String(src || ''), send).catch((e) => (e.code === 'cancelled' ? { skipped: 'cancelled' } : Promise.reject(e)));
  });
  ipcMain.handle('proxy:cancel', () => { cancel(); return true; });
  const { app } = require('electron');
  app.on('will-quit', cancel);
}

module.exports = { initPreviewProxy, ensure, cancel, keyframeGap, sameTimeline, buildArgs, encoderList, _test: { prune, streamsOf } };
