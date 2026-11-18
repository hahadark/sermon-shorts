//! 가운데 칸: 자막 편집 카드 + 파형 (기존 editor.js 도구 모음 · caption-blocks.js 칸 · waveform.js)
use crate::*;
use crate::icons::img;
use sermon_shorts::tidy;

pub(crate) enum Action {
    SeekSrc(f64),
    Del(usize, usize, bool),
    EditLine(usize, String),
    Move(usize, usize, bool),
    Step(usize, i32, Option<(usize, String)>),
    /// 체크 (from, to, 켜기, Shift: 마지막으로 누른 칸부터 여기까지 한꺼번에)
    Check(usize, usize, bool, bool),
    WaveTo(f64, f64),
    RestoreGap(usize),
    CutPause(usize),
    ShowDeleted,
    Split(usize, String, usize),
    MergeUp(usize, Option<String>),
    MergeDown(usize, Option<String>),
    Unmerge(usize),
    Fine(usize, usize),
    FineOpen(usize, usize),
    Cut(usize, usize),
    TabTo(usize, i32, Option<(usize, String)>),
}

impl App {
    pub(crate) fn center_column(&mut self, ui: &mut egui::Ui) {
        style::card().inner_margin(egui::Margin { left: 18, right: 18, top: 16, bottom: 10 }).show(ui, |ui| {
            ui.set_min_size(ui.available_size());
            let base_wave = self.panes.wave.clamp(100.0, (ui.available_height() - 236.0 - 200.0).max(100.0));
            let wave_h = base_wave + if self.trim.is_some() { 236.0 } else { 0.0 };
            let list_h = (ui.available_height() - wave_h).max(160.0);
            // 자막 목록과 파형 사이 손잡이 (끌어서 파형 높이 바꾸기)
            let top = ui.min_rect().top() + list_h;
            let hr = egui::Rect::from_min_max(egui::pos2(ui.max_rect().left() + 40.0, top - 5.0), egui::pos2(ui.max_rect().right() - 40.0, top + 3.0));
            let (d, dbl, done) = crate::ui_panes::handle(ui, hr, "wave", false, "끌어서 파형 높이 바꾸기 (두 번 누르면 기본 크기)");
            if d != 0.0 { self.panes.wave = (base_wave - d).clamp(100.0, (ui.available_height() - 236.0 - 200.0).max(100.0)); }
            if dbl { self.panes.wave = crate::ui_panes::Panes::default().wave; }
            if done || dbl { self.panes.save(); }
            ui.allocate_ui_with_layout(egui::vec2(ui.available_width(), list_h), egui::Layout::top_down(egui::Align::Min), |ui| {
                self.caption_header(ui);
                ui.add_space(8.0);
                self.caption_toolbar(ui);
                if self.cap_settings_open { ui.add_space(8.0); self.caption_settings(ui); }
                ui.add_space(6.0);
                ui.add(egui::Label::new(RichText::new("두 번 누르기: 시작·끝 미세 조정 · STT 원문: 줄 맨 앞 Backspace / 맨 끝 Delete 합치기 · 출력 자막: Enter 나누기 · 체크 옆 휴지통: 구간 삭제 · Ctrl+Z 취소 · F1 단축키").size(12.5).color(style::FAINT)).truncate());
                self.find_bar(ui);
                ui.add_space(6.0);
                self.caption_list(ui);
            });
            ui.add_space(6.0);
            if self.trim.is_some() { self.trim_panel(ui); ui.add_space(6.0); }
            self.wave_panel(ui);
        });
    }

    fn caption_header(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            let dur = edl::segments_duration(&self.segs);
            let cuts = self.segs.len().saturating_sub(1);
            style::card_title(ui, "captions", "자막 편집", &format!("자막 {}개 · 결과 {} · {}컷", self.lines.len(), edl::format_time(dur, false), cuts));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.checkbox(&mut self.edited, RichText::new("편집 결과로 재생").size(14.0).color(style::TEXT2)).changed() { self.dirty = true; }
            });
        });
    }

    fn caption_toolbar(&mut self, ui: &mut egui::Ui) {
        let n_checked = self.checked_blocks();
        let has_sel = self.word_selection().is_some();
        style::tray().show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
                // 기존 editor.js: 글자는 늘 "지운 부분 숨기기", 되살리기·선택만 남기기는 늘 누를 수 있다 (되살리기는 커서 자리·고른 곳)
                if style::tool(ui, "eye-off", "지운 부분 숨기기").on_hover_text("지운 부분 숨기기·보이기 (H)").clicked() { self.hide_deleted = !self.hide_deleted; }
                if style::tool(ui, "rotate-ccw", "되살리기").on_hover_text("선택한 지운 부분 되살리기 (R)").clicked() { self.handle_restore(); }
                if style::tool(ui, "crop", "선택만 남기기").on_hover_text("선택한 부분만 남기고 나머지 지우기 (Ctrl+K)").clicked() && has_sel { self.keep_selection(); }
                ui.add_space(4.0);
                if style::tool(ui, "wand-sparkles", "자동 정리").on_hover_text("자동 정리: 군말(음·어·아)·되풀이한 말·말 사이 공백 지우기, 지운 곳은 노란 표시 (Ctrl+Shift+C)").clicked() { self.cmd_tidy(); }
                let can_fix = self.ai_can_correct();
                if ui.add_enabled_ui(can_fix, |ui| style::tool(ui, "spell-check", "용어 교정")).inner.on_hover_text("AI 용어 교정: 교회 용어·고유명사 오타 고치기, 제미나이 키 필요 (Ctrl+Shift+T)").on_disabled_hover_text("AI 용어 교정: AI 연결이 필요합니다").clicked() { self.cmd_ai_correct(); }
                ui.add_space(4.0);
                if style::tool(ui, "list-checks", "전체 선택").on_hover_text("모든 자막 구간 선택").clicked() { self.check_all(); }
                if n_checked > 0 {
                    if style::tool(ui, "x", "선택 해제").clicked() { self.checked.clear(); }
                    if style::danger(ui, "trash-2", &format!("선택 구간 삭제 ({n_checked}개)")).clicked() { self.delete_checked(); }
                }
                if edl::has_order(&self.project.words, self.project.order.as_deref()) && style::tool(ui, "list-restart", "원래 순서로").on_hover_text("칸을 끌어 바꾼 설교 내용 순서를 원본 순서로 되돌립니다 (Ctrl+Z 로도 되돌릴 수 있음)").clicked() {
                    self.project.order = None; self.commit(); self.toast("원래 순서로 되돌렸습니다");
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let b = egui::Button::image_and_text(img("sliders-horizontal", 16.0, style::TEXT2), RichText::new("설정").size(13.5).family(style::semi()).color(style::TEXT2))
                        .fill(if self.cap_settings_open { style::PRIMARY_SOFT } else { style::PANEL }).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(0.0, 32.0));
                    if ui.add(b).on_hover_text("자막 한 줄 길이·컷 여백·페이드").clicked() { self.cap_settings_open = !self.cap_settings_open; }
                });
            });
        });
    }

    /// 자막 길이·컷 설정 (기존 #edSettings)
    fn caption_settings(&mut self, ui: &mut egui::Ui) {
        let mut changed = false;
        let st = &mut self.project.settings;
        style::tray().show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal_wrapped(|ui| {
                ui.label(RichText::new("자막 한 줄 최대").size(14.0));
                let mut mc = st.max_line_chars.unwrap_or(14.0);
                if ui.add(egui::DragValue::new(&mut mc).range(1.0..=200.0).speed(0.2)).changed() { st.max_line_chars = Some(mc.round()); changed = true; }
                ui.label(RichText::new("자").size(14.0)); ui.label(style::muted("(공백 제외)"));
                let cur = st.max_line_chars.unwrap_or(14.0) as i64;
                egui::ComboBox::from_id_salt("cap-preset").width(90.0).selected_text(if [8, 12, 14, 16, 20].contains(&cur) { format!("{cur}자") } else { "직접 설정".into() }).show_ui(ui, |ui| {
                    for n in [8i64, 12, 14, 16, 20] { if ui.selectable_label(cur == n, format!("{n}자")).clicked() { st.max_line_chars = Some(n as f64); changed = true; } }
                });
                changed |= ui.checkbox(&mut st.semantic_breaks, "의미 단위로 나누기").on_hover_text("문장 끝·쉼표·말 사이 쉼·이음말 뒤에서 끊고, 붙어 다니는 말은 한 줄에 둡니다").changed();
                changed |= ui.checkbox(&mut st.split_long_words, "긴 단어도 나누기").on_hover_text("한 단어가 제한보다 길면 글자 수에 맞춰 나눕니다 (영상은 그대로)").changed();
            });
            ui.horizontal_wrapped(|ui| {
                ui.label(RichText::new("컷 여백  앞").size(14.0));
                changed |= ui.add(egui::DragValue::new(&mut st.pad_before).range(0.0..=2.0).speed(0.01).fixed_decimals(2)).changed();
                ui.label("뒤");
                changed |= ui.add(egui::DragValue::new(&mut st.pad_after).range(0.0..=2.0).speed(0.01).fixed_decimals(2)).changed();
                ui.label("초");
                ui.add_space(14.0);
                ui.label(RichText::new("페이드").size(14.0));
                changed |= ui.add(egui::DragValue::new(&mut st.fade_ms).range(0.0..=500.0).speed(1.0)).changed();
                ui.label("ms");
            });
            let mut auto = self.settings["editDefaults"]["autoTidy"].as_bool().unwrap_or(true);
            if ui.checkbox(&mut auto, "음성 인식 뒤 군말·말 사이 공백 자동으로 지우기").changed() {
                let mut ed = self.settings["editDefaults"].clone(); if !ed.is_object() { ed = json!({}); } ed["autoTidy"] = json!(auto);
                if let Ok(s) = theme::save_settings(&json!({ "editDefaults": ed })) { self.settings = s; }
            }
        });
        if changed { self.dirty = true; self.unsaved = self.has_project; self.cap_buf.clear(); }
    }

    fn caption_list(&mut self, ui: &mut egui::Ui) {
        if self.project.words.is_empty() {
            egui::ScrollArea::vertical().id_salt("empty-state").auto_shrink([false, false]).show(ui, |ui| self.empty_state(ui));
            return;
        }
        let src_now = self.player.src_now();
        let playing_block = self.blocks.iter().position(|b| b.line.is_some() && { let ws = &self.project.words[b.from..b.to]; let a = ws.iter().filter(|w| !w.del).map(|w| w.start).fold(f64::MAX, f64::min); let z = ws.iter().filter(|w| !w.del).map(|w| w.end).fold(f64::MIN, f64::max); src_now >= a - 0.05 && src_now < z + 0.05 });
        // 재생 중 자막이 화면 밖으로 나가면 따라간다 (멀면 가운데로, 가까우면 보이는 만큼) — 기존 editor.js playbackLoop
        let follow_on = self.player.playing() && self.follow_play;
        let snap = std::mem::take(&mut self.follow_snap);
        self.last_block = playing_block;
        let mut action: Option<Action> = None;
        let max_chars = self.max_chars();
        let focus_from = self.focus_from.take();
        let focus_line = self.focus_line.take();
        let fine_block = self.trim.as_ref().filter(|t| t.range).and_then(|t| self.blocks.iter().position(|b| b.line.is_some() && t.idx_b >= b.from && t.idx_b < b.to));
        let sel = self.sel_range();
        let caret = self.caret;
        let (mark_i, mark_o) = (self.mark_i, self.mark_o);
        let find_hits: (Vec<usize>, Option<usize>) = self.find.as_ref().map(|f| (f.matches.clone(), f.idx.map(|k| f.matches[k]))).unwrap_or_default();
        let mut word_edit = self.word_edit.take();
        let mut word_edit_done: Option<Option<(usize, String, bool)>> = None;
        let caret_scroll = std::mem::take(&mut self.caret_scroll);
        let mut out_focus: Option<f64> = None;
        let n_all = self.project.words.len();
        let hide = self.hide_deleted;
        let mut word_rects: Vec<(usize, egui::Rect)> = vec![];
        let mut check_rects: Vec<(usize, egui::Rect)> = vec![];
        let mut out_rects: Vec<(usize, egui::Rect)> = vec![];
        // 단어 누르기: (단어, Shift, 오른쪽 절반) · 끌기 시작 · 두 번 누르기
        let mut click_word: Option<(usize, bool, bool)> = None;
        let mut drag_start: Option<(usize, bool)> = None;
        // 지운 말 묶음·군말 묶음·컷·쉼 (기존 caption-blocks.js 표시)
        let n_words = self.project.words.len();
        let mut run_of: Vec<Option<(usize, usize)>> = vec![None; n_words];
        let mut fill_run: HashMap<usize, bool> = HashMap::new();
        { let ws = &self.project.words; let mut i = 0; while i < n_words { if ws[i].del { let a = i; while i < n_words && ws[i].del { i += 1; } for k in a..i { run_of[k] = Some((a, i)); } fill_run.insert(a, (a..i).all(|k| tidy::is_filler(&ws[k].text))); } else { i += 1; } } }
        let idx_of: HashMap<i64, usize> = self.project.words.iter().enumerate().map(|(i, w)| (w.id, i)).collect();
        let cut_by_end: HashMap<i64, (usize, f64)> = edl::cut_points(&self.segs).into_iter().filter_map(|c| { let e: i64 = c.key_end.get(2..)?.parse().ok()?; let s: i64 = c.key_start.get(2..)?.parse().ok()?; Some((e, (*idx_of.get(&s)?, (c.in_start - c.out_end).max(0.0)))) }).collect();
        let pause_at: HashMap<usize, (usize, f64)> = tidy::pauses(&self.project.words, &self.segs, 0.5).into_iter().map(|p| (p.prev, (p.i, p.gap))).collect();
        let sec = |v: f64| { let s = format!("{:.2}", (v * 100.0).round() / 100.0); if s.ends_with('0') { s[..s.len() - 1].to_string() } else { s } };
        let src_off = self.src_offset();
        let (blocks_v, words, lines, cap_buf, checked, segs_ref) = (&self.blocks, &self.project.words, &self.lines, &mut self.cap_buf, &self.checked, &self.segs);
        let list_out = egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 10.0;
            for (n, b) in blocks_v.iter().enumerate() {
                let live: Vec<usize> = (b.from..b.to).filter(|&i| !words[i].del).collect();
                if hide && live.is_empty() { continue; }
                let active = playing_block == Some(n) || fine_block == Some(n);
                let n_chk = live.iter().filter(|&&i| checked.contains(&words[i].id)).count();
                let is_chk = !live.is_empty() && n_chk == live.len();
                let border = if is_chk { style::PRIMARY } else if active { Color32::from_rgb(0x93, 0xb4, 0xf5) } else { style::BORDER };
                let fill = if live.is_empty() { style::PANEL2 } else { style::PANEL };
                let frame = egui::Frame::new().fill(fill).stroke(Stroke::new(if active || is_chk { 1.5 } else { 1.0 }, border)).corner_radius(CornerRadius::same(16)).inner_margin(egui::Margin { left: 16, right: 16, top: 12, bottom: 14 });
                let resp = frame.show(ui, |ui| {
                    ui.set_min_width(ui.available_width());
                    // 머리 줄
                    ui.horizontal(|ui| {
                        if b.line.is_some() { ui.dnd_drag_source(egui::Id::unique(("grip", b.from)), n, |ui| { ui.add(img("grip-vertical", 17.0, style::FAINT)); }).response.on_hover_text("끌어서 칸 순서 바꾸기 (자막 칸에서 Alt+↑↓)"); }
                        let mut c = is_chk;
                        let cb = ui.add_enabled(!live.is_empty(), egui::Checkbox::without_text(&mut c).indeterminate(n_chk > 0 && !is_chk));
                        check_rects.push((b.from, cb.rect));
                        if cb.changed() { action = Some(Action::Check(b.from, b.to, c, ui.input(|i| i.modifiers.shift))); }
                        // 번호는 체크 상자의 이름표: 누르면 체크가 바뀐다 (기존 <label>)
                        let num = style::pill(ui, format!("{:03}", n + 1), style::PRIMARY_SOFT, style::PRIMARY).interact(egui::Sense::click()).on_hover_text("같은 STT 단어를 나눠 표시한 구간은 함께 선택됩니다");
                        if num.clicked() && !live.is_empty() { action = Some(Action::Check(b.from, b.to, !is_chk, ui.input(|i| i.modifiers.shift))); }
                        if !live.is_empty() && style::icon_btn(ui, "trash-2", 17.0, style::MUTED, "이 자막 구간 삭제 (영상·음성도 삭제 · Ctrl+Z로 복원)").clicked() { action = Some(Action::Del(b.from, b.to, true)); }
                        let (a, z) = (words[b.from].start, words[b.to - 1].end);
                        let tp = style::pill_button(ui, format!("{} ~ {}", edl::format_time(a + src_off, true), edl::format_time(z + src_off, true)), style::PANEL3, style::TEXT2, ""); if tp.clicked() { action = Some(Action::SeekSrc(a)); }
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            let fine_on = fine_block == Some(n); if !live.is_empty() && style::icon_btn(ui, "audio-waveform", 17.0, if fine_on { style::PRIMARY } else { style::FAINT }, if fine_on { "미세 조정 닫기" } else { "시작·끝 미세 조정 (STT 원문·출력 자막 두 번 누르기)" }).clicked() { action = Some(Action::Fine(b.from, b.to)); }
                            if let Some(li) = b.line { let c = edl::char_count(&lines[li].text); let note = if lines[li].manual_merge { " · 수동 병합" } else if c > max_chars { " · 적용 시 자동 분할" } else { "" };
                                let txt = format!("{c} / {max_chars}자{note}");
                                // 칸이 좁아 시간 표시와 겹치면 글자 수는 보이지 않는다
                                let tw = ui.fonts_mut(|f| f.layout_no_wrap(txt.clone(), egui::FontId::proportional(13.5), Color32::WHITE).size().x);
                                if ui.available_width() > tw + 4.0 { ui.label(RichText::new(txt).size(13.5).color(if c > max_chars { style::WARN } else { style::MUTED })); } }
                            else { ui.label(RichText::new(format!("0 / {max_chars}자")).size(13.5).color(style::MUTED)); }
                        });
                    });
                    ui.add_space(4.0);
                    // STT 원문: 지운 말 묶음(군말은 노란 표시)·잘라 낸 공백·남겨 둔 긴 쉼
                    let mut chip_rects: Vec<egui::Rect> = vec![];
                    let src_row = ui.horizontal_wrapped(|ui| {
                        ui.allocate_ui_with_layout(egui::vec2(82.0, 24.0), egui::Layout::left_to_right(egui::Align::Center), |ui| ui.label(RichText::new("STT 원문").size(13.5).color(style::MUTED)));
                        ui.spacing_mut().item_spacing.x = 0.0;
                        for i in b.from..b.to {
                            let w = &words[i];
                            let run = run_of[i];
                            if w.del && hide {
                                if i == b.from || !words[i - 1].del {
                                    let pr = style::pill_button(ui, "삭제 구간 펼치기", style::PANEL3, style::MUTED, "지운 부분 보이기 (H)"); chip_rects.push(pr.rect); if pr.clicked() { action = Some(Action::ShowDeleted); }
                                    ui.label(" ");
                                }
                                continue;
                            }
                            let filler_run = run.is_some_and(|(ra, _)| fill_run.get(&ra).copied().unwrap_or(false));
                            if w.del && (i == b.from || !words[i - 1].del) && filler_run { style::pill(ui, "군말", Color32::from_rgb(0xfe, 0xf3, 0xc7), style::WARN); ui.label(" "); }
                            let in_sel = sel.is_some_and(|(s0, s1)| i >= s0 && i < s1);
                            let fill = tidy::is_filler(&w.text);
                            let mut t = RichText::new(caption_edit::source_text(w)).size(15.5).color(style::TEXT);
                            if w.del { t = t.strikethrough().color(if filler_run { style::WARN } else { style::FAINT }); if filler_run { t = t.background_color(Color32::from_rgb(0xff, 0xf4, 0xdc)); } }
                            else if fill { t = t.color(Color32::from_rgb(0xd9, 0x77, 0x06)).underline(); }
                            if in_sel { t = t.background_color(Color32::from_rgba_unmultiplied(37, 99, 235, 41)); }
                            if mark_i == Some(i) || mark_o == Some(i) { t = t.background_color(if in_sel { Color32::from_rgba_unmultiplied(245, 158, 11, 89) } else { Color32::from_rgba_unmultiplied(245, 158, 11, 56) }); }
                            let r = ui.add(egui::Label::new(t).sense(egui::Sense::click_and_drag()).selectable(false));
                            let r = if mark_i == Some(i) { r.on_hover_text("쇼츠 시작점") } else if mark_o == Some(i) { r.on_hover_text("쇼츠 끝점") } else { r };
                            if find_hits.0.contains(&i) { ui.painter().rect_stroke(r.rect.expand(1.0), CornerRadius::same(3), Stroke::new(if find_hits.1 == Some(i) { 2.0 } else { 1.0 }, if find_hits.1 == Some(i) { style::PRIMARY } else { Color32::from_rgb(0x93, 0xb4, 0xf5) }), egui::StrokeKind::Outside); if find_hits.1 == Some(i) && caret_scroll { r.scroll_to_me(Some(egui::Align::Center)); } }
                            if caret == i { ui.painter().vline(r.rect.left() - 1.0, r.rect.y_range(), Stroke::new(2.0, style::PRIMARY)); if caret_scroll { r.scroll_to_me(None); } }
                            if caret == n_all && i + 1 == n_all { ui.painter().vline(r.rect.right() + 1.0, r.rect.y_range(), Stroke::new(2.0, style::PRIMARY)); }
                            word_rects.push((i, r.rect));
                            let right = |rr: &egui::Response| rr.interact_pointer_pos().or(ui.ctx().pointer_interact_pos()).is_some_and(|p| p.x > rr.rect.center().x);
                            if r.double_clicked() { action = Some(Action::FineOpen(b.from, b.to)); }
                            else if r.clicked() { click_word = Some((i, ui.input(|x| x.modifiers.shift), right(&r))); }
                            if r.drag_started() { drag_start = Some((i, right(&r))); }
                            let r = if w.del && filler_run { r.on_hover_text("군말(음·어·아)이라 지웠습니다 · 되살리기를 누르면 되살립니다") } else if !w.del && fill { r.on_hover_text("군말로 보입니다 · 누른 뒤 Delete 로 지우기") } else { r };
                            r.on_hover_cursor(egui::CursorIcon::Text);
                            ui.add_space(7.0);
                            if w.del && (i + 1 == b.to || !words[i + 1].del) {
                                if let Some((ra, rb)) = run { if ui.add(egui::Button::new(RichText::new("되살리기").size(12.5).color(style::PRIMARY)).frame(false)).on_hover_text("이 지운 부분 되살리기").clicked() { action = Some(Action::Del(ra, rb, false)); } ui.label(" "); }
                            }
                            if !w.del {
                                if let Some(&(j, gone)) = cut_by_end.get(&w.id) {
                                    if j == i + 1 {
                                        if style::pill_button(ui, format!("✂ 공백 {}초", sec(gone)), Color32::from_rgb(0xfe, 0xf3, 0xc7), style::WARN, &format!("말 사이 공백 {}초를 잘라 냈습니다 · 누르면 컷 미세 조정 (T)", sec(gone))).clicked() { action = Some(Action::Cut(i, j)); }
                                        if words.get(j).is_some_and(|x| x.extra.get("gapCut").and_then(|v| v.as_bool()) == Some(true)) {
                                            if ui.add(egui::Button::new(RichText::new("되살리기").size(12.5).color(style::PRIMARY)).frame(false)).on_hover_text("잘라 낸 공백 되살리기").clicked() { action = Some(Action::RestoreGap(j)); }
                                        }
                                    } else if style::pill_button(ui, format!("✂ {}초", sec(gone)), style::PANEL3, style::MUTED, &format!("여기서 {}초를 잘라 냈습니다 · 누르면 컷 미세 조정 (T)", sec(gone))).clicked() { action = Some(Action::Cut(i, j)); }
                                    ui.label(" ");
                                } else if let Some(&(ni, gap)) = pause_at.get(&i) {
                                    if style::pill_button(ui, format!("⏸ {}초", sec(gap)), style::PANEL3, style::TEXT2, &format!("말 사이 쉼 {}초 · 누르면 잘라 냅니다", sec(gap))).clicked() { action = Some(Action::CutPause(ni)); }
                                    ui.label(" ");
                                }
                            }
                        }
                    });
                    let row_rect = src_row.response.rect;
                    if action.is_none() && ui.input(|x| x.pointer.button_double_clicked(egui::PointerButton::Primary)) {
                        if let Some(p) = ui.ctx().pointer_interact_pos() { if row_rect.contains(p) && !chip_rects.iter().any(|c| c.contains(p)) && !word_rects.iter().any(|(_, r)| r.contains(p)) && ui.ctx().layer_id_at(p) == Some(ui.layer_id()) { action = Some(Action::FineOpen(b.from, b.to)); } }
                    }
                    // 단어 수정 (E·F2): 출력 단어 수정 칸 (Enter 적용 · Esc 취소 · Tab 다음 단어)
                    if let Some((wid, buf, focus)) = word_edit.as_mut().filter(|(w, _, _)| *w >= b.from && *w < b.to) {
                        ui.horizontal(|ui| {
                            ui.add_space(82.0);
                            ui.label(RichText::new("출력 단어 수정:").size(12.0).color(style::PRIMARY));
                            let ww = (buf.chars().count() as f32 * 14.0).max(40.0) + 20.0;
                            let te = ui.add(egui::TextEdit::singleline(buf).desired_width(ww).font(egui::FontId::proportional(14.0)));
                            if *focus { te.request_focus(); let mut st = egui::TextEdit::load_state(ui.ctx(), te.id).unwrap_or_default(); st.cursor.set_char_range(Some(egui::text::CCursorRange::two(egui::text::CCursor::new(0), egui::text::CCursor::new(buf.chars().count())))); st.store(ui.ctx(), te.id); *focus = false; }
                            if te.has_focus() || te.lost_focus() {
                                let (enter, esc, tab) = ui.input_mut(|x| (x.consume_key(egui::Modifiers::NONE, egui::Key::Enter), x.consume_key(egui::Modifiers::NONE, egui::Key::Escape), x.consume_key(egui::Modifiers::NONE, egui::Key::Tab)));
                                if enter || (te.lost_focus() && ui.input(|x| x.key_pressed(egui::Key::Enter))) { word_edit_done = Some(Some((*wid, buf.clone(), false))); }
                                else if tab { word_edit_done = Some(Some((*wid, buf.clone(), true))); }
                                else if esc || (te.lost_focus() && !enter) { word_edit_done = Some(None); }
                            }
                        });
                    }
                    // 출력 자막: Enter 나누기 · 맨 앞 Backspace / 맨 끝 Delete 합치기 · Ctrl+Enter 적용
                    if let Some(li) = b.line {
                        ui.add_space(2.0);
                        if lines[li].manual_merge {
                            if ui.add(egui::Button::new(RichText::new(format!("{max_chars}자로 다시 나누기")).size(12.5).color(style::PRIMARY)).frame(false)).on_hover_text("손으로 합친 줄을 글자 수대로 다시 나눕니다").clicked() { action = Some(Action::Unmerge(li)); }
                        }
                        ui.horizontal(|ui| {
                            ui.allocate_ui_with_layout(egui::vec2(82.0, 30.0), egui::Layout::left_to_right(egui::Align::Center), |ui| ui.label(RichText::new("출력 자막").size(13.5).family(style::semi()).color(style::OK)));
                            let line_text = lines[li].text.clone();
                            let buf = cap_buf.entry(li).or_insert_with(|| line_text.clone());
                            let id = egui::Id::unique(("cap-out", li, lines[li].parts.first().map(|p| (p.id, p.from))));
                            // 글 칸이 받기 전에 Enter·Backspace·Delete 를 가로챈다
                            if ui.memory(|m| m.has_focus(id)) && action.is_none() {
                                let len = buf.chars().count();
                                let cur = egui::TextEdit::load_state(ui.ctx(), id).and_then(|s| s.cursor.char_range()).map(|r| (r.primary.index.0, r.secondary.index.0));
                                let pending = if *buf != line_text { Some(buf.clone()) } else { None };
                                if let Some((p, s)) = cur {
                                    if ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Enter)) { action = Some(Action::Split(li, buf.clone(), p)); }
                                    else if p == 0 && s == 0 && li > 0 && ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Backspace)) { action = Some(Action::MergeUp(li, pending)); }
                                    else if p == len && s == len && li + 1 < lines.len() && ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Delete)) { action = Some(Action::MergeDown(li, pending)); }
                                    else if ui.input_mut(|i| i.consume_key(egui::Modifiers::COMMAND, egui::Key::Enter)) && *buf != line_text { action = Some(Action::EditLine(li, buf.clone())); }
                                }
                            }
                            let r = ui.add(egui::TextEdit::singleline(buf).id(id).desired_width(f32::INFINITY).font(egui::FontId::new(17.0, style::semi())).margin(egui::Margin::symmetric(14, 10)).background_color(style::PANEL2).hint_text("빈칸이면 자막만 숨김 · 영상 유지"))
                                .on_hover_text("Enter: 커서 자리에서 자막 나누기 · 맨 앞 Backspace: 위 자막과 합치기 · 맨 끝 Delete: 아래 자막과 합치기 · Ctrl+Enter: 적용");
                            out_rects.push((b.from, r.rect));
                            if r.gained_focus() { out_focus = edl::out_to_src(segs_ref, lines[li].out_start).map(|x| x.1).or(Some(words[b.from].start)); }
                            if r.double_clicked() { action = Some(Action::FineOpen(b.from, b.to)); }
                            if r.has_focus() && action.is_none() {
                                let (tab, stab, esc, senter) = ui.input_mut(|x| (x.consume_key(egui::Modifiers::NONE, egui::Key::Tab), x.consume_key(egui::Modifiers::SHIFT, egui::Key::Tab), x.consume_key(egui::Modifiers::NONE, egui::Key::Escape), x.consume_key(egui::Modifiers::SHIFT, egui::Key::Enter)));
                                if tab || stab { let pending = if *buf != line_text { Some((li, buf.clone())) } else { None }; action = Some(Action::TabTo(li, if stab { -1 } else { 1 }, pending)); }
                                else if esc { *buf = line_text.clone(); r.surrender_focus(); }
                                else if senter { if *buf != line_text { action = Some(Action::EditLine(li, buf.clone())); } r.surrender_focus(); }
                            }
                            if let Some((anchor, caret)) = focus_line { if lines[li].parts.first().is_some_and(|p| p.id == anchor.id && p.from == anchor.from) {
                                r.request_focus();
                                let mut st = egui::TextEdit::load_state(ui.ctx(), id).unwrap_or_default();
                                let c = egui::text::CCursor::new(caret.min(buf.chars().count()));
                                st.cursor.set_char_range(Some(egui::text::CCursorRange::one(c)));
                                st.store(ui.ctx(), id);
                            } }
                            if focus_from == Some(b.from) { r.request_focus(); }
                            if r.has_focus() {
                                let (up, down) = ui.input_mut(|i| (i.consume_key(egui::Modifiers::ALT, egui::Key::ArrowUp), i.consume_key(egui::Modifiers::ALT, egui::Key::ArrowDown)));
                                if up || down { let pending = if *buf != line_text { Some((li, buf.clone())) } else { None }; action = Some(Action::Step(b.from, if up { -1 } else { 1 }, pending)); }
                            }
                            if action.is_none() && r.lost_focus() && *buf != line_text { action = Some(Action::EditLine(li, buf.clone())); }
                            if !r.has_focus() && *buf == line_text { cap_buf.remove(&li); }
                        });
                    }
                });
                if b.line.is_some() {
                    let rr = &resp.response;
                    let after = ui.ctx().pointer_interact_pos().is_some_and(|p| p.y > rr.rect.center().y);
                    if let Some(src) = rr.dnd_hover_payload::<usize>() { if *src != n { let y = if after { rr.rect.bottom() + 5.0 } else { rr.rect.top() - 5.0 }; ui.painter().hline(rr.rect.x_range(), y, Stroke::new(3.0, style::PRIMARY)); } }
                    if let Some(src) = rr.dnd_release_payload::<usize>() { if *src != n { action = Some(Action::Move(*src, n, after)); } }
                }
                if active && (follow_on || snap) {
                    let (r, clip) = (resp.response.rect, ui.clip_rect());
                    if snap { resp.response.scroll_to_me(Some(egui::Align::Center)); }
                    else if r.top() < clip.top() || r.bottom() > clip.bottom() {
                        let far = r.bottom() < clip.top() - clip.height() || r.top() > clip.bottom() + clip.height();
                        resp.response.scroll_to_me(if far { Some(egui::Align::Center) } else { None });
                    }
                }
            }
        });
        // 단어 누르기: 누른 쪽(왼쪽·오른쪽 절반) 자리에 커서, Shift 면 선택 넓히기, 그 자리로 이동 (기존 editor.js mousedown)
        if let Some((i, shift, right)) = click_word {
            let nc = if right { i + 1 } else { i };
            self.manual_caret = true;
            if shift { let a = if self.selection.is_none() { self.sel_anchor = Some(self.caret); self.caret } else { self.sel_anchor.unwrap_or(self.caret) }; self.selection = Some((a.min(nc), a.max(nc))); }
            else { self.selection = None; self.sel_anchor = Some(nc); }
            self.caret = nc;
            self.seek_caret(nc);
        }
        if let Some((i, right)) = drag_start { let nc = if right { i + 1 } else { i }; if !ui.input(|x| x.modifiers.shift) { self.sel_anchor = Some(nc); self.selection = None; } self.caret = nc; self.word_drag = true; self.manual_caret = true; }
        if self.word_drag {
            if let Some(p) = ui.ctx().pointer_interact_pos() {
                if let Some((j, r)) = word_rects.iter().filter(|(_, r)| r.y_range().contains(p.y) || (p.y - r.center().y).abs() < 14.0).min_by(|a, b| a.1.center().distance(p).total_cmp(&b.1.center().distance(p))) {
                    let nc = if p.x < r.center().x { *j } else { j + 1 };
                    let a = self.sel_anchor.unwrap_or(nc);
                    self.caret = nc;
                    self.selection = Some((a.min(nc), a.max(nc)));
                }
            }
            if !ui.input(|i| i.pointer.any_down()) { self.word_drag = false; }
        }
        self.word_rects = word_rects;
        self.check_rects = check_rects;
        // 직접 스크롤(휠·스크롤 막대·PageUp/Down)하면 따라가기를 멈추고 [재생 위치로] 단추를 띄운다
        let lr = list_out.inner_rect;
        self.list_rect = lr;
        if self.player.playing() && self.follow_play {
            let typing = ui.ctx().egui_wants_keyboard_input();
            let (wheel, page, bar) = ui.input(|i| (i.events.iter().any(|e| matches!(e, egui::Event::MouseWheel { .. })), !typing && (i.key_pressed(egui::Key::PageUp) || i.key_pressed(egui::Key::PageDown)),
                i.pointer.primary_pressed() && i.pointer.interact_pos().is_some_and(|p| lr.contains(p) && p.x >= lr.right() - 12.0)));
            if (wheel && ui.rect_contains_pointer(lr)) || page || bar { self.follow_play = false; }
        }
        if self.player.playing() && !self.follow_play {
            let txt = RichText::new("재생 위치로").size(12.0).color(Color32::WHITE).family(style::semi());
            let w = 10.0 + 14.0 + 12.0 + ui.fonts_mut(|f| f.layout_no_wrap("재생 위치로".into(), egui::FontId::new(12.0, style::semi()), Color32::WHITE).size().x) + 10.0;
            let r = egui::Rect::from_min_size(egui::pos2(lr.right() - 34.0 - w, lr.bottom() - 26.0 - 28.0), egui::vec2(w, 28.0));
            ui.painter().add(egui::epaint::RectShape::filled(r.translate(egui::vec2(0.0, 8.0)).expand(4.0), CornerRadius::same(255), Color32::from_rgba_unmultiplied(37, 99, 235, 40)).with_blur_width(20.0));
            let b = ui.put(r, egui::Button::image_and_text(crate::icons::img("locate-fixed", 14.0, Color32::WHITE), txt).wrap_mode(egui::TextWrapMode::Extend).fill(style::PRIMARY).stroke(Stroke::new(1.0, style::PRIMARY)).corner_radius(CornerRadius::same(255)))
                .on_hover_text("지금 재생 중인 자막으로 돌아가 다시 따라가기");
            if b.clicked() { self.follow_play = true; self.follow_snap = true; }
        }
        self.out_rects = out_rects;
        // 단어 수정 마침
        match word_edit_done {
            Some(Some((wid, text, next))) => {
                self.apply_word_edit(wid, text);
                if next { let ws = &self.project.words; let mut k = wid + 1; while k < ws.len() && ws[k].del { k += 1; } if k < ws.len() { self.caret = k; self.word_edit = Some((k, ws[k].text.clone(), true)); } }
            }
            Some(None) => {}
            None => { self.word_edit = word_edit; }
        }
        // 출력 자막 칸에 들어가면: 재생 멈추고 그 자막 처음으로
        if let Some(t) = out_focus { self.player.stop(); self.manual_caret = true; self.player.seek_src(t); }
        match action {
            Some(Action::SeekSrc(t)) => self.player.seek_src(t),
            Some(Action::Del(a, b, d)) => {
                // 휴지통: 재생을 멈추고, 미세 조정을 닫고, 커서를 칸 첫 단어로 (기존 caption-delete)
                if d { self.player.stop(); self.close_trim(); for i in a..b { let id = self.project.words[i].id; self.checked.remove(&id); } }
                self.toggle_words(a, b, d);
                if d { self.selection = None; self.caret = a; self.sel_anchor = Some(a); self.manual_caret = true; }
            }
            Some(Action::EditLine(li, text)) => {
                let line = self.lines[li].clone();
                self.project.words = caption_edit::apply(&self.project.words, &line, &text);
                self.cap_buf.clear();
                self.commit();
            }
            Some(Action::Move(src, target, after)) => { self.move_block(src, target, after); }
            Some(Action::Step(from, dir, pending)) => {
                if let Some((li, text)) = pending { let line = self.lines[li].clone(); self.project.words = caption_edit::apply(&self.project.words, &line, &text); self.cap_buf.clear(); self.commit(); self.recompute(); }
                if let Some(n) = self.blocks.iter().position(|b| b.line.is_some() && b.from <= from && from < b.to) { if !self.step_block(n, dir) { self.focus_from = Some(self.blocks[n].from); } }
            }
            Some(Action::Check(a, b, on, shift)) => {
                // Shift: 마지막으로 누른 칸과 이 칸 사이(화면에 보이는 순서)의 칸을 모두 같은 상태로
                let here = self.blocks.iter().position(|x| x.from == a);
                let there = self.check_anchor.and_then(|f| self.blocks.iter().position(|x| x.from == f));
                let ranges: Vec<(usize, usize)> = match (shift, here, there) {
                    (true, Some(h), Some(t)) => { let (lo, hi) = (h.min(t), h.max(t)); self.blocks[lo..=hi].iter().map(|x| (x.from, x.to)).collect() }
                    _ => vec![(a, b)],
                };
                for (a, b) in ranges { for i in a..b { let w = &self.project.words[i]; if w.del { continue; } if on { self.checked.insert(w.id); } else { self.checked.remove(&w.id); } } }
                self.check_anchor = Some(a);
            }
            Some(Action::WaveTo(a, z)) => { let pad = ((z - a) * 0.5).max(1.0); self.wave.view_start = (a - pad).max(0.0); self.wave.view_dur = (z - a + pad * 2.0).max(1.0); self.player.seek_src(a); }
            Some(Action::RestoreGap(j)) => self.restore_gap(j),
            Some(Action::CutPause(i)) => self.cut_pause(i),
            Some(Action::ShowDeleted) => self.hide_deleted = false,
            Some(Action::Split(li, text, caret)) => self.split_line(li, text, caret),
            Some(Action::MergeUp(li, pending)) => self.merge_lines(li, true, pending),
            Some(Action::MergeDown(li, pending)) => self.merge_lines(li, false, pending),
            Some(Action::Fine(a, b)) => { self.cap_buf.clear(); self.toggle_fine(a, b.saturating_sub(1)); }
            Some(Action::FineOpen(a, b)) => {
                // 두 번 누르기: 늘 연다 (닫지 않음). 출력 자막 칸에서 빠져나와 화살표 키가 미세 조정으로 가게 (기존 openFineTune)
                ui.ctx().memory_mut(|m| if let Some(id) = m.focused() { m.surrender_focus(id); });
                self.cap_buf.clear(); self.open_fine(a, b.saturating_sub(1));
            }
            Some(Action::Cut(a, b)) => self.open_cut(a, b),
            Some(Action::TabTo(li, dir, pending)) => {
                if let Some((l, text)) = pending { let line = self.lines[l].clone(); self.project.words = caption_edit::apply(&self.project.words, &line, &text); self.cap_buf.clear(); self.commit(); self.recompute(); }
                let target = li as i64 + dir as i64;
                if target >= 0 { if let Some(b) = self.blocks.iter().find(|b| b.line == Some(target as usize)) { self.focus_from = Some(b.from); } }
            }
            Some(Action::Unmerge(li)) => { let line = self.lines[li].clone(); self.project.words = caption_edit::unmerge(&self.project.words, &line); self.cap_buf.clear(); self.commit(); }
            None => {}
        }
    }

    fn wave_panel(&mut self, ui: &mut egui::Ui) {
        let total = self.player.probe.duration;
        let segs = if self.edited { self.segs.clone() } else { vec![] };
        match self.wave.ui(ui, self.peaks.as_deref(), total, self.player.src_now(), self.player.playing(), &segs) {
            ui_wave::WaveEvent::ScrubStart(t) => { self.scrub_resume = self.player.playing(); if self.scrub_resume { self.player.stop(); } self.player.seek_src(t); self.last_still = Some(Instant::now()); }
            ui_wave::WaveEvent::ScrubEnd(t) => { self.player.seek_src(t); self.last_still = Some(Instant::now()); if std::mem::take(&mut self.scrub_resume) { self.player.play(); } }
            ui_wave::WaveEvent::Scrub(t) => { if self.last_still.is_none_or(|x| x.elapsed().as_millis() > 70) { self.player.seek_src(t); self.last_still = Some(Instant::now()); } }
            ui_wave::WaveEvent::Seek(t) => { self.player.seek_src(t); self.last_still = Some(Instant::now()); }
            ui_wave::WaveEvent::None => {}
        }
    }

    // ---------------- 나누기·합치기 ----------------
    /// 고치던 글이 있으면 먼저 적용하고, 같은 줄(첫 조각이 같은 줄)의 새 번호를 돌려준다
    fn apply_pending(&mut self, li: usize, pending: Option<String>) -> Option<usize> {
        let anchor = self.lines.get(li)?.parts.first().map(|p| (p.id, p.from));
        if let Some(text) = pending {
            let line = self.lines[li].clone();
            self.project.words = caption_edit::apply(&self.project.words, &line, &text);
            self.cap_buf.clear(); self.commit(); self.recompute();
            return self.lines.iter().position(|l| l.parts.first().map(|p| (p.id, p.from)) == anchor);
        }
        Some(li)
    }
    pub(crate) fn split_line(&mut self, li: usize, text: String, caret: usize) {
        let pending = if self.lines.get(li).is_some_and(|l| l.text != text) { Some(text) } else { None };
        let Some(li) = self.apply_pending(li, pending) else { return };
        let line = self.lines[li].clone();
        match caption_edit::split(&self.project.words, &line, caret) {
            Some((ws, anchor)) => { self.project.words = ws; self.cap_buf.clear(); self.commit(); self.recompute(); self.focus_line = Some((anchor, 0)); }
            None => {
                // 맨 끝 Enter: 다음 자막으로
                if caret >= line.text.chars().count() { if let Some(next) = self.lines.get(li + 1) { if let Some(p) = next.parts.first() { self.focus_line = Some((caption_edit::Anchor { id: p.id, from: p.from }, 0)); } } }
            }
        }
    }
    pub(crate) fn merge_lines(&mut self, li: usize, up: bool, pending: Option<String>) {
        let Some(li) = self.apply_pending(li, pending) else { return };
        let (a, b) = if up { (li.wrapping_sub(1), li) } else { (li, li + 1) };
        if a >= self.lines.len() || b >= self.lines.len() { return; }
        let (prev, cur) = (self.lines[a].clone(), self.lines[b].clone());
        if let Some((ws, _text, caret, anchor)) = caption_edit::merge(&self.project.words, &prev, &cur) {
            self.project.words = ws; self.cap_buf.clear(); self.commit(); self.recompute();
            self.focus_line = Some((anchor, caret));
        }
    }

    // ---------------- 고르기·지우기 ----------------
    /// 체크한 칸 수 (살아 있는 말이 하나라도 체크된 칸)
    pub(crate) fn checked_blocks(&self) -> usize {
        if self.checked.is_empty() { return 0; }
        self.blocks.iter().filter(|b| (b.from..b.to).any(|i| { let w = &self.project.words[i]; !w.del && self.checked.contains(&w.id) })).count()
    }
    pub(crate) fn check_all(&mut self) { self.checked = self.project.words.iter().filter(|w| !w.del).map(|w| w.id).collect(); }
    pub(crate) fn delete_checked(&mut self) {
        if self.checked.is_empty() { return; }
        let mut n = 0;
        for w in self.project.words.iter_mut() { if self.checked.contains(&w.id) && !w.del { w.del = true; n += 1; } }
        self.checked.clear();
        if n > 0 { self.commit(); self.toast("선택 구간을 삭제했습니다. Ctrl+Z로 복원할 수 있습니다."); }
    }
    /// 단어 고른 범위 [a, b)
    pub(crate) fn word_selection(&self) -> Option<(usize, usize)> { self.sel_range() }
    pub(crate) fn delete_selection(&mut self) {
        let Some((a, b)) = self.word_selection() else { return };
        if self.project.words[a..b].iter().all(|w| w.del) { return; }
        self.toggle_words(a, b, true);
        self.selection = None; self.caret = a;
    }
    pub(crate) fn restore_selection(&mut self) {
        let Some((a, b)) = self.word_selection() else { return };
        if self.project.words[a..b].iter().all(|w| !w.del) { return; }
        self.toggle_words(a, b, false);
    }
    pub(crate) fn keep_selection(&mut self) {
        let Some((a, b)) = self.word_selection() else { return };
        for (i, w) in self.project.words.iter_mut().enumerate() { if i < a || i >= b { w.del = true; } }
        self.commit();
        self.toast("고른 부분만 남겼습니다 (Ctrl+Z 되돌리기)");
    }

}

impl App {
    /// 자막이 없을 때 시작 안내 (기존 editor.js emptyStateHtml): 제목 + 카드 세 장
    pub(crate) fn empty_state(&mut self, ui: &mut egui::Ui) {
        let cards: [(&str, &str, &str, &str, bool); 3] = [
            ("sparkles", "유튜브 주소로 AI 편집", "오른쪽 AI 편집 대화에 설교 영상 주소를 넣으면 구간 추천부터 편집까지 해 줍니다.", "주소 넣기", true),
            ("film", "내 컴퓨터의 영상", "영상 파일을 열고 자막 메뉴의 [자막 만들기]로 음성을 글자로 바꿔 직접 편집합니다.", "영상 파일 열기", false),
            ("folder-open", "저장한 프로젝트", "전에 저장한 편집(.sshorts)을 이어서 합니다.", "프로젝트 열기", false),
        ];
        let avail = ui.available_rect_before_wrap();
        let (cw, gap) = (230.0_f32, 12.0_f32);
        let per_row = (((avail.width() - 16.0 + gap) / (cw + gap)).floor() as usize).clamp(1, 3);
        let rows = cards.len().div_ceil(per_row);
        let card_h = 236.0;
        let total_h = 30.0 + 18.0 + rows as f32 * card_h + (rows - 1) as f32 * gap;
        let mut hit: Option<usize> = None;
        ui.add_space(((avail.height() - total_h) / 2.0).max(20.0));
        ui.vertical_centered(|ui| {
            ui.label(RichText::new("설교 영상을 불러와 시작하세요").size(22.0).family(style::bold()).color(style::TEXT));
            ui.add_space(18.0);
            for row in cards.chunks(per_row).enumerate() {
                let (ri, chunk) = row;
                let w = chunk.len() as f32 * cw + (chunk.len() - 1) as f32 * gap;
                let x0 = avail.center().x - w / 2.0;
                let y0 = ui.cursor().top();
                for (k, (icon, title, text, btn, primary)) in chunk.iter().enumerate() {
                    let r = egui::Rect::from_min_size(egui::pos2(x0 + k as f32 * (cw + gap), y0), egui::vec2(cw, card_h));
                    ui.painter().add(egui::epaint::RectShape::filled(r.translate(egui::vec2(0.0, 2.0)), CornerRadius::same(20), Color32::from_rgba_unmultiplied(15, 23, 42, 10)).with_blur_width(10.0));
                    ui.painter().rect(r, CornerRadius::same(20), Color32::WHITE, Stroke::new(1.0, style::BORDER), egui::StrokeKind::Inside);
                    {
                        let ui = &mut ui.new_child(egui::UiBuilder::new().max_rect(r.shrink2(egui::vec2(18.0, 0.0)).with_min_y(r.top() + 20.0).with_max_y(r.bottom() - 18.0)).layout(egui::Layout::top_down(egui::Align::Min)));
                        ui.spacing_mut().item_spacing.y = 10.0;
                        let (ir, _) = ui.allocate_exact_size(egui::vec2(48.0, 48.0), egui::Sense::hover());
                        ui.painter().rect_filled(ir, CornerRadius::same(15), style::PRIMARY_SOFT);
                        crate::icons::img(icon, 24.0, style::PRIMARY).paint_at(ui, egui::Rect::from_center_size(ir.center(), egui::vec2(24.0, 24.0)));
                        ui.label(RichText::new(*title).size(16.0).family(style::bold()).color(style::TEXT));
                        let mut job = egui::text::LayoutJob::single_section(text.to_string(), egui::TextFormat { font_id: egui::FontId::proportional(12.5), color: style::MUTED, line_height: Some(19.4), ..Default::default() });
                        job.wrap.max_width = ui.available_width(); job.wrap.break_anywhere = true;
                        ui.label(job);
                        // 단추는 카드 아래쪽에 (기존 p 가 flex:1 로 남는 자리를 차지)
                        let left = ui.available_height() - 32.0;
                        if left > 0.0 { ui.add_space(left); }
                        let (fill, color, stroke) = if *primary { (style::PRIMARY, Color32::WHITE, Stroke::new(1.0, style::PRIMARY)) } else { (Color32::WHITE, style::TEXT2, Stroke::new(1.0, style::BORDER_STRONG)) };
                        let b = egui::Button::new(RichText::new(*btn).size(12.0).color(color).family(style::semi())).fill(fill).stroke(stroke).corner_radius(CornerRadius::same(9)).min_size(egui::vec2(0.0, 28.0));
                        if ui.add(b).clicked() { hit = Some(ri * per_row + k); }
                    }
                }
                ui.allocate_exact_size(egui::vec2(w, card_h), egui::Sense::hover());
                ui.add_space(gap);
            }
        });
        match hit {
            Some(0) => { self.chat_open = true; self.focus_chat_url = true; }
            Some(1) => self.cmd_open_video(),
            Some(2) => self.cmd_open_project(),
            _ => {}
        }
    }
}