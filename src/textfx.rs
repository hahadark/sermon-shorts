//! 글자 효과 계산 (기존 src/shared/textfx.js): *강조*, 줄 나누기, 단어 강조(가라오케) 시각
use crate::edl::{self, Line, Segment};
use crate::model::Word;
use crate::theme::{s, truthy};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct Part { pub text: String, pub hl: bool }

#[derive(Clone, Debug, PartialEq)]
pub struct Token {
    pub text: String,
    pub hl: bool,
    pub parts: Option<Vec<Part>>,
    pub group: usize,
    /// 줄 전체에서의 단어 번호 (가라오케 비교용)
    pub k: usize,
}

/// JS: String.split(/\s+/)
fn split_ws(t: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut in_ws = false;
    for c in t.chars() {
        if c.is_whitespace() { if !in_ws { out.push(std::mem::take(&mut cur)); in_ws = true; } }
        else { in_ws = false; cur.push(c); }
    }
    out.push(cur);
    out
}

pub fn tokenize(text: &str, groups: Option<&[String]>) -> Vec<Token> {
    let src: Vec<String> = match groups { Some(g) if !g.is_empty() => g.to_vec(), _ => split_ws(text) };
    let mut out = vec![];
    let mut in_hl = false;
    for (i, raw) in src.iter().enumerate() {
        let t = raw.trim();
        if t.is_empty() { continue; }
        let mut segs: Vec<Part> = vec![];
        let mut cur = String::new();
        let mut cur_hl = in_hl;
        for c in t.chars() {
            if c == '*' {
                if !cur.is_empty() { segs.push(Part { text: std::mem::take(&mut cur), hl: cur_hl }); }
                in_hl = !in_hl; cur_hl = in_hl;
                continue;
            }
            cur.push(c);
        }
        if !cur.is_empty() { segs.push(Part { text: cur, hl: cur_hl }); }
        if segs.is_empty() { continue; }
        let mut merged: Vec<Part> = vec![];
        for sg in segs {
            match merged.last_mut() { Some(l) if l.hl == sg.hl => l.text.push_str(&sg.text), _ => merged.push(sg) }
        }
        out.push(Token {
            text: merged.iter().map(|x| x.text.as_str()).collect(),
            hl: merged.iter().any(|x| x.hl),
            parts: if merged.len() > 1 { Some(merged) } else { None },
            group: i,
            k: 0,
        });
    }
    out
}

pub fn transform_text(text: &str, transform: &Value) -> String {
    if transform.as_str() == Some("uppercase") { text.to_uppercase() } else { text.to_string() }
}

pub fn wrap_tokens(tokens: &[Token], measure: &mut dyn FnMut(&str) -> f64, max_w: f64, gap: f64, max_lines: i64) -> Vec<Vec<Token>> {
    let max_lines = if max_lines > 0 { max_lines as usize } else { 99 };
    let mut lines: Vec<Vec<Token>> = vec![];
    let mut cur: Vec<Token> = vec![];
    let mut cur_w = 0.0;
    for t in tokens {
        let w = measure(&t.text);
        let mut add = if cur.is_empty() { w } else { gap + w };
        if !cur.is_empty() && cur_w + add > max_w && lines.len() < max_lines - 1 {
            lines.push(std::mem::take(&mut cur)); cur_w = 0.0; add = w;
        }
        cur.push(t.clone()); cur_w += add;
    }
    if !cur.is_empty() { lines.push(cur); }
    lines
}

#[derive(Clone, Debug, PartialEq)]
pub struct Frame { pub index: usize, pub start: f64, pub end: f64 }

pub fn karaoke_frames(line_start: f64, line_end: f64, starts: &[f64], min_dur: f64) -> Vec<Frame> {
    let min_dur = if min_dur > 0.0 { min_dur } else { 1.0 / 30.0 };
    let n = starts.len();
    if n == 0 || !(line_end > line_start) { return vec![]; }
    let mut t: Vec<f64> = starts.iter().map(|&s| if s.is_finite() { s.min(line_end).max(line_start) } else { f64::NAN }).collect();
    t[0] = line_start;
    let mut u = 1;
    while u < n {
        if !t[u].is_nan() { u += 1; continue; }
        let mut e = u;
        while e < n && t[e].is_nan() { e += 1; }
        let (a0, b0, cnt) = (t[u - 1], if e < n { t[e] } else { line_end }, (e - u + 1) as f64);
        for q in u..e { t[q] = a0 + (b0 - a0) * (q - u + 1) as f64 / cnt; }
        u = e;
    }
    for m in 1..n { if t[m] < t[m - 1] { t[m] = t[m - 1]; } }
    let mut frames: Vec<Frame> = vec![];
    for j in 0..n {
        let (a, b) = (t[j], if j + 1 < n { t[j + 1] } else { line_end });
        if b - a < min_dur && !frames.is_empty() { frames.last_mut().unwrap().end = b; continue; }
        if b - a < min_dur { continue; }
        frames.push(Frame { index: j, start: a, end: b });
    }
    if !frames.is_empty() { frames[0].start = line_start; let l = frames.len() - 1; frames[l].end = line_end; }
    frames
}

#[derive(Clone, Debug)]
pub struct Unit { pub id: i64, pub text: String, pub from: usize, pub to: usize }

pub fn line_units(line: &Line) -> Vec<Unit> {
    let mut units: Vec<Unit> = vec![];
    for p in &line.parts {
        let text = p.text.trim();
        if text.is_empty() { continue; }
        if let Some(last) = units.last_mut() { if last.id == p.id && last.to == p.from { last.text.push_str(text); last.to = p.to; continue; } }
        units.push(Unit { id: p.id, text: text.to_string(), from: p.from, to: p.to });
    }
    units
}

pub struct Karaoke { pub groups: Vec<String>, pub frames: Vec<Frame> }

/// 줄의 가라오케 (template.js karaokeOf): 단어 시각을 출력 시각으로, 잘린 단어는 글자 위치만큼 나눠
pub fn karaoke_of(line: &Line, words: &[Word], segs: &[Segment]) -> Karaoke {
    let by_id: HashMap<i64, &Word> = words.iter().map(|w| (w.id, w)).collect();
    let u = line_units(line);
    let starts: Vec<f64> = u.iter().map(|x| {
        let Some(w) = by_id.get(&x.id) else { return f64::NAN };
        if !w.start.is_finite() { return f64::NAN; }
        let len = w.text.chars().count().max(1) as f64;
        let end = if w.end.is_finite() { w.end } else { w.start };
        edl::src_to_out(segs, w.start + (end - w.start) * (x.from as f64 / len).min(1.0)).unwrap_or(f64::NAN)
    }).collect();
    Karaoke { groups: u.iter().map(|x| x.text.clone()).collect(), frames: karaoke_frames(line.out_start, line.out_end, &starts, 0.0) }
}

pub fn karaoke_index_at(frames: &[Frame], t: f64) -> i64 {
    for f in frames { if t >= f.start && t < f.end { return f.index as i64; } }
    match frames.last() { Some(l) if t >= l.end => l.index as i64, _ => -1 }
}

/// 토큰 색: 가라오케 > 줄 색 > 강조(*) > 기본
pub fn token_color(hl: bool, idx: usize, el: &Value, line_idx: usize, karaoke_index: Option<i64>) -> String {
    let base = el["lineColors"].as_array().and_then(|a| a.get(line_idx)).and_then(|c| c.as_str()).filter(|c| !c.is_empty()).unwrap_or_else(|| s(&el["color"], "#FFFFFF")).to_string();
    let k = &el["karaoke"];
    let mode = k["mode"].as_str().unwrap_or("");
    if truthy(k) && !mode.is_empty() && mode != "none" {
        if let Some(ki) = karaoke_index.filter(|&i| i >= 0) {
            let hi = || s(&k["color"], s(&el["highlightColor"], "#FFE14D")).to_string();
            let idx = idx as i64;
            if idx == ki { return hi(); }
            if idx < ki { return if mode == "progressive" { hi() } else { s(&k["pastColor"], &base).to_string() }; }
            return s(&k["futureColor"], &base).to_string();
        }
    }
    if hl { if let Some(h) = el["highlightColor"].as_str().filter(|h| !h.is_empty()) { return h.to_string(); } }
    base
}

pub fn strip_emphasis(text: &str) -> String { text.replace('*', "") }

/// {speaker} {church} {title} {verse} 채우기
pub fn fill_format(fmt: &str, vals: &HashMap<&str, String>) -> String {
    let mut out = String::new();
    let mut rest = fmt;
    while let Some(i) = rest.find('{') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        if let Some(j) = after.find('}') {
            let key = &after[..j];
            if ["speaker", "church", "title", "verse"].contains(&key) { out.push_str(vals.get(key).map(|s| s.as_str()).unwrap_or("")); rest = &after[j + 1..]; continue; }
        }
        out.push('{'); rest = after;
    }
    out.push_str(rest);
    // /\s{2,}/g → ' ', trim
    let mut r = String::new();
    let mut ws = 0;
    for c in out.chars() {
        if c.is_whitespace() { ws += 1; if ws == 1 { r.push(c); } else if ws == 2 { r.pop(); r.push(' '); } }
        else { ws = 0; r.push(c); }
    }
    r.trim().to_string()
}
