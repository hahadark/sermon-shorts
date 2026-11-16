//! 목소리 크기 칸 (기존 voice-ui.js): 원래대로 / 자동 맞춤(유튜브 기준 -14 LUFS) / 직접(-12~+20 dB), 작은 말소리 고르게, 리미터.
//! 미리보기는 소리 출력 직전에 압축기 → 크기 → 리미터 → 미터 (player · vox_dsp), 내보내기는 같은 순서의 ffmpeg 필터.
//! 자동 맞춤은 편집이 바뀌고 1초 동안 그대로면 다시 잰다 (ffmpeg loudnorm).
//! 배경음악은 다음 단계에서 옮긴다.
use crate::*;
use sermon_shorts::voice::{self, Measured, Voice};
use sermon_shorts::vox_dsp::Fx;

#[derive(Default)]
pub(crate) struct State {
    measuring: Option<Receiver<Result<Measured, String>>>,
    pub measure_err: String,
    stable_key: String,
    stable_since: Option<Instant>,
    last_check: Option<Instant>,
    peak_hold: f32,
    peak_at: Option<Instant>,
    rms_db: f32,
    limiting: bool,
    /// 미터 시험용: 재생 중 가장 큰 값 (dB), 섞은 배경음악 최고값
    pub max_peak_db: f32,
    pub max_bgm_peak: f32,
}

const ERR: Color32 = Color32::from_rgb(0xb9, 0x1c, 0x1c);

impl App {
    /// 지금 목소리 설정 (프로젝트 voice)
    pub(crate) fn voice(&self) -> Voice { voice::normalize(self.project.rest.get("voice").unwrap_or(&Value::Null)) }
    fn seg_pairs(&self) -> Vec<(f64, f64)> { self.segs.iter().map(|s| (s.start, s.end)).collect() }
    /// 바꾸기 (되돌리기 기록 포함, 기존 change)
    pub(crate) fn change_voice(&mut self, f: impl FnOnce(&mut Voice), undo: bool) {
        if undo { self.push_undo(); }
        let mut v = self.voice();
        f(&mut v);
        let v = voice::normalize(&v.to_json());
        self.project.rest.insert("voice".into(), v.to_json());
        if undo { self.push_undo(); self.unsaved = true; }
        if v.mode == "auto" { self.measure_voice(false); }
    }
    /// 자동 맞춤: 편집한 말소리 크기 재기 (뒤에서)
    pub(crate) fn measure_voice(&mut self, force: bool) {
        if self.player.path.is_none() || self.audio.measuring.is_some() { return; }
        let v = self.voice();
        let segs = self.seg_pairs();
        if segs.is_empty() { return; }
        if !force && voice::measured_fits(&v, &voice::seg_key(&segs)) { return; }
        self.audio.measure_err.clear();
        let src = self.project.source_path.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || { let _ = tx.send(voice::analyze(&src, &segs, &v)); });
        self.audio.measuring = Some(rx);
    }
    pub(crate) fn voice_measuring(&self) -> bool { self.audio.measuring.is_some() }

    /// 매 화면: 잰 값 받기 · 편집이 바뀌면 다시 재기 · 미리보기 소리 길 · 미터
    pub(crate) fn audio_ui(&mut self, ctx: &egui::Context) {
        if let Some(rx) = &self.audio.measuring {
            if let Ok(r) = rx.try_recv() {
                self.audio.measuring = None;
                match r {
                    // 재는 동안 고르게 설정을 바꿨으면 버린다
                    Ok(m) => { let now = self.voice(); if now.even == m.even { let mut v = now; v.measured = Some(m); self.project.rest.insert("voice".into(), v.to_json()); } }
                    Err(e) => self.audio.measure_err = e,
                }
            } else { ctx.request_repaint_after(std::time::Duration::from_millis(200)); }
        }
        // 편집이 바뀌면: 1초 동안 그대로면 다시 잰다 (자동 맞춤일 때만)
        if self.audio.last_check.is_none_or(|t| t.elapsed().as_millis() >= 500) {
            self.audio.last_check = Some(Instant::now());
            let v = self.voice();
            if v.mode == "auto" && self.audio.measuring.is_none() && self.player.path.is_some() && !self.dirty {
                let key = voice::seg_key(&self.seg_pairs());
                if voice::measured_fits(&v, &key) { self.audio.stable_key = key; }
                else if key != self.audio.stable_key { self.audio.stable_key = key; self.audio.stable_since = Some(Instant::now()); }
                else if self.audio.stable_since.is_some_and(|t| t.elapsed().as_millis() >= 1000) { self.measure_voice(false); }
            }
            if v.mode == "auto" { ctx.request_repaint_after(std::time::Duration::from_millis(500)); }
        }
        // 미리보기 소리 길
        let fx = Fx::of(&self.voice());
        if let Ok(mut f) = self.player.fx.lock() { if *f != fx { *f = fx; } }
        // 미터 (-48 ~ 0 dB, 최고값 1.5초 유지)
        let m = self.player.meter.lock().map(|mut m| std::mem::take(&mut *m)).unwrap_or_default();
        if m.bgm_peak > self.audio.max_bgm_peak { self.audio.max_bgm_peak = m.bgm_peak; }
        if m.n > 0 {
            let pk = if m.peak > 0.0 { 20.0 * m.peak.log10() } else { -100.0 };
            self.audio.rms_db = if m.sum > 0.0 { (10.0 * (m.sum / m.n as f64).log10()) as f32 } else { -100.0 };
            if self.player.playing() && pk > self.audio.max_peak_db { self.audio.max_peak_db = pk; }
            if pk > self.audio.peak_hold || self.audio.peak_at.is_none_or(|t| t.elapsed().as_millis() > 1500) { self.audio.peak_hold = pk; self.audio.peak_at = Some(Instant::now()); }
            self.audio.limiting = m.min_gain < 0.94;
        } else if !self.player.playing() { self.audio.rms_db = -100.0; self.audio.limiting = false; }
    }

    /// 디자인 카드의 [목소리] 탭
    pub(crate) fn voice_tab(&mut self, ui: &mut egui::Ui) {
        let v = self.voice();
        let g = voice::gain_db(&v);
        let label_w = 78.0;
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            ui.label(RichText::new("설교 목소리 크기").size(13.5).family(style::bold()).color(style::TEXT));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| { ui.label(RichText::new(voice::describe(&v)).size(12.5).family(style::bold()).color(style::PRIMARY)); });
        });
        ui.add_space(8.0);
        let key_label = |ui: &mut egui::Ui, s: &str| { ui.allocate_ui_with_layout(egui::vec2(label_w, 32.0), egui::Layout::left_to_right(egui::Align::Center), |ui| ui.label(RichText::new(s).size(13.0).color(style::MUTED))); };
        // 크기: 원래대로 / 자동 맞춤 / 직접
        let mut pick = None;
        ui.horizontal(|ui| {
            key_label(ui, "크기");
            egui::Frame::new().fill(style::PANEL3).corner_radius(CornerRadius::same(10)).inner_margin(egui::Margin::same(3)).show(ui, |ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                for (m, l, tip) in [("off", "원래대로", "원본 소리 그대로"), ("auto", "자동 맞춤", "편집한 목소리를 재서 유튜브 기준 크기(-14 LUFS)에 맞춤"), ("manual", "직접", "직접 키우거나 줄이기")] {
                    let on = v.mode == m;
                    let b = egui::Button::new(RichText::new(l).size(12.5).family(if on { style::bold() } else { style::semi() }).color(if on { style::TEXT } else { style::MUTED }))
                        .fill(if on { Color32::WHITE } else { Color32::TRANSPARENT }).stroke(Stroke::NONE).corner_radius(CornerRadius::same(8)).min_size(egui::vec2(0.0, 28.0));
                    if ui.add(b).on_hover_text(tip).clicked() && !on { pick = Some(m); }
                }
            });
        });
        if let Some(m) = pick { self.change_voice(|v| v.mode = m.into(), true); }
        let v = self.voice();
        // 자동 맞춤: 잰 값
        if v.mode == "auto" {
            let fits = voice::measured_fits(&v, &voice::seg_key(&self.seg_pairs()));
            let busy = self.audio.measuring.is_some() || (!fits && self.player.path.is_some());
            let mut again = false;
            egui::Frame::new().fill(style::PANEL2).corner_radius(CornerRadius::same(12)).inner_margin(egui::Margin::symmetric(10, 8)).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.allocate_ui_with_layout(egui::vec2(ui.available_width() - 96.0, 20.0), egui::Layout::left_to_right(egui::Align::Center), |ui| {
                        ui.spacing_mut().item_spacing.x = 3.0;
                        let t = |s: &str| RichText::new(s).size(12.0).color(style::TEXT2);
                        let b = |s: &str| RichText::new(s).size(12.0).family(style::bold()).color(style::TEXT);
                        if !self.audio.measure_err.is_empty() { ui.add(egui::Label::new(RichText::new(&self.audio.measure_err).size(12.0).color(ERR)).wrap()); }
                        else if busy { ui.add(egui::Spinner::new().size(11.0).color(style::PRIMARY)); ui.label(t("목소리 크기를 재는 중…")); }
                        else if let Some(m) = &v.measured { ui.label(t("지금 목소리")); ui.label(b(&format!("{:.1} LUFS", m.i))); ui.label(t(&format!("→ 유튜브 기준 {} LUFS 에 맞춰", voice::TARGET_LUFS))); ui.label(b(&format!("{}{:.1} dB", if g.unwrap_or(0.0) > 0.0 { "+" } else { "" }, g.unwrap_or(0.0)))); }
                        else { ui.label(t("영상을 열면 목소리 크기를 잽니다.")); }
                    });
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let r = ui.add_enabled(self.audio.measuring.is_none(), egui::Button::image_and_text(icons::img("rotate-ccw", 13.0, style::TEXT2), RichText::new("다시 재기").size(12.0).color(style::TEXT2)).fill(Color32::TRANSPARENT).corner_radius(CornerRadius::same(9)));
                        if r.on_hover_text("목소리 크기 다시 재기").clicked() { again = true; }
                    });
                });
            });
            if again { self.measure_voice(true); }
        }
        // 직접: 키우기 (끄는 동안에도 바로 들리고, 놓으면 되돌리기 기록)
        if v.mode == "manual" {
            let mut gdb = v.gain_db;
            let (mut done, mut live) = (false, false);
            ui.horizontal(|ui| {
                key_label(ui, "키우기");
                ui.spacing_mut().slider_width = (ui.available_width() - 80.0).max(120.0);
                let r = ui.add(egui::Slider::new(&mut gdb, voice::MIN_DB..=voice::MAX_DB).step_by(0.5).show_value(false));
                live = r.changed();
                done = r.drag_stopped() || (r.changed() && !r.dragged());
                ui.allocate_ui_with_layout(egui::vec2(62.0, 22.0), egui::Layout::right_to_left(egui::Align::Center), |ui| ui.label(RichText::new(format!("{}{:.1} dB", if gdb > 0.0 { "+" } else { "" }, gdb)).size(12.5).color(style::TEXT2)));
            });
            if live { let mut nv = v.clone(); nv.gain_db = gdb; self.project.rest.insert("voice".into(), voice::normalize(&nv.to_json()).to_json()); }
            if done { self.unsaved = true; self.push_undo(); }
        }
        // 작은 말소리 고르게
        ui.add_space(4.0);
        let mut even = v.even;
        ui.horizontal(|ui| {
            ui.checkbox(&mut even, "");
            ui.vertical(|ui| {
                ui.spacing_mut().item_spacing.y = 1.0;
                ui.label(RichText::new("작은 말소리 고르게").size(12.5).color(style::TEXT));
                ui.label(RichText::new("큰 소리는 살짝 누르고 작게 말한 부분은 올립니다").size(11.5).color(style::MUTED));
            });
        });
        if even != v.even { self.change_voice(|x| x.even = even, true); }
        // 미터
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            key_label(ui, "미터");
            let w = (ui.available_width() - 130.0).max(120.0);
            let (r, resp) = ui.allocate_exact_size(egui::vec2(w, 10.0), egui::Sense::hover());
            resp.on_hover_text("소리 크기 (-48 ~ 0 dB). 빨간 선이 리미터 천장(-1.5 dB)");
            let p = ui.painter();
            p.rect_filled(r, CornerRadius::same(5), Color32::from_rgb(0xe2, 0xe8, 0xf0));
            let pos = |db: f32| ((db + 48.0) / 48.0).clamp(0.0, 1.0);
            let right = r.left() + r.width() * pos(self.audio.rms_db);
            if right > r.left() + 0.5 {
                // 초록 → 노랑 → 빨강 (기존 그라데이션: 막대 전체 폭 기준)
                let stops = [(0.0, Color32::from_rgb(0x22, 0xc5, 0x5e)), (0.7, Color32::from_rgb(0x22, 0xc5, 0x5e)), (0.88, Color32::from_rgb(0xea, 0xb3, 0x08)), (1.0, Color32::from_rgb(0xef, 0x44, 0x44))];
                let mut mesh = egui::Mesh::default();
                for w2 in stops.windows(2) {
                    let (x0, x1) = (r.left() + r.width() * w2[0].0, r.left() + r.width() * w2[1].0);
                    let x1c = x1.min(right);
                    if x1c <= x0 { continue; }
                    let mix = |a: Color32, b: Color32, t: f32| Color32::from_rgb((a.r() as f32 + (b.r() as f32 - a.r() as f32) * t) as u8, (a.g() as f32 + (b.g() as f32 - a.g() as f32) * t) as u8, (a.b() as f32 + (b.b() as f32 - a.b() as f32) * t) as u8);
                    let c1 = mix(w2[0].1, w2[1].1, (x1c - x0) / (x1 - x0));
                    let base = mesh.vertices.len() as u32;
                    for (x, c) in [(x0, w2[0].1), (x1c, c1)] { mesh.colored_vertex(egui::pos2(x, r.top()), c); mesh.colored_vertex(egui::pos2(x, r.bottom()), c); }
                    mesh.add_triangle(base, base + 1, base + 2); mesh.add_triangle(base + 1, base + 2, base + 3);
                }
                p.add(egui::Shape::mesh(mesh));
            }
            if self.audio.peak_hold > -48.0 { let px = r.left() + r.width() * pos(self.audio.peak_hold); p.rect_filled(egui::Rect::from_min_max(egui::pos2(px - 1.0, r.top()), egui::pos2(px + 1.0, r.bottom())), CornerRadius::ZERO, style::TEXT); }
            let cx = r.left() + r.width() * (48.0 - 1.5) / 48.0;
            p.rect_filled(egui::Rect::from_min_max(egui::pos2(cx - 1.0, r.top()), egui::pos2(cx + 1.0, r.bottom())), CornerRadius::ZERO, Color32::from_rgba_unmultiplied(0xef, 0x44, 0x44, 204));
            ui.allocate_ui_with_layout(egui::vec2(52.0, 20.0), egui::Layout::right_to_left(egui::Align::Center), |ui| ui.label(RichText::new(if self.audio.peak_hold > -60.0 { format!("{:.1} dB", self.audio.peak_hold) } else { "-∞".into() }).size(11.5).color(style::TEXT2)));
            let on = self.audio.limiting && self.player.playing();
            let (fill, col, stroke) = if on { (Color32::from_rgb(0xff, 0xfb, 0xeb), Color32::from_rgb(0xb4, 0x53, 0x09), Color32::from_rgb(0xf5, 0x9e, 0x0b)) } else { (Color32::TRANSPARENT, style::FAINT, style::BORDER) };
            egui::Frame::new().fill(fill).stroke(Stroke::new(1.0, stroke)).corner_radius(CornerRadius::same(255)).inner_margin(egui::Margin::symmetric(7, 1)).show(ui, |ui| { ui.label(RichText::new("리미터").size(10.5).family(style::bold()).color(col)); }).response.on_hover_text("리미터가 큰 소리를 누르는 중");
        });
        // 들어 보기
        ui.add_space(4.0);
        let playing = self.player.playing();
        if ui.add(egui::Button::image_and_text(icons::img(if playing { "pause" } else { "play" }, 14.0, style::TEXT), RichText::new(if playing { "멈추기" } else { "들어 보기" }).size(12.0).family(style::semi()).color(style::TEXT))
            .fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(9)).min_size(egui::vec2(0.0, 28.0))).clicked() && self.player.path.is_some() { self.player.toggle(); }
        ui.add_space(6.0);
        ui.add(egui::Label::new(RichText::new("맨 끝에 리미터가 있어 크게 키워도 소리가 찢어지지 않습니다(최대 -1.5 dB). 미리보기와 내보낸 영상에 똑같이 적용됩니다. 원본에 이미 깨져 녹음된 소리는 되살리지 못합니다.").size(11.5).color(style::MUTED)).wrap());
        if self.player.playing() { ui.ctx().request_repaint(); }
    }
}
