'use strict';
// 오픈라우터: openrouter.ai 키 하나로 여러 회사의 무료 모델을 쓴다. 키는 설정(safeStorage)에 암호화되어 있다.
// 기본은 'openrouter/free'(그때 쓸 수 있는 무료 모델을 오픈라우터가 골라 줌). 무료 모델이 붐비면(429) 다른 무료 모델로 한 번 더 해 본다.
const API = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/free';
const MIN_CONTEXT = 64000; // 설교 자막 전체(1시간 ≈ 2~3만 토큰)가 들어가야 한다

let freeCache = { at: 0, ids: [] };

/** 지금 무료인 글 모델 (문맥 긴 것부터). 1시간 동안 기억한다 */
async function freeModels() {
  if (Date.now() - freeCache.at < 3600 * 1000 && freeCache.ids.length) return freeCache.ids;
  const res = await fetch(`${API}/models`);
  if (!res.ok) return freeCache.ids;
  const data = await res.json().catch(() => ({}));
  const ids = (data.data || [])
    .filter((m) => /:free$/.test(m.id) && m.pricing && +m.pricing.prompt === 0 && +m.pricing.completion === 0)
    .filter((m) => (m.context_length || 0) >= MIN_CONTEXT)
    .filter((m) => !m.architecture || !m.architecture.output_modalities || m.architecture.output_modalities.includes('text'))
    .filter((m) => !/safety|guard|code/i.test(m.id))
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
    .map((m) => m.id);
  freeCache = { at: Date.now(), ids };
  return ids;
}

async function callOnce(key, model, system, messages, signal) {
  const body = {
    model,
    temperature: 0.3,
    messages: (system ? [{ role: 'system', content: system }] : []).concat((messages || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))),
  };
  const res = await fetch(`${API}/chat/completions`, {
    signal,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + key,
      'HTTP-Referer': 'https://github.com/hahadark/sermon-shorts',
      'X-Title': 'SermonShorts',
    },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  const msg = (data.error && data.error.message) || '';
  if (!res.ok || data.error) {
    const status = res.ok ? (data.error.code || 500) : res.status;
    if (status === 401 || status === 403) throw Object.assign(new Error('오픈라우터 키가 올바르지 않습니다. [AI 연결]에서 다시 입력해 주세요.'), { code: 'auth' });
    if (status === 402) throw Object.assign(new Error('오픈라우터 계정의 무료 사용 조건이 막혔습니다. openrouter.ai 에서 계정 상태를 확인해 주세요.'), { code: 'usage_limit' });
    throw Object.assign(new Error(`오픈라우터 오류 ${status}: ${msg.slice(0, 200)}`), { status, retry: status === 429 || status === 404 || status >= 500 });
  }
  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  if (!text.trim()) throw Object.assign(new Error('오픈라우터 모델이 빈 답을 보냈습니다'), { retry: true });
  return { text, model: data.model || model };
}

async function complete({ system, messages, model, keyProvider, signal }) {
  const key = (keyProvider ? keyProvider() : '') || '';
  if (!key) throw Object.assign(new Error('오픈라우터 키가 없습니다. [AI 연결]에서 키를 입력해 주세요.'), { code: 'auth' });
  const first = model || DEFAULT_MODEL;
  const tried = [first];
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await callOnce(key, tried[i], system, messages, signal);
    } catch (e) {
      lastErr = e;
      if (!e.retry || (signal && signal.aborted)) throw e;
      const next = (await freeModels().catch(() => [])).find((id) => !tried.includes(id));
      if (!next) break;
      tried.push(next);
    }
  }
  if (lastErr && lastErr.status === 429) throw Object.assign(new Error('오픈라우터 무료 모델이 지금 붐빕니다(하루 무료 횟수를 다 썼을 수도 있습니다). 잠시 뒤 다시 하거나 다른 AI 로 바꿔 주세요.'), { code: 'usage_limit' });
  throw lastErr;
}

module.exports = { complete, freeModels, DEFAULT_MODEL };
