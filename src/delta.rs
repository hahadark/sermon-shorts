//! 바뀐 부분만 받는 업데이트.
//! 릴리스마다 앱 묶음을 세 덩어리(core: 실행 파일·글, assets: 글꼴·그림 등, tools: ffmpeg·yt-dlp)의 ZIP 으로 나눠 올리고,
//! 파일마다 해시가 든 목록(…-files.json)을 함께 올린다. 업데이트할 때는 지금 설치된 파일과 목록을 견주어
//! 바뀐 파일이 든 덩어리만 받고, 바뀌지 않은 파일은 지금 설치본에서 복사해 새 앱 전체를 따로 만든다(파일마다 해시 확인).
//! 목록이 없거나 무엇이든 맞지 않으면 예전처럼 전체 ZIP 을 받는다.
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const PARTS: [&str; 3] = ["core", "assets", "tools"];

pub fn manifest_name(version: &str, label: &str) -> String { format!("SermonShorts-Rust-{version}-{label}-files.json") }
pub fn part_name(version: &str, label: &str, part: &str) -> String { format!("SermonShorts-Rust-{version}-{label}-{part}.zip") }

/// 파일이 어느 덩어리에 드나 (경로는 '/' 로 나눈 앱 뿌리 기준)
pub fn part_of(rel: &str) -> &'static str {
    let r = rel.strip_prefix("Contents/Resources/").unwrap_or(rel);
    if r.starts_with("bin/") || r.starts_with("assets/bin/") { "tools" }
    else if r.starts_with("assets/") { "assets" }
    else { "core" }
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for e in std::fs::read_dir(dir)? {
        let e = e?;
        let p = e.path();
        let ft = e.file_type()?;
        if ft.is_dir() { walk(root, &p, out)?; } else if ft.is_file() { out.push(p.strip_prefix(root).unwrap().to_path_buf()); }
    }
    Ok(())
}
fn rel_str(p: &Path) -> String { p.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/") }
#[cfg(unix)]
fn mode_of(p: &Path) -> u32 { use std::os::unix::fs::PermissionsExt; std::fs::metadata(p).map(|m| m.permissions().mode() & 0o777).unwrap_or(0o644) }
#[cfg(not(unix))]
fn mode_of(_p: &Path) -> u32 { 0o644 }
#[cfg(unix)]
fn set_mode(p: &Path, mode: u32) { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode)); }
#[cfg(not(unix))]
fn set_mode(_p: &Path, _mode: u32) {}

/// 앱 묶음(윈도우: 앱 폴더, 맥: SermonShorts.app)을 덩어리 ZIP 들과 목록으로 나눈다 → 만든 파일들
pub fn build(app: &Path, version: &str, label: &str, out_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = vec![];
    walk(app, app, &mut files).map_err(|e| e.to_string())?;
    files.sort();
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    let mut writers: Vec<(String, PathBuf, zip::ZipWriter<std::fs::File>)> = PARTS.iter().map(|p| {
        let f = out_dir.join(part_name(version, label, p));
        let w = zip::ZipWriter::new(std::fs::File::create(&f).unwrap());
        (p.to_string(), f, w)
    }).collect();
    let mut list = vec![];
    for rel in &files {
        let full = app.join(rel);
        let r = rel_str(rel);
        let part = part_of(&r);
        let mode = mode_of(&full);
        let (_, _, w) = writers.iter_mut().find(|x| x.0 == part).unwrap();
        w.start_file(r.as_str(), opt.unix_permissions(mode)).map_err(|e| e.to_string())?;
        let mut f = std::fs::File::open(&full).map_err(|e| e.to_string())?;
        std::io::copy(&mut f, w).map_err(|e| e.to_string())?;
        list.push(json!({ "path": r, "sha256": crate::updater::sha256_file(&full)?, "size": std::fs::metadata(&full).map(|m| m.len()).unwrap_or(0), "part": part, "mode": mode }));
    }
    let mut out = vec![];
    let mut parts = vec![];
    for (name, f, w) in writers {
        w.finish().map_err(|e| e.to_string())?;
        parts.push(json!({ "name": name, "asset": f.file_name().unwrap().to_string_lossy(), "sha256": crate::updater::sha256_file(&f)?, "size": std::fs::metadata(&f).map(|m| m.len()).unwrap_or(0) }));
        out.push(f);
    }
    let root = app.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let m = json!({ "version": version, "label": label, "root": root, "files": list, "parts": parts });
    let mf = out_dir.join(manifest_name(version, label));
    std::fs::write(&mf, serde_json::to_string_pretty(&m).unwrap()).map_err(|e| e.to_string())?;
    out.push(mf);
    Ok(out)
}

/// 지금 설치본과 견주기 → (받아야 할 덩어리, 그 크기 합, 설치본에서 그대로 쓸 수 있는 파일 경로들)
pub fn plan(m: &Value, install: &Path) -> (Vec<String>, u64, std::collections::HashSet<String>) {
    let mut need = std::collections::BTreeSet::new();
    let mut keep = std::collections::HashSet::new();
    for f in m["files"].as_array().into_iter().flatten() {
        let (path, part) = (f["path"].as_str().unwrap_or(""), f["part"].as_str().unwrap_or("core"));
        let local = install.join(path);
        let same = std::fs::metadata(&local).map(|md| md.len() == f["size"].as_u64().unwrap_or(u64::MAX)).unwrap_or(false)
            && crate::updater::sha256_file(&local).ok().as_deref() == f["sha256"].as_str();
        if same { keep.insert(path.to_string()); } else { need.insert(part.to_string()); }
    }
    let size = m["parts"].as_array().into_iter().flatten().filter(|p| need.contains(p["name"].as_str().unwrap_or(""))).map(|p| p["size"].as_u64().unwrap_or(0)).sum();
    (need.into_iter().collect(), size, keep)
}

/// 덩어리 ZIP 풀기 (경로가 밖으로 나가는 항목은 거부, 맥은 실행 권한 살림)
pub fn extract_part(zip_file: &Path, dest: &Path) -> Result<(), String> {
    let f = std::fs::File::open(zip_file).map_err(|e| e.to_string())?;
    let mut a = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..a.len() {
        let mut e = a.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = e.enclosed_name() else { return Err(format!("잘못된 경로: {}", e.name())) };
        let out = dest.join(rel);
        if e.is_dir() { std::fs::create_dir_all(&out).map_err(|e| e.to_string())?; continue; }
        if let Some(p) = out.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
        let mut w = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 256 * 1024];
        loop { let n = e.read(&mut buf).map_err(|e| e.to_string())?; if n == 0 { break; } w.write_all(&buf[..n]).map_err(|e| e.to_string())?; }
        drop(w);
        if let Some(m) = e.unix_mode() { set_mode(&out, m & 0o777); }
    }
    Ok(())
}

/// 새 앱 전체 만들기: 그대로 쓸 파일은 설치본에서, 나머지는 받은 덩어리에서. 파일마다 해시 확인
pub fn assemble(m: &Value, install: &Path, parts_dir: &Path, keep: &std::collections::HashSet<String>, out_root: &Path) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(out_root);
    std::fs::create_dir_all(out_root).map_err(|e| e.to_string())?;
    for f in m["files"].as_array().into_iter().flatten() {
        let path = f["path"].as_str().ok_or("목록 오류")?;
        if path.split('/').any(|c| c == ".." || c.is_empty()) || path.starts_with('/') || path.contains(':') { return Err(format!("잘못된 경로: {path}")); }
        let src = if keep.contains(path) { install.join(path) } else { parts_dir.join(path) };
        let dst = out_root.join(path);
        if let Some(p) = dst.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
        std::fs::copy(&src, &dst).map_err(|e| format!("{path}: {e}"))?;
        if crate::updater::sha256_file(&dst)?.as_str() != f["sha256"].as_str().unwrap_or("") { return Err(format!("파일 해시가 맞지 않습니다: {path}")); }
        if let Some(md) = f["mode"].as_u64() { set_mode(&dst, md as u32); }
    }
    Ok(())
}
