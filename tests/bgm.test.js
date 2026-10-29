'use strict';
// 배경음악 배치(맞추기·구간·페이드)와 내보내기 필터
const test = require('node:test');
const assert = require('node:assert');
const B = require('../src/shared/bgm.js');
const { buildExportArgs } = require('../src/main/render.js');
const catalog = require('../src/shared/bgm-catalog.js');
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('처음에 맞춤: 고른 구간 앞부분을 영상 길이만큼', () => {
  const p = B.plan({ id: 'x', duration: 200, trackStart: 20, trackEnd: 150, align: 'start', fadeIn: 1, fadeOut: 2, volume: 0.25 }, 60);
  assert.ok(near(p.from, 20) && near(p.length, 60) && near(p.delay, 0));
  assert.ok(near(B.trackTimeAt(p, 10), 30));
  assert.ok(near(B.gainAt(p, 0.5), 0.125));           // 페이드 인 가운데
  assert.ok(near(B.gainAt(p, 30), 0.25));
  assert.ok(near(B.gainAt(p, 59), 0.125));            // 페이드 아웃 가운데
  assert.equal(B.gainAt(p, 61), 0);
});
test('끝에 맞춤: 긴 구간은 뒷부분, 짧은 구간은 늦게 시작해 영상 끝에 끝남', () => {
  const long = B.plan({ id: 'x', duration: 200, trackStart: 20, trackEnd: 150, align: 'end' }, 60);
  assert.ok(near(long.from, 90) && near(long.delay, 0) && near(long.length, 60));
  const short = B.plan({ id: 'x', duration: 200, trackStart: 10, trackEnd: 40, align: 'end' }, 60);
  assert.ok(near(short.from, 10) && near(short.length, 30) && near(short.delay, 30));
  assert.equal(B.trackTimeAt(short, 10), null);       // 아직 음악 전
  assert.ok(near(B.trackTimeAt(short, 59), 39));
});
test('잘못된 값은 다듬는다', () => {
  const n = B.normalize({ id: 'x', duration: 100, trackStart: 90, trackEnd: 20, volume: 3, fadeIn: -1 });
  assert.deepEqual([n.trackStart, n.trackEnd, n.volume, n.fadeIn, n.align], [0, 100, 1, 0, 'start']);
  assert.equal(B.normalize({}), null);
  assert.equal(B.plan(null, 30), null);
});
test('내보내기: 음악 입력을 더하고 말소리와 섞는다 (말소리 크기는 그대로)', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bgm-'));
  const p = B.plan({ id: 'x', duration: 100, trackStart: 5, trackEnd: 50, align: 'end', fadeIn: 1, fadeOut: 2, volume: 0.2 }, 20);
  const { args, filtergraph } = buildExportArgs({ sourcePath: 'in.mp4', outPath: 'out.mp4', segments: [{ start: 10, end: 20 }, { start: 30, end: 40 }], lines: [], crop: null, fadeMs: 10, tempDir: tmp, theme: {}, encoder: 'x264', bgmFile: 'music.mp3', bgmPlan: p });
  const i = args.indexOf('music.mp3');
  assert.ok(i > 0 && args[i - 1] === '-i');
  assert.match(filtergraph, /atrim=start=30\.000:end=50\.000/);
  assert.match(filtergraph, /afade=t=out:st=18\.000:d=2\.000/);
  assert.match(filtergraph, /amix=inputs=2:duration=first:dropout_transition=0:normalize=0\[aout\]/);
  assert.equal(args[args.indexOf('-map', args.indexOf('[vout]')) + 1], '[aout]');
  const plain = buildExportArgs({ sourcePath: 'in.mp4', outPath: 'out.mp4', segments: [{ start: 10, end: 20 }], lines: [], tempDir: tmp, theme: {}, encoder: 'x264' });
  assert.ok(!plain.args.includes('[aout]') && plain.args.includes('[acat]'));
});
test('추천 목록: 저작권 공개 곡만, 주소·출처 갖춤', () => {
  const ok = ['CC BY 4.0', 'CC BY 3.0', 'CC0', 'Public Domain'];
  assert.ok(catalog.tracks.length >= 15);
  const ids = new Set();
  for (const t of catalog.tracks) {
    assert.ok(ok.includes(t.license), t.id + ' ' + t.license);
    assert.match(t.url, /^https:\/\/(incompetech\.com|upload\.wikimedia\.org)\//);
    assert.ok(catalog.MOODS.includes(t.mood), t.mood);
    assert.ok(t.durationSec > 30);
    if (/^CC BY/.test(t.license)) assert.ok(t.attribution.length > 10, t.id + ' 출처 문구');
    assert.ok(!ids.has(t.id)); ids.add(t.id);
  }
});
