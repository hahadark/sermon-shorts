//! 칸 크기 끌어서 바꾸기: 왼쪽 칸·AI 대화 칸 너비, 자막 목록과 파형 사이, 미리보기와 디자인 탭 사이.
//! 손잡이를 두 번 누르면 기본 크기로. 크기는 사용자 폴더의 layout.json 에 남긴다.
use crate::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub(crate) struct Panes { pub left: f32, pub chat: f32, pub wave: f32, pub tabs: f32 }
impl Default for Panes { fn default() -> Self { Self { left: 440.0, chat: 380.0, wave: 168.0, tabs: 318.0 } } }

pub(crate) const LEFT_MIN: f32 = 360.0;
pub(crate) const CHAT_MIN: f32 = 280.0;
pub(crate) const CENTER_MIN: f32 = 360.0;

fn file() -> PathBuf { sermon_shorts::theme::user_data_dir().join("layout.json") }
impl Panes {
    pub fn load() -> Panes { std::fs::read_to_string(file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default() }
    pub fn save(&self) { let _ = std::fs::write(file(), serde_json::to_string_pretty(self).unwrap_or_default()); }
}

/// 손잡이 하나: 끈 거리(가로면 x, 세로면 y), 두 번 눌렀는지, 놓았는지
pub(crate) fn handle(ui: &mut egui::Ui, rect: egui::Rect, id: &str, horizontal: bool, tip: &str) -> (f32, bool, bool) {
    ui.ctx().data_mut(|d| d.insert_temp(egui::Id::new(("pane-rect", id)), rect));
    let r = ui.interact(rect, egui::Id::new(("pane-handle", id)), egui::Sense::click_and_drag());
    let r = r.on_hover_cursor(if horizontal { egui::CursorIcon::ResizeHorizontal } else { egui::CursorIcon::ResizeVertical }).on_hover_text(tip);
    let hot = r.hovered() || r.dragged();
    if hot {
        let c = rect.center();
        let p = ui.painter();
        if horizontal { p.line_segment([egui::pos2(c.x, rect.top() + 8.0), egui::pos2(c.x, rect.bottom() - 8.0)], Stroke::new(3.0, style::PRIMARY.gamma_multiply(0.55))); }
        else { p.line_segment([egui::pos2(rect.left() + 8.0, c.y), egui::pos2(rect.right() - 8.0, c.y)], Stroke::new(3.0, style::PRIMARY.gamma_multiply(0.55))); }
    }
    let d = if horizontal { r.drag_delta().x } else { r.drag_delta().y };
    (d, r.double_clicked(), r.drag_stopped())
}

/// 시험용: 손잡이 자리
pub(crate) fn rect_of(ctx: &egui::Context, id: &str) -> Option<egui::Rect> { ctx.data(|d| d.get_temp::<egui::Rect>(egui::Id::new(("pane-rect", id)))) }
