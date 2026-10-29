'use strict';
// 큰 파일을 여러 갈래(Range)로 동시에 받는다. 서버가 나눠 받기를 안 받아 주면 한 갈래로 받는다.
// 배경음악 사이트(incompetech 등)는 한 연결이 느려서 6갈래로 받으면 1.5~7배 빨라진다 (2026-10-28 측정).
// 순수 Node(fetch) 만 쓴다: 앱(main)과 scripts/make_bgm_peaks.js 가 함께 쓴다.

const MIN_PART = 512 * 1024; // 이보다 작게는 나누지 않는다
// 여러 갈래를 막는 곳: 위키미디어는 동시 요청이 많으면 429 를 준다 (한 갈래로도 빠름)
const SINGLE_HOSTS = /(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitOf(res, attempt) {
  const ra = Number(res.headers.get('retry-after'));
  return Math.min(8000, ra > 0 ? ra * 1000 : 800 * Math.pow(2, attempt));
}

async function readAll(res, onChunk) {
  const chunks = [];
  const rd = res.body.getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    if (onChunk) onChunk(value.length);
  }
  return Buffer.concat(chunks);
}

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

async function single(url, { headers, maxBytes, onProgress, signal, total }) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, { redirect: 'follow', headers, signal });
    if ((res.status === 429 || res.status === 503) && attempt < 3) { try { await res.body.cancel(); } catch (_) { /* */ } await sleep(waitOf(res, attempt)); continue; }
    break;
  }
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
  const len = Number(res.headers.get('content-length')) || total || 0;
  if (maxBytes && len > maxBytes) throw new Error('파일이 너무 큽니다.');
  let got = 0;
  const buf = await readAll(res, (n) => {
    got += n;
    if (maxBytes && got > maxBytes) throw new Error('파일이 너무 큽니다.');
    if (onProgress) onProgress(got, len);
  });
  return buf;
}

/**
 * url 을 받아 Buffer 로 돌려준다.
 * opts: headers, parts(기본 6), maxBytes, onProgress(got, total), signal
 */
async function download(url, opts = {}) {
  const headers = opts.headers || {};
  let parts = Math.max(1, Math.min(12, opts.parts || 6));
  try { if (SINGLE_HOSTS.test(new URL(url).hostname)) parts = 1; } catch (_) { /* */ }
  if (parts < 2) return single(url, { ...opts, headers });
  const info = await probe(url, headers, opts.signal);
  if (opts.maxBytes && info.len > opts.maxBytes) throw new Error('파일이 너무 큽니다.');
  const n = info.ranges && info.len ? Math.min(parts, Math.floor(info.len / MIN_PART)) : 1;
  if (n < 2) return single(info.url, { ...opts, headers, total: info.len });

  const size = Math.ceil(info.len / n);
  const got = new Array(n).fill(0);
  const tell = () => { if (opts.onProgress) opts.onProgress(got.reduce((a, b) => a + b, 0), info.len); };
  const part = async (i) => {
    const a = i * size, b = Math.min(info.len - 1, a + size - 1);
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      got[i] = 0;
      try {
        const r = await fetch(info.url, { redirect: 'follow', headers: { ...headers, Range: `bytes=${a}-${b}` }, signal: opts.signal });
        if (r.status !== 206) { try { await r.body.cancel(); } catch (_) { /* */ } const e = new Error('no-range ' + r.status); e.noRange = true; throw e; } // 429·200 등: 한 갈래로
        const buf = await readAll(r, (k) => { got[i] += k; tell(); });
        if (buf.length !== b - a + 1) throw new Error('조각 길이가 맞지 않습니다');
        return buf;
      } catch (e) {
        if (e.noRange || (opts.signal && opts.signal.aborted)) throw e;
        lastErr = e;
      }
    }
    throw lastErr;
  };
  try {
    const bufs = await Promise.all(Array.from({ length: n }, (_, i) => part(i)));
    return Buffer.concat(bufs);
  } catch (e) {
    if (e.noRange) return single(info.url, { ...opts, headers, total: info.len });
    throw e;
  }
}

module.exports = { download, probe };
