'use strict';
// Claude Code `-p --output-format stream-json --verbose --include-partial-messages` 출력(한 줄에 JSON 하나)을 읽는다.
// 기다리는 동안 대화창에 단계를 보여 주려고: 요청 중 → 생각 중(생각량) → 답 쓰는 중(글자) → 끝(result).
// result 줄은 --output-format json 의 결과와 같은 모양이다 ({ type:'result', subtype, is_error, result, ... }).

/**
 * onStage({ stage: 'ask' | 'think' | 'write', tokens? }), onDelta(text)
 * 반환: { feed(chunk), end() → result 객체 또는 null, get text() }
 */
function createParser({ onStage, onDelta } = {}) {
  let buf = '';
  let result = null;
  let text = '';
  let stage = '';
  let thinkTokens = 0;
  const tell = (s, extra) => {
    if (!onStage) return;
    if (s === stage && s !== 'think') return;
    stage = s;
    try { onStage({ stage: s, ...(extra || {}) }); } catch (_) { /* 창이 닫힘 */ }
  };
  function line(l) {
    l = l.trim();
    if (!l || l[0] !== '{') return;
    let o;
    try { o = JSON.parse(l); } catch (_) { return; }
    if (o.type === 'result') { result = o; return; }
    if (o.type === 'system') {
      if (o.subtype === 'status' && o.status === 'requesting') tell('ask');
      else if (o.subtype === 'thinking_tokens') {
        const n = Number(o.estimated_tokens) || 0;
        if (n > thinkTokens) thinkTokens = n;
        tell('think', { tokens: thinkTokens });
      }
      return;
    }
    if (o.type === 'stream_event' && o.event) {
      const ev = o.event;
      if (ev.type === 'content_block_start' && ev.content_block) {
        if (ev.content_block.type === 'thinking') tell('think', { tokens: thinkTokens });
        else if (ev.content_block.type === 'text') tell('write');
      } else if (ev.type === 'content_block_delta' && ev.delta) {
        if (ev.delta.type === 'text_delta' && ev.delta.text) {
          if (stage !== 'write') tell('write');
          text += ev.delta.text;
          if (onDelta) { try { onDelta(ev.delta.text); } catch (_) { /* */ } }
        } else if (ev.delta.type === 'thinking_delta') {
          const n = Number(ev.delta.estimated_tokens) || 0;
          if (n) { thinkTokens += n; tell('think', { tokens: thinkTokens }); }
        }
      }
    }
  }
  return {
    feed(chunk) {
      buf += typeof chunk === 'string' ? chunk : String(chunk);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
    },
    end() { if (buf) { line(buf); buf = ''; } return result; },
    get text() { return text; },
  };
}

module.exports = { createParser };
