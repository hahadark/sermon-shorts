//! 시스템 점검 창 (기존 renderer/syscheck-ui.js): 도움말 → 시스템 점검, 처음 실행할 때 꼭 필요한 도구가 없으면 저절로.
//! 항목마다 설치·확인 단추, [필요한 것 모두 설치](작은 것부터 차례로). 설치 진행은 창을 닫았다 열어도 이어서 보인다.
use crate::*;
use sermon_shorts::syscheck::{self as sc, Report, Row, St};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};

type Job = (String, &'static str, bool, String); // (행 id, 동작, 성공?, 글)

#[derive(Default)]
pub(crate) struct State {
    pub open: bool,
    pub rows: Vec<Row>,
    pub rx: Option<Receiver<Report>>,
    /// 행 아래 결과 글: (성공? None=진행 중, 글)
    pub results: std::collections::HashMap<String, (Option<bool>, String)>,
    /// 설치 진행 글 (다른 스레드가 고친다)
    progress: Arc<Mutex<std::collections::HashMap<String, String>>>,
    pub installing: bool,
    job_rx: Option<Receiver<Job>>,
    /// [필요한 것 모두 설치] 남은 것
    queue: Vec<(String, &'static str)>,
    auto_checked: bool,
    auto_rx: Option<Receiver<Report>>,
    /// 시험용: 지난 화면의 단추 자리 (행 id:동작 → 자리)
    pub rects: Vec<(String, egui::Rect)>,
}

const ACTION_LABEL: [(&str, &str); 15] = [
    ("update-ytdlp", "업데이트"), ("test-youtube", "유튜브 확인"), ("test-ai", "연결 확인"), ("open-settings", "설정 열기"), ("clear-cache", "캐시 정리"),
    ("install-engine", "엔진 설치"), ("reinstall-engine", "엔진 다시 설치"), ("download-model", "지금 받기"), ("install-ffmpeg", "설치"), ("install-ytdlp", "설치"),
    ("open:python", "다운로드 페이지"), ("open:ffmpeg", "다운로드 페이지"), ("open:ytdlp", "다운로드 페이지"), ("open:node", "Node.js 받기"), ("open:gemini", "키 발급 페이지"),
];
fn label(a: &str) -> &str { ACTION_LABEL.iter().find(|x| x.0 == a).map(|x| x.1).unwrap_or(a) }
/// 설치 동작: (확인 글, 진행 글)
fn install_job(a: &str) -> Option<(Option<&'static str>, &'static str)> {
    match a {
        "install-engine" => Some((Some("자막 엔진을 설치할까요?\nPython 3.12가 없으면 함께 설치하고, PyTorch와 음성 인식 라이브러리 약 3GB를 내려받습니다. 10분 이상 걸릴 수 있으며, 끝날 때까지 앱을 닫지 마세요."), "자막 엔진 설치 준비 중...")),
        "reinstall-engine" => Some((Some("기존 엔진을 지우고 다시 설치할까요?\nPyTorch와 음성 인식 라이브러리 약 3GB를 다시 내려받습니다. 10분 이상 걸릴 수 있습니다."), "자막 엔진 다시 설치 준비 중...")),
        "download-model" => Some((Some("Whisper 모델을 지금 받을까요? (GPU: large-v3 약 3GB, CPU: medium 약 1.5GB)"), "Whisper 모델 받기 준비 중...")),
        "install-ffmpeg" => Some((None, "ffmpeg 받는 중...")),
        "install-ytdlp" => Some((None, "yt-dlp 받는 중...")),
        _ => None,
    }
}
/// [필요한 것 모두 설치] 순서와 안내 (작은 것부터)
const ALL_ORDER: [(&str, &str); 5] = [("install-ffmpeg", "ffmpeg (약 100MB)"), ("install-ytdlp", "yt-dlp (약 20MB)"), ("install-engine", "자막 엔진 (약 3GB, 10분 이상)"), ("reinstall-engine", "자막 엔진 다시 설치 (약 3GB)"), ("download-model", "Whisper 모델 (1.5~3GB)")];

fn yes(title: &str, text: &str) -> bool {
    std::env::var("SS_TEST_YES").is_ok() || crate::style::confirm(title, text)
}

impl App {
    pub(crate) fn open_syscheck(&mut self) {
        self.sys.open = true;
        self.refresh_syscheck();
    }
    fn refresh_syscheck(&mut self) {
        if self.sys.rx.is_some() { return; }
        self.sys.rows.clear();
        let (tx, rx) = channel();
        std::thread::spawn(move || { let _ = tx.send(sc::check_system(false)); });
        self.sys.rx = Some(rx);
    }
    /// 지금 점검 결과에서 설치할 수 있는 것들 (작은 것부터)
    fn pending_installs(&self) -> Vec<(String, &'static str, &'static str)> {
        let mut out: Vec<(String, &'static str, &'static str)> = vec![];
        for r in &self.sys.rows {
            if r.status == St::Ok { continue; }
            if let Some((a, l)) = ALL_ORDER.iter().find(|(a, _)| r.actions.contains(a)) { out.push((r.id.to_string(), a, l)); }
        }
        out.sort_by_key(|x| ALL_ORDER.iter().position(|(a, _)| *a == x.1).unwrap_or(9));
        out
    }

    fn run_sys_action(&mut self, id: &str, act: &'static str, skip_confirm: bool) {
        if let Some(k) = act.strip_prefix("open:") {
            let (ok, m) = sc::open_link(k);
            self.sys.results.insert(id.into(), (Some(ok), m));
            return;
        }
        if act == "open-settings" { self.sys.open = false; self.open_settings("ai"); return; }
        if act == "clear-cache" && !yes("시스템 점검", "유튜브에서 받은 영상과 자막 결과(캐시)를 모두 지울까요?\n지운 영상은 다음에 다시 내려받습니다.") { return; }
        if let Some((confirm, busy)) = install_job(act) {
            if self.sys.installing { return; }
            if !skip_confirm { if let Some(c) = confirm { if !yes("시스템 점검", c) { return; } } }
            self.sys.installing = true;
            self.sys.progress.lock().unwrap().insert(id.into(), busy.into());
            self.sys.results.insert(id.into(), (None, busy.into()));
        } else {
            let busy = match act { "update-ytdlp" => "yt-dlp 업데이트 중...", "test-youtube" => "유튜브에서 영상 정보를 받는 중...", "test-ai" => "Gemini에 연결하는 중...", "clear-cache" => "정리 중...", _ => "..." };
            self.sys.results.insert(id.into(), (None, busy.into()));
        }
        let (tx, rx) = channel::<Job>();
        let (idc, prog) = (id.to_string(), self.sys.progress.clone());
        let model = self.sys.rows.iter().find(|r| r.id == id).map(|r| r.model.clone()).unwrap_or_default();
        std::thread::spawn(move || {
            let on = |pct: Option<f64>, m: String| { prog.lock().unwrap().insert(idc.clone(), format!("{}{m}", pct.map(|p| format!("{p:.0}% · ")).unwrap_or_default())); };
            let (ok, msg) = match act {
                "install-engine" => sc::install_engine(false, on),
                "reinstall-engine" => sc::install_engine(true, on),
                "download-model" => sc::download_model(on),
                "install-ffmpeg" => sc::install_ffmpeg(on),
                "install-ytdlp" | "update-ytdlp" => sc::update_ytdlp(),
                "test-youtube" => sc::test_youtube(sc::TEST_URL),
                "test-ai" => {
                    let s = sermon_shorts::settings::load();
                    let m = if model.is_empty() { sermon_shorts::llm::gemini::DEFAULT_MODEL.to_string() } else { model };
                    sermon_shorts::llm::gemini::test_connection(&sermon_shorts::llm::gemini_key(&s), &m)
                }
                "clear-cache" => { let (ok, m, _, _) = sc::clear_cache(); (ok, m) }
                _ => (false, "알 수 없는 동작".into()),
            };
            prog.lock().unwrap().remove(&idc);
            let _ = tx.send((idc, act, ok, msg));
        });
        self.sys.job_rx = Some(rx);
    }

    fn install_all(&mut self) {
        if self.sys.installing { return; }
        let todo = self.pending_installs();
        if todo.is_empty() { return; }
        let list: Vec<String> = todo.iter().map(|t| format!("· {}", t.2)).collect();
        if !yes("시스템 점검", &format!("다음을 차례로 설치합니다. 끝날 때까지 앱을 닫지 마세요.\n\n{}", list.join("\n"))) { return; }
        self.sys.queue = todo.into_iter().map(|t| (t.0, t.1)).collect();
        if !self.sys.queue.is_empty() { let (id, a) = self.sys.queue.remove(0); self.run_sys_action(&id, a, true); }
    }

    /// 처음 시작할 때: 꼭 필요한 도구가 없으면 점검 창, 아니고 AI 가 안 골라져 있으면 AI 연결 창 (기존 syscheck-ui 자동 열기)
    fn sys_auto(&mut self) {
        if self.sys.auto_checked || self.test.is_some() { return; }
        self.sys.auto_checked = true;
        let (tx, rx) = channel();
        std::thread::spawn(move || { let _ = tx.send(sc::check_system(true)); });
        self.sys.auto_rx = Some(rx);
    }

    /// 매 화면
    pub(crate) fn syscheck_ui(&mut self, ctx: &egui::Context) {
        self.sys_auto();
        if let Some(rx) = &self.sys.auto_rx {
            if let Ok(r) = rx.try_recv() {
                self.sys.auto_rx = None;
                if r.critical { self.open_syscheck(); }
                else if sermon_shorts::llm::active_provider(&self.settings).is_none() && !self.ai.open { self.open_ai_connect(); }
            }
        }
        if let Some(rx) = &self.sys.rx { if let Ok(r) = rx.try_recv() { self.sys.rows = r.rows; self.sys.rx = None; } }
        if let Some(rx) = &self.sys.job_rx {
            if let Ok((id, act, ok, msg)) = rx.try_recv() {
                self.sys.job_rx = None;
                let was_install = install_job(act).is_some();
                if was_install { self.sys.installing = false; if ok { self.toast(msg.clone()); } }
                self.sys.results.insert(id.clone(), (Some(ok), msg));
                if matches!(act, "update-ytdlp" | "clear-cache" | "install-ytdlp") || was_install { self.refresh_syscheck(); }
                // 모두 설치: 실패하면 멈추고, 성공하면 다음 (엔진을 깔아야 모델 받기가 생기므로 점검 뒤 다시 고른다)
                if was_install {
                    if !ok { self.sys.queue.clear(); }
                    else if !self.sys.queue.is_empty() { self.sys.queue.retain(|(_, a)| *a != act); self.sys_queue_after_refresh = true; }
                }
            }
        }
        if self.sys_queue_after_refresh && self.sys.rx.is_none() && !self.sys.rows.is_empty() {
            self.sys_queue_after_refresh = false;
            let next = self.pending_installs().into_iter().find(|t| self.sys.queue.iter().any(|q| q.1 == t.1) || t.1 == "download-model");
            if let Some((id, a, _)) = next { self.sys.queue.retain(|q| q.1 != a); self.run_sys_action(&id, a, true); } else { self.sys.queue.clear(); }
        }
        if self.sys.rx.is_some() || self.sys.job_rx.is_some() || self.sys.auto_rx.is_some() { ctx.request_repaint_after(std::time::Duration::from_millis(250)); }
        if !self.sys.open { return; }
        let progress = self.sys.progress.lock().unwrap().clone();
        let mut close = false;
        let mut act: Option<(String, &'static str)> = None;
        let (mut refresh, mut all) = (false, false);
        let mut rects: Vec<(String, egui::Rect)> = vec![];
        let frame = egui::Frame::new().fill(style::PANEL).corner_radius(CornerRadius::same(18)).inner_margin(egui::Margin::symmetric(22, 18))
            .shadow(egui::epaint::Shadow { offset: [0, 30], blur: 80, spread: 0, color: Color32::from_rgba_unmultiplied(15, 23, 42, 71) });
        let pending = !self.pending_installs().is_empty();
        let mr = egui::Modal::new(egui::Id::new("syscheck")).frame(frame).show(ctx, |ui| {
            ui.set_width(720.0 - 44.0);
            ui.horizontal(|ui| {
                ui.label(RichText::new("시스템 점검").size(18.0).family(style::bold()).color(style::TEXT));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| { if style::icon_btn(ui, "x", 18.0, style::FAINT, "닫기").clicked() { close = true; } });
            });
            ui.label(RichText::new("이 PC에서 SermonShorts에 필요한 도구를 확인합니다.").size(12.0).color(style::MUTED));
            ui.add_space(8.0);
            let maxh = ctx.content_rect().height() * 0.66;
            let so = egui::ScrollArea::vertical().max_height(maxh).min_scrolled_height(maxh).auto_shrink([false, true]).show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 6.0;
                if self.sys.rows.is_empty() {
                    ui.add_space(24.0);
                    ui.vertical_centered(|ui| ui.label(RichText::new("점검 중... (Python 엔진 확인에 몇 초 걸립니다)").size(13.0).color(style::MUTED)));
                    ui.add_space(24.0);
                    return;
                }
                for r in &self.sys.rows {
                    let (bar, icon, icol) = match r.status { St::Ok => (Color32::from_rgb(0x16, 0xa3, 0x4a), "✓", Color32::from_rgb(0x15, 0x80, 0x3d)), St::Warn => (Color32::from_rgb(0xd9, 0x77, 0x06), "!", Color32::from_rgb(0xb4, 0x53, 0x09)), St::Error => (Color32::from_rgb(0xdc, 0x26, 0x26), "✗", Color32::from_rgb(0xdc, 0x26, 0x26)) };
                    let fr = egui::Frame::new().fill(Color32::from_rgb(0xf6, 0xf8, 0xfb)).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(6)).inner_margin(egui::Margin { left: 14, right: 12, top: 8, bottom: 8 }).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.horizontal(|ui| {
                            ui.add_sized([18.0, 26.0], egui::Label::new(RichText::new(icon).size(15.0).family(style::bold()).color(icol)));
                            ui.allocate_ui_with_layout(egui::vec2(160.0, 26.0), egui::Layout::left_to_right(egui::Align::Center), |ui| { ui.set_min_size(egui::vec2(160.0, 26.0)); ui.add(egui::Label::new(RichText::new(r.name).size(13.0).family(style::bold()).color(style::TEXT)).truncate()); });
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                for a in r.actions.iter().rev() {
                                    let dis = install_job(a).is_some() && self.sys.installing;
                                    let b = ui.add_enabled(!dis, egui::Button::new(RichText::new(label(a)).size(12.0).color(style::TEXT)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(8)).min_size(egui::vec2(0.0, 26.0)));
                                    rects.push((format!("{}:{a}", r.id), b.rect));
                                    if b.clicked() { act = Some((r.id.to_string(), a)); }
                                }
                                ui.add(egui::Label::new(RichText::new(&r.value).size(12.5).color(style::TEXT2)).truncate());
                            });
                        });
                        let res = progress.get(r.id).map(|p| (None, p.clone())).or_else(|| self.sys.results.get(r.id).cloned());
                        if !r.hint.is_empty() { ui.horizontal(|ui| { ui.add_space(28.0); ui.add(egui::Label::new(RichText::new(&r.hint).size(11.5).color(if r.status == St::Error { Color32::from_rgb(0xdc, 0x26, 0x26) } else { style::MUTED })).wrap()); }); }
                        if let Some((ok, m)) = res.filter(|x| !x.1.is_empty()) {
                            let col = match ok { None => style::MUTED, Some(true) => Color32::from_rgb(0x15, 0x80, 0x3d), Some(false) => Color32::from_rgb(0xdc, 0x26, 0x26) };
                            ui.horizontal(|ui| { ui.add_space(28.0); ui.add(egui::Label::new(RichText::new(m).size(12.0).color(col)).wrap()); });
                        }
                    });
                    let rr = fr.response.rect;
                    ui.painter().rect_filled(egui::Rect::from_min_max(rr.min, egui::pos2(rr.left() + 4.0, rr.bottom())), CornerRadius { nw: 6, sw: 6, ne: 0, se: 0 }, bar);
                }
            });
            rects.push(("clip".into(), so.inner_rect));
            ui.add_space(12.0);
            ui.horizontal(|ui| {
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let c = ui.add(egui::Button::new(RichText::new("닫기").size(13.0).color(Color32::WHITE).family(style::semi())).fill(style::PRIMARY).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(0.0, 34.0)));
                    rects.push(("close".into(), c.rect)); if c.clicked() { close = true; }
                    let d = ui.add_enabled(self.sys.rx.is_none(), egui::Button::new(RichText::new("다시 점검").size(13.0).color(style::TEXT)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(0.0, 34.0)));
                    rects.push(("refresh".into(), d.rect)); if d.clicked() { refresh = true; }
                    let a = ui.add_enabled(pending && !self.sys.installing, egui::Button::new(RichText::new("필요한 것 모두 설치").size(13.0).color(style::TEXT)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(0.0, 34.0)));
                    rects.push(("install-all".into(), a.rect)); if a.clicked() { all = true; }
                });
            });
        });
        self.sys.rects = rects;
        if mr.backdrop_response.clicked() { close = true; }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) { close = true; }
        if let Some((id, a)) = act { self.run_sys_action(&id, a, false); }
        if refresh { self.refresh_syscheck(); }
        if all { self.install_all(); }
        if close { self.sys.open = false; }
    }
}
