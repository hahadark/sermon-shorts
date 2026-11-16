//! 자동 저장 (기존 renderer/autosave.js): 편집이 멈추고 4초 뒤(그리고 30초마다 확인) 지금 편집을 자동 저장한다.
//! 바뀐 것이 없으면 쓰지 않는다. 몇 분에 하나씩 과거 작업본을 남긴다. 창을 닫을 때도 한 번 저장한다.
//! 편집기가 갑자기 꺼졌으면 다음에 켤 때 "지난 작업을 불러올까요?"를 묻고, [파일 > 자동 저장본 열기]로 언제든 과거 작업본을 연다.
use crate::*;
use sermon_shorts::autosave::{self as asv, Entry};
use std::collections::HashSet;
use std::hash::{Hash, Hasher};

const DEBOUNCE_MS: u128 = 4000;

#[derive(Default)]
pub(crate) struct State {
    pub core: Option<asv::Autosave>,
    last_cmp: String,
    pub last_at: f64,
    pub err: Option<String>,
    timer: Option<Instant>,
    last_check: Option<Instant>,
    /// 0 이 아니면 저장하지 않는다. 켜자마자는 '지난 작업 불러오기'를 확인할 때까지 1
    pub paused: i32,
    crash_hold: bool,
    crash_check_at: Option<Instant>,
    fp: u64,
    pub browser: Option<Browser>,
    pub stats: (u32, u32, u32),
}

pub(crate) struct Browser { pub crash: bool, crashed_at: f64, pub entries: Option<Vec<Entry>>, open_vers: HashSet<String> }

/// 열기의 출처 (프로젝트 파일 / 자동 저장본)
#[derive(Clone, Debug)]
pub(crate) enum Origin { Project, Autosave { file: String } }

fn two(n: u32) -> String { format!("{n:02}") }
fn hm(t: f64) -> String { let (_, _, _, h, m, _) = asv::local_parts(t); format!("{}:{}", two(h), two(m)) }
/// 오늘 14:32 · 어제 09:10 · 11월 3일 18:00
fn when(t: f64) -> String {
    if t <= 0.0 { return String::new(); }
    let day = |ms: f64| ((ms / 1000.0).floor() as i64 + sermon_shorts::youtube::local_offset_secs()).div_euclid(86400);
    let (d, n) = (day(t), day(asv::now_ms()));
    let (_, m, dd, _, _, _) = asv::local_parts(t);
    let w = if d == n { "오늘".to_string() } else if d == n - 1 { "어제".to_string() } else { format!("{m}월 {dd}일") };
    format!("{w} {}", hm(t))
}
fn fmt_dur(s: f64) -> String { let s = s.round().max(0.0) as i64; format!("{}분 {}초", s / 60, two((s % 60) as u32)) }
fn sum_text(s: &Value) -> String {
    if !s.is_object() { return String::new(); }
    format!("결과 {} · {}컷 · 남긴 단어 {}/{}", fmt_dur(s["dur"].as_f64().unwrap_or(0.0)), s["cuts"].as_i64().unwrap_or(0), s["kept"].as_i64().unwrap_or(0), s["total"].as_i64().unwrap_or(0))
}

impl App {
    /// 켤 때 한 번 (시험 중에는 자동 저장 시험이 아니면 아무것도 쓰지 않는다)
    fn asv_init(&mut self) {
        let active = self.test.as_ref().is_none_or(|t| t.name.starts_with("autosave"));
        self.asv.core = Some(asv::Autosave::init(active, &self.settings));
        self.asv.paused = 1;
        self.asv.crash_hold = true;
        self.asv.crash_check_at = Some(Instant::now() + std::time::Duration::from_millis(1200));
        self.asv.last_check = Some(Instant::now());
    }
    fn asv_can_save(&self) -> bool {
        asv::enabled(&self.settings) && self.asv.core.as_ref().is_some_and(|c| c.active) && self.asv.paused == 0
            && !self.project.source_path.as_os_str().is_empty() && !self.project.words.is_empty()
    }
    /// 지금 편집 (저장할 프로젝트 내용)
    fn asv_snapshot(&mut self) -> Value {
        self.project.playhead = self.player.src_now();
        self.write_project_design();
        self.project.to_json()
    }
    fn asv_cmp(&self, snap: &Value) -> String {
        let mut s = snap.clone();
        s["playhead"] = json!(0);
        format!("{}|{}", s, self.project_path.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default())
    }
    /// 지금 편집을 자동 저장. 바뀐 것이 없으면 건너뜀 (force 면 작업본도 하나 남김)
    pub(crate) fn asv_save_now(&mut self, force: bool) -> Option<asv::Written> {
        if !self.asv_can_save() { return None; }
        let snap = self.asv_snapshot();
        let cmp = self.asv_cmp(&snap);
        if cmp == self.asv.last_cmp && !force { self.asv.stats.1 += 1; return None; }
        if let Ok(p) = std::env::var("SS_ASV_TRACE") { let a: Vec<char> = self.asv.last_cmp.chars().collect(); let b: Vec<char> = cmp.chars().collect(); let i = a.iter().zip(&b).position(|(x, y)| x != y).unwrap_or(a.len().min(b.len())); let s = i.saturating_sub(80); let line = format!("force={force} 처음 다른 곳 {i}: 전 {:?} / 후 {:?}\n", a[s..(i + 80).min(a.len())].iter().collect::<String>(), b[s..(i + 80).min(b.len())].iter().collect::<String>()); let _ = std::fs::OpenOptions::new().create(true).append(true).open(p).and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes())); }
        let src = self.project.rest.get("source").cloned().unwrap_or(Value::Null);
        let path = self.project.source_path.to_string_lossy().to_string();
        let name = path.rsplit(['/', '\\']).next().unwrap_or("").to_string();
        let url = src["url"].as_str().unwrap_or("").to_string();
        let off = src["offset"].as_f64().filter(|x| *x != 0.0).unwrap_or(0.0);
        let stitle = src["title"].as_str().unwrap_or("").to_string();
        let first = |xs: &[&str]| xs.iter().find(|s| !s.is_empty()).map(|s| s.to_string()).unwrap_or_default();
        let dur: f64 = self.segs.iter().map(|s| (s.end - s.start).max(0.0)).sum();
        let summary = json!({ "dur": (dur * 10.0).round() / 10.0, "cuts": self.segs.len(), "kept": self.project.words.iter().filter(|w| !w.del).count(), "total": self.project.words.len() });
        let p = asv::Payload {
            source_key: format!("{}|{}", if url.is_empty() { &path } else { &url }, sermon_shorts::stt::js_num(Some(off))),
            title: { let t = first(&[self.title.trim(), &stitle, &name]); if t.is_empty() { "편집".into() } else { t } },
            source_path: path.clone(), source_name: first(&[&stitle, &name]), source_url: url,
            project_path: self.project_path.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            summary, data: snap.to_string(), force_version: force,
        };
        let settings = self.settings.clone();
        match self.asv.core.as_mut().unwrap().write(&p, &settings) {
            Ok(w) => { self.asv.last_cmp = cmp; self.asv.last_at = w.at; self.asv.err = None; self.asv.stats.0 += 1; if w.versioned { self.asv.stats.2 += 1; } Some(w) }
            Err(e) => { eprintln!("[autosave] 저장 실패 {e}"); self.asv.err = Some(e.to_string()); None }
        }
    }
    fn asv_schedule(&mut self) { if self.asv_can_save() { self.asv.timer = Some(Instant::now()); } }
    fn release_crash_hold(&mut self) { if self.asv.crash_hold { self.asv.crash_hold = false; self.asv.paused -= 1; self.asv_schedule(); } }
    /// 열고 난 뒤: 지금 상태를 저장된 것으로 (바로 다시 쓰지 않게)
    pub(crate) fn asv_mark_clean(&mut self) { let s = self.asv_snapshot(); self.asv.last_cmp = self.asv_cmp(&s); }

    /// 편집 신호: 실행 취소 기록·디자인·입력칸이 바뀌면 4초 뒤 저장
    fn asv_fingerprint(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (self.hist_at, self.history.len(), &self.title, &self.verse, self.speaker(), self.theme_key, self.hide_deleted, &self.project_path, &self.project.source_path).hash(&mut h);
        (self.crop.scale.to_bits(), self.crop.x.to_bits(), self.crop.y.to_bits()).hash(&mut h);
        let st = &self.project.settings;
        (st.pad_before.to_bits(), st.pad_after.to_bits(), st.fade_ms.to_bits(), st.max_line_chars.map(f64::to_bits), st.semantic_breaks, st.split_long_words).hash(&mut h);
        h.finish()
    }

    /// 매 화면: 저장 시각 확인 · 지난 작업 묻기 · 창 닫을 때 저장 · 자동 저장본 창
    pub(crate) fn autosave_ui(&mut self, ctx: &egui::Context) {
        if self.asv.core.is_none() { self.asv_init(); }
        let fp = self.asv_fingerprint();
        if fp != self.asv.fp { self.asv.fp = fp; self.asv_schedule(); }
        if self.asv.crash_check_at.is_some_and(|t| Instant::now() >= t) { self.asv.crash_check_at = None; self.check_crash(); }
        if self.asv.timer.is_some_and(|t| t.elapsed().as_millis() >= DEBOUNCE_MS) { self.asv.timer = None; self.asv_save_now(false); }
        if self.asv.last_check.is_some_and(|t| t.elapsed().as_secs() >= 30) { self.asv.last_check = Some(Instant::now()); if self.asv.timer.is_none() { self.asv_save_now(false); } }
        if self.asv.timer.is_some() || self.asv.crash_check_at.is_some() { ctx.request_repaint_after(std::time::Duration::from_millis(500)); }
        // 창을 닫을 때 마지막으로 한 번 (실행 표시도 지운다)
        if ctx.input(|i| i.viewport().close_requested()) {
            self.asv.timer = None;
            if self.asv.paused == 1 && self.asv.crash_hold { /* 지난 작업을 묻는 중이면 덮어쓰지 않는다 */ } else { self.asv_save_now(false); }
            if let Some(c) = &self.asv.core { c.quit(); }
        }
        self.autosave_browser(ctx);
    }
    pub(crate) fn check_crash_now(&mut self) { self.check_crash(); }
    /// 지난번에 갑자기 꺼졌으면 묻기
    fn check_crash(&mut self) {
        let entries = self.asv.core.as_ref().map(|c| c.crashed_entries()).unwrap_or_default();
        if entries.is_empty() { self.release_crash_hold(); return; }
        if self.import.dlg.is_some() || self.export_view.is_some() { self.asv.crash_check_at = Some(Instant::now() + std::time::Duration::from_secs(2)); return; }
        let at = self.asv.core.as_ref().and_then(|c| c.crashed.as_ref()).map(|s| s.started_at).unwrap_or(0.0);
        self.asv.browser = Some(Browser { crash: true, crashed_at: at, entries: Some(entries), open_vers: HashSet::new() });
    }

    /// 파일 → 자동 저장본 열기
    pub(crate) fn cmd_open_autosaves(&mut self) {
        self.asv.browser = Some(Browser { crash: false, crashed_at: 0.0, entries: Some(asv::list()), open_vers: HashSet::new() });
    }
    /// 위 막대에 보일 자동 저장 상태 ("자동 저장됨 14:32")
    pub(crate) fn autosave_status(&self) -> Option<String> {
        if !asv::enabled(&self.settings) { return None; }
        if self.asv.err.is_some() { return Some("자동 저장 실패".into()); }
        (self.asv.last_at > 0.0).then(|| format!("자동 저장됨 {}", hm(self.asv.last_at)))
    }
    fn close_browser(&mut self) { self.asv.browser = None; self.release_crash_hold(); }

    /// 자동 저장본 열기: 지금 편집을 먼저 작업본으로 남겨 두고 연다
    pub(crate) fn open_saved(&mut self, key: &str, file: &str, force_download: bool) {
        if self.asv_can_save() { self.asv_save_now(true); }
        let settings = self.settings.clone();
        match asv::read(key, file, &settings) {
            Ok((data, pp, _)) => {
                let pp = (!pp.is_empty()).then(|| PathBuf::from(pp));
                self.asv.paused += 1;
                self.open_project_from(pp, data, Origin::Autosave { file: file.to_string() }, force_download);
                self.asv.paused -= 1;
                self.close_browser();
            }
            Err(e) => self.toast(format!("열지 못했습니다: {e}")),
        }
    }

    fn autosave_browser(&mut self, ctx: &egui::Context) {
        let Some(mut b) = self.asv.browser.take() else { return };
        let entries = b.entries.clone().unwrap_or_default();
        let a = &self.settings["autosave"];
        let foot = if !asv::enabled(&self.settings) { "자동 저장이 꺼져 있습니다 (설정에서 켤 수 있음).".to_string() }
            else { format!("편집하는 동안 몇 초마다 자동 저장되고, {}분마다 작업본이 하나씩(영상마다 최근 {}개) 남습니다.", a["everyMin"].as_f64().filter(|x| *x != 0.0).unwrap_or(2.0), a["maxVersions"].as_f64().filter(|x| *x != 0.0).unwrap_or(30.0)) };
        let (mut close, mut open, mut del, mut goto_settings) = (false, None::<(String, String, bool)>, None::<String>, false);
        let frame = egui::Frame::new().fill(style::PANEL).corner_radius(CornerRadius::same(18)).inner_margin(egui::Margin::ZERO);
        let mr = egui::Modal::new(egui::Id::unique("asv-browser")).frame(frame).show(ctx, |ui| {
            ui.set_width(760.0);
            let max_h = ctx.content_rect().height() * 0.86;
            // 머리
            egui::Frame::new().inner_margin(egui::Margin { left: 22, right: 22, top: 20, bottom: 12 }).show(ui, |ui| {
                ui.horizontal_top(|ui| {
                    ui.vertical(|ui| {
                        ui.set_width(760.0 - 44.0 - 40.0);
                        ui.label(RichText::new(if b.crash { "지난 작업을 불러올까요?" } else { "자동 저장본" }).size(18.0).family(style::bold()).color(if b.crash { Color32::from_rgb(0x1e, 0x3a, 0x8a) } else { style::TEXT }));
                        ui.add_space(6.0);
                        let lead = if b.crash { format!("편집기가 지난번({}에 시작한 편집)에 제대로 닫히지 않았습니다. 자동 저장된 작업을 다시 열 수 있습니다.", when(b.crashed_at)) } else { "저장하지 않고 닫았거나 갑자기 꺼졌을 때, 자동 저장된 작업을 다시 엽니다. 작업본을 펼치면 그보다 앞선 상태로도 돌아갈 수 있습니다.".into() };
                        ui.label(RichText::new(lead).size(12.5).color(style::TEXT2));
                    });
                    if style::icon_btn(ui, "x", 18.0, style::MUTED, "닫기 (Esc)").clicked() { close = true; }
                });
            });
            // 목록
            egui::ScrollArea::vertical().max_height((max_h - 170.0).max(120.0)).auto_shrink([false, true]).show(ui, |ui| {
                egui::Frame::new().inner_margin(egui::Margin { left: 16, right: 16, top: 0, bottom: 12 }).show(ui, |ui| {
                    ui.set_width(760.0 - 32.0);
                    ui.spacing_mut().item_spacing.y = 8.0;
                    if entries.is_empty() {
                        ui.add_space(30.0);
                        ui.vertical_centered(|ui| { ui.label(RichText::new("자동 저장본이 없습니다").size(14.0).family(style::bold()).color(style::TEXT2)); ui.label(RichText::new("영상을 열고 편집하면 자동으로 저장됩니다.").size(12.5).color(style::MUTED)); });
                        ui.add_space(30.0);
                    }
                    for (i, e) in entries.iter().enumerate() {
                        let first = b.crash && i == 0;
                        let (fill, stroke) = if first { (style::PRIMARY_SOFT, Color32::from_rgb(0x93, 0xc5, 0xfd)) } else { (style::PANEL, style::BORDER) };
                        egui::Frame::new().fill(fill).stroke(Stroke::new(1.0, stroke)).corner_radius(CornerRadius::same(14)).show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            egui::Frame::new().inner_margin(egui::Margin::symmetric(14, 12)).show(ui, |ui| {
                                ui.horizontal(|ui| {
                                    ui.spacing_mut().item_spacing.x = 8.0;
                                    let btn_w = 300.0;
                                    ui.vertical(|ui| {
                                        ui.set_width(ui.available_width() - btn_w);
                                        ui.spacing_mut().item_spacing.y = 2.0;
                                        let t = [e.title.as_str(), e.source_name.as_str()].into_iter().find(|s| !s.is_empty()).unwrap_or("편집");
                                        ui.add(egui::Label::new(RichText::new(t).size(14.0).family(style::bold()).color(style::TEXT)).truncate());
                                        ui.add(egui::Label::new(RichText::new(format!("{} 자동 저장 · {}", when(e.updated_at), sum_text(&e.summary))).size(12.0).color(style::TEXT2)).truncate());
                                        let mut job = egui::text::LayoutJob::default();
                                        let f = |c: Color32, bold: bool| egui::TextFormat { font_id: egui::FontId::new(11.5, if bold { style::bold() } else { egui::FontFamily::Proportional }), color: c, ..Default::default() };
                                        if e.source_missing {
                                            job.append("원본 영상이 없음", 0.0, f(Color32::from_rgb(0xb9, 0x1c, 0x1c), true));
                                            job.append(if e.source_url.is_empty() { " · 열 때 원본 파일을 찾습니다 · " } else { " · 열 때 유튜브에서 다시 받습니다 · " }, 0.0, f(style::MUTED, false));
                                        }
                                        let pp = if e.project_path.is_empty() { String::new() } else { format!(" · 프로젝트 {}", e.project_path.rsplit(['/', '\\']).next().unwrap_or("")) };
                                        job.append(&format!("{}{pp}", e.source_name), 0.0, f(style::MUTED, false));
                                        job.wrap = egui::text::TextWrapping::truncate_at_width(ui.available_width());
                                        ui.label(job).on_hover_text(&e.source_path);
                                    });
                                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                        if style::icon_btn(ui, "trash-2", 15.0, style::MUTED, "이 영상의 자동 저장본 지우기").clicked() { del = Some(e.key.clone()); }
                                        let n = e.versions.len().saturating_sub(1);
                                        let more = ui.add(egui::Button::new(RichText::new(format!("작업본 {n}개")).size(12.5).color(style::TEXT2)).fill(Color32::TRANSPARENT).corner_radius(CornerRadius::same(8)));
                                        if more.clicked() { if !b.open_vers.remove(&e.key) { b.open_vers.insert(e.key.clone()); } }
                                        let label = if e.source_missing { if e.source_url.is_empty() { "찾아서 열기" } else { "다시 받아 열기" } } else if first { "불러오기" } else { "열기" };
                                        let primary = i == 0;
                                        let r = ui.add(egui::Button::new(RichText::new(label).size(12.5).color(if primary { Color32::WHITE } else { style::TEXT })).fill(if primary { style::PRIMARY } else { Color32::WHITE }).stroke(if primary { Stroke::NONE } else { Stroke::new(1.0, style::BORDER_STRONG) }).corner_radius(CornerRadius::same(8)).min_size(egui::vec2(0.0, 30.0)));
                                        let r = if e.source_missing { r.on_hover_text(if e.source_url.is_empty() { "원본 영상 파일을 찾아 엽니다" } else { "원본 영상을 유튜브에서 다시 받아 엽니다" }) } else { r };
                                        if r.clicked() { open = Some((e.key.clone(), "current.sshorts".into(), e.source_missing && !e.source_url.is_empty())); }
                                    });
                                });
                            });
                            if b.open_vers.contains(&e.key) {
                                let r = ui.max_rect();
                                let y = ui.cursor().top();
                                let mut x = r.left();
                                while x < r.right() { ui.painter().hline(x..=(x + 4.0).min(r.right()), y, Stroke::new(1.0, style::BORDER)); x += 8.0; }
                                egui::Frame::new().inner_margin(egui::Margin { left: 14, right: 14, top: 6, bottom: 10 }).show(ui, |ui| {
                                    egui::ScrollArea::vertical().id_salt(("asv-vers", &e.key)).max_height(240.0).show(ui, |ui| {
                                        ui.spacing_mut().item_spacing.y = 2.0;
                                        if e.versions.len() <= 1 { ui.label(RichText::new("아직 남은 작업본이 없습니다.").size(12.0).color(style::MUTED)); }
                                        for v in e.versions.iter().skip(1) {
                                            ui.horizontal(|ui| {
                                                let (_, _, _, _, _, s) = asv::local_parts(v.at);
                                                ui.add_sized([110.0, 22.0], egui::Label::new(RichText::new(format!("{}:{}", when(v.at), two(s))).size(12.0).family(style::semi()).color(style::TEXT)));
                                                ui.add(egui::Label::new(RichText::new(sum_text(&v.summary)).size(12.0).color(style::MUTED)).truncate());
                                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                                    if ui.add(egui::Button::new(RichText::new("이 상태로 열기").size(12.0).color(style::TEXT)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(8))).clicked() { open = Some((e.key.clone(), v.file.clone(), false)); }
                                                });
                                            });
                                        }
                                    });
                                });
                            }
                        });
                    }
                });
            });
            // 바닥
            let r = ui.cursor();
            ui.painter().hline(r.x_range(), r.top(), Stroke::new(1.0, style::BORDER));
            egui::Frame::new().inner_margin(egui::Margin { left: 22, right: 22, top: 10, bottom: 14 }).show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.add(egui::Label::new(RichText::new(&foot).size(11.5).color(style::MUTED)).wrap());
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.add(egui::Button::new(RichText::new("설정").size(11.5).color(style::PRIMARY)).frame(false)).clicked() { goto_settings = true; }
                        if ui.add(egui::Button::new(RichText::new("폴더 열기").size(11.5).color(style::PRIMARY)).frame(false)).clicked() { let _ = std::process::Command::new("explorer.exe").arg(asv::root_dir()).spawn(); }
                    });
                });
            });
        });
        if mr.backdrop_response.clicked() { close = true; }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) { close = true; }
        self.asv.browser = Some(b);
        if let Some(k) = del {
            let yes = std::env::var("SS_TEST_YES").is_ok() || rfd::MessageDialog::new().set_title("자동 저장본 지우기").set_description("이 영상의 자동 저장본(작업본 포함)을 모두 지울까요?").set_buttons(rfd::MessageButtons::YesNo).show() == rfd::MessageDialogResult::Yes;
            if yes { let _ = asv::remove(&k); if let Some(b) = &mut self.asv.browser { if let Some(es) = &mut b.entries { es.retain(|e| e.key != k); } } }
        }
        if let Some((k, f, force)) = open { self.open_saved(&k, &f, force); return; }
        if goto_settings { self.close_browser(); self.page = Page::Settings; return; }
        if close { self.close_browser(); }
    }
}
