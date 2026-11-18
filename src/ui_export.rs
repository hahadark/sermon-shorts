//! 내보내기 (기존 exporter.js 단추·진행률 + 완성 영상 창 일부)
use crate::*;
use std::sync::Mutex;

pub(crate) struct Job {
    pub progress: Arc<Mutex<export::Progress>>,
    pub rx: Receiver<Result<export::Done, String>>,
}

impl Job {
    pub fn label(&self) -> String {
        let p = self.progress.lock().unwrap();
        if p.stage.is_empty() { "내보내는 중...".into() } else { format!("{} {}%", if p.stage.contains("그림") { "준비 중" } else { "내보내는 중" }, p.pct.round() as i64) }
    }
}

impl App {
    pub(crate) fn start_export(&mut self) {
        if self.export.is_some() { self.toast("이미 내보내기가 진행 중입니다."); return; }
        if self.player.path.is_none() || self.project.words.is_empty() { self.toast("내보낼 영상과 자막이 없습니다."); return; }
        if self.dirty { self.recompute(); }
        if self.segs.is_empty() { self.toast("남은 영상 구간이 없습니다. 지운 단어를 먼저 되살려 주세요."); return; }
        let dir = self.settings["lastExportDir"].as_str().map(PathBuf::from).filter(|p| p.is_dir());
        let mut dlg = rfd::FileDialog::new().set_title("영상 내보내기").add_filter("MP4 영상", &["mp4"]).set_file_name(export::default_name(&self.title));
        if let Some(d) = dir { dlg = dlg.set_directory(d); }
        let Some(mut out) = dlg.save_file() else { return };
        if out.extension().map(|e| e.to_string_lossy().to_lowercase()) != Some("mp4".into()) { out.set_extension("mp4"); }
        if let Some(d) = out.parent() { if let Ok(s) = theme::save_settings(&json!({ "lastExportDir": d.to_string_lossy() })) { self.settings = s; } }
        self.export_to(out);
    }

    /// 경로를 정해 내보내기 시작 (시험에서도 쓴다)
    pub(crate) fn export_to(&mut self, out: PathBuf) {
        let mut theme = self.theme.clone();
        theme["logo"]["path"] = json!(self.logo_path());
        let church = if self.church.trim().is_empty() { self.settings["template"]["churchName"].as_str().unwrap_or("").to_string() } else { self.church.trim().to_string() };
        let req = export::Request {
            source: self.project.source_path.clone(), out, words: self.project.words.clone(), segs: self.segs.clone(), lines: self.lines.clone(),
            theme, crop: self.crop, fade_ms: self.project.settings.fade_ms,
            meta: export::Meta { title: self.title.clone(), verse: self.verse.clone(), speaker: self.speaker(), church },
            encoder: export::Encoder::Nvenc,
            voice: None, bgm: None, bgm_file: None, bgm_plan: None,
            audio_offset: sermon_shorts::sync::of(&self.project.rest),
        };
        let (voice, bgm) = self.audio_export_params();
        let req = export::Request { voice, bgm, ..req };
        let progress = Arc::new(Mutex::new(export::Progress::default()));
        let (tx, rx) = std::sync::mpsc::channel();
        let p2 = progress.clone();
        std::thread::spawn(move || { let _ = tx.send(export::run(req, p2)); });
        self.export = Some(Job { progress, rx });
        self.export_result = None;
    }

    pub(crate) fn poll_export(&mut self) {
        let Some(job) = &self.export else { return };
        if let Ok(r) = job.rx.try_recv() {
            self.export = None;
            match &r { Ok(_) => self.toast("MP4와 SRT를 저장했습니다"), Err(e) => self.toast(format!("내보내기 실패: {e}")) }
            self.export_result = Some(r);
        }
    }

    /// 다 만든 뒤: 완성 영상 창 열기 (실패면 알림 창)
    pub(crate) fn export_window(&mut self, ctx: &egui::Context) {
        if let Some(res) = self.export_result.take() {
            match res {
                Ok(d) => self.open_export_view(d),
                Err(e) => self.export_error = Some(e),
            }
        }
        if let Some(e) = self.export_error.clone() {
            let mut close = false;
            egui::Window::new(RichText::new("내보내기 실패").family(style::bold()).size(17.0)).id(egui::Id::unique("export-err")).collapsible(false).resizable(false).anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0]).show(ctx, |ui| {
                ui.set_max_width(520.0);
                ui.label(RichText::new(&e).size(13.5).color(style::TEXT2));
                ui.add_space(10.0);
                if style::tool(ui, "x", "닫기").clicked() { close = true; }
            });
            if close { self.export_error = None; }
        }
        self.export_view_ui(ctx);
    }

    pub(crate) fn open_export_view(&mut self, d: export::Done) {
        self.player.stop();
        let mut p = Player::default();
        let _ = p.open(&d.out);
        let dur = p.probe.duration;
        if dur > 0.0 { p.set_ranges(&[(0.0, dur)]); }
        p.seek(0.0);
        if std::env::var("SS_TEST_MUTE").is_err() { p.play(); }
        let st = sermon_shorts::ytupload::status();
        let meta = self.yt_meta(None);
        let (title, desc, privacy) = sermon_shorts::ytupload::defaults(&meta);
        let mode = st.upload_mode.clone();
        let done = self.uploaded.get(&d.out).cloned();
        self.export_view = Some(ExportView { done: d, player: p, tex: None, watched: 0.0, last_t: 0.0, yt: Some(st), yt_open: mode != "off", checks: [false; 3], title, desc, privacy, upload: None, result: done, hint: String::new(), login: None });
        let auto = self.export_view.as_ref().is_some_and(|v| mode == "auto" && v.result.is_none() && v.yt.as_ref().is_some_and(|s| s.logged_in));
        if auto { if let Some(v) = &mut self.export_view { v.checks = [true; 3]; } self.start_upload(); }
    }

    fn yt_meta(&self, v: Option<&ExportView>) -> sermon_shorts::ytupload::Meta {
        let church = if self.church.trim().is_empty() { self.settings["template"]["churchName"].as_str().unwrap_or("").to_string() } else { self.church.trim().to_string() };
        let mut m = sermon_shorts::ytupload::Meta { title: self.title.clone(), verse: self.verse.clone(), church, speaker: self.speaker(), privacy: String::new(), credits: self.bgm_credit(), description: None };
        if let Some(v) = v { m.title = v.title.trim().to_string(); m.description = Some(v.desc.clone()); m.privacy = v.privacy.clone(); }
        m
    }

    pub(crate) fn start_upload(&mut self) {
        let Some(v) = &self.export_view else { return };
        if v.upload.is_some() || v.result.is_some() || v.title.trim().is_empty() { return; }
        let meta = self.yt_meta(Some(v));
        let file = v.done.out.clone();
        let pct = Arc::new(std::sync::Mutex::new(0f32));
        let (tx, rx) = std::sync::mpsc::channel();
        let p2 = pct.clone();
        std::thread::spawn(move || { let _ = tx.send(sermon_shorts::ytupload::upload(&file, &meta, p2).map_err(|e| e.to_string())); });
        if let Some(v) = &mut self.export_view { v.upload = Some((pct, rx)); v.hint.clear(); }
    }

    fn export_view_ui(&mut self, ctx: &egui::Context) {
        let Some(v) = &mut self.export_view else { return };
        let mut uploaded: Option<(PathBuf, sermon_shorts::ytupload::Uploaded)> = None;
        if let Some((_, rx)) = &v.upload { if let Ok(r) = rx.try_recv() { v.upload = None; match r { Ok(u) => { uploaded = Some((v.done.out.clone(), u.clone())); v.result = Some(u); } Err(e) => v.hint = format!("올리지 못했습니다: {e}"), } } }
        if let Some(rx) = &v.login { if let Ok(r) = rx.try_recv() { v.login = None; match r { Ok(s) => { v.yt = Some(s); } Err(e) => v.hint = e } } }
        if v.upload.is_some() || v.login.is_some() { ctx.request_repaint_after(std::time::Duration::from_millis(150)); }
        if v.player.tick() { if let Some(f) = &v.player.frame { let img = egui::ColorImage::from_rgba_unmultiplied([f.w, f.h], &f.rgba); match &mut v.tex { Some(t) => t.set(img, stage::tex_options()), None => v.tex = Some(ctx.load_texture("export-video", img, stage::tex_options())) } } }
        let dur = v.player.duration().max(0.01);
        let t = v.player.out_t;
        if v.player.playing() { if t > v.last_t && t - v.last_t < 1.5 { v.watched += t - v.last_t; } ctx.request_repaint(); }
        v.last_t = t;
        if v.watched >= dur * 0.95 || (t >= dur - 0.05 && v.watched > dur * 0.5) { v.checks[0] = true; }
        let name = v.done.out.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let mut close = false;
        let mut act: Option<&str> = None;
        let show_yt = v.yt_open && v.yt.is_some();
        let width = if show_yt { 315.0 + 18.0 + 412.0 + 8.0 } else { 330.0 };
        let mr = egui::Modal::new(egui::Id::unique("export-player")).frame(egui::Frame::new().fill(style::PANEL).corner_radius(CornerRadius::same(20)).inner_margin(egui::Margin::same(20))).show(ctx, |ui| {
            ui.set_width(width);
            ui.horizontal(|ui| {
                ui.vertical(|ui| {
                    ui.label(RichText::new(format!("완성 영상 · {name}")).size(19.0).family(style::bold()).color(style::TEXT));
                    ui.label(RichText::new(format!("길이 {} · MP4와 자막(SRT)을 저장했습니다.", edl::format_time(v.done.duration, false))).size(13.5).color(style::MUTED));
                    ui.label(RichText::new(v.done.out.to_string_lossy()).size(12.5).color(style::FAINT));
                });
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| { if style::icon_btn(ui, "x", 20.0, style::MUTED, "닫기 (Esc)").clicked() { close = true; } });
            });
            ui.add_space(10.0);
            ui.horizontal_top(|ui| {
                ui.vertical(|ui| {
                    let h = (ctx.content_rect().height() - 260.0).clamp(380.0, 560.0);
                    let w = h * 9.0 / 16.0;
                    let (rect, resp) = ui.allocate_exact_size(egui::vec2(w, h), egui::Sense::click());
                    ui.painter().rect_filled(rect, CornerRadius::same(14), Color32::BLACK);
                    if let Some(tex) = &v.tex { let [tw, th] = tex.size(); let k = (w / tw as f32).min(h / th as f32); let r = egui::Rect::from_center_size(rect.center(), egui::vec2(tw as f32 * k, th as f32 * k)); ui.painter().image(tex.id(), r, egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), Color32::WHITE); }
                    if resp.clicked() { v.player.toggle(); }
                    ui.horizontal(|ui| {
                        if style::icon_btn(ui, if v.player.playing() { "pause" } else { "play" }, 18.0, style::TEXT, "재생·멈춤 (Space)").clicked() { v.player.toggle(); }
                        ui.label(RichText::new(format!("{} / {}", edl::format_time(t, false), edl::format_time(dur, false))).monospace().size(13.0));
                    });
                    let (sr, sresp) = ui.allocate_exact_size(egui::vec2(w, 18.0), egui::Sense::click_and_drag());
                    let tr = egui::Rect::from_min_max(egui::pos2(sr.left() + 6.0, sr.center().y - 3.0), egui::pos2(sr.right() - 6.0, sr.center().y + 3.0));
                    if let Some(p) = sresp.interact_pointer_pos() { if sresp.clicked() || sresp.dragged() { v.player.seek((((p.x - tr.left()) / tr.width()).clamp(0.0, 1.0) as f64) * dur); } }
                    let x = tr.left() + tr.width() * (t / dur).clamp(0.0, 1.0) as f32;
                    ui.painter().rect_filled(tr, CornerRadius::same(3), style::PANEL3);
                    ui.painter().rect_filled(egui::Rect::from_min_max(tr.min, egui::pos2(x, tr.max.y)), CornerRadius::same(3), style::PRIMARY);
                    ui.painter().circle(egui::pos2(x, tr.center().y), 7.0, style::PRIMARY, Stroke::new(2.0, Color32::WHITE));
                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        if style::tool(ui, "rotate-ccw", "처음부터 다시").clicked() { act = Some("replay"); }
                        if style::tool(ui, "folder-open", "폴더에서 보기").clicked() { let _ = reveal(&v.done.out); }
                        if !show_yt && v.yt.is_some() && style::tool(ui, "square-play", "유튜브에 올리기…").clicked() { v.yt_open = true; }
                        if style::primary(ui, None, "닫기").clicked() { close = true; }
                    });
                });
                if show_yt {
                    ui.add_space(18.0);
                    egui::Frame::new().fill(style::PANEL2).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(16)).inner_margin(egui::Margin::same(16)).show(ui, |ui| { ui.vertical(|ui| {
                        ui.set_width(380.0);
                        ui.horizontal(|ui| { ui.add(crate::icons::img("square-play", 18.0, style::DANGER)); ui.label(RichText::new("유튜브에 올리기").size(16.0).family(style::bold())); });
                        ui.add_space(6.0);
                        let st = v.yt.clone().unwrap_or_default();
                        if let Some(u) = &v.result {
                            ui.label(RichText::new(format!("유튜브에 올렸습니다 · {}", match u.privacy.as_str() { "unlisted" => "일부공개", "private" => "비공개", "public" => "공개", p => p })).size(15.0).family(style::bold()).color(style::OK));
                            if ui.link(&u.url).clicked() { sermon_shorts::ytupload::open_url(&u.url); }
                            ui.horizontal(|ui| {
                                if style::tool(ui, "copy", "링크 복사").clicked() { ui.ctx().copy_text(u.url.clone()); act = Some("copied"); }
                                if style::primary(ui, None, "유튜브 스튜디오에서 보기").clicked() { sermon_shorts::ytupload::open_url(&u.studio); }
                            });
                            if u.privacy != "public" { ui.label(style::muted("공개로 바꾸려면 유튜브 스튜디오에서 공개 범위를 바꾸세요.")); }
                        } else if !st.logged_in {
                            ui.label(style::muted("유튜브에 올리려면 먼저 구글로 로그인해 주세요. (브라우저에서 구글 화면이 열립니다)"));
                            ui.add_space(6.0);
                            let busy = v.login.is_some();
                            if ui.add_enabled(!busy && st.has_client, egui::Button::new(RichText::new(if busy { "브라우저에서 로그인하는 중…" } else { "구글로 로그인" }).color(Color32::WHITE).family(style::bold())).fill(style::PRIMARY).corner_radius(CornerRadius::same(12)).min_size(egui::vec2(0.0, 38.0))).clicked() {
                                let (tx, rx) = std::sync::mpsc::channel();
                                std::thread::spawn(move || { let _ = tx.send(sermon_shorts::ytupload::sign_in().map_err(|e| e.to_string())); });
                                v.login = Some(rx);
                            }
                            if !st.has_client { ui.label(RichText::new("구글 OAuth 클라이언트가 없습니다. [설정 → 유튜브]에서 넣어 주세요.").color(style::WARN)); }
                        } else {
                            ui.label(RichText::new(format!("채널: {}", if st.channel.is_empty() { "내 채널" } else { &st.channel })).size(13.5).color(style::TEXT2));
                            ui.add_space(4.0);
                            ui.label(RichText::new("점검").size(13.5).family(style::bold()).color(style::TEXT2));
                            let labels = [("처음부터 끝까지 재생해 봤어요", "끝까지 재생하면 저절로 체크됩니다"), ("제목·자막에 틀린 글자가 없어요", ""), ("말소리·배경음악 크기가 알맞아요", "")];
                            let busy = v.upload.is_some();
                            for (k, (lab, note)) in labels.iter().enumerate() {
                                ui.add_enabled(!busy, egui::Checkbox::new(&mut v.checks[k], RichText::new(*lab).size(14.0)));
                                if !note.is_empty() { ui.label(RichText::new(*note).size(12.0).color(style::FAINT)); }
                            }
                            ui.add_space(6.0);
                            ui.horizontal(|ui| { ui.label(RichText::new("제목").size(13.5)); ui.label(RichText::new(format!("{}/100", v.title.encode_utf16().count())).size(12.0).color(style::FAINT)); });
                            ui.add_enabled(!busy, egui::TextEdit::singleline(&mut v.title).char_limit(100).desired_width(f32::INFINITY).margin(egui::Margin::symmetric(10, 8)));
                            ui.label(RichText::new("설명").size(13.5));
                            ui.add_enabled(!busy, egui::TextEdit::multiline(&mut v.desc).char_limit(5000).desired_rows(5).desired_width(f32::INFINITY));
                            ui.horizontal(|ui| {
                                ui.label(RichText::new("공개 범위").size(13.5));
                                let pname = |p: &str| match p { "unlisted" => "일부공개 (링크가 있는 사람만)", "private" => "비공개 (나만)", _ => "공개" };
                                ui.add_enabled_ui(!busy, |ui| egui::ComboBox::from_id_salt("yt-privacy").selected_text(pname(&v.privacy)).show_ui(ui, |ui| { for p in ["unlisted", "private", "public"] { ui.selectable_value(&mut v.privacy, p.to_string(), pname(p)); } }));
                            });
                            ui.add_space(6.0);
                            let all = v.checks.iter().all(|c| *c);
                            let can = all && !v.title.trim().is_empty() && !busy;
                            if ui.add_enabled(can, egui::Button::image_and_text(crate::icons::img("upload", 17.0, Color32::WHITE), RichText::new("유튜브에 올리기").color(Color32::WHITE).family(style::bold())).fill(style::PRIMARY).corner_radius(CornerRadius::same(12)).min_size(egui::vec2(0.0, 38.0))).clicked() { act = Some("upload"); }
                            if let Some((pct, _)) = &v.upload {
                                let p = *pct.lock().unwrap();
                                ui.add(egui::ProgressBar::new(p / 100.0).text(if p <= 0.0 { "준비 중…".to_string() } else { format!("{}%", p.round()) }));
                            } else if !all { ui.label(style::muted("점검 목록을 모두 체크하면 올릴 수 있습니다.")); }
                            else if v.title.trim().is_empty() { ui.label(style::muted("제목을 넣어 주세요.")); }
                        }
                        if !v.hint.is_empty() { ui.label(RichText::new(&v.hint).color(style::DANGER).size(13.0)); }
                    }); });
                }
            });
        });
        if mr.backdrop_response.clicked() { close = true; }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) { close = true; }
        if !ctx.egui_wants_keyboard_input() && ctx.input(|i| i.key_pressed(egui::Key::Space)) { v.player.toggle(); }
        match act {
            Some("replay") => { v.player.seek(0.0); v.player.play(); }
            Some("copied") => self.toast("링크를 복사했습니다"),
            Some("upload") => self.start_upload(),
            _ => {}
        }
        if let Some((p, u)) = uploaded {
            self.toast(format!("유튜브에 올렸습니다: {}", u.url));
            self.record_upload(&u);
            self.uploaded.insert(p, u);
        }
        if close {
            let busy = self.export_view.as_ref().is_some_and(|v| v.upload.is_some());
            if let Some(mut v) = self.export_view.take() {
                v.player.stop();
                if busy { self.toast("유튜브 업로드는 계속 진행됩니다. 끝나면 알려 드립니다."); self.bg_uploads.push(v); }
            }
        }
    }

    /// 프로젝트의 업로드 기록에 남긴다 (Electron SS.ytUploadNow 와 같은 모양)
    fn record_upload(&mut self, u: &sermon_shorts::ytupload::Uploaded) {
        let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        let entry = json!({ "url": u.url, "id": u.id, "privacy": u.privacy, "title": u.title, "at": ms });
        let arr = self.project.rest.entry("uploads".to_string()).or_insert_with(|| json!([]));
        if !arr.is_array() { *arr = json!([]); }
        arr.as_array_mut().unwrap().push(entry);
        if self.has_project { self.unsaved = true; }
    }

    /// 창을 닫은 뒤에도 계속되는 업로드
    pub(crate) fn poll_bg_uploads(&mut self) {
        let mut done = vec![];
        for (i, v) in self.bg_uploads.iter_mut().enumerate() {
            if let Some((_, rx)) = &v.upload { if let Ok(r) = rx.try_recv() { done.push((i, r)); } }
        }
        for (i, r) in done.into_iter().rev() {
            let v = self.bg_uploads.remove(i);
            match r { Ok(u) => { self.toast(format!("유튜브에 올렸습니다: {}", u.url)); self.record_upload(&u); self.uploaded.insert(v.done.out.clone(), u); } Err(e) => self.toast(format!("유튜브 업로드 실패: {e}")) }
        }
    }


}

pub(crate) struct ExportView {
    pub done: export::Done,
    pub player: Player,
    pub tex: Option<egui::TextureHandle>,
    pub watched: f64,
    pub last_t: f64,
    pub yt: Option<sermon_shorts::ytupload::Status>,
    pub yt_open: bool,
    pub checks: [bool; 3],
    pub title: String,
    pub desc: String,
    pub privacy: String,
    pub upload: Option<(Arc<std::sync::Mutex<f32>>, Receiver<Result<sermon_shorts::ytupload::Uploaded, String>>)>,
    pub result: Option<sermon_shorts::ytupload::Uploaded>,
    pub hint: String,
    pub login: Option<Receiver<Result<sermon_shorts::ytupload::Status, String>>>,
}

/// 기본 프로그램으로 열기
pub(crate) fn open_path(p: &std::path::Path) -> std::io::Result<()> {
    #[cfg(windows)] { std::process::Command::new("explorer.exe").arg(p).spawn().map(|_| ()) }
    #[cfg(target_os = "macos")] { std::process::Command::new("open").arg(p).spawn().map(|_| ()) }
    #[cfg(all(not(windows), not(target_os = "macos")))] { std::process::Command::new("xdg-open").arg(p).spawn().map(|_| ()) }
}
/// 탐색기에서 파일 위치 보이기
pub(crate) fn reveal(p: &std::path::Path) -> std::io::Result<()> {
    #[cfg(windows)] { std::process::Command::new("explorer.exe").arg(format!("/select,{}", p.display())).spawn().map(|_| ()) }
    #[cfg(target_os = "macos")] { std::process::Command::new("open").arg("-R").arg(p).spawn().map(|_| ()) }
    #[cfg(all(not(windows), not(target_os = "macos")))] { std::process::Command::new("xdg-open").arg(p.parent().unwrap_or(p)).spawn().map(|_| ()) }
}
