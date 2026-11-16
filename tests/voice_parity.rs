//! 목소리 크기 계산이 Electron(shared/voice.js)과 같은지
use serde_json::{json, Value};
use sermon_shorts::voice as v;

#[test]
fn voice_matches_electron() {
    let fx: Value = serde_json::from_str(&std::fs::read_to_string("tests/fixtures/voice_cases.json").expect("node tests/gen_voice.js 먼저")).unwrap();
    assert_eq!(v::comp_filter(), fx["comp"].as_str().unwrap());
    assert_eq!(v::limiter_filter(), fx["limiter"].as_str().unwrap());
    for (i, c) in fx["cases"].as_array().unwrap().iter().enumerate() {
        let raw = if c["raw"] == "__undef__" { Value::Null } else { c["raw"].clone() };
        let n = v::normalize(&raw);
        assert_eq!(n.to_json(), c["norm"], "normalize {i} {raw}");
        assert_eq!(v::is_on(&n), c["isOn"].as_bool().unwrap(), "isOn {i}");
        assert_eq!(v::gain_db(&n), c["gain"].as_f64(), "gain {i}");
        assert_eq!(v::ffmpeg_filter(&n, "[acat]", "[avox]"), c["filter"].as_str().unwrap(), "filter {i}");
        assert_eq!(v::analysis_filter(&n), c["analysis"].as_str().unwrap(), "analysis {i}");
        assert_eq!(v::describe(&n), c["describe"].as_str().unwrap(), "describe {i}");
        assert_eq!(v::measured_fits(&n, "k0"), c["fitsK0"].as_bool().unwrap(), "fits {i}");
        assert_eq!(v::measured_fits(&n, "k"), c["fitsK"].as_bool().unwrap(), "fits k {i}");
    }
    for (i, k) in fx["keys"].as_array().unwrap().iter().enumerate() {
        let segs: Vec<(f64, f64)> = k["segs"].as_array().unwrap().iter().map(|p| (p[0].as_f64().unwrap(), p[1].as_f64().unwrap())).collect();
        assert_eq!(v::seg_key(&segs), k["key"].as_str().unwrap(), "segKey {i}");
    }
    for (i, l) in fx["loud"].as_array().unwrap().iter().enumerate() {
        let got = v::parse_loudnorm(l["text"].as_str().unwrap()).map(|(a, b, c)| json!({ "i": a, "tp": b, "lra": c }));
        let want = &l["out"];
        match (&got, want) { (None, Value::Null) => {} (Some(g), w) => { for k in ["i", "tp", "lra"] { let (x, y) = (g[k].as_f64(), w[k].as_f64()); assert!(x == y || (x.is_none() && w[k].is_null()), "loud {i} {k}: {g} vs {w}"); } } _ => panic!("loud {i}: {got:?} vs {want}") }
    }
    println!("목소리 {}건 · 구간 열쇠 {}건 · loudnorm {}건 같음", fx["cases"].as_array().unwrap().len(), fx["keys"].as_array().unwrap().len(), fx["loud"].as_array().unwrap().len());
}