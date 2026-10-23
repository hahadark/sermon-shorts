const assert = require('node:assert');
const test = require('node:test');

// Mock window/document for browser-less test
global.window = { SS: {} };
global.SS = global.window.SS;
global.document = {
  addEventListener: () => {}
};

const Keymap = require('../src/renderer/keymap.js');

test('Key normalization', () => {
  const e1 = { key: 's', ctrlKey: true };
  const n1 = Keymap.normalize(e1);
  assert.strictEqual(n1.mods, 'Ctrl');
  assert.strictEqual(n1.key, 'S'); // 글자 키는 대문자로 통일
});

test('Korean IME fallback (e.code)', () => {
  // Simulate Korean 'ㅇ' which is KeyD
  const e = { key: 'ㅇ', code: 'KeyD' };
  assert.strictEqual(Keymap.keyMatches('d', '', 'ㅇ', 'KeyD'), true);
  assert.strictEqual(Keymap.keyMatches('D', '', 'ㅇ', 'KeyD'), true);
});

test('Conflict detection (none should share same key in same mode)', () => {
  const bindings = Keymap.bindings;
  const map = {}; // mode -> key -> id
  
  bindings.forEach(b => {
    b.keys.forEach(k => {
      const mode = b.mode;
      if (!map[mode]) map[mode] = {};
      if (map[mode][k]) {
        throw new Error(`Conflict: ${b.id} and ${map[mode][k]} both use ${k} in mode ${mode}`);
      }
      map[mode][k] = b.id;
    });
  });
});
