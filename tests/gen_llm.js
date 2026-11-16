// Electron 의 AI 연결 순수 로직(chatgpt-core, gemini·openrouter 본문·오류, ai.testConnection, claude 대화 합치기)을 돌려
// tests/fixtures/llm_cases.json 을 만든다. node tests/gen_llm.js <sermon-shorts-app 경로>
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const APP = process.argv[2] || 'F:/aside/sermon-shorts-app';
const core = require(path.join(APP, 'src/main/llm/chatgpt-core.js'));

const out = {};
const tryv = (f) => { try { return { ok: f() }; } catch (e) { return { err: e.code || 'error', msg: e.message }; } };

// ---- 로그인 주소
out.authorize = [
  { clientId: null, hostId: 'urn:uuid:1', redirectUri: 'http://127.0.0.1:1455/auth/callback', state: 'st a+b', nonce: 'n/1', codeChallenge: 'cc_-', idTokenHint: 'id.tok', loginHint: 'a@b.c', isNew: true },
  { clientId: 'client-x', hostId: 'urn:uuid:2', redirectUri: 'http://127.0.0.1:50123/auth/callback', state: 'S', nonce: 'N', codeChallenge: 'C', idTokenHint: 'h.e.y', loginHint: '목사@교회.kr', isNew: false },
  { clientId: 'client-x', hostId: 'urn:uuid:3', redirectUri: 'http://127.0.0.1:9/auth/callback', state: 'S', nonce: 'N', codeChallenge: 'C', idTokenHint: '', loginHint: '', isNew: false },
  { clientId: 'c', hostId: '', redirectUri: 'http://127.0.0.1:9/auth/callback', state: 'S', nonce: 'N', codeChallenge: 'C', isNew: false },
  { clientId: 'c', hostId: 'h', redirectUri: 'http://localhost:9/auth/callback', state: 'S', nonce: 'N', codeChallenge: 'C', isNew: false },
].map((a) => ({ args: a, out: tryv(() => core.buildAuthorizeUrl(a)) }));

// ---- 콜백
const P = (state, isNew, clientId) => ({ state, isNew, clientId });
out.callback = [
  ['/auth/callback?code=abc&state=S&client_id=cid1&scope=openid+chatgpt.tokens.use.direct', P('S', true, null)],
  ['/auth/callback?code=abc&state=S&client_id=dynamic_agent_client', P('S', true, null)],
  ['/auth/callback?code=abc&state=S', P('S', true, null)],
  ['/auth/callback?code=abc&state=X', P('S', false, 'cid')],
  ['/auth/callback?error=access_denied&state=S', P('S', false, 'cid')],
  ['/auth/callback?error=server_error&state=S', P('S', false, 'cid')],
  ['/auth/callback?state=S', P('S', false, 'cid')],
  ['/auth/callback?code=c%2Bd&state=S&client_id=other', P('S', false, 'cid')],
  ['/auth/callback?code=c%2Bd&state=S', P('S', false, 'cid')],
  ['/auth/callback?code=q&state=S&client_id=cid&scope=a%20b', P('S', false, 'cid')],
].map(([url, p]) => ({ url, pending: p, out: tryv(() => core.parseCallback(url, p)) }));

// ---- 폼
out.forms = {
  token: core.buildTokenForm({ clientId: 'c i', code: 'x/y+z', verifier: 'v~v', redirectUri: 'http://127.0.0.1:1455/auth/callback' }),
  refresh: core.buildRefreshForm({ clientId: 'cid', refreshToken: 'r.t-_*!' }),
  revoke: core.buildRevokeForm({ clientId: 'cid', refreshToken: 'rt=1&2' }),
};
out.scopes = [['openid profile  chatgpt.tokens.use.direct'], ['a+b+c'], [['x', 'chatgpt.tokens.use.direct']], [''], [null]].map(([s]) => ({ in: s, out: core.parseScopes(s), plan: core.hasPlanScope(s) }));

// ---- ID 토큰
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' });
const b64 = (o) => core.b64url(Buffer.from(JSON.stringify(o)));
const sign = (header, payload, key = privateKey) => { const input = b64(header) + '.' + b64(payload); return input + '.' + core.b64url(crypto.sign('RSA-SHA256', Buffer.from(input), key)); };
const claims = { iss: 'https://auth.openai.com', aud: 'cid', sub: 'user-1', email: 'a@b.c', name: '김', exp: 2000000000, nonce: 'N1' };
const good = sign({ alg: 'RS256', kid: 'k1' }, claims);
const jwks = { keys: [{ ...other, kid: 'k0', kty: 'RSA' }, { ...jwk, kid: 'k1', kty: 'RSA' }] };
const parts = good.split('.');
out.jwt = [
  { name: 'good', token: good, jwks },
  { name: 'nokid', token: sign({ alg: 'RS256' }, claims), jwks },
  { name: 'tampered', token: parts[0] + '.' + b64({ ...claims, sub: 'evil' }) + '.' + parts[2], jwks },
  { name: 'wrongkid', token: sign({ alg: 'RS256', kid: 'zz' }, claims), jwks },
  { name: 'hs256', token: b64({ alg: 'HS256' }) + '.' + b64(claims) + '.abc', jwks },
  { name: 'badform', token: 'a.b', jwks },
  { name: 'otherkey', token: sign({ alg: 'RS256', kid: 'k0' }, claims), jwks },
].map((c) => ({ ...c, out: tryv(() => core.verifyJwt(c.token, c.jwks)) }));
const NOW = 1900000000;
out.validate = [
  [claims, 'cid', 'N1'], [{ ...claims, iss: 'https://auth.openai.com/' }, 'cid', 'N1'], [{ ...claims, iss: 'https://evil' }, 'cid', 'N1'],
  [{ ...claims, aud: ['x', 'cid'], azp: 'x' }, 'cid', 'N1'], [{ ...claims, aud: ['x', 'cid'], azp: 'cid' }, 'cid', 'N1'], [{ ...claims, aud: ['cid'] }, 'cid', 'N1'],
  [{ ...claims, exp: NOW - 121 }, 'cid', 'N1'], [{ ...claims, exp: NOW - 119 }, 'cid', 'N1'], [{ ...claims, exp: '9999999999' }, 'cid', 'N1'],
  [claims, 'cid', 'other'], [claims, 'cid', undefined], [{ ...claims, sub: '' }, 'cid', 'N1'], [claims, '', 'N1'],
].map(([c, aud, nonce]) => ({ claims: c, audience: aud, nonce: nonce === undefined ? null : nonce, out: tryv(() => core.validateIdToken(c, { audience: aud, nonce, now: NOW })) }));

// ---- 대화 본문·SSE
out.responses = [
  { model: 'gpt-x', instructions: '시스템', messages: [{ role: 'user', content: '안녕' }, { role: 'assistant', content: '네' }, { role: 'system', content: 'x' }, { role: 'user', content: '' }] },
  { model: 'gpt-x', instructions: '', messages: [{ role: 'user', content: 'a' }] },
  { model: '', instructions: '', messages: [{ role: 'user', content: 'a' }] },
  { model: 'm', instructions: 'i', messages: [{ role: 'system', content: 'x' }] },
].map((a) => ({ args: a, out: tryv(() => core.buildResponsesBody(a)) }));
const sse = (chunks) => { const st = core.parseSSE(chunks); return { text: st.text, completed: st.completed, failed: st.failed, incomplete: st.incomplete, events: st.events }; };
const ev = (o, name) => (name ? 'event: ' + name + '\n' : '') + 'data: ' + JSON.stringify(o) + '\n\n';
const s1 = ev({ type: 'response.output_text.delta', delta: '{"ok"' }) + ev({ type: 'response.output_text.delta', delta: ':true}' }) + ': keepalive\n\n' + ev({ type: 'response.completed', response: {} }) + 'data: [DONE]\n\n';
out.sse = [
  [s1], [s1.slice(0, 17), s1.slice(17, 60), s1.slice(60)], [s1.replace(/\n/g, '\r\n')],
  [ev({ type: 'response.failed', response: { error: { code: 'usage_limit_exceeded', message: 'm' } } })],
  [ev({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } })],
  [ev({ code: 'bad', message: 'oops' }, 'error')], ['data: {"type":"response.output_text.delta",\ndata: "delta":"여러 줄"}\n\n'], ['data: not json\n\n' + ev({ type: 'response.completed' }).trimEnd()],
].map((chunks) => ({ chunks, out: sse(chunks) }));
out.models = [{ models: [{ slug: 'a', display_name: 'A', visibility: 'list' }, { slug: 'b', visibility: 'hide' }, { id: 'c' }] }, { data: [{ id: 'd', display_name: 'D' }, {}] }, {}].map((j) => ({ in: j, out: core.pickListedModels(j) }));
out.usage = ['usage_limit_exceeded', 'insufficient_quota', 'other', ''].map((c) => ({ in: c, out: core.isUsageLimitCode(c) }));

// ---- 제미나이·오픈라우터: 요청 본문과 오류 (fetch 를 바꿔 끼운다)
let reply = null; const sent = [];
global.fetch = async (url, opts) => { sent.push({ url, headers: opts && opts.headers, body: opts && opts.body ? JSON.parse(opts.body) : null }); const r = typeof reply === 'function' ? reply(url) : reply; return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json, text: async () => JSON.stringify(r.json) }; };
const gemini = require(path.join(APP, 'src/main/llm/gemini.js'));
const ai = require(path.join(APP, 'src/main/ai.js'));
const openrouter = require(path.join(APP, 'src/main/llm/openrouter.js'));
const msgs = [{ role: 'user', content: '첫 질문' }, { role: 'assistant', content: '{"a":1}' }, { role: 'user', content: '둘째' }];
async function main() {
  out.gemini = [];
  for (const [status, json, system] of [
    [200, { candidates: [{ content: { parts: [{ text: '생각', thought: true }, { text: '{"ok"' }, { text: ':true}' }] } }] }, '시스템 글'],
    [200, {}, ''], [429, { error: { message: 'quota' } }, 's'], [400, { error: { message: 'API key not valid. Please pass a valid API key.' } }, 's'],
    [400, { error: { message: 'Invalid JSON payload' } }, 's'], [401, {}, 's'], [403, { error: { message: 'denied' } }, 's'], [500, { error: { message: 'x'.repeat(300) } }, 's'],
  ]) {
    reply = { status, json }; sent.length = 0;
    const r = await gemini.complete({ system, messages: msgs, keyProvider: () => 'KEY' }).then((x) => ({ ok: x.text }), (e) => ({ err: e.code || 'api', msg: e.message }));
    out.gemini.push({ status, json, system, out: r, body: sent[0] && sent[0].body, url: sent[0] && sent[0].url.replace(/^.*\/models\//, '') });
  }
  out.geminiTest = [];
  ai.setKeyProvider(() => 'KEY');
  for (const [status, json] of [[200, {}], [400, { error: { message: 'API key not valid' } }], [400, { error: { message: 'other' } }], [403, {}], [404, {}], [429, {}], [503, { error: { message: 'busy' } }]]) {
    reply = { status, json }; sent.length = 0;
    const r = await ai.testConnection('gemini-test-model');
    out.geminiTest.push({ status, json, ok: r.ok, message: r.ok ? r.message.replace(/, \d+ms\)$/, ', 0ms)') : r.message, body: sent[0] && sent[0].body });
  }
  out.openrouterBody = [];
  for (const [model, system, messages] of [['m1', '시스템', msgs], ['openrouter/free', '', msgs.slice(0, 1)]]) {
    reply = { status: 200, json: { choices: [{ message: { content: 'x' } }] } }; sent.length = 0;
    await openrouter.complete({ system, messages, model, keyProvider: () => 'K' });
    out.openrouterBody.push({ model, system, messages, body: sent[0].body, headers: sent[0].headers });
  }
  out.openrouterErr = [];
  for (const [status, json] of [[401, {}], [403, {}], [402, { error: { message: 'pay' } }], [200, { error: { code: 401, message: 'no auth' } }], [200, { error: { message: 'no code' } }], [400, { error: { message: 'bad' } }]]) {
    reply = { status, json }; sent.length = 0;
    const r = await openrouter.complete({ system: '', messages: msgs, keyProvider: () => 'K' }).then((x) => ({ ok: x.text }), (e) => ({ err: e.code || 'api', msg: e.message }));
    out.openrouterErr.push({ status, json, out: r });
  }
  const list = { data: [
    { id: 'a/big:free', pricing: { prompt: '0', completion: '0' }, context_length: 200000 },
    { id: 'b/small:free', pricing: { prompt: '0', completion: '0' }, context_length: 32000 },
    { id: 'c/paid', pricing: { prompt: '0.1', completion: '0.2' }, context_length: 300000 },
    { id: 'd/guard:free', pricing: { prompt: '0', completion: '0' }, context_length: 100000 },
    { id: 'e/img:free', pricing: { prompt: 0, completion: 0 }, context_length: 100000, architecture: { output_modalities: ['image'] } },
    { id: 'f/mid:free', pricing: { prompt: 0, completion: '0' }, context_length: 128000, architecture: { output_modalities: ['text'] } },
    { id: 'g/nopricing:free', context_length: 999999 },
  ] };
  reply = { status: 200, json: list };
  out.freeModels = { in: list, out: await openrouter.freeModels() };
  // 클로드: 대화를 한 글로
  out.claudeConvo = { messages: msgs, out: msgs.map((m) => (m.role === 'assistant' ? '[편집자(이전 답)]\n' : '[사용자]\n') + m.content).join('\n\n') };
  fs.writeFileSync(path.join(__dirname, 'fixtures', 'llm_cases.json'), JSON.stringify(out, null, 1));
  console.log('llm_cases.json 만듦');
}
main().catch((e) => { console.error(e); process.exit(1); });
