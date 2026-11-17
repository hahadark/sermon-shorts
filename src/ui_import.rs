//! 유튜브에서 가져오기 · 구간 고르기 · 자막 생성 (기존 import.js · recent-yt.js 흐름과 글을 그대로)
//!   주소 넣기 → 구간 고르기(미리보기·자동 자막) → 구간 받기 진행 → 자막 생성(음성 인식) → 자동 정리
use crate::*;
use sermon_shorts::{media, source_fetch as sf, stt, youtube as yt};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

type Shared<T> = Arc<Mutex<T>>;

#[derive(Default)]
pub(crate) struct State { pub dlg: Option<Dlg> }

pub(crate) enum Dlg { Url(UrlDlg), Picker(Box<Picker>), Fetch(FetchDlg), Trans(TransDlg), Recover(Box<Recover>) }

/// 원본 영상 되살리기 (기존 source-recover.js): 묻기 → 다시 받기 진행
pub(crate) struct Recover { pub proj: Option<PathBuf>, pub origin: crate::ui_autosave::Origin, pub saved: Value, pub plan: sf::Plan, pub failure: String, prog: Shared<(f64, String)>, rx: Option<Receiver<Result<Value, String>>> }

pub(crate) struct UrlDlg {
    pub url: String,
    asked: String,
    edited: Option<Instant>,
    pub info: Option<Result<yt::Formats, String>>,
    rx: Option<Receiver<(String, Result<yt::Formats, String>)>>,
    focus: bool,
}

pub(crate) struct Picker {
    pub url: String,
    pub info: yt::Formats,
    pub player: Player,
    probe_rx: Option<Receiver<Result<media::Probe, String>>>,
    preview_err: Option<String>,
    first_seek: Option<f64>,
    tex: Option<egui::TextureHandle>,
    pub start: f64,
    pub end: f64,
    start_buf: String,
    end_buf: String,
    pub full: bool,
    pub subs: Option<Result<Option<Vec<yt::SubLine>>, String>>,
    subs_rx: Option<Receiver<Result<Option<Vec<yt::SubLine>>, String>>>,
    last_active: Option<usize>,
    pub ok: bool,
}

pub(crate) struct FetchDlg { title: String, prog: Shared<(f64, String)>, rx: Receiver<Result<yt::Fetched, String>>, url: String, start: f64, end: f64, full: bool, src_title: String, src_dur: f64 }

pub(crate) struct TransDlg { pub path: PathBuf, offset: f64, pub range: String, pub running: bool, prog: Shared<(f64, String)>, rx: Option<Receiver<Result<Value, String>>>, cancel: Arc<AtomicBool>, pub err: String, auto: bool }

fn fmt(t: f64) -> String { edl::format_time(t, false) }

// ---------- 기존 .ss-modal 모양 ----------
const MODAL_W: f32 = 520.0 - 56.0;
const WIDE_W: f32 = 900.0 - 56.0;
const INFO_TEXT: Color32 = Color32::from_rgb(0x1e, 0x3a, 0x8a);
const ACTIVE_TEXT: Color32 = Color32::from_rgb(0x1d, 0x4e, 0xd8);
const PRIMARY_OFF: Color32 = Color32::from_rgb(0xbf, 0xd3, 0xfb);
const PROG_TEXT: Color32 = Color32::from_rgb(0x47, 0x55, 0x69);
const LINE: Color32 = Color32::from_rgb(0xe5, 0xe7, 0xeb);

fn modal_frame() -> egui::Frame {
    egui::Frame::new().fill(style::PANEL).corner_radius(CornerRadius::same(24)).inner_margin(egui::Margin::symmetric(28, 26))
        .shadow(egui::epaint::Shadow { offset: [0, 30], blur: 80, spread: 0, color: Color32::from_rgba_unmultiplied(15, 23, 42, 71) })
}
fn modal<R>(ctx: &egui::Context, id: &str, width: f32, title: &str, body: impl FnOnce(&mut egui::Ui) -> R) -> R {
    let mr = egui::Modal::new(egui::Id::unique(id)).frame(modal_frame()).backdrop_color(Color32::from_rgba_unmultiplied(15, 23, 42, 97)).show(ctx, |ui| {
        ui.set_width(width);
        ui.label(RichText::new(title).size(20.8).family(style::bold()).color(style::TEXT));
        ui.add_space(20.0);
        body(ui)
    });
    crate::style::note_backdrop(ctx, &mr);
    mr.inner
}
fn label(ui: &mut egui::Ui, text: &str) { ui.label(RichText::new(text).size(14.4).family(style::semi()).color(style::MUTED)); ui.add_space(6.0); }
/// 기존 .ss-btn (취소: 흰 바탕 · 기본: 파랑)
fn btn(ui: &mut egui::Ui, text: &str, primary: bool, enabled: bool) -> egui::Response {
    let (fill, color, stroke) = if primary { (if enabled { style::PRIMARY } else { PRIMARY_OFF }, Color32::WHITE, Stroke::NONE) } else { (Color32::WHITE, style::TEXT, Stroke::new(1.0, style::BORDER_STRONG)) };
    let b = egui::Button::new(RichText::new(text).size(15.2).color(color)).fill(fill).stroke(stroke).corner_radius(CornerRadius::same(4)).min_size(egui::vec2(0.0, 36.0));
    ui.scope(|ui| { ui.spacing_mut().button_padding = egui::vec2(20.0, 8.0); if !enabled { ui.disable(); ui.style_mut().visuals.disabled_alpha = 1.0; } ui.add(b) }).inner
}
fn actions(ui: &mut egui::Ui, add: impl FnOnce(&mut egui::Ui)) {
    ui.add_space(24.0);
    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| { ui.spacing_mut().item_spacing.x = 12.0; add(ui); });
}
/// 기존 .ss-progress-container
fn progress(ui: &mut egui::Ui, pct: f64, text: &str) {
    ui.add_space(12.0);
    let (r, _) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 10.0), egui::Sense::hover());
    ui.painter().rect_filled(r, CornerRadius::same(5), style::PANEL3);
    let w = r.width() * (pct.clamp(0.0, 100.0) / 100.0) as f32;
    if w > 0.0 { ui.painter().rect_filled(egui::Rect::from_min_size(r.min, egui::vec2(w, 10.0)), CornerRadius::same(5), style::PRIMARY); }
    ui.add_space(8.0);
    ui.vertical_centered(|ui| ui.label(RichText::new(text).size(14.4).color(PROG_TEXT)));
}
/// 기존 .ss-info-box (왼쪽 파란 줄)
fn info_box(ui: &mut egui::Ui, add: impl FnOnce(&mut egui::Ui)) {
    let r = egui::Frame::new().fill(style::PRIMARY_SOFT).corner_radius(CornerRadius::same(12)).inner_margin(egui::Margin { left: 18, right: 14, top: 12, bottom: 12 })
        .show(ui, |ui| { ui.set_width(ui.available_width()); add(ui); }).response.rect;
    ui.painter().rect_filled(egui::Rect::from_min_max(r.min, egui::pos2(r.left() + 4.0, r.bottom())), CornerRadius { nw: 12, sw: 12, ne: 0, se: 0 }, style::PRIMARY);
    ui.add_space(16.0);
}
/// Esc 또는 창 바깥 어두운 곳 누르기 (기존 app.js: 바깥을 누르면 그 창의 닫기·취소를 누른 것과 같다)
fn escape(ctx: &egui::Context) -> bool { ctx.input(|i| i.key_pressed(egui::Key::Escape)) || crate::style::backdrop_clicked(ctx) }

/// 최근 목록의 날짜 (오늘 · 어제 · M월 D일)
fn when(at_ms: f64) -> String {
    if at_ms <= 0.0 { return String::new(); }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0);
    let day = |ms: f64| ((ms / 1000.0) as i64 + yt::local_offset_secs()).div_euclid(86400);
    let (d, n) = (day(at_ms), day(now));
    if d == n { return "오늘".into(); }
    if d == n - 1 { return "어제".into(); }
    let (_, m, dd) = yt::civil_from_days(d);
    format!("{m}월 {dd}일")
}

impl App {
    /// 창이 떠 있으면 편집 화면 단축키를 막는다 (기존 SS.state.dialogOpen)
    pub(crate) fn dialog_open(&self) -> bool { self.import.dlg.is_some() || self.export_view.is_some() || self.asv.browser.is_some() || self.prefs.open.is_some() || self.bgm.lib.is_some() || self.bgm.mgr.is_some() || self.help_open || self.sys.open || self.ai.open }

    /// 파일 → 유튜브에서 가져오기 (Ctrl+U)
    pub(crate) fn cmd_youtube(&mut self) {
        if self.import.dlg.is_some() { return; }
        self.import.dlg = Some(Dlg::Url(UrlDlg { url: String::new(), asked: String::new(), edited: None, info: None, rx: None, focus: true }));
    }
    /// 주소를 넣은 채로 가져오기 창 (AI 편집 대화의 [불러오기], 시험)
    pub(crate) fn cmd_load_url(&mut self, url: String) {
        if url.trim().is_empty() { self.toast("유튜브 주소를 넣어 주세요"); return; }
        if self.import.dlg.is_some() { return; }
        self.import.dlg = Some(Dlg::Url(UrlDlg { url, asked: String::new(), edited: Some(Instant::now() - std::time::Duration::from_secs(1)), info: None, rx: None, focus: false }));
    }
    /// 자막 → 자막 만들기 (음성 인식)
    pub(crate) fn cmd_transcribe(&mut self) {
        if self.player.path.is_none() { self.toast("먼저 영상을 열거나 유튜브에서 가져와 주세요."); return; }
        if self.import.dlg.is_some() { return; }
        let off = self.src_offset();
        self.open_transcribe(self.project.source_path.clone(), off, String::new(), false);
    }
    fn open_transcribe(&mut self, path: PathBuf, offset: f64, range: String, auto: bool) {
        self.import.dlg = Some(Dlg::Trans(TransDlg { path, offset, range, running: false, prog: Arc::new(Mutex::new((0.0, "준비 중…".into()))), rx: None, cancel: Arc::new(AtomicBool::new(false)), err: String::new(), auto }));
    }
    /// 원본 영상 파일의 0초가 원래 유튜브 영상의 몇 초인지 (구간만 받은 영상)
    pub(crate) fn src_offset(&self) -> f64 { self.project.rest.get("source").and_then(|s| s["offset"].as_f64()).unwrap_or(0.0) }

    pub(crate) fn import_ui(&mut self, ctx: &egui::Context) {
        let Some(dlg) = self.import.dlg.take() else { return };
        let next = match dlg {
            Dlg::Url(d) => self.url_dialog(ctx, d),
            Dlg::Picker(p) => self.picker_dialog(ctx, p),
            Dlg::Fetch(f) => self.fetch_dialog(ctx, f),
            Dlg::Trans(t) => self.trans_dialog(ctx, t),
            Dlg::Recover(r) => self.recover_dialog(ctx, r),
        };
        if self.import.dlg.is_none() { self.import.dlg = next; }
        if self.import.dlg.is_some() { ctx.request_repaint_after(std::time::Duration::from_millis(100)); }
    }

    // ---------------- 1) 유튜브에서 가져오기 (주소) ----------------
    fn url_dialog(&mut self, ctx: &egui::Context, mut d: UrlDlg) -> Option<Dlg> {
        if let Some(rx) = &d.rx { if let Ok((u, r)) = rx.try_recv() { d.rx = None; if u == d.url.trim() { d.info = Some(r); } } }
        // 쓰기를 멈추고 0.4초 뒤 영상 정보 (기존 debounce 400ms)
        if d.edited.is_some_and(|t| t.elapsed().as_millis() >= 400) {
            d.edited = None;
            let u = d.url.trim().to_string();
            if yt::parse_youtube_url(&u).is_none() { d.info = None; d.rx = None; d.asked.clear(); }
            else if u != d.asked || d.info.is_none() && d.rx.is_none() {
                d.asked = u.clone(); d.info = None;
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::spawn(move || { let r = yt::resolve_formats(&u, false); let _ = tx.send((u, r)); });
                d.rx = Some(rx);
            }
        }
        let recent = yt::recent_list(&self.settings);
        let (mut close, mut go, mut pick) = (false, false, None::<String>);
        let ready = matches!(d.info, Some(Ok(_))) && d.rx.is_none();
        modal(ctx, "yt-url", MODAL_W, "유튜브에서 가져오기", |ui| {
            label(ui, "유튜브 주소");
            let r = ui.add(style::text_field(&mut d.url, "https://www.youtube.com/watch?v=...").desired_width(f32::INFINITY));
            if d.focus { r.request_focus(); d.focus = false; }
            if r.changed() { d.edited = Some(Instant::now()); }
            if r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) && ready { go = true; }
            // 최근 작업한 영상 (누르면 주소를 넣고 정보를 불러온다)
            if !recent.is_empty() {
                ui.add_space(4.0);
                ui.horizontal(|ui| { ui.add(icons::img("history", 12.0, style::MUTED)); ui.label(RichText::new("최근 작업한 영상").size(12.0).color(style::MUTED)); });
                for (u, t, at) in recent.iter().take(10) {
                    let (rect, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 30.0), egui::Sense::click());
                    let hov = resp.hovered();
                    ui.painter().rect(rect, CornerRadius::same(8), if hov { Color32::from_rgba_unmultiplied(37, 99, 235, 15) } else { Color32::WHITE }, Stroke::new(1.0, if hov { style::PRIMARY } else { LINE }), egui::StrokeKind::Inside);
                    let w = when(*at);
                    let wg = ui.painter().layout_no_wrap(w, egui::FontId::proportional(11.0), style::MUTED);
                    let title = if t.is_empty() { u.as_str() } else { t.as_str() };
                    let mut job = egui::text::LayoutJob::simple_singleline(title.to_string(), egui::FontId::proportional(13.0), style::TEXT);
                    job.wrap = egui::text::TextWrapping::truncate_at_width(rect.width() - 30.0 - wg.size().x);
                    let tg = ui.painter().layout_job(job);
                    ui.painter().galley(egui::pos2(rect.left() + 10.0, rect.center().y - tg.size().y / 2.0), tg, style::TEXT);
                    ui.painter().galley(egui::pos2(rect.right() - 10.0 - wg.size().x, rect.center().y - wg.size().y / 2.0), wg, style::MUTED);
                    if resp.on_hover_text(u).clicked() { pick = Some(u.clone()); }
                    ui.add_space(-4.0);
                }
                ui.add_space(4.0);
            }
            ui.add_space(16.0);
            if d.rx.is_some() { info_box(ui, |ui| { ui.label(RichText::new("영상 정보를 불러오는 중…").size(14.4).color(INFO_TEXT)); }); }
            else { match &d.info {
                Some(Ok(i)) => info_box(ui, |ui| { ui.label(RichText::new(&i.title).size(14.4).family(style::bold()).color(INFO_TEXT)); ui.label(RichText::new(format!("길이: {}", fmt(i.duration))).size(14.4).color(INFO_TEXT)); }),
                Some(Err(e)) => info_box(ui, |ui| { ui.label(RichText::new(format!("정보를 불러오지 못했습니다: {e}")).size(14.4).color(INFO_TEXT)); }),
                None => {}
            } }
            actions(ui, |ui| {
                if btn(ui, "불러오기", true, ready).clicked() && ready { go = true; }
                if btn(ui, "취소", false, true).clicked() { close = true; }
            });
        });
        if escape(ctx) { close = true; }
        if let Some(u) = pick { d.url = u; d.asked.clear(); d.edited = Some(Instant::now() - std::time::Duration::from_secs(1)); }
        if close { return None; }
        if go {
            if let Some(Ok(info)) = d.info.take() {
                let url = d.url.trim().to_string();
                match yt::recent_add(&url, &info.title) { Ok(s) => self.settings = s, Err(e) => eprintln!("[recent] 저장 실패 {e}") }
                return Some(Dlg::Picker(Box::new(self.new_picker(url, info, None))));
            }
        }
        Some(Dlg::Url(d))
    }

    pub(crate) fn new_picker(&mut self, url: String, info: yt::Formats, preset: Option<(f64, f64)>) -> Picker {
        self.player.stop();
        let (mut start, mut end, mut first_seek) = (0.0, info.duration, None);
        if let Some((a, b)) = preset { start = a; end = b; first_seek = Some(a); }
        else if let Some((_, Some(t))) = yt::parse_youtube_url(&url) { start = t; first_seek = Some(t); }
        // 미리보기 스트림 정보는 뒤에서 (인터넷 주소의 ffprobe 는 1~2초)
        let probe_rx = info.preview.as_ref().map(|p| {
            let (tx, rx) = std::sync::mpsc::channel();
            let u = p.url.clone();
            std::thread::spawn(move || { let _ = tx.send(media::probe(Path::new(&u)).map_err(|e| e.to_string())); });
            rx
        });
        let (tx, rx) = std::sync::mpsc::channel();
        let u2 = url.clone();
        std::thread::spawn(move || { let _ = tx.send(yt::fetch_auto_subs(&u2)); });
        Picker { start_buf: fmt(start), end_buf: fmt(end), url, preview_err: if info.preview.is_none() { Some("미리보기가 없습니다".into()) } else { None }, info, player: Player::default(), probe_rx, first_seek, tex: None, start, end, full: false, subs: None, subs_rx: Some(rx), last_active: None, ok: false }
    }

    // ---------------- 2) 구간 고르기 ----------------
    fn picker_dialog(&mut self, ctx: &egui::Context, mut p: Box<Picker>) -> Option<Dlg> {
        if let Some(rx) = &p.subs_rx { if let Ok(r) = rx.try_recv() { p.subs_rx = None; p.subs = Some(r); } }
        if let Some(rx) = &p.probe_rx {
            if let Ok(r) = rx.try_recv() {
                p.probe_rx = None;
                match r {
                    Ok(pr) => { let u = p.info.preview.as_ref().unwrap().url.clone(); p.player.open_probed(Path::new(&u), pr); if let Some(t) = p.first_seek.take() { p.player.seek(t); } }
                    Err(e) => p.preview_err = Some(format!("미리보기를 열지 못했습니다: {e}")),
                }
            }
        }
        if p.player.tick() { if let Some(f) = &p.player.frame { let img = egui::ColorImage::from_rgba_unmultiplied([f.w, f.h], &f.rgba); match &mut p.tex { Some(t) => t.set(img, stage::tex_options()), None => p.tex = Some(ctx.load_texture("yt-preview", img, stage::tex_options())) } } }
        if p.player.playing() { ctx.request_repaint(); }
        let dur = p.info.duration.max(0.01);
        let t = if p.player.path.is_some() { p.player.out_t } else { 0.0 };
        let playing = p.player.playing();
        let (mut close, mut ok, mut seek, mut toggle) = (false, false, None::<f64>, false);
        let set_label = |p: &mut Picker| { p.start_buf = fmt(p.start); p.end_buf = fmt(p.end); };
        modal(ctx, "yt-picker", WIDE_W, "구간 고르기", |ui| {
            ui.horizontal_top(|ui| {
                ui.spacing_mut().item_spacing.x = 20.0;
                let main_w = WIDE_W - 300.0 - 20.0;
                ui.vertical(|ui| {
                    ui.set_width(main_w);
                    let (rect, resp) = ui.allocate_exact_size(egui::vec2(main_w, main_w * 9.0 / 16.0), egui::Sense::click());
                    ui.painter().rect_filled(rect, CornerRadius::ZERO, Color32::BLACK);
                    if let Some(tex) = &p.tex {
                        let [tw, th] = tex.size();
                        let k = (rect.width() / tw as f32).min(rect.height() / th as f32);
                        ui.painter().image(tex.id(), egui::Rect::from_center_size(rect.center(), egui::vec2(tw as f32 * k, th as f32 * k)), egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), Color32::WHITE);
                    } else if let Some(e) = &p.preview_err {
                        ui.painter().text(rect.center(), egui::Align2::CENTER_CENTER, e, egui::FontId::proportional(14.0), Color32::GRAY);
                    }
                    if resp.clicked() { toggle = true; }
                    // 재생 · 시간 막대 · 지금/길이 (기존 .ss-yt-timeline)
                    ui.add_space(8.0);
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 10.0;
                        let b = ui.scope(|ui| { ui.spacing_mut().button_padding = egui::vec2(12.0, 4.0); ui.add(egui::Button::new(RichText::new(if playing { "일시정지" } else { "재생" }).size(15.2).color(style::TEXT)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(4))) }).inner;
                        if b.clicked() { toggle = true; b.surrender_focus(); }
                        let cur = format!("{} / {}", fmt(t), fmt(dur));
                        let cg = ui.painter().layout_no_wrap(cur.clone(), egui::FontId::monospace(13.6), style::TEXT);
                        let (sr, sresp) = ui.allocate_exact_size(egui::vec2((ui.available_width() - cg.size().x - 10.0).max(60.0), 20.0), egui::Sense::click_and_drag());
                        let tr = egui::Rect::from_min_max(egui::pos2(sr.left() + 8.0, sr.center().y - 2.0), egui::pos2(sr.right() - 8.0, sr.center().y + 2.0));
                        if let Some(pp) = sresp.interact_pointer_pos() { if sresp.clicked() || sresp.dragged() || sresp.drag_stopped() { seek = Some((((pp.x - tr.left()) / tr.width()).clamp(0.0, 1.0) as f64 * dur * 10.0).round() / 10.0); } }
                        let x = tr.left() + tr.width() * (t / dur).clamp(0.0, 1.0) as f32;
                        ui.painter().rect_filled(tr, CornerRadius::same(2), style::BORDER_STRONG);
                        ui.painter().rect_filled(egui::Rect::from_min_max(tr.min, egui::pos2(x, tr.bottom())), CornerRadius::same(2), style::PRIMARY);
                        ui.painter().circle_filled(egui::pos2(x, tr.center().y), 8.0, style::PRIMARY);
                        ui.label(RichText::new(cur).font(egui::FontId::monospace(13.6)).color(style::TEXT));
                    });
                    // 시작·끝 (기존 .ss-yt-range-ui)
                    ui.add_space(12.0);
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 8.0;
                        let small = |ui: &mut egui::Ui, s: &str| ui.scope(|ui| { ui.spacing_mut().button_padding = egui::vec2(12.0, 8.0); ui.add(egui::Button::new(RichText::new(s).size(15.2).color(style::TEXT)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(4))) }).inner;
                        if small(ui, "시작 지정 (I)").clicked() { p.start = t; set_label(&mut p); }
                        let rs = ui.add(style::text_field(&mut p.start_buf, "").desired_width(76.0).align(egui::Align2::CENTER_CENTER));
                        if rs.lost_focus() { if let Some(v) = yt::parse_timecode(&p.start_buf) { p.start = v; } set_label(&mut p); }
                        ui.label(RichText::new("~").color(style::TEXT));
                        let re = ui.add(style::text_field(&mut p.end_buf, "").desired_width(76.0).align(egui::Align2::CENTER_CENTER));
                        if re.lost_focus() { if let Some(v) = yt::parse_timecode(&p.end_buf) { p.end = v; } set_label(&mut p); }
                        if small(ui, "끝 지정 (O)").clicked() { p.end = t; set_label(&mut p); }
                        ui.add_space(2.0);
                        let len = p.end - p.start;
                        ui.label(RichText::new(format!("선택: {} ({}초)", fmt(len), len.round() as i64)).size(15.2).family(style::bold()).color(style::PRIMARY));
                    });
                    ui.add_space(10.0);
                    ui.label(RichText::new("단축키: Space(재생), I(시작), O(끝), ←/→(±5초)").size(13.6).color(style::MUTED));
                    ui.add_space(15.0);
                    ui.checkbox(&mut p.full, RichText::new("영상 전체 받기 (느림)").size(14.4).color(style::TEXT));
                });
                // 자동 자막 (기존 .ss-yt-subs-box)
                egui::Frame::new().fill(Color32::from_rgb(0xf8, 0xfa, 0xfc)).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(12)).show(ui, |ui| {
                    ui.set_width(300.0); ui.set_height(400.0);
                    ui.vertical(|ui| {
                    let msg = |ui: &mut egui::Ui, s: &str| { ui.add_space(20.0); ui.vertical_centered(|ui| ui.label(RichText::new(s).size(14.4).color(style::FAINT))); };
                    match &p.subs {
                        None => msg(ui, "자막 불러오는 중…"),
                        Some(Ok(Some(lines))) if !lines.is_empty() => {
                            let active = lines.iter().position(|l| t >= l.start && t <= l.end);
                            let follow = playing && active.is_some() && active != p.last_active;
                            let mut clicked = None;
                            egui::ScrollArea::vertical().auto_shrink([false, false]).max_height(400.0).show(ui, |ui| {
                                ui.spacing_mut().item_spacing.y = 0.0;
                                let w = ui.available_width();
                                for (i, l) in lines.iter().enumerate() {
                                    let on = active == Some(i);
                                    let mut job = egui::text::LayoutJob::default();
                                    job.append(&fmt(l.start), 0.0, egui::TextFormat { font_id: egui::FontId::monospace(13.6), color: style::FAINT, ..Default::default() });
                                    job.append(&l.text, 8.0, egui::TextFormat { font_id: egui::FontId::proportional(13.6), color: if on { ACTIVE_TEXT } else { style::TEXT2 }, ..Default::default() });
                                    job.wrap.max_width = w - 24.0 - if on { 3.0 } else { 0.0 };
                                    let g = ui.painter().layout_job(job);
                                    let (rect, resp) = ui.allocate_exact_size(egui::vec2(w, g.size().y + 14.0), egui::Sense::click());
                                    let hov = resp.hovered();
                                    if on { ui.painter().rect_filled(rect, CornerRadius::ZERO, style::PRIMARY_SOFT); ui.painter().rect_filled(egui::Rect::from_min_size(rect.min, egui::vec2(3.0, rect.height())), CornerRadius::ZERO, style::PRIMARY); }
                                    else if hov { ui.painter().rect_filled(rect, CornerRadius::ZERO, style::PANEL3); }
                                    ui.painter().galley(egui::pos2(rect.left() + 12.0 + if on { 3.0 } else { 0.0 }, rect.top() + 7.0), g, style::TEXT2);
                                    ui.painter().hline(rect.x_range(), rect.bottom() - 0.5, Stroke::new(1.0, style::PANEL3));
                                    if resp.on_hover_cursor(egui::CursorIcon::PointingHand).clicked() { clicked = Some(l.start); }
                                    if on && follow {
                                        let clip = ui.clip_rect();
                                        if rect.top() < clip.top() || rect.top() > clip.bottom() - 40.0 { ui.scroll_to_rect(rect, Some(egui::Align::Center)); }
                                    }
                                }
                            });
                            p.last_active = active;
                            if let Some(s) = clicked { seek = Some(s); if !playing { toggle = true; } }
                        }
                        _ => msg(ui, "자막이 없습니다."),
                    }
                    });
                });
            });
            actions(ui, |ui| {
                if btn(ui, "이 구간 가져오기", true, true).clicked() { ok = true; }
                if btn(ui, "취소", false, true).clicked() { close = true; }
            });
        });
        if !ctx.egui_wants_keyboard_input() {
            let (sp, i, o, l, r, esc, ent) = ctx.input(|x| (x.key_pressed(egui::Key::Space), x.key_pressed(egui::Key::I), x.key_pressed(egui::Key::O), x.key_pressed(egui::Key::ArrowLeft), x.key_pressed(egui::Key::ArrowRight), x.key_pressed(egui::Key::Escape), x.key_pressed(egui::Key::Enter)));
            if sp { toggle = !toggle; }
            if i { p.start = t; set_label(&mut p); }
            if o { p.end = t; set_label(&mut p); }
            if l { seek = Some((t - 5.0).max(0.0)); }
            if r { seek = Some((t + 5.0).min(dur)); }
            if esc || crate::style::backdrop_clicked(ctx) { close = true; }
            if ent { ok = true; }
        }
        if p.ok { ok = true; p.ok = false; }
        if p.player.path.is_some() {
            if let Some(s) = seek { p.player.seek(s); }
            if toggle { p.player.toggle(); }
        } else if let Some(s) = seek { p.first_seek = Some(s); }
        if close { p.player.stop(); return None; }
        if ok {
            if p.end <= p.start { self.toast("구간이 올바르지 않습니다."); return Some(Dlg::Picker(p)); }
            p.player.stop();
            return Some(Dlg::Fetch(self.start_fetch(p.url.clone(), p.start, p.end, p.full, p.info.title.clone(), p.info.duration)));
        }
        Some(Dlg::Picker(p))
    }

    fn start_fetch(&mut self, url: String, start: f64, end: f64, full: bool, src_title: String, src_dur: f64) -> FetchDlg {
        let prog: Shared<(f64, String)> = Arc::new(Mutex::new((0.0, "준비 중…".into())));
        let (tx, rx) = std::sync::mpsc::channel();
        let (u, p2) = (url.clone(), prog.clone());
        std::thread::spawn(move || {
            let r = if full {
                yt::download_full(&u, &|pct| { *p2.lock().unwrap() = (pct, format!("영상 전체 받는 중… {}%", pct.round() as i64)); })
            } else {
                yt::fetch_part(&u, start, end, 8.0, &|pct, stage| {
                    let s = if stage == "part" { "영상 받는 중" } else { "처리 중" };
                    *p2.lock().unwrap() = (pct, format!("{s}… {}%", pct.round() as i64));
                })
            };
            let _ = tx.send(r);
        });
        FetchDlg { title: if full { "유튜브에서 가져오기".into() } else { "유튜브 구간 가져오기".into() }, prog, rx, url, start, end, full, src_title, src_dur }
    }

    // ---------------- 3) 받는 중 ----------------
    fn fetch_dialog(&mut self, ctx: &egui::Context, f: FetchDlg) -> Option<Dlg> {
        if let Ok(r) = f.rx.try_recv() {
            let res = match r { Ok(x) => x, Err(e) => { self.toast(if f.full { format!("실패: {e}") } else { format!("가져오기 실패: {e}") }); return None; } };
            // 원본 정보 (원본이 사라지면 같은 구간을 다시 받는다: source-recover)
            let title = if f.src_title.is_empty() { res.title.clone() } else { f.src_title.clone() };
            let mut opts = json!({ "offset": res.offset, "url": f.url, "title": title, "fetch": { "kind": if f.full { "section" } else { "part" }, "start": f.start, "end": f.end } });
            if !f.full { opts["range"] = json!({ "start": f.start, "end": f.end }); }
            let _ = f.src_dur;
            if !self.open_video_with(res.path.clone(), opts) { return None; }
            self.player.seek_src((f.start - res.offset).max(0.0));
            let range = if f.full { format!("{} ~ {}", fmt(f.start), fmt(f.end)) } else { format!("{} ~ {}", fmt(f.start), fmt(f.end.ceil())) };
            self.open_transcribe(res.path, res.offset, range, true);
            return self.import.dlg.take();
        }
        let (pct, text) = f.prog.lock().unwrap().clone();
        modal(ctx, "yt-fetch", MODAL_W, &f.title, |ui| progress(ui, pct, &text));
        Some(Dlg::Fetch(f))
    }

    // ---------------- 4) 자막 생성 ----------------
    fn trans_dialog(&mut self, ctx: &egui::Context, mut d: TransDlg) -> Option<Dlg> {
        if let Some(rx) = &d.rx {
            if let Ok(r) = rx.try_recv() {
                d.rx = None; d.running = false;
                if d.cancel.load(Ordering::Relaxed) { return None; }
                match r { Ok(v) => { self.apply_transcript(&v); return None; } Err(e) => d.err = format!("실패: {e}") }
            }
        }
        let (mut close, mut start) = (false, std::mem::take(&mut d.auto));
        let running = d.running;
        modal(ctx, "transcribe", MODAL_W, "자막 생성", |ui| {
            label(ui, "자막 만들 구간 (원본 영상 시각)");
            ui.add_enabled(!running, style::text_field(&mut d.range, "전체 구간 (예: 14:30 ~ 16:00)").desired_width(f32::INFINITY));
            ui.add_space(4.0);
            ui.label(RichText::new("영상은 이미 열려 있습니다. 취소해도 영상은 그대로 남습니다.").size(12.8).color(style::MUTED));
            ui.add_space(16.0);
            if running || !d.err.is_empty() {
                let (pct, text) = d.prog.lock().unwrap().clone();
                progress(ui, pct, if d.err.is_empty() { &text } else { &d.err });
            }
            actions(ui, |ui| {
                if btn(ui, "자막 생성 시작", true, !running).clicked() && !running { start = true; }
                if btn(ui, "취소", false, true).clicked() { close = true; }
            });
        });
        if escape(ctx) { close = true; }
        if close { if d.running { d.cancel.store(true, Ordering::Relaxed); } return None; }
        if start && !d.running {
            let off = d.offset;
            let r = d.range.trim().to_string();
            let (mut s, mut e): (f64, Option<f64>) = (0.0, None);
            if !r.is_empty() {
                if let Some((a, b)) = yt::parse_range(&r) { s = a - off; e = Some(b - off); }
                else if let Some(t0) = yt::parse_timecode(&r) { s = t0 - off; }
                else { self.toast("구간 형식이 올바르지 않습니다."); return Some(Dlg::Trans(d)); }
            }
            let s = s.max(0.0);
            d.running = true; d.err.clear();
            *d.prog.lock().unwrap() = (0.0, "준비 중…".into());
            let (tx, rx) = std::sync::mpsc::channel();
            let (path, prog, cancel) = (d.path.clone(), d.prog.clone(), d.cancel.clone());
            let terms = self.settings["churchTerms"].as_str().unwrap_or("").to_string();
            std::thread::spawn(move || {
                let cb = move |st: &str, pct: f64, msg: &str| {
                    if !msg.is_empty() || pct < 0.0 { return; }
                    let name = match st { "extract" => "오디오 추출 중", "stt" => "음성 인식 중", "align" => "단어 정렬 중", "done" => "완료", x => x };
                    *prog.lock().unwrap() = (pct, format!("{name}… {pct:.0}%"));
                };
                let r = stt::transcribe(&path, Some(s), e, &terms, &cb, cancel).map_err(|e| e.to_string());
                let _ = tx.send(r);
            });
            d.rx = Some(rx);
        }
        Some(Dlg::Trans(d))
    }

    /// 음성 인식 결과를 자막으로 (기존 ss:transcript-ready: 설정의 편집 기본값 → 단어 → 자동 정리 → 첫 단어로)
    pub(crate) fn apply_transcript(&mut self, v: &Value) {
        let mut arr = v["words"].clone();
        // 엔진의 단어 번호("w0001")는 버리고 0,1,2… 로 (기존 transcript-ready)
        if let Some(a) = arr.as_array_mut() { for (i, w) in a.iter_mut().enumerate() { if w.is_object() { w["id"] = json!(i); } } }
        let mut words: Vec<Word> = match serde_json::from_value(arr) { Ok(w) => w, Err(e) => { self.toast(format!("자막을 읽지 못했습니다: {e}")); return; } };
        for (i, w) in words.iter_mut().enumerate() { w.id = i as i64; if w.stt_text.is_none() { w.stt_text = Some(w.text.clone()); } }
        self.apply_edit_defaults();
        self.set_words(words);
        self.recompute();
        self.unsaved = true;
        let first = self.project.words.iter().find(|w| !w.del).map(|w| w.start);
        if let Some(t) = first { self.player.seek_src(t); }
        if self.settings["editDefaults"]["autoTidy"].as_bool() != Some(false) && !self.project.words.is_empty() { self.cmd_tidy(); }
    }
    /// 설정 [편집]의 기본값을 지금 편집에 (기존 SS.applyEditDefaults)
    pub(crate) fn apply_edit_defaults(&mut self) {
        let ed = self.settings["editDefaults"].clone();
        if !ed.is_object() { return; }
        let st = &mut self.project.settings;
        st.max_line_chars = ed["maxLineChars"].as_f64();
        st.semantic_breaks = ed["semanticBreaks"].as_bool() != Some(false);
        st.split_long_words = ed["splitLongWords"].as_bool() != Some(false);
        if let Some(x) = ed["padBefore"].as_f64() { st.pad_before = x; }
        if let Some(x) = ed["padAfter"].as_f64() { st.pad_after = x; }
        if let Some(x) = ed["fadeMs"].as_f64() { st.fade_ms = x; }
        self.dirty = true;
    }

    /// 시험: 주소 넣기 → 구간 → 받기 → 자막까지 한 번에 (ytimport)
    pub(crate) fn test_import_step(&mut self, url: &str, start: f64, end: f64) -> &'static str {
        match &mut self.import.dlg {
            None => { self.cmd_load_url(url.to_string()); "url" }
            Some(Dlg::Url(d)) => { if matches!(d.info, Some(Ok(_))) && d.rx.is_none() { let Some(Ok(info)) = d.info.take() else { return "resolving" }; let u = d.url.trim().to_string(); let pk = self.new_picker(u, info, None); self.import.dlg = Some(Dlg::Picker(Box::new(pk))); "picker" } else { "resolving" } }
            Some(Dlg::Picker(p)) => { if p.subs.is_some() && (p.tex.is_some() || p.info.preview.is_none()) { p.start = start; p.end = end; p.start_buf = fmt(start); p.end_buf = fmt(end); "picked" } else { "loading" } }
            Some(Dlg::Fetch(_)) => "fetching",
            Some(Dlg::Trans(_)) => "transcribing",
            Some(Dlg::Recover(_)) => "recovering",
        }
    }
    pub(crate) fn test_import_ok(&mut self) { if let Some(Dlg::Picker(p)) = &mut self.import.dlg { p.ok = true; } }
    pub(crate) fn test_import_info(&self) -> Value {
        match &self.import.dlg {
            Some(Dlg::Picker(p)) => json!({ "title": p.info.title, "duration": p.info.duration, "subs": p.subs.as_ref().map(|s| match s { Ok(Some(l)) => l.len() as i64, _ => 0 }), "preview": p.tex.is_some(), "start": p.start_buf, "end": p.end_buf, "t": p.player.out_t }),
            Some(Dlg::Trans(d)) => json!({ "range": d.range, "running": d.running, "err": d.err }),
            _ => Value::Null,
        }
    }
}

impl App {
    /// 원본 영상이 없는 프로젝트: 설정 [원본 영상이 없을 때]가 묻기('ask')가 아니면 바로 다시 받는다
    pub(crate) fn start_recover(&mut self, proj: Option<PathBuf>, saved: Value, origin: crate::ui_autosave::Origin, force: bool) {
        let plan = sf::plan(&saved["source"]);
        let auto = plan.error.is_none() && (force || self.settings["sourceMissing"].as_str() != Some("ask"));
        let mut r = Recover { proj, origin, saved, plan, failure: String::new(), prog: Arc::new(Mutex::new((0.0, "준비 중…".into()))), rx: None };
        if auto { Self::recover_download(&mut r); }
        self.import.dlg = Some(Dlg::Recover(Box::new(r)));
    }
    pub(crate) fn recover_download(r: &mut Recover) {
        let (tx, rx) = std::sync::mpsc::channel();
        let (saved, plan, prog) = (r.saved.clone(), r.plan.clone(), r.prog.clone());
        *prog.lock().unwrap() = (0.0, "준비 중…".into());
        std::thread::spawn(move || {
            let ui = |pct: f64, msg: &str| { *prog.lock().unwrap() = (pct, msg.to_string()); };
            let _ = tx.send(sf::redownload(&saved, &plan, &ui));
        });
        r.rx = Some(rx);
    }

    fn recover_dialog(&mut self, ctx: &egui::Context, mut r: Box<Recover>) -> Option<Dlg> {
        if let Some(rx) = &r.rx {
            if let Ok(res) = rx.try_recv() {
                r.rx = None;
                match res {
                    Ok(v) => { let o = r.origin.clone(); self.open_project_value(r.proj.clone(), v, Some("downloaded"), &o); return None; }
                    Err(e) => r.failure = e, // 자동 재시도를 되풀이하지 않고 같은 창에서 다시·직접 찾기·취소
                }
            }
        }
        if r.rx.is_some() {
            let (pct, msg) = r.prog.lock().unwrap().clone();
            modal(ctx, "src-recover-prog", MODAL_W, "원본 영상 다시 받는 중", |ui| {
                ui.label(RichText::new(msg).size(13.0).color(style::TEXT2));
                ui.add_space(8.0);
                let (rr, _) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 8.0), egui::Sense::hover());
                ui.painter().rect_filled(rr, CornerRadius::same(4), LINE);
                let w = rr.width() * (pct.clamp(0.0, 100.0) / 100.0) as f32;
                if w > 0.0 { ui.painter().rect_filled(egui::Rect::from_min_size(rr.min, egui::vec2(w, 8.0)), CornerRadius::same(4), style::PRIMARY); }
            });
            return Some(Dlg::Recover(r));
        }
        let src = r.saved["source"].clone();
        let name = src["path"].as_str().unwrap_or("").rsplit(['/', '\\']).next().unwrap_or("").to_string();
        let can = r.plan.error.is_none();
        let (mut choice, title) = (None::<&str>, if r.failure.is_empty() { "원본 영상 연결" } else { "원본 영상을 다시 받지 못했습니다" });
        modal(ctx, "src-recover", MODAL_W, title, |ui| {
            ui.spacing_mut().item_spacing.y = 6.0;
            let body = |s: &str| RichText::new(s).size(13.0).color(style::TEXT2);
            if !r.failure.is_empty() { ui.label(RichText::new(&r.failure).size(13.0).color(Color32::from_rgb(0xb9, 0x1c, 0x1c))); ui.add_space(4.0); }
            let mut job = egui::text::LayoutJob::default();
            let f = |c: Color32, b: bool| egui::TextFormat { font_id: egui::FontId::new(13.0, if b { style::bold() } else { egui::FontFamily::Proportional }), color: c, ..Default::default() };
            job.append("이 편집의 원본 영상(", 0.0, f(style::TEXT2, false));
            job.append(&name, 0.0, f(style::TEXT, true));
            job.append(")이 지워졌거나 옮겨졌습니다.", 0.0, f(style::TEXT2, false));
            job.wrap.max_width = ui.available_width();
            ui.label(job);
            if can {
                ui.label(body(&format!("유튜브에서 같은 부분을 다시 받으면 편집(자막·컷·미세 조정)을 그대로 이어서 할 수 있습니다.{}", if r.plan.needs_subs { " 예전 버전에서 만든 편집이라 유튜브 자막과 맞춰 위치를 되찾습니다." } else { "" })));
                let t = src["title"].as_str().filter(|s| !s.is_empty()).or(src["url"].as_str()).unwrap_or("");
                ui.label(RichText::new(t).size(13.0).color(style::MUTED));
            } else { ui.label(body(r.plan.error.as_deref().unwrap_or(""))); }
            actions(ui, |ui| {
                if can && btn(ui, "유튜브에서 다시 받기", true, true).clicked() { choice = Some("download"); }
                if btn(ui, "파일 직접 찾기", false, true).clicked() { choice = Some("locate"); }
                if btn(ui, "취소", false, true).clicked() { choice = Some("cancel"); }
            });
        });
        if escape(ctx) { choice = Some("cancel"); }
        match choice {
            Some("cancel") => { self.toast(match r.origin { crate::ui_autosave::Origin::Project => "프로젝트 열기 실패: 원본 영상이 없어 열지 않았습니다.", _ => "열지 못했습니다: 원본 영상이 없어 열지 않았습니다." }); None }
            Some("locate") => {
                let Some(p) = rfd::FileDialog::new().set_title("영상 파일 열기").add_filter("영상", &["mp4", "mov", "mkv", "webm", "m4v", "avi"]).pick_file() else { return Some(Dlg::Recover(r)) };
                let mut saved = r.saved.clone();
                saved["source"]["path"] = json!(p.to_string_lossy());
                let o = r.origin.clone();
                self.open_project_value(r.proj.clone(), saved, Some("located"), &o);
                None
            }
            Some("download") => { r.failure.clear(); Self::recover_download(&mut r); Some(Dlg::Recover(r)) }
            _ => Some(Dlg::Recover(r)),
        }
    }
}