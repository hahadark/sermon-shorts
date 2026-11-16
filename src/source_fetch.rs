//! 원본 영상 다시 받기 (기존 src/shared/source-fetch.js + renderer/source-recover.js 의 redownload)
//!
//! 유튜브에서 받은 원본은 캐시 폴더에 있어서 사라질 수 있다. 같은 구간을 다시 받으면 키프레임·화질이 달라
//! 파일 안의 시각이 조금 어긋날 수 있으므로, 모든 시각을 '유튜브 원본 시각(src)'으로 바꿨다가 새 파일 시각으로 옮긴다.
//! source.fetch: { kind:'part'|'section', start, end } 또는 { kind:'clips', spans, map }
use crate::{chat_plan, youtube as yt};
use regex::Regex;
use serde_json::{json, Map, Value};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Piece { pub src0: f64, pub src1: f64, pub file0: f64 }
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Span { pub start: f64, pub end: f64 }

fn is_num(v: &Value) -> Option<f64> { v.as_f64().filter(|x| x.is_finite()) }
/// JS ToNumber (Math.max 에 넣을 때)
fn js_to_number(v: &Value) -> f64 {
    match v { Value::Number(n) => n.as_f64().unwrap_or(f64::NAN), Value::Null => 0.0, Value::Bool(b) => if *b { 1.0 } else { 0.0 }, Value::String(s) => { let t = s.trim(); if t.is_empty() { 0.0 } else { t.parse().unwrap_or(f64::NAN) } } _ => f64::NAN }
}
fn base_name(p: &str) -> &str { p.rsplit(['/', '\\']).next().unwrap_or("") }

pub fn clean_map(v: &Value) -> Option<Vec<Piece>> {
    let out: Vec<Piece> = v.as_array()?.iter().filter_map(|m| { let (a, b, f) = (is_num(&m["src0"])?, is_num(&m["src1"])?, is_num(&m["file0"])?); (b > a).then_some(Piece { src0: a, src1: b, file0: f }) }).collect();
    (!out.is_empty()).then_some(out)
}
pub fn clean_spans(v: &Value) -> Option<Vec<Span>> {
    let out: Vec<Span> = v.as_array()?.iter().filter_map(|s| { let (a, b) = (is_num(&s["start"])?, is_num(&s["end"])?); (b > a).then_some(Span { start: a, end: b }) }).collect();
    (!out.is_empty()).then_some(out)
}
pub fn map_json(m: &[Piece]) -> Value { json!(m.iter().map(|p| json!({ "src0": p.src0, "src1": p.src1, "file0": p.file0 })).collect::<Vec<_>>()) }
pub fn spans_json(s: &[Span]) -> Value { json!(s.iter().map(|p| json!({ "start": p.start, "end": p.end })).collect::<Vec<_>>()) }

/// 저장할 수 있게 다듬은 fetch (잘못되면 None)
pub fn normalize_fetch(f: &Value) -> Option<Value> {
    if !f.is_object() { return None; }
    let kind = f["kind"].as_str().unwrap_or("");
    if kind == "part" || kind == "section" {
        if let (Some(s), Some(e)) = (is_num(&f["start"]), is_num(&f["end"])) { if e > s { return Some(json!({ "kind": kind, "start": s, "end": e })); } }
    }
    if kind == "clips" { if let (Some(sp), Some(m)) = (clean_spans(&f["spans"]), clean_map(&f["map"])) { return Some(json!({ "kind": "clips", "spans": spans_json(&sp), "map": map_json(&m) })); } }
    None
}

/// 지도에서 파일 시각 → 원본 시각 (조각 밖이면 가장 가까운 조각 기준으로 늘려서)
pub fn file_to_src_by_map(map: &[Piece], f: f64) -> Option<f64> {
    let (mut best, mut best_d) = (None, f64::INFINITY);
    for m in map {
        let len = m.src1 - m.src0;
        if f >= m.file0 - 0.001 && f <= m.file0 + len + 0.001 { return Some(m.src0 + (f - m.file0)); }
        let d = if f < m.file0 { m.file0 - f } else { f - (m.file0 + len) };
        if d < best_d { best_d = d; best = Some(m); }
    }
    best.map(|b| b.src0 + (f - b.file0))
}
/// 지도에서 원본 시각 → 파일 시각 (받은 조각 밖이면 None)
pub fn src_to_file_by_map(map: &[Piece], s: f64) -> Option<f64> {
    map.iter().find(|m| s >= m.src0 - 0.001 && s <= m.src1 + 0.001).map(|m| m.file0 + (s - m.src0))
}

/// 다시 받을 방법
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Plan { pub kind: String, pub url: String, pub start: Option<f64>, pub end: Option<f64>, pub spans: Option<Vec<Span>>, pub map: Option<Vec<Piece>>, pub legacy: bool, pub needs_subs: bool, pub error: Option<String> }
impl Plan {
    fn err(e: &str) -> Plan { Plan { error: Some(e.into()), ..Default::default() } }
    /// JS 와 같은 모양 (비교 시험용)
    pub fn to_json(&self) -> Value {
        if let Some(e) = &self.error { return json!({ "error": e }); }
        let mut o = Map::new();
        o.insert("kind".into(), json!(self.kind)); o.insert("url".into(), json!(self.url));
        if let Some(s) = self.start { o.insert("start".into(), json!(s)); }
        if let Some(e) = self.end { o.insert("end".into(), json!(e)); }
        if let Some(s) = &self.spans { o.insert("spans".into(), spans_json(s)); }
        if let Some(m) = &self.map { o.insert("map".into(), map_json(m)); }
        if self.legacy { o.insert("legacy".into(), json!(true)); }
        if self.needs_subs { o.insert("needsSubs".into(), json!(true)); }
        Value::Object(o)
    }
}

pub fn plan(source: &Value) -> Plan {
    let url = source["url"].as_str().unwrap_or("").trim().to_string();
    if url.is_empty() { return Plan::err("유튜브에서 받은 영상이 아니라 다시 받을 수 없습니다. 원본 파일을 직접 찾아 주세요."); }
    let off = is_num(&source["offset"]).unwrap_or(0.0);
    let dur = is_num(&source["duration"]).filter(|d| *d > 0.0).unwrap_or(0.0);
    if let Some(f) = normalize_fetch(&source["fetch"]) {
        if f["kind"] == "clips" { return Plan { kind: "clips".into(), url, spans: clean_spans(&f["spans"]), map: clean_map(&f["map"]), ..Default::default() }; }
        let (s, e) = (f["start"].as_f64().unwrap(), f["end"].as_f64().unwrap());
        let len = if dur != 0.0 { dur } else { 1f64.max(e - off) };
        return Plan { kind: f["kind"].as_str().unwrap().into(), url, start: Some(s), end: Some(e), map: Some(vec![Piece { src0: off, src1: off + len, file0: 0.0 }]), ..Default::default() };
    }
    // ---- 예전 프로젝트: 파일 이름으로 짐작 ----
    let name = base_name(source["path"].as_str().unwrap_or(""));
    let part = Regex::new(r"(?i)^part_(\d+)_(\d+)\.mp4$").unwrap().captures(name).map(|c| c[2].parse::<f64>().unwrap_or(0.0));
    if let Some(p_end) = part { if off > 0.0 {
        let end = if dur != 0.0 { off + dur } else { p_end };
        return Plan { kind: "part".into(), url, start: Some(off), end: Some(end), map: Some(vec![Piece { src0: off, src1: end, file0: 0.0 }]), legacy: true, ..Default::default() };
    } }
    if Regex::new(r"(?i)^clips_[0-9a-f]+\.mp4$").unwrap().is_match(name) || (part.is_some() && off == 0.0) {
        return Plan { kind: "clips".into(), url, needs_subs: true, legacy: true, ..Default::default() };
    }
    let to = if dur != 0.0 { off + dur } else { off + 24.0 * 3600.0 };
    Plan { kind: "section".into(), url, start: Some(off), end: Some(to), map: Some(vec![Piece { src0: off, src1: to, file0: 0.0 }]), legacy: true, ..Default::default() }
}

fn norm(t: &str) -> String { t.chars().filter(|c| !c.is_whitespace() && *c != '\u{feff}' && !".,?!…\"'“”‘’".contains(*c)).collect() }

/// 예전 AI 대화 편집: 편집 단어(sttText = 유튜브 자막 낱말, start = 파일 시각)를 유튜브 자막 단어와 맞춰
/// 파일 조각마다 '원본 시각 - 파일 시각' 차이를 되찾는다
pub fn recover_clip_map(words: &[Value], subs: &[chat_plan::SubWord]) -> Option<Vec<Piece>> {
    if words.is_empty() || subs.is_empty() { return None; }
    let sw: Vec<(String, f64)> = subs.iter().map(|w| (norm(&w.text), w.start)).collect();
    let pw: Vec<(String, Option<f64>, Option<f64>)> = words.iter().map(|w| {
        let t = match &w["sttText"] { Value::Null => &w["text"], v => v };
        let t = match t { Value::String(s) => s.clone(), Value::Null => String::new(), v => v.to_string() };
        (norm(&t), is_num(&w["start"]), is_num(&w["end"]))
    }).collect();
    let same = |i: usize, k: usize| i < pw.len() && k < sw.len() && !pw[i].0.is_empty() && pw[i].0 == sw[k].0;
    let mut pairs: Vec<(f64, f64, f64)> = vec![];
    let (mut j, mut d): (usize, Option<f64>) = (0, None);
    for i in 0..pw.len() {
        let Some(f) = pw[i].1 else { continue };
        if pw[i].0.is_empty() { continue; }
        let mut found = None;
        if let Some(dd) = d { for k in j..sw.len().min(j + 12) { if same(i, k) && (sw[k].1 - (f + dd)).abs() < 0.35 { found = Some(k); break; } } }
        if found.is_none() { for k in j..sw.len() { if same(i, k) && same(i + 1, k + 1) && same(i + 2, k + 2) { found = Some(k); break; } } }
        let Some(k) = found else { continue };
        let dd = sw[k].1 - f;
        d = Some(dd);
        pairs.push((f, pw[i].2.unwrap_or(f), dd));
        j = k + 1;
    }
    if pairs.len() < 3 || (pairs.len() as f64) < 20f64.min(pw.len() as f64 * 0.3) { return None; }
    // 차이가 같은 것끼리 조각으로 묶는다
    struct Pc { ds: Vec<f64>, f0: f64, f1: f64 }
    let mut pieces: Vec<Pc> = vec![];
    for &(f, e, dd) in &pairs {
        if let Some(last) = pieces.last_mut() { if (dd - last.ds[0]).abs() < 0.35 { last.ds.push(dd); last.f1 = last.f1.max(e); continue; } }
        pieces.push(Pc { ds: vec![dd], f0: f, f1: e });
    }
    let n = pieces.len();
    let mut map: Vec<(f64, f64, f64, f64)> = vec![]; // src0, src1, file0, d
    for pc in &pieces {
        if pc.ds.len() < 2 && n > 1 { continue; }
        let mut ds = pc.ds.clone();
        ds.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let dm = ds[ds.len() / 2];
        map.push((pc.f0 + dm, pc.f1 + dm, pc.f0, dm));
    }
    if map.is_empty() { return None; }
    let mut out = vec![];
    for r in 0..map.len() {
        let a = map[r];
        let lo = if r == 0 { 0.0 } else { let p = map[r - 1]; (p.2 + (p.1 - p.0) + a.2) / 2.0 };
        let hi = match map.get(r + 1) { Some(b) => (a.2 + (a.1 - a.0) + b.2) / 2.0, None => a.2 + (a.1 - a.0) + 600.0 };
        out.push(Piece { src0: lo + a.3, src1: hi + a.3, file0: lo });
    }
    Some(out)
}

/// 다시 받을 원본 구간: 단어가 있는 곳만
pub fn spans_from_words(words: &[Value], f2s: &dyn Fn(f64) -> Option<f64>) -> Vec<Span> {
    let mut spans: Vec<Span> = vec![];
    for w in words {
        let (Some(s), Some(e)) = (is_num(&w["start"]), is_num(&w["end"])) else { continue };
        let (Some(a), Some(b)) = (f2s(s), f2s(e)) else { continue };
        match spans.last_mut() { Some(l) if a - l.end < 3.0 => l.end = l.end.max(b), _ => spans.push(Span { start: a, end: b }) }
    }
    spans
}

/// 프로젝트 시각 옮기기: 옛 파일 시각 → 원본 시각(f2s) → 새 파일 시각(s2f). 단어·미세 조정·재생 위치 → (복사본, 옮긴 수, 못 옮긴 수)
pub fn remap_project(data: &Value, f2s: &dyn Fn(f64) -> Option<f64>, s2f: &dyn Fn(f64) -> Option<f64>) -> (Value, usize, usize) {
    let mut out = data.clone();
    let (mut moved, mut missing) = (0usize, 0usize);
    let mut mv = |t: &Value| -> Value {
        let Some(x) = is_num(t) else { return t.clone() };
        match f2s(x).and_then(s2f) { Some(n) => { moved += 1; json!(n.max(0.0)) } None => { missing += 1; t.clone() } }
    };
    if let Some(ws) = out["words"].as_array_mut() {
        for w in ws {
            let (a, b) = (mv(&w["start"]), mv(&w["end"]));
            // JS: w.start = a; w.end = Math.max(a, b) (숫자가 아니면 NaN → null)
            let m = { let (x, y) = (js_to_number(&a), js_to_number(&b)); if x.is_nan() || y.is_nan() { Value::Null } else { json!(x.max(y)) } };
            w["start"] = a; w["end"] = m;
        }
    }
    if let Some(ov) = out["overrides"].as_object_mut() { for (_, v) in ov.iter_mut() { if is_num(v).is_some() { *v = mv(v); } } }
    if let Some(p) = is_num(&out["playhead"]) { out["playhead"] = json!(f2s(p).and_then(s2f).map(|n| n.max(0.0)).unwrap_or(0.0)); }
    (out, moved, missing)
}

/// 유튜브 자막 단어 (원본 시각): 예전 AI 대화 편집의 위치를 되찾을 때 (기존 source:subWords)
pub fn sub_words(url: &str) -> Result<Vec<chat_plan::SubWord>, String> {
    Ok(match yt::fetch_auto_subs_raw(url)? { Some(raw) => chat_plan::words_from_json3(&raw).0, None => vec![] })
}

/// 다시 받고 시각을 옮긴 프로젝트 데이터 (기존 source-recover.js redownload). ui(퍼센트, 글)
pub fn redownload(saved: &Value, plan: &Plan, ui: &(dyn Fn(f64, &str) + Sync)) -> Result<Value, String> {
    let words: Vec<Value> = saved["words"].as_array().cloned().unwrap_or_default();
    let old_map = if plan.needs_subs {
        ui(2.0, "유튜브 자막과 맞춰 편집 위치를 찾는 중…");
        let subs = sub_words(&plan.url)?;
        recover_clip_map(&words, &subs).ok_or("예전 버전에서 만든 편집이라 위치를 되찾지 못했습니다. 원본 파일이 있다면 [파일 직접 찾기]로 골라 주세요.")?
    } else { plan.map.clone().unwrap_or_default() };
    let f2s = |f: f64| file_to_src_by_map(&old_map, f);
    let on = |pct: f64| ui(5.0 + (pct * 0.9).round(), &format!("영상 받는 중… {}%", pct.round() as i64));
    ui(5.0, "영상 받는 중…");
    let (path, new_map, new_off, fetch) = match plan.kind.as_str() {
        "clips" => {
            let spans = plan.spans.clone().unwrap_or_else(|| spans_from_words(&words, &f2s));
            let r = yt::fetch_clips(&plan.url, &spans, &on)?;
            let fetch = json!({ "kind": "clips", "spans": spans_json(&spans), "map": map_json(&r.map) });
            (r.path, r.map, 0.0, fetch)
        }
        "part" => {
            let (s, e) = (plan.start.unwrap_or(0.0), plan.end.unwrap_or(0.0));
            let r = yt::fetch_part(&plan.url, s, e, 8.0, &|p, _| on(p))?;
            (r.path, vec![Piece { src0: r.offset, src1: r.offset + 1e7, file0: 0.0 }], r.offset, json!({ "kind": "part", "start": s, "end": e }))
        }
        _ => {
            let (s, e) = (plan.start.unwrap_or(0.0), plan.end.unwrap_or(0.0));
            let r = yt::download_full(&plan.url, &on)?;
            (r.path, vec![Piece { src0: r.offset, src1: r.offset + 1e7, file0: 0.0 }], r.offset, json!({ "kind": "section", "start": s, "end": e }))
        }
    };
    ui(97.0, "자막·컷 위치를 새 영상에 맞추는 중…");
    let (mut out, moved, missing) = remap_project(saved, &f2s, &|s| src_to_file_by_map(&new_map, s));
    if moved > 0 && (missing as f64) > 2f64.max(moved as f64 * 0.05) { return Err(format!("다시 받은 영상에 편집 부분 일부가 없습니다 ({missing}곳). 원본 파일을 직접 찾아 주세요.")); }
    let mut src = saved["source"].as_object().cloned().unwrap_or_default();
    src.insert("path".into(), json!(path.to_string_lossy()));
    src.insert("offset".into(), json!(new_off));
    src.insert("fetch".into(), fetch);
    for k in ["duration", "fps", "width", "height"] { src.remove(k); }
    out["source"] = Value::Object(src);
    Ok(out)
}
