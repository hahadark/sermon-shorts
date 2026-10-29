'use strict';
// 클로드 stream-json 출력 읽기: 단계(요청→생각→쓰기)와 글자, 마지막 result
const test = require('node:test');
const assert = require('node:assert');
const { createParser } = require('../src/main/llm/claude-stream.js');

const L = (o) => JSON.stringify(o) + '\n';
const SAMPLE = [
  L({ type: 'system', subtype: 'init', session_id: 's' }),
  L({ type: 'system', subtype: 'status', status: 'requesting' }),
  L({ type: 'stream_event', event: { type: 'message_start', message: { model: 'claude' } } }),
  L({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } }),
  L({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50, estimated_tokens_delta: 50 }),
  L({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 398, estimated_tokens_delta: 248 }),
  L({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }),
  L({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } }),
  L({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"reply":"구간' } } }),
  L({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: ' 3곳"}' } } }),
  L({ type: 'assistant', message: { content: [{ type: 'text', text: '{"reply":"구간 3곳"}' }] } }),
  L({ type: 'result', subtype: 'success', is_error: false, result: '{"reply":"구간 3곳"}' }),
].join('');

test('단계·글자·결과를 순서대로 읽는다 (아무 데서나 잘려 와도)', () => {
  for (const cut of [1, 7, 33, 200, SAMPLE.length]) {
    const stages = [], deltas = [];
    const p = createParser({ onStage: (s) => stages.push(s), onDelta: (d) => deltas.push(d) });
    for (let i = 0; i < SAMPLE.length; i += cut) p.feed(SAMPLE.slice(i, i + cut));
    const r = p.end();
    assert.strictEqual(r.subtype, 'success');
    assert.strictEqual(r.result, '{"reply":"구간 3곳"}');
    assert.strictEqual(deltas.join(''), '{"reply":"구간 3곳"}');
    assert.strictEqual(p.text, '{"reply":"구간 3곳"}');
    const names = stages.map((s) => s.stage);
    assert.strictEqual(names[0], 'ask');
    assert.ok(names.indexOf('think') > 0 && names.indexOf('write') > names.indexOf('think'), names.join(','));
    assert.strictEqual(Math.max(...stages.filter((s) => s.stage === 'think').map((s) => s.tokens || 0)), 398);
    assert.strictEqual(names.filter((n) => n === 'write').length, 1, '쓰기 단계는 한 번만 알림');
  }
});

test('결과 줄이 없으면 null, 깨진 줄은 건너뜀', () => {
  const p = createParser({});
  p.feed('not json\n{"type":"system","subtype":"status","status":"requesting"}\n{broken');
  assert.strictEqual(p.end(), null);
});

test('오류 결과도 그대로 돌려준다', () => {
  const p = createParser({});
  p.feed(L({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'usage limit' }));
  const r = p.end();
  assert.ok(r.is_error && r.result === 'usage limit');
});
