//! 미리보기용 영상 (기존 main/preview-proxy.js)
//! 유튜브에서 받은 영상은 기준 화면(키프레임)이 5초에 한 번쯤뿐이라, 편집 결과로 재생하다 지운 곳을 건너뛸 때마다
//! 그 사이 화면을 모두 다시 해독하느라 멈칫한다. 같은 길이·같은 시각에 기준 화면만 0.5초마다 넣은 영상(1080p 이하)을
//! 뒤에서 만들어 미리보기에만 쓴다. 내보내기·자막 만들기·파형·목소리 측정은 늘 원본을 쓴다.
use crate::media;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

const TARGET_GOP_SEC: f64 = 0.5;
const DENSE_ENOUGH_SEC: f64 = 1.0;
const KEEP_FILES: usize = 8;
const KEEP_DAYS: f64 = 30.0;

static GOOD_ENCODER: Mutex<Option<&'static str>> = Mutex::new(None);

pub fn dir() -> PathBuf { let d = crate::youtube::cache_dir().join("proxy"); let _ = std::fs::create_dir_all(&d); d }

/// 기존 media.sourceHash: sha1(절대 경로|크기|수정 시각 ms) 앞 16자리
pub fn source_hash(src: &Path) -> Option<String> {
    let st = std::fs::metadata(src).ok()?;
    let abs = std::path::absolute(src).unwrap_or_else(|_| src.to_path_buf());
    let mtime = st.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos() as f64 / 1e6;
    Some(crate::autosave::sha16(format!("{}|{}|{}", abs.to_string_lossy(), st.len(), crate::stt::js_num(Some(mtime))).as_bytes()))
}

#[derive(Clone, Debug, Default)]
pub struct Streams { pub duration: f64, pub video: Option<(f64, u32, f64)>, pub audio: Option<(f64, String)> }

pub fn streams_of(file: &Path) -> Result<Streams, String> {
    let out = media::command("ffprobe").args(["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,start_time,height,avg_frame_rate", "-of", "json"]).arg(file).output().map_err(|e| e.to_string())?;
    let j: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let num = |v: &Value| v.as_str().and_then(|s| s.parse::<f64>().ok()).or(v.as_f64()).unwrap_or(0.0);
    let ss = j["streams"].as_array().cloned().unwrap_or_default();
    let v = ss.iter().find(|s| s["codec_type"] == "video");
    let a = ss.iter().find(|s| s["codec_type"] == "audio");
    let fps = v.map(|v| { let p: Vec<f64> = v["avg_frame_rate"].as_str().unwrap_or("30/1").split('/').map(|x| x.parse().unwrap_or(0.0)).collect(); if p.len() == 2 && p[1] > 0.0 { p[0] / p[1] } else { 30.0 } }).unwrap_or(30.0);
    Ok(Streams {
        duration: num(&j["format"]["duration"]),
        video: v.map(|v| (num(&v["start_time"]), v["height"].as_u64().unwrap_or(0) as u32, if fps > 0.0 { fps } else { 30.0 })),
        audio: a.map(|a| (num(&a["start_time"]), a["codec_name"].as_str().unwrap_or("").to_string())),
    })
}

/// 원본의 기준 화면 간격(앞 90초 기준, 초). 읽지 못하면 None
pub fn keyframe_gap(src: &Path) -> Option<f64> {
    let out = media::command("ffprobe").args(["-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-read_intervals", "%+90", "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0"]).arg(src).output().ok()?;
    if !out.status.success() { return None; }
    let mut t: Vec<f64> = String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| l.trim().trim_end_matches(',').parse().ok()).filter(|x: &f64| x.is_finite()).collect();
    t.sort_by(|a, b| a.partial_cmp(b).unwrap());
    if t.len() < 2 { return if t.is_empty() { None } else { Some(90.0) }; }
    Some((t[t.len() - 1] - t[0]) / (t.len() - 1) as f64)
}

/// 하드웨어 인코더 먼저, 안 되면 CPU (libx264)
pub fn encoder_list() -> Vec<&'static str> {
    let mut l: Vec<&'static str> = if cfg!(target_os = "macos") { vec!["h264_videotoolbox"] } else if cfg!(windows) { vec!["h264_nvenc", "h264_qsv", "h264_amf"] } else { vec![] };
    l.push("libx264");
    l
}
fn encoder_args(name: &str) -> Vec<&'static str> {
    match name {
        "h264_nvenc" => vec!["-c:v", "h264_nvenc", "-preset", "p1", "-rc", "vbr", "-cq", "28", "-b:v", "0"],
        "h264_qsv" => vec!["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "28"],
        "h264_amf" => vec!["-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", "26", "-qp_p", "28"],
        "h264_videotoolbox" => vec!["-c:v", "h264_videotoolbox", "-q:v", "55", "-realtime", "1"],
        _ => vec!["-c:v", "libx264", "-preset", "ultrafast", "-tune", "fastdecode", "-crf", "26"],
    }
}
pub fn build_args(src: &Path, out: &Path, info: &Streams, encoder: &str) -> Vec<String> {
    let (_, height, fps) = info.video.unwrap_or((0.0, 0, 30.0));
    let gop = ((fps * TARGET_GOP_SEC).round() as i64).max(1).to_string();
    let mut a: Vec<String> = ["-y", "-v", "error", "-nostats", "-progress", "pipe:1", "-i"].iter().map(|s| s.to_string()).collect();
    a.push(src.to_string_lossy().into());
    a.extend(["-map", "0:v:0", "-map", "0:a:0?"].iter().map(|s| s.to_string()));
    if height > 1080 { a.extend(["-vf", "scale=-2:1080"].iter().map(|s| s.to_string())); }
    a.extend(encoder_args(encoder).iter().map(|s| s.to_string()));
    a.extend(["-g", &gop, "-keyint_min", &gop, "-bf", "0", "-pix_fmt", "yuv420p", "-fps_mode", "passthrough"].iter().map(|s| s.to_string()));
    if encoder == "libx264" { a.extend(["-sc_threshold", "0"].iter().map(|s| s.to_string())); }
    if let Some((_, codec)) = &info.audio { if codec == "aac" { a.extend(["-c:a", "copy"].iter().map(|s| s.to_string())); } else { a.extend(["-c:a", "aac", "-b:a", "160k"].iter().map(|s| s.to_string())); } }
    a.extend(["-movflags", "+faststart", "-f", "mp4"].iter().map(|s| s.to_string()));
    a.push(out.to_string_lossy().into());
    a
}

/// 만든 영상이 원본과 같은 길이·같은 시각인지 (어긋나면 쓰지 않는다: 자막·컷 위치가 틀어지므로)
pub fn same_timeline(src: &Path, out: &Path) -> bool {
    let (Ok(a), Ok(b)) = (streams_of(src), streams_of(out)) else { return false };
    let (Some(va), Some(vb)) = (a.video, b.video) else { return false };
    if (a.duration - b.duration).abs() > 0.15 || (va.0 - vb.0).abs() > 0.02 { return false; }
    if let Some((sa, _)) = a.audio { match b.audio { Some((sb, _)) if (sa - sb).abs() <= 0.02 => {}, _ => return false } }
    true
}

fn prune(keep: &Path) {
    let Ok(rd) = std::fs::read_dir(dir()) else { return };
    let now = std::time::SystemTime::now();
    let mut files: Vec<(PathBuf, std::time::SystemTime)> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("mp4"))).filter_map(|p| std::fs::metadata(&p).and_then(|m| m.modified()).ok().map(|t| (p, t))).collect();
    files.sort_by(|a, b| b.1.cmp(&a.1));
    for (i, (f, t)) in files.iter().enumerate() {
        if f == keep { continue; }
        let old = now.duration_since(*t).map(|d| d.as_secs_f64() > KEEP_DAYS * 86400.0).unwrap_or(false);
        if i >= KEEP_FILES || old || f.to_string_lossy().to_lowercase().ends_with(".part.mp4") { let _ = std::fs::remove_file(f); }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Outcome { Ready(PathBuf), Skipped(&'static str) }

/// 미리보기용 영상 준비 (만든 것 또는 이미 있던 것). cancel 이 켜지면 멈춘다
pub fn ensure(src: &Path, on_pct: &dyn Fn(f64), cancel: Arc<AtomicBool>) -> Result<Outcome, String> {
    if !src.exists() { return Err("원본 영상이 없습니다.".into()); }
    let hash = source_hash(src).ok_or("원본 영상을 읽지 못했습니다.")?;
    let out = dir().join(format!("{hash}.mp4"));
    if std::fs::metadata(&out).map(|m| m.len() > 1024).unwrap_or(false) {
        if let Ok(f) = std::fs::File::options().append(true).open(&out) { let _ = f.set_modified(std::time::SystemTime::now()); }
        return Ok(Outcome::Ready(out));
    }
    let info = streams_of(src)?;
    if info.video.is_none() { return Ok(Outcome::Skipped("no-video")); }
    if keyframe_gap(src).is_some_and(|g| g <= DENSE_ENOUGH_SEC) { return Ok(Outcome::Skipped("dense")); }
    let part = dir().join(format!("{hash}.part.mp4"));
    let list: Vec<&'static str> = match *GOOD_ENCODER.lock().unwrap() { Some(e) => vec![e], None => encoder_list() };
    let mut last = String::new();
    for enc in list {
        if cancel.load(Ordering::SeqCst) { break; }
        match encode(src, &part, &info, enc, on_pct, &cancel) {
            Ok(()) if same_timeline(src, &part) => {
                std::fs::rename(&part, &out).map_err(|e| e.to_string())?;
                *GOOD_ENCODER.lock().unwrap() = Some(enc);
                prune(&out);
                return Ok(Outcome::Ready(out));
            }
            Ok(()) => { last = "만든 영상의 시각이 원본과 어긋납니다".into(); }
            Err(e) => { last = e; }
        }
        let _ = std::fs::remove_file(&part);
        if cancel.load(Ordering::SeqCst) { return Err("취소됨".into()); }
        let mut g = GOOD_ENCODER.lock().unwrap();
        if *g == Some(enc) { *g = None; }
    }
    if cancel.load(Ordering::SeqCst) { return Err("취소됨".into()); }
    Err(if last.is_empty() { "미리보기용 영상을 만들지 못했습니다".into() } else { last })
}

fn encode(src: &Path, out: &Path, info: &Streams, enc: &str, on_pct: &dyn Fn(f64), cancel: &Arc<AtomicBool>) -> Result<(), String> {
    let mut c = media::command("ffmpeg");
    c.args(build_args(src, out, info, enc)).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut ch = c.spawn().map_err(|e| format!("{enc} 실행 실패: {e}"))?;
    let so = ch.stdout.take().unwrap();
    let mut se = ch.stderr.take().unwrap();
    let err_t = std::thread::spawn(move || { let mut s = String::new(); let _ = std::io::Read::read_to_string(&mut se, &mut s); s });
    let child = Arc::new(Mutex::new(ch));
    // 취소 지켜보기
    let (c2, k2) = (cancel.clone(), child.clone());
    let done = Arc::new(AtomicBool::new(false));
    let d2 = done.clone();
    std::thread::spawn(move || { while !d2.load(Ordering::SeqCst) { if c2.load(Ordering::SeqCst) { let _ = k2.lock().unwrap().kill(); break; } std::thread::sleep(std::time::Duration::from_millis(150)); } });
    for line in BufReader::new(so).lines().map_while(Result::ok) {
        if let Some(v) = line.trim().strip_prefix("out_time_us=").or_else(|| line.trim().strip_prefix("out_time_ms=")) {
            if let (Ok(us), true) = (v.parse::<f64>(), info.duration > 0.0) { on_pct((us / 1e6 / info.duration * 100.0).min(99.0)); }
        }
    }
    let st = loop { if let Ok(Some(s)) = child.lock().unwrap().try_wait() { break s; } std::thread::sleep(std::time::Duration::from_millis(50)); };
    done.store(true, Ordering::SeqCst);
    let err = err_t.join().unwrap_or_default();
    if cancel.load(Ordering::SeqCst) { return Err("취소됨".into()); }
    if st.success() { Ok(()) } else { Err(format!("{enc} 실패 ({}): {}", st.code().unwrap_or(-1), err.trim().lines().rev().take(2).collect::<Vec<_>>().join(" "))) }
}
