//! 유튜브 가져오기 계산이 Electron 과 같은지 (tests/gen_youtube.js)
use base64::Engine;
use serde_json::Value;
use sermon_shorts::{stt, youtube as y};

fn f() -> Value { serde_json::from_str(&std::fs::read_to_string("tests/fixtures/youtube_cases.json").unwrap()).unwrap() }
fn close(a: f64, b: f64) -> bool { (a - b).abs() < 1e-9 }

#[test]
fn urls_times() {
    let f = f();
    for c in f["urls"].as_array().unwrap() {
        let u = c["u"].as_str().unwrap();
        let r = y::parse_youtube_url(u);
        match &c["r"] {
            Value::Null => assert!(r.is_none(), "{u} → {r:?}"),
            j => { let (id, t) = r.unwrap_or_else(|| panic!("{u} 못 읽음")); assert_eq!(id, j["id"].as_str().unwrap(), "{u}"); assert_eq!(t, j["t"].as_f64(), "{u} 시각"); }
        }
    }
    for c in f["times"].as_array().unwrap() { assert_eq!(y::parse_timecode(c["t"].as_str().unwrap()), c["r"].as_f64(), "{}", c["t"]); }
    for c in f["ranges"].as_array().unwrap() {
        let r = y::parse_range(c["t"].as_str().unwrap());
        match &c["r"] { Value::Null => assert!(r.is_none()), j => { let (a, b) = r.unwrap(); assert!(close(a, j["start"].as_f64().unwrap()) && close(b, j["end"].as_f64().unwrap())); } }
    }
    for c in f["errs"].as_array().unwrap() { assert_eq!(y::is_stale_error(c["t"].as_str().unwrap()), c["r"].as_bool().unwrap()); }
}

#[test]
fn formats_sidx() {
    let f = f();
    let fmts: Vec<Value> = f["formats"].as_array().unwrap().clone();
    let (v, a, p) = y::pick_formats(&fmts);
    let id = |x: &Option<Value>| x.as_ref().and_then(|v| v["format_id"].as_str().map(String::from));
    assert_eq!(id(&v), f["picked"]["video"].as_str().map(String::from));
    assert_eq!(id(&a), f["picked"]["audio"].as_str().map(String::from));
    assert_eq!(id(&p), f["picked"]["preview"].as_str().map(String::from));
    if let Some(h) = f["head"].as_str() {
        let head = base64::engine::general_purpose::STANDARD.decode(h).unwrap();
        let (init_end, ts, refs) = y::parse_sidx(&head).unwrap();
        let js = &f["sidx"];
        assert_eq!(init_end as i64, js["initEnd"].as_i64().unwrap());
        assert_eq!(ts as u64, js["timescale"].as_u64().unwrap());
        let jr = js["refs"].as_array().unwrap();
        assert_eq!(refs.len(), jr.len());
        for (r, j) in refs.iter().zip(jr) { assert!(close(r.start, j["start"].as_f64().unwrap()) && close(r.end, j["end"].as_f64().unwrap()) && r.a == j["a"].as_u64().unwrap() && r.b == j["b"].as_u64().unwrap()); }
        assert_eq!(y::select_refs(&refs, 3.0, 9.0).len(), f["sel"].as_array().unwrap().len());
    }
}

#[test]
fn stt_cache_path() {
    let f = f();
    for c in f["cache"].as_array().unwrap() {
        let p = std::path::Path::new(c["p"].as_str().unwrap());
        let got = stt::cache_path(p, c["s"].as_f64(), c["e"].as_f64());
        let s = got.to_string_lossy();
        assert!(s.ends_with(&format!("{}\\{}", c["hash"].as_str().unwrap(), c["file"].as_str().unwrap())) || s.ends_with(&format!("{}/{}", c["hash"].as_str().unwrap(), c["file"].as_str().unwrap())), "{s} vs {c}");
    }
}
