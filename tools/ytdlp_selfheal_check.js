// 오래된 yt-dlp 로 시작해도 403 → 자동 업데이트 → 다시 받기가 되는지 확인 (네트워크 필요)
// 사용: node tools/ytdlp_selfheal_check.js [옛 버전 태그, 기본 2026.07.04]
'use strict';
const fs = require('fs');
const path = require('path');
const tools = require('../src/main/tools');
const m = require('../src/main/ytdlp-manager');
const ytpart = require('../src/main/ytpart');

(async () => {
  const tag = process.argv[2] || '2026.07.04';
  const dest = tools.managedYtdlp;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const asset = m.ASSET;
  const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/${asset}`);
  if (!res.ok) throw new Error('옛 버전 받기 실패 ' + res.status);
  if (fs.existsSync(dest)) fs.renameSync(dest, dest + '.old-' + Date.now());
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  // 하루 안에 확인한 것처럼 표시 → 시작할 때는 업데이트하지 않게
  fs.writeFileSync(path.join(tools.cache, 'ytdlp-update.json'), JSON.stringify({ checkedAt: Date.now() - 20 * 60 * 1000, version: tag }));
  m.setLogger((s) => console.log('  [yt-dlp]', s));
  console.log('시작 버전:', await m.versionOf(dest));
  const url = 'https://www.youtube.com/watch?v=uSE5pZB3gtQ';
  const s = 5041.3 + Math.round(Math.random() * 20), e = s + 11.4;   // 1시간 24분 근처, 캐시 안 된 구간
  const t0 = Date.now();
  const r = await ytpart.fetchPart(url, s, e, { pad: 1, noFallback: true }, (p) => { if (p.stage === 'update') console.log('  (업데이트 후 다시 받기)'); });
  console.log('결과:', r.method, 'offset', r.offset.toFixed(2), '파일', path.basename(r.path), ((Date.now() - t0) / 1000).toFixed(1) + '초');
  console.log('끝 버전:', await m.versionOf(dest));
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
