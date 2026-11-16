//! 기존 JS 편집 계산(edl.js·linebreak.js)과 결과가 같은지 대조 (tests/fixtures/edl_cases.json 은 JS 로 만든 것)
use sermon_shorts::{edl, linebreak, model::{EditSettings, Overrides, Word}};
use serde_json::Value;

fn fx() -> Value { serde_json::from_str(include_str!("fixtures/edl_cases.json")).unwrap() }
fn f(v: &Value) -> f64 { v.as_f64().unwrap() }
fn close(a: f64, b: f64, what: &str) { assert!((a - b).abs() < 1e-9, "{what}: rust {a} / js {b}"); }

#[test]
fn segments_lines_srt_match_js() {
    let all = fx();
    for c in all["cases"].as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let words: Vec<Word> = serde_json::from_value(c["words"].clone()).unwrap();
        let s: EditSettings = serde_json::from_value(c["settings"].clone()).unwrap();
        let ov: Overrides = serde_json::from_value(c["overrides"].clone()).unwrap();
        let order: Option<Vec<i64>> = serde_json::from_value(c["order"].clone()).unwrap();
        let segs = edl::build_segments(&words, &s, &ov, Some(f(&c["duration"])), order.as_deref());
        let js = c["segs"].as_array().unwrap();
        assert_eq!(segs.len(), js.len(), "{name}: 구간 수");
        for (r, j) in segs.iter().zip(js) {
            close(r.start, f(&j["start"]), &format!("{name} 구간 시작"));
            close(r.end, f(&j["end"]), &format!("{name} 구간 끝"));
            assert_eq!(r.first_word_id, j["firstWordId"].as_i64().unwrap(), "{name}");
            assert_eq!(r.last_word_id, j["lastWordId"].as_i64().unwrap(), "{name}");
            assert_eq!(r.piece.map(|p| p as i64), j["piece"].as_i64(), "{name} 조각");
        }
        close(edl::segments_duration(&segs), f(&c["outDur"]), name);
        let lines = edl::build_lines(&words, &segs, &s);
        let jl = c["lines"].as_array().unwrap();
        assert_eq!(lines.len(), jl.len(), "{name}: 자막 줄 수");
        for (k, (r, j)) in lines.iter().zip(jl).enumerate() {
            assert_eq!(r.text, j["text"].as_str().unwrap(), "{name} {k}번 줄 글");
            let jw: Vec<i64> = j["words"].as_array().unwrap().iter().map(|x| x.as_i64().unwrap()).collect();
            assert_eq!(r.words, jw, "{name} {k}번 줄 단어");
            close(r.out_start, f(&j["outStart"]), &format!("{name} {k}번 줄 시작"));
            close(r.out_end, f(&j["outEnd"]), &format!("{name} {k}번 줄 끝"));
            assert_eq!(r.manual_merge, j["manualMerge"].as_bool().unwrap_or(false), "{name} {k}번 손합침");
            for (p, jp) in r.parts.iter().zip(j["parts"].as_array().unwrap()) {
                assert_eq!((p.id, p.from as i64, p.to as i64, p.text.as_str()), (jp["id"].as_i64().unwrap(), jp["from"].as_i64().unwrap(), jp["to"].as_i64().unwrap(), jp["text"].as_str().unwrap()), "{name} {k}번 조각");
            }
        }
        assert_eq!(edl::to_srt(&lines), c["srt"].as_str().unwrap(), "{name}: SRT");
        for p in c["probes"].as_array().unwrap() {
            let t = f(&p["t"]);
            match (edl::src_to_out(&segs, t), p["out"].as_f64()) { (Some(a), Some(b)) => close(a, b, name), (a, b) => assert_eq!(a.is_some(), b.is_some(), "{name} srcToOut {t}") }
            match (edl::out_to_src(&segs, t), p["back"].as_object()) { (Some((i, x)), Some(o)) => { assert_eq!(i as i64, o["segIndex"].as_i64().unwrap()); close(x, f(&o["t"]), name) }, (a, b) => assert_eq!(a.is_some(), b.is_some(), "{name} outToSrc {t}") }
        }
    }
}

#[test]
fn move_range_and_pieces_match_js() {
    let all = fx();
    let words: Vec<Word> = serde_json::from_value(all["cases"][0]["words"].clone()).unwrap();
    for o in all["orders"].as_array().unwrap() {
        let order: Option<Vec<i64>> = serde_json::from_value(o["order"].clone()).unwrap();
        let before = o["before"].as_u64().map(|b| b as usize);
        let r = edl::move_range(&words, order.as_deref(), o["from"].as_u64().unwrap() as usize, o["to"].as_u64().unwrap() as usize, before);
        let jr: Option<Vec<i64>> = serde_json::from_value(o["result"].clone()).unwrap();
        assert_eq!(r, jr, "moveRange {o}");
        let p: Vec<(usize, usize)> = edl::order_pieces(&words, r.as_deref()).iter().map(|p| (p.a, p.b)).collect();
        let jp: Vec<(usize, usize)> = o["pieces"].as_array().unwrap().iter().map(|x| (x["a"].as_u64().unwrap() as usize, x["b"].as_u64().unwrap() as usize)).collect();
        assert_eq!(p, jp);
    }
}

#[test]
fn break_cost_matches_js() {
    let all = fx();
    let mut n = 0;
    for c in all["costs"].as_array().unwrap() {
        let (a, b) = (c["a"].as_str().unwrap(), c["b"].as_str().unwrap());
        let r = linebreak::break_cost(a, b, Some(f(&c["g"])));
        assert!((r - f(&c["c"])).abs() < 1e-9, "breakCost({a:?}, {b:?}) rust {r} / js {}", c["c"]);
        assert_eq!(linebreak::is_sentence_end(a), c["se"].as_bool().unwrap(), "isSentenceEnd({a:?})");
        n += 1;
    }
    assert!(n >= 900);
}

#[test]
fn time_formats_match_js() {
    for t in fx()["times"].as_array().unwrap() {
        let x = f(&t["t"]);
        assert_eq!(edl::format_time(x, true), t["fmt"].as_str().unwrap(), "formatTime({x})");
        assert_eq!(edl::format_time(x, false), t["fmt0"].as_str().unwrap(), "formatTime({x}, false)");
        let line = edl::Line { text: "x".into(), words: vec![], parts: vec![], out_start: x.max(0.0), out_end: x.max(0.0) + 1.0, manual_merge: false };
        assert_eq!(edl::to_srt(&[line]), t["srt"].as_str().unwrap(), "srt({x})");
    }
}
