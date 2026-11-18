//! 화면 꾸밈: 기존 앱 styles.css 의 색·모서리·그림자를 egui 로 옮긴 것 (만나로 밝은 디자인)
use crate::icons;
use eframe::egui::{self, Color32, CornerRadius, FontFamily, FontId, Margin, Response, RichText, Shadow, Stroke, TextStyle, Vec2};

pub const BG: Color32 = Color32::from_rgb(0xf1, 0xf3, 0xf7);
pub const PANEL: Color32 = Color32::WHITE;
pub const PANEL2: Color32 = Color32::from_rgb(0xf6, 0xf8, 0xfb);
pub const PANEL3: Color32 = Color32::from_rgb(0xee, 0xf2, 0xf7);
pub const BORDER: Color32 = Color32::from_rgb(0xe6, 0xeb, 0xf2);
pub const BORDER_STRONG: Color32 = Color32::from_rgb(0xd5, 0xdd, 0xe8);
pub const TEXT: Color32 = Color32::from_rgb(0x0f, 0x17, 0x2a);
pub const TEXT2: Color32 = Color32::from_rgb(0x33, 0x41, 0x55);
pub const MUTED: Color32 = Color32::from_rgb(0x64, 0x74, 0x8b);
pub const FAINT: Color32 = Color32::from_rgb(0x94, 0xa3, 0xb8);
pub const PRIMARY: Color32 = Color32::from_rgb(0x25, 0x63, 0xeb);
pub const PRIMARY_SOFT: Color32 = Color32::from_rgb(0xea, 0xf1, 0xfe);
pub const NAVY: Color32 = Color32::from_rgb(0x0f, 0x1b, 0x33);
pub const NAVY2: Color32 = Color32::from_rgb(0x1a, 0x2a, 0x4b);
pub const DANGER: Color32 = Color32::from_rgb(0xdc, 0x26, 0x26);
pub const OK: Color32 = Color32::from_rgb(0x16, 0xa3, 0x4a);
pub const WARN: Color32 = Color32::from_rgb(0xb4, 0x53, 0x09);
pub const WARN_SOFT: Color32 = Color32::from_rgb(0xfe, 0xf3, 0xc7);

pub fn bold() -> FontFamily { FontFamily::Name(crate::fonts::BOLD.into()) }
pub fn semi() -> FontFamily { FontFamily::Name(crate::fonts::SEMIBOLD.into()) }

pub fn apply(ctx: &egui::Context) {
    ctx.set_visuals(egui::Visuals::light());
    ctx.all_styles_mut(|s| {
        s.text_styles = [
            (TextStyle::Small, FontId::proportional(12.0)),
            (TextStyle::Body, FontId::proportional(14.0)),
            (TextStyle::Button, FontId::proportional(14.0)),
            (TextStyle::Heading, FontId::proportional(18.0)),
            (TextStyle::Monospace, FontId::monospace(13.0)),
        ].into();
        let v = &mut s.visuals;
        v.panel_fill = BG;
        v.window_fill = PANEL;
        v.extreme_bg_color = PANEL;
        v.faint_bg_color = PANEL2;
        v.code_bg_color = PANEL3;
        v.hyperlink_color = PRIMARY;
        v.selection.bg_fill = Color32::from_rgb(0xc7, 0xdb, 0xfd);
        v.selection.stroke = Stroke::new(1.5, PRIMARY);
        v.window_corner_radius = CornerRadius::same(16);
        v.menu_corner_radius = CornerRadius::same(12);
        v.window_stroke = Stroke::new(1.0, BORDER);
        v.window_shadow = Shadow { offset: [0, 14], blur: 40, spread: 0, color: Color32::from_rgba_unmultiplied(15, 23, 42, 46) };
        v.popup_shadow = Shadow { offset: [0, 10], blur: 28, spread: 0, color: Color32::from_rgba_unmultiplied(15, 23, 42, 38) };
        let r = CornerRadius::same(10);
        let w = &mut v.widgets;
        w.noninteractive.bg_fill = PANEL; w.noninteractive.weak_bg_fill = PANEL; w.noninteractive.bg_stroke = Stroke::new(1.0, BORDER); w.noninteractive.fg_stroke = Stroke::new(1.0, TEXT2); w.noninteractive.corner_radius = r;
        w.inactive.bg_fill = PANEL; w.inactive.weak_bg_fill = PANEL; w.inactive.bg_stroke = Stroke::new(1.0, BORDER_STRONG); w.inactive.fg_stroke = Stroke::new(1.0, TEXT); w.inactive.corner_radius = r; w.inactive.expansion = 0.0;
        w.hovered.bg_fill = PANEL2; w.hovered.weak_bg_fill = PANEL2; w.hovered.bg_stroke = Stroke::new(1.0, Color32::from_rgb(0xbf, 0xcd, 0xe0)); w.hovered.fg_stroke = Stroke::new(1.5, TEXT); w.hovered.corner_radius = r; w.hovered.expansion = 0.0;
        w.active.bg_fill = PRIMARY_SOFT; w.active.weak_bg_fill = PRIMARY_SOFT; w.active.bg_stroke = Stroke::new(1.0, PRIMARY); w.active.fg_stroke = Stroke::new(1.5, PRIMARY); w.active.corner_radius = r; w.active.expansion = 0.0;
        w.open = w.active.clone();
        s.spacing.button_padding = Vec2::new(12.0, 6.0);
        s.spacing.item_spacing = Vec2::new(8.0, 8.0);
        s.spacing.interact_size = Vec2::new(36.0, 30.0);
        s.spacing.menu_margin = Margin::same(8);
    });
}

/// 흰 카드 (모서리 20, 옅은 그림자)
pub fn card() -> egui::Frame {
    egui::Frame::new().fill(PANEL).corner_radius(CornerRadius::same(20)).inner_margin(Margin::same(18))
        .shadow(Shadow { offset: [0, 8], blur: 24, spread: 0, color: Color32::from_rgba_unmultiplied(15, 23, 42, 14) })
}

/// 옅은 회색 상자 (도구 모음·설정 묶음)
pub fn tray() -> egui::Frame {
    egui::Frame::new().fill(PANEL2).corner_radius(CornerRadius::same(14)).inner_margin(Margin::symmetric(12, 10)).stroke(Stroke::new(1.0, BORDER))
}

/// 파란 기본 단추
pub fn primary(ui: &mut egui::Ui, icon: Option<&str>, text: &str) -> Response {
    let txt = RichText::new(text).color(Color32::WHITE).family(bold()).size(15.0);
    let b = match icon { Some(i) => egui::Button::image_and_text(icons::img(i, 18.0, Color32::WHITE), txt), None => egui::Button::new(txt) };
    ui.add(b.fill(PRIMARY).stroke(Stroke::NONE).corner_radius(CornerRadius::same(12)).min_size(Vec2::new(0.0, 40.0)))
}

/// 흰 바탕 테두리 단추 (도구 모음)
pub fn tool(ui: &mut egui::Ui, icon: &str, text: &str) -> Response {
    let b = egui::Button::image_and_text(icons::img(icon, 16.0, TEXT2), RichText::new(text).color(TEXT2).size(13.5).family(semi()));
    ui.add(b.fill(PANEL).stroke(Stroke::new(1.0, BORDER)).corner_radius(CornerRadius::same(10)).min_size(Vec2::new(0.0, 32.0)))
}

/// 위험한 일 단추 (빨강 글씨)
pub fn danger(ui: &mut egui::Ui, icon: &str, text: &str) -> Response {
    let b = egui::Button::image_and_text(icons::img(icon, 16.0, DANGER), RichText::new(text).color(DANGER).size(13.5).family(semi()));
    ui.add(b.fill(Color32::from_rgb(0xfe, 0xf2, 0xf2)).stroke(Stroke::new(1.0, Color32::from_rgb(0xfe, 0xca, 0xca))).corner_radius(CornerRadius::same(10)).min_size(Vec2::new(0.0, 32.0)))
}

/// 아이콘만 있는 단추
pub fn icon_btn(ui: &mut egui::Ui, icon: &str, size: f32, color: Color32, tip: &str) -> Response {
    ui.add(egui::Button::image(icons::img(icon, size, color)).frame(false).min_size(Vec2::splat(size + 10.0))).on_hover_text(tip)
}

/// 둥근 알약 꼬리표
pub fn pill(ui: &mut egui::Ui, text: impl Into<String>, fill: Color32, color: Color32) -> Response {
    egui::Frame::new().fill(fill).corner_radius(CornerRadius::same(255)).inner_margin(Margin::symmetric(9, 3))
        .show(ui, |ui| ui.label(RichText::new(text.into()).color(color).size(13.0).family(semi()))).response
}

/// 누를 수 있는 알약 (시각 꼬리표 등)
pub fn pill_button(ui: &mut egui::Ui, text: impl Into<String>, fill: Color32, color: Color32, tip: &str) -> Response {
    ui.add(egui::Button::new(RichText::new(text.into()).color(color).size(13.5).family(semi())).fill(fill).stroke(Stroke::NONE).corner_radius(CornerRadius::same(255)).min_size(Vec2::new(0.0, 26.0))).on_hover_text(tip)
}

/// 카드 머리: 아이콘 + 굵은 제목 + 옅은 설명
pub fn card_title(ui: &mut egui::Ui, icon: &str, title: &str, sub: &str) {
    ui.add(icons::img(icon, 20.0, TEXT2));
    ui.label(RichText::new(title).size(19.0).family(bold()).color(TEXT));
    if !sub.is_empty() { ui.label(RichText::new(sub).size(13.5).color(MUTED)); }
}

/// 글자 입력 칸 (높이 38, 둥근 10)
pub fn text_field<'t>(buf: &'t mut dyn egui::TextBuffer, hint: &str) -> egui::TextEdit<'t> {
    egui::TextEdit::singleline(buf).hint_text(hint).margin(Margin::symmetric(12, 9)).font(FontId::proportional(14.5))
}

pub fn muted(text: impl Into<String>) -> RichText { RichText::new(text.into()).color(MUTED).size(13.5) }

/// 창(모달) 바깥 어두운 곳을 눌렀는지 이 화면에 기록 (눌렀다 뗀 곳이 모두 바깥일 때만: 창 안에서 끌다가 바깥에서 놓은 건 아님)
pub fn note_backdrop<T>(ctx: &egui::Context, mr: &egui::ModalResponse<T>) {
    let hit = mr.backdrop_response.clicked();
    let n = ctx.cumulative_pass_nr(); // 잠금 안에서 ctx 를 다시 부르면 멈추므로 먼저 읽는다
    ctx.data_mut(|d| d.insert_temp(egui::Id::new("ss-backdrop-click"), (n, hit)));
}
pub fn backdrop_clicked(ctx: &egui::Context) -> bool {
    let now = ctx.cumulative_pass_nr();
    ctx.data(|d| d.get_temp::<(u64, bool)>(egui::Id::new("ss-backdrop-click"))).is_some_and(|(n, hit)| hit && n == now)
}
/// 예/아니요 묻기 (맥에서도 한국어 단추). 시험(SS_TEST_YES)에서는 늘 예
pub fn confirm(title: impl AsRef<str>, text: impl AsRef<str>) -> bool {
    if std::env::var("SS_TEST_YES").is_ok() { return true; }
    let r = rfd::MessageDialog::new().set_title(title.as_ref()).set_description(text.as_ref())
        .set_buttons(rfd::MessageButtons::OkCancelCustom("예".into(), "아니요".into())).show();
    matches!(r, rfd::MessageDialogResult::Yes | rfd::MessageDialogResult::Ok) || matches!(&r, rfd::MessageDialogResult::Custom(s) if s == "예")
}
