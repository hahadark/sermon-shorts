//! 출력 자막 고치기 (기존 src/shared/caption-edit.js 의 apply 를 옮김).
//! 고친 글을 인식 단어(STT)에 맞춰 나눠 넣는다. 소리 시각과 STT 원문(sttText)은 바뀌지 않는다.
use crate::edl::Line;
use crate::model::{CaptionMerge, Word};
use std::collections::HashMap;

pub fn source_text(w: &Word) -> String {
    if let Some(s) = &w.stt_text { return s.clone(); }
    if let Some(s) = w.extra.get("_oldText").and_then(|x| x.as_str()) { return s.to_string(); }
    w.text.clone()
}

/// 자막 줄 line 의 글을 text 로 고친 새 단어 목록
pub fn apply(words: &[Word], line: &Line, text: &str) -> Vec<Word> {
    let base = |w: &Word| { let mut n = w.clone(); n.stt_text = Some(source_text(w)); n };
    let parts = &line.parts;
    if parts.is_empty() { return words.iter().map(base).collect(); }
    let mut old: Vec<(String, usize)> = vec![];
    for (owner, p) in parts.iter().enumerate() { for tok in p.text.trim().split_whitespace() { old.push((tok.to_string(), owner)); } }
    let fresh: Vec<&str> = text.trim().split_whitespace().collect();
    let (n, m) = (old.len(), fresh.len());
    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for i in 0..=n { dp[i][0] = i; }
    for j in 0..=m { dp[0][j] = j; }
    for i in 1..=n { for j in 1..=m {
        let sub = dp[i - 1][j - 1] + if old[i - 1].0 == fresh[j - 1] { 0 } else { 1 };
        dp[i][j] = (dp[i - 1][j] + 1).min(dp[i][j - 1] + 1).min(sub);
    } }
    let mut ops: Vec<(usize, &str)> = vec![];
    let (mut i, mut j) = (n, m);
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && dp[i][j] == dp[i - 1][j - 1] + if old[i - 1].0 == fresh[j - 1] { 0 } else { 1 } { ops.push((old[i - 1].1, fresh[j - 1])); i -= 1; j -= 1; }
        else if i > 0 && dp[i][j] == dp[i - 1][j] + 1 { i -= 1; }
        else { ops.push((if i > 0 { old[i - 1].1 } else { old.first().map(|o| o.1).unwrap_or(0) }, fresh[j - 1])); j -= 1; }
    }
    let mut output: Vec<Vec<&str>> = vec![vec![]; parts.len()];
    for (owner, tok) in ops.into_iter().rev() { output[owner].push(tok); }
    let mut repl: HashMap<i64, Vec<(usize, usize, String)>> = HashMap::new();
    for (k, p) in parts.iter().enumerate() { repl.entry(p.id).or_default().push((p.from, p.to, output[k].join(" "))); }
    words.iter().map(|w| {
        let mut next = base(w);
        let Some(edits) = repl.get_mut(&w.id) else { return next };
        let mut chars: Vec<char> = w.text.chars().collect();
        edits.sort_by(|a, b| b.0.cmp(&a.0));
        for (from, to, value) in edits.iter() {
            let (from, to) = ((*from).min(chars.len()), (*to).min(chars.len()).max((*from).min(chars.len())));
            chars.splice(from..to, value.chars());
        }
        next.text = chars.into_iter().collect();
        if next.text != w.text {
            let keep = w.extra.get("_oldText").and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(str::to_string).or_else(|| next.stt_text.clone());
            if let Some(k) = keep { next.extra.insert("_oldText".into(), serde_json::Value::String(k)); }
        }
        next
    }).collect()
}

fn base(w: &Word) -> Word { let mut n = w.clone(); n.stt_text = Some(source_text(w)); n }
fn char_len(s: &str) -> usize { s.chars().count() }

/// 줄 앞 조각 자리 (단어 id, 단어 안 글자 위치)
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Anchor { pub id: i64, pub from: usize }

/// 위 줄과 이 줄 합치기 (출력 자막 맨 앞에서 Backspace). → (새 단어들, 합친 글, 커서 자리, 합친 줄의 앞 조각)
pub fn merge(words: &[Word], previous: &Line, current: &Line) -> Option<(Vec<Word>, String, usize, Anchor)> {
    let (first, tail) = (previous.parts.first()?, previous.parts.last()?);
    let (head, last) = (current.parts.first()?, current.parts.last()?);
    let end_word = words.iter().find(|w| w.id == last.id)?;
    let join = if tail.id == head.id && tail.to == head.from { "" } else { " " };
    let record = CaptionMerge { start_id: first.id, start_offset: Some(first.from as f64), end_id: last.id, end_offset: if last.to == char_len(&end_word.text) { None } else { Some(last.to as f64) } };
    let mut result: Vec<Word> = words.iter().map(base).collect();
    let owner = result.iter_mut().find(|w| w.id == last.id)?;
    owner.caption_merges.get_or_insert_with(Vec::new).push(record);
    Some((result, format!("{}{}{}", previous.text, join, current.text), char_len(&previous.text) + char_len(join), Anchor { id: first.id, from: first.from }))
}

/// 손으로 합친 줄을 다시 글자 수대로 나누기
pub fn unmerge(words: &[Word], line: &Line) -> Vec<Word> {
    words.iter().map(|w| { let mut n = w.clone(); if line.words.contains(&w.id) { n.caption_merges = None; } n }).collect()
}

/// 출력 자막 한 줄을 글자 위치 caret 에서 둘로 나눈다 (출력 자막 칸에서 Enter).
/// 단어 사이면 앞 단어에 br, 단어 가운데면 captionSplits, 손으로 합친 기록도 나눈 자리에서 둘로.
/// → (새 단어들, 뒤 줄 첫 조각) 또는 None (맨 앞·맨 끝 등 나눌 수 없는 자리)
pub fn split(words: &[Word], line: &Line, caret: usize) -> Option<(Vec<Word>, Anchor)> {
    if line.parts.is_empty() { return None; }
    let text: Vec<char> = line.text.chars().collect();
    let caret = caret.min(text.len());
    let s_left: String = text[..caret].iter().collect();
    let s_right: String = text[caret..].iter().collect();
    if s_left.trim().is_empty() || s_right.trim().is_empty() { return None; }
    // 줄 글에서 각 조각의 자리
    let find = |t: &[char], from: usize| -> Option<usize> { if t.is_empty() { return Some(from); } (from..=text.len().saturating_sub(t.len())).find(|&i| text[i..i + t.len()] == *t) };
    let mut spans: Vec<Option<(usize, usize)>> = vec![];
    let mut pos = 0;
    for p in &line.parts {
        let t: Vec<char> = p.text.trim().chars().collect();
        if t.is_empty() { spans.push(None); continue; }
        let at = find(&t, pos)?;
        spans.push(Some((at, at + t.len())));
        pos = at + t.len();
    }
    let (mut left, mut right, mut mid): (Option<usize>, Option<usize>, Option<usize>) = (None, None, None);
    for (n, s) in spans.iter().enumerate() {
        let Some((s0, s1)) = *s else { continue };
        if caret <= s0 { right = Some(n); break; }
        if caret < s1 { mid = Some(n); break; }
        left = Some(n);
    }
    let mut result: Vec<Word> = words.iter().map(base).collect();
    let idx: HashMap<i64, usize> = result.iter().enumerate().map(|(i, w)| (w.id, i)).collect();
    let add_split = |result: &mut Vec<Word>, id: i64, offset: usize| -> bool {
        let Some(&i) = idx.get(&id) else { return false };
        let len = char_len(&result[i].text);
        if !(offset > 0 && offset < len) { return false; }
        let mut v: Vec<f64> = result[i].caption_splits.clone().unwrap_or_default();
        if !v.iter().any(|x| *x == offset as f64) { v.push(offset as f64); }
        v.sort_by(|a, b| a.total_cmp(b));
        result[i].caption_splits = Some(v);
        true
    };
    let (left_end, right_start): ((i64, Option<usize>), (i64, usize));
    if let Some(m) = mid {
        let p = &line.parts[m];
        let (s0, _) = spans[m]?;
        let &wi = idx.get(&p.id)?;
        let chars: Vec<char> = result[wi].text.chars().collect();
        let mut offset = p.from;
        while offset < p.to && offset < chars.len() && chars[offset].is_whitespace() { offset += 1; }
        offset += caret - s0;
        while offset < p.to && offset < chars.len() && chars[offset].is_whitespace() { offset += 1; }
        if offset >= p.to { return None; }
        if !add_split(&mut result, p.id, offset) { return None; }
        left_end = (p.id, Some(offset)); right_start = (p.id, offset);
    } else {
        let (l, r) = (left?, right?);
        let (lp, rp) = (&line.parts[l], &line.parts[r]);
        if lp.id == rp.id {
            if !add_split(&mut result, lp.id, rp.from) { return None; }
            left_end = (lp.id, Some(rp.from)); right_start = (rp.id, rp.from);
        } else {
            let &wi = idx.get(&lp.id)?;
            result[wi].br = true;
            let len = char_len(&result[wi].text);
            left_end = (lp.id, if lp.to >= len { None } else { Some(lp.to) }); right_start = (rp.id, rp.from);
        }
    }
    // 손으로 합친 기록이 나눈 자리를 덮으면 앞·뒤 두 기록으로
    let at = |result: &Vec<Word>, id: i64, offset: Option<f64>, end: bool| -> f64 {
        let Some(&i) = idx.get(&id) else { return f64::NAN };
        let len = char_len(&result[i].text) as f64;
        i as f64 * 1e6 + offset.unwrap_or(if end { len } else { 0.0 })
    };
    let cut = at(&result, right_start.0, Some(right_start.1 as f64), false);
    let mut additions: Vec<(i64, CaptionMerge)> = vec![];
    for k in 0..result.len() {
        let Some(ms) = result[k].caption_merges.clone() else { continue };
        if ms.is_empty() { continue; }
        let mut keep = vec![];
        for m in ms {
            let (a, b) = (at(&result, m.start_id, m.start_offset, false), at(&result, m.end_id, m.end_offset, true));
            if a < cut && cut <= b {
                additions.push((left_end.0, CaptionMerge { start_id: m.start_id, start_offset: m.start_offset, end_id: left_end.0, end_offset: left_end.1.map(|x| x as f64) }));
                keep.push(CaptionMerge { start_id: right_start.0, start_offset: Some(right_start.1 as f64), end_id: m.end_id, end_offset: m.end_offset });
            } else { keep.push(m); }
        }
        result[k].caption_merges = Some(keep);
    }
    for (owner, rec) in additions { if let Some(&i) = idx.get(&owner) { result[i].caption_merges.get_or_insert_with(Vec::new).push(rec); } }
    Some((result, Anchor { id: right_start.0, from: right_start.1 }))
}