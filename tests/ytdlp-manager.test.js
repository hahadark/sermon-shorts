'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const m = require('../src/main/ytdlp-manager');
const tools = require('../src/main/tools');

test('오래된 yt-dlp 때문에 나는 오류를 알아본다', () => {
  assert.ok(m.isStaleError('ERROR: unable to download video data: HTTP Error 403: Forbidden'));
  assert.ok(m.isStaleError('WARNING: Your yt-dlp version (2026.07.04) is older than 90 days!'));
  assert.ok(m.isStaleError('ERROR: [youtube] abc: Sign in to confirm you’re not a bot'));
  assert.ok(m.isStaleError('Requested format is not available'));
  assert.ok(!m.isStaleError('ERROR: [youtube] abc: Private video'));
  assert.ok(!m.isStaleError(''));
});

test('관리용 yt-dlp 는 앱 데이터 폴더 bin/ 의 공식 실행 파일', () => {
  assert.equal(tools.managedYtdlp, path.join(tools.dataRoot, 'bin', 'yt-dlp' + tools.EXE));
  assert.equal(typeof tools.ytdlp, 'string');
  assert.equal(tools.ytdlp, tools.ytdlpPath());
  assert.match(m.LATEST_URL, /^https:\/\/github\.com\/yt-dlp\/yt-dlp\/releases\/latest\/download\/yt-dlp/);
});
