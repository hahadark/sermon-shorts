const assert = require('assert');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const edl = require('../src/shared/edl.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 가짜 <video>: currentTime 설정 시 seeking → 지연 후 seeked. 같은 자리 시크는 옵션으로 seeked 를 안 보낸다. */
function makeVideo(opts = {}) {
  const v = new EventTarget();
  let ct = 0, tm = null;
  Object.assign(v, { paused: true, muted: false, seeking: false, ended: false, readyState: 4, playbackRate: 1, duration: 100 });
  Object.defineProperty(v, 'currentTime', {
    get: () => ct,
    set: (x) => {
      if (opts.noSameSeeked && Math.abs(x - ct) < 1e-6) return;
      if (opts.dropSeeked) { ct = x; return; }
      v.seeking = true; clearTimeout(tm);
      tm = setTimeout(() => { ct = x; v.seeking = false; v.dispatchEvent(new Event('seeked')); }, opts.delay || 5);
      ct = x;
    },
  });
  v.play = () => { v.paused = false; setTimeout(() => v.dispatchEvent(new Event('play')), 0); return Promise.resolve(); };
  v.pause = () => { if (v.paused) return; v.paused = true; setTimeout(() => v.dispatchEvent(new Event('pause')), 0); };
  v.load = () => {}; v.removeAttribute = () => {};
  v.advance = (dt) => { if (!v.paused) ct += dt; };
  return v;
}

function env(opts = {}) {
  const video = makeVideo(opts);
  let segments = opts.segs || [{ start: 1, end: 3 }, { start: 5, end: 8 }];
  const focus = [];
  const SS = { edl, state: { words: [{}], source: { offset: 0 } }, getSegments: () => segments, getEditedPlayMode: () => true, updateTimeUI() {}, focusPlaybackCaption: (t) => focus.push(t) };
  const el = { style: {}, clientWidth: 100, clientHeight: 100 };
  const sandbox = {
    window: null, console, setTimeout, clearTimeout, requestAnimationFrame: () => 0, EventTarget, Event, isFinite,
    ResizeObserver: class { observe() {} }, encodeURIComponent,
    document: { readyState: 'complete', getElementById: (id) => (id === 'video' ? video : el), addEventListener() {} },
  };
  sandbox.window = { SS };
  vm.createContext(sandbox);
  for (const f of ['preview.js', 'playback.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', f), 'utf8'), sandbox);
  SS.preview = new SS.Preview();
  SS.preview.path = 'x'; SS.preview.duration = 100;
  return { SS, video, focus, setSegs: (s) => { segments = s; } };
}

test('seek: 같은 시각이어도 Promise 가 끝난다', async () => {
  const { SS, video } = env({ noSameSeeked: true });
  await SS.preview.seek(0);                 // 현재 0 과 동일
  await SS.preview.seek(2); await SS.preview.seek(2);
  assert.strictEqual(video.currentTime, 2);
});

test('seek: seeked 가 아예 안 와도 타임아웃으로 끝난다', async () => {
  const { SS } = env({ dropSeeked: true });
  const t0 = Date.now();
  await SS.preview.seek(4);
  assert.ok(Date.now() - t0 < 3500);
});

test('seek: 동시 시크는 마지막 것이 끝난 뒤 모두 완료', async () => {
  const { SS, video } = env({ delay: 20 });
  const a = SS.preview.seek(2);
  await sleep(5);
  const b = SS.preview.seek(6);
  await Promise.all([a, b]);
  assert.strictEqual(video.currentTime, 6);
  assert.strictEqual(video.seeking, false);
});

test('seek: 시크 도중 load 로 교체돼도 끝난다', async () => {
  const { SS, video } = env({ dropSeeked: true });
  const p = SS.preview.seek(4);
  setTimeout(() => video.dispatchEvent(new Event('emptied')), 10);
  const t0 = Date.now(); await p;
  assert.ok(Date.now() - t0 < 500);
});

test('load: 겹쳐 호출하면 이전 대기는 정리되고 마지막이 완료', async () => {
  const { SS, video } = env();
  const a = SS.preview.load('C:/a.mp4', { duration: 10 });
  const b = SS.preview.load('C:/b.mp4', { duration: 10 });
  video.dispatchEvent(new Event('loadeddata'));
  await Promise.all([a, b]);
});

test('재생: 지운 곳을 건너뛰고 끝에서 멈추며 재시작 가능, pause 시 포커스 호출', async () => {
  const { SS, video, focus } = env();
  video.currentTime = 1.5; await sleep(20);
  SS.preview.play(); await sleep(10);
  video.currentTime = 2.98; await sleep(20);        // 첫 구간 끝 직전
  SS.playback.tick(); await sleep(40);
  assert.ok(video.currentTime >= 5 - 0.03, 'jump to 2nd segment: ' + video.currentTime);
  assert.strictEqual(video.muted, false);
  video.currentTime = 7.99; await sleep(20); SS.playback.tick(); await sleep(40);
  assert.strictEqual(video.paused, true);
  await sleep(20);
  // 끝에서 다시 재생 → 처음 구간부터
  SS.preview.play(); await sleep(60);
  assert.ok(Math.abs(video.currentTime - 1) < 0.1, 'restart: ' + video.currentTime);
  SS.preview.pause(); await sleep(10);
  assert.ok(focus.length >= 1, 'focus called');
});

test('jump 중 seek 이 멈춰도 skipping 이 잠기지 않음', async () => {
  const { SS, video } = env({ dropSeeked: true });
  video.currentTime = 0.2;
  SS.preview.play(); await sleep(3200);
  assert.strictEqual(video.muted, false);
});

test('playOutRange: 끝에서 멈추고 stop 이 남지 않으며 내부 pause 는 포커스를 안 부른다', async () => {
  const { SS, video, focus } = env();
  SS.playback.playOutRange(0.5, 1.0); await sleep(60);
  assert.strictEqual(video.paused, false);
  video.currentTime = 1 + 1.2; await sleep(20); SS.playback.tick(); await sleep(20);
  assert.strictEqual(video.paused, true);
  const n = focus.length;
  SS.preview.play(); await sleep(30);               // 일반 재생은 정지 지점이 남아 있지 않아야 함
  video.currentTime = 6; await sleep(20); SS.playback.tick(); await sleep(20);
  assert.strictEqual(video.paused, false);
  SS.preview.pause(); await sleep(10);
  assert.ok(focus.length > n);
});

test('편집 도중 segment 가 바뀌면 옛 정지 지점을 버린다', async () => {
  const { SS, video, setSegs } = env();
  SS.playback.playOutRange(0.5, 1.0); await sleep(40);
  setSegs([{ start: 1, end: 3 }, { start: 5, end: 9 }]);
  video.currentTime = 6; await sleep(20); SS.playback.tick(); await sleep(20);
  assert.strictEqual(video.paused, false);
});
