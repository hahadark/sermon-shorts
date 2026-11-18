//! 단어별 시작·끝 고치기 (미세 조정 창의 '단어별 조정').
//! 음성 인식이 단어 시각을 틀리게 잡아 지운 말 소리가 남거나 남긴 말이 잘릴 때 사용자가 직접 고친다.
//!
//! 저장 방식 (Electron 판과 호환):
//! - 단어의 `start`/`end` 를 바로 바꾼다. 처음 바꿀 때 인식 원래 값을 `sttStart`/`sttEnd` 에 남긴다
//!   (Electron 판은 모르는 단어 필드를 그대로 두므로 같은 파일을 열어도 같은 시각으로 자른다).
//! - 구간 경계는 기존 미세 조정 값(`overrides` 의 "s:<id>"·"e:<id>")만 쓴다.
//!   남긴 말과 지운 말 사이 경계를 고치면 그 자리 컷을 새 경계에 맞춘다: 여유(pad)는 주되 지운 말 소리 안으로는 넘지 않게.
//!   남긴 말끼리의 컷(공백 컷 등)에 이미 미세 조정 값이 있으면 단어가 움직인 만큼 같이 옮긴다.
use crate::model::{EditSettings, Overrides, Word};

/// 단어 하나의 가장 짧은 길이 (초)
pub const MIN_LEN: f64 = 0.02;

/// 같은 값으로 본다
const EPS: f64 = 1e-6;

/// 이 단어의 인식 원래 시각 (고친 적 없으면 지금 값)
pub fn original(w: &Word) -> (f64, f64) {
    let g = |k: &str, d: f64| w.extra.get(k).and_then(|v| v.as_f64()).unwrap_or(d);
    (g("sttStart", w.start), g("sttEnd", w.end))
}
/// 손으로 고친 단어인가
pub fn edited(w: &Word) -> bool {
    let (s, e) = original(w);
    (s - w.start).abs() > EPS || (e - w.end).abs() > EPS
}
fn remember(w: &mut Word) {
    if !w.extra.contains_key("sttStart") { w.extra.insert("sttStart".into(), serde_json::json!(w.start)); }
    if !w.extra.contains_key("sttEnd") { w.extra.insert("sttEnd".into(), serde_json::json!(w.end)); }
}
/// 원래 값으로 돌아왔으면 기록을 지운다 (파일을 깨끗하게)
fn tidy_memo(w: &mut Word) { if !edited(w) { w.extra.remove("sttStart"); w.extra.remove("sttEnd"); } }

fn timed(words: &[Word], i: Option<usize>) -> Option<usize> { i.filter(|&k| k < words.len() && words[k].timed()) }

/// 단어 i 의 시작('S') 또는 끝('E') 을 val 로. 앞뒤 단어와 겹치지 않게 이웃 단어의 맞닿은 쪽을 밀어 주고
/// (이웃 단어도 MIN_LEN 보다 짧아지지는 않음), 그 경계의 컷을 맞춘다. 실제로 넣은 값을 돌려준다.
pub fn set_edge(words: &mut [Word], ov: &mut Overrides, s: &EditSettings, i: usize, edge: char, val: f64) -> f64 {
    if i >= words.len() || !words[i].timed() || !val.is_finite() { return val; }
    let prev = timed(words, i.checked_sub(1));
    let next = timed(words, Some(i + 1));
    let (l, r) = if edge == 'S' { (prev, Some(i)) } else { (Some(i), next) };
    let old_l_end = l.map(|k| words[k].end);
    let old_r_start = r.map(|k| words[k].start);
    let v = if edge == 'S' {
        let lo = prev.map(|p| words[p].start + MIN_LEN).unwrap_or(0.0).max(0.0);
        let hi = words[i].end - MIN_LEN;
        let v = if hi < lo { words[i].start } else { val.clamp(lo, hi) };
        remember(&mut words[i]); words[i].start = v;
        if let Some(p) = prev { if words[p].end > v { remember(&mut words[p]); words[p].end = v; } }
        v
    } else {
        let lo = words[i].start + MIN_LEN;
        let hi = next.map(|n| words[n].end - MIN_LEN).unwrap_or(f64::INFINITY);
        let v = if hi < lo { words[i].end } else { val.clamp(lo, hi) };
        remember(&mut words[i]); words[i].end = v;
        if let Some(n) = next { if words[n].start < v { remember(&mut words[n]); words[n].start = v; } }
        v
    };
    refit(words, ov, s, l, r, old_l_end, old_r_start);
    for k in [prev, Some(i), next].into_iter().flatten() { tidy_memo(&mut words[k]); }
    v
}

/// 단어 i 를 인식 원래 시각으로 (이웃을 민 것은 이웃 단어 쪽에서 따로 되돌린다)
pub fn reset(words: &mut [Word], ov: &mut Overrides, s: &EditSettings, i: usize) {
    if i >= words.len() { return; }
    let (os, oe) = original(&words[i]);
    // 늘이는 쪽부터 (줄이는 쪽을 먼저 하면 MIN_LEN 제한에 걸릴 수 있다)
    if os < words[i].start { set_edge(words, ov, s, i, 'S', os); set_edge(words, ov, s, i, 'E', oe); }
    else { set_edge(words, ov, s, i, 'E', oe); set_edge(words, ov, s, i, 'S', os); }
}

/// 경계 (왼쪽 단어 l 의 끝 | 오른쪽 단어 r 의 시작) 의 컷을 새 단어 시각에 맞춘다
fn refit(words: &mut [Word], ov: &mut Overrides, s: &EditSettings, l: Option<usize>, r: Option<usize>, old_l_end: Option<f64>, old_r_start: Option<f64>) {
    let pad_b = if s.pad_before.is_finite() { s.pad_before.max(0.0) } else { 0.0 };
    let pad_a = if s.pad_after.is_finite() { s.pad_after.max(0.0) } else { 0.0 };
    // 두 단어가 모두 인식 원래 시각이면 (원래대로) 그 자리 컷도 처음처럼 자동으로
    let both_orig = matches!((l, r), (Some(a), Some(b)) if !edited(&words[a]) && !edited(&words[b]));
    let set = |ov: &mut Overrides, key: String, v: f64, natural: f64| { if both_orig || (v - natural).abs() < EPS { ov.remove(&key); } else { ov.insert(key, v); } };
    let shift = |ov: &mut Overrides, key: String, d: f64| { if d.abs() > 0.0 { if let Some(x) = ov.get_mut(&key) { *x += d; } } };
    match (l, r) {
        // 남긴 말 | 지운 말: 남긴 말 끝 + 여유, 다만 지운 말 시작은 넘지 않게
        (Some(a), Some(b)) if !words[a].del && words[b].del => {
            let natural = words[a].end + pad_a;
            let cut = natural.min(words[b].start).max(words[a].end);
            set(ov, format!("e:{}", words[a].id), cut, natural);
        }
        // 지운 말 | 남긴 말: 남긴 말 시작 - 여유, 다만 지운 말 끝보다 앞으로는 가지 않게
        (Some(a), Some(b)) if words[a].del && !words[b].del => {
            let natural = (words[b].start - pad_b).max(0.0);
            let cut = natural.max(words[a].end).min(words[b].start);
            set(ov, format!("s:{}", words[b].id), cut, natural);
        }
        // 남긴 말끼리: 컷이 있으면 (공백 컷·미세 조정 컷) 그 미세 조정 값을 단어와 같이 옮긴다. 붙어 있으면 할 일 없음
        (Some(a), Some(b)) if !words[a].del && !words[b].del => {
            if words[b].cut_before {
                shift(ov, format!("e:{}", words[a].id), words[a].end - old_l_end.unwrap_or(words[a].end));
                shift(ov, format!("s:{}", words[b].id), words[b].start - old_r_start.unwrap_or(words[b].start));
            }
        }
        (Some(a), None) if !words[a].del => shift(ov, format!("e:{}", words[a].id), words[a].end - old_l_end.unwrap_or(words[a].end)),
        (None, Some(b)) if !words[b].del => shift(ov, format!("s:{}", words[b].id), words[b].start - old_r_start.unwrap_or(words[b].start)),
        _ => {}
    }
}
