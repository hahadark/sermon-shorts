//! 편집 동작: 칸 순서 옮기기 (기존 caption-blocks.js moveSpan·moveBlock·stepBlock)
use crate::*;

impl App {
    /// 칸 n 을 옮길 원본 단어 범위 (같은 조각 안에서 다음 줄 칸 앞까지, 사이의 지운 말 포함)
    pub(crate) fn move_span(&self, n: usize) -> Result<(usize, usize), String> {
        let b = &self.blocks[n];
        if b.line.is_none() { return Err(String::new()); }
        let (a, end) = (b.from, b.to);
        if self.blocks.iter().enumerate().any(|(k, o)| k != n && o.line.is_some() && o.from < end && o.to > a) {
            return Err("한 단어를 나눠 두 칸에 걸쳐 있어 옮길 수 없습니다. 칸을 합치거나 나눈 곳을 바꿔 주세요.".into());
        }
        let pb = edl::order_pieces(&self.project.words, self.project.order.as_deref()).iter().find(|p| a >= p.a && a < p.b).map(|p| p.b).unwrap_or(self.project.words.len());
        let mut to = end;
        while to < pb && !self.blocks.iter().any(|o| o.line.is_some() && o.from == to) { to += 1; }
        Ok((a, to.min(pb)))
    }
    /// 칸 n 을 칸 target 앞(after=false)·뒤(after=true)로
    pub(crate) fn move_block(&mut self, n: usize, target: usize, after: bool) -> bool {
        let (from, to) = match self.move_span(n) { Ok(s) => s, Err(e) => { if !e.is_empty() { self.toast(e); } return false; } };
        let mut k = if after { target + 1 } else { target };
        while k < self.blocks.len() && self.blocks[k].line.is_none() { k += 1; }
        if k == n || (after && target == n) { return false; }
        let before = if k < self.blocks.len() { Some(self.blocks[k].from) } else { None };
        let next = edl::move_range(&self.project.words, self.project.order.as_deref(), from, to, before);
        if next == self.project.order { return false; }
        self.project.order = next;
        self.cap_buf.clear(); self.commit(); self.recompute();
        self.focus_from = Some(from);
        self.toast(if self.project.order.is_some() { "칸을 옮겼습니다 · 미리보기가 이 순서를 따릅니다 (Ctrl+Z 되돌리기)" } else { "원본 순서와 같아졌습니다" });
        true
    }
    /// 칸 n 을 위(-1)·아래(+1) 줄 칸 하나만큼
    pub(crate) fn step_block(&mut self, n: usize, dir: i32) -> bool {
        let lines: Vec<usize> = self.blocks.iter().enumerate().filter(|(_, b)| b.line.is_some()).map(|(i, _)| i).collect();
        let Some(at) = lines.iter().position(|&i| i == n) else { return false };
        if dir < 0 { if at == 0 { return false; } self.move_block(n, lines[at - 1], false) }
        else { if at + 1 >= lines.len() { return false; } self.move_block(n, lines[at + 1], true) }
    }

}
