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

test('완성 영상 창에서 고친 설명은 그대로, 비우면 비운 대로', () => {
  const m = buildMetadata({ title: '제목', verse: '수 1:9', description: '  내가 쓴 설명\n#설교  ' });
  assert.equal(m.snippet.description, '내가 쓴 설명\n#설교');
  assert.equal(buildMetadata({ title: '제목', verse: '수 1:9', description: '' }).snippet.description, '');
  assert.match(buildMetadata({ title: '제목', verse: '수 1:9' }).snippet.description, /^수 1:9/);
  assert.equal(buildMetadata({ title: 't', description: '<b>x</b>' }).snippet.description, 'bx/b');
});

test('영상을 만든 뒤 올리는 방식: 예전 설정(바로 올리기 켬/끔)을 그대로 이어받는다', () => {
  const { uploadMode } = require('../src/main/youtube-upload');
  assert.equal(uploadMode({}), 'review', '처음 쓰는 사람: 점검하고 올리기');
  assert.equal(uploadMode({ ytAutoUpload: true }), 'auto', '예전에 바로 올리기를 켰으면 그대로');
  assert.equal(uploadMode({ ytAutoUpload: false }), 'review');
  assert.equal(uploadMode({ ytUploadMode: 'off', ytAutoUpload: true }), 'off');
  assert.equal(uploadMode({ ytUploadMode: 'weird', ytAutoUpload: true }), 'auto');
});
