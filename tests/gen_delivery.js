// Electron 의 설교 전달 점검(src/shared/delivery.js)·원고 파일 읽기(hwp.js·docxText)로 tests/fixtures/delivery_cases.json · files_cases.json 을 만든다.
// node tests/gen_delivery.js <sermon-shorts-app 경로>
'use strict';
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const APP = process.argv[2] || 'F:/aside/sermon-shorts-app';
const D = require(path.join(APP, 'src/shared/delivery.js'));
const H = require(path.join(APP, 'src/main/hwp.js'));
const { docxText } = (() => { try { return require(path.join(APP, 'src/main/materials.js')); } catch (_) { return {}; } })();
// ---- 전달 점검: 일부러 쉼·군말·반복·구간 경계를 섞은 자막
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pool = ['하나님은', '우리를', '사랑하십니다', '음', '어...', '그…', '그', '은혜', '은혜', 'Jesus', '2026년', '말씀을', '들으라', '으음', '뭐~', '기도합시다.', '!!', ' '];
const sets = [];
for (const n of [0, 1, 5, 40, 400]) {
  const ws = []; let t = 3.2;
  for (let i = 0; i < n; i++) { const d = 0.2 + rnd() * 0.9; ws.push({ text: pool[Math.floor(rnd() * pool.length)], start: +t.toFixed(3), end: +(t + d).toFixed(3) }); t += d + (rnd() < 0.05 ? 2 + rnd() * 6 : rnd() * 0.4 - 0.05); }
  if (n === 40) ws.push({ text: '나쁜', start: 5, end: 4 }, { text: '', start: 1, end: 2 }, { text: '겹침', start: 10, end: 75 });
  sets.push(ws);
}
const delivery = sets.map((w) => ({ words: w, report: D.analyze(w), text: D.toText(D.analyze(w), '시험 라벨') }));
fs.writeFileSync(path.join(__dirname, 'fixtures/delivery_cases.json'), JSON.stringify({ delivery, times: [0, 59.9, 61, 3599, 3600, 3725.5, -3].map((n) => [n, D.time(n)]) }));
// ---- 원고 파일 (아주 작은 HWP 만들기: 기존 tests/hwp.test.js 와 같은 방법)
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function record(tag, data) { return Buffer.concat([u32(tag | (data.length << 20)), data]); }
function para(text) { const ctrl = Buffer.alloc(16); ctrl.writeUInt16LE(11, 0); return Buffer.concat([ctrl, Buffer.from(text, 'utf16le'), Buffer.from([13, 0])]); }
function dirEntry(name, type, child, left, right, start, size) { const e = Buffer.alloc(128, 0); const n = Buffer.from(name + '\0', 'utf16le'); n.copy(e, 0); e.writeUInt16LE(n.length, 64); e[66] = type; e[67] = 1; e.writeUInt32LE(left, 68); e.writeUInt32LE(right, 72); e.writeUInt32LE(child, 76); e.writeUInt32LE(start, 116); e.writeUInt32LE(size, 120); return e; }
function buildHwp(paras, { compressed = true, flags = 0 } = {}) {
  const NONE = 0xFFFFFFFF, END = 0xFFFFFFFE;
  const head = Buffer.alloc(256, 0); head.write('HWP Document File', 0, 'latin1'); head.writeUInt32LE((compressed ? 1 : 0) | flags, 36);
  let sec = Buffer.concat(paras.map((p) => record(67, para(p))));
  if (compressed) sec = zlib.deflateRawSync(sec);
  const pad = (b, n) => Buffer.concat([b, Buffer.alloc((n - (b.length % n)) % n)]);
  const h64 = pad(head, 64), s64 = pad(sec, 64); const mini = Buffer.concat([h64, s64]);
  const hN = h64.length / 64, sN = s64.length / 64; const miniFat = [];
  for (let i = 0; i < hN; i++) miniFat.push(i === hN - 1 ? END : i + 1);
  for (let i = 0; i < sN; i++) miniFat.push(i === sN - 1 ? END : hN + i + 1);
  const miniSecs = Math.ceil(mini.length / 512); const fat = new Array(128).fill(NONE);
  fat[0] = 0xFFFFFFFD; fat[1] = END; fat[2] = END;
  for (let i = 0; i < miniSecs; i++) fat[3 + i] = i === miniSecs - 1 ? END : 4 + i;
  const dir = Buffer.concat([dirEntry('Root Entry', 5, 1, NONE, NONE, 3, mini.length), dirEntry('FileHeader', 2, NONE, NONE, 2, 0, head.length), dirEntry('BodyText', 1, 3, NONE, NONE, 0, 0), dirEntry('Section0', 2, NONE, NONE, NONE, hN, sec.length)]);
  const hdr = Buffer.alloc(512, 0);
  hdr.writeUInt32LE(0xE011CFD0, 0); hdr.writeUInt32LE(0xE11AB1A1, 4); hdr.writeUInt16LE(0x3E, 0x18); hdr.writeUInt16LE(3, 0x1A); hdr.writeUInt16LE(0xFFFE, 0x1C); hdr.writeUInt16LE(9, 0x1E); hdr.writeUInt16LE(6, 0x20);
  hdr.writeUInt32LE(1, 0x2C); hdr.writeUInt32LE(1, 0x30); hdr.writeUInt32LE(4096, 0x38); hdr.writeUInt32LE(2, 0x3C); hdr.writeUInt32LE(1, 0x40); hdr.writeUInt32LE(END, 0x44); hdr.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) hdr.writeUInt32LE(i === 0 ? 0 : NONE, 0x4C + i * 4);
  return Buffer.concat([hdr, Buffer.concat(fat.map(u32)), pad(dir, 512), pad(Buffer.concat(miniFat.map(u32).concat(new Array(128 - miniFat.length).fill(u32(NONE)))), 512), pad(mini, 512)]);
}
const tryv = (f) => { try { return { ok: f() }; } catch (e) { return { err: e.message }; } };
const long = Array.from({ length: 60 }, (_, i) => `${i + 1}. 염려를 기도로 바꾸라 \t탭 · 빌립보서 4:6-7`);
const hwps = [buildHwp(['염려를 기도로 바꾸라', '빌립보서 4:6-7 말씀입니다.']), buildHwp(['첫째, 감사함으로'], { compressed: false }), buildHwp(['x'], { flags: 2 }), buildHwp(['x'], { flags: 4 }), Buffer.from('그냥 글 파일입니다'.repeat(60)), buildHwp(long)];
const xmls = ['<hs:sec><hp:p id="1"><hp:run><hp:t>첫 문단 &amp; &lt;표시&gt; &#44032;&#x AC00;</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>둘<hp:tab/>째</hp:t><hp:lineBreak/><hp:t>줄</hp:t><hp:t/></hp:run></hp:p><hp:p></hp:p></hs:sec>'];
fs.writeFileSync(path.join(__dirname, 'fixtures/files_cases.json'), JSON.stringify({
  hwp: hwps.map((b) => ({ b64: b.toString('base64'), out: tryv(() => H.hwpText(b)) })),
  xml: xmls.map((x) => ({ x, out: H.xmlText(x) })),
  para: [Buffer.from([0x41, 0, 9, 0, ...new Array(14).fill(0), 0x42, 0, 30, 0, 24, 0, 13, 0, 11, 0, ...new Array(14).fill(0), 0x43, 0])].map((b) => ({ b64: b.toString('base64'), out: H.paraText(b) })),
}));
console.log('ok', delivery.length);
