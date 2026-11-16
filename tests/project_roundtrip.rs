//! Electron 판이 저장한 프로젝트를 읽고 다시 쓰면 같은 내용인지
use sermon_shorts::{edl, project::Project};
use serde_json::Value;

fn roundtrip(name: &str) {
    let path = format!("tests/fixtures/{name}");
    if !std::path::Path::new(&path).exists() { return; }
    let orig: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let p = Project::load(path.as_ref()).unwrap();
    assert!(p.words.len() > 50);
    let back = p.to_json();
    // 다시 읽어도 같은 편집 (구간·자막 줄)
    let p2 = Project::from_json(back.clone()).unwrap();
    let a = edl::build_segments(&p.words, &p.settings, &p.overrides, Some(1e9), p.order.as_deref());
    let b = edl::build_segments(&p2.words, &p2.settings, &p2.overrides, Some(1e9), p2.order.as_deref());
    assert_eq!(a, b, "{name}: 구간");
    assert_eq!(edl::build_lines(&p.words, &a, &p.settings), edl::build_lines(&p2.words, &b, &p2.settings), "{name}: 자막 줄");
    // 이 판이 아직 다루지 않는 항목은 그대로
    for k in ["activeTheme", "meta", "crop", "bgm", "voice", "materials", "uploads", "caret"] { assert_eq!(orig.get(k), back.get(k), "{name}: {k} 보존"); }
    assert_eq!(orig["source"], back["source"], "{name}: source 보존");
    // 단어 하나하나 (지움·시각·글·STT 원문)
    for (o, n) in orig["words"].as_array().unwrap().iter().zip(back["words"].as_array().unwrap()) {
        for k in ["text", "start", "end", "sttText", "br", "captionSplits", "captionMerges"] { assert_eq!(o.get(k).filter(|v| !v.is_null() && *v != &Value::Bool(false)), n.get(k).filter(|v| !v.is_null() && *v != &Value::Bool(false)), "{name}: 단어 {k}"); }
        assert_eq!(o["del"].as_bool().unwrap_or(false), n["del"].as_bool().unwrap_or(false));
    }
    assert_eq!(orig["order"], back["order"], "{name}: 출력 순서");
}
#[test] fn electron_project_roundtrip() { roundtrip("electron_project.sshorts"); }
#[test] fn electron_reordered_project_roundtrip() { roundtrip("electron_order.sshorts"); }
