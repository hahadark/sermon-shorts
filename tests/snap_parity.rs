//! 소리 맞추기(edl.js snap)가 Electron 과 같은지
#[test]
fn snap_match() {
    let f: serde_json::Value = serde_json::from_str(&std::fs::read_to_string("tests/fixtures/snap_cases.json").unwrap()).unwrap();
    let rate = f["rate"].as_f64().unwrap();
    let pcm: Vec<f32> = f["pcm"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect();
    for c in f["cases"].as_array().unwrap() {
        let got = sermon_shorts::edl::snap(&pcm, rate, c["t"].as_f64().unwrap(), c["mode"].as_str().unwrap(), c["w"].as_f64().unwrap());
        assert!((got - c["out"].as_f64().unwrap()).abs() < 1e-9, "{c} → {got}");
    }
}
