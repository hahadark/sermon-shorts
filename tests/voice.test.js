'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const V = require('../src/shared/voice.js');
const B = require('../src/shared/bgm.js');
const { buildExportArgs } = require('../src/main/render.js');

test('설정 정리: 범위 밖 값·이상한 값', () => {
  assert.deepStrictEqual(V.normalize(null), { mode: 'off', gainDb: 0, even: false, measured: null });
  assert.strictEqual(V.normalize({ mode: 'manual', gainDb: 99 }).gainDb, 20);
  assert.strictEqual(V.normalize({ mode: 'manual', gainDb: -50 }).gainDb, -12);
  assert.strictEqual(V.normalize({ mode: 'x' }).mode, 'off');
  assert.strictEqual(V.normalize({ measured: { i: 'abc' } }).measured, null);
});

test('키울 크기: 직접 / 자동(-14 LUFS 까지, 최대 +20) / 무음', () => {
  assert.strictEqual(V.gainDb({ mode: 'manual', gainDb: 6 }), 6);
  assert.strictEqual(V.gainDb({ mode: 'auto' }), null);
  assert.strictEqual(V.gainDb({ mode: 'auto', measured: { i: -22.4, key: 'k' } }), 8.4);
  assert.strictEqual(V.gainDb({ mode: 'auto', measured: { i: -9, key: 'k' } }), -5);
  assert.strictEqual(V.gainDb({ mode: 'auto', measured: { i: -45, key: 'k' } }), 20);
  assert.strictEqual(V.gainDb({ mode: 'auto', measured: { i: -70, key: 'k' } }), 0);
  assert.strictEqual(V.gainDb({ mode: 'off', gainDb: 10 }), 0);
});

test('잰 값이 지금 편집에 맞는지: 구간·고르게 설정', () => {
  const segs = [{ start: 1, end: 5 }, { start: 8, end: 9.5 }];
  const key = V.segKey(segs);
  assert.notStrictEqual(key, V.segKey([{ start: 1, end: 5 }]));
  assert.ok(V.measuredFits({ mode: 'auto', measured: { i: -20, key, even: false } }, key));
  assert.ok(!V.measuredFits({ mode: 'auto', even: true, measured: { i: -20, key, even: false } }, key));
});

test('ffmpeg 체인: 압축기 → 크기 → 4배 리미터, 끄면 없음', () => {
  assert.strictEqual(V.ffmpegFilter({ mode: 'off' }, '[a]', '[b]'), '');
  const f = V.ffmpegFilter({ mode: 'manual', gainDb: 12, even: true }, '[a]', '[b]');
  assert.match(f, /^\[a\]acompressor=.*,volume=12dB,aresample=192000,alimiter=limit=0\.794:.*level=false:latency=true,aresample=48000\[b\]$/);
  assert.ok(f.indexOf('acompressor') < f.indexOf('volume') && f.indexOf('volume') < f.indexOf('alimiter'));
  // 자동인데 아직 안 쟀으면 크기는 그대로, 리미터만
  assert.doesNotMatch(V.ffmpegFilter({ mode: 'auto' }, '[a]', '[b]'), /volume=/);
});

test('loudnorm 결과 읽기', () => {
  const txt = '[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-19.52",\n\t"input_tp" : "-3.71",\n\t"input_lra" : "11.00",\n\t"input_thresh" : "-30.1"\n}\n[out#0] video:0kB';
  assert.deepStrictEqual(V.parseLoudnorm(txt), { i: -19.52, tp: -3.71, lra: 11 });
  assert.strictEqual(V.parseLoudnorm('없음'), null);
  assert.strictEqual(V.parseLoudnorm('{"input_i":"-inf","input_tp":"-inf"}').i, -70);
});

test('내보내기: 목소리 처리 뒤에 배경음악을 섞는다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-voice-'));
  const base = { sourcePath: 'in.mp4', outPath: 'out.mp4', segments: [{ start: 10, end: 20 }], lines: [], crop: null, fadeMs: 10, tempDir: tmp, theme: {}, encoder: 'x264' };
  const a = buildExportArgs({ ...base, voice: { mode: 'manual', gainDb: 6 } });
  assert.match(a.filtergraph, /\[acat\]volume=6dB,aresample=192000,alimiter=[^\[]*\[avox\]/);
  assert.equal(a.args[a.args.indexOf('-map', a.args.indexOf('[vout]')) + 1], '[avox]');
  const p = B.plan({ id: 'x', duration: 100, trackStart: 0, trackEnd: 60, align: 'start', fadeIn: 1, fadeOut: 1, volume: 0.2 }, 10);
  const b = buildExportArgs({ ...base, voice: { mode: 'manual', gainDb: 6 }, bgmFile: 'm.mp3', bgmPlan: p });
  assert.match(b.filtergraph, /\[avox\][^;]*aformat=[^;]*\[speech\]/);
  assert.equal(b.args[b.args.indexOf('-map', b.args.indexOf('[vout]')) + 1], '[aout]');
  const c = buildExportArgs({ ...base, voice: { mode: 'off' } });
  assert.doesNotMatch(c.filtergraph, /avox|alimiter/);
});
