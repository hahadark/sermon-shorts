'use strict';
// ChatGPT 로그인(Sign in with ChatGPT, 오픈소스·로컬 앱용) 순수 로직.
// electron 을 쓰지 않으므로 node --test 로 바로 검사할 수 있다.
// 참고: https://developers.openai.com/siwc/token-sharing-open-source
const crypto = require('node:crypto');

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
const OIDC_CONFIG_URL = 'https://auth.openai.com/.well-known/openid-configuration';
const RESOURCE = 'https://api.openai.com/v1';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MODELS_URL = 'https://api.openai.com/v1/models';
const NEW_CLIENT_ID = 'dynamic_agent_client';
const AGENT_NAME = 'SermonShorts';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const CALLBACK_PATH = '/auth/callback';
const PREFERRED_PORT = 1455;
const USAGE_URL = 'https://chatgpt.com/settings/usage';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}
function randomToken(bytes = 32) { return b64url(crypto.randomBytes(bytes)); }

/** PKCE: { verifier, challenge } (S256) */
function createPkce() {
  const verifier = randomToken(48); // 64자, RFC 7636 길이 범위(43~128) 안
  return { verifier, challenge: pkceChallenge(verifier) };
}
function pkceChallenge(verifier) {
  return b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
}

function newHostId() { return 'urn:uuid:' + crypto.randomUUID(); }

function redirectUriFor(port) { return `http://127.0.0.1:${port}${CALLBACK_PATH}`; }

/**
 * 인증 주소. isNew(처음 등록)이면 client_id=dynamic_agent_client + agent_name_hint 를 넣는다.
 */
function buildAuthorizeUrl({ clientId, hostId, redirectUri, state, nonce, codeChallenge, idTokenHint, loginHint, isNew }) {
  if (!hostId) throw new Error('ext_agent_host_id 가 없습니다.');
  if (!redirectUri || !/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/.test(redirectUri)) throw new Error('잘못된 redirect_uri 입니다.');
  if (!state || !nonce || !codeChallenge) throw new Error('state/nonce/PKCE 값이 필요합니다.');
  const fresh = isNew || !clientId;
  const p = new URLSearchParams();
  p.set('client_id', fresh ? NEW_CLIENT_ID : clientId);
  if (fresh) p.set('agent_name_hint', AGENT_NAME);
  p.set('ext_agent_host_id', hostId);
  if (!fresh && idTokenHint) p.set('id_token_hint', idTokenHint);
  if (!fresh && loginHint) p.set('login_hint', loginHint);
  p.set('response_type', 'code');
  p.set('redirect_uri', redirectUri);
  p.set('scope', SCOPES);
  p.set('resource', RESOURCE);
  p.set('state', state);
  p.set('nonce', nonce);
  p.set('code_challenge_method', 'S256');
  p.set('code_challenge', codeChallenge);
  return AUTHORIZE_URL + '?' + p.toString();
}

class AuthError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * 콜백 주소를 해석한다. pending = { state, isNew, clientId }
 * @returns {{ code, clientId, scope }}
 */
function parseCallback(url, pending) {
  const u = new URL(url, 'http://127.0.0.1');
  const q = u.searchParams;
  const state = q.get('state');
  if (!pending || !state || state !== pending.state) throw new AuthError('state', '로그인 확인값(state)이 맞지 않습니다. 다시 시도해 주세요.');
  const err = q.get('error');
  if (err === 'access_denied') throw new AuthError('denied', 'ChatGPT 로그인 또는 요금제 사용 허용이 취소되었습니다.');
  if (err) throw new AuthError('oauth', `ChatGPT 로그인 오류: ${err}`);
  const code = q.get('code');
  if (!code) throw new AuthError('oauth', '로그인 코드가 없습니다. 다시 시도해 주세요.');
  const cbClient = q.get('client_id');
  let clientId;
  if (pending.isNew || !pending.clientId) {
    if (!cbClient || cbClient === NEW_CLIENT_ID) throw new AuthError('registration', '앱 등록이 끝나지 않았습니다(client_id 없음). 다시 시도해 주세요.');
    clientId = cbClient;
  } else {
    if (cbClient && cbClient !== pending.clientId) throw new AuthError('client_mismatch', '다른 앱 등록으로 돌아왔습니다. 다시 시도해 주세요.');
    clientId = pending.clientId;
  }
  return { code, clientId, scope: q.get('scope') || '' };
}

function buildTokenForm({ clientId, code, verifier, redirectUri }) {
  const p = new URLSearchParams();
  p.set('grant_type', 'authorization_code');
  p.set('client_id', clientId);
  p.set('code', code);
  p.set('code_verifier', verifier);
  p.set('redirect_uri', redirectUri);
  p.set('resource', RESOURCE);
  return p.toString();
}

function buildRefreshForm({ clientId, refreshToken }) {
  const p = new URLSearchParams();
  p.set('grant_type', 'refresh_token');
  p.set('client_id', clientId);
  p.set('refresh_token', refreshToken);
  p.set('resource', RESOURCE);
  return p.toString();
}

function buildRevokeForm({ clientId, refreshToken }) {
  const p = new URLSearchParams();
  p.set('token', refreshToken);
  p.set('token_type_hint', 'refresh_token');
  p.set('client_id', clientId);
  return p.toString();
}

function parseScopes(scope) {
  if (Array.isArray(scope)) return scope.slice();
  return String(scope || '').split(/[\s+]+/).filter(Boolean);
}
function hasPlanScope(scopes) { return parseScopes(scopes).includes(PLAN_SCOPE); }

/** JWT 를 나눈다(검증 없음). */
function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new AuthError('id_token', 'ID 토큰 형식이 잘못되었습니다.');
  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  } catch (_) {
    throw new AuthError('id_token', 'ID 토큰을 읽을 수 없습니다.');
  }
  return { header, payload, signingInput: parts[0] + '.' + parts[1], signature: b64urlDecode(parts[2]) };
}

/** RS256 서명을 JWKS 로 검증하고 claims 를 돌려준다. */
function verifyJwt(token, jwks) {
  const d = decodeJwt(token);
  if (d.header.alg !== 'RS256') throw new AuthError('id_token', `지원하지 않는 서명 방식입니다: ${d.header.alg}`);
  const keys = (jwks && jwks.keys) || [];
  const cands = d.header.kid ? keys.filter((k) => k.kid === d.header.kid) : keys.filter((k) => k.kty === 'RSA');
  if (!cands.length) throw new AuthError('id_token', 'ID 토큰 서명 키를 찾지 못했습니다.');
  for (const jwk of cands) {
    try {
      const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      const ok = crypto.verify('RSA-SHA256', Buffer.from(d.signingInput), key, d.signature);
      if (ok) return d.payload;
    } catch (_) { /* 다음 키 */ }
  }
  throw new AuthError('id_token', 'ID 토큰 서명이 올바르지 않습니다.');
}

/** claims 검증: issuer, audience, exp, nonce. now 는 초 단위. */
function validateIdToken(claims, { issuer = ISSUER, audience, nonce, now = Math.floor(Date.now() / 1000), skew = 120 } = {}) {
  if (!claims || typeof claims !== 'object') throw new AuthError('id_token', 'ID 토큰 내용이 없습니다.');
  if (String(claims.iss || '').replace(/\/$/, '') !== issuer.replace(/\/$/, '')) throw new AuthError('id_token', 'ID 토큰 발급자가 다릅니다.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience || !aud.includes(audience)) throw new AuthError('id_token', 'ID 토큰 대상(client_id)이 다릅니다.');
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp && claims.azp !== audience) throw new AuthError('id_token', 'ID 토큰 대상(azp)이 다릅니다.');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new AuthError('id_token', 'ID 토큰이 만료되었습니다. 다시 로그인해 주세요.');
  if (nonce !== undefined && claims.nonce !== nonce) throw new AuthError('id_token', '로그인 확인값(nonce)이 맞지 않습니다.');
  if (!claims.sub) throw new AuthError('id_token', 'ID 토큰에 계정 정보(sub)가 없습니다.');
  return { sub: claims.sub, email: claims.email || '', name: claims.name || '' };
}

/**
 * Responses API 요청 본문. ChatGPT 요금제 사용 흐름의 제약:
 * store:false, stream:true, input 배열, system 메시지 대신 instructions, 지원 안 되는 필드 생략.
 */
function buildResponsesBody({ model, instructions, messages }) {
  if (!model) throw new Error('모델이 정해지지 않았습니다.');
  const input = [];
  for (const m of messages || []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const text = typeof m.content === 'string' ? m.content : String(m.content == null ? '' : m.content);
    if (!text) continue;
    input.push({ role: m.role, content: text });
  }
  if (!input.length) throw new Error('보낼 메시지가 없습니다.');
  const body = { model, input, store: false, stream: true };
  if (instructions) body.instructions = String(instructions);
  return body;
}

/**
 * SSE 파서. feed(chunk) 를 여러 번 부르면 조각 경계를 넘는 이벤트도 처리한다.
 * onEvent({type, data}) 를 부르고, 상태를 누적한다.
 */
function createSSEParser(onDelta) {
  let buf = '';
  const st = { text: '', completed: false, failed: null, incomplete: null, events: 0 };
  function handle(block) {
    let ev = '', data = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      let val = i < 0 ? '' : line.slice(i + 1);
      if (val.startsWith(' ')) val = val.slice(1);
      if (field === 'event') ev = val;
      else if (field === 'data') data.push(val);
    }
    if (!data.length) return;
    const raw = data.join('\n');
    if (raw === '[DONE]') return;
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { return; }
    const type = obj.type || ev;
    st.events++;
    if (type === 'response.output_text.delta' && typeof obj.delta === 'string') {
      st.text += obj.delta;
      if (onDelta) onDelta(obj.delta);
    } else if (type === 'response.completed') {
      st.completed = true;
      st.response = obj.response || null;
    } else if (type === 'response.failed') {
      const e = (obj.response && obj.response.error) || obj.error || {};
      st.failed = { code: e.code || 'unknown_error', message: e.message || '' };
    } else if (type === 'response.incomplete') {
      const r = obj.response || {};
      st.incomplete = { reason: (r.incomplete_details && r.incomplete_details.reason) || 'incomplete' };
    } else if (type === 'error') {
      st.failed = { code: obj.code || (obj.error && obj.error.code) || 'error', message: obj.message || (obj.error && obj.error.message) || '' };
    }
  }
  return {
    feed(chunk) {
      buf += chunk;
      let m;
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        handle(block);
      }
    },
    end() {
      if (buf.trim()) handle(buf);
      buf = '';
      return st;
    },
    state: st,
  };
}

/** 텍스트 조각 배열을 한 번에 해석(테스트·간단 사용). */
function parseSSE(chunks, onDelta) {
  const p = createSSEParser(onDelta);
  for (const c of [].concat(chunks || [])) p.feed(c);
  return p.end();
}

const USAGE_LIMIT_CODES = new Set(['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable', 'usage_limit_exceeded', 'rate_limit_exceeded', 'insufficient_quota']);
function isUsageLimitCode(code) { return USAGE_LIMIT_CODES.has(String(code || '')); }

function pickListedModels(json) {
  const arr = (json && (json.models || json.data)) || [];
  return arr.filter((m) => !m.visibility || m.visibility === 'list')
    .map((m) => ({ slug: m.slug || m.id, display_name: m.display_name || m.slug || m.id }))
    .filter((m) => m.slug);
}

module.exports = {
  ISSUER, AUTHORIZE_URL, TOKEN_URL, OIDC_CONFIG_URL, RESOURCE, RESPONSES_URL, MODELS_URL,
  NEW_CLIENT_ID, AGENT_NAME, PLAN_SCOPE, SCOPES, CALLBACK_PATH, PREFERRED_PORT, USAGE_URL,
  AuthError, b64url, b64urlDecode, randomToken, createPkce, pkceChallenge, newHostId, redirectUriFor,
  buildAuthorizeUrl, parseCallback, buildTokenForm, buildRefreshForm, buildRevokeForm,
  parseScopes, hasPlanScope, decodeJwt, verifyJwt, validateIdToken,
  buildResponsesBody, createSSEParser, parseSSE, isUsageLimitCode, pickListedModels,
};
