//! Rust 판 자동 업데이트 (기존 main/updater.js·updater-mac.js 방식을 Rust 판에 맞춤).
//!  1) GitHub 릴리스에서 내 플랫폼 묶음(SermonShorts-Rust-<버전>-win-x64.zip / -mac-arm64.zip / -mac-intel.zip)이 있는 가장 새 버전을 찾는다
//!     (지금이 베타면 베타도, 정식이면 정식만). Electron 판 릴리스는 묶음 이름이 달라 고르지 않는다
//!  2) 뒤에서 받아 SHA256SUMS-rust.txt 와 맞춰 보고 푼다
//!  3) 앱이 끝날 때(또는 [지금 다시 시작]) 작은 스크립트가 앱이 완전히 끝나기를 기다렸다가 파일을 바꿔 끼운다. 실패하면 되돌린다
//! 바꿀 수 없는 곳(쓰기 권한 없음, 맥 DMG 안 등)이면 새 버전 알림과 내려받기 페이지만 준다. 개발 실행·시험에서는 하지 않는다.
use serde_json::Value;
use sha2::Digest;
use std::cmp::Ordering;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const RELEASES_API: &str = "https://api.github.com/repos/hahadark/sermon-shorts/releases?per_page=30";
pub const RELEASES_URL: &str = "https://github.com/hahadark/sermon-shorts/releases";
pub const SUMS_NAME: &str = "SHA256SUMS-rust.txt";
pub fn current() -> &'static str { env!("CARGO_PKG_VERSION") }

// ---------------------------------------------------------------- 순수 함수 (시험용으로 공개)

/// "rust-v0.4.0-beta.2" / "v0.4.0" / "0.4.0" → (0,4,0, ["beta","2"])
pub fn parse_version(v: &str) -> Option<(u64, u64, u64, Vec<String>)> {
    let s = v.trim();
    let s = s.strip_prefix("rust-").unwrap_or(s);
    let s = s.strip_prefix('v').unwrap_or(s);
    let (core, pre) = match s.split_once('-') { Some((a, b)) => (a, Some(b)), None => (s, None) };
    let core = core.split('+').next()?;
    let p: Vec<u64> = core.split('.').map(|x| x.parse().ok()).collect::<Option<Vec<_>>>()?;
    if p.len() != 3 { return None; }
    let pre = pre.map(|x| x.split('+').next().unwrap_or("").split('.').filter(|y| !y.is_empty()).map(String::from).collect()).unwrap_or_default();
    Some((p[0], p[1], p[2], pre))
}
/// 유의적 버전 순서 (정식 > 같은 번호의 베타, beta.10 > beta.2)
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let (Some(x), Some(y)) = (parse_version(a), parse_version(b)) else { return Ordering::Equal };
    let c = (x.0, x.1, x.2).cmp(&(y.0, y.1, y.2));
    if c != Ordering::Equal { return c; }
    match (x.3.is_empty(), y.3.is_empty()) {
        (true, true) => return Ordering::Equal,
        (true, false) => return Ordering::Greater,
        (false, true) => return Ordering::Less,
        _ => {}
    }
    for (p, q) in x.3.iter().zip(y.3.iter()) {
        let o = match (p.parse::<u64>(), q.parse::<u64>()) { (Ok(m), Ok(n)) => m.cmp(&n), (Ok(_), Err(_)) => Ordering::Less, (Err(_), Ok(_)) => Ordering::Greater, _ => p.cmp(q) };
        if o != Ordering::Equal { return o; }
    }
    x.3.len().cmp(&y.3.len())
}
pub fn is_prerelease(v: &str) -> bool { parse_version(v).is_some_and(|p| !p.3.is_empty()) }

/// 이 컴퓨터용 묶음 이름의 꼬리
pub fn platform_label() -> &'static str {
    if cfg!(target_os = "macos") { if cfg!(target_arch = "aarch64") { "mac-arm64" } else { "mac-intel" } } else { "win-x64" }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rel { pub version: String, pub tag: String, pub zip_name: String, pub zip_url: String, pub zip_size: u64, pub sums_url: String, pub page: String,
    /// 바뀐 부분만 받기: 파일 목록 주소와 덩어리들 (이름, 주소, 크기). 없으면 전체 ZIP
    pub manifest_url: Option<String>, pub parts: Vec<(String, String, u64)> }

/// 릴리스 목록 → 지금보다 새, 내 플랫폼 묶음이 있는 가장 새 릴리스 (지금이 베타면 베타도)
pub fn pick_release(list: &Value, label: &str, current: &str) -> Option<Rel> {
    let allow_pre = is_prerelease(current);
    let mut best: Option<Rel> = None;
    for rel in list.as_array().into_iter().flatten() {
        if rel["draft"].as_bool() == Some(true) { continue; }
        if rel["prerelease"].as_bool() == Some(true) && !allow_pre { continue; }
        let tag = rel["tag_name"].as_str().unwrap_or("");
        let Some(p) = parse_version(tag) else { continue };
        let version = format!("{}.{}.{}{}", p.0, p.1, p.2, if p.3.is_empty() { String::new() } else { format!("-{}", p.3.join(".")) });
        if !allow_pre && !p.3.is_empty() { continue; }
        let assets = rel["assets"].as_array().cloned().unwrap_or_default();
        let want = format!("SermonShorts-Rust-{version}-{label}.zip");
        let Some(zip) = assets.iter().find(|a| a["name"].as_str() == Some(want.as_str())) else { continue };
        let Some(sums) = assets.iter().find(|a| a["name"].as_str() == Some(SUMS_NAME)) else { continue };
        if compare_versions(&version, current) != Ordering::Greater { continue; }
        if best.as_ref().is_some_and(|b| compare_versions(&version, &b.version) != Ordering::Greater) { continue; }
        let url_of = |n: &str| assets.iter().find(|a| a["name"].as_str() == Some(n)).map(|a| (a["browser_download_url"].as_str().unwrap_or("").to_string(), a["size"].as_u64().unwrap_or(0)));
        let manifest_url = url_of(&crate::delta::manifest_name(&version, label)).map(|x| x.0);
        let parts: Vec<(String, String, u64)> = crate::delta::PARTS.iter().filter_map(|p| { let n = crate::delta::part_name(&version, label, p); url_of(&n).map(|(u, s)| (n, u, s)) }).collect();
        best = Some(Rel { version, tag: tag.into(), zip_name: want, zip_url: zip["browser_download_url"].as_str().unwrap_or("").into(), zip_size: zip["size"].as_u64().unwrap_or(0),
            sums_url: sums["browser_download_url"].as_str().unwrap_or("").into(), page: rel["html_url"].as_str().unwrap_or(RELEASES_URL).into(), manifest_url, parts });
    }
    best
}

/// SHA256SUMS 글에서 파일 이름의 해시
pub fn sum_for(text: &str, name: &str) -> Option<String> {
    for line in text.lines() {
        let l = line.trim();
        let Some((h, n)) = l.split_once(char::is_whitespace) else { continue };
        let n = n.trim().trim_start_matches('*');
        if h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()) && n == name { return Some(h.to_lowercase()); }
    }
    None
}

/// 개발 실행(cargo target 폴더)·시험이면 하지 않는다
pub fn dev_run() -> bool {
    if std::env::var("SS_NO_UPDATE").is_ok() { return true; }
    if std::env::var("SS_UPDATE_FORCE").is_ok() { return false; }
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().replace('\\', "/").to_lowercase()).unwrap_or_default();
    exe.contains("/target/release/") || exe.contains("/target/debug/")
}

/// 바꿔 끼울 자리: 윈도우는 실행 파일 폴더, 맥은 .app 묶음
pub fn install_target() -> Option<PathBuf> {
    if let Ok(d) = std::env::var("SS_UPDATE_DEST") { return Some(PathBuf::from(d)); }
    let exe = std::env::current_exe().ok()?;
    if cfg!(target_os = "macos") {
        let b = exe.parent()?.parent()?.parent()?.to_path_buf();
        b.extension().is_some_and(|e| e == "app").then_some(b)
    } else { exe.parent().map(Path::to_path_buf) }
}

/// 이 자리를 스스로 바꿀 수 있나
pub fn can_replace(dest: Option<&Path>) -> Result<(), String> {
    let Some(d) = dest else { return Err("앱 폴더를 찾지 못했습니다".into()) };
    let s = d.to_string_lossy();
    if s.starts_with("/Volumes/") { return Err("디스크 이미지(DMG) 안에서 실행 중입니다. 응용 프로그램 폴더로 옮겨 주세요".into()); }
    if s.contains("/AppTranslocation/") { return Err("격리된 위치에서 실행 중입니다. 응용 프로그램 폴더로 옮겨 주세요".into()); }
    let probe_dir = if cfg!(target_os = "macos") { d.parent().map(Path::to_path_buf).unwrap_or_else(|| d.to_path_buf()) } else { d.to_path_buf() };
    let probe = probe_dir.join(format!(".ss-write-test-{}", std::process::id()));
    match std::fs::write(&probe, b"x") { Ok(()) => { let _ = std::fs::remove_file(&probe); Ok(()) } Err(_) => Err("앱 폴더에 쓸 권한이 없습니다".into()) }
}

/// 윈도우: 앱이 끝나기를 기다렸다가 새 파일을 넣는다 (바뀌는 것만 옆으로 치웠다가, 실패하면 되돌린다)
pub fn win_swap_script() -> &'static str {
    r#"param([int]$ProcId, [string]$New, [string]$Dest, [string]$Exe, [int]$Relaunch)
# SermonShorts Rust 판 업데이트: 앱이 끝나기를 기다렸다가 바꿔 끼운다.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
"$(Get-Date -Format s) 시작 pid=$ProcId new=$New dest=$Dest relaunch=$Relaunch"
for ($i = 0; $i -lt 600; $i++) { if (-not (Get-Process -Id $ProcId -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 200 }
if (Get-Process -Id $ProcId -ErrorAction SilentlyContinue) { '앱이 끝나지 않아 그만둡니다'; exit 1 }
Start-Sleep -Milliseconds 400
$bak = Join-Path $Dest ('.ss-old-' + $PID)
$moved = @(); $placed = @(); $ok = 0
# 예전 것은 이름 바꾸기 한 번으로만 옆으로 치운다 (잠긴 파일이 있으면 통째로 실패해 반쯤 옮겨지지 않는다). 새 것은 복사해 넣는다
function MoveAtomic([string]$a, [string]$b) { if ([IO.Directory]::Exists($a)) { [IO.Directory]::Move($a, $b) } else { [IO.File]::Move($a, $b) } }
try {
  if (-not (Test-Path -LiteralPath $New)) { throw '새 파일이 없습니다' }
  [IO.Directory]::CreateDirectory($bak) | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $New -Force) {
    $target = Join-Path $Dest $item.Name
    if (Test-Path -LiteralPath $target) { MoveAtomic $target (Join-Path $bak $item.Name); $moved += $item.Name }
    $placed += $item.Name
    Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse -Force
  }
  $ok = 1
} catch {
  "실패: $_ (되돌립니다)"
  foreach ($n in $placed) { Remove-Item -LiteralPath (Join-Path $Dest $n) -Recurse -Force -ErrorAction SilentlyContinue }
  foreach ($n in $moved) { try { MoveAtomic (Join-Path $bak $n) (Join-Path $Dest $n) } catch { "되돌리지 못함: $n ($_)" } }
}
if ($ok -eq 1 -or -not (Get-ChildItem -LiteralPath $bak -Recurse -Force -File -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $bak -Recurse -Force -ErrorAction SilentlyContinue }
if ($ok -eq 1) { Remove-Item -LiteralPath $New -Recurse -Force -ErrorAction SilentlyContinue }
"$(Get-Date -Format s) 결과 ok=$ok"
Set-Content -LiteralPath (Join-Path $PSScriptRoot 'last-swap') -Value $ok
if ($Relaunch -eq 1) { $e = Join-Path $Dest $Exe; if (Test-Path -LiteralPath $e) { Start-Process -FilePath $e -WorkingDirectory $Dest } }
if ($ok -ne 1) { exit 1 }
"#
}

/// 맥: 앱이 끝나기를 기다렸다가 .app 을 바꿔 끼운다 (기존 updater-mac.js swapScript 와 같음)
pub fn mac_swap_script() -> &'static str {
    r#"#!/bin/bash
# SermonShorts Rust 판 맥 업데이트: 앱이 끝나기를 기다렸다가 바꿔 끼운다.
PID="$1"; NEW="$2"; DEST="$3"; RELAUNCH="$4"
echo "$(date '+%F %T') 시작 pid=$PID new=$NEW dest=$DEST relaunch=$RELAUNCH"
for _ in $(seq 1 600); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$PID" 2>/dev/null; then echo "앱이 끝나지 않아 그만둡니다"; exit 1; fi
[ -d "$NEW" ] || { echo "새 앱이 없습니다"; exit 1; }
OLD="$(dirname "$DEST")/.SermonShorts-old-$$.app"
ok=0
if mv "$DEST" "$OLD"; then
  if mv "$NEW" "$DEST"; then ok=1; rm -rf "$OLD"
  else echo "새 앱을 넣지 못해 되돌립니다"; rm -rf "$DEST"; mv "$OLD" "$DEST"; fi
else echo "기존 앱을 옮기지 못했습니다"; fi
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
echo "$(date '+%F %T') 결과 ok=$ok"
echo "$ok" > "$(dirname "$0")/last-swap"
[ "$RELAUNCH" = 1 ] && open "$DEST"
[ "$ok" = 1 ]
"#
}
pub const MAC_BLOCKED: &str = "macOS 가 앱 바꾸기를 막았습니다. 시스템 설정 > 개인정보 보호 및 보안 > 앱 관리에서 SermonShorts 를 켜 주세요";

// ---------------------------------------------------------------- 실제 동작

/// 화면에 보일 상태 (기존 update:status): off | idle | checking | latest | downloading | ready | portable | error
#[derive(Clone, Debug, PartialEq)]
pub enum St { Off, Idle, Checking, Latest, Downloading { version: String, percent: u32 }, Ready { version: String }, Portable { version: String, reason: String, page: String }, Error { message: String } }
impl St {
    pub fn key(&self) -> String { match self { St::Downloading { version, .. } => format!("downloading:{version}"), St::Ready { version } => format!("ready:{version}"), St::Portable { version, .. } => format!("portable:{version}"), s => format!("{s:?}") } }
}

pub fn work_dir() -> PathBuf { crate::theme::user_data_dir().join("rust-update") }

fn agent() -> String { format!("SermonShorts-Rust/{}", current()) }
/// 주소(또는 시험용 로컬 파일)에서 글 받기
fn get_text(url: &str) -> Result<String, String> {
    if !url.starts_with("http") { return std::fs::read_to_string(url).map_err(|e| e.to_string()); }
    let r = ureq::get(url).set("User-Agent", &agent()).set("Accept", "application/vnd.github+json").timeout(std::time::Duration::from_secs(30)).call();
    match r { Ok(r) => r.into_string().map_err(|e| e.to_string()), Err(ureq::Error::Status(c, _)) => Err(format!("GitHub 응답 {c}")), Err(e) => Err(format!("인터넷 연결을 확인하세요 ({e})")) }
}
fn download(url: &str, file: &Path, size: u64, on: &dyn Fn(u32)) -> Result<(), String> {
    let tmp = file.with_extension("part");
    let (mut reader, total): (Box<dyn Read>, u64) = if url.starts_with("http") {
        let r = ureq::get(url).set("User-Agent", &agent()).timeout(std::time::Duration::from_secs(1800)).call().map_err(|e| format!("내려받기 실패: {e}"))?;
        let total = r.header("content-length").and_then(|v| v.parse().ok()).unwrap_or(size);
        (Box::new(r.into_reader()), total)
    } else { let f = std::fs::File::open(url).map_err(|e| e.to_string())?; let n = f.metadata().map(|m| m.len()).unwrap_or(size); (Box::new(f), n) };
    let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 256 * 1024];
    let (mut got, mut last) = (0u64, u32::MAX);
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("내려받기 끊김: {e}"))?;
        if n == 0 { break; }
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        let pct = if total > 0 { (got * 100 / total) as u32 } else { 0 };
        if pct != last { last = pct; on(pct); }
    }
    drop(out);
    if total > 0 && got != total { return Err(format!("받은 크기가 다릅니다 ({got}/{total})")); }
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}
pub fn sha256_file(p: &Path) -> Result<String, String> {
    let mut f = std::fs::File::open(p).map_err(|e| e.to_string())?;
    let mut h = sha2::Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop { let n = f.read(&mut buf).map_err(|e| e.to_string())?; if n == 0 { break; } h.update(&buf[..n]); }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}
/// ZIP 풀기 (윈도우). 경로가 밖으로 나가는 항목은 거부
pub fn unzip(zip: &Path, dest: &Path) -> Result<(), String> {
    let f = std::fs::File::open(zip).map_err(|e| e.to_string())?;
    let mut a = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..a.len() {
        let mut e = a.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = e.enclosed_name() else { return Err(format!("잘못된 경로: {}", e.name())) };
        let out = dest.join(rel);
        if e.is_dir() { std::fs::create_dir_all(&out).map_err(|e| e.to_string())?; continue; }
        if let Some(p) = out.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
        let mut w = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut e, &mut w).map_err(|e| e.to_string())?;
    }
    Ok(())
}
/// 푼 곳에서 앱 폴더 찾기: 윈도우는 SermonShorts.exe 가 든 폴더, 맥은 SermonShorts.app
fn find_payload(dir: &Path) -> Option<PathBuf> {
    let want = |p: &Path| if cfg!(target_os = "macos") { p.extension().is_some_and(|e| e == "app") } else { p.join("SermonShorts.exe").is_file() };
    if want(dir) { return Some(dir.to_path_buf()); }
    std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| p.is_dir() && want(p))
}
#[cfg(target_os = "macos")]
fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let o = std::process::Command::new(cmd).args(args).output().map_err(|e| e.to_string())?;
    if !o.status.success() { return Err(format!("{cmd} 실패: {}", String::from_utf8_lossy(&o.stderr).trim())); }
    Ok(String::from_utf8_lossy(&o.stdout).to_string())
}

/// 받아서 확인하고 풀기 → 새 앱 폴더(또는 .app)
pub fn prepare(rel: &Rel, on: &dyn Fn(u32)) -> Result<PathBuf, String> {
    let dir = work_dir().join(&rel.version);
    let done = dir.join("ready.json");
    let app = dir.join("app");
    if done.exists() { if let Some(p) = find_payload(&app) { return Ok(p); } }
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let sums = get_text(&rel.sums_url)?;
    on(0);
    // 바뀐 부분만 받기 (안 되면 전체)
    match prepare_delta(rel, &sums, &dir, on) {
        Ok(Some(p)) => { std::fs::write(&done, format!("{{\"version\":\"{}\",\"delta\":true}}", rel.version)).map_err(|e| e.to_string())?; return Ok(p); }
        Ok(None) => {}
        Err(e) => { let _ = std::fs::write(dir.join("delta-error.txt"), &e); let _ = std::fs::remove_dir_all(&app); }
    }
    let zip = dir.join(&rel.zip_name);
    download(&rel.zip_url, &zip, rel.zip_size, on)?;
    let want = sum_for(&sums, &rel.zip_name).ok_or("해시 목록에 이 파일이 없습니다")?;
    if sha256_file(&zip)? != want { return Err("받은 파일의 해시가 맞지 않습니다".into()); }
    #[cfg(target_os = "macos")]
    { run("/usr/bin/ditto", &["-x", "-k", &zip.to_string_lossy(), &app.to_string_lossy()])?; }
    #[cfg(not(target_os = "macos"))]
    { unzip(&zip, &app)?; }
    let _ = std::fs::remove_file(&zip);
    let payload = find_payload(&app).ok_or("받은 묶음에서 앱을 찾지 못했습니다")?;
    #[cfg(target_os = "macos")]
    {
        let plist = payload.join("Contents").join("Info.plist");
        let ver = run("/usr/bin/plutil", &["-extract", "CFBundleShortVersionString", "raw", "-o", "-", &plist.to_string_lossy()])?.trim().to_string();
        if ver != rel.version { return Err(format!("새 앱의 버전이 다릅니다 ({ver})")); }
        run("/usr/bin/codesign", &["--verify", "--deep", &payload.to_string_lossy()])?;
        let _ = run("/usr/bin/xattr", &["-dr", "com.apple.quarantine", &payload.to_string_lossy()]);
    }
    std::fs::write(&done, format!("{{\"version\":\"{}\"}}", rel.version)).map_err(|e| e.to_string())?;
    Ok(payload)
}

/// 바뀐 부분만 받아 새 앱 만들기. 목록이 없거나 아낄 것이 적으면 Ok(None) → 전체 ZIP
pub fn prepare_delta(rel: &Rel, sums: &str, dir: &Path, on: &dyn Fn(u32)) -> Result<Option<PathBuf>, String> {
    let Some(murl) = rel.manifest_url.as_ref() else { return Ok(None) };
    let Some(install) = install_target() else { return Ok(None) };
    if std::env::var("SS_UPDATE_FULL").is_ok() { return Ok(None); }
    let label = platform_label();
    let mname = crate::delta::manifest_name(&rel.version, label);
    let mtext = get_text(murl)?;
    let want = sum_for(sums, &mname).ok_or("해시 목록에 파일 목록이 없습니다")?;
    if sha256_bytes(mtext.as_bytes()) != want { return Err("파일 목록의 해시가 맞지 않습니다".into()); }
    let m: Value = serde_json::from_str(&mtext).map_err(|e| e.to_string())?;
    if m["version"].as_str() != Some(rel.version.as_str()) { return Err("파일 목록의 버전이 다릅니다".into()); }
    let (need, size, keep) = crate::delta::plan(&m, &install);
    let _ = std::fs::write(dir.join("delta.json"), serde_json::json!({ "need": need, "size": size, "keep": keep.len(), "full": rel.zip_size }).to_string());
    // 아끼는 것이 적으면(전체의 80% 넘게 받아야 하면) 전체 ZIP
    if rel.zip_size > 0 && size as f64 > rel.zip_size as f64 * 0.8 { return Ok(None); }
    let parts_dir = dir.join("parts");
    let total = size.max(1);
    let mut got = 0u64;
    for p in &need {
        let (name, url, psize) = rel.parts.iter().find(|x| x.0 == crate::delta::part_name(&rel.version, label, p)).cloned().ok_or(format!("{p} 덩어리가 릴리스에 없습니다"))?;
        let file = dir.join(&name);
        let base = got;
        download(&url, &file, psize, &|pct| on(((base + psize * pct as u64 / 100) * 100 / total) as u32))?;
        got += psize;
        let h = sha256_file(&file)?;
        let w1 = sum_for(sums, &name);
        let w2 = m["parts"].as_array().into_iter().flatten().find(|x| x["asset"].as_str() == Some(name.as_str())).and_then(|x| x["sha256"].as_str()).map(String::from);
        if w1.as_deref() != Some(h.as_str()) || w2.as_deref() != Some(h.as_str()) { return Err(format!("{name} 해시가 맞지 않습니다")); }
        crate::delta::extract_part(&file, &parts_dir)?;
        let _ = std::fs::remove_file(&file);
    }
    let root = m["root"].as_str().filter(|r| !r.is_empty() && !r.contains(['/', '\\']) && *r != "..").ok_or("목록의 앱 이름이 잘못됐습니다")?;
    let payload = dir.join("app").join(root);
    crate::delta::assemble(&m, &install, &parts_dir, &keep, &payload)?;
    let _ = std::fs::remove_dir_all(&parts_dir);
    #[cfg(target_os = "macos")]
    {
        let plist = payload.join("Contents").join("Info.plist");
        let ver = run("/usr/bin/plutil", &["-extract", "CFBundleShortVersionString", "raw", "-o", "-", &plist.to_string_lossy()])?.trim().to_string();
        if ver != rel.version { return Err(format!("새 앱의 버전이 다릅니다 ({ver})")); }
        run("/usr/bin/codesign", &["--verify", "--deep", &payload.to_string_lossy()])?;
        let _ = run("/usr/bin/xattr", &["-dr", "com.apple.quarantine", &payload.to_string_lossy()]);
    }
    #[cfg(not(target_os = "macos"))]
    { if !payload.join("SermonShorts.exe").is_file() { return Err("새 앱에 실행 파일이 없습니다".into()); } }
    on(100);
    Ok(Some(payload))
}
fn sha256_bytes(b: &[u8]) -> String { let mut h = sha2::Sha256::new(); h.update(b); h.finalize().iter().map(|x| format!("{x:02x}")).collect() }
/// 지난 바꿔 끼우기 결과를 읽고 지운다 (실패였으면 true)
fn read_last_swap_failed() -> bool {
    let f = work_dir().join("last-swap");
    let failed = std::fs::read_to_string(&f).map(|s| s.trim() == "0").unwrap_or(false);
    let _ = std::fs::remove_file(&f);
    failed
}

pub struct Updater {
    st: Arc<Mutex<St>>,
    staged: Arc<Mutex<Option<(String, PathBuf)>>>,
    busy: Arc<Mutex<bool>>,
    swapped: bool,
    last_failed: bool,
}
impl Updater {
    pub fn new(enabled: bool) -> Updater {
        let on = enabled && !dev_run();
        if on {
            // 지난 업데이트 찌꺼기 정리 (지금 버전 이하)
            if let Ok(rd) = std::fs::read_dir(work_dir()) { for e in rd.flatten() { let n = e.file_name().to_string_lossy().to_string(); if parse_version(&n).is_some() && compare_versions(&n, current()) != Ordering::Greater { let _ = std::fs::remove_dir_all(e.path()); } } }
        }
        Updater { st: Arc::new(Mutex::new(if on { St::Idle } else { St::Off })), staged: Arc::new(Mutex::new(None)), busy: Arc::new(Mutex::new(false)), swapped: false, last_failed: on && read_last_swap_failed() }
    }
    pub fn status(&self) -> St { self.st.lock().unwrap().clone() }
    pub fn busy(&self) -> bool { *self.busy.lock().unwrap() }
    /// 확인 (뒤에서). 이미 받아 두었으면 준비됨
    pub fn check(&self) {
        if *self.st.lock().unwrap() == St::Off { return; }
        { let mut b = self.busy.lock().unwrap(); if *b { return; } *b = true; }
        if let Some((v, _)) = self.staged.lock().unwrap().clone() { *self.st.lock().unwrap() = St::Ready { version: v }; *self.busy.lock().unwrap() = false; return; }
        let (st, staged, busy, last_failed) = (self.st.clone(), self.staged.clone(), self.busy.clone(), self.last_failed);
        std::thread::spawn(move || {
            *st.lock().unwrap() = St::Checking;
            let r = (|| -> Result<(), String> {
                let feed = std::env::var("SS_UPDATE_FEED").unwrap_or_else(|_| RELEASES_API.into());
                let list: Value = serde_json::from_str(&get_text(&feed)?).map_err(|e| format!("릴리스 정보를 읽지 못했습니다: {e}"))?;
                let Some(rel) = pick_release(&list, platform_label(), current()) else { *st.lock().unwrap() = St::Latest; return Ok(()) };
                let dest = install_target();
                if let Err(reason) = can_replace(dest.as_deref()) { *st.lock().unwrap() = St::Portable { version: rel.version.clone(), reason, page: rel.page.clone() }; return Ok(()); }
                let s2 = st.clone(); let v2 = rel.version.clone();
                let payload = prepare(&rel, &move |p| { *s2.lock().unwrap() = St::Downloading { version: v2.clone(), percent: p }; })?;
                *staged.lock().unwrap() = Some((rel.version.clone(), payload));
                *st.lock().unwrap() = if last_failed && cfg!(target_os = "macos") { St::Portable { version: rel.version.clone(), reason: MAC_BLOCKED.into(), page: rel.page.clone() } } else { St::Ready { version: rel.version.clone() } };
                Ok(())
            })();
            if let Err(e) = r { *st.lock().unwrap() = St::Error { message: e }; }
            *busy.lock().unwrap() = false;
        });
    }
    /// 앱이 끝날 때: 받아 둔 새 버전이 있으면 바꿔 끼우는 스크립트를 띄운다
    pub fn spawn_swap(&mut self, relaunch: bool) -> bool {
        if self.swapped { return false; }
        let Some((ver, payload)) = self.staged.lock().unwrap().clone() else { return false };
        let Some(dest) = install_target() else { return false };
        self.swapped = true;
        let work = work_dir();
        let _ = std::fs::create_dir_all(&work);
        let log = std::fs::OpenOptions::new().create(true).append(true).open(work.join("swap.log"));
        let (Ok(l1), Ok(l2)) = (log.as_ref().map(|f| f.try_clone()), log.as_ref().map(|f| f.try_clone())) else { return false };
        let (Ok(o), Ok(e)) = (l1, l2) else { return false };
        let pid = std::process::id().to_string();
        let r = if cfg!(target_os = "macos") {
            let script = work.join("swap.sh");
            if std::fs::write(&script, mac_swap_script()).is_err() { return false; }
            std::process::Command::new("/bin/bash").arg(&script).arg(&pid).arg(&payload).arg(&dest).arg(if relaunch { "1" } else { "0" }).stdin(std::process::Stdio::null()).stdout(o).stderr(e).spawn()
        } else {
            let script = work.join("swap.ps1");
            // 한글 안내가 깨지지 않게 BOM 을 붙인다 (Windows PowerShell 5)
            let mut body = vec![0xEF, 0xBB, 0xBF]; body.extend_from_slice(win_swap_script().as_bytes());
            if std::fs::write(&script, body).is_err() { return false; }
            let exe = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())).filter(|n| payload.join(n).exists()).unwrap_or_else(|| "SermonShorts.exe".into());
            let mut c = crate::media::command("powershell");
            c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File"]).arg(&script).arg("-ProcId").arg(&pid).arg("-New").arg(&payload).arg("-Dest").arg(&dest).arg("-Exe").arg(&exe).arg("-Relaunch").arg(if relaunch { "1" } else { "0" });
            c.stdin(std::process::Stdio::null()).stdout(o).stderr(e).spawn()
        };
        let _ = ver;
        r.is_ok()
    }
}
