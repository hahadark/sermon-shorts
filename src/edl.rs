//! 편집 모델 (기존 src/shared/edl.js 를 그대로 옮김). 모든 시각은 원본 파일 기준 초.
//! 출력 시각(out)은 남긴 구간을 이어 붙인 결과 기준.
use crate::linebreak;
use crate::model::{EditSettings, Overrides, Word};
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

static SENTENCE_END: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"[.?!。？！]["'”’」』)\]]*$"#).unwrap());
const LINE_PAUSE: f64 = 0.6;
const LINE_GAP: f64 = 0.8;
const LINE_TAIL: f64 = 0.3;
const EPS: f64 = 1e-9;

fn clamp(x: f64, lo: f64, hi: f64) -> f64 { if x < lo { lo } else if x > hi { hi } else { x } }
fn jsmin(a: f64, b: f64) -> f64 { if a < b { a } else { b } }
fn jsmax(a: f64, b: f64) -> f64 { if a > b { a } else { b } }

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: String,
    pub first_word_id: i64,
    pub last_word_id: i64,
    pub start: f64,
    pub end: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub piece: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Piece { pub a: usize, pub b: usize }

// ---------------------------------------------------------------- 출력 순서

/// 출력 순서(order = 조각 첫 단어 id 들) → 출력 순서의 원본 단어 번호 범위 [a, b)
pub fn order_pieces(words: &[Word], order: Option<&[i64]>) -> Vec<Piece> {
    let n = words.len();
    if n == 0 { return vec![]; }
    let idx: HashMap<i64, usize> = words.iter().enumerate().map(|(i, w)| (w.id, i)).collect();
    let mut listed = vec![];
    let mut seen = HashSet::new();
    for id in order.unwrap_or(&[]) { if let Some(&k) = idx.get(id) { if seen.insert(k) { listed.push(k); } } }
    if listed.is_empty() { return vec![Piece { a: 0, b: n }]; }
    let mut bounds = listed.clone();
    if !seen.contains(&0) { bounds.push(0); }
    bounds.sort();
    let end_of: HashMap<usize, usize> = bounds.iter().enumerate().map(|(q, &a)| (a, if q + 1 < bounds.len() { bounds[q + 1] } else { n })).collect();
    let mut out: Vec<Piece> = listed.iter().map(|&a| Piece { a, b: end_of[&a] }).collect();
    for &a in &bounds {
        if seen.contains(&a) { continue; }
        let piece = Piece { a, b: end_of[&a] };
        match out.iter().position(|p| p.b == a) { None => out.insert(0, piece), Some(k) => out.insert(k + 1, piece) }
    }
    merge_pieces(&out)
}
fn merge_pieces(list: &[Piece]) -> Vec<Piece> {
    let mut merged: Vec<Piece> = vec![];
    for p in list { if let Some(last) = merged.last_mut() { if last.b == p.a { last.b = p.b; continue; } } merged.push(*p); }
    merged
}
fn pieces_to_order(words: &[Word], pieces: &[Piece]) -> Option<Vec<i64>> {
    if pieces.len() <= 1 { return None; }
    Some(pieces.iter().map(|p| words[p.a].id).collect())
}
/// 원본 단어 [from, to) 를 원본 단어 before 앞으로 (None 이면 맨 끝) → 새 order (원본 순서면 None)
pub fn move_range(words: &[Word], order: Option<&[i64]>, from: usize, to: usize, before: Option<usize>) -> Option<Vec<i64>> {
    let keep = || order.map(|o| o.to_vec());
    let n = words.len();
    if n == 0 || to <= from || to > n { return keep(); }
    if let Some(b) = before { if b >= from && b < to { return keep(); } }
    let mut pieces = order_pieces(words, order);
    let mut cut_at = |x: Option<usize>| {
        let Some(x) = x else { return };
        if x == 0 || x >= n { return; }
        if let Some(k) = pieces.iter().position(|p| x > p.a && x < p.b) {
            let p = pieces[k];
            pieces.splice(k..=k, [Piece { a: p.a, b: x }, Piece { a: x, b: p.b }]);
        }
    };
    cut_at(Some(from)); cut_at(Some(to)); cut_at(before);
    let (moving, rest): (Vec<Piece>, Vec<Piece>) = pieces.iter().partition(|p| p.a >= from && p.b <= to);
    if moving.is_empty() { return keep(); }
    let at = match before { None => rest.len(), Some(b) => match rest.iter().position(|p| p.a == b) { Some(k) => k, None => return keep() } };
    let mut next = rest[..at].to_vec();
    next.extend(moving);
    next.extend_from_slice(&rest[at..]);
    pieces_to_order(words, &merge_pieces(&next))
}
pub fn has_order(words: &[Word], order: Option<&[i64]>) -> bool { order_pieces(words, order).len() > 1 }

// ---------------------------------------------------------------- 구간

/// 지워지지 않은 연속 단어 묶음 → 구간 (order 가 있으면 조각을 그 순서로)
pub fn build_segments(words: &[Word], s: &EditSettings, ov: &Overrides, duration: Option<f64>, order: Option<&[i64]>) -> Vec<Segment> {
    if words.is_empty() { return vec![]; }
    if order.is_some_and(|o| !o.is_empty()) {
        let pcs = order_pieces(words, order);
        if pcs.len() > 1 {
            let live = |w: Option<&Word>| w.is_some_and(|w| !w.del && w.timed());
            let mut all = vec![];
            for (k, p) in pcs.iter().enumerate() {
                let mut ps = build_segments(&words[p.a..p.b], s, ov, duration, None);
                // 조각 경계: 원래 이어지던 이웃 단어가 남아 있으면 패딩을 두 단어 사이 가운데까지만 (미세 조정 값은 그대로)
                if !ps.is_empty() {
                    let fw = words.get(p.a);
                    let pw = if p.a > 0 { words.get(p.a - 1) } else { None };
                    if let Some(fw) = fw.filter(|fw| ps[0].first_word_id == fw.id) {
                        if live(pw) && live(Some(fw)) && !ov.get(&format!("s:{}", fw.id)).is_some_and(|v| v.is_finite()) {
                            let pw = pw.unwrap();
                            ps[0].start = jsmax(ps[0].start, jsmin(fw.start, (pw.end + fw.start) / 2.0));
                        }
                    }
                    let lw = words.get(p.b - 1);
                    let nw = words.get(p.b);
                    let li = ps.len() - 1;
                    if let Some(lw) = lw.filter(|lw| ps[li].last_word_id == lw.id) {
                        if live(nw) && live(Some(lw)) && !ov.get(&format!("e:{}", lw.id)).is_some_and(|v| v.is_finite()) {
                            let nw = nw.unwrap();
                            ps[li].end = jsmin(ps[li].end, jsmax(lw.end, (lw.end + nw.start) / 2.0));
                        }
                    }
                }
                for mut seg in ps { if seg.end > seg.start { seg.piece = Some(k); all.push(seg); } }
            }
            return all;
        }
    }
    let pad_before = if s.pad_before.is_finite() { s.pad_before } else { 0.0 };
    let pad_after = if s.pad_after.is_finite() { s.pad_after } else { 0.0 };
    let dur = match duration { Some(d) if d.is_finite() && d > 0.0 => d, _ => f64::INFINITY };
    // 1) 연속된 남은 단어 묶기
    struct G { first: i64, last: i64, start: f64, end: f64 }
    let mut groups: Vec<G> = vec![];
    let mut cur: Option<G> = None;
    for w in words {
        if w.del || !w.timed() {
            if w.del { if let Some(c) = cur.take() { groups.push(c); } }
            continue;
        }
        if w.cut_before { if let Some(c) = cur.take() { groups.push(c); } }
        match cur.as_mut() {
            None => cur = Some(G { first: w.id, last: w.id, start: w.start, end: w.end }),
            Some(c) => { c.last = w.id; if w.start < c.start { c.start = w.start; } if w.end > c.end { c.end = w.end; } }
        }
    }
    if let Some(c) = cur { groups.push(c); }
    // 2) 패딩, 미세 조정, 범위 안으로
    let mut segs: Vec<Segment> = vec![];
    for g in groups {
        let mut start = g.start - pad_before;
        let mut end = g.end + pad_after;
        if let Some(&os) = ov.get(&format!("s:{}", g.first)) { if os.is_finite() && os < end { start = os; } }
        if let Some(&oe) = ov.get(&format!("e:{}", g.last)) { if oe.is_finite() && oe > start { end = oe; } }
        start = clamp(start, 0.0, dur);
        end = clamp(end, 0.0, dur);
        if !(end > start) { continue; }
        segs.push(Segment { id: format!("seg:{}", g.first), first_word_id: g.first, last_word_id: g.last, start, end, piece: None });
    }
    // 3) 겹치면 합치기
    let mut merged: Vec<Segment> = vec![];
    for s in segs {
        if let Some(prev) = merged.last_mut() {
            if s.start <= prev.end {
                prev.start = jsmin(prev.start, s.start);
                prev.end = jsmax(prev.end, s.end);
                prev.last_word_id = s.last_word_id;
                continue;
            }
        }
        merged.push(s);
    }
    merged
}

pub fn segments_duration(segs: &[Segment]) -> f64 { segs.iter().fold(0.0, |a, s| a + (s.end - s.start)) }

/// 원본 시각 → 출력 시각. 구간 밖이면 None
pub fn src_to_out(segs: &[Segment], t: f64) -> Option<f64> {
    if !t.is_finite() { return None; }
    let mut off = 0.0;
    for s in segs {
        if t >= s.start - EPS && t <= s.end + EPS { return Some(off + clamp(t - s.start, 0.0, s.end - s.start)); }
        off += s.end - s.start;
    }
    None
}

/// 출력 시각 → (구간 번호, 원본 시각). 범위 밖이면 양끝으로
pub fn out_to_src(segs: &[Segment], out_t: f64) -> Option<(usize, f64)> {
    if segs.is_empty() || !out_t.is_finite() { return None; }
    if out_t <= 0.0 { return Some((0, segs[0].start)); }
    let mut off = 0.0;
    for (i, s) in segs.iter().enumerate() {
        let d = s.end - s.start;
        if out_t < off + d || i == segs.len() - 1 { return Some((i, s.start + clamp(out_t - off, 0.0, d))); }
        off += d;
    }
    None
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CutPoint { pub index: usize, pub out_end: f64, pub in_start: f64, pub key_end: String, pub key_start: String }
pub fn cut_points(segs: &[Segment]) -> Vec<CutPoint> {
    (0..segs.len().saturating_sub(1)).map(|i| CutPoint {
        index: i, out_end: segs[i].end, in_start: segs[i + 1].start,
        key_end: format!("e:{}", segs[i].last_word_id), key_start: format!("s:{}", segs[i + 1].first_word_id),
    }).collect()
}

// ---------------------------------------------------------------- 자막 줄

pub fn char_count(text: &str) -> usize { text.chars().filter(|c| !c.is_whitespace()).count() }

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct LinePart { pub id: i64, pub text: String, pub from: usize, pub to: usize }

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub text: String,
    pub words: Vec<i64>,
    pub parts: Vec<LinePart>,
    pub out_start: f64,
    pub out_end: f64,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub manual_merge: bool,
}

#[derive(Clone)]
struct Item { id: i64, text: String, br: bool, out_start: f64, out_end: f64, len: usize, text_from: usize, text_to: usize, piece: Option<usize>, piece_start: bool }

/// JS 의 /\s+(?=\S*$)/ : 마지막 공백 덩어리 (뒤에 공백이 더 없는 것). → (바이트 위치, 바이트 길이)
fn last_space_run(text: &str) -> Option<(usize, usize)> {
    // 끝의 공백 아닌 글자를 떼면 마지막 공백 덩어리가 끝에 오고, 그 공백을 더 떼면 그 덩어리의 시작이 나온다
    let t = text.trim_end_matches(|c: char| !c.is_whitespace());
    let end = t.len();
    let start = t.trim_end_matches(char::is_whitespace).len();
    if end == start { None } else { Some((start, end - start)) }
}
fn js_trim(s: &str) -> &str { s.trim() }

pub fn build_lines(words: &[Word], segs: &[Segment], s: &EditSettings) -> Vec<Line> {
    if words.is_empty() || segs.is_empty() { return vec![]; }
    let max_chars = match s.max_line_chars { Some(m) if m.is_finite() && m > 0.0 => (m.floor().min(200.0)).max(1.0) as usize, _ => 14 };
    let total = segments_duration(segs);
    let mut seg_off = vec![];
    let mut acc = 0.0;
    for sg in segs { seg_off.push(acc); acc += sg.end - sg.start; }
    // 단어 → 구간: 구간의 firstWordId..lastWordId 원본 번호 범위
    let w_idx: HashMap<i64, usize> = words.iter().enumerate().map(|(i, w)| (w.id, i)).collect();
    let mut seg_of: Vec<Option<usize>> = vec![None; words.len()];
    for (sk, sg) in segs.iter().enumerate() {
        let (Some(&ia), Some(&ib)) = (w_idx.get(&sg.first_word_id), w_idx.get(&sg.last_word_id)) else { continue };
        for wj in ia..=ib.min(words.len().saturating_sub(1)) { if seg_of[wj].is_none() { seg_of[wj] = Some(sk); } }
    }
    let mut items: Vec<Item> = vec![];
    for (i, w) in words.iter().enumerate() {
        let Some(si) = seg_of[i] else { continue };
        if w.del || !w.timed() || char_count(&w.text) == 0 { continue; }
        let sg = &segs[si];
        let a = clamp(w.start, sg.start, sg.end);
        let mut b = clamp(w.end, sg.start, sg.end);
        if b < a { b = a; }
        items.push(Item { id: w.id, text: w.text.clone(), br: w.br, out_start: seg_off[si] + (a - sg.start), out_end: seg_off[si] + (b - sg.start),
            len: char_count(&w.text), text_from: 0, text_to: w.text.chars().count(), piece: sg.piece, piece_start: false });
    }
    if items.is_empty() { return vec![]; }
    let by_id: HashMap<i64, &Word> = words.iter().map(|w| (w.id, w)).collect();

    // 손으로 나눈 자리(captionSplits): 표시만 나눈다
    let mut manual = vec![];
    for item in items {
        let w = by_id[&item.id];
        let chars: Vec<char> = item.text.chars().collect();
        let mut pts: Vec<usize> = vec![];
        if let Some(marks) = &w.caption_splits {
            for &c in marks {
                let c = c.round();
                if !c.is_finite() || c <= 0.0 || c >= chars.len() as f64 { continue; }
                let c = c as usize;
                if !pts.contains(&c) { pts.push(c); }
            }
        }
        pts.sort();
        let mut pieces: Vec<(String, usize, usize)> = vec![];
        if !pts.is_empty() {
            let mut bounds = vec![0];
            bounds.extend(&pts);
            bounds.push(chars.len());
            for k in 0..bounds.len() - 1 {
                let t: String = chars[bounds[k]..bounds[k + 1]].iter().collect();
                if !t.trim().is_empty() { pieces.push((t, bounds[k], bounds[k + 1])); }
            }
        }
        if pieces.len() < 2 { manual.push(item); continue; }
        let tot: usize = pieces.iter().map(|p| char_count(&p.0)).sum();
        let np = pieces.len();
        let mut used = 0usize;
        for (idx, (t, from, to)) in pieces.into_iter().enumerate() {
            let len = char_count(&t);
            let d = item.out_end - item.out_start;
            let begin = item.out_start + d * (if tot > 0 { used as f64 / tot as f64 } else { idx as f64 / np as f64 });
            used += len;
            let finish = item.out_start + d * (if tot > 0 { used as f64 / tot as f64 } else { (idx + 1) as f64 / np as f64 });
            manual.push(Item { text: t, br: if idx == np - 1 { item.br } else { true }, out_start: begin, out_end: finish, len, text_from: from, text_to: to, ..item.clone() });
        }
    }
    items = manual;

    // 엄격한 최대 글자: 표시 항목만 나눈다
    if s.split_long_words {
        let mut out = vec![];
        for item in items {
            if item.len <= max_chars { out.push(item); continue; }
            let mut parts: Vec<String> = vec![];
            let mut text = String::new();
            let mut count = 0usize;
            for ch in js_trim(&item.text).chars() {
                let visible = !ch.is_whitespace();
                if visible && count >= max_chars {
                    match last_space_run(&text) {
                        Some((bi, bl)) if bi > 0 => {
                            parts.push(text[..bi].trim().to_string());
                            text = text[bi + bl..].to_string();
                            count = char_count(&text);
                        }
                        _ => { parts.push(text.trim().to_string()); text.clear(); count = 0; }
                    }
                }
                text.push(ch);
                if visible { count += 1; }
            }
            if !text.trim().is_empty() { parts.push(text.trim().to_string()); }
            let mut consumed = 0usize;
            let src: Vec<char> = item.text.chars().collect();
            let mut off = 0usize;
            let base = item.text_from;
            let np = parts.len();
            for (index, part) in parts.into_iter().enumerate() {
                while off < src.len() && src[off].is_whitespace() { off += 1; }
                let plen = part.chars().count();
                let tf = base + off;
                let tt = base + off + plen;
                off += plen;
                let len = char_count(&part);
                let d = item.out_end - item.out_start;
                let begin = item.out_start + d * consumed as f64 / item.len as f64;
                consumed += len;
                out.push(Item { text: part, br: index == np - 1 && item.br, out_start: begin, out_end: item.out_start + d * consumed as f64 / item.len as f64, len, text_from: tf, text_to: tt, ..item.clone() });
            }
        }
        items = out;
    }

    // 출력 순서대로. 조각이 바뀌는 곳은 다른 내용이므로 줄을 꼭 바꾼다
    items.sort_by(|x, y| x.out_start.partial_cmp(&y.out_start).unwrap_or(std::cmp::Ordering::Equal));
    for pi in 1..items.len() { if items[pi].piece != items[pi - 1].piece { items[pi].piece_start = true; } }

    // 줄 나누기
    let mut groups: Vec<Vec<Item>> = vec![];
    if s.semantic_breaks {
        let mut runs: Vec<Vec<Item>> = vec![];
        let mut run: Vec<Item> = vec![];
        for cur in items {
            if let Some(pv) = run.last() {
                let pt = pv.text.trim();
                if cur.piece_start || pv.br || SENTENCE_END.is_match(pt) || cur.out_start - pv.out_end > LINE_PAUSE || linebreak::is_sentence_end(pt) {
                    runs.push(std::mem::take(&mut run));
                }
            }
            run.push(cur);
        }
        if !run.is_empty() { runs.push(run); }
        for r in runs {
            let ri: Vec<linebreak::RunItem> = r.iter().enumerate().map(|(idx, x)| linebreak::RunItem { text: &x.text, len: x.len, gap_before: if idx > 0 { x.out_start - r[idx - 1].out_end } else { 0.0 } }).collect();
            let counts = linebreak::split_run(&ri, max_chars);
            let mut at = 0;
            for c in counts { groups.push(r[at..at + c].to_vec()); at += c; }
        }
    } else {
        let mut cur: Vec<Item> = vec![];
        let mut cur_len = 0usize;
        for it in items {
            if let Some(prev) = cur.last() {
                let brk = it.piece_start || prev.br || SENTENCE_END.is_match(prev.text.trim()) || it.out_start - prev.out_end > LINE_PAUSE || cur_len + it.len > max_chars;
                if brk { groups.push(std::mem::take(&mut cur)); cur_len = 0; }
            }
            cur_len += it.len;
            cur.push(it);
        }
        if !cur.is_empty() { groups.push(cur); }
    }

    let mut lines: Vec<(Line, f64)> = groups.iter().map(|g| {
        let text = g.iter().map(|x| x.text.trim()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join(" ");
        (Line { text, words: g.iter().map(|x| x.id).collect(), parts: g.iter().map(|x| LinePart { id: x.id, text: x.text.trim().to_string(), from: x.text_from, to: x.text_to }).collect(),
            out_start: g[0].out_start, out_end: 0.0, manual_merge: false }, g[g.len() - 1].out_end)
    }).collect();
    let n = lines.len();
    for k in 0..n {
        let last_end = lines[k].1;
        let mut end = if k + 1 < n {
            let ns = lines[k + 1].0.out_start;
            if ns - last_end >= LINE_GAP { jsmin(ns, last_end + LINE_TAIL) } else { ns }
        } else { jsmin(total, last_end + LINE_TAIL) };
        if end < lines[k].0.out_start { end = lines[k].0.out_start; }
        lines[k].0.out_end = end;
    }
    let mut lines: Vec<Line> = lines.into_iter().map(|x| x.0).collect();

    // 손으로 합친 줄 (captionMerges)
    let mut ranges: Vec<(usize, usize)> = vec![];
    for w in words {
        for m in w.caption_merges.iter().flatten() {
            let start = lines.iter().position(|l| l.parts.iter().any(|p| p.id == m.start_id && { let o = m.start_offset.unwrap_or(0.0); (p.from as f64) <= o && (p.to as f64) > o }));
            let mut end: Option<usize> = None;
            for (i, l) in lines.iter().enumerate() {
                if l.parts.iter().any(|p| p.id == m.end_id && m.end_offset.is_none_or(|o| (p.from as f64) < o && (p.to as f64) >= o)) { end = Some(i); }
            }
            if let (Some(a), Some(b)) = (start, end) { if b > a { ranges.push((a, b)); } }
        }
    }
    ranges.sort_by_key(|r| r.0);
    let mut merged: Vec<(usize, usize)> = vec![];
    for r in ranges { if let Some(prev) = merged.last_mut() { if r.0 <= prev.1 { prev.1 = prev.1.max(r.1); continue; } } merged.push(r); }
    for &(a, b) in merged.iter().rev() {
        let sel: Vec<Line> = lines[a..=b].to_vec();
        let mut text = sel[0].text.clone();
        let mut parts = sel[0].parts.clone();
        for q in &sel[1..] {
            let last = parts.last().unwrap();
            let next = &q.parts[0];
            if !(last.id == next.id && last.to == next.from) { text.push(' '); }
            text.push_str(&q.text);
            parts.extend(q.parts.iter().cloned());
        }
        let line = Line { text, words: parts.iter().map(|p| p.id).collect(), parts, out_start: sel[0].out_start, out_end: sel[sel.len() - 1].out_end, manual_merge: true };
        lines.splice(a..=b, [line]);
    }
    lines
}

// ---------------------------------------------------------------- SRT·시간 표시

struct Hms { h: i64, m: i64, s: i64, ms: i64 }
fn split_ms(sec: f64) -> Hms {
    let total_ms = (if sec.is_finite() { sec.max(0.0) } else { 0.0 } * 1000.0 + 0.5).floor() as i64;   // JS Math.round (양수)
    let ms = total_ms % 1000;
    let total_s = (total_ms - ms) / 1000;
    Hms { h: total_s / 3600, m: (total_s / 60) % 60, s: total_s % 60, ms }
}
pub fn srt_time(sec: f64) -> String { let p = split_ms(sec); format!("{:02}:{:02}:{:02},{:03}", p.h, p.m, p.s, p.ms) }
pub fn to_srt(lines: &[Line]) -> String {
    lines.iter().enumerate().map(|(i, l)| format!("{}\n{} --> {}\n{}\n", i + 1, srt_time(l.out_start), srt_time(l.out_end), l.text.replace('*', ""))).collect::<Vec<_>>().join("\n")
}
/// "MM:SS.mmm" (1시간 넘으면 "H:MM:SS.mmm")
pub fn format_time(sec: f64, with_ms: bool) -> String {
    let p = if with_ms { split_ms(sec) } else { split_ms((if sec.is_finite() { sec.max(0.0) } else { 0.0 }).floor()) };
    let mut s = if p.h > 0 { format!("{}:{:02}:{:02}", p.h, p.m, p.s) } else { format!("{:02}:{:02}", p.m, p.s) };
    if with_ms { s.push_str(&format!(".{:03}", p.ms)); }
    s
}

/// 소리 맞추기 (edl.js snap): 'zero' = ±window 안 가장 가까운 0 교차, 'silence' = ±0.15초 안 RMS 가장 낮은 10ms 창의 가운데. t 는 pcm 앞에서부터 초
pub fn snap(pcm: &[f32], rate: f64, t: f64, mode: &str, window_sec: f64) -> f64 {
    if pcm.is_empty() || !(rate > 0.0) || !t.is_finite() { return t; }
    let window_sec = if window_sec.is_finite() { window_sec } else { 0.05 };
    let n = pcm.len() as i64;
    let c = (t * rate).round() as i64;
    match mode {
        "zero" => {
            let win = ((window_sec * rate).round() as i64).max(1);
            let (lo, hi) = ((c - win).max(0), (c + win).min(n - 1));
            if lo >= hi { return t; }
            let (mut best, mut best_d) = (-1i64, i64::MAX);
            for i in lo..hi {
                let (a, b) = (pcm[i as usize], pcm[i as usize + 1]);
                let cand = if a == 0.0 { i } else if b == 0.0 { i + 1 } else if (a < 0.0) != (b < 0.0) { if a.abs() <= b.abs() { i } else { i + 1 } } else { -1 };
                if cand < 0 { continue; }
                let d = (cand - c).abs();
                if d < best_d { best_d = d; best = cand; }
            }
            if best < 0 { t } else { best as f64 / rate }
        }
        "silence" => {
            let range = (0.15 * rate).round() as i64;
            let w = ((0.01 * rate).round() as i64).max(1);
            if w > n { return t; }
            let half = w / 2;
            let (s_lo, s_hi) = ((c - range - half).max(0), (c + range - half).min(n - w));
            if s_lo > s_hi { return t; }
            let mut pre = vec![0f64; n as usize + 1];
            for k in 0..n as usize { pre[k + 1] = pre[k] + pcm[k] as f64 * pcm[k] as f64; }
            let (mut best_s, mut best_e, mut best_d) = (-1i64, f64::INFINITY, i64::MAX);
            for st in s_lo..=s_hi {
                let e = pre[(st + w) as usize] - pre[st as usize];
                let dd = (st + half - c).abs();
                if e < best_e - 1e-12 || ((e - best_e).abs() <= 1e-12 && dd < best_d) { best_e = e; best_s = st; best_d = dd; }
            }
            if best_s < 0 { t } else { (best_s + half) as f64 / rate }
        }
        _ => t,
    }
}