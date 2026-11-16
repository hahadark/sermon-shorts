//! 원본 다시 받기 순수 함수가 Electron(source-fetch.js · chat-plan.js · clips.js)과 같은지
use serde_json::{json, Value};
use sermon_shorts::{chat_plan, source_fetch as sf, youtube as yt};

fn near(a: f64, b: f64, what: &str) { assert!((a - b).abs() < 1e-9, "{what}: rust {a} js {b}"); }
fn same_json(a: &Value, b: &Value, what: &str) {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => near(x.as_f64().unwrap(), y.as_f64().unwrap(), what),
        (Value::Array(x), Value::Array(y)) => { assert_eq!(x.len(), y.len(), "{what}: 길이"); for (i, (p, q)) in x.iter().zip(y).enumerate() { same_json(p, q, &format!("{what}[{i}]")); } }
        (Value::Object(x), Value::Object(y)) => {
            let kx: Vec<_> = x.keys().collect(); let ky: Vec<_> = y.keys().collect();
            let mut kx2 = kx.clone(); kx2.sort(); let mut ky2 = ky.clone(); ky2.sort();
            assert_eq!(kx2, ky2, "{what}: 키");
            for k in kx { same_json(&x[k], &y[k], &format!("{what}.{k}")); }
        }
        _ => assert_eq!(a, b, "{what}"),
    }
}
fn map_of(v: &Value) -> Vec<sf::Piece> { sf::clean_map(v).unwrap_or_default() }

fn check_subs(fx: &Value, tag: &str) {
    let (words, lines) = chat_plan::words_from_json3(&fx["json3"]);
    let js = fx["subWords"].as_array().unwrap();
    assert_eq!(words.len(), js.len(), "{tag} 단어 수");
    for (i, (w, j)) in words.iter().zip(js).enumerate() {
        assert_eq!(w.text, j["text"].as_str().unwrap(), "{tag} 단어 {i}");
        near(w.start, j["start"].as_f64().unwrap(), &format!("{tag} start {i}"));
        near(w.end, j["end"].as_f64().unwrap(), &format!("{tag} end {i}"));
    }
    let jl = fx["subLines"].as_array().unwrap();
    assert_eq!(lines.len(), jl.len(), "{tag} 줄 수");
    for (l, j) in lines.iter().zip(jl) { near(l.start, j["start"].as_f64().unwrap(), "줄 시작"); assert_eq!((l.from as u64, l.to as u64), (j["from"].as_u64().unwrap(), j["to"].as_u64().unwrap())); }
    let subs: Vec<chat_plan::SubWord> = js.iter().map(|j| chat_plan::SubWord { text: j["text"].as_str().unwrap().into(), start: j["start"].as_f64().unwrap(), end: j["end"].as_f64().unwrap() }).collect();
    for (i, r) in fx["recover"].as_array().unwrap().iter().enumerate() {
        let got = sf::recover_clip_map(r["words"].as_array().unwrap(), &subs);
        match (&got, &r["map"]) {
            (None, Value::Null) => {}
            (Some(m), v) if v.is_array() => same_json(&sf::map_json(m), v, &format!("{tag} 되찾기 {i}")),
            _ => panic!("{tag} 되찾기 {i}: rust {:?} js {}", got, r["map"]),
        }
    }
    println!("{tag}: 자막 단어 {} 줄 {} 되찾기 {}건 같음", words.len(), lines.len(), fx["recover"].as_array().unwrap().len());
}

#[test]
fn source_fetch_matches_electron() {
    let fx: Value = serde_json::from_str(&std::fs::read_to_string("tests/fixtures/source_fetch_cases.json").expect("node tests/gen_source_fetch.js 먼저")).unwrap();
    check_subs(&fx["synthetic"], "합성");
    let real = std::path::Path::new("target/sf_real.json");
    if real.exists() { check_subs(&serde_json::from_str(&std::fs::read_to_string(real).unwrap()).unwrap(), "실제"); }
    // plan · normalizeFetch
    for (i, c) in fx["plan"].as_array().unwrap().iter().enumerate() {
        same_json(&sf::plan(&c["source"]).to_json(), &c["plan"], &format!("plan {i}"));
        same_json(&sf::normalize_fetch(&c["source"]["fetch"]).unwrap_or(Value::Null), &c["fetch"], &format!("fetch {i}"));
    }
    // 지도 변환
    for (i, m) in fx["maps"].as_array().unwrap().iter().enumerate() {
        let map = map_of(&m["map"]);
        for p in m["f2s"].as_array().unwrap() { let t = p[0].as_f64().unwrap(); same_json(&json!(sf::file_to_src_by_map(&map, t)), &p[1], &format!("f2s {i} {t}")); }
        for p in m["s2f"].as_array().unwrap() { let t = p[0].as_f64().unwrap(); same_json(&json!(sf::src_to_file_by_map(&map, t)), &p[1], &format!("s2f {i} {t}")); }
    }
    // 단어 → 받을 구간
    let words = fx["remapData"]["words"].as_array().unwrap().clone();
    for (i, m) in fx["maps"].as_array().unwrap().iter().enumerate() {
        let map = map_of(&m["map"]);
        let got = sf::spans_from_words(&words, &|f| sf::file_to_src_by_map(&map, f));
        same_json(&sf::spans_json(&got), &fx["spans"][i], &format!("spans {i}"));
    }
    // 시각 옮기기
    for (i, r) in fx["remap"].as_array().unwrap().iter().enumerate() {
        let (oo, no, cut) = (r["oldOff"].as_f64().unwrap(), r["newOff"].as_f64().unwrap(), r["cut"].as_f64());
        let (out, moved, missing) = sf::remap_project(&fx["remapData"], &|f| Some(f + oo), &|s| match cut { Some(c) if s >= c => None, _ => Some(s - no) });
        same_json(&out, &r["result"]["data"], &format!("remap {i}"));
        assert_eq!((moved as u64, missing as u64), (r["result"]["moved"].as_u64().unwrap(), r["result"]["missing"].as_u64().unwrap()), "remap {i} 수");
    }
    // 구간 묶기
    let spans = sf::clean_spans(&fx["cluster"]["spans"]).unwrap();
    same_json(&sf::spans_json(&yt::cluster_ranges(&spans, 45.0, 2.0)), &fx["cluster"]["out"], "cluster");
    same_json(&sf::spans_json(&yt::cluster_ranges(&spans, 10.0, 0.5)), &fx["cluster"]["outGap"], "cluster gap");
}
