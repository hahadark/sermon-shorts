/*
 * materials.js - 설교로 교인 배포 자료 만들기 (순수 함수: 종류·선택지·AI 지시문·답 읽기·글로 바꾸기).
 * 만나로 스튜디오의 '콘텐츠 만들기'처럼 설교 원고 하나로 여러 자료를 만든다.
 *  - 설교 요약 / 소그룹 자료 / QT 자료 / 성경 퀴즈 / 묵상카드 / 가정예배지
 * AI 는 설교에 있는 내용만 쓰고, 성경 본문은 장절 표기와 설교에서 직접 읽은 문장만 쓴다(번역본 본문을 지어내지 않게).
 * UMD: 렌더러 SS.materials, Node require().
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) { root.SS = root.SS || {}; root.SS.materials = api; }
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {
  'use strict';

  var TYPES = [
    { id: 'smallgroup', label: '소그룹 자료', icon: 'i-users', desc: '마음 열기 · 나눔 질문 · 이번 주 실천', kind: 'page' },
    { id: 'qt', label: 'QT 자료', icon: 'i-book-marked', desc: '날마다 본문 · 묵상 · 질문 · 기도', kind: 'page' },
    { id: 'quiz', label: '성경 퀴즈', icon: 'i-circle-help', desc: 'OX · 객관식 문제와 해설', kind: 'page' },
    { id: 'summary', label: '설교 요약', icon: 'i-file-text', desc: '핵심 한 문장 · 대지 요약 · 적용', kind: 'page' },
    { id: 'cards', label: '묵상카드', icon: 'i-images', desc: 'SNS·카톡용 말씀 카드 이미지', kind: 'cards' },
    { id: 'family', label: '가정예배지', icon: 'i-house', desc: '가족이 함께 드리는 예배 순서', kind: 'page' },
    { id: 'cardnews', label: '카드뉴스', icon: 'i-gallery-horizontal-end', desc: '인스타용 여러 장 · 표지 · 핵심 · 이번 주 실천', kind: 'cards' },
    { id: 'leader', label: '소그룹 리더 가이드', icon: 'i-user-check', desc: '진행 순서·시간 · 질문 의도·예상 답', kind: 'page' },
    { id: 'slides', label: '설교 PPT', icon: 'i-presentation', desc: '예배 화면용 16:9 슬라이드 · PPT 저장', kind: 'slides' },
  ];

  var OPTIONS = {
    audience: { label: '대상', values: ['장년', '청년', '청소년', '어린이', '유아·유치'] },
    smallgroup: { label: '소그룹 자료', values: ['나눔형', '공부형'] },
    qtDays: { label: 'QT 일수', values: [1, 2, 3, 4, 5, 6, 7] },
    qtFocus: { label: 'QT 본문', values: ['본문 중심', '확장 묵상', '혼합형'] },
    qtForm: { label: 'QT 형식', values: ['기본형', '묵상형', '적용형'] },
    quiz: { label: '성경 퀴즈', values: ['OX', '객관식', '혼합형'] },
    summary: { label: '설교 요약', values: ['짧게', '보통', '길게'] },
    cardTone: { label: '묵상카드', values: ['말씀 중심', '위로', '도전', '적용', '초청'] },
    cardCount: { label: '카드 장수', values: [1, 2, 3, 4, 5, 6, 7] },
    newsCount: { label: '카드뉴스 장수', values: [4, 5, 6, 7, 8] },
    leaderTime: { label: '모임 시간', values: [30, 45, 60, 90] },
    slideCount: { label: '슬라이드 수', values: [4, 6, 8, 10, 12] },
  };
  var DEFAULTS = { audience: '장년', smallgroup: '나눔형', qtDays: 5, qtFocus: '혼합형', qtForm: '묵상형', quiz: '혼합형', summary: '보통', cardTone: '말씀 중심', cardCount: 3, newsCount: 6, leaderTime: 60, slideCount: 8 };

  function typeOf(id) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i]; return null; }
  function pick(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
  function normOptions(o) {
    o = o || {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = pick(o[k], OPTIONS[k].values, DEFAULTS[k]); });
    return out;
  }

  var AUDIENCE_TONE = {
    '장년': '교회 장년 성도가 읽기 좋은 차분한 존댓말',
    '청년': '청년부가 공감할 수 있는 담백하고 생활에 가까운 존댓말',
    '청소년': '중고등부 학생이 이해하기 쉬운 짧은 문장과 친근한 존댓말, 학교·친구 같은 생활 예',
    '어린이': '초등학생이 이해할 수 있는 아주 쉬운 낱말과 짧은 문장, 다정한 존댓말',
    '유아·유치': '유치부 아이와 부모가 함께 읽을 아주 짧고 쉬운 말, 반복과 따라 하기',
  };

  var RULES = [
    '아래 [설교]에 실제로 있는 내용과 흐름만 씁니다. 설교에 없는 예화·통계·인용을 지어내지 않습니다.',
    '[설교]는 자동 자막이라 띄어쓰기·맞춤법·교회 용어가 틀릴 수 있습니다. 문맥에 맞게 바로잡아 씁니다.',
    '성경은 "로마서 1:16-17"처럼 장절로만 적습니다. 성경 본문 문장을 새로 만들거나 번역본 본문을 길게 옮기지 않습니다. 설교자가 직접 읽은 구절 한두 문장만 인용할 수 있습니다.',
    '교단·교회 이름·설교자 이름은 주어진 대로 씁니다.',
    '모든 글은 한국어로, 인쇄·카톡 공유에 알맞게 짧고 분명하게 씁니다.',
    '답은 설명 없이 요청한 JSON 하나만 씁니다. 문자열 안 줄바꿈은 \\n 으로.',
  ];

  /** 공통 시스템 지시문 */
  function buildSystem(ctx) {
    ctx = ctx || {};
    var o = normOptions(ctx.options);
    var lines = ['당신은 한국 교회의 목회 자료 편집자입니다. 주일 설교를 바탕으로 성도들에게 나눠 줄 자료를 만듭니다.', ''];
    lines.push('[설교 정보]');
    if (ctx.church) lines.push('- 교회: ' + ctx.church);
    if (ctx.title) lines.push('- 설교 제목: ' + String(ctx.title).replace(/\*/g, '').replace(/\s+\/\s+/g, ' '));
    if (ctx.verse) lines.push('- 본문: ' + ctx.verse);
    if (ctx.speaker) lines.push('- 설교자: ' + ctx.speaker);
    if (ctx.date) lines.push('- 날짜: ' + ctx.date);
    lines.push('- 대상: ' + o.audience + ' (' + AUDIENCE_TONE[o.audience] + ')');
    lines.push('', '[원칙]');
    RULES.forEach(function (r, i) { lines.push((i + 1) + '. ' + r); });
    lines.push('', '[설교]', String(ctx.sermon || '').trim().slice(0, 60000));
    return lines.join('\n');
  }

  /** 종류별 요청 (JSON 모양 포함) */
  function buildRequest(type, options) {
    var o = normOptions(options);
    switch (type) {
      case 'summary': {
        var n = { '짧게': '대지 2개, 각 2~3문장', '보통': '대지 3개, 각 3~4문장', '길게': '대지 3~4개, 각 5~6문장' }[o.summary];
        return '설교 요약을 만들어 주세요. 분량: ' + o.summary + ' (' + n + ').\n'
          + 'JSON: {"title":"설교 제목","verse":"본문 장절","theme":"설교의 핵심을 한 문장으로","points":[{"heading":"대지 제목(짧게)","body":"대지 내용"}],"application":"이번 주 삶의 적용 2~3문장","prayer":"짧은 기도문"}';
      }
      case 'smallgroup': {
        var how = o.smallgroup === '공부형'
          ? '공부형: 본문 관찰(무엇이 쓰여 있나) → 해석(무슨 뜻인가) → 적용(내 삶에) 순서의 질문, 질문마다 리더를 위한 짧은 도움말(note)'
          : '나눔형: 마음을 여는 생활 질문 → 설교 핵심을 되새기는 질문 → 내 삶을 나누는 질문, 정답보다 경험을 나누게';
        return '소그룹(셀·구역) 나눔 자료를 만들어 주세요. 형식: ' + how + '. 질문은 5~6개.\n'
          + 'JSON: {"title":"자료 제목","verse":"본문 장절","summary":"설교 요약 3~4문장","icebreaker":"마음 열기 질문 1개","questions":[{"q":"질문","note":"리더 도움말(없으면 빈 글)"}],"action":"이번 주 함께 실천할 것","prayer":"함께 드리는 기도"}';
      }
      case 'qt': {
        var focus = { '본문 중심': '설교 본문과 그 앞뒤 문맥을 나누어 날마다 읽게', '확장 묵상': '설교 주제와 이어지는 다른 성경 본문으로 넓혀서', '혼합형': '앞쪽은 설교 본문, 뒤쪽은 주제와 이어지는 다른 본문으로' }[o.qtFocus];
        var form = { '기본형': '본문 · 묵상 · 질문 · 기도', '묵상형': '묵상 글을 조금 길게(4~5문장), 마음에 새길 한 문장', '적용형': '오늘 실천할 구체적인 행동 한 가지를 꼭' }[o.qtForm];
        return o.qtDays + '일치 QT(큐티) 자료를 만들어 주세요. 본문 고르기: ' + focus + '. 형식: ' + form + '.\n'
          + '성경 본문은 장절만 적고(본문 문장은 쓰지 않음), 날마다 실제로 있는 짧은 범위(5~12절)로 고릅니다.\n'
          + 'JSON: {"title":"QT 제목","days":[{"day":1,"title":"그날의 제목","passage":"성경 장절","meditation":"묵상","keyline":"마음에 새길 한 문장","question":"묵상 질문","action":"오늘의 실천(없으면 빈 글)","prayer":"짧은 기도"}]}';
      }
      case 'quiz': {
        var kind = { 'OX': '모두 OX 문제', '객관식': '모두 4지선다 객관식', '혼합형': 'OX와 4지선다를 섞어서' }[o.quiz];
        return '설교 내용과 본문으로 성경 퀴즈 8문제를 만들어 주세요(' + kind + '). 설교를 잘 들었으면 풀 수 있게, 답은 설교와 본문에서 분명한 것으로.\n'
          + 'OX 는 "type":"ox", "answer":"O" 또는 "X". 객관식은 "type":"mc", "choices" 4개, "answer" 는 정답 번호(1~4).\n'
          + 'JSON: {"title":"퀴즈 제목","items":[{"type":"ox","q":"문제","answer":"O","explain":"해설 한 문장"},{"type":"mc","q":"문제","choices":["","","",""],"answer":2,"explain":"해설"}]}';
      }
      case 'cards': {
        return '묵상카드 ' + o.cardCount + '장의 글을 만들어 주세요. 분위기: ' + o.cardTone + '. 카드마다 설교의 서로 다른 핵심을 담습니다.\n'
          + 'headline 은 크게 보일 한 문장(공백 포함 24자 이내), body 는 풀어 쓴 1~2문장(60자 이내), source 는 근거(성경 장절 또는 "설교: 제목").\n'
          + 'JSON: {"cards":[{"headline":"","body":"","source":""}]}';
      }
      case 'family': {
        return '가정예배지를 만들어 주세요. 부모와 자녀가 15분 안에 함께 드릴 수 있게, 아이도 알아듣는 쉬운 말로.\n'
          + 'JSON: {"title":"제목","verse":"본문 장절","opening":"함께 부를 찬송·찬양 제목 제안(널리 알려진 곡 1~2개)","story":"부모가 읽어 줄 말씀 이야기 5~7문장","questions":["가족이 나눌 질문 2~3개"],"activity":"함께 해 볼 활동이나 실천","prayer":"가족 기도문","blessing":"마치는 축복의 말 한 문장"}';
      }
      case 'cardnews': {
        var body = o.newsCount - 2;
        return '인스타그램 카드뉴스 ' + o.newsCount + '장의 글을 만들어 주세요. 1장은 표지, 가운데 ' + body + '장은 설교의 핵심을 흐름대로 하나씩, 마지막 장은 "이번 주 실천"입니다.\n'
          + '표지 title 은 공백 포함 18자 이내로 크게 보일 제목, subtitle 은 한 줄(30자 이내). slides 는 정확히 ' + body + '개: heading 은 16자 이내, body 는 2~3문장(90자 이내), highlight 는 꼭 채웁니다: body 안에 글자 그대로 들어 있는 가장 중요한 구절(6~20자, body 에서 복사해 붙인 것처럼 똑같이).\n'
          + 'action 은 이번 주에 해 볼 구체적인 실천 한 문장(40자 이내), closing 은 마무리 한 문장.\n'
          + 'JSON: {"title":"","subtitle":"","verse":"본문 장절","slides":[{"heading":"","body":"","highlight":""}],"action":"","closing":""}';
      }
      case 'leader': {
        return '소그룹 리더용 진행 가이드를 만들어 주세요. 모임 시간은 ' + o.leaderTime + '분입니다. 리더가 미리 읽고 모임을 이끌 수 있게, 성도용 나눔지와 달리 질문의 의도와 예상 답(설교의 어느 부분이 근거인지)을 적습니다.\n'
          + 'flow 는 마음 열기 → 말씀 되새기기 → 나눔 → 적용·기도 순서이고 minutes 합이 ' + o.leaderTime + '분이 되게. 질문은 4~6개.\n'
          + 'JSON: {"title":"","verse":"본문 장절","goal":"이번 모임의 목표 1~2문장","prepare":"리더가 미리 할 것(설교 다시 듣기, 본문 읽기 등)","flow":[{"part":"단계 이름","minutes":10,"guide":"진행 방법 1~2문장"}],"questions":[{"q":"질문","intent":"질문 의도","expected":"나올 만한 답과 설교 근거","followup":"이어 물을 질문(없으면 빈 글)"}],"tips":["진행 팁(말이 없는 분·말이 긴 분·어려운 질문이 나왔을 때 등) 2~4개"],"prayer":"마무리 기도"}';
      }
      case 'slides': {
        return '설교를 예배당 화면에 띄울 16:9 슬라이드 ' + o.slideCount + '장 분량으로 정리해 주세요. 첫 장은 제목(자동으로 만듦)이니 slides 에는 본론만 ' + (o.slideCount - 2) + '~' + (o.slideCount - 1) + '장을 넣습니다.\n'
          + '설교의 흐름(대지) 순서대로, 장마다 heading 은 18자 이내, lines 는 화면에 띄울 짧은 문장 1~3개(각 32자 이내, 말하는 그대로가 아니라 핵심만), ref 는 그 장과 관련된 성경 장절(없으면 빈 글).\n'
          + 'closing 은 마지막 장에 띄울 결단·적용 한 문장(40자 이내).\n'
          + 'JSON: {"title":"","verse":"본문 장절","slides":[{"heading":"","lines":[""],"ref":""}],"closing":""}';
      }
    }
    throw new Error('모르는 자료 종류: ' + type);
  }

  function repairJson(s) {
    var out = '', inStr = false, esc = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (inStr) {
        if (esc) { out += c; esc = false; continue; }
        if (c === '\\') { out += c; esc = true; continue; }
        if (c === '"') { inStr = false; out += c; continue; }
        if (c === '\n') { out += '\\n'; continue; }
        if (c === '\r') continue;
        if (c === '\t') { out += '\\t'; continue; }
        out += c;
      } else {
        if (c === '“' || c === '”') c = '"';
        if (c === '"') { inStr = true; out += c; continue; }
        out += c;
      }
    }
    return out.replace(/,\s*([}\]])/g, '$1');
  }

  function str(v, max) { var s = v == null ? '' : String(v).replace(/\r/g, '').trim(); return max ? s.slice(0, max) : s; }
  function arr(v) { return Array.isArray(v) ? v : []; }

  /** 종류별 모양 맞추기 (빠진 칸은 빈 글) */
  function normalize(type, o) {
    o = o && typeof o === 'object' ? o : {};
    switch (type) {
      case 'summary': return { title: str(o.title, 120), verse: str(o.verse, 120), theme: str(o.theme, 300),
        points: arr(o.points).slice(0, 6).map(function (p) { return { heading: str(p && p.heading, 80), body: str(p && p.body, 1200) }; }).filter(function (p) { return p.heading || p.body; }),
        application: str(o.application, 800), prayer: str(o.prayer, 800) };
      case 'smallgroup': return { title: str(o.title, 120), verse: str(o.verse, 120), summary: str(o.summary, 1000), icebreaker: str(o.icebreaker, 300),
        questions: arr(o.questions).slice(0, 10).map(function (q) { return typeof q === 'string' ? { q: str(q, 400), note: '' } : { q: str(q && q.q, 400), note: str(q && q.note, 400) }; }).filter(function (q) { return q.q; }),
        action: str(o.action, 500), prayer: str(o.prayer, 800) };
      case 'qt': return { title: str(o.title, 120),
        days: arr(o.days).slice(0, 7).map(function (d, i) { return { day: i + 1, title: str(d && d.title, 80), passage: str(d && d.passage, 80), meditation: str(d && d.meditation, 1200), keyline: str(d && d.keyline, 200), question: str(d && d.question, 400), action: str(d && d.action, 300), prayer: str(d && d.prayer, 500) }; }) };
      case 'quiz': return { title: str(o.title, 120),
        items: arr(o.items).slice(0, 20).map(function (it) {
          it = it || {};
          var mc = it.type === 'mc' || Array.isArray(it.choices) && it.choices.length >= 2;
          if (mc) {
            var ch = arr(it.choices).slice(0, 5).map(function (c) { return str(c, 120); });
            var a = parseInt(it.answer, 10);
            return { type: 'mc', q: str(it.q, 300), choices: ch, answer: a >= 1 && a <= ch.length ? a : 1, explain: str(it.explain, 400) };
          }
          var ox = String(it.answer || '').toUpperCase().indexOf('X') >= 0 ? 'X' : 'O';
          return { type: 'ox', q: str(it.q, 300), answer: ox, explain: str(it.explain, 400) };
        }).filter(function (it) { return it.q; }) };
      case 'cards': return { cards: arr(o.cards).slice(0, 7).map(function (c) { return { headline: str(c && c.headline, 60), body: str(c && c.body, 160), source: str(c && c.source, 80) }; }).filter(function (c) { return c.headline || c.body; }) };
      case 'family': return { title: str(o.title, 120), verse: str(o.verse, 120), opening: str(o.opening, 200), story: str(o.story, 2000),
        questions: arr(o.questions).slice(0, 5).map(function (q) { return str(q, 300); }).filter(Boolean), activity: str(o.activity, 500), prayer: str(o.prayer, 800), blessing: str(o.blessing, 300) };
      case 'cardnews': return { title: str(o.title, 60), subtitle: str(o.subtitle, 80), verse: str(o.verse, 80),
        slides: arr(o.slides).slice(0, 8).map(function (s) { s = s || {}; var b = str(s.body, 240), h = str(s.highlight, 60); return { heading: str(s.heading, 50), body: b, highlight: h && b.indexOf(h) >= 0 ? h : '' }; }).filter(function (s) { return s.heading || s.body; }),
        action: str(o.action, 120), closing: str(o.closing, 160) };
      case 'leader': return { title: str(o.title, 120), verse: str(o.verse, 120), goal: str(o.goal, 400), prepare: str(o.prepare, 400),
        flow: arr(o.flow).slice(0, 8).map(function (f) { f = f || {}; var m = parseInt(f.minutes, 10); return { part: str(f.part, 40), minutes: m > 0 && m < 200 ? m : 0, guide: str(f.guide, 400) }; }).filter(function (f) { return f.part || f.guide; }),
        questions: arr(o.questions).slice(0, 8).map(function (q) { q = q || {}; return typeof q === 'string' ? { q: str(q, 300), intent: '', expected: '', followup: '' } : { q: str(q.q, 300), intent: str(q.intent, 300), expected: str(q.expected, 500), followup: str(q.followup, 300) }; }).filter(function (q) { return q.q; }),
        tips: arr(o.tips).slice(0, 6).map(function (t) { return str(t, 300); }).filter(Boolean), prayer: str(o.prayer, 800) };
      case 'slides': return { title: str(o.title, 80), verse: str(o.verse, 80),
        slides: arr(o.slides).slice(0, 14).map(function (s) { s = s || {}; return { heading: str(s.heading, 60), lines: arr(s.lines).slice(0, 4).map(function (l) { return str(l, 80); }).filter(Boolean), ref: str(s.ref, 60) }; }).filter(function (s) { return s.heading || s.lines.length; }),
        closing: str(o.closing, 120) };
    }
    return o;
  }

  /** AI 답 → 자료 데이터 */
  function parse(type, text) {
    var s = String(text || '').trim();
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw Object.assign(new Error('AI 답을 읽지 못했습니다. 다시 만들어 주세요.'), { code: 'format' });
    var body = s.slice(a, b + 1), obj;
    try { obj = JSON.parse(body); }
    catch (e) {
      try { obj = JSON.parse(repairJson(body)); }
      catch (e2) { throw Object.assign(new Error('AI 답의 형식이 잘못되었습니다. 다시 만들어 주세요.'), { code: 'format' }); }
    }
    var out = normalize(type, obj);
    var empty = (type === 'cards' && !out.cards.length) || (type === 'quiz' && !out.items.length) || (type === 'qt' && !out.days.length)
      || (type === 'summary' && !out.points.length && !out.theme) || (type === 'smallgroup' && !out.questions.length) || (type === 'family' && !out.story)
      || (type === 'cardnews' && !out.slides.length) || (type === 'leader' && !out.questions.length) || (type === 'slides' && !out.slides.length);
    if (empty) throw Object.assign(new Error('AI 답에 내용이 비어 있습니다. 다시 만들어 주세요.'), { code: 'format' });
    return out;
  }

  /** 카톡·문자로 붙여 넣을 글 */
  function toText(type, d, meta) {
    meta = meta || {};
    var L = [];
    var head = function (t) { L.push('■ ' + t); };
    var nl = function () { L.push(''); };
    if (meta.church) L.push(meta.church);
    switch (type) {
      case 'summary':
        head(d.title || '설교 요약'); if (d.verse) L.push(d.verse); nl();
        if (d.theme) { L.push('“' + d.theme + '”'); nl(); }
        d.points.forEach(function (p, i) { L.push((i + 1) + '. ' + p.heading); if (p.body) L.push(p.body); nl(); });
        if (d.application) { L.push('[적용] ' + d.application); nl(); }
        if (d.prayer) L.push('[기도] ' + d.prayer);
        break;
      case 'smallgroup':
        head(d.title || '소그룹 나눔'); if (d.verse) L.push(d.verse); nl();
        if (d.summary) { L.push('[말씀 요약] ' + d.summary); nl(); }
        if (d.icebreaker) { L.push('[마음 열기] ' + d.icebreaker); nl(); }
        d.questions.forEach(function (q, i) { L.push('Q' + (i + 1) + '. ' + q.q); });
        nl(); if (d.action) L.push('[이번 주 실천] ' + d.action);
        if (d.prayer) L.push('[함께 기도] ' + d.prayer);
        break;
      case 'qt':
        head(d.title || 'QT');
        d.days.forEach(function (x) { nl(); L.push(x.day + '일째 · ' + x.title + (x.passage ? ' (' + x.passage + ')' : '')); if (x.meditation) L.push(x.meditation); if (x.keyline) L.push('▶ ' + x.keyline); if (x.question) L.push('Q. ' + x.question); if (x.action) L.push('실천: ' + x.action); if (x.prayer) L.push('기도: ' + x.prayer); });
        break;
      case 'quiz':
        head(d.title || '성경 퀴즈'); nl();
        d.items.forEach(function (it, i) { L.push((i + 1) + '. ' + it.q + (it.type === 'ox' ? ' (O / X)' : '')); if (it.type === 'mc') it.choices.forEach(function (c, k) { L.push('   ' + (k + 1) + ') ' + c); }); });
        nl(); L.push('[정답] ' + d.items.map(function (it, i) { return (i + 1) + '-' + it.answer; }).join(', '));
        break;
      case 'cards':
        d.cards.forEach(function (c, i) { if (i) nl(); L.push(c.headline); if (c.body) L.push(c.body); if (c.source) L.push('- ' + c.source); });
        break;
      case 'family':
        head(d.title || '가정예배'); if (d.verse) L.push(d.verse); nl();
        if (d.opening) L.push('1. 찬양: ' + d.opening);
        L.push('2. 말씀 읽기: ' + (d.verse || ''));
        if (d.story) L.push('3. 말씀 이야기: ' + d.story);
        if (d.questions.length) { L.push('4. 함께 나누기'); d.questions.forEach(function (q) { L.push(' - ' + q); }); }
        if (d.activity) L.push('5. 함께 해 보기: ' + d.activity);
        if (d.prayer) L.push('6. 기도: ' + d.prayer);
        if (d.blessing) L.push('7. 축복: ' + d.blessing);
        break;
      case 'cardnews':
        head(d.title || '카드뉴스'); if (d.subtitle) L.push(d.subtitle); if (d.verse) L.push(d.verse);
        d.slides.forEach(function (s, i) { nl(); L.push((i + 1) + '. ' + s.heading); if (s.body) L.push(s.body); });
        if (d.action) { nl(); L.push('[이번 주 실천] ' + d.action); }
        if (d.closing) L.push(d.closing);
        break;
      case 'leader':
        head((d.title || '소그룹') + ' · 리더 가이드'); if (d.verse) L.push(d.verse); nl();
        if (d.goal) L.push('[모임 목표] ' + d.goal);
        if (d.prepare) L.push('[미리 준비] ' + d.prepare);
        if (d.flow.length) { nl(); L.push('[진행 순서]'); d.flow.forEach(function (f) { L.push('- ' + f.part + (f.minutes ? ' (' + f.minutes + '분)' : '') + (f.guide ? ': ' + f.guide : '')); }); }
        d.questions.forEach(function (q, i) { nl(); L.push('Q' + (i + 1) + '. ' + q.q); if (q.intent) L.push('  의도: ' + q.intent); if (q.expected) L.push('  예상 답: ' + q.expected); if (q.followup) L.push('  이어서: ' + q.followup); });
        if (d.tips.length) { nl(); L.push('[진행 팁]'); d.tips.forEach(function (t) { L.push('- ' + t); }); }
        if (d.prayer) { nl(); L.push('[마무리 기도] ' + d.prayer); }
        break;
      case 'slides':
        head(d.title || '설교'); if (d.verse) L.push(d.verse);
        d.slides.forEach(function (s, i) { nl(); L.push((i + 1) + '. ' + s.heading + (s.ref ? ' (' + s.ref + ')' : '')); s.lines.forEach(function (l) { L.push(' · ' + l); }); });
        if (d.closing) { nl(); L.push(d.closing); }
        break;
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** 자막 단어 → 읽기 좋은 문단 (쉼·문장 끝에서 줄 바꿈) */
  function sermonText(words) {
    var out = [], cur = [], prevEnd = null;
    (words || []).forEach(function (w) {
      if (!w || !w.text) return;
      if (prevEnd != null && w.start - prevEnd > 1.2 && cur.length) { out.push(cur.join(' ')); cur = []; }
      cur.push(String(w.text).trim());
      prevEnd = w.end;
      if (/[.?!]$/.test(String(w.text).trim()) && cur.length > 25) { out.push(cur.join(' ')); cur = []; }
    });
    if (cur.length) out.push(cur.join(' '));
    return out.join('\n');
  }

  /**
   * 설교 요약 → 홈페이지(Astro sermon-notes) 말씀 요약 글 (.md)
   * 앞머리: title·date·service·series·passage·preacher·summary·published. 묵상 질문은 넣지 않는다.
   * meta: { title, verse, speaker, date('2026년 10월 25일' 또는 '2026-10-25'), service, series }
   */
  var SERVICES = ['sunday', 'afternoon', 'wednesday', 'friday', 'dawn', 'special'];
  function isoDate(s) {
    s = String(s || '');
    var m = s.match(/(\d{4})\s*[-.년]\s*(\d{1,2})\s*[-.월]\s*(\d{1,2})/);
    if (!m) { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  }
  function yamlStr(v) { return JSON.stringify(String(v == null ? '' : v).replace(/\s+/g, ' ').trim()); }
  function toHomepage(d, meta) {
    meta = meta || {};
    var date = isoDate(meta.date);
    var service = SERVICES.indexOf(meta.service) >= 0 ? meta.service : 'sunday';
    var title = String(meta.title || d.title || '말씀 요약').replace(/\*/g, '').replace(/\s+\/\s+/g, ' ').trim();
    var fm = ['---', 'title: ' + yamlStr(title), 'date: ' + date, 'service: ' + service];
    if (meta.series) fm.push('series: ' + yamlStr(meta.series));
    if (meta.verse || d.verse) fm.push('passage: ' + yamlStr(meta.verse || d.verse));
    if (meta.speaker) fm.push('preacher: ' + yamlStr(meta.speaker));
    fm.push('summary: ' + yamlStr(d.theme || (d.points[0] && d.points[0].body) || title));
    fm.push('published: false', '---', '');
    var L = [];
    d.points.forEach(function (p, i) { L.push('### ' + (d.points.length > 1 ? (i + 1) + '. ' : '') + p.heading, '', p.body, ''); });
    if (d.application) L.push('### 말씀을 정리하며', '', d.application, '');
    return { name: date + '-' + service + '.md', text: fm.join('\n') + L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' };
  }

  return { TYPES: TYPES, OPTIONS: OPTIONS, DEFAULTS: DEFAULTS, typeOf: typeOf, normOptions: normOptions, buildSystem: buildSystem, buildRequest: buildRequest, parse: parse, normalize: normalize, toText: toText, sermonText: sermonText, repairJson: repairJson, toHomepage: toHomepage, isoDate: isoDate };
}));
