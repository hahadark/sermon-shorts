// 배경음악 계산 비교용 기준값: Electron src/shared/bgm.js · bgm-peaks.js 를 그대로 돌린다 → tests/fixtures/bgm_cases.json
'use strict';
const fs = require('fs'); const path = require('path');
const B = require('F:/aside/sermon-shorts-app/src/shared/bgm.js');
const P = require('F:/aside/sermon-shorts-app/src/shared/bgm-peaks.js');
let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const raws = [null, {}, { id: '' }, { id: 5 }, { id: 'a' }, { id: 'a', duration: 200, trackStart: 10, trackEnd: 10.2 }, { id: 'a', duration: -1, trackStart: 50, trackEnd: 20 }, { id: 'a', duration: 100, trackStart: -5, trackEnd: 500, align: 'end', fadeIn: 40, fadeOut: -1, volume: 3 },
  { id: 'a', trackStart: '5', trackEnd: null, fadeIn: '2', volume: NaN }, { id: 'b', duration: 213, trackStart: 12.345, trackEnd: 98.7654, align: 'end', fadeIn: 1.2345, fadeOut: 2.5, volume: 0.2 }];
for (let k = 0; k < 40; k++) { const d = 30 + rnd() * 300; const a = rnd() * d; raws.push({ id: 't' + k, duration: Math.round(d * 100) / 100, trackStart: Math.round(a * 1000) / 1000, trackEnd: Math.round((a + rnd() * (d - a)) * 1000) / 1000, align: rnd() < 0.5 ? 'end' : 'start', fadeIn: Math.round(rnd() * 50) / 10, fadeOut: Math.round(rnd() * 80) / 10, volume: Math.round(rnd() * 100) / 100 }); }
const durs = [0, -1, 5, 37.5, 60.0333, 129.8975, 400];
const cases = raws.map((r) => ({ raw: r, norm: B.normalize(r), plans: durs.map((d) => { const p = B.plan(r, d); const ts = [-1, 0, 0.3, 1, 2.5, d / 2, d - 1, d, d + 1]; return { d, plan: p, gain: ts.map((t) => [t, B.gainAt(p, t)]), tt: ts.map((t) => [t, B.trackTimeAt(p, t)]), filter: p ? B.ffmpegFilter(p, 4, '[avox]') : null }; }) }));
const fmts = [-3, 0, 0.49, 0.5, 59.5, 61, 3599.4, NaN, 125.5].map((x) => [isNaN(x) ? null : x, B.fmt(x)]);
const peaks = []; P.ids().slice(0, 6).forEach((id) => [10, 420, 600, 1000, 1500].forEach((n) => peaks.push({ id, n, out: P.get(id, n) })));
fs.writeFileSync(path.join(__dirname, 'fixtures', 'bgm_cases.json'), JSON.stringify({ cases, fmts, peaks }));
console.log('배경음악 경우', cases.length, 'fmt', fmts.length, '파형', peaks.length);