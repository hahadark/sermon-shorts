'use strict';
// ChatGPT 로그인으로 사용자 본인의 ChatGPT 요금제를 써서 대화한다 (Sign in with ChatGPT, 로컬 앱용).
// 토큰은 safeStorage 로 암호화해 userData/llm/chatgpt.json 에만 둔다. 토큰은 절대 로그에 남기지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const core = require('./chatgpt-core');

const SIGNIN_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_MARGIN_S = 120;

function err(code, message) { const e = new Error(message); e.code = code; return e; }

function resultPage(ok, msg) {
  const title = ok ? '로그인이 끝났습니다' : '로그인하지 못했습니다';
  const body = ok ? '로그인이 끝났습니다. SermonShorts로 돌아가세요.' : (msg || '다시 시도해 주세요.');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;background:#f5f5f5}
div{background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 2px 12px #0002;font-size:18px}</style></head>
<body><div>${body.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</div></body></html>`;
}

function createChatGPT({ app, shell, safeStorage, fetchImpl = global.fetch, http = require('node:http') } = {}) {
  if (!app || !shell) throw new Error('createChatGPT: app, shell 이 필요합니다.');
  const file = path.join(app.getPath('userData'), 'llm', 'chatgpt.json');
  let refreshing = null;
  let signingIn = null;
  let oidcCache = null;

  // ---------- 저장소 ----------
  function ensureCrypto() {
    if (!safeStorage || !safeStorage.isEncryptionAvailable || !safeStorage.isEncryptionAvailable()) {
      throw err('storage', '이 컴퓨터에서 로그인 정보를 안전하게 저장할 수 없습니다(암호화 기능 없음).');
    }
  }
  function load() {
    try {
      if (!fs.existsSync(file)) return {};
      ensureCrypto();
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (!raw) return {};
      return JSON.parse(safeStorage.decryptString(Buffer.from(raw, 'base64')));
    } catch (e) {
      if (e.code === 'storage') throw e;
      return {}; // 손상되었으면 새로 시작
    }
  }
  function save(data) {
    ensureCrypto();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const enc = safeStorage.encryptString(JSON.stringify(data)).toString('base64');
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, enc, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  function hostId(store) {
    if (!store.ext_agent_host_id) { store.ext_agent_host_id = core.newHostId(); save(store); }
    return store.ext_agent_host_id;
  }

  // ---------- 네트워크 ----------
  async function postForm(url, form) {
    const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    return { ok: r.ok, status: r.status, json };
  }
  async function oidc() {
    if (oidcCache) return oidcCache;
    const r = await fetchImpl(core.OIDC_CONFIG_URL);
    if (!r.ok) throw err('network', `ChatGPT 로그인 서버에 연결하지 못했습니다 (${r.status}).`);
    oidcCache = await r.json();
    return oidcCache;
  }
  async function jwks() {
    const cfg = await oidc();
    const r = await fetchImpl(cfg.jwks_uri);
    if (!r.ok) throw err('network', `로그인 서명 키를 받지 못했습니다 (${r.status}).`);
    return r.json();
  }

  function saveTokens(store, tok, extra = {}) {
    const now = Math.floor(Date.now() / 1000);
    store.access_token = tok.access_token;
    if (tok.refresh_token) store.refresh_token = tok.refresh_token;
    if (tok.id_token) store.id_token = tok.id_token;
    store.token_type = tok.token_type || 'Bearer';
    store.expires_in = tok.expires_in || 3600;
    store.expires_at = now + (Number(tok.expires_in) || 3600);
    if (tok.scope) store.scopes = core.parseScopes(tok.scope);
    store.saved_at = new Date().toISOString();
    Object.assign(store, extra);
    save(store);
  }

  // ---------- 로그인 ----------
  function listen() {
    return new Promise((resolve, reject) => {
      const tryPort = (port, fallback) => {
        const srv = http.createServer();
        srv.once('error', (e) => {
          if (fallback && (e.code === 'EADDRINUSE' || e.code === 'EACCES')) tryPort(0, false);
          else reject(err('network', `로그인 창을 받을 준비를 하지 못했습니다: ${e.code || e.message}`));
        });
        srv.listen(port, '127.0.0.1', () => resolve(srv));
      };
      tryPort(core.PREFERRED_PORT, true);
    });
  }

  async function doSignIn() {
    const store = load();
    const host = hostId(store);
    const isNew = !store.client_id;
    const pkce = core.createPkce();
    const state = core.randomToken(24);
    const nonce = core.randomToken(24);
    const srv = await listen();
    const port = srv.address().port;
    const redirectUri = core.redirectUriFor(port);
    const pending = { state, isNew, clientId: store.client_id };
    try {
      const cb = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(err('timeout', '로그인 시간이 지났습니다(5분). 다시 시도해 주세요.')), SIGNIN_TIMEOUT_MS);
        srv.on('request', (req, res) => {
          const u = new URL(req.url, 'http://127.0.0.1');
          if (u.pathname !== core.CALLBACK_PATH) { res.writeHead(404); res.end(); return; }
          try {
            const parsed = core.parseCallback(req.url, pending);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(resultPage(true));
            clearTimeout(timer);
            resolve(parsed);
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(resultPage(false, e.message));
            if (e.code !== 'state') { clearTimeout(timer); reject(e); }
          }
        });
        const url = core.buildAuthorizeUrl({
          clientId: store.client_id, hostId: host, redirectUri, state, nonce, codeChallenge: pkce.challenge,
          idTokenHint: store.id_token, loginHint: store.email, isNew,
        });
        Promise.resolve(shell.openExternal(url)).catch((e) => { clearTimeout(timer); reject(err('browser', '브라우저를 열지 못했습니다: ' + e.message)); });
      });

      const tokRes = await postForm(core.TOKEN_URL, core.buildTokenForm({ clientId: cb.clientId, code: cb.code, verifier: pkce.verifier, redirectUri }));
      if (!tokRes.ok || !tokRes.json || !tokRes.json.access_token) {
        const code = tokRes.json && tokRes.json.error;
        throw err('token', code === 'invalid_grant' ? '로그인 코드가 만료되었습니다. 다시 시도해 주세요.' : `로그인 토큰을 받지 못했습니다 (${tokRes.status}${code ? ', ' + code : ''}).`);
      }
      const tok = tokRes.json;
      const claims = core.verifyJwt(tok.id_token, await jwks());
      const ident = core.validateIdToken(claims, { audience: cb.clientId, nonce });
      if (!isNew && store.subject && store.subject !== ident.sub) {
        throw err('account_mismatch', '처음 연결한 ChatGPT 계정과 다른 계정으로 로그인했습니다. 원래 계정으로 다시 로그인하거나, 연결을 끊고 새로 연결해 주세요.');
      }
      const scopes = core.parseScopes(tok.scope || cb.scope);
      const planEnabled = core.hasPlanScope(scopes);
      saveTokens(store, { ...tok, scope: scopes.join(' ') }, {
        issuer: core.ISSUER, client_id: cb.clientId, subject: ident.sub, email: ident.email, name: ident.name, planEnabled,
      });
      return publicStatus(store);
    } finally {
      srv.close();
    }
  }

  function signIn() {
    if (!signingIn) signingIn = doSignIn().finally(() => { signingIn = null; });
    return signingIn;
  }

  // ---------- 토큰 갱신 ----------
  async function doRefresh(store) {
    if (!store.refresh_token || !store.client_id) throw err('auth', 'ChatGPT 로그인이 필요합니다.');
    const r = await postForm(core.TOKEN_URL, core.buildRefreshForm({ clientId: store.client_id, refreshToken: store.refresh_token }));
    if (!r.ok || !r.json || !r.json.access_token) {
      if (r.status === 400 || r.status === 401) {
        delete store.access_token; delete store.refresh_token; save(store);
        throw err('auth', 'ChatGPT 로그인이 만료되었습니다. 다시 로그인해 주세요.');
      }
      throw err('network', `ChatGPT 로그인 갱신에 실패했습니다 (${r.status}).`);
    }
    const scopes = r.json.scope ? core.parseScopes(r.json.scope) : store.scopes;
    saveTokens(store, { ...r.json, scope: (scopes || []).join(' ') }, { planEnabled: core.hasPlanScope(scopes) });
    return store;
  }
  function refresh(force = false) {
    if (!refreshing) {
      refreshing = (async () => {
        const store = load();
        const now = Math.floor(Date.now() / 1000);
        if (!force && store.access_token && store.expires_at && store.expires_at - now > REFRESH_MARGIN_S) return store;
        return doRefresh(store);
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }
  async function token() {
    const store = load();
    if (!store.access_token && !store.refresh_token) throw err('auth', 'ChatGPT 로그인이 필요합니다.');
    const now = Math.floor(Date.now() / 1000);
    if (store.access_token && store.expires_at && store.expires_at - now > REFRESH_MARGIN_S) return store;
    return refresh(false);
  }

  // ---------- 상태 ----------
  function publicStatus(store) {
    return {
      connected: !!(store.access_token || store.refresh_token),
      email: store.email || '',
      planEnabled: !!store.planEnabled,
      model: store.model || '',
    };
  }
  async function status() { return publicStatus(load()); }

  async function setModel(model) { const s = load(); s.model = model || ''; save(s); return publicStatus(s); }

  // ---------- 모델 ----------
  async function listModels() {
    let store = await token();
    let r = await fetchImpl(core.MODELS_URL, { headers: { Authorization: 'Bearer ' + store.access_token } });
    if (r.status === 401) { store = await refresh(true); r = await fetchImpl(core.MODELS_URL, { headers: { Authorization: 'Bearer ' + store.access_token } }); }
    if (r.status === 401) throw err('auth', 'ChatGPT 로그인이 만료되었습니다. 다시 로그인해 주세요.');
    if (!r.ok) throw err('network', `ChatGPT 모델 목록을 받지 못했습니다 (${r.status}).`);
    return core.pickListedModels(await r.json());
  }

  // ---------- 대화 ----------
  async function readStream(res, onDelta) {
    const p = core.createSSEParser(onDelta);
    const dec = new TextDecoder('utf-8');
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        p.feed(dec.decode(value, { stream: true }));
      }
      p.feed(dec.decode());
    } else if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
      for await (const chunk of res.body) p.feed(typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true }));
      p.feed(dec.decode());
    } else {
      p.feed(await res.text());
    }
    return p.end();
  }

  async function errorFromResponse(r) {
    let j = null;
    try { j = await r.json(); } catch (_) { /* 무시 */ }
    const code = j && (j.error && (j.error.code || j.error.type) || j.code);
    if (core.isUsageLimitCode(code) || r.status === 429) return err('usage_limit', 'ChatGPT 사용 한도에 도달했습니다. ChatGPT 설정 > 사용량에서 확인해 주세요.');
    if (r.status === 403) return err('plan', 'ChatGPT 요금제 사용이 허용되지 않았습니다. ChatGPT Go·Plus·Pro 요금제인지 확인하고 다시 연결해 주세요.');
    const msg = j && j.error && j.error.message;
    return err('api', `ChatGPT 요청이 실패했습니다 (${r.status})${msg ? ': ' + String(msg).slice(0, 200) : ''}`);
  }

  async function complete({ instructions, messages, model, onDelta, signal } = {}) {
    let store = await token();
    if (!store.planEnabled) throw err('plan', 'ChatGPT 요금제 사용이 허용되지 않았습니다. 다시 연결하면서 "ChatGPT 요금제 사용"을 허용해 주세요.');
    let useModel = model || store.model;
    if (!useModel) {
      const ms = await listModels();
      if (!ms.length) throw err('api', '사용할 수 있는 ChatGPT 모델이 없습니다.');
      useModel = ms[0].slug;
    }
    const body = JSON.stringify(core.buildResponsesBody({ model: useModel, instructions, messages }));
    const send = (s) => fetchImpl(core.RESPONSES_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body,
      signal,
    });
    let r = await send(store);
    if (r.status === 401) { store = await refresh(true); r = await send(store); }
    if (r.status === 401) throw err('auth', 'ChatGPT 로그인이 만료되었습니다. 다시 로그인해 주세요.');
    if (!r.ok) throw await errorFromResponse(r);
    const st = await readStream(r, onDelta);
    if (st.failed) {
      if (core.isUsageLimitCode(st.failed.code)) throw err('usage_limit', 'ChatGPT 사용 한도에 도달했습니다. ChatGPT 설정 > 사용량에서 확인해 주세요.');
      throw err('api', `ChatGPT 응답이 실패했습니다 (${st.failed.code})${st.failed.message ? ': ' + st.failed.message.slice(0, 200) : ''}`);
    }
    if (st.incomplete) throw err('incomplete', `ChatGPT 응답이 중간에 끝났습니다 (${st.incomplete.reason}). 다시 시도해 주세요.`);
    if (!st.completed) throw err('incomplete', 'ChatGPT 응답이 끝까지 오지 않았습니다. 다시 시도해 주세요.');
    return { text: st.text, model: useModel };
  }

  // ---------- 연결 끊기 ----------
  async function signOut() {
    const store = load();
    let revoked = true;
    if (store.refresh_token && store.client_id) {
      revoked = false;
      try {
        const cfg = await oidc();
        const url = cfg.revocation_endpoint;
        if (url) {
          for (let i = 0; i < 2 && !revoked; i++) {
            try {
              const r = await postForm(url, core.buildRevokeForm({ clientId: store.client_id, refreshToken: store.refresh_token }));
              if (r.ok) revoked = true;
              else if (r.status < 500) break;
            } catch (_) { /* 재시도 */ }
          }
        }
      } catch (_) { /* 서버 연결 실패 */ }
    }
    for (const k of ['access_token', 'refresh_token', 'id_token', 'expires_at', 'expires_in', 'scopes', 'planEnabled', 'token_type', 'saved_at']) delete store[k];
    // client_id, subject, email, ext_agent_host_id 는 다음 로그인을 위해 남긴다
    save(store);
    return { ...publicStatus(store), revoked };
  }

  return { status, signIn, signOut, listModels, complete, setModel, usageUrl: core.USAGE_URL };
}

module.exports = { createChatGPT };
