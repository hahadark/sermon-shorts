//! 설교 목소리 크기 (기존 src/shared/voice.js + src/main/voice.js): 키워도 깨지지 않게 (ffmpeg 내장 무료 필터만)
//!  - 자동 맞춤: 편집한 말소리를 EBU R128(LUFS)로 재서 유튜브 기준(-14 LUFS)에 맞게
//!  - 직접: -12 ~ +20 dB
//!  - 작은 말소리 고르게(선택): acompressor
//!  - 맨 끝 리미터(alimiter, 4배 오버샘플): -1.5 dBFS 를 넘지 않게
use serde_json::{json, Value};

pub const TARGET_LUFS: f64 = -14.0;
pub const CEIL_DB: f64 = -1.5;
pub const MIN_DB: f64 = -12.0;
pub const MAX_DB: f64 = 20.0;
pub const AUTO_MAX: f64 = 20.0;
pub struct Comp { pub threshold_db: f64, pub ratio: f64, pub knee_db: f64, pub attack: f64, pub release: f64, pub makeup_db: f64 }
pub const COMP: Comp = Comp { threshold_db: -24.0, ratio: 3.0, knee_db: 6.0, attack: 0.012, release: 0.25, makeup_db: 4.0 };

/// JS Number(v)
fn js_number(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::Null => 0.0,
        Value::Bool(b) => if *b { 1.0 } else { 0.0 },
        Value::String(s) => { let t = s.trim(); if t.is_empty() { 0.0 } else { match t { "Infinity" | "+Infinity" => f64::INFINITY, "-Infinity" => f64::NEG_INFINITY, _ => t.parse().ok().filter(|_: &f64| !t.contains(['i', 'n', 'I', 'N'])).unwrap_or(f64::NAN) } } }
        Value::Array(a) if a.is_empty() => 0.0,
        Value::Array(a) if a.len() == 1 => js_number(&a[0]),
        _ => f64::NAN,
    }
}
fn num(v: Option<&Value>, d: f64) -> f64 { let n = v.map(js_number).unwrap_or(f64::NAN); if n.is_finite() { n } else { d } }
fn truthy(v: Option<&Value>) -> bool { match v { None | Some(Value::Null) => false, Some(Value::Bool(b)) => *b, Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0), Some(Value::String(s)) => !s.is_empty(), _ => true } }
fn js_round(x: f64) -> f64 { (x + 0.5).floor() }
pub fn r1(v: f64) -> f64 { js_round(v * 10.0) / 10.0 }
fn jnum(x: f64) -> Value { if x.fract() == 0.0 && x.abs() < 9e15 { json!(x as i64) } else { json!(x) } }

#[derive(Clone, Debug, PartialEq)]
pub struct Measured { pub i: f64, pub tp: f64, pub lra: f64, pub key: String, pub even: bool }
#[derive(Clone, Debug, PartialEq)]
pub struct Voice { pub mode: String, pub gain_db: f64, pub even: bool, pub measured: Option<Measured> }
impl Default for Voice { fn default() -> Self { Voice { mode: "off".into(), gain_db: 0.0, even: false, measured: None } } }
impl Voice {
    pub fn to_json(&self) -> Value {
        json!({ "mode": self.mode, "gainDb": jnum(self.gain_db), "even": self.even,
            "measured": self.measured.as_ref().map(|m| json!({ "i": jnum(m.i), "tp": jnum(m.tp), "lra": jnum(m.lra), "key": m.key, "even": m.even })) })
    }
}

pub fn normalize(v: &Value) -> Voice {
    let o = if v.is_object() { v.clone() } else { json!({}) };
    let m = &o["measured"];
    let measured = (m.is_object() && js_number(&m["i"]).is_finite()).then(|| Measured {
        i: r1(num(m.get("i"), -30.0)), tp: r1(num(m.get("tp"), 0.0)), lra: r1(num(m.get("lra"), 0.0)),
        key: if truthy(m.get("key")) { match &m["key"] { Value::String(s) => s.clone(), x => x.to_string() } } else { String::new() }, even: truthy(m.get("even")),
    });
    let mode = match o["mode"].as_str() { Some("auto") => "auto", Some("manual") => "manual", _ => "off" };
    Voice { mode: mode.into(), gain_db: r1(num(o.get("gainDb"), 0.0).clamp(MIN_DB, MAX_DB)), even: truthy(o.get("even")), measured }
}
pub fn is_on(v: &Voice) -> bool { v.mode != "off" || v.even }
/// 편집 구간이 바뀌었는지 알기 위한 열쇠 (구간 = 원본 시각 start, end)
pub fn seg_key(segments: &[(f64, f64)]) -> String {
    let s = segments.iter().map(|(a, b)| format!("{}-{}", js_round(a * 100.0) as i64, js_round(b * 100.0) as i64)).collect::<Vec<_>>().join(",");
    let mut h: i32 = 0;
    for c in s.encode_utf16() { h = (h << 5).wrapping_sub(h).wrapping_add(c as i32); }
    format!("{}:{}", segments.len(), radix36(h as u32))
}
fn radix36(mut x: u32) -> String {
    if x == 0 { return "0".into(); }
    let d = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = vec![];
    while x > 0 { out.push(d[(x % 36) as usize]); x /= 36; }
    out.reverse();
    String::from_utf8(out).unwrap()
}
/// 잰 값이 지금 편집(구간·고르게 설정)에 맞는지
pub fn measured_fits(v: &Voice, key: &str) -> bool { v.measured.as_ref().is_some_and(|m| m.key == key && m.even == v.even) }
/// 키울(줄일) 크기 dB. 자동인데 아직 안 쟀으면 None
pub fn gain_db(v: &Voice) -> Option<f64> {
    match v.mode.as_str() {
        "manual" => Some(v.gain_db),
        "auto" => { let m = v.measured.as_ref()?; if m.i < -60.0 { Some(0.0) } else { Some(r1((TARGET_LUFS - m.i).clamp(MIN_DB, AUTO_MAX))) } }
        _ => Some(0.0),
    }
}
/// JS (Math.round(x*1000)/1000).toString()
pub fn f3(x: f64) -> String { let v = js_round(x * 1000.0) / 1000.0; if v == 0.0 { "0".into() } else { format!("{v}") } }
pub fn db_to_lin(db: f64) -> f64 { 10f64.powf(db / 20.0) }
/// 압축기 (작은 말소리 고르게)
pub fn comp_filter() -> String {
    format!("acompressor=threshold={}:ratio={}:knee={}:attack={}:release={}:makeup={}", f3(db_to_lin(COMP.threshold_db)), COMP.ratio, f3(db_to_lin(COMP.knee_db)), js_round(COMP.attack * 1000.0), js_round(COMP.release * 1000.0), f3(db_to_lin(COMP.makeup_db)))
}
/// 4배로 늘려서(192kHz) 리미터를 걸면 샘플 사이 최고값까지 잡힌다. 천장은 0.5 dB 더 낮춰 AAC 넘침까지 막는다
pub fn limiter_filter() -> String { format!("aresample=192000,alimiter=limit={}:attack=5:release=80:level=false:latency=true,aresample=48000", f3(db_to_lin(CEIL_DB - 0.5))) }
/// 재기용 체인: (압축기) → loudnorm 재기
pub fn analysis_filter(v: &Voice) -> String { format!("{}loudnorm=I={}:TP={}:LRA=11:print_format=json", if v.even { format!("{},", comp_filter()) } else { String::new() }, TARGET_LUFS, CEIL_DB) }
/// loudnorm 이 stderr 에 찍은 JSON → (i, tp, lra)
pub fn parse_loudnorm(text: &str) -> Option<(f64, f64, f64)> {
    let (a, b) = (text.rfind('{')?, text.rfind('}')?);
    if b < a { return None; }
    let j: Value = serde_json::from_str(&text[a..=b]).ok()?;
    let (i, tp, lra) = (js_number(&j["input_i"]), js_number(&j["input_tp"]), js_number(&j["input_lra"]));
    let (i2, tp2, lra2) = (if j.get("input_i").is_none() { f64::NAN } else { i }, if j.get("input_tp").is_none() { f64::NAN } else { tp }, if j.get("input_lra").is_none() { f64::NAN } else { lra });
    if !i2.is_finite() { return Some((-70.0, if tp2.is_finite() { tp2 } else { -70.0 }, if lra2.is_finite() { lra2 } else { 0.0 })); }
    Some((i2, tp2, lra2))
}
/// 오디오 체인 (라벨 없이): (압축기) → 크기 → 리미터. 끄면 None
pub fn chain(v: &Voice) -> Option<String> {
    if !is_on(v) { return None; }
    let g = gain_db(v).unwrap_or(0.0);
    let mut parts = vec![];
    if v.even { parts.push(comp_filter()); }
    if g.abs() >= 0.05 { parts.push(format!("volume={}dB", f3(g))); }
    parts.push(limiter_filter());
    Some(parts.join(","))
}
/// 내보내기 체인: [in] → … → [out]. 끄면 ''
pub fn ffmpeg_filter(v: &Voice, in_label: &str, out_label: &str) -> String { chain(v).map(|c| format!("{in_label}{c}{out_label}")).unwrap_or_default() }
pub fn describe(v: &Voice) -> String {
    let g = gain_db(v);
    if v.mode == "off" { return if v.even { "작은 말소리 고르게만".into() } else { "원래 크기".into() }; }
    match g { None => "목소리 크기를 재는 중…".into(), Some(g) => format!("{}{:.1} dB", if g > 0.0 { "+" } else { "" }, g) }
}

/// 목소리 크기 재기: 편집한 구간만 이어 붙여 loudnorm 으로 잰다 (소리만 읽어 빠름)
pub fn analyze(source: &std::path::Path, segments: &[(f64, f64)], v: &Voice) -> Result<Measured, String> {
    let segs: Vec<(f64, f64)> = segments.iter().copied().filter(|(a, b)| b > a).collect();
    if segs.is_empty() { return Err("잴 구간이 없습니다.".into()); }
    let start_t = (segs[0].0 - 1.0).max(0.0);
    let end_t = segs[segs.len() - 1].1 + 1.0;
    let mut fg = String::new();
    for (i, (a, b)) in segs.iter().enumerate() { fg += &format!("[0:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[a{i}]; ", (a - start_t).max(0.0), (b - start_t).max(0.0)); }
    fg += &format!("{}concat=n={}:v=0:a=1[acat]; [acat]{}[out]", (0..segs.len()).map(|i| format!("[a{i}]")).collect::<String>(), segs.len(), analysis_filter(v));
    let out = crate::media::command("ffmpeg").args(["-hide_banner", "-nostats", "-ss", &format!("{start_t:.3}"), "-to", &format!("{end_t:.3}"), "-i"]).arg(source)
        .args(["-vn", "-filter_complex", &fg, "-map", "[out]", "-f", "null", "-"]).output().map_err(|e| e.to_string())?;
    let err = String::from_utf8_lossy(&out.stderr);
    let m = parse_loudnorm(&err);
    match (out.status.success(), m) {
        (true, Some((i, tp, lra))) => Ok(Measured { i: r1(i), tp: r1(tp), lra: r1(lra), key: seg_key(&segs), even: v.even }),
        _ => { let tail: Vec<&str> = err.lines().filter(|l| !l.trim().is_empty()).collect(); let t = tail[tail.len().saturating_sub(2)..].join(" / "); let tl: String = { let c: Vec<char> = t.chars().collect(); c[c.len().saturating_sub(200)..].iter().collect() }; Err(format!("목소리 크기를 재지 못했습니다. {tl}")) }
    }
}
