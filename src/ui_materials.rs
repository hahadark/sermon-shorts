//! 교인 자료 (기존 materials.js · materials-ui.js · materials-doc.js · card-visuals.js · materials-speech · hwp · pdf · pptx)
//! [작업 중] 보조 작업자가 채운다.
use crate::*;

#[derive(Default)]
pub(crate) struct State {}

impl App {
    /// 왼쪽 메뉴 [교인 자료] 화면
    pub(crate) fn materials_page(&mut self, ui: &mut egui::Ui) { self.placeholder(ui, Page::Materials); }
    /// 매 화면: 자료 만들기 진행
    pub(crate) fn materials_ui(&mut self, _ctx: &egui::Context) {}
}
