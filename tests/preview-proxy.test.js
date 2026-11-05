'use strict';
// 미리보기용 영상 (src/main/preview-proxy.js): 인코더 순서·만들기 인자·시각 검사·보관 정리
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const P = require('../src/main/preview-proxy.js');
const tools = require('../src/main/tools.js');
const haveFf = fs.existsSync(tools.ffmpeg) && fs.existsSync(tools.ffprobe);

test('하드웨어 인코더를 먼저, 마지막은 늘 CPU(libx264)', () => {
  const l = P.encoderList();
  assert.equal(l[l.length - 1], 'libx264');
  if (process.platform === 'win32') assert.equal(l[0], 'h264_nvenc');
  if (process.platform === 'darwin') assert.equal(l[0], 'h264_videotoolbox');
});

test('만들기 인자: 기준 화면 0.5초마다, B프레임 없음, 시각 그대로, 소리 복사, 1080 넘으면 줄임', () => {
  const info = { duration: 10, video: { fps: 60, height: 2160, start: 0 }, audio: { codec: 'aac', start: 0 } };
  const a = P.buildArgs('in.mp4', 'out.mp4', info, 'libx264');
  const v = (k) => a[a.indexOf(k) + 1];
  assert.equal(v('-g'), '30'); assert.equal(v('-keyint_min'), '30'); assert.equal(v('-bf'), '0');
  assert.equal(v('-fps_mode'), 'passthrough'); assert.equal(v('-c:a'), 'copy'); assert.equal(v('-vf'), 'scale=-2:1080');
  assert.equal(v('-sc_threshold'), '0');
  const b = P.buildArgs('in.mp4', 'out.mp4', { duration: 10, video: { fps: 30, height: 720, start: 0 }, audio: { codec: 'opus', start: 0 } }, 'h264_nvenc');
  assert.equal(b[b.indexOf('-g') + 1], '15'); assert.ok(!b.includes('-vf')); assert.equal(b[b.indexOf('-c:a') + 1], 'aac');
  assert.ok(!b.includes('-sc_threshold'));
  const c = P.buildArgs('in.mp4', 'out.mp4', { duration: 10, video: { fps: 30, height: 720, start: 0 }, audio: null }, 'libx264');
  assert.ok(!c.includes('-c:a'));
});

test('실제 영상: 기준 화면이 드문 원본으로 만들면 촘촘해지고 시각이 같다 (이미 촘촘하면 만들지 않음)', { skip: !haveFf && 'ffmpeg 없음' }, async () => {
  const d = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ss-proxy-'));
  const src = path.join(d, 'sparse.mp4');
  cp.execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=8', '-f', 'lavfi', '-i', 'sine=f=440:d=8', '-c:v', 'libx264', '-g', '240', '-c:a', 'aac', '-shortest', src]);
  assert.ok((await P.keyframeGap(src)) > 2, '원본은 기준 화면이 드물다');
  const r = await P.ensure(src, () => {});
  assert.ok(r.path && fs.existsSync(r.path), JSON.stringify(r));
  assert.ok((await P.keyframeGap(r.path)) <= 0.6, '미리보기용은 0.5초마다');
  assert.equal(await P.sameTimeline(src, r.path), true);
  const again = await P.ensure(src, () => {});
  assert.equal(again.cached, true, '같은 원본은 다시 만들지 않는다');
  const dense = path.join(d, 'dense.mp4');
  cp.execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=4', '-c:v', 'libx264', '-g', '15', dense]);
  assert.equal((await P.ensure(dense, () => {})).skipped, 'dense');
  fs.rmSync(r.path, { force: true }); fs.rmSync(d, { recursive: true, force: true });
});

test('시각이 다른 영상은 미리보기용으로 쓰지 않는다', { skip: !haveFf && 'ffmpeg 없음' }, async () => {
  const d = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ss-proxy-'));
  const a = path.join(d, 'a.mp4'), b = path.join(d, 'b.mp4');
  cp.execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=6', '-c:v', 'libx264', a]);
  cp.execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=4', '-c:v', 'libx264', b]);
  assert.equal(await P.sameTimeline(a, b), false);
  fs.rmSync(d, { recursive: true, force: true });
});
