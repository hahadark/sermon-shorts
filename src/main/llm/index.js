'use strict';
// AI 연결(챗GPT·클로드·제미나이·오픈라우터)과 대화형 편집 세션. 렌더러에는 토큰·키를 절대 보내지 않는다.
const { ipcMain, shell, app, safeStorage } = require('electron');
const settingsMod = require('../settings');
const youtube = require('../youtube');
const claude = require('./claude');
const gemini = require('./gemini');
const openrouter = require('./openrouter');
const chatPlan = require('../../shared/chat-plan');
const fs = require('fs');
const path = require('path');
const tools = require('../tools');

let chatgpt = null;
function getChatGPT() {
  if (!chatgpt) {
    const { createChatGPT } = require('./chatgpt');
    chatgpt = createChatGPT({ app, shell, safeStorage });
  }
  return chatgpt;
}

const PROVIDERS = ['chatgpt', 'claude', 'gemini', 'openrouter'];
const LINKS = {
  chatgptUsage: 'https://chatgpt.com/settings/usage',
  chatgptPlans: 'https://chatgpt.com/pricing',
  claudePlans: 'https://claude.com/pricing',
  claudeSetup: 'https://code.claude.com/docs/en/setup',
  geminiKey: 'https://aistudio.google.com/apikey',
  openrouterKey: 'https://openrouter.ai/settings/keys',
};

function activeProvider() {
  const s = settingsMod.loadSettings();
  return PROVIDERS.includes(s.aiProvider) ? s.aiProvider : null;
}

async function statusAll() {
  const pub = settingsMod.getPublicSettings ? settingsMod.getPublicSettings() : {};
  const [gpt, cl] = await Promise.all([
    getChatGPT().status().catch((e) => ({ connected: false, error: e.message })),
    claude.status().catch((e) => ({ installed: false, loggedIn: false, error: e.message })),
  ]);
  return {
    active: activeProvider(),
    chatgpt: gpt,
    claude: cl,
    gemini: { hasKey: !!(pub.hasApiKey || pub.hasEnvApiKey), suffix: pub.apiKeySuffix || '' },
    openrouter: { hasKey: !!pub.hasOpenrouterKey, suffix: pub.openrouterKeySuffix || '', model: pub.openrouterModel || openrouter.DEFAULT_MODEL },
    platform: process.platform,
  };
}

async function complete(provider, { system, messages, onDelta, onStage, signal }) {
  if (provider === 'chatgpt') return getChatGPT().complete({ instructions: system, messages, onDelta, signal });
  if (provider === 'claude') return claude.complete({ system, messages, model: 'sonnet', onStage, onDelta, signal });
  if (provider === 'gemini') return gemini.complete({ system, messages, signal });
  if (provider === 'openrouter') return openrouter.complete({ system, messages, model: settingsMod.loadSettings().openrouterModel || undefined, keyProvider: settingsMod.getOpenrouterApiKey, signal });
  throw Object.assign(new Error('AI 가 연결되어 있지 않습니다. [AI 연결]에서 하나를 골라 연결해 주세요.'), { code: 'no_provider' });
}

// ---- 대화형 편집 세션 (한 번에 영상 하나) ----
let session = null;

async function loadVideo(url) {
  // 같은 영상을 다시 불러오면 앞의 대화(AI 기억·편집 계획)를 이어간다 ([새로]를 눌러도 잊지 않게)
  if (session && session.url === url && Array.isArray(session.words) && session.words.length) {
    return {
      url, title: session.info.title || '', duration: session.info.duration || 0, resumed: true,
      hasPlan: !!(session.plan && session.plan.ranges && session.plan.ranges.length),
      words: session.words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
    };
  }
  // 자막을 받다가 실패한 경우(번역 자막 429 등)도 '자막 없음'으로 보고 위스퍼를 고를 수 있게 한다. 영상 자체가 없으면 아래 fetchInfo 에서 오류
  const subs = await youtube.fetchAutoSubs(url, { raw: true }).catch((e) => { if (/subtitle|자막/i.test(String(e && e.message))) return null; throw e; });
  if (!subs || !subs.raw) {
    // 유튜브 자막이 없다: 전에 위스퍼로 만든 것이 있으면 그것으로, 없으면 위스퍼로 만들지 물어볼 수 있게 알린다
    const info = await youtube.fetchInfo(url);
    const cached = readWhisperCache(info.id);
    if (cached) return startSession(url, info, cached.words, cached.lines, { whisper: true });
    return { noSubs: true, url, title: info.title || '', duration: info.duration || 0, live: liveNow(info), engineReady: fs.existsSync(tools.python) };
  }
  const { words, lines } = chatPlan.wordsFromJson3(subs.raw);
  if (words.length < 20) throw new Error('자막이 너무 짧습니다. 다른 영상을 넣어 주세요.');
  const info = subs.info || {};
  session = { url, info, words, lines, history: [], plan: null, sermon: null };
  return {
    url, title: info.title || '', duration: info.duration || 0,
    words: words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
  };
}

// ---- 유튜브 자막이 없는 영상: 이 PC 의 위스퍼(자막 엔진)로 영상 전체 소리에서 자막을 만든다 ----
const liveNow = (info) => info.liveStatus === 'is_live' || info.liveStatus === 'is_upcoming';
function whisperCacheFile(id) { return path.join(tools.ensureDir(path.join(tools.cache, 'chat')), `whisper_${String(id).replace(/[^\w-]/g, '_')}.json`); }
function readWhisperCache(id) {
  try { const j = JSON.parse(fs.readFileSync(whisperCacheFile(id), 'utf8')); return Array.isArray(j.words) && j.words.length && Array.isArray(j.lines) ? j : null; } catch (_) { return null; }
}
/** 위스퍼 단어 → 대화용 단어·줄 (줄: 문장 끝·0.7초 넘는 쉼·16단어마다 끊는다. 줄 모양은 wordsFromJson3 과 같다) */
function whisperWordsToLines(raw) {
  const words = [], lines = [];
  for (const w of raw || []) {
    const text = String(w.text || '').replace(/\s+/g, ' ').trim();
    if (!text || !Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
    words.push({ id: words.length, text, start: w.start, end: Math.max(w.end, w.start + 0.05) });
  }
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1];
    const brk = !next || /[.?!。？！]$/.test(w.text) || next.start - w.end > 0.7 || i - from + 1 >= 16;
    if (brk) { lines.push({ start: words[from].start, from, to: i }); from = i + 1; }
  }
  return { words, lines };
}
function startSession(url, info, words, lines, extra = {}) {
  session = { url, info: { title: info.title, duration: info.duration }, words, lines, history: [], plan: null, sermon: null };
  return { url, title: info.title || '', duration: info.duration || 0, ...extra, words: words.map((w) => ({ text: w.text, start: w.start, end: w.end })) };
}
let whisperStop = null;
/** 영상 소리를 받아(이미 받았으면 그대로) 위스퍼로 자막을 만든다. onProgress({stage:'download'|'transcribe', pct}) */
async function loadVideoWhisper(url, onProgress) {
  const engine = require('../engine');
  const info = await youtube.fetchInfo(url);
  if (liveNow(info)) throw new Error('라이브가 아직 진행 중이라 소리를 받을 수 없습니다. 방송이 끝난 뒤 다시 해 주세요.');
  if (!fs.existsSync(tools.python)) throw new Error('위스퍼(자막 엔진)가 설치되어 있지 않습니다. 도움말 → 시스템 점검에서 [엔진 설치]를 한 뒤 다시 불러와 주세요.');
  let stopped = false;
  whisperStop = () => { stopped = true; engine.cancelTask(); };
  try {
    const dir = tools.ensureDir(path.join(tools.cache, 'yt', String(info.id)));
    const a = await youtube.downloadAudio(url, dir, (p) => onProgress && onProgress({ stage: 'download', pct: p }));
    if (stopped) throw Object.assign(new Error('요청을 멈췄습니다.'), { code: 'cancelled' });
    const res = await engine.transcribe(a.file, {}, (m) => { if (onProgress && m && m.stage !== 'warn') onProgress({ stage: 'transcribe', pct: Number.isFinite(m.pct) ? m.pct : null, message: m.message || '' }); });
    if (stopped) throw Object.assign(new Error('요청을 멈췄습니다.'), { code: 'cancelled' });
    const { words, lines } = whisperWordsToLines(res && res.words);
    if (words.length < 20) throw new Error('위스퍼가 알아들은 말이 너무 적습니다. 다른 영상을 넣어 주세요.');
    fs.writeFileSync(whisperCacheFile(info.id), JSON.stringify({ url, title: info.title || '', words, lines }), 'utf8');
    return startSession(url, info, words, lines, { whisper: true });
  } finally { whisperStop = null; }
}
function transcriptRange() {
  if (!session.sermon) return null;
  const w = session.words;
  return { start: w[session.sermon.from].start - 30, end: w[session.sermon.to].end + 30 };
}

// 지금 AI 에게 묻는 중인 요청 (멈추기용)
let current = null;
const cancelledErr = () => Object.assign(new Error('요청을 멈췄습니다.'), { code: 'cancelled' });
/** 대화 보내기. onStage({stage}) 로 진행 단계를 알린다: prepare → ask → (think → write) → check (→ retry → check) */
async function send(text, onDelta, onStage) {
  const ac = new AbortController();
  if (current) current.abort();
  current = ac;
  const stage = (s) => { if (onStage && !ac.signal.aborted) { try { onStage(s); } catch (_) { /* 창이 닫힘 */ } } };
  try { return await sendInner(text, onDelta, stage, ac.signal); }
  catch (e) { if (ac.signal.aborted || (e && e.code === 'cancelled')) throw cancelledErr(); throw e; }
  finally { if (current === ac) current = null; }
}
function cancel() { if (!current) return false; current.abort(); return true; }

async function sendInner(text, onDelta, stage, signal) {
  if (!session) throw new Error('먼저 설교 영상의 유튜브 주소를 넣어 주세요.');
  const provider = activeProvider();
  stage({ stage: 'prepare', provider, words: session.words.length });
  const s = settingsMod.loadSettings();
  const tpl = s.template || {};
  const system = chatPlan.buildSystemPrompt({ church: tpl.churchName, speaker: s.defaultSpeaker || tpl.defaultSpeaker, terms: s.churchTerms, videoTitle: session.info.title })
    + '\n\n[설교 자막]\n' + chatPlan.transcriptText(session.words, session.lines, transcriptRange());
  const current = session.plan ? {
    title: session.plan.title, verse: session.plan.verse, tighten: session.plan.tighten,
    segments: chatPlan.describeRanges(session.plan.ranges, session.words),
    remainingQuestions: chatPlan.questionsIn(session.plan.ranges, session.words),
  } : null;
  const userMsg = chatPlan.buildUserMessage(text, { current, durationSec: session.plan ? chatPlan.rangesDuration(session.plan.ranges, session.words) : 0 });
  const messages = session.history.slice(-8).concat([{ role: 'user', content: userMsg }]);
  const t0 = Date.now();
  stage({ stage: 'ask', provider });
  const { text: answer } = await complete(provider, { system, messages, onDelta, onStage: stage, signal });
  if (signal.aborted) throw cancelledErr();
  stage({ stage: 'check' });
  let plan;
  try {
    plan = chatPlan.parsePlan(answer);
  } catch (e) {
    if (e.code !== 'format') throw e;
    // 형식이 깨진 답이면 한 번 고쳐 달라고 한다
    console.log('[SermonShorts] AI 답 형식 오류, 다시 요청:', e.detail || '', String(answer || '').slice(0, 200).replace(/\s+/g, ' '));
    stage({ stage: 'retry' });
    const fix = await complete(provider, { signal, onStage: stage, system, messages: messages.concat([
      { role: 'assistant', content: String(answer || '').slice(0, 12000) },
      { role: 'user', content: '방금 답은 JSON 형식이 잘못되어 읽을 수 없습니다. 같은 편집 내용을 [답 형식]에 맞는 올바른 JSON 하나로만 다시 쓰세요. 문자열 안의 따옴표는 \\" 로, 줄바꿈은 \\n 으로 쓰세요.' },
    ]), onDelta });
    if (signal.aborted) throw cancelledErr();
    stage({ stage: 'check' });
    plan = chatPlan.parsePlan(fix.text);
  }
  const resolved = chatPlan.resolvePlan(plan, session.words);
  // 구간 추천: 후보만 돌려주고 지금 편집은 그대로 둔다
  const candidates = chatPlan.resolveCandidates(plan.candidates, session.words);
  const recommend = candidates.length > 0; // 후보가 오면 추천으로 본다 (같이 온 segments 는 반영하지 않음)
  if (candidates.length) session.candidates = candidates;
  if (!resolved.ranges.length && session.plan) resolved.ranges = session.plan.ranges; // 질문만 한 경우
  if (plan.sermon && isFinite(plan.sermon.from) && isFinite(plan.sermon.to)) {
    const n = session.words.length;
    const f = Math.max(0, Math.min(n - 1, Math.round(plan.sermon.from))), t = Math.max(0, Math.min(n - 1, Math.round(plan.sermon.to)));
    if (t > f) session.sermon = { from: f, to: t };
  }
  const prev = session.plan;
  // 추천이면 지금 편집(구간·제목)은 그대로 둔다
  session.plan = recommend
    ? { title: (prev && prev.title) || '', verse: (prev && prev.verse) || plan.verse || '', tighten: prev ? prev.tighten : plan.tighten, ranges: prev ? prev.ranges : [] }
    : { title: plan.title || (prev && prev.title) || '', verse: plan.verse || (prev && prev.verse) || '', tighten: plan.tighten, ranges: resolved.ranges };
  const memo = { reply: plan.reply, title: session.plan.title, segments: chatPlan.describeRanges(session.plan.ranges, session.words).map((r) => ({ from: r.from, to: r.to })) };
  if (candidates.length) memo.candidates = candidates.map((c) => ({ no: c.no, from: c.from, to: c.to, title: c.title }));
  session.history.push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify(memo) });
  return {
    reply: plan.reply || (recommend ? '추천 구간입니다.' : '편집했습니다.'),
    title: session.plan.title, verse: session.plan.verse, tighten: session.plan.tighten,
    // 추천만 한 답이면 편집기에 다시 반영하지 않도록 빈 구간을 보낸다
    ranges: recommend ? [] : resolved.ranges, corrections: recommend ? [] : resolved.corrections, warnings: resolved.warnings,
    candidates: candidates.map((c) => ({ no: c.no, title: c.title, summary: c.summary, why: c.why, from: c.from, to: c.to, start: c.start, end: c.end, durationSec: c.durationSec, excerpt: c.excerpt })),
    questions: chatPlan.questionsIn(resolved.ranges, session.words),
    durationSec: chatPlan.rangesDuration(resolved.ranges, session.words),
    provider, ms: Date.now() - t0,
  };
}

function initLlm() {
  ipcMain.handle('llm:status', () => statusAll());
  ipcMain.handle('llm:setActive', (_e, name) => {
    if (name !== null && !PROVIDERS.includes(name)) throw new Error('알 수 없는 AI 입니다.');
    settingsMod.saveSettings({ aiProvider: name });
    return statusAll();
  });
  ipcMain.handle('llm:openLink', (_e, key) => {
    if (!LINKS[key]) throw new Error('알 수 없는 링크입니다.');
    return shell.openExternal(LINKS[key]);
  });
  ipcMain.handle('llm:chatgptSignIn', async () => { const r = await getChatGPT().signIn(); settingsMod.saveSettings({ aiProvider: 'chatgpt' }); return r; });
  ipcMain.handle('llm:chatgptSignOut', () => getChatGPT().signOut());
  ipcMain.handle('llm:claudeInstall', () => claude.openInstall());
  ipcMain.handle('llm:claudeLogin', () => claude.openLogin());
  ipcMain.handle('llm:test', async (_e, name) => {
    const r = await complete(name, { system: '짧게 답하세요. JSON 으로만 답합니다.', messages: [{ role: 'user', content: '{"ok":true} 를 그대로 답하세요.' }] });
    return { ok: /ok/.test(r.text || ''), text: String(r.text || '').slice(0, 80) };
  });
  ipcMain.handle('chat:load', (_e, url) => loadVideo(url));
  ipcMain.handle('chat:send', (event, text) => send(text, (delta) => {
    if (!event.sender.isDestroyed()) event.sender.send('chat:delta', delta);
  }, (s) => {
    if (!event.sender.isDestroyed()) event.sender.send('chat:stage', s);
  }));
  ipcMain.handle('chat:cancel', () => cancel());
  ipcMain.handle('chat:loadWhisper', (event, url) => loadVideoWhisper(url, (p) => {
    if (!event.sender.isDestroyed()) event.sender.send('progress', { task: 'chat-whisper', ...p });
  }));
  // 편집기에 연 영상(파일 → 유튜브에서 가져오기 등)의 자막으로 대화하기: 단어는 원본 영상 시각
  ipcMain.handle('chat:useWords', (_e, url, title, duration, raw) => {
    const { words, lines } = whisperWordsToLines(raw);
    if (words.length < 5) throw new Error('편집기의 자막이 너무 짧습니다.');
    return startSession(url, { title, duration }, words, lines, { fromEditor: true });
  });
  ipcMain.handle('chat:cancelWhisper', () => { if (whisperStop) { whisperStop(); return true; } return false; });
  ipcMain.handle('chat:reset', () => { session = null; return true; });
  ipcMain.handle('chat:fetchClips', (event, url, spans) => require('./clips').fetchClips(url, spans, (info) => {
    if (!event.sender.isDestroyed()) event.sender.send('progress', { ...info, task: 'youtube' });
  }));
}

/** 교인 자료용: 유튜브 대화에서 불러온 설교 자막 (AI 가 찾은 설교 범위가 있으면 그 범위만) */
function sermonSource() {
  if (!session || !Array.isArray(session.words) || !session.words.length) return null;
  const w = session.words;
  let a = 0, b = w.length - 1;
  if (session.sermon) { a = Math.max(0, session.sermon.from - 5); b = Math.min(w.length - 1, session.sermon.to + 5); }
  return { url: session.url, title: (session.info && session.info.title) || '', whole: !session.sermon, words: w.slice(a, b + 1).map((x) => ({ text: x.text, start: x.start, end: x.end })) };
}

module.exports = { initLlm, LINKS, complete, activeProvider, sermonSource, whisperWordsToLines, _test: { loadVideo, loadVideoWhisper } };
