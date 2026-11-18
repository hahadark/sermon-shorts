//! 자막 만들기 (기존 src/main/engine.js): 시스템 점검에서 설치한 음성 인식 엔진(파이썬 + faster-whisper, Electron 판과 같은 곳)을 부른다.
//! 맥(macOS 26 이상)은 설치 없이 맥 내장 받아쓰기(앱 묶음의 ss-stt-apple, tools/mac_stt)를 먼저 쓴다. 같은 인자·같은 결과 모양이다.
//! 엔진 고르기: 환경 변수 SS_STT_ENGINE=apple|whisper (없으면 맥 받아쓰기가 되면 그것, 아니면 위스퍼)
//! 같은 영상·같은 구간이면 Electron 판과 같은 캐시(runtime/cache/<md5>/transcript_*.json)를 함께 쓴다.
use crate::youtube::{cache_dir, runtime_dir};
use md5::Digest;
use serde_json::Value;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub fn engine_dir() -> PathBuf { runtime_dir().join("engine") }
pub fn python() -> PathBuf { if cfg!(windows) { engine_dir().join(".venv").join("Scripts").join("python.exe") } else { engine_dir().join(".venv").join("bin").join("python") } }
pub fn script() -> PathBuf { crate::assets_dir().join("engine").join("transcribe.py") }

/// 맥 내장 받아쓰기 도우미 (앱 묶음 Contents/Resources/bin/ss-stt-apple). 맥이 아니거나 없으면 None
pub fn apple_helper() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") { return None; }
    let p = crate::media::find_tool("ss-stt-apple");
    p.is_absolute().then_some(p).filter(|p| p.exists())
}
/// 맥 내장 받아쓰기를 쓸 수 있는지 (macOS 26 이상·한국어 지원). 한 번 물어보고 기억한다
pub fn apple_ready() -> bool {
    static R: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *R.get_or_init(|| {
        let Some(h) = apple_helper() else { return false };
        let Ok(o) = crate::media::command_path(&h).arg("--check").stdin(std::process::Stdio::null()).output() else { return false };
        String::from_utf8_lossy(&o.stdout).lines().filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok()).any(|v| v["ok"] == true)
    })
}
/// 이번에 쓸 엔진이 맥 받아쓰기인지
pub fn use_apple() -> bool {
    match std::env::var("SS_STT_ENGINE").unwrap_or_default().as_str() { "whisper" => false, "apple" => apple_helper().is_some(), _ => apple_ready() }
}
/// 자막을 만들 수 있는 엔진이 있는지 (맥 받아쓰기 또는 설치한 위스퍼)
pub fn engine_ready() -> bool { use_apple() || python().exists() }
/// 화면에 보일 엔진 이름
pub fn engine_label() -> &'static str { if use_apple() { "맥 받아쓰기" } else { "위스퍼" } }

/// JS 의 `${숫자}` 와 같은 글 (정수는 소수점 없이, 없으면 undefined)
pub fn js_num(x: Option<f64>) -> String {
    match x { None => "undefined".into(), Some(v) if v.fract() == 0.0 && v.abs() < 1e15 => format!("{}", v as i64), Some(v) => format!("{v}") }
}

/// engine.js getCachePath: md5(`${입력}_${시작}_${끝}`)
pub fn cache_path(input: &Path, start: Option<f64>, end: Option<f64>) -> PathBuf {
    let key = format!("{}_{}_{}", input.to_string_lossy(), js_num(start), js_num(end));
    let hash: String = md5::Md5::digest(key.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
    cache_dir().join(hash).join(format!("transcript_{}_{}.json", js_num(start), js_num(end)))
}

/// 진행: (단계 extract|stt|align|done|warn, 퍼센트, 알림 글)
pub type Progress = dyn Fn(&str, f64, &str) + Send + Sync;

/// 음성 인식 → 결과 JSON ({ words, language, … }). cancel 이 켜지면 엔진을 멈춘다
pub fn transcribe(input: &Path, start: Option<f64>, end: Option<f64>, terms: &str, progress: &Progress, cancel: Arc<AtomicBool>) -> anyhow::Result<Value> {
    if use_apple() {
        match run_engine(true, input, start, end, terms, progress, cancel.clone()) {
            Ok(v) => return Ok(v),
            // 맥 받아쓰기가 실패하면 위스퍼가 설치돼 있을 때만 그것으로
            Err(e) if !cancel.load(Ordering::Relaxed) && python().exists() => progress("warn", -1.0, &format!("맥 받아쓰기 실패, 위스퍼로 다시: {e}")),
            Err(e) => return Err(e),
        }
    }
    run_engine(false, input, start, end, terms, progress, cancel)
}

fn run_engine(apple: bool, input: &Path, start: Option<f64>, end: Option<f64>, terms: &str, progress: &Progress, cancel: Arc<AtomicBool>) -> anyhow::Result<Value> {
    // 맥 받아쓰기 결과는 위스퍼 결과와 따로 둔다 (엔진을 바꾸면 새로 만든다)
    let out = { let c = cache_path(input, start, end); if apple { c.with_file_name(format!("apple_{}", c.file_name().unwrap().to_string_lossy())) } else { c } };
    if out.exists() {
        if let Ok(v) = std::fs::read_to_string(&out).map_err(anyhow::Error::from).and_then(|t| Ok(serde_json::from_str::<Value>(&t)?)) { progress("done", 100.0, ""); return Ok(v); }
    }
    if let Some(d) = out.parent() { std::fs::create_dir_all(d)?; }
    let mut cmd = if apple {
        let Some(h) = apple_helper() else { anyhow::bail!("맥 받아쓰기 도우미가 앱에 없습니다") };
        crate::media::command_path(&h)
    } else {
        let py = python();
        if !py.exists() { anyhow::bail!("자막 엔진(Python)이 설치되지 않았습니다. 도움말 → 시스템 점검에서 [엔진 설치]를 누르세요."); }
        let mut c = crate::media::command_path(&py); c.arg(script()); c
    };
    cmd.arg("--input").arg(input).arg("--out").arg(&out).arg("--ffmpeg").arg(crate::media::find_tool("ffmpeg"));
    if !terms.trim().is_empty() { cmd.args(["--terms", terms.trim()]); }
    if let Some(s) = start { cmd.args(["--start", &js_num(Some(s))]); }
    if let Some(e) = end { cmd.args(["--end", &js_num(Some(e))]); }
    for k in ["PYTHONHOME", "PYTHONPATH", "PIP_PREFIX"] { cmd.env_remove(k); }
    cmd.env("PYTHONIOENCODING", "utf-8").env("SS_ENGINE_DIR", engine_dir()).env("SS_CACHE_DIR", cache_dir()).env("HF_HOME", engine_dir().join("hf-cache"));
    if let Some(d) = crate::assets_dir().parent() { cmd.current_dir(d); }
    cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).stdin(std::process::Stdio::null());
    let mut child = cmd.spawn().map_err(|e| anyhow::anyhow!("자막 엔진 실행 실패: {e}"))?;
    let err_h = { let mut e = child.stderr.take().unwrap(); std::thread::spawn(move || { let mut s = String::new(); let _ = e.read_to_string(&mut s); s }) };
    let stdout = child.stdout.take().unwrap();
    let mut error_msg = String::new();
    // 끊기 감시: cancel 이 켜지면 엔진을 끈다
    let pid_kill = Arc::new(std::sync::Mutex::new(Some(child)));
    let pk = pid_kill.clone();
    let c2 = cancel.clone();
    let watcher = std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(200));
        let mut g = pk.lock().unwrap();
        let Some(ch) = g.as_mut() else { return };
        if c2.load(Ordering::Relaxed) { let _ = ch.kill(); return; }
        if let Ok(Some(_)) = ch.try_wait() { return; }
    });
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let l = line.trim();
        if l.is_empty() { continue; }
        match serde_json::from_str::<Value>(l) {
            Ok(m) => match m["type"].as_str() {
                Some("progress") => progress(m["stage"].as_str().unwrap_or(""), m["pct"].as_f64().unwrap_or(0.0), ""),
                Some("warn") => progress("warn", -1.0, m["message"].as_str().unwrap_or("")),
                Some("error") => error_msg = m["message"].as_str().unwrap_or("").to_string(),
                _ => {}
            },
            Err(_) => { if l.contains("Error") { error_msg.push_str(l); } }
        }
    }
    let status = { let mut g = pid_kill.lock().unwrap(); g.take().map(|mut ch| ch.wait()) };
    let _ = watcher.join();
    let stderr = err_h.join().unwrap_or_default();
    if cancel.load(Ordering::Relaxed) { anyhow::bail!("취소했습니다"); }
    let ok = matches!(status, Some(Ok(s)) if s.success());
    if !ok {
        if error_msg.is_empty() { error_msg = stderr.lines().filter(|l| l.to_lowercase().contains("error")).last().unwrap_or("").to_string(); }
        anyhow::bail!(if error_msg.is_empty() { "자막 엔진이 실패했습니다".to_string() } else { error_msg });
    }
    if !out.exists() { anyhow::bail!("자막 결과 파일이 없습니다"); }
    Ok(serde_json::from_str(&std::fs::read_to_string(&out)?)?)
}
