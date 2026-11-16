//! 편집 단축키·커서 (기존 keymap.js · editor.js 의 moveCursor/moveLine/handleDelete/handleRestore/markIn/… · shared/caret.js)
//! 커서는 단어 사이 자리(0..=단어 수), 선택은 [a, b) 자리 범위. 단축키 표는 기존과 같고 F1 로 본다.
use crate::*;

/// 단축키 표 (기존 DEFAULT_BINDINGS: 이름, 키 표시, 묶음)
pub(crate) const BINDINGS: &[(&str, &str, &str)] = &[
    ("재생/정지", "Space", "재생"), ("원본 재생/정지", "Shift+Space", "재생"), ("정지", "K", "재생"), ("2초 뒤로", "J", "재생"), ("2초 앞으로", "L", "재생"),
    ("5초 뒤로", "Shift+J", "재생"), ("5초 앞으로", "Shift+L", "재생"), ("1프레임 뒤로", ",", "재생"), ("1프레임 앞으로", ".", "재생"), ("10ms 뒤로", "Shift+,", "재생"), ("10ms 앞으로", "Shift+.", "재생"),
    ("줄 처음으로", "Home, Shift+Home, Ctrl+Home, Ctrl+Shift+Home", "재생"), ("줄 끝으로", "End, Shift+End, Ctrl+End, Ctrl+Shift+End", "재생"),
    ("이전 단어", "←", "이동"), ("다음 단어", "→", "이동"), ("윗줄", "↑", "이동"), ("아랫줄", "↓", "이동"), ("선택 넓히기(좌)", "Shift+←", "이동"), ("선택 넓히기(우)", "Shift+→", "이동"),
    ("선택 넓히기(상)", "Shift+↑", "이동"), ("선택 넓히기(하)", "Shift+↓", "이동"), ("칸을 위로 옮기기 (설교 내용 순서)", "Alt+↑", "편집"), ("칸을 아래로 옮기기 (설교 내용 순서)", "Alt+↓", "편집"),
    ("전체 선택", "Ctrl+A", "이동"), ("찾기", "Ctrl+F", "이동"), ("앞 지우기", "Backspace", "편집"), ("뒤 지우기", "D, Delete", "편집"), ("앞 문장 끝까지 지우기", "Ctrl+Backspace", "편집"), ("뒤 문장 끝까지 지우기", "Ctrl+Delete", "편집"),
    ("되살리기", "R", "편집"), ("지운 부분 숨기기", "H", "편집"), ("시작점 설정", "I", "편집"), ("끝점 설정", "O", "편집"), ("선택만 남기기", "Ctrl+K", "편집"), ("앞에서 끊기", "X", "편집"), ("줄바꿈 토글", "Enter", "편집"),
    ("단어 수정", "E, F2", "편집"), ("실행 취소", "Ctrl+Z", "편집"), ("다시 실행", "Ctrl+Shift+Z / Ctrl+Y", "편집"), ("자동 정리", "Ctrl+Shift+C", "편집"), ("AI 용어 교정", "Ctrl+Shift+T", "편집"),
    ("이전 컷 이동", "[", "컷"), ("다음 컷 이동", "]", "컷"), ("가까운 컷 미세 조정", "T", "컷"),
    ("프로젝트 저장", "Ctrl+S", "파일"), ("다른 이름으로 저장", "Ctrl+Shift+S", "파일"), ("프로젝트 열기", "Ctrl+O", "파일"), ("영상 파일 열기", "Ctrl+Shift+O", "파일"), ("유튜브 가져오기", "Ctrl+U", "파일"), ("AI 추천", "Ctrl+Shift+U", "파일"), ("내보내기", "Ctrl+E", "파일"), ("설정", "Ctrl+,", "파일"), ("도움말", "F1, ?", "파일"),
    ("1프레임 이동", "←", "트림"), ("1프레임 이동", "→", "트림"), ("10ms 이동", "Shift+←", "트림"), ("10ms 이동", "Shift+→", "트림"), ("1ms 이동", "Alt+←", "트림"), ("1ms 이동", "Alt+→", "트림"),
    ("손잡이 전환", "Tab, 1, 2", "트림"), ("반복 재생", "Space", "트림"), ("무음 지점 스냅", "S", "트림"), ("제로 크로싱 스냅", "Alt+S", "트림"), ("초기화", "R", "트림"), ("이전 컷", "[", "트림"), ("다음 컷", "]", "트림"), ("확인 및 닫기", "Enter", "트림"), ("취소 및 닫기", "Escape", "트림"),
];

/// 찾기 막대 (기존 #findBar)
#[derive(Default)]
pub(crate) struct FindBar { pub query: String, pub matches: Vec<usize>, pub idx: Option<usize>, pub focus: bool }

/// shared/caret.js
pub(crate) mod caret {
    use super::Word;
    pub fn next_alive(words: &[Word], start: isize, dir: isize) -> Option<usize> { let mut i = start; while i >= 0 && (i as usize) < words.len() { if !words[i as usize].del { return Some(i as usize); } i += dir; } None }
    pub fn backspace_at(words: &[Word], caret: usize) -> (Vec<usize>, usize) { if caret == 0 { return (vec![], caret); } match next_alive(words, caret as isize - 1, -1) { Some(t) => (vec![t], t), None => (vec![], caret) } }
    pub fn delete_at(words: &[Word], caret: usize) -> (Vec<usize>, usize) { if caret == words.len() { return (vec![], caret); } match next_alive(words, caret as isize, 1) { Some(t) => (vec![t], caret), None => (vec![], caret) } }
    fn ends(w: &Word) -> bool { w.br || w.text.contains(['.', '?', '!']) }
    pub fn delete_to_sentence(words: &[Word], caret: usize, dir: i32) -> (Vec<usize>, usize) {
        let mut del = vec![]; let mut nc = caret;
        if dir < 0 { let mut i = caret as isize - 1; while i >= 0 { let w = &words[i as usize]; if !w.del { del.push(i as usize); } nc = i as usize; if ends(w) { break; } i -= 1; } }
        else { let mut i = caret; while i < words.len() { let w = &words[i]; if !w.del { del.push(i); } if ends(w) { break; } i += 1; } }
        (del, nc)
    }
    pub fn restore_at(words: &[Word], caret: usize, sel: Option<(usize, usize)>) -> Vec<usize> {
        if let Some((a, b)) = sel.filter(|(a, b)| a != b) { return (a.min(b)..a.max(b)).filter(|&i| words[i].del).collect(); }
        let mut ids = vec![];
        let mut l = caret as isize - 1; while l >= 0 && words[l as usize].del { ids.push(l as usize); l -= 1; }
        let mut r = caret; while r < words.len() && words[r].del { ids.push(r); r += 1; }
        ids
    }
}

impl App {
    /// 고른 범위 [a, b) (기존 getSelectionRange)
    pub(crate) fn sel_range(&self) -> Option<(usize, usize)> { self.selection.filter(|(a, b)| a != b).map(|(a, b)| (a.min(b), a.max(b))) }
    /// 커서 자리 → 그 자리부터 남은 단어 시각으로 옮기기 (편집 결과로 재생이면 지운 말은 건너뜀)
    pub(crate) fn seek_caret(&mut self, pos: usize) {
        let ws = &self.project.words;
        let mut k = pos;
        while self.edited && k < ws.len() && ws[k].del { k += 1; }
        if k < ws.len() { let t = ws[k].start; self.player.seek_src(t); }
    }
    /// 커서 옮기기 (extend: 선택 넓히기)
    pub(crate) fn move_cursor(&mut self, dir: isize, extend: bool) {
        let n = self.project.words.len();
        if n == 0 { return; }
        self.manual_caret = true;
        let next = (self.caret as isize + dir).clamp(0, n as isize) as usize;
        if extend {
            if self.selection.is_none() { self.sel_anchor = Some(self.caret); }
            let a = self.sel_anchor.unwrap_or(self.caret);
            self.selection = Some((a.min(next), a.max(next)));
        } else { self.selection = None; self.sel_anchor = Some(next); }
        self.caret = next;
        self.seek_caret(next);
        self.caret_scroll = true;
    }
    /// 윗줄·아랫줄·줄 처음·끝 (화면에 그린 단어 자리로 계산, 기존 moveLine)
    pub(crate) fn move_line(&mut self, dir: isize, extend: bool, edge: bool, whole: bool) {
        let mut pts: Vec<(usize, f32, f32)> = vec![];
        for (i, r) in &self.word_rects { pts.push((*i, r.left(), r.top())); pts.push((*i + 1, r.right(), r.top())); }
        let Some(&(_, cx, cy)) = pts.iter().find(|p| p.0 == self.caret) else { return };
        let target = if whole { if dir < 0 { 0 } else { self.project.words.len() } }
        else if edge {
            let row: Vec<&(usize, f32, f32)> = pts.iter().filter(|p| (p.2 - cy).abs() < 3.0).collect();
            match row.iter().copied().reduce(|a, b| if dir < 0 { if a.1 < b.1 { a } else { b } } else if a.1 > b.1 { a } else { b }) { Some(p) => p.0, None => return }
        } else {
            let mut rows: Vec<f32> = pts.iter().map(|p| p.2).collect();
            rows.sort_by(|a, b| a.total_cmp(b)); rows.dedup_by(|a, b| (*a - *b).abs() < 0.5);
            let y = if dir < 0 { rows.iter().copied().filter(|y| *y < cy - 3.0).last() } else { rows.iter().copied().find(|y| *y > cy + 3.0) };
            let Some(y) = y else { return };
            match pts.iter().filter(|p| (p.2 - y).abs() < 0.5).min_by(|a, b| (a.1 - cx).abs().total_cmp(&(b.1 - cx).abs())) { Some(p) => p.0, None => return }
        };
        self.move_cursor(target as isize - self.caret as isize, extend);
    }
    /// 지우기 (기존 handleDelete: 선택이 있으면 선택을, 없으면 커서 앞·뒤 단어·문장 끝까지)
    pub(crate) fn handle_delete(&mut self, dir: i32, to_sentence: bool, merge_boundary: bool) {
        if self.project.words.is_empty() { return; }
        if merge_boundary && !to_sentence && self.merge_source_at_boundary(dir) { return; }
        if let Some((a, b)) = self.sel_range() {
            for i in a..b { self.project.words[i].del = true; }
            self.caret = a; self.selection = None;
            self.commit();
        } else {
            let (ids, nc) = if to_sentence { caret::delete_to_sentence(&self.project.words, self.caret, dir) } else if dir < 0 { caret::backspace_at(&self.project.words, self.caret) } else { caret::delete_at(&self.project.words, self.caret) };
            if !ids.is_empty() { for i in ids { self.project.words[i].del = true; } self.commit(); }
            self.caret = nc;
        }
        self.manual_caret = true;
    }
    /// STT 원문 줄 맨 앞 Backspace / 맨 끝 Delete: 이웃 자막과 합치기 (기존 mergeSourceAtBoundary)
    fn merge_source_at_boundary(&mut self, dir: i32) -> bool {
        if self.sel_range().is_some() { return false; }
        let c = self.caret;
        let n = self.project.words.len();
        let Some(bi) = self.blocks.iter().position(|b| c >= b.from && c < b.to).or_else(|| (c == n).then(|| self.blocks.len().saturating_sub(1))) else { return false };
        let b = &self.blocks[bi];
        let Some(li) = b.line else { return false };
        if c != if dir < 0 { b.from } else { b.to } { return false; }
        let oi = bi as isize + dir as isize;
        if oi < 0 || oi as usize >= self.blocks.len() { return false; }
        let Some(oli) = self.blocks[oi as usize].line else { return false };
        let (left, right) = if dir < 0 { (oli, li) } else { (li, oli) };
        let (l, r) = (self.lines[left].clone(), self.lines[right].clone());
        let right_from = if dir < 0 { b.from } else { self.blocks[oi as usize].from };
        match caption_edit::merge(&self.project.words, &l, &r) {
            Some((words, ..)) => { self.project.words = words; self.cap_buf.clear(); self.commit(); self.caret = right_from; self.selection = None; self.manual_caret = true; true }
            None => false,
        }
    }
    /// 되살리기 (기존 handleRestore: 선택 안의 지운 말, 없으면 커서 양옆의 지운 묶음)
    pub(crate) fn handle_restore(&mut self) {
        let ids = caret::restore_at(&self.project.words, self.caret, self.sel_range());
        if ids.is_empty() { return; }
        for i in ids { self.project.words[i].del = false; }
        self.commit();
    }
    /// 시작점·끝점: 그 바깥 말을 모두 지운다 (기존 markIn/markOut)
    pub(crate) fn mark(&mut self, start: bool) {
        let t = self.caret.min(self.project.words.len());
        if start { self.mark_i = Some(t); if self.mark_o.is_some_and(|o| t > o) { self.mark_o = None; } }
        else { self.mark_o = Some(t); if self.mark_i.is_some_and(|i| t < i) { self.mark_i = None; } }
        let (mi, mo) = (self.mark_i, self.mark_o);
        for (i, w) in self.project.words.iter_mut().enumerate() { if mi.is_some_and(|a| i < a) || mo.is_some_and(|b| i >= b) { w.del = true; } }
        self.commit();
    }
    /// X: 커서 자리 단어 앞에서 끊기 / Enter: 커서 앞 단어 뒤 줄바꿈
    pub(crate) fn toggle_cut_before(&mut self) { let t = self.caret; if let Some(w) = self.project.words.get_mut(t) { w.cut_before = !w.cut_before; self.commit(); } }
    pub(crate) fn toggle_br(&mut self) { if self.caret == 0 { return; } let t = self.caret - 1; if let Some(w) = self.project.words.get_mut(t) { w.br = !w.br; self.commit(); } }
    pub(crate) fn select_all_words(&mut self) { self.sel_anchor = Some(0); self.caret = self.project.words.len(); self.selection = Some((0, self.caret)); }
    /// 컷 목록 (단어 번호 a = 컷 앞 단어, b = 컷 뒤 단어)
    pub(crate) fn cuts_idx(&self) -> Vec<(usize, usize)> {
        let idx: HashMap<i64, usize> = self.project.words.iter().enumerate().map(|(i, w)| (w.id, i)).collect();
        edl::cut_points(&self.segs).iter().filter_map(|c| { let e: i64 = c.key_end.get(2..)?.parse().ok()?; let s: i64 = c.key_start.get(2..)?.parse().ok()?; Some((*idx.get(&e)?, *idx.get(&s)?)) }).collect()
    }
    /// 단어 수정 (E·F2): 그 칸 아래에 '출력 단어 수정' 칸
    pub(crate) fn edit_word(&mut self) {
        let wid = self.caret;
        let Some(w) = self.project.words.get(wid) else { return };
        if w.del { return; }
        self.word_edit = Some((wid, w.text.clone(), true));
        self.manual_caret = true;
    }
    pub(crate) fn apply_word_edit(&mut self, wid: usize, text: String) {
        if let Some(w) = self.project.words.get_mut(wid) {
            if w.text != text { if !w.extra.contains_key("_oldText") { w.extra.insert("_oldText".into(), json!(w.text)); } w.text = text; }
        }
        self.cap_buf.clear();
        self.commit();
    }

    /// 편집 화면 단축키 (기존 keymap 'editor'·'global'). 글 칸에 쓰는 중이거나 창이 떠 있으면 쉰다
    pub(crate) fn editor_keys(&mut self, ctx: &egui::Context) {
        if self.trim.is_some() || ctx.egui_wants_keyboard_input() || self.word_edit.is_some() { return; }
        let fps = if self.player.probe.fps > 0.0 { self.player.probe.fps } else { 30.0 };
        let mut todo: Vec<&'static str> = vec![];
        {
            use egui::{Key as K, Modifiers as M};
            let cs = M::COMMAND | M::SHIFT;
            // 수식키가 많은 것부터 (Shift 없는 키가 Shift 붙은 것까지 가져가지 않게)
            let table: Vec<(M, K, &'static str)> = vec![
                (M::SHIFT, K::Space, "play_raw"), (M::NONE, K::K, "stop"),
                (M::SHIFT, K::J, "back5"), (M::SHIFT, K::L, "fwd5"), (M::NONE, K::J, "back2"), (M::NONE, K::L, "fwd2"),
                (M::SHIFT, K::Comma, "ms_prev"), (M::SHIFT, K::Period, "ms_next"), (M::NONE, K::Comma, "frame_prev"), (M::NONE, K::Period, "frame_next"),
                (cs, K::Home, "home_cs"), (M::COMMAND, K::Home, "home_c"), (M::SHIFT, K::Home, "home_s"), (M::NONE, K::Home, "home"),
                (cs, K::End, "end_cs"), (M::COMMAND, K::End, "end_c"), (M::SHIFT, K::End, "end_s"), (M::NONE, K::End, "end"),
                (M::ALT, K::ArrowUp, "block_up"), (M::ALT, K::ArrowDown, "block_down"),
                (M::SHIFT, K::ArrowLeft, "sel_left"), (M::SHIFT, K::ArrowRight, "sel_right"), (M::SHIFT, K::ArrowUp, "sel_up"), (M::SHIFT, K::ArrowDown, "sel_down"),
                (M::NONE, K::ArrowLeft, "left"), (M::NONE, K::ArrowRight, "right"), (M::NONE, K::ArrowUp, "up"), (M::NONE, K::ArrowDown, "down"),
                (M::COMMAND, K::A, "select_all"), (M::COMMAND, K::F, "find"),
                (M::COMMAND, K::Backspace, "del_sent_back"), (M::COMMAND, K::Delete, "del_sent_fwd"),
                (M::NONE, K::Backspace, "del_back"), (M::NONE, K::Delete, "del_fwd_merge"), (M::NONE, K::D, "del_fwd"),
                (M::NONE, K::R, "restore"), (M::NONE, K::I, "mark_in"), (M::NONE, K::O, "mark_out"), (M::COMMAND, K::K, "keep"),
                (M::NONE, K::X, "cut_before"), (M::NONE, K::Enter, "br"), (M::NONE, K::E, "edit"), (M::NONE, K::F2, "edit"),
                (cs, K::C, "tidy"), (cs, K::T, "ai_correct"), (cs, K::U, "ai_recommend"),
                (M::NONE, K::OpenBracket, "cut_prev"), (M::NONE, K::CloseBracket, "cut_next"), (M::NONE, K::T, "trim_open"),
                (M::NONE, K::Escape, "esc"),
            ];
            ctx.input_mut(|i| { for (m, key, name) in &table { if i.consume_key(*m, *key) { todo.push(*name); } } });
        }
        if todo.is_empty() { return; }
        let src = self.player.src_now();
        for a in todo {
            match a {
                "play_raw" => self.play_raw(),
                "stop" => self.player.stop(),
                "back2" => self.player.seek_src((src - 2.0).max(0.0)), "fwd2" => self.player.seek_src(src + 2.0),
                "back5" => self.player.seek_src((src - 5.0).max(0.0)), "fwd5" => self.player.seek_src(src + 5.0),
                "frame_prev" => { self.player.stop(); let t = self.player.out_t - 1.0 / fps; self.player.seek(t.max(0.0)); }
                "frame_next" => { self.player.stop(); let t = self.player.out_t + 1.0 / fps; self.player.seek(t); }
                "ms_prev" => { self.player.stop(); let t = self.player.out_t - 0.01; self.player.seek(t.max(0.0)); }
                "ms_next" => { self.player.stop(); let t = self.player.out_t + 0.01; self.player.seek(t); }
                "home" => self.move_line(-1, false, true, false), "home_s" => self.move_line(-1, true, true, false), "home_c" => self.move_line(-1, false, true, true), "home_cs" => self.move_line(-1, true, true, true),
                "end" => self.move_line(1, false, true, false), "end_s" => self.move_line(1, true, true, false), "end_c" => self.move_line(1, false, true, true), "end_cs" => self.move_line(1, true, true, true),
                "left" => self.move_cursor(-1, false), "right" => self.move_cursor(1, false), "sel_left" => self.move_cursor(-1, true), "sel_right" => self.move_cursor(1, true),
                "up" => self.move_line(-1, false, false, false), "down" => self.move_line(1, false, false, false), "sel_up" => self.move_line(-1, true, false, false), "sel_down" => self.move_line(1, true, false, false),
                "block_up" | "block_down" => { let c = self.caret; if let Some(n) = self.blocks.iter().position(|b| b.line.is_some() && c >= b.from && c < b.to) { self.step_block(n, if a == "block_up" { -1 } else { 1 }); } }
                "select_all" => self.select_all_words(),
                "find" => { let f = self.find.get_or_insert_with(Default::default); f.focus = true; }
                "del_back" => self.handle_delete(-1, false, true),
                "del_fwd" => self.handle_delete(1, false, false),
                "del_fwd_merge" => self.handle_delete(1, false, true),
                "del_sent_back" => self.handle_delete(-1, true, false), "del_sent_fwd" => self.handle_delete(1, true, false),
                "restore" => self.handle_restore(),
                "mark_in" => self.mark(true), "mark_out" => self.mark(false),
                "keep" => self.keep_selection(),
                "cut_before" => self.toggle_cut_before(), "br" => self.toggle_br(),
                "edit" => self.edit_word(),
                "tidy" => self.cmd_tidy(), "ai_correct" => self.cmd_ai_correct(), "ai_recommend" => self.cmd_ai_recommend(),
                "cut_prev" | "cut_next" | "trim_open" => {
                    let cuts = self.cuts_idx();
                    let start = |c: &(usize, usize)| self.project.words[c.0].start;
                    match a {
                        "cut_prev" => { if let Some(c) = cuts.iter().rev().find(|c| start(c) < src - 0.5) { let t = start(c); self.player.seek_src(t); } }
                        "cut_next" => { if let Some(c) = cuts.iter().find(|c| start(c) > src + 0.5) { let t = start(c); self.player.seek_src(t); } }
                        _ => { if let Some(&(x, y)) = cuts.iter().min_by(|p, q| (start(p) - src).abs().total_cmp(&(start(q) - src).abs())) { self.open_cut(x, y); } }
                    }
                }
                "esc" => { self.selection = None; }
                _ => {}
            }
        }
    }
    /// 원본 재생 (Shift+Space): 지운 곳까지 그대로 한 번 재생, 멈추면 편집 결과로 돌아온다
    pub(crate) fn play_raw(&mut self) {
        if self.player.playing() { self.player.stop(); return; }
        if self.edited { self.raw_once = true; self.edited = false; self.recompute(); }
        self.player.play();
    }
    /// 매 화면: 원본 재생이 끝나면 편집 결과로 · 재생 중 커서 따라가기 (사용자가 커서를 옮기기 전까지)
    pub(crate) fn caret_follow(&mut self) {
        if self.raw_once && !self.player.playing() { self.raw_once = false; self.edited = true; self.dirty = true; }
        let playing = self.player.playing();
        if playing && !self.was_playing { self.manual_caret = false; self.follow_play = true; }
        self.was_playing = playing;
        if playing && !self.manual_caret {
            let t = self.player.src_now();
            if let Some(i) = self.project.words.iter().position(|w| t >= w.start && t <= w.end) { if self.caret != i { self.caret = i; self.sel_anchor = Some(i); self.selection = None; } }
        }
    }

    /// 단축키 창 (F1, ?) — 기존 showHelp
    pub(crate) fn shortcuts_ui(&mut self, ctx: &egui::Context) {
        let typing = ctx.egui_wants_keyboard_input();
        if ctx.input(|i| i.key_pressed(egui::Key::F1)) || (!typing && ctx.input(|i| i.events.iter().any(|e| matches!(e, egui::Event::Text(t) if t == "?")))) { self.help_open = !self.help_open; }
        if !self.help_open { return; }
        let mut close = false;
        let frame = egui::Frame::new().fill(style::PANEL).corner_radius(CornerRadius::same(24)).inner_margin(egui::Margin::same(15));
        let mr = egui::Modal::new(egui::Id::unique("keyhelp")).frame(frame).show(ctx, |ui| {
            let w = (ctx.content_rect().width() * 0.9).min(800.0) - 30.0;
            ui.set_width(w);
            ui.horizontal(|ui| {
                ui.label(RichText::new("단축키 도움말").size(18.0).family(style::bold()));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| { if style::icon_btn(ui, "x", 18.0, style::FAINT, "닫기").clicked() { close = true; } });
            });
            ui.add_space(10.0);
            let hh = ctx.content_rect().height() * 0.85 - 90.0;
            egui::ScrollArea::vertical().max_height(hh).min_scrolled_height(hh).show(ui, |ui| {
                let groups = ["재생", "이동", "편집", "컷", "파일", "트림"];
                egui::Grid::new("keyhelp-grid").num_columns(2).spacing([30.0, 15.0]).show(ui, |ui| {
                    for (k, g) in groups.iter().enumerate() {
                        ui.vertical(|ui| {
                            ui.set_width((w - 44.0) / 2.0);
                            ui.label(RichText::new(*g).size(14.0).family(style::bold()).color(Color32::from_rgb(0x1d, 0x4e, 0xd8)));
                            let r = ui.cursor(); ui.painter().hline(r.x_range(), r.top() + 3.0, Stroke::new(1.0, style::BORDER)); ui.add_space(8.0);
                            for (label, keys, grp) in BINDINGS.iter().filter(|b| b.2 == *g) {
                                let _ = grp;
                                let cw = ui.available_width();
                                ui.horizontal_top(|ui| {
                                    let lw = (cw * 0.46).max(110.0);
                                    ui.allocate_ui_with_layout(egui::vec2(lw, 0.0), egui::Layout::top_down(egui::Align::Min), |ui| {
                                        ui.set_width(lw);
                                        ui.add(egui::Label::new(RichText::new(*label).size(13.0).color(Color32::from_rgb(0x47, 0x55, 0x69))).wrap());
                                    });
                                    let kw = (cw - lw - 8.0).max(40.0);
                                    ui.allocate_ui_with_layout(egui::vec2(kw, 0.0), egui::Layout::top_down(egui::Align::Max), |ui| {
                                        ui.set_width(kw);
                                        ui.add(egui::Label::new(RichText::new(*keys).size(13.0).monospace()).wrap().halign(egui::Align::Max));
                                    });
                                });
                                ui.add_space(2.0);
                            }
                        });
                        if k % 2 == 1 { ui.end_row(); }
                    }
                });
            });
        });
        if mr.backdrop_response.clicked() { close = true; }
        if close || ctx.input(|i| i.key_pressed(egui::Key::Escape)) { self.help_open = false; }
    }
}

impl App {
    /// 찾기 막대 (Ctrl+F): 글자로 단어를 찾아 차례로 (Enter 다음 · Shift+Enter 이전 · Esc 닫기)
    pub(crate) fn find_bar(&mut self, ui: &mut egui::Ui) {
        let Some(mut f) = self.find.take() else { return };
        let mut close = false;
        let mut go: i32 = 0;
        egui::Frame::new().fill(style::PANEL2).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(12)).inner_margin(egui::Margin::symmetric(10, 8)).show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(RichText::new("찾기").size(12.0).family(style::semi()).color(style::MUTED));
                let r = ui.add(egui::TextEdit::singleline(&mut f.query).desired_width(ui.available_width() - 200.0).font(egui::FontId::proportional(13.0)));
                if f.focus { r.request_focus(); f.focus = false; }
                if r.changed() {
                    f.matches = if f.query.is_empty() { vec![] } else { self.project.words.iter().enumerate().filter(|(_, w)| w.text.contains(f.query.as_str())).map(|(i, _)| i).collect() };
                    f.idx = (!f.matches.is_empty()).then_some(0); if !f.matches.is_empty() { go = 2; }
                }
                if r.has_focus() {
                    let (enter, senter, esc) = ui.input_mut(|x| (x.consume_key(egui::Modifiers::NONE, egui::Key::Enter), x.consume_key(egui::Modifiers::SHIFT, egui::Key::Enter), x.consume_key(egui::Modifiers::NONE, egui::Key::Escape)));
                    if senter { go = -1; } else if enter { go = 1; }
                    if esc { close = true; }
                }
                ui.label(RichText::new(match f.idx { Some(k) if !f.matches.is_empty() => format!("{}/{}", k + 1, f.matches.len()), _ => "0/0".into() }).size(11.5).color(style::MUTED));
                let b = |ui: &mut egui::Ui, s: &str| ui.add(egui::Button::new(RichText::new(s).size(12.0)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(9)));
                if b(ui, "이전").clicked() { go = -1; }
                if b(ui, "다음").clicked() { go = 1; }
                if b(ui, "닫기").clicked() { close = true; }
            });
        });
        if go != 0 && !f.matches.is_empty() {
            let n = f.matches.len();
            if go == 1 { f.idx = Some(f.idx.map(|k| (k + 1) % n).unwrap_or(0)); } else if go == -1 { f.idx = Some(f.idx.map(|k| (k + n - 1) % n).unwrap_or(0)); }
            if let Some(k) = f.idx { self.caret = f.matches[k]; self.sel_anchor = Some(self.caret); self.caret_scroll = true; }
        }
        if !close { self.find = Some(f); }
    }
}
