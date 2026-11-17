//! 교인 자료 순수 함수가 Electron(src/shared/materials.js)과 같은 결과를 내는지. 기대값: node tests/gen_materials.js
use serde_json::{json, Value};
use sermon_shorts::materials::*;

fn cases() -> Value { serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/materials_cases.json")).unwrap()).unwrap() }
fn s(v: &Value) -> &str { v.as_str().unwrap_or("") }
/// 숫자 5 와 5.0 을 같게 본다
fn eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| eq(p, q)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| eq(v, w))),
        _ => a == b,
    }
}

#[test]
fn types_and_options() {
    let c = cases();
    let ids: Vec<&str> = TYPES.iter().map(|t| t.id).collect();
    for (t, e) in TYPES.iter().zip(c["types"].as_array().unwrap()) { assert_eq!((t.id, t.label, t.kind), (s(&e[0]), s(&e[1]), s(&e[2]))); }
    for x in c["options"].as_array().unwrap() {
        assert!(eq(&norm_options(&x["o"]), &x["norm"]), "norm {}", x["o"]);
        for (t, r) in ids.iter().zip(x["req"].as_array().unwrap()) { assert_eq!(build_request(t, &x["o"]).unwrap(), s(r), "req {t} {}", x["o"]); }
    }
    for x in c["system"].as_array().unwrap() { assert_eq!(build_system(&x["ctx"]), s(&x["out"]), "system {}", x["ctx"]); }
}

#[test]
fn parse_normalize_text() {
    let c = cases();
    for x in c["parse"].as_array().unwrap() {
        let r = parse(s(&x["type"]), s(&x["text"]));
        match (&r, x["out"].get("ok")) {
            (Ok(v), Some(e)) => assert!(eq(v, e), "parse {} {}\n rust={v}\n js={e}", x["type"], x["text"]),
            (Err(m), None) => assert_eq!(m, s(&x["out"]["err"])),
            _ => panic!("다름 {} {}: rust={r:?} js={}", x["type"], x["text"], x["out"]),
        }
    }
    for x in c["normalize"].as_array().unwrap() { let v = normalize(s(&x["type"]), &x["o"]); assert!(eq(&v, &x["out"]), "normalize {} {}\n rust={v}\n js={}", x["type"], x["o"], x["out"]); }
    for x in c["text"].as_array().unwrap() { assert_eq!(to_text(s(&x["type"]), &x["d"], &x["meta"]), s(&x["out"]), "text {} {}", x["type"], x["meta"]); }
    for x in c["tags"].as_array().unwrap() { assert_eq!(json!(tags(&x[0])), x[1], "tags {}", x[0]); }
}

#[test]
fn sermon_iso_home_check() {
    let c = cases();
    let mut words = vec![json!({ "text": "안녕하세요.", "start": 0, "end": 1 }), json!({ "text": "오늘", "start": 3, "end": 3.4 }), Value::Null, json!({ "text": "" })];
    for i in 0..30 { words.push(json!({ "text": format!("말{i}{}", if i == 27 { "." } else { "" }), "start": 4.0 + i as f64 * 0.3, "end": 4.2 + i as f64 * 0.3 })); }
    words.push(json!({ "text": "끝", "start": 20, "end": 20.5 }));
    assert_eq!(sermon_text(&words), s(&c["sermonText"]));
    for x in c["iso"].as_array().unwrap() { assert_eq!(iso_date(s(&x[0])), s(&x[1])); }
    for x in c["home"].as_array().unwrap() { let (n, t) = to_homepage(&x["d"], &x["meta"]); assert_eq!(n, s(&x["out"]["name"])); assert_eq!(t, s(&x["out"]["text"]), "home {}", x["meta"]); }
    for x in c["check"].as_array().unwrap() { assert_eq!(build_check_request(s(&x["type"]), &x["d"]), s(&x["req"]), "check {}", x["type"]); }
    let pc = &c["parseCheck"];
    let sum = c["home"][0]["d"].clone();
    let mut r = parse_check(s(&pc["text"]), Some(&sum), "summary").unwrap();
    r.as_object_mut().unwrap().remove("at");
    assert!(eq(&r, &pc["out"]), "parseCheck rust={r} js={}", pc["out"]);
}
