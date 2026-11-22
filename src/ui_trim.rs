//! 시작·끝 미세 조정 (기존 editor.js 의 trimPanel: 자막 미세 조정 · 컷 미세 조정)
use crate::*;

pub(crate) const RATE: u32 = 48000;

pub(crate) struct Trim {
    /// 자막 미세 조정 (아니면 컷 미세 조정)
    pub range: bool,
    /// 끝 손잡이 'A' 의 단어 번호 (자막이면 마지막 단어)
    pub idx_a: usize,
    /// 시작 손잡이 'B' 의 단어 번호 (자막이면 첫 단어)
    pub idx_b: usize,
    pub active: char,
    pub center_a: f64,
    pub center_b: f64,
    /// 두 칸 파형 소리 조각의 원본 시작 시각 (가운데가 단어 고치기로 옮겨 가도 조각은 그대로)
    pub buf_a: f64,
    pub buf_b: f64,
    pub pcm: Option<(Arc<Vec<f32>>, Arc<Vec<f32>>)>,
    pub rx: Option<Receiver<Result<(Vec<f32>, Vec<f32>, Vec<f32>), String>>>,
    pub dragging: bool,
    // ---- 단어별 조정 (자막 미세 조정에서만) ----
    /// 칸 전체 소리 (보이는 범위 = wview)
    pub wpcm: Option<Arc<Vec<f32>>>,
    pub wview: (f64, f64),
    /// 보여 주는 단어 번호 (앞뒤 이웃 단어 몇 개 포함)
    pub wlo: usize,
    pub whi: usize,
    /// 고른 단어와 움직일 쪽 ('S' 시작 · 'E' 끝)
    pub word: Option<usize>,
    pub wedge: char,
    /// 자를 자리 (파형을 누른 원본 시각): 나누기·공백 없애기가 여기에 한다
    pub wcur: Option<f64>,
    /// 단축키가 단어 쪽으로 가는가 (단어 막대를 누른 뒤)
    pub wfocus: bool,
    /// 끌기 중인 쪽과 끌기 시작 때 상태 (끄는 동안은 늘 이 상태에서 다시 계산)
    pub wdrag: Option<char>,
    pub wbase: Option<(Overrides, Vec<(usize, Word)>)>,
    /// 화면 자리 (시험용)
    pub wstrip: egui::Rect,
    pub wrects: Vec<(usize, egui::Rect)>,
    /// 조각 도구 단추 자리: 나누기 · 지우기 · 공백 없애기 (시험용)
    pub wbtn: [egui::Rect; 3],
    /// 이 칸이 맡은 단어 범위 (연 때의 자막 첫·끝 단어. 조각을 나누면 같이 늘어난다). idx_b·idx_a 는 이 안의 남긴 첫·끝 단어
    pub wspan: (usize, usize),
    /// '이 단어만 들어 보기' 중 (틀 구간을 그 단어로 바꿔 둠)
    pub solo: bool,
}

/// 단어별 조정 칸 높이 (ui_captions 가 자리를 잡을 때 씀)
pub(crate) const WORD_SECTION_H: f32 = 172.0;
pub(crate) const STRIP_H: f32 = 84.0;
pub(crate) const BAR_H: f32 = 22.0;

impl App {
    fn prev_live_idx(&self, i: usize) -> Option<usize> { (0..i).rev().find(|&k| !self.project.words[k].del) }
    fn next_live_idx(&self, i: usize) -> Option<usize> { (i + 1..self.project.words.len()).find(|&k| !self.project.words[k].del) }
    fn fine_cut(&self, i: usize) -> bool { self.project.words[i].extra.get("fineCut").and_then(|v| v.as_bool()) == Some(true) }
    fn joined_before(&self, a: usize) -> bool { self.prev_live_idx(a).is_some_and(|p| p + 1 == a) && (!self.project.words[a].cut_before || self.fine_cut(a)) }
    fn joined_after(&self, b: usize) -> bool { self.next_live_idx(b).is_some_and(|n| n == b + 1) && (!self.project.words[b + 1].cut_before || self.fine_cut(b + 1)) }
    fn boundary(&self, x: usize, y: usize) -> f64 { let (e, s) = (self.project.words[x].end, self.project.words[y].start); if e <= s { (e + s) / 2.0 } else { s } }

    /// 자막(단어 a..=b) 미세 조정 열기. 지운 단어는 빼고 남은 첫·끝 단어로
    pub(crate) fn open_fine(&mut self, a: usize, b: usize) {
        let n = self.project.words.len();
        if n == 0 { return; }
        let (mut a, mut b) = (a.min(n - 1), b.min(n - 1));
        while a <= b && self.project.words[a].del { a += 1; }
        while b >= a && self.project.words[b].del { if b == 0 { break; } b -= 1; }
        if a > b || self.project.words[a].del { self.toast("지운 구간이라 조정할 소리가 없습니다. 먼저 되살려 주세요."); return; }
        self.player.stop();
        self.start_trim(true, b, a);
    }
    /// 칸 머리의 파형 단추: 같은 칸이 열려 있으면 닫고, 아니면 연다 (기존 toggleFineTuneBlock)
    pub(crate) fn toggle_fine(&mut self, a: usize, b: usize) {
        let n = self.project.words.len();
        if n == 0 { return; }
        let (mut a, mut b) = (a.min(n - 1), b.min(n - 1));
        while a <= b && self.project.words[a].del { a += 1; }
        while b > a && self.project.words[b].del { b -= 1; }
        if let Some(t) = &self.trim { if t.range && t.idx_b == a && t.idx_a == b { self.close_trim(); return; } }
        self.open_fine(a, b);
    }
    /// 컷 미세 조정 열기 (앞 구간 끝 단어 idx_a, 뒤 구간 첫 단어 idx_b)
    pub(crate) fn open_cut(&mut self, idx_a: usize, idx_b: usize) { self.player.stop(); self.start_trim(false, idx_a, idx_b); }

    /// 손잡이의 자동 위치 (미세 조정 값이 없을 때 구간이 실제로 잘리는 곳)
    pub(crate) fn centers(&self, range: bool, idx_a: usize, idx_b: usize) -> (f64, f64) {
        let st = &self.project.settings;
        if range {
            let (a, b) = (idx_b, idx_a);
            let cb = if self.joined_before(a) { self.boundary(a - 1, a) } else { (self.project.words[a].start - st.pad_before).max(0.0) };
            let ca = if self.joined_after(b) { self.boundary(b, b + 1) } else { self.project.words[b].end + st.pad_after };
            (ca, cb)
        } else { (self.project.words[idx_a].end + st.pad_after, self.project.words[idx_b].start - st.pad_before) }
    }

    /// 단어별 조정에 보일 단어 범위와 시각 범위: 칸의 단어들 + 1.2초 안의 앞뒤 이웃 (지운 말 포함) 3개까지
    fn word_window(&self, lo: usize, hi: usize) -> (usize, usize, (f64, f64)) {
        let ws = &self.project.words;
        let (cs, ce) = (ws[lo].start, ws[hi].end);
        let mut wlo = lo;
        for k in (lo.saturating_sub(3)..lo).rev() { if !ws[k].timed() { continue; } if ws[k].end >= cs - 1.2 { wlo = k; } else { break; } }
        let mut whi = hi;
        for k in hi + 1..(hi + 4).min(ws.len()) { if !ws[k].timed() { continue; } if ws[k].start <= ce + 1.2 { whi = k; } else { break; } }
        let (mut a, mut b) = (f64::INFINITY, f64::NEG_INFINITY);
        for w in &ws[wlo..=whi] { if w.timed() { a = a.min(w.start); b = b.max(w.end); } }
        if !a.is_finite() || !b.is_finite() { a = cs; b = ce; }
        let a = (a - 0.25).max(0.0);
        let b = (b + 0.25).min(a + 30.0).max(a + 0.5);
        (wlo, whi, (a, b))
    }

    fn start_trim(&mut self, range: bool, idx_a: usize, idx_b: usize) {
        self.stop_solo();
        let (center_a, center_b) = self.centers(range, idx_a, idx_b);
        let (wlo, whi, wview) = if range { self.word_window(idx_b, idx_a) } else { (idx_a.min(idx_b), idx_a.max(idx_b), (0.0, 1.0)) };
        let path = self.project.source_path.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let r = (|| -> anyhow::Result<(Vec<f32>, Vec<f32>, Vec<f32>)> {
                let a = sermon_shorts::media::pcm(&path, center_a - 2.0, 4.0, RATE)?;
                let b = sermon_shorts::media::pcm(&path, center_b - 2.0, 4.0, RATE)?;
                let w = if range { sermon_shorts::media::pcm(&path, wview.0, wview.1 - wview.0, RATE)? } else { vec![] };
                Ok((a, b, w))
            })();
            let _ = tx.send(r.map_err(|e| e.to_string()));
        });
        self.trim = Some(Trim { range, idx_a, idx_b, active: 'B', center_a, center_b, buf_a: center_a - 2.0, buf_b: center_b - 2.0, pcm: None, rx: Some(rx), dragging: false,
            wpcm: None, wview, wlo, whi, word: None, wedge: 'E', wcur: None, wfocus: false, wdrag: None, wbase: None, wstrip: egui::Rect::NOTHING, wrects: vec![], wbtn: [egui::Rect::NOTHING; 3], wspan: (idx_a.min(idx_b), idx_a.max(idx_b)), solo: false });
    }

    pub(crate) fn close_trim(&mut self) { self.stop_solo(); self.trim = None; self.trim_loop = None; }

    /// '이 단어만 들어 보기' 를 멈추고 틀 구간을 편집 결과로 돌려놓는다
    pub(crate) fn stop_solo(&mut self) {
        if let Some(t) = &mut self.trim { if t.solo { t.solo = false; self.player.stop(); self.trim_loop = None; self.dirty = true; } }
    }

    fn key_a(&self) -> String { format!("e:{}", self.project.words[self.trim.as_ref().unwrap().idx_a].id) }
    fn key_b(&self) -> String { format!("s:{}", self.project.words[self.trim.as_ref().unwrap().idx_b].id) }
    pub(crate) fn a_end(&self) -> f64 { let t = self.trim.as_ref().unwrap(); self.project.overrides.get(&self.key_a()).copied().unwrap_or(t.center_a) }
    pub(crate) fn b_start(&self) -> f64 { let t = self.trim.as_ref().unwrap(); self.project.overrides.get(&self.key_b()).copied().unwrap_or(t.center_b) }

    /// 자막 미세 조정: 시작(B)·끝(A) 값을 넣는다. 이웃 말과 붙어 있으면 안쪽으로 당길 때만 컷을 만든다
    fn set_range_value(&mut self, handle: char, val: f64) {
        let t = self.trim.as_ref().unwrap();
        let (ca, cb, ia, ib) = (t.center_a, t.center_b, t.idx_a, t.idx_b);
        if handle == 'B' {
            let a = ib;
            let aid = self.project.words[a].id;
            if self.joined_before(a) {
                let pid = self.project.words[a - 1].id;
                if val > cb + 0.004 {
                    let w = &mut self.project.words[a]; w.cut_before = true; w.extra.insert("fineCut".into(), json!(true));
                    self.project.overrides.insert(format!("e:{pid}"), cb); self.project.overrides.insert(format!("s:{aid}"), val);
                } else {
                    if self.fine_cut(a) { let w = &mut self.project.words[a]; w.cut_before = false; w.extra.remove("fineCut"); self.project.overrides.remove(&format!("e:{pid}")); }
                    self.project.overrides.remove(&format!("s:{aid}"));
                }
            } else { self.project.overrides.insert(format!("s:{aid}"), val.max(0.0)); }
        } else {
            let b = ia;
            let bid = self.project.words[b].id;
            if self.joined_after(b) {
                let nid = self.project.words[b + 1].id;
                if val < ca - 0.004 {
                    let w = &mut self.project.words[b + 1]; w.cut_before = true; w.extra.insert("fineCut".into(), json!(true));
                    self.project.overrides.insert(format!("s:{nid}"), ca); self.project.overrides.insert(format!("e:{bid}"), val);
                } else {
                    if self.fine_cut(b + 1) { let w = &mut self.project.words[b + 1]; w.cut_before = false; w.extra.remove("fineCut"); self.project.overrides.remove(&format!("s:{nid}")); }
                    self.project.overrides.remove(&format!("e:{bid}"));
                }
            } else { self.project.overrides.insert(format!("e:{bid}"), val); }
        }
    }

    pub(crate) fn update_trim_value(&mut self, handle: char, val: f64) {
        let Some(t) = &self.trim else { return };
        if !val.is_finite() { return; }
        if t.range {
            let v = if handle == 'B' { val.min(self.a_end() - 0.05) } else { val.max(self.b_start() + 0.05) };
            self.set_range_value(handle, v);
        } else {
            let k = if handle == 'A' { self.key_a() } else { self.key_b() };
            self.project.overrides.insert(k, val);
        }
        if self.trim.as_ref().is_some_and(|t| t.dragging) { self.dirty = true; } else { self.commit(); self.recompute(); }
    }

    fn handle_value(&self, h: char) -> f64 { if h == 'A' { self.a_end() } else { self.b_start() } }
    pub(crate) fn nudge(&mut self, d: f64) { let h = self.trim.as_ref().unwrap().active; let v = self.handle_value(h) + d; self.update_trim_value(h, v); }

    pub(crate) fn snap_trim(&mut self, mode: &str) {
        let Some(t) = &self.trim else { return };
        let Some((pa, pb)) = t.pcm.clone() else { return };
        let h = t.active;
        let (pcm, buf) = if h == 'A' { (pa, t.buf_a) } else { (pb, t.buf_b) };
        let cur = self.handle_value(h);
        let off = cur - buf;
        let new_off = edl::snap(&pcm, RATE as f64, off, mode, 0.05);
        self.update_trim_value(h, buf + new_off);
    }
    pub(crate) fn reset_trim(&mut self) {
        let Some(t) = &self.trim else { return };
        let (h, range, ca, cb) = (t.active, t.range, t.center_a, t.center_b);
        if range { self.set_range_value(h, if h == 'A' { ca } else { cb }); }
        else { let k = if h == 'A' { self.key_a() } else { self.key_b() }; self.project.overrides.remove(&k); }
        self.commit(); self.recompute();
    }

    fn view_of(&self, h: char) -> (f64, f64) {
        let t = self.trim.as_ref().unwrap();
        let c = if h == 'A' { t.center_a } else { t.center_b };
        if t.range { (c - 1.0, c + 1.0) } else if h == 'A' { (c - 1.5, c + 0.5) } else { (c - 0.5, c + 1.5) }
    }
    fn left_handle(&self) -> char { if self.trim.as_ref().is_some_and(|t| t.range) { 'B' } else { 'A' } }

    /// 이전·다음 자막 (자막 미세 조정) 또는 이전·다음 컷
    pub(crate) fn step_trim(&mut self, dir: i32) {
        let Some(t) = &self.trim else { return };
        if t.range {
            let id = self.project.words[t.idx_b].id;
            let Some(li) = self.lines.iter().position(|l| l.words.contains(&id)) else { return };
            let ni = li as i64 + dir as i64;
            if ni < 0 || ni as usize >= self.lines.len() { return; }
            let idx: HashMap<i64, usize> = self.project.words.iter().enumerate().map(|(i, w)| (w.id, i)).collect();
            let ids: Vec<usize> = self.lines[ni as usize].words.iter().filter_map(|id| idx.get(id).copied()).collect();
            if let (Some(&a), Some(&b)) = (ids.iter().min(), ids.iter().max()) { self.stop_solo(); self.trim = None; self.open_fine(a, b); }
        } else {
            let idx: HashMap<i64, usize> = self.project.words.iter().enumerate().map(|(i, w)| (w.id, i)).collect();
            let cuts: Vec<(usize, usize)> = edl::cut_points(&self.segs).iter().filter_map(|c| Some((*idx.get(&c.key_end.get(2..)?.parse::<i64>().ok()?)?, *idx.get(&c.key_start.get(2..)?.parse::<i64>().ok()?)?))).collect();
            let Some(k) = cuts.iter().position(|&(a, b)| a == t.idx_a && b == t.idx_b) else { return };
            let nk = k as i64 + dir as i64;
            if nk >= 0 && (nk as usize) < cuts.len() { let (a, b) = cuts[nk as usize]; self.open_cut(a, b); }
        }
    }

    /// 편집 결과로 들어 보기: 자막은 앞뒤 조금 붙여 한 번, 컷은 앞 2초+뒤 2초를 되풀이
    fn trim_listen(&mut self) {
        let Some(range) = self.trim.as_ref().map(|t| t.range) else { return };
        if self.player.playing() { self.stop_solo(); self.player.stop(); self.trim_loop = None; return; }
        if self.dirty { self.recompute(); }
        let (bs, ae) = (self.b_start(), self.a_end());
        let (from, to) = if range {
            let s = edl::src_to_out(&self.segs, bs + 0.002).unwrap_or(0.0);
            let e = edl::src_to_out(&self.segs, ae - 0.002).unwrap_or(s);
            (s - 1.0, e.max(s) + 0.8)
        } else {
            let c = edl::src_to_out(&self.segs, ae - 0.002).unwrap_or(0.0);
            (c - 2.0, c + 2.0)
        };
        self.edited = true; self.dirty = true; self.recompute();
        self.player.seek(from.max(0.0));
        self.player.play();
        self.trim_loop = Some((from.max(0.0), to, !range));
    }

    /// 미세 조정 창 (자막 목록과 파형 사이)
    pub(crate) fn trim_panel(&mut self, ui: &mut egui::Ui) {
        // 소리 조각 받기
        let got = self.trim.as_mut().and_then(|t| t.rx.as_ref().map(|rx| rx.try_recv()));
        match got {
            Some(Ok(Ok((a, b, w)))) => { if let Some(t) = &mut self.trim { t.rx = None; t.pcm = Some((Arc::new(a), Arc::new(b))); t.wpcm = Some(Arc::new(w)); } }
            Some(Ok(Err(e))) => { self.trim = None; self.toast(format!("미세 조정 소리를 읽지 못했습니다: {e}")); return; }
            Some(Err(_)) => ui.ctx().request_repaint(),
            None => {}
        }
        // 손잡이 자동 위치는 단어 시각에서 (단어별 조정·되돌리기 뒤에도 맞게)
        if let Some((rg, ia, ib)) = self.trim.as_ref().map(|t| (t.range, t.idx_a, t.idx_b)) { let (ca, cb) = self.centers(rg, ia, ib); if let Some(t) = &mut self.trim { t.center_a = ca; t.center_b = cb; } }
        let Some((range, active, t_idx_b)) = self.trim.as_ref().map(|t| (t.range, t.active, t.idx_b)) else { return };
        let mut act: Option<&str> = None;
        let mut nudge: f64 = 0.0;
        let fr = egui::Frame::new().fill(style::PANEL2).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(14)).inner_margin(egui::Margin::symmetric(12, 8)).show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing.x = 6.0;
                let title = if range {
                    let id = self.project.words[t_idx_b].id;
                    let li = self.lines.iter().position(|l| l.words.contains(&id));
                    format!("{}미세 조정 · {} ~ {}", li.map(|i| format!("{:03}번 자막 ", i + 1)).unwrap_or_else(|| "자막 ".into()), edl::format_time(self.b_start(), true), edl::format_time(self.a_end(), true))
                } else { format!("컷 미세 조정 · 잘라 낸 길이 {:.2}초", (self.b_start() - self.a_end()).max(0.0)) };
                ui.label(RichText::new(title).size(14.5).family(style::bold()).color(style::TEXT));
                if style::tool(ui, "chevron-left", if range { "이전 자막 ([)" } else { "이전 컷 ([)" }).clicked() { act = Some("prev"); }
                if style::tool(ui, "chevron-right", if range { "다음 자막 (])" } else { "다음 컷 (])" }).clicked() { act = Some("next"); }
                ui.add_space(6.0);
                let hn = if range { if active == 'B' { "시작" } else { "끝" } } else if active == 'A' { "앞 끝" } else { "뒤 시작" };
                ui.label(RichText::new("움직일 곳").size(13.5).color(style::MUTED));
                ui.label(RichText::new(hn).size(13.5).family(style::bold()).color(style::PRIMARY));
                for (lab, d, tip) in [("−0.1", -0.1, "0.1초 앞으로"), ("−0.01", -0.01, "0.01초 앞으로 (Shift+←)"), ("+0.01", 0.01, "0.01초 뒤로 (Shift+→)"), ("+0.1", 0.1, "0.1초 뒤로")] {
                    if ui.add(egui::Button::new(RichText::new(lab).size(13.0)).corner_radius(CornerRadius::same(8)).min_size(egui::vec2(46.0, 28.0))).on_hover_text(tip).clicked() { nudge = d; }
                }
                if style::tool(ui, "rotate-ccw", "원래대로").on_hover_text("자동 위치로 (R)").clicked() { act = Some("reset"); }
                let playing = self.player.playing() && self.trim_loop.is_some();
                if style::primary(ui, Some(if playing { "pause" } else { "play" }), if playing { "멈춤" } else { "미리듣기" }).on_hover_text("편집 결과로 들어 보기 (Space)").clicked() { act = Some("listen"); }
                if style::icon_btn(ui, "x", 18.0, style::TEXT2, "미세 조정 닫기 (Esc)").clicked() { act = Some("close"); }
            });
            ui.label(RichText::new("파형을 누르거나 끌어서 옮기기 · ←/→ 1프레임 · Shift 10ms · Alt 1ms · Tab 시작↔끝 · S 무음에 맞추기 · Enter 닫기 · 초록=남는 소리, 빨강=잘려 나가는 소리").size(12.0).color(style::FAINT));
            // 두 칸 파형
            let (rect, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 120.0), egui::Sense::click_and_drag());
            self.paint_trim(ui, rect);
            let left = self.left_handle();
            let right = if left == 'A' { 'B' } else { 'A' };
            if resp.drag_started() || resp.clicked() {
                if let Some(p) = resp.interact_pointer_pos() { if let Some(t) = &mut self.trim { t.active = if p.x < rect.center().x { left } else { right }; t.dragging = resp.drag_started(); t.wfocus = false; } }
            }
            if let Some(p) = resp.interact_pointer_pos() {
                if resp.dragged() || resp.clicked() {
                    let h = self.trim.as_ref().unwrap().active;
                    let on_left = h == left;
                    let (mn, mx) = self.view_of(h);
                    let w2 = rect.width() / 2.0;
                    let x0 = if on_left { rect.left() } else { rect.left() + w2 };
                    let k = ((p.x - x0) / w2).clamp(0.0, 1.0) as f64;
                    self.update_trim_value(h, mn + k * (mx - mn));
                }
            }
            if resp.drag_stopped() { if let Some(t) = &mut self.trim { t.dragging = false; } self.commit(); self.recompute(); }
            if range { self.word_section(ui); }
        });
        // 실제 높이 (다음 화면에서 자막 목록이 이만큼 비워 둔다. 좁은 창에서 줄이 바뀌어도 파형 칸을 밀지 않게)
        ui.ctx().data_mut(|d| d.insert_temp(egui::Id::new("trim-panel-h"), (range, fr.response.rect.height())));
        if nudge != 0.0 { self.nudge(nudge); }
        match act { Some("prev") => self.step_trim(-1), Some("next") => self.step_trim(1), Some("reset") => self.reset_trim(), Some("listen") => self.trim_listen(), Some("close") => self.close_trim(), _ => {} }
    }

    fn paint_trim(&self, ui: &egui::Ui, rect: egui::Rect) {
        let p = ui.painter_at(rect);
        p.rect_filled(rect, CornerRadius::same(8), Color32::from_rgb(0xf8, 0xfa, 0xfc));
        let Some(t) = &self.trim else { return };
        let Some((pa, pb)) = &t.pcm else { p.text(rect.center(), egui::Align2::CENTER_CENTER, "소리 읽는 중…", egui::FontId::proportional(13.0), style::MUTED); return };
        let left = self.left_handle();
        let right = if left == 'A' { 'B' } else { 'A' };
        let w2 = rect.width() / 2.0;
        let h = rect.height();
        let playhead = self.player.src_now();
        let playing = self.player.playing();
        for (hd, xo) in [(left, rect.left()), (right, rect.left() + w2)] {
            let is_a = hd == 'A';
            let (mn, mx) = self.view_of(hd);
            let pcm = if is_a { pa } else { pb };
            let buf_start = if is_a { t.buf_a } else { t.buf_b };
            let x_of = |tt: f64| xo + (((tt - mn) / (mx - mn)) as f32) * w2;
            p.rect_filled(egui::Rect::from_min_size(egui::pos2(xo, rect.top()), egui::vec2(w2, h)), 0.0, Color32::from_rgb(0xfd, 0xec, 0xec));
            for s in &self.segs { let (a, b) = (s.start.max(mn), s.end.min(mx)); if b > a { p.rect_filled(egui::Rect::from_min_max(egui::pos2(x_of(a), rect.top()), egui::pos2(x_of(b), rect.bottom())), 0.0, Color32::from_rgb(0xe8, 0xf6, 0xee)); } }
            let spp = ((mx - mn) * RATE as f64 / w2 as f64).max(1.0);
            let mid = rect.center().y;
            for px in 0..(w2 as i32) {
                let tt = mn + (px as f64 / w2 as f64) * (mx - mn);
                let si = ((tt - buf_start) * RATE as f64).floor() as i64;
                if si < 0 || si as usize >= pcm.len() { continue; }
                let (mut lo, mut hi) = (0f32, 0f32);
                for j in 0..(spp as usize) { if let Some(&v) = pcm.get(si as usize + j) { lo = lo.min(v); hi = hi.max(v); } }
                let x = xo + px as f32;
                p.line_segment([egui::pos2(x, mid - hi * h / 2.0), egui::pos2(x, mid - lo * h / 2.0)], Stroke::new(1.0, Color32::from_rgb(0x64, 0x74, 0x8b)));
            }
            // 눈금 0.1초
            let mut tk = (mn * 10.0).ceil() / 10.0;
            while tk < mx { let x = x_of(tk); p.vline(x, (rect.bottom() - 15.0)..=rect.bottom(), Stroke::new(1.0, style::FAINT)); if ((tk * 10.0).round() as i64) % 5 == 0 { p.text(egui::pos2(x + 2.0, rect.bottom() - 15.0), egui::Align2::LEFT_TOP, format!("{tk:.1}"), egui::FontId::monospace(10.0), style::FAINT); } tk += 0.1; }
            // 단어 이름·시작선
            let center_idx = if is_a { t.idx_a } else { t.idx_b };
            let ws = &self.project.words;
            for i in center_idx.saturating_sub(6)..(center_idx + 7).min(ws.len()) {
                let w = &ws[i];
                if w.start < mn || w.start > mx { continue; }
                let wx = x_of(w.start);
                p.text(egui::pos2(wx + 2.0, rect.top() + 4.0 + (i % 2) as f32 * 14.0), egui::Align2::LEFT_TOP, &w.text, egui::FontId::proportional(12.0), if w.del { Color32::from_rgb(0xd4, 0x6a, 0x6a) } else { style::TEXT });
                p.vline(wx, (rect.top() + 22.0)..=mid, Stroke::new(1.0, Color32::from_rgb(0xcb, 0xd5, 0xe1)));
            }
            let ht = if is_a { self.a_end() } else { self.b_start() };
            let on = t.active == hd;
            p.vline(x_of(ht), rect.y_range(), Stroke::new(if on { 3.0 } else { 2.0 }, if on { style::PRIMARY } else { style::FAINT }));
            let delta = ht - if is_a { t.center_a } else { t.center_b };
            if delta.abs() > 0.0005 { p.text(egui::pos2(x_of(ht) + 4.0, mid + 8.0), egui::Align2::LEFT_TOP, format!("{:+.3}초", delta), egui::FontId::monospace(11.0), style::PRIMARY); }
            if playing && playhead >= mn && playhead <= mx { p.vline(x_of(playhead), rect.y_range(), Stroke::new(2.0, Color32::from_rgb(0xf5, 0x9e, 0x0b))); }
        }
        p.vline(rect.left() + w2, rect.y_range(), Stroke::new(2.0, Color32::from_rgb(0xcb, 0xd5, 0xe1)));
        if playing { ui.ctx().request_repaint(); }
    }

    /// 미세 조정 단축키 (창이 열려 있고 글자 칸에 쓰는 중이 아닐 때)
    pub(crate) fn trim_keys(&mut self, ctx: &egui::Context) {
        if self.trim.is_none() || ctx.egui_wants_keyboard_input() { return; }
        let fps = if self.player.probe.fps > 0.0 { self.player.probe.fps } else { 30.0 };
        let mut todo: Vec<&str> = vec![];
        let mut step = 0.0f64;
        let wtools = self.trim.as_ref().is_some_and(|t| t.range);
        let wsel = self.trim.as_ref().is_some_and(|t| t.range && t.wfocus && t.word.is_some());
        ctx.input_mut(|i| {
            let m = i.modifiers;
            if i.consume_key(egui::Modifiers::SHIFT, egui::Key::ArrowLeft) { step = -0.01; }
            else if i.consume_key(egui::Modifiers::SHIFT, egui::Key::ArrowRight) { step = 0.01; }
            else if i.consume_key(egui::Modifiers::ALT, egui::Key::ArrowLeft) { step = -0.001; }
            else if i.consume_key(egui::Modifiers::ALT, egui::Key::ArrowRight) { step = 0.001; }
            else if i.consume_key(egui::Modifiers::NONE, egui::Key::ArrowLeft) { step = -1.0 / fps; }
            else if i.consume_key(egui::Modifiers::NONE, egui::Key::ArrowRight) { step = 1.0 / fps; }
            if i.consume_key(egui::Modifiers::NONE, egui::Key::Tab) { todo.push("switch"); }
            if i.consume_key(egui::Modifiers::NONE, egui::Key::Num1) { todo.push("left"); }
            if i.consume_key(egui::Modifiers::NONE, egui::Key::Num2) { todo.push("right"); }
            if i.consume_key(egui::Modifiers::NONE, egui::Key::Space) { todo.push("listen"); }
            if i.consume_key(egui::Modifiers::ALT, egui::Key::S) { todo.push("zero"); }
            else if i.consume_key(egui::Modifiers::NONE, egui::Key::S) { todo.push("silence"); }
            if i.consume_key(egui::Modifiers::NONE, egui::Key::R) { todo.push("reset"); }
            // 단어별 조정: X 나누기 · G 공백 없애기 · Delete 지우기/되살리기
            if wtools { if i.consume_key(egui::Modifiers::NONE, egui::Key::X) { todo.push("wsplit"); } if i.consume_key(egui::Modifiers::NONE, egui::Key::G) { todo.push("wgap"); } }
            if wsel && i.consume_key(egui::Modifiers::NONE, egui::Key::Delete) { todo.push("wdel"); }
            if i.consume_key(egui::Modifiers::NONE, egui::Key::OpenBracket) { todo.push("prev"); }
            if i.consume_key(egui::Modifiers::NONE, egui::Key::CloseBracket) { todo.push("next"); }
            if i.consume_key(egui::Modifiers::NONE, egui::Key::Enter) { todo.push("confirm"); }
            if i.consume_key(egui::Modifiers::NONE, egui::Key::Escape) { todo.push("close"); }
            let _ = m;
        });
        // 단어 막대를 눌렀으면 화살표·Tab·S·R·Space 는 고른 단어 쪽으로 (1·2 를 누르거나 위 파형을 누르면 다시 칸 시작·끝)
        // 조각 도구는 단어를 고르지 않아도 (자를 자리만 있어도) 된다
        todo.retain(|a| match *a { "wsplit" => { self.split_word_here(); false } "wdel" => { self.toggle_word_del(); false } "wgap" => { self.cut_gaps_here(); false } _ => true });
        let word_keys = self.trim.as_ref().is_some_and(|t| t.wfocus && t.word.is_some());
        if word_keys {
            if step != 0.0 { self.nudge_word(step); }
            for a in todo {
                match a {
                    "switch" => { if let Some(t) = &mut self.trim { t.wedge = if t.wedge == 'S' { 'E' } else { 'S' }; } }
                    "left" | "right" => { let h = if a == "left" { self.left_handle() } else if self.left_handle() == 'A' { 'B' } else { 'A' }; if let Some(t) = &mut self.trim { t.active = h; t.wfocus = false; } }
                    "listen" => self.listen_word(),
                    "zero" => self.snap_word("zero"),
                    "silence" => self.snap_word("silence"),
                    "reset" => self.reset_word(),
                    "prev" => self.step_trim(-1),
                    "next" => self.step_trim(1),
                    "close" => self.close_trim(),
                    "confirm" => self.confirm_trim(),
                    _ => {}
                }
            }
            return;
        }
        if step != 0.0 { self.nudge(step); }
        for a in todo {
            match a {
                "switch" => { if let Some(t) = &mut self.trim { t.active = if t.active == 'A' { 'B' } else { 'A' }; } }
                "left" => { let h = self.left_handle(); if let Some(t) = &mut self.trim { t.active = h; } }
                "right" => { let h = if self.left_handle() == 'A' { 'B' } else { 'A' }; if let Some(t) = &mut self.trim { t.active = h; } }
                "listen" => self.trim_listen(),
                "zero" => self.snap_trim("zero"),
                "silence" => self.snap_trim("silence"),
                "reset" => self.reset_trim(),
                "prev" => self.step_trim(-1),
                "next" => self.step_trim(1),
                "close" => self.close_trim(),
                "confirm" => self.confirm_trim(),
                _ => {}
            }
        }
    }

    /// Enter: 닫고 고친 곳을 들려준다 (기존 keymap.js trim_confirm) — 자막은 앞뒤 0.5초 붙여 한 번, 컷은 1초 앞부터 이어서
    pub(crate) fn confirm_trim(&mut self) {
        let Some(range) = self.trim.as_ref().map(|t| t.range) else { return };
        if self.dirty { self.recompute(); }
        if range {
            let (ia, ib) = { let t = self.trim.as_ref().unwrap(); (t.idx_a, t.idx_b) };
            let (bs, ae) = (self.b_start(), self.a_end());
            let s = edl::src_to_out(&self.segs, bs + 0.002);
            let e = edl::src_to_out(&self.segs, ae - 0.002);
            let a = s.or_else(|| edl::src_to_out(&self.segs, self.project.words[ib].start)).unwrap_or(0.0);
            let b = e.or_else(|| edl::src_to_out(&self.segs, self.project.words[ia].end)).unwrap_or(a).max(a);
            self.close_trim();
            let total = self.player.duration();
            let from = (a - 0.5).clamp(0.0, total);
            let to = (b + 0.5).clamp(from, total);
            if !self.edited { self.edited = true; self.dirty = true; self.recompute(); }
            self.raw_once = false;
            self.player.seek(from);
            self.player.play();
            self.trim_loop = Some((from, to, false));
        } else {
            let t = self.a_end();
            self.close_trim();
            self.player.seek_src((t - 1.0).max(0.0));
            self.player.play();
        }
    }

    /// 들어 보기 끝 (자막은 한 번, 컷은 되풀이)
    pub(crate) fn tick_trim_loop(&mut self) {
        let Some((from, to, repeat)) = self.trim_loop else { return };
        if !self.player.playing() { self.trim_loop = None; self.stop_solo(); return; }
        if self.player.out_t >= to {
            if repeat { self.player.seek(from); } else { self.player.stop(); self.trim_loop = None; self.stop_solo(); }
        }
    }
}
