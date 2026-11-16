//! 테마 (기존 src/shared/theme.js). 테마 JSON 은 항목이 많고 사용자가 손으로 고친 파일도 있어
//! serde_json::Value 그대로 다루고, 읽을 때 JS 와 같은 기본값·참거짓 규칙을 쓴다.
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

pub fn defaults() -> Value {
    json!({
      "canvas": { "background": "#000000", "mode": "solid", "gradient": { "from": "#1B2A4A", "to": "#05070C", "angle": 180 }, "blur": { "amount": 30, "dim": 0.55, "tint": null } },
      "title": { "show": true, "align": "center", "x": 540, "y": 205, "width": 1000, "font": "Noto Sans KR", "size": 70, "color": "#FFFFFF", "weight": 700, "maxLines": 2, "stroke": 0, "strokeColor": null, "shadow": null, "anchor": "bottom", "lineGap": 1.15, "lineColors": null, "highlightColor": null, "box": null, "band": null, "italic": false, "transform": null },
      "verse": { "show": true, "align": "center", "x": 540, "y": 280, "width": 1000, "font": "Noto Sans KR", "size": 44, "color": "#FFFFFF", "weight": 400, "band": null, "anchor": "center", "maxLines": 2, "lineGap": 1.2, "box": null, "italic": false },
      "video": { "show": true, "x": 0, "y": 353, "width": 1080, "height": 958, "fit": "cover", "radius": 0, "border": null, "fade": null, "shadow": null },
      "subtitle": { "show": true, "align": "center", "x": 540, "y": 1400, "width": 1000, "font": "Noto Sans KR", "size": 60, "color": "#FFFFFF", "weight": 700, "stroke": 0, "strokeColor": "#000000", "box": null, "maxChars": 14, "highlightColor": null, "lineGap": 1.2, "anchor": "center", "maxLines": 2, "karaoke": null, "italic": false, "transform": null, "shadow": null },
      "badge": { "show": false, "text": "{speaker}", "align": "center", "x": 540, "y": 140, "width": 420, "font": "Noto Sans KR", "size": 36, "weight": 700, "color": "#FFFFFF", "bg": "#E2416B", "radius": 999, "padX": 24, "padY": 10 },
      "churchName": { "show": true, "align": "center", "x": 540, "y": 1700, "width": 1000, "font": "Noto Sans KR", "size": 40, "color": "#FFFFFF", "letterSpacing": 0, "text": "" },
      "speaker": { "show": true, "align": "center", "x": 540, "y": 1770, "width": 1000, "font": "Noto Sans KR", "size": 44, "color": "#FFFFFF", "text": "", "format": "{speaker}" },
      "logo": { "show": true, "x": 540, "y": 1620, "height": 120, "path": "" },
      "fadeInSec": 1,
      "fallbackFont": "Noto Sans KR"
    })
}

/// JS merge: 객체(배열 아님)이고 참이면 재귀로 합치고, 나머지(null·배열·값)는 덮어쓴다
fn merge(target: &mut Value, source: &Value) {
    let Some(src) = source.as_object() else { return };
    if !target.is_object() { *target = Value::Object(Map::new()); }
    let t = target.as_object_mut().unwrap();
    for (k, v) in src {
        if v.is_object() {
            let slot = t.entry(k.clone()).or_insert(Value::Null);
            if !slot.is_object() { *slot = Value::Object(Map::new()); }
            merge(slot, v);
        } else {
            t.insert(k.clone(), v.clone());
        }
    }
}

pub fn normalize(json: Option<&Value>) -> Value {
    let mut t = defaults();
    if let Some(j) = json { if j.is_object() { merge(&mut t, j); } }
    t
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Layers { pub bg_image: bool, pub blur: bool, pub under: bool, pub mask: bool }

pub fn export_layers(t: &Value) -> Layers {
    let c = &t["canvas"];
    let v = &t["video"];
    let mode = c["mode"].as_str().unwrap_or("solid");
    let mode = if mode == "gradient" || mode == "blur" { mode } else { "solid" };
    let vshow = v["show"] != Value::Bool(false);
    let sh = &v["shadow"];
    let shadow = truthy(sh) && (num(&sh["blur"]).map(|b| b > 0.0).unwrap_or(false) || num(&sh["offsetX"]).map(|x| x != 0.0).unwrap_or(false) || num(&sh["offsetY"]).map(|y| y != 0.0).unwrap_or(false));
    Layers {
        bg_image: mode == "gradient",
        blur: mode == "blur",
        under: (mode == "blur" && truthy(&c["blur"]) && truthy(&c["blur"]["tint"])) || (vshow && shadow),
        mask: vshow && num(&v["radius"]).map(|r| r > 0.0).unwrap_or(false),
    }
}

// ---------------------------------------------------------------- JS 와 같은 값 읽기

/// JS 참거짓 (null·false·0·NaN·"" 은 거짓)
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}
/// 숫자 (JS Number(x) 비슷: 숫자 문자열도)
pub fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}
/// `x || d` (0·없음이면 d)
pub fn or(v: &Value, d: f64) -> f64 { num(v).filter(|x| *x != 0.0 && !x.is_nan()).unwrap_or(d) }
/// `x != null ? x : d`
pub fn nn(v: &Value, d: f64) -> f64 { if v.is_null() { d } else { num(v).unwrap_or(d) } }
pub fn s<'a>(v: &'a Value, d: &'a str) -> &'a str { match v.as_str() { Some(x) if !x.is_empty() => x, _ => d } }

// ---------------------------------------------------------------- 테마 파일

/// 기존 앱 사용자 자료 폴더 (%APPDATA%\SermonShorts)
pub fn user_data_dir() -> PathBuf {
    if let Ok(p) = std::env::var("SS_USER_DATA_DIR") { return PathBuf::from(p); }
    if cfg!(target_os = "macos") { return crate::home_dir().join("Library").join("Application Support").join("SermonShorts"); }
    std::env::var("APPDATA").map(|a| PathBuf::from(a).join("SermonShorts")).unwrap_or_else(|_| PathBuf::from("."))
}
/// 기본 테마 폴더: 실행 파일 옆 assets/themes, 개발 중에는 저장소 assets/themes
pub fn builtin_dir() -> PathBuf { crate::assets_dir().join("themes") }

pub struct ThemeEntry { pub id: String, pub name: String, pub json: Value, pub builtin: bool }

pub fn list_themes() -> Vec<ThemeEntry> {
    let mut out = vec![];
    let mut read_dir = |dir: &Path, builtin: bool| {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut files: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().map(|e| e == "json").unwrap_or(false)).collect();
        files.sort();
        for p in files {
            let Ok(txt) = std::fs::read_to_string(&p) else { continue };
            let Ok(j) = serde_json::from_str::<Value>(txt.trim_start_matches('\u{feff}')) else { continue };
            let id = j["id"].as_str().map(String::from).unwrap_or_else(|| p.file_stem().unwrap().to_string_lossy().into());
            let name = j["name"].as_str().unwrap_or(&id).to_string();
            out.retain(|e: &ThemeEntry| e.id != id);
            out.push(ThemeEntry { id, name, json: j, builtin });
        }
    };
    read_dir(&builtin_dir(), true);
    read_dir(&user_data_dir().join("themes"), false);
    out
}

/// 기존 앱 설정 (settings.json): 지금 테마, 교회 이름, 로고, 기본 설교자
/// 설정 (기본값을 채우고 다듬은 것, 기존 settings.js loadSettings)
pub fn app_settings() -> Value { crate::settings::load() }

pub fn active_theme(settings: &Value) -> Value {
    let list = list_themes();
    let id = settings["activeThemeId"].as_str().unwrap_or("");
    let pick = list.iter().find(|t| t.id == id).or(list.first());
    let mut t = normalize(pick.map(|e| &e.json));
    if let Some(e) = pick { t["id"] = json!(e.id); t["name"] = json!(e.name); }
    t
}

/// 설정 일부 바꾸기 (기존 앱 settings.json 을 다시 읽어 합친 뒤 저장. 객체는 안쪽까지 합친다)
/// 설정 저장 (기존 settings.js saveSettings: 맨 위는 바꿔 넣고 template 은 합치고 다듬어 저장)
pub fn save_settings(patch: &Value) -> anyhow::Result<Value> { crate::settings::save(patch) }

/// 로고 그림을 기존 앱 자료 폴더 logos 로 복사하고 경로를 돌려준다
pub fn import_logo(src: &Path) -> anyhow::Result<PathBuf> {
    let dir = user_data_dir().join("logos");
    std::fs::create_dir_all(&dir)?;
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "png".into());
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dst = dir.join(format!("logo_{ms}.{ext}"));
    std::fs::copy(src, &dst)?;
    Ok(dst)
}