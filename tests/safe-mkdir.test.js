'use strict';
// Windows '제어된 폴더 액세스'가 막을 때 recursive mkdir 이 끝없이 반복해 앱이 멈추던 문제 (v0.3.22)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const tools = require('../src/main/tools.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-mkdir-'));

test('없는 상위 폴더까지 한 단계씩 만든다, 이미 있으면 그대로', () => {
  const d = tmp(), deep = path.join(d, 'a', '배경음악', 'c');
  assert.equal(tools.ensureDir(deep), path.resolve(deep));
  assert.ok(fs.statSync(deep).isDirectory());
  assert.equal(tools.ensureDir(deep), path.resolve(deep));
  assert.equal(tools.canWriteDir(deep), true);
  assert.deepEqual(fs.readdirSync(deep), [], '쓰기 시험 파일을 남기지 않는다');
  fs.rmSync(d, { recursive: true, force: true });
});

test('보호된 폴더(부모는 있는데 만들기가 ENOENT)는 멈추지 않고 바로 알기 쉬운 오류', () => {
  const d = tmp(), guarded = path.join(d, 'Documents');
  fs.mkdirSync(guarded);
  const real = fs.mkdirSync;
  let calls = 0;
  fs.mkdirSync = function (p, o) {
    calls++;
    if (path.resolve(String(p)).startsWith(guarded + path.sep)) { const e = new Error('ENOENT: no such file or directory, mkdir'); e.code = 'ENOENT'; throw e; }
    return real.call(fs, p, o);
  };
  try {
    const t0 = Date.now();
    assert.throws(() => tools.ensureDir(path.join(guarded, 'SermonShorts', '배경음악')), (e) => e.blocked === true && /제어된 폴더 액세스/.test(e.message));
    assert.ok(Date.now() - t0 < 1000 && calls <= 2, '한 번 시도하고 끝낸다 (반복 ' + calls + '회)');
    assert.equal(tools.canWriteDir(path.join(guarded, 'SermonShorts')), false);
  } finally { fs.mkdirSync = real; fs.rmSync(d, { recursive: true, force: true }); }
});

test('파일이 같은 이름으로 있으면 폴더로 착각하지 않는다', () => {
  const d = tmp(), f = path.join(d, 'x');
  fs.writeFileSync(f, '1');
  assert.throws(() => tools.ensureDir(path.join(f, 'y')));
  fs.rmSync(d, { recursive: true, force: true });
});

test('main 코드에 recursive mkdir 가 남아 있지 않다 (모두 tools.ensureDir)', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
  const bad = walk(path.join(__dirname, '..', 'src', 'main')).filter((f) => fs.readFileSync(f, 'utf8').split('\n').some((l) => /mkdirSync\([^)]*recursive\s*:\s*true/.test(l) && !/^\s*(\/\/|\/?\*)/.test(l)));
  assert.deepEqual(bad.map((f) => path.basename(f)), []);
});
