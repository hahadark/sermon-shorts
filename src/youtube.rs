//! 유튜브에서 가져오기 (기존 src/main/youtube.js · ytpart.js · ytdlp-manager.js · tools.js, src/shared/edl.js 의 주소·시각 해석).
//! 데이터 폴더는 Electron 설치본과 같은 `%APPDATA%\SermonShorts\runtime` 을 함께 쓴다 (yt-dlp·받은 영상·캐시).
use crate::theme;
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const ASSET: &str = if cfg!(windows) { "yt-dlp.exe" } else if cfg!(target_os = "macos") { "yt-dlp_macos" } else { "yt-dlp" };
const CHUNK: u64 = 9_000_000;
const DAY_MS: u64 = 24 * 3600 * 1000;
const MIN_FORCE_GAP_MS: u64 = 10 * 60 * 1000;

fn now_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }
fn exe(name: &str) -> String { if cfg!(windows) { format!("{name}.exe") } else { name.to_string() } }

/// Electron 설치본의 데이터 폴더 (엔진·yt-dlp·캐시)
pub fn runtime_dir() -> PathBuf { std::env::var("SS_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(|_| theme::user_data_dir().join("runtime")) }
pub fn cache_dir() -> PathBuf { runtime_dir().join("cache") }
pub fn yt_cache_root() -> PathBuf { cache_dir().join("yt") }
pub fn managed_ytdlp() -> PathBuf { runtime_dir().join("bin").join(exe("yt-dlp")) }

/// yt-dlp 경로: 앱이 관리하는 최신본 → 앱 자료 bin → PATH
pub fn ytdlp_path() -> PathBuf {
    let m = managed_ytdlp();
    if m.exists() { return m; }
    let b = crate::assets_dir().join("bin").join(exe("yt-dlp"));
    if b.exists() { return b; }
    crate::media::find_tool("yt-dlp")
}

// ---------------------------------------------------------------- 주소·시각 해석 (edl.js)

/// "14:30", "1:02:03", "870.5" → 초
pub fn parse_timecode(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() { return None; }
    let re = regex::Regex::new(r"^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$").unwrap();
    let m = re.captures(s)?;
    let (mut h, mut mi) = (0.0, 0.0);
    match (m.get(1), m.get(2)) {
        (Some(a), Some(b)) => { h = a.as_str().parse().ok()?; mi = b.as_str().parse().ok()?; }
        (Some(a), None) => { mi = a.as_str().parse().ok()?; }
        _ => {}
    }
    let sec: f64 = m[3].parse().ok()?;
    if s.contains(':') && sec >= 60.0 { return None; }
    if m.get(2).is_some() && mi >= 60.0 { return None; }
    Some(h * 3600.0 + mi * 60.0 + sec)
}
/// "14:30 ~ 38:50" → (시작, 끝)
pub fn parse_range(s: &str) -> Option<(f64, f64)> {
    let parts: Vec<&str> = regex::Regex::new(r"\s*[~\-–—]\s*").unwrap().split(s).collect();
    if parts.len() != 2 { return None; }
    let (a, b) = (parse_timecode(parts[0])?, parse_timecode(parts[1])?);
    if !(b > a) { return None; }
    Some((a, b))
}
/// "870", "870s", "14m30s", "1h2m3s" → 초
pub fn parse_yt_time(v: &str) -> Option<f64> {
    let s = v.trim().to_lowercase();
    if s.is_empty() { return None; }
    if regex::Regex::new(r"^\d+(\.\d+)?$").unwrap().is_match(&s) { return s.parse().ok(); }
    let m = regex::Regex::new(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$").unwrap().captures(&s)?;
    if m.get(1).is_none() && m.get(2).is_none() && m.get(3).is_none() { return None; }
    let g = |i: usize| m.get(i).and_then(|x| x.as_str().parse::<f64>().ok()).unwrap_or(0.0);
    Some(g(1) * 3600.0 + g(2) * 60.0 + g(3))
}

fn query_get(q: &str, key: &str) -> Option<String> {
    q.split('&').filter_map(|kv| kv.split_once('=').or(Some((kv, "")))).find(|(k, _)| *k == key).map(|(_, v)| v.to_string())
}

/// 유튜브 주소 → (영상 id, 시작 초)
pub fn parse_youtube_url(url: &str) -> Option<(String, Option<f64>)> {
    let mut raw = url.trim().to_string();
    if raw.is_empty() { return None; }
    if !regex::Regex::new(r"(?i)^[a-z][a-z0-9+.\-]*://").unwrap().is_match(&raw) { raw = format!("https://{raw}"); }
    let after = raw.split_once("://")?.1;
    let (host_port, rest) = match after.find(['/', '?', '#']) { Some(i) => (&after[..i], &after[i..]), None => (after, "") };
    let host = host_port.rsplit('@').next()?.split(':').next()?.to_lowercase();
    let host = regex::Regex::new(r"^(www\.|m\.|music\.)").unwrap().replace(&host, "").to_string();
    let (path_q, hash) = rest.split_once('#').map(|(a, b)| (a, Some(b))).unwrap_or((rest, None));
    let (path, query) = path_q.split_once('?').unwrap_or((path_q, ""));
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let id = if host == "youtu.be" { segs.first().map(|s| s.to_string()) }
        else if host == "youtube.com" || host == "youtube-nocookie.com" {
            match segs.first().copied() { Some("watch") => query_get(query, "v"), Some("shorts" | "live" | "embed" | "v") => segs.get(1).map(|s| s.to_string()), _ => None }
        } else { return None; };
    let id = id?;
    if !regex::Regex::new(r"^[A-Za-z0-9_-]{6,}$").unwrap().is_match(&id) { return None; }
    let mut tv = query_get(query, "t").or_else(|| query_get(query, "start"));
    if tv.is_none() { if let Some(h) = hash { if let Some(c) = regex::Regex::new(r"(?:^|&)t=([^&]+)").unwrap().captures(h) { tv = Some(c[1].to_string()); } } }
    Some((id, tv.and_then(|t| parse_yt_time(&t))))
}

/// ytpart.js videoIdOf
pub fn video_id_of(url: &str) -> Option<String> { parse_youtube_url(url).map(|(id, _)| id) }

// ---------------------------------------------------------------- yt-dlp 실행·업데이트

/// 오래된 yt-dlp 때문에 생기는 오류인지
pub fn is_stale_error(text: &str) -> bool {
    regex::Regex::new(r"(?i)HTTP Error 403|403: Forbidden|Sign in to confirm|Requested format is not available|nsig extraction failed|Unable to extract|Precondition check failed|Some formats may be missing|older than 90 days|page needs to be reloaded").unwrap().is_match(text)
}

/// yt-dlp 실패 → 알기 쉬운 한국어 오류
pub fn yt_error(code: i32, stderr: &str) -> String {
    let lines: Vec<&str> = stderr.lines().map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let last = lines.iter().filter(|l| l.starts_with("ERROR")).last().or_else(|| lines.iter().filter(|l| !l.starts_with("WARNING")).last()).map(|l| l.trim_start_matches("ERROR:").trim().to_string()).unwrap_or_default();
    let low = last.to_lowercase();
    let msg = if low.contains("private video") || low.contains("private") { "비공개 영상이라 받을 수 없습니다. 유튜브에서 공개 또는 일부공개로 바꿔 주세요" }
        else if low.contains("sign in to confirm") { "유튜브가 로그인 확인을 요구합니다. 잠시 뒤 다시 해 주세요" }
        else if last.contains("403") { "유튜브가 다운로드를 거부했습니다(403). 다운로드 프로그램을 최신으로 바꿨는데도 안 되면 잠시 뒤 다시 해 주세요" }
        else if low.contains("not a valid url") || low.contains("unsupported url") || low.contains("incomplete youtube id") { "유튜브 주소가 올바르지 않습니다" }
        else if low.contains("unavailable") || low.contains("not available") { "이 영상을 볼 수 없습니다(삭제됐거나 지역 제한)" }
        else { "유튜브에서 영상을 받지 못했습니다" };
    if last.is_empty() { format!("{msg} (코드 {code})") } else { format!("{msg} (자세히: {})", last.chars().take(160).collect::<String>()) }
}

/// yt-dlp 서명 풀이에 쓸 JS 실행기 (PATH 의 node → 데이터 폴더 deno)
fn js_runtime_args() -> Vec<String> {
    static RT: OnceLock<Option<(String, PathBuf)>> = OnceLock::new();
    let rt = RT.get_or_init(|| {
        let node = crate::media::find_tool("node");
        if node.exists() {
            if let Ok(o) = crate::media::command_path(&node).args(["-e", "process.stdout.write(process.version)"]).output() { if o.status.success() { return Some(("node".into(), node)); } }
        }
        let deno = runtime_dir().join("bin").join(exe("deno"));
        if deno.exists() { return Some(("deno".into(), deno)); }
        None
    });
    match rt { Some((k, p)) => vec!["--js-runtimes".into(), format!("{k}:{}", p.display())], None => vec![] }
}

pub struct YtErr { pub msg: String, pub stderr: String }
impl std::fmt::Display for YtErr { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "{}", self.msg) } }

fn run_ytdlp_once(args: &[String]) -> Result<String, YtErr> {
    let mut all = js_runtime_args();
    all.extend(args.iter().cloned());
    let out = crate::media::command_path(&ytdlp_path()).args(&all).stdin(std::process::Stdio::null()).output().map_err(|e| YtErr { msg: format!("yt-dlp 를 실행하지 못했습니다: {e}"), stderr: String::new() })?;
    let err = String::from_utf8_lossy(&out.stderr).to_string();
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).to_string()) } else { Err(YtErr { msg: yt_error(out.status.code().unwrap_or(-1), &err), stderr: err }) }
}

fn state_file() -> PathBuf { cache_dir().join("ytdlp-update.json") }
fn version_of(bin: &Path) -> String {
    if !bin.exists() { return String::new(); }
    let Ok(o) = crate::media::command_path(bin).arg("--version").output() else { return String::new() };
    String::from_utf8_lossy(&o.stdout).lines().map(|s| s.trim().to_string()).filter(|s| regex::Regex::new(r"^\d{4}\.\d{2}\.\d{2}").unwrap().is_match(s)).last().unwrap_or_default()
}
fn download_latest(dest: &Path) -> anyhow::Result<()> {
    let url = format!("https://github.com/yt-dlp/yt-dlp/releases/latest/download/{ASSET}");
    let mut buf = vec![];
    ureq::get(&url).call()?.into_reader().read_to_end(&mut buf)?;
    if buf.len() < 1_000_000 { anyhow::bail!("받은 yt-dlp 파일이 올바르지 않습니다"); }
    let tmp = dest.with_extension("download");
    std::fs::write(&tmp, &buf)?;
    if dest.exists() { if std::fs::rename(dest, dest.with_extension(format!("old-{}", now_ms()))).is_err() { let _ = std::fs::remove_file(dest); } }
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

/// 관리용 yt-dlp 준비·업데이트 (하루에 한 번, force 면 10분 간격). → 바뀌었는지
pub fn ensure_ytdlp(force: bool) -> anyhow::Result<bool> {
    static RUNNING: Mutex<()> = Mutex::new(());
    let _g = RUNNING.lock().unwrap();
    let dest = managed_ytdlp();
    if let Some(d) = dest.parent() { std::fs::create_dir_all(d)?; }
    let st: Value = std::fs::read_to_string(state_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}));
    let mut fresh = false;
    if !dest.exists() {
        let bundled = crate::assets_dir().join("bin").join(exe("yt-dlp"));
        if bundled.exists() { std::fs::copy(&bundled, &dest)?; } else { download_latest(&dest)?; fresh = true; }
    }
    let before = version_of(&dest);
    let since = now_ms().saturating_sub(st["checkedAt"].as_u64().unwrap_or(0));
    let due = !fresh && if force { since > MIN_FORCE_GAP_MS } else { since > DAY_MS };
    let write = |v: &str, at: u64| { let _ = std::fs::create_dir_all(cache_dir()); let _ = std::fs::write(state_file(), serde_json::to_string_pretty(&json!({ "checkedAt": at, "version": v })).unwrap()); };
    if !due { if fresh || st["version"].is_null() { write(&before, if fresh { now_ms() } else { st["checkedAt"].as_u64().unwrap_or(0) }); } return Ok(fresh); }
    let r = crate::media::command_path(&dest).arg("-U").output();
    let mut after = version_of(&dest);
    if (r.as_ref().map(|o| !o.status.success()).unwrap_or(true) && after == before) || after.is_empty() {
        if download_latest(&dest).is_ok() { after = version_of(&dest); }
    }
    write(&after, now_ms());
    Ok(after != before)
}

/// yt-dlp 작업을 하고, 오래된 yt-dlp 오류면 최신으로 바꾼 뒤 한 번 더
pub fn with_update_retry<T>(f: impl Fn() -> Result<T, YtErr>) -> Result<T, String> {
    if !managed_ytdlp().exists() { let _ = ensure_ytdlp(false); }
    match f() {
        Ok(v) => Ok(v),
        Err(e) => {
            if !is_stale_error(&format!("{}\n{}", e.stderr, e.msg)) { return Err(e.msg); }
            match ensure_ytdlp(true) { Ok(true) => f().map_err(|e| e.msg), _ => Err(e.msg) }
        }
    }
}

// ---------------------------------------------------------------- 정보·자동 자막

#[derive(Clone, Debug, Default)]
pub struct Info { pub id: String, pub title: String, pub duration: f64, pub upload_date: String, pub description: String, pub uploader: String }

pub fn fetch_info(url: &str) -> Result<Info, String> {
    let out = with_update_retry(|| run_ytdlp_once(&["-J".into(), "--no-playlist".into(), "--".into(), url.into()]))?;
    let j: Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    Ok(Info { id: j["id"].as_str().unwrap_or("").into(), title: j["title"].as_str().unwrap_or("").into(), duration: j["duration"].as_f64().unwrap_or(0.0), upload_date: j["upload_date"].as_str().unwrap_or("").into(), description: j["description"].as_str().unwrap_or("").into(), uploader: j["uploader"].as_str().or(j["channel"].as_str()).unwrap_or("").into() })
}

#[derive(Clone, Debug)]
pub struct SubLine { pub start: f64, pub end: f64, pub text: String }

/// json3 자막 → 줄 (youtube.js fetchAutoSubs)
pub fn parse_json3(content: &Value) -> Vec<SubLine> {
    let mut lines = vec![];
    for ev in content["events"].as_array().into_iter().flatten() {
        let Some(segs) = ev["segs"].as_array() else { continue };
        let start = ev["tStartMs"].as_f64().unwrap_or(0.0) / 1000.0;
        let dur = ev["dDurationMs"].as_f64().unwrap_or(0.0) / 1000.0;
        let text: String = segs.iter().map(|s| s["utf8"].as_str().unwrap_or("")).collect::<String>().trim().to_string();
        if text.is_empty() { continue; }
        lines.push(SubLine { start, end: start + dur, text });
    }
    lines
}

/// 유튜브 자동 자막 (한국어). 없으면 None
pub fn fetch_auto_subs(url: &str) -> Result<Option<Vec<SubLine>>, String> {
    Ok(fetch_auto_subs_raw(url)?.map(|j| parse_json3(&j)))
}
/// 자동 자막 json3 그대로 (없으면 None)
pub fn fetch_auto_subs_raw(url: &str) -> Result<Option<Value>, String> {
    let info = fetch_info(url)?;
    let dir = yt_cache_root().join(&info.id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let find = || std::fs::read_dir(&dir).ok().and_then(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| p.to_string_lossy().ends_with(".json3")));
    if find().is_none() {
        let args: Vec<String> = ["--skip-download", "--write-auto-subs", "--write-subs", "--sub-langs", "ko.*,ko", "--sub-format", "json3", "-o"].iter().map(|s| s.to_string()).chain([dir.join("%(id)s.%(ext)s").to_string_lossy().to_string(), "--".into(), url.into()]).collect();
        let r = with_update_retry(|| run_ytdlp_once(&args));
        if find().is_none() { return match r { Err(e) => Err(e), Ok(_) => Ok(None) }; }
    }
    let p = find().unwrap();
    let j: Value = serde_json::from_str(&std::fs::read_to_string(p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(Some(j))
}

// ---------------------------------------------------------------- 형식 고르기·구간 받기 (ytpart.js)

#[derive(Clone, Debug, Default)]
pub struct Fmt { pub url: String, pub itag: String, pub fps: f64, pub width: u32, pub height: u32, pub vcodec: String }

#[derive(Clone, Debug, Default)]
pub struct Formats { pub id: String, pub title: String, pub duration: f64, pub description: String, pub upload_date: String, pub video: Fmt, pub audio: Fmt, pub preview: Option<Fmt>, pub expires_at: u64 }

fn fmt_of(f: &Value) -> Fmt {
    Fmt { url: f["url"].as_str().unwrap_or("").into(), itag: f["format_id"].as_str().map(String::from).unwrap_or_else(|| f["format_id"].to_string()), fps: f["fps"].as_f64().unwrap_or(0.0), width: f["width"].as_u64().unwrap_or(0) as u32, height: f["height"].as_u64().unwrap_or(0) as u32, vcodec: f["vcodec"].as_str().unwrap_or("").into() }
}

/// 형식 고르기 (순수): 1080p 이하 mp4 영상(avc1 우선) · m4a(140 우선) · 미리보기(18)
pub fn pick_formats(formats: &[Value]) -> (Option<Value>, Option<Value>, Option<Value>) {
    let direct = |f: &Value| { let u = f["url"].as_str().unwrap_or(""); !u.is_empty() && regex::Regex::new(r"^https?$").unwrap().is_match(f["protocol"].as_str().unwrap_or("https")) && !u.contains("manifest") };
    let s = |f: &Value, k: &str| f[k].as_str().unwrap_or("").to_string();
    let none = |v: &str| v.is_empty() || v == "none";
    let n = |f: &Value, k: &str| f[k].as_f64().unwrap_or(0.0);
    let mut vids: Vec<&Value> = formats.iter().filter(|f| direct(f) && !none(&s(f, "vcodec")) && none(&s(f, "acodec")) && n(f, "height") <= 1080.0 && s(f, "ext") == "mp4").collect();
    vids.sort_by(|a, b| n(b, "height").total_cmp(&n(a, "height"))
        .then_with(|| (s(b, "vcodec").starts_with("avc1") as i32).cmp(&(s(a, "vcodec").starts_with("avc1") as i32)))
        .then_with(|| n(b, "fps").total_cmp(&n(a, "fps"))).then_with(|| n(b, "tbr").total_cmp(&n(a, "tbr"))));
    let fid = |f: &Value| f["format_id"].as_str().unwrap_or("").to_string();
    let mut auds: Vec<&Value> = formats.iter().filter(|f| direct(f) && !none(&s(f, "acodec")) && none(&s(f, "vcodec")) && (s(f, "ext") == "m4a" || fid(f) == "140")).collect();
    auds.sort_by(|a, b| ((fid(b) == "140") as i32).cmp(&((fid(a) == "140") as i32)).then_with(|| n(b, "abr").total_cmp(&n(a, "abr"))));
    let prev = formats.iter().find(|f| direct(f) && fid(f) == "18").or_else(|| formats.iter().find(|f| direct(f) && s(f, "vcodec") != "none" && !none(&s(f, "acodec")) && s(f, "ext") == "mp4"));
    (vids.first().map(|v| (*v).clone()), auds.first().map(|v| (*v).clone()), prev.cloned())
}

fn expire_of(u: &str) -> u64 {
    regex::Regex::new(r"[?&/]expire[=/](\d+)").unwrap().captures(u).and_then(|c| c[1].parse::<u64>().ok()).map(|s| s * 1000).unwrap_or(now_ms() + 3600 * 1000)
}

/// 직접 재생 주소 얻기 (영상 id 마다 기억, 주소가 만료되기 10분 전까지)
pub fn resolve_formats(url: &str, force: bool) -> Result<Formats, String> {
    static CACHE: OnceLock<Mutex<std::collections::HashMap<String, Formats>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(id) = video_id_of(url) { if !force { if let Some(c) = cache.lock().unwrap().get(&id) { if c.expires_at > now_ms() + 10 * 60 * 1000 { return Ok(c.clone()); } } } }
    let out = with_update_retry(|| run_ytdlp_once(&["-J".into(), "--no-playlist".into(), "--".into(), url.into()]))?;
    let info: Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    let fmts: Vec<Value> = info["formats"].as_array().cloned().unwrap_or_default();
    let (mut v, mut a, mut p) = pick_formats(&fmts);
    let (mut video, mut audio, mut preview) = (v.as_ref().map(fmt_of), a.as_ref().map(fmt_of), p.as_ref().map(fmt_of));
    if video.is_none() || audio.is_none() {
        let f = "bv*[height<=1080][vcodec^=avc1][ext=mp4][protocol=https]/bv*[height<=1080][ext=mp4][protocol=https],ba[ext=m4a][protocol=https],18/b[ext=mp4][protocol=https]";
        let lines: Vec<String> = with_update_retry(|| run_ytdlp_once(&["-g".into(), "-f".into(), f.into(), "--no-playlist".into(), "--".into(), url.into()]))?.trim().lines().map(String::from).collect();
        let itag_of = |u: &str| regex::Regex::new(r"[?&]itag=(\d+)").unwrap().captures(u).map(|c| c[1].to_string()).unwrap_or_default();
        let by_itag = |u: &str| fmts.iter().find(|x| x["format_id"].as_str() == Some(&itag_of(u))).cloned().unwrap_or(json!({}));
        if let Some(l) = lines.first() { let mut x = fmt_of(&by_itag(l)); x.url = l.clone(); x.itag = itag_of(l); video = Some(x); }
        if let Some(l) = lines.get(1) { let mut x = fmt_of(&by_itag(l)); x.url = l.clone(); x.itag = itag_of(l); audio = Some(x); }
        if let Some(l) = lines.get(2) { preview = Some(Fmt { url: l.clone(), itag: itag_of(l), ..Default::default() }); }
        v = None; a = None; p = None; let _ = (&v, &a, &p);
    }
    let (Some(video), Some(audio)) = (video, audio) else { return Err("DASH 영상/오디오 주소를 찾지 못했습니다".into()) };
    let d = Formats { id: info["id"].as_str().unwrap_or("").into(), title: info["title"].as_str().unwrap_or("").into(), duration: info["duration"].as_f64().unwrap_or(0.0), description: info["description"].as_str().unwrap_or("").into(), upload_date: info["upload_date"].as_str().unwrap_or("").into(), expires_at: expire_of(&video.url).min(expire_of(&audio.url)), video, audio, preview };
    cache.lock().unwrap().insert(d.id.clone(), d.clone());
    Ok(d)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Ref { pub start: f64, pub end: f64, pub a: u64, pub b: u64 }

/// 파일 앞부분에서 sidx 를 찾아 조각 목록 (초기 부분 끝, 조각들)
pub fn parse_sidx(head: &[u8]) -> Option<(u64, u32, Vec<Ref>)> {
    let be32 = |b: &[u8], i: usize| u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as u64;
    let be64 = |b: &[u8], i: usize| u64::from_be_bytes(b[i..i + 8].try_into().unwrap());
    let mut p = 0usize;
    let mut found: Option<(usize, usize, usize)> = None;
    while p + 8 <= head.len() {
        let mut size = be32(head, p) as usize;
        let typ = &head[p + 4..p + 8];
        let mut hdr = 8;
        if size == 1 && p + 16 <= head.len() { size = be64(head, p + 8) as usize; hdr = 16; }
        if typ == b"sidx" { found = Some((p, size, hdr)); break; }
        if size < 8 { break; }
        p += size;
    }
    let (off, size, hdr) = found?;
    if off + size > head.len() { return None; }
    let b = &head[off..off + size];
    let mut q = hdr;
    let ver = b[q]; q += 4; q += 4;
    let timescale = be32(b, q) as u32; q += 4;
    let (ept, first) = if ver == 0 { let r = (be32(b, q), be32(b, q + 4)); q += 8; r } else { let r = (be64(b, q), be64(b, q + 8)); q += 16; r };
    q += 2;
    let count = u16::from_be_bytes([b[q], b[q + 1]]) as usize; q += 2;
    let mut o = (off + size) as u64 + first;
    let mut t = ept;
    let mut refs = vec![];
    for _ in 0..count {
        let sz = be32(b, q) & 0x7fff_ffff;
        let dur = be32(b, q + 4);
        refs.push(Ref { start: t as f64 / timescale as f64, end: (t + dur) as f64 / timescale as f64, a: o, b: o + sz - 1 });
        o += sz; t += dur; q += 12;
    }
    Some(((off as u64).saturating_sub(1), timescale, refs))
}

pub fn select_refs(refs: &[Ref], t0: f64, t1: f64) -> Vec<Ref> { refs.iter().filter(|r| r.end > t0 && r.start < t1).cloned().collect() }

#[derive(Debug)]
enum GetErr { Status(u16), Other(String) }

fn get_range(url: &str, a: u64, b: u64) -> Result<Vec<u8>, GetErr> {
    let mut last = GetErr::Other("받지 못했습니다".into());
    for i in 0..3 {
        match ureq::get(&format!("{url}&range={a}-{b}")).call() {
            Ok(r) => { let mut v = vec![]; if r.into_reader().read_to_end(&mut v).is_ok() { return Ok(v); } last = GetErr::Other("읽기 오류".into()); }
            Err(ureq::Error::Status(code, _)) => { last = GetErr::Status(code); if code == 403 || code == 410 || (400..500).contains(&code) && code != 429 { return Err(last); } }
            Err(e) => last = GetErr::Other(e.to_string()),
        }
        std::thread::sleep(std::time::Duration::from_millis(800 * (i + 1)));
    }
    Err(last)
}

struct Track { head: Vec<u8>, init_end: u64, refs: Vec<Ref> }
fn index_track(url: &str) -> Result<Track, GetErr> {
    let head = get_range(url, 0, 262143)?;
    let (init_end, _, refs) = parse_sidx(&head).ok_or_else(|| GetErr::Other("sidx 없음".into()))?;
    Ok(Track { head, init_end, refs })
}
fn download_track(url: &str, tr: &Track, t0: f64, t1: f64, file: &Path, on_bytes: &dyn Fn(u64)) -> Result<(f64, f64, u64), GetErr> {
    let sel = select_refs(&tr.refs, t0, t1);
    if sel.is_empty() { return Err(GetErr::Other("구간에 해당하는 조각이 없습니다".into())); }
    let (a, b) = (sel[0].a, sel[sel.len() - 1].b);
    let mut out = tr.head[..=(tr.init_end as usize).min(tr.head.len() - 1)].to_vec();
    let mut x = a;
    while x <= b { let y = b.min(x + CHUNK - 1); out.extend(get_range(url, x, y)?); on_bytes(y - x + 1); x += CHUNK; }
    std::fs::write(file, out).map_err(|e| GetErr::Other(e.to_string()))?;
    Ok((sel[0].start, sel[sel.len() - 1].end, b - a + 1))
}

#[derive(Clone, Debug, Default)]
pub struct Fetched { pub path: PathBuf, pub offset: f64, pub start: f64, pub end: f64, pub title: String, pub duration: f64, pub method: String, pub id: String }

/// [start-pad, end+pad] 구간만 받아 mp4 하나로 (실패하면 전체 받기). progress(퍼센트, 단계)
pub fn fetch_part(url: &str, start: f64, end: f64, pad: f64, progress: &(dyn Fn(f64, &str) + Sync)) -> Result<Fetched, String> {
    let r = (|| -> Result<Fetched, String> {
        let mut info = resolve_formats(url, false)?;
        let dir = yt_cache_root().join(&info.id);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let (s, e) = (start.floor() as i64, end.ceil() as i64);
        let base = dir.join(format!("part_{s}_{e}"));
        let out = base.with_extension("mp4");
        let side = base.with_extension("json");
        if out.exists() && side.exists() {
            let j: Value = serde_json::from_str(&std::fs::read_to_string(&side).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            progress(100.0, "part");
            return Ok(Fetched { path: out, offset: j["offset"].as_f64().unwrap_or(0.0), start, end, title: info.title, duration: info.duration, method: "part".into(), id: info.id });
        }
        let t0 = (start - pad).max(0.0);
        let t1 = if info.duration > 0.0 { (end + pad).min(info.duration) } else { end + pad };
        let (vfile, afile) = (dir.join(format!("part_{s}_{e}.v.mp4")), dir.join(format!("part_{s}_{e}.a.m4a")));
        let mut result = None;
        for attempt in 0..3 {
            let est = ((t1 - t0) * 450_000.0).max(1.0);
            let got = Mutex::new(0f64);
            let on_bytes = |n: u64| { let mut g = got.lock().unwrap(); *g += n as f64; progress((*g / est * 95.0).min(95.0), "part"); };
            let r = (|| -> Result<((f64, f64, u64), (f64, f64, u64)), GetErr> {
                let (vt, at) = std::thread::scope(|sc| { let h = sc.spawn(|| index_track(&info.audio.url)); let v = index_track(&info.video.url); (v, h.join().unwrap()) });
                let (vt, at) = (vt?, at?);
                let vsel = select_refs(&vt.refs, t0, t1);
                let vstart = vsel.first().map(|r| r.start).unwrap_or(t0);
                let (va, aa) = std::thread::scope(|sc| {
                    let h = sc.spawn(|| download_track(&info.audio.url, &at, t0.min(vstart), t1, &afile, &on_bytes));
                    let v = download_track(&info.video.url, &vt, t0, t1, &vfile, &on_bytes);
                    (v, h.join().unwrap())
                });
                Ok((va?, aa?))
            })();
            match r {
                Ok(x) => { result = Some(x); break; }
                Err(GetErr::Status(403 | 410)) if attempt == 0 => { info = resolve_formats(url, true)?; }
                Err(GetErr::Status(403)) if attempt == 1 => { if ensure_ytdlp(true).unwrap_or(false) { progress(0.0, "update"); info = resolve_formats(url, true)?; } else { return Err("유튜브가 거부했습니다(403)".into()); } }
                Err(GetErr::Status(c)) => return Err(format!("HTTP {c}")),
                Err(GetErr::Other(m)) => return Err(m),
            }
        }
        let ((vs, _, vb), (as_, _, ab)) = result.ok_or("구간을 받지 못했습니다")?;
        let offset = vs.max(as_);
        progress(96.0, "part");
        let tmp = out.with_extension("tmp.mp4");
        let st = crate::media::command("ffmpeg").args(["-hide_banner", "-loglevel", "error", "-y", "-ss", &format!("{:.6}", offset - vs), "-i"]).arg(&vfile).args(["-ss", &format!("{:.6}", offset - as_), "-i"]).arg(&afile)
            .args(["-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart"]).arg(&tmp).output().map_err(|e| e.to_string())?;
        if !st.status.success() { return Err(format!("ffmpeg: {}", String::from_utf8_lossy(&st.stderr).chars().rev().take(400).collect::<String>().chars().rev().collect::<String>())); }
        std::fs::rename(&tmp, &out).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&vfile); let _ = std::fs::remove_file(&afile);
        let meta = json!({ "offset": offset, "start": start, "end": end, "pad": pad, "itag": info.video.itag, "videoStart": vs, "audioStart": as_, "videoBytes": vb, "audioBytes": ab, "createdAt": chrono_like_now() });
        let _ = std::fs::write(&side, serde_json::to_string_pretty(&meta).unwrap());
        progress(100.0, "part");
        Ok(Fetched { path: out, offset, start, end, title: info.title, duration: info.duration, method: "part".into(), id: info.id })
    })();
    match r {
        Ok(f) => Ok(f),
        Err(_) => { let mut f = download_full(url, &|p| progress(p, "download"))?; f.start = start; f.end = end; Ok(f) }
    }
}

fn chrono_like_now() -> String { format!("{}", now_ms()) }

/// 영상 전체를 한 번 받아 둔다 (영상 id 마다 캐시)
pub fn download_full(url: &str, progress: &dyn Fn(f64)) -> Result<Fetched, String> {
    let info = fetch_info(url)?;
    let dir = yt_cache_root().join(&info.id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(format!("{}_full.mp4", info.id));
    let res = |p: PathBuf| Fetched { path: p, offset: 0.0, start: 0.0, end: info.duration, title: info.title.clone(), duration: info.duration, method: "full".into(), id: info.id.clone() };
    if out.metadata().map(|m| m.len() > 0).unwrap_or(false) { progress(100.0); return Ok(res(out)); }
    let ffdir = crate::media::find_tool("ffmpeg").parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let tmpl = dir.join(format!("{}_full.%(ext)s", info.id)).to_string_lossy().to_string();
    let args: Vec<String> = ["--newline", "--no-playlist", "-N", "4", "-f", "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b", "--merge-output-format", "mp4", "--ffmpeg-location", &ffdir, "-o", &tmpl, "--", url].iter().map(|s| s.to_string()).collect();
    let run = || -> Result<(), YtErr> {
        let mut all = js_runtime_args(); all.extend(args.iter().cloned());
        let mut child = crate::media::command_path(&ytdlp_path()).args(&all).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).stdin(std::process::Stdio::null()).spawn().map_err(|e| YtErr { msg: e.to_string(), stderr: String::new() })?;
        let err_h = { let mut e = child.stderr.take().unwrap(); std::thread::spawn(move || { let mut s = String::new(); let _ = e.read_to_string(&mut s); s }) };
        let mut part = 0;
        let re = regex::Regex::new(r"\[download\]\s+(\d+(?:\.\d+)?)%").unwrap();
        for line in std::io::BufRead::lines(std::io::BufReader::new(child.stdout.take().unwrap())).map_while(Result::ok) {
            if line.contains("[download] Destination:") && regex::Regex::new(r"\.f\d+\.m4a").unwrap().is_match(&line) { part = 1; }
            if let Some(c) = re.captures(&line) { let p: f64 = c[1].parse().unwrap_or(0.0); progress(if part == 0 { p * 0.9 } else { 90.0 + p * 0.1 }); }
        }
        let st = child.wait().map_err(|e| YtErr { msg: e.to_string(), stderr: String::new() })?;
        let err = err_h.join().unwrap_or_default();
        if !st.success() || !out.exists() { return Err(YtErr { msg: yt_error(st.code().unwrap_or(-1), &err), stderr: err }); }
        Ok(())
    };
    with_update_retry(run)?;
    progress(100.0);
    Ok(res(out))
}

// ---------------------------------------------------------------- 최근 영상 목록 (settings.recentYoutube)

/// (주소, 제목, 저장 시각 ms) 최근 것이 앞. 보존 개수(recentYoutubeMax, 기본 5)까지
pub fn recent_list(settings: &Value) -> Vec<(String, String, f64)> {
    let max = settings["recentYoutubeMax"].as_u64().unwrap_or(5) as usize;
    settings["recentYoutube"].as_array().into_iter().flatten().filter_map(|r| Some((r["url"].as_str()?.to_string(), r["title"].as_str().unwrap_or("").to_string(), r["at"].as_f64().unwrap_or(0.0)))).take(max).collect()
}
pub fn recent_add(url: &str, title: &str) -> anyhow::Result<Value> {
    let s = theme::app_settings();
    let url = url.trim();
    let max = s["recentYoutubeMax"].as_u64().unwrap_or(5);
    if url.is_empty() || max == 0 { return Ok(s); }
    let prev = s["recentYoutube"].as_array().and_then(|a| a.iter().find(|r| r["url"].as_str() == Some(url))).and_then(|r| r["title"].as_str()).unwrap_or("").to_string();
    let title = if title.is_empty() { prev } else { title.to_string() };
    let mut list = vec![json!({ "url": url, "title": title, "at": now_ms() })];
    list.extend(s["recentYoutube"].as_array().into_iter().flatten().filter(|r| r["url"].as_str() != Some(url)).cloned());
    list.truncate(max as usize);
    theme::save_settings(&json!({ "recentYoutube": list }))
}

/// 이 PC 시간대의 UTC 와의 차이 (초). 최근 목록의 '오늘·어제' 계산용
pub fn local_offset_secs() -> i64 {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::SystemInformation::{GetLocalTime, GetSystemTime};
        let (mut l, mut u) = (std::mem::zeroed(), std::mem::zeroed());
        GetLocalTime(&mut l);
        GetSystemTime(&mut u);
        let secs = |t: &windows_sys::Win32::Foundation::SYSTEMTIME| days_from_civil(t.wYear as i64, t.wMonth as i64, t.wDay as i64) * 86400 + t.wHour as i64 * 3600 + t.wMinute as i64 * 60;
        let d = secs(&l) - secs(&u);
        (d as f64 / 900.0).round() as i64 * 900
    }
    #[cfg(not(windows))]
    {
        static OFF: std::sync::OnceLock<i64> = std::sync::OnceLock::new();
        *OFF.get_or_init(|| {
            let z = std::process::Command::new("date").arg("+%z").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
            let (sign, rest) = match z.as_bytes().first() { Some(b'-') => (-1, &z[1..]), Some(b'+') => (1, &z[1..]), _ => (1, z.as_str()) };
            if rest.len() < 4 { return 0; }
            let (h, m) = (rest[..2].parse::<i64>().unwrap_or(0), rest[2..4].parse::<i64>().unwrap_or(0));
            sign * (h * 3600 + m * 60)
        })
    }
}
/// 1970-01-01 부터의 날 수 ↔ (년, 월, 일)
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d)
}

// ---------------------------------------------------------------- 여러 구간 받아 이어 붙이기 (llm/clips.js)

/// 가까운 구간끼리 묶기 (사이가 gap 초보다 짧으면 하나로)
pub fn cluster_ranges(spans: &[crate::source_fetch::Span], gap: f64, pad: f64) -> Vec<crate::source_fetch::Span> {
    let mut s: Vec<crate::source_fetch::Span> = spans.iter().map(|x| crate::source_fetch::Span { start: (x.start - pad).max(0.0), end: x.end + pad }).collect();
    s.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    let mut out: Vec<crate::source_fetch::Span> = vec![];
    for r in s { match out.last_mut() { Some(l) if r.start - l.end < gap => l.end = l.end.max(r.end), _ => out.push(r) } }
    out
}
pub struct Clips { pub path: PathBuf, pub map: Vec<crate::source_fetch::Piece>, pub duration: f64, pub title: String, pub single: bool }
/// 흩어진 여러 구간을 각각 필요한 만큼만 받아 하나의 영상으로 이어 붙인다. map: 원본 시각 → 이어 붙인 파일 시각
pub fn fetch_clips(url: &str, spans: &[crate::source_fetch::Span], progress: &(dyn Fn(f64) + Sync)) -> Result<Clips, String> {
    use crate::source_fetch::Piece;
    use sha1::Digest;
    let clusters = cluster_ranges(spans, 45.0, 2.0);
    let n = clusters.len().max(1) as f64;
    let mut parts: Vec<(PathBuf, f64, f64)> = vec![];
    let mut title = String::new();
    for (i, c) in clusters.iter().enumerate() {
        let r = fetch_part(url, c.start, c.end, 1.0, &|p, _| progress((((i as f64) + p / 100.0) / n * 100.0).round()))?;
        if title.is_empty() { title = r.title.clone(); }
        let d = crate::media::probe(&r.path).map(|p| p.duration).map_err(|e| e.to_string())?;
        parts.push((r.path, r.offset, d));
    }
    if parts.len() == 1 {
        let (p, s0, d) = parts.remove(0);
        return Ok(Clips { path: p, map: vec![Piece { src0: s0, src1: s0 + d, file0: 0.0 }], duration: d, title, single: true });
    }
    let key_src = parts.iter().map(|(p, s0, _)| format!("{}:{}", p.to_string_lossy(), crate::stt::js_num(Some(*s0)))).collect::<Vec<_>>().join("|");
    let key: String = sha1::Sha1::digest(key_src.as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>()[..16].to_string();
    let dir = cache_dir().join("chat");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(format!("clips_{key}.mp4"));
    if !out.exists() {
        let list = dir.join(format!("clips_{key}.txt"));
        let body = parts.iter().map(|(p, _, _)| format!("file '{}'", p.to_string_lossy().replace('\\', "/").replace('\'', "'\\''"))).collect::<Vec<_>>().join("\n");
        std::fs::write(&list, format!("ffconcat version 1.0\n{body}\n")).map_err(|e| e.to_string())?;
        let tmp = PathBuf::from(format!("{}.tmp.mp4", out.to_string_lossy()));
        let o = crate::media::command("ffmpeg").args(["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i"]).arg(&list).args(["-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-movflags", "+faststart"]).arg(&tmp).output().map_err(|e| e.to_string())?;
        if !o.status.success() { let e = String::from_utf8_lossy(&o.stderr); return Err(format!("ffmpeg {}: {}", o.status.code().unwrap_or(-1), &e[e.len().saturating_sub(400)..])); }
        std::fs::rename(&tmp, &out).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&list);
    }
    let mut map = vec![];
    let mut f0 = 0.0;
    for (_, s0, d) in &parts { map.push(Piece { src0: *s0, src1: s0 + d, file0: f0 }); f0 += d; }
    let duration = crate::media::probe(&out).map(|p| p.duration).map_err(|e| e.to_string())?;
    Ok(Clips { path: out, map, duration, title, single: false })
}

// ---------------------------------------------------------------- 배경음악 보관함: 소리만 받기 · 재생목록 (youtube.js)

pub struct AudioDl { pub file: PathBuf, pub id: String, pub title: String, pub uploader: String, pub duration: f64 }
/// 소리만 받아 out_dir/yt-<id>.<ext> 로 (이미 있으면 그대로)
pub fn download_audio(url: &str, out_dir: &Path, progress: &dyn Fn(f64)) -> Result<AudioDl, String> {
    let info = fetch_info(url)?;
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let prefix = format!("yt-{}.", info.id);
    let found = || std::fs::read_dir(out_dir).ok().and_then(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| { let n = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase(); n.starts_with(&prefix.to_lowercase()) && !n.ends_with(".part") && !n.ends_with(".ytdl") && !n.ends_with(".json") }));
    let res = |f: PathBuf| AudioDl { file: f, id: info.id.clone(), title: if info.title.is_empty() { info.id.clone() } else { info.title.clone() }, uploader: info.uploader.clone(), duration: info.duration };
    if let Some(h) = found() { if h.metadata().map(|m| m.len() > 2048).unwrap_or(false) { progress(100.0); return Ok(res(h)); } }
    let tmpl = out_dir.join(format!("yt-{}.%(ext)s", info.id)).to_string_lossy().to_string();
    let args: Vec<String> = ["--newline", "--no-playlist", "-N", "4", "-f", "bestaudio[ext=m4a]/bestaudio", "-o", &tmpl, "--", url].iter().map(|s| s.to_string()).collect();
    let run = || -> Result<(), YtErr> {
        let mut all = js_runtime_args(); all.extend(args.iter().cloned());
        let mut child = crate::media::command_path(&ytdlp_path()).args(&all).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).stdin(std::process::Stdio::null()).spawn().map_err(|e| YtErr { msg: e.to_string(), stderr: String::new() })?;
        let err_h = { let mut e = child.stderr.take().unwrap(); std::thread::spawn(move || { let mut s = String::new(); let _ = e.read_to_string(&mut s); s }) };
        let re = regex::Regex::new(r"\[download\]\s+(\d+(?:\.\d+)?)%").unwrap();
        for line in std::io::BufRead::lines(std::io::BufReader::new(child.stdout.take().unwrap())).map_while(Result::ok) {
            if let Some(c) = re.captures(&line) { progress(c[1].parse().unwrap_or(0.0)); }
        }
        let st = child.wait().map_err(|e| YtErr { msg: e.to_string(), stderr: String::new() })?;
        let err = err_h.join().unwrap_or_default();
        if !st.success() || found().is_none() { let tail: String = { let c: Vec<char> = err.chars().collect(); c[c.len().saturating_sub(4000)..].iter().collect() }; return Err(YtErr { msg: yt_error(st.code().unwrap_or(-1), &tail), stderr: tail }); }
        Ok(())
    };
    with_update_retry(run)?;
    progress(100.0);
    Ok(res(found().ok_or("받은 파일을 찾지 못했습니다")?))
}
/// 재생목록 주소면 곡 목록(최대 max개), 영상 주소면 그 하나 → (주소, 제목, id)
pub fn list_playlist(url: &str, max: usize) -> Result<Vec<(String, String, String)>, String> {
    let url = url.trim();
    let is_list = regex::Regex::new(r"[?&]list=").unwrap().is_match(url) && !regex::Regex::new(r"[?&]v=|youtu\.be/|shorts/").unwrap().is_match(url);
    if !is_list {
        let id = regex::Regex::new(r"(?:youtu\.be/|[?&]v=|shorts/|live/)([\w-]{11})").unwrap().captures(url).map(|c| c[1].to_string()).unwrap_or_default();
        return Ok(vec![(url.to_string(), String::new(), id)]);
    }
    let out = with_update_retry(|| run_ytdlp_once(&["--flat-playlist".into(), "-J".into(), "--playlist-end".into(), max.to_string(), "--".into(), url.into()]))?;
    let j: Value = serde_json::from_str(&out).map_err(|_| "재생목록을 읽지 못했습니다.".to_string())?;
    Ok(j["entries"].as_array().into_iter().flatten().filter_map(|x| { let id = x["id"].as_str()?; Some((format!("https://www.youtube.com/watch?v={id}"), x["title"].as_str().unwrap_or("").to_string(), id.to_string())) }).take(max).collect())
}

/// 유튜브용 JS 런타임 (종류, 경로, 판) — 시스템 점검용
pub fn js_runtime() -> Option<(String, PathBuf, String)> {
    let _ = js_runtime_args();
    let node = crate::media::find_tool("node");
    if node.exists() {
        if let Ok(o) = crate::media::command_path(&node).args(["-e", "process.stdout.write(process.version)"]).output() { if o.status.success() { return Some(("node".into(), node, String::from_utf8_lossy(&o.stdout).trim().to_string())); } }
    }
    let deno = runtime_dir().join("bin").join(exe("deno"));
    if deno.exists() {
        let v = crate::media::command_path(&deno).arg("--version").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").to_string()).unwrap_or_default();
        return Some(("deno".into(), deno, v));
    }
    None
}
/// 지금 쓰는 yt-dlp 판 (없으면 빈 글)
pub fn ytdlp_version() -> String { version_of(&ytdlp_path()) }