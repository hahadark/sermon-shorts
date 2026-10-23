'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const youtube = require('../src/main/youtube');
const path = require('path');
const { spawnSync } = require('child_process');

test('youtube API integration', { skip: process.env.SS_NET_TESTS !== '1' }, async (t) => {
  const url = 'https://www.youtube.com/watch?v=9Tmjg3ESEyc';
  
  await t.test('fetchInfo', async () => {
    const info = await youtube.fetchInfo(url);
    assert.ok(info.title);
    assert.ok(info.duration > 0);
  });

  await t.test('fetchAutoSubs', async () => {
    const subs = await youtube.fetchAutoSubs(url);
    if (subs) {
      assert.ok(subs.lines.length > 0);
    }
  });

  await t.test('downloadSection', async () => {
    // 30 seconds starting from 870
    const dl = await youtube.downloadSection(url, 870, 900, { pad: 10 }, () => {});
    assert.ok(dl.path);
    const ffprobe = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
    const ff = spawnSync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      dl.path
    ]);
    const probeData = JSON.parse(ff.stdout.toString());
    assert.ok(probeData.format.duration > 0);
  });
});
