// 배경음악 곡 목록·파형 자료를 Rust 판 assets 로 옮긴다 (Electron src/shared/bgm-catalog.js · bgm-peaks.js 에서 그대로)
//   node tools/gen_bgm_assets.js
'use strict';
const fs = require('fs'); const path = require('path');
const APP = 'F:/aside/sermon-shorts-app/src/shared/';
const cat = require(APP + 'bgm-catalog.js');
const src = fs.readFileSync(APP + 'bgm-peaks.js', 'utf8');
// DATA 를 직접 읽는다 (get() 은 n 칸으로 바꾼 값만 주므로)
const m = /var BINS = (\d+);\s*var DATA = (\{[\s\S]*?\n  \});/.exec(src);
if (!m) throw new Error('bgm-peaks.js 형식이 바뀌었습니다');
const data = Function('"use strict"; return (' + m[2] + ');')();
const out = path.join(__dirname, '..', 'assets', 'bgm');
fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify({ moods: cat.MOODS, tracks: cat.tracks }, null, 1));
fs.writeFileSync(path.join(out, 'peaks.json'), JSON.stringify({ bins: Number(m[1]), data }));
console.log('곡', cat.tracks.length, '분위기', cat.MOODS.length, '파형', Object.keys(data).length);