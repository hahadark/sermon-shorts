//! 설정 정리·저장 규칙이 Electron(settings.js)과 같은지
use serde_json::Value;
use sermon_shorts::settings;

fn same(a: &Value, b: &Value, what: &str) {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => assert!((x.as_f64().unwrap() - y.as_f64().unwrap()).abs() < 1e-12, "{what}: rust {x} js {y}"),
        (Value::Array(x), Value::Array(y)) => { assert_eq!(x.len(), y.len(), "{what} 길이"); for (i, (p, q)) in x.iter().zip(y).enumerate() { same(p, q, &format!("{what}[{i}]")); } }
        (Value::Object(x), Value::Object(y)) => {
            let mut kx: Vec<_> = x.keys().collect(); kx.sort(); let mut ky: Vec<_> = y.keys().collect(); ky.sort();
            assert_eq!(kx, ky, "{what} 키");
            for k in x.keys() { same(&x[k], &y[k], &format!("{what}.{k}")); }
        }
        _ => assert_eq!(a, b, "{what}"),
    }
}

#[test]
fn settings_match_electron() {
    let fx: Value = serde_json::from_str(&std::fs::read_to_string("tests/fixtures/settings_cases.json").expect("node tests/gen_settings.js 먼저")).unwrap();
    let dir = std::env::temp_dir().join(format!("ss-settings-rs-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    #[allow(unused_unsafe)]
    unsafe { std::env::set_var("SS_USER_DATA_DIR", &dir); }
    for (i, c) in fx["load"].as_array().unwrap().iter().enumerate() { same(&settings::normalize(&c["raw"]), &c["out"], &format!("읽기 {i}")); }
    for (i, c) in fx["save"].as_array().unwrap().iter().enumerate() {
        std::fs::write(dir.join("settings.json"), c["raw"].to_string()).unwrap();
        settings::save(&c["patch"]).unwrap();
        let got: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("settings.json")).unwrap()).unwrap();
        same(&got, &c["out"], &format!("저장 {i}"));
    }
    let _ = std::fs::remove_dir_all(&dir);
    println!("읽기 {}건 · 저장 {}건 같음", fx["load"].as_array().unwrap().len(), fx["save"].as_array().unwrap().len());
}