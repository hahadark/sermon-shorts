//! 자동 저장 (기존 src/main/autosave.js). Electron 판과 같은 폴더·같은 파일을 쓴다 (서로의 자동 저장본을 열 수 있게)
//! 위치: <userData>/autosave/<영상키>/
//!   current.sshorts             마지막 상태 (임시 파일에 쓰고 바꿔 넣어 깨지지 않게)
//!   v-YYYYMMDD-HHMMSS.sshorts   과거 작업본 (몇 분에 하나, 영상마다 최근 N개)
//!   meta.json                   제목·원본 영상·프로젝트 파일·작업본 목록
//! <userData>/autosave/sessions/<pid>.json : 실행 중 표시. 정상 종료면 지우고, 남아 있는데 그 프로세스가 없으면 '갑자기 꺼짐'
use crate::theme;
use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use sha1::Digest;
use std::path::{Path, PathBuf};

pub struct Limits { pub max_versions: usize, pub every_ms: f64, pub max_keys: usize, pub keep_days: f64 }
/// 설정 [일반 → 자동 저장] (settings.autosave)
pub fn limits(settings: &Value) -> Limits {
    let a = &settings["autosave"];
    let n = |k: &str, d: f64| a[k].as_f64().filter(|x| *x != 0.0).unwrap_or(d);
    Limits { max_versions: n("maxVersions", 30.0) as usize, every_ms: n("everyMin", 2.0) * 60.0 * 1000.0, max_keys: n("maxVideos", 40.0) as usize, keep_days: n("keepDays", 60.0) }
}
pub fn enabled(settings: &Value) -> bool { settings["autosave"]["enabled"].as_bool() != Some(false) }

pub fn now_ms() -> f64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0) }
pub fn root_dir() -> PathBuf { let d = theme::user_data_dir().join("autosave"); let _ = std::fs::create_dir_all(&d); d }
fn sess_dir() -> PathBuf { let d = root_dir().join("sessions"); let _ = std::fs::create_dir_all(&d); d }
pub fn sha16(s: &[u8]) -> String { sha1::Sha1::digest(s).iter().map(|b| format!("{b:02x}")).collect::<String>()[..16].to_string() }
pub fn key_of(s: &str) -> String { sha16(s.as_bytes()) }
fn valid_key(k: &str) -> bool { k.len() == 16 && k.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)) }
fn key_dir(key: &str) -> Result<PathBuf> { if !valid_key(key) { bail!("잘못된 자동 저장 키"); } Ok(root_dir().join(key)) }
fn read_json(p: &Path) -> Option<Value> { serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok() }
/// 임시 파일에 다 쓴 뒤 바꿔 넣는다 (쓰는 중에 꺼져도 앞 파일이 남음)
pub fn write_atomic(p: &Path, text: &str) -> Result<()> {
    let tmp = PathBuf::from(format!("{}.tmp-{}", p.to_string_lossy(), std::process::id()));
    std::fs::write(&tmp, text)?;
    if std::fs::rename(&tmp, p).is_err() { std::fs::copy(&tmp, p)?; let _ = std::fs::remove_file(&tmp); }
    Ok(())
}
/// JSON.stringify(v, null, 1) 와 같은 들여쓰기
fn pretty1(v: &Value) -> String {
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, serde_json::ser::PrettyFormatter::with_indent(b" "));
    serde::Serialize::serialize(v, &mut ser).ok();
    String::from_utf8(buf).unwrap_or_default()
}

/// 그 프로세스가 아직 살아 있는지 (process.kill(pid, 0))
pub fn alive(pid: u32) -> bool {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED};
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() { return GetLastError() == ERROR_ACCESS_DENIED; }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(h, &mut code) != 0;
        CloseHandle(h);
        ok && code == 259
    }
    #[cfg(not(windows))]
    { std::path::Path::new(&format!("/proc/{pid}")).exists() }
}
/// 이 PC 시각으로 (년, 월, 일, 시, 분, 초)
pub fn local_parts(ms: f64) -> (i64, u32, u32, u32, u32, u32) {
    let s = (ms / 1000.0).floor() as i64 + crate::youtube::local_offset_secs();
    let (y, m, d) = crate::youtube::civil_from_days(s.div_euclid(86400));
    let r = s.rem_euclid(86400);
    (y, m, d, (r / 3600) as u32, ((r % 3600) / 60) as u32, (r % 60) as u32)
}
fn stamp(ms: f64) -> String { let (y, mo, d, h, mi, s) = local_parts(ms); format!("{y}{mo:02}{d:02}-{h:02}{mi:02}{s:02}") }

#[derive(Clone, Debug, Default)]
pub struct Session { pub pid: u32, pub started_at: f64, pub keys: Vec<String> }
impl Session {
    fn json(&self) -> Value { json!({ "pid": self.pid, "startedAt": self.started_at, "keys": self.keys }) }
}

#[derive(Clone, Debug)]
pub struct Version { pub file: String, pub at: f64, pub summary: Value, pub current: bool }
#[derive(Clone, Debug)]
pub struct Entry { pub key: String, pub title: String, pub source_path: String, pub source_name: String, pub source_url: String, pub project_path: String, pub updated_at: f64, pub summary: Value, pub source_missing: bool, pub versions: Vec<Version> }

pub fn entry_of(key: &str) -> Option<Entry> {
    let d = key_dir(key).ok()?;
    let meta = read_json(&d.join("meta.json"))?;
    if !d.join("current.sshorts").exists() { return None; }
    let s = |k: &str| meta[k].as_str().unwrap_or("").to_string();
    let updated = meta["updatedAt"].as_f64().unwrap_or(0.0);
    let mut versions = vec![Version { file: "current.sshorts".into(), at: updated, summary: meta["summary"].clone(), current: true }];
    let olds: Vec<Version> = meta["versions"].as_array().into_iter().flatten().filter_map(|v| { let f = v["file"].as_str()?; d.join(f).exists().then(|| Version { file: f.into(), at: v["at"].as_f64().unwrap_or(0.0), summary: v["summary"].clone(), current: false }) }).collect();
    versions.extend(olds.into_iter().rev());
    let sp = s("sourcePath");
    Some(Entry { key: key.into(), title: s("title"), source_missing: !sp.is_empty() && !Path::new(&sp).exists(), source_path: sp, source_name: s("sourceName"), source_url: s("sourceUrl"), project_path: s("projectPath"), updated_at: updated, summary: meta["summary"].clone(), versions })
}
pub fn list() -> Vec<Entry> {
    let mut out: Vec<Entry> = std::fs::read_dir(root_dir()).into_iter().flatten().filter_map(|e| e.ok()).filter_map(|e| { let k = e.file_name().to_string_lossy().to_string(); if valid_key(&k) { entry_of(&k) } else { None } }).collect();
    out.sort_by(|a, b| b.updated_at.partial_cmp(&a.updated_at).unwrap_or(std::cmp::Ordering::Equal));
    out
}
/// 오래된 것 정리: keepDays 지난 영상, maxVideos 넘는 영상
pub fn prune(l: &Limits) {
    let now = now_ms();
    for (i, e) in list().iter().enumerate() {
        if i >= l.max_keys || now - e.updated_at > l.keep_days * 864e5 { if let Ok(d) = key_dir(&e.key) { let _ = std::fs::remove_dir_all(d); } }
    }
}

/// 저장할 것 (기존 autosave:write 의 p)
pub struct Payload { pub source_key: String, pub title: String, pub source_path: String, pub source_name: String, pub source_url: String, pub project_path: String, pub summary: Value, pub data: String, pub force_version: bool }
pub struct Written { pub key: String, pub at: f64, pub versioned: bool }

fn add_version(d: &Path, meta: &mut Value, at: f64, text: &str, summary: Value, hash: String, max: usize) -> Result<()> {
    let base = format!("v-{}", stamp(at));
    let mut file = format!("{base}.sshorts");
    let mut n = 2;
    while d.join(&file).exists() { file = format!("{base}-{n}.sshorts"); n += 1; }
    write_atomic(&d.join(&file), text)?;
    let vs = meta["versions"].as_array_mut().unwrap();
    vs.push(json!({ "file": file, "at": at, "summary": summary, "hash": hash }));
    while vs.len() > max { let old = vs.remove(0); if let Some(f) = old["file"].as_str() { let _ = std::fs::remove_file(d.join(f)); } }
    Ok(())
}

/// 자동 저장 상태 (실행 하나에 하나)
pub struct Autosave { pub mine: Session, pub crashed: Option<Session>, pub active: bool }
impl Autosave {
    /// 켤 때: 지난번 갑자기 꺼진 실행을 찾고 이번 실행 표시를 남긴다. active=false 면 (시험 등) 아무것도 쓰지 않는다
    pub fn init(active: bool, settings: &Value) -> Autosave {
        let mut a = Autosave { mine: Session { pid: std::process::id(), started_at: now_ms(), keys: vec![] }, crashed: None, active };
        if !active { return a; }
        a.crashed = scan_sessions();
        a.write_session();
        let l = limits(settings);
        std::thread::spawn(move || { std::thread::sleep(std::time::Duration::from_secs(10)); prune(&l); });
        a
    }
    fn write_session(&self) { if self.active { let _ = write_atomic(&sess_dir().join(format!("{}.json", self.mine.pid)), &self.mine.json().to_string()); } }
    /// 정상 종료: 실행 표시 지우기 (자동 저장본은 남겨 두어 메뉴에서 다시 열 수 있다)
    pub fn quit(&self) { if self.active { let _ = std::fs::remove_file(sess_dir().join(format!("{}.json", self.mine.pid))); } }

    pub fn write(&mut self, p: &Payload, settings: &Value) -> Result<Written> {
        if !self.active { bail!("자동 저장이 꺼져 있습니다"); }
        if p.data.is_empty() { bail!("저장할 내용이 없습니다."); }
        let key = key_of(if p.source_key.is_empty() { &p.source_path } else { &p.source_key });
        let d = key_dir(&key)?;
        std::fs::create_dir_all(&d)?;
        let l = limits(settings);
        write_atomic(&d.join("current.sshorts"), &p.data)?;
        let meta_path = d.join("meta.json");
        let mut meta = read_json(&meta_path).filter(|m| m.is_object()).unwrap_or_else(|| json!({}));
        let kept: Vec<Value> = meta["versions"].as_array().into_iter().flatten().filter(|v| v["file"].as_str().is_some_and(|f| d.join(f).exists())).cloned().collect();
        meta["versions"] = json!(kept);
        let now = now_ms();
        let last = meta["versions"].as_array().and_then(|a| a.last()).cloned();
        let hash = sha16(p.data.as_bytes());
        let mut versioned = false;
        let due = p.force_version || last.as_ref().map(|l2| now - l2["at"].as_f64().unwrap_or(0.0) >= l.every_ms).unwrap_or(true);
        if due && !last.as_ref().is_some_and(|l2| l2["hash"].as_str() == Some(hash.as_str())) {
            add_version(&d, &mut meta, now, &p.data, p.summary.clone(), hash, l.max_versions)?;
            versioned = true;
        }
        for (k, v) in [("key", json!(key)), ("title", json!(p.title)), ("sourcePath", json!(p.source_path)), ("sourceName", json!(p.source_name)), ("sourceUrl", json!(p.source_url)), ("projectPath", json!(p.project_path)), ("summary", p.summary.clone()), ("updatedAt", json!(now))] { meta[k] = v; }
        write_atomic(&meta_path, &pretty1(&meta))?;
        if !self.mine.keys.contains(&key) { self.mine.keys.push(key.clone()); self.write_session(); }
        Ok(Written { key, at: now, versioned })
    }
    /// 지난번에 갑자기 꺼졌으면 그때 저장한 영상들 (최근 것이 앞)
    pub fn crashed_entries(&self) -> Vec<Entry> {
        let Some(c) = &self.crashed else { return vec![] };
        let mut e: Vec<Entry> = c.keys.iter().filter_map(|k| entry_of(k)).collect();
        e.sort_by(|a, b| b.updated_at.partial_cmp(&a.updated_at).unwrap_or(std::cmp::Ordering::Equal));
        e
    }
}

/// 시작할 때: 남아 있는 다른 실행 표시 중 프로세스가 없는 것 = 갑자기 꺼짐
pub fn scan_sessions() -> Option<Session> {
    let me = std::process::id();
    let mut found: Vec<Session> = vec![];
    for e in std::fs::read_dir(sess_dir()).into_iter().flatten().filter_map(|e| e.ok()) {
        let f = e.file_name().to_string_lossy().to_string();
        let Some(pid) = f.strip_suffix(".json").and_then(|s| s.parse::<u32>().ok()) else { continue };
        if pid == me { continue; }
        let s = read_json(&e.path());
        let started = s.as_ref().and_then(|v| v["startedAt"].as_f64()).unwrap_or(0.0);
        if s.is_some() && alive(pid) && now_ms() - started < 7.0 * 864e5 { continue; } // 다른 편집기 창이 아직 열려 있음
        if let Some(v) = &s { let keys: Vec<String> = v["keys"].as_array().into_iter().flatten().filter_map(|k| k.as_str().map(String::from)).collect(); if !keys.is_empty() { found.push(Session { pid, started_at: started, keys }); } }
        let _ = std::fs::remove_file(e.path());
    }
    if found.is_empty() { return None; }
    let mut keys: Vec<String> = vec![];
    for s in &found { for k in &s.keys { if !keys.contains(k) { keys.push(k.clone()); } } }
    Some(Session { pid: found[0].pid, started_at: found.iter().map(|s| s.started_at).fold(f64::INFINITY, f64::min), keys })
}

/// 과거 작업본을 열기 전에: 마지막 상태(current)가 작업본에 없으면 하나 남긴다 (되돌리다 최신 편집을 잃지 않게)
fn preserve_current(d: &Path, settings: &Value) -> Result<()> {
    let meta_path = d.join("meta.json");
    let (Some(mut meta), true) = (read_json(&meta_path), d.join("current.sshorts").exists()) else { return Ok(()) };
    if !meta["versions"].is_array() { meta["versions"] = json!([]); }
    let text = std::fs::read_to_string(d.join("current.sshorts"))?;
    let hash = sha16(text.as_bytes());
    let last = meta["versions"].as_array().and_then(|a| a.last()).cloned();
    if let Some(l) = &last {
        if l["hash"].as_str() == Some(hash.as_str()) { return Ok(()); }
        if l["hash"].is_null() { if let Some(f) = l["file"].as_str() { if std::fs::read_to_string(d.join(f)).ok().as_deref() == Some(text.as_str()) { return Ok(()); } } }
    }
    let at = meta["updatedAt"].as_f64().filter(|x| *x != 0.0).unwrap_or_else(now_ms);
    let summary = meta["summary"].clone();
    add_version(d, &mut meta, at, &text, summary, hash, limits(settings).max_versions)?;
    write_atomic(&meta_path, &pretty1(&meta))
}
/// 자동 저장본 읽기 → (프로젝트 데이터, 프로젝트 파일 경로, 제목)
pub fn read(key: &str, file: &str, settings: &Value) -> Result<(Value, String, String)> {
    let d = key_dir(key)?;
    let ok = file == "current.sshorts" || (file.starts_with("v-") && file.ends_with(".sshorts") && file[2..file.len() - 8].chars().all(|c| c.is_ascii_digit() || c == '-'));
    if !ok { bail!("잘못된 자동 저장 파일"); }
    if file != "current.sshorts" { preserve_current(&d, settings)?; }
    let data = read_json(&d.join(file)).ok_or_else(|| anyhow!("자동 저장본을 읽지 못했습니다."))?;
    let meta = read_json(&d.join("meta.json")).unwrap_or(json!({}));
    Ok((data, meta["projectPath"].as_str().unwrap_or("").into(), meta["title"].as_str().unwrap_or("").into()))
}
pub fn remove(key: &str) -> Result<()> { std::fs::remove_dir_all(key_dir(key)?)?; Ok(()) }
