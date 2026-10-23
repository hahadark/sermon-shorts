'use strict';
// ffprobe/ffmpeg 래퍼: probe, PCM 추출, 파형 개요(peaks)
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tools = require('./tools');

const PEAK_RATE = 8000;        // 개요용 디코드 샘플레이트
const PEAK_BUCKET_SEC = 0.01;  // 10ms 버킷
const PEAK_SAMPLES = Math.round(PEAK_RATE * PEAK_BUCKET_SEC); // 80

function run(cmd, args, { onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    const out = [];
    let err = '';
    proc.stdout.on('data', (d) => (onStdout ? onStdout(d) : out.push(d)));
    proc.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 20000) err = err.slice(-10000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`${path.basename(cmd)} 종료 코드 ${code}: ${err.trim().slice(-800)}`));
      resolve(onStdout ? null : Buffer.concat(out));
    });
  });
}

function parseRate(s) {
  if (!s || typeof s !== 'string') return 0;
  const [n, d] = s.split('/').map(Number);
  if (!d) return n || 0;
  return n / d;
}

/** @returns {Promise<{duration:number,fps:number,width:number,height:number,hasAudio:boolean}>} */
async function probe(filePath) {
  const buf = await run(tools.ffprobe, [
    '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath,
  ]);
  const info = JSON.parse(buf.toString('utf8'));
  const streams = info.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find((s) => s.codec_type === 'audio');
  let fps = v ? parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) : 0;
  if (!(fps > 0 && fps < 1000)) fps = 30;
  const duration = parseFloat((info.format && info.format.duration) || (v && v.duration) || (a && a.duration) || 0) || 0;
  return {
    duration,
    fps,
    width: v ? v.width : 0,
    height: v ? v.height : 0,
    hasAudio: !!a,
  };
}

/** 구간 PCM 추출 → Float32Array (mono). end<=start 이면 끝까지. */
async function extractPcm(filePath, start = 0, end = 0, rate = 48000) {
  const args = ['-v', 'error', '-nostdin'];
  if (start > 0) args.push('-ss', start.toFixed(6));
  args.push('-i', filePath);
  if (end > start) args.push('-t', (end - start).toFixed(6));
  args.push('-vn', '-sn', '-dn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1');
  const buf = await run(tools.ffmpeg, args);
  // 새 ArrayBuffer로 복사 (Buffer pool 공유/정렬 문제 방지)
  const n = Math.floor(buf.length / 4);
  const out = new Float32Array(n);
  new Uint8Array(out.buffer).set(buf.subarray(0, n * 4));
  return out;
}

function sourceHash(filePath) {
  const st = fs.statSync(filePath);
  return crypto.createHash('sha1')
    .update(path.resolve(filePath)).update('|' + st.size).update('|' + st.mtimeMs)
    .digest('hex').slice(0, 16);
}

/**
 * 파형 개요: 10ms 버킷당 [min,max] Float32 쌍. cache/<hash>/peaks.bin 에 저장.
 * 긴 영상도 메모리를 적게 쓰도록 ffmpeg 출력을 스트리밍으로 축약한다.
 * @returns {Promise<{peaks: Float32Array, bucketSec:number, hash:string}>}
 */
async function computePeaks(filePath) {
  const hash = sourceHash(filePath);
  const file = path.join(tools.cacheDir(hash), 'peaks.bin');
  if (fs.existsSync(file)) {
    const b = fs.readFileSync(file);
    const peaks = new Float32Array(b.length / 4);
    new Uint8Array(peaks.buffer).set(b);
    return { peaks, bucketSec: PEAK_BUCKET_SEC, hash };
  }

  const chunks = []; // Float32Array 조각들 (min,max 쌍)
  let cur = new Float32Array(65536 * 2);
  let curLen = 0; // 채워진 쌍 개수
  let bMin = 0, bMax = 0, bCount = 0;
  let carry = Buffer.alloc(0);

  const pushBucket = () => {
    if (curLen * 2 >= cur.length) { chunks.push(cur); cur = new Float32Array(65536 * 2); curLen = 0; }
    cur[curLen * 2] = bMin;
    cur[curLen * 2 + 1] = bMax;
    curLen++;
    bMin = 0; bMax = 0; bCount = 0;
  };

  await run(tools.ffmpeg, [
    '-v', 'error', '-nostdin', '-i', filePath, '-vn', '-sn', '-dn',
    '-ac', '1', '-ar', String(PEAK_RATE), '-f', 'f32le', 'pipe:1',
  ], {
    onStdout: (d) => {
      const data = carry.length ? Buffer.concat([carry, d]) : d;
      const usable = data.length - (data.length % 4);
      for (let off = 0; off < usable; off += 4) {
        const s = data.readFloatLE(off);
        if (s < bMin) bMin = s;
        if (s > bMax) bMax = s;
        if (++bCount === PEAK_SAMPLES) pushBucket();
      }
      carry = Buffer.from(data.subarray(usable));
    },
  });
  if (bCount > 0) pushBucket();

  const total = chunks.length * 65536 + curLen;
  const peaks = new Float32Array(total * 2);
  let o = 0;
  for (const c of chunks) { peaks.set(c, o); o += c.length; }
  peaks.set(cur.subarray(0, curLen * 2), o);

  fs.writeFileSync(file, Buffer.from(peaks.buffer, peaks.byteOffset, peaks.byteLength));
  return { peaks, bucketSec: PEAK_BUCKET_SEC, hash };
}

module.exports = { probe, extractPcm, computePeaks, sourceHash, PEAK_BUCKET_SEC, PEAK_RATE };
