'use strict';
// AI 연결(챗GPT·클로드·제미나이)과 대화형 편집 세션. 렌더러에는 토큰·키를 절대 보내지 않는다.
const { ipcMain, shell, app, safeStorage } = require('electron');
const settingsMod = require('../settings');
const youtube = require('../youtube');
const claude = require('./claude');
const gemini = require('./gemini');
const chatPlan = require('../../shared/chat-plan');

let chatgpt = null;
function getChatGPT() {
  if (!chatgpt) {
    const { createChatGPT } = require('./chatgpt');
    chatgpt = createChatGPT({ app, shell, safeStorage });
  }
  return chatgpt;
}

const PROVIDERS = ['chatgpt', 'claude', 'gemini'];
const LINKS = {
  chatgptUsage: 'https://chatgpt.com/settings/usage',
  chatgptPlans: 'https://chatgpt.com/pricing',
  claudePlans: 'https://claude.com/pricing',
  claudeSetup: 'https://code.claude.com/docs/en/setup',
  geminiKey: 'https://aistudio.google.com/apikey',
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
    platform: process.platform,
  };
}

async function complete(provider, { system, messages, onDelta }) {
  if (provider === 'chatgpt') return getChatGPT().complete({ instructions: system, messages, onDelta });
  if (provider === 'claude') return claude.complete({ system, messages, model: 'sonnet' });
  if (provider === 'gemini') return gemini.complete({ system, messages });
  throw Object.assign(new Error('AI 가 연결되어 있지 않습니다. [AI 연결]에서 하나를 골라 연결해 주세요.'), { code: 'no_provider' });
}

// ---- 대화형 편집 세션 (한 번에 영상 하나) ----
let session = null;

async function loadVideo(url) {
  const subs = await youtube.fetchAutoSubs(url, { raw: true });
  if (!subs || !subs.raw) throw new Error('이 영상에서 한국어 자막을 찾지 못했습니다. 올린 직후라면 몇 시간 뒤 다시 해 주세요. (영상은 공개 또는 일부공개여야 합니다)');
  const { words, lines } = chatPlan.wordsFromJson3(subs.raw);
  if (words.length < 20) throw new Error('자막이 너무 짧습니다. 다른 영상을 넣어 주세요.');
  const info = subs.info || {};
  session = { url, info, words, lines, history: [], plan: null, sermon: null };
  return {
    url, title: info.title || '', duration: info.duration || 0,
    words: words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
  };
}

function transcriptRange() {
  if (!session.sermon) return null;
  const w = session.words;
  return { start: w[session.sermon.from].start - 30, end: w[session.sermon.to].end + 30 };
}

async function send(text, onDelta) {
  if (!session) throw new Error('먼저 설교 영상의 유튜브 주소를 넣어 주세요.');
  const provider = activeProvider();
  const s = settingsMod.loadSettings();
  const tpl = s.template || {};
  const system = chatPlan.buildSystemPrompt({ church: tpl.churchName, speaker: s.defaultSpeaker || tpl.defaultSpeaker, videoTitle: session.info.title })
    + '\n\n[설교 자막]\n' + chatPlan.transcriptText(session.words, session.lines, transcriptRange());
  const current = session.plan ? {
    title: session.plan.title, verse: session.plan.verse, tighten: session.plan.tighten,
    segments: chatPlan.describeRanges(session.plan.ranges, session.words),
    remainingQuestions: chatPlan.questionsIn(session.plan.ranges, session.words),
  } : null;
  const userMsg = chatPlan.buildUserMessage(text, { current, durationSec: session.plan ? chatPlan.rangesDuration(session.plan.ranges, session.words) : 0 });
  const messages = session.history.slice(-8).concat([{ role: 'user', content: userMsg }]);
  const t0 = Date.now();
  const { text: answer } = await complete(provider, { system, messages, onDelta });
  let plan;
  try {
    plan = chatPlan.parsePlan(answer);
  } catch (e) {
    if (e.code !== 'format') throw e;
    // 형식이 깨진 답이면 한 번 고쳐 달라고 한다
    console.log('[SermonShorts] AI 답 형식 오류, 다시 요청:', e.detail || '', String(answer || '').slice(0, 200).replace(/\s+/g, ' '));
    const fix = await complete(provider, { system, messages: messages.concat([
      { role: 'assistant', content: String(answer || '').slice(0, 12000) },
      { role: 'user', content: '방금 답은 JSON 형식이 잘못되어 읽을 수 없습니다. 같은 편집 내용을 [답 형식]에 맞는 올바른 JSON 하나로만 다시 쓰세요. 문자열 안의 따옴표는 \\" 로, 줄바꿈은 \\n 으로 쓰세요.' },
    ]), onDelta });
    plan = chatPlan.parsePlan(fix.text);
  }
  const resolved = chatPlan.resolvePlan(plan, session.words);
  if (!resolved.ranges.length && session.plan) resolved.ranges = session.plan.ranges; // 질문만 한 경우
  if (plan.sermon && isFinite(plan.sermon.from) && isFinite(plan.sermon.to)) {
    const n = session.words.length;
    const f = Math.max(0, Math.min(n - 1, Math.round(plan.sermon.from))), t = Math.max(0, Math.min(n - 1, Math.round(plan.sermon.to)));
    if (t > f) session.sermon = { from: f, to: t };
  }
  session.plan = { title: plan.title || (session.plan && session.plan.title) || '', verse: plan.verse || (session.plan && session.plan.verse) || '', tighten: plan.tighten, ranges: resolved.ranges };
  session.history.push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify({ reply: plan.reply, title: session.plan.title, segments: chatPlan.describeRanges(resolved.ranges, session.words).map((r) => ({ from: r.from, to: r.to })) }) });
  return {
    reply: plan.reply || '편집했습니다.',
    title: session.plan.title, verse: session.plan.verse, tighten: plan.tighten,
    ranges: resolved.ranges, corrections: resolved.corrections, warnings: resolved.warnings,
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
  }));
  ipcMain.handle('chat:reset', () => { session = null; return true; });
  ipcMain.handle('chat:fetchClips', (event, url, spans) => require('./clips').fetchClips(url, spans, (info) => {
    if (!event.sender.isDestroyed()) event.sender.send('progress', { ...info, task: 'youtube' });
  }));
}

module.exports = { initLlm, LINKS };
