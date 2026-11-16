//! 자막 칸 목록 (기존 caption-blocks.js 의 칸 나누기). 칸 = 자막 한 줄 + 그 줄에 든 원본 단어들.
//! 어느 줄에도 들지 않은 지운 말 묶음은 원본에서 바로 앞 줄 칸 뒤에(없으면 맨 앞) 따로 칸을 만든다. 칸 순서 = 출력 순서.
use crate::caption_edit::source_text;
use crate::edl::{Line, char_count};
use crate::model::Word;
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct Block {
    /// 원본 단어 번호들 (이어진 범위)
    pub from: usize,
    pub to: usize,
    /// 자막 줄 (지운 말만 있는 칸이면 None)
    pub line: Option<usize>,
}

pub fn build(words: &[Word], lines: &[Line], max_chars: usize) -> Vec<Block> {
    let ids: HashMap<i64, usize> = words.iter().enumerate().map(|(i, w)| (w.id, i)).collect();
    let mut line_blocks: Vec<(usize, usize, usize)> = vec![];
    for (li, l) in lines.iter().enumerate() {
        let idx: Vec<usize> = l.words.iter().filter_map(|id| ids.get(id).copied()).collect();
        if idx.is_empty() { continue; }
        line_blocks.push((*idx.iter().min().unwrap(), idx.iter().max().unwrap() + 1, li));
    }
    let mut covered = vec![false; words.len()];
    for &(a, b, _) in &line_blocks { for c in &mut covered[a..b] { *c = true; } }
    let mut by_end: Vec<usize> = (0..line_blocks.len()).collect();
    by_end.sort_by_key(|&k| line_blocks[k].1);
    let mut after: HashMap<usize, Vec<(usize, usize)>> = HashMap::new();
    let mut top: Vec<(usize, usize)> = vec![];
    let mut i = 0;
    while i < words.len() {
        if covered[i] { i += 1; continue; }
        let mut j = i;
        while j < words.len() && !covered[j] { j += 1; }
        let owner = by_end.iter().copied().filter(|&k| line_blocks[k].1 <= i).last();
        match owner { Some(k) => after.entry(k).or_default().push((i, j)), None => top.push((i, j)) }
        i = j;
    }
    // 지운 말 묶음을 한 줄 최대 글자 정도로 나눈다
    let gaps = |out: &mut Vec<Block>, a: usize, b: usize| {
        let (mut start, mut size) = (a, 0usize);
        for k in a..b {
            let len = char_count(&source_text(&words[k]));
            if k > start && size + len > max_chars { out.push(Block { from: start, to: k, line: None }); start = k; size = 0; }
            size += len;
        }
        if b > start { out.push(Block { from: start, to: b, line: None }); }
    };
    let mut out = vec![];
    for (a, b) in top { gaps(&mut out, a, b); }
    for (k, &(a, b, li)) in line_blocks.iter().enumerate() {
        out.push(Block { from: a, to: b, line: Some(li) });
        for &(x, y) in after.get(&k).into_iter().flatten() { gaps(&mut out, x, y); }
    }
    out
}
