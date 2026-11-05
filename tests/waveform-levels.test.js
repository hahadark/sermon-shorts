'use strict';
// 파형: 넓게 볼 때 쓰는 줄인 단계(mip)가 원래 파형의 최소·최대를 그대로 담는지
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const ctx = { window: {}, document: { createElement: () => ({ getContext: () => ({}) }) }, ResizeObserver: class { observe() {} }, requestAnimationFrame: () => 0 };
vm.runInNewContext(fs.readFileSync(require.resolve('../src/renderer/waveform.js'), 'utf8'), ctx);
const build = ctx.window.SS.waveformLevels;
test('줄인 단계: 4배씩, 각 칸은 묶은 칸들의 최소·최대', () => {
  const n = 20000, p = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { p[2 * i] = -((i * 7919) % 101) / 100; p[2 * i + 1] = ((i * 104729) % 97) / 96; }
  const L = build(p, 0.01);
  assert.ok(L.length >= 3);
  for (let k = 1; k < L.length; k++) {
    assert.ok(Math.abs(L[k].bs - L[k - 1].bs * 4) < 1e-12);
    assert.equal(L[k].n, Math.ceil(L[k - 1].n / 4));
    for (const i of [0, 7, L[k].n - 1]) {
      let mn = 0, mx = 0; const src = L[k - 1].p;
      for (let j = i * 4; j < Math.min(L[k - 1].n, i * 4 + 4); j++) { mn = Math.min(mn, src[2 * j]); mx = Math.max(mx, src[2 * j + 1]); }
      assert.equal(L[k].p[2 * i], Math.fround(mn)); assert.equal(L[k].p[2 * i + 1], Math.fround(mx));
    }
  }
  assert.ok(L[L.length - 1].n <= 4096);
});
test('짧은 영상은 줄이지 않는다', () => { assert.equal(build(new Float32Array(2000), 0.01).length, 1); });
