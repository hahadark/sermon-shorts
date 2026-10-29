/* 대화형 AI 편집: 유튜브 자동 자막(json3) → 단어 목록, AI 프롬프트, AI 답(편집 계획) 해석.
 * 순수 함수만 둔다 (Electron 없이 테스트 가능). 브라우저에서는 SS.chatPlan, Node 에서는 module.exports. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SS = root.SS || {}; root.SS.chatPlan = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SYL = 0.17; // 설교 말 속도: 한 글자(음절)에 걸리는 대략 시간(초)

  function syllables(t) {
    var n = 0;
    for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); if ((c >= 0xAC00 && c <= 0xD7A3) || /[0-9A-Za-z]/.test(t[i])) n++; }
    return Math.max(1, n);
  }

  /** json3 → { words:[{text,start,end}], lines:[{start,from,to}] } (시간은 원본 영상 기준 초) */
  function wordsFromJson3(data) {
    var words = [], lines = [];
    var events = (data && data.events) || [];
    for (var e = 0; e < events.length; e++) {
      var ev = events[e];
      if (!ev.segs) continue;
      var t0 = (ev.tStartMs || 0) / 1000;
      var evEnd = t0 + (ev.dDurationMs || 0) / 1000;
      var from = words.length;
      for (var s = 0; s < ev.segs.length; s++) {
        var text = String(ev.segs[s].utf8 || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        var st = t0 + (ev.segs[s].tOffsetMs || 0) / 1000;
        var parts = text.split(' '), q = 0;
        for (var p = 0; p < parts.length; p++) {
          if (!parts[p] || parts[p] === '>>') continue; // >> = 말하는 사람이 바뀜 표시
          words.push({ text: parts[p], start: st + (q++) * 0.05, end: 0, _evEnd: evEnd });
        }
      }
      if (words.length > from) lines.push({ start: words[from].start, from: from, to: words.length - 1 });
    }
    // 단어 끝: 다음 단어 시작 전, 글자 수로 어림한 길이만큼 (말 사이의 쉼을 남겨 두어야 공백을 줄일 수 있다)
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var next = i + 1 < words.length ? words[i + 1].start : w._evEnd;
      var est = w.start + syllables(w.text) * SYL + 0.08;
      w.end = Math.max(w.start + 0.12, Math.min(next - 0.02, est, Math.max(w._evEnd, w.start + 0.12)));
      if (w.end <= w.start) w.end = w.start + 0.12;
      delete w._evEnd;
    }
    for (var k = 0; k < words.length; k++) words[k].id = k;
    return { words: words, lines: lines };
  }

  function fmtTime(sec) {
    sec = Math.max(0, sec || 0);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec - h * 3600 - m * 60;
    var ss = s.toFixed(1); if (s < 10) ss = '0' + ss;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + ss;
  }

  /** AI 에게 줄 자막: "#4501 [57:34.5] 기도란 시작도 하나님이요" (#번호 = 그 줄 첫 단어 번호, 이후 단어는 1씩 증가) */
  function transcriptText(words, lines, range) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (range && (words[L.to].end < range.start || L.start > range.end)) continue;
      var t = [];
      for (var k = L.from; k <= L.to; k++) t.push(words[k].text);
      out.push('#' + L.from + ' [' + fmtTime(L.start) + '] ' + t.join(' '));
    }
    return out.join('\n');
  }

  var RULES = [
    '설교 제목에 맞는 가장 결론적인 메시지와 삶의 적용을 중심으로 고릅니다. 결론부의 요약·적용·축복도 꼭 살펴봅니다.',
    '"그…", "어…", "음…"처럼 말을 끄는 소리와 군말, 같은 말 반복, 말 더듬기는 빼고 이어 붙입니다.',
    '회중에게 묻는 말("누구입니까?", "그렇지 않습니까?", "아멘 하시겠습니까?"), 그 대답, 회중 이름을 부르는 말, 개인적인 농담은 뺍니다. 질문을 빼서 어색해지는 대답 조각도 함께 뺍니다.',
    '물음표로 끝나는 문장은 수사적 질문이라도(예: "아멘의 뜻이 뭡니까?") 빼고, 그 뒤의 설명을 평서문으로 이어지게 고릅니다.',
    '예배 진행 안내("이제 마무리하겠습니다", "말씀 나누도록 하겠습니다", "성경 보시면")는 뺍니다.',
    '빼고 난 뒤에도 문장이 자연스럽게 이어지도록 앞뒤를 고릅니다. 설교자가 하지 않은 말을 만들지 않습니다.',
    '구간은 원래 시간 순서대로만 이어 붙일 수 있습니다(순서를 바꿀 수 없습니다).',
    '마지막은 힘 있는 결론이나 축복으로 끝나게 합니다.',
  ];

  function buildSystemPrompt(ctx) {
    ctx = ctx || {};
    return [
      '당신은 교회 설교 영상을 세로형 쇼츠로 편집하는 편집자입니다. 사용자(교회 담당자)와 한국어로 대화하며 편집합니다.',
      ctx.church ? '교회: ' + ctx.church : '',
      ctx.speaker ? '설교자: ' + ctx.speaker : '',
      ctx.terms ? '이 교회에서 자주 쓰는 용어(자동 자막이 잘못 받아 적었을 수 있음): ' + ctx.terms : '',
      ctx.videoTitle ? '영상 제목: ' + ctx.videoTitle : '',
      '',
      '[자막 형식] 각 줄은 "#번호 [시각] 단어들" 입니다. #번호는 그 줄 첫 단어의 번호이고, 같은 줄의 다음 단어들은 번호가 1씩 커집니다. 자동 자막이라 틀린 글자가 있습니다.',
      '',
      '[편집 원칙]',
      RULES.map(function (r, i) { return (i + 1) + '. ' + r; }).join('\n'),
      '',
      '[답 형식] 반드시 JSON 하나만 답합니다. 코드 블록이나 다른 글은 쓰지 않습니다.',
      '{',
      '  "reply": "사용자에게 할 말 (한두 문장, 무엇을 어떻게 했는지)",',
      '  "title": "쇼츠 제목 (두 줄이면 \\n 으로 나눔, 줄당 12자 안팎)",',
      '  "verse": "성경 본문 (예: 마태복음 6:13, 모르면 빈 글자)",',
      '  "sermon": {"from": 설교 시작 단어번호, "to": 설교 끝 단어번호},',
      '  "segments": [ {"from": 첫 단어번호, "fromText": "첫 단어", "to": 끝 단어번호, "toText": "끝 단어"} ],',
      '  "corrections": [ {"id": 단어번호, "text": "바르게 고친 단어"} ],',
      '  "tighten": "none | normal | strong (말 사이 공백을 얼마나 줄일지)"',
      '}',
      'segments 는 남길 부분(포함 범위)을 시간 순서대로 적습니다. 바꿀 것이 없는 항목은 이전 답과 같게 둡니다.',
      'reply 는 교회 봉사자가 읽는 쉬운 우리말로 씁니다. tighten, segments 같은 항목 이름이나 영어 값은 쓰지 않습니다.',
      '사용자가 편집이 아닌 질문만 하면 segments 를 이전과 같게 두고 reply 로 답합니다.',
    ].filter(function (x) { return x !== ''; }).join('\n').replace(/\n\[/g, '\n\n[');
  }

  /** 이번 요청 + 현재 편집 상태를 담은 사용자 메시지 */
  function buildUserMessage(request, state) {
    var parts = [];
    if (state && state.transcript) parts.push('[설교 자막]\n' + state.transcript);
    if (state && state.current) parts.push('[현재 편집]\n' + JSON.stringify(state.current));
    if (state && state.durationSec) parts.push('[현재 길이] 약 ' + Math.round(state.durationSec) + '초');
    parts.push('[요청]\n' + request);
    return parts.join('\n\n');
  }

  /** 조금 어긋난 JSON 고치기: 문자열 안의 줄바꿈·탭, 끝에 남은 쉼표, // 주석, 똑똑한 따옴표 */
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
        if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
        out += c;
      }
    }
    return out.replace(/,\s*([}\]])/g, '$1');
  }

  /** AI 답에서 JSON 꺼내기 (코드 블록·앞뒤 글이 붙어도) */
  function parsePlan(text) {
    var s = String(text || '').trim();
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw Object.assign(new Error('AI 답을 읽지 못했습니다. 다시 요청해 주세요.'), { code: 'format' });
    var obj, body = s.slice(a, b + 1);
    try { obj = JSON.parse(body); }
    catch (e) {
      try { obj = JSON.parse(repairJson(body)); }
      catch (e2) { throw Object.assign(new Error('AI 답의 형식이 잘못되었습니다. 다시 요청해 주세요.'), { code: 'format', detail: e2.message }); }
    }
    if (!obj || typeof obj !== 'object') throw new Error('AI 답이 비어 있습니다.');
    obj.segments = Array.isArray(obj.segments) ? obj.segments : [];
    obj.corrections = Array.isArray(obj.corrections) ? obj.corrections : [];
    obj.reply = String(obj.reply || '');
    obj.title = obj.title == null ? '' : String(obj.title);
    obj.verse = obj.verse == null ? '' : String(obj.verse);
    obj.tighten = ['none', 'normal', 'strong'].indexOf(obj.tighten) >= 0 ? obj.tighten : 'normal';
    return obj;
  }

  function norm(t) { return String(t || '').replace(/[\s.,!?~…"'“”‘’·:;()\[\]>-]/g, ''); }

  function findNear(words, id, text, dir) {
    var target = norm(text);
    if (!target) return id;
    if (words[id] && norm(words[id].text).indexOf(target) === 0) return id;
    for (var d = 1; d <= 15; d++) {
      var cands = dir < 0 ? [id - d, id + d] : [id + d, id - d];
      for (var c = 0; c < 2; c++) {
        var k = cands[c];
        if (k >= 0 && k < words.length && norm(words[k].text).indexOf(target) === 0) return k;
      }
    }
    // 앞 몇 글자만이라도 맞는 곳
    var head = target.slice(0, 2);
    for (var d2 = 0; d2 <= 15; d2++) {
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        var k2 = id + sgn * d2;
        if (k2 >= 0 && k2 < words.length && head && norm(words[k2].text).indexOf(head) === 0) return k2;
      }
    }
    return id;
  }

  /** 계획 → 남길 단어 범위 [{from,to}] (시간 순, 겹침 합침) + 경고 */
  function resolvePlan(plan, words) {
    var n = words.length, ranges = [], warnings = [];
    for (var i = 0; i < plan.segments.length; i++) {
      var sg = plan.segments[i];
      var f = Math.round(Number(sg.from)), t = Math.round(Number(sg.to));
      if (!isFinite(f) || !isFinite(t)) { warnings.push((i + 1) + '번째 구간 번호가 없습니다'); continue; }
      f = Math.max(0, Math.min(n - 1, f)); t = Math.max(0, Math.min(n - 1, t));
      f = findNear(words, f, sg.fromText, 1);
      t = findNear(words, t, sg.toText, -1);
      if (t < f) { var x = f; f = t; t = x; }
      ranges.push({ from: f, to: t });
    }
    ranges.sort(function (a, b) { return a.from - b.from; });
    var merged = [];
    for (var j = 0; j < ranges.length; j++) {
      var last = merged[merged.length - 1];
      if (last && ranges[j].from <= last.to + 1) last.to = Math.max(last.to, ranges[j].to);
      else merged.push({ from: ranges[j].from, to: ranges[j].to });
    }
    var corrections = [];
    for (var c = 0; c < plan.corrections.length; c++) {
      var cr = plan.corrections[c], id = Math.round(Number(cr.id));
      if (isFinite(id) && id >= 0 && id < n && cr.text) corrections.push({ id: id, text: String(cr.text) });
    }
    return { ranges: merged, corrections: corrections, warnings: warnings };
  }

  /** 남길 범위의 대략 길이(초) */
  function rangesDuration(ranges, words) {
    var sum = 0;
    for (var i = 0; i < ranges.length; i++) sum += words[ranges[i].to].end - words[ranges[i].from].start + 0.25;
    return sum;
  }

  /** 현재 편집을 AI 에게 보여 줄 짧은 요약 */
  function describeRanges(ranges, words) {
    return ranges.map(function (r) {
      var t = []; for (var k = r.from; k <= r.to; k++) t.push(words[k].text);
      var s = t.join(' ');
      if (s.length > 160) s = s.slice(0, 70) + ' … ' + s.slice(-70);
      return { from: r.from, to: r.to, text: s };
    });
  }

  /** 남긴 부분 안의 물음표 문장 (질문이 남았는지 알려 주기용) */
  function questionsIn(ranges, words) {
    var out = [];
    for (var i = 0; i < ranges.length; i++) {
      var buf = [];
      for (var k = ranges[i].from; k <= ranges[i].to; k++) {
        buf.push(words[k].text);
        if (/[?？]$/.test(words[k].text)) { out.push(buf.slice(-6).join(' ')); buf = []; }
        else if (/[.!。]$/.test(words[k].text)) buf = [];
      }
    }
    return out;
  }

  return {
    repairJson: repairJson,
    questionsIn: questionsIn,
    wordsFromJson3: wordsFromJson3, transcriptText: transcriptText, buildSystemPrompt: buildSystemPrompt,
    buildUserMessage: buildUserMessage, parsePlan: parsePlan, resolvePlan: resolvePlan,
    rangesDuration: rangesDuration, describeRanges: describeRanges, fmtTime: fmtTime, RULES: RULES,
  };
});
