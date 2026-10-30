'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const asv = require('../src/main/autosave');

function tmpRoot() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-asv-')); asv._setRoot(d); return d; }
const snap = (n) => JSON.stringify({ version: 1, words: Array.from({ length: n }, (_, i) => ({ id: i })) });

test('자동 저장: current 덮어쓰기, 2분 안에는 작업본 하나, force 면 하나 더', () => {
  const d = tmpRoot();
  const a = asv.write({ sourceKey: 'v|0', title: '시험', sourcePath: 'x.mp4', data: snap(3), summary: { kept: 3 } });
  assert.ok(a.versioned);
  const b = asv.write({ sourceKey: 'v|0', title: '시험', data: snap(4), summary: { kept: 4 } });
  assert.strictEqual(b.versioned, false);
  const c = asv.write({ sourceKey: 'v|0', title: '시험', data: snap(5), summary: { kept: 5 }, forceVersion: true });
  assert.ok(c.versioned);
  const l = asv.list();
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].summary.kept, 5);
  assert.strictEqual(l[0].versions.length, 3); // current + 작업본 2
  assert.strictEqual(asv.read(l[0].key, 'current.sshorts').data.words.length, 5);
  assert.ok(!fs.readdirSync(path.join(d, l[0].key)).some((f) => /\.tmp-/.test(f)), '임시 파일이 남지 않음');
});

test('자동 저장: 다른 영상은 따로, 잘못된 키·파일 이름은 거절', () => {
  tmpRoot();
  asv.write({ sourceKey: 'a|0', data: snap(1) });
  asv.write({ sourceKey: 'b|0', data: snap(2) });
  assert.strictEqual(asv.list().length, 2);
  const k = asv.list()[0].key;
  assert.throws(() => asv.read('../x', 'current.sshorts'));
  assert.throws(() => asv.read(k, '../../meta.json'));
});

test('과거 작업본을 열면 최신 상태를 작업본으로 남김', () => {
  tmpRoot();
  asv.write({ sourceKey: 'v|0', data: snap(3) });          // 작업본 1 (3)
  const key = asv.list()[0].key;
  asv.write({ sourceKey: 'v|0', data: snap(9) });          // current 9, 작업본 없음
  const old = asv.list()[0].versions[1].file;
  asv.read(key, old);
  const vers = asv.list()[0].versions.slice(1);
  assert.strictEqual(vers.length, 2);
  assert.ok(vers.some((v) => asv.read(key, v.file).data.words.length === 9), '최신 9 가 작업본에 남음');
  asv.read(key, old); // 다시 열어도 또 늘지 않음
  assert.strictEqual(asv.list()[0].versions.length, 3);
});

test('작업본은 영상마다 최근 30개', () => {
  const d = tmpRoot();
  for (let i = 0; i < 34; i++) asv.write({ sourceKey: 'v|0', data: snap(i + 1), forceVersion: true });
  const e = asv.list()[0];
  assert.strictEqual(e.versions.length, 31);
  assert.strictEqual(fs.readdirSync(path.join(d, e.key)).filter((f) => /^v-/.test(f)).length, 30, '지운 작업본 파일도 정리');
});

test('실행 표시: 프로세스가 없는 표시 = 갑자기 꺼짐, 살아 있으면 아님', () => {
  const d = tmpRoot();
  const sd = path.join(d, 'sessions'); fs.mkdirSync(sd, { recursive: true });
  fs.writeFileSync(path.join(sd, '999999.json'), JSON.stringify({ pid: 999999, startedAt: Date.now() - 1000, keys: ['abcdef0123456789'] }));
  fs.writeFileSync(path.join(sd, process.ppid + '.json'), JSON.stringify({ pid: process.ppid, startedAt: Date.now(), keys: ['1111111111111111'] }));
  const c = asv.scanSessions();
  assert.ok(c && c.keys.includes('abcdef0123456789') && !c.keys.includes('1111111111111111'));
  assert.ok(!fs.existsSync(path.join(sd, '999999.json')), '꺼진 실행 표시는 지움');
  assert.ok(fs.existsSync(path.join(sd, process.ppid + '.json')), '다른 창(살아 있음) 표시는 둠');
  assert.strictEqual(asv.scanSessions(), null);
});

test('같은 밀리초에 두 번 저장해도 최신 상태를 작업본으로 남김', () => {
  tmpRoot();
  const realNow = Date.now; const t0 = realNow(); Date.now = () => t0;
  try {
    asv.write({ sourceKey: 's|0', data: snap(3) });
    asv.write({ sourceKey: 's|0', data: snap(8) });
  } finally { Date.now = realNow; }
  const e = asv.list()[0];
  asv.read(e.key, e.versions[1].file);
  assert.ok(asv.list()[0].versions.slice(1).some((v) => asv.read(e.key, v.file).data.words.length === 8));
});
