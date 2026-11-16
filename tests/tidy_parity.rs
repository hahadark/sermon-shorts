//! 자동 정리 계산이 Electron(disfluency.js·gaps.js·silence.js)과 같은지 (tests/gen_tidy_fixture.js 로 만든 자료)
use serde_json::Value;
use sermon_shorts::{edl, model::{EditSettings, Overrides, Word}, tidy};

fn fixture() -> Value { serde_json::from_str(&std::fs::read_to_string("tests/fixtures/tidy_cases.json").unwrap()).unwrap() }
fn close(a: f64, b: f64) -> bool { (a - b).abs() < 1e-9 }

fn same_plan(name: &str, p: &tidy::GapPlan, j: &Value) {
    let cb: Vec<usize> = j["cutBefore"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as usize).collect();
    assert_eq!(p.cut_before, cb, "{name} cutBefore");
    assert_eq!(p.cuts as u64, j["cuts"].as_u64().unwrap(), "{name} cuts");
    assert!(close(p.saved_sec, j["savedSec"].as_f64().unwrap()), "{name} savedSec {} vs {}", p.saved_sec, j["savedSec"]);
    let ov = j["overrides"].as_object().unwrap();
    assert_eq!(p.overrides.len(), ov.len(), "{name} overrides 수");
    for (k, v) in ov { assert!(p.overrides.get(k).is_some_and(|x| close(*x, v.as_f64().unwrap())), "{name} override {k}"); }
}

#[test]
fn fillers_match() {
    let f = fixture();
    for c in f["fillers"].as_array().unwrap() {
        let t = c["text"].as_str().unwrap();
        assert_eq!(tidy::is_filler(t), c["filler"].as_bool().unwrap(), "isFiller({t})");
        assert_eq!(tidy::core(t), c["core"].as_str().unwrap(), "core({t})");
    }
}

#[test]
fn plans_match() {
    let f = fixture();
    let settings = EditSettings { pad_before: 0.1, pad_after: 0.15, fade_ms: 10.0, max_line_chars: Some(14.0), split_long_words: true, semantic_breaks: true };
    for c in f["cases"].as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let words: Vec<Word> = serde_json::from_value(c["words"].clone()).unwrap();
        let segs = edl::build_segments(&words, &settings, &Overrides::default(), Some(145.0), None);
        let js_segs = c["segs"].as_array().unwrap();
        assert_eq!(segs.len(), js_segs.len(), "{name} 구간 수");
        for (a, b) in segs.iter().zip(js_segs) { assert!(close(a.start, b["start"].as_f64().unwrap()) && close(a.end, b["end"].as_f64().unwrap()), "{name} 구간"); }
        let sil: Vec<tidy::Silence> = c["silences"].as_array().unwrap().iter().map(|s| tidy::Silence { start: s["start"].as_f64().unwrap(), end: s["end"].as_f64().unwrap() }).collect();
        let ps = tidy::pauses(&words, &segs, 0.5);
        let jp = c["pauses"].as_array().unwrap();
        assert_eq!(ps.len(), jp.len(), "{name} 쉼 수");
        for (a, b) in ps.iter().zip(jp) { assert!(a.i as u64 == b["i"].as_u64().unwrap() && a.prev as u64 == b["prev"].as_u64().unwrap() && close(a.gap, b["gap"].as_f64().unwrap()), "{name} 쉼"); }
        same_plan(&format!("{name} timing"), &tidy::gap_cuts_by_timing(&words, &segs, 0.3, 0.08, 0.12), &c["timing"]);
        same_plan(&format!("{name} plan1"), &tidy::plan_gap_cuts(&words, &segs, &sil, 0.08, 0.12, 0.15), &c["plan1"]);
        same_plan(&format!("{name} plan2"), &tidy::plan_gap_cuts(&words, &segs, &sil, 0.05, 0.07, 0.08), &c["plan2"]);
    }
}

#[test]
fn silence_log_match() {
    let f = fixture();
    let log = f["log"].as_str().unwrap();
    let cmp = |got: Vec<tidy::Silence>, want: &Value| {
        let w = want.as_array().unwrap();
        assert_eq!(got.len(), w.len());
        for (a, b) in got.iter().zip(w) { assert!(close(a.start, b["start"].as_f64().unwrap()) && close(a.end, b["end"].as_f64().unwrap())); }
    };
    cmp(tidy::parse_silences(log, 3.0, Some(10.0)), &f["parsed"]);
    cmp(tidy::parse_silences(log, 0.0, None), &f["parsedNoDur"]);
    assert!(close(tidy::parse_mean_volume(log).unwrap(), f["mean"].as_f64().unwrap()));
    for x in f["floors"].as_array().unwrap() { assert_eq!(tidy::noise_floor_for(x["mean"].as_f64()), x["floor"].as_f64().unwrap(), "floor {:?}", x["mean"]); }
}
