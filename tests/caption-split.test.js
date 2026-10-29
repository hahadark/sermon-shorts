// 출력 자막 칸에서 Enter: 커서 자리에서 자막을 둘로 나누기 (영상·원문·시각은 그대로)
const test = require('node:test');
const assert = require('node:assert');
const edl = require('../src/shared/edl.js');
const edit = require('../src/shared/caption-edit.js');

const settings = { padBefore: 0, padAfter: 0, maxLineChars: 14, splitLongWords: true };
const mk = (texts) => edit.capture(texts.map((text, id) => ({ id, text, start: 1 + id * 0.5, end: 1.45 + id * 0.5 })));
const lines = (words) => edl.buildLines(words, edl.buildSegments(words, settings, {}, 30), settings);
const texts = (words) => lines(words).map((l) => l.text);

test('단어 사이에서 나누면 앞 단어 뒤에서 줄이 바뀐다 (띄어쓰기 앞·뒤 모두)', () => {
  const words = mk(['하나님의', '나라와', '권세와']);
  const [line] = lines(words);
  assert.strictEqual(line.text, '하나님의 나라와 권세와');
  for (const caret of [8, 9]) {
    const r = edit.split(words, line, caret);
    assert.ok(r, 'caret ' + caret);
    assert.deepStrictEqual(texts(r.words), ['하나님의 나라와', '권세와']);
    assert.strictEqual(r.words[1].br, true);
    assert.deepStrictEqual(r.anchor, { id: 2, from: 0 });
    // 원문·시각은 그대로
    assert.deepStrictEqual(r.words.map((w) => [w.sttText, w.start, w.end]), words.map((w) => [w.sttText, w.start, w.end]));
  }
  assert.strictEqual(edit.split(words, line, 0), null);
  assert.strictEqual(edit.split(words, line, line.text.length), null);
  assert.strictEqual(edit.split(words, line, 3).words[0].captionSplits[0], 3); // 단어 가운데
});

test('띄어 쓰지 않은 단어 가운데에서도 나눈다 (조각 시각은 글자 수로)', () => {
  const words = mk(['하나님의나라', '임하소서']);
  const [line] = lines(words);
  const r = edit.split(words, line, 4);
  assert.deepStrictEqual(r.words[0].captionSplits, [4]);
  const ls = lines(r.words);
  assert.deepStrictEqual(ls.map((l) => l.text), ['하나님의', '나라 임하소서']);
  assert.deepStrictEqual(ls[1].parts[0], { id: 0, text: '나라', from: 4, to: 6 });
  assert.deepStrictEqual(r.anchor, { id: 0, from: 4 });
  assert.ok(Math.abs(ls[0].outEnd - ls[1].outStart) < 1e-9);
  // 나눈 뒤 뒤 조각만 고쳐도 단어 글자 자리가 맞는다
  const fixed = edit.apply(r.words, ls[1], '나라가 임하소서');
  assert.strictEqual(fixed[0].text, '하나님의나라가');
  assert.strictEqual(fixed[0].sttText, '하나님의나라');
});

test('고친 단어 속 띄어쓰기에서 나누면 그 자리에서 나뉜다', () => {
  const words = mk(['오직', '하나님께 영광']);
  const [line] = lines(words);
  assert.strictEqual(line.text, '오직 하나님께 영광');
  const r = edit.split(words, line, line.text.indexOf('영광'));
  assert.deepStrictEqual(texts(r.words), ['오직 하나님께', '영광']);
  assert.deepStrictEqual(r.words[1].captionSplits, [5]);
});

test('손으로 합친 줄을 나누면 합친 기록도 그 자리에서 둘로 나뉜다', () => {
  const base = mk(['첫째.', '둘째.', '셋째.', '넷째.']);
  let ls = lines(base);
  assert.deepStrictEqual(ls.map((l) => l.text), ['첫째.', '둘째.', '셋째.', '넷째.']);
  let w = edit.merge(base, ls[0], ls[1]).words;
  ls = lines(w);
  w = edit.merge(w, ls[0], ls[1]).words;
  ls = lines(w);
  assert.deepStrictEqual(ls.map((l) => l.text), ['첫째. 둘째. 셋째.', '넷째.']);
  const r = edit.split(w, ls[0], ls[0].text.indexOf('셋째'));
  assert.deepStrictEqual(texts(r.words), ['첫째. 둘째.', '셋째.', '넷째.']);
  // 나눈 앞 줄은 여전히 손으로 합친 줄
  assert.strictEqual(lines(r.words)[0].manualMerge, true);
});
