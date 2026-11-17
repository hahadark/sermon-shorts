'use strict';
// AI 편집 대화: 유튜브 자막이 없는 영상을 위스퍼 단어로 대화에 쓸 수 있게 줄로 묶는다
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

function loadLlm() {
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'electron') return { ipcMain: { handle() {}, on() {} }, shell: {}, app: { getPath: () => require('os').tmpdir(), isPackaged: false }, safeStorage: {} };
    return orig.call(this, req, ...rest);
  };
  try { return require('../src/main/llm/index.js'); } finally { Module._load = orig; }
}

test('위스퍼 단어 → 대화용 단어·줄', () => {
  const { whisperWordsToLines } = loadLlm();
  const raw = [
    { id: 'w0001', text: '오늘', start: 1.0, end: 1.3 }, { id: 'w0002', text: ' 말씀은 ', start: 1.35, end: 1.8 },
    { id: 'w0003', text: '사랑입니다.', start: 1.85, end: 2.6 },              // 문장 끝 → 줄 끝
    { id: 'w0004', text: '하나님은', start: 2.7, end: 3.1 },
    { id: 'w0005', text: '', start: 3.1, end: 3.2 },                         // 빈 글은 버림
    { id: 'w0006', text: '우리를', start: 3.2, end: 3.5 },
    { id: 'w0007', text: '부르십니다', start: 4.5, end: 5.0 },                // 앞의 쉼 1초 → 앞 줄 끝
    { id: 'w0008', text: 'x', start: NaN, end: 5.0 },                         // 시각이 없으면 버림
  ];
  const { words, lines } = whisperWordsToLines(raw);
  assert.deepStrictEqual(words.map((w) => w.text), ['오늘', '말씀은', '사랑입니다.', '하나님은', '우리를', '부르십니다']);
  assert.deepStrictEqual(words.map((w) => w.id), [0, 1, 2, 3, 4, 5]);
  assert.deepStrictEqual(lines.map((l) => [l.from, l.to]), [[0, 2], [3, 4], [5, 5]]);
  assert.strictEqual(lines[1].start, 2.7);
  // 같은 모양이라 대화 프롬프트(transcriptText)에 그대로 쓴다
  const chatPlan = require('../src/shared/chat-plan');
  assert.match(chatPlan.transcriptText(words, lines), /^#0 \[0:01\.0\] 오늘 말씀은 사랑입니다\.\n#3 \[0:02\.7\] 하나님은 우리를\n#5 /);
});

test('위스퍼 단어: 긴 말은 16단어마다 줄을 나눈다', () => {
  const { whisperWordsToLines } = loadLlm();
  const raw = Array.from({ length: 40 }, (_, i) => ({ text: '말' + i, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const { lines } = whisperWordsToLines(raw);
  assert.deepStrictEqual(lines.map((l) => l.to - l.from + 1), [16, 16, 8]);
});
