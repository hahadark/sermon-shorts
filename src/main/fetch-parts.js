'use strict';
// 큰 파일을 여러 갈래(Range)로 동시에 받는다. 서버가 나눠 받기를 안 받아 주면 한 갈래로 받는다.
// 배경음악 사이트(incompetech 등)는 한 연결이 느려서 6갈래로 받으면 1.5~7배 빨라진다 (2026-10-28 측정).
// open() 은 길이를 알자마자 돌려주고, 받는 대로 buf 를 채운다: 받은 앞부분부터 바로 재생에 쓸 수 있다.
// 순수 Node(fetch) 만 쓴다: 앱(main)과 scripts/make_bgm_peaks.js 가 함께 쓴다.

const MIN_PART = 512 * 1024; // 이보다 작게는 나누지 않는다
// 여러 갈래를 막는 곳: 위키미디어는 동시 요청이 많으면 429 를 준다 (한 갈래로도 빠름)
const SINGLE_HOSTS = /(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitOf(res, attempt) {
  const ra = Number(res.headers.get('retry-after'));
  return Math.min(8000, ra > 0 ? ra * 1000 : 800 * Math.pow(2, attempt));
}
const tooBig = () => new Error('파일이 너무 큽니다.');

/** 길이와 나눠 받기 지원 여부 (HEAD 가 막혀 있으면 0 바이트 Range GET 으로) */
async function probe(url, headers, signal) {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers, signal });
    if (r.ok) {
      const len = Number(r.headers.get('content-length')) || 0;
      const ranges = /bytes/i.test(r.headers.get('accept-ranges') || '');
      if (len) return { url: r.url || url, len, ranges };
    }
  } catch (e) { if (signal && signal.aborted) throw e; }
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { ...headers, Range: 'bytes=0-0' }, signal });
    const m = /\/(\d+)\s*$/.exec(r.headers.get('content-range') || '');
    try { await r.body.cancel(); } catch (_) { /* */ }
    if (r.status === 206 && m) return { url: r.url || url, len: Number(m[1]), ranges: true };
  } catch (e) { if (signal && signal.aborted) throw e; }
  return { url, len: 0, ranges: false };
}

async function getWithRetry(url, headers, signal) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { redirect: 'follow', headers, signal });
    if ((res.status === 429 || res.status === 503) && attempt < 3) { try { await res.body.cancel(); } catch (_) { /* */ } await sleep(waitOf(res, attempt)); continue; }
    if (!res.ok) { try { await res.body.cancel(); } catch (_) { /* */ } const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    return res;
  }
}

/**
 * 받기를 시작한다. 길이를 알면 곧바로 { len, buf, segs, got(), availableFrom(pos), done } 를 돌려준다.
 *  - buf: 길이만큼 미리 잡은 Buffer. 조각이 오는 대로 채워진다 (segs[i].got 바이트씩, 앞에서부터)
 *  - availableFrom(pos): pos 부터 이어서 받아 둔 끝 (그 앞까지 읽어도 됨)
 *  - done: 다 받으면 buf 로 끝남
 * opts: headers, parts(기본 6), maxBytes, onData(), signal
 * 길이를 모르는 서버(드묾)는 len 0 으로 돌려주고 done 에서 전체를 준다.
 */
async function open(url, opts = {}) {
  const headers = opts.headers || {};
  const signal = opts.signal;
  const onData = opts.onData || (() => {});
  let parts = Math.max(1, Math.min(12, opts.parts || 6));
  try { if (SINGLE_HOSTS.test(new URL(url).hostname)) parts = 1; } catch (_) { /* */ }
  const o = {
    len: 0, buf: null, segs: [], done: null,
    got() { return this.segs.reduce((s, g) => s + g.got, 0); },
    availableFrom(pos) {
      for (const g of this.segs) if (pos >= g.a && pos <= g.b) return g.a + g.got > pos ? g.a + g.got : pos;
      return pos;
    },
  };
  // 응답 본문을 buf 의 seg 자리에 채워 넣는다 (seg 끝을 넘는 부분은 버리고 연결을 끊는다)
  async function pump(res, seg) {
    const rd = res.body.getReader();
    for (;;) {
      const room = seg.b + 1 - (seg.a + seg.got);
      if (room <= 0) { try { await rd.cancel(); } catch (_) { /* */ } break; }
      const { done, value } = await rd.read();
      if (done) break;
      const v = value.length > room ? value.subarray(0, room) : value;
      o.buf.set(v, seg.a + seg.got);
      seg.got += v.length;
      onData();
    }
    if (seg.a + seg.got !== seg.b + 1) throw new Error('덜 받았습니다');
  }
  async function wholeFrom(res, knownLen) { // 한 갈래로 전부
    const len = Number(res.headers.get('content-length')) || knownLen || 0;
    if (opts.maxBytes && len > opts.maxBytes) { try { await res.body.cancel(); } catch (_) { /* */ } throw tooBig(); }
    if (!len) { // 길이 모름: 다 모아서
      const chunks = []; let total = 0;
      const rd = res.body.getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(Buffer.from(value)); total += value.length; if (opts.maxBytes && total > opts.maxBytes) throw tooBig(); }
      o.buf = Buffer.concat(chunks); o.len = o.buf.length; o.segs = [{ a: 0, b: o.len - 1, got: o.len }]; onData();
      return Promise.resolve(o.buf);
    }
    o.len = len; o.buf = o.buf && o.buf.length === len ? o.buf : Buffer.allocUnsafe(len);
    o.segs = [{ a: 0, b: len - 1, got: 0 }];
    return pump(res, o.segs[0]).then(() => o.buf);
  }
  const retryable = (seg) => async () => {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const from = seg.a + seg.got; // 끊기면 받은 데서 이어 받기
        const r = await fetch(url2, { redirect: 'follow', headers: { ...headers, Range: `bytes=${from}-${seg.b}` }, signal });
        if (r.status !== 206) { try { await r.body.cancel(); } catch (_) { /* */ } const e = new Error('no-range ' + r.status); e.noRange = true; throw e; } // 429·200 등: 한 갈래로
        await pump(r, seg);
        return;
      } catch (e) {
        if (e.noRange || (signal && signal.aborted)) throw e;
        lastErr = e;
        await sleep(300 * (attempt + 1));
      }
    }
    throw lastErr;
  };
  let url2 = url;

  if (parts < 2) { // 위키미디어 등: 한 갈래
    const res = await getWithRetry(url, headers, signal);
    o.done = wholeFrom(res); o.done.catch(() => {});
    return o;
  }
  // 첫 요청을 바로 'bytes=0-' 로: 길이를 따로 묻지 않고(0.6초 아낌) 앞부분을 받으면서 길이를 알아낸다
  const first = await fetch(url, { redirect: 'follow', headers: { ...headers, Range: 'bytes=0-' }, signal });
  url2 = first.url || url;
  const cr = /\/(\d+)\s*$/.exec(first.headers.get('content-range') || '');
  if (first.status !== 206 || !cr) {
    if (first.ok) { o.done = wholeFrom(first); o.done.catch(() => {}); return o; } // 나눠 받기 안 됨
    try { await first.body.cancel(); } catch (_) { /* */ }
    const res = await getWithRetry(url, headers, signal); // 429 등: 잠시 뒤 한 갈래로
    o.done = wholeFrom(res); o.done.catch(() => {});
    return o;
  }
  const len = Number(cr[1]);
  if (opts.maxBytes && len > opts.maxBytes) { try { await first.body.cancel(); } catch (_) { /* */ } throw tooBig(); }
  const n = Math.max(1, Math.min(parts, Math.floor(len / MIN_PART)));
  o.len = len; o.buf = Buffer.allocUnsafe(len);
  const size = Math.ceil(len / n);
  o.segs = Array.from({ length: n }, (_, i) => ({ a: i * size, b: Math.min(len - 1, i * size + size - 1), got: 0 }));
  const seg0 = o.segs[0];
  const firstJob = pump(first, seg0).catch((e) => { if (signal && signal.aborted) throw e; return retryable(seg0)(); });
  o.done = Promise.all([firstJob, ...o.segs.slice(1).map((s) => retryable(s)())]).then(() => o.buf, async (e) => {
    if (!e.noRange) throw e;
    const res = await getWithRetry(url, headers, signal); // 나눠 받기를 거절하면 처음부터 한 갈래로
    o.segs = []; return wholeFrom(res, len);
  });
  o.done.catch(() => {});
  return o;
}

/** url 을 받아 Buffer 로 돌려준다. opts: headers, parts, maxBytes, onProgress(got, total), signal */
async function download(url, opts = {}) {
  let o = null;
  const tell = () => { if (o && opts.onProgress) opts.onProgress(o.got(), o.len); };
  o = await open(url, { ...opts, onData: tell });
  const buf = await o.done;
  if (opts.onProgress) opts.onProgress(buf.length, buf.length);
  return buf;
}

module.exports = { download, open, probe };
