//! 유튜브 업로드 (기존 src/main/youtube-upload.js): 구글 로그인(설치형 앱 OAuth + PKCE) → 만든 MP4 를 내 채널에 올린다.
//! 로그인 정보(갱신 토큰)는 Electron 판과 같은 설정 키(ytRefreshEnc)에 같은 방식으로 잠가 둔다 — 두 판이 함께 쓴다.
use crate::{secret, theme};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64URL, Engine};
use serde_json::{json, Value};
use sha2::Digest;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const UPLOAD_URL: &str = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const CHANNEL_URL: &str = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";
const SCOPES: &str = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
pub const PRIVACY: [&str; 3] = ["private", "unlisted", "public"];
pub const MODES: [&str; 3] = ["review", "auto", "off"];

/// 시험 전용 가짜 업로드 (SS_TEST_YTFAKE 가 있을 때만, 실제로 올리지 않는다)
pub fn fake() -> bool { std::env::var("SS_TEST_YTFAKE").is_ok() }

pub struct Client { pub id: String, pub secret: String, pub own: bool }

/// 앱에 들어 있는 구글 OAuth 클라이언트 (assets/google-client.json — 저장소에는 넣지 않는다)
fn bundled_client() -> Option<Client> {
    const EMBEDDED: &str = include_str!(concat!(env!("OUT_DIR"), "/google_client.json"));
    let p = crate::assets_dir().join("google-client.json");
    let txt = std::fs::read_to_string(p).ok().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| EMBEDDED.to_string());
    let j: Value = serde_json::from_str(&txt).ok()?;
    let c = if j["installed"].is_object() { &j["installed"] } else { &j };
    let id = c["client_id"].as_str()?.to_string();
    Some(Client { id, secret: c["client_secret"].as_str().unwrap_or("").to_string(), own: false })
}
pub fn client(s: &Value) -> Option<Client> {
    if let Some(id) = s["ytClientId"].as_str().filter(|x| !x.is_empty()) { return Some(Client { id: id.into(), secret: secret::setting(s, "ytClientSecretEnc"), own: true }); }
    bundled_client()
}
fn refresh_token(s: &Value) -> String { secret::setting(s, "ytRefreshEnc") }

pub fn upload_mode(s: &Value) -> &'static str {
    match s["ytUploadMode"].as_str() { Some("review") => "review", Some("auto") => "auto", Some("off") => "off", _ => if s["ytAutoUpload"].as_bool() == Some(true) { "auto" } else { "review" } }
}

#[derive(Clone, Debug, Default)]
pub struct Status { pub has_client: bool, pub own_client: bool, pub logged_in: bool, pub channel: String, pub privacy: String, pub upload_mode: String }

pub fn status() -> Status {
    let s = theme::app_settings();
    let privacy = s["ytPrivacy"].as_str().filter(|p| PRIVACY.contains(p)).unwrap_or("unlisted").to_string();
    if fake() { return Status { has_client: true, own_client: false, logged_in: true, channel: "시험 채널".into(), privacy, upload_mode: upload_mode(&s).into() }; }
    let c = client(&s);
    Status { has_client: c.is_some(), own_client: c.as_ref().is_some_and(|c| c.own), logged_in: !refresh_token(&s).is_empty(), channel: s["ytChannel"].as_str().unwrap_or("").into(), privacy, upload_mode: upload_mode(&s).into() }
}

#[derive(Clone, Debug, Default)]
pub struct Meta { pub title: String, pub verse: String, pub church: String, pub speaker: String, pub privacy: String, pub credits: String, pub description: Option<String> }

/// 제목·설명 만들기 (youtube-upload.js buildMetadata 와 같은 규칙)
pub fn build_metadata(m: &Meta) -> Value {
    let re = regex::Regex::new(r"\s+/\s+").unwrap();
    let mut t = re.replace_all(&m.title.replace('*', ""), " ").trim().to_string();
    if t.is_empty() { t = "설교 쇼츠".into(); }
    if !t.to_lowercase().contains("#shorts") { t.push_str(" #Shorts"); }
    // JS 문자열 길이(UTF-16) 기준으로 자른다
    let u16len = |s: &str| s.encode_utf16().count();
    if u16len(&t) > 100 {
        let keep = 100 - " #Shorts".len();
        let cut: String = String::from_utf16_lossy(&t.encode_utf16().take(keep).collect::<Vec<u16>>());
        t = format!("{} #Shorts", cut.trim());
    }
    let desc = match &m.description {
        Some(d) => d.trim().to_string(),
        None => {
            let who = [m.church.as_str(), m.speaker.as_str()].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join(" · ");
            let parts = [m.verse.clone(), who, String::new(), m.credits.trim().to_string(), "#Shorts #설교".to_string()];
            parts.iter().enumerate().filter(|(i, x)| !x.is_empty() || *i == 2).map(|(_, x)| x.as_str()).collect::<Vec<_>>().join("\n").trim().to_string()
        }
    };
    let clean = |s: &str| s.replace(['<', '>'], "");
    let d16: Vec<u16> = clean(&desc).encode_utf16().take(5000).collect();
    json!({
        "snippet": { "title": clean(&t), "description": String::from_utf16_lossy(&d16), "categoryId": "29", "defaultLanguage": "ko", "defaultAudioLanguage": "ko" },
        "status": { "privacyStatus": if PRIVACY.contains(&m.privacy.as_str()) { m.privacy.as_str() } else { "unlisted" }, "selfDeclaredMadeForKids": false }
    })
}

fn post_form(url: &str, form: &[(&str, &str)]) -> anyhow::Result<Value> {
    match ureq::post(url).send_form(form) {
        Ok(r) => Ok(r.into_json()?),
        Err(ureq::Error::Status(code, r)) => {
            let d: Value = r.into_json().unwrap_or(Value::Null);
            let msg = d["error_description"].as_str().or(d["error"].as_str()).map(String::from).unwrap_or_else(|| format!("HTTP {code}"));
            if d["error"].as_str() == Some("invalid_grant") { anyhow::bail!("invalid_grant: {msg}"); }
            anyhow::bail!(msg)
        }
        Err(e) => anyhow::bail!("인터넷 연결 오류: {e}"),
    }
}

static TOKEN: Mutex<Option<(String, std::time::Instant)>> = Mutex::new(None);

fn access_token() -> anyhow::Result<String> {
    if let Some((t, exp)) = TOKEN.lock().unwrap().clone() { if exp > std::time::Instant::now() { return Ok(t); } }
    let s = theme::app_settings();
    let (rt, c) = (refresh_token(&s), client(&s));
    let Some(c) = c.filter(|_| !rt.is_empty()) else { anyhow::bail!("유튜브에 로그인되어 있지 않습니다. [설정 → 유튜브]에서 로그인해 주세요.") };
    match post_form(TOKEN_URL, &[("client_id", &c.id), ("client_secret", &c.secret), ("refresh_token", &rt), ("grant_type", "refresh_token")]) {
        Ok(t) => {
            let tok = t["access_token"].as_str().unwrap_or("").to_string();
            let secs = t["expires_in"].as_u64().unwrap_or(3600).saturating_sub(60);
            *TOKEN.lock().unwrap() = Some((tok.clone(), std::time::Instant::now() + std::time::Duration::from_secs(secs)));
            Ok(tok)
        }
        Err(e) if e.to_string().starts_with("invalid_grant") => {
            let _ = theme::save_settings(&json!({ "ytRefreshEnc": "" }));
            anyhow::bail!("유튜브 로그인이 만료되었습니다. [설정 → 유튜브]에서 다시 로그인해 주세요.")
        }
        Err(e) => Err(e),
    }
}

/// 내 채널 이름 (읽기만)
pub fn channel_name() -> anyhow::Result<String> {
    let tok = access_token()?;
    let d: Value = ureq::get(CHANNEL_URL).set("authorization", &format!("Bearer {tok}")).call()?.into_json()?;
    Ok(d["items"][0]["snippet"]["title"].as_str().unwrap_or("").to_string())
}

fn rand_b64(n: usize) -> String { let mut b = vec![0u8; n]; let _ = getrandom::getrandom(&mut b); B64URL.encode(b) }

/// 기본 브라우저로 주소 열기
pub fn open_url(url: &str) {
    #[cfg(windows)] { let _ = std::process::Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url]).spawn(); }
    #[cfg(target_os = "macos")] { let _ = std::process::Command::new("open").arg(url).spawn(); }
    #[cfg(all(not(windows), not(target_os = "macos")))] { let _ = std::process::Command::new("xdg-open").arg(url).spawn(); }
}

/// 구글 로그인: 브라우저에서 구글 화면 → 이 PC 의 임시 주소로 돌아온 코드를 토큰으로 바꿔 잠가 둔다 (5분 기다림)
pub fn sign_in() -> anyhow::Result<Status> {
    let s = theme::app_settings();
    let Some(c) = client(&s) else { anyhow::bail!("구글 OAuth 클라이언트가 없습니다. [설정 → 유튜브]에서 클라이언트 ID 와 비밀번호를 넣어 주세요.") };
    let verifier = rand_b64(32);
    let challenge = B64URL.encode(sha2::Sha256::digest(verifier.as_bytes()));
    let state = rand_b64(16);
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let q = [("client_id", c.id.as_str()), ("redirect_uri", &redirect), ("response_type", "code"), ("scope", SCOPES), ("code_challenge", &challenge), ("code_challenge_method", "S256"), ("state", &state), ("access_type", "offline"), ("prompt", "consent")];
    let qs: Vec<String> = q.iter().map(|(k, v)| format!("{k}={}", urlencode(v))).collect();
    open_url(&format!("{AUTH_URL}?{}", qs.join("&")));
    listener.set_nonblocking(true)?;
    let t0 = std::time::Instant::now();
    loop {
        if t0.elapsed().as_secs() > 300 { anyhow::bail!("5분 안에 로그인이 끝나지 않았습니다. 다시 해 주세요."); }
        let (mut sock, _) = match listener.accept() { Ok(x) => x, Err(_) => { std::thread::sleep(std::time::Duration::from_millis(200)); continue; } };
        sock.set_nonblocking(false)?;
        let mut line = String::new();
        BufReader::new(sock.try_clone()?).read_line(&mut line)?;
        let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
        let (p, query) = path.split_once('?').unwrap_or((&path, ""));
        if p != "/" { let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"); continue; }
        let params: Vec<(String, String)> = query.split('&').filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.to_string(), urldecode(v)))).collect();
        let get = |k: &str| params.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone());
        let ok = get("state").as_deref() == Some(state.as_str()) && get("code").is_some();
        let body = format!("<meta charset=\"utf-8\"><body style=\"font-family:sans-serif;padding:40px;text-align:center\"><h2>{}</h2><p>이 창을 닫고 설교 쇼츠 편집기로 돌아가세요.</p></body>", if ok { "유튜브 로그인이 끝났습니다." } else { "로그인하지 못했습니다." });
        let _ = sock.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes());
        if !ok { anyhow::bail!(if get("error").as_deref() == Some("access_denied") { "로그인을 취소했습니다." } else { "로그인 응답이 올바르지 않습니다." }); }
        let code = get("code").unwrap();
        let t = post_form(TOKEN_URL, &[("code", &code), ("client_id", &c.id), ("client_secret", &c.secret), ("code_verifier", &verifier), ("grant_type", "authorization_code"), ("redirect_uri", &redirect)])?;
        let rt = t["refresh_token"].as_str().ok_or_else(|| anyhow::anyhow!("구글이 갱신 토큰을 주지 않았습니다. 다시 로그인해 주세요."))?;
        let secs = t["expires_in"].as_u64().unwrap_or(3600).saturating_sub(60);
        *TOKEN.lock().unwrap() = Some((t["access_token"].as_str().unwrap_or("").into(), std::time::Instant::now() + std::time::Duration::from_secs(secs)));
        let channel = channel_name().unwrap_or_default();
        theme::save_settings(&json!({ "ytRefreshEnc": secret::encrypt(rt)?, "ytChannel": channel }))?;
        return Ok(status());
    }
}

pub fn sign_out() -> Status {
    let rt = refresh_token(&theme::app_settings());
    *TOKEN.lock().unwrap() = None;
    let _ = theme::save_settings(&json!({ "ytRefreshEnc": "", "ytChannel": "" }));
    if !rt.is_empty() { let _ = post_form(REVOKE_URL, &[("token", &rt)]); }
    status()
}

fn urlencode(s: &str) -> String { s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect() }
fn urldecode(s: &str) -> String {
    let b = s.as_bytes(); let mut out = vec![]; let mut i = 0;
    while i < b.len() { if b[i] == b'%' && i + 2 < b.len() { if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) { out.push(v); i += 3; continue; } } out.push(if b[i] == b'+' { b' ' } else { b[i] }); i += 1; }
    String::from_utf8_lossy(&out).to_string()
}

#[derive(Clone, Debug)]
pub struct Uploaded { pub id: String, pub url: String, pub studio: String, pub privacy: String, pub title: String }

fn api_error(code: u16, d: &Value) -> anyhow::Error {
    let reason = d["error"]["errors"][0]["reason"].as_str().unwrap_or("");
    let msg = d["error"]["message"].as_str().unwrap_or("");
    if reason == "quotaExceeded" { return anyhow::anyhow!("오늘 유튜브 업로드 한도를 다 썼습니다. 내일 다시 하거나 유튜브 스튜디오에서 직접 올려 주세요."); }
    if reason == "uploadLimitExceeded" { return anyhow::anyhow!("이 채널의 하루 업로드 개수 제한에 걸렸습니다. 내일 다시 해 주세요."); }
    if code == 401 { return anyhow::anyhow!("유튜브 로그인이 만료되었습니다. 다시 로그인해 주세요."); }
    let rm = format!("{reason}{msg}").to_lowercase();
    if code == 403 && (rm.contains("youtubesignuprequired") || rm.contains("channel")) { return anyhow::anyhow!("이 구글 계정에 유튜브 채널이 없습니다. 유튜브에서 채널을 먼저 만들어 주세요."); }
    anyhow::anyhow!("유튜브 업로드 오류 {code}: {}", msg.chars().take(200).collect::<String>())
}

/// 읽은 만큼 진행률을 알리는 파일 읽개
struct Progressed { f: std::fs::File, sent: u64, size: u64, pct: Arc<Mutex<f32>> }
impl Read for Progressed {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.f.read(buf)?;
        self.sent += n as u64;
        *self.pct.lock().unwrap() = (self.sent as f64 / self.size.max(1) as f64 * 99.0) as f32;
        Ok(n)
    }
}

/// 올리기 (pct 에 0~100 진행률)
pub fn upload(file: &Path, meta: &Meta, pct: Arc<Mutex<f32>>) -> anyhow::Result<Uploaded> {
    if !file.extension().map(|e| e.eq_ignore_ascii_case("mp4")).unwrap_or(false) || !file.exists() { anyhow::bail!("올릴 MP4 파일이 없습니다."); }
    let mut m = meta.clone();
    if m.privacy.is_empty() { m.privacy = status().privacy; }
    let body = build_metadata(&m);
    let title = body["snippet"]["title"].as_str().unwrap_or("").to_string();
    if fake() {
        for p in [0.0, 35.0, 70.0, 100.0] { *pct.lock().unwrap() = p; std::thread::sleep(std::time::Duration::from_millis(120)); }
        let id = format!("fake{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
        let log = crate::theme::user_data_dir().join("ytfake.log");
        let _ = std::fs::OpenOptions::new().create(true).append(true).open(log).and_then(|mut f| writeln!(f, "{}", json!({ "file": file.file_name().map(|x| x.to_string_lossy().to_string()), "title": title, "description": body["snippet"]["description"], "privacy": body["status"]["privacyStatus"] })));
        return Ok(Uploaded { url: format!("https://youtu.be/{id}"), studio: format!("https://studio.youtube.com/video/{id}/edit"), privacy: body["status"]["privacyStatus"].as_str().unwrap_or("").into(), title, id });
    }
    let size = std::fs::metadata(file)?.len();
    let tok = access_token()?;
    *pct.lock().unwrap() = 0.0;
    let init = match ureq::post(UPLOAD_URL).set("authorization", &format!("Bearer {tok}")).set("content-type", "application/json; charset=UTF-8").set("x-upload-content-type", "video/mp4").set("x-upload-content-length", &size.to_string()).send_string(&body.to_string()) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => { let d: Value = r.into_json().unwrap_or(Value::Null); return Err(api_error(code, &d)); }
        Err(e) => anyhow::bail!("인터넷 연결 오류: {e}"),
    };
    let location = init.header("location").ok_or_else(|| anyhow::anyhow!("유튜브가 업로드 주소를 주지 않았습니다."))?.to_string();
    let reader = Progressed { f: std::fs::File::open(file)?, sent: 0, size, pct: pct.clone() };
    let put = match ureq::put(&location).set("content-type", "video/mp4").set("content-length", &size.to_string()).send(reader) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => { let d: Value = r.into_json().unwrap_or(Value::Null); return Err(api_error(code, &d)); }
        Err(e) => anyhow::bail!("인터넷 연결 오류: {e}"),
    };
    let d: Value = put.into_json()?;
    let id = d["id"].as_str().unwrap_or("").to_string();
    *pct.lock().unwrap() = 100.0;
    Ok(Uploaded { url: format!("https://youtu.be/{id}"), studio: format!("https://studio.youtube.com/video/{id}/edit"), privacy: d["status"]["privacyStatus"].as_str().unwrap_or("").into(), title, id })
}

/// 완성 영상 창에 미리 채울 제목·설명·공개 범위
pub fn defaults(meta: &Meta) -> (String, String, String) {
    let mut m = meta.clone();
    if m.privacy.is_empty() { m.privacy = status().privacy; }
    let b = build_metadata(&m);
    (b["snippet"]["title"].as_str().unwrap_or("").into(), b["snippet"]["description"].as_str().unwrap_or("").into(), b["status"]["privacyStatus"].as_str().unwrap_or("unlisted").into())
}

pub const LINK_CONSOLE: &str = "https://console.cloud.google.com/apis/credentials";
pub const LINK_API: &str = "https://console.cloud.google.com/apis/library/youtube.googleapis.com";
/// 설정 [유튜브]의 바꾼 값 (기존 ytup:setOptions): 공개 범위 · 영상을 만든 뒤 · 내 OAuth 클라이언트
pub fn set_options(privacy: Option<&str>, upload_mode: Option<&str>, client: Option<(&str, &str)>) -> anyhow::Result<Status> {
    let mut next = serde_json::Map::new();
    if let Some(p) = privacy.filter(|p| PRIVACY.contains(p)) { next.insert("ytPrivacy".into(), serde_json::json!(p)); }
    if let Some(m) = upload_mode.filter(|m| MODES.contains(m)) { next.insert("ytUploadMode".into(), serde_json::json!(m)); next.insert("ytAutoUpload".into(), serde_json::json!(m == "auto")); }
    if let Some((id, sec)) = client {
        let id = id.trim();
        let ok = id.strip_suffix(".apps.googleusercontent.com").is_some_and(|h| !h.is_empty() && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
        if !id.is_empty() && !ok { anyhow::bail!("클라이언트 ID 형식이 아닙니다. ...apps.googleusercontent.com 으로 끝나는 값을 넣어 주세요."); }
        if id != theme::app_settings()["ytClientId"].as_str().unwrap_or("") { next.insert("ytClientId".into(), serde_json::json!(id)); next.insert("ytRefreshEnc".into(), serde_json::json!("")); next.insert("ytChannel".into(), serde_json::json!("")); }
        if !sec.trim().is_empty() { next.insert("ytClientSecretEnc".into(), serde_json::json!(secret::encrypt(sec.trim())?)); }
        if id.is_empty() { next.insert("ytClientSecretEnc".into(), serde_json::json!("")); }
    }
    theme::save_settings(&serde_json::Value::Object(next))?;
    Ok(status())
}