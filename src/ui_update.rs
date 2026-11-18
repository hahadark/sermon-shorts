//! 자동 업데이트 화면 (기존 update-ui.js 알림 줄, 도움말 → 업데이트 확인, 설정 [지금 확인]).
//! 시작 15초 뒤 한 번, 그 뒤 6시간마다 확인 (설정에서 끄면 [지금 확인]을 눌렀을 때만). 닫을 때 받아 둔 새 버전을 바꿔 끼운다.
use crate::*;
use sermon_shorts::updater::{St, Updater, RELEASES_URL};
use std::time::{Duration, Instant};

const FIRST_CHECK: Duration = Duration::from_secs(15);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);

pub(crate) struct UpdState {
    pub u: Updater,
    next: Instant,
    /// [업데이트 확인]을 눌러 결과를 알려 줘야 하는지
    manual: bool,
    /// 닫기를 누른 알림 (같은 상태·버전이면 다시 띄우지 않는다)
    closed: String,
    relaunch: bool,
}
impl UpdState {
    pub fn new(enabled: bool) -> UpdState { UpdState { u: Updater::new(enabled), next: Instant::now() + FIRST_CHECK, manual: false, closed: String::new(), relaunch: false } }
}

/// 설정 창에 보일 글 (기존 settings-ui.js UPD)
pub(crate) fn status_text(s: &St) -> String {
    let cur = sermon_shorts::updater::current();
    let t = match s {
        St::Idle => "확인 전".to_string(), St::Checking => "확인 중…".into(), St::Latest => "최신 버전입니다".into(),
        St::Downloading { version, percent } => format!("새 버전 받는 중 {version} {percent}%"), St::Ready { version } => format!("새 버전이 준비됐습니다 (닫을 때 설치) {version}"),
        St::Portable { version, .. } => format!("새 버전이 나왔습니다 {version}"), St::Error { message } => format!("확인하지 못했습니다 ({message})"), St::Off => "개발 실행 중이라 확인하지 않습니다".into(),
    };
    format!("지금 버전 {cur} · {t}")
}

impl App {
    /// 도움말 → 업데이트 확인 (기존 update-check)
    pub(crate) fn cmd_update_check(&mut self) {
        if self.upd.u.status() == St::Off { self.toast(format!("개발용으로 실행 중이라 업데이트를 확인하지 않습니다 (지금 버전 {})", sermon_shorts::updater::current())); return; }
        self.toast("업데이트 확인 중…");
        self.upd.manual = true;
        self.upd.u.check();
    }
    pub(crate) fn update_check_now(&mut self) { self.upd.u.check(); }

    /// 매 화면: 정해진 때 확인, 확인 결과 알림, 닫을 때 바꿔 끼우기
    pub(crate) fn update_poll(&mut self, ctx: &egui::Context) {
        let st = self.upd.u.status();
        if st == St::Off { return; }
        if Instant::now() >= self.upd.next {
            self.upd.next = Instant::now() + CHECK_EVERY;
            let auto = self.settings["autoUpdate"].as_bool() != Some(false);
            if auto && !matches!(st, St::Ready { .. } | St::Downloading { .. }) { self.upd.u.check(); }
        }
        if self.upd.u.busy() || matches!(st, St::Checking | St::Downloading { .. }) { ctx.request_repaint_after(Duration::from_millis(500)); }
        else if self.upd.manual {
            self.upd.manual = false;
            let cur = format!(" (지금 버전 {})", sermon_shorts::updater::current());
            let m = match &st {
                St::Latest => format!("최신 버전입니다{cur}"),
                St::Ready { version } => format!("새 버전 {version} 준비됨 · 위쪽 알림 줄의 [지금 다시 시작]을 누르거나 닫을 때 설치됩니다"),
                St::Portable { version, .. } => format!("새 버전 {version} 이 나왔습니다 · 위쪽 알림 줄의 [내려받기 페이지]에서 받으세요"),
                St::Error { message } => format!("확인하지 못했습니다: {message}"),
                s => format!("업데이트 확인: {s:?}{cur}"),
            };
            self.toast(m);
        }
        // 창을 닫을 때 받아 둔 새 버전을 바꿔 끼운다
        if ctx.input(|i| i.viewport().close_requested()) && matches!(st, St::Ready { .. }) { self.upd.u.spawn_swap(self.upd.relaunch); }
    }

    /// 위쪽 막대의 업데이트 알림 줄 (기존 #updateBar). 보일 것이 없으면 아무것도 그리지 않는다
    pub(crate) fn update_bar(&mut self, ui: &mut egui::Ui) {
        let st = self.upd.u.status();
        if st.key() == self.upd.closed { return; }
        let (text, action): (String, Option<&str>) = match &st {
            St::Downloading { version, percent } => (format!("새 버전 {version} 받는 중… {percent}%"), None),
            St::Ready { version } => (format!("새 버전 {version} 준비됨 · 닫을 때 설치됩니다"), Some("지금 다시 시작")),
            St::Portable { version, reason, .. } => (format!("새 버전 {version} 이 나왔습니다{}", if reason.is_empty() { String::new() } else { format!(" · {reason}") }), Some("내려받기 페이지")),
            _ => return,
        };
        egui::Frame::new().fill(style::PRIMARY_SOFT).stroke(Stroke::new(1.0, Color32::from_rgb(0xbf, 0xd3, 0xfb))).corner_radius(CornerRadius::same(10)).inner_margin(egui::Margin::symmetric(10, 4)).show(ui, |ui| {
            ui.horizontal(|ui| {
                if style::icon_btn(ui, "x", 14.0, style::MUTED, "닫기").clicked() { self.upd.closed = st.key(); }
                if let Some(a) = action {
                    let b = ui.add(egui::Button::new(RichText::new(a).size(12.0).family(style::bold()).color(Color32::WHITE)).fill(style::PRIMARY).corner_radius(CornerRadius::same(8)).min_size(egui::vec2(0.0, 24.0)));
                    if b.clicked() {
                        match &st {
                            St::Ready { .. } => {
                                if crate::style::confirm("업데이트", "저장하지 않은 편집은 사라집니다. 지금 다시 시작해 새 버전을 설치할까요?") {
                                    self.upd.relaunch = true;
                                    ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
                                }
                            }
                            St::Portable { page, .. } => sermon_shorts::ytupload::open_url(if page.is_empty() { RELEASES_URL } else { page }),
                            _ => {}
                        }
                    }
                }
                ui.add(egui::Label::new(RichText::new(text).size(12.5).color(Color32::from_rgb(0x1d, 0x4e, 0xd8))).truncate());
            });
        });
    }
}
