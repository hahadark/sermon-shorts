//! 대화형 AI 편집 세션 (기존 src/main/llm/index.js): 영상 하나의 자막·대화 기억·편집 계획.
//! 유튜브 자막이 없으면 이 PC 의 위스퍼로 만든다. 토큰·키는 화면 쪽에 보내지 않는다.
use crate::chat_plan::{self as cp, Candidate, Range, SubLine, SubWord};
use crate::llm::{self, Msg};
use crate::youtube as yt;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, Default)]
pub struct SPlan { pub title: String, pub verse: String, pub tighten: String, pub ranges: Vec<Range> }

#[derive(Clone, Debug, Default)]
pub struct Session {
    pub url: String, pub title: String, pub duration: f64,
    pub words: Vec<SubWord>, pub lines: Vec<SubLine>,
    pub history: Vec<Msg>, pub plan: Option<SPlan>, pub sermon: Option<(usize, usize)>, pub candidates: Vec<Candidate>,
}
pub type Shared = Arc<Mutex<Option<Session>>>;

/// 불러오기 결과
#[derive(Clone, Debug)]
pub enum Loaded {
    Ready { url: String, title: String, duration: f64, words: usize, resumed: bool, has_plan: bool, whisper: bool, from_editor: bool },
    /// 유튜브 자막이 없다: 위스퍼로 만들지 물어본다
    NoSubs { url: String, title: String, duration: f64, live: bool, engine_ready: bool },
}

pub const CANCELLED: &str = "요청을 멈췄습니다.";
fn re_subs() -> regex::Regex { regex::Regex::new(r"(?i)subtitle|자막").unwrap() }

fn start_session(shared: &Shared, url: &str, title: &str, duration: f64, words: Vec<SubWord>, lines: Vec<SubLine>, whisper: bool, from_editor: bool) -> Loaded {
    let n = words.len();
    *shared.lock().unwrap() = Some(Session { url: url.into(), title: title.into(), duration, words, lines, ..Default::default() });
    Loaded::Ready { url: url.into(), title: title.into(), duration, words: n, resumed: false, has_plan: false, whisper, from_editor }
}

pub fn whisper_cache_file(id: &str) -> PathBuf {
    let safe: String = id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
    yt::cache_dir().join("chat").join(format!("whisper_{safe}.json"))
}
/// 전에 위스퍼로 만든 자막 (Electron 판과 같은 파일)
pub fn read_whisper_cache(id: &str) -> Option<(Vec<SubWord>, Vec<SubLine>)> {
    let j: Value = serde_json::from_str(&std::fs::read_to_string(whisper_cache_file(id)).ok()?).ok()?;
    let ws = j["words"].as_array().filter(|a| !a.is_empty())?;
    let ls = j["lines"].as_array()?;
    let words: Vec<SubWord> = ws.iter().map(|w| SubWord { text: w["text"].as_str().unwrap_or("").into(), start: w["start"].as_f64().unwrap_or(0.0), end: w["end"].as_f64().unwrap_or(0.0) }).collect();
    let lines: Vec<SubLine> = ls.iter().filter_map(|l| Some(SubLine { start: l["start"].as_f64()?, from: l["from"].as_u64()? as usize, to: l["to"].as_u64()? as usize })).filter(|l| l.to < words.len() && l.from <= l.to).collect();
    Some((words, lines))
}
fn write_whisper_cache(id: &str, url: &str, title: &str, words: &[SubWord], lines: &[SubLine]) {
    let p = whisper_cache_file(id);
    if let Some(d) = p.parent() { let _ = std::fs::create_dir_all(d); }
    let v = json!({ "url": url, "title": title,
        "words": words.iter().enumerate().map(|(i, w)| json!({ "id": i, "text": w.text, "start": w.start, "end": w.end })).collect::<Vec<_>>(),
        "lines": lines.iter().map(|l| json!({ "start": l.start, "from": l.from, "to": l.to })).collect::<Vec<_>>() });
    let _ = std::fs::write(p, v.to_string());
}

/// 영상 불러오기: 같은 영상이면 앞의 대화를 이어가고, 자막이 없으면 NoSubs
pub fn load_video(shared: &Shared, url: &str) -> Result<Loaded, String> {
    if let Some(s) = shared.lock().unwrap().as_ref() {
        if s.url == url && !s.words.is_empty() {
            return Ok(Loaded::Ready { url: url.into(), title: s.title.clone(), duration: s.duration, words: s.words.len(), resumed: true, has_plan: s.plan.as_ref().is_some_and(|p| !p.ranges.is_empty()), whisper: false, from_editor: false });
        }
    }
    let info = yt::fetch_info(url)?;
    // 자막을 받다가 실패한 경우(번역 자막 429 등)도 '자막 없음'으로 본다. 영상 자체가 없으면 위 fetch_info 에서 오류
    let subs = match yt::fetch_auto_subs_raw(url) { Ok(v) => v, Err(e) if re_subs().is_match(&e) => None, Err(e) => return Err(e) };
    let Some(raw) = subs else {
        if let Some((w, l)) = read_whisper_cache(&info.id) { return Ok(start_session(shared, url, &info.title, info.duration, w, l, true, false)); }
        return Ok(Loaded::NoSubs { url: url.into(), title: info.title.clone(), duration: info.duration, live: info.live_now(), engine_ready: crate::stt::python().exists() });
    };
    let (words, lines) = cp::words_from_json3(&raw);
    if words.len() < 20 { return Err("자막이 너무 짧습니다. 다른 영상을 넣어 주세요.".into()); }
    Ok(start_session(shared, url, &info.title, info.duration, words, lines, false, false))
}

/// 유튜브 자막이 없는 영상: 소리를 받아(이미 받았으면 그대로) 위스퍼로 자막을 만든다. progress(stage "download"|"transcribe", pct)
pub fn load_video_whisper(shared: &Shared, url: &str, progress: Arc<dyn Fn(&str, Option<f64>) + Send + Sync>, cancel: Arc<AtomicBool>) -> Result<Loaded, String> {
    let info = yt::fetch_info(url)?;
    if info.live_now() { return Err("라이브가 아직 진행 중이라 소리를 받을 수 없습니다. 방송이 끝난 뒤 다시 해 주세요.".into()); }
    if !crate::stt::python().exists() { return Err("위스퍼(자막 엔진)가 설치되어 있지 않습니다. 도움말 → 시스템 점검에서 [엔진 설치]를 한 뒤 다시 불러와 주세요.".into()); }
    let dir = yt::yt_cache_root().join(&info.id);
    let a = yt::download_audio(url, &dir, &|p| progress("download", Some(p)))?;
    if cancel.load(Ordering::Relaxed) { return Err(CANCELLED.into()); }
    let p2 = progress.clone();
    let pr = move |stage: &str, pct: f64, _m: &str| { if stage != "warn" { p2("transcribe", if pct.is_finite() && pct >= 0.0 { Some(pct) } else { None }); } };
    let res = crate::stt::transcribe(&a.file, None, None, "", &pr, cancel.clone());
    if cancel.load(Ordering::Relaxed) { return Err(CANCELLED.into()); }
    let res = res.map_err(|e| e.to_string())?;
    let raw = res["words"].as_array().cloned().unwrap_or_default();
    let (words, lines) = cp::whisper_words_to_lines(&raw);
    if words.len() < 20 { return Err("위스퍼가 알아들은 말이 너무 적습니다. 다른 영상을 넣어 주세요.".into()); }
    write_whisper_cache(&info.id, url, &info.title, &words, &lines);
    Ok(start_session(shared, url, &info.title, info.duration, words, lines, true, false))
}

/// 편집기에 연 영상의 자막으로 대화 시작 (파일 → 유튜브에서 가져오기로 연 영상)
pub fn use_words(shared: &Shared, url: &str, title: &str, duration: f64, raw: &[Value]) -> Result<Loaded, String> {
    let (words, lines) = cp::whisper_words_to_lines(raw);
    if words.len() < 5 { return Err("편집기의 자막이 너무 짧습니다.".into()); }
    Ok(start_session(shared, url, title, duration, words, lines, false, true))
}

/// AI 답 (편집기에 반영할 것)
#[derive(Clone, Debug, Default)]
pub struct Reply {
    pub reply: String, pub title: String, pub verse: String, pub tighten: String,
    pub ranges: Vec<Range>, pub corrections: Vec<(usize, String)>, pub warnings: Vec<String>,
    pub candidates: Vec<Candidate>, pub questions: Vec<String>, pub duration_sec: f64, pub provider: String, pub ms: u64,
}

fn prompt_ctx(s: &Value, title: &str) -> cp::PromptCtx {
    let tpl = &s["template"];
    let st = |v: &Value| v.as_str().unwrap_or("").to_string();
    let sp = { let a = st(&s["defaultSpeaker"]); if a.is_empty() { st(&tpl["defaultSpeaker"]) } else { a } };
    cp::PromptCtx { church: st(&tpl["churchName"]), speaker: sp, terms: st(&s["churchTerms"]), video_title: title.into() }
}

/// AI 에게 묻기. 시험(SS_TEST_LLM_ANSWERS = 답 목록 JSON 파일)에서는 돈 드는 호출 없이 차례로 꺼낸다
fn ask(provider: &str, system: &str, messages: &[Msg]) -> Result<String, String> {
    if let Ok(p) = std::env::var("SS_TEST_LLM_ANSWERS") {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let list: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(&p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let i = N.fetch_add(1, Ordering::Relaxed);
        std::thread::sleep(std::time::Duration::from_millis(600));
        let _ = std::fs::write(std::env::temp_dir().join(format!("ss_llm_sent{i}.txt")), format!("{system}\n\n=====\n{}", messages.last().map(|m| m.content.as_str()).unwrap_or("")));
        return list.get(i).map(|v| v.as_str().map(String::from).unwrap_or_else(|| v.to_string())).ok_or_else(|| "시험 답이 더 없습니다".into());
    }
    llm::complete(provider, system, messages).map_err(|e| e.msg)
}

/// 대화 보내기. stage("prepare"|"ask"|"check"|"retry"). cancel 이 켜지면 답을 버리고 CANCELLED
pub fn send(shared: &Shared, text: &str, stage: &(dyn Fn(&str) + Send + Sync), cancel: Arc<AtomicBool>) -> Result<Reply, String> {
    let s = crate::settings::load();
    let provider = llm::active_provider(&s).ok_or("AI 가 연결되어 있지 않습니다. [AI 연결]에서 하나를 골라 연결해 주세요.")?;
    let (system, messages) = {
        let g = shared.lock().unwrap();
        let ss = g.as_ref().ok_or("먼저 설교 영상의 유튜브 주소를 넣어 주세요.")?;
        stage("prepare");
        let range = ss.sermon.map(|(f, t)| (ss.words[f].start - 30.0, ss.words[t].end + 30.0));
        let system = format!("{}\n\n[설교 자막]\n{}", cp::build_system_prompt(&prompt_ctx(&s, &ss.title)), cp::transcript_text(&ss.words, &ss.lines, range));
        let cur = ss.plan.as_ref().map(|p| cp::Current { title: p.title.clone(), verse: p.verse.clone(), tighten: p.tighten.clone(), segments: cp::describe_ranges(&p.ranges, &ss.words), remaining_questions: cp::questions_in(&p.ranges, &ss.words) });
        let dur = ss.plan.as_ref().map(|p| cp::ranges_duration(&p.ranges, &ss.words)).unwrap_or(0.0);
        let user = cp::build_user_message(text, cur.as_ref(), dur);
        let mut m: Vec<Msg> = ss.history[ss.history.len().saturating_sub(8)..].to_vec();
        m.push(Msg { role: "user".into(), content: user });
        (system, m)
    };
    let t0 = std::time::Instant::now();
    let stop = || cancel.load(Ordering::Relaxed);
    stage("ask");
    let answer = ask(&provider, &system, &messages)?;
    if stop() { return Err(CANCELLED.into()); }
    stage("check");
    let plan = match cp::parse_plan(&answer) {
        Ok(p) => p,
        Err(e) if e.format => {
            // 형식이 깨진 답이면 한 번 고쳐 달라고 한다
            stage("retry");
            let mut m2 = messages.clone();
            m2.push(Msg { role: "assistant".into(), content: answer.chars().take(12000).collect() });
            m2.push(Msg { role: "user".into(), content: "방금 답은 JSON 형식이 잘못되어 읽을 수 없습니다. 같은 편집 내용을 [답 형식]에 맞는 올바른 JSON 하나로만 다시 쓰세요. 문자열 안의 따옴표는 \\\" 로, 줄바꿈은 \\n 으로 쓰세요.".into() });
            let fix = ask(&provider, &system, &m2)?;
            if stop() { return Err(CANCELLED.into()); }
            stage("check");
            cp::parse_plan(&fix).map_err(|e| e.msg)?
        }
        Err(e) => return Err(e.msg),
    };
    let mut g = shared.lock().unwrap();
    let ss = g.as_mut().ok_or("먼저 설교 영상의 유튜브 주소를 넣어 주세요.")?;
    let mut resolved = cp::resolve_plan(&plan, &ss.words);
    // 구간 추천: 후보만 돌려주고 지금 편집은 그대로 둔다
    let candidates = cp::resolve_candidates(&plan.candidates, &ss.words);
    let recommend = !candidates.is_empty();
    if recommend { ss.candidates = candidates.clone(); }
    if resolved.ranges.is_empty() { if let Some(p) = &ss.plan { resolved.ranges = p.ranges.clone(); } } // 질문만 한 경우
    if let Some((f, t)) = plan.sermon { if f.is_finite() && t.is_finite() && !ss.words.is_empty() {
        let n = ss.words.len() as f64;
        let (f, t) = (cp::js_round(f).max(0.0).min(n - 1.0) as usize, cp::js_round(t).max(0.0).min(n - 1.0) as usize);
        if t > f { ss.sermon = Some((f, t)); }
    } }
    let prev = ss.plan.clone();
    ss.plan = Some(if recommend {
        SPlan { title: prev.as_ref().map(|p| p.title.clone()).unwrap_or_default(), verse: prev.as_ref().map(|p| p.verse.clone()).filter(|v| !v.is_empty()).unwrap_or_else(|| plan.verse.clone()),
            tighten: prev.as_ref().map(|p| p.tighten.clone()).unwrap_or_else(|| plan.tighten.clone()), ranges: prev.as_ref().map(|p| p.ranges.clone()).unwrap_or_default() }
    } else {
        SPlan { title: if plan.title.is_empty() { prev.as_ref().map(|p| p.title.clone()).unwrap_or_default() } else { plan.title.clone() },
            verse: if plan.verse.is_empty() { prev.as_ref().map(|p| p.verse.clone()).unwrap_or_default() } else { plan.verse.clone() },
            tighten: plan.tighten.clone(), ranges: resolved.ranges.clone() }
    });
    let sp = ss.plan.clone().unwrap();
    // 대화 기억 (JSON.stringify(memo) 와 같은 모양)
    let segs: Vec<String> = sp.ranges.iter().map(|r| format!("{{\"from\":{},\"to\":{}}}", r.from, r.to)).collect();
    let mut memo = format!("{{\"reply\":{},\"title\":{},\"segments\":[{}]", cp::jstr(&plan.reply), cp::jstr(&sp.title), segs.join(","));
    if !candidates.is_empty() {
        let cs: Vec<String> = candidates.iter().map(|c| format!("{{\"no\":{},\"from\":{},\"to\":{},\"title\":{}}}", c.no, c.from, c.to, cp::jstr(&c.title))).collect();
        memo.push_str(&format!(",\"candidates\":[{}]", cs.join(",")));
    }
    memo.push('}');
    ss.history.push(Msg { role: "user".into(), content: text.into() });
    ss.history.push(Msg { role: "assistant".into(), content: memo });
    let questions = cp::questions_in(&resolved.ranges, &ss.words);
    let duration_sec = cp::ranges_duration(&resolved.ranges, &ss.words);
    Ok(Reply {
        reply: if plan.reply.is_empty() { if recommend { "추천 구간입니다.".into() } else { "편집했습니다.".into() } } else { plan.reply.clone() },
        title: sp.title, verse: sp.verse, tighten: sp.tighten,
        // 추천만 한 답이면 편집기에 다시 반영하지 않도록 빈 구간
        ranges: if recommend { vec![] } else { resolved.ranges.clone() }, corrections: if recommend { vec![] } else { resolved.corrections.clone() }, warnings: resolved.warnings.clone(),
        candidates, questions, duration_sec, provider, ms: t0.elapsed().as_millis() as u64,
    })
}
