//! 사용자 설정 (기존 src/main/settings.js): userData/settings.json. Electron 판과 같은 파일·같은 정리 규칙.
//! API 키는 암호화해 저장하고 화면에는 끝 네 글자만 보인다.
use crate::{secret, theme};
use anyhow::Result;
use serde_json::{json, Map, Value};

pub const DEFAULT_CHURCH: &str = "우리 교회";
pub const DEFAULT_LOGO: &str = "assets/images/logo-default.png";

pub fn defaults() -> Value {
    json!({
        "activeThemeId": "",
        "template": {
            "titleY": 205, "verseY": 280, "videoY": 353, "videoH": 958, "subtitleY": 1390, "footerY": 1620,
            "fontTitleVerse": "Yeon Sung", "fontSubtitleFooter": "Noto Sans KR", "colorTitleVerse": "#39FF5A", "colorSubtitle": "#ffffff",
            "fadeMs": 10, "churchName": DEFAULT_CHURCH, "logoPath": DEFAULT_LOGO, "speakers": [], "aiModel": "gemini-3.5-flash"
        },
        "speakers": [],
        "lastExportDir": "", "sysCheckSeen": false, "churchTerms": "",
        "geminiApiKeyEnc": "", "openrouterApiKeyEnc": "", "openrouterModel": "",
        "ytClientId": "", "ytClientSecretEnc": "", "ytRefreshEnc": "", "ytChannel": "", "ytPrivacy": "unlisted", "ytAutoUpload": false, "ytUploadMode": "",
        "recentYoutubeMax": 5, "recentYoutube": [], "sourceMissing": "auto", "previewProxy": true, "autoUpdate": true,
        "autosave": { "enabled": true, "everyMin": 2, "maxVersions": 30, "keepDays": 60, "maxVideos": 40 },
        "editDefaults": { "maxLineChars": 14, "semanticBreaks": true, "splitLongWords": true, "padBefore": 0.1, "padAfter": 0.15, "fadeMs": 10, "autoTidy": true }
    })
}

/// JS Number(v) (숫자로 못 바꾸면 NaN)
fn js_number(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::Null => 0.0,
        Value::Bool(b) => if *b { 1.0 } else { 0.0 },
        Value::String(s) => { let t = s.trim(); if t.is_empty() { 0.0 } else { t.parse().unwrap_or(f64::NAN) } }
        Value::Array(a) if a.is_empty() => 0.0,
        Value::Array(a) if a.len() == 1 => js_number(&a[0]),
        _ => f64::NAN,
    }
}
/// num(v, d, lo, hi): 숫자가 아니면 기본값, 범위 밖이면 끝 값 (undefined 는 NaN)
fn num(v: Option<&Value>, d: f64, lo: f64, hi: f64) -> f64 { let n = v.map(js_number).unwrap_or(f64::NAN); if n.is_finite() { n.max(lo).min(hi) } else { d } }
/// JS Math.round (0.5 는 위로)
fn js_round(x: f64) -> f64 { (x + 0.5).floor() }
fn jnum(x: f64) -> Value { if x.fract() == 0.0 && x.abs() < 9e15 { json!(x as i64) } else { json!(x) } }
fn truthy(v: Option<&Value>) -> bool { match v { None | Some(Value::Null) => false, Some(Value::Bool(b)) => *b, Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0), Some(Value::String(s)) => !s.is_empty(), _ => true } }
fn js_string(v: &Value) -> String { match v { Value::String(s) => s.clone(), Value::Null => "null".into(), v => v.to_string() } }

/// 설정 창 값 다듬기 (범위 밖·잘못된 값은 기본값으로) — normalizeExtras
fn normalize_extras(out: &mut Map<String, Value>, d: &Value) {
    let rmax = js_round(num(out.get("recentYoutubeMax"), d["recentYoutubeMax"].as_f64().unwrap(), 0.0, 50.0));
    out.insert("recentYoutubeMax".into(), jnum(rmax));
    let mut seen: Vec<String> = vec![];
    let list: Vec<Value> = out.get("recentYoutube").and_then(|v| v.as_array()).cloned().unwrap_or_default().into_iter()
        .filter(|r| { let Some(u) = r.get("url").and_then(|u| u.as_str()) else { return false }; let t = u.trim(); if t.is_empty() || seen.iter().any(|s| s == t) { return false; } seen.push(t.to_string()); true })
        .map(|r| { let title = if truthy(r.get("title")) { js_string(&r["title"]) } else { String::new() }; json!({ "url": r["url"].as_str().unwrap().trim(), "title": title.chars().take(200).collect::<String>(), "at": jnum(num(r.get("at"), 0.0, 0.0, 1e15)) }) })
        .take(rmax as usize).collect();
    out.insert("recentYoutube".into(), json!(list));
    let sm = if out.get("sourceMissing").and_then(|v| v.as_str()) == Some("ask") { "ask" } else { "auto" };
    out.insert("sourceMissing".into(), json!(sm));
    for k in ["autoUpdate", "previewProxy"] { let on = out.get(k) != Some(&json!(false)); out.insert(k.into(), json!(on)); }
    let mut a = d["autosave"].as_object().unwrap().clone();
    if let Some(Value::Object(o)) = out.get("autosave") { for (k, v) in o { a.insert(k.clone(), v.clone()); } }
    out.insert("autosave".into(), json!({ "enabled": a.get("enabled") != Some(&json!(false)), "everyMin": jnum(num(a.get("everyMin"), 2.0, 1.0, 60.0)),
        "maxVersions": jnum(js_round(num(a.get("maxVersions"), 30.0, 1.0, 200.0))), "keepDays": jnum(js_round(num(a.get("keepDays"), 60.0, 1.0, 3650.0))), "maxVideos": jnum(js_round(num(a.get("maxVideos"), 40.0, 1.0, 500.0))) }));
    let mut e = d["editDefaults"].as_object().unwrap().clone();
    if let Some(Value::Object(o)) = out.get("editDefaults") { for (k, v) in o { e.insert(k.clone(), v.clone()); } }
    out.insert("editDefaults".into(), json!({ "maxLineChars": jnum(js_round(num(e.get("maxLineChars"), 14.0, 1.0, 200.0))), "semanticBreaks": e.get("semanticBreaks") != Some(&json!(false)), "splitLongWords": e.get("splitLongWords") != Some(&json!(false)),
        "padBefore": jnum(num(e.get("padBefore"), 0.1, 0.0, 5.0)), "padAfter": jnum(num(e.get("padAfter"), 0.15, 0.0, 5.0)), "fadeMs": jnum(js_round(num(e.get("fadeMs"), 10.0, 0.0, 1000.0))), "autoTidy": e.get("autoTidy") != Some(&json!(false)) }));
}

/// 읽은 설정 → 기본값을 채우고 다듬은 설정 (normalize)
pub fn normalize(s: &Value) -> Value {
    let d = defaults();
    let empty = Map::new();
    let so = s.as_object().unwrap_or(&empty);
    let mut out = d.as_object().unwrap().clone();
    for (k, v) in so { out.insert(k.clone(), v.clone()); }
    let mut tpl = d["template"].as_object().unwrap().clone();
    if let Some(Value::Object(t)) = so.get("template") { for (k, v) in t { tpl.insert(k.clone(), v.clone()); } }
    // 테마: 처음 설치면 기본 테마 (예전 템플릿에서 옮겨 온 'daegu-sarang' 은 Electron 판이 이미 만들어 둠)
    if !truthy(out.get("activeThemeId")) {
        let legacy = so.get("template").is_some_and(|t| truthy(t.get("titleY")) || truthy(t.get("fontTitleVerse")) || truthy(t.get("colorTitleVerse")));
        let id = if legacy && theme::user_data_dir().join("themes").join("daegu-sarang.json").exists() { "daegu-sarang" } else { "basic-blank" };
        out.insert("activeThemeId".into(), json!(id));
    }
    // 설교자: 최상위가 없으면 예전 template.speakers 에서
    if !so.get("speakers").is_some_and(|v| v.is_array()) {
        let sp = tpl.get("speakers").filter(|v| v.is_array()).cloned().unwrap_or_else(|| d["speakers"].clone());
        out.insert("speakers".into(), sp);
    }
    if !so.get("defaultSpeaker").is_some_and(|v| v.is_string()) {
        let first = out["speakers"].as_array().and_then(|a| a.first()).cloned();
        let ds = if truthy(tpl.get("defaultSpeaker")) { tpl["defaultSpeaker"].clone() } else if truthy(first.as_ref()) { first.unwrap() } else { json!("") };
        out.insert("defaultSpeaker".into(), ds);
    }
    let speakers: Vec<String> = out["speakers"].as_array().cloned().unwrap_or_default().iter().map(|x| js_string(x).trim().to_string()).filter(|x| !x.is_empty()).collect();
    out.insert("speakers".into(), json!(speakers));
    if truthy(out.get("defaultSpeaker")) && !out["defaultSpeaker"].as_str().is_some_and(|d| speakers.iter().any(|s| s == d)) {
        out.insert("defaultSpeaker".into(), json!(speakers.first().cloned().unwrap_or_default()));
    }
    tpl.insert("speakers".into(), json!(speakers));
    tpl.insert("defaultSpeaker".into(), out["defaultSpeaker"].clone());
    if !truthy(tpl.get("churchName")) { tpl.insert("churchName".into(), json!(DEFAULT_CHURCH)); }
    if !truthy(tpl.get("logoPath")) { tpl.insert("logoPath".into(), json!(DEFAULT_LOGO)); }
    out.insert("template".into(), Value::Object(tpl));
    normalize_extras(&mut out, &d);
    Value::Object(out)
}

fn path() -> std::path::PathBuf { theme::user_data_dir().join("settings.json") }
fn read_raw() -> Value { std::fs::read_to_string(path()).ok().and_then(|t| serde_json::from_str(t.trim_start_matches('\u{feff}')).ok()).unwrap_or(json!({})) }
/// 설정 읽기 (기본값을 채운 것)
pub fn load() -> Value { normalize(&read_raw()) }

/// 설정 저장 (saveSettings): 맨 위는 바꿔 넣고 template 은 한 단계 합친다. geminiApiKey·openrouterApiKey 는 암호화해서.
/// 돌려주는 값에도 암호문이 있으므로 화면에 그대로 보이지 않는다
pub fn save(patch: &Value) -> Result<Value> {
    let cur = load();
    let mut inc = patch.as_object().cloned().unwrap_or_default();
    let key = inc.remove("geminiApiKey");
    let or_key = inc.remove("openrouterApiKey");
    for k in ["geminiApiKeyEnc", "openrouterApiKeyEnc", "hasApiKey", "apiKeySuffix"] { inc.remove(k); }
    let mut merged = cur.as_object().unwrap().clone();
    let inc_tpl = inc.get("template").cloned();
    for (k, v) in &inc { merged.insert(k.clone(), v.clone()); }
    let mut tpl = cur["template"].as_object().cloned().unwrap_or_default();
    if let Some(Value::Object(t)) = &inc_tpl { for (k, v) in t { tpl.insert(k.clone(), v.clone()); } }
    merged.insert("template".into(), Value::Object(tpl));
    if !inc.contains_key("speakers") { if let Some(sp) = inc_tpl.as_ref().and_then(|t| t.get("speakers")).filter(|v| v.is_array()) { merged.insert("speakers".into(), sp.clone()); } }
    if !inc.contains_key("defaultSpeaker") { if let Some(ds) = inc_tpl.as_ref().and_then(|t| t.get("defaultSpeaker")).filter(|v| v.is_string()) { merged.insert("defaultSpeaker".into(), ds.clone()); } }
    for (k, enc_k) in [(key, "geminiApiKeyEnc"), (or_key, "openrouterApiKeyEnc")] {
        match k { Some(Value::String(s)) if !s.trim().is_empty() => { merged.insert(enc_k.into(), json!(secret::encrypt(s.trim())?)); } Some(Value::String(_)) => { merged.insert(enc_k.into(), json!("")); } _ => {} }
    }
    let out = normalize(&Value::Object(merged));
    let p = path();
    if let Some(d) = p.parent() { std::fs::create_dir_all(d)?; }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&out)?)?;
    std::fs::rename(&tmp, &p)?;
    Ok(out)
}

/// 저장된 키의 끝 네 글자 (없으면 None)
pub fn key_suffix(settings: &Value, enc_field: &str) -> Option<String> {
    let enc = settings[enc_field].as_str().unwrap_or("");
    if enc.is_empty() { return None; }
    let k = secret::decrypt(enc).ok()?;
    if k.is_empty() { return None; }
    Some(k.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect())
}

/// 최근 유튜브 링크 지우기 (주소 하나 / 전부)
pub fn recent_remove(url: Option<&str>) -> Result<Value> {
    let s = load();
    let list: Vec<Value> = match url { Some(u) => s["recentYoutube"].as_array().cloned().unwrap_or_default().into_iter().filter(|r| r["url"].as_str() != Some(u)).collect(), None => vec![] };
    save(&json!({ "recentYoutube": list }))
}
