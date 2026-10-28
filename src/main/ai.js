// AI analysis via Gemini REST. The API key is read from settings (safeStorage) or env GEMINI_API_KEY.
// Never log the key.
'use strict';

const DEFAULT_MODEL = 'gemini-3.5-flash';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

let keyProvider = () => process.env.GEMINI_API_KEY || '';
function setKeyProvider(fn) { keyProvider = fn; }

async function callGemini({ model = DEFAULT_MODEL, system, prompt, schema, temperature = 0.4, thinking = 'medium' }) {
  const key = keyProvider();
  if (!key) throw new Error('AI 키가 없습니다. 설정에서 Gemini API 키를 입력하세요.');
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {}),
      thinkingConfig: { thinkingLevel: thinking },
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const res = await fetch(`${API}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini 오류 ${res.status}: ${data?.error?.message || ''}`);
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  return { json: JSON.parse(text), usage: data.usageMetadata || {} };
}

function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}

// Merge caption lines into ~8s blocks: "[14:30] text" (keeps tokens low, timing good enough for selection)
function compactTranscript(lines, blockSec = 8) {
  const out = [];
  let cur = null;
  for (const l of lines) {
    const t = (l.text || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (!cur || l.start - cur.start >= blockSec) {
      if (cur) out.push(cur);
      cur = { start: l.start, text: t };
    } else cur.text += ' ' + t;
  }
  if (cur) out.push(cur);
  return out.map(b => `[${fmt(b.start)}] ${b.text}`).join('\n');
}

// 추천 조건(파라미터) 정의: UI와 프롬프트가 같은 표를 쓴다.
const CONTENT_TYPES = {
  core: '설교의 핵심 메시지(결론, 오늘 한 문장)',
  story: '예화·실제 이야기(설교자 경험, 사람 이야기)',
  exposition: '본문 해설(성경 배경, 원어, 의미 풀이)',
  application: '삶의 적용(일상에서 무엇을 할지)',
  comfort: '위로와 격려(고난, 낙심한 사람에게)',
  challenge: '도전과 결단(회개, 순종 촉구)',
  gospel: '복음 제시(십자가, 은혜, 구원)',
  prayer: '기도와 축복의 말',
};
const INTENSITY = {
  1: '아주 잔잔하게: 조용한 묵상, 따뜻한 위로의 어조',
  2: '잔잔한 편: 차분히 설명하고 다독이는 어조',
  3: '균형: 차분함과 힘이 섞인 보통의 설교 어조',
  4: '힘 있는 편: 확신 있게 선포하고 질문을 던지는 어조',
  5: '아주 강렬하게: 목소리가 고조되고 강하게 도전·선포하는 절정 부분',
};
const AUDIENCE = {
  all: '일반 시청자 누구나',
  members: '교회 성도',
  seekers: '교회에 다니지 않는 사람, 새신자(교회 용어를 모르는 사람)',
  youth: '청년·청소년',
};

function buildSystem(churchName) {
  return `너는 ${churchName || '교회'}의 설교 쇼츠 편집자다.
예배 영상 자동 자막을 읽고 설교 부분을 찾은 뒤, 유튜브 쇼츠로 만들 구간을 사용자가 정한 조건에 맞게 고른다.
교회 용어 예: 사관(구세군 목회자 직분), 영문(구세군 교회), 하나님, 예수님, 성령, 말씀.
항상 지킬 기준:
1. 앞뒤 맥락 없이 혼자 들어도 이해되는 한 덩어리 이야기.
2. 첫 문장이 귀를 붙잡는다(질문, 강한 주장, 이야기의 시작). "자, 그리고, 그래서, 그러니까"로 시작하지 않는다.
3. 생각이 완결되는 문장에서 끝난다. 문장 중간에서 끊지 않는다.
4. 광고, 찬양, 기도 인도, 성경 봉독만 있는 부분, 회중 소음은 제외한다.
5. 설교자의 뜻을 바꾸거나 과장하지 않는다. 쇼츠 제목은 설교 문장에서 따온 표현을 우선한다.
자동 자막에는 오타가 많다. 시간은 [분:초] 표시를 기준으로 초 단위 숫자로 답한다.`;
}

const SCHEMA = {
  type: 'object',
  properties: {
    sermon: {
      type: 'object',
      properties: {
        start: { type: 'number', description: '설교 시작 (초)' },
        end: { type: 'number', description: '설교 끝 (초), 설교 후 통성기도 전까지' },
        title: { type: 'string', description: '설교 제목 (설교자가 말한 제목, 없으면 추정)' },
        scripture: { type: 'string', description: '본문, 약어 형식 예: 행 5:27-32, 마 6:5-13' },
        mainMessage: { type: 'string', description: '설교 핵심 메시지 한 문장' },
      },
      required: ['start', 'end', 'title', 'scripture', 'mainMessage'],
    },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number' },
          end: { type: 'number' },
          shortsTitle: { type: 'string', description: '쇼츠 화면 상단 제목, 15자 안팎' },
          firstSentence: { type: 'string' },
          lastSentence: { type: 'string' },
          reason: { type: 'string', description: '추천 이유 1~2문장, 요청 조건과 어떻게 맞는지 포함' },
          types: { type: 'array', items: { type: 'string', enum: Object.keys(CONTENT_TYPES) }, description: '이 구간의 내용 유형' },
          intensity: { type: 'number', description: '이 구간의 실제 강도 1~5' },
          score: { type: 'number', description: '조건 적합도와 쇼츠 품질을 합한 점수 1~10' },
        },
        required: ['start', 'end', 'shortsTitle', 'firstSentence', 'lastSentence', 'reason', 'types', 'intensity', 'score'],
      },
    },
  },
  required: ['sermon', 'candidates'],
};

// opts: { videoTitle, description, model, churchName,
//         count=4, minSec=60, maxSec=120, intensity=3 (1~5, 0=상관없음),
//         types=[] (CONTENT_TYPES 키, 비우면 상관없음), audience='all', extra='' (자유 요청) }
async function analyzeSermon(lines, opts = {}) {
  const {
    videoTitle = '', description = '', model, churchName = '',
    count = 4, minSec = 60, maxSec = 120, intensity = 3, types = [], audience = 'all', extra = '',
  } = opts;
  const transcript = compactTranscript(lines);
  const cond = [
    `- 개수: ${count}개 (서로 겹치지 않게, 점수 높은 순)`,
    `- 길이: 각 ${minSec}~${maxSec}초`,
    intensity ? `- 강도: ${intensity}/5 = ${INTENSITY[intensity]}. 이 강도에 가까운 구간을 우선한다.` : '- 강도: 상관없음',
    types.length ? `- 원하는 내용: ${types.map(t => CONTENT_TYPES[t]).filter(Boolean).join(', ')}. 이 유형이 중심인 구간을 우선한다.` : '- 원하는 내용: 상관없음(설교 핵심이 잘 드러나는 곳)',
    `- 대상: ${AUDIENCE[audience] || AUDIENCE.all}${audience === 'seekers' ? '. 교회 안에서만 통하는 말이 적고 처음 듣는 사람도 이해되는 구간을 우선한다.' : ''}`,
    extra ? `- 추가 요청: ${extra}` : '',
  ].filter(Boolean).join('\n');
  const prompt = `영상 제목: ${videoTitle}
영상 설명: ${String(description || '').slice(0, 500)}

[추천 조건]
${cond}
조건에 딱 맞는 구간이 부족하면 가장 가까운 구간을 고르되 reason에 무엇이 다른지 적는다.

아래는 예배 영상 전체의 자동 자막이다. 설교 구간을 찾고, 그 안에서 조건에 맞는 쇼츠 후보를 골라라.

${transcript}`;
  const usedModel = model || DEFAULT_MODEL;
  const { json, usage } = await callGemini({ model: usedModel, system: buildSystem(churchName), prompt, schema: SCHEMA });
  json.candidates = (json.candidates || []).sort((a, b) => b.score - a.score);
  return { ...json, usage, model: usedModel, conditions: { count, minSec, maxSec, intensity, types, audience, extra } };
}

// API 연결 확인: 키·모델·한도를 실제 호출로 확인하고 사람이 읽을 수 있는 결과를 돌려준다. 키는 절대 반환하지 않는다.
async function testConnection(model = DEFAULT_MODEL) {
  const key = keyProvider();
  if (!key) return { ok: false, code: 'no-key', message: 'API 키가 없습니다. 설정에서 Gemini API 키를 입력하세요.' };
  const t0 = Date.now();
  try {
    const res = await fetch(`${API}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '확인. "OK"라고만 답해.' }] }], generationConfig: { maxOutputTokens: 5, thinkingConfig: { thinkingLevel: 'minimal' } } }),
    });
    const data = await res.json().catch(() => ({}));
    const ms = Date.now() - t0;
    if (res.ok) return { ok: true, code: 'ok', model, ms, message: `연결 성공 (${model}, ${ms}ms)` };
    const msg = data?.error?.message || '';
    if (res.status === 400 && /API key/i.test(msg)) return { ok: false, code: 'bad-key', message: 'API 키가 올바르지 않습니다. 키를 다시 확인하세요.' };
    if (res.status === 403) return { ok: false, code: 'forbidden', message: '이 키로는 사용할 수 없습니다(권한 또는 결제 설정 확인).' };
    if (res.status === 404) return { ok: false, code: 'no-model', message: `모델을 찾을 수 없습니다: ${model}` };
    if (res.status === 429) return { ok: false, code: 'quota', message: '사용 한도를 넘었습니다. 잠시 후 다시 시도하거나 다른 모델을 고르세요.' };
    return { ok: false, code: 'http-' + res.status, message: `오류 ${res.status}: ${msg.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, code: 'network', message: '인터넷 연결을 확인하세요. (' + e.message + ')' };
  }
}

module.exports = { callGemini, analyzeSermon, compactTranscript, setKeyProvider, testConnection, DEFAULT_MODEL, CONTENT_TYPES, INTENSITY, AUDIENCE };
async function correctTerms(words, context) {
  const prompt = `설교 제목: ${context.title || ''}\n본문: ${context.scripture || ''}\n\n다음 단어들의 띄어쓰기, 배열 등은 건드리지 말고 오로지 '교회/성경 용어, 고유명사, 그리고 명백한 오타'만 수정하라.\n${JSON.stringify(words)}`;
  const schema = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        text: { type: 'string' }
      },
      required: ['id', 'text']
    }
  };
  const { json } = await callGemini({
    system: "너는 오타 교정기다. 주어진 단어 배열(id, text)에서 명백한 오타나 잘못 인식된 기독교 용어만 수정하여 동일한 id와 수정된 text의 배열로 반환한다. 구조나 단어 개수는 절대 바꾸지 마라.",
    prompt,
    schema,
    temperature: 0.1
  });
  return json;
}

module.exports.correctTerms = correctTerms;
module.exports._getKey = () => keyProvider();
