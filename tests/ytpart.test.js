'use strict';
// sidx 파서 / 조각 선택 / 형식 선택 단위 테스트 (네트워크 없음)
const test = require('node:test');
const assert = require('node:assert');
const { parseSidx, selectRefs, pickFormats, videoIdOf } = require('../src/main/ytpart');

function box(type, payload) {
  const b = Buffer.alloc(8 + payload.length);
  b.writeUInt32BE(b.length, 0); b.write(type, 4, 'latin1'); payload.copy(b, 8);
  return b;
}
// sidx: version, timescale, ept, firstOffset, refs [{size, dur}]
function sidx(version, timescale, ept, first, refs) {
  const head = Buffer.alloc(4 + 4 + 4 + (version === 0 ? 8 : 16) + 4);
  let q = 0;
  head.writeUInt8(version, q); q += 4;         // version + flags
  head.writeUInt32BE(1, q); q += 4;            // reference_ID
  head.writeUInt32BE(timescale, q); q += 4;
  if (version === 0) { head.writeUInt32BE(ept, q); head.writeUInt32BE(first, q + 4); q += 8; }
  else { head.writeBigUInt64BE(BigInt(ept), q); head.writeBigUInt64BE(BigInt(first), q + 8); q += 16; }
  head.writeUInt16BE(0, q); head.writeUInt16BE(refs.length, q + 2);
  const body = Buffer.alloc(12 * refs.length);
  refs.forEach((r, i) => { body.writeUInt32BE(r.size & 0x7fffffff, i * 12); body.writeUInt32BE(r.dur, i * 12 + 4); body.writeUInt32BE(0x90000000, i * 12 + 8); });
  return box('sidx', Buffer.concat([head, body]));
}

test('parseSidx v0: init 끝, 시각, 바이트 범위', () => {
  const ftyp = box('ftyp', Buffer.alloc(16));
  const moov = box('moov', Buffer.alloc(100));
  const s = sidx(0, 1000, 5000, 0, [{ size: 300, dur: 6000 }, { size: 200, dur: 6000 }, { size: 100, dur: 3000 }]);
  const buf = Buffer.concat([ftyp, moov, s, Buffer.alloc(50)]);
  const ix = parseSidx(buf);
  assert.ok(ix);
  assert.strictEqual(ix.initEnd, ftyp.length + moov.length - 1);
  assert.strictEqual(ix.timescale, 1000);
  const base = ftyp.length + moov.length + s.length;
  assert.deepStrictEqual(ix.refs, [
    { start: 5, end: 11, a: base, b: base + 299 },
    { start: 11, end: 17, a: base + 300, b: base + 499 },
    { start: 17, end: 20, a: base + 500, b: base + 599 },
  ]);
});

test('parseSidx v1 + first_offset', () => {
  const ftyp = box('ftyp', Buffer.alloc(8));
  const s = sidx(1, 44100, 44100 * 3, 10, [{ size: 1000, dur: 441000 }]);
  const ix = parseSidx(Buffer.concat([ftyp, s]));
  assert.strictEqual(ix.refs[0].start, 3);
  assert.strictEqual(ix.refs[0].end, 13);
  assert.strictEqual(ix.refs[0].a, ftyp.length + s.length + 10);
});

test('parseSidx: sidx 없거나 잘리면 null', () => {
  assert.strictEqual(parseSidx(Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n')), null);
  const s = sidx(0, 1000, 0, 0, [{ size: 10, dur: 1000 }]);
  assert.strictEqual(parseSidx(Buffer.concat([box('ftyp', Buffer.alloc(8)), s.subarray(0, 20)])), null);
});

test('selectRefs: 구간을 덮는 조각만', () => {
  const refs = [0, 6, 12, 18, 24].map((t) => ({ start: t, end: t + 6 }));
  assert.deepStrictEqual(selectRefs(refs, 7, 13).map((r) => r.start), [6, 12]);
  assert.deepStrictEqual(selectRefs(refs, 12, 12.5).map((r) => r.start), [12]);
  assert.deepStrictEqual(selectRefs(refs, 100, 120), []);
});

test('pickFormats: avc1 1080 + 140 + 18, HLS 주소 제외', () => {
  const f = [
    { format_id: '312', url: 'https://manifest.googlevideo.com/api/manifest/hls_playlist/x', protocol: 'm3u8_native', vcodec: 'avc1.64002A', acodec: 'none', height: 1080, ext: 'mp4' },
    { format_id: '303', url: 'https://r.googlevideo.com/videoplayback?itag=303', protocol: 'https', vcodec: 'vp9', acodec: 'none', height: 1080, ext: 'webm' },
    { format_id: '299', url: 'https://r.googlevideo.com/videoplayback?itag=299', protocol: 'https', vcodec: 'avc1.64002A', acodec: 'none', height: 1080, fps: 60, ext: 'mp4' },
    { format_id: '137', url: 'https://r.googlevideo.com/videoplayback?itag=137', protocol: 'https', vcodec: 'avc1.640028', acodec: 'none', height: 1080, fps: 30, ext: 'mp4' },
    { format_id: '401', url: 'https://r.googlevideo.com/videoplayback?itag=401', protocol: 'https', vcodec: 'av01', acodec: 'none', height: 2160, ext: 'mp4' },
    { format_id: '139', url: 'https://r.googlevideo.com/videoplayback?itag=139', protocol: 'https', vcodec: 'none', acodec: 'mp4a.40.5', abr: 48, ext: 'm4a' },
    { format_id: '140', url: 'https://r.googlevideo.com/videoplayback?itag=140', protocol: 'https', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129, ext: 'm4a' },
    { format_id: '18', url: 'https://r.googlevideo.com/videoplayback?itag=18', protocol: 'https', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, ext: 'mp4' },
  ];
  const p = pickFormats(f);
  assert.strictEqual(p.video.format_id, '299');
  assert.strictEqual(p.audio.format_id, '140');
  assert.strictEqual(p.preview.format_id, '18');
});

test('videoIdOf', () => {
  assert.strictEqual(videoIdOf('https://www.youtube.com/watch?v=9Tmjg3ESEyc&t=870'), '9Tmjg3ESEyc');
  assert.strictEqual(videoIdOf('https://youtu.be/9Tmjg3ESEyc?t=10'), '9Tmjg3ESEyc');
  assert.strictEqual(videoIdOf('youtube.com/live/9Tmjg3ESEyc'), '9Tmjg3ESEyc');
});
