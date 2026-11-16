//! 오른쪽 칸: AI 편집 대화 (기존 chat-ui.js). AI 대화는 Rust 판으로 옮기는 중이라 지금은 시작 안내와 주소 불러오기만 동작한다
use crate::*;

/// 굵은 글씨가 섞인 한 문단 (기존 <p><b>1.</b> … <b>AI 연결</b> …</p>)
fn rich_par(ui: &mut egui::Ui, parts: &[(&str, bool)]) {
    let mut job = egui::text::LayoutJob::default();
    for (t, b) in parts {
        let fam = if *b { style::bold() } else { egui::FontFamily::Proportional };
        job.append(t, 0.0, egui::TextFormat { font_id: egui::FontId::new(13.5, fam), color: style::TEXT2, line_height: Some(21.0), ..Default::default() });
    }
    job.wrap.max_width = ui.available_width();
    job.wrap.break_anywhere = true; // 한글은 글자 사이에서도 줄을 바꾼다 (브라우저와 같게)
    ui.label(job);
}

impl App {
    /// 연결 상태 표시 (누르면 AI 연결 창, 기존 #chatProvider)
    fn chat_chip(&mut self, ui: &mut egui::Ui) {
                    let (chip, ok) = self.ai_chip();
                    let (fill, col) = if ok { (Color32::from_rgb(0xe7, 0xf8, 0xee), Color32::from_rgb(0x15, 0x80, 0x3d)) } else { (Color32::from_rgb(0xff, 0xf4, 0xe5), Color32::from_rgb(0xb4, 0x53, 0x09)) };
                    let r = egui::Frame::new().fill(fill).corner_radius(CornerRadius::same(255)).inner_margin(egui::Margin::symmetric(10, 4))
                        .show(ui, |ui| ui.label(RichText::new(&chip).size(12.0).family(style::bold()).color(col))).response.interact(egui::Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
                    if r.clicked() { self.open_ai_connect(); }
    }

    pub(crate) fn right_column(&mut self, ui: &mut egui::Ui) {
        style::card().inner_margin(egui::Margin::same(0)).show(ui, |ui| {
            ui.set_min_size(ui.available_size());
            let full = ui.available_rect_before_wrap();
            // 머리: 제목 · AI 연결 상태 · [새로] · 기록 지우기 · 접기
            egui::Frame::new().inner_margin(egui::Margin { left: 18, right: 14, top: 14, bottom: 12 }).show(ui, |ui| {
                let narrow = ui.available_width() < 336.0;
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = if narrow { 5.0 } else { 8.0 };
                    ui.add(crate::icons::img("message-square", 19.0, style::TEXT2));
                    ui.label(RichText::new("AI 편집 대화").size(if narrow { 15.5 } else { 18.0 }).family(style::bold()).color(style::TEXT));
                    if !narrow { self.chat_chip(ui); }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.spacing_mut().item_spacing.x = 4.0;
                        if style::icon_btn(ui, "panel-right-close", 17.0, style::MUTED, "대화 창 접기").clicked() { self.chat_open = false; }
                        if style::icon_btn(ui, "trash-2", 17.0, style::MUTED, "대화 기록 지우기").clicked() { self.chat_input.clear(); }
                        let b = egui::Button::image_and_text(crate::icons::img("plus", 14.0, style::TEXT2), RichText::new(if narrow { "" } else { "새로" }).size(12.0).color(style::TEXT2).family(style::semi()))
                            .fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(9)).min_size(egui::vec2(0.0, 28.0));
                        if ui.add(b).on_hover_text("다른 영상으로 새로 시작 (지금 대화와 편집은 위에 남고, 편집은 자동 저장됩니다)").clicked() {
                            self.chat_input.clear(); self.yt_url.clear(); self.focus_chat_url = true;
                        }
                    });
                });
                if narrow { ui.add_space(6.0); ui.horizontal(|ui| self.chat_chip(ui)); }
            });
            let (r, _) = ui.allocate_exact_size(egui::vec2(full.width(), 1.0), egui::Sense::hover());
            ui.painter().rect_filled(r, 0.0, style::BORDER);
            // 아래 입력 칸 높이만큼 남기고 대화 본문
            let compose_h = 142.0;
            let top = ui.cursor().top();
            let body_rect = egui::Rect::from_min_max(egui::pos2(full.left(), top), egui::pos2(full.right(), (full.bottom() - compose_h).max(top + 40.0)));
            ui.painter().rect_filled(body_rect, 0.0, style::PANEL2);
            ui.scope_builder(egui::UiBuilder::new().max_rect(body_rect), |ui| {
                egui::ScrollArea::vertical().id_salt("chat-body").auto_shrink([false, false]).show(ui, |ui| {
                    egui::Frame::new().inner_margin(egui::Margin::same(18)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.spacing_mut().item_spacing.y = 10.0;
                        rich_par(ui, &[("1.", true), (" 오른쪽 위 ", false), ("AI 연결", true), ("에서 챗GPT·클로드·제미나이·오픈라우터 중 하나를 연결합니다. (처음 한 번)", false)]);
                        rich_par(ui, &[("2.", true), (" 유튜브에 올린 ", false), ("설교 영상 주소", true), ("를 넣고 [불러오기]를 누릅니다.", false)]);
                        rich_par(ui, &[("3.", true), (" \"결론 위주로 2분 정도\"처럼 말로 부탁하고, 화면에서 재생해 보며 계속 고쳐 달라고 하면 됩니다.", false)]);
                        ui.add_space(2.0);
                        let url = ui.add(style::text_field(&mut self.yt_url, "https://youtube.com/live/... 또는 https://youtu.be/...").desired_width(f32::INFINITY));
                        if std::mem::take(&mut self.focus_chat_url) { url.request_focus(); }
                        let enter = url.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                        let w = ui.available_width();
                        let load = ui.add_sized([w, 40.0], egui::Button::new(RichText::new("불러오기").color(Color32::WHITE).family(style::bold()).size(15.0)).fill(style::PRIMARY).corner_radius(CornerRadius::same(12))).clicked();
                        if load || enter { let u = self.yt_url.trim().to_string(); self.cmd_load_url(u); }
                    });
                });
            });
            // 입력 (AI 연결 전에는 막혀 있다)
            let crect = egui::Rect::from_min_max(egui::pos2(full.left(), body_rect.bottom()), full.max);
            ui.painter().hline(crect.x_range(), crect.top(), Stroke::new(1.0, style::BORDER));
            ui.scope_builder(egui::UiBuilder::new().max_rect(crect.shrink2(egui::vec2(14.0, 12.0))), |ui| {
                ui.add_enabled(false, egui::TextEdit::multiline(&mut self.chat_input).hint_text("예: 결론 부분으로 2분 정도 만들어 줘").desired_rows(3).desired_width(f32::INFINITY).margin(egui::Margin::same(12)));
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    ui.add_enabled(false, egui::Button::new(RichText::new("영상 만들기").size(13.5).family(style::semi())).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(0.0, 34.0)))
                        .on_disabled_hover_text("완성 영상(MP4)과 자막(SRT) 만들기");
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.add_enabled(false, egui::Button::new(RichText::new("보내기 (Enter)").color(Color32::WHITE).family(style::bold())).fill(style::PRIMARY).corner_radius(CornerRadius::same(12)).min_size(egui::vec2(0.0, 36.0)));
                    });
                });
            });
        });
    }
}
