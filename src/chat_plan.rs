//! 대화형 AI 편집의 순수 함수 (기존 src/shared/chat-plan.js): 자막 → 단어, AI 프롬프트, AI 답(편집 계획) 해석, 편집 조건 버튼.
use serde_json::Value;

/// 설교 말 속도: 한 글자(음절)에 걸리는 대략 시간(초)
pub const SYL: f64 = 0.17;

pub fn syllables(t: &str) -> usize {
    let n = t.chars().filter(|&c| ('\u{AC00}'..='\u{D7A3}').contains(&c) || c.is_ascii_alphanumeric()).count();
    n.max(1)
}

#[derive(Clone, Debug, PartialEq)]
pub struct SubWord { pub text: String, pub start: f64, pub end: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct SubLine { pub start: f64, pub from: usize, pub to: usize }

fn js_space(c: char) -> bool { c.is_whitespace() || c == '\u{feff}' }
fn num(v: &Value) -> f64 { v.as_f64().filter(|x| *x != 0.0).unwrap_or(0.0) }

/// json3 → (단어, 줄). 시간은 원본 영상 기준 초
pub fn words_from_json3(data: &Value) -> (Vec<SubWord>, Vec<SubLine>) {
    let mut words: Vec<(SubWord, f64)> = vec![];
    let mut lines = vec![];
    for ev in data["events"].as_array().into_iter().flatten() {
        let Some(segs) = ev["segs"].as_array() else { continue };
        let t0 = num(&ev["tStartMs"]) / 1000.0;
        let ev_end = t0 + num(&ev["dDurationMs"]) / 1000.0;
        let from = words.len();
        for s in segs {
            let raw = match &s["utf8"] { Value::String(x) => x.clone(), Value::Null => String::new(), v => v.to_string() };
            let text = raw.split(js_space).filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ");
            if text.is_empty() { continue; }
            let st = t0 + num(&s["tOffsetMs"]) / 1000.0;
            let mut q = 0.0;
            for p in text.split(' ') {
                if p.is_empty() || p == ">>" { continue; }
                words.push((SubWord { text: p.to_string(), start: st + q * 0.05, end: 0.0 }, ev_end));
                q += 1.0;
            }
        }
        if words.len() > from { lines.push(SubLine { start: words[from].0.start, from, to: words.len() - 1 }); }
    }
    // 단어 끝: 다음 단어 시작 전, 글자 수로 어림한 길이만큼
    let n = words.len();
    for i in 0..n {
        let next = if i + 1 < n { words[i + 1].0.start } else { words[i].1 };
        let ev_end = words[i].1;
        let w = &mut words[i].0;
        let est = w.start + syllables(&w.text) as f64 * SYL + 0.08;
        w.end = (w.start + 0.12).max((next - 0.02).min(est).min(ev_end.max(w.start + 0.12)));
        if w.end <= w.start { w.end = w.start + 0.12; }
    }
    (words.into_iter().map(|x| x.0).collect(), lines)
}

// ---------------- JS 와 같은 동작을 위한 작은 도구 ----------------
/// JS Number(v) (없는 값 = NaN, null = 0)
pub fn js_num(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => if *b { 1.0 } else { 0.0 },
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => { let t = s.trim(); if t.is_empty() { 0.0 } else { t.parse::<f64>().ok().filter(|x| x.is_finite()).unwrap_or(f64::NAN) } }
        Some(Value::Array(a)) => if a.is_empty() { 0.0 } else if a.len() == 1 { js_num(Some(&a[0])) } else { f64::NAN },
        Some(Value::Object(_)) => f64::NAN,
    }
}
/// JS Math.round
pub fn js_round(x: f64) -> f64 { if x.is_finite() { (x + 0.5).floor() } else { x } }
/// JS 의 참/거짓
pub fn truthy(v: Option<&Value>) -> bool {
    match v { None | Some(Value::Null) => false, Some(Value::Bool(b)) => *b, Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()), Some(Value::String(s)) => !s.is_empty(), _ => true }
}
fn js_num_str(x: f64) -> String { if x.fract() == 0.0 && x.abs() < 1e21 { format!("{}", x as i64) } else { format!("{x}") } }
/// JS String(v)
pub fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(), Some(Value::Null) => "null".into(), Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => js_num_str(n.as_f64().unwrap_or(0.0)), Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a.iter().map(|x| match x { Value::Null => String::new(), _ => js_string(Some(x)) }).collect::<Vec<_>>().join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}
/// UTF-16 길이 (JS .length)
pub fn js_len(s: &str) -> usize { s.encode_utf16().count() }
pub fn js_slice(s: &str, a: usize, b: usize) -> String { let u: Vec<u16> = s.encode_utf16().collect(); String::from_utf16_lossy(&u[a.min(u.len())..b.min(u.len())]) }
fn js_tail(s: &str, n: usize) -> String { let u: Vec<u16> = s.encode_utf16().collect(); String::from_utf16_lossy(&u[u.len().saturating_sub(n)..]) }
/// JS toFixed(1) (딱 반이면 올림)
fn to_fixed1(x: f64) -> String {
    // 소수 첫째 자리에서 정확히 반인 값(…25, …75)만 JS 는 올리고 Rust 는 짝수로 맞춘다
    if (x * 4.0).fract() == 0.0 && (x * 2.0).fract() != 0.0 { return format!("{:.1}", ((x * 10.0).floor() + 1.0) / 10.0); }
    format!("{x:.1}")
}
/// JSON 글자 (JSON.stringify 와 같은 이스케이프)
pub fn jstr(s: &str) -> String { serde_json::to_string(s).unwrap_or_default() }

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Range { pub from: usize, pub to: usize }

pub fn fmt_time(sec: f64) -> String {
    let sec = sec.max(0.0);
    let h = (sec / 3600.0).floor();
    let m = ((sec % 3600.0) / 60.0).floor();
    let s = sec - h * 3600.0 - m * 60.0;
    let mut ss = to_fixed1(s);
    if s < 10.0 { ss = format!("0{ss}"); }
    format!("{}:{ss}", if h > 0.0 { format!("{}:{:02}", h as i64, m as i64) } else { (m as i64).to_string() })
}

/// AI 에게 줄 자막: "#4501 [57:34.5] 기도란 시작도 하나님이요"
pub fn transcript_text(words: &[SubWord], lines: &[SubLine], range: Option<(f64, f64)>) -> String {
    let mut out = vec![];
    for l in lines {
        if let Some((a, b)) = range { if words[l.to].end < a || l.start > b { continue; } }
        let t: Vec<&str> = (l.from..=l.to).map(|k| words[k].text.as_str()).collect();
        out.push(format!("#{} [{}] {}", l.from, fmt_time(l.start), t.join(" ")));
    }
    out.join("\n")
}

pub const RULES: [&str; 8] = [
    "설교 제목에 맞는 가장 결론적인 메시지와 삶의 적용을 중심으로 고릅니다. 결론부의 요약·적용·축복도 꼭 살펴봅니다.",
    "\"그…\", \"어…\", \"음…\"처럼 말을 끄는 소리와 군말, 같은 말 반복, 말 더듬기는 빼고 이어 붙입니다.",
    "회중에게 묻는 말(\"누구입니까?\", \"그렇지 않습니까?\", \"아멘 하시겠습니까?\"), 그 대답, 회중 이름을 부르는 말, 개인적인 농담은 뺍니다. 질문을 빼서 어색해지는 대답 조각도 함께 뺍니다.",
    "물음표로 끝나는 문장은 수사적 질문이라도(예: \"아멘의 뜻이 뭡니까?\") 빼고, 그 뒤의 설명을 평서문으로 이어지게 고릅니다.",
    "예배 진행 안내(\"이제 마무리하겠습니다\", \"말씀 나누도록 하겠습니다\", \"성경 보시면\")는 뺍니다.",
    "빼고 난 뒤에도 문장이 자연스럽게 이어지도록 앞뒤를 고릅니다. 설교자가 하지 않은 말을 만들지 않습니다.",
    "구간은 원래 시간 순서대로만 이어 붙일 수 있습니다(순서를 바꿀 수 없습니다).",
    "마지막은 힘 있는 결론이나 축복으로 끝나게 합니다.",
];

#[derive(Default, Clone)]
pub struct PromptCtx { pub church: String, pub speaker: String, pub terms: String, pub video_title: String }

pub fn build_system_prompt(c: &PromptCtx) -> String {
    let rules: Vec<String> = RULES.iter().enumerate().map(|(i, r)| format!("{}. {r}", i + 1)).collect();
    let opt = |label: &str, v: &str| if v.is_empty() { String::new() } else { format!("{label}{v}") };
    let parts: Vec<String> = vec![
        "당신은 교회 설교 영상을 세로형 쇼츠로 편집하는 편집자입니다. 사용자(교회 담당자)와 한국어로 대화하며 편집합니다.".into(),
        opt("교회: ", &c.church),
        opt("설교자: ", &c.speaker),
        opt("이 교회에서 자주 쓰는 용어(자동 자막이 잘못 받아 적었을 수 있음): ", &c.terms),
        opt("영상 제목: ", &c.video_title),
        String::new(),
        "[자막 형식] 각 줄은 \"#번호 [시각] 단어들\" 입니다. #번호는 그 줄 첫 단어의 번호이고, 같은 줄의 다음 단어들은 번호가 1씩 커집니다. 자동 자막이라 틀린 글자가 있습니다.".into(),
        String::new(),
        "[편집 원칙]".into(),
        rules.join("\n"),
        String::new(),
        "[답 형식] 반드시 JSON 하나만 답합니다. 코드 블록이나 다른 글은 쓰지 않습니다.".into(),
        "{".into(),
        "  \"reply\": \"사용자에게 할 말 (한두 문장, 무엇을 어떻게 했는지)\",".into(),
        "  \"title\": \"쇼츠 제목 (두 줄이면 \\n 으로 나눔, 줄당 12자 안팎)\",".into(),
        "  \"verse\": \"성경 본문 (예: 마태복음 6:13, 모르면 빈 글자)\",".into(),
        "  \"sermon\": {\"from\": 설교 시작 단어번호, \"to\": 설교 끝 단어번호},".into(),
        "  \"segments\": [ {\"from\": 첫 단어번호, \"fromText\": \"첫 단어\", \"to\": 끝 단어번호, \"toText\": \"끝 단어\"} ],".into(),
        "  \"corrections\": [ {\"id\": 단어번호, \"text\": \"바르게 고친 단어\"} ],".into(),
        "  \"tighten\": \"none | normal | strong (말 사이 공백을 얼마나 줄일지)\",".into(),
        "  \"candidates\": [ {\"title\": \"후보 제목\", \"from\": 첫 단어번호, \"fromText\": \"첫 단어\", \"to\": 끝 단어번호, \"toText\": \"끝 단어\", \"summary\": \"무슨 내용인지 한 문장\", \"why\": \"쇼츠로 좋은 까늭 한 문장\"} ]".into(),
        "}".into(),
        "segments 는 남길 부분(포함 범위)을 시간 순서대로 적습니다. 바꿀 것이 없는 항목은 이전 답과 같게 둡니다.".into(),
        "사용자가 구간 추천을 부탁하면 candidates 에 서로 겹치지 않는 후보를 부탁한 개수만큼(보통 3개) 설교 안에서 골라 시간 순서대로 넣고, segments 는 빈 배열로 둡니다. 추천이 아닐 때는 candidates 를 쓰지 않습니다.".into(),
        "[편집 조건] 이 있으면 [편집 원칙] 보다 우선합니다.".into(),
        "reply 는 교회 봉사자가 읽는 쉬운 우리말로 씁니다. tighten, segments 같은 항목 이름이나 영어 값은 쓰지 않습니다.".into(),
        "사용자가 편집이 아닌 질문만 하면 segments 를 이전과 같게 두고 reply 로 답합니다.".into(),
    ];
    parts.into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join("\n").replace("\n[", "\n\n[")
}

/// 지금 편집 상태 (AI 에게 보여 줄 요약)
#[derive(Clone, Debug, Default)]
pub struct Current { pub title: String, pub verse: String, pub tighten: String, pub segments: Vec<(usize, usize, String)>, pub remaining_questions: Vec<String> }
impl Current {
    /// JSON.stringify 와 같은 순서의 글
    pub fn to_json(&self) -> String {
        let segs: Vec<String> = self.segments.iter().map(|(f, t, s)| format!("{{\"from\":{f},\"to\":{t},\"text\":{}}}", jstr(s))).collect();
        let qs: Vec<String> = self.remaining_questions.iter().map(|q| jstr(q)).collect();
        format!("{{\"title\":{},\"verse\":{},\"tighten\":{},\"segments\":[{}],\"remainingQuestions\":[{}]}}", jstr(&self.title), jstr(&self.verse), jstr(&self.tighten), segs.join(","), qs.join(","))
    }
}

pub fn build_user_message(request: &str, current: Option<&Current>, duration_sec: f64) -> String {
    let mut parts = vec![];
    if let Some(c) = current { parts.push(format!("[현재 편집]\n{}", c.to_json())); }
    if duration_sec != 0.0 && !duration_sec.is_nan() { parts.push(format!("[현재 길이] 약 {}초", js_round(duration_sec) as i64)); }
    parts.push(format!("[요청]\n{request}"));
    parts.join("\n\n")
}

pub fn js_ws(c: char) -> bool { c.is_whitespace() || c == '\u{feff}' }

/// 조금 어긋난 JSON 고치기: 문자열 안의 줄바꿈·탭, 끝에 남은 쉼표, // 주석, 똑똑한 따옴표
pub fn repair_json(s: &str) -> String {
    let cs: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let (mut in_str, mut esc) = (false, false);
    let mut i = 0;
    while i < cs.len() {
        let mut c = cs[i];
        if in_str {
            if esc { out.push(c); esc = false; }
            else if c == '\\' { out.push(c); esc = true; }
            else if c == '"' { in_str = false; out.push(c); }
            else if c == '\n' { out.push_str("\\n"); }
            else if c == '\r' {}
            else if c == '\t' { out.push_str("\\t"); }
            else { out.push(c); }
        } else {
            if c == '“' || c == '”' { c = '"'; }
            if c == '"' { in_str = true; out.push(c); }
            else if c == '/' && cs.get(i + 1) == Some(&'/') { while i < cs.len() && cs[i] != '\n' { i += 1; } } // JS 처럼 줄바꿈도 함께 건너뜀
            else { out.push(c); }
        }
        i += 1;
    }
    // ,\s*([}\]]) → $1
    let oc: Vec<char> = out.chars().collect();
    let mut r = String::with_capacity(out.len());
    let mut i = 0;
    while i < oc.len() {
        if oc[i] == ',' {
            let mut j = i + 1;
            while j < oc.len() && js_ws(oc[j]) { j += 1; }
            if j < oc.len() && (oc[j] == '}' || oc[j] == ']') { r.push(oc[j]); i = j + 1; continue; }
        }
        r.push(oc[i]);
        i += 1;
    }
    r
}

#[derive(Debug, Clone)]
pub struct PlanErr { pub format: bool, pub msg: String, pub detail: String }
impl std::fmt::Display for PlanErr { fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str(&self.msg) } }

/// AI 답 (parsePlan 결과)
#[derive(Debug, Clone, Default)]
pub struct Plan {
    pub reply: String, pub title: String, pub verse: String, pub tighten: String,
    pub segments: Vec<Value>, pub corrections: Vec<Value>, pub candidates: Vec<Value>,
    pub sermon: Option<(f64, f64)>,
}

pub fn js_trim(s: &str) -> &str { s.trim_matches(js_ws) }

/// AI 답에서 JSON 꺼내기 (코드 블록·앞뒤 글이 붙어도)
pub fn parse_plan(text: &str) -> Result<Plan, PlanErr> {
    let mut s = js_trim(text).to_string();
    if let Some(a) = s.find("```") {
        let mut rest = &s[a + 3..];
        if let Some(r) = rest.strip_prefix("json") { rest = r; }
        let rest = rest.trim_start_matches(js_ws);
        if let Some(b) = rest.find("```") { s = js_trim(&rest[..b]).to_string(); }
    }
    let fmt = |m: &str, d: String| PlanErr { format: true, msg: m.into(), detail: d };
    let (Some(a), Some(b)) = (s.find('{'), s.rfind('}')) else { return Err(fmt("AI 답을 읽지 못했습니다. 다시 요청해 주세요.", String::new())) };
    if b <= a { return Err(fmt("AI 답을 읽지 못했습니다. 다시 요청해 주세요.", String::new())); }
    let body = &s[a..=b];
    let obj: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => match serde_json::from_str(&repair_json(body)) { Ok(v) => v, Err(e2) => return Err(fmt("AI 답의 형식이 잘못되었습니다. 다시 요청해 주세요.", e2.to_string())) },
    };
    if !obj.is_object() && !obj.is_array() { return Err(PlanErr { format: false, msg: "AI 답이 비어 있습니다.".into(), detail: String::new() }); }
    let g = |k: &str| obj.get(k);
    let arr = |k: &str| g(k).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let tighten = g("tighten").and_then(|v| v.as_str()).filter(|t| ["none", "normal", "strong"].contains(t)).unwrap_or("normal").to_string();
    let sermon = if truthy(g("sermon")) { g("sermon").map(|sv| (js_num(sv.get("from")), js_num(sv.get("to")))) } else { None };
    Ok(Plan {
        reply: if truthy(g("reply")) { js_string(g("reply")) } else { String::new() },
        title: match g("title") { None | Some(Value::Null) => String::new(), v => js_string(v) },
        verse: match g("verse") { None | Some(Value::Null) => String::new(), v => js_string(v) },
        tighten,
        segments: arr("segments"), corrections: arr("corrections"),
        candidates: arr("candidates").into_iter().filter(|c| c.is_object() || c.is_array()).collect(),
        sermon,
    })
}

fn norm(t: &str) -> String { t.chars().filter(|c| !(js_ws(*c) || ".,!?~…\"'“”‘’·:;()[]>-".contains(*c))).collect() }

fn find_near(words: &[SubWord], id: usize, text: Option<&Value>, dir: i32) -> usize {
    let target = norm(&match text { None | Some(Value::Null) => String::new(), v => js_string(v) });
    if target.is_empty() { return id; }
    let n = words.len() as i64;
    let hit = |k: i64, t: &str| k >= 0 && k < n && norm(&words[k as usize].text).starts_with(t);
    if hit(id as i64, &target) { return id; }
    for d in 1..=15i64 {
        let c = if dir < 0 { [id as i64 - d, id as i64 + d] } else { [id as i64 + d, id as i64 - d] };
        for k in c { if hit(k, &target) { return k as usize; } }
    }
    let head = js_slice(&target, 0, 2);
    if !head.is_empty() {
        for d in 0..=15i64 { for sg in [-1i64, 1] { let k = id as i64 + sg * d; if hit(k, &head) { return k as usize; } } }
    }
    id
}

fn clamp_id(x: f64, n: usize) -> usize { x.max(0.0).min(n as f64 - 1.0) as usize }

#[derive(Debug, Clone, Default)]
pub struct Resolved { pub ranges: Vec<Range>, pub corrections: Vec<(usize, String)>, pub warnings: Vec<String> }

/// 계획 → 남길 단어 범위 (시간 순, 겹침 합침) + 경고
pub fn resolve_plan(plan: &Plan, words: &[SubWord]) -> Resolved {
    let n = words.len();
    let mut ranges = vec![];
    let mut warnings = vec![];
    for (i, sg) in plan.segments.iter().enumerate() {
        let (f, t) = (js_round(js_num(sg.get("from"))), js_round(js_num(sg.get("to"))));
        if !f.is_finite() || !t.is_finite() { warnings.push(format!("{}번째 구간 번호가 없습니다", i + 1)); continue; }
        if n == 0 { continue; }
        let (mut f, mut t) = (clamp_id(f, n), clamp_id(t, n));
        f = find_near(words, f, sg.get("fromText"), 1);
        t = find_near(words, t, sg.get("toText"), -1);
        if t < f { std::mem::swap(&mut f, &mut t); }
        ranges.push(Range { from: f, to: t });
    }
    ranges.sort_by_key(|r| r.from);
    let mut merged: Vec<Range> = vec![];
    for r in ranges {
        if let Some(l) = merged.last_mut() { if r.from <= l.to + 1 { l.to = l.to.max(r.to); continue; } }
        merged.push(r);
    }
    let mut corrections = vec![];
    for cr in &plan.corrections {
        let id = js_round(js_num(cr.get("id")));
        if id.is_finite() && id >= 0.0 && (id as usize) < n && truthy(cr.get("text")) { corrections.push((id as usize, js_string(cr.get("text")))); }
    }
    Resolved { ranges: merged, corrections, warnings }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Candidate { pub no: usize, pub title: String, pub summary: String, pub why: String, pub from: usize, pub to: usize, pub start: f64, pub end: f64, pub duration_sec: f64, pub excerpt: String }

/// AI 가 추천한 후보 → 단어 범위·시각·길이·자막 미리보기 (최대 5개, 너무 짧은 것은 버림)
pub fn resolve_candidates(list: &[Value], words: &[SubWord]) -> Vec<Candidate> {
    let n = words.len();
    let mut out: Vec<Candidate> = vec![];
    for c in list {
        if !c.is_object() || out.len() >= 5 || n == 0 { continue; }
        let (f, t) = (js_round(js_num(c.get("from"))), js_round(js_num(c.get("to"))));
        if !f.is_finite() || !t.is_finite() { continue; }
        let (mut f, mut t) = (clamp_id(f, n), clamp_id(t, n));
        f = find_near(words, f, c.get("fromText"), 1);
        t = find_near(words, t, c.get("toText"), -1);
        if t < f { std::mem::swap(&mut f, &mut t); }
        if t - f < 5 { continue; }
        let s = (f..=t).map(|k| words[k].text.as_str()).collect::<Vec<_>>().join(" ");
        let excerpt = if js_len(&s) > 420 { format!("{} … {}", js_slice(&s, 0, 260), js_tail(&s, 140)) } else { s };
        let st = |k: &str| if truthy(c.get(k)) { js_trim(&js_string(c.get(k))).to_string() } else { String::new() };
        out.push(Candidate { no: out.len() + 1, title: st("title"), summary: st("summary"), why: st("why"), from: f, to: t, start: words[f].start, end: words[t].end, duration_sec: words[t].end - words[f].start, excerpt });
    }
    out
}

// ---------------- 편집 조건 버튼 ----------------
pub const LENGTHS: [(u32, &str); 5] = [(60, "1분"), (90, "1분 30초"), (120, "2분"), (150, "2분 30초"), (180, "3분")];
pub const CONTENTS: [(&str, &str); 8] = [("core", "핵심 메시지"), ("story", "예화·이야기"), ("exposition", "말씀 풀이"), ("application", "삶의 적용"), ("comfort", "위로"), ("challenge", "도전"), ("gospel", "복음"), ("prayer", "기도")];
pub const AUDIENCES: [(&str, &str); 4] = [("all", "모두"), ("members", "성도"), ("seekers", "처음 온 분"), ("youth", "청년")];
fn audience_text(k: &str) -> Option<&'static str> {
    match k { "members" => Some("교회에 다니는 성도에게 깊이 있게 다가갈"), "seekers" => Some("교회에 처음 온 분이나 신앙이 없는 분도 이해하기 쉽고 교회 용어가 적은"), "youth" => Some("청년·학생이 공감할 만한"), _ => None }
}
fn intensity_text(i: i64) -> &'static str { ["", "아주 잔잔하게(위로·묵상)", "잔잔하게", "보통", "힘 있게", "아주 강하게(도전·결단)"][i as usize] }
pub const COUNTS: [u32; 3] = [3, 4, 5];
pub const STYLES: [(&str, &str, &str); 6] = [
    ("tight", "늘어지지 않게", "늘어지지 않게: 같은 내용을 되풀이하는 문장, 길게 늘어지는 예화·배경 설명, 곁가지 이야기는 빼고 핵심 메시지가 힘 있게 이어지게 고릅니다."),
    ("filler", "군말·반복 빼기", "군말 빼기: \"그…\", \"어…\", \"음…\"처럼 말을 끄는 소리, 더듬기, 같은 말 반복은 빼고 이어 붙입니다."),
    ("questions", "질문·대답 빼기", "질문 빼기: 회중에게 묻는 말과 그 대답, 물음표로 끝나는 문장은 뺍니다."),
    ("notices", "진행 안내 빼기", "진행 안내 빼기: 예배 진행 안내(\"이제 마무리하겠습니다\", \"성경 보시면\" 등)는 뺍니다."),
    ("gaps", "공백 없애기", ""),
    ("ending", "결론으로 끝내기", "끝맺음: 마지막은 힘 있는 결론이나 축복의 말로 끝나게 합니다."),
];
fn style_off(k: &str) -> Option<&'static str> { match k { "questions" => Some("질문: 회중에게 묻는 말도 흐름에 필요하면 남겨도 됩니다."), "notices" => Some("진행 안내: 흐름에 필요하면 남겨도 됩니다."), _ => None } }
pub const GAP_SHRINK: f64 = 0.88;

pub fn fmt_len(sec: f64) -> String {
    let sec = js_round(sec).max(0.0) as i64;
    let (m, s) = (sec / 60, sec % 60);
    let ms = if m > 0 { format!("{m}분") } else { String::new() };
    let ss = if s > 0 { format!("{}{s}초", if m > 0 { " " } else { "" }) } else if m > 0 { String::new() } else { "0초".into() };
    format!("{ms}{ss}")
}
/// '2분' → '2분으로', '1분 30초' → '1분 30초로'
pub fn with_ro(w: &str) -> String {
    let c = w.encode_utf16().last().unwrap_or(0) as u32;
    if (0xAC00..=0xD7A3).contains(&c) { let j = (c - 0xAC00) % 28; return format!("{w}{}", if j != 0 && j != 8 { "으로" } else { "로" }); }
    format!("{w}로")
}

fn content_names(p: &Value) -> Vec<&'static str> {
    let cs: Vec<String> = p.get("contents").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    CONTENTS.iter().filter(|c| cs.iter().any(|x| x == c.0)).map(|c| c.1).collect()
}
pub fn count_of(p: &Value) -> i64 { let n = js_round(js_num(p.get("count"))); if (1.0..=5.0).contains(&n) { n as i64 } else { 3 } }
fn raw_len(l: f64) -> f64 { js_round(l / GAP_SHRINK / 5.0) * 5.0 }

/// 버튼으로 고른 조건 → AI 에게 줄 [편집 조건] 글
pub fn build_conditions(p: &Value) -> String {
    let mut out: Vec<String> = vec![];
    let l = js_num(p.get("length"));
    if l > 0.0 {
        if truthy(p.get("gaps")) { let r = raw_len(l); out.push(format!("길이: 남길 범위를 합쳐 약 {} ({}~{}). 프로그램이 말 사이 공백을 줄이면 완성 길이가 약 {}이 됩니다.", fmt_len(r), fmt_len(r - 10.0), fmt_len(r + 10.0), fmt_len(l))); }
        else { out.push(format!("길이: 남길 범위를 합쳐 약 {} ({}~{}).", fmt_len(l), fmt_len(l - 10.0), fmt_len(l + 10.0))); }
    }
    let names = content_names(p);
    if !names.is_empty() { out.push(format!("내용: {} 중심으로 고릅니다.", names.join("·"))); }
    if let Some(t) = p.get("audience").and_then(|v| v.as_str()).and_then(audience_text) { out.push(format!("대상: {t} 부분을 고릅니다.")); }
    let i = js_round(js_num(p.get("intensity")));
    if (1.0..=5.0).contains(&i) { out.push(format!("강도: 5단계 중 {} — {} (1=잔잔한 위로, 5=강한 도전).", i as i64, intensity_text(i as i64))); }
    for st in STYLES { if truthy(p.get(st.0)) { if !st.2.is_empty() { out.push(st.2.into()); } } else if let Some(o) = style_off(st.0) { out.push(o.into()); } }
    if out.is_empty() { String::new() } else { format!("[편집 조건] (아래 조건이 [편집 원칙]보다 우선합니다)\n- {}", out.join("\n- ")) }
}

/// 조건 요약 (버튼 옆·말풍선에 보여 줄 짧은 글)
pub fn conditions_summary(p: &Value) -> String {
    let mut parts: Vec<String> = vec![];
    let l = js_num(p.get("length"));
    if l > 0.0 { parts.push(fmt_len(l)); }
    parts.extend(content_names(p).into_iter().map(String::from));
    if let Some(a) = AUDIENCES.iter().find(|a| p.get("audience").and_then(|v| v.as_str()) == Some(a.0) && a.0 != "all") { parts.push(a.1.into()); }
    let i = js_round(js_num(p.get("intensity")));
    if (1.0..=5.0).contains(&i) { parts.push(format!("강도 {}", i as i64)); }
    for st in STYLES { if truthy(p.get(st.0)) { parts.push(st.1.into()); } }
    parts.join(" · ")
}

/// 버튼 하나 → (말풍선 글, AI 에게 보낼 글). arg: pick 이면 후보 {no,from,to,title}, length 면 초
pub fn action_request(key: &str, p: &Value, arg: &Value) -> Option<(String, String)> {
    let cond = build_conditions(p);
    let sum = conditions_summary(p);
    let with_cond = |t: String| if cond.is_empty() { t } else { format!("{cond}\n\n{t}") };
    let sumx = if sum.is_empty() { String::new() } else { format!(" ({sum})") };
    Some(match key {
        "recommend" => { let n = count_of(p); (format!("구간 {n}곳 추천{sumx}"), with_cond(format!("이 설교에서 쇼츠로 쓸 만한 구간 {n}곳을 추천해 줘. 후보끼리 겹치지 않게, 각 후보는 길이 조건보다 30초쯤 넉넉하게 잡아 줘(나중에 다듬을 거야). 아직 편집은 하지 마."))) }
        "again" => { let n = count_of(p); (format!("다른 구간 {n}곳 추천"), with_cond(format!("지금 편집과 앞서 추천한 것과 다른 구간으로 쇼츠 후보 {n}곳을 추천해 줘. 아직 편집은 바꾸지 마."))) }
        "make" => (format!("바로 만들기{sumx}"), with_cond("설교의 결론과 삶의 적용을 중심으로 쇼츠를 만들어 줘.".into())),
        "pick" => {
            let t = if truthy(arg.get("title")) { js_string(arg.get("title")) } else { String::new() };
            let re = regex::Regex::new(r"\s*\n\s*").unwrap();
            let ttl = js_trim(&re.replace_all(&t, " ")).to_string();
            let no = js_string(arg.get("no"));
            let q = if ttl.is_empty() { String::new() } else { format!(" 「{ttl}」") };
            let q2 = if ttl.is_empty() { String::new() } else { format!(", 「{ttl}」") };
            (format!("{no}번 후보로 만들기{q}"), with_cond(format!("{no}번 후보(#{}~#{}{q2}) 범위 안에서만 골라 쇼츠를 만들어 줘.", js_string(arg.get("from")), js_string(arg.get("to")))))
        }
        "length" => {
            let a = js_num(Some(arg));
            let b = js_num(p.get("length"));
            let l = if a != 0.0 && !a.is_nan() { a } else if b != 0.0 && !b.is_nan() { b } else { 120.0 };
            let r = if truthy(p.get("gaps")) { raw_len(l) } else { l };
            (format!("길이를 {}", with_ro(&fmt_len(l))), format!("길이를 완성 약 {} 맞춰 줘. 남길 범위를 합쳐 약 {}({}~{})가 되게, 흐름은 유지하고 덜 중요한 부분부터 빼거나 바로 앞뒤에서 더해 줘.", with_ro(&fmt_len(l)), fmt_len(r), fmt_len(r - 10.0), fmt_len(r + 10.0)))
        }
        "tight" => ("늘어지지 않게".into(), "늘어지지 않게 다시 다듬어 줘. 되풀이하는 말, 늘어지는 예화·설명, 곁가지를 빼서 핵심이 힘 있게 이어지게. 결론은 남겨 줘.".into()),
        "filler" => ("군말·반복 빼기".into(), "\"그…\", \"어…\", \"음…\" 같은 말 끄는 소리, 더듬기, 같은 말 반복을 남김없이 빼 줘. 빼고 나서도 문장이 자연스럽게 이어지게.".into()),
        "questions" => ("질문·대답 빼기".into(), "회중에게 묻는 말과 그 대답, 물음표로 끝나는 문장을 모두 빼 줘. 질문을 빼서 어색해진 대답 조각도 빼 줘.".into()),
        "notices" => ("진행 안내 빼기".into(), "예배 진행 안내 말(\"마무리하겠습니다\", \"성경 보시면\" 등)을 빼 줘.".into()),
        "shorter" => ("더 짧게".into(), "20초쯤 더 짧게 줄여 줘. 덜 중요한 설명부터 빼고 결론은 남겨 줘.".into()),
        "longer" => ("더 길게".into(), "20초쯤 더 길게 해 줘. 바로 앞뒤에서 흐름에 필요한 말을 더해 줘.".into()),
        "ending" => ("결론으로 끝내기".into(), "마지막을 힘 있는 결론이나 축복의 말로 끝나게 해 줘.".into()),
        "title" => ("제목 다시".into(), "제목을 다시 지어 줘. 구간은 그대로 둡니다.".into()),
        "typos" => ("자막 오타 고치기".into(), "남긴 부분 자막에서 틀린 글자(교회 용어·고유명사·맞춤법)만 고쳐 줘. 구간은 그대로 둡니다.".into()),
        _ => return None,
    })
}

/// 남길 범위의 대략 길이(초)
pub fn ranges_duration(ranges: &[Range], words: &[SubWord]) -> f64 { ranges.iter().map(|r| words[r.to].end - words[r.from].start + 0.25).sum() }

/// 현재 편집을 AI 에게 보여 줄 짧은 요약
pub fn describe_ranges(ranges: &[Range], words: &[SubWord]) -> Vec<(usize, usize, String)> {
    ranges.iter().map(|r| {
        let s = (r.from..=r.to).map(|k| words[k].text.as_str()).collect::<Vec<_>>().join(" ");
        let s = if js_len(&s) > 160 { format!("{} … {}", js_slice(&s, 0, 70), js_tail(&s, 70)) } else { s };
        (r.from, r.to, s)
    }).collect()
}

/// 남긴 부분 안의 물음표 문장
pub fn questions_in(ranges: &[Range], words: &[SubWord]) -> Vec<String> {
    let mut out = vec![];
    for r in ranges {
        let mut buf: Vec<&str> = vec![];
        for w in &words[r.from..=r.to] {
            buf.push(&w.text);
            if w.text.ends_with(['?', '？']) { out.push(buf[buf.len().saturating_sub(6)..].join(" ")); buf.clear(); }
            else if w.text.ends_with(['.', '!', '。']) { buf.clear(); }
        }
    }
    out
}

/// 위스퍼 단어 → 대화용 단어·줄 (문장 끝·0.7초 넘는 쉼·16단어마다 끊는다)
pub fn whisper_words_to_lines(raw: &[Value]) -> (Vec<SubWord>, Vec<SubLine>) {
    let mut words: Vec<SubWord> = vec![];
    for w in raw {
        let text = if truthy(w.get("text")) { js_string(w.get("text")) } else { String::new() };
        let text = text.split(js_ws).filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ");
        let (Some(st), Some(en)) = (w.get("start").and_then(|v| v.as_f64()), w.get("end").and_then(|v| v.as_f64())) else { continue };
        if text.is_empty() { continue; }
        words.push(SubWord { text, start: st, end: en.max(st + 0.05) });
    }
    let mut lines = vec![];
    let mut from = 0;
    for i in 0..words.len() {
        let next = words.get(i + 1);
        let brk = next.is_none() || words[i].text.ends_with(['.', '?', '!', '。', '？', '！']) || next.is_some_and(|n| n.start - words[i].end > 0.7) || i - from + 1 >= 16;
        if brk { lines.push(SubLine { start: words[from].start, from, to: i }); from = i + 1; }
    }
    (words, lines)
}
