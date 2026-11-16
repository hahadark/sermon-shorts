// 목소리 크기 계산 비교용 기준값: Electron src/shared/voice.js 를 그대로 돌린다 → tests/fixtures/voice_cases.json
'use strict';
const fs = require('fs'); const path = require('path');
const V = require('F:/aside/sermon-shorts-app/src/shared/voice.js');
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const raws = [null, undefined, 5, 'x', {}, { mode: 'auto' }, { mode: 'manual', gainDb: 7.26 }, { mode: 'manual', gainDb: 40 }, { mode: 'manual', gainDb: -30 }, { mode: 'manual', gainDb: '3.04' },
  { mode: 'off', even: 1 }, { mode: 'auto', measured: { i: -23.456, tp: -3.21, lra: 7.77, key: 'k', even: 0 } }, { mode: 'auto', measured: { i: -70.2, tp: -60, lra: 0 } },
  { mode: 'auto', even: true, measured: { i: '-18.05', tp: null, key: 5, even: 'y' } }, { mode: 'auto', measured: { i: null } }, { mode: 'auto', measured: { i: 'abc' } }, { mode: 'auto', measured: { i: -2 } },
  { mode: 'auto', measured: { i: -40 } }, { mode: 'manual', gainDb: 0.04 }, { mode: 'manual', gainDb: -0.05 }, { mode: 'MANUAL', gainDb: 3 }, { mode: 'manual', gainDb: null, even: '' }];
for (let k = 0; k < 40; k++) raws.push({ mode: ['off', 'auto', 'manual'][Math.floor(rnd() * 3)], gainDb: Math.round((rnd() * 40 - 15) * 100) / 100, even: rnd() < 0.5, measured: rnd() < 0.7 ? { i: Math.round((rnd() * -50 - 5) * 1000) / 1000, tp: -rnd() * 10, lra: rnd() * 15, key: 'k' + Math.floor(rnd() * 3), even: rnd() < 0.5 } : null });
const cases = raws.map((r) => { const n = V.normalize(r); return { raw: r === undefined ? '__undef__' : r, norm: n, isOn: V.isOn(r), gain: V.gainDb(r), filter: V.ffmpegFilter(r, '[acat]', '[avox]'), analysis: V.analysisFilter(r), describe: V.describe(r), fitsK0: V.measuredFits(r, 'k0'), fitsK: V.measuredFits(r, 'k') }; });
const segsets = [[], [{ start: 0, end: 1 }], [{ start: 1.234, end: 5.675 }, { start: 7.005, end: 9.995 }]];
for (let k = 0; k < 20; k++) { const a = []; let t = rnd() * 100; for (let j = 0; j < 1 + Math.floor(rnd() * 40); j++) { const s = t + rnd() * 3; const e = s + 0.2 + rnd() * 8; a.push({ start: Math.round(s * 1000) / 1000, end: Math.round(e * 1000) / 1000 }); t = e; } segsets.push(a); }
const keys = segsets.map((s) => ({ segs: s.map((x) => [x.start, x.end]), key: V.segKey(s) }));
const logs = ['', 'noise', '[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-23.45",\n\t"input_tp" : "-4.20",\n\t"input_lra" : "6.70",\n\t"target_offset" : "0.1"\n}\n', '{ "input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0.00" }', '{ "input_i" : "-30.0", "input_tp" : "-5" ', '} {', '{"input_i": -12.5, "input_tp": "x"}'];
const loud = logs.map((t) => ({ text: t, out: V.parseLoudnorm(t) }));
fs.writeFileSync(path.join(__dirname, 'fixtures', 'voice_cases.json'), JSON.stringify({ cases, keys, loud, comp: V.compFilter(), limiter: V.limiterFilter() }));
console.log('목소리 경우', cases.length, '구간 열쇠', keys.length, 'loudnorm', loud.length);