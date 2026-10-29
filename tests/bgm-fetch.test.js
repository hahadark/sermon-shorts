'use strict';
// 배경음악 빠르게 불러오기: 앱에 넣어 둔 파형 자료, 여러 갈래로 나눠 받기(안 되면 한 갈래로)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const peaks = require('../src/shared/bgm-peaks.js');
const catalog = require('../src/shared/bgm-catalog.js');
const { download } = require('../src/main/fetch-parts.js');

test('목록의 모든 곡에 파형 자료가 있고 길이가 목록과 맞다', () => {
  for (const t of catalog.tracks) {
    assert.ok(peaks.has(t.id), '파형 없음: ' + t.id);
    const g = peaks.get(t.id, 420);
    assert.strictEqual(g.peaks.length, 420);
    assert.ok(Math.abs(g.duration - t.durationSec) < 1.5, `${t.id} 길이 ${g.duration} vs ${t.durationSec}`);
    assert.strictEqual(Math.max(...g.peaks), 1);
    assert.ok(g.peaks.every((v) => v >= 0 && v <= 1));
    assert.ok(g.peaks.filter((v) => v > 0.05).length > 100, t.id + ' 파형이 거의 비어 있음');
  }
});

test('파형 칸 수 바꾸기와 없는 곡', () => {
  const id = catalog.tracks[0].id;
  assert.strictEqual(peaks.get(id, 2000).peaks.length, 2000);
  assert.strictEqual(peaks.get(id, 50).peaks.length, 50);
  assert.strictEqual(peaks.get(id, 420), peaks.get(id, 420), '같은 요청은 다시 계산하지 않음');
  assert.strictEqual(peaks.get('없는-곡', 100), null);
});

function server(mode) {
  const body = crypto.randomBytes(3 * 1024 * 1024 + 12345);
  const hits = { range: 0, full: 0, head: 0 };
  const srv = http.createServer((req, res) => {
    if (req.method === 'HEAD') { hits.head++; res.writeHead(200, { 'Content-Length': body.length, 'Accept-Ranges': mode === 'norange' ? 'none' : 'bytes' }); return res.end(); }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m && mode === 'ranges') {
      hits.range++;
      const a = +m[1], b = m[2] ? Math.min(body.length - 1, +m[2]) : body.length - 1;
      res.writeHead(206, { 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${body.length}` });
      return res.end(body.subarray(a, b + 1));
    }
    if (m && mode === '429') { hits.range++; res.writeHead(429, { 'Retry-After': '0' }); return res.end(); }
    hits.full++;
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, body, hits, url: `http://127.0.0.1:${srv.address().port}/a.mp3` })));
}

for (const mode of ['ranges', 'norange', '429']) {
  test('여러 갈래 받기: ' + mode, async () => {
    const s = await server(mode);
    try {
      let last = [0, 0];
      const buf = await download(s.url, { parts: 6, onProgress: (g, t) => { last = [g, t]; } });
      assert.ok(buf.equals(s.body), '받은 내용이 원본과 같아야 함');
      assert.strictEqual(last[0], s.body.length);
      if (mode === 'ranges') { assert.strictEqual(s.hits.range, 6); assert.strictEqual(s.hits.full, 0); }
      else assert.strictEqual(s.hits.full, 1, '나눠 받기가 안 되면 한 갈래로');
    } finally { s.srv.close(); }
  });
}

test('너무 큰 파일은 받지 않는다', async () => {
  const s = await server('ranges');
  try { await assert.rejects(download(s.url, { maxBytes: 1024 * 1024 }), /너무 큽니다/); } finally { s.srv.close(); }
});
