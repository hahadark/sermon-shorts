// edl.js snap 비교 자료 (정해진 흔들림의 가짜 소리)
const E = require('F:/aside/sermon-shorts-app/src/shared/edl.js');
const fs = require('fs');
const rate = 8000, n = 8000 * 2;
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pcm = []; for (let i = 0; i < n; i++) { const t = i / rate; const env = (t > 0.6 && t < 0.75) || (t > 1.3 && t < 1.32) ? 0.002 : 0.4; pcm.push(Math.fround(env * Math.sin(2 * Math.PI * 220 * t + rnd()) + (rnd() - 0.5) * 0.01)); }
const cases = [];
for (const t of [0.1, 0.5, 0.68, 0.9, 1.25, 1.31, 1.9, 1.99]) for (const mode of ['zero', 'silence']) for (const w of [0.05, 0.002]) cases.push({ t, mode, w, out: E.snap(pcm, rate, t, mode, w) });
fs.writeFileSync('tests/fixtures/snap_cases.json', JSON.stringify({ rate, pcm, cases }));
console.log('snap cases', cases.length);
