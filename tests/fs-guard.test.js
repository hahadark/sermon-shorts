const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const guard = require('../src/main/fs-guard.js');
const { srtPathOf } = require('../src/main/render.js');

const base = path.join(os.tmpdir(), 'ss-guard');
const cache = path.join(base, 'cache');

test('fs guard allows cache contents and chosen files only', () => {
  guard.reset();
  guard.allowRoot(cache);
  const chosen = guard.allowFile(path.join(base, 'docs', 'sermon.sshorts'));
  assert.strictEqual(guard.check(cache), path.resolve(cache));
  assert.strictEqual(guard.check(path.join(cache, 'export_1', 'title.png')), path.resolve(cache, 'export_1', 'title.png'));
  assert.strictEqual(guard.check(chosen), path.resolve(chosen));
  assert.throws(() => guard.check(path.join(base, 'docs', 'other.sshorts')), /허용되지 않은 경로/);
  assert.throws(() => guard.check(path.join(cache, '..', 'settings.json')), /허용되지 않은 경로/);
  assert.throws(() => guard.check(cache + '-evil/x.json'), /허용되지 않은 경로/);
  assert.throws(() => guard.check(''), /비어/);
  assert.throws(() => guard.check(null), /비어/);
  guard.reset();
});

test('SRT path never equals the exported video path', () => {
  assert.strictEqual(srtPathOf('C:/out/쇼츠.mp4'), 'C:/out/쇼츠.srt');
  assert.strictEqual(srtPathOf('C:/out/쇼츠.MP4'), 'C:/out/쇼츠.srt');
  assert.strictEqual(srtPathOf('C:/out/쇼츠'), 'C:/out/쇼츠.srt');
});

test('setup links are fixed https pages and unknown keys are refused', () => {
  const setup = require('../src/main/setup.js');
  for (const url of Object.values(setup.LINKS)) assert.match(url, /^https:\/\//);
  assert.strictEqual(setup.openLink('file:///C:/Windows').ok, false);
  assert.strictEqual(setup.openLink('https://example.com').ok, false);
});
