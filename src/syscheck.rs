//! 시스템 점검·설치 (기존 main/syscheck-logic.js · main/setup.js): 이 PC에 필요한 도구가 있는지 보고,
//! 자막 엔진(Python + faster-whisper)·Whisper 모델·ffmpeg·yt-dlp 를 설치한다. 엔진 설치는 Electron 판과 같은 스크립트
//! (assets/engine/setup_engine.ps1 · .sh)를 같은 데이터 폴더(runtime)에 대고 돌리므로 두 판이 같은 엔진을 쓴다.
//! API 키 값은 절대 돌려주지 않는다.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::youtube::{cache_dir, runtime_dir};

#[derive(Clone, Debug, PartialEq)]
pub enum St { Ok, Warn, Error }
impl St { pub fn as_str(&self) -> &'static str { match self { St::Ok => "ok", St::Warn => "warn", St::Error => "error" } } }

#[derive(Clone, Debug)]
pub struct Row { pub id: &'static str, pub name: &'static str, pub status: St, pub value: String, pub hint: String, pub actions: Vec<&'static str>, pub critical: bool, pub model: String }
fn row(id: &'static str, name: &'static str, status: St, value: impl Into<String>) -> Row {
    Row { id, name, status, value: value.into(), hint: String::new(), actions: vec![], critical: false, model: String::new() }
}
impl Row {
    fn hint(mut self, h: impl Into<String>) -> Self { self.hint = h.into(); self }
    fn acts(mut self, a: &[&'static str]) -> Self { self.actions = a.to_vec(); self }
    fn crit(mut self) -> Self { self.critical = true; self }
}

pub const LINKS: [(&str, &str); 5] = [
    ("python", if cfg!(target_os = "macos") { "https://www.python.org/downloads/macos/" } else { "https://www.python.org/downloads/release/python-31210/" }),
    ("ffmpeg", "https://www.gyan.dev/ffmpeg/builds/"),
    ("ytdlp", "https://github.com/yt-dlp/yt-dlp/releases/latest"),
    ("node", "https://nodejs.org/ko/download"),
    ("gemini", "https://aistudio.google.com/apikey"),
];
pub fn open_link(key: &str) -> (bool, String) {
    match LINKS.iter().find(|(k, _)| *k == key) {
        Some((_, u)) => { crate::ytupload::open_url(u); (true, format!("브라우저에서 열었습니다: {u}")) }
        None => (false, "알 수 없는 링크입니다.".into()),
    }
}

pub const TEST_URL: &str = "https://www.youtube.com/watch?v=jNQXAC9IVRw"; // 유튜브 첫 영상, 어느 교회와도 상관없는 공개 영상

pub fn engine_dir() -> PathBuf { runtime_dir().join("engine") }
pub fn models_dir() -> PathBuf { engine_dir().join("models") }
pub fn python() -> PathBuf { crate::stt::python() }
/// 앱이 받아 두는 도구 폴더 (ffmpeg 를 여기에 설치한다)
pub fn managed_bin() -> PathBuf { runtime_dir().join("bin") }

fn exe(name: &str) -> String { if cfg!(windows) { format!("{name}.exe") } else { name.to_string() } }

/// 파이썬을 섞이지 않게 (Aside·Conda 등 다른 환경 변수 제거)
pub fn py_cmd(p: &Path) -> std::process::Command {
    let mut c = crate::media::command_path(p);
    for k in ["PYTHONHOME", "PYTHONPATH", "PIP_PREFIX", "PIP_TARGET", "PIP_USER", "VIRTUAL_ENV"] { c.env_remove(k); }
    c.env("PYTHONIOENCODING", "utf-8");
    c
}
fn out_ok(c: &mut std::process::Command) -> Option<(String, String)> {
    let o = c.stdin(std::process::Stdio::null()).output().ok()?;
    if !o.status.success() { return None; }
    Some((String::from_utf8_lossy(&o.stdout).into_owned(), String::from_utf8_lossy(&o.stderr).into_owned()))
}

pub fn fmt_bytes(n: u64) -> String {
    let n = n as f64;
    if n >= 1024f64.powi(3) { format!("{:.1} GB", n / 1024f64.powi(3)) } else if n >= 1024f64.powi(2) { format!("{:.0} MB", n / 1024f64.powi(2)) } else { format!("{} KB", (n / 1024.0).round()) }
}
pub fn dir_size(dir: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    rd.flatten().map(|e| { let p = e.path(); match e.file_type() { Ok(t) if t.is_dir() => dir_size(&p), Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0), _ => 0 } }).sum()
}

/// 지울 수 있는 캐시: cache/yt (유튜브에서 받은 것), cache/<16~64자 해시> (자막 결과·파형)
pub fn clearable_cache_dirs() -> Vec<PathBuf> {
    let mut out = vec![];
    let c = cache_dir();
    let yt = c.join("yt");
    if yt.exists() { out.push(yt); }
    let re = regex::Regex::new(r"(?i)^[a-f0-9]{16,64}$").unwrap();
    if let Ok(rd) = std::fs::read_dir(&c) { for e in rd.flatten() { if e.file_type().is_ok_and(|t| t.is_dir()) && re.is_match(&e.file_name().to_string_lossy()) { out.push(e.path()); } } }
    out
}

// ---------------------------------------------------------------- 점검 항목

pub fn check_ffmpeg() -> Row {
    let a = out_ok(crate::media::command("ffmpeg").args(["-hide_banner", "-version"]));
    let b = out_ok(crate::media::command("ffprobe").args(["-hide_banner", "-version"]));
    let ver = a.as_ref().and_then(|(s, _)| regex::Regex::new(r"ffmpeg version (\S+)").unwrap().captures(s).map(|c| c[1].to_string()));
    if a.is_some() && b.is_some() { return row("ffmpeg", "ffmpeg / ffprobe", St::Ok, ver.unwrap_or_else(|| "설치됨".into())); }
    let missing: Vec<String> = [(a.is_none(), "ffmpeg"), (b.is_none(), "ffprobe")].iter().filter(|x| x.0).map(|x| exe(x.1)).collect();
    let r = row("ffmpeg", "ffmpeg / ffprobe", St::Error, format!("{} 없음", missing.join(", "))).crit();
    if cfg!(windows) { r.hint("[설치]를 누르면 공식 빌드(gyan.dev, 약 100MB)를 받아 넣습니다.").acts(&["install-ffmpeg", "open:ffmpeg"]) }
    else { r.hint("Homebrew로 설치하세요: brew install ffmpeg").acts(&["open:ffmpeg"]) }
}

pub fn check_ytdlp() -> Row {
    let p = crate::youtube::ytdlp_path();
    match out_ok(&mut crate::media::command_path(&p).arg("--version")) {
        Some((v, _)) => row("ytdlp", "yt-dlp", St::Ok, v.trim()).hint("유튜브 가져오기가 갑자기 안 되면 [업데이트]를 누르세요.").acts(&["update-ytdlp"]),
        None => row("ytdlp", "yt-dlp", St::Error, "없음").crit().hint("[설치]를 누르면 공식 최신판(GitHub)을 받아 넣습니다.").acts(&["install-ytdlp", "open:ytdlp"]),
    }
}

pub fn check_js_runtime() -> Row {
    match crate::youtube::js_runtime() {
        Some((kind, path, ver)) => row("jsruntime", "유튜브용 JS 런타임", St::Ok, format!("{} {ver}", if kind == "deno" { "Deno" } else { "Node" })).hint(path.display().to_string()).acts(&["test-youtube"]),
        None => row("jsruntime", "유튜브용 JS 런타임", St::Error, "없음").hint("Node.js를 설치하거나 bin 폴더에 deno.exe를 넣으세요.").acts(&["open:node"]),
    }
}

/// Python 3.12 찾기 (setup_engine 과 같은 순서). 없으면 None
pub fn find_python312() -> Option<String> {
    if cfg!(target_os = "macos") {
        for c in [engine_dir().join("python").join("bin").join("python3.12"), "/opt/homebrew/bin/python3.12".into(), "/usr/local/bin/python3.12".into(), "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12".into()] {
            if c.exists() { return Some(c.display().to_string()); }
        }
        return None;
    }
    if let Some((s, _)) = out_ok(crate::media::command("py").args(["-3.12", "-c", "import sys; print(sys.executable)"])) { if let Some(l) = s.trim().lines().last() { if !l.trim().is_empty() { return Some(l.trim().into()); } } }
    let env = |k: &str| std::env::var(k).ok().map(PathBuf::from);
    let cands = [env("LOCALAPPDATA").map(|p| p.join("Programs").join("Python").join("Python312").join("python.exe")), env("ProgramFiles").map(|p| p.join("Python312").join("python.exe")),
        env("ProgramFiles(x86)").map(|p| p.join("Python312").join("python.exe")), Some(PathBuf::from(r"C:\Python312\python.exe"))];
    if let Some(f) = cands.into_iter().flatten().find(|p| p.exists()) { return Some(f.display().to_string()); }
    let (s, _) = out_ok(crate::media::command("python").args(["-c", "import sys; print('%d.%d|' % sys.version_info[:2] + sys.executable)"]))?;
    let (ver, exe) = s.trim().split_once('|')?;
    (ver == "3.12" && !exe.trim().is_empty()).then(|| exe.trim().to_string())
}

const PY_INFO: &str = "import json,sys\ntry:\n import torch\n c=torch.cuda.is_available()\n print(json.dumps({\"py\":sys.version.split()[0],\"torch\":torch.__version__,\"cuda\":c,\"gpu\":torch.cuda.get_device_name(0) if c else None}))\nexcept Exception as e:\n print(json.dumps({\"py\":sys.version.split()[0],\"err\":str(e)}))";

pub fn check_python(quick: bool) -> Row {
    let py = python();
    if !py.exists() {
        if quick { return row("python", "자막 엔진 (Python)", St::Warn, "설치 안 됨"); }
        return match find_python312() {
            Some(p) => row("python", "자막 엔진 (Python)", St::Warn, "설치 안 됨").hint(format!("Python 3.12 찾음: {p}. [엔진 설치]를 누르면 PyTorch와 음성 인식 라이브러리를 설치합니다 (약 3GB, 10분 이상).")).acts(&["install-engine"]),
            None => row("python", "자막 엔진 (Python)", St::Warn, "설치 안 됨 · Python 3.12 없음")
                .hint(format!("[엔진 설치]를 누르면 Python 3.12{}와 엔진을 함께 설치합니다 (약 3GB, 10분 이상). 직접 설치하려면 [다운로드 페이지].", if cfg!(windows) { "(python.org 공식 설치 파일)" } else { "" }))
                .acts(&["install-engine", "open:python"]),
        };
    }
    if quick { return row("python", "자막 엔진 (Python)", St::Ok, "설치됨"); }
    let o = py_cmd(&py).args(["-c", PY_INFO]).stdin(std::process::Stdio::null()).output();
    let (stdout, stderr) = o.as_ref().map(|o| (String::from_utf8_lossy(&o.stdout).into_owned(), String::from_utf8_lossy(&o.stderr).into_owned())).unwrap_or_default();
    let info: Option<Value> = stdout.trim().lines().last().and_then(|l| serde_json::from_str(l).ok());
    let Some(info) = info else {
        let tail: String = stderr.chars().rev().take(200).collect::<Vec<_>>().into_iter().rev().collect();
        return row("python", "자막 엔진 (Python)", St::Warn, "실행 실패").hint(format!("엔진 가상환경이 깨졌습니다. [엔진 다시 설치]를 누르세요. {tail}")).acts(&["reinstall-engine"]);
    };
    let pyv = info["py"].as_str().unwrap_or("");
    if let Some(err) = info["err"].as_str() {
        return row("python", "자막 엔진 (Python)", St::Warn, format!("Python {pyv}, torch 없음")).hint(format!("[엔진 다시 설치]를 누르세요. ({})", err.chars().take(120).collect::<String>())).acts(&["reinstall-engine"]);
    }
    let cuda = info["cuda"].as_bool() == Some(true);
    let mut gpu = info["gpu"].as_str().unwrap_or("").to_string();
    if !cuda && cfg!(windows) {
        if let Some((s, _)) = out_ok(crate::media::command("nvidia-smi").args(["--query-gpu=name", "--format=csv,noheader"])) {
            if let Some(n) = s.trim().lines().next().filter(|n| !n.trim().is_empty()) { gpu = format!("{} (torch에서 CUDA 사용 불가)", n.trim()); }
        }
    }
    let value = format!("Python {pyv} · torch {} · {}", info["torch"].as_str().unwrap_or(""), if cuda { format!("GPU: {gpu}") } else { "CPU 모드".into() });
    let hint = if cuda { String::new() } else if !gpu.is_empty() { format!("{gpu}. [엔진 다시 설치]를 누르면 CUDA용 torch를 설치합니다.") }
        else { format!("{} CPU로 변환합니다 (medium 모델, 느림: 30분 설교에 약 10~30분).", if cfg!(windows) { "NVIDIA GPU가 없어" } else { "Mac은" }) };
    let r = row("python", "자막 엔진 (Python)", if cuda { St::Ok } else { St::Warn }, value).hint(hint);
    if !cuda && !gpu.is_empty() { r.acts(&["reinstall-engine"]) } else { r }
}

pub fn check_model() -> Row {
    let names: Vec<String> = std::fs::read_dir(models_dir()).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
    let has = |n: &str| names.iter().any(|f| f.contains(&format!("faster-whisper-{n}")));
    if has("large-v3") { return row("model", "Whisper 모델", St::Ok, "large-v3 받음"); }
    if has("medium") { return row("model", "Whisper 모델", St::Ok, "medium 받음 (CPU용)"); }
    let r = row("model", "Whisper 모델", St::Warn, "아직 안 받음")
        .hint(format!("첫 자막 생성 때 자동으로 내려받습니다. [지금 받기]로 미리 받아 둘 수 있습니다 ({}medium 약 1.5GB).", if cfg!(windows) { "GPU: large-v3 약 3GB, CPU: " } else { "" }));
    if python().exists() { r.acts(&["download-model"]) } else { r }
}

pub fn check_ai_key(s: &Value) -> Row {
    let from_settings = !crate::secret::setting(s, "geminiApiKeyEnc").is_empty();
    let from_env = std::env::var("GEMINI_API_KEY").is_ok_and(|v| !v.is_empty());
    let model = s["template"]["aiModel"].as_str().filter(|m| !m.is_empty()).unwrap_or(crate::llm::gemini::DEFAULT_MODEL).to_string();
    if !from_settings && !from_env {
        return row("ai", "Gemini API 키", St::Warn, "없음").hint("AI 추천을 쓰려면 https://aistudio.google.com/apikey 에서 키를 만들어 [설정 → AI]에 넣으세요.").acts(&["open:gemini", "open-settings"]);
    }
    let mut r = row("ai", "Gemini API 키", St::Ok, format!("{} · 모델 {model}", if from_settings { "설정에 저장됨" } else { "환경변수 GEMINI_API_KEY" })).hint("[연결 확인]으로 실제 호출을 시험합니다.").acts(&["test-ai"]);
    r.model = model;
    r
}

/// 디스크 여유 공간 (바이트)
pub fn disk_free(p: &Path) -> Option<u64> {
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        let mut q = p.to_path_buf();
        while !q.exists() { q = q.parent()?.to_path_buf(); }
        let w: Vec<u16> = q.as_os_str().encode_wide().chain([0]).collect();
        let mut free = 0u64;
        let ok = unsafe { windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(w.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
        if ok != 0 { Some(free) } else { None }
    }
    #[cfg(not(windows))] {
        let mut q = p.to_path_buf();
        while !q.exists() { q = q.parent()?.to_path_buf(); }
        let o = std::process::Command::new("df").args(["-k"]).arg(&q).output().ok()?;
        let s = String::from_utf8_lossy(&o.stdout);
        let l = s.lines().nth(1)?;
        l.split_whitespace().nth(3)?.parse::<u64>().ok().map(|k| k * 1024)
    }
}
fn drive_of(p: &Path) -> String { p.components().next().map(|c| c.as_os_str().to_string_lossy().into_owned()).map(|d| if cfg!(windows) { format!("{d}\\") } else { "/".into() }).unwrap_or_default() }

pub fn check_disk() -> Row {
    let c = cache_dir();
    match disk_free(&c) {
        Some(free) => {
            let gb = free as f64 / 1024f64.powi(3);
            let st = if gb >= 10.0 { St::Ok } else if gb >= 3.0 { St::Warn } else { St::Error };
            row("disk", "디스크 여유 공간", st, format!("{} {} 남음", drive_of(&c), fmt_bytes(free))).hint(if gb >= 10.0 { "" } else { "영상 1편 다운로드에 약 1~2GB가 필요합니다. 캐시를 정리하거나 공간을 비우세요." })
        }
        None => row("disk", "디스크 여유 공간", St::Warn, "확인 실패"),
    }
}

pub fn check_cache() -> Row {
    let size: u64 = clearable_cache_dirs().iter().map(|d| dir_size(d)).sum();
    let r = row("cache", "캐시 (다운로드·자막)", St::Ok, fmt_bytes(size)).hint(cache_dir().display().to_string());
    if size > 0 { r.acts(&["clear-cache"]) } else { r }
}

pub struct Report { pub rows: Vec<Row>, pub critical: bool }
/// quick: 시작할 때 쓰는 빠른 점검 (Python 실행 생략)
pub fn check_system(quick: bool) -> Report {
    let s = crate::settings::load();
    let rows = std::thread::scope(|sc| {
        let a = sc.spawn(check_ffmpeg);
        let b = sc.spawn(check_ytdlp);
        let c = sc.spawn(check_js_runtime);
        let d = sc.spawn(move || check_python(quick));
        let rest = vec![check_model(), check_ai_key(&s), check_disk(), if quick { row("cache", "캐시", St::Ok, "") } else { check_cache() }];
        let mut v = vec![a.join().unwrap(), b.join().unwrap(), c.join().unwrap(), d.join().unwrap()];
        v.extend(rest);
        v
    });
    let critical = rows.iter().any(|r| r.critical && r.status == St::Error);
    Report { rows, critical }
}

// ---------------------------------------------------------------- 설치·동작

static RUNNING: Mutex<Option<&'static str>> = Mutex::new(None);
/// 한 번에 하나만 (기존 exclusive)
fn exclusive(name: &'static str, f: impl FnOnce() -> (bool, String)) -> (bool, String) {
    { let mut g = RUNNING.lock().unwrap(); if let Some(n) = *g { return (false, format!("이미 다른 설치가 진행 중입니다: {n}")); } *g = Some(name); }
    let r = f();
    *RUNNING.lock().unwrap() = None;
    r
}

/// 줄마다 읽으며 실행 (표준 출력·오류 둘 다). 끝 코드와 마지막 20줄
fn spawn_lines(mut c: std::process::Command, mut on_line: impl FnMut(&str)) -> (i32, Vec<String>) {
    use std::process::Stdio;
    let Ok(mut child) = c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() else { return (-1, vec!["실행하지 못했습니다".into()]) };
    let err = child.stderr.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let tx2 = tx.clone();
    let t1 = std::thread::spawn(move || { for l in BufReader::new(err).lines().map_while(Result::ok) { let _ = tx2.send(l); } });
    let out = child.stdout.take().unwrap();
    let t2 = std::thread::spawn(move || { for l in BufReader::new(out).lines().map_while(Result::ok) { let _ = tx.send(l); } });
    let mut tail: Vec<String> = vec![];
    for l in rx { if l.trim().is_empty() { continue; } tail.push(l.clone()); if tail.len() > 20 { tail.remove(0); } on_line(&l); }
    let _ = t1.join(); let _ = t2.join();
    (child.wait().ok().and_then(|s| s.code()).unwrap_or(-1), tail)
}

/// 엔진 설치 스크립트 (시험용 SS_SETUP_SCRIPT 로 바꿀 수 있다)
pub fn setup_script() -> PathBuf {
    if let Ok(p) = std::env::var("SS_SETUP_SCRIPT") { return PathBuf::from(p); }
    crate::assets_dir().join("engine").join(if cfg!(windows) { "setup_engine.ps1" } else { "setup_engine.sh" })
}

/// 자막 엔진 설치 (force: 기존 가상환경을 지우고 새로). on(pct, 글)
pub fn install_engine(force: bool, mut on: impl FnMut(Option<f64>, String)) -> (bool, String) {
    exclusive("자막 엔진", || {
        let script = setup_script();
        if !script.exists() { return (false, format!("설치 스크립트가 없습니다: {}", script.display())); }
        let data = runtime_dir();
        let _ = std::fs::create_dir_all(&data);
        let mut c = if cfg!(windows) {
            let mut c = crate::media::command("powershell");
            c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]).arg(&script).arg("-DataDir").arg(&data).arg("-InstallPython");
            if force { c.arg("-Force"); }
            c
        } else {
            let mut c = std::process::Command::new("/bin/bash");
            c.arg(&script).arg("--data-dir").arg(&data).arg("--install-python");
            if force { c.arg("--force"); }
            c
        };
        for k in ["PYTHONHOME", "PYTHONPATH", "PIP_PREFIX", "PIP_TARGET", "PIP_USER", "VIRTUAL_ENV"] { c.env_remove(k); }
        c.env("PYTHONIOENCODING", "utf-8");
        on(Some(0.0), "자막 엔진 설치 시작 (PyTorch 포함 약 3GB, 10분 이상 걸릴 수 있습니다)".into());
        let (mut done, mut error): (Option<Value>, Option<String>) = (None, None);
        let (code, tail) = spawn_lines(c, |l| {
            let Ok(m) = serde_json::from_str::<Value>(l) else { return };
            match m["type"].as_str() {
                Some("progress") => on(m["pct"].as_f64(), m["message"].as_str().unwrap_or("").into()),
                Some("warn") => on(None, m["message"].as_str().unwrap_or("").into()),
                Some("error") => error = m["message"].as_str().map(String::from),
                Some("done") => done = Some(m),
                _ => {}
            }
        });
        if let Some(d) = done.filter(|d| d["ok"].as_bool() == Some(true) && code == 0) { return (true, d["message"].as_str().unwrap_or("엔진 설치 완료").to_string()); }
        (false, error.unwrap_or_else(|| format!("엔진 설치 실패 (코드 {code}): {}", tail.iter().rev().take(3).rev().cloned().collect::<Vec<_>>().join(" "))))
    })
}

/// transcribe.py 와 같은 모델(GPU면 large-v3, CPU면 medium)을 같은 폴더에 미리 받는다
pub fn download_model(mut on: impl FnMut(Option<f64>, String)) -> (bool, String) {
    exclusive("Whisper 모델", || {
        let py = python();
        if !py.exists() { return (false, "먼저 자막 엔진을 설치하세요.".into()); }
        let models = models_dir();
        let _ = std::fs::create_dir_all(&models);
        let code = "import json, sys, torch\nfrom faster_whisper.utils import download_model\nname = 'large-v3' if torch.cuda.is_available() else 'medium'\nprint(json.dumps({'model': name}), flush=True)\ndownload_model(name, cache_dir=sys.argv[1])\nprint(json.dumps({'done': True}), flush=True)";
        let mut c = py_cmd(&py);
        c.args(["-c", code]).arg(&models).env("HF_HOME", engine_dir().join("hf-cache"));
        let start = dir_size(&models);
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let model = std::sync::Arc::new(Mutex::new(String::new()));
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let (stop2, model2, models2) = (stop.clone(), model.clone(), models.clone());
        let ticker = std::thread::spawn(move || {
            while !stop2.load(std::sync::atomic::Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                let mb = dir_size(&models2).saturating_sub(start) / 1024 / 1024;
                let m = model2.lock().unwrap().clone();
                let _ = tx.send(format!("{} 모델 받는 중... {mb} MB", if m.is_empty() { "Whisper".into() } else { m }));
            }
        });
        let mut finished = false;
        let (rc, tail) = spawn_lines(c, |l| {
            while let Ok(m) = rx.try_recv() { on(None, m); }
            if let Ok(v) = serde_json::from_str::<Value>(l) {
                if let Some(m) = v["model"].as_str() { *model.lock().unwrap() = m.into(); }
                if v["done"].as_bool() == Some(true) { finished = true; }
            }
        });
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = ticker.join();
        let m = model.lock().unwrap().clone();
        if finished && rc == 0 { return (true, format!("{m} 모델을 받았습니다.")); }
        (false, format!("모델 받기 실패 (코드 {rc}): {}", tail.iter().rev().take(2).rev().cloned().collect::<Vec<_>>().join(" ")))
    })
}

const FFMPEG_ZIP: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

/// Windows: gyan.dev 공식 빌드에서 ffmpeg.exe·ffprobe.exe 만 꺼내 데이터 폴더 bin/ 에 둔다
pub fn install_ffmpeg(mut on: impl FnMut(Option<f64>, String)) -> (bool, String) {
    exclusive("ffmpeg", || {
        if !cfg!(windows) { return (false, "Mac 은 터미널에서 brew install ffmpeg 로 설치하세요.".into()); }
        let bin = managed_bin();
        let work = cache_dir().join("ffmpeg-setup");
        let _ = std::fs::remove_dir_all(&work);
        if let Err(e) = std::fs::create_dir_all(&work).and_then(|_| std::fs::create_dir_all(&bin)) { return (false, format!("ffmpeg 설치 실패: {e}")); }
        let zip = work.join("ffmpeg.zip");
        let r = (|| -> Result<(bool, String), String> {
            on(Some(0.0), "ffmpeg 받는 중 (약 100MB)".into());
            download_to(FFMPEG_ZIP, &zip, |pct, mb| on(pct.map(|p| (p * 0.9).round()), format!("ffmpeg 받는 중… {mb} MB")))?;
            on(Some(92.0), "압축 푸는 중".into());
            // Windows 10 이상의 tar.exe 는 zip 도 푼다
            let tar = PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into())).join("System32").join("tar.exe");
            let mut c = crate::media::command_path(if tar.exists() { &tar } else { Path::new("tar") });
            c.args(["-xf"]).arg(&zip).arg("-C").arg(&work);
            let (code, tail) = spawn_lines(c, |_| {});
            if code != 0 { return Ok((false, format!("압축 풀기 실패: {}", tail.join(" ")))); }
            for name in ["ffmpeg.exe", "ffprobe.exe"] {
                let Some(src) = find_file(&work, name) else { return Ok((false, format!("받은 파일에 {name} 이 없습니다"))) };
                std::fs::copy(&src, bin.join(name)).map_err(|e| e.to_string())?;
            }
            on(Some(100.0), "ffmpeg 설치 완료".into());
            Ok((true, "ffmpeg·ffprobe 를 설치했습니다".into()))
        })();
        let _ = std::fs::remove_dir_all(&work);
        r.unwrap_or_else(|e| (false, format!("ffmpeg 설치 실패: {e}")))
    })
}
fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).ok()?.flatten() {
            let p = e.path();
            if p.is_dir() { stack.push(p); } else if e.file_name().to_string_lossy().eq_ignore_ascii_case(name) { return Some(p); }
        }
    }
    None
}
/// 내려받으며 진행률 보고 on(pct 0~100, 받은 MB)
fn download_to(url: &str, dest: &Path, mut on: impl FnMut(Option<f64>, u64)) -> Result<(), String> {
    use std::io::{Read, Write};
    let res = ureq::get(url).timeout(std::time::Duration::from_secs(600)).call().map_err(|e| format!("내려받기 실패 ({e})"))?;
    let total: u64 = res.header("content-length").and_then(|s| s.parse().ok()).unwrap_or(0);
    let mut rd = res.into_reader();
    let mut f = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let (mut got, mut last) = (0u64, std::time::Instant::now());
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = rd.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        f.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        if last.elapsed().as_millis() > 500 { last = std::time::Instant::now(); on(if total > 0 { Some((got as f64 / total as f64 * 100.0).round()) } else { None }, got / 1048576); }
    }
    if total > 0 && got < total { return Err("내려받다가 끊겼습니다".into()); }
    Ok(())
}

pub fn update_ytdlp() -> (bool, String) {
    let before = crate::youtube::ytdlp_version();
    match crate::youtube::ensure_ytdlp(true) {
        Ok(updated) => {
            let v = crate::youtube::ytdlp_version();
            if updated && v != before { (true, format!("최신으로 바꿨습니다: {} → {v}", if before.is_empty() { "없음".into() } else { before })) } else { (true, format!("이미 최신입니다: {v}")) }
        }
        Err(e) => (false, format!("yt-dlp 업데이트 실패: {e}")),
    }
}

/// 실제로 유튜브 정보를 가져와 JS 런타임이 쓰이는지 확인
pub fn test_youtube(url: &str) -> (bool, String) {
    let rt = crate::youtube::js_runtime();
    let mut c = crate::media::command_path(&crate::youtube::ytdlp_path());
    c.args(["-J", "--no-playlist", "--skip-download"]);
    if let Some((k, p, _)) = &rt { c.arg("--js-runtimes").arg(format!("{k}:{}", p.display())); }
    c.arg("--").arg(url);
    let t0 = std::time::Instant::now();
    let Ok(o) = c.stdin(std::process::Stdio::null()).output() else { return (false, "유튜브 확인 실패: yt-dlp 를 실행하지 못했습니다".into()) };
    let ms = t0.elapsed().as_millis();
    let err = String::from_utf8_lossy(&o.stderr);
    if !o.status.success() { return (false, format!("유튜브 확인 실패: {}", err.trim().lines().last().unwrap_or(""))); }
    let title = serde_json::from_slice::<Value>(&o.stdout).ok().and_then(|v| v["title"].as_str().map(String::from)).unwrap_or_default();
    if regex::RegexBuilder::new("No supported JavaScript runtime").case_insensitive(true).build().unwrap().is_match(&err) {
        return (false, format!("영상 정보는 받았지만 JS 런타임이 인식되지 않았습니다 ({})", rt.map(|r| r.0).unwrap_or_else(|| "없음".into())));
    }
    (true, format!("유튜브 확인 성공 ({ms}ms): {title}"))
}

pub fn clear_cache() -> (bool, String, usize, u64) {
    let dirs = clearable_cache_dirs();
    let mut freed = 0;
    for d in &dirs { freed += dir_size(d); let _ = std::fs::remove_dir_all(d); }
    (true, format!("{} 정리됨", fmt_bytes(freed)), dirs.len(), freed)
}

/// 행을 JSON 으로 (시험·기록용)
pub fn row_json(r: &Row) -> Value { json!({ "id": r.id, "name": r.name, "status": r.status.as_str(), "value": r.value, "hint": r.hint, "actions": r.actions, "critical": r.critical }) }
