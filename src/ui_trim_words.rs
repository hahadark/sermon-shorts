//! 미세 조정 창의 '단어별 조정': 칸 안 단어마다 시작·끝을 파형 위에서 끌거나 숫자로 고친다.
//! 자동 인식이 단어 시각을 틀리게 잡아 지운 말 소리가 남거나 남긴 말이 잘릴 때 쓴다 (계산은 word_trim.rs).
use crate::*;
use crate::ui_trim::{BAR_H, RATE, STRIP_H};

/// 단어별 조정 칸에서 한 화면 동안 모은 일 (다 그린 뒤 한 번에)
enum WAct { Select(usize, char), Edge(char), BeginDrag(usize, char), Drag(f64), EndDrag, Set(char, f64), Nudge(f64), Listen, Reset, Cursor(f64), Split, Del, Gap }

/// 자를 자리 선 색
const CUT_RED: Color32 = Color32::from_rgb(0xdc, 0x26, 0x26);

impl App {
    /// 단어 i 를 고치고 손잡이 자동 위치·구간을 새로. 끄는 중이면 끌기 시작 상태에서 다시 계산하고 기록은 끌기가 끝날 때 한 번
    pub(crate) fn set_word_edge(&mut self, i: usize, edge: char, val: f64) {
        if i >= self.project.words.len() { return; }
        let base = self.trim.as_ref().and_then(|t| t.wbase.clone());
        let dragging = base.is_some();
        if let Some((ov, ws)) = base { self.project.overrides = ov; for (k, w) in ws { self.project.words[k] = w; } }
        let st = self.project.settings.clone();
        sermon_shorts::word_trim::set_edge(&mut self.project.words, &mut self.project.overrides, &st, i, edge, val);
        self.after_word_change(dragging);
    }
    fn after_word_change(&mut self, dragging: bool) {
        if let Some((range, ia, ib)) = self.trim.as_ref().map(|t| (t.range, t.idx_a, t.idx_b)) {
            let (ca, cb) = self.centers(range, ia, ib);
            if let Some(t) = &mut self.trim { t.center_a = ca; t.center_b = cb; }
        }
        if dragging { self.dirty = true; } else { self.commit(); self.recompute(); }
    }
    pub(crate) fn begin_word_drag(&mut self, i: usize, edge: char) {
        let n = self.project.words.len();
        let ws: Vec<(usize, Word)> = (i.saturating_sub(1)..(i + 2).min(n)).map(|k| (k, self.project.words[k].clone())).collect();
        let ov = self.project.overrides.clone();
        if let Some(t) = &mut self.trim { t.wbase = Some((ov, ws)); t.wdrag = Some(edge); t.word = Some(i); t.wedge = edge; t.wfocus = true; }
    }
    pub(crate) fn end_word_drag(&mut self) {
        let was = self.trim.as_mut().map(|t| { t.wdrag = None; t.wbase.take().is_some() }).unwrap_or(false);
        if was { self.commit(); self.recompute(); }
    }
    fn word_edge_value(&self, i: usize, edge: char) -> f64 { let w = &self.project.words[i]; if edge == 'S' { w.start } else { w.end } }
    pub(crate) fn nudge_word(&mut self, d: f64) {
        let Some((Some(i), e)) = self.trim.as_ref().map(|t| (t.word, t.wedge)) else { return };
        let v = self.word_edge_value(i, e) + d;
        self.set_word_edge(i, e, v);
    }
    pub(crate) fn snap_word(&mut self, mode: &str) {
        let Some((Some(i), e, Some(pcm), v0)) = self.trim.as_ref().map(|t| (t.word, t.wedge, t.wpcm.clone(), t.wview.0)) else { return };
        let cur = self.word_edge_value(i, e);
        let off = edl::snap(&pcm, RATE as f64, cur - v0, mode, 0.05);
        self.set_word_edge(i, e, v0 + off);
    }
    pub(crate) fn reset_word(&mut self) {
        let Some(Some(i)) = self.trim.as_ref().map(|t| t.word) else { return };
        let st = self.project.settings.clone();
        sermon_shorts::word_trim::reset(&mut self.project.words, &mut self.project.overrides, &st, i);
        self.after_word_change(false);
    }
    /// 단어 수가 바뀐 뒤 (조각 나누기·그것의 되돌리기) 단어 번호로 기억하던 것들을 옮긴다.
    /// f: 예전 번호 → 그 단어의 시작이 든 새 번호, g: 예전 번호 → 그 단어의 끝이 든 새 번호
    pub(crate) fn remap_word_indices(&mut self, f: &dyn Fn(usize) -> usize, g: &dyn Fn(usize) -> usize, old_len: usize) {
        let n = self.project.words.len();
        if old_len == 0 || n == 0 { return; }
        let m = |k: usize| if k >= old_len { n } else { f(k).min(n - 1) };
        let e = |k: usize| g(k.min(old_len - 1)).min(n - 1);
        self.caret = m(self.caret);
        self.sel_anchor = self.sel_anchor.map(m);
        self.selection = self.selection.map(|(a, b)| (m(a), if b == 0 { 0 } else if b >= old_len { n } else { e(b - 1) + 1 }));
        self.mark_i = self.mark_i.map(|k| m(k).min(n - 1));
        self.mark_o = self.mark_o.map(e);
        self.check_anchor = self.check_anchor.map(|k| m(k).min(n - 1));
        self.last_block = self.last_block.map(|k| m(k).min(n - 1));
        self.focus_from = self.focus_from.map(|k| m(k).min(n - 1));
        // 체크한 단어 (번호 = id): 나뉘었으면 두 조각 모두
        let old: Vec<i64> = self.checked.iter().copied().collect();
        self.checked.clear();
        for id in old { if id >= 0 && (id as usize) < old_len { for k in m(id as usize).min(n - 1)..=e(id as usize) { self.checked.insert(k as i64); } } }
        self.cap_buf.clear();
        self.word_edit = None;
        if let Some(t) = &mut self.trim { t.idx_b = m(t.idx_b).min(n - 1); t.idx_a = e(t.idx_a); t.wspan = (m(t.wspan.0).min(n - 1), e(t.wspan.1)); t.word = None; t.wdrag = None; t.wbase = None; }
    }

    /// 미세 조정 칸의 첫·끝 단어를 다시 잡는다 (조각을 나누거나 지우거나 되돌린 뒤):
    /// 칸이 맡은 단어 범위(wspan) 안의 남긴 첫·끝 단어, 화면에 보이는 단어 범위. 자막 줄이 다시 나뉘어도 같은 단어들을 계속 보여 준다
    pub(crate) fn refit_trim_range(&mut self) {
        let Some((true, (s0, s1), (v0, v1))) = self.trim.as_ref().map(|t| (t.range, t.wspan, t.wview)) else { return };
        let ws = &self.project.words;
        let n = ws.len();
        if n == 0 { return; }
        let (mut b, mut a) = (s0.min(s1).min(n - 1), s1.max(s0).min(n - 1));
        while b < a && ws[b].del { b += 1; }
        while a > b && ws[a].del { a -= 1; }
        let wlo = (0..n).find(|&k| ws[k].timed() && ws[k].end > v0).unwrap_or(b).min(b);
        let whi = (0..n).rev().find(|&k| ws[k].timed() && ws[k].start < v1).unwrap_or(a).max(a);
        let (ca, cb) = self.centers(true, a, b);
        if let Some(t) = &mut self.trim { t.idx_b = b; t.idx_a = a; t.wlo = wlo; t.whi = whi; t.center_a = ca; t.center_b = cb; if t.word.is_some_and(|w| w >= n) { t.word = None; } }
    }

    /// 나누기: 자를 자리(파형을 누른 곳, 단어를 듣는 중이면 지금 들리는 곳)에서 그 단어를 두 조각으로.
    /// 글자는 소리가 큰 쪽에 남고 다른 쪽은 빈 조각이 된다. 빈 조각을 골라 둔다 (바로 지울 수 있게)
    pub(crate) fn split_word_here(&mut self) {
        let Some(t) = &self.trim else { return };
        if !t.range { return; }
        let at = if t.solo && self.player.playing() { Some(self.player.src_now()) } else { t.wcur };
        let Some(at) = at else { self.toast("나눌 자리를 먼저 정해 주세요: 아래 파형에서 자를 곳을 누른 뒤 [나누기]"); return };
        let ws = &self.project.words;
        let n = ws.len();
        if n == 0 { return; }
        let hit = (t.wlo..=t.whi.min(n - 1)).filter(|&k| ws[k].timed() && at > ws[k].start && at < ws[k].end).min_by(|&x, &y| (ws[x].end - ws[x].start).total_cmp(&(ws[y].end - ws[y].start)));
        let Some(i) = hit else { self.toast("단어 막대 안쪽을 눌러 자를 자리를 정해 주세요 (단어 사이 빈 곳은 [공백 없애기])"); return };
        let (ws_, we) = (ws[i].start, ws[i].end);
        let min = sermon_shorts::word_trim::MIN_LEN * 2.0;
        if at - ws_ < min || we - at < min { self.toast("단어 끝에 너무 가깝습니다. 조금 안쪽을 눌러 주세요"); return; }
        // 글자는 소리가 큰 쪽에 (소리를 아직 못 읽었으면 긴 쪽)
        let v0 = t.wview.0;
        let text_first = match &t.wpcm {
            Some(pcm) if !pcm.is_empty() => {
                let en = |a: f64, b: f64| -> f64 { let (x, y) = ((((a - v0) * RATE as f64).max(0.0) as usize).min(pcm.len()), (((b - v0) * RATE as f64).max(0.0) as usize).min(pcm.len())); pcm[x..y.max(x)].iter().map(|v| (*v as f64) * (*v as f64)).sum() };
                en(ws_, at) >= en(at, we)
            }
            _ => at - ws_ >= we - at,
        };
        let was_blank = sermon_shorts::word_trim::blank(&ws[i]);
        self.stop_solo();
        self.player.stop(); self.trim_loop = None;
        let p = &mut self.project;
        if sermon_shorts::word_trim::split(&mut p.words, &mut p.overrides, &mut p.order, i, at, text_first).is_none() { return; }
        self.remap_word_indices(&|k| if k > i { k + 1 } else { k }, &|k| if k >= i { k + 1 } else { k }, n);
        self.commit(); self.recompute();
        self.refit_trim_range();
        let sel = if text_first || was_blank { i + 1 } else { i };
        if let Some(t) = &mut self.trim { t.word = Some(sel); t.wedge = if sel == i { 'E' } else { 'S' }; t.wfocus = true; t.wcur = None; }
        self.toast(if was_blank { "빈 조각을 둘로 나눴습니다 (Ctrl+Z 되돌리기)" } else { "둘로 나눴습니다 · 글자 없는 쪽(빈 조각)을 골라 두었습니다: [지우기] 또는 Delete 로 소리째 지웁니다 (Ctrl+Z 되돌리기)" });
    }

    /// 고른 조각(단어) 지우기·되살리기: 소리·영상째. 컷은 조각 끝에 바짝 맞춘다
    pub(crate) fn toggle_word_del(&mut self) {
        let Some(Some(i)) = self.trim.as_ref().map(|t| t.word) else { self.toast("지울 조각(단어 막대)을 먼저 눌러 주세요"); return };
        if i >= self.project.words.len() { return; }
        self.stop_solo();
        let st = self.project.settings.clone();
        let del = !self.project.words[i].del;
        sermon_shorts::word_trim::set_del(&mut self.project.words, &mut self.project.overrides, &st, i, del);
        self.commit(); self.recompute();
        self.refit_trim_range();
        if let Some(t) = &mut self.trim { t.word = Some(i); t.wfocus = true; }
    }

    /// 공백 없애기: 자를 자리가 단어 사이 빈 곳이면 그 공백만, 아니면 이 자막 안의 공백(0.1초 이상) 모두
    pub(crate) fn cut_gaps_here(&mut self) {
        let Some(t) = &self.trim else { return };
        if !t.range { return; }
        let ws = &self.project.words;
        let n = ws.len();
        if n == 0 { return; }
        let next_timed = |k: usize| (k + 1..n).find(|&j| ws[j].timed());
        let hi = t.whi.min(n - 1);
        let mut pairs: Vec<(usize, usize)> = vec![];
        let mut one = false;
        if let Some(c) = t.wcur {
            let in_word = (t.wlo..=hi).any(|k| ws[k].timed() && c >= ws[k].start && c <= ws[k].end);
            if !in_word {
                if let Some(a) = (t.wlo..=hi).rev().find(|&k| ws[k].timed() && ws[k].end <= c) {
                    if let Some(b) = next_timed(a) { if ws[b].start >= c { pairs.push((a, b)); one = true; } }
                }
            }
        }
        if !one { let mut k = t.idx_b; while k < t.idx_a { let Some(j) = next_timed(k) else { break }; if j > t.idx_a { break; } pairs.push((k, j)); k = j; } }
        self.stop_solo();
        if self.dirty { self.recompute(); }
        let before = edl::segments_duration(&self.segs);
        let min_gap = if one { sermon_shorts::word_trim::MIN_GAP } else { 0.1 };
        let mut done = 0;
        for (a, b) in pairs { if sermon_shorts::word_trim::cut_gap(&mut self.project.words, &mut self.project.overrides, a, b, min_gap) { done += 1; } }
        if done == 0 {
            self.toast(if one { "이 공백은 이미 없앤거나 너무 짧습니다" } else { "이 자막 안에는 없앨 공백이 없습니다 · 단어 막대 끝을 소리에 맞게 끌거나, 단어 사이 빈 곳을 누른 뒤 다시 눌러 보세요" });
            return;
        }
        self.commit(); self.recompute();
        self.refit_trim_range();
        let after = edl::segments_duration(&self.segs);
        if let Some(t) = &mut self.trim { t.wcur = None; }
        self.toast(format!("공백 {done}곳을 없앤습니다 ({:.2}초 짧아짐) · 되살리기: 자막 편집의 '✂ 공백' 옆 [되살리기] 또는 Ctrl+Z", (before - after).max(0.0)));
    }

    /// 이 단어만 들어 보기: 원본에서 그 단어 시작~끝만 (지운 말도). 끝나면 틀 구간을 편집 결과로 돌린다
    pub(crate) fn listen_word(&mut self) {
        if self.player.playing() { self.stop_solo(); self.player.stop(); self.trim_loop = None; return; }
        let Some(Some(i)) = self.trim.as_ref().map(|t| t.word) else { return };
        let w = &self.project.words[i];
        if !w.timed() || self.player.path.is_none() || self.player.probe.duration <= 0.0 { return; }
        let (s, e) = (w.start.max(0.0), w.end.min(self.player.probe.duration));
        if e <= s { return; }
        if self.dirty { self.recompute(); }
        self.player.set_ranges(&[(s, e)]);
        self.player.seek(0.0);
        self.player.play();
        self.trim_loop = Some((0.0, e - s, false));
        if let Some(t) = &mut self.trim { t.solo = true; }
    }

    /// 자막 미세 조정 아래 '단어별 조정': 단어 막대를 눌러 고르고, 양끝 선을 끌거나 숫자로 시작·끝을 옮긴다
    pub(crate) fn word_section(&mut self, ui: &mut egui::Ui) {
        let Some(t) = &self.trim else { return };
        let (sel, wedge, wdrag, (v0, v1), wlo, whi, wcur) = (t.word, t.wedge, t.wdrag, t.wview, t.wlo, t.whi, t.wcur);
        let sel = sel.filter(|&i| i < self.project.words.len());
        let solo_playing = t.solo && self.player.playing();
        let mut acts: Vec<WAct> = vec![];
        ui.add_space(6.0);
        { let y = ui.cursor().top(); ui.painter().hline(ui.max_rect().x_range(), y, Stroke::new(1.0, style::BORDER)); }
        ui.add_space(6.0);
        // 한 줄 (좁은 창에서는 다음 줄로 넘어감): 제목 · 고른 단어 · 시작/끝 숫자 칸 · ±0.01 · 단어 듣기 · 원래대로 · 인식 원래 값
        let w_full = ui.available_width();
        let open_id = egui::Id::new("word-section-open");
        let open = ui.ctx().data(|d| d.get_temp::<bool>(open_id)).unwrap_or(true);
        let mut toggle = false;
        let help = "단어 막대 누르기: 고르기 · 고른 단어의 양끝 선 끌기: 시작·끝 옮기기\n회색 취소선 = 지운 말 · 주황 점 = 손으로 고친 단어 · 점선 = 인식 원래 자리\n붙어 있는 단어(틈 0.3초 이하)의 경계는 함께 움직입니다: 끝을 줄이면 다음 단어 시작이 따라와 빈 곳이 생기지 않습니다.\n0.3초보다 긴 쉼을 사이에 둔 이웃은 그대로 두고, 겹칠 때만 밀립니다.\n빈 곳을 만들려면 [나누기]로 빈 조각을 만드세요.\n남긴 말과 지운 말 사이를 고치면 그 자리 컷도 새 경계에 맞춥니다 (지운 말 소리 안으로 넘지 않게).\n[나누기] 파형을 눌러 자를 자리(빨간 선)를 정하면 그 단어를 두 조각으로 나눕니다. 글자는 소리가 큰 쪽에 남고 다른 쪽은 빈 조각이 됩니다.\n[지우기] 고른 조각을 소리째 지우거나 되살립니다.\n[공백 없애기] 단어 막대 사이 빈 곳을 잘라 냅니다 (빈 곳을 눌렀으면 그곳만, 아니면 이 자막 전체).\n단축키: X 나누기 · Delete 지우기/되살리기 · G 공백 없애기\n단축키 (단어를 고른 뒤): ←/→ 1프레임 · Shift 10ms · Alt 1ms · Tab 시작↔끝 · S 무음에 맞추기 · R 원래대로 · Space 단어 듣기 · 1/2 위 칸 손잡이로";
        ui.horizontal_wrapped(|ui| {
            ui.set_max_width(w_full);
            ui.spacing_mut().item_spacing.x = 5.0;
            ui.set_min_height(28.0);
            if style::icon_btn(ui, if open { "chevron-down" } else { "chevron-right" }, 16.0, style::TEXT2, if open { "단어별 조정 접기" } else { "단어별 조정 펼치기" }).clicked() { toggle = true; }
            ui.label(RichText::new("단어별 조정").size(14.0).family(style::bold()).color(style::TEXT)).on_hover_text(help);
            if !open { ui.label(RichText::new("접혀 있음 · 펼치면 칸 안 단어마다 시작·끝을 고칠 수 있습니다").size(13.0).color(style::MUTED)); return; }
            let Some(i) = sel else {
                ui.label(RichText::new("아래 단어 막대를 누르면 그 단어의 시작·끝을 고칠 수 있습니다 (지운 말도)").size(13.0).color(style::MUTED)).on_hover_text(help);
                return;
            };
            let w = &self.project.words[i];
            let mut name = RichText::new(if sermon_shorts::word_trim::blank(w) { "「빈 조각」".to_string() } else { format!("「{}」", w.text.trim()) }).size(13.5).family(style::bold()).color(if w.del { style::FAINT } else { style::PRIMARY });
            if w.del { name = name.strikethrough(); }
            ui.label(name).on_hover_text(if w.del { "지운 말" } else { "남긴 말" });
            for (e, label) in [('S', "시작"), ('E', "끝")] {
                let on = wedge == e;
                let b = egui::Button::new(RichText::new(label).size(13.0).color(if on { Color32::WHITE } else { style::TEXT2 })).fill(if on { style::PRIMARY } else { style::PANEL }).corner_radius(CornerRadius::same(8)).min_size(egui::vec2(34.0, 26.0));
                if ui.add(b).on_hover_text(if e == 'S' { "시작을 움직이기 (Tab 으로 바꾸기)" } else { "끝을 움직이기 (Tab 으로 바꾸기)" }).clicked() { acts.push(WAct::Edge(e)); }
                let mut v = if e == 'S' { w.start } else { w.end };
                let r = ui.add_sized([70.0, 26.0], egui::DragValue::new(&mut v).speed(0.002).fixed_decimals(2).suffix("초")).on_hover_text("초 단위 (0.01초). 끌거나 눌러서 숫자를 넣으세요");
                if r.drag_started() { acts.push(WAct::BeginDrag(i, e)); }
                if r.changed() { acts.push(WAct::Set(e, v)); }
                if r.drag_stopped() { acts.push(WAct::EndDrag); }
            }
            for (lab, d, tip) in [("−0.01", -0.01, "고른 쪽을 10ms 앞으로 (Shift+←)"), ("+0.01", 0.01, "고른 쪽을 10ms 뒤로 (Shift+→)")] {
                if ui.add(egui::Button::new(RichText::new(lab).size(13.0)).corner_radius(CornerRadius::same(8)).min_size(egui::vec2(46.0, 26.0))).on_hover_text(tip).clicked() { acts.push(WAct::Nudge(d)); }
            }
        });
        if toggle { ui.ctx().data_mut(|d| d.insert_temp(open_id, !open)); }
        if !open { return; }
        // 조각 도구: 나누기 · 지우기/되살리기 · 공백 없애기
        let mut wbtn = [egui::Rect::NOTHING; 3];
        ui.horizontal_wrapped(|ui| {
            ui.set_max_width(w_full);
            ui.spacing_mut().item_spacing.x = 6.0;
            let ws = &self.project.words;
            let cur_word = wcur.and_then(|c| (wlo..=whi.min(ws.len().saturating_sub(1))).find(|&k| ws[k].timed() && c > ws[k].start && c < ws[k].end));
            // 고른 단어: 듣기 · 원래대로
            if let Some(i) = sel {
                let w = &ws[i];
                if style::tool(ui, if solo_playing { "pause" } else { "play" }, if solo_playing { "멈춤" } else { "단어 듣기" }).on_hover_text("이 단어만 들어 보기: 원본에서 이 단어 시작~끝만 재생 (Space)").clicked() { acts.push(WAct::Listen); }
                let edited = sermon_shorts::word_trim::edited(w);
                let tip = if edited { let (os, oe) = sermon_shorts::word_trim::original(w); format!("이 단어를 자동 인식 시각으로 (R) · 인식 값 {os:.2}~{oe:.2}초") } else { "고친 적 없는 단어".to_string() };
                if style::icon_btn(ui, "rotate-ccw", 17.0, if edited { style::TEXT2 } else { style::BORDER_STRONG }, &tip).clicked() && edited { acts.push(WAct::Reset); }
                ui.add_space(4.0);
            }
            let r = style::tool(ui, "scissors", "나누기").on_hover_text("자를 자리(빨간 선)에서 단어를 두 조각으로 나눕니다 (X)\n먼저 아래 파형에서 자를 곳을 누르세요. [단어 듣기] 중에 누르면 지금 들리는 곳에서 나눕니다.\n글자는 소리가 큰 쪽에 남고, 다른 쪽은 빈 조각(소리만)이 됩니다.");
            wbtn[0] = r.rect;
            if r.clicked() { acts.push(WAct::Split); }
            let del_now = sel.is_some_and(|i| ws[i].del);
            let r = style::tool(ui, if del_now { "undo-2" } else { "trash-2" }, if del_now { "되살리기" } else { "지우기" }).on_hover_text(if del_now { "고른 조각을 되살립니다 (Delete)" } else { "고른 조각(단어)을 소리·영상째 지웁니다 (Delete) · 컷은 조각 끝에 바짝 맞춥니다" });
            wbtn[1] = r.rect;
            if r.clicked() { acts.push(WAct::Del); }
            let in_gap = wcur.is_some() && cur_word.is_none();
            let r = style::tool(ui, "fold-horizontal", "공백 없애기").on_hover_text(if in_gap { "누른 자리의 공백(단어 막대 사이 빈 곳)을 잘라 냅니다 (G)" } else { "이 자막 안에서 단어 막대 사이 빈 곳(0.1초 이상)을 모두 잘라 냅니다 (G)\n한 곳만 없애려면 그 빈 곳을 먼저 누르세요. 말 양끝에는 아주 짧은 숨(0.03초)만 남깁니다." });
            wbtn[2] = r.rect;
            if r.clicked() { acts.push(WAct::Gap); }
            let note = match (wcur, cur_word) {
                (Some(c), Some(_)) => format!("자를 자리 {c:.2}초"),
                (Some(c), None) => format!("빈 곳 {c:.2}초"),
                // 고른 단어가 없을 때만 안내 (단추가 많아지면 줄이 넘친다)
                _ => if sel.is_none() { "파형을 눌러 자를 자리 정하기".to_string() } else { String::new() },
            };
            if !note.is_empty() { ui.label(RichText::new(note).size(12.5).color(if wcur.is_some() { CUT_RED } else { style::MUTED })).on_hover_text(if cur_word.is_some() { "[나누기] 를 누르면 여기서 단어를 둘로 나눕니다" } else if wcur.is_some() { "[공백 없애기] 를 누르면 이 빈 곳을 잘라 냅니다" } else { "아래 파형을 누르면 빨간 선(자를 자리)이 생깁니다" }); }
        });
        ui.add_space(4.0);
        let (rect, resp) = ui.allocate_exact_size(egui::vec2(w_full, STRIP_H), egui::Sense::click_and_drag());
        let rects = self.paint_words(ui, rect);
        let x_of = |tt: f64| rect.left() + (((tt - v0) / (v1 - v0)) as f32) * rect.width();
        let t_of = |x: f32| v0 + (((x - rect.left()) / rect.width()).clamp(0.0, 1.0) as f64) * (v1 - v0);
        let ws = &self.project.words;
        let edge_xs = sel.filter(|&i| ws[i].timed()).map(|i| (x_of(ws[i].start), x_of(ws[i].end)));
        let hit_edge = |p: egui::Pos2| -> Option<char> {
            let (xs, xe) = edge_xs?;
            let (ds, de) = ((p.x - xs).abs(), (p.x - xe).abs());
            if ds.min(de) > 8.0 { return None; }
            Some(if ds < de { 'S' } else { 'E' })
        };
        let hit_word = |p: egui::Pos2| -> Option<(usize, char)> {
            let mut best: Option<(usize, f32)> = None;
            for k in wlo..=whi.min(ws.len().saturating_sub(1)) {
                let w = &ws[k];
                if !w.timed() { continue; }
                let (a, b) = (x_of(w.start), x_of(w.end));
                if p.x >= a - 1.0 && p.x <= b + 1.0 && best.is_none_or(|x| b - a < x.1) { best = Some((k, b - a)); }
            }
            best.map(|(k, _)| (k, if (p.x - x_of(ws[k].start)).abs() < (p.x - x_of(ws[k].end)).abs() { 'S' } else { 'E' }))
        };
        if let Some(hp) = resp.hover_pos() { if hit_edge(hp).is_some() || wdrag.is_some() { ui.ctx().set_cursor_icon(egui::CursorIcon::ResizeHorizontal); } }
        if resp.drag_started() {
            let p0 = ui.input(|i| i.pointer.press_origin()).or(resp.interact_pointer_pos());
            if let Some(p0) = p0 {
                if let (Some(e), Some(i)) = (hit_edge(p0), sel) { acts.push(WAct::BeginDrag(i, e)); }
                else if let Some((k, e)) = hit_word(p0) { acts.push(WAct::Select(k, e)); }
            }
        }
        let dragging_edge = wdrag.is_some() || acts.iter().any(|a| matches!(a, WAct::BeginDrag(..)));
        if resp.dragged() && dragging_edge { if let Some(p) = resp.interact_pointer_pos() { acts.push(WAct::Drag(t_of(p.x))); } }
        if resp.drag_stopped() { acts.push(WAct::EndDrag); }
        if resp.clicked() {
            if let Some(p) = resp.interact_pointer_pos() {
                if let (Some(e), Some(i)) = (hit_edge(p), sel) { acts.push(WAct::Select(i, e)); }
                else {
                    if let Some((k, e)) = hit_word(p) { acts.push(WAct::Select(k, e)); }
                    // 누른 곳 = 자를 자리 (나누기·공백 없애기)
                    acts.push(WAct::Cursor(t_of(p.x)));
                }
            }
        }
        let tip = resp.hover_pos().and_then(&hit_word).map(|(k, _)| { let w = &ws[k]; format!("{}{} · {:.2}~{:.2}초", w.text.trim(), if w.del { " (지운 말)" } else { "" }, w.start, w.end) });
        if let Some(tip) = tip { resp.clone().on_hover_text(tip); }
        if let Some(t) = &mut self.trim { t.wstrip = rect; t.wrects = rects; t.wbtn = wbtn; }
        for a in acts {
            match a {
                WAct::Select(k, e) => { if let Some(t) = &mut self.trim { t.word = Some(k); t.wedge = e; t.wfocus = true; } }
                WAct::Edge(e) => { if let Some(t) = &mut self.trim { t.wedge = e; t.wfocus = true; } }
                WAct::BeginDrag(i, e) => self.begin_word_drag(i, e),
                WAct::Drag(v) => { if let Some((Some(i), Some(e))) = self.trim.as_ref().map(|t| (t.word, t.wdrag)) { self.set_word_edge(i, e, v); } }
                WAct::EndDrag => self.end_word_drag(),
                WAct::Set(e, v) => {
                    if let Some(Some(i)) = self.trim.as_ref().map(|t| t.word) {
                        if let Some(t) = &mut self.trim { t.wedge = e; t.wfocus = true; }
                        self.set_word_edge(i, e, v);
                    }
                }
                WAct::Nudge(d) => { if let Some(t) = &mut self.trim { t.wfocus = true; } self.nudge_word(d); }
                WAct::Listen => self.listen_word(),
                WAct::Reset => self.reset_word(),
                WAct::Cursor(c) => { if let Some(t) = &mut self.trim { t.wcur = Some(c); } }
                WAct::Split => self.split_word_here(),
                WAct::Del => self.toggle_word_del(),
                WAct::Gap => self.cut_gaps_here(),
            }
        }
    }

    /// 단어 막대·칸 전체 파형·고른 단어 양끝 선. 막대 자리를 돌려준다
    fn paint_words(&self, ui: &egui::Ui, rect: egui::Rect) -> Vec<(usize, egui::Rect)> {
        let p = ui.painter_at(rect);
        p.rect_filled(rect, CornerRadius::same(8), Color32::from_rgb(0xfd, 0xec, 0xec));
        let Some(t) = &self.trim else { return vec![] };
        let (v0, v1) = t.wview;
        let x_of = |tt: f64| rect.left() + (((tt - v0) / (v1 - v0)) as f32) * rect.width();
        let ws = &self.project.words;
        let wave_top = rect.top() + BAR_H + 6.0;
        let wave_bot = rect.bottom() - 16.0;
        for s in &self.segs {
            let (a, b) = (s.start.max(v0), s.end.min(v1));
            if b > a { p.rect_filled(egui::Rect::from_min_max(egui::pos2(x_of(a), wave_top - 2.0), egui::pos2(x_of(b), rect.bottom())), 0.0, Color32::from_rgb(0xe8, 0xf6, 0xee)); }
        }
        if let Some(i) = t.word { let w = &ws[i]; if w.timed() { p.rect_filled(egui::Rect::from_min_max(egui::pos2(x_of(w.start), wave_top - 2.0), egui::pos2(x_of(w.end), rect.bottom())), 0.0, style::PRIMARY.gamma_multiply(0.13)); } }
        match &t.wpcm {
            Some(pcm) if !pcm.is_empty() => {
                let peak = pcm.iter().fold(0f32, |m, v| m.max(v.abs())).max(0.05);
                let gain = 0.95 / peak;
                let w = rect.width();
                let spp = ((v1 - v0) * RATE as f64 / w as f64).max(1.0) as usize;
                let (mid, hh) = ((wave_top + wave_bot) / 2.0, (wave_bot - wave_top) / 2.0);
                for px in 0..(w as i32) {
                    let si = (((px as f64 / w as f64) * (v1 - v0)) * RATE as f64).floor() as usize;
                    if si >= pcm.len() { break; }
                    let (mut lo, mut hi) = (0f32, 0f32);
                    for &v in &pcm[si..(si + spp).min(pcm.len())] { lo = lo.min(v); hi = hi.max(v); }
                    let x = rect.left() + px as f32;
                    p.line_segment([egui::pos2(x, mid - hi * gain * hh), egui::pos2(x, mid - lo * gain * hh)], Stroke::new(1.0, Color32::from_rgb(0x64, 0x74, 0x8b)));
                }
            }
            Some(_) => {}
            None => { p.text(egui::pos2(rect.center().x, (wave_top + wave_bot) / 2.0), egui::Align2::CENTER_CENTER, "소리 읽는 중…", egui::FontId::proportional(13.0), style::MUTED); }
        }
        // 눈금 0.1초 (0.5초마다 숫자)
        let step = if v1 - v0 > 12.0 { 0.5 } else { 0.1 };
        let mut tk = (v0 / step).ceil() * step;
        while tk < v1 {
            let x = x_of(tk);
            p.vline(x, (rect.bottom() - 4.0)..=rect.bottom(), Stroke::new(1.0, style::FAINT));
            if ((tk * 10.0).round() as i64) % 5 == 0 { p.text(egui::pos2(x, rect.bottom() - 4.0), egui::Align2::CENTER_BOTTOM, format!("{tk:.1}"), egui::FontId::monospace(10.0), style::FAINT); }
            tk += step;
        }
        // 단어 막대
        let mut rects = vec![];
        for i in t.wlo..=t.whi.min(ws.len().saturating_sub(1)) {
            let w = &ws[i];
            if !w.timed() { continue; }
            let (x0, x1) = (x_of(w.start).max(rect.left()), x_of(w.end).min(rect.right()));
            if x1 <= x0 { continue; }
            let bar = egui::Rect::from_min_max(egui::pos2(x0 + 0.5, rect.top() + 3.0), egui::pos2((x1 - 0.5).max(x0 + 2.0), rect.top() + 3.0 + BAR_H));
            let sel = t.word == Some(i);
            let in_block = i >= t.idx_b && i <= t.idx_a;
            let (fill, edge, tc) = if w.del { (Color32::from_rgb(0xe5, 0xe7, 0xeb), Color32::from_rgb(0xcb, 0xd5, 0xe1), Color32::from_rgb(0x94, 0xa3, 0xb8)) }
                else if in_block { (Color32::from_rgb(0xdb, 0xea, 0xfe), Color32::from_rgb(0x93, 0xc5, 0xfd), style::TEXT) }
                else { (Color32::from_rgb(0xf1, 0xf5, 0xf9), Color32::from_rgb(0xcb, 0xd5, 0xe1), style::TEXT2) };

            let is_blank = sermon_shorts::word_trim::blank(w);
            let (fill, tc) = if is_blank && !w.del { (Color32::from_rgb(0xff, 0xfb, 0xeb), Color32::from_rgb(0xb4, 0x53, 0x09)) } else { (fill, tc) };
            p.rect(bar, CornerRadius::same(5), fill, Stroke::new(if sel { 2.0 } else { 1.0 }, if sel { style::PRIMARY } else { edge }), egui::StrokeKind::Inside);
            // 빈 조각(글자 없음)은 '빈' 으로 표시
            let g = p.layout_no_wrap(if is_blank { "빈".to_string() } else { w.text.trim().to_string() }, egui::FontId::proportional(12.5), tc);
            let (gw, gh) = (g.size().x, g.size().y);
            let pos = if gw + 6.0 <= bar.width() { egui::pos2(bar.center().x - gw / 2.0, bar.center().y - gh / 2.0) } else { egui::pos2(bar.left() + 3.0, bar.center().y - gh / 2.0) };
            let cp = p.with_clip_rect(bar.shrink(1.0));
            cp.galley(pos, g, tc);
            if w.del { cp.hline(pos.x..=(pos.x + gw).min(bar.right() - 2.0), bar.center().y, Stroke::new(1.2, tc)); }
            if sermon_shorts::word_trim::edited(w) { p.circle_filled(egui::pos2(bar.right() - 4.0, bar.top() + 4.0), 2.6, Color32::from_rgb(0xf5, 0x9e, 0x0b)); }
            rects.push((i, bar));
        }
        // 고른 단어 양끝 (점선 = 인식 원래 자리)
        if let Some(i) = t.word {
            let w = &ws[i];
            if w.timed() {
                if sermon_shorts::word_trim::edited(w) {
                    let (os, oe) = sermon_shorts::word_trim::original(w);
                    for x in [x_of(os), x_of(oe)] { if x >= rect.left() && x <= rect.right() { p.extend(egui::Shape::dashed_line(&[egui::pos2(x, wave_top), egui::pos2(x, wave_bot)], Stroke::new(1.0, style::MUTED), 3.0, 3.0)); } }
                }
                for (e, tt) in [('S', w.start), ('E', w.end)] {
                    let x = x_of(tt);
                    let on = t.wedge == e;
                    p.vline(x, (rect.top() + 3.0)..=rect.bottom(), Stroke::new(if on { 3.0 } else { 2.0 }, if on { style::PRIMARY } else { style::PRIMARY.gamma_multiply(0.55) }));
                    let tab = egui::Rect::from_center_size(egui::pos2(x, (wave_top + wave_bot) / 2.0), egui::vec2(10.0, 24.0));
                    p.rect(tab, CornerRadius::same(3), if on { style::PRIMARY } else { Color32::WHITE }, Stroke::new(1.5, style::PRIMARY), egui::StrokeKind::Middle);
                    for dy in [-4.0, 0.0, 4.0] { p.hline((tab.left() + 3.0)..=(tab.right() - 3.0), tab.center().y + dy, Stroke::new(1.0, if on { Color32::WHITE } else { style::PRIMARY })); }
                }
            }
        }
        // 자를 자리 (빨간 점선 + 위쪽 세모)
        if let Some(c) = t.wcur {
            if c >= v0 && c <= v1 {
                let x = x_of(c);
                p.extend(egui::Shape::dashed_line(&[egui::pos2(x, rect.top() + 2.0), egui::pos2(x, rect.bottom())], Stroke::new(1.6, CUT_RED), 4.0, 3.0));
                p.add(egui::Shape::convex_polygon(vec![egui::pos2(x - 5.0, rect.top()), egui::pos2(x + 5.0, rect.top()), egui::pos2(x, rect.top() + 7.0)], CUT_RED, Stroke::NONE));
            }
        }
        let ph = self.player.src_now();
        if self.player.playing() && ph >= v0 && ph <= v1 { p.vline(x_of(ph), rect.y_range(), Stroke::new(2.0, Color32::from_rgb(0xf5, 0x9e, 0x0b))); }
        rects
    }
}
