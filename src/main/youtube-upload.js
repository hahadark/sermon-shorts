'use strict';
// 유튜브 업로드: 구글 로그인(OAuth, 설치형 앱 방식) → 만든 MP4 를 내 채널에 올린다.
// - 로그인은 사용자의 기본 브라우저에서 구글 공식 화면으로 한다. 이 앱은 비밀번호를 받지 않는다.
// - 받은 갱신 토큰은 safeStorage 로 암호화해 설정에 둔다. 렌더러에는 토큰을 보내지 않는다.
// - 구글 OAuth 클라이언트(데스크톱 앱)는 설정에 넣은 것 → 앱에 들어 있는 google-client.json 순서로 쓴다.
//   구글 검증을 받지 않은 클라이언트로 올린 영상은 유튜브가 '비공개'로 묶는다.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Readable } = require('stream');
const { ipcMain, shell, safeStorage } = require('electron');
const settingsMod = require('./settings');
const guard = require('./fs-guard');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const CHANNEL_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const LINKS = {
  console: 'https://console.cloud.google.com/apis/credentials',
  api: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
  studio: 'https://studio.youtube.com/',
};
const PRIVACY = ['private', 'unlisted', 'public'];

let accessToken = null; // { token, exp }
let uploading = false;

// ---- 설정 ----
function bundledClient() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'google-client.json'), 'utf8'));
    const c = j.installed || j;
    return c.client_id ? { id: c.client_id, secret: c.client_secret || '' } : null;
  } catch (_) { return null; }
}
function client() {
  const s = settingsMod.loadSettings();
  if (s.ytClientId) return { id: s.ytClientId, secret: decrypt(s.ytClientSecretEnc), own: true };
  const b = bundledClient();
  return b ? { ...b, own: false } : null;
}
function encrypt(text) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('이 PC에서는 로그인 정보를 암호화할 수 없습니다.');
  return safeStorage.encryptString(text).toString('base64');
}
function decrypt(enc) {
  if (!enc || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch (_) { return ''; }
}
function refreshToken() { return decrypt(settingsMod.loadSettings().ytRefreshEnc); }

function status() {
  const s = settingsMod.loadSettings();
  const c = client();
  return {
    hasClient: !!c, ownClient: !!(c && c.own), clientIdSuffix: c ? c.id.slice(0, 12) : '',
    loggedIn: !!refreshToken(), channel: s.ytChannel || '',
    privacy: PRIVACY.includes(s.ytPrivacy) ? s.ytPrivacy : 'unlisted',
    autoUpload: !!s.ytAutoUpload,
  };
}

// ---- 로그인 ----
function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

async function postForm(url, form) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error_description || data.error || ('HTTP ' + res.status)), { code: data.error });
  return data;
}

function signIn() {
  const c = client();
  if (!c) return Promise.reject(new Error('구글 OAuth 클라이언트가 없습니다. [설정 → 유튜브]에서 클라이언트 ID 와 비밀번호를 넣어 주세요.'));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); server.close(); err ? reject(err) : resolve(val); };
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>${ok ? '유튜브 로그인이 끝났습니다.' : '로그인하지 못했습니다.'}</h2><p>이 창을 닫고 SermonShorts 로 돌아가세요.</p></body>`);
      if (!ok) { finish(new Error(u.searchParams.get('error') === 'access_denied' ? '로그인을 취소했습니다.' : '로그인 응답이 올바르지 않습니다.')); return; }
      try {
        const port = server.address().port;
        const t = await postForm(TOKEN_URL, { code: u.searchParams.get('code'), client_id: c.id, client_secret: c.secret, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: `http://127.0.0.1:${port}` });
        if (!t.refresh_token) throw new Error('구글이 갱신 토큰을 주지 않았습니다. 다시 로그인해 주세요.');
        accessToken = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
        let channel = '';
        try { channel = await channelName(); } catch (_) { /* 채널 이름은 없어도 된다 */ }
        settingsMod.saveSettings({ ytRefreshEnc: encrypt(t.refresh_token), ytChannel: channel });
        finish(null, status());
      } catch (e) { finish(e); }
    });
    const timer = setTimeout(() => finish(new Error('5분 안에 로그인이 끝나지 않았습니다. 다시 해 주세요.')), 5 * 60 * 1000);
    server.on('error', (e) => finish(e));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const q = new URLSearchParams({
        client_id: c.id, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', scope: SCOPES.join(' '),
        code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
      });
      shell.openExternal(`${AUTH_URL}?${q}`);
    });
  });
}

async function signOut() {
  const rt = refreshToken();
  accessToken = null;
  settingsMod.saveSettings({ ytRefreshEnc: '', ytChannel: '' });
  if (rt) { try { await postForm(REVOKE_URL, { token: rt }); } catch (_) { /* 이미 만료 */ } }
  return status();
}

async function getAccessToken() {
  if (accessToken && accessToken.exp > Date.now()) return accessToken.token;
  const rt = refreshToken(), c = client();
  if (!rt || !c) throw Object.assign(new Error('유튜브에 로그인되어 있지 않습니다. [설정 → 유튜브]에서 로그인해 주세요.'), { code: 'auth' });
  try {
    const t = await postForm(TOKEN_URL, { client_id: c.id, client_secret: c.secret, refresh_token: rt, grant_type: 'refresh_token' });
    accessToken = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
    return accessToken.token;
  } catch (e) {
    if (e.code === 'invalid_grant') {
      settingsMod.saveSettings({ ytRefreshEnc: '' });
      throw Object.assign(new Error('유튜브 로그인이 만료되었습니다. [설정 → 유튜브]에서 다시 로그인해 주세요.'), { code: 'auth' });
    }
    throw e;
  }
}

async function channelName() {
  const res = await fetch(CHANNEL_URL, { headers: { authorization: 'Bearer ' + await getAccessToken() } });
  const data = await res.json().catch(() => ({}));
  return (data.items && data.items[0] && data.items[0].snippet && data.items[0].snippet.title) || '';
}

// ---- 업로드 ----
/** 제목·설명 만들기 — 순수 함수 (테스트용으로 내보냄) */
function buildMetadata({ title, verse, church, speaker, privacy }) {
  let t = String(title || '').trim() || '설교 쇼츠';
  if (!/#shorts/i.test(t)) t += ' #Shorts';
  if (t.length > 100) t = t.slice(0, 100 - ' #Shorts'.length).trim() + ' #Shorts';
  const desc = [verse, [church, speaker].filter(Boolean).join(' · '), '', '#Shorts #설교'].filter((x, i) => x || i === 2).join('\n').trim();
  return {
    snippet: { title: t.replace(/[<>]/g, ''), description: desc.replace(/[<>]/g, '').slice(0, 5000), categoryId: '29', defaultLanguage: 'ko', defaultAudioLanguage: 'ko' },
    status: { privacyStatus: PRIVACY.includes(privacy) ? privacy : 'unlisted', selfDeclaredMadeForKids: false },
  };
}

function apiError(status, data) {
  const reason = data && data.error && data.error.errors && data.error.errors[0] && data.error.errors[0].reason;
  const msg = (data && data.error && data.error.message) || '';
  if (reason === 'quotaExceeded') return new Error('오늘 유튜브 업로드 한도를 다 썼습니다. 내일 다시 하거나 유튜브 스튜디오에서 직접 올려 주세요.');
  if (reason === 'uploadLimitExceeded') return new Error('이 채널의 하루 업로드 개수 제한에 걸렸습니다. 내일 다시 해 주세요.');
  if (status === 401) return Object.assign(new Error('유튜브 로그인이 만료되었습니다. 다시 로그인해 주세요.'), { code: 'auth' });
  if (status === 403 && /youtubeSignupRequired|channel/i.test(reason + msg)) return new Error('이 구글 계정에 유튜브 채널이 없습니다. 유튜브에서 채널을 먼저 만들어 주세요.');
  return new Error(`유튜브 업로드 오류 ${status}: ${msg.slice(0, 200)}`);
}

async function upload(filePath, meta, onProgress) {
  if (uploading) throw new Error('이미 업로드가 진행 중입니다.');
  uploading = true;
  try {
    const file = guard.check(filePath);
    if (!/\.mp4$/i.test(file) || !fs.existsSync(file)) throw new Error('올릴 MP4 파일이 없습니다.');
    const size = fs.statSync(file).size;
    const s = settingsMod.loadSettings();
    const body = buildMetadata({ ...meta, privacy: meta.privacy || s.ytPrivacy });
    const token = await getAccessToken();
    onProgress({ pct: 0, message: '유튜브 업로드 준비 중' });
    const init = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(size) },
      body: JSON.stringify(body),
    });
    if (!init.ok) throw apiError(init.status, await init.json().catch(() => ({})));
    const location = init.headers.get('location');
    if (!location) throw new Error('유튜브가 업로드 주소를 주지 않았습니다.');
    // 파일을 흘려 보내면서 읽은 만큼 진행률을 알린다
    let sent = 0, last = 0;
    const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => {
      sent += chunk.length;
      if (Date.now() - last > 400) { last = Date.now(); onProgress({ pct: Math.round(sent / size * 99), message: `유튜브에 올리는 중… ${Math.round(sent / size * 100)}%` }); }
    });
    const put = await fetch(location, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(size) }, body: Readable.toWeb(stream), duplex: 'half' });
    const data = await put.json().catch(() => ({}));
    if (!put.ok) throw apiError(put.status, data);
    const url = `https://youtu.be/${data.id}`;
    onProgress({ pct: 100, message: '유튜브에 올렸습니다' });
    return { ok: true, id: data.id, url, studio: `https://studio.youtube.com/video/${data.id}/edit`, privacy: data.status && data.status.privacyStatus, title: body.snippet.title };
  } finally {
    uploading = false;
  }
}

function initYoutubeUpload() {
  ipcMain.handle('ytup:status', () => status());
  ipcMain.handle('ytup:signIn', () => signIn());
  ipcMain.handle('ytup:signOut', () => signOut());
  ipcMain.handle('ytup:setOptions', (_e, o = {}) => {
    const next = {};
    if (PRIVACY.includes(o.privacy)) next.ytPrivacy = o.privacy;
    if (typeof o.autoUpload === 'boolean') next.ytAutoUpload = o.autoUpload;
    if (typeof o.clientId === 'string') {
      const id = o.clientId.trim();
      if (id && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error('클라이언트 ID 형식이 아닙니다. ...apps.googleusercontent.com 으로 끝나는 값을 넣어 주세요.');
      if (id !== (settingsMod.loadSettings().ytClientId || '')) { next.ytClientId = id; next.ytRefreshEnc = ''; next.ytChannel = ''; accessToken = null; }
      if (typeof o.clientSecret === 'string' && o.clientSecret.trim()) next.ytClientSecretEnc = encrypt(o.clientSecret.trim());
      if (!id) next.ytClientSecretEnc = '';
    }
    settingsMod.saveSettings(next);
    return status();
  });
  ipcMain.handle('ytup:openLink', (_e, key) => { if (!LINKS[key]) throw new Error('알 수 없는 링크입니다.'); return shell.openExternal(LINKS[key]); });
  ipcMain.handle('ytup:openUrl', (_e, url) => {
    if (!/^https:\/\/(youtu\.be|studio\.youtube\.com)\//.test(String(url))) throw new Error('열 수 없는 주소입니다.');
    return shell.openExternal(url);
  });
  ipcMain.handle('ytup:upload', (event, filePath, meta) => upload(filePath, meta || {}, (info) => {
    if (!event.sender.isDestroyed()) event.sender.send('progress', { task: 'ytupload', ...info });
  }));
}

module.exports = { initYoutubeUpload, buildMetadata };
