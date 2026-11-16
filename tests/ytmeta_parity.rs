//! 유튜브 제목·설명 규칙이 Electron youtube-upload.js buildMetadata 와 같은지
use sermon_shorts::ytupload::{build_metadata, Meta};
#[test]
fn ytmeta_match() {
    let f: serde_json::Value = serde_json::from_str(&std::fs::read_to_string("tests/fixtures/ytmeta_cases.json").unwrap()).unwrap();
    for c in f.as_array().unwrap() {
        let m = &c["meta"];
        let s = |k: &str| m[k].as_str().unwrap_or("").to_string();
        let meta = Meta { title: s("title"), verse: s("verse"), church: s("church"), speaker: s("speaker"), privacy: s("privacy"), credits: s("credits"), description: m["description"].as_str().map(String::from) };
        assert_eq!(build_metadata(&meta), c["out"], "{m}");
    }
}
