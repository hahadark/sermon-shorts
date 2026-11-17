'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
// electron 없이 순수 함수만 시험
const orig = Module._load;
Module._load = function (req, ...rest) { if (req === 'electron') return { app: {}, ipcMain: {}, shell: {} }; return orig.call(this, req, ...rest); };
const { pickRust } = require('../src/main/updater.js');
Module._load = orig;

test('Rust판 정식 릴리스를 찾는다 (사전 공개·초안·Electron 릴리스는 건너뜀)', () => {
  const list = [
    { tag_name: 'v0.3.27', prerelease: false, html_url: 'e' },
    { tag_name: 'rust-v0.4.1-beta.1', prerelease: true, html_url: 'b' },
    { tag_name: 'rust-v0.4.0', prerelease: false, draft: true, html_url: 'd' },
    { tag_name: 'rust-v0.4.0', prerelease: false, html_url: 'https://x/rust-v0.4.0' },
  ];
  assert.deepStrictEqual(pickRust(list), { version: '0.4.0', url: 'https://x/rust-v0.4.0' });
});
test('Rust판 정식이 없으면 null (베타만 있을 때)', () => {
  assert.strictEqual(pickRust([{ tag_name: 'rust-v0.4.0-beta.2', prerelease: true }, { tag_name: 'v0.3.26' }]), null);
  assert.strictEqual(pickRust(null), null);
});
