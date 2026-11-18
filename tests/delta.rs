//! 바뀐 부분만 받는 업데이트: 나누기 → 견주기 → 덩어리 풀기 → 새 앱 만들기가 새 묶음과 똑같은지 (맥은 실행 권한까지)
use sermon_shorts::delta;
use std::path::{Path, PathBuf};

fn tmp(name: &str) -> PathBuf { let d = std::env::temp_dir().join(format!("ss_delta_test_{}_{name}", std::process::id())); let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d }
fn put(root: &Path, rel: &str, body: &[u8]) { let p = root.join(rel); std::fs::create_dir_all(p.parent().unwrap()).unwrap(); std::fs::write(p, body).unwrap(); }
#[cfg(unix)]
fn exec(p: &Path) { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755)).unwrap(); }
#[cfg(not(unix))]
fn exec(_p: &Path) {}

fn make_app(root: &Path, exe: &[u8], extra_asset: bool) {
    put(root, "SermonShorts.exe", exe);
    put(root, "LICENSE.txt", b"license");
    put(root, "assets/fonts/a.ttf", &vec![7u8; 5000]);
    put(root, "assets/bin/yt-dlp", &vec![9u8; 20000]);
    put(root, "bin/ffmpeg", &vec![3u8; 50000]);
    exec(&root.join("bin/ffmpeg")); exec(&root.join("assets/bin/yt-dlp")); exec(&root.join("SermonShorts.exe"));
    if extra_asset { put(root, "assets/new.txt", b"new"); }
}

#[test]
fn delta_round_trip() {
    let base = tmp("base");
    let old = base.join("old").join("App"); make_app(&old, b"old exe", false);
    let new = base.join("new").join("App"); make_app(&new, b"new exe!", true);
    let rel = base.join("rel");
    let files = delta::build(&new, "9.9.9", "win-x64", &rel).unwrap();
    assert_eq!(files.len(), 4);
    let m: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(rel.join(delta::manifest_name("9.9.9", "win-x64"))).unwrap()).unwrap();
    assert_eq!(m["root"], "App");
    assert_eq!(m["files"].as_array().unwrap().len(), 6);
    assert_eq!(delta::part_of("bin/ffmpeg"), "tools");
    assert_eq!(delta::part_of("Contents/Resources/assets/bin/yt-dlp"), "tools");
    assert_eq!(delta::part_of("Contents/Resources/assets/fonts/a.ttf"), "assets");
    assert_eq!(delta::part_of("Contents/MacOS/SermonShorts"), "core");
    // 견주기: 실행 파일(core)과 새 assets 파일만 바뀜 → tools 는 안 받는다
    let (need, _size, keep) = delta::plan(&m, &old);
    assert_eq!(need, vec!["assets".to_string(), "core".to_string()]);
    assert!(keep.contains("bin/ffmpeg") && keep.contains("assets/bin/yt-dlp") && !keep.contains("SermonShorts.exe"));
    // 받은 덩어리만 풀고 새 앱 만들기
    let parts = base.join("parts");
    for p in &need { delta::extract_part(&rel.join(delta::part_name("9.9.9", "win-x64", p)), &parts).unwrap(); }
    assert!(!parts.join("bin/ffmpeg").exists());
    let out = base.join("out").join("App");
    delta::assemble(&m, &old, &parts, &keep, &out).unwrap();
    for f in m["files"].as_array().unwrap() {
        let p = f["path"].as_str().unwrap();
        assert_eq!(std::fs::read(out.join(p)).unwrap(), std::fs::read(new.join(p)).unwrap(), "{p}");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for p in ["bin/ffmpeg", "assets/bin/yt-dlp", "SermonShorts.exe"] { assert_eq!(std::fs::metadata(out.join(p)).unwrap().permissions().mode() & 0o777, 0o755, "{p}"); }
    }
    // 덩어리가 망가지면 새 앱 만들기가 실패해야 한다 (해시 확인)
    std::fs::write(parts.join("SermonShorts.exe"), b"tampered").unwrap();
    assert!(delta::assemble(&m, &old, &parts, &keep, &base.join("out2").join("App")).is_err());
    // 지금 설치본이 이미 새 것과 같으면 받을 것이 없다
    let (need2, size2, _) = delta::plan(&m, &new);
    assert!(need2.is_empty() && size2 == 0);
    let _ = std::fs::remove_dir_all(&base);
}
