//! 왼쪽 남색 메뉴 줄과 위 메뉴 막대 (기존 index.html #rail · #topbar)
use crate::*;
use crate::icons::img;

const RAIL: [(&str, &str, Page, &str); 5] = [
    ("clapperboard", "쇼츠 편집", Page::Editor, "쇼츠 편집"),
    ("book-open", "교인 자료", Page::Materials, "설교로 소그룹 자료·QT·성경 퀴즈·설교 요약·묵상카드·가정예배지 만들기"),
    ("music", "배경음악", Page::Music, "배경음악 고르기·구간·페이드"),
    ("palette", "테마", Page::Theme, "쇼츠 테마 편집"),
    ("plug", "AI 연결", Page::Ai, "챗GPT·클로드·제미나이 연결"),
];
const RAIL_BOTTOM: [(&str, &str, Page, &str); 2] = [
    ("circle-help", "설명서", Page::Guide, "사용 설명서"),
    ("settings", "설정", Page::Settings, "설정 (Ctrl+,)"),
];

impl App {
    pub(crate) fn rail(&mut self, ui: &mut egui::Ui) {
        ui.vertical_centered(|ui| {
            ui.add_space(14.0);
            let logo = sermon_shorts::assets_dir().join("images").join("app-icon.png");
            ui.add(crate::icons::file_img(&logo, egui::vec2(50.0, 50.0)).corner_radius(CornerRadius::same(12)));
            ui.add_space(16.0);
            for (icon, label, page, tip) in RAIL { self.rail_item(ui, icon, label, page, tip); }
            let rest = ui.available_height() - 2.0 * 76.0 - 10.0;
            if rest > 0.0 { ui.add_space(rest); }
            for (icon, label, page, tip) in RAIL_BOTTOM { self.rail_item(ui, icon, label, page, tip); }
        });
    }

    fn rail_item(&mut self, ui: &mut egui::Ui, icon: &str, label: &str, page: Page, tip: &str) {
        // 지금 보이는 작업 공간: 교인 자료 > 배경음악 탭 > 쇼츠 편집 (기존 syncRail)
        let on = match page {
            Page::Editor => self.page == Page::Editor && self.design_tab != DesignTab::Music,
            Page::Music => self.page == Page::Editor && self.design_tab == DesignTab::Music,
            _ => self.page == page,
        };
        let size = egui::vec2(72.0, 70.0);
        let (rect, resp) = ui.allocate_exact_size(size, egui::Sense::click());
        let resp = resp.on_hover_text(tip);
        let p = ui.painter();
        if on { p.rect_filled(rect, CornerRadius::same(14), style::NAVY2); }
        else if resp.hovered() { p.rect_filled(rect, CornerRadius::same(14), Color32::from_rgba_unmultiplied(255, 255, 255, 14)); }
        let col = if on { Color32::WHITE } else { Color32::from_rgb(0xb4, 0xc0, 0xd4) };
        let ir = egui::Rect::from_center_size(rect.center() - egui::vec2(0.0, 11.0), egui::vec2(24.0, 24.0));
        img(icon, 24.0, col).paint_at(ui, ir);
        p.text(rect.center() + egui::vec2(0.0, 18.0), egui::Align2::CENTER_CENTER, label, egui::FontId::new(12.5, if on { style::bold() } else { style::semi() }), col);
        if resp.clicked() {
            // 기존 RAIL: 쇼츠 편집 → 디자인 탭, 배경음악 → 배경음악 탭, 설정 → 설정 창
            match page {
                Page::Editor => { self.page = Page::Editor; if self.design_tab == DesignTab::Music { self.design_tab = DesignTab::Design; } }
                Page::Music => { self.page = Page::Editor; self.design_tab = DesignTab::Music; }
                Page::Settings => self.open_settings("general"),
                Page::Ai => self.open_ai_connect(),
                p => self.page = p,
            }
        }
        ui.add_space(6.0);
    }

    pub(crate) fn top_bar(&mut self, ui: &mut egui::Ui) {
        let full = ui.max_rect();
        ui.horizontal_centered(|ui| {
            ui.label(RichText::new(match self.page { Page::Editor => "쇼츠 편집", Page::Materials => "교인 자료", Page::Music => "배경음악", Page::Theme => "테마", Page::Ai => "AI 연결", Page::Guide => "사용 설명서", Page::Settings => "설정" }).size(21.0).family(style::bold()).color(style::TEXT));
            ui.add_space(18.0);
            ui.spacing_mut().button_padding = egui::vec2(10.0, 6.0);
            ui.scope(|ui| {
                let w = &mut ui.visuals_mut().widgets;
                w.inactive.weak_bg_fill = Color32::TRANSPARENT; w.inactive.bg_stroke = Stroke::NONE;
                w.hovered.weak_bg_fill = style::PANEL3; w.hovered.bg_stroke = Stroke::NONE;
                w.open.weak_bg_fill = style::PANEL3; w.open.bg_stroke = Stroke::NONE;
                // 메뉴 막대: 하나가 열려 있으면 옆 메뉴에 마우스만 올려도 그 메뉴가 열린다 (기존 layout.js)
                egui::MenuBar::new().style(egui::style::StyleModifier::default()).ui(ui, |ui| self.menus(ui));
            });
            ui.add_space(6.0);
            let (r, _) = ui.allocate_exact_size(egui::vec2(1.0, 26.0), egui::Sense::hover());
            ui.painter().rect_filled(r, 0.0, style::BORDER);
            ui.add_space(6.0);
            if style::icon_btn(ui, "save", 19.0, style::TEXT2, "저장 (Ctrl+S)").clicked() { self.save_project(false); }
            if ui.add_enabled_ui(self.hist_at >= 2, |ui| style::icon_btn(ui, "undo-2", 19.0, style::TEXT2, "실행 취소 (Ctrl+Z)")).inner.clicked() { self.undo(); }
            if ui.add_enabled_ui(self.hist_at < self.history.len(), |ui| style::icon_btn(ui, "redo-2", 19.0, style::TEXT2, "다시 실행 (Ctrl+Y)")).inner.clicked() { self.redo(); }
        });
        // 가운데: 파일 이름
        if !self.source_name.is_empty() {
            let name = if self.unsaved { format!("{} ·", self.source_name) } else { self.source_name.clone() };
            let nr = ui.painter().text(full.center(), egui::Align2::CENTER_CENTER, name, egui::FontId::new(15.0, style::semi()), style::TEXT2);
            // 부드러운 미리보기 상태 (기존 #proxyStatus)
            if let Some((txt, tip, kind)) = self.proxy.status.clone() {
                let col = match kind { 1 => style::OK, 2 => style::WARN, _ => style::MUTED };
                let g = ui.painter().layout_no_wrap(txt, egui::FontId::new(12.0, style::semi()), col);
                let pr = egui::Rect::from_min_size(egui::pos2(nr.right() + 10.0, full.center().y - g.size().y / 2.0 - 3.0), g.size() + egui::vec2(14.0, 6.0));
                ui.painter().rect_filled(pr, CornerRadius::same(255), if kind == 1 { Color32::from_rgb(0xe7, 0xf8, 0xee) } else if kind == 2 { style::WARN_SOFT } else { style::PANEL3 });
                ui.painter().galley(pr.min + egui::vec2(7.0, 3.0), g, col);
                let resp = ui.interact(pr, egui::Id::new("proxy-status"), egui::Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand).on_hover_text(format!("{tip}\n\n누르면 부드러운 미리보기를 끕니다 (원본으로 미리 보기). 설정 → 편집에서 다시 켤 수 있습니다."));
                ui.ctx().data_mut(|d| d.insert_temp(egui::Id::new("proxy-badge"), pr));
                if resp.clicked() { self.proxy_set_enabled(false, true); self.toast("부드러운 미리보기를 껐습니다. 설정 → 편집에서 다시 켤 수 있습니다."); }
            }
        }
        // 오른쪽: 내보내기
        let r = egui::Rect::from_min_max(egui::pos2(full.right() - if matches!(self.upd.u.status(), sermon_shorts::updater::St::Downloading { .. } | sermon_shorts::updater::St::Ready { .. } | sermon_shorts::updater::St::Portable { .. }) { 760.0 } else { 330.0 }, full.top()), full.max);
        ui.scope_builder(egui::UiBuilder::new().max_rect(r).layout(egui::Layout::right_to_left(egui::Align::Center)), |ui| {
            let busy = self.export.as_ref().map(|j| j.label());
            let can = self.player.path.is_some() && self.project.words.iter().any(|w| !w.del);
            match busy {
                Some(label) => { ui.add_enabled(false, egui::Button::image_and_text(img("share", 18.0, Color32::WHITE), RichText::new(label).color(Color32::WHITE).family(style::bold()).size(15.0)).fill(style::PRIMARY).corner_radius(CornerRadius::same(12)).min_size(egui::vec2(0.0, 40.0))); }
                None => {
                    let r = ui.add_enabled_ui(can, |ui| style::primary(ui, Some("share"), "내보내기")).inner.on_hover_text("MP4·SRT 로 내보내기 (Ctrl+E)");
                    if r.clicked() { self.start_export(); }
                }
            }
            self.update_bar(ui);
            if let Some(st) = self.autosave_status() { ui.add(crate::icons::img("history", 15.0, style::MUTED)); ui.label(RichText::new(st).color(style::MUTED).size(13.0)); }
            else if self.unsaved && self.has_project { ui.label(RichText::new("저장 안 함").color(style::WARN).size(13.0)); }
        });
    }

    fn menus(&mut self, ui: &mut egui::Ui) {
        let item = |ui: &mut egui::Ui, icon: &str, text: &str, key: &str| -> bool {
            let b = egui::Button::image_and_text(img(icon, 16.0, style::TEXT2), RichText::new(text).size(14.0)).shortcut_text(RichText::new(key).size(12.0).color(style::FAINT)).frame_when_inactive(false).min_size(egui::vec2(260.0, 32.0));
            ui.add(b).clicked()
        };
        let soon = |me: &mut App, what: &str| me.toast(format!("{what}: Rust 판으로 옮기는 중입니다 (지금은 Electron 판에서)"));
        ui.menu_button(RichText::new("파일").size(15.0).color(style::TEXT2), |ui| {
            if item(ui, "film", "영상 파일 열기", "Ctrl+Shift+O") { ui.close(); self.cmd_open_video(); }
            if item(ui, "square-play", "유튜브에서 가져오기", "Ctrl+U") { ui.close(); self.cmd_youtube(); }
            ui.separator();
            if item(ui, "folder-open", "프로젝트 열기", "Ctrl+O") { ui.close(); self.cmd_open_project(); }
            if item(ui, "save", "저장", "Ctrl+S") { ui.close(); self.save_project(false); }
            if item(ui, "save-all", "다른 이름으로 저장", "Ctrl+Shift+S") { ui.close(); self.save_project(true); }
            if item(ui, "history", "자동 저장본 열기", "") { ui.close(); self.cmd_open_autosaves(); }
            ui.separator();
            if item(ui, "share", "내보내기 (MP4·SRT)", "Ctrl+E") { ui.close(); self.start_export(); }
        });
        ui.menu_button(RichText::new("편집").size(15.0).color(style::TEXT2), |ui| {
            if item(ui, "undo-2", "실행 취소", "Ctrl+Z") { ui.close(); self.undo(); }
            if item(ui, "redo-2", "다시 실행", "Ctrl+Y") { ui.close(); self.redo(); }
            ui.separator();
            if item(ui, "eye-off", "지운 부분 숨기기·보이기", "H") { ui.close(); self.hide_deleted = !self.hide_deleted; }
            if item(ui, "wand-sparkles", "자동 정리 (군말·반복)", "Ctrl+Shift+C") { ui.close(); self.cmd_tidy(); }
            if item(ui, "fold-horizontal", "말 사이 공백 없애기", "") { ui.close(); self.cmd_gaps(); }
        });
        ui.menu_button(RichText::new("자막").size(15.0).color(style::TEXT2), |ui| {
            if item(ui, "captions", "자막 만들기 (음성 인식)", "") { ui.close(); self.cmd_transcribe(); }
            if item(ui, "spell-check", "AI 용어 교정", "Ctrl+Shift+T") { ui.close(); self.cmd_ai_correct(); }
            ui.separator();
            if item(ui, "sliders-horizontal", "자막 길이·컷 설정", "") { ui.close(); self.cap_settings_open = true; }
        });
        ui.menu_button(RichText::new("AI").size(15.0).color(style::TEXT2), |ui| {
            if item(ui, "plug", "AI 연결 (챗GPT·클로드·제미나이)", "") { ui.close(); self.open_ai_connect(); }
            if item(ui, "sparkles", "AI 쇼츠 추천 (제미나이 키)", "Ctrl+Shift+U") { ui.close(); self.cmd_ai_recommend(); }
            if item(ui, "book-open", "교인 자료 만들기 (소그룹·QT·퀴즈·요약·카드)", "") { ui.close(); self.page = Page::Materials; }
            ui.separator();
            if item(ui, "message-square", "AI 편집 대화 보이기·숨기기", "") { ui.close(); self.chat_open = !self.chat_open; }
        });
        ui.menu_button(RichText::new("도움말").size(15.0).color(style::TEXT2), |ui| {
            if item(ui, "book-open", "사용 설명서", "") { ui.close(); self.page = Page::Guide; }
            if item(ui, "keyboard", "단축키", "F1") { ui.close(); self.help_open = true; }
            if item(ui, "stethoscope", "시스템 점검", "") { ui.close(); self.open_syscheck(); }
            if item(ui, "refresh-cw", "업데이트 확인", "") { ui.close(); self.cmd_update_check(); }
            ui.separator();
            if item(ui, "settings", "설정", "Ctrl+,") { ui.close(); self.open_settings("general"); }
        });
    }
}
