/*
 * linebreak.js - 자막을 의미 단위로 나누기 (순수 함수, 의존성 없음).
 * 글자 수만 채워 끊지 않고, 한 줄 최대 글자 안에서 '끊기 좋은 자리'를 고른다.
 *  - 좋은 자리: 문장 끝(~습니다·~요), 쉼표, 말 사이 쉼, 이음말 끝(~고·~는데·~면서·~니까·~때), 은/는·이/가·을/를 같은 조사 뒤,
 *               '그리고·그래서·하지만' 같은 접속어 앞
 *  - 나쁜 자리: '그·이런·모든' 같은 꾸밈말 뒤, '하나님의'처럼 ~의 뒤, '기도할·중요한·가는' 같은 꾸밈꼴 뒤,
 *               '수·것·때문' 같은 의존 명사 앞, '있습니다·주세요' 같은 보조 용언 앞, 숫자와 단위(3 장) 사이
 * 줄마다 비슷한 길이가 되도록 하면서 위 점수가 가장 좋은 조합을 동적 계획법으로 찾는다.
 * UMD: 렌더러에서는 SS.linebreak, Node 에서는 require().
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) { root.SS = root.SS || {}; root.SS.linebreak = api; }
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {
  'use strict';

  var PUNCT_TAIL = /["'”’」』)\]…~·]+$/;
  var DETERMINERS = toSet('그 이 저 이런 그런 저런 어떤 무슨 모든 온 온갖 각 한 두 세 네 몇 여러 새 첫 옛 다른 아무 이번 지난 매 본 전 총 약');
  var ADVERBS = toSet('정말 너무 아주 매우 참 더 덜 가장 제일 다시 잘 안 못 꼭 곧 또 늘 항상 함께 같이 바로 그냥 많이 조금 좀 진짜 특히 계속 이미 아직 벌써 가끔 자주 먼저 모두 다 오직 반드시 얼마나 어떻게 왜 이렇게 그렇게 저렇게 진실로 정말로 참으로');
  var CONJ = toSet('그리고 그런데 그래서 하지만 그러나 그러므로 그러니까 그러면 그럼 또한 즉 왜냐하면 따라서 게다가 그렇지만 근데 그러니 결국 그런데도 그리하여 그러자 혹은 또는');
  var NOUN_UI = toSet('회의 의의 주의 강의 문의 정의 예의 동의 합의 논의 결의 의의 민주주의 이의');
  var ADJ_EUN = toSet('좋은 많은 작은 깊은 높은 넓은 같은 받은 믿은 놓은 낮은 적은 젊은 늙은 옳은 맑은 밝은 굳은 짧은 긴 큰 참된 거룩한 새로운');
  var EN_STICKY = toSet('a an the of to in on at for with from by my your our his her their its this these those');
  var EN_CONJ = toSet('and but so because which who when if or that while although');

  // 의존 명사·때를 나타내는 말 (앞말과 붙어 다닌다)
  var DEP_NEXT = /^(수|것|거|게|줄|데|뿐|중|동안|만큼|대로|듯|채|척|체|바|김|적|따름|나름|터|때문)(?:[가-힣]{0,4})$/;
  // 보조 용언·용언 활용 (앞말 없이 줄을 시작하지 않는다)
  var AUX_NEXT = /^(있|없|싶|주|줘|드리|드립|드려|보|봅|봐|놓|두|버리|버렸|계시|계십|계신|않|못하|못합|하|합|한다|했|해|되|됩|된|돼|가|갑|간|오|옵|왔|와|이다|입니|이에|예요|이었|였|이셨|이십|이신|이시)/;
  var LIGHT_VERB = /^(합니다|했습니다|했어요|해요|하는|하고|하며|하면|해서|하셨|하신|하실|하십|됩니다|되었|되고|되는|된다|입니다|이다|이고|이며|이에요|예요|이었|였|이셨|이십|이신|이시|드립니다|드려요|드리|드렸)/;
  var CONNECTIVE_PREV = /(고|어|아|여|게|지|야|러|려|해|와|워|줘|아야|어야|해야|도록)$/;
  var DEP_PREV = toSet('수 줄 것 거 적 바 데 뿐 터');
  var COUNTER_NEXT = /^(장|절|년|월|일|시|분|초|명|번|개|살|주|권|편|가지|차례|째|세|원|분의)/;

  // 끊기 좋은 끝말
  var STRONG_END = /(니다|니까|요|죠|시오|읍시다|ㅂ시다|합시다|봅시다|갑시다|십시다)$/;
  var DECL_END = /(다|까|하라|보라|되라|가라|오라|하자|가자|보자|되자|살자)$/;
  var NOT_END = toSet('필요 중요 주요 수요 소요 강요 동요 개요 요요 불필요 귀중 과연');
  var CONNECTIVE_END = /(고|며|면서|면서도|니까|는데|은데|던데|지만|면|으면|도록|려고|으려고|다가|거나|든지|든가|므로|으므로|하니|보니|되니|오니|가니|으니|어서|아서|여서|해서|라서|기에|길래|자마자|듯이|더니|는데도|어도|아도|해도|라도|때|때에|때는|때마다|동안|후에|전에|뒤에|중에|위해|위해서|통해|통해서|대해|대해서|따라|같이|처럼)$/;
  var TOPIC_END = /(은|는|께서는|에서는|으로는|로는|에게는)$/;
  var SUBJ_END = /(이|가|께서|에서|에게|에게서|께|한테|에|으로|로|와|과|도|만|까지|부터|보다|마다|조차|밖에|이나|나|이랑|랑|하고)$/;
  var OBJ_END = /(을|를)$/;
  var QUOTE_END = /(라고|다고|냐고|자고|라며|다며|이라고|라는|다는)$/;
  // 꾸밈꼴 (뒤의 말을 꾸미므로 그 뒤에서 끊으면 어색하다)
  var ADN_NEUN = /(하|되|있|없|보|주|받|믿|알|살|먹|듣|읽|시|가|오|키|르|치|우|쓰|드리|계시)는$/;
  var ADN_L = /(할|될|갈|올|볼|줄|살|알|받을|있을|없을|드릴|하실|되실|주실|오실|가실|보실|믿을|먹을|들을|읽을|만날|이길|지킬|부를|따를|섬길|누릴|얻을|잃을|찾을|느낄|배울|도울)$/;
  var ADN_PAST = /(던|었던|았던|했던|한|운|된|난|간|온|본|준|받은|있는|없는)$/;

  var LINE_COST = 2.0;   // 줄 하나 더 만드는 값: 쉼표·문장 끝 같은 강한 자리일 때만 줄이 늘어난다
  function toSet(s) { var o = Object.create(null); s.split(/\s+/).forEach(function (w) { if (w) o[w] = true; }); return o; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function bare(text) { return String(text == null ? '' : text).trim().replace(PUNCT_TAIL, '').replace(/[.,?!。？！、;:]+$/, '').replace(PUNCT_TAIL, ''); }
  function lastSyllableHasB(s) {
    // '합니까'처럼 니까 앞 글자 받침이 ㅂ 이면 물음 끝말 (하니까=이유 와 구별)
    var m = /(.)니까$/.exec(s);
    if (!m) return false;
    var c = m[1].charCodeAt(0) - 0xAC00;
    return c >= 0 && c < 11172 && (c % 28) === 17;
  }

  /** 문장이 확실히 끝나는 말 (의미 단위 모드에서는 여기서 항상 줄을 바꾼다) */
  function isSentenceEnd(text) {
    var raw = String(text == null ? '' : text).trim();
    if (/[.?!。？！]["'”’」』)\]]*$/.test(raw)) return true;
    var b = bare(raw);
    if (b.length < 2) return false;
    if (/니까$/.test(b)) return lastSyllableHasB(b);
    return STRONG_END.test(b) && !NOT_END[b];
  }

  /**
   * prev 다음, next 앞에서 줄을 바꾸는 값. 작을수록(음수) 끊기 좋다.
   * gap: 두 말 사이 쉼(초)
   */
  function breakCost(prevText, nextText, gap) {
    var raw = String(prevText == null ? '' : prevText).trim();
    var p = bare(raw), n = bare(nextText).replace(/[^0-9A-Za-z가-힣]/g, '');
    var pl = p.toLowerCase(), nl = n.toLowerCase();
    var cost = 0;
    // 쉼표·말 사이 쉼
    if (/[,，、;:]["'”’」』)\]]*$/.test(raw)) cost -= 2.0;
    if (isNum(gap) && gap > 0) cost -= Math.min(gap, 0.5) / 0.5 * 1.5;
    if (/[.?!。？！]["'”’」』)\]]*$/.test(raw)) cost -= 3.0;
    // 접속어: 그 뒤는 나쁘고 그 앞은 좋다
    if (CONJ[p]) cost += 2.2;
    if (CONJ[n]) cost -= 1.2;
    if (EN_CONJ[nl]) cost -= 0.8;
    // 꾸밈말·~의·꾸밈꼴 뒤
    if (DETERMINERS[p]) cost += 3.0;
    else if (ADVERBS[p]) cost += 1.0;
    if (p.length >= 2 && /의$/.test(p) && !NOUN_UI[p]) cost += 2.5;
    if (ADJ_EUN[p]) cost += 2.0;
    else if (p.length >= 2 && ADN_NEUN.test(p)) cost += 2.0;
    else if (p.length >= 2 && ADN_L.test(p)) cost += 2.0;
    else if (p.length >= 3 && ADN_PAST.test(p)) cost += 1.5;
    if (EN_STICKY[pl]) cost += 2.0;
    // 다음 말이 앞말에 붙어 다니는 말
    if (DEP_NEXT.test(n)) cost += 3.0;
    if (DEP_PREV[p] && /^(있|없|이|아니|같|하|되|밖|뿐|도)/.test(n)) cost += 3.0;
    if (AUX_NEXT.test(n) && CONNECTIVE_PREV.test(p)) cost += 2.5;           // 하고 있습니다 · 해 주세요 · 알지 못합니다
    else if (LIGHT_VERB.test(n)) cost += 2.0;                             // 사랑 합니다 · 기도를 드립니다 · 말씀 입니다
    if (/\d$/.test(p) && COUNTER_NEXT.test(n)) cost += 3.0;
    // 좋은 끝말
    if (/^(때|때에|때는|때도|때마다|후|후에|뒤|뒤에|전|전에|동안|중에|만큼)$/.test(p)) cost -= 1.2;   // ~할 때 / ~한 후에
    if (p.length >= 2) {
      if (isSentenceEnd(raw)) cost -= 2.5;
      else if (DECL_END.test(p) && !DETERMINERS[p]) cost -= 1.0;
      if (QUOTE_END.test(p)) cost -= 0.8;
      else if (CONNECTIVE_END.test(p)) cost -= 1.2;
      else if (TOPIC_END.test(p) && !ADN_NEUN.test(p)) cost -= 0.6;
      else if (SUBJ_END.test(p)) cost -= 0.4;
      else if (OBJ_END.test(p)) cost -= 0.3;
    }
    if (/^(여러분|성도님?들?|형제자매)/.test(p)) cost -= 0.5;
    return cost;
  }

  /**
   * items: [{ text, len, gapBefore }] (len=공백 뺀 글자 수, gapBefore=앞말과의 쉼 초)
   * @returns 줄마다 item 개수 배열 (합 = items.length)
   */
  function splitRun(items, maxChars) {
    var n = items.length;
    if (!n) return [];
    var total = 0, i, j;
    for (i = 0; i < n; i++) total += items[i].len;
    if (total <= maxChars) return [n];
    var k = Math.ceil(total / maxChars), ideal = total / k;
    var bc = new Array(n);
    for (i = 0; i < n - 1; i++) bc[i] = breakCost(items[i].text, items[i + 1].text, items[i + 1].gapBefore);
    var best = [0], from = [0];
    for (j = 1; j <= n; j++) {
      best[j] = Infinity; from[j] = -1;
      var len = 0;
      for (i = j - 1; i >= 0; i--) {
        len += items[i].len;
        if (len > maxChars && i < j - 1) break;
        if (best[i] === Infinity) continue;
        var d = (ideal - len) / maxChars;
        var c = best[i] + LINE_COST + 2.2 * d * d + (len <= 2 && total > 2 ? 1.5 : len <= 3 ? 0.7 : 0) + (j < n ? bc[j - 1] : 0);
        if (c < best[j]) { best[j] = c; from[j] = i; }
      }
    }
    var counts = [];
    for (j = n; j > 0; j = from[j]) counts.unshift(j - from[j]);
    return counts;
  }

  return { breakCost: breakCost, splitRun: splitRun, isSentenceEnd: isSentenceEnd, bare: bare };
}));
