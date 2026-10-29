'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildMetadata } = require('../src/main/youtube-upload');

test('upload metadata adds #Shorts, keeps title within 100 chars, defaults to unlisted', () => {
  const m = buildMetadata({ title: '두려움을 이기는 믿음', verse: '수 1:9', church: '은혜교회', speaker: '홍길동 목사' });
  assert.equal(m.snippet.title, '두려움을 이기는 믿음 #Shorts');
  assert.match(m.snippet.description, /^수 1:9\n은혜교회 · 홍길동 목사\n\n#Shorts/);
  assert.equal(m.status.privacyStatus, 'unlisted');
  assert.equal(m.status.selfDeclaredMadeForKids, false);

  const long = buildMetadata({ title: '가'.repeat(150), privacy: 'public' });
  assert.ok(long.snippet.title.length <= 100);
  assert.ok(long.snippet.title.endsWith(' #Shorts'));
  assert.equal(long.status.privacyStatus, 'public');

  assert.equal(buildMetadata({ title: '<b>제목</b> #shorts', privacy: 'weird' }).snippet.title, 'b제목/b #shorts');
  assert.equal(buildMetadata({}).status.privacyStatus, 'unlisted');
  assert.equal(buildMetadata({}).snippet.title, '설교 쇼츠 #Shorts');
});
