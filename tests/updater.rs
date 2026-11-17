//! Rust 판 자동 업데이트의 순수 부분: 버전 순서, 릴리스 고르기, 해시 목록
use serde_json::json;
use sermon_shorts::updater::*;
use std::cmp::Ordering;

#[test]
fn versions() {
    assert_eq!(compare_versions("0.4.0", "0.4.0-beta.2"), Ordering::Greater);
    assert_eq!(compare_versions("rust-v0.4.0-beta.10", "0.4.0-beta.2"), Ordering::Greater);
    assert_eq!(compare_versions("v0.4.1", "0.4.0"), Ordering::Greater);
    assert_eq!(compare_versions("0.4.0-beta.2", "rust-v0.4.0-beta.2"), Ordering::Equal);
    assert_eq!(compare_versions("0.4.0-alpha.9", "0.4.0-beta.1"), Ordering::Less);
    assert_eq!(compare_versions("0.3.26", "0.4.0-beta.1"), Ordering::Less);
    assert!(is_prerelease("0.4.0-beta.2") && !is_prerelease("0.4.0"));
}

fn rel(tag: &str, pre: bool, assets: &[&str]) -> serde_json::Value {
    json!({ "tag_name": tag, "prerelease": pre, "draft": false, "html_url": format!("https://x/{tag}"),
        "assets": assets.iter().map(|n| json!({ "name": n, "browser_download_url": format!("https://dl/{n}"), "size": 10 })).collect::<Vec<_>>() })
}

#[test]
fn pick() {
    let s = "SHA256SUMS-rust.txt";
    let list = json!([
        rel("v0.3.26", false, &["SermonShorts-Setup-0.3.26.exe", "latest.yml", "SHA256SUMS.txt"]),
        rel("rust-v0.4.0-beta.3", true, &["SermonShorts-Rust-0.4.0-beta.3-win-x64.zip", "SermonShorts-Rust-0.4.0-beta.3-mac-arm64.zip", s]),
        rel("rust-v0.4.0-beta.2", true, &["SermonShorts-Rust-0.4.0-beta.2-win-x64.zip", s]),
        rel("rust-v0.4.0", false, &["SermonShorts-Rust-0.4.0-win-x64.zip", s]),
        rel("rust-v0.4.1-beta.1", true, &["SermonShorts-Rust-0.4.1-beta.1-win-x64.zip", s]),
        rel("rust-v0.4.2", false, &["SermonShorts-Rust-0.4.2-mac-intel.zip", s]),
    ]);
    // 베타 사용자는 베타도 받는다 (가장 새 것)
    assert_eq!(pick_release(&list, "win-x64", "0.4.0-beta.2").map(|r| r.version), Some("0.4.1-beta.1".into()));
    // 정식 사용자는 정식만
    assert_eq!(pick_release(&list, "win-x64", "0.4.0"), None);
    assert_eq!(pick_release(&list, "win-x64", "0.3.99").map(|r| (r.version, r.zip_url, r.sums_url)), Some(("0.4.0".into(), "https://dl/SermonShorts-Rust-0.4.0-win-x64.zip".into(), "https://dl/SHA256SUMS-rust.txt".into())));
    // 내 플랫폼 묶음이 없으면 고르지 않는다 (Electron 릴리스·다른 플랫폼)
    assert_eq!(pick_release(&list, "mac-intel", "0.4.1").map(|r| r.version), Some("0.4.2".into()));
    assert_eq!(pick_release(&list, "mac-arm64", "0.4.0-beta.2").map(|r| r.version), Some("0.4.0-beta.3".into()));
    // 해시 목록이 없으면 고르지 않는다
    let no_sums = json!([rel("rust-v0.5.0", false, &["SermonShorts-Rust-0.5.0-win-x64.zip"])]);
    assert_eq!(pick_release(&no_sums, "win-x64", "0.4.0"), None);
}

#[test]
fn sums() {
    let t = "5d22a8efda0b1c694d7a8503f317df121dcaaba88118ef125bb397a3882bbc33  SermonShorts-Rust-0.4.0-beta.2-win-x64.zip\r\nF987D1DF350DD8AF29187E4A85E9EECE456A9A370CEAB03FC2C358088527D3FB *SermonShorts-Rust-0.4.0-beta.2-mac-intel.zip\n";
    assert_eq!(sum_for(t, "SermonShorts-Rust-0.4.0-beta.2-win-x64.zip").as_deref(), Some("5d22a8efda0b1c694d7a8503f317df121dcaaba88118ef125bb397a3882bbc33"));
    assert_eq!(sum_for(t, "SermonShorts-Rust-0.4.0-beta.2-mac-intel.zip").as_deref(), Some("f987d1df350dd8af29187e4a85e9eece456a9a370ceab03fc2c358088527d3fb"));
    assert_eq!(sum_for(t, "없는.zip"), None);
}