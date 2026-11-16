//! 배경음악 배치 계산·파형이 Electron(shared/bgm.js · bgm-peaks.js)과 같은지
use serde_json::{json, Value};
use sermon_shorts::bgm;

fn near(a: Option<f64>, b: &Value, what: &str) {
    match (a, b.as_f64()) { (None, None) => {} (Some(x), Some(y)) => assert!((x - y).abs() < 1e-9, "{what}: rust {x} js {y}"), _ => panic!("{what}: rust {a:?} js {b}") }
}
#[test]
fn bgm_matches_electron() {
    let fx: Value = serde_json::from_str(&std::fs::read_to_string("tests/fixtures/bgm_cases.json").expect("node tests/gen_bgm.js 먼저")).unwrap();
    let mut n = 0;
    for (i, c) in fx["cases"].as_array().unwrap().iter().enumerate() {
        let got = bgm::normalize(&c["raw"]);
        match (&got, &c["norm"]) {
            (None, Value::Null) => {}
            (Some(b), w) => { let g = b.to_json(); for k in ["id", "align"] { assert_eq!(g[k], w[k], "norm {i} {k}"); } for k in ["duration", "trackStart", "trackEnd", "fadeIn", "fadeOut", "volume"] { near(g[k].as_f64(), &w[k], &format!("norm {i} {k}")); } }
            _ => panic!("norm {i}: {got:?} vs {}", c["norm"]),
        }
        for p in c["plans"].as_array().unwrap() {
            let d = p["d"].as_f64().unwrap();
            let pl = bgm::plan(&c["raw"], d);
            match (&pl, &p["plan"]) { (None, Value::Null) => {} (Some(x), w) => { let g = x.to_json(); for k in ["from", "length", "delay", "fadeIn", "fadeOut", "volume"] { near(g[k].as_f64(), &w[k], &format!("plan {i} d{d} {k}")); } } _ => panic!("plan {i} d{d}: {pl:?} vs {}", p["plan"]) }
            for t in p["gain"].as_array().unwrap() { near(Some(bgm::gain_at(pl.as_ref(), t[0].as_f64().unwrap())), &t[1], &format!("gain {i} d{d} t{}", t[0])); }
            for t in p["tt"].as_array().unwrap() { near(bgm::track_time_at(pl.as_ref(), t[0].as_f64().unwrap()), &t[1], &format!("tt {i} d{d} t{}", t[0])); }
            if let Some(f) = p["filter"].as_str() { assert_eq!(bgm::ffmpeg_filter(pl.as_ref().unwrap(), 4, "[avox]"), f, "filter {i} d{d}"); }
            n += 1;
        }
    }
    for f in fx["fmts"].as_array().unwrap() { assert_eq!(bgm::fmt(f[0].as_f64().unwrap_or(f64::NAN)), f[1].as_str().unwrap(), "fmt {}", f[0]); }
    for p in fx["peaks"].as_array().unwrap() {
        let (d, v) = bgm::bundled_peaks(p["id"].as_str().unwrap(), p["n"].as_u64().unwrap() as usize).expect("파형");
        near(Some(d), &p["out"]["duration"], "peaks d");
        assert_eq!(json!(v.len()), json!(p["out"]["peaks"].as_array().unwrap().len()));
        for (k, (a, b)) in v.iter().zip(p["out"]["peaks"].as_array().unwrap()).enumerate() { near(Some(*a), b, &format!("peaks {} {} {k}", p["id"], p["n"])); }
    }
    println!("배경음악 배치 {n}건 · fmt {}건 · 파형 {}건 같음", fx["fmts"].as_array().unwrap().len(), fx["peaks"].as_array().unwrap().len());
}