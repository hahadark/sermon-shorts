//! 외부 도구(ffmpeg·ffprobe) 찾기와 영상 정보 읽기
use anyhow::{Context, Result, bail};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
pub const NO_WINDOW: u32 = 0x0800_0000;

/// 실행 파일 옆 bin\ → PATH 순서
pub fn find_tool(name: &str) -> PathBuf {
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    if let Ok(me) = std::env::current_exe() {
        if let Some(dir) = me.parent() {
            for cand in [dir.join("bin").join(&exe), dir.join(&exe)] { if cand.exists() { return cand; } }
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for d in std::env::split_paths(&paths) { let p = d.join(&exe); if p.exists() { return p; } }
    }
    PathBuf::from(exe)
}

/// 경로가 정해진 실행 파일 (창 없이)
pub fn command_path(p: &Path) -> Command {
    let mut c = Command::new(p);
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; c.creation_flags(NO_WINDOW); }
    c
}
pub fn command(tool: &str) -> Command {
    let mut c = Command::new(find_tool(tool));
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; c.creation_flags(NO_WINDOW); }
    c
}

#[derive(Clone, Debug, Default)]
pub struct Probe { pub duration: f64, pub width: u32, pub height: u32, pub fps: f64, pub has_audio: bool, pub has_video: bool }

pub fn probe(path: &Path) -> Result<Probe> {
    let out = command("ffprobe").args(["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate", "-of", "json"]).arg(path).output().context("ffprobe 를 실행하지 못했습니다")?;
    if !out.status.success() { bail!("영상 정보를 읽지 못했습니다: {}", String::from_utf8_lossy(&out.stderr).trim()); }
    let j: serde_json::Value = serde_json::from_slice(&out.stdout)?;
    let mut p = Probe { duration: j["format"]["duration"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0.0), ..Default::default() };
    for s in j["streams"].as_array().into_iter().flatten() {
        match s["codec_type"].as_str() {
            Some("video") if !p.has_video => {
                p.has_video = true;
                p.width = s["width"].as_u64().unwrap_or(0) as u32;
                p.height = s["height"].as_u64().unwrap_or(0) as u32;
                let rate = |k: &str| s[k].as_str().and_then(|r| { let (a, b) = r.split_once('/')?; let (a, b): (f64, f64) = (a.parse().ok()?, b.parse().ok()?); (b > 0.0 && a > 0.0).then(|| a / b) });
                p.fps = rate("avg_frame_rate").or_else(|| rate("r_frame_rate")).unwrap_or(30.0);
            }
            Some("audio") => p.has_audio = true,
            _ => {}
        }
    }
    if p.duration <= 0.0 { bail!("영상 길이를 알 수 없습니다"); }
    Ok(p)
}

/// 소리 조각: start 초부터 dur 초를 한 채널 f32 로 (start 가 0 보다 앞이면 앞을 0 으로 채움)
pub fn pcm(path: &Path, start: f64, dur: f64, rate: u32) -> anyhow::Result<Vec<f32>> {
    let pad = if start < 0.0 { ((-start) * rate as f64).round() as usize } else { 0 };
    let s = start.max(0.0);
    let d = (dur - (s - start)).max(0.0);
    let out = command("ffmpeg").args(["-hide_banner", "-v", "error", "-ss", &format!("{s:.3}"), "-t", &format!("{d:.3}"), "-i"]).arg(path)
        .args(["-vn", "-ac", "1", "-ar", &rate.to_string(), "-f", "f32le", "-"]).stdin(std::process::Stdio::null()).output()?;
    if !out.status.success() { anyhow::bail!("소리를 읽지 못했습니다: {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("")); }
    let mut v = vec![0f32; pad];
    v.extend(out.stdout.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])));
    Ok(v)
}