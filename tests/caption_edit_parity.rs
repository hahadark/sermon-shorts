//! 출력 자막 고치기가 JS(caption-edit.js apply)와 같은 결과인지
use sermon_shorts::{caption_edit, edl, model::{EditSettings, Word}};
use serde_json::Value;
#[test]
fn caption_apply_matches_js() {
    let fx: Value = serde_json::from_str(include_str!("fixtures/caption_edit.json")).unwrap();
    let raw: Value = serde_json::from_str(include_str!("../../sermon-shorts-app/cache/theme_check/words_4955.json")).unwrap();
    let mut words: Vec<Word> = serde_json::from_value(if raw.is_array() { raw } else { raw["words"].clone() }).unwrap();
    for (i, w) in words.iter_mut().enumerate() { w.id = i as i64; }
    let s = EditSettings { pad_before: 0.1, pad_after: 0.15, fade_ms: 10.0, max_line_chars: Some(14.0), split_long_words: true, semantic_breaks: true };
    let lines = edl::build_lines(&words, &edl::build_segments(&words, &s, &Default::default(), Some(150.0), None), &s);
    let mut n = 0;
    for e in fx["edits"].as_array().unwrap() {
        let line = &lines[e["line"].as_u64().unwrap() as usize];
        let text = e["text"].as_str().unwrap();
        let out = caption_edit::apply(&words, line, text);
        let changed: Vec<(i64, String, Option<String>)> = out.iter().zip(&words).filter(|(o, w)| o.text != w.text || o.extra.contains_key("_oldText")).map(|(o, _)| (o.id, o.text.clone(), o.extra.get("_oldText").and_then(|x| x.as_str()).map(str::to_string))).collect();
        let js: Vec<(i64, String, Option<String>)> = e["words"].as_array().unwrap().iter().map(|w| (w["id"].as_i64().unwrap(), w["text"].as_str().unwrap().to_string(), w["old"].as_str().map(str::to_string))).collect();
        assert_eq!(changed, js, "{}번 줄을 {text:?} 로", e["line"]);
        assert!(out.iter().all(|o| o.stt_text.is_some()));
        n += 1;
    }
    assert!(n >= 150);
}
