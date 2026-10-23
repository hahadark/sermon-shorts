'use strict';
// yt-dlp + JS 런타임 확인 (네트워크 필요). 사용: node scripts/check_ytdlp.js [URL]
const youtube = require('../src/main/youtube');

(async () => {
  const url = process.argv[2] || 'https://www.youtube.com/watch?v=9Tmjg3ESEyc';
  const rt = youtube.getJsRuntime();
  console.log('JS runtime:', rt.label, rt.kind, rt.version || '', rt.path);
  const t0 = Date.now();
  const info = await youtube.fetchInfo(url);
  console.log('fetchInfo OK:', info.id, info.title, info.duration + 's', (Date.now() - t0) + 'ms');
  const subs = await youtube.fetchAutoSubs(url);
  console.log('fetchAutoSubs:', subs ? subs.lines.length + ' lines, first: ' + (subs.lines[0] && subs.lines[0].text) : 'none');
  process.exit(subs && subs.lines.length ? 0 : 1);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
