//! 자막을 의미 단위로 나누기 (기존 src/shared/linebreak.js 를 그대로 옮김).
//! 한 줄 최대 글자 안에서 '끊기 좋은 자리'(문장 끝·쉼표·쉼·이음말·조사 뒤·접속어 앞)를 고르고,
//! 꾸밈말 뒤·의존 명사 앞·보조 용언 앞 같은 나쁜 자리는 피한다. 줄 길이가 고르도록 동적 계획법으로 찾는다.
use regex::Regex;
use std::collections::HashSet;
use std::sync::LazyLock;

fn set(s: &'static str) -> HashSet<&'static str> { s.split_whitespace().collect() }
macro_rules! re { ($name:ident, $p:expr) => { static $name: LazyLock<Regex> = LazyLock::new(|| Regex::new($p).unwrap()); }; }
macro_rules! words { ($name:ident, $s:expr) => { static $name: LazyLock<HashSet<&'static str>> = LazyLock::new(|| set($s)); }; }

re!(PUNCT_TAIL, r#"["'”’」』)\]…~·]+$"#);
re!(PUNCT_END, r"[.,?!。？！、;:]+$");
words!(DETERMINERS, "그 이 저 이런 그런 저런 어떤 무슨 모든 온 온갖 각 한 두 세 네 몇 여러 새 첫 옛 다른 아무 이번 지난 매 본 전 총 약");
words!(ADVERBS, "정말 너무 아주 매우 참 더 덜 가장 제일 다시 잘 안 못 꼭 곧 또 늘 항상 함께 같이 바로 그냥 많이 조금 좀 진짜 특히 계속 이미 아직 벌써 가끔 자주 먼저 모두 다 오직 반드시 얼마나 어떻게 왜 이렇게 그렇게 저렇게 진실로 정말로 참으로");
words!(CONJ, "그리고 그런데 그래서 하지만 그러나 그러므로 그러니까 그러면 그럼 또한 즉 왜냐하면 따라서 게다가 그렇지만 근데 그러니 결국 그런데도 그리하여 그러자 혹은 또는");
words!(NOUN_UI, "회의 의의 주의 강의 문의 정의 예의 동의 합의 논의 결의 의의 민주주의 이의");
words!(ADJ_EUN, "좋은 많은 작은 깊은 높은 넓은 같은 받은 믿은 놓은 낮은 적은 젊은 늙은 옳은 맑은 밝은 굳은 짧은 긴 큰 참된 거룩한 새로운");
words!(EN_STICKY, "a an the of to in on at for with from by my your our his her their its this these those");
words!(EN_CONJ, "and but so because which who when if or that while although");
re!(DEP_NEXT, r"^(수|것|거|게|줄|데|뿐|중|동안|만큼|대로|듯|채|척|체|바|김|적|따름|나름|터|때문)(?:[가-힣]{0,4})$");
re!(AUX_NEXT, r"^(있|없|싶|주|줘|드리|드립|드려|보|봅|봐|놓|두|버리|버렸|계시|계십|계신|않|못하|못합|하|합|한다|했|해|되|됩|된|돼|가|갑|간|오|옵|왔|와|이다|입니|이에|예요|이었|였|이셨|이십|이신|이시)");
re!(LIGHT_VERB, r"^(합니다|했습니다|했어요|해요|하는|하고|하며|하면|해서|하셨|하신|하실|하십|됩니다|되었|되고|되는|된다|입니다|이다|이고|이며|이에요|예요|이었|였|이셨|이십|이신|이시|드립니다|드려요|드리|드렸)");
re!(CONNECTIVE_PREV, r"(고|어|아|여|게|지|야|러|려|해|와|워|줘|아야|어야|해야|도록)$");
words!(DEP_PREV, "수 줄 것 거 적 바 데 뿐 터");
re!(COUNTER_NEXT, r"^(장|절|년|월|일|시|분|초|명|번|개|살|주|권|편|가지|차례|째|세|원|분의)");
re!(STRONG_END, r"(니다|니까|요|죠|시오|읍시다|ㅂ시다|합시다|봅시다|갑시다|십시다)$");
re!(DECL_END, r"(다|까|하라|보라|되라|가라|오라|하자|가자|보자|되자|살자)$");
words!(NOT_END, "필요 중요 주요 수요 소요 강요 동요 개요 요요 불필요 귀중 과연");
re!(CONNECTIVE_END, r"(고|며|면서|면서도|니까|는데|은데|던데|지만|면|으면|도록|려고|으려고|다가|거나|든지|든가|므로|으므로|하니|보니|되니|오니|가니|으니|어서|아서|여서|해서|라서|기에|길래|자마자|듯이|더니|는데도|어도|아도|해도|라도|때|때에|때는|때마다|동안|후에|전에|뒤에|중에|위해|위해서|통해|통해서|대해|대해서|따라|같이|처럼)$");
re!(TOPIC_END, r"(은|는|께서는|에서는|으로는|로는|에게는)$");
re!(SUBJ_END, r"(이|가|께서|에서|에게|에게서|께|한테|에|으로|로|와|과|도|만|까지|부터|보다|마다|조차|밖에|이나|나|이랑|랑|하고)$");
re!(OBJ_END, r"(을|를)$");
re!(QUOTE_END, r"(라고|다고|냐고|자고|라며|다며|이라고|라는|다는)$");
re!(ADN_NEUN, r"(하|되|있|없|보|주|받|믿|알|살|먹|듣|읽|시|가|오|키|르|치|우|쓰|드리|계시)는$");
re!(ADN_L, r"(할|될|갈|올|볼|줄|살|알|받을|있을|없을|드릴|하실|되실|주실|오실|가실|보실|믿을|먹을|들을|읽을|만날|이길|지킬|부를|따를|섬길|누릴|얻을|잃을|찾을|느낄|배울|도울)$");
re!(ADN_PAST, r"(던|었던|았던|했던|한|운|된|난|간|온|본|준|받은|있는|없는)$");
re!(SENT_PUNCT, r#"[.?!。？！]["'”’」』)\]]*$"#);
re!(COMMA_END, r#"[,，、;:]["'”’」』)\]]*$"#);
re!(NOT_WORDCH, r"[^0-9A-Za-z가-힣]");
re!(DIGIT_END, r"[0-9]$");
re!(DEP_PREV_NEXT, r"^(있|없|이|아니|같|하|되|밖|뿐|도)");
re!(TIME_WORD, r"^(때|때에|때는|때도|때마다|후|후에|뒤|뒤에|전|전에|동안|중에|만큼)$");
re!(YEOREOBUN, r"^(여러분|성도님?들?|형제자매)");
re!(UI_END, r"의$");
re!(NIKKA_END, r"니까$");

const LINE_COST: f64 = 2.0;

/// JS String.length (UTF-16 단위). 한글은 글자 수와 같다.
fn jlen(s: &str) -> usize { s.encode_utf16().count() }

pub fn bare(text: &str) -> String {
    let t = text.trim();
    let t = PUNCT_TAIL.replace(t, "");
    let t = PUNCT_END.replace(&t, "");
    PUNCT_TAIL.replace(&t, "").into_owned()
}

fn last_syllable_has_b(s: &str) -> bool {
    // '합니까'처럼 니까 앞 글자 받침이 ㅂ 이면 물음 끝말 (하니까=이유 와 구별)
    let chars: Vec<char> = s.chars().collect();
    if chars.len() < 3 || !s.ends_with("니까") { return false; }
    let c = chars[chars.len() - 3] as i64 - 0xAC00;
    (0..11172).contains(&c) && c % 28 == 17
}

/// 문장이 확실히 끝나는 말 (의미 단위 모드에서는 여기서 항상 줄을 바꾼다)
pub fn is_sentence_end(text: &str) -> bool {
    let raw = text.trim();
    if SENT_PUNCT.is_match(raw) { return true; }
    let b = bare(raw);
    if jlen(&b) < 2 { return false; }
    if NIKKA_END.is_match(&b) { return last_syllable_has_b(&b); }
    STRONG_END.is_match(&b) && !NOT_END.contains(b.as_str())
}

/// prev 다음, next 앞에서 줄을 바꾸는 값. 작을수록(음수) 끊기 좋다. gap: 두 말 사이 쉼(초)
pub fn break_cost(prev_text: &str, next_text: &str, gap: Option<f64>) -> f64 {
    let raw = prev_text.trim();
    let p = bare(raw);
    let n = NOT_WORDCH.replace_all(&bare(next_text), "").into_owned();
    let pl = p.to_lowercase();
    let nl = n.to_lowercase();
    let ps = p.as_str();
    let plen = jlen(ps);
    let mut cost = 0.0;
    if COMMA_END.is_match(raw) { cost -= 2.0; }
    if let Some(g) = gap { if g.is_finite() && g > 0.0 { cost -= g.min(0.5) / 0.5 * 1.5; } }
    if SENT_PUNCT.is_match(raw) { cost -= 3.0; }
    if CONJ.contains(ps) { cost += 2.2; }
    if CONJ.contains(n.as_str()) { cost -= 1.2; }
    if EN_CONJ.contains(nl.as_str()) { cost -= 0.8; }
    if DETERMINERS.contains(ps) { cost += 3.0; } else if ADVERBS.contains(ps) { cost += 1.0; }
    if plen >= 2 && UI_END.is_match(ps) && !NOUN_UI.contains(ps) { cost += 2.5; }
    if ADJ_EUN.contains(ps) { cost += 2.0; }
    else if plen >= 2 && ADN_NEUN.is_match(ps) { cost += 2.0; }
    else if plen >= 2 && ADN_L.is_match(ps) { cost += 2.0; }
    else if plen >= 3 && ADN_PAST.is_match(ps) { cost += 1.5; }
    if EN_STICKY.contains(pl.as_str()) { cost += 2.0; }
    if DEP_NEXT.is_match(&n) { cost += 3.0; }
    if DEP_PREV.contains(ps) && DEP_PREV_NEXT.is_match(&n) { cost += 3.0; }
    if AUX_NEXT.is_match(&n) && CONNECTIVE_PREV.is_match(ps) { cost += 2.5; }
    else if LIGHT_VERB.is_match(&n) { cost += 2.0; }
    if DIGIT_END.is_match(ps) && COUNTER_NEXT.is_match(&n) { cost += 3.0; }
    if TIME_WORD.is_match(ps) { cost -= 1.2; }
    if plen >= 2 {
        if is_sentence_end(raw) { cost -= 2.5; }
        else if DECL_END.is_match(ps) && !DETERMINERS.contains(ps) { cost -= 1.0; }
        if QUOTE_END.is_match(ps) { cost -= 0.8; }
        else if CONNECTIVE_END.is_match(ps) { cost -= 1.2; }
        else if TOPIC_END.is_match(ps) && !ADN_NEUN.is_match(ps) { cost -= 0.6; }
        else if SUBJ_END.is_match(ps) { cost -= 0.4; }
        else if OBJ_END.is_match(ps) { cost -= 0.3; }
    }
    if YEOREOBUN.is_match(ps) { cost -= 0.5; }
    cost
}

pub struct RunItem<'a> { pub text: &'a str, pub len: usize, pub gap_before: f64 }

/// → 줄마다 item 개수 (합 = items.len())
pub fn split_run(items: &[RunItem], max_chars: usize) -> Vec<usize> {
    let n = items.len();
    if n == 0 { return vec![]; }
    let total: usize = items.iter().map(|x| x.len).sum();
    if total <= max_chars { return vec![n]; }
    let k = (total as f64 / max_chars as f64).ceil();
    let ideal = total as f64 / k;
    let bc: Vec<f64> = (0..n.saturating_sub(1)).map(|i| break_cost(items[i].text, items[i + 1].text, Some(items[i + 1].gap_before))).collect();
    let mut best = vec![f64::INFINITY; n + 1];
    let mut from = vec![-1i64; n + 1];
    best[0] = 0.0; from[0] = 0;
    for j in 1..=n {
        let mut len = 0usize;
        let mut i = j as i64 - 1;
        while i >= 0 {
            let iu = i as usize;
            len += items[iu].len;
            if len > max_chars && iu < j - 1 { break; }
            if best[iu].is_finite() {
                let d = (ideal - len as f64) / max_chars as f64;
                let short = if len <= 2 && total > 2 { 1.5 } else if len <= 3 { 0.7 } else { 0.0 };
                let c = best[iu] + LINE_COST + 2.2 * d * d + short + if j < n { bc[j - 1] } else { 0.0 };
                if c < best[j] { best[j] = c; from[j] = i; }
            }
            i -= 1;
        }
    }
    let mut counts = vec![];
    let mut j = n as i64;
    while j > 0 { let f = from[j as usize]; counts.insert(0, (j - f) as usize); j = f; }
    counts
}
