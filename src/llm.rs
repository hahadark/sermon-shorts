//! AI 연결: 챗GPT(계정 로그인)·클로드(Claude Code)·제미나이·오픈라우터 (기존 main/llm/*.js, main/ai.js testConnection)
//! 키·토큰은 절대 화면이나 기록에 내보내지 않는다.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const PROVIDERS: [&str; 4] = ["chatgpt", "claude", "gemini", "openrouter"];
pub fn name_ko(p: &str) -> &'static str {
    match p { "chatgpt" => "챗GPT", "claude" => "클로드", "gemini" => "제미나이", "openrouter" => "오픈라우터", _ => "AI" }
}
pub const LINKS: [(&str, &str); 6] = [
    ("chatgptUsage", "https://chatgpt.com/settings/usage"),
    ("chatgptPlans", "https://chatgpt.com/pricing"),
    ("claudePlans", "https://claude.com/pricing"),
    ("claudeSetup", "https://code.claude.com/docs/en/setup"),
    ("geminiKey", "https://aistudio.google.com/apikey"),
    ("openrouterKey", "https://openrouter.ai/settings/keys"),
];
pub fn open_link(key: &str) -> Result<(), String> {
    let Some((_, u)) = LINKS.iter().find(|(k, _)| *k == key) else { return Err("알 수 없는 링크입니다.".into()) };
    crate::ytupload::open_url(u);
    Ok(())
}

/// 오류: code 는 기존 e.code (auth·usage_limit·plan·not_installed·network …)
#[derive(Clone, Debug)]
pub struct LlmErr { pub code: String, pub msg: String }
impl std::fmt::Display for LlmErr { fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str(&self.msg) } }
fn e(code: &str, msg: impl Into<String>) -> LlmErr { LlmErr { code: code.into(), msg: msg.into() } }

#[derive(Clone, Debug)]
pub struct Msg { pub role: String, pub content: String }
impl Msg { pub fn user(t: &str) -> Self { Msg { role: "user".into(), content: t.into() } } }

// ---------------------------------------------------------------- 상태

#[derive(Clone, Debug, Default)]
pub struct GptStatus { pub connected: bool, pub email: String, pub plan_enabled: bool, pub model: String, pub error: String }
#[derive(Clone, Debug, Default)]
pub struct ClaudeStatus { pub installed: bool, pub logged_in: bool, pub method: String, pub version: String, pub path: String }
#[derive(Clone, Debug, Default)]
pub struct KeyStatus { pub has_key: bool, pub suffix: String }
#[derive(Clone, Debug, Default)]
pub struct Status { pub active: Option<String>, pub chatgpt: GptStatus, pub claude: ClaudeStatus, pub gemini: KeyStatus, pub openrouter: KeyStatus }
impl Status {
    /// 기존 chat-ui.js isReady
    pub fn is_ready(&self, name: &str) -> bool {
        match name {
            "chatgpt" => self.chatgpt.connected && self.chatgpt.plan_enabled,
            "claude" => self.claude.logged_in,
            "gemini" => self.gemini.has_key,
            "openrouter" => self.openrouter.has_key,
            _ => false,
        }
    }
    /// 대화 칸 머리의 표시: (글, 연결됨?)
    pub fn chip(&self) -> (String, bool) {
        match &self.active { Some(a) if self.is_ready(a) => (format!("{} 연결됨", name_ko(a)), true), _ => ("AI 연결 필요".into(), false) }
    }
}

pub fn active_provider(s: &Value) -> Option<String> {
    s["aiProvider"].as_str().filter(|p| PROVIDERS.contains(p)).map(String::from)
}
pub fn gemini_key(s: &Value) -> String {
    let k = crate::secret::setting(s, "geminiApiKeyEnc");
    if !k.is_empty() { k } else { std::env::var("GEMINI_API_KEY").unwrap_or_default() }
}
pub fn openrouter_key(s: &Value) -> String {
    let k = crate::secret::setting(s, "openrouterApiKeyEnc");
    if !k.is_empty() { k } else { std::env::var("OPENROUTER_API_KEY").unwrap_or_default() }
}
fn suffix(k: &str) -> String { let c: Vec<char> = k.chars().collect(); c[c.len().saturating_sub(4)..].iter().collect() }

/// 기존 statusAll (클로드 프로그램을 물어보느라 몇 초 걸릴 수 있다: 화면 밖 스레드에서)
pub fn status() -> Status {
    let s = crate::settings::load();
    let g = gemini_key(&s);
    let o = openrouter_key(&s);
    let (gpt, cl) = std::thread::scope(|sc| {
        let a = sc.spawn(|| chatgpt::status());
        let b = sc.spawn(claude::status);
        (a.join().unwrap_or_default(), b.join().unwrap_or_default())
    });
    Status {
        active: active_provider(&s), chatgpt: gpt, claude: cl,
        gemini: KeyStatus { has_key: !g.is_empty(), suffix: if crate::secret::setting(&s, "geminiApiKeyEnc").is_empty() { String::new() } else { suffix(&g) } },
        openrouter: KeyStatus { has_key: !o.is_empty(), suffix: if o.is_empty() { String::new() } else { suffix(&o) } },
    }
}

pub fn set_active(name: Option<&str>) -> Result<Value, String> {
    if let Some(n) = name { if !PROVIDERS.contains(&n) { return Err("알 수 없는 AI 입니다.".into()); } }
    crate::settings::save(&json!({ "aiProvider": name })).map_err(|e| e.to_string())
}

/// 한 번 묻고 답 받기 (기존 complete)
pub fn complete(provider: &str, system: &str, messages: &[Msg]) -> Result<String, LlmErr> {
    let s = crate::settings::load();
    match provider {
        "chatgpt" => chatgpt::complete(system, messages, None),
        "claude" => claude::complete(system, messages, Some("sonnet")),
        "gemini" => gemini::complete(&gemini_key(&s), system, messages, None),
        "openrouter" => openrouter::complete(&openrouter_key(&s), system, messages, s["openrouterModel"].as_str().filter(|m| !m.is_empty())),
        _ => Err(e("no_provider", "AI 가 연결되어 있지 않습니다. [AI 연결]에서 하나를 골라 연결해 주세요.")),
    }
}

/// 연결 확인 (기존 llm:test): 짧은 JSON 하나를 돌려 달라고 한다
pub fn test(provider: &str) -> (bool, String) {
    match complete(provider, "짧게 답하세요. JSON 으로만 답합니다.", &[Msg::user("{\"ok\":true} 를 그대로 답하세요.")]) {
        Ok(t) => (t.contains("ok"), t.chars().take(80).collect()),
        Err(er) => (false, er.msg),
    }
}

// ---------------------------------------------------------------- HTTP 도움

/// 응답 (상태, 본문). 연결 자체가 안 되면 Err(글)
fn http(req: ureq::Request, body: Option<&str>) -> Result<(u16, String), String> {
    let r = match body { Some(b) => req.send_string(b), None => req.call() };
    match r {
        Ok(res) => { let st = res.status(); Ok((st, res.into_string().unwrap_or_default())) }
        Err(ureq::Error::Status(st, res)) => Ok((st, res.into_string().unwrap_or_default())),
        Err(er) => Err(er.to_string()),
    }
}
fn api_base(env: &str, default: &str) -> String { std::env::var(env).unwrap_or_else(|_| default.to_string()) }
fn timeout(secs: u64) -> std::time::Duration { std::time::Duration::from_secs(secs) }

/// application/x-www-form-urlencoded (URLSearchParams 와 같게: 공백은 +, *-._ 와 영숫자는 그대로)
pub fn form_encode(pairs: &[(&str, &str)]) -> String {
    let enc = |s: &str| -> String {
        let mut o = String::new();
        for b in s.bytes() {
            match b { b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => o.push(b as char), b' ' => o.push('+'), _ => o.push_str(&format!("%{b:02X}")) }
        }
        o
    };
    pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect::<Vec<_>>().join("&")
}
pub fn form_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => { out.push(b' '); i += 1; }
            b'%' if i + 2 < b.len() => {
                let hex = |c: u8| (c as char).to_digit(16);
                match (hex(b[i + 1]), hex(b[i + 2])) { (Some(h), Some(l)) => { out.push((h * 16 + l) as u8); i += 3; } _ => { out.push(b'%'); i += 1; } }
            }
            c => { out.push(c); i += 1; }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------------------------------------------------------------- 제미나이

pub mod gemini {
    use super::*;
    pub const DEFAULT_MODEL: &str = "gemini-3.5-flash";
    fn api() -> String { api_base("SS_GEMINI_API", "https://generativelanguage.googleapis.com/v1beta/models") }

    /// 기존 llm/gemini.js 요청 본문
    pub fn body(system: &str, messages: &[Msg]) -> Value {
        let mut b = json!({
            "contents": messages.iter().map(|m| json!({ "role": if m.role == "assistant" { "model" } else { "user" }, "parts": [{ "text": m.content }] })).collect::<Vec<_>>(),
            "generationConfig": { "temperature": 0.3, "responseMimeType": "application/json", "thinkingConfig": { "thinkingLevel": "medium" } },
        });
        if !system.is_empty() { b["systemInstruction"] = json!({ "parts": [{ "text": system }] }); }
        b
    }
    /// 실패 응답 → 오류 (기존 gemini.js)
    pub fn error_of(status: u16, data: &Value) -> LlmErr {
        let msg = data["error"]["message"].as_str().unwrap_or("");
        let api_key = regex::RegexBuilder::new("API key").case_insensitive(true).build().unwrap().is_match(msg);
        if status == 429 { return e("usage_limit", "제미나이 무료 사용량을 다 썼습니다. 잠시 뒤 다시 하거나 다른 AI 로 바꿔 주세요."); }
        if (status == 400 && api_key) || status == 401 || status == 403 { return e("auth", "제미나이 키가 올바르지 않습니다. [AI 연결]에서 다시 입력해 주세요."); }
        e("api", format!("제미나이 오류 {status}: {}", msg.chars().take(200).collect::<String>()))
    }
    pub fn text_of(data: &Value) -> String {
        data["candidates"][0]["content"]["parts"].as_array().map(|ps| ps.iter().filter(|p| p["thought"].as_bool() != Some(true)).map(|p| p["text"].as_str().unwrap_or("")).collect::<String>()).unwrap_or_default()
    }
    pub fn complete(key: &str, system: &str, messages: &[Msg], model: Option<&str>) -> Result<String, LlmErr> {
        if key.is_empty() { return Err(e("auth", "제미나이 키가 없습니다. [AI 연결]에서 키를 입력해 주세요.")); }
        let url = format!("{}/{}:generateContent", api(), model.unwrap_or(DEFAULT_MODEL));
        let req = ureq::post(&url).set("content-type", "application/json").set("x-goog-api-key", key).timeout(timeout(600));
        let (st, text) = http(req, Some(&body(system, messages).to_string())).map_err(|m| e("network", format!("제미나이에 연결하지 못했습니다: {m}")))?;
        let data: Value = serde_json::from_str(&text).unwrap_or(json!({}));
        if !(200..300).contains(&st) { return Err(error_of(st, &data)); }
        Ok(text_of(&data))
    }

    /// 설정의 [연결 확인] (기존 ai.js testConnection): (성공?, 사람이 읽는 글)
    pub fn test_connection(key: &str, model: &str) -> (bool, String) {
        if key.is_empty() { return (false, "API 키가 없습니다. 설정에서 Gemini API 키를 입력하세요.".into()); }
        let t0 = std::time::Instant::now();
        let body = json!({ "contents": [{ "role": "user", "parts": [{ "text": "확인. \"OK\"라고만 답해." }] }], "generationConfig": { "maxOutputTokens": 5, "thinkingConfig": { "thinkingLevel": "minimal" } } });
        let req = ureq::post(&format!("{}/{model}:generateContent", api())).set("content-type", "application/json").set("x-goog-api-key", key).timeout(timeout(60));
        match http(req, Some(&body.to_string())) {
            Err(m) => (false, format!("인터넷 연결을 확인하세요. ({m})")),
            Ok((st, text)) => test_result(st, &serde_json::from_str(&text).unwrap_or(json!({})), model, t0.elapsed().as_millis() as u64),
        }
    }
    pub fn test_result(status: u16, data: &Value, model: &str, ms: u64) -> (bool, String) {
        if (200..300).contains(&status) { return (true, format!("연결 성공 ({model}, {ms}ms)")); }
        let msg = data["error"]["message"].as_str().unwrap_or("");
        let api_key = regex::RegexBuilder::new("API key").case_insensitive(true).build().unwrap().is_match(msg);
        let m = match status {
            400 if api_key => "API 키가 올바르지 않습니다. 키를 다시 확인하세요.".to_string(),
            403 => "이 키로는 사용할 수 없습니다(권한 또는 결제 설정 확인).".into(),
            404 => format!("모델을 찾을 수 없습니다: {model}"),
            429 => "사용 한도를 넘었습니다. 잠시 후 다시 시도하거나 다른 모델을 고르세요.".into(),
            _ => format!("오류 {status}: {}", msg.chars().take(200).collect::<String>()),
        };
        (false, m)
    }
}

// ---------------------------------------------------------------- 오픈라우터

pub mod openrouter {
    use super::*;
    pub const DEFAULT_MODEL: &str = "openrouter/free";
    const MIN_CONTEXT: f64 = 64000.0;
    fn api() -> String { api_base("SS_OPENROUTER_API", "https://openrouter.ai/api/v1") }

    pub fn body(model: &str, system: &str, messages: &[Msg]) -> Value {
        let mut ms: Vec<Value> = if system.is_empty() { vec![] } else { vec![json!({ "role": "system", "content": system })] };
        ms.extend(messages.iter().map(|m| json!({ "role": if m.role == "assistant" { "assistant" } else { "user" }, "content": m.content })));
        json!({ "model": model, "temperature": 0.3, "messages": ms })
    }
    /// 지금 무료인 글 모델 (문맥 긴 것부터, 한 시간 기억)
    pub fn free_models() -> Vec<String> {
        use std::sync::Mutex;
        static CACHE: Mutex<Option<(std::time::Instant, Vec<String>)>> = Mutex::new(None);
        if let Some((at, ids)) = CACHE.lock().unwrap().as_ref() { if at.elapsed().as_secs() < 3600 && !ids.is_empty() { return ids.clone(); } }
        let Ok((200, text)) = http(ureq::get(&format!("{}/models", api())).timeout(timeout(30)), None) else { return CACHE.lock().unwrap().as_ref().map(|c| c.1.clone()).unwrap_or_default() };
        let data: Value = serde_json::from_str(&text).unwrap_or(json!({}));
        let ids = pick_free(&data);
        *CACHE.lock().unwrap() = Some((std::time::Instant::now(), ids.clone()));
        ids
    }
    pub fn pick_free(data: &Value) -> Vec<String> {
        let num = |v: &Value| -> f64 { v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())).unwrap_or(f64::NAN) };
        let bad = regex::RegexBuilder::new("safety|guard|code").case_insensitive(true).build().unwrap();
        let mut ms: Vec<&Value> = data["data"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
        ms.retain(|m| {
            let id = m["id"].as_str().unwrap_or("");
            id.ends_with(":free") && m["pricing"].is_object() && num(&m["pricing"]["prompt"]) == 0.0 && num(&m["pricing"]["completion"]) == 0.0
                && m["context_length"].as_f64().unwrap_or(0.0) >= MIN_CONTEXT
                && (m["architecture"].is_null() || m["architecture"]["output_modalities"].is_null() || m["architecture"]["output_modalities"].as_array().is_some_and(|a| a.iter().any(|x| x == "text")))
                && !bad.is_match(id)
        });
        ms.sort_by(|a, b| b["context_length"].as_f64().unwrap_or(0.0).total_cmp(&a["context_length"].as_f64().unwrap_or(0.0)));
        ms.iter().map(|m| m["id"].as_str().unwrap_or("").to_string()).collect()
    }
    /// 실패 → (오류, 다시 해 볼 만한지)
    pub fn error_of(http_ok: bool, status: u16, data: &Value) -> (LlmErr, bool, u16) {
        let st = if http_ok { data["error"]["code"].as_u64().map(|c| c as u16).unwrap_or(500) } else { status };
        let msg = data["error"]["message"].as_str().unwrap_or("");
        if st == 401 || st == 403 { return (e("auth", "오픈라우터 키가 올바르지 않습니다. [AI 연결]에서 다시 입력해 주세요."), false, st); }
        if st == 402 { return (e("usage_limit", "오픈라우터 계정의 무료 사용 조건이 막혔습니다. openrouter.ai 에서 계정 상태를 확인해 주세요."), false, st); }
        (e("api", format!("오픈라우터 오류 {st}: {}", msg.chars().take(200).collect::<String>())), st == 429 || st == 404 || st >= 500, st)
    }
    fn call_once(key: &str, model: &str, system: &str, messages: &[Msg]) -> Result<String, (LlmErr, bool, u16)> {
        let req = ureq::post(&format!("{}/chat/completions", api())).set("content-type", "application/json").set("authorization", &format!("Bearer {key}"))
            .set("HTTP-Referer", "https://github.com/hahadark/sermon-shorts").set("X-Title", "SermonShorts").timeout(timeout(600));
        let (st, text) = http(req, Some(&body(model, system, messages).to_string())).map_err(|m| (e("network", format!("오픈라우터에 연결하지 못했습니다: {m}")), false, 0))?;
        let data: Value = serde_json::from_str(&text).unwrap_or(json!({}));
        let ok = (200..300).contains(&st);
        if !ok || !data["error"].is_null() { return Err(error_of(ok, st, &data)); }
        let t = data["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
        if t.trim().is_empty() { return Err((e("api", "오픈라우터 모델이 빈 답을 보냈습니다"), true, 0)); }
        Ok(t)
    }
    pub fn complete(key: &str, system: &str, messages: &[Msg], model: Option<&str>) -> Result<String, LlmErr> {
        if key.is_empty() { return Err(e("auth", "오픈라우터 키가 없습니다. [AI 연결]에서 키를 입력해 주세요.")); }
        let mut tried = vec![model.unwrap_or(DEFAULT_MODEL).to_string()];
        let mut last: Option<(LlmErr, bool, u16)> = None;
        for i in 0..3 {
            match call_once(key, &tried[i], system, messages) {
                Ok(t) => return Ok(t),
                Err(er) => {
                    let retry = er.1;
                    last = Some(er);
                    if !retry { break; }
                    let Some(next) = free_models().into_iter().find(|id| !tried.contains(id)) else { break };
                    tried.push(next);
                }
            }
        }
        let (er, _, st) = last.unwrap();
        if st == 429 { return Err(e("usage_limit", "오픈라우터 무료 모델이 지금 붐빕니다(하루 무료 횟수를 다 썼을 수도 있습니다). 잠시 뒤 다시 하거나 다른 AI 로 바꿔 주세요.")); }
        Err(er)
    }
}

// ---------------------------------------------------------------- 클로드 (Claude Code)

pub mod claude {
    use super::*;
    use std::io::{Read, Write};
    pub const INSTALL_WIN: &str = "irm https://claude.ai/install.ps1 | iex";

    fn candidates() -> Vec<PathBuf> {
        let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map(PathBuf::from).unwrap_or_default();
        let mut l = vec![];
        if cfg!(windows) {
            l.push(home.join(".local").join("bin").join("claude.exe"));
            if let Ok(la) = std::env::var("LOCALAPPDATA") { l.push(PathBuf::from(la).join("Microsoft").join("WinGet").join("Links").join("claude.exe")); }
            if let Ok(ad) = std::env::var("APPDATA") { l.push(PathBuf::from(ad).join("npm").join("claude.cmd")); }
        } else {
            l.extend([home.join(".local/bin/claude"), "/opt/homebrew/bin/claude".into(), "/usr/local/bin/claude".into(), home.join(".npm-global/bin/claude")]);
        }
        let exes: &[&str] = if cfg!(windows) { &["claude.exe", "claude.cmd"] } else { &["claude"] };
        for d in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) { for x in exes { if !d.as_os_str().is_empty() { l.push(d.join(x)); } } }
        l
    }
    pub fn find() -> Option<PathBuf> { candidates().into_iter().find(|p| p.is_file()) }

    fn cmd(bin: &Path) -> std::process::Command {
        // npm 설치본(claude.cmd)은 셸로 실행해야 한다
        if bin.extension().is_some_and(|x| x.eq_ignore_ascii_case("cmd")) { let mut c = crate::media::command("cmd"); c.arg("/c").arg(bin); c } else { crate::media::command_path(bin) }
    }
    /// 실행해서 (끝 코드, 표준 출력, 오류 출력). 시간이 지나면 멈춘다
    fn run(bin: &Path, args: &[String], input: Option<&str>, secs: u64) -> Result<(i32, String, String), LlmErr> {
        use std::process::Stdio;
        let mut c = cmd(bin);
        c.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = c.spawn().map_err(|er| e("not_installed", format!("클로드 실행 실패: {er}")))?;
        let mut stdin = child.stdin.take().unwrap();
        let inp = input.unwrap_or("").to_string();
        let w = std::thread::spawn(move || { let _ = stdin.write_all(inp.as_bytes()); });
        let mut so = child.stdout.take().unwrap();
        let mut se = child.stderr.take().unwrap();
        let ro = std::thread::spawn(move || { let mut b = Vec::new(); let _ = so.read_to_end(&mut b); b });
        let re = std::thread::spawn(move || { let mut b = Vec::new(); let _ = se.read_to_end(&mut b); b });
        let t0 = std::time::Instant::now();
        let code = loop {
            if let Ok(Some(s)) = child.try_wait() { break s.code().unwrap_or(-1); }
            if t0.elapsed().as_secs() > secs {
                kill_tree(&mut child);
                return Err(e("timeout", "클로드 응답 시간이 너무 깁니다. 잠시 뒤 다시 해 주세요."));
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        let _ = w.join();
        let out = String::from_utf8_lossy(&ro.join().unwrap_or_default()).into_owned();
        let err = String::from_utf8_lossy(&re.join().unwrap_or_default()).into_owned();
        Ok((code, out, err))
    }
    fn kill_tree(child: &mut std::process::Child) {
        #[cfg(windows)] { let _ = crate::media::command("taskkill").args(["/pid", &child.id().to_string(), "/t", "/f"]).status(); }
        let _ = child.kill();
    }

    /// { installed, loggedIn, method, version, path }
    pub fn status() -> ClaudeStatus {
        let Some(bin) = find() else { return ClaudeStatus::default() };
        let version = run(&bin, &["--version".into()], None, 15).map(|r| r.1.trim().to_string()).unwrap_or_default();
        let info: Value = run(&bin, &["auth".into(), "status".into()], None, 20).ok().and_then(|r| serde_json::from_str(r.1.trim()).ok()).unwrap_or(json!({}));
        let method = info["authMethod"].as_str().unwrap_or("none").to_string();
        ClaudeStatus { installed: true, logged_in: info["loggedIn"].as_bool() == Some(true) && method != "none", method, version, path: bin.display().to_string() }
    }

    /// Windows 터미널(wt.exe). 옛 명령 창에서는 클로드 로그인 화면에 코드를 붙여 넣을 수 없는 경우가 있어 있으면 그 창으로 연다
    pub fn windows_terminal() -> Option<PathBuf> {
        let p = PathBuf::from(std::env::var("LOCALAPPDATA").ok()?).join("Microsoft").join("WindowsApps").join("wt.exe");
        std::fs::symlink_metadata(&p).ok().map(|_| p) // 앱 실행 별칭이라 metadata 대신 symlink_metadata
    }
    /// PowerShell 명령을 새 창에서 (UTF-16 Base64 로 넘겨 터미널이 따옴표·세미콜론을 해석하지 않게). 연 방식을 돌려준다
    pub fn open_powershell_window(title: &str, script: &str) -> Result<&'static str, String> {
        use base64::Engine;
        let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let enc = base64::engine::general_purpose::STANDARD.encode(utf16);
        let args = ["-NoExit", "-NoProfile", "-EncodedCommand", enc.as_str()];
        if let Some(wt) = windows_terminal() {
            if std::process::Command::new(&wt).args(["-w", "new", "new-tab", "--title", title, "powershell.exe"]).args(args).spawn().is_ok() { return Ok("wt"); }
        }
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("cmd.exe").raw_arg(format!("/c start \"{title}\" powershell.exe")).args(args).spawn().map_err(|er| er.to_string())?;
            Ok("conhost")
        }
        #[cfg(not(windows))] { let _ = args; Err("Windows 에서만 됩니다.".into()) }
    }
    fn ps_quote(s: &str) -> String { format!("'{}'", s.replace('\'', "''")) }

    /// 공식 설치 명령을 새 창에서 (진행 상황을 사용자가 본다)
    pub fn open_install() -> Result<(), String> {
        if cfg!(windows) {
            open_powershell_window("Claude Code 설치", &format!("Write-Host 'Claude Code 공식 설치를 시작합니다...'; {INSTALL_WIN}; Write-Host ''; Write-Host '설치가 끝났습니다. 이 창을 닫고 SermonShorts에서 [다시 확인]을 누르세요.'"))?;
            Ok(())
        } else { Err("터미널에서 직접 설치해 주세요: curl -fsSL https://claude.ai/install.sh | bash".into()) }
    }
    /// 공식 로그인(claude auth login)을 새 창에서
    pub fn open_login() -> Result<(), String> {
        let Some(bin) = find() else { return Err("Claude Code 가 설치되어 있지 않습니다. 먼저 설치해 주세요.".into()) };
        if cfg!(windows) {
            open_powershell_window("Claude 로그인", &format!("Write-Host '브라우저에서 클로드 계정으로 로그인하세요. 코드를 붙여 넣으라고 하면 Ctrl+V 또는 마우스 오른쪽 클릭으로 붙여 넣습니다.'; Write-Host ''; & {} auth login; Write-Host ''; Write-Host '로그인이 끝났습니다. 이 창을 닫고 SermonShorts에서 [다시 확인]을 누르세요.'", ps_quote(&bin.display().to_string())))?;
            Ok(())
        } else { Err("터미널에서 다음을 실행해 로그인해 주세요: claude auth login".into()) }
    }
    /// 대화를 한 글로 합치기 (기존 completeOnce)
    pub fn convo(messages: &[Msg]) -> String {
        messages.iter().map(|m| format!("{}{}", if m.role == "assistant" { "[편집자(이전 답)]\n" } else { "[사용자]\n" }, m.content)).collect::<Vec<_>>().join("\n\n")
    }
    /// stream-json 의 result 줄 찾기
    pub fn result_of(out: &str) -> Option<Value> {
        let mut r = None;
        for l in out.lines() { let l = l.trim(); if l.starts_with('{') { if let Ok(o) = serde_json::from_str::<Value>(l) { if o["type"] == "result" { r = Some(o); } } } }
        r
    }
    pub fn complete(system: &str, messages: &[Msg], model: Option<&str>) -> Result<String, LlmErr> {
        match complete_once(system, messages, model, false) {
            Ok(t) => Ok(t),
            Err(er) if ["not_installed", "auth", "usage_limit", "cancelled"].contains(&er.code.as_str()) => Err(er),
            Err(_) => complete_once(system, messages, model, false), // 일시적인 오류는 한 번 더
        }
    }
    fn complete_once(system: &str, messages: &[Msg], model: Option<&str>, no_effort: bool) -> Result<String, LlmErr> {
        let Some(bin) = find() else { return Err(e("not_installed", "Claude Code 가 설치되어 있지 않습니다. [AI 연결]에서 설치해 주세요.")) };
        let tmp = std::env::temp_dir().join(format!("ss-claude-system-{}-{}.txt", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)));
        std::fs::write(&tmp, system).map_err(|er| e("io", er.to_string()))?;
        let effort = std::env::var("SS_CLAUDE_EFFORT").unwrap_or_else(|_| "medium".into());
        let mut base: Vec<String> = ["-p", "--tools", "", "--no-session-persistence", "--system-prompt-file"].iter().map(|s| s.to_string()).collect();
        base.push(tmp.display().to_string());
        if let Some(m) = model { base.push("--model".into()); base.push(m.into()); }
        if !no_effort && !effort.is_empty() && effort != "default" { base.push("--effort".into()); base.push(effort); }
        let input = convo(messages);
        let mut args: Vec<String> = ["--output-format", "stream-json", "--verbose", "--include-partial-messages"].iter().map(|s| s.to_string()).collect();
        args.extend(base.iter().cloned());
        let r = run(&bin, &args, Some(&input), 6 * 60);
        let _ = std::fs::remove_file(&tmp);
        let (_, out, err) = r?;
        let mut data = result_of(&out);
        let unk = regex::RegexBuilder::new("unknown|invalid|error").case_insensitive(true).build().unwrap();
        if data.is_none() && !no_effort && err.to_lowercase().contains("effort") && unk.is_match(&err) { return complete_once(system, messages, model, true); }
        if data.is_none() && regex::Regex::new("(?i)unknown option|include-partial-messages|stream-json|--verbose").unwrap().is_match(&err) {
            // 옛 Claude Code: 한 번에 받기
            std::fs::write(&tmp, system).map_err(|er| e("io", er.to_string()))?;
            let mut a2: Vec<String> = vec!["--output-format".into(), "json".into()];
            a2.extend(base.iter().cloned());
            let r2 = run(&bin, &a2, Some(&input), 6 * 60);
            let _ = std::fs::remove_file(&tmp);
            let (_, o2, _) = r2?;
            data = serde_json::from_str(o2.trim()).ok();
        }
        let Some(d) = data else {
            let m = if err.trim().is_empty() { out.trim().to_string() } else { err.trim().to_string() };
            if regex::Regex::new("(?i)login|log in|auth|인증|로그인").unwrap().is_match(&m) { return Err(e("auth", "클로드에 로그인되어 있지 않습니다. [AI 연결]에서 로그인해 주세요.")); }
            return Err(e("api", format!("클로드 실행 실패: {}", m.chars().take(300).collect::<String>())));
        };
        if d["is_error"].as_bool() == Some(true) || d["subtype"].as_str().is_some_and(|s| s != "success") {
            let m = d["result"].as_str().map(String::from).or_else(|| d["error"].as_str().map(String::from))
                .or_else(|| d["errors"].as_array().map(|a| a.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect::<Vec<_>>().join(" ")).filter(|s| !s.is_empty()))
                .or_else(|| d["subtype"].as_str().map(String::from)).unwrap_or_else(|| "알 수 없는 오류".into());
            if regex::Regex::new("(?i)limit|한도|usage").unwrap().is_match(&m) { return Err(e("usage_limit", "클로드 사용 한도에 도달했습니다. 잠시 뒤 다시 하거나 다른 AI 로 바꿔 주세요.")); }
            if regex::Regex::new("(?i)login|auth|credential").unwrap().is_match(&m) { return Err(e("auth", "클로드에 로그인되어 있지 않습니다. [AI 연결]에서 로그인해 주세요.")); }
            return Err(e("api", format!("클로드 오류: {}", m.chars().take(300).collect::<String>())));
        }
        Ok(d["result"].as_str().unwrap_or("").to_string())
    }
}

// ---------------------------------------------------------------- 챗GPT (Sign in with ChatGPT)

pub mod chatgpt {
    use super::*;
    use base64::Engine;
    use sha2::Digest;
    const B64URL: base64::engine::GeneralPurpose = base64::engine::general_purpose::URL_SAFE_NO_PAD;

    pub const ISSUER: &str = "https://auth.openai.com";
    pub const RESOURCE: &str = "https://api.openai.com/v1";
    pub const NEW_CLIENT_ID: &str = "dynamic_agent_client";
    pub const AGENT_NAME: &str = "SermonShorts";
    pub const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
    pub const SCOPES: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
    pub const CALLBACK_PATH: &str = "/auth/callback";
    pub const PREFERRED_PORT: u16 = 1455;
    const REFRESH_MARGIN_S: i64 = 120;
    fn auth_base() -> String { api_base("SS_CHATGPT_AUTH", "https://auth.openai.com") }
    fn api() -> String { api_base("SS_CHATGPT_API", "https://api.openai.com/v1") }
    pub fn authorize_url() -> String { format!("{}/api/accounts/authorize", auth_base()) }
    fn token_url() -> String { format!("{}/api/accounts/oauth/token", auth_base()) }
    fn oidc_url() -> String { format!("{}/.well-known/openid-configuration", auth_base()) }

    fn now_s() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) }
    pub fn random_token(bytes: usize) -> String { let mut b = vec![0u8; bytes]; let _ = getrandom::getrandom(&mut b); B64URL.encode(b) }
    pub fn pkce_challenge(verifier: &str) -> String { B64URL.encode(sha2::Sha256::digest(verifier.as_bytes())) }
    pub fn new_host_id() -> String {
        let mut b = [0u8; 16]; let _ = getrandom::getrandom(&mut b);
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
        format!("urn:uuid:{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
    }
    pub fn redirect_uri_for(port: u16) -> String { format!("http://127.0.0.1:{port}{CALLBACK_PATH}") }

    pub struct AuthorizeArgs<'a> { pub client_id: Option<&'a str>, pub host_id: &'a str, pub redirect_uri: &'a str, pub state: &'a str, pub nonce: &'a str, pub code_challenge: &'a str, pub id_token_hint: Option<&'a str>, pub login_hint: Option<&'a str>, pub is_new: bool }
    /// 기존 buildAuthorizeUrl
    pub fn build_authorize_url(a: &AuthorizeArgs) -> Result<String, String> {
        if a.host_id.is_empty() { return Err("ext_agent_host_id 가 없습니다.".into()); }
        if !regex::Regex::new(r"^http://127\.0\.0\.1:\d+/auth/callback$").unwrap().is_match(a.redirect_uri) { return Err("잘못된 redirect_uri 입니다.".into()); }
        if a.state.is_empty() || a.nonce.is_empty() || a.code_challenge.is_empty() { return Err("state/nonce/PKCE 값이 필요합니다.".into()); }
        let fresh = a.is_new || a.client_id.is_none_or(|c| c.is_empty());
        let mut p: Vec<(&str, &str)> = vec![("client_id", if fresh { NEW_CLIENT_ID } else { a.client_id.unwrap() })];
        if fresh { p.push(("agent_name_hint", AGENT_NAME)); }
        p.push(("ext_agent_host_id", a.host_id));
        if !fresh { if let Some(h) = a.id_token_hint.filter(|s| !s.is_empty()) { p.push(("id_token_hint", h)); } }
        if !fresh { if let Some(h) = a.login_hint.filter(|s| !s.is_empty()) { p.push(("login_hint", h)); } }
        p.extend([("response_type", "code"), ("redirect_uri", a.redirect_uri), ("scope", SCOPES), ("resource", RESOURCE), ("state", a.state), ("nonce", a.nonce), ("code_challenge_method", "S256"), ("code_challenge", a.code_challenge)]);
        Ok(format!("{}?{}", authorize_url(), form_encode(&p)))
    }

    /// 콜백 해석: (code, client_id, scope). 오류 code 는 기존 AuthError.code
    pub fn parse_callback(url: &str, state: &str, is_new: bool, client_id: Option<&str>) -> Result<(String, String, String), LlmErr> {
        let q = url.split_once('?').map(|x| x.1).unwrap_or("");
        let q = q.split('#').next().unwrap_or("");
        let params: Vec<(String, String)> = q.split('&').filter(|s| !s.is_empty()).map(|kv| { let (k, v) = kv.split_once('=').unwrap_or((kv, "")); (form_decode(k), form_decode(v)) }).collect();
        let get = |k: &str| params.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone());
        if get("state").as_deref() != Some(state) || state.is_empty() { return Err(e("state", "로그인 확인값(state)이 맞지 않습니다. 다시 시도해 주세요.")); }
        if let Some(er) = get("error") {
            if er == "access_denied" { return Err(e("denied", "ChatGPT 로그인 또는 요금제 사용 허용이 취소되었습니다.")); }
            if !er.is_empty() { return Err(e("oauth", format!("ChatGPT 로그인 오류: {er}"))); }
        }
        let Some(code) = get("code").filter(|c| !c.is_empty()) else { return Err(e("oauth", "로그인 코드가 없습니다. 다시 시도해 주세요.")) };
        let cb = get("client_id").filter(|c| !c.is_empty());
        let cid = if is_new || client_id.is_none_or(|c| c.is_empty()) {
            match cb { Some(c) if c != NEW_CLIENT_ID => c, _ => return Err(e("registration", "앱 등록이 끝나지 않았습니다(client_id 없음). 다시 시도해 주세요.")) }
        } else {
            let pc = client_id.unwrap();
            if cb.as_deref().is_some_and(|c| c != pc) { return Err(e("client_mismatch", "다른 앱 등록으로 돌아왔습니다. 다시 시도해 주세요.")); }
            pc.to_string()
        };
        Ok((code, cid, get("scope").unwrap_or_default()))
    }
    pub fn token_form(client_id: &str, code: &str, verifier: &str, redirect_uri: &str) -> String {
        form_encode(&[("grant_type", "authorization_code"), ("client_id", client_id), ("code", code), ("code_verifier", verifier), ("redirect_uri", redirect_uri), ("resource", RESOURCE)])
    }
    pub fn refresh_form(client_id: &str, refresh_token: &str) -> String {
        form_encode(&[("grant_type", "refresh_token"), ("client_id", client_id), ("refresh_token", refresh_token), ("resource", RESOURCE)])
    }
    pub fn revoke_form(client_id: &str, refresh_token: &str) -> String {
        form_encode(&[("token", refresh_token), ("token_type_hint", "refresh_token"), ("client_id", client_id)])
    }
    pub fn parse_scopes(v: &Value) -> Vec<String> {
        if let Some(a) = v.as_array() { return a.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect(); }
        regex::Regex::new(r"[\s+]+").unwrap().split(v.as_str().unwrap_or("")).filter(|s| !s.is_empty()).map(String::from).collect()
    }
    pub fn has_plan_scope(v: &Value) -> bool { parse_scopes(v).iter().any(|s| s == PLAN_SCOPE) }

    // ---- ID 토큰 (RS256) ----
    fn b64url_decode(s: &str) -> Option<Vec<u8>> { B64URL.decode(s.trim_end_matches('=')).ok() }
    pub fn decode_jwt(token: &str) -> Result<(Value, Value, String, Vec<u8>), LlmErr> {
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 { return Err(e("id_token", "ID 토큰 형식이 잘못되었습니다.")); }
        let rd = |s: &str| b64url_decode(s).and_then(|b| serde_json::from_slice::<Value>(&b).ok());
        let (Some(h), Some(p)) = (rd(parts[0]), rd(parts[1])) else { return Err(e("id_token", "ID 토큰을 읽을 수 없습니다.")) };
        Ok((h, p, format!("{}.{}", parts[0], parts[1]), b64url_decode(parts[2]).unwrap_or_default()))
    }
    /// RSA PKCS#1 v1.5 + SHA-256 서명 확인
    pub fn rsa_verify(n: &[u8], ev: &[u8], msg: &[u8], sig: &[u8]) -> bool {
        use num_bigint::BigUint;
        let (n, ev, s) = (BigUint::from_bytes_be(n), BigUint::from_bytes_be(ev), BigUint::from_bytes_be(sig));
        if s >= n { return false; }
        let k = n.to_bytes_be().len();
        let m = s.modpow(&ev, &n).to_bytes_be();
        if m.len() + 1 != k && m.len() != k { return false; }
        let mut em = vec![0u8; k - m.len()]; em.extend(m);
        const DI: [u8; 19] = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20];
        let h = sha2::Sha256::digest(msg);
        let tlen = DI.len() + h.len();
        if k < tlen + 11 { return false; }
        let mut want = vec![0x00, 0x01]; want.extend(std::iter::repeat_n(0xffu8, k - tlen - 3)); want.push(0x00); want.extend(DI); want.extend(h.as_slice());
        em == want
    }
    pub fn verify_jwt(token: &str, jwks: &Value) -> Result<Value, LlmErr> {
        let (h, p, input, sig) = decode_jwt(token)?;
        if h["alg"] != "RS256" { return Err(e("id_token", format!("지원하지 않는 서명 방식입니다: {}", h["alg"].as_str().unwrap_or("")))); }
        let keys: Vec<&Value> = jwks["keys"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
        let cands: Vec<&Value> = match h["kid"].as_str() { Some(kid) => keys.into_iter().filter(|k| k["kid"] == kid).collect(), None => keys.into_iter().filter(|k| k["kty"] == "RSA").collect() };
        if cands.is_empty() { return Err(e("id_token", "ID 토큰 서명 키를 찾지 못했습니다.")); }
        for k in cands {
            if let (Some(n), Some(ev)) = (k["n"].as_str().and_then(b64url_decode), k["e"].as_str().and_then(b64url_decode)) {
                if rsa_verify(&n, &ev, input.as_bytes(), &sig) { return Ok(p); }
            }
        }
        Err(e("id_token", "ID 토큰 서명이 올바르지 않습니다."))
    }
    /// claims 검증: (sub, email, name)
    pub fn validate_id_token(c: &Value, audience: &str, nonce: Option<&str>, now: i64) -> Result<(String, String, String), LlmErr> {
        let skew = 120;
        if !c.is_object() { return Err(e("id_token", "ID 토큰 내용이 없습니다.")); }
        if c["iss"].as_str().unwrap_or("").trim_end_matches('/') != ISSUER.trim_end_matches('/') { return Err(e("id_token", "ID 토큰 발급자가 다릅니다.")); }
        let aud: Vec<String> = match &c["aud"] { Value::Array(a) => a.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect(), v => vec![v.as_str().unwrap_or("").to_string()] };
        if audience.is_empty() || !aud.iter().any(|a| a == audience) { return Err(e("id_token", "ID 토큰 대상(client_id)이 다릅니다.")); }
        if c["aud"].as_array().is_some_and(|a| a.len() > 1) && c["azp"].as_str().is_some_and(|z| !z.is_empty() && z != audience) { return Err(e("id_token", "ID 토큰 대상(azp)이 다릅니다.")); }
        match c["exp"].as_f64() { Some(x) if x + skew as f64 >= now as f64 => {}, _ => return Err(e("id_token", "ID 토큰이 만료되었습니다. 다시 로그인해 주세요.")) }
        if let Some(n) = nonce { if c["nonce"].as_str() != Some(n) { return Err(e("id_token", "로그인 확인값(nonce)이 맞지 않습니다.")); } }
        let sub = c["sub"].as_str().unwrap_or("");
        if sub.is_empty() { return Err(e("id_token", "ID 토큰에 계정 정보(sub)가 없습니다.")); }
        Ok((sub.into(), c["email"].as_str().unwrap_or("").into(), c["name"].as_str().unwrap_or("").into()))
    }

    // ---- 대화 ----
    pub fn responses_body(model: &str, instructions: &str, messages: &[Msg]) -> Result<Value, String> {
        if model.is_empty() { return Err("모델이 정해지지 않았습니다.".into()); }
        let input: Vec<Value> = messages.iter().filter(|m| (m.role == "user" || m.role == "assistant") && !m.content.is_empty()).map(|m| json!({ "role": m.role, "content": m.content })).collect();
        if input.is_empty() { return Err("보낼 메시지가 없습니다.".into()); }
        let mut b = json!({ "model": model, "input": input, "store": false, "stream": true });
        if !instructions.is_empty() { b["instructions"] = json!(instructions); }
        Ok(b)
    }
    #[derive(Debug, Default, Clone)]
    pub struct Sse { pub text: String, pub completed: bool, pub failed: Option<(String, String)>, pub incomplete: Option<String>, pub events: usize }
    /// 기존 createSSEParser (조각 경계를 넘어도 된다)
    #[derive(Default)]
    pub struct SseParser { buf: String, pub st: Sse }
    impl SseParser {
        pub fn feed(&mut self, chunk: &str) {
            self.buf.push_str(chunk);
            let re = regex::Regex::new(r"\r?\n\r?\n").unwrap();
            while let Some(m) = re.find(&self.buf) { let block = self.buf[..m.start()].to_string(); self.buf = self.buf[m.end()..].to_string(); self.handle(&block); }
        }
        pub fn end(mut self) -> Sse { if !self.buf.trim().is_empty() { let b = std::mem::take(&mut self.buf); self.handle(&b); } self.st }
        fn handle(&mut self, block: &str) {
            let (mut ev, mut data) = (String::new(), Vec::<String>::new());
            for line in block.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)) {
                if line.is_empty() || line.starts_with(':') { continue; }
                let (field, mut val) = match line.find(':') { Some(i) => (&line[..i], &line[i + 1..]), None => (line, "") };
                if let Some(v) = val.strip_prefix(' ') { val = v; }
                if field == "event" { ev = val.to_string(); } else if field == "data" { data.push(val.to_string()); }
            }
            if data.is_empty() { return; }
            let raw = data.join("\n");
            if raw == "[DONE]" { return; }
            let Ok(o) = serde_json::from_str::<Value>(&raw) else { return };
            let ty = o["type"].as_str().map(String::from).unwrap_or(ev);
            self.st.events += 1;
            match ty.as_str() {
                "response.output_text.delta" => { if let Some(d) = o["delta"].as_str() { self.st.text.push_str(d); } }
                "response.completed" => self.st.completed = true,
                "response.failed" => { let er = if o["response"]["error"].is_object() { &o["response"]["error"] } else { &o["error"] }; self.st.failed = Some((er["code"].as_str().unwrap_or("unknown_error").into(), er["message"].as_str().unwrap_or("").into())); }
                "response.incomplete" => { self.st.incomplete = Some(o["response"]["incomplete_details"]["reason"].as_str().unwrap_or("incomplete").into()); }
                "error" => { self.st.failed = Some((o["code"].as_str().or(o["error"]["code"].as_str()).unwrap_or("error").into(), o["message"].as_str().or(o["error"]["message"].as_str()).unwrap_or("").into())); }
                _ => {}
            }
        }
    }
    pub fn is_usage_limit_code(c: &str) -> bool { ["subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable", "usage_limit_exceeded", "rate_limit_exceeded", "insufficient_quota"].contains(&c) }
    pub fn pick_listed_models(j: &Value) -> Vec<(String, String)> {
        let arr = j["models"].as_array().or(j["data"].as_array()).cloned().unwrap_or_default();
        arr.iter().filter(|m| m["visibility"].is_null() || m["visibility"] == "list")
            .map(|m| { let slug = m["slug"].as_str().or(m["id"].as_str()).unwrap_or("").to_string(); (slug.clone(), m["display_name"].as_str().map(String::from).unwrap_or(slug)) })
            .filter(|(s, _)| !s.is_empty()).collect()
    }

    // ---- 저장소: userData/llm/chatgpt.json (Electron safeStorage 와 같은 잠금) ----
    pub fn store_file() -> PathBuf { crate::theme::user_data_dir().join("llm").join("chatgpt.json") }
    pub fn load() -> Value {
        let Ok(raw) = std::fs::read_to_string(store_file()) else { return json!({}) };
        if raw.trim().is_empty() { return json!({}); }
        crate::secret::decrypt(raw.trim()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}))
    }
    pub fn save(v: &Value) -> Result<(), LlmErr> {
        let f = store_file();
        if let Some(d) = f.parent() { let _ = std::fs::create_dir_all(d); }
        let enc = crate::secret::encrypt(&v.to_string()).map_err(|er| e("storage", format!("이 컴퓨터에서 로그인 정보를 안전하게 저장할 수 없습니다: {er}")))?;
        let tmp = f.with_extension(format!("json.{}.tmp", std::process::id()));
        std::fs::write(&tmp, enc).and_then(|_| std::fs::rename(&tmp, &f)).map_err(|er| e("storage", er.to_string()))
    }
    pub fn public_status(s: &Value) -> GptStatus {
        let has = |k: &str| s[k].as_str().is_some_and(|x| !x.is_empty());
        GptStatus { connected: has("access_token") || has("refresh_token"), email: s["email"].as_str().unwrap_or("").into(), plan_enabled: s["planEnabled"].as_bool() == Some(true), model: s["model"].as_str().unwrap_or("").into(), error: String::new() }
    }
    pub fn status() -> GptStatus { public_status(&load()) }
    fn iso_now() -> String {
        let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        let (secs, mil) = (ms.div_euclid(1000), ms.rem_euclid(1000));
        let (y, mo, d) = crate::youtube::civil_from_days(secs.div_euclid(86400));
        let t = secs.rem_euclid(86400);
        format!("{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}.{mil:03}Z", t / 3600, t / 60 % 60, t % 60)
    }
    fn save_tokens(store: &mut Value, tok: &Value, extra: &Value) -> Result<(), LlmErr> {
        let now = now_s();
        store["access_token"] = tok["access_token"].clone();
        if tok["refresh_token"].as_str().is_some_and(|s| !s.is_empty()) { store["refresh_token"] = tok["refresh_token"].clone(); }
        if tok["id_token"].as_str().is_some_and(|s| !s.is_empty()) { store["id_token"] = tok["id_token"].clone(); }
        store["token_type"] = json!(tok["token_type"].as_str().filter(|s| !s.is_empty()).unwrap_or("Bearer"));
        let ein = tok["expires_in"].as_f64().filter(|x| *x != 0.0).unwrap_or(3600.0);
        store["expires_in"] = json!(ein);
        store["expires_at"] = json!(now + ein as i64);
        if tok["scope"].as_str().is_some_and(|s| !s.is_empty()) { store["scopes"] = json!(parse_scopes(&tok["scope"])); }
        store["saved_at"] = json!(iso_now());
        if let Some(o) = extra.as_object() { for (k, v) in o { store[k] = v.clone(); } }
        save(store)
    }
    fn post_form(url: &str, form: &str) -> Result<(u16, Value), LlmErr> {
        let req = ureq::post(url).set("Content-Type", "application/x-www-form-urlencoded").set("Accept", "application/json").timeout(timeout(60));
        let (st, t) = http(req, Some(form)).map_err(|m| e("network", format!("ChatGPT 로그인 서버에 연결하지 못했습니다: {m}")))?;
        Ok((st, serde_json::from_str(&t).unwrap_or(Value::Null)))
    }
    fn oidc() -> Result<Value, LlmErr> {
        let (st, t) = http(ureq::get(&oidc_url()).timeout(timeout(30)), None).map_err(|m| e("network", format!("ChatGPT 로그인 서버에 연결하지 못했습니다 ({m}).")))?;
        if st != 200 { return Err(e("network", format!("ChatGPT 로그인 서버에 연결하지 못했습니다 ({st})."))); }
        Ok(serde_json::from_str(&t).unwrap_or(json!({})))
    }
    fn jwks() -> Result<Value, LlmErr> {
        let cfg = oidc()?;
        let (st, t) = http(ureq::get(cfg["jwks_uri"].as_str().unwrap_or("")).timeout(timeout(30)), None).map_err(|m| e("network", format!("로그인 서명 키를 받지 못했습니다 ({m}).")))?;
        if st != 200 { return Err(e("network", format!("로그인 서명 키를 받지 못했습니다 ({st})."))); }
        Ok(serde_json::from_str(&t).unwrap_or(json!({})))
    }

    fn do_refresh(store: &mut Value) -> Result<(), LlmErr> {
        let (rt, cid) = (store["refresh_token"].as_str().unwrap_or("").to_string(), store["client_id"].as_str().unwrap_or("").to_string());
        if rt.is_empty() || cid.is_empty() { return Err(e("auth", "ChatGPT 로그인이 필요합니다.")); }
        let (st, j) = post_form(&token_url(), &refresh_form(&cid, &rt))?;
        if !(200..300).contains(&st) || j["access_token"].as_str().is_none_or(|s| s.is_empty()) {
            if st == 400 || st == 401 {
                if let Some(o) = store.as_object_mut() { o.remove("access_token"); o.remove("refresh_token"); }
                save(store)?;
                return Err(e("auth", "ChatGPT 로그인이 만료되었습니다. 다시 로그인해 주세요."));
            }
            return Err(e("network", format!("ChatGPT 로그인 갱신에 실패했습니다 ({st}).")));
        }
        let scopes: Vec<String> = if j["scope"].as_str().is_some_and(|s| !s.is_empty()) { parse_scopes(&j["scope"]) } else { parse_scopes(&store["scopes"]) };
        let mut tok = j.clone();
        tok["scope"] = json!(scopes.join(" "));
        save_tokens(store, &tok, &json!({ "planEnabled": scopes.iter().any(|s| s == PLAN_SCOPE) }))
    }
    fn refresh(force: bool) -> Result<Value, LlmErr> {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _g = LOCK.lock().unwrap();
        let mut store = load();
        if !force && store["access_token"].as_str().is_some_and(|s| !s.is_empty()) && store["expires_at"].as_i64().is_some_and(|x| x - now_s() > REFRESH_MARGIN_S) { return Ok(store); }
        do_refresh(&mut store)?;
        Ok(store)
    }
    fn token() -> Result<Value, LlmErr> {
        let store = load();
        let has = |k: &str| store[k].as_str().is_some_and(|x| !x.is_empty());
        if !has("access_token") && !has("refresh_token") { return Err(e("auth", "ChatGPT 로그인이 필요합니다.")); }
        if has("access_token") && store["expires_at"].as_i64().is_some_and(|x| x - now_s() > REFRESH_MARGIN_S) { return Ok(store); }
        refresh(false)
    }
    fn bearer(s: &Value) -> String { format!("Bearer {}", s["access_token"].as_str().unwrap_or("")) }

    pub fn list_models() -> Result<Vec<(String, String)>, LlmErr> {
        let mut store = token()?;
        let get = |s: &Value| http(ureq::get(&format!("{}/models", api())).set("Authorization", &bearer(s)).timeout(timeout(30)), None).map_err(|m| e("network", format!("ChatGPT 모델 목록을 받지 못했습니다 ({m}).")));
        let mut r = get(&store)?;
        if r.0 == 401 { store = refresh(true)?; r = get(&store)?; }
        if r.0 == 401 { return Err(e("auth", "ChatGPT 로그인이 만료되었습니다. 다시 로그인해 주세요.")); }
        if !(200..300).contains(&r.0) { return Err(e("network", format!("ChatGPT 모델 목록을 받지 못했습니다 ({}).", r.0))); }
        Ok(pick_listed_models(&serde_json::from_str(&r.1).unwrap_or(json!({}))))
    }
    pub fn error_from_response(status: u16, j: &Value) -> LlmErr {
        let code = j["error"]["code"].as_str().or(j["error"]["type"].as_str()).or(j["code"].as_str()).unwrap_or("");
        if is_usage_limit_code(code) || status == 429 { return e("usage_limit", "ChatGPT 사용 한도에 도달했습니다. ChatGPT 설정 > 사용량에서 확인해 주세요."); }
        if status == 403 { return e("plan", "ChatGPT 요금제 사용이 허용되지 않았습니다. ChatGPT Go·Plus·Pro 요금제인지 확인하고 다시 연결해 주세요."); }
        let m = j["error"]["message"].as_str().filter(|s| !s.is_empty()).map(|m| format!(": {}", m.chars().take(200).collect::<String>())).unwrap_or_default();
        e("api", format!("ChatGPT 요청이 실패했습니다 ({status}){m}"))
    }
    pub fn complete(instructions: &str, messages: &[Msg], model: Option<&str>) -> Result<String, LlmErr> {
        let mut store = token()?;
        if store["planEnabled"].as_bool() != Some(true) { return Err(e("plan", "ChatGPT 요금제 사용이 허용되지 않았습니다. 다시 연결하면서 \"ChatGPT 요금제 사용\"을 허용해 주세요.")); }
        let use_model = match model.map(String::from).or_else(|| store["model"].as_str().filter(|s| !s.is_empty()).map(String::from)) {
            Some(m) => m,
            None => list_models()?.into_iter().next().map(|x| x.0).ok_or_else(|| e("api", "사용할 수 있는 ChatGPT 모델이 없습니다."))?,
        };
        let body = responses_body(&use_model, instructions, messages).map_err(|m| e("api", m))?.to_string();
        let send = |s: &Value| http(ureq::post(&format!("{}/responses", api())).set("Authorization", &bearer(s)).set("Content-Type", "application/json").set("Accept", "text/event-stream").timeout(timeout(600)), Some(&body))
            .map_err(|m| e("network", format!("ChatGPT 에 연결하지 못했습니다: {m}")));
        let mut r = send(&store)?;
        if r.0 == 401 { store = refresh(true)?; r = send(&store)?; }
        if r.0 == 401 { return Err(e("auth", "ChatGPT 로그인이 만료되었습니다. 다시 로그인해 주세요.")); }
        if !(200..300).contains(&r.0) { return Err(error_from_response(r.0, &serde_json::from_str(&r.1).unwrap_or(json!({})))); }
        let mut p = SseParser::default();
        p.feed(&r.1);
        let st = p.end();
        if let Some((code, msg)) = &st.failed {
            if is_usage_limit_code(code) { return Err(e("usage_limit", "ChatGPT 사용 한도에 도달했습니다. ChatGPT 설정 > 사용량에서 확인해 주세요.")); }
            let m = if msg.is_empty() { String::new() } else { format!(": {}", msg.chars().take(200).collect::<String>()) };
            return Err(e("api", format!("ChatGPT 응답이 실패했습니다 ({code}){m}")));
        }
        if let Some(reason) = &st.incomplete { return Err(e("incomplete", format!("ChatGPT 응답이 중간에 끝났습니다 ({reason}). 다시 시도해 주세요."))); }
        if !st.completed { return Err(e("incomplete", "ChatGPT 응답이 끝까지 오지 않았습니다. 다시 시도해 주세요.")); }
        Ok(st.text)
    }

    fn result_page(ok: bool, msg: &str) -> String {
        let title = if ok { "로그인이 끝났습니다" } else { "로그인하지 못했습니다" };
        let body = if ok { "로그인이 끝났습니다. SermonShorts로 돌아가세요.".to_string() } else if msg.is_empty() { "다시 시도해 주세요.".into() } else { msg.to_string() };
        let body = body.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
        format!("<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><title>{title}</title>\n<style>body{{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;background:#f5f5f5}}\ndiv{{background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 2px 12px #0002;font-size:18px}}</style></head>\n<body><div>{body}</div></body></html>")
    }

    /// 로그인: 브라우저에서 챗GPT 로그인 → 이 PC 로 돌아온 코드로 토큰 (5분)
    pub fn sign_in() -> Result<GptStatus, LlmErr> {
        use std::io::{BufRead, BufReader, Write};
        static RUNNING: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let Ok(_g) = RUNNING.try_lock() else { return Err(e("busy", "이미 로그인 창이 열려 있습니다. 브라우저에서 로그인을 마쳐 주세요.")) };
        let mut store = load();
        if store["ext_agent_host_id"].as_str().is_none_or(|s| s.is_empty()) { store["ext_agent_host_id"] = json!(new_host_id()); save(&store)?; }
        let host = store["ext_agent_host_id"].as_str().unwrap_or("").to_string();
        let client_id = store["client_id"].as_str().filter(|s| !s.is_empty()).map(String::from);
        let is_new = client_id.is_none();
        let verifier = random_token(48);
        let (state, nonce) = (random_token(24), random_token(24));
        let listener = std::net::TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).or_else(|_| std::net::TcpListener::bind(("127.0.0.1", 0)))
            .map_err(|er| e("network", format!("로그인 창을 받을 준비를 하지 못했습니다: {er}")))?;
        let port = listener.local_addr().map(|a| a.port()).unwrap_or(PREFERRED_PORT);
        let redirect = redirect_uri_for(port);
        let url = build_authorize_url(&AuthorizeArgs { client_id: client_id.as_deref(), host_id: &host, redirect_uri: &redirect, state: &state, nonce: &nonce, code_challenge: &pkce_challenge(&verifier),
            id_token_hint: store["id_token"].as_str(), login_hint: store["email"].as_str(), is_new }).map_err(|m| e("oauth", m))?;
        crate::ytupload::open_url(&url);
        listener.set_nonblocking(true).ok();
        let t0 = std::time::Instant::now();
        let (code, cid, cb_scope) = loop {
            if t0.elapsed().as_secs() > 300 { return Err(e("timeout", "로그인 시간이 지났습니다(5분). 다시 시도해 주세요.")); }
            let (mut sock, _) = match listener.accept() { Ok(x) => x, Err(_) => { std::thread::sleep(std::time::Duration::from_millis(200)); continue; } };
            let _ = sock.set_nonblocking(false);
            let mut line = String::new();
            if BufReader::new(match sock.try_clone() { Ok(s) => s, Err(_) => continue }).read_line(&mut line).is_err() { continue; }
            let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
            if path.split('?').next() != Some(CALLBACK_PATH) { let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"); continue; }
            let reply = |sock: &mut std::net::TcpStream, ok: bool, m: &str| { let b = result_page(ok, m); let _ = sock.write_all(format!("HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{b}", if ok { "200 OK" } else { "400 Bad Request" }, b.len()).as_bytes()); };
            match parse_callback(&path, &state, is_new, client_id.as_deref()) {
                Ok(x) => { reply(&mut sock, true, ""); break x; }
                Err(er) => { reply(&mut sock, false, &er.msg); if er.code != "state" { return Err(er); } }
            }
        };
        let (st, tok) = post_form(&token_url(), &token_form(&cid, &code, &verifier, &redirect))?;
        if !(200..300).contains(&st) || tok["access_token"].as_str().is_none_or(|s| s.is_empty()) {
            let c = tok["error"].as_str().unwrap_or("");
            return Err(e("token", if c == "invalid_grant" { "로그인 코드가 만료되었습니다. 다시 시도해 주세요.".to_string() } else { format!("로그인 토큰을 받지 못했습니다 ({st}{}).", if c.is_empty() { String::new() } else { format!(", {c}") }) }));
        }
        let claims = verify_jwt(tok["id_token"].as_str().unwrap_or(""), &jwks()?)?;
        let (sub, email, name) = validate_id_token(&claims, &cid, Some(&nonce), now_s())?;
        if !is_new && store["subject"].as_str().is_some_and(|s| !s.is_empty() && s != sub) {
            return Err(e("account_mismatch", "처음 연결한 ChatGPT 계정과 다른 계정으로 로그인했습니다. 원래 계정으로 다시 로그인하거나, 연결을 끊고 새로 연결해 주세요."));
        }
        let cbv = json!(cb_scope);
        let scopes = parse_scopes(if tok["scope"].as_str().is_some_and(|s| !s.is_empty()) { &tok["scope"] } else { &cbv });
        let plan = scopes.iter().any(|s| s == PLAN_SCOPE);
        let mut t2 = tok.clone();
        t2["scope"] = json!(scopes.join(" "));
        save_tokens(&mut store, &t2, &json!({ "issuer": ISSUER, "client_id": cid, "subject": sub, "email": email, "name": name, "planEnabled": plan }))?;
        Ok(public_status(&store))
    }

    /// 연결 끊기: 갱신 토큰을 서버에서 무르고(두 번까지) 토큰만 지운다 (계정·앱 등록은 다음 로그인용으로 남긴다)
    pub fn sign_out() -> Result<(GptStatus, bool), LlmErr> {
        let mut store = load();
        let (rt, cid) = (store["refresh_token"].as_str().unwrap_or("").to_string(), store["client_id"].as_str().unwrap_or("").to_string());
        let mut revoked = true;
        if !rt.is_empty() && !cid.is_empty() {
            revoked = false;
            if let Ok(cfg) = oidc() {
                if let Some(u) = cfg["revocation_endpoint"].as_str() {
                    for _ in 0..2 {
                        match post_form(u, &revoke_form(&cid, &rt)) { Ok((st, _)) if (200..300).contains(&st) => { revoked = true; break; } Ok((st, _)) if st < 500 => break, _ => {} }
                    }
                }
            }
        }
        if let Some(o) = store.as_object_mut() { for k in ["access_token", "refresh_token", "id_token", "expires_at", "expires_in", "scopes", "planEnabled", "token_type", "saved_at"] { o.remove(k); } }
        save(&store)?;
        Ok((public_status(&store), revoked))
    }
}
