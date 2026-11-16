// 유튜브 가져오기 계산 비교 자료 (Electron edl.js · ytpart.js · ytdlp-manager.js · engine.js 규칙)
const E = require('F:/aside/sermon-shorts-app/src/shared/edl.js');
const P = require('F:/aside/sermon-shorts-app/src/main/ytpart.js');
const M = require('F:/aside/sermon-shorts-app/src/main/ytdlp-manager.js');
const crypto = require('crypto'); const fs = require('fs'); const { execFileSync } = require('child_process');
(async () => {
  const urls = ['https://www.youtube.com/watch?v=jNQXAC9IVRw', 'youtu.be/jNQXAC9IVRw?t=90', 'https://youtube.com/shorts/abcDEF12345', 'https://m.youtube.com/watch?v=9Tmjg3ESEyc&t=14m30s', 'https://www.youtube.com/live/uSE5pZB3gtQ?si=x', 'https://music.youtube.com/watch?v=abcdef#t=1h2m3s', 'https://example.com/watch?v=abc', 'nonsense', 'https://www.youtube.com/watch?v=ab', 'https://www.youtube.com/embed/XYZxyz123?start=45'];
  const times = ['14:30', '1:02:03', '870.5', '61:00', '1:61:00', '00:00', '', 'x', '12:34.5'];
  const ranges = ['14:30 ~ 38:50', '14:30-38:50', '14:30 – 16:00', '16:00 ~ 14:30', '1:00:00 ~ 1:02:00', 'abc'];
  const ytt = ['870', '870s', '14m30s', '1h2m3s', 'h', '', '1.5'];
  const errs = ['ERROR: HTTP Error 403: Forbidden', 'Sign in to confirm you are not a bot', 'fine', 'nsig extraction failed'];
  const ytdlp = 'C:/Users/Administrator/AppData/Roaming/SermonShorts/runtime/bin/yt-dlp.exe';
  const info = JSON.parse(execFileSync(ytdlp, ['-J', '--no-playlist', '--', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'], { maxBuffer: 64e6, encoding: 'utf8' }));
  const picked = P.pickFormats(info.formats || []);
  let sidx = null, head = null;
  if (picked.video) {
    const r = await fetch(picked.video.url + '&range=0-262143');
    const buf = Buffer.from(await r.arrayBuffer()); head = buf.toString('base64');
    sidx = P.parseSidx(buf);
  }
  const keyOf = (p, s, e) => crypto.createHash('md5').update(`${p}_${s}_${e}`).digest('hex');
  fs.writeFileSync('tests/fixtures/youtube_cases.json', JSON.stringify({
    urls: urls.map((u) => ({ u, r: E.parseYoutubeUrl(u), id: P.videoIdOf(u) })),
    times: times.map((t) => ({ t, r: E.parseTimecode(t) })), ranges: ranges.map((t) => ({ t, r: E.parseRange(t) })),
    errs: errs.map((t) => ({ t, r: M.isStaleError(t) })),
    formats: info.formats, picked: { video: picked.video && picked.video.format_id, audio: picked.audio && picked.audio.format_id, preview: picked.preview && picked.preview.format_id },
    head, sidx, sel: sidx ? P.selectRefs(sidx.refs, 3, 9) : null,
    cache: [['F:\\v\\a.mp4', 0, undefined], ['F:\\v\\a.mp4', 14.5, 30], ['C:\\x y\\b.mp4', 1413, 1520.25]].map(([p, s, e]) => ({ p, s: s === undefined ? null : s, e: e === undefined ? null : e, hash: keyOf(p, s, e), file: `transcript_${s}_${e}.json` })),
  }));
  console.log('formats', info.formats.length, 'picked', JSON.stringify({ v: picked.video && picked.video.format_id, a: picked.audio && picked.audio.format_id, p: picked.preview && picked.preview.format_id }), 'sidx refs', sidx ? sidx.refs.length : null);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
