//! 배경음악 (기존 src/shared/bgm.js · src/main/bgm.js · src/main/fetch-parts.js)
//!  - 배치 계산 (plan · gainAt · trackTimeAt · ffmpeg 필터): 미리보기와 내보내기가 같은 계산
//!  - 곡 목록 (assets/bgm/catalog.json) · 앱에 넣어 둔 파형 (assets/bgm/peaks.json). 음악 파일은 앱에 없다
//!  - 받기: 쓰기로 한 곡·내보낼 때만 사용자 캐시(runtime/cache/bgm)에 한 번 (여러 갈래 동시 받기)
//!  - 보관함: 내 파일·유튜브에서 넣은 곡 (문서\SermonShorts\배경음악, index.json) — Electron 판과 같은 폴더·같은 파일
use crate::{media, settings, theme, youtube};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

// ================================================================ 배치 계산 (shared/bgm.js)

pub const DEF_VOLUME: f64 = 0.2;
pub const DEF_FADE_IN: f64 = 1.0;
pub const DEF_FADE_OUT: f64 = 2.0;

#[derive(Clone, Debug, PartialEq)]
pub struct Bgm { pub id: String, pub duration: Option<f64>, pub track_start: f64, pub track_end: f64, pub align: String, pub fade_in: f64, pub fade_out: f64, pub volume: f64 }
impl Bgm {
    pub fn to_json(&self) -> Value {
        json!({ "id": self.id, "duration": self.duration, "trackStart": self.track_start, "trackEnd": self.track_end, "align": self.align, "fadeIn": self.fade_in, "fadeOut": self.fade_out, "volume": self.volume })
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plan { pub from: f64, pub length: f64, pub delay: f64, pub fade_in: f64, pub fade_out: f64, pub volume: f64 }
impl Plan { pub fn to_json(&self) -> Value { json!({ "from": self.from, "length": self.length, "delay": self.delay, "fadeIn": self.fade_in, "fadeOut": self.fade_out, "volume": self.volume }) } }

fn is_num(v: &Value) -> Option<f64> { v.as_f64().filter(|x| x.is_finite()) }
fn clamp(x: f64, lo: f64, hi: f64) -> f64 { if x < lo { lo } else if x > hi { hi } else { x } }

/// 저장된 값 다듬기 (모르는 값은 기본값, 구간은 곡 길이 안으로). id 가 없으면 None
pub fn normalize(b: &Value) -> Option<Bgm> {
    let id = b["id"].as_str().filter(|s| !s.is_empty())?.to_string();
    if !b.is_object() { return None; }
    let dur = is_num(&b["duration"]).filter(|d| *d > 0.0);
    let top = dur.unwrap_or(36000.0);
    let mut a = clamp(is_num(&b["trackStart"]).unwrap_or(0.0), 0.0, top);
    let mut e = clamp(is_num(&b["trackEnd"]).unwrap_or(top), 0.0, top);
    if !(e - a >= 0.5) { a = 0.0; e = top; }
    Some(Bgm {
        id, duration: dur, track_start: a, track_end: e,
        align: if b["align"].as_str() == Some("end") { "end".into() } else { "start".into() },
        fade_in: clamp(is_num(&b["fadeIn"]).unwrap_or(DEF_FADE_IN), 0.0, 30.0),
        fade_out: clamp(is_num(&b["fadeOut"]).unwrap_or(DEF_FADE_OUT), 0.0, 30.0),
        volume: clamp(is_num(&b["volume"]).unwrap_or(DEF_VOLUME), 0.0, 1.0),
    })
}
pub fn plan(b: &Value, out_dur: f64) -> Option<Plan> {
    let b = normalize(b)?;
    if !(out_dur > 0.0) { return None; }
    let sel = b.track_end - b.track_start;
    let length = sel.min(out_dur);
    if !(length > 0.0) { return None; }
    let (from, delay) = if b.align == "end" { (b.track_end - length, out_dur - length) } else { (b.track_start, 0.0) };
    Some(Plan { from, length, delay, fade_in: b.fade_in.min(length / 2.0), fade_out: b.fade_out.min(length / 2.0), volume: b.volume })
}
/// 영상 시각 out_t 에서의 음악 크기 (0~volume)
pub fn gain_at(p: Option<&Plan>, out_t: f64) -> f64 {
    let Some(p) = p else { return 0.0 };
    let x = out_t - p.delay;
    if !(x >= 0.0 && x <= p.length) { return 0.0; }
    let mut g = 1.0;
    if p.fade_in > 0.0 && x < p.fade_in { g = x / p.fade_in; }
    if p.fade_out > 0.0 && x > p.length - p.fade_out { g = f64::min(g, (p.length - x) / p.fade_out); }
    p.volume * clamp(g, 0.0, 1.0)
}
/// 영상 시각 out_t 에 곡의 몇 초가 나와야 하는지 (음악이 없는 때면 None)
pub fn track_time_at(p: Option<&Plan>, out_t: f64) -> Option<f64> {
    let p = p?;
    let x = out_t - p.delay;
    (x >= 0.0 && x <= p.length).then_some(p.from + x)
}
/// JS (Math.round(x*1000)/1000).toFixed(3)
fn f3(x: f64) -> String { format!("{:.3}", ((x * 1000.0) + 0.5).floor() / 1000.0) }
/// ffmpeg 오디오 필터: 음악 입력을 [bgm] 으로 만들고 말소리와 섞어 [aout]
pub fn ffmpeg_filter(p: &Plan, input_index: usize, speech_label: &str) -> String {
    let mut c = format!("[{input_index}:a]atrim=start={}:end={},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo", f3(p.from), f3(p.from + p.length));
    if p.fade_in > 0.001 { c += &format!(",afade=t=in:st=0:d={}", f3(p.fade_in)); }
    if p.fade_out > 0.001 { c += &format!(",afade=t=out:st={}:d={}", f3((p.length - p.fade_out).max(0.0)), f3(p.fade_out)); }
    c += &format!(",volume={}", f3(p.volume));
    let ms = (p.delay * 1000.0 + 0.5).floor() as i64;
    if ms > 0 { c += &format!(",adelay={ms}|{ms}"); }
    c += "[bgm]; ";
    c += &format!("{speech_label}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[speech]; ");
    c += "[speech][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]";
    c
}
/// 초 → 1:05
pub fn fmt(sec: f64) -> String {
    let sec = if sec.is_finite() && sec >= 0.0 { sec } else { 0.0 };
    let s = (sec + 0.5).floor() as i64;
    format!("{}:{:02}", s / 60, s % 60)
}

// ================================================================ 곡 목록 · 파형 (bgm-catalog.js · bgm-peaks.js)

#[derive(Clone, Debug, Default)]
pub struct Track {
    pub id: String, pub title: String, pub artist: String, pub mood: String, pub tags: Vec<String>, pub url: String, pub page: String,
    pub license: String, pub attribution: Option<String>, pub license_quote: String, pub duration_sec: f64,
    /// 직접 넣은 음악 (보관함)
    pub custom: bool, pub kind: String, pub file: Option<PathBuf>, pub source: String, pub missing: bool, pub added_at: f64,
}
pub struct Catalog { pub moods: Vec<String>, pub tracks: Vec<Track>, bins: usize, peaks: HashMap<String, (f64, Vec<u8>)> }
pub fn catalog() -> &'static Catalog {
    static C: OnceLock<Catalog> = OnceLock::new();
    C.get_or_init(|| {
        let dir = crate::assets_dir().join("bgm");
        let c: Value = std::fs::read_to_string(dir.join("catalog.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}));
        let s = |v: &Value| v.as_str().unwrap_or("").to_string();
        let tracks = c["tracks"].as_array().into_iter().flatten().map(|t| Track {
            id: s(&t["id"]), title: s(&t["title"]), artist: s(&t["artist"]), mood: s(&t["mood"]), tags: t["tags"].as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect(),
            url: s(&t["url"]), page: s(&t["page"]), license: s(&t["license"]), attribution: t["attribution"].as_str().filter(|x| !x.is_empty()).map(String::from), license_quote: s(&t["licenseQuote"]),
            duration_sec: t["durationSec"].as_f64().unwrap_or(0.0), ..Default::default()
        }).collect();
        let p: Value = std::fs::read_to_string(dir.join("peaks.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}));
        use base64::Engine;
        let peaks = p["data"].as_object().map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), (v["d"].as_f64()?, base64::engine::general_purpose::STANDARD.decode(v["p"].as_str()?).ok()?)))).collect()).unwrap_or_default();
        Catalog { moods: c["moods"].as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect(), tracks, bins: p["bins"].as_u64().unwrap_or(1000) as usize, peaks }
    })
}
/// 앱에 넣어 둔 파형을 n 칸(0~1)으로 → (길이, 봉우리). 없으면 None (기존 bgmPeaks.get)
pub fn bundled_peaks(id: &str, n: usize) -> Option<(f64, Vec<f64>)> {
    let c = catalog();
    let (d, a) = c.peaks.get(id)?;
    let n = n.clamp(10, 4000);
    let bins = c.bins;
    let mut out = vec![0u8; n];
    let mut max = 0u8;
    for (i, o) in out.iter_mut().enumerate() {
        let s = i * bins / n;
        let t = (s + 1).max((i + 1) * bins / n);
        let m = (s..t.min(bins)).filter_map(|k| a.get(k)).copied().max().unwrap_or(0);
        *o = m; max = max.max(m);
    }
    Some((*d, out.iter().map(|&v| if max > 0 { ((v as f64 / max as f64) * 1000.0 + 0.5).floor() / 1000.0 } else { 0.0 }).collect()))
}

// ================================================================ 보관함 (직접 넣은 음악)

pub const AUDIO_EXT: [&str; 10] = ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "webm", "mp4"];
fn can_write_dir(d: &Path) -> bool {
    if std::fs::create_dir_all(d).is_err() { return false; }
    let p = d.join(format!(".ss-write-test-{}", std::process::id()));
    let ok = std::fs::write(&p, b"ok").is_ok();
    let _ = std::fs::remove_file(&p);
    ok
}
pub fn wanted_library_dir() -> PathBuf {
    if let Ok(d) = std::env::var("SS_BGM_LIBRARY") { if !d.is_empty() { return PathBuf::from(d); } }
    if let Some(d) = settings::load()["bgmLibraryDir"].as_str().filter(|d| !d.is_empty()) { return PathBuf::from(d); }
    crate::documents_dir().join("SermonShorts").join("배경음악")
}
/// 보관함 폴더 (문서 폴더를 '제어된 폴더 액세스'가 막으면 앱 데이터 폴더의 배경음악) → (폴더, 대신 쓰는 중인지)
pub fn library_info() -> (PathBuf, PathBuf, bool) {
    let want = wanted_library_dir();
    if can_write_dir(&want) { return (want.clone(), want, false); }
    let d = theme::user_data_dir().join("배경음악");
    let _ = std::fs::create_dir_all(&d);
    (d, want, true)
}
pub fn library_dir() -> PathBuf { library_info().0 }
/// 파일 이름으로 쓸 수 있게 (윈도우 금지 글자 빼고 80자)
pub fn safe_file(name: &str) -> String {
    let s: String = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) || (c as u32) < 0x20 { ' ' } else { c }).collect();
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = s.trim_end_matches(['.', ' ']).to_string();
    let s: String = s.chars().take(80).collect();
    if s.is_empty() { "음악".into() } else { s }
}
fn unique_file(dir: &Path, base: &str, ext: &str, me: Option<&Path>) -> PathBuf {
    let mut p = dir.join(format!("{base}.{ext}"));
    let mut n = 2;
    while p.exists() && me.is_none_or(|m| std::fs::canonicalize(&p).ok() != std::fs::canonicalize(m).ok()) { p = dir.join(format!("{base} ({n}).{ext}")); n += 1; }
    p
}
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> { if std::fs::rename(from, to).is_err() { std::fs::copy(from, to)?; std::fs::remove_file(from)?; } Ok(()) }
fn read_index(lib: &Path) -> serde_json::Map<String, Value> { std::fs::read_to_string(lib.join("index.json")).ok().and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok()).and_then(|v| v.as_object().cloned()).unwrap_or_default() }
fn save_index(m: &serde_json::Map<String, Value>) -> Result<(), String> { std::fs::write(library_dir().join("index.json"), serde_json::to_string_pretty(m).unwrap_or_default()).map_err(|e| e.to_string()) }
pub fn custom_track(id: &str) -> Option<Track> {
    let m = read_index(&library_dir());
    let e = m.get(id)?;
    let s = |k: &str| e[k].as_str().unwrap_or("").to_string();
    let kind = s("kind");
    let file = e["file"].as_str().map(PathBuf::from);
    let yt = kind == "youtube";
    Some(Track {
        id: id.into(), title: s("title"), artist: e["artist"].as_str().filter(|x| !x.is_empty()).map(String::from).unwrap_or_else(|| if yt { "유튜브".into() } else { "내 파일".into() }),
        mood: e["mood"].as_str().filter(|x| !x.is_empty()).unwrap_or("내 음악").into(), tags: vec![], missing: !file.as_ref().is_some_and(|f| f.exists()),
        duration_sec: e["durationSec"].as_f64().unwrap_or(0.0), url: file.as_ref().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(), file, source: s("source"),
        license: if yt { "유튜브에서 가져옴".into() } else { "내 파일".into() }, attribution: None, license_quote: "직접 넣은 음악입니다. 저작권은 직접 확인해 주세요.".into(),
        custom: true, kind, page: String::new(), added_at: e["addedAt"].as_f64().unwrap_or(0.0),
    })
}
pub fn list_custom() -> Vec<Track> {
    let mut v: Vec<Track> = read_index(&library_dir()).keys().filter_map(|k| custom_track(k)).collect();
    v.sort_by(|a, b| b.added_at.partial_cmp(&a.added_at).unwrap_or(std::cmp::Ordering::Equal));
    v
}
/// 길이와 소리 줄기 여부 (영상만 있는 mp4 는 길이는 있어도 소리가 없다)
pub fn probe_audio(file: &Path) -> (f64, bool) {
    let out = media::command("ffprobe").args(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type:format=duration", "-of", "json"]).arg(file).output();
    let Ok(o) = out else { return (0.0, false) };
    let j: Value = serde_json::from_slice(&o.stdout).unwrap_or(json!({}));
    (j["format"]["duration"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0.0), j["streams"].as_array().is_some_and(|a| !a.is_empty()))
}
fn now_ms() -> f64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0) }
fn add_custom(id: &str, mut entry: serde_json::Map<String, Value>) -> Result<Track, String> {
    let file = PathBuf::from(entry["file"].as_str().unwrap_or(""));
    let (dur, has_audio) = probe_audio(&file);
    if !(dur > 1.0) || !has_audio {
        if file.starts_with(library_dir()) && !read_index(&library_dir()).contains_key(id) { let _ = std::fs::remove_file(&file); }
        return Err(if dur > 1.0 && !has_audio { "소리가 들어 있지 않은 파일입니다 (영상만 있음). 음악이 담긴 파일을 골라 주세요.".into() } else if dur > 0.0 { "너무 짧은 파일입니다 (1초 이하). 음악 파일을 골라 주세요.".into() } else { "소리를 읽을 수 없는 파일입니다. mp3·m4a·wav 같은 음악 파일을 골라 주세요.".into() });
    }
    let mut m = read_index(&library_dir());
    entry.insert("durationSec".into(), json!(((dur * 100.0) + 0.5).floor() / 100.0));
    entry.insert("addedAt".into(), json!(now_ms()));
    m.insert(id.into(), Value::Object(entry));
    save_index(&m)?;
    custom_track(id).ok_or_else(|| "보관함에 넣지 못했습니다".into())
}
/// 내 파일 넣기 → (곡, 이미 있었는지)
pub fn import_file(src: &Path) -> Result<(Track, bool), String> {
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !AUDIO_EXT.contains(&ext.as_str()) { return Err("음악 파일(mp3·m4a·wav·ogg·flac 등)을 골라 주세요.".into()); }
    let st = std::fs::metadata(src).map_err(|_| "파일을 찾을 수 없습니다. 이름이나 위치가 바뀌었는지 확인해 주세요.".to_string())?;
    if !st.is_file() { return Err("파일이 아니라 폴더입니다. 음악 파일을 골라 주세요.".into()); }
    if st.len() > 200 * 1024 * 1024 { return Err("음악 파일이 너무 큽니다(200MB 넘음).".into()); }
    let mtime = st.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0);
    let hash = crate::autosave::sha16(format!("{}|{}|{}", src.to_string_lossy(), st.len(), crate::stt::js_num(Some(mtime))).as_bytes())[..12].to_string();
    let id = format!("custom-f-{hash}");
    if let Some(t) = custom_track(&id) { if !t.missing { return Ok((t, true)); } }
    let title = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let lib = library_dir();
    let file = unique_file(&lib, &safe_file(&title), &ext, None);
    std::fs::copy(src, &file).map_err(|e| format!("음악 파일을 복사하지 못했습니다: {e}"))?;
    let mut e = serde_json::Map::new();
    for (k, v) in [("kind", json!("file")), ("title", json!(title)), ("artist", json!("내 파일")), ("file", json!(file.to_string_lossy())), ("source", json!(src.to_string_lossy()))] { e.insert(k.into(), v); }
    Ok((add_custom(&id, e)?, false))
}
/// 유튜브에서 소리만 받아 넣기 → (곡, 이미 있었는지)
pub fn import_youtube(url: &str, progress: &dyn Fn(f64)) -> Result<(Track, bool), String> {
    let url = url.trim();
    if !regex::Regex::new(r"(?i)^https?://([\w-]+\.)?(youtube\.com|youtu\.be)/").unwrap().is_match(url) { return Err("유튜브 주소를 넣어 주세요 (https://youtu.be/... 또는 https://www.youtube.com/...).".into()); }
    if let Some(vid) = regex::Regex::new(r"(?:youtu\.be/|[?&]v=|shorts/|live/)([\w-]{11})").unwrap().captures(url).map(|c| c[1].to_string()) {
        if let Some(t) = custom_track(&format!("custom-yt-{vid}")) { if !t.missing { progress(100.0); return Ok((t, true)); } }
    }
    let lib = library_dir();
    let r = youtube::download_audio(url, &lib, progress)?;
    let ext = r.file.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "m4a".into());
    let mut file = r.file.clone();
    let to = unique_file(&lib, &safe_file(&r.title), &ext, Some(&r.file));
    if std::fs::canonicalize(&to).ok() != std::fs::canonicalize(&r.file).ok() && move_file(&r.file, &to).is_ok() { file = to; }
    let mut e = serde_json::Map::new();
    for (k, v) in [("kind", json!("youtube")), ("title", json!(r.title)), ("artist", json!(if r.uploader.is_empty() { "유튜브".to_string() } else { r.uploader.clone() })), ("file", json!(file.to_string_lossy())), ("source", json!(format!("https://www.youtube.com/watch?v={}", r.id)))] { e.insert(k.into(), v); }
    Ok((add_custom(&format!("custom-yt-{}", r.id), e)?, false))
}
/// 보관함 곡 정보 고치기: 제목·분위기 (제목을 바꾸면 파일 이름도)
pub fn update_custom(id: &str, title: Option<&str>, mood: Option<&str>) -> Result<Track, String> {
    let mut m = read_index(&library_dir());
    let lib = library_dir();
    let e = m.get_mut(id).and_then(|v| v.as_object_mut()).ok_or("보관함에 없는 곡입니다.")?;
    if let Some(t) = title.map(str::trim).filter(|t| !t.is_empty() && Some(*t) != e.get("title").and_then(|x| x.as_str())) {
        let t: String = t.chars().take(120).collect();
        e.insert("title".into(), json!(t));
        if let Some(f) = e.get("file").and_then(|x| x.as_str()).map(PathBuf::from) {
            if f.exists() && f.parent().and_then(|p| std::fs::canonicalize(p).ok()) == std::fs::canonicalize(&lib).ok() {
                let ext = f.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_else(|| "mp3".into());
                let to = unique_file(&lib, &safe_file(&t), &ext, Some(&f));
                if std::fs::canonicalize(&to).ok() != std::fs::canonicalize(&f).ok() && move_file(&f, &to).is_ok() { e.insert("file".into(), json!(to.to_string_lossy())); }
            }
        }
    }
    if let Some(md) = mood {
        let ok = md == "내 음악" || catalog().moods.iter().any(|x| x == md);
        e.insert("mood".into(), json!(if ok { md } else { "내 음악" }));
    }
    save_index(&m)?;
    custom_track(id).ok_or_else(|| "보관함에 없는 곡입니다.".into())
}
pub fn remove_custom(id: &str) -> bool {
    let mut m = read_index(&library_dir());
    let Some(e) = m.remove(id) else { return false };
    let _ = save_index(&m);
    if let Some(f) = e["file"].as_str().map(PathBuf::from) { if f.starts_with(library_dir()) { let _ = std::fs::remove_file(f); } }
    if let Ok(rd) = std::fs::read_dir(cache_dir()) { for x in rd.flatten() { if x.file_name().to_string_lossy().starts_with(&format!("{id}.peaks")) { let _ = std::fs::remove_file(x.path()); } } }
    true
}

// ================================================================ 곡 찾기 · 받기 (main/bgm.js · fetch-parts.js)

pub fn track_of(id: &str) -> Result<Track, String> {
    if let Some(t) = catalog().tracks.iter().find(|t| t.id == id) { return Ok(t.clone()); }
    if id.starts_with("custom-") { return custom_track(id).ok_or_else(|| "직접 넣은 음악을 찾을 수 없습니다. 음악을 다시 넣어 주세요.".into()); }
    Err("목록에 없는 음악입니다. 다시 골라 주세요.".into())
}
pub fn cache_dir() -> PathBuf { let d = youtube::cache_dir().join("bgm"); let _ = std::fs::create_dir_all(&d); d }
fn ext_of(t: &Track) -> String {
    let src = if t.custom { t.file.as_ref().map(|f| f.to_string_lossy().to_string()).unwrap_or_default() } else { t.url.clone() };
    regex::Regex::new(r"(?i)\.(mp3|ogg|oga|opus|m4a|wav|flac|aac|webm|mp4)(?:$|[?#])").unwrap().captures(&src).map(|c| c[1].to_lowercase()).unwrap_or_else(|| "mp3".into())
}
pub fn file_of(t: &Track) -> PathBuf { if t.custom { t.file.clone().unwrap_or_default() } else { cache_dir().join(format!("{}.{}", t.id, ext_of(t))) } }
pub fn cached_file(id: &str) -> Option<PathBuf> { let f = file_of(&track_of(id).ok()?); (f.metadata().map(|m| m.len()).unwrap_or(0) > 2048).then_some(f) }

const MAX_BYTES: u64 = 60 * 1024 * 1024;
const MIN_PART: u64 = 512 * 1024;
const UA: &str = "SermonShorts/1.0 (+https://github.com/hahadark/sermon-shorts; sermon shorts editor)";
fn agent() -> ureq::Agent { ureq::AgentBuilder::new().timeout_connect(std::time::Duration::from_secs(15)).timeout_read(std::time::Duration::from_secs(30)).build() }
/// 여러 갈래(Range)로 동시에 받기. 서버가 나눠 받기를 안 받아 주면 한 갈래로 (기존 fetch-parts.js)
pub fn fetch_parts(url: &str, parts: usize, progress: &(dyn Fn(u64, u64) + Sync)) -> Result<Vec<u8>, String> {
    let ag = agent();
    let single = regex::Regex::new(r"(?i)(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$").unwrap();
    let host = url.split("://").nth(1).and_then(|r| r.split('/').next()).unwrap_or("");
    let parts = if single.is_match(host) { 1 } else { parts.clamp(1, 12) };
    let get = |range: Option<String>| -> Result<ureq::Response, (u16, String)> {
        let mut req = ag.get(url).set("User-Agent", UA);
        if let Some(r) = range { req = req.set("Range", &r); }
        match req.call() { Ok(r) => Ok(r), Err(ureq::Error::Status(c, r)) => Err((c, r.status_text().to_string())), Err(e) => Err((0, e.to_string())) }
    };
    let get_retry = || -> Result<ureq::Response, String> {
        for attempt in 0..4 {
            match get(None) {
                Ok(r) => return Ok(r),
                Err((c, _)) if (c == 429 || c == 503) && attempt < 3 => std::thread::sleep(std::time::Duration::from_millis((800 * 2u64.pow(attempt)).min(8000))),
                Err((c, m)) => return Err(if c > 0 { format!("HTTP {c}") } else { m }),
            }
        }
        Err("HTTP 429".into())
    };
    let whole = |r: ureq::Response| -> Result<Vec<u8>, String> {
        let len: u64 = r.header("content-length").and_then(|s| s.parse().ok()).unwrap_or(0);
        if len > MAX_BYTES { return Err("파일이 너무 큽니다.".into()); }
        let mut buf = Vec::with_capacity(len as usize);
        let mut rd = r.into_reader().take(MAX_BYTES + 1);
        let mut chunk = vec![0u8; 65536];
        loop { let n = rd.read(&mut chunk).map_err(|e| e.to_string())?; if n == 0 { break; } buf.extend_from_slice(&chunk[..n]); progress(buf.len() as u64, len.max(buf.len() as u64)); }
        if buf.len() as u64 > MAX_BYTES { return Err("파일이 너무 큽니다.".into()); }
        Ok(buf)
    };
    if parts < 2 { return whole(get_retry()?); }
    // 첫 요청을 바로 'bytes=0-' 로: 길이를 따로 묻지 않고 앞부분을 받으면서 길이를 알아낸다
    let first = match get(Some("bytes=0-".into())) { Ok(r) => r, Err((c, _)) if c == 429 || c == 503 => return whole(get_retry()?), Err((c, m)) => return Err(if c > 0 { format!("HTTP {c}") } else { m }) };
    let total = first.header("content-range").and_then(|cr| cr.rsplit('/').next()).and_then(|s| s.trim().parse::<u64>().ok());
    let Some(len) = total.filter(|_| first.status() == 206) else { return whole(first) };
    if len > MAX_BYTES { return Err("파일이 너무 큽니다.".into()); }
    let n = (parts as u64).min(len / MIN_PART).max(1);
    let size = len.div_ceil(n);
    let segs: Vec<(u64, u64)> = (0..n).map(|i| (i * size, ((i + 1) * size - 1).min(len - 1))).collect();
    let buf = Mutex::new(vec![0u8; len as usize]);
    let got = std::sync::atomic::AtomicU64::new(0);
    // 응답 본문을 buf 의 seg 자리에 (seg 끝을 넘는 부분은 버린다). 받은 바이트 수
    let pump = |r: ureq::Response, a: u64, b: u64, from: u64| -> Result<u64, String> {
        let mut rd = r.into_reader();
        let mut pos = from;
        let mut chunk = vec![0u8; 65536];
        while pos <= b {
            let want = ((b + 1 - pos) as usize).min(chunk.len());
            let k = rd.read(&mut chunk[..want]).map_err(|e| e.to_string())?;
            if k == 0 { break; }
            buf.lock().unwrap()[pos as usize..pos as usize + k].copy_from_slice(&chunk[..k]);
            pos += k as u64;
            let g = got.fetch_add(k as u64, std::sync::atomic::Ordering::SeqCst) + k as u64;
            progress(g, len);
        }
        let _ = a;
        Ok(pos)
    };
    let seg_job = |a: u64, b: u64, first: Option<ureq::Response>| -> Result<(), String> {
        let mut pos = a;
        if let Some(r) = first { pos = pump(r, a, b, a).unwrap_or(pos); }
        let mut last = String::new();
        for attempt in 0..4 {
            if pos > b { return Ok(()); }
            match get(Some(format!("bytes={pos}-{b}"))) {
                Ok(r) if r.status() == 206 => match pump(r, a, b, pos) { Ok(p) => pos = p, Err(e) => last = e },
                Ok(r) => return Err(format!("no-range {}", r.status())),
                Err((c, m)) => last = if c > 0 { format!("HTTP {c}") } else { m },
            }
            if pos > b { return Ok(()); }
            std::thread::sleep(std::time::Duration::from_millis(300 * (attempt + 1)));
        }
        if pos > b { Ok(()) } else { Err(if last.is_empty() { "덜 받았습니다".into() } else { last }) }
    };
    let results: Vec<Result<(), String>> = std::thread::scope(|sc| {
        let mut hs = vec![];
        let mut first = Some(first);
        for (i, &(a, b)) in segs.iter().enumerate() {
            let f = if i == 0 { first.take() } else { None };
            let job = &seg_job;
            hs.push(sc.spawn(move || job(a, b, f)));
        }
        hs.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("받기 실패".into()))).collect()
    });
    if let Some(Err(e)) = results.iter().find(|r| r.is_err()) {
        if e.starts_with("no-range") { got.store(0, std::sync::atomic::Ordering::SeqCst); return whole(get_retry()?); }
        return Err(e.clone());
    }
    Ok(buf.into_inner().unwrap())
}

fn jobs() -> &'static Mutex<HashMap<String, std::sync::Arc<(Mutex<Option<Result<PathBuf, String>>>, std::sync::Condvar)>>> { static J: OnceLock<Mutex<HashMap<String, std::sync::Arc<(Mutex<Option<Result<PathBuf, String>>>, std::sync::Condvar)>>>> = OnceLock::new(); J.get_or_init(Default::default) }
fn friendly(e: &str) -> String {
    if let Some(c) = e.strip_prefix("HTTP ") { return format!("음악을 받지 못했습니다 (HTTP {c}). 잠시 뒤 다시 해 주세요."); }
    if e.contains("너무 큽니다") { return "음악 파일이 너무 큽니다.".into(); }
    format!("음악을 받지 못했습니다. 인터넷 연결을 확인해 주세요. ({e})")
}
/// 곡 파일을 캐시에 받아 두고 경로 (이미 있으면 바로). 같은 곡을 여러 곳에서 불러도 한 번만 받는다. progress(받은, 전체)
pub fn ensure(id: &str, progress: &(dyn Fn(u64, u64) + Sync)) -> Result<PathBuf, String> {
    if let Some(f) = cached_file(id) { return Ok(f); }
    let t = track_of(id)?;
    if t.custom { return Err("직접 넣은 음악 파일이 없어졌습니다. 음악을 다시 넣어 주세요.".into()); }
    let (job, mine) = {
        let mut j = jobs().lock().unwrap();
        match j.get(id) { Some(x) => (x.clone(), false), None => { let x = std::sync::Arc::new((Mutex::new(None), std::sync::Condvar::new())); j.insert(id.into(), x.clone()); (x, true) } }
    };
    if !mine {
        let mut g = job.0.lock().unwrap();
        while g.is_none() { g = job.1.wait(g).unwrap(); }
        return g.clone().unwrap();
    }
    let file = file_of(&t);
    let r = fetch_parts(&t.url, 6, progress).map_err(|e| friendly(&e)).and_then(|buf| {
        if buf.len() < 2048 || buf.len() as u64 > MAX_BYTES { return Err("음악 파일이 올바르지 않습니다.".into()); }
        let tmp = PathBuf::from(format!("{}.{}.part", file.to_string_lossy(), std::process::id()));
        std::fs::write(&tmp, &buf).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
        progress(buf.len() as u64, buf.len() as u64);
        Ok(file.clone())
    });
    *job.0.lock().unwrap() = Some(r.clone());
    job.1.notify_all();
    jobs().lock().unwrap().remove(id);
    r
}

/// 파형용 봉우리 값 (0~1, n개)과 길이. 앱에 넣어 둔 것 → 캐시 → 받아서 계산 (기존 peaks)
pub fn peaks(id: &str, n: usize) -> Result<(f64, Vec<f64>), String> {
    let n = n.clamp(50, 2000);
    let t = track_of(id)?;
    if let Some(p) = bundled_peaks(id, n) { return Ok(p); }
    let cache = cache_dir().join(format!("{}.peaks{n}.json", t.id));
    if let Some(v) = std::fs::read_to_string(&cache).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
        if let (Some(d), Some(p)) = (v["duration"].as_f64(), v["peaks"].as_array()) { return Ok((d, p.iter().filter_map(|x| x.as_f64()).collect())); }
    }
    let file = ensure(id, &|_, _| {})?;
    const RATE: usize = 4000;
    let o = media::command("ffmpeg").args(["-v", "error", "-i"]).arg(&file).args(["-ac", "1", "-ar", "4000", "-f", "s16le", "-"]).output().map_err(|e| e.to_string())?;
    if !o.status.success() { return Err(format!("음악 파형을 읽지 못했습니다: {}", String::from_utf8_lossy(&o.stderr).chars().take(200).collect::<String>())); }
    let pcm = &o.stdout;
    let samples = pcm.len() / 2;
    let duration = samples as f64 / RATE as f64;
    let per = (samples / n).max(1);
    let mut out = vec![0i32; n];
    let mut max = 1i32;
    for (i, o) in out.iter_mut().enumerate() {
        let a = i * per;
        let b = samples.min(a + per);
        let m = (a..b).map(|k| (i16::from_le_bytes([pcm[k * 2], pcm[k * 2 + 1]]) as i32).abs()).max().unwrap_or(0);
        *o = m; max = max.max(m);
    }
    let peaks: Vec<f64> = out.iter().map(|&v| ((v as f64 / max as f64) * 1000.0 + 0.5).floor() / 1000.0).collect();
    let _ = std::fs::write(&cache, json!({ "duration": duration, "peaks": peaks }).to_string());
    Ok((duration, peaks))
}

/// 영상 설명란에 넣을 음악 출처 (CC BY 는 꼭) — 기존 creditText
pub fn credit_text(b: &Value) -> String {
    let Some(b) = normalize(b) else { return String::new() };
    let Ok(t) = track_of(&b.id) else { return String::new() };
    if t.custom { return if t.kind == "youtube" { format!("음악: \"{}\" - {} ({})", t.title, t.artist, t.source) } else { format!("음악: \"{}\"", t.title) }; }
    match &t.attribution { Some(a) => format!("음악: {a}"), None => format!("음악: \"{}\" - {} ({})", t.title, t.artist, t.license) }
}

/// 곡 소리를 48kHz 두 채널로 풀어 둔다 (미리보기에 섞을 때)
pub fn decode_pcm(file: &Path) -> Result<Vec<f32>, String> {
    let o = media::command("ffmpeg").args(["-v", "error", "-i"]).arg(file).args(["-vn", "-ac", "2", "-ar", "48000", "-f", "f32le", "-"]).output().map_err(|e| e.to_string())?;
    if !o.status.success() { return Err("음악을 읽지 못했습니다".into()); }
    Ok(o.stdout.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}
