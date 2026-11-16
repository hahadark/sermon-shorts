//! 왼쪽 칸: 9:16 미리보기 무대 + 재생 줄 + 디자인·목소리·배경음악 탭 (기존 #stage · .design-card)
use crate::*;
use crate::icons::img;
use crate::stage::{hkey, Kind};
use sermon_shorts::theme::{num, or, truthy};

impl App {
    pub(crate) fn left_column(&mut self, ui: &mut egui::Ui) {
        style::card().show(ui, |ui| {
            ui.set_min_size(ui.available_size());
            let full_h = ui.available_height();
            let w = ui.available_width();
            let tabs_h = 318.0f32.min(full_h * 0.44);
            let ctrl_h = 78.0;
            let stage_h = (full_h - tabs_h - ctrl_h - 10.0).max(180.0);
            let stage_w = (stage_h * 9.0 / 16.0).min(w);
            let stage_h = stage_w * 16.0 / 9.0;
            ui.vertical_centered(|ui| self.stage_ui(ui, egui::vec2(stage_w, stage_h)));
            ui.add_space(10.0);
            self.play_controls(ui);
            ui.add_space(10.0);
            self.design_tabs(ui);
        });
    }

    /// 9:16 무대: 배경 → (흐린 배경) → 영상 → 제목·꼬리말 → 자막
    fn stage_ui(&mut self, ui: &mut egui::Ui, size: egui::Vec2) {
        let (rect, resp) = ui.allocate_exact_size(size, egui::Sense::click_and_drag());
        let k = rect.width() / template::W as f32;
        let to_screen = |r: egui::Rect| egui::Rect::from_min_max(rect.min + r.min.to_vec2() * k, rect.min + r.max.to_vec2() * k);
        let ctx = ui.ctx().clone();
        // 층 그리기 요청
        let tk = self.theme_key;
        let base_key = hkey(&format!("base{tk}"));
        if self.stage.want(Kind::Base, base_key) { let p = self.draw_params(); self.stage.send(Kind::Base, base_key, p); }
        let over_key = hkey(&format!("over{tk}|{}|{}|{}|{}|{}", self.title, self.verse, self.speaker(), self.church, self.logo_path()));
        if self.stage.want(Kind::Over, over_key) { let p = self.draw_params(); self.stage.send(Kind::Over, over_key, p); }
        let out = edl::src_to_out(&self.segs, self.player.src_now());
        let cap = if self.project.words.is_empty() { None } else { self.caption_at(out) };
        let sub_key = hkey(&format!("sub{tk}|{:?}", cap));
        if self.stage.want(Kind::Sub, sub_key) {
            let mut p = self.draw_params();
            if let Some((t, g, i)) = cap { p.subtitle_text = t; p.subtitle_groups = g; p.karaoke_index = i; }
            self.stage.send(Kind::Sub, sub_key, p);
        }
        let blur_mode = self.theme["canvas"]["mode"].as_str() == Some("blur");
        if blur_mode {
            if let Some(f) = &self.player.frame {
                let b = &self.theme["canvas"]["blur"];
                self.stage.update_blur(&ctx, self.frame_no, &f.rgba, f.w, f.h, num(&b["amount"]).unwrap_or(30.0), num(&b["dim"]).unwrap_or(0.55), self.player.playing());
            }
        }
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 0.0, Color32::BLACK);
        let full_uv = egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0));
        if blur_mode { if let Some(t) = &self.stage.blur { painter.image(t.id(), rect, full_uv, Color32::WHITE); } }
        if let Some(Some(t)) = self.stage.layers[0].as_ref().map(|l| l.tex.as_ref().map(|t| (t.id(), l.rect))) { painter.image(t.0, to_screen(t.1), full_uv, Color32::WHITE); }
        // 영상 상자
        let v = &self.theme["video"];
        let vbox = egui::Rect::from_min_size(egui::pos2(num(&v["x"]).unwrap_or(0.0) as f32, num(&v["y"]).unwrap_or(0.0) as f32), egui::vec2(num(&v["width"]).unwrap_or(1080.0) as f32, num(&v["height"]).unwrap_or(1920.0) as f32));
        let vshow = v["show"] != Value::Bool(false);
        if vshow {
            if let (Some(tex), Some(f)) = (&self.tex, &self.player.frame) {
                let contain = v["fit"].as_str() == Some("contain");
                if let Some((pw, ph, left, top)) = template::placement(f.w as f64, f.h as f64, vbox.width() as f64, vbox.height() as f64, contain, self.crop.scale, self.crop.x, self.crop.y) {
                    let img_r = egui::Rect::from_min_size(vbox.min + egui::vec2(left as f32, top as f32), egui::vec2(pw as f32, ph as f32));
                    let shown = img_r.intersect(vbox);
                    if shown.is_positive() {
                        let uv = egui::Rect::from_min_max(egui::pos2((shown.min.x - img_r.min.x) / img_r.width(), (shown.min.y - img_r.min.y) / img_r.height()), egui::pos2((shown.max.x - img_r.min.x) / img_r.width(), (shown.max.y - img_r.min.y) / img_r.height()));
                        let rad = (or(&v["radius"], 0.0) as f32 * k).min(255.0) as u8;
                        painter.add(egui::epaint::RectShape::filled(to_screen(shown), CornerRadius::same(rad), Color32::WHITE).with_texture(tex.id(), uv));
                    }
                }
            }
        }
        for li in [1usize, 2] {
            if let Some(l) = &self.stage.layers[li] { if let Some(t) = &l.tex { painter.image(t.id(), to_screen(l.rect), full_uv, Color32::WHITE); } }
        }
        stage::round_corners(&painter, rect, 22.0, style::PANEL);
        self.stage_overlay(ui, rect, k);
        if self.player.path.is_none() {
            painter.text(rect.center(), egui::Align2::CENTER_CENTER, "영상을 열면 여기에 보입니다", egui::FontId::proportional(14.0), Color32::from_gray(160));
        }
        // 영상 위치·확대: 영상 상자 안에서 끌기·휠
        let vscreen = to_screen(vbox);
        let over_video = resp.hover_pos().is_some_and(|p| vscreen.contains(p));
        if vshow && self.tex.is_some() {
            if over_video {
                let d = ui.input(|i| i.smooth_scroll_delta().y);
                if d != 0.0 { self.crop.scale = (self.crop.scale + d as f64 * 0.001).clamp(1.0, 3.0); self.crop_changed(); }
                ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
            }
            if resp.drag_started() { if let Some(p) = resp.interact_pointer_pos() { if vscreen.contains(p) { self.crop_drag = Some((p, self.crop)); } } }
            if resp.dragged() {
                if let (Some((p0, c0)), Some(p)) = (self.crop_drag, resp.interact_pointer_pos()) {
                    let d = (p - p0) / k;
                    self.crop.x = (c0.x - d.x as f64 / (vbox.width() as f64 * c0.scale)).clamp(0.0, 1.0);
                    self.crop.y = (c0.y - d.y as f64 / (vbox.height() as f64 * c0.scale)).clamp(0.0, 1.0);
                    self.crop_changed();
                    ui.ctx().set_cursor_icon(egui::CursorIcon::Grabbing);
                }
            }
            if resp.drag_stopped() { self.crop_drag = None; }
            if over_video { resp.clone().on_hover_text("끌어서 영상 위치 · 휠로 확대 (두 번 누르면 처음대로)"); }
            if resp.double_clicked() && over_video { self.crop = export::Crop::default(); self.crop_changed(); }
        }
    }

    fn crop_changed(&mut self) { if self.has_project { self.unsaved = true; } }

    fn play_controls(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            let playing = self.player.playing();
            let b = egui::Button::image_and_text(img(if playing { "pause" } else { "play" }, 17.0, style::TEXT), RichText::new(if playing { "일시정지" } else { "재생" }).size(14.5).family(style::semi()).color(style::TEXT))
                .fill(style::PANEL).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(12)).min_size(egui::vec2(110.0, 40.0));
            if ui.add_enabled(self.player.path.is_some(), b).on_hover_text("Space").clicked() { self.player.toggle(); }
            ui.add_space(6.0);
            let out = self.player.out_t;
            let dur = self.player.duration();
            ui.label(RichText::new(format!("{} / {}", edl::format_time(out, true), edl::format_time(dur, true))).monospace().size(15.0).strong().color(style::TEXT));
            style::pill(ui, if self.edited { "편집본" } else { "원본" }, style::PRIMARY_SOFT, style::PRIMARY);
        });
        ui.add_space(4.0);
        let dur = self.player.duration().max(0.01);
        let (rect, r) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 22.0), egui::Sense::click_and_drag());
        let track = egui::Rect::from_min_max(egui::pos2(rect.left() + 8.0, rect.center().y - 3.0), egui::pos2(rect.right() - 8.0, rect.center().y + 3.0));
        if let Some(p) = r.interact_pointer_pos() { if r.dragged() || r.clicked() || r.drag_stopped() {
            let t = (((p.x - track.left()) / track.width()).clamp(0.0, 1.0) as f64) * dur;
            self.throttled_still_out(t, r.drag_stopped() || r.clicked());
        } }
        let k = (self.player.out_t / dur).clamp(0.0, 1.0) as f32;
        let x = track.left() + track.width() * k;
        let p = ui.painter();
        p.rect_filled(track, CornerRadius::same(3), style::PANEL3);
        p.rect_filled(egui::Rect::from_min_max(track.min, egui::pos2(x, track.max.y)), CornerRadius::same(3), style::PRIMARY);
        p.circle(egui::pos2(x, track.center().y), if r.hovered() || r.dragged() { 9.0 } else { 8.0 }, style::PRIMARY, Stroke::new(3.0, Color32::WHITE));
    }

    pub(crate) fn throttled_still_out(&mut self, out: f64, last: bool) {
        if last || self.last_still.is_none_or(|t| t.elapsed().as_millis() > 70) { self.player.seek(out); self.last_still = Some(Instant::now()); } else { self.player.out_t = out; }
    }

    fn design_tabs(&mut self, ui: &mut egui::Ui) {
        style::tray().show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal(|ui| {
                for (tab, icon, label) in [(DesignTab::Design, "palette", "디자인"), (DesignTab::Voice, "audio-waveform", "목소리"), (DesignTab::Music, "music", "배경음악")] {
                    let on = self.design_tab == tab;
                    let (fill, col) = if on { (style::NAVY, Color32::WHITE) } else { (Color32::TRANSPARENT, style::TEXT2) };
                    let b = egui::Button::image_and_text(img(icon, 16.0, col), RichText::new(label).size(14.0).family(if on { style::bold() } else { style::semi() }).color(col))
                        .fill(fill).stroke(Stroke::NONE).corner_radius(CornerRadius::same(255)).min_size(egui::vec2(0.0, 34.0));
                    if ui.add(b).clicked() { self.design_tab = tab; }
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if style::icon_btn(ui, "settings", 17.0, style::MUTED, "교회 정보 자세히 (설교자 목록·자주 쓰는 말)").clicked() { self.open_settings("church"); }
                });
            });
            ui.add_space(6.0);
            // 칸이 길면 카드 안에서 스크롤 (목소리·배경음악 줄이 잘리지 않게)
            egui::ScrollArea::vertical().id_salt(("design-tab", self.design_tab as u8)).auto_shrink([false, true]).show(ui, |ui| {
                match self.design_tab {
                    DesignTab::Design => self.design_rows(ui),
                    DesignTab::Voice => self.voice_tab(ui),
                    DesignTab::Music => self.music_tab(ui),
                }
            });
        });
    }

    fn design_rows(&mut self, ui: &mut egui::Ui) {
        let label_w = 78.0;
        let row = |ui: &mut egui::Ui, label: &str, add: &mut dyn FnMut(&mut egui::Ui)| {
            ui.horizontal(|ui| {
                ui.allocate_ui_with_layout(egui::vec2(label_w, 38.0), egui::Layout::left_to_right(egui::Align::Center), |ui| ui.label(RichText::new(label).size(13.5).color(style::MUTED)));
                add(ui);
            });
        };
        // 테마
        let mut pick: Option<String> = None;
        let mut edit_theme = false;
        let mut preview_edit = false;
        let cur_id = self.theme["id"].as_str().unwrap_or("").to_string();
        let cur_name = format!("{}{}", self.theme["name"].as_str().unwrap_or("테마"), if self.project_theme { " (프로젝트)" } else { "" });
        let themes: Vec<(String, String)> = self.themes.iter().map(|e| (e.id.clone(), e.name.clone())).collect();
        row(ui, "테마", &mut |ui| {
            let w = (ui.available_width() - 190.0).max(120.0);
            egui::ComboBox::from_id_salt("theme").width(w).selected_text(RichText::new(&cur_name).size(14.5)).show_ui(ui, |ui| {
                for (id, name) in &themes { if ui.selectable_label(*id == cur_id, name).clicked() { pick = Some(id.clone()); } }
            });
            if style::tool(ui, "pencil", "편집").on_hover_text("테마 편집기").clicked() { edit_theme = true; }
            if style::tool(ui, "pencil-line", "미리보기 편집").on_hover_text("미리보기에서 글자·영상 위치를 끌어 바꾸기").clicked() { preview_edit = true; }
        });
        if let Some(id) = pick { self.pick_theme(&id); }
        if edit_theme { self.cmd_edit_theme(); }
        if preview_edit { self.cmd_preview_edit(); }
        // 제목·성경 구절
        let mut changed = false;
        row(ui, "제목", &mut |ui| { changed |= ui.add(style::text_field(&mut self.title, "제목 (‘ / ’ 를 넣으면 줄 나눔, *강조*)").desired_width(f32::INFINITY)).changed(); });
        row(ui, "성경 구절", &mut |ui| { changed |= ui.add(style::text_field(&mut self.verse, "예: 마태복음 6:13").desired_width(f32::INFINITY)).changed(); });
        // 설교자
        let speakers = self.speakers();
        let mut save_speaker = false;
        row(ui, "설교자", &mut |ui| {
            let custom = self.speaker_pick == SPEAKER_CUSTOM;
            let w = if custom { 120.0 } else { ui.available_width() - 4.0 };
            egui::ComboBox::from_id_salt("speaker").width(w).selected_text(RichText::new(&self.speaker_pick).size(14.5)).show_ui(ui, |ui| {
                for s in speakers.iter().map(|s| s.as_str()).chain([SPEAKER_CUSTOM]) {
                    if ui.selectable_label(self.speaker_pick == s, s).clicked() { self.speaker_pick = s.to_string(); changed = true; }
                }
            });
            if custom {
                let can_save = !self.speaker_custom.trim().is_empty() && !speakers.contains(&self.speaker_custom.trim().to_string());
                let bw = if can_save { 40.0 } else { 0.0 };
                changed |= ui.add(style::text_field(&mut self.speaker_custom, "설교자 이름").desired_width(ui.available_width() - bw - 4.0)).changed();
                if can_save && style::icon_btn(ui, "plus", 18.0, style::PRIMARY, "설교자 목록에 저장").clicked() { save_speaker = true; }
            }
        });
        if save_speaker {
            let name = self.speaker_custom.trim().to_string();
            let mut list = self.speakers(); if !list.contains(&name) { list.push(name.clone()); }
            let def = self.settings["defaultSpeaker"].as_str().filter(|s| !s.is_empty()).map(String::from).unwrap_or(name.clone());
            match theme::save_settings(&json!({ "speakers": list, "defaultSpeaker": def })) {
                Ok(s) => { self.settings = s; self.speaker_pick = name.clone(); self.toast(format!("설교자 목록에 \"{name}\"을(를) 저장했습니다")); }
                Err(e) => self.toast(format!("설교자 저장 실패: {e}")),
            }
        }
        // 교회: 로고 · 이름 · 보이기
        let mut choose_logo = false;
        let mut toggle_show = false;
        let shown = truthy(&self.theme["churchName"]["show"]);
        let logo = self.logo_path();
        row(ui, "교회", &mut |ui| {
            let logo_src = if logo.is_empty() { sermon_shorts::assets_dir().join("images").join("logo-default.png") } else { PathBuf::from(&logo) };
            let im = crate::icons::file_img(&logo_src, egui::vec2(30.0, 30.0)).corner_radius(CornerRadius::same(8));
            if ui.add(egui::Button::image(im).fill(style::NAVY).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(40.0, 38.0))).on_hover_text("교회 로고 바꾸기").clicked() { choose_logo = true; }
            if ui.add(style::text_field(&mut self.church, "교회 이름").desired_width(ui.available_width() - 44.0)).changed() { self.church_save_at = Some(Instant::now()); }
            let r = style::icon_btn(ui, if shown { "eye" } else { "eye-off" }, 18.0, if shown { style::PRIMARY } else { style::MUTED }, if shown { "쇼츠에 교회 이름·로고를 보이는 중 (누르면 숨김)" } else { "쇼츠에 교회 이름·로고 보이기 (지금 테마는 숨김)" });
            if r.clicked() { toggle_show = true; }
        });
        if choose_logo {
            if let Some(p) = rfd::FileDialog::new().set_title("교회 로고 고르기").add_filter("그림", &["png", "jpg", "jpeg", "webp"]).pick_file() {
                match theme::import_logo(&p).and_then(|dst| theme::save_settings(&json!({ "template": { "logoPath": dst.to_string_lossy() } }))) {
                    Ok(s) => { self.settings = s; self.toast("로고를 바꿨습니다"); }
                    Err(e) => self.toast(format!("로고 바꾸기 실패: {e}")),
                }
            }
        }
        if toggle_show {
            let on = !shown;
            self.theme["churchName"]["show"] = json!(on);
            self.theme["logo"]["show"] = json!(on);
            self.theme_changed();
            if self.has_project { self.unsaved = true; }
            self.toast(if on { "쇼츠에 교회 이름·로고를 보입니다 (이 프로젝트에만. 테마에 저장하려면 [편집])" } else { "쇼츠에서 교회 이름·로고를 숨겼습니다" });
        }
        if changed && self.has_project { self.unsaved = true; }
    }
}
