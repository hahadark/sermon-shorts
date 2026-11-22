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

/// 두 단어가 맞닿았다고 보는 틈 (초). 맞닿은 단어의 경계는 함께 움직인다
pub const TOUCH: f64 = 0.015;
/// 이만큼 안쪽으로 붙은 이웃 단어는 한 경계로 본다 (초): 한쪽을 옮기면 다른 쪽이 따라와 붙는다. 이보다 긴 틈은 쉼으로 보고 따로 둔다
pub const JOIN_GAP: f64 = 0.3;

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

/// 단어 i 의 시작('S') 또는 끝('E') 을 val 로. 이웃 단어와 붙어 있으면 (틈 JOIN_GAP 이하) 그 경계를 함께 옮긴다
/// (줄여도 단어 사이에 빈 곳이 생기지 않는다. 빈 곳은 [나누기] 로 만든 빈 조각으로만 생긴다).
/// 떨어져 있던 이웃은 겹칠 때만 밀어 준다 (이웃 단어도 MIN_LEN 보다 짧아지지는 않음).
/// 그 경계의 컷을 맞추고 실제로 넣은 값을 돌려준다.
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
        let touching = prev.is_some_and(|p| words[i].start - words[p].end <= JOIN_GAP);
        remember(&mut words[i]); words[i].start = v;
        if let Some(p) = prev { if words[p].end > v || touching { remember(&mut words[p]); words[p].end = v; } }
        v
    } else {
        let lo = words[i].start + MIN_LEN;
        let hi = next.map(|n| words[n].end - MIN_LEN).unwrap_or(f64::INFINITY);
        let v = if hi < lo { words[i].end } else { val.clamp(lo, hi) };
        let touching = next.is_some_and(|n| words[n].start - words[i].end <= JOIN_GAP);
        remember(&mut words[i]); words[i].end = v;
        if let Some(n) = next { if words[n].start < v || touching { remember(&mut words[n]); words[n].start = v; } }
        v
    };
    refit(words, ov, s, l, r, old_l_end, old_r_start);
    for k in [prev, Some(i), next].into_iter().flatten() { tidy_memo(&mut words[k]); }
    v
}

/// 단어 i 를 인식 원래 시각으로. 맞닿아 있던 이웃의 경계도 그 이웃의 인식 값으로 함께 돌린다 (처음부터 있던 쉼만 다시 생긴다)
pub fn reset(words: &mut [Word], ov: &mut Overrides, s: &EditSettings, i: usize) {
    if i >= words.len() { return; }
    if !words[i].timed() { return; }
    let (os, oe) = original(&words[i]);
    let prev = timed(words, i.checked_sub(1));
    let next = timed(words, Some(i + 1));
    let (old_s, old_e) = (words[i].start, words[i].end);
    let old_p_end = prev.map(|p| words[p].end);
    let old_n_start = next.map(|n| words[n].start);
    let touch_p = prev.is_some_and(|p| (old_s - words[p].end).abs() <= TOUCH);
    let touch_n = next.is_some_and(|n| (words[n].start - old_e).abs() <= TOUCH);
    // 이 단어를 인식 값으로 (이웃이 MIN_LEN 은 남게)
    let lo = prev.map(|p| words[p].start + MIN_LEN).unwrap_or(0.0).max(0.0);
    let hi = next.map(|n| words[n].end - MIN_LEN).unwrap_or(f64::INFINITY);
    let ns = if os < lo { lo } else { os };
    let ne = if oe > hi { hi } else { oe };
    if ne - ns < MIN_LEN { return; }
    words[i].start = ns; words[i].end = ne;
    // 맞닿아 있던 (또는 겹치게 된) 이웃의 경계는 그 이웃의 인식 값으로, 다만 이 단어와 겹치지 않게
    if let Some(p) = prev { if touch_p || words[p].end > ns { let poe = original(&words[p]).1; remember(&mut words[p]); words[p].end = poe.min(ns).max(words[p].start + MIN_LEN); } }
    if let Some(n) = next { if touch_n || words[n].start < ne { let nos = original(&words[n]).0; remember(&mut words[n]); words[n].start = nos.max(ne).min(words[n].end - MIN_LEN); } }
    refit(words, ov, s, prev, Some(i), old_p_end, Some(old_s));
    refit(words, ov, s, Some(i), next, Some(old_e), old_n_start);
    for k in [prev, Some(i), next].into_iter().flatten() { tidy_memo(&mut words[k]); }
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

// ---------------------------------------------------------------- 조각 나누기 · 지우기 · 공백 없애기

/// 글자가 없는 조각 (나누기로 생긴 빈 조각: 소리만 있고 자막에는 안 나온다)
pub fn blank(w: &Word) -> bool { w.text.trim().is_empty() }
/// 빈 조각이 뒤 말에 딸린 것인가 (단어의 앞부분을 잘라 낸 조각)
pub fn joins_next(w: &Word) -> bool { w.extra.get("joinNext").and_then(|v| v.as_bool()) == Some(true) }

/// 없앨 수 있는 가장 짧은 공백 (초)
pub const MIN_GAP: f64 = 0.04;
/// 공백을 없앨 때 말 양끝에 남기는 숨 (초). 공백이 짧으면 그 1/4 까지만
pub const GAP_KEEP: f64 = 0.03;

/// 단어 i 를 원본 시각 t 에서 둘로 나눈다. 글자는 한쪽에만 남고 (text_first = 앞 조각) 다른 쪽은 빈 조각이 된다.
/// 단어 번호(id)를 0부터 다시 매기고 미세 조정 값·출력 순서·손으로 합친 자막 기록의 번호를 같이 옮긴다.
/// 예전 번호 → 새 번호 표를 돌려준다 (새로 생긴 조각은 i + 1 번째).
pub fn split(words: &mut Vec<Word>, ov: &mut Overrides, order: &mut Option<Vec<i64>>, i: usize, t: f64, text_first: bool) -> Option<std::collections::HashMap<i64, i64>> {
    if i >= words.len() || !words[i].timed() || !t.is_finite() { return None; }
    if t < words[i].start + MIN_LEN - EPS || t > words[i].end - MIN_LEN + EPS { return None; }
    let old_id = words[i].id;
    let mut second = words[i].clone();
    {
        let first = &mut words[i];
        first.end = t;
        first.br = false;
        first.extra.remove("sttEnd");
    }
    second.id = -1;
    second.start = t;
    second.cut_before = false;
    second.caption_merges = None;
    for k in ["sttStart", "fineCut", "gapCut"] { second.extra.remove(k); }
    let empty = |w: &mut Word| { w.text = String::new(); w.stt_text = Some(String::new()); w.caption_splits = None; w.extra.remove("_oldText"); };
    // 빈 조각이 어느 쪽 말에 딸린 것인지 (자막 칸을 묶을 때): 앞 조각이 비면 뒤 말 쪽(joinNext)
    let was_blank = blank(&words[i]);
    if text_first { empty(&mut second); } else { empty(&mut words[i]); }
    if !was_blank { second.extra.remove("joinNext"); if text_first { words[i].extra.remove("joinNext"); } else { words[i].extra.insert("joinNext".into(), serde_json::json!(true)); } }
    for w in [&mut words[i], &mut second] { tidy_memo(w); }
    words.insert(i + 1, second);
    // 번호 다시 매기기
    let mut map = std::collections::HashMap::new();
    for (k, w) in words.iter_mut().enumerate() { if w.id >= 0 && k != i + 1 { map.insert(w.id, k as i64); } w.id = k as i64; }
    let mut nov = Overrides::new();
    for (k, v) in ov.drain() {
        let Ok(id) = k[2..].parse::<i64>() else { continue };
        // 나눈 단어의 끝 값은 뒤 조각 것
        if id == old_id && k.starts_with("e:") { nov.insert(format!("e:{}", i + 1), v); continue; }
        if let Some(n) = map.get(&id) { nov.insert(format!("{}{}", &k[..2], n), v); }
    }
    *ov = nov;
    if let Some(o) = order.as_mut() { for x in o.iter_mut() { if let Some(n) = map.get(x) { *x = *n; } } }
    for w in words.iter_mut() {
        if let Some(ms) = w.caption_merges.as_mut() { for m in ms.iter_mut() { if let Some(n) = map.get(&m.start_id) { m.start_id = *n; } if let Some(n) = map.get(&m.end_id) { m.end_id = *n; } } }
    }
    Some(map)
}

/// 경계 (왼쪽 l | 오른쪽 r) 의 컷을 단어 끝에 바짝: 남긴 말 쪽 여유가 지운 말 소리 안으로 넘지 않게.
/// 둘 다 남긴 말이고 컷이 없으면 지울 때 넣었던 값을 치운다.
fn fit_del(words: &[Word], ov: &mut Overrides, s: &EditSettings, l: Option<usize>, r: Option<usize>) {
    let pad_b = if s.pad_before.is_finite() { s.pad_before.max(0.0) } else { 0.0 };
    let pad_a = if s.pad_after.is_finite() { s.pad_after.max(0.0) } else { 0.0 };
    let (Some(a), Some(b)) = (l, r) else { return };
    let (wa, wb) = (&words[a], &words[b]);
    match (wa.del, wb.del) {
        (false, true) => { let natural = wa.end + pad_a; let cut = natural.min(wb.start).max(wa.end); if (cut - natural).abs() < EPS { ov.remove(&format!("e:{}", wa.id)); } else { ov.insert(format!("e:{}", wa.id), cut); } }
        (true, false) => { let natural = (wb.start - pad_b).max(0.0); let cut = natural.max(wa.end).min(wb.start); if (cut - natural).abs() < EPS { ov.remove(&format!("s:{}", wb.id)); } else { ov.insert(format!("s:{}", wb.id), cut); } }
        (false, false) => { if !wb.cut_before { ov.remove(&format!("e:{}", wa.id)); ov.remove(&format!("s:{}", wb.id)); } }
        _ => {}
    }
}

/// 조각(단어) i 를 지우거나 되살린다. 양옆 경계의 컷을 조각 끝에 바짝 맞춰 지운 소리가 새지 않게 한다
pub fn set_del(words: &mut [Word], ov: &mut Overrides, s: &EditSettings, i: usize, del: bool) {
    if i >= words.len() { return; }
    words[i].del = del;
    // 지운 조각 앞에 있던 공백 컷 표시는 뜻이 없어진다 (되살리면 그냥 이어짐)
    if del && words[i].cut_before { words[i].cut_before = false; words[i].extra.remove("gapCut"); words[i].extra.remove("fineCut"); ov.remove(&format!("s:{}", words[i].id)); }
    let prev = timed(words, i.checked_sub(1));
    let next = timed(words, Some(i + 1));
    fit_del(words, ov, s, prev, Some(i));
    fit_del(words, ov, s, Some(i), next);
}

/// 이웃한 두 단어 a < b 사이 공백 (a 끝 ~ b 시작) 을 없앤다. 말 양끝에 아주 짧은 숨(GAP_KEEP)만 남긴다.
/// 남긴 말끼리면 그 자리에 공백 컷을 만들고 (자막 편집의 '✂ 공백' 표시·되살리기와 같은 것),
/// 한쪽이 지운 말이면 남긴 말 쪽 컷만 당긴다. 바뀐 것이 있으면 true
pub fn cut_gap(words: &mut [Word], ov: &mut Overrides, a: usize, b: usize, min_gap: f64) -> bool {
    if a >= b || b >= words.len() || !words[a].timed() || !words[b].timed() { return false; }
    let gap = words[b].start - words[a].end;
    if !(gap >= min_gap.max(MIN_GAP)) { return false; }
    let m = GAP_KEEP.min(gap * 0.25);
    let (e0, s1) = (words[a].end + m, words[b].start - m);
    let (ka, kb) = (format!("e:{}", words[a].id), format!("s:{}", words[b].id));
    let same = |ov: &Overrides, k: &str, v: f64| ov.get(k).is_some_and(|x| (x - v).abs() < EPS);
    match (words[a].del, words[b].del) {
        (false, false) => {
            if words[b].cut_before && same(ov, &ka, e0) && same(ov, &kb, s1) { return false; }
            let w = &mut words[b];
            w.cut_before = true; w.extra.remove("fineCut"); w.extra.insert("gapCut".into(), serde_json::json!(true));
            ov.insert(ka, e0); ov.insert(kb, s1);
            true
        }
        (false, true) => { if same(ov, &ka, e0) { return false; } ov.insert(ka, e0); true }
        (true, false) => { if same(ov, &kb, s1) { return false; } ov.insert(kb, s1); true }
        _ => false,
    }
}
