'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const edl = require('../src/shared/edl.js');

const near = (a, b, eps = 1e-6, msg) =>
  assert.ok(Math.abs(a - b) <= eps, (msg ? msg + ': ' : '') + `expected ${b}, got ${a}`);

// 설교 한 대목 (행 5:29 근처). 시각은 원본 파일 기준 초.
function sampleWords() {
  return [
    { id: 'w01', text: '여러분', start: 10.00, end: 10.40 },
    { id: 'w02', text: '오늘', start: 10.50, end: 10.80 },
    { id: 'w03', text: '우리가', start: 10.90, end: 11.30 },
    { id: 'w04', text: '함께', start: 11.40, end: 11.70 },
    { id: 'w05', text: '읽은', start: 11.80, end: 12.10 },
    { id: 'w06', text: '말씀은', start: 12.20, end: 12.70 },
    { id: 'w07', text: '사도행전', start: 12.80, end: 13.40 },
    { id: 'w08', text: '5장입니다.', start: 13.50, end: 14.20 },
    { id: 'w09', text: '음', start: 14.60, end: 14.90 },
    { id: 'w10', text: '그러니까', start: 15.00, end: 15.50 },
    { id: 'w11', text: '베드로와', start: 15.80, end: 16.30 },
    { id: 'w12', text: '사도들이', start: 16.40, end: 16.90 },
    { id: 'w13', text: '대답하여', start: 17.00, end: 17.50 },
    { id: 'w14', text: '이르되', start: 17.60, end: 18.00 },
    { id: 'w15', text: '사람보다', start: 18.90, end: 19.30 },
    { id: 'w16', text: '하나님께', start: 19.40, end: 19.90 },
    { id: 'w17', text: '순종하는', start: 20.00, end: 20.50 },
    { id: 'w18', text: '것이', start: 20.60, end: 20.80 },
    { id: 'w19', text: '마땅하니라', start: 20.90, end: 21.60 },
    { id: 'w20', text: '아멘', start: 22.00, end: 22.40 }
  ].map((w) => ({ score: 0.9, del: false, br: false, ...w }));
}
const SET = { padBefore: 0.10, padAfter: 0.15, fadeMs: 10, maxLineChars: 14 };
const DUR = 30;

function delIds(words, ids) {
  for (const w of words) if (ids.includes(w.id)) w.del = true;
  return words;
}

// 3구간: "음 그러니까"와 "이르되" 삭제
function threeSegs() {
  const words = delIds(sampleWords(), ['w09', 'w10', 'w14']);
  return { words, segs: edl.buildSegments(words, SET, {}, DUR) };
}

// ---------------------------------------------------------------- buildSegments

test('buildSegments: no deletion -> one padded segment', () => {
  const segs = edl.buildSegments(sampleWords(), SET, {}, DUR);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].id, 'seg:w01');
  assert.equal(segs[0].firstWordId, 'w01');
  assert.equal(segs[0].lastWordId, 'w20');
  near(segs[0].start, 9.90);
  near(segs[0].end, 22.55);
});

test('buildSegments: deleting in the middle gives 2 then 3 segments with stable ids', () => {
  const two = edl.buildSegments(delIds(sampleWords(), ['w09', 'w10']), SET, {}, DUR);
  assert.equal(two.length, 2);
  assert.deepEqual(two.map((s) => s.id), ['seg:w01', 'seg:w11']);
  near(two[0].end, 14.35);
  near(two[1].start, 15.70);

  const { segs } = threeSegs();
  assert.equal(segs.length, 3);
  assert.deepEqual(segs.map((s) => [s.id, s.firstWordId, s.lastWordId]), [
    ['seg:w01', 'w01', 'w08'],
    ['seg:w11', 'w11', 'w13'],
    ['seg:w15', 'w15', 'w20']
  ]);
  near(segs[0].start, 9.90); near(segs[0].end, 14.35);
  near(segs[1].start, 15.70); near(segs[1].end, 17.65);
  near(segs[2].start, 18.80); near(segs[2].end, 22.55);
});

test('buildSegments: deleting at both ends and padding 0', () => {
  const words = delIds(sampleWords(), ['w01', 'w20']);
  const segs = edl.buildSegments(words, { padBefore: 0, padAfter: 0 }, {}, DUR);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].id, 'seg:w02');
  near(segs[0].start, 10.50);
  near(segs[0].end, 21.60);
});

test('buildSegments: overrides are applied by first/last word keys', () => {
  const words = delIds(sampleWords(), ['w09', 'w10']);
  const segs = edl.buildSegments(words, SET, { 's:w11': 15.55, 'e:w08': 14.28 }, DUR);
  near(segs[0].end, 14.28);
  near(segs[1].start, 15.55);
  assert.equal(segs[1].id, 'seg:w11');
});

test('buildSegments: override making start>=end is ignored', () => {
  const words = delIds(sampleWords(), ['w09', 'w10']);
  const segs = edl.buildSegments(words, SET, { 's:w11': 25, 'e:w08': 5 }, DUR);
  assert.equal(segs.length, 2);
  near(segs[0].end, 14.35);
  near(segs[1].start, 15.70);
});

test('buildSegments: overlapping segments after padding are merged', () => {
  const words = delIds(sampleWords(), ['w09']);
  // 구간1 끝 14.20+0.5=14.70, 구간2 시작 15.00-0.4=14.60 -> 겹침
  const segs = edl.buildSegments(words, { padBefore: 0.4, padAfter: 0.5 }, {}, DUR);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].id, 'seg:w01');
  assert.equal(segs[0].lastWordId, 'w20');
  near(segs[0].start, 9.60);
  near(segs[0].end, 22.90);
});

test('buildSegments: override pulling a start back into previous segment merges', () => {
  const words = delIds(sampleWords(), ['w09', 'w10']);
  const segs = edl.buildSegments(words, SET, { 's:w11': 14.0 }, DUR);
  assert.equal(segs.length, 1);
  near(segs[0].start, 9.90);
  near(segs[0].end, 22.55);
});

test('buildSegments: clamps to [0, duration]', () => {
  const words = [
    { id: 'a1', text: '할렐루야', start: 0.05, end: 0.6 },
    { id: 'a2', text: '아멘', start: 0.7, end: 1.95 }
  ];
  const segs = edl.buildSegments(words, SET, {}, 2.0);
  assert.equal(segs.length, 1);
  near(segs[0].start, 0);
  near(segs[0].end, 2.0);
  // 전부 duration 밖이면 구간 없음
  assert.deepEqual(edl.buildSegments([{ id: 'x', text: '끝', start: 5, end: 6 }], SET, {}, 2.0), []);
});

test('buildSegments: empty / all deleted / null args', () => {
  assert.deepEqual(edl.buildSegments([], SET, {}, DUR), []);
  assert.deepEqual(edl.buildSegments(null, SET, {}, DUR), []);
  const all = sampleWords().map((w) => ({ ...w, del: true }));
  assert.deepEqual(edl.buildSegments(all, SET, {}, DUR), []);
  assert.equal(edl.buildSegments(sampleWords(), null, null, DUR).length, 1);
});

// ---------------------------------------------------------------- 시간 변환

test('segmentsDuration', () => {
  const { segs } = threeSegs();
  near(edl.segmentsDuration(segs), 4.45 + 1.95 + 3.75);
  assert.equal(edl.segmentsDuration([]), 0);
});

test('srcToOut: inside / outside segments', () => {
  const { segs } = threeSegs();
  near(edl.srcToOut(segs, 9.90), 0);
  near(edl.srcToOut(segs, 10.00), 0.10);
  near(edl.srcToOut(segs, 16.00), 4.45 + 0.30);
  near(edl.srcToOut(segs, 18.80), 4.45 + 1.95);
  near(edl.srcToOut(segs, 22.55), 10.15);
  assert.equal(edl.srcToOut(segs, 15.00), null); // 지운 "그러니까"
  assert.equal(edl.srcToOut(segs, 5), null);
  assert.equal(edl.srcToOut(segs, 25), null);
  assert.equal(edl.srcToOut([], 1), null);
});

test('outToSrc: mapping, boundaries and clamping', () => {
  const { segs } = threeSegs();
  assert.deepEqual(edl.outToSrc(segs, 0), { segIndex: 0, t: 9.90 });
  const r = edl.outToSrc(segs, 4.75);
  assert.equal(r.segIndex, 1); near(r.t, 16.00);
  const b = edl.outToSrc(segs, 4.45); // 이음새는 다음 구간 시작
  assert.equal(b.segIndex, 1); near(b.t, 15.70);
  const end = edl.outToSrc(segs, 999);
  assert.equal(end.segIndex, 2); near(end.t, 22.55);
  assert.equal(edl.outToSrc([], 1), null);
});

test('srcToOut/outToSrc round trip', () => {
  const { segs } = threeSegs();
  for (const t of [9.95, 10.5, 12.34, 14.3, 15.71, 17.0, 17.64, 18.81, 20.0, 22.5]) {
    const o = edl.srcToOut(segs, t);
    assert.notEqual(o, null, 'src ' + t);
    near(edl.outToSrc(segs, o).t, t, 1e-9, 'src ' + t);
  }
  const total = edl.segmentsDuration(segs);
  for (let o = 0; o < total; o += 0.37) {
    const s = edl.outToSrc(segs, o);
    near(edl.srcToOut(segs, s.t), o, 1e-9, 'out ' + o);
  }
});

test('cutPoints', () => {
  const { segs } = threeSegs();
  const cps = edl.cutPoints(segs);
  assert.equal(cps.length, 2);
  assert.equal(cps[0].index, 0);
  near(cps[0].outEnd, 14.35);
  near(cps[0].inStart, 15.70);
  assert.equal(cps[0].keyEnd, 'e:w08');
  assert.equal(cps[0].keyStart, 's:w11');
  assert.equal(cps[1].keyEnd, 'e:w13');
  assert.equal(cps[1].keyStart, 's:w15');
  assert.deepEqual(edl.cutPoints([segs[0]]), []);
  assert.deepEqual(edl.cutPoints([]), []);
});

test('cutPoints keys round-trip through overrides', () => {
  const { words, segs } = threeSegs();
  const cp = edl.cutPoints(segs)[0];
  const segs2 = edl.buildSegments(words, SET, { [cp.keyEnd]: 14.30, [cp.keyStart]: 15.65 }, DUR);
  near(segs2[0].end, 14.30);
  near(segs2[1].start, 15.65);
});

// ---------------------------------------------------------------- buildLines

test('buildLines: maxLineChars 14, sentence end, deletion cut', () => {
  const { words, segs } = threeSegs();
  const lines = edl.buildLines(words, segs, SET);
  assert.deepEqual(lines.map((l) => l.text), [
    '여러분 오늘 우리가 함께 읽은',      // 12자, 다음 "말씀은"이면 15 > 14
    '말씀은 사도행전 5장입니다.',        // 문장 끝
    '베드로와 사도들이 대답하여',
    '사람보다 하나님께 순종하는 것이',   // 정확히 14자
    '마땅하니라 아멘'
  ]);
  for (const l of lines) {
    const chars = l.text.replace(/\s/g, '').length;
    assert.ok(chars <= 14, l.text);
    assert.ok(l.outEnd >= l.outStart, l.text);
  }
  assert.deepEqual(lines[2].words, ['w11', 'w12', 'w13']);
  near(lines[0].outStart, 0.10);
  near(lines[0].outEnd, lines[1].outStart);
  near(lines[2].outStart, 4.45 + 0.10);
  // 마지막 줄: 마지막 단어 end + 0.3, 전체 길이로 클램프
  const total = edl.segmentsDuration(segs);
  near(lines[4].outEnd, Math.min(total, edl.srcToOut(segs, 22.40) + 0.3));
});

test('buildLines: pause > 0.6s breaks, gap >= 0.8s ends line at word end + 0.3', () => {
  const words = sampleWords();
  const segs = edl.buildSegments(words, SET, {}, DUR);
  const lines = edl.buildLines(words, segs, SET);
  assert.deepEqual(lines.map((l) => l.text), [
    '여러분 오늘 우리가 함께 읽은',
    '말씀은 사도행전 5장입니다.',
    '음 그러니까 베드로와 사도들이',
    '대답하여 이르되',                   // "사람보다" 앞 0.9초 무음
    '사람보다 하나님께 순종하는 것이',
    '마땅하니라 아멘'
  ]);
  // 이르되 end 18.00 -> out 8.10, +0.3 = 8.40 (다음 줄 시작 9.00보다 빠름)
  near(lines[3].outEnd, 8.40);
  near(lines[4].outStart, 9.00);
  // 짧은 공백이면 다음 줄 시작까지 이어짐
  near(lines[2].outEnd, lines[3].outStart);
  // 마지막 줄은 전체 길이로 클램프 (22.40-9.90+0.3=12.8 > 12.65)
  near(lines[5].outEnd, 12.65);
});

test('buildLines: br flag forces a break', () => {
  const words = delIds(sampleWords(), ['w09', 'w10', 'w14']);
  words.find((w) => w.id === 'w02').br = true;
  const segs = edl.buildSegments(words, SET, {}, DUR);
  const lines = edl.buildLines(words, segs, SET);
  assert.equal(lines[0].text, '여러분 오늘');
  assert.equal(lines[1].text, '우리가 함께 읽은 말씀은 사도행전');
  assert.equal(lines[2].text, '5장입니다.');
});

test('buildLines: a single word longer than maxLineChars is its own line, words never split', () => {
  const words = [
    { id: 'k1', text: '오늘은', start: 1.0, end: 1.3 },
    { id: 'k2', text: '하나님의은혜와사랑과평강이충만한', start: 1.4, end: 3.0 },
    { id: 'k3', text: '날입니다', start: 3.1, end: 3.6 }
  ];
  const segs = edl.buildSegments(words, SET, {}, 10);
  const lines = edl.buildLines(words, segs, SET);
  assert.deepEqual(lines.map((l) => l.text), ['오늘은', '하나님의은혜와사랑과평강이충만한', '날입니다']);
  assert.deepEqual(lines.map((l) => l.words), [['k1'], ['k2'], ['k3']]);
});

test('buildLines: corrected text with spaces counts non-space chars only', () => {
  const words = [
    { id: 'c1', text: '예수 그리스도', start: 1.0, end: 1.8 }, // 6자
    { id: 'c2', text: '안에서', start: 1.9, end: 2.2 },        // 3자 -> 9
    { id: 'c3', text: '우리는', start: 2.3, end: 2.6 },        // 3자 -> 12
    { id: 'c4', text: '하나', start: 2.7, end: 2.9 },          // 2자 -> 14
    { id: 'c5', text: '입니다', start: 3.0, end: 3.3 }
  ];
  const segs = edl.buildSegments(words, SET, {}, 10);
  const lines = edl.buildLines(words, segs, SET);
  assert.deepEqual(lines.map((l) => l.text), ['예수 그리스도 안에서 우리는 하나', '입니다']);
});

test('buildLines: word start outside its segment (override) is clamped to the segment', () => {
  const words = sampleWords();
  const segs = edl.buildSegments(words, SET, { 's:w01': 10.2 }, DUR);
  near(segs[0].start, 10.2);
  const lines = edl.buildLines(words, segs, SET);
  near(lines[0].outStart, 0);
  assert.ok(lines.every((l) => l.outStart >= 0 && l.outEnd <= edl.segmentsDuration(segs) + 1e-9));
});

test('buildLines: empty / all deleted', () => {
  assert.deepEqual(edl.buildLines([], [], SET), []);
  const all = sampleWords().map((w) => ({ ...w, del: true }));
  assert.deepEqual(edl.buildLines(all, edl.buildSegments(all, SET, {}, DUR), SET), []);
});

// ---------------------------------------------------------------- SRT / formatTime

test('toSRT formats HH:MM:SS,mmm blocks', () => {
  const srt = edl.toSRT([
    { text: '여러분 오늘 우리가', words: ['w01'], outStart: 0.1, outEnd: 2.5 },
    { text: '마땅하니라', words: ['w19'], outStart: 3723.456, outEnd: 3725 }
  ]);
  assert.equal(srt,
    '1\n00:00:00,100 --> 00:00:02,500\n여러분 오늘 우리가\n\n' +
    '2\n01:02:03,456 --> 01:02:05,000\n마땅하니라\n');
  assert.equal(edl.toSRT([]), '');
});

test('toSRT from buildLines output', () => {
  const { words, segs } = threeSegs();
  const srt = edl.toSRT(edl.buildLines(words, segs, SET));
  const blocks = srt.trim().split('\n\n');
  assert.equal(blocks.length, 5);
  assert.match(blocks[0], /^1\n00:00:00,100 --> 00:00:\d\d,\d{3}\n여러분 오늘 우리가 함께 읽은$/);
});

test('formatTime', () => {
  assert.equal(edl.formatTime(0), '00:00.000');
  assert.equal(edl.formatTime(0.3), '00:00.300');
  assert.equal(edl.formatTime(75.5), '01:15.500');
  assert.equal(edl.formatTime(870.25), '14:30.250');
  assert.equal(edl.formatTime(3723.456), '1:02:03.456');
  assert.equal(edl.formatTime(59.9996), '01:00.000');
  assert.equal(edl.formatTime(75.9, false), '01:15');
  assert.equal(edl.formatTime(4470, false), '1:14:30');
});

// ---------------------------------------------------------------- 파서

test('parseTimecode', () => {
  assert.equal(edl.parseTimecode('870'), 870);
  assert.equal(edl.parseTimecode('14:30'), 870);
  assert.equal(edl.parseTimecode('1:14:30'), 4470);
  assert.equal(edl.parseTimecode('14:30.5'), 870.5);
  assert.equal(edl.parseTimecode(' 05:07 '), 307);
  assert.equal(edl.parseTimecode('90:00'), 5400);
  assert.equal(edl.parseTimecode(''), null);
  assert.equal(edl.parseTimecode('abc'), null);
  assert.equal(edl.parseTimecode('14:75'), null);
  assert.equal(edl.parseTimecode('1:2:3:4'), null);
  assert.equal(edl.parseTimecode(null), null);
});

test('parseRange', () => {
  const want = { start: 870, end: 2330 };
  assert.deepEqual(edl.parseRange('14:30 ~ 38:50'), want);
  assert.deepEqual(edl.parseRange('14:30-38:50'), want);
  assert.deepEqual(edl.parseRange('14:30 - 38:50'), want);
  assert.deepEqual(edl.parseRange('14:30~38:50'), want);
  assert.deepEqual(edl.parseRange('1:14:30 ~ 1:16:00'), { start: 4470, end: 4560 });
  assert.deepEqual(edl.parseRange('870-900'), { start: 870, end: 900 });
  assert.equal(edl.parseRange('38:50 ~ 14:30'), null);
  assert.equal(edl.parseRange('14:30'), null);
  assert.equal(edl.parseRange('가 ~ 나'), null);
});

test('parseYoutubeUrl', () => {
  const id = 'dQw4w9WgXcQ';
  assert.deepEqual(edl.parseYoutubeUrl(`https://www.youtube.com/watch?v=${id}`), { id, t: null });
  assert.deepEqual(edl.parseYoutubeUrl(`https://www.youtube.com/watch?v=${id}&t=870s`), { id, t: 870 });
  assert.deepEqual(edl.parseYoutubeUrl(`https://youtu.be/${id}?t=870`), { id, t: 870 });
  assert.deepEqual(edl.parseYoutubeUrl(`https://youtu.be/${id}?si=abc&t=14m30s`), { id, t: 870 });
  assert.deepEqual(edl.parseYoutubeUrl(`https://m.youtube.com/watch?v=${id}&t=1h2m3s`), { id, t: 3723 });
  assert.deepEqual(edl.parseYoutubeUrl(`https://youtube.com/shorts/${id}`), { id, t: null });
  assert.deepEqual(edl.parseYoutubeUrl(`https://www.youtube.com/live/${id}?start=95`), { id, t: 95 });
  assert.deepEqual(edl.parseYoutubeUrl(`youtube.com/watch?v=${id}&t=2m`), { id, t: 120 });
  assert.equal(edl.parseYoutubeUrl('https://example.com/watch?v=' + id), null);
  assert.equal(edl.parseYoutubeUrl('그냥 텍스트'), null);
  assert.equal(edl.parseYoutubeUrl(''), null);
});

// ---------------------------------------------------------------- snap

const RATE = 48000;
const FREQ = 220;
// 0~0.5s 사인, 0.5~0.52s 무음, 0.52~1.0s 사인
function sineWithGap() {
  const pcm = new Float32Array(RATE);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / RATE;
    pcm[i] = t >= 0.5 && t < 0.52 ? 0 : 0.5 * Math.sin(2 * Math.PI * FREQ * t);
  }
  return pcm;
}

test('snap zero: nearest zero crossing of a sine', () => {
  const pcm = sineWithGap();
  // 220Hz 사인의 영점은 k/440 초. 0.1003 근처 영점은 44/440 = 0.1
  near(edl.snap(pcm, RATE, 0.1003, 'zero'), 0.1, 1.5 / RATE);
  near(edl.snap(pcm, RATE, 0.1022, 'zero', 0.05), 45 / 440, 1.5 / RATE);
  // 결과는 실제로 작은 값이어야 함
  const s = edl.snap(pcm, RATE, 0.2371, 'zero');
  assert.ok(Math.abs(pcm[Math.round(s * RATE)]) < 0.01);
  assert.ok(Math.abs(s - 0.2371) <= 1 / 880 + 1 / RATE);
});

test('snap zero: no sign change -> t unchanged', () => {
  const dc = new Float32Array(RATE).fill(0.3);
  assert.equal(edl.snap(dc, RATE, 0.4, 'zero'), 0.4);
});

test('snap silence: finds the quiet gap within +-0.15s', () => {
  const pcm = sineWithGap();
  const s = edl.snap(pcm, RATE, 0.45, 'silence');
  assert.ok(s >= 0.5049 && s <= 0.5151, 'got ' + s);
  const s2 = edl.snap(pcm, RATE, 0.60, 'silence');
  assert.ok(s2 >= 0.5049 && s2 <= 0.5151, 'got ' + s2);
});

test('snap: unknown mode / bad input returns t', () => {
  const pcm = sineWithGap();
  assert.equal(edl.snap(pcm, RATE, 0.33, 'foo'), 0.33);
  assert.equal(edl.snap(new Float32Array(0), RATE, 0.33, 'zero'), 0.33);
  assert.equal(edl.snap(new Float32Array(100), RATE, 0.001, 'silence'), 0.001);
});

// ---------------------------------------------------------------- UMD

test('UMD: exposes window.SS.edl as a classic script', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'edl.js'), 'utf8');
  const existing = { other: 1 };
  const win = { SS: existing };
  win.window = win;
  vm.runInNewContext(code, { window: win, URL });
  assert.equal(win.SS, existing);
  assert.equal(typeof win.SS.edl.buildSegments, 'function');
  const win2 = {}; win2.window = win2;
  vm.runInNewContext(code, { window: win2, URL });
  assert.equal(typeof win2.SS.edl.parseYoutubeUrl, 'function');
});


test('autoClean: removes fillers', () => {
  const words = [
    { id: '1', text: '어,', start: 1, end: 2 },
    { id: '2', text: '음', start: 2, end: 3 },
    { id: '3', text: '하나님', start: 3, end: 4 }
  ];
  const cleaned = edl.autoClean(words, { fillers: ['어', '음'] });
  assert.equal(cleaned[0].del, true);
  assert.equal(cleaned[1].del, true);
  assert.equal(cleaned[2].del, undefined);
  assert.equal(words[0].del, undefined); // pure function check
});

test('autoClean: removes consecutive identical words', () => {
  const words = [
    { id: '1', text: '우리가', start: 1, end: 2 },
    { id: '2', text: '우리가', start: 2.1, end: 3 },
    { id: '3', text: '함께', start: 3, end: 4 }
  ];
  const cleaned = edl.autoClean(words, {});
  assert.equal(cleaned[0].del, true);
  assert.equal(cleaned[1].del, undefined);
  assert.equal(cleaned[2].del, undefined);
});

test('autoClean: gap > maxGap sets cutBefore', () => {
  const words = [
    { id: '1', text: '시작', start: 1, end: 2 },
    { id: '2', text: '끝', start: 3, end: 4 }
  ];
  const cleaned = edl.autoClean(words, { maxGap: 0.6 });
  assert.equal(cleaned[1].cutBefore, true);

  const segs = edl.buildSegments(cleaned, { padBefore: 0, padAfter: 0 }, {}, 10);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].lastWordId, '1');
  assert.equal(segs[1].firstWordId, '2');
});

test('buildLines: user max changes grouping without changing video segments',()=>{
  const words=[{id:0,text:'하나님의',start:1,end:1.4},{id:1,text:'은혜가',start:1.5,end:1.9},{id:2,text:'충분합니다',start:2,end:2.5}];
  const segs=edl.buildSegments(words,SET,{},10);const before=JSON.stringify(words);
  const short=edl.buildLines(words,segs,{maxLineChars:8,splitLongWords:true});
  const long=edl.buildLines(words,segs,{maxLineChars:20,splitLongWords:true});
  assert.equal(short.length,2);assert.equal(long.length,1);
  assert.ok(short.every(l=>Array.from(l.text.replace(/\s/g,'')).length<=8));
  assert.equal(JSON.stringify(words),before);assert.deepEqual(edl.buildSegments(words,SET,{},10),segs);
});
test('buildLines: strict limit divides long word display and proportionally assigns times',()=>{
  const words=[{id:0,text:'가나다라마바사아자차',start:1,end:3,br:true}];
  const segs=edl.buildSegments(words,{padBefore:0,padAfter:0},{},4);
  const lines=edl.buildLines(words,segs,{maxLineChars:4,splitLongWords:true});
  assert.deepEqual(lines.map(l=>l.text),['가나다라','마바사아','자차']);
  assert.ok(Math.abs(lines[0].outEnd-.8)<1e-8);assert.ok(Math.abs(lines[1].outEnd-1.6)<1e-8);
  assert.equal(lines[2].outEnd,2);assert.equal(words[0].text,'가나다라마바사아자차');
});
test('buildLines: strict length counts Unicode characters not UTF-16 halves',()=>{
  const words=[{id:0,text:'𠮷가나다라',start:1,end:2}];const segs=edl.buildSegments(words,{}, {},4);
  const lines=edl.buildLines(words,segs,{maxLineChars:2,splitLongWords:true});
  assert.deepEqual(lines.map(l=>l.text),['𠮷가','나다','라']);
});
test('buildLines: strict split respects cuts, deleted words, line breaks and output bounds',()=>{
  const words=[{id:0,text:'가나다라마바',start:1,end:2,br:true},{id:1,text:'삭제',start:2.1,end:3,del:true},{id:2,text:'사아자차카타',start:4,end:5}];
  const segs=edl.buildSegments(words,{}, {},6);const lines=edl.buildLines(words,segs,{maxLineChars:3,splitLongWords:true});
  assert.ok(lines.every(l=>Array.from(l.text.replace(/\s/g,'')).length<=3));assert.ok(lines.every(l=>l.outEnd>=l.outStart&&l.outEnd<=2));
  assert.ok(!edl.toSRT(lines).includes('삭제'));assert.equal(lines.map(l=>l.text).join(''),'가나다라마바사아자차카타');
});
