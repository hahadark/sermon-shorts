'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const sp = require('../src/main/materials-speech');
const I = sp._internal;

const voices = [
  { id: 'Microsoft David Desktop', name: 'Microsoft David Desktop', lang: 'en-US' },
  { id: 'Microsoft Heami Desktop', name: 'Microsoft Heami Desktop', lang: 'ko-KR' },
  { id: 'Other Ko', name: 'Other Ko', lang: 'ko-KR' },
];

test('pickVoice: Heami 우선, 영어 대체 금지', () => {
  assert.strictEqual(I.pickVoice(voices).id, 'Microsoft Heami Desktop');
  assert.throws(() => I.pickVoice([voices[0]]), /한국어 음성이 없습니다/);
  assert.throws(() => I.pickVoice(voices, 'Microsoft David Desktop'), /한국어 음성이 아닙니다/);
  assert.throws(() => I.pickVoice(voices, 'Nope'), /찾을 수 없습니다/);
});

test('파서', () => {
  assert.deepStrictEqual(I.parseWinList('A B\tko-KR\nC\ten-US'), [
    { id: 'A B', name: 'A B', lang: 'ko-KR' }, { id: 'C', name: 'C', lang: 'en-US' }]);
  const r = I.parseSayList('Yuna                ko_KR    # 안녕하세요\nGrandma (English (US)) en_US    # Hello');
  assert.strictEqual(r[0].lang, 'ko-KR');
  assert.strictEqual(r[0].id, 'Yuna');
});

test('입력 검증', () => {
  assert.throws(() => I.validateText(''), /비어/);
  assert.throws(() => I.validateText(null), /없습니다/);
  assert.throws(() => I.validateText('가'.repeat(sp.MAX_CHARS + 1)), /너무 깁니다/);
  assert.strictEqual(I.validateText(' <speak>x</speak> '), '<speak>x</speak>');
  assert.strictEqual(I.validateRate(99), 10);
  assert.strictEqual(I.validateRate(undefined), 0);
  assert.throws(() => I.validateRate('abc'), /숫자/);
});

test('synthesize: 동시 실행 거부, 임시파일 정리, 명령 주입 문자열은 인자로만', async () => {
  const b = I.backend; const orig = { ...b };
  const plat = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  let captured, release;
  b.listWin = async () => voices;
  b.synthWin = (text, voice, rate, out) => { captured = { text, voice, out }; fs.writeFileSync(out, Buffer.alloc(200)); return new Promise(r => { release = r; }); };
  try {
    const evil = '"; calc & $(x) <speak>';
    const p1 = sp.synthesize({ text: evil });
    await new Promise(r => setTimeout(r, 20));
    await assert.rejects(sp.synthesize({ text: 'b' }), /진행 중/);
    release();
    const res = await p1;
    assert.strictEqual(res.format, 'wav');
    assert.strictEqual(captured.text, evil);
    assert.strictEqual(captured.voice, 'Microsoft Heami Desktop');
    fs.rmSync(res.path, { force: true });
    // 실패 시 출력 파일 정리 + busy 해제
    b.synthWin = async (t, v, r, out) => { fs.writeFileSync(out, 'x'); throw new Error('boom'); };
    await assert.rejects(sp.synthesize({ text: 'a' }), /boom/);
    assert.strictEqual(fs.existsSync(captured.out) && false, false);
    assert.strictEqual(I.isBusy(), false);
    // 한국어 음성 없음
    b.listWin = async () => [voices[0]];
    await assert.rejects(sp.synthesize({ text: 'a' }), /한국어 음성이 없습니다/);
  } finally {
    Object.assign(b, orig);
    Object.defineProperty(process, 'platform', plat);
  }
});
