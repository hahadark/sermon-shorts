//! 설교 전달 점검·원고 파일 읽기가 Electron(src/shared/delivery.js · main/hwp.js)과 같은 결과를 내는지. 기대값: node tests/gen_delivery.js
use serde_json::Value;
use sermon_shorts::{delivery, materials_file as mf};
use base64::Engine;

fn load(n: &str) -> Value { serde_json::from_str(&std::fs::read_to_string(format!("{}/tests/fixtures/{n}", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap() }
fn close(a: f64, b: &Value) -> bool { (a - b.as_f64().unwrap()).abs() < 1e-6 }
fn spots(a: &[delivery::Spot], b: &Value, secs: bool) {
    let b = b.as_array().unwrap();
    assert_eq!(a.len(), b.len());
    for (x, y) in a.iter().zip(b) { assert!(close(x.start, &y["start"]) && close(x.end, &y["end"]), "{} {}", x.start, y); assert_eq!(x.text, y["text"].as_str().unwrap()); if secs { assert!(close(x.seconds, &y["seconds"])); } }
}

#[test]
fn delivery_matches() {
    let c = load("delivery_cases.json");
    for case in c["delivery"].as_array().unwrap() {
        let words: Vec<(String, f64, f64)> = case["words"].as_array().unwrap().iter().map(|w| (w["text"].as_str().unwrap().to_string(), w["start"].as_f64().unwrap(), w["end"].as_f64().unwrap())).collect();
        let r = delivery::analyze(&words);
        let e = &case["report"];
        assert_eq!(delivery::to_text(r.as_ref(), "시험 라벨"), case["text"].as_str().unwrap(), "text n={}", words.len());
        let Some(r) = r else { assert!(e.is_null()); continue };
        assert!(close(r.start, &e["start"]) && close(r.end, &e["end"]) && close(r.duration, &e["duration"]) && close(r.coverage, &e["coverage"]));
        assert_eq!((r.total_chars as i64, r.cpm, r.word_count as i64), (e["totalChars"].as_i64().unwrap(), e["cpm"].as_i64().unwrap(), e["wordCount"].as_i64().unwrap()));
        let bins = e["bins"].as_array().unwrap();
        assert_eq!(r.bins.len(), bins.len());
        for (x, y) in r.bins.iter().zip(bins) { assert!(close(x.start, &y["start"]) && close(x.end, &y["end"]) && close(x.chars, &y["chars"]), "bin {} {}", x.chars, y); assert_eq!(x.cpm, y["cpm"].as_i64().unwrap()); }
        spots(&r.pauses, &e["pauses"], true);
        spots(&r.fillers, &e["fillers"], false);
        spots(&r.repeats, &e["repeats"], false);
    }
    for t in c["times"].as_array().unwrap() { assert_eq!(delivery::time(t[0].as_f64().unwrap()), t[1].as_str().unwrap()); }
}

#[test]
fn files_match() {
    let c = load("files_cases.json");
    let b64 = |v: &Value| base64::engine::general_purpose::STANDARD.decode(v.as_str().unwrap()).unwrap();
    for h in c["hwp"].as_array().unwrap() {
        let r = mf::hwp_text(&b64(&h["b64"]));
        match (&r, h["out"]["ok"].as_str(), h["out"]["err"].as_str()) {
            (Ok(t), Some(e), _) => assert_eq!(t, e),
            (Err(t), _, Some(e)) => assert_eq!(t, e),
            _ => panic!("hwp {:?} vs {}", r, h["out"]),
        }
    }
    for x in c["xml"].as_array().unwrap() { assert_eq!(mf::xml_text(x["x"].as_str().unwrap()), x["out"].as_str().unwrap()); }
    for p in c["para"].as_array().unwrap() { assert_eq!(mf::para_text(&b64(&p["b64"])), p["out"].as_str().unwrap()); }
    assert_eq!(mf::srt_text("1\n00:00:01,000 --> 00:00:02,000\n안녕\n\n2\n00:00:03,000 --> 00:00:04,000\n하세요\n"), "\n안녕\n하세요\n");
}
