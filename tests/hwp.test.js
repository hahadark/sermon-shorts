'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { hwpText, hwpxText, paraText } = require('../src/main/hwp.js');

// ---- 아주 작은 HWP(복합 문서) 만들기: FileHeader + BodyText/Section0 (작은 스트림은 미니 스트림에) ----
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function record(tag, data) { return Buffer.concat([u32(tag | (data.length << 20)), data]); }
function para(text) { // 문단 글: 표 컨트롤(8글자) 하나 + 글 + 문단 끝(13)
  const ctrl = Buffer.alloc(16); ctrl.writeUInt16LE(11, 0);
  return Buffer.concat([ctrl, Buffer.from(text, 'utf16le'), Buffer.from([13, 0])]);
}
function dirEntry(name, type, child, left, right, start, size) {
  const e = Buffer.alloc(128, 0);
  const n = Buffer.from(name + '\0', 'utf16le'); n.copy(e, 0); e.writeUInt16LE(n.length, 64);
  e[66] = type; e[67] = 1;
  e.writeUInt32LE(left, 68); e.writeUInt32LE(right, 72); e.writeUInt32LE(child, 76);
  e.writeUInt32LE(start, 116); e.writeUInt32LE(size, 120);
  return e;
}
function buildHwp(paras, { compressed = true, flags = 0 } = {}) {
  const NONE = 0xFFFFFFFF, END = 0xFFFFFFFE;
  const head = Buffer.alloc(256, 0); head.write('HWP Document File', 0, 'latin1'); head.writeUInt32LE((compressed ? 1 : 0) | flags, 36);
  let sec = Buffer.concat(paras.map((p) => record(67, para(p))));
  if (compressed) sec = zlib.deflateRawSync(sec);
  // 미니 스트림 (64바이트 단위): FileHeader, Section0
  const pad = (b, n) => Buffer.concat([b, Buffer.alloc((n - (b.length % n)) % n)]);
  const h64 = pad(head, 64), s64 = pad(sec, 64);
  const mini = Buffer.concat([h64, s64]);
  const hN = h64.length / 64, sN = s64.length / 64;
  const miniFat = [];
  for (let i = 0; i < hN; i++) miniFat.push(i === hN - 1 ? END : i + 1);
  for (let i = 0; i < sN; i++) miniFat.push(i === sN - 1 ? END : hN + i + 1);
  // 섹터(512): 0=FAT, 1=디렉터리(4개 항목), 2=미니FAT, 3..=미니 스트림
  const miniSecs = Math.ceil(mini.length / 512);
  const fat = new Array(128).fill(NONE);
  fat[0] = 0xFFFFFFFD; fat[1] = END; fat[2] = END;
  for (let i = 0; i < miniSecs; i++) fat[3 + i] = i === miniSecs - 1 ? END : 4 + i;
  // 디렉터리: 0 Root(child=1) / 1 FileHeader(right=2) / 2 BodyText(storage, child=3) / 3 Section0
  const dir = Buffer.concat([
    dirEntry('Root Entry', 5, 1, NONE, NONE, 3, mini.length),
    dirEntry('FileHeader', 2, NONE, NONE, 2, 0, head.length),
    dirEntry('BodyText', 1, 3, NONE, NONE, 0, 0),
    dirEntry('Section0', 2, NONE, NONE, NONE, hN, sec.length),
  ]);
  const hdr = Buffer.alloc(512, 0);
  hdr.writeUInt32LE(0xE011CFD0, 0); hdr.writeUInt32LE(0xE11AB1A1, 4);
  hdr.writeUInt16LE(0x3E, 0x18); hdr.writeUInt16LE(3, 0x1A); hdr.writeUInt16LE(0xFFFE, 0x1C);
  hdr.writeUInt16LE(9, 0x1E); hdr.writeUInt16LE(6, 0x20);
  hdr.writeUInt32LE(1, 0x2C); hdr.writeUInt32LE(1, 0x30); hdr.writeUInt32LE(4096, 0x38);
  hdr.writeUInt32LE(2, 0x3C); hdr.writeUInt32LE(1, 0x40); hdr.writeUInt32LE(END, 0x44); hdr.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) hdr.writeUInt32LE(i === 0 ? 0 : NONE, 0x4C + i * 4);
  const fatSec = Buffer.concat(fat.map(u32));
  const dirSec = pad(dir, 512);
  const mfSec = pad(Buffer.concat(miniFat.map(u32).concat(new Array(128 - miniFat.length).fill(u32(NONE)))), 512);
  return Buffer.concat([hdr, fatSec, dirSec, mfSec, pad(mini, 512)]);
}

test('HWP: 압축된 본문에서 문단 글 꺼내기 (표 컨트롤 건너뜀)', () => {
  const t = hwpText(buildHwp(['염려를 기도로 바꾸라', '빌립보서 4:6-7 말씀입니다.']));
  assert.strictEqual(t, '염려를 기도로 바꾸라\n빌립보서 4:6-7 말씀입니다.');
});
test('HWP: 압축하지 않은 문서도', () => {
  assert.strictEqual(hwpText(buildHwp(['첫째, 감사함으로'], { compressed: false })), '첫째, 감사함으로');
});
test('HWP: 암호·배포용·다른 파일은 알기 쉬운 오류', () => {
  assert.throws(() => hwpText(buildHwp(['x'], { flags: 2 })), /암호/);
  assert.throws(() => hwpText(buildHwp(['x'], { flags: 4 })), /배포용/);
  assert.throws(() => hwpText(Buffer.from('그냥 글 파일입니다'.repeat(60))), /HWP\) 파일 형식이 아닙니다/);
});
test('HWP 문단 글: 탭·묶음 빈칸·줄바꿈', () => {
  const tab = Buffer.alloc(16); tab.writeUInt16LE(9, 0);
  const b = Buffer.concat([Buffer.from('가', 'utf16le'), tab, Buffer.from('나', 'utf16le'), Buffer.from([30, 0, 10, 0]), Buffer.from('다', 'utf16le')]);
  assert.strictEqual(paraText(b), '가\t나 \n다');
});
test('HWPX: section XML 의 글·탭·특수문자', async () => {
  const JSZip = require('jszip');
  const z = new JSZip();
  z.file('mimetype', 'application/hwp+zip');
  z.file('Contents/section0.xml', '<?xml version="1.0"?><hs:sec xmlns:hs="x" xmlns:hp="y"><hp:p id="1"><hp:run><hp:t>염려를 기도로</hp:t></hp:run></hp:p><hp:p id="2"><hp:run><hp:t>첫째,<hp:tab/>정체 &amp; &lt;특수&gt;</hp:t></hp:run></hp:p></hs:sec>');
  z.file('Contents/section1.xml', '<hs:sec xmlns:hp="y"><hp:p><hp:run><hp:t>둘째 구역</hp:t></hp:run></hp:p></hs:sec>');
  const buf = await z.generateAsync({ type: 'nodebuffer' });
  assert.strictEqual(await hwpxText(buf), '염려를 기도로\n첫째,\t정체 & <특수>\n둘째 구역');
  await assert.rejects(() => hwpxText(Buffer.from('zip 아님')), /HWPX/);
});
