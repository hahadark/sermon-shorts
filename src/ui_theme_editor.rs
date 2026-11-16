//! 테마 편집기 · 미리보기 직접 편집 (기존 theme-editor.js · preview-edit.js)
//! [작업 중] 보조 작업자가 채운다.
use crate::*;

#[derive(Default)]
pub(crate) struct State {}

impl App {
    /// 왼쪽 메뉴 [테마] 화면
    pub(crate) fn theme_page(&mut self, ui: &mut egui::Ui) { self.placeholder(ui, Page::Theme); }
    /// 디자인 탭 [편집]
    pub(crate) fn cmd_edit_theme(&mut self) { self.toast("테마 편집기: Rust 판으로 옮기는 중입니다"); }
    /// 디자인 탭 [미리보기 편집]
    pub(crate) fn cmd_preview_edit(&mut self) { self.toast("미리보기 편집: Rust 판으로 옮기는 중입니다"); }
    /// 미리보기 무대 위 직접 편집 (무대 그리기 뒤에 불림: 무대 화면 영역과 1080 기준 배율)
    pub(crate) fn stage_overlay(&mut self, _ui: &mut egui::Ui, _stage: egui::Rect, _k: f32) {}
    /// 매 화면: 편집기 창
    pub(crate) fn theme_editor_ui(&mut self, _ctx: &egui::Context) {}
}
