//! 설교로 교인 배포 자료 만들기 (기존 src/shared/materials.js): 종류·선택지·AI 지시문·답 읽기·글로 바꾸기·홈페이지 글·충실도 검사.
//! 설교 요약 / 소그룹 자료 / QT 자료 / 성경 퀴즈 / 묵상카드 / 가정예배지 / 카드뉴스 / 소그룹 리더 가이드 / 설교 PPT.
//! AI 는 설교에 있는 내용만 쓰고, 성경 본문은 장절 표기와 설교에서 직접 읽은 문장만 쓴다.
use crate::chat_plan::{js_len, js_num, js_slice, js_string, js_trim, js_ws, truthy};
use serde_json::{json, Map, Value};

pub struct TypeInfo { pub id: &'static str, pub label: &'static str, pub icon: &'static str, pub desc: &'static str, pub kind: &'static str }
pub const TYPES: [TypeInfo; 9] = [
    TypeInfo { id: "smallgroup", label: "소그룹 자료", icon: "users", desc: "마음 열기 · 나눔 질문 · 이번 주 실천", kind: "page" },
    TypeInfo { id: "qt", label: "QT 자료", icon: "book-marked", desc: "날마다 본문 · 묵상 · 질문 · 기도", kind: "page" },
    TypeInfo { id: "quiz", label: "성경 퀴즈", icon: "circle-help", desc: "OX · 객관식 문제와 해설", kind: "page" },
    TypeInfo { id: "summary", label: "설교 요약", icon: "file-text", desc: "핵심 한 문장 · 대지 요약 · 적용", kind: "page" },
    TypeInfo { id: "cards", label: "묵상카드", icon: "images", desc: "SNS·카톡용 말씀 카드 이미지", kind: "cards" },
    TypeInfo { id: "family", label: "가정예배지", icon: "house", desc: "가족이 함께 드리는 예배 순서", kind: "page" },
    TypeInfo { id: "cardnews", label: "카드뉴스", icon: "gallery-horizontal-end", desc: "인스타용 여러 장 · 표지 · 핵심 · 이번 주 실천", kind: "cards" },
    TypeInfo { id: "leader", label: "소그룹 리더 가이드", icon: "user-check", desc: "진행 순서·시간 · 질문 의도·예상 답", kind: "page" },
    TypeInfo { id: "slides", label: "설교 PPT", icon: "presentation", desc: "예배 화면용 16:9 슬라이드 · PPT 저장", kind: "slides" },
];
pub fn type_of(id: &str) -> Option<&'static TypeInfo> { TYPES.iter().find(|t| t.id == id) }

/// 선택지 (키, 이름, 값들)
pub fn options() -> Vec<(&'static str, &'static str, Vec<Value>)> {
    let s = |v: &[&str]| v.iter().map(|x| json!(x)).collect::<Vec<_>>();
    let n = |v: &[i64]| v.iter().map(|x| json!(x)).collect::<Vec<_>>();
    vec![
        ("audience", "대상", s(&["장년", "청년", "청소년", "어린이", "유아·유치"])),
        ("smallgroup", "소그룹 자료", s(&["나눔형", "공부형"])),
        ("qtDays", "QT 일수", n(&[1, 2, 3, 4, 5, 6, 7])),
        ("qtFocus", "QT 본문", s(&["본문 중심", "확장 묵상", "혼합형"])),
        ("qtForm", "QT 형식", s(&["기본형", "묵상형", "적용형"])),
        ("quiz", "성경 퀴즈", s(&["OX", "객관식", "혼합형"])),
        ("summary", "설교 요약", s(&["짧게", "보통", "길게"])),
        ("cardTone", "묵상카드", s(&["말씀 중심", "위로", "도전", "적용", "초청"])),
        ("cardCount", "카드 장수", n(&[1, 2, 3, 4, 5, 6, 7])),
        ("newsCount", "카드뉴스 장수", n(&[4, 5, 6, 7, 8])),
        ("leaderTime", "모임 시간", n(&[30, 45, 60, 90])),
        ("slideCount", "슬라이드 수", n(&[4, 6, 8, 10, 12])),
    ]
}
pub fn defaults() -> Value { json!({ "audience": "장년", "smallgroup": "나눔형", "qtDays": 5, "qtFocus": "혼합형", "qtForm": "묵상형", "quiz": "혼합형", "summary": "보통", "cardTone": "말씀 중심", "cardCount": 3, "newsCount": 6, "leaderTime": 60, "slideCount": 8 }) }
fn same(a: &Value, b: &Value) -> bool { match (a, b) { (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(), _ => a == b } }
/// 선택지 다듬기 (목록에 없는 값은 기본값)
pub fn norm_options(o: &Value) -> Value {
    let d = defaults();
    let mut out = Map::new();
    for (k, _, values) in options() {
        let v = o.get(k).filter(|v| values.iter().any(|x| same(x, v))).cloned().unwrap_or_else(|| d[k].clone());
        out.insert(k.into(), v);
    }
    Value::Object(out)
}
fn os(o: &Value, k: &str) -> String { match &o[k] { Value::String(s) => s.clone(), v => js_string(Some(v)) } }

fn audience_tone(a: &str) -> &'static str {
    match a {
        "장년" => "교회 장년 성도가 읽기 좋은 차분한 존댓말", "청년" => "청년부가 공감할 수 있는 담백하고 생활에 가까운 존댓말",
        "청소년" => "중고등부 학생이 이해하기 쉬운 짧은 문장과 친근한 존댓말, 학교·친구 같은 생활 예", "어린이" => "초등학생이 이해할 수 있는 아주 쉬운 낱말과 짧은 문장, 다정한 존댓말",
        "유아·유치" => "유치부 아이와 부모가 함께 읽을 아주 짧고 쉬운 말, 반복과 따라 하기", _ => "",
    }
}
pub const RULES: [&str; 6] = [
    "아래 [설교]에 실제로 있는 내용과 흐름만 씁니다. 설교에 없는 예화·통계·인용을 지어내지 않습니다.",
    "[설교]는 자동 자막이라 띄어쓰기·맞춤법·교회 용어가 틀릴 수 있습니다. 문맥에 맞게 바로잡아 씁니다.",
    "성경은 \"로마서 1:16-17\"처럼 장절로만 적습니다. 성경 본문 문장을 새로 만들거나 번역본 본문을 길게 옮기지 않습니다. 설교자가 직접 읽은 구절 한두 문장만 인용할 수 있습니다.",
    "교단·교회 이름·설교자 이름은 주어진 대로 씁니다.",
    "모든 글은 한국어로, 인쇄·카톡 공유에 알맞게 짧고 분명하게 씁니다.",
    "답은 설명 없이 요청한 JSON 하나만 씁니다. 문자열 안 줄바꿈은 \\n 으로.",
];

/// 공통 시스템 지시문. ctx: { church, title, verse, speaker, date, options, sermon }
pub fn build_system(ctx: &Value) -> String {
    let o = norm_options(&ctx["options"]);
    let mut lines: Vec<String> = vec!["당신은 한국 교회의 목회 자료 편집자입니다. 주일 설교를 바탕으로 성도들에게 나눠 줄 자료를 만듭니다.".into(), String::new(), "[설교 정보]".into()];
    let t = |k: &str| truthy(ctx.get(k));
    if t("church") { lines.push(format!("- 교회: {}", js_string(ctx.get("church")))); }
    if t("title") { let s = js_string(ctx.get("title")).replace('*', ""); lines.push(format!("- 설교 제목: {}", regex::Regex::new(r"\s+/\s+").unwrap().replace_all(&s, " "))); }
    if t("verse") { lines.push(format!("- 본문: {}", js_string(ctx.get("verse")))); }
    if t("speaker") { lines.push(format!("- 설교자: {}", js_string(ctx.get("speaker")))); }
    if t("date") { lines.push(format!("- 날짜: {}", js_string(ctx.get("date")))); }
    let a = os(&o, "audience");
    lines.push(format!("- 대상: {a} ({})", audience_tone(&a)));
    lines.push(String::new()); lines.push("[원칙]".into());
    for (i, r) in RULES.iter().enumerate() { lines.push(format!("{}. {r}", i + 1)); }
    lines.push(String::new()); lines.push("[설교]".into());
    let sermon = if truthy(ctx.get("sermon")) { js_string(ctx.get("sermon")) } else { String::new() };
    lines.push(js_slice(js_trim(&sermon), 0, 60000));
    lines.join("\n")
}

/// 종류별 요청 (JSON 모양 포함)
pub fn build_request(ty: &str, options: &Value) -> Result<String, String> {
    let o = norm_options(options);
    let g = |k: &str| os(&o, k);
    let n = |k: &str| o[k].as_i64().unwrap_or(0);
    Ok(match ty {
        "summary" => {
            let s = g("summary");
            let amt = match s.as_str() { "짧게" => "대지 2개, 각 2~3문장", "길게" => "대지 3~4개, 각 5~6문장", _ => "대지 3개, 각 3~4문장" };
            format!("설교 요약을 만들어 주세요. 분량: {s} ({amt}).\nJSON: {{\"title\":\"설교 제목\",\"verse\":\"본문 장절\",\"theme\":\"설교의 핵심을 한 문장으로\",\"points\":[{{\"heading\":\"대지 제목(짧게)\",\"body\":\"대지 내용\"}}],\"application\":\"이번 주 삶의 적용 2~3문장\",\"prayer\":\"짧은 기도문\"}}")
        }
        "smallgroup" => {
            let how = if g("smallgroup") == "공부형" { "공부형: 본문 관찰(무엇이 쓰여 있나) → 해석(무슨 뜻인가) → 적용(내 삶에) 순서의 질문, 질문마다 리더를 위한 짧은 도움말(note)" } else { "나눔형: 마음을 여는 생활 질문 → 설교 핵심을 되새기는 질문 → 내 삶을 나누는 질문, 정답보다 경험을 나누게" };
            format!("소그룹(셀·구역) 나눔 자료를 만들어 주세요. 형식: {how}. 질문은 5~6개.\nJSON: {{\"title\":\"자료 제목\",\"verse\":\"본문 장절\",\"summary\":\"설교 요약 3~4문장\",\"icebreaker\":\"마음 열기 질문 1개\",\"questions\":[{{\"q\":\"질문\",\"note\":\"리더 도움말(없으면 빈 글)\"}}],\"action\":\"이번 주 함께 실천할 것\",\"prayer\":\"함께 드리는 기도\"}}")
        }
        "qt" => {
            let focus = match g("qtFocus").as_str() { "본문 중심" => "설교 본문과 그 앞뒤 문맥을 나누어 날마다 읽게", "확장 묵상" => "설교 주제와 이어지는 다른 성경 본문으로 넓혀서", _ => "앞쪽은 설교 본문, 뒤쪽은 주제와 이어지는 다른 본문으로" };
            let form = match g("qtForm").as_str() { "기본형" => "본문 · 묵상 · 질문 · 기도", "적용형" => "오늘 실천할 구체적인 행동 한 가지를 꼭", _ => "묵상 글을 조금 길게(4~5문장), 마음에 새길 한 문장" };
            format!("{}일치 QT(큐티) 자료를 만들어 주세요. 본문 고르기: {focus}. 형식: {form}.\n성경 본문은 장절만 적고(본문 문장은 쓰지 않음), 날마다 실제로 있는 짧은 범위(5~12절)로 고릅니다.\nJSON: {{\"title\":\"QT 제목\",\"days\":[{{\"day\":1,\"title\":\"그날의 제목\",\"passage\":\"성경 장절\",\"meditation\":\"묵상\",\"keyline\":\"마음에 새길 한 문장\",\"question\":\"묵상 질문\",\"action\":\"오늘의 실천(없으면 빈 글)\",\"prayer\":\"짧은 기도\"}}]}}", n("qtDays"))
        }
        "quiz" => {
            let kind = match g("quiz").as_str() { "OX" => "모두 OX 문제", "객관식" => "모두 4지선다 객관식", _ => "OX와 4지선다를 섞어서" };
            format!("설교 내용과 본문으로 성경 퀴즈 8문제를 만들어 주세요({kind}). 설교를 잘 들었으면 풀 수 있게, 답은 설교와 본문에서 분명한 것으로.\nOX 는 \"type\":\"ox\", \"answer\":\"O\" 또는 \"X\". 객관식은 \"type\":\"mc\", \"choices\" 4개, \"answer\" 는 정답 번호(1~4).\nJSON: {{\"title\":\"퀴즈 제목\",\"items\":[{{\"type\":\"ox\",\"q\":\"문제\",\"answer\":\"O\",\"explain\":\"해설 한 문장\"}},{{\"type\":\"mc\",\"q\":\"문제\",\"choices\":[\"\",\"\",\"\",\"\"],\"answer\":2,\"explain\":\"해설\"}}]}}")
        }
        "cards" => format!("묵상카드 {}장의 글을 만들어 주세요. 분위기: {}. 카드마다 설교의 서로 다른 핵심을 담습니다.\nheadline 은 크게 보일 한 문장(공백 포함 24자 이내), body 는 풀어 쓴 1~2문장(60자 이내), source 는 근거(성경 장절 또는 \"설교: 제목\").\n인스타그램 본문 caption 은 2~4문장(200자 이내, 설교 내용으로), hashtags 는 5~8개(# 로 시작, 띄어쓰기 없이, 예: #주일설교 #말씀묵상 #본문장절 같은 것. 설교자·성도 등 사람 이름은 넣지 않음).\nJSON: {{\"cards\":[{{\"headline\":\"\",\"body\":\"\",\"source\":\"\"}}],\"caption\":\"\",\"hashtags\":[\"#\"]}}", n("cardCount"), g("cardTone")),
        "family" => "가정예배지를 만들어 주세요. 부모와 자녀가 15분 안에 함께 드릴 수 있게, 아이도 알아듣는 쉬운 말로.\nJSON: {\"title\":\"제목\",\"verse\":\"본문 장절\",\"opening\":\"함께 부를 찬송·찬양 제목 제안(널리 알려진 곡 1~2개)\",\"story\":\"부모가 읽어 줄 말씀 이야기 5~7문장\",\"questions\":[\"가족이 나눌 질문 2~3개\"],\"activity\":\"함께 해 볼 활동이나 실천\",\"prayer\":\"가족 기도문\",\"blessing\":\"마치는 축복의 말 한 문장\"}".into(),
        "cardnews" => {
            let c = n("newsCount"); let body = c - 2;
            format!("인스타그램 카드뉴스 {c}장의 글을 만들어 주세요. 1장은 표지, 가운데 {body}장은 설교의 핵심을 흐름대로 하나씩, 마지막 장은 \"이번 주 실천\"입니다.\n표지 title 은 공백 포함 18자 이내로 크게 보일 제목, subtitle 은 한 줄(30자 이내). slides 는 정확히 {body}개: heading 은 16자 이내, body 는 2~3문장(90자 이내), highlight 는 꼭 채웁니다: body 안에 글자 그대로 들어 있는 가장 중요한 구절(6~20자, body 에서 복사해 붙인 것처럼 똑같이).\naction 은 이번 주에 해 볼 구체적인 실천 한 문장(40자 이내), closing 은 마무리 한 문장.\n인스타그램 본문 caption 은 2~4문장(200자 이내, 설교 내용으로), hashtags 는 5~8개(# 로 시작, 띄어쓰기 없이, 예: #주일설교 #말씀묵상 #본문장절 같은 것. 설교자·성도 등 사람 이름은 넣지 않음).\nJSON: {{\"title\":\"\",\"subtitle\":\"\",\"verse\":\"본문 장절\",\"slides\":[{{\"heading\":\"\",\"body\":\"\",\"highlight\":\"\"}}],\"action\":\"\",\"closing\":\"\",\"caption\":\"\",\"hashtags\":[\"#\"]}}")
        }
        "leader" => {
            let m = n("leaderTime");
            format!("소그룹 리더용 진행 가이드를 만들어 주세요. 모임 시간은 {m}분입니다. 리더가 미리 읽고 모임을 이끌 수 있게, 성도용 나눔지와 달리 질문의 의도와 예상 답(설교의 어느 부분이 근거인지)을 적습니다.\nflow 는 마음 열기 → 말씀 되새기기 → 나눔 → 적용·기도 순서이고 minutes 합이 {m}분이 되게. 질문은 4~6개.\nJSON: {{\"title\":\"\",\"verse\":\"본문 장절\",\"goal\":\"이번 모임의 목표 1~2문장\",\"prepare\":\"리더가 미리 할 것(설교 다시 듣기, 본문 읽기 등)\",\"flow\":[{{\"part\":\"단계 이름\",\"minutes\":10,\"guide\":\"진행 방법 1~2문장\"}}],\"questions\":[{{\"q\":\"질문\",\"intent\":\"질문 의도\",\"expected\":\"나올 만한 답과 설교 근거\",\"followup\":\"이어 물을 질문(없으면 빈 글)\"}}],\"tips\":[\"진행 팁(말이 없는 분·말이 긴 분·어려운 질문이 나왔을 때 등) 2~4개\"],\"prayer\":\"마무리 기도\"}}")
        }
        "slides" => {
            let c = n("slideCount");
            format!("설교를 예배당 화면에 띄울 16:9 슬라이드 {c}장 분량으로 정리해 주세요. 첫 장은 제목(자동으로 만듦)이니 slides 에는 본론만 {}~{}장을 넣습니다.\n설교의 흐름(대지) 순서대로, 장마다 heading 은 18자 이내, lines 는 화면에 띄울 짧은 문장 1~3개(각 32자 이내, 말하는 그대로가 아니라 핵심만), ref 는 그 장과 관련된 성경 장절(없으면 빈 글).\nclosing 은 마지막 장에 띄울 결단·적용 한 문장(40자 이내).\nJSON: {{\"title\":\"\",\"verse\":\"본문 장절\",\"slides\":[{{\"heading\":\"\",\"lines\":[\"\"],\"ref\":\"\"}}],\"closing\":\"\"}}", c - 2, c - 1)
        }
        _ => return Err(format!("모르는 자료 종류: {ty}")),
    })
}

/// 조금 어긋난 JSON 고치기 (문자열 안 줄바꿈·탭, 똑똑한 따옴표, 끝 쉼표)
pub fn repair_json(s: &str) -> String {
    let mut out = String::new();
    let (mut in_str, mut esc) = (false, false);
    for mut c in s.chars() {
        if in_str {
            if esc { out.push(c); esc = false; continue; }
            match c { '\\' => { out.push(c); esc = true; } '"' => { in_str = false; out.push(c); } '\n' => out.push_str("\\n"), '\r' => {} '\t' => out.push_str("\\t"), _ => out.push(c) }
        } else {
            if c == '“' || c == '”' { c = '"'; }
            if c == '"' { in_str = true; }
            out.push(c);
        }
    }
    let oc: Vec<char> = out.chars().collect();
    let mut r = String::with_capacity(out.len());
    let mut i = 0;
    while i < oc.len() {
        if oc[i] == ',' { let mut j = i + 1; while j < oc.len() && js_ws(oc[j]) { j += 1; } if j < oc.len() && (oc[j] == '}' || oc[j] == ']') { r.push(oc[j]); i = j + 1; continue; } }
        r.push(oc[i]); i += 1;
    }
    r
}

/// JS: v==null ? '' : String(v).replace(/\r/g,'').trim(), max 글자(UTF-16)까지
fn sv(v: Option<&Value>, max: usize) -> String {
    let s = match v { None | Some(Value::Null) => String::new(), Some(x) => js_string(Some(x)) };
    let s = js_trim(&s.replace('\r', "")).to_string();
    if max > 0 && js_len(&s) > max { js_slice(&s, 0, max) } else { s }
}
fn av(v: Option<&Value>) -> Vec<Value> { v.and_then(|x| x.as_array()).cloned().unwrap_or_default() }
/// JS (x && x.key): x 가 거짓이면 x 그대로
fn field<'a>(x: &'a Value, k: &str) -> Option<&'a Value> { if truthy(Some(x)) { x.get(k) } else { Some(x) } }
/// JS parseInt(v, 10)
fn parse_int(v: Option<&Value>) -> Option<i64> {
    let s = match v { None | Some(Value::Null) => return None, Some(Value::Number(n)) => { let f = n.as_f64()?; if !f.is_finite() { return None; } return Some(f.trunc() as i64); } Some(x) => js_string(Some(x)) };
    let t = js_trim(&s);
    let (neg, rest) = match t.strip_prefix('-') { Some(r) => (true, r), None => (false, t.strip_prefix('+').unwrap_or(t)) };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() { return None; }
    let n: i64 = digits.parse().ok()?;
    Some(if neg { -n } else { n })
}

/// 해시태그: '#' 붙이고 띄어쓰기·기호 빼고 겹친 것 빼고 최대 10개
pub fn tags(v: &Value) -> Vec<String> {
    let list: Vec<String> = match v {
        Value::Array(a) => a.iter().map(|t| if truthy(Some(t)) { js_string(Some(t)) } else { String::new() }).collect(),
        _ => { let s = if truthy(Some(v)) { js_string(Some(v)) } else { String::new() }; s.split(|c: char| js_ws(c) || c == ',').map(String::from).collect() }
    };
    let mut out: Vec<String> = vec![];
    for t in list {
        let t: String = t.chars().filter(|c| !(js_ws(*c) || "#,.'\"!?()[]{}".contains(*c))).collect();
        let h = format!("#{t}");
        if !t.is_empty() && js_len(&t) <= 30 && !out.contains(&h) { out.push(h); }
    }
    out.truncate(10);
    out
}

/// 종류별 모양 맞추기 (빠진 칸은 빈 글)
pub fn normalize(ty: &str, o: &Value) -> Value {
    let e = json!({});
    let o = if o.is_object() || o.is_array() { o } else { &e };
    let g = |k: &str| o.get(k);
    match ty {
        "summary" => json!({ "title": sv(g("title"), 120), "verse": sv(g("verse"), 120), "theme": sv(g("theme"), 300),
            "points": av(g("points")).iter().take(6).map(|p| json!({ "heading": sv(field(p, "heading"), 80), "body": sv(field(p, "body"), 1200) })).filter(|p| p["heading"] != "" || p["body"] != "").collect::<Vec<_>>(),
            "application": sv(g("application"), 800), "prayer": sv(g("prayer"), 800) }),
        "smallgroup" => json!({ "title": sv(g("title"), 120), "verse": sv(g("verse"), 120), "summary": sv(g("summary"), 1000), "icebreaker": sv(g("icebreaker"), 300),
            "questions": av(g("questions")).iter().take(10).map(|q| if q.is_string() { json!({ "q": sv(Some(q), 400), "note": "" }) } else { json!({ "q": sv(field(q, "q"), 400), "note": sv(field(q, "note"), 400) }) }).filter(|q| q["q"] != "").collect::<Vec<_>>(),
            "action": sv(g("action"), 500), "prayer": sv(g("prayer"), 800) }),
        "qt" => json!({ "title": sv(g("title"), 120),
            "days": av(g("days")).iter().take(7).enumerate().map(|(i, d)| json!({ "day": i + 1, "title": sv(field(d, "title"), 80), "passage": sv(field(d, "passage"), 80), "meditation": sv(field(d, "meditation"), 1200), "keyline": sv(field(d, "keyline"), 200), "question": sv(field(d, "question"), 400), "action": sv(field(d, "action"), 300), "prayer": sv(field(d, "prayer"), 500) })).collect::<Vec<_>>() }),
        "quiz" => json!({ "title": sv(g("title"), 120),
            "items": av(g("items")).iter().take(20).map(|it| {
                let it = if truthy(Some(it)) { it.clone() } else { json!({}) };
                let mc = it.get("type").and_then(|v| v.as_str()) == Some("mc") || it.get("choices").and_then(|c| c.as_array()).is_some_and(|c| c.len() >= 2);
                if mc {
                    let ch: Vec<String> = av(it.get("choices")).iter().take(5).map(|c| sv(Some(c), 120)).collect();
                    let a = parse_int(it.get("answer")).filter(|a| *a >= 1 && (*a as usize) <= ch.len()).unwrap_or(1);
                    json!({ "type": "mc", "q": sv(it.get("q"), 300), "choices": ch, "answer": a, "explain": sv(it.get("explain"), 400) })
                } else {
                    let ans = if truthy(it.get("answer")) { js_string(it.get("answer")) } else { String::new() };
                    json!({ "type": "ox", "q": sv(it.get("q"), 300), "answer": if ans.to_uppercase().contains('X') { "X" } else { "O" }, "explain": sv(it.get("explain"), 400) })
                }
            }).filter(|it| it["q"] != "").collect::<Vec<_>>() }),
        "cards" => json!({ "cards": av(g("cards")).iter().take(7).map(|c| json!({ "headline": sv(field(c, "headline"), 60), "body": sv(field(c, "body"), 160), "source": sv(field(c, "source"), 80) })).filter(|c| c["headline"] != "" || c["body"] != "").collect::<Vec<_>>(),
            "caption": sv(g("caption"), 600), "hashtags": tags(g("hashtags").unwrap_or(&Value::Null)) }),
        "family" => json!({ "title": sv(g("title"), 120), "verse": sv(g("verse"), 120), "opening": sv(g("opening"), 200), "story": sv(g("story"), 2000),
            "questions": av(g("questions")).iter().take(5).map(|q| sv(Some(q), 300)).filter(|q| !q.is_empty()).collect::<Vec<_>>(), "activity": sv(g("activity"), 500), "prayer": sv(g("prayer"), 800), "blessing": sv(g("blessing"), 300) }),
        "cardnews" => json!({ "title": sv(g("title"), 60), "subtitle": sv(g("subtitle"), 80), "verse": sv(g("verse"), 80),
            "slides": av(g("slides")).iter().take(8).map(|s| { let s = if truthy(Some(s)) { s.clone() } else { json!({}) }; let b = sv(s.get("body"), 240); let h = sv(s.get("highlight"), 60); json!({ "heading": sv(s.get("heading"), 50), "highlight": if !h.is_empty() && b.contains(&h) { h } else { String::new() }, "body": b }) }).filter(|s| s["heading"] != "" || s["body"] != "").collect::<Vec<_>>(),
            "action": sv(g("action"), 120), "closing": sv(g("closing"), 160), "caption": sv(g("caption"), 600), "hashtags": tags(g("hashtags").unwrap_or(&Value::Null)) }),
        "leader" => json!({ "title": sv(g("title"), 120), "verse": sv(g("verse"), 120), "goal": sv(g("goal"), 400), "prepare": sv(g("prepare"), 400),
            "flow": av(g("flow")).iter().take(8).map(|f| { let f = if truthy(Some(f)) { f.clone() } else { json!({}) }; let m = parse_int(f.get("minutes")).filter(|m| *m > 0 && *m < 200).unwrap_or(0); json!({ "part": sv(f.get("part"), 40), "minutes": m, "guide": sv(f.get("guide"), 400) }) }).filter(|f| f["part"] != "" || f["guide"] != "").collect::<Vec<_>>(),
            "questions": av(g("questions")).iter().take(8).map(|q| { let q = if truthy(Some(q)) { q.clone() } else { json!({}) }; if q.is_string() { json!({ "q": sv(Some(&q), 300), "intent": "", "expected": "", "followup": "" }) } else { json!({ "q": sv(q.get("q"), 300), "intent": sv(q.get("intent"), 300), "expected": sv(q.get("expected"), 500), "followup": sv(q.get("followup"), 300) }) } }).filter(|q| q["q"] != "").collect::<Vec<_>>(),
            "tips": av(g("tips")).iter().take(6).map(|t| sv(Some(t), 300)).filter(|t| !t.is_empty()).collect::<Vec<_>>(), "prayer": sv(g("prayer"), 800) }),
        "slides" => json!({ "title": sv(g("title"), 80), "verse": sv(g("verse"), 80),
            "slides": av(g("slides")).iter().take(14).map(|s| { let s = if truthy(Some(s)) { s.clone() } else { json!({}) }; json!({ "heading": sv(s.get("heading"), 60), "lines": av(s.get("lines")).iter().take(4).map(|l| sv(Some(l), 80)).filter(|l| !l.is_empty()).collect::<Vec<_>>(), "ref": sv(s.get("ref"), 60) }) }).filter(|s| s["heading"] != "" || s["lines"].as_array().is_some_and(|l| !l.is_empty())).collect::<Vec<_>>(),
            "closing": sv(g("closing"), 120) }),
        _ => o.clone(),
    }
}

fn json_body(text: &str) -> Option<String> {
    let mut s = js_trim(text).to_string();
    if let Some(a) = s.find("```") {
        let mut rest = &s[a + 3..];
        if let Some(r) = rest.strip_prefix("json") { rest = r; }
        let rest = rest.trim_start_matches(js_ws);
        if let Some(b) = rest.find("```") { s = js_trim(&rest[..b]).to_string(); }
    }
    let (a, b) = (s.find('{')?, s.rfind('}')?);
    (b > a).then(|| s[a..=b].to_string())
}

/// AI 답 → 자료 데이터
pub fn parse(ty: &str, text: &str) -> Result<Value, String> {
    let Some(body) = json_body(text) else { return Err("AI 답을 읽지 못했습니다. 다시 만들어 주세요.".into()) };
    let obj: Value = serde_json::from_str(&body).or_else(|_| serde_json::from_str(&repair_json(&body))).map_err(|_| "AI 답의 형식이 잘못되었습니다. 다시 만들어 주세요.".to_string())?;
    let out = normalize(ty, &obj);
    let empty_arr = |k: &str| out[k].as_array().is_none_or(|a| a.is_empty());
    let empty = match ty {
        "cards" => empty_arr("cards"), "quiz" => empty_arr("items"), "qt" => empty_arr("days"),
        "summary" => empty_arr("points") && out["theme"] == "", "smallgroup" => empty_arr("questions"), "family" => out["story"] == "",
        "cardnews" => empty_arr("slides"), "leader" => empty_arr("questions"), "slides" => empty_arr("slides"), _ => false,
    };
    if empty { return Err("AI 답에 내용이 비어 있습니다. 다시 만들어 주세요.".into()); }
    Ok(out)
}

fn st(d: &Value, k: &str) -> String { d[k].as_str().unwrap_or("").to_string() }
fn list<'a>(d: &'a Value, k: &str) -> Vec<&'a Value> { d[k].as_array().map(|a| a.iter().collect()).unwrap_or_default() }
fn or_s(a: String, b: &str) -> String { if a.is_empty() { b.to_string() } else { a } }

/// 카톡·문자로 붙여 넣을 글
pub fn to_text(ty: &str, d: &Value, meta: &Value) -> String {
    let mut l: Vec<String> = vec![];
    if truthy(meta.get("church")) { l.push(js_string(meta.get("church"))); }
    let cap_text = |l: &mut Vec<String>| {
        let tags: Vec<String> = list(d, "hashtags").iter().map(|t| js_string(Some(t))).collect();
        if !st(d, "caption").is_empty() || !tags.is_empty() {
            l.push(String::new()); l.push("[인스타 캡션]".into());
            if !st(d, "caption").is_empty() { l.push(st(d, "caption")); }
            if !tags.is_empty() { l.push(tags.join(" ")); }
        }
    };
    let head = |l: &mut Vec<String>, t: String| l.push(format!("■ {t}"));
    match ty {
        "summary" => {
            head(&mut l, or_s(st(d, "title"), "설교 요약")); if !st(d, "verse").is_empty() { l.push(st(d, "verse")); } l.push(String::new());
            if !st(d, "theme").is_empty() { l.push(format!("“{}”", st(d, "theme"))); l.push(String::new()); }
            for (i, p) in list(d, "points").iter().enumerate() { l.push(format!("{}. {}", i + 1, st(p, "heading"))); if !st(p, "body").is_empty() { l.push(st(p, "body")); } l.push(String::new()); }
            if !st(d, "application").is_empty() { l.push(format!("[적용] {}", st(d, "application"))); l.push(String::new()); }
            if !st(d, "prayer").is_empty() { l.push(format!("[기도] {}", st(d, "prayer"))); }
        }
        "smallgroup" => {
            head(&mut l, or_s(st(d, "title"), "소그룹 나눔")); if !st(d, "verse").is_empty() { l.push(st(d, "verse")); } l.push(String::new());
            if !st(d, "summary").is_empty() { l.push(format!("[말씀 요약] {}", st(d, "summary"))); l.push(String::new()); }
            if !st(d, "icebreaker").is_empty() { l.push(format!("[마음 열기] {}", st(d, "icebreaker"))); l.push(String::new()); }
            for (i, q) in list(d, "questions").iter().enumerate() { l.push(format!("Q{}. {}", i + 1, st(q, "q"))); }
            l.push(String::new()); if !st(d, "action").is_empty() { l.push(format!("[이번 주 실천] {}", st(d, "action"))); }
            if !st(d, "prayer").is_empty() { l.push(format!("[함께 기도] {}", st(d, "prayer"))); }
        }
        "qt" => {
            head(&mut l, or_s(st(d, "title"), "QT"));
            for x in list(d, "days") {
                l.push(String::new());
                l.push(format!("{}일째 · {}{}", js_string(x.get("day")), st(x, "title"), if st(x, "passage").is_empty() { String::new() } else { format!(" ({})", st(x, "passage")) }));
                if !st(x, "meditation").is_empty() { l.push(st(x, "meditation")); }
                if !st(x, "keyline").is_empty() { l.push(format!("▶ {}", st(x, "keyline"))); }
                if !st(x, "question").is_empty() { l.push(format!("Q. {}", st(x, "question"))); }
                if !st(x, "action").is_empty() { l.push(format!("실천: {}", st(x, "action"))); }
                if !st(x, "prayer").is_empty() { l.push(format!("기도: {}", st(x, "prayer"))); }
            }
        }
        "quiz" => {
            head(&mut l, or_s(st(d, "title"), "성경 퀴즈")); l.push(String::new());
            let items = list(d, "items");
            for (i, it) in items.iter().enumerate() {
                l.push(format!("{}. {}{}", i + 1, st(it, "q"), if st(it, "type") == "ox" { " (O / X)" } else { "" }));
                if st(it, "type") == "mc" { for (k, c) in list(it, "choices").iter().enumerate() { l.push(format!("   {}) {}", k + 1, js_string(Some(c)))); } }
            }
            l.push(String::new());
            l.push(format!("[정답] {}", items.iter().enumerate().map(|(i, it)| format!("{}-{}", i + 1, js_string(it.get("answer")))).collect::<Vec<_>>().join(", ")));
        }
        "cards" => {
            for (i, c) in list(d, "cards").iter().enumerate() { if i > 0 { l.push(String::new()); } l.push(st(c, "headline")); if !st(c, "body").is_empty() { l.push(st(c, "body")); } if !st(c, "source").is_empty() { l.push(format!("- {}", st(c, "source"))); } }
            cap_text(&mut l);
        }
        "family" => {
            head(&mut l, or_s(st(d, "title"), "가정예배")); if !st(d, "verse").is_empty() { l.push(st(d, "verse")); } l.push(String::new());
            if !st(d, "opening").is_empty() { l.push(format!("1. 찬양: {}", st(d, "opening"))); }
            l.push(format!("2. 말씀 읽기: {}", st(d, "verse")));
            if !st(d, "story").is_empty() { l.push(format!("3. 말씀 이야기: {}", st(d, "story"))); }
            let qs = list(d, "questions");
            if !qs.is_empty() { l.push("4. 함께 나누기".into()); for q in qs { l.push(format!(" - {}", js_string(Some(q)))); } }
            if !st(d, "activity").is_empty() { l.push(format!("5. 함께 해 보기: {}", st(d, "activity"))); }
            if !st(d, "prayer").is_empty() { l.push(format!("6. 기도: {}", st(d, "prayer"))); }
            if !st(d, "blessing").is_empty() { l.push(format!("7. 축복: {}", st(d, "blessing"))); }
        }
        "cardnews" => {
            head(&mut l, or_s(st(d, "title"), "카드뉴스")); if !st(d, "subtitle").is_empty() { l.push(st(d, "subtitle")); } if !st(d, "verse").is_empty() { l.push(st(d, "verse")); }
            for (i, s) in list(d, "slides").iter().enumerate() { l.push(String::new()); l.push(format!("{}. {}", i + 1, st(s, "heading"))); if !st(s, "body").is_empty() { l.push(st(s, "body")); } }
            if !st(d, "action").is_empty() { l.push(String::new()); l.push(format!("[이번 주 실천] {}", st(d, "action"))); }
            if !st(d, "closing").is_empty() { l.push(st(d, "closing")); }
            cap_text(&mut l);
        }
        "leader" => {
            head(&mut l, format!("{} · 리더 가이드", or_s(st(d, "title"), "소그룹"))); if !st(d, "verse").is_empty() { l.push(st(d, "verse")); } l.push(String::new());
            if !st(d, "goal").is_empty() { l.push(format!("[모임 목표] {}", st(d, "goal"))); }
            if !st(d, "prepare").is_empty() { l.push(format!("[미리 준비] {}", st(d, "prepare"))); }
            let flow = list(d, "flow");
            if !flow.is_empty() { l.push(String::new()); l.push("[진행 순서]".into()); for f in flow { let m = f["minutes"].as_i64().unwrap_or(0); l.push(format!("- {}{}{}", st(f, "part"), if m != 0 { format!(" ({m}분)") } else { String::new() }, if st(f, "guide").is_empty() { String::new() } else { format!(": {}", st(f, "guide")) })); } }
            for (i, q) in list(d, "questions").iter().enumerate() {
                l.push(String::new()); l.push(format!("Q{}. {}", i + 1, st(q, "q")));
                if !st(q, "intent").is_empty() { l.push(format!("  의도: {}", st(q, "intent"))); }
                if !st(q, "expected").is_empty() { l.push(format!("  예상 답: {}", st(q, "expected"))); }
                if !st(q, "followup").is_empty() { l.push(format!("  이어서: {}", st(q, "followup"))); }
            }
            let tips = list(d, "tips");
            if !tips.is_empty() { l.push(String::new()); l.push("[진행 팁]".into()); for t in tips { l.push(format!("- {}", js_string(Some(t)))); } }
            if !st(d, "prayer").is_empty() { l.push(String::new()); l.push(format!("[마무리 기도] {}", st(d, "prayer"))); }
        }
        "slides" => {
            head(&mut l, or_s(st(d, "title"), "설교")); if !st(d, "verse").is_empty() { l.push(st(d, "verse")); }
            for (i, s) in list(d, "slides").iter().enumerate() {
                l.push(String::new()); l.push(format!("{}. {}{}", i + 1, st(s, "heading"), if st(s, "ref").is_empty() { String::new() } else { format!(" ({})", st(s, "ref")) }));
                for x in list(s, "lines") { l.push(format!(" · {}", js_string(Some(x)))); }
            }
            if !st(d, "closing").is_empty() { l.push(String::new()); l.push(st(d, "closing")); }
        }
        _ => {}
    }
    let joined = l.join("\n");
    js_trim(&regex::Regex::new(r"\n{3,}").unwrap().replace_all(&joined, "\n\n")).to_string()
}

/// 자막 단어 → 읽기 좋은 문단 (쉼·문장 끝에서 줄 바꿈). words: [{text,start,end}]
pub fn sermon_text(words: &[Value]) -> String {
    let mut out: Vec<String> = vec![];
    let mut cur: Vec<String> = vec![];
    let mut prev_end: Option<f64> = None;
    for w in words {
        if !truthy(Some(w)) || !truthy(w.get("text")) { continue; }
        let start = js_num(w.get("start"));
        if let Some(pe) = prev_end { if start - pe > 1.2 && !cur.is_empty() { out.push(cur.join(" ")); cur.clear(); } }
        let t = js_trim(&js_string(w.get("text"))).to_string();
        cur.push(t.clone());
        prev_end = Some(js_num(w.get("end")));
        if t.ends_with(['.', '?', '!']) && cur.len() > 25 { out.push(cur.join(" ")); cur.clear(); }
    }
    if !cur.is_empty() { out.push(cur.join(" ")); }
    out.join("\n")
}

pub const SERVICES: [&str; 6] = ["sunday", "afternoon", "wednesday", "friday", "dawn", "special"];
/// '2026년 10월 25일' / '2026-10-25' → '2026-10-25' (못 읽으면 오늘)
pub fn iso_date(s: &str) -> String {
    let re = regex::Regex::new(r"(\d{4})\s*[-.년]\s*(\d{1,2})\s*[-.월]\s*(\d{1,2})").unwrap();
    if let Some(m) = re.captures(s) { return format!("{}-{:0>2}-{:0>2}", &m[1], &m[2], &m[3]); }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) + crate::youtube::local_offset_secs();
    let (y, m, d) = crate::youtube::civil_from_days(now.div_euclid(86400));
    format!("{y:04}-{m:02}-{d:02}")
}
fn yaml_str(v: &str) -> String { serde_json::to_string(&v.split(js_ws).filter(|x| !x.is_empty()).collect::<Vec<_>>().join(" ")).unwrap_or_default() }

/// 설교 요약 → 홈페이지(Astro sermon-notes) 말씀 요약 글 (.md) → (파일 이름, 글)
pub fn to_homepage(d: &Value, meta: &Value) -> (String, String) {
    let date = iso_date(&if truthy(meta.get("date")) { js_string(meta.get("date")) } else { String::new() });
    let service = meta["service"].as_str().filter(|s| SERVICES.contains(s)).unwrap_or("sunday").to_string();
    let raw = if truthy(meta.get("title")) { js_string(meta.get("title")) } else if !st(d, "title").is_empty() { st(d, "title") } else { "말씀 요약".into() };
    let title = js_trim(&regex::Regex::new(r"\s+/\s+").unwrap().replace_all(&raw.replace('*', ""), " ")).to_string();
    let mut fm = vec!["---".to_string(), format!("title: {}", yaml_str(&title)), format!("date: {date}"), format!("service: {service}")];
    if truthy(meta.get("series")) { fm.push(format!("series: {}", yaml_str(&js_string(meta.get("series"))))); }
    let verse = if truthy(meta.get("verse")) { js_string(meta.get("verse")) } else { st(d, "verse") };
    if !verse.is_empty() { fm.push(format!("passage: {}", yaml_str(&verse))); }
    if truthy(meta.get("speaker")) { fm.push(format!("preacher: {}", yaml_str(&js_string(meta.get("speaker"))))); }
    let points = list(d, "points");
    let summary = if !st(d, "theme").is_empty() { st(d, "theme") } else if let Some(p) = points.first().filter(|p| !st(p, "body").is_empty()) { st(p, "body") } else { title.clone() };
    fm.push(format!("summary: {}", yaml_str(&summary)));
    fm.push("published: false".into()); fm.push("---".into()); fm.push(String::new());
    let mut l: Vec<String> = vec![];
    for (i, p) in points.iter().enumerate() { l.push(format!("### {}{}", if points.len() > 1 { format!("{}. ", i + 1) } else { String::new() }, st(p, "heading"))); l.push(String::new()); l.push(st(p, "body")); l.push(String::new()); }
    if !st(d, "application").is_empty() { l.push("### 말씀을 정리하며".into()); l.push(String::new()); l.push(st(d, "application")); l.push(String::new()); }
    let body = js_trim(&regex::Regex::new(r"\n{3,}").unwrap().replace_all(&l.join("\n"), "\n\n")).to_string();
    (format!("{date}-{service}.md"), format!("{}{body}\n", fm.join("\n")))
}

/// 충실도 검사 요청: 만든 자료를 설교와 대조해 설교에 없거나 어긋난 곳을 찾는다
pub fn build_check_request(ty: &str, data: &Value) -> String {
    let label = type_of(ty).map(|t| t.label).unwrap_or(ty);
    format!("아래는 위 [설교]로 만든 \"{label}\" 자료입니다. 자료를 설교와 한 문장씩 대조해 주세요.\n찾을 것: (1) 설교에 없는 예화·통계·인물·인용·원어 풀이를 지어낸 곳 (2) 설교의 뜻과 반대이거나 과장한 곳 (3) 성경 장절이 설교·본문과 맞지 않는 곳 (4) 성경 본문 문장을 길게 옮겨 적은 곳.\n찾지 않을 것: 맞춤법, 문체, 설교의 신학적 옳고 그름, 설교를 쉬운 말로 바꾼 것, 설교 흐름에서 자연스럽게 나온 적용·질문·기도.\nquote 는 자료 속 문장을 글자 그대로(40자 이내 부분) 복사합니다. 문제가 없으면 issues 를 빈 배열로.\nJSON: {{\"issues\":[{{\"quote\":\"자료 속 그대로\",\"problem\":\"무엇이 설교와 다른지 한 문장\",\"fix\":\"고칠 방향이나 바꿀 문장\"}}]}}\n\n[자료]\n{}", js_slice(&to_text(ty, data, &json!({})), 0, 12000))
}
fn ws1(s: &str) -> String { regex::Regex::new(r"\s+").unwrap().replace_all(s, " ").to_string() }
/// 검사 결과 읽기 → { ok, issues:[{quote,problem,fix,found}], at }
pub fn parse_check(text: &str, data: Option<&Value>, ty: &str) -> Result<Value, String> {
    let err = || "검사 결과를 읽지 못했습니다.".to_string();
    let mut s = js_trim(text).to_string();
    if let Some(a) = s.find("```") { let mut rest = &s[a + 3..]; if let Some(r) = rest.strip_prefix("json") { rest = r; } let rest = rest.trim_start_matches(js_ws); if let Some(b) = rest.find("```") { s = js_trim(&rest[..b]).to_string(); } }
    let (a, b) = (s.find('{').ok_or_else(err)?, s.rfind('}').ok_or_else(err)?);
    if b < a { return Err(err()); }
    let o: Value = serde_json::from_str(&repair_json(&s[a..=b])).map_err(|_| err())?;
    let whole = data.map(|d| ws1(&to_text(ty, d, &json!({})))).unwrap_or_default();
    let issues: Vec<Value> = av(o.get("issues")).iter().take(12).map(|it| {
        let it = if truthy(Some(it)) { it.clone() } else { json!({}) };
        let q = sv(it.get("quote"), 120);
        json!({ "quote": q, "problem": sv(it.get("problem"), 300), "fix": sv(it.get("fix"), 300), "found": !q.is_empty() && whole.contains(&ws1(&q)) })
    }).filter(|it| it["problem"] != "").collect();
    Ok(json!({ "ok": issues.is_empty(), "issues": issues, "at": crate::youtube::now_iso() }))
}

// ---------------- AI 로 만들기·대조 (기존 main/materials.js generate·check) ----------------
fn msg(role: &str, c: &str) -> crate::llm::Msg { crate::llm::Msg { role: role.into(), content: c.into() } }
/// 자료 만들기: (데이터, AI 이름). 형식이 깨지면 한 번 고쳐 달라고 한다. ctx: { church, title, verse, speaker, date, sermon }
pub fn generate(ty: &str, options: &Value, ctx: &Value) -> Result<(Value, String), String> {
    if type_of(ty).is_none() { return Err("모르는 자료 종류입니다.".into()); }
    if js_trim(&if truthy(ctx.get("sermon")) { js_string(ctx.get("sermon")) } else { String::new() }).is_empty() { return Err("설교 원고가 비어 있습니다.".into()); }
    let s = crate::settings::load();
    let provider = crate::llm::active_provider(&s).ok_or("AI 가 연결되어 있지 않습니다. 오른쪽 위 [AI 연결]에서 챗GPT·클로드·제미나이 중 하나를 연결해 주세요.")?;
    let mut c = ctx.clone(); c["options"] = options.clone();
    let system = build_system(&c);
    let request = build_request(ty, options)?;
    let messages = vec![msg("user", &request)];
    let first = crate::chat::ask(&provider, &system, &messages)?;
    match parse(ty, &first) {
        Ok(d) => Ok((d, provider)),
        Err(_) => {
            let mut m2 = messages.clone();
            m2.push(msg("assistant", &first.chars().take(12000).collect::<String>()));
            m2.push(msg("user", "방금 답은 JSON 형식이 잘못되었거나 비어 있습니다. 같은 내용을 요청한 JSON 하나로만 다시 쓰세요. 문자열 안 따옴표는 \\\", 줄바꿈은 \\n."));
            let fix = crate::chat::ask(&provider, &system, &m2)?;
            Ok((parse(ty, &fix)?, provider))
        }
    }
}
/// 충실도 검사: 만든 자료를 설교와 다시 대조 (AI 한 번 더)
pub fn check(ty: &str, data: &Value, options: &Value, ctx: &Value) -> Result<Value, String> {
    if type_of(ty).is_none() { return Err("모르는 자료 종류입니다.".into()); }
    let s = crate::settings::load();
    let provider = crate::llm::active_provider(&s).ok_or("AI 가 연결되어 있지 않습니다.")?;
    let mut c = ctx.clone(); c["options"] = options.clone();
    let system = build_system(&c);
    let messages = vec![msg("user", &build_check_request(ty, data))];
    let first = crate::chat::ask(&provider, &system, &messages)?;
    match parse_check(&first, Some(data), ty) {
        Ok(v) => Ok(v),
        Err(_) => {
            let mut m2 = messages.clone();
            m2.push(msg("assistant", &first.chars().take(6000).collect::<String>()));
            m2.push(msg("user", "요청한 JSON 하나로만 다시 쓰세요: {\"issues\":[...]}"));
            parse_check(&crate::chat::ask(&provider, &system, &m2)?, Some(data), ty)
        }
    }
}