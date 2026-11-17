//! 제미나이로 하는 AI 기능 (기존 src/main/ai.js): AI 쇼츠 추천(설교 찾기·후보 고르기), AI 용어 교정.
//! 키는 설정(암호화) 또는 환경변수 GEMINI_API_KEY 에서 읽고, 절대 기록하거나 돌려주지 않는다.
use serde_json::{json, Value};

pub const DEFAULT_MODEL: &str = "gemini-3.5-flash";

/// 제미나이 구조화 응답 (기존 callGemini) → (JSON, usageMetadata).
/// 시험(SS_TEST_GEMINI_ANSWERS = 답 목록 JSON 파일)에서는 돈 드는 호출 없이 차례로 꺼낸다
pub fn call_gemini(key: &str, model: &str, system: &str, prompt: &str, schema: Option<&Value>, temperature: f64, thinking: &str) -> Result<(Value, Value), String> {
    let mut body = json!({
        "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
        "generationConfig": { "temperature": temperature, "responseMimeType": "application/json", "thinkingConfig": { "thinkingLevel": thinking } },
    });
    if let Some(s) = schema { body["generationConfig"]["responseSchema"] = s.clone(); }
    if !system.is_empty() { body["systemInstruction"] = json!({ "parts": [{ "text": system }] }); }
    let data = if let Ok(p) = std::env::var("SS_TEST_GEMINI_ANSWERS") {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let list: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(&p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let i = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let _ = std::fs::write(std::env::temp_dir().join(format!("ss_gemini_sent{i}.json")), body.to_string());
        std::thread::sleep(std::time::Duration::from_millis(400));
        let a = list.get(i).cloned().ok_or("시험 답이 더 없습니다")?;
        json!({ "candidates": [{ "content": { "parts": [{ "text": a.as_str().map(String::from).unwrap_or_else(|| a.to_string()) }] } }], "usageMetadata": { "promptTokenCount": 1000, "candidatesTokenCount": 100 } })
    } else {
        if key.is_empty() { return Err("AI 키가 없습니다. 설정에서 Gemini API 키를 입력하세요.".into()); }
        let (st, data) = crate::llm::gemini::generate(key, model, &body)?;
        if !(200..300).contains(&st) { return Err(format!("Gemini 오류 {st}: {}", data["error"]["message"].as_str().unwrap_or(""))); }
        data
    };
    let text: String = data["candidates"][0]["content"]["parts"].as_array().map(|ps| ps.iter().map(|p| p["text"].as_str().unwrap_or("")).collect()).unwrap_or_default();
    let j: Value = serde_json::from_str(&text).map_err(|e| format!("AI 답을 읽지 못했습니다: {e}"))?;
    Ok((j, data["usageMetadata"].clone()))
}

fn fmt(sec: f64) -> String {
    let sec = crate::chat_plan::js_round(sec).max(0.0) as i64;
    let (h, m, s) = (sec / 3600, (sec % 3600) / 60, sec % 60);
    format!("{}:{s:02}", if h > 0 { format!("{h}:{m:02}") } else { m.to_string() })
}

/// 자막 줄을 8초 남짓 덩어리로: "[14:30] 글" (토큰을 아끼고, 구간 고르기에는 이 시각이면 된다)
pub fn compact_transcript(lines: &[(f64, String)], block_sec: f64) -> String {
    let mut out: Vec<(f64, String)> = vec![];
    let mut cur: Option<(f64, String)> = None;
    for (start, text) in lines {
        let t = text.split(|c: char| c.is_whitespace() || c == '\u{feff}').filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ");
        if t.is_empty() { continue; }
        match &mut cur {
            Some(c) if start - c.0 < block_sec => { c.1.push(' '); c.1.push_str(&t); }
            _ => { if let Some(c) = cur.take() { out.push(c); } cur = Some((*start, t)); }
        }
    }
    if let Some(c) = cur { out.push(c); }
    out.iter().map(|(s, t)| format!("[{}] {t}", fmt(*s))).collect::<Vec<_>>().join("\n")
}

/// 추천 조건 표 (화면과 프롬프트가 같은 표를 쓴다)
pub const CONTENT_TYPES: [(&str, &str); 8] = [
    ("core", "설교의 핵심 메시지(결론, 오늘 한 문장)"), ("story", "예화·실제 이야기(설교자 경험, 사람 이야기)"), ("exposition", "본문 해설(성경 배경, 원어, 의미 풀이)"),
    ("application", "삶의 적용(일상에서 무엇을 할지)"), ("comfort", "위로와 격려(고난, 낙심한 사람에게)"), ("challenge", "도전과 결단(회개, 순종 촉구)"),
    ("gospel", "복음 제시(십자가, 은혜, 구원)"), ("prayer", "기도와 축복의 말"),
];
pub const INTENSITY: [&str; 6] = ["", "아주 잔잔하게: 조용한 묵상, 따뜻한 위로의 어조", "잔잔한 편: 차분히 설명하고 다독이는 어조", "균형: 차분함과 힘이 섞인 보통의 설교 어조", "힘 있는 편: 확신 있게 선포하고 질문을 던지는 어조", "아주 강렬하게: 목소리가 고조되고 강하게 도전·선포하는 절정 부분"];
pub const AUDIENCE: [(&str, &str); 4] = [("all", "일반 시청자 누구나"), ("members", "교회 성도"), ("seekers", "교회에 다니지 않는 사람, 새신자(교회 용어를 모르는 사람)"), ("youth", "청년·청소년")];

pub fn build_system(church: &str, terms: &str) -> String {
    let terms = terms.trim();
    format!("너는 {}의 설교 쇼츠 편집자다.
예배 영상 자동 자막을 읽고 설교 부분을 찾은 뒤, 유튜브 쇼츠로 만들 구간을 사용자가 정한 조건에 맞게 고른다.
교회 용어 예: 하나님, 예수님, 성령, 말씀{}.
항상 지킬 기준:
1. 앞뒤 맥락 없이 혼자 들어도 이해되는 한 덩어리 이야기.
2. 첫 문장이 귀를 붙잡는다(질문, 강한 주장, 이야기의 시작). \"자, 그리고, 그래서, 그러니까\"로 시작하지 않는다.
3. 생각이 완결되는 문장에서 끝난다. 문장 중간에서 끊지 않는다.
4. 광고, 찬양, 기도 인도, 성경 봉독만 있는 부분, 회중 소음은 제외한다.
5. 설교자의 뜻을 바꾸거나 과장하지 않는다. 쇼츠 제목은 설교 문장에서 따온 표현을 우선한다.
자동 자막에는 오타가 많다. 시간은 [분:초] 표시를 기준으로 초 단위 숫자로 답한다.", if church.is_empty() { "교회" } else { church }, if terms.is_empty() { String::new() } else { format!(", {terms}") })
}

pub fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "sermon": { "type": "object", "properties": {
                "start": { "type": "number", "description": "설교 시작 (초)" },
                "end": { "type": "number", "description": "설교 끝 (초), 설교 후 통성기도 전까지" },
                "title": { "type": "string", "description": "설교 제목 (설교자가 말한 제목, 없으면 추정)" },
                "scripture": { "type": "string", "description": "본문, 약어 형식 예: 행 5:27-32, 마 6:5-13" },
                "mainMessage": { "type": "string", "description": "설교 핵심 메시지 한 문장" } },
                "required": ["start", "end", "title", "scripture", "mainMessage"] },
            "candidates": { "type": "array", "items": { "type": "object", "properties": {
                "start": { "type": "number" }, "end": { "type": "number" },
                "shortsTitle": { "type": "string", "description": "쇼츠 화면 상단 제목, 15자 안팎" },
                "firstSentence": { "type": "string" }, "lastSentence": { "type": "string" },
                "reason": { "type": "string", "description": "추천 이유 1~2문장, 요청 조건과 어떻게 맞는지 포함" },
                "types": { "type": "array", "items": { "type": "string", "enum": CONTENT_TYPES.iter().map(|x| x.0).collect::<Vec<_>>() }, "description": "이 구간의 내용 유형" },
                "intensity": { "type": "number", "description": "이 구간의 실제 강도 1~5" },
                "score": { "type": "number", "description": "조건 적합도와 쇼츠 품질을 합한 점수 1~10" } },
                "required": ["start", "end", "shortsTitle", "firstSentence", "lastSentence", "reason", "types", "intensity", "score"] } },
        },
        "required": ["sermon", "candidates"],
    })
}

/// 추천 조건 (기존 analyzeSermon opts)
#[derive(Clone, Debug)]
pub struct RecOpts { pub video_title: String, pub description: String, pub model: String, pub church: String, pub count: i64, pub min_sec: i64, pub max_sec: i64, pub intensity: i64, pub types: Vec<String>, pub audience: String, pub extra: String }
impl Default for RecOpts {
    fn default() -> Self { RecOpts { video_title: String::new(), description: String::new(), model: String::new(), church: String::new(), count: 4, min_sec: 60, max_sec: 120, intensity: 3, types: vec![], audience: "all".into(), extra: String::new() } }
}

fn utf16_head(s: &str, n: usize) -> String { let u: Vec<u16> = s.encode_utf16().collect(); String::from_utf16_lossy(&u[..n.min(u.len())]) }

/// 추천 요청 글 (기존 analyzeSermon 의 prompt)
pub fn analyze_prompt(lines: &[(f64, String)], o: &RecOpts) -> String {
    let transcript = compact_transcript(lines, 8.0);
    let aud = AUDIENCE.iter().find(|a| a.0 == o.audience).map(|a| a.1).unwrap_or(AUDIENCE[0].1);
    let types: Vec<&str> = o.types.iter().filter_map(|t| CONTENT_TYPES.iter().find(|c| c.0 == t).map(|c| c.1)).collect();
    let cond: Vec<String> = [
        format!("- 개수: {}개 (서로 겹치지 않게, 점수 높은 순)", o.count),
        format!("- 길이: 각 {}~{}초", o.min_sec, o.max_sec),
        if o.intensity != 0 { format!("- 강도: {}/5 = {}. 이 강도에 가까운 구간을 우선한다.", o.intensity, INTENSITY.get(o.intensity as usize).copied().unwrap_or("undefined")) } else { "- 강도: 상관없음".into() },
        if !o.types.is_empty() { format!("- 원하는 내용: {}. 이 유형이 중심인 구간을 우선한다.", types.join(", ")) } else { "- 원하는 내용: 상관없음(설교 핵심이 잘 드러나는 곳)".into() },
        format!("- 대상: {aud}{}", if o.audience == "seekers" { ". 교회 안에서만 통하는 말이 적고 처음 듣는 사람도 이해되는 구간을 우선한다." } else { "" }),
        if o.extra.is_empty() { String::new() } else { format!("- 추가 요청: {}", o.extra) },
    ].into_iter().filter(|x| !x.is_empty()).collect();
    format!("영상 제목: {}
영상 설명: {}

[추천 조건]
{}
조건에 딱 맞는 구간이 부족하면 가장 가까운 구간을 고르되 reason에 무엇이 다른지 적는다.

아래는 예배 영상 전체의 자동 자막이다. 설교 구간을 찾고, 그 안에서 조건에 맞는 쇼츠 후보를 골라라.

{transcript}", o.video_title, utf16_head(&o.description, 500), cond.join("\n"))
}

/// AI 쇼츠 추천 (기존 analyzeSermon): { sermon, candidates(점수 높은 순), usage, model }
pub fn analyze_sermon(key: &str, terms: &str, lines: &[(f64, String)], o: &RecOpts) -> Result<Value, String> {
    let model = if o.model.is_empty() { DEFAULT_MODEL.to_string() } else { o.model.clone() };
    let (mut j, usage) = call_gemini(key, &model, &build_system(&o.church, terms), &analyze_prompt(lines, o), Some(&schema()), 0.4, "medium")?;
    let mut cands = j["candidates"].as_array().cloned().unwrap_or_default();
    cands.sort_by(|a, b| b["score"].as_f64().unwrap_or(0.0).partial_cmp(&a["score"].as_f64().unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal));
    j["candidates"] = json!(cands);
    j["usage"] = usage;
    j["model"] = json!(model);
    Ok(j)
}

/// 용어 교정 요청 글 (기존 correctTerms 의 prompt). words: [(id, text)]
pub fn correct_prompt(words: &[(i64, String)], title: &str, scripture: &str) -> String {
    let arr: Vec<Value> = words.iter().map(|(i, t)| json!({ "id": i, "text": t })).collect();
    format!("설교 제목: {title}\n본문: {scripture}\n\n다음 단어들의 띄어쓰기, 배열 등은 건드리지 말고 오로지 '교회/성경 용어, 고유명사, 그리고 명백한 오타'만 수정하라.\n{}", serde_json::to_string(&arr).unwrap_or_default())
}
pub const CORRECT_SYSTEM: &str = "너는 오타 교정기다. 주어진 단어 배열(id, text)에서 명백한 오타나 잘못 인식된 기독교 용어만 수정하여 동일한 id와 수정된 text의 배열로 반환한다. 구조나 단어 개수는 절대 바꾸지 마라.";

/// AI 용어 교정 (기존 correctTerms) → [(id 글자, 고친 글)]
pub fn correct_terms(key: &str, model: &str, words: &[(i64, String)], title: &str, scripture: &str) -> Result<Vec<(String, String)>, String> {
    let schema = json!({ "type": "array", "items": { "type": "object", "properties": { "id": { "type": "string" }, "text": { "type": "string" } }, "required": ["id", "text"] } });
    let (j, _) = call_gemini(key, if model.is_empty() { DEFAULT_MODEL } else { model }, CORRECT_SYSTEM, &correct_prompt(words, title, scripture), Some(&schema), 0.1, "medium")?;
    Ok(j.as_array().into_iter().flatten().filter_map(|c| {
        let id = match &c["id"] { Value::String(s) => s.clone(), Value::Number(n) => n.to_string(), _ => return None };
        Some((id, c["text"].as_str()?.to_string()))
    }).collect())
}

// ---------------- 후보 → 실제 단어 (기존 onSelectCandidate) ----------------
fn norm(t: &str) -> Vec<char> { t.chars().filter(|c| !(c.is_whitespace() || ".,!?~…\"'“”‘’·:;()[]-".contains(*c))).collect() }
fn dice(x: &[char], y: &[char]) -> f64 {
    if x.len() < 2 || y.len() < 2 { return if x == y { 1.0 } else { 0.0 }; }
    let mut a: std::collections::HashMap<(char, char), i64> = Default::default();
    for w in x.windows(2) { *a.entry((w[0], w[1])).or_default() += 1; }
    let mut b: std::collections::HashMap<(char, char), i64> = Default::default();
    for w in y.windows(2) { *b.entry((w[0], w[1])).or_default() += 1; }
    let inter: i64 = a.iter().map(|(g, n)| (*n).min(*b.get(g).unwrap_or(&0))).sum();
    2.0 * inter as f64 / ((x.len() - 1 + y.len() - 1) as f64)
}
/// 후보의 첫 문장·끝 문장을 실제 단어와 맞춰 문장 경계 찾기 (자동 자막 시각은 대략적이라 ±10초 안에서). words: (글, 시작, 끝) 원본 시각
pub fn match_candidate(words: &[(String, f64, f64)], start: f64, end: f64, first: &str, last: &str) -> Option<(usize, usize)> {
    if words.is_empty() { return None; }
    let (first, last) = (norm(first), norm(last));
    let (mut si, mut ei, mut best): (i64, i64, f64) = (-1, -1, -1.0);
    for i in 0..words.len() {
        if (words[i].1 - start).abs() > 10.0 { continue; }
        let mut t: Vec<char> = vec![];
        let mut k = i;
        while k < words.len() && t.len() < first.len() { t.extend(norm(&words[k].0)); k += 1; }
        let sc = dice(&t[..first.len().min(t.len())], &first);
        if sc > best { best = sc; si = i as i64; }
    }
    if best < 0.35 { si = words.iter().position(|w| w.1 >= start - 1.0).map(|x| x as i64).unwrap_or(-1); }
    best = -1.0;
    for j in (0..words.len()).rev() {
        if (words[j].2 - end).abs() > 10.0 || (j as i64) < si { continue; }
        let mut t: Vec<char> = vec![];
        let mut k = j as i64;
        while k >= 0 && t.len() < last.len() { let mut n = norm(&words[k as usize].0); n.extend(t); t = n; k -= 1; }
        let tail = &t[t.len().saturating_sub(last.len())..];
        let sc = dice(tail, &last);
        if sc > best { best = sc; ei = j as i64; }
    }
    if best < 0.35 { ei = -1; for j in (0..words.len()).rev() { if words[j].2 <= end + 1.0 { ei = j as i64; break; } } }
    if si < 0 { si = 0; }
    if ei < si { ei = words.len() as i64 - 1; }
    Some((si as usize, ei as usize))
}
