const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const core = require('../src/main/llm/chatgpt-core.js');

test('PKCE verifier/challenge are S256 base64url', () => {
  const { verifier, challenge } = core.createPkce();
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  const expect = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.strictEqual(challenge, expect);
  // RFC 7636 appendix B vector
  assert.strictEqual(core.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('host id is urn:uuid', () => {
  assert.match(core.newHostId(), /^urn:uuid:[0-9a-f-]{36}$/);
});

const base = { hostId: 'urn:uuid:11111111-1111-4111-8111-111111111111', redirectUri: core.redirectUriFor(1455), state: 'S', nonce: 'N', codeChallenge: 'C' };

test('authorize URL for new registration', () => {
  const u = new URL(core.buildAuthorizeUrl({ ...base, isNew: true, idTokenHint: 'x', loginHint: 'a@b.c' }));
  assert.strictEqual(u.origin + u.pathname, 'https://auth.openai.com/api/accounts/authorize');
  const q = u.searchParams;
  assert.strictEqual(q.get('client_id'), 'dynamic_agent_client');
  assert.strictEqual(q.get('agent_name_hint'), 'SermonShorts');
  assert.strictEqual(q.get('ext_agent_host_id'), base.hostId);
  assert.strictEqual(q.get('redirect_uri'), 'http://127.0.0.1:1455/auth/callback');
  assert.strictEqual(q.get('scope'), 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');
  assert.strictEqual(q.get('resource'), 'https://api.openai.com/v1');
  assert.strictEqual(q.get('response_type'), 'code');
  assert.strictEqual(q.get('code_challenge_method'), 'S256');
  assert.strictEqual(q.get('code_challenge'), 'C');
  assert.strictEqual(q.get('state'), 'S');
  assert.strictEqual(q.get('nonce'), 'N');
  assert.strictEqual(q.get('id_token_hint'), null);
  assert.strictEqual(q.get('login_hint'), null);
});

test('authorize URL for returning account', () => {
  const q = new URL(core.buildAuthorizeUrl({ ...base, clientId: 'oaiapp_123', isNew: false, idTokenHint: 'IDT', loginHint: 'a@b.c' })).searchParams;
  assert.strictEqual(q.get('client_id'), 'oaiapp_123');
  assert.strictEqual(q.get('agent_name_hint'), null);
  assert.strictEqual(q.get('id_token_hint'), 'IDT');
  assert.strictEqual(q.get('login_hint'), 'a@b.c');
  assert.strictEqual(q.get('ext_agent_host_id'), base.hostId);
});

test('authorize URL rejects localhost redirect', () => {
  assert.throws(() => core.buildAuthorizeUrl({ ...base, redirectUri: 'http://localhost:1455/auth/callback', isNew: true }));
  assert.throws(() => core.buildAuthorizeUrl({ ...base, redirectUri: 'http://127.0.0.1:1455/callback', isNew: true }));
});

test('callback parsing', () => {
  const ok = core.parseCallback('/auth/callback?code=AC&state=S&client_id=oaiapp_9&scope=openid+chatgpt.tokens.use.direct', { state: 'S', isNew: true });
  assert.deepStrictEqual(ok, { code: 'AC', clientId: 'oaiapp_9', scope: 'openid chatgpt.tokens.use.direct' });
  assert.throws(() => core.parseCallback('/auth/callback?code=AC&state=X&client_id=oaiapp_9', { state: 'S', isNew: true }), (e) => e.code === 'state');
  assert.throws(() => core.parseCallback('/auth/callback?error=access_denied&state=S', { state: 'S', isNew: true }), (e) => e.code === 'denied');
  assert.throws(() => core.parseCallback('/auth/callback?code=AC&state=S', { state: 'S', isNew: true }), (e) => e.code === 'registration');
  assert.throws(() => core.parseCallback('/auth/callback?code=AC&state=S&client_id=dynamic_agent_client', { state: 'S', isNew: true }), (e) => e.code === 'registration');
  // returning: callback may omit client_id
  assert.strictEqual(core.parseCallback('/auth/callback?code=AC&state=S', { state: 'S', isNew: false, clientId: 'oaiapp_1' }).clientId, 'oaiapp_1');
  assert.throws(() => core.parseCallback('/auth/callback?code=AC&state=S&client_id=oaiapp_2', { state: 'S', isNew: false, clientId: 'oaiapp_1' }), (e) => e.code === 'client_mismatch');
});

test('token / refresh / revoke forms', () => {
  const t = new URLSearchParams(core.buildTokenForm({ clientId: 'oaiapp_1', code: 'C', verifier: 'V', redirectUri: 'http://127.0.0.1:1455/auth/callback' }));
  assert.strictEqual(t.get('grant_type'), 'authorization_code');
  assert.strictEqual(t.get('client_id'), 'oaiapp_1');
  assert.strictEqual(t.get('code_verifier'), 'V');
  assert.strictEqual(t.get('resource'), 'https://api.openai.com/v1');
  assert.strictEqual(t.get('client_secret'), null);
  const r = new URLSearchParams(core.buildRefreshForm({ clientId: 'oaiapp_1', refreshToken: 'R' }));
  assert.strictEqual(r.get('grant_type'), 'refresh_token');
  assert.strictEqual(r.get('scope'), null);
  assert.strictEqual(r.get('resource'), 'https://api.openai.com/v1');
  const v = new URLSearchParams(core.buildRevokeForm({ clientId: 'oaiapp_1', refreshToken: 'R' }));
  assert.strictEqual(v.get('token_type_hint'), 'refresh_token');
});

test('plan scope detection', () => {
  assert.ok(core.hasPlanScope('openid email chatgpt.tokens.use.direct'));
  assert.ok(core.hasPlanScope('chatgpt.tokens.use.direct+email'));
  assert.ok(!core.hasPlanScope('openid profile email'));
  assert.ok(core.hasPlanScope(['chatgpt.tokens.use.direct']));
});

function makeKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  return { privateKey, jwks: { keys: [jwk] } };
}
function signJwt(payload, privateKey, kid = 'k1') {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

test('ID token RS256 verification and claim validation', () => {
  const { privateKey, jwks } = makeKey();
  const now = 1_800_000_000;
  const claims = { iss: 'https://auth.openai.com', aud: 'oaiapp_1', sub: 'user-123', email: 'a@b.c', nonce: 'N', exp: now + 3600, iat: now };
  const tok = signJwt(claims, privateKey);
  const got = core.verifyJwt(tok, jwks);
  assert.strictEqual(got.sub, 'user-123');
  assert.deepStrictEqual(core.validateIdToken(got, { audience: 'oaiapp_1', nonce: 'N', now }), { sub: 'user-123', email: 'a@b.c', name: '' });
  assert.throws(() => core.validateIdToken(got, { audience: 'oaiapp_1', nonce: 'WRONG', now }));
  assert.throws(() => core.validateIdToken(got, { audience: 'other', nonce: 'N', now }));
  assert.throws(() => core.validateIdToken(got, { audience: 'oaiapp_1', nonce: 'N', now: now + 7200 }));
  assert.throws(() => core.validateIdToken({ ...got, iss: 'https://evil.example' }, { audience: 'oaiapp_1', nonce: 'N', now }));
  // tampered payload
  const parts = tok.split('.');
  const forged = parts[0] + '.' + Buffer.from(JSON.stringify({ ...claims, sub: 'attacker' })).toString('base64url') + '.' + parts[2];
  assert.throws(() => core.verifyJwt(forged, jwks));
  // different key
  const other = makeKey();
  assert.throws(() => core.verifyJwt(tok, other.jwks));
  // alg none rejected
  const none = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') + '.' + parts[1] + '.';
  assert.throws(() => core.verifyJwt(none, jwks));
});

test('SSE parsing across chunk boundaries and completion', () => {
  const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const full = ev({ type: 'response.created', response: {} })
    + ev({ type: 'response.output_text.delta', delta: '안녕' })
    + ev({ type: 'response.output_text.delta', delta: '하세요' })
    + ev({ type: 'response.completed', response: { id: 'r1' } });
  const chunks = [];
  for (let i = 0; i < full.length; i += 7) chunks.push(full.slice(i, i + 7));
  const deltas = [];
  const st = core.parseSSE(chunks, (d) => deltas.push(d));
  assert.strictEqual(st.text, '안녕하세요');
  assert.deepStrictEqual(deltas, ['안녕', '하세요']);
  assert.ok(st.completed);
  assert.strictEqual(st.failed, null);
});

test('SSE parsing: failed usage limit and incomplete', () => {
  const failed = core.parseSSE([
    'data: {"type":"response.output_text.delta","delta":"a"}\r\n\r\n',
    'data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"limit"}}}\n\n',
  ]);
  assert.ok(!failed.completed);
  assert.strictEqual(failed.failed.code, 'subscription_sharing_usage_limit_exceeded');
  assert.ok(core.isUsageLimitCode(failed.failed.code));
  assert.ok(core.isUsageLimitCode('subscription_sharing_usage_unavailable'));
  const inc = core.parseSSE(['data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n']);
  assert.strictEqual(inc.incomplete.reason, 'max_output_tokens');
  // stream ending without blank line still parsed on end()
  const tail = core.parseSSE(['data: {"type":"response.completed","response":{}}']);
  assert.ok(tail.completed);
});

test('responses body uses store:false, stream:true, no unsupported fields', () => {
  const b = core.buildResponsesBody({ model: 'gpt-x', instructions: '규칙', messages: [
    { role: 'system', content: 'ignored' }, { role: 'user', content: '안녕' }, { role: 'assistant', content: '네' }, { role: 'user', content: '' },
  ] });
  assert.strictEqual(b.store, false);
  assert.strictEqual(b.stream, true);
  assert.strictEqual(b.instructions, '규칙');
  assert.deepStrictEqual(b.input, [{ role: 'user', content: '안녕' }, { role: 'assistant', content: '네' }]);
  for (const k of ['temperature', 'max_output_tokens', 'previous_response_id', 'metadata', 'top_p', 'user', 'truncation', 'background', 'conversation']) assert.ok(!(k in b), k);
  assert.throws(() => core.buildResponsesBody({ model: 'gpt-x', messages: [] }));
  assert.throws(() => core.buildResponsesBody({ messages: [{ role: 'user', content: 'x' }] }));
});

test('model list keeps visibility=list', () => {
  const ms = core.pickListedModels({ models: [{ slug: 'a', display_name: 'A', visibility: 'list' }, { slug: 'b', visibility: 'hide' }, { slug: 'c', display_name: 'C', visibility: 'list' }] });
  assert.deepStrictEqual(ms, [{ slug: 'a', display_name: 'A' }, { slug: 'c', display_name: 'C' }]);
});
