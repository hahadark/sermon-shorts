'use strict';
// 제미나이: 구글 AI Studio 무료 API 키로 대화. 키는 설정(safeStorage)에 암호화되어 있고 여기서는 읽기만 한다.
const ai = require('../ai');

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

function getKey() {
  try { return ai._getKey ? ai._getKey() : ''; } catch (_) { return ''; }
}

async function complete({ system, messages, model, keyProvider }) {
  const key = (keyProvider ? keyProvider() : getKey()) || '';
  if (!key) throw Object.assign(new Error('제미나이 키가 없습니다. [AI 연결]에서 키를 입력해 주세요.'), { code: 'auth' });
  const body = {
    contents: (messages || []).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'medium' } },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const res = await fetch(`${API}/${model || ai.DEFAULT_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = data?.error?.message || '';
    if (res.status === 429) throw Object.assign(new Error('제미나이 무료 사용량을 다 썼습니다. 잠시 뒤 다시 하거나 다른 AI 로 바꿔 주세요.'), { code: 'usage_limit' });
    if (res.status === 400 && /API key/i.test(msg) || res.status === 401 || res.status === 403) throw Object.assign(new Error('제미나이 키가 올바르지 않습니다. [AI 연결]에서 다시 입력해 주세요.'), { code: 'auth' });
    throw new Error(`제미나이 오류 ${res.status}: ${msg.slice(0, 200)}`);
  }
  const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  return { text };
}

module.exports = { complete };
