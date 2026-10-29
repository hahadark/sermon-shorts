// 테마 강화(v0.3.9): 글자 효과·가라오케·내보내기 층·기본 테마 파일 점검
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const fx = require('../src/shared/textfx.js');
const themeLib = require('../src/shared/theme.js');
const edl = require('../src/shared/edl.js');
const { buildExportArgs, blurBackgroundFilter } = require('../src/main/render.js');
const { buildMetadata } = require('../src/main/youtube-upload.js');

// buildExportArgs 는 lines.txt 를 쓰므로 쓰기를 가로채서 내용만 받는다
function exportWith(params) {
  const original = fs.writeFileSync;
  let written = '';
  fs.writeFileSync = (p, data) => { written = String(data); };
  try {
    const r = buildExportArgs(Object.assign({ sourcePath: 'in.mp4', outPath: 'out.mp4', segments: [{ start: 1, end: 6 }], lines: [], crop: { scale: 1, x: 0.5, y: 0.5 }, fadeMs: 0, tempDir: 'cache/tmp' }, params));
    return Object.assign({ list: written }, r);
  } finally { fs.writeFileSync = original; }
}

test('tokenize: *강조* 는 별표를 지우고 표시, 여러 단어 강조도 이어진다', () => {
  const t = fx.tokenize('나라와 *권세와 영광이* 아버지께');
  assert.deepStrictEqual(t.map((x) => x.text), ['나라와', '권세와', '영광이', '아버지께']);
  assert.deepStrictEqual(t.map((x) => x.hl), [false, true, true, false]);
  const g = fx.tokenize('', ['*하나님*의', '나라']);
  assert.deepStrictEqual(g.map((x) => [x.text, x.hl, x.group]), [['하나님의', true, 0], ['나라', false, 1]]);
  // 단어 일부만 강조하면 조각으로 나눠 준다
  assert.deepStrictEqual(g[0].parts, [{ text: '하나님', hl: true }, { text: '의', hl: false }]);
  assert.strictEqual(t[1].parts, null);
  assert.strictEqual(fx.stripEmphasis('*은혜*로'), '은혜로');
});

test('wrapTokens: 너비를 넘으면 단어 단위로 줄을 나누고 최대 줄 수를 지킨다', () => {
  const toks = fx.tokenize('가나 다라 마바 사아 자차');
  const measure = (s) => s.length * 10; // 글자당 10px
  assert.deepStrictEqual(fx.wrapTokens(toks, measure, 50, 5, 3).map((l) => l.map((x) => x.text).join(' ')), ['가나 다라', '마바 사아', '자차']);
  // 최대 2줄이면 남은 단어는 마지막 줄에 (그릴 때 좁힌다)
  assert.deepStrictEqual(fx.wrapTokens(toks, measure, 50, 5, 2).map((l) => l.length), [2, 3]);
  assert.strictEqual(fx.wrapTokens(toks, measure, 1000, 5, 2).length, 1);
});

test('karaokeFrames: 단어 시작 시각으로 장면을 나누고 너무 짧은 장면은 합친다', () => {
  const f = fx.karaokeFrames(10, 12, [10.2, 10.6, 10.61, 11.2]);
  // 1번 단어(10.6~10.61)는 너무 짧아 앞 장면에 합쳐진다
  assert.deepStrictEqual(f.map((x) => x.index), [0, 2, 3]);
  assert.strictEqual(f[0].start, 10);
  assert.strictEqual(f[f.length - 1].end, 12);
  for (let i = 1; i < f.length; i++) assert.strictEqual(f[i].start, f[i - 1].end);
  assert.strictEqual(fx.karaokeIndexAt(f, 10.605), 0);
  assert.strictEqual(fx.karaokeIndexAt(f, 10.65), 2);
  assert.strictEqual(fx.karaokeIndexAt(f, 11.5), 3);
  // 시각을 모르는 단어(NaN)는 앞뒤 단어 사이를 나눠 갖는다
  assert.deepStrictEqual(fx.karaokeFrames(0, 1, [0, NaN, 0.5]).map((x) => [x.index, x.start, x.end]), [[0, 0, 0.25], [1, 0.25, 0.5], [2, 0.5, 1]]);
  assert.deepStrictEqual(fx.karaokeFrames(0, 1, [0, NaN, NaN]).map((x) => x.index), [0, 1, 2]);
  assert.deepStrictEqual(fx.karaokeFrames(0, 0, [0]), []);
});

test('tokenColor: 가라오케 > 줄 색 > 강조 > 기본', () => {
  const el = { color: '#FFFFFF', lineColors: ['#41E6FF'], highlightColor: '#FFE14D', karaoke: { mode: 'current', color: '#FFD400' } };
  assert.strictEqual(fx.tokenColor({ hl: true }, 2, el, 0, 2), '#FFD400');
  assert.strictEqual(fx.tokenColor({ hl: true }, 1, el, 0, 2), '#41E6FF');
  assert.strictEqual(fx.tokenColor({ hl: true }, 1, el, 1, null), '#FFE14D');
  assert.strictEqual(fx.tokenColor({ hl: false }, 1, el, 1, null), '#FFFFFF');
  const prog = { color: '#FFFFFF', karaoke: { mode: 'progressive', color: '#7CF2C8' } };
  assert.strictEqual(fx.tokenColor({}, 0, prog, 0, 2), '#7CF2C8');
  assert.strictEqual(fx.tokenColor({}, 3, prog, 0, 2), '#FFFFFF');
});

test('fillFormat: 빈 값은 지우고 빈칸을 정리한다', () => {
  assert.strictEqual(fx.fillFormat('{church} {speaker}', { church: '', speaker: '차재수 사관' }), '차재수 사관');
  assert.strictEqual(fx.fillFormat('{speaker}', {}), '');
});

test('lineKaraoke: 잘린 같은 단어 조각은 다시 붙이고 단어 시각으로 장면을 만든다', () => {
  const line = { outStart: 0, outEnd: 2, parts: [{ id: 1, text: '하나님의', from: 0, to: 4 }, { id: 2, text: '나라와', from: 0, to: 3 }, { id: 2, text: '권세', from: 3, to: 5 }, { id: 3, text: '영광', from: 0, to: 2 }] };
  assert.deepStrictEqual(fx.lineUnits(line).map((u) => u.text), ['하나님의', '나라와권세', '영광']);
  const starts = { 1: 0, 2: 0.7, 3: 1.4 };
  const k = fx.lineKaraoke(line, (u) => starts[u.id]);
  assert.deepStrictEqual(k.groups, ['하나님의', '나라와권세', '영광']);
  assert.deepStrictEqual(k.frames.map((f) => [f.index, f.start, f.end]), [[0, 0, 0.7], [1, 0.7, 1.4], [2, 1.4, 2]]);
});

test('exportLayers: 테마에 따라 필요한 내보내기 층만 고른다', () => {
  const n = (j) => themeLib.exportLayers(themeLib.normalizeTheme(j));
  assert.deepStrictEqual(n(null), { mode: 'solid', bgImage: false, blur: false, under: false, mask: false });
  assert.strictEqual(n({ canvas: { mode: 'gradient' } }).bgImage, true);
  const b = n({ canvas: { mode: 'blur', blur: { tint: '#00000055' } }, video: { radius: 30 } });
  assert.deepStrictEqual([b.blur, b.under, b.mask, b.bgImage], [true, true, true, false]);
  // 흐림 0 인 그림자는 층을 만들지 않는다
  assert.strictEqual(n({ video: { shadow: { color: '#000', blur: 0, offsetX: 0, offsetY: 0 } } }).under, false);
  assert.strictEqual(n({ video: { shadow: { color: '#000', blur: 30 } } }).under, true);
});

test('내보내기: 흐린 배경은 영상을 둘로 나눠 1/4 크기에서 흐리고 어둡게 한다', () => {
  const { filtergraph, args } = exportWith({ theme: { canvas: { mode: 'blur', blur: { amount: 30, dim: 0.5 } }, video: { x: 0, y: 500, width: 1080, height: 900 } } });
  assert.ok(filtergraph.includes('[vcat]split=2[vmain][vbgsrc]'));
  assert.ok(filtergraph.includes('[vmain]crop='));
  assert.ok(/\[vbgsrc\]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=luma_radius=\d+/.test(filtergraph));
  assert.ok(filtergraph.includes('colorchannelmixer=rr=0.500:gg=0.500:bb=0.500[base]'));
  assert.ok(!filtergraph.includes('color=c='));
  assert.ok(!args.some((a) => /bg\.png|mask\.png|under\.png/.test(a)));
  assert.ok(!blurBackgroundFilter({ amount: 20, dim: 0 }).includes('colorchannelmixer'));
});

test('내보내기: 그라데이션 배경 그림, 영상 그림자 층, 둥근 모서리 마스크', () => {
  const { filtergraph, args } = exportWith({ theme: { canvas: { mode: 'gradient' }, video: { x: 40, y: 140, width: 1000, height: 1320, radius: 40, shadow: { color: '#0006', blur: 40, offsetY: 14 } } } });
  const inputs = args.filter((a, i) => args[i - 1] === '-i').map((p) => path.basename(p));
  assert.deepStrictEqual(inputs, ['in.mp4', 'top.png', 'footer.png', 'lines.txt', 'bg.png', 'under.png', 'mask.png']);
  assert.ok(filtergraph.includes('[4:v]format=rgba[base]'));
  assert.ok(filtergraph.includes('[base][5:v]overlay=x=0:y=0[baseu]'));
  assert.ok(filtergraph.includes('[6:v]scale=1000:1320,format=gray[vmask]'));
  assert.ok(filtergraph.includes('[vrgba][vmask]alphamerge[vround]'));
  assert.ok(filtergraph.includes('[baseu][vround]overlay=x=40:y=140[basev]'));
});

test('내보내기: 가라오케 줄은 여러 장을 잇고, 길이는 밀리초로 맞아떨어진다', () => {
  const lines = [
    { outStart: 0.3333, outEnd: 1.6667, images: [{ name: 'line_0_0.png', start: 0.3333, end: 0.9 }, { name: 'line_0_1.png', start: 0.9, end: 1.6667 }] },
    { outStart: 1.6667, outEnd: 2.5 },
    { outStart: 2.5, outEnd: 3, images: [{ name: '../evil.png', start: 2.5, end: 3 }] },
  ];
  const { list } = exportWith({ lines });
  const entries = [...list.matchAll(/file '([^']+)'\nduration ([\d.]+)/g)].map((m) => [m[1], Number(m[2])]);
  assert.deepStrictEqual(entries.map((e) => e[0]), ['empty.png', 'line_0_0.png', 'line_0_1.png', 'line_1.png', 'line_2.png', 'empty.png']);
  const total = entries.slice(0, -1).reduce((s, e) => s + Math.round(e[1] * 1000), 0);
  assert.strictEqual(total, 3000); // 0 ~ 3초가 오차 없이 채워진다
});

test('기본 테마 파일: 모두 읽히고, 무료(OFL) 글꼴만 쓰고, 화면 안에 있다', () => {
  const dir = path.join(__dirname, '..', 'assets', 'themes');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 11, '테마 수: ' + files.length);
  const allowed = new Set(['Noto Sans KR', 'Black Han Sans', 'Do Hyeon', 'Nanum Pen Script', 'Yeon Sung', 'NanumGothic']);
  const ids = new Set();
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.strictEqual(raw.id + '.json', f, '파일 이름과 id: ' + f);
    assert.ok(!ids.has(raw.id)); ids.add(raw.id);
    const t = themeLib.normalizeTheme(raw);
    for (const k of ['title', 'verse', 'subtitle', 'churchName', 'speaker', 'badge']) {
      if (!t[k].show) continue;
      assert.ok(allowed.has(t[k].font), `${f} ${k} 글꼴 ${t[k].font}`);
      assert.ok(t[k].y > 0 && t[k].y < 1920 && t[k].x >= 0 && t[k].x <= 1080, `${f} ${k} 위치`);
    }
    const v = t.video;
    assert.ok(v.x >= 0 && v.y >= 0 && v.x + v.width <= 1080 && v.y + v.height <= 1920, f + ' 영상 영역');
    for (const fo of raw.fonts || []) assert.ok(/OFL/.test(fo.license), f + ' 글꼴 라이선스');
    assert.ok(['solid', 'gradient', 'blur'].includes(themeLib.exportLayers(t).mode));
  }
});

test('SRT·유튜브 제목에는 화면용 표시(*강조*, 줄바꿈 / )가 남지 않는다', () => {
  assert.ok(!edl.toSRT([{ outStart: 0, outEnd: 1, text: '나라와 *권세와*' }]).includes('*'));
  const m = buildMetadata({ title: '오늘의 말씀 / *하나님 중심의* 기도' });
  assert.strictEqual(m.snippet.title, '오늘의 말씀 하나님 중심의 기도 #Shorts');
});
