//! AI 쇼츠 추천·용어 교정의 요청 글이 Electron(src/main/ai.js)과 같은지. 기대값: node tests/gen_ai.js
use serde_json::{json, Value};
use sermon_shorts::ai::*;

fn cases() -> Value { serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/ai_cases.json")).unwrap()).unwrap() }
fn lines(c: &Value) -> Vec<(f64, String)> { c["lines"].as_array().unwrap().iter().map(|l| (l[0].as_f64().unwrap(), l[1].as_str().unwrap().to_string())).collect() }

#[test]
fn compact() {
    let c = cases();
    let l = lines(&c);
    for x in c["compact"].as_array().unwrap() { assert_eq!(compact_transcript(&l, x[0].as_f64().unwrap()), x[1].as_str().unwrap()); }
}

#[test]
fn analyze_and_correct() {
    let c = cases();
    let l = lines(&c);
    for x in c["analyze"].as_array().unwrap() {
        let o = &x["opts"];
        let s = |k: &str, d: &str| o[k].as_str().unwrap_or(d).to_string();
        let opts = RecOpts { video_title: s("videoTitle", ""), description: s("description", ""), model: String::new(), church: s("churchName", ""),
            count: o["count"].as_i64().unwrap_or(4), min_sec: o["minSec"].as_i64().unwrap_or(60), max_sec: o["maxSec"].as_i64().unwrap_or(120), intensity: o["intensity"].as_i64().unwrap_or(3),
            types: o["types"].as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect()).unwrap_or_default(), audience: s("audience", "all"), extra: s("extra", "") };
        assert_eq!(build_system(&opts.church, x["terms"].as_str().unwrap()), x["system"].as_str().unwrap(), "system {o}");
        assert_eq!(analyze_prompt(&l, &opts), x["prompt"].as_str().unwrap(), "prompt {o}");
        assert_eq!(schema(), x["schema"]);
        assert_eq!(x["model"], json!(DEFAULT_MODEL));
    }
    let k = &c["correct"];
    let words: Vec<(i64, String)> = k["words"].as_array().unwrap().iter().map(|w| (w[0].as_i64().unwrap(), w[1].as_str().unwrap().to_string())).collect();
    assert_eq!(correct_prompt(&words, k["title"].as_str().unwrap(), k["scripture"].as_str().unwrap()), k["prompt"].as_str().unwrap());
    assert_eq!(CORRECT_SYSTEM, k["system"].as_str().unwrap());
}

#[test]
fn match_sentences() {
    // 첫 문장·끝 문장으로 경계를 찾는다 (시각이 몇 초 어긋나도)
    let words: Vec<(String, f64, f64)> = "그래서 우리는 오늘 기도를 배웁니다. 기도는 하나님과의 대화입니다. 그러므로 쉬지 말고 기도하십시오. 아멘."
        .split(' ').enumerate().map(|(i, w)| (w.to_string(), 100.0 + i as f64, 100.8 + i as f64)).collect();
    let r = match_candidate(&words, 103.0, 109.0, "기도는 하나님과의 대화입니다", "쉬지 말고 기도하십시오.");
    assert_eq!(r, Some((5, 11)));
    // 문장이 안 맞으면 시각으로
    let r2 = match_candidate(&words, 102.0, 105.0, "전혀 없는 말", "없는 끝");
    assert_eq!(r2, Some((1, 5)));
}