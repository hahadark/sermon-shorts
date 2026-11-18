//! 배경음악 칸·고르기 창 (기존 bgm-ui.js): 추천 목록에서 고르고(듣기), 곡의 쓸 구간·페이드 인/아웃·
//! 맞추기(영상 처음에 시작 / 영상 끝에 끝남)·크기를 정한다. 미리보기 재생 때 영상과 함께 들리고(player 에서 섞음), 내보낼 때 섞인다.
//! 계산은 bgm.rs 로 미리보기와 내보내기가 똑같이 한다. 음악 파일은 앱에 들어 있지 않다.
use crate::*;
use sermon_shorts::bgm::{self, Track};
use sermon_shorts::player::BgmMix;
use std::sync::Mutex;

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum DlState { Loading, Done, Error(String) }
#[derive(Clone, Debug)]
pub(crate) struct Dl { pub got: u64, pub total: u64, pub state: DlState }

#[derive(Default)]
pub(crate) struct State {
    /// 곡 받기 (id → 진행)
    pub dl: Arc<Mutex<HashMap<String, Dl>>>,
    /// 미리보기에 섞을 곡 소리 (id, 48kHz 두 채널)
    pcm: Option<(String, Arc<Vec<f32>>)>,
    pcm_rx: Option<Receiver<(String, Result<Vec<f32>, String>)>>,
    /// 파형 (id, 봉우리)
    peaks: Option<(String, Vec<f64>)>,
    peaks_rx: Option<Receiver<(String, Result<(f64, Vec<f64>), String>)>>,
    peaks_msg: String,
    drag: Option<bool>,
    a_buf: String,
    b_buf: String,
    shown_key: String,
    /// 직접 넣은 음악 (보관함)
    pub custom: Vec<Track>,
    custom_loaded: bool,
    pub lib: Option<Box<LibDlg>>,
    pub listen: Option<Box<Listen>>,
    lost: String,
    /// 배경음악 관리 창 · 받기 목록(창을 닫아도 계속 받는다)
    pub mgr: Option<Box<Mgr>>,
    pub shared: MgrShared,
    warned_fallback: bool,
}

pub(crate) struct LibDlg { pub mood: String, yt_url: String, msg: (String, i8), importing: Option<Receiver<Result<(Track, bool), String>>>, prog: Arc<Mutex<f64>> }

/// 곡 듣기 (목록·구간): 원래 사이트 주소나 받아 둔 파일을 바로 재생
pub(crate) struct Listen { pub id: String, pub player: Player, probe_rx: Option<Receiver<Result<sermon_shorts::media::Probe, String>>>, src: String, section: Option<(f64, f64, f64, f64)>, start: f64, pub loading: bool }

const ERR: Color32 = Color32::from_rgb(0xb9, 0x1c, 0x1c);
const WARN: Color32 = Color32::from_rgb(0xb4, 0x53, 0x09);
const LIC_FG: Color32 = Color32::from_rgb(0x1d, 0x4e, 0xd8);

/// 라이선스 알약 (크기를 글자에 맞춰 직접 그린다: 줄 높이를 따라 늘어나지 않게)
fn lic_pill(ui: &mut egui::Ui, text: &str, tip: &str) {
    let g = ui.painter().layout_no_wrap(text.to_string(), egui::FontId::new(10.5, style::bold()), LIC_FG);
    let (r, resp) = ui.allocate_exact_size(egui::vec2(g.size().x + 14.0, g.size().y + 4.0), egui::Sense::hover());
    ui.painter().rect_filled(r, CornerRadius::same(255), style::PRIMARY_SOFT);
    ui.painter().galley(egui::pos2(r.left() + 7.0, r.top() + 2.0), g, LIC_FG);
    if !tip.is_empty() { resp.on_hover_text(tip); }
}
fn sm_btn(ui: &mut egui::Ui, icon: Option<&str>, text: &str, primary: bool) -> egui::Response {
    let (fill, col, stroke) = if primary { (style::PRIMARY, Color32::WHITE, Stroke::NONE) } else { (Color32::WHITE, style::TEXT, Stroke::new(1.0, style::BORDER_STRONG)) };
    let rt = RichText::new(text).size(12.0).family(if primary { style::bold() } else { style::semi() }).color(col);
    let b = match icon { Some(i) => egui::Button::image_and_text(icons::img(i, 13.0, col), rt), None => egui::Button::new(rt) };
    ui.add(b.fill(fill).stroke(stroke).corner_radius(CornerRadius::same(9)).min_size(egui::vec2(0.0, 28.0)))
}
fn parse_time(s: &str) -> Option<f64> {
    let s = s.trim();
    if let Some((m, sec)) = s.split_once(':') { if let (Ok(m), Ok(x)) = (m.parse::<u32>(), sec.parse::<f64>()) { if !sec.is_empty() && sec.split('.').next().is_some_and(|p| p.len() <= 2) { return Some(m as f64 * 60.0 + x); } } return None; }
    s.parse::<f64>().ok().filter(|x| x.is_finite())
}

impl App {
    pub(crate) fn bgm_value(&self) -> Option<Value> { self.project.rest.get("bgm").filter(|b| b.is_object() && b["id"].as_str().is_some_and(|s| !s.is_empty())).cloned() }
    fn bgm_cur(&self) -> Option<bgm::Bgm> { self.bgm_value().and_then(|b| bgm::normalize(&b)) }
    fn ensure_custom(&mut self) { if !self.bgm.custom_loaded { self.bgm.custom_loaded = true; self.bgm.custom = bgm::list_custom(); } }
    pub(crate) fn reload_custom(&mut self) { self.bgm.custom = bgm::list_custom(); self.bgm.custom_loaded = true; }
    pub(crate) fn bgm_track(&self, id: &str) -> Option<Track> {
        bgm::catalog().tracks.iter().find(|t| t.id == id).cloned().or_else(|| self.bgm.custom.iter().find(|t| t.id == id).cloned())
    }
    fn out_dur(&self) -> f64 { edl::segments_duration(&self.segs) }
    fn plan_now(&self) -> Option<bgm::Plan> { self.bgm_value().and_then(|b| bgm::plan(&b, self.out_dur())) }
    /// 영상 설명란에 넣을 음악 출처
    pub(crate) fn bgm_credit(&self) -> String { self.bgm_value().map(|b| bgm::credit_text(&b)).unwrap_or_default() }
    /// 내보내기에 넘길 목소리·배경음악 값 (프로젝트 voice·bgm 과 같은 모양)
    pub(crate) fn audio_export_params(&self) -> (Option<Value>, Option<Value>) { (Some(self.voice().to_json()), self.bgm_value()) }

    /// 곡을 고르면 바로 뒤에서 받는다 (내보내기에 필요). 받은 뒤엔 미리보기에도 섞인다
    pub(crate) fn bgm_prefetch(&mut self, id: &str) {
        if bgm::cached_file(id).is_some() { return; }
        { let d = self.bgm.dl.lock().unwrap(); if d.get(id).is_some_and(|x| x.state != DlState::Error(String::new()) && !matches!(x.state, DlState::Error(_))) { return; } }
        if self.bgm_track(id).is_some_and(|t| t.custom) { self.bgm.dl.lock().unwrap().insert(id.into(), Dl { got: 0, total: 0, state: DlState::Error("직접 넣은 음악 파일이 없어졌습니다".into()) }); return; }
        self.bgm.dl.lock().unwrap().insert(id.into(), Dl { got: 0, total: 0, state: DlState::Loading });
        let (dl, id2) = (self.bgm.dl.clone(), id.to_string());
        std::thread::spawn(move || {
            let r = bgm::ensure(&id2, &|g, n| { if let Some(d) = dl.lock().unwrap().get_mut(&id2) { d.got = g; d.total = n; } });
            let mut m = dl.lock().unwrap();
            let e = m.entry(id2).or_insert(Dl { got: 0, total: 0, state: DlState::Loading });
            e.state = match r { Ok(_) => DlState::Done, Err(err) => DlState::Error(err) };
        });
    }

    /// 매 화면: 받기·풀기·파형 · 미리보기에 섞을 곡과 배치 · 듣기
    pub(crate) fn bgm_tick(&mut self, ctx: &egui::Context) {
        self.ensure_custom();
        let cur = self.bgm_cur();
        // 프로젝트의 직접 넣은 음악이 목록에 없으면 다시 읽어 본다
        if let Some(b) = &cur { if self.bgm_track(&b.id).is_none() && b.id.starts_with("custom-") && self.bgm.lost != b.id { self.reload_custom(); if self.bgm_track(&b.id).is_none() { self.bgm.lost = b.id.clone(); } } }
        if let Some(b) = &cur { if self.bgm_track(&b.id).is_some() { self.bgm_prefetch(&b.id.clone()); } }
        // 받은 곡을 풀어 둔다 (미리보기에 섞기)
        if let Some(rx) = &self.bgm.pcm_rx { if let Ok((id, r)) = rx.try_recv() { self.bgm.pcm_rx = None; if let Ok(p) = r { self.bgm.pcm = Some((id, Arc::new(p))); } } }
        if let Some(b) = &cur {
            if self.bgm.pcm.as_ref().is_none_or(|(id, _)| *id != b.id) && self.bgm.pcm_rx.is_none() {
                if let Some(f) = bgm::cached_file(&b.id) {
                    let (tx, rx) = std::sync::mpsc::channel();
                    let id = b.id.clone();
                    std::thread::spawn(move || { let _ = tx.send((id, bgm::decode_pcm(&f))); });
                    self.bgm.pcm_rx = Some(rx);
                }
            }
        }
        // 미리보기에 섞기: 편집 결과로 재생할 때만 (기존 playback.active)
        let mix = match (&cur, &self.bgm.pcm, self.plan_now()) {
            (Some(b), Some((id, pcm)), Some(plan)) if *id == b.id && self.edited => Some(BgmMix { id: id.clone(), pcm: pcm.clone(), plan }),
            _ => None,
        };
        if let Ok(mut m) = self.player.bgm.lock() {
            let same = match (&*m, &mix) { (Some(a), Some(b)) => a.id == b.id && a.plan == b.plan, (None, None) => true, _ => false };
            if !same { *m = mix; }
        }
        // 파형
        if let Some(rx) = &self.bgm.peaks_rx { if let Ok((id, r)) = rx.try_recv() { self.bgm.peaks_rx = None; match r { Ok((_, p)) => { self.bgm.peaks = Some((id, p)); self.bgm.peaks_msg.clear(); } Err(_) => self.bgm.peaks_msg = "파형을 불러오지 못했습니다 (인터넷 연결 확인). 구간은 숫자로 정할 수 있어요.".into() } } }
        if let Some(b) = &cur {
            if self.bgm.peaks.as_ref().is_none_or(|(id, _)| *id != b.id) && self.bgm.peaks_rx.is_none() && self.bgm_track(&b.id).is_some() {
                if let Some((_, p)) = bgm::bundled_peaks(&b.id, 420) { self.bgm.peaks = Some((b.id.clone(), p)); self.bgm.peaks_msg.clear(); }
                else {
                    self.bgm.peaks_msg = "파형 불러오는 중… (처음 한 번 음악을 받습니다)".into();
                    let (tx, rx) = std::sync::mpsc::channel();
                    let id = b.id.clone();
                    std::thread::spawn(move || { let _ = tx.send((id.clone(), bgm::peaks(&id, 420))); });
                    self.bgm.peaks_rx = Some(rx);
                }
            }
        }
        // 듣기
        let mut stop_listen = false;
        if let Some(l) = &mut self.bgm.listen {
            if let Some(rx) = &l.probe_rx {
                if let Ok(r) = rx.try_recv() {
                    l.probe_rx = None;
                    match r {
                        Ok(pr) => {
                            let dur = pr.duration;
                            l.player.open_probed(std::path::Path::new(&l.src), pr);
                            if let Some((a, b2, _, _)) = l.section { l.player.set_ranges(&[(a, b2.min(dur.max(b2)))]); l.player.seek(0.0); } else { l.player.seek(l.start); }
                            l.player.play();
                            l.loading = false;
                        }
                        Err(_) => { stop_listen = true; self.toast = Some(("음악을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.".into(), Instant::now())); }
                    }
                }
            }
            if !l.loading {
                l.player.tick();
                // 크기 0.8, 구간 듣기는 페이드 넣어서
                let mut g = 0.8f32;
                if let Some((a, b2, fi, fo)) = l.section { let x = l.player.src_now(); let mut k = 1.0; if fi > 0.0 && x - a < fi { k = (x - a) / fi; } if fo > 0.0 && b2 - x < fo { k = k.min((b2 - x) / fo); } g *= k.clamp(0.0, 1.0) as f32; }
                if let Ok(mut f) = l.player.fx.lock() { *f = sermon_shorts::vox_dsp::Fx { on: true, even: false, gain: g, ceil: 1.0 }; }
            }
            if l.player.playing() || l.loading { ctx.request_repaint(); }
        }
        // 영상을 재생하면 곡 듣기는 멈춘다 (기존 video play → stopLib)
        if self.player.playing() && self.bgm.listen.as_ref().is_some_and(|l| l.player.playing() || l.loading) { stop_listen = true; }
        if stop_listen { self.bgm.listen = None; }
        if self.bgm.dl.lock().unwrap().values().any(|d| d.state == DlState::Loading) || self.bgm.pcm_rx.is_some() || self.bgm.peaks_rx.is_some() { ctx.request_repaint_after(std::time::Duration::from_millis(200)); }
        self.bgm_lib_ui(ctx);
        self.bgm_mgr_ui(ctx);
    }

    /// 왼쪽 메뉴 [배경음악]: 편집 화면의 배경음악 탭 (기존 RAIL.music)
    pub(crate) fn music_page(&mut self, ui: &mut egui::Ui) { self.page = Page::Editor; self.design_tab = DesignTab::Music; self.editor(ui); }
    /// 곡 듣기 시작 (section: 쓸 구간만, 페이드 넣어서)
    pub(crate) fn listen_track(&mut self, t: &Track, from: f64, section: Option<(f64, f64, f64, f64)>) {
        self.bgm.listen = None;
        self.player.stop();
        let src = bgm::cached_file(&t.id).map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| t.url.clone());
        let (tx, rx) = std::sync::mpsc::channel();
        let s2 = src.clone();
        std::thread::spawn(move || { let _ = tx.send(sermon_shorts::media::probe(std::path::Path::new(&s2)).map_err(|e| e.to_string())); });
        self.bgm.listen = Some(Box::new(Listen { id: t.id.clone(), player: Player::default(), probe_rx: Some(rx), src, section, start: from, loading: true }));
    }
    pub(crate) fn listening(&self, id: &str) -> (bool, bool) { self.bgm.listen.as_ref().filter(|l| l.id == id).map(|l| (l.loading, l.player.playing())).unwrap_or((false, false)) }
    fn stop_listen(&mut self) { self.bgm.listen = None; }

    fn change_bgm(&mut self, f: impl FnOnce(&mut bgm::Bgm), record: bool) {
        let Some(mut b) = self.bgm_cur() else { return };
        let dur = self.bgm_track(&b.id).map(|t| t.duration_sec).filter(|d| *d > 0.0).or(b.duration);
        let (a0, e0) = (b.track_start, b.track_end);
        f(&mut b);
        // 시작을 끝 뒤로·끝을 시작 앞으로 적으면 전체 구간으로 되돌아가 버리므로, 가까운 값(1초 간격)으로 맞춘다
        if b.track_start != a0 { b.track_start = b.track_start.min(e0 - 1.0).max(0.0); }
        if b.track_end != e0 { b.track_end = b.track_end.max(b.track_start + 1.0); }
        let mut v = b.to_json();
        v["duration"] = json!(dur);
        if let Some(n) = bgm::normalize(&v) { self.project.rest.insert("bgm".into(), n.to_json()); }
        if record { self.push_undo(); self.unsaved = true; }
    }
    /// 이 음악 쓰기 (기존 use)
    pub(crate) fn use_bgm(&mut self, id: &str) {
        let Some(t) = self.bgm_track(id) else { return };
        self.push_undo();
        let prev = self.bgm_cur();
        let mut v = json!({ "id": id, "duration": t.duration_sec, "trackStart": 0, "trackEnd": t.duration_sec, "volume": bgm::DEF_VOLUME, "fadeIn": bgm::DEF_FADE_IN, "fadeOut": bgm::DEF_FADE_OUT, "align": "start" });
        if let Some(p) = prev { v["volume"] = json!(p.volume); v["fadeIn"] = json!(p.fade_in); v["fadeOut"] = json!(p.fade_out); v["align"] = json!(p.align); }
        if let Some(n) = bgm::normalize(&v) { self.project.rest.insert("bgm".into(), n.to_json()); }
        self.bgm.lib = None; self.stop_listen();
        self.design_tab = DesignTab::Music;
        self.push_undo(); self.unsaved = true;
        self.toast(format!("\"{}\"을(를) 배경음악으로 넣었습니다. [재생]으로 영상과 함께 들어 보세요.", t.title));
    }

    /// 디자인 카드의 [배경음악] 탭
    pub(crate) fn music_tab(&mut self, ui: &mut egui::Ui) {
        let cur = self.bgm_cur();
        let t = cur.as_ref().and_then(|b| self.bgm_track(&b.id));
        ui.add_space(4.0);
        let (Some(b), Some(t)) = (cur.clone(), t) else {
            ui.add(egui::Label::new(RichText::new("잔잔한 피아노·찬송가 연주처럼 설교 쇼츠에 많이 쓰는 저작권 공개 음악을 골라 넣습니다. 음악은 앱에 들어 있지 않고 인터넷에서 바로 재생합니다.").size(12.5).color(style::TEXT2)).wrap());
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                if ui.add(egui::Button::image_and_text(icons::img("list-music", 15.0, Color32::WHITE), RichText::new("음악 고르기").size(13.0).family(style::bold()).color(Color32::WHITE)).fill(style::PRIMARY).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(0.0, 34.0))).clicked() { self.open_bgm_lib(); }
                if ui.add(egui::Button::image_and_text(icons::img("library-big", 15.0, style::TEXT), RichText::new("배경음악 관리").size(13.0).family(style::semi()).color(style::TEXT)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(0.0, 34.0))).on_hover_text("유튜브 주소로 음악 받기 · 받아 둔 음악 관리").clicked() { self.open_bgm_manager(); }
            });
            if cur.as_ref().is_some_and(|b| self.bgm.lost == b.id) {
                ui.add_space(6.0);
                ui.add(egui::Label::new(RichText::new("이 프로젝트에 넣었던 음악(직접 넣은 파일)을 이 컴퓨터에서 찾을 수 없습니다. [음악 고르기]에서 다시 고르거나 파일을 다시 넣어 주세요. 그대로 두면 내보내기가 멈춥니다.").size(12.0).color(WARN)).wrap());
            }
            return;
        };
        let plan = self.plan_now();
        let playing = self.player.playing();
        // 곡 이름 줄
        ui.horizontal(|ui| {
            let (r, resp) = ui.allocate_exact_size(egui::vec2(32.0, 32.0), egui::Sense::click());
            ui.painter().circle_filled(r.center(), 16.0, style::PRIMARY);
            icons::img(if playing { "pause" } else { "play" }, 15.0, Color32::WHITE).paint_at(ui, egui::Rect::from_center_size(r.center(), egui::vec2(15.0, 15.0)));
            if resp.on_hover_text("영상과 함께 듣기 (Space)").clicked() && self.player.path.is_some() {
                if playing { self.player.stop(); } else { if !self.edited { self.edited = true; self.dirty = true; self.recompute(); } self.stop_listen(); self.player.play(); }
            }
            ui.vertical(|ui| {
                ui.set_width((ui.available_width() - 110.0).max(60.0));
                ui.spacing_mut().item_spacing.y = 0.0;
                ui.add(egui::Label::new(RichText::new(&t.title).size(13.0).family(style::bold()).color(style::TEXT)).truncate());
                ui.add(egui::Label::new(RichText::new(format!("{} · {} · {}", t.artist, t.mood, bgm::fmt(t.duration_sec))).size(11.5).color(style::MUTED)).truncate());
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if style::icon_btn(ui, "x", 15.0, style::TEXT2, "음악 빼기").clicked() {
                    self.push_undo(); self.project.rest.remove("bgm"); self.push_undo(); self.unsaved = true;
                    self.toast("배경음악을 뺐습니다. (Ctrl+Z 로 되돌리기)");
                }
                if sm_btn(ui, None, "바꾸기", false).clicked() { self.open_bgm_lib(); }
            });
        });
        if self.bgm_cur().is_none() { return; }
        // 파형 (곡 전체, 쓸 구간 손잡이)
        let dur = if t.duration_sec > 0.0 { t.duration_sec } else { 1.0 };
        let (rect, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 46.0), egui::Sense::click_and_drag());
        let resp = resp.on_hover_text("파란 손잡이를 끌어 쓸 구간을 고르세요").on_hover_cursor(egui::CursorIcon::ResizeHorizontal);
        let x_of = |s: f64| rect.left() + (s / dur) as f32 * rect.width();
        let t_of = |x: f32| (((x - rect.left()) / rect.width()) as f64 * dur).clamp(0.0, dur);
        if resp.drag_started() || (resp.clicked() && self.bgm.drag.is_none()) {
            if let Some(pos) = resp.interact_pointer_pos() { let tt = t_of(pos.x); self.bgm.drag = Some((x_of(tt) - x_of(b.track_start)).abs() <= (x_of(tt) - x_of(b.track_end)).abs()); self.push_undo(); }
        }
        if let (Some(is_a), Some(pos)) = (self.bgm.drag, resp.interact_pointer_pos()) {
            if resp.dragged() || resp.drag_started() || resp.clicked() { let tt = t_of(pos.x); self.change_bgm(|bb| if is_a { bb.track_start = tt.min(bb.track_end - 1.0) } else { bb.track_end = tt.max(bb.track_start + 1.0) }, false); }
        }
        if resp.drag_stopped() || (resp.clicked() && self.bgm.drag.is_some()) { self.bgm.drag = None; self.push_undo(); self.unsaved = true; }
        let b = self.bgm_cur().unwrap_or(b);
        let p = ui.painter_at(rect);
        p.rect(rect, CornerRadius::same(7), Color32::WHITE, Stroke::new(1.0, style::BORDER), egui::StrokeKind::Inside);
        p.rect_filled(egui::Rect::from_min_max(egui::pos2(x_of(b.track_start), rect.top()), egui::pos2(x_of(b.track_end), rect.bottom())), CornerRadius::ZERO, Color32::from_rgba_unmultiplied(37, 99, 235, 20));
        let plan2 = self.plan_now();
        if let Some(pl) = &plan2 { p.rect_filled(egui::Rect::from_min_max(egui::pos2(x_of(pl.from), rect.top()), egui::pos2(x_of(pl.from + pl.length), rect.bottom())), CornerRadius::ZERO, Color32::from_rgba_unmultiplied(37, 99, 235, 41)); }
        if let Some((pid, pk)) = &self.bgm.peaks {
            if *pid == b.id && !pk.is_empty() {
                let n = pk.len(); let bw = rect.width() / n as f32; let h = rect.height();
                for (i, v) in pk.iter().enumerate() {
                    let s = (i as f64 / n as f64) * dur;
                    let in_sel = s >= b.track_start && s <= b.track_end;
                    let vv = ((*v as f32) * h * 0.42).max(1.0);
                    p.rect_filled(egui::Rect::from_min_size(egui::pos2(rect.left() + i as f32 * bw, rect.center().y - vv), egui::vec2((bw - 0.6).max(1.0), vv * 2.0)), CornerRadius::ZERO, if in_sel { Color32::from_rgb(0x60, 0xa5, 0xfa) } else { style::BORDER_STRONG });
                }
            }
        }
        if let Some(pl) = &plan2 {
            let (a, e) = (x_of(pl.from), x_of(pl.from + pl.length));
            let fi = x_of(pl.from + pl.fade_in) - a; let fo = e - x_of(pl.from + pl.length - pl.fade_out);
            p.add(egui::Shape::line(vec![egui::pos2(a, rect.bottom() - 3.0), egui::pos2(a + fi, rect.top() + 4.0), egui::pos2(e - fo, rect.top() + 4.0), egui::pos2(e, rect.bottom() - 3.0)], Stroke::new(1.5, Color32::from_rgb(0xf5, 0x9e, 0x0b))));
        }
        for s in [b.track_start, b.track_end] { let x = x_of(s); p.rect_filled(egui::Rect::from_min_max(egui::pos2(x - 1.5, rect.top()), egui::pos2(x + 1.5, rect.bottom())), CornerRadius::ZERO, style::PRIMARY); p.rect_filled(egui::Rect::from_min_size(egui::pos2(x - 5.0, rect.top()), egui::vec2(10.0, 8.0)), CornerRadius::ZERO, style::PRIMARY); p.rect_filled(egui::Rect::from_min_size(egui::pos2(x - 5.0, rect.bottom() - 8.0), egui::vec2(10.0, 8.0)), CornerRadius::ZERO, style::PRIMARY); }
        // 재생 위치 (영상과 함께 / 구간 듣기)
        let now = if playing { plan2.as_ref().and_then(|pl| bgm::track_time_at(Some(pl), self.player.out_t)) } else { self.bgm.listen.as_ref().filter(|l| l.id == b.id && l.player.playing()).map(|l| l.player.src_now()) };
        if let Some(x) = now { let xx = x_of(x); p.rect_filled(egui::Rect::from_min_max(egui::pos2(xx - 0.5, rect.top()), egui::pos2(xx + 1.0, rect.bottom())), CornerRadius::ZERO, style::TEXT); }
        if !self.bgm.peaks_msg.is_empty() && self.bgm.peaks.as_ref().is_none_or(|(id, _)| *id != b.id) { p.text(rect.center(), egui::Align2::CENTER_CENTER, &self.bgm.peaks_msg, egui::FontId::proportional(11.5), style::MUTED); }
        ui.add_space(4.0);
        // 구간
        let key = format!("{}|{}|{}", b.id, b.track_start, b.track_end);
        if key != self.bgm.shown_key { self.bgm.shown_key = key; self.bgm.a_buf = bgm::fmt(b.track_start); self.bgm.b_buf = bgm::fmt(b.track_end); }
        let row_k = |ui: &mut egui::Ui, s: &str| { ui.allocate_ui_with_layout(egui::vec2(40.0, 26.0), egui::Layout::left_to_right(egui::Align::Center), |ui| ui.label(RichText::new(s).size(12.0).color(style::MUTED))); };
        let (mut set_a, mut set_b, mut listen) = (None, None, false);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            row_k(ui, "구간");
            let ra = ui.add(egui::TextEdit::singleline(&mut self.bgm.a_buf).desired_width(58.0).font(egui::FontId::proportional(12.0)).align(egui::Align2::CENTER_CENTER));
            if ra.lost_focus() { match parse_time(&self.bgm.a_buf) { Some(v) => set_a = Some(v), None => self.bgm.shown_key.clear() } }
            ui.label(RichText::new("~").size(12.0));
            let rb = ui.add(egui::TextEdit::singleline(&mut self.bgm.b_buf).desired_width(58.0).font(egui::FontId::proportional(12.0)).align(egui::Align2::CENTER_CENTER));
            if rb.lost_focus() { match parse_time(&self.bgm.b_buf) { Some(v) => set_b = Some(v), None => self.bgm.shown_key.clear() } }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let (loading, on) = self.listening(&b.id);
                if sm_btn(ui, Some(if on { "pause" } else { "play" }), if loading { "불러오는 중" } else if on { "멈추기" } else { "구간 듣기" }, false).clicked() { listen = true; }
            });
        });
        if let Some(v) = set_a { self.change_bgm(|bb| bb.track_start = v, true); }
        if let Some(v) = set_b { self.change_bgm(|bb| bb.track_end = v, true); }
        if listen {
            let (loading, on) = self.listening(&b.id);
            if on || loading { self.stop_listen(); } else { self.player.stop(); self.listen_track(&t, b.track_start, Some((b.track_start, b.track_end, b.fade_in, b.fade_out))); }
        }
        let b = self.bgm_cur().unwrap_or(b);
        // 구간 길이 안내
        let (sel, od) = (b.track_end - b.track_start, self.out_dur());
        let extra = if od > 0.0 { if sel > od + 0.5 { format!(" · 영상({})보다 길어 {}만 씀", bgm::fmt(od), if b.align == "end" { "뒷부분" } else { "앞부분" }) } else if sel < od - 0.5 { format!(" · 영상보다 짧아 {}", if b.align == "end" { "끝에 맞춰 늦게 시작" } else { "처음부터 나오고 먼저 끝남" }) } else { String::new() } } else { String::new() };
        ui.horizontal(|ui| { ui.add_space(46.0); ui.label(RichText::new(format!("{} 구간{extra}", bgm::fmt(sel))).size(11.5).color(style::MUTED)); });
        // 받기 진행
        let d = self.bgm.dl.lock().unwrap().get(&b.id).cloned();
        let mut retry = false;
        if let Some(d) = d {
            match &d.state {
                DlState::Done => {}
                DlState::Error(_) if t.custom => { ui.add(egui::Label::new(RichText::new("직접 넣은 음악 파일이 없어졌습니다. [바꾸기]에서 음악을 다시 넣어 주세요. (이대로는 내보낼 때 음악을 섞지 못합니다)").size(12.0).color(WARN)).wrap()); }
                DlState::Error(_) => { ui.horizontal_wrapped(|ui| { ui.label(RichText::new("음악 파일을 받지 못했습니다. 들어 보기는 되고, 내보낼 때 다시 받습니다.").size(12.0).color(WARN)); if ui.link(RichText::new("다시 받기").size(12.0)).clicked() { retry = true; } }); }
                DlState::Loading => {
                    let pct = if d.total > 0 { (d.got * 100 / d.total).min(99) } else { 0 };
                    ui.horizontal(|ui| {
                        let (r, _) = ui.allocate_exact_size(egui::vec2(80.0, 6.0), egui::Sense::hover());
                        ui.painter().rect_filled(r, CornerRadius::same(255), style::BORDER);
                        ui.painter().rect_filled(egui::Rect::from_min_size(r.min, egui::vec2(r.width() * pct as f32 / 100.0, 6.0)), CornerRadius::same(255), style::PRIMARY);
                        ui.label(RichText::new(format!("음악 파일 받는 중 {}", if d.total > 0 { format!("{pct}%") } else { "…".into() })).size(12.0).color(style::MUTED));
                        ui.label(RichText::new("· 편집은 그대로 하셔도 됩니다").size(11.0).color(style::MUTED));
                    });
                }
            }
        }
        if retry { self.bgm.dl.lock().unwrap().remove(&b.id); self.bgm_prefetch(&b.id.clone()); }
        // 맞추기
        let mut align = None;
        ui.horizontal(|ui| {
            row_k(ui, "맞추기");
            egui::Frame::new().fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(255)).inner_margin(egui::Margin::same(3)).show(ui, |ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                for (a, l, tip) in [("start", "처음에 시작", "영상이 시작할 때 음악도 시작"), ("end", "끝에 끝남", "영상이 끝날 때 음악도 끝나도록")] {
                    let on = b.align == a;
                    if ui.add(egui::Button::new(RichText::new(l).size(12.0).family(style::semi()).color(if on { Color32::WHITE } else { style::TEXT2 })).fill(if on { style::NAVY } else { Color32::TRANSPARENT }).corner_radius(CornerRadius::same(255)).min_size(egui::vec2(0.0, 24.0))).on_hover_text(tip).clicked() && !on { align = Some(a); }
                }
            });
        });
        if let Some(a) = align { self.change_bgm(|bb| bb.align = a.into(), true); }
        // 페이드
        let (mut fi, mut fo) = (b.fade_in, b.fade_out);
        let (mut fi_done, mut fo_done) = (false, false);
        ui.horizontal(|ui| {
            row_k(ui, "페이드");
            ui.label(RichText::new("인").size(12.0));
            let r = ui.add_sized([52.0, 26.0], egui::DragValue::new(&mut fi).range(0.0..=30.0).speed(0.5).max_decimals(1)); fi_done = r.changed() && !r.dragged() || r.drag_stopped();
            ui.label(RichText::new("초 · 아웃").size(12.0));
            let r = ui.add_sized([52.0, 26.0], egui::DragValue::new(&mut fo).range(0.0..=30.0).speed(0.5).max_decimals(1)); fo_done = r.changed() && !r.dragged() || r.drag_stopped();
            ui.label(RichText::new("초").size(12.0));
        });
        if fi != b.fade_in || fi_done { self.change_bgm(|bb| bb.fade_in = fi, fi_done); }
        if fo != b.fade_out || fo_done { self.change_bgm(|bb| bb.fade_out = fo, fo_done); }
        // 크기
        let mut vol = (b.volume * 100.0).round();
        let mut vol_done = false;
        ui.horizontal(|ui| {
            row_k(ui, "크기");
            ui.spacing_mut().slider_width = (ui.available_width() - 50.0).max(80.0);
            let r = ui.add(egui::Slider::new(&mut vol, 0.0..=100.0).step_by(1.0).show_value(false));
            vol_done = r.drag_stopped() || (r.changed() && !r.dragged());
            ui.allocate_ui_with_layout(egui::vec2(34.0, 20.0), egui::Layout::right_to_left(egui::Align::Center), |ui| ui.label(RichText::new(format!("{}%", vol as i64)).size(12.0).color(style::TEXT)));
        });
        if (vol / 100.0 - b.volume).abs() > 1e-9 || vol_done { self.change_bgm(|bb| bb.volume = vol / 100.0, vol_done); }
        // 출처
        let r = ui.cursor();
        ui.painter().hline(r.x_range(), r.top() + 2.0, Stroke::new(1.0, style::BORDER));
        ui.add_space(8.0);
        let credit = if t.custom { format!("직접 넣은 음악 · 저작권은 직접 확인해 주세요{}", if t.kind == "youtube" { " (유튜브 음악은 대부분 저작권이 있습니다)" } else { "" }) } else if let Some(a) = &t.attribution { format!("출처 표시 필요 ({}): {a}", t.license) } else { format!("{} · 출처 표시 없이 써도 됩니다", t.license) };
        let mut copy = false;
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing.x = 4.0;
            lic_pill(ui, &t.license, "");
            ui.label(RichText::new(credit).size(11.0).color(style::MUTED));
            if ui.link(RichText::new("복사").size(11.0).family(style::semi()).color(style::PRIMARY)).clicked() { copy = true; }
        });
        if copy { ui.ctx().copy_text(self.bgm_credit()); self.toast("음악 출처를 복사했습니다. 영상 설명란에 붙여 넣으세요."); }
        let _ = plan;
    }

    // ---------------- 음악 고르기 (목록) ----------------
    pub(crate) fn open_bgm_lib(&mut self) {
        self.reload_custom();
        self.bgm.lib = Some(Box::new(LibDlg { mood: "전체".into(), yt_url: String::new(), msg: ("직접 넣은 음악은 저작권을 꼭 확인하세요. 유튜브 음악은 대부분 저작권이 있어 올린 영상에 문제가 생길 수 있습니다.".into(), 0), importing: None, prog: Arc::new(Mutex::new(0.0)) }));
    }
    fn bgm_lib_ui(&mut self, ctx: &egui::Context) {
        let Some(mut d) = self.bgm.lib.take() else { return };
        if let Some(rx) = &d.importing {
            if let Ok(r) = rx.try_recv() {
                d.importing = None;
                match r {
                    Ok((t, _)) => { self.reload_custom(); d.mood = "내 음악".into(); d.msg = (format!("\"{}\" ({})을(를) 넣었습니다.", t.title, bgm::fmt(t.duration_sec)), 1); self.bgm.lib = Some(d); self.use_bgm(&t.id); return; }
                    Err(e) => d.msg = (format!("넣지 못했습니다: {e}"), -1),
                }
            } else { let p = *d.prog.lock().unwrap(); if p > 0.0 { d.msg = (format!("유튜브에서 소리만 받는 중… {}%", p.round() as i64), 0); } ctx.request_repaint_after(std::time::Duration::from_millis(200)); }
        }
        let cat = bgm::catalog();
        let mine = self.bgm.custom.clone();
        let mut moods: Vec<String> = vec!["전체".into()];
        if !mine.is_empty() { moods.push("내 음악".into()); }
        moods.extend(cat.moods.iter().cloned());
        if d.mood == "내 음악" && mine.is_empty() { d.mood = "전체".into(); }
        let count = |m: &str| if m == "전체" { cat.tracks.len() + mine.len() } else if m == "내 음악" { mine.len() } else { cat.tracks.iter().filter(|t| t.mood == m).count() + mine.iter().filter(|t| t.mood == m).count() };
        let list: Vec<Track> = if d.mood == "내 음악" { mine.clone() } else { let mut v: Vec<Track> = mine.iter().filter(|t| d.mood == "전체" || t.mood == d.mood).cloned().collect(); v.extend(cat.tracks.iter().filter(|t| d.mood == "전체" || t.mood == d.mood).cloned()); v };
        let sel = self.bgm_cur().map(|b| b.id);
        let (mut close, mut pick_file, mut pick_yt, mut open_mgr) = (false, false, false, false);
        let (mut play, mut use_id, mut del_id, mut seek): (Option<String>, Option<String>, Option<String>, Option<(String, f64)>) = (None, None, None, None);
        let busy = d.importing.is_some();
        let frame = egui::Frame::new().fill(style::PANEL).corner_radius(CornerRadius::same(24)).inner_margin(egui::Margin::ZERO);
        let mr = egui::Modal::new(egui::Id::unique("bgm-lib")).frame(frame).show(ctx, |ui| {
            ui.set_width(760.0);
            let max_h = ctx.content_rect().height() * 0.86;
            egui::Frame::new().inner_margin(egui::Margin { left: 22, right: 22, top: 20, bottom: 12 }).show(ui, |ui| {
                ui.horizontal_top(|ui| {
                    ui.vertical(|ui| {
                        ui.set_width(760.0 - 44.0 - 40.0);
                        ui.label(RichText::new("배경음악 고르기").size(18.0).family(style::bold()).color(style::TEXT));
                        ui.add_space(6.0);
                        let mut job = egui::text::LayoutJob::default();
                        let f = |b: bool| egui::TextFormat { font_id: egui::FontId::new(12.5, if b { style::bold() } else { egui::FontFamily::Proportional }), color: if b { LIC_FG } else { style::TEXT2 }, ..Default::default() };
                        job.append("설교 쇼츠에 많이 쓰는 분위기로 골랐습니다. ", 0.0, f(false)); job.append("퍼블릭 도메인과 CC BY", 0.0, f(true)); job.append("처럼 저작권이 공개된 곡만 넣었고, 음악은 앱에 들어 있지 않아 원래 사이트에서 바로 재생합니다.", 0.0, f(false));
                        job.wrap.max_width = ui.available_width();
                        ui.label(job);
                    });
                    if style::icon_btn(ui, "x", 18.0, style::MUTED, "닫기").clicked() { close = true; }
                });
            });
            // 직접 넣기
            egui::Frame::new().outer_margin(egui::Margin { left: 22, right: 22, top: 0, bottom: 10 }).inner_margin(egui::Margin::symmetric(12, 10)).fill(Color32::from_rgb(0xf8, 0xfa, 0xfc)).stroke(Stroke::new(1.0, Color32::from_rgb(0xcb, 0xd5, 0xe1))).corner_radius(CornerRadius::same(14)).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.add_enabled_ui(!busy, |ui| {
                        if sm_btn(ui, Some("folder-open"), "내 파일로 넣기", false).on_hover_text("내 컴퓨터의 mp3·m4a·wav 등 음악 파일 넣기").clicked() { pick_file = true; }
                        let r = ui.add(egui::TextEdit::singleline(&mut d.yt_url).hint_text("유튜브 링크 붙여넣기 (https://youtu.be/...)").desired_width(ui.available_width() - 260.0).font(egui::FontId::proportional(12.5)));
                        if r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) { pick_yt = true; }
                        if sm_btn(ui, Some("square-play"), "유튜브에서 넣기", false).clicked() { pick_yt = true; }
                    });
                    if sm_btn(ui, Some("library-big"), "배경음악 관리", false).on_hover_text("받아 둔 음악 모아 보기 · 여러 곡·재생목록 받기").clicked() { open_mgr = true; }
                });
                ui.add(egui::Label::new(RichText::new(&d.msg.0).size(11.5).color(match d.msg.1 { 1 => Color32::from_rgb(0x15, 0x80, 0x3d), -1 => ERR, _ => style::MUTED })).wrap());
            });
            // 분위기
            egui::Frame::new().inner_margin(egui::Margin { left: 22, right: 22, top: 4, bottom: 12 }).show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
                    for m in &moods {
                        let on = *m == d.mood;
                        let mut job = egui::text::LayoutJob::default();
                        job.append(m, 0.0, egui::TextFormat { font_id: egui::FontId::new(12.5, style::semi()), color: if on { Color32::WHITE } else { style::TEXT2 }, ..Default::default() });
                        job.append(&count(m).to_string(), 6.0, egui::TextFormat { font_id: egui::FontId::proportional(12.5), color: if on { Color32::from_rgb(0xc7, 0xdb, 0xff) } else { style::MUTED }, ..Default::default() });
                        if ui.add(egui::Button::new(job).fill(if on { style::NAVY } else { style::PANEL2 }).stroke(Stroke::new(1.0, if on { style::NAVY } else { style::BORDER_STRONG })).corner_radius(CornerRadius::same(255)).min_size(egui::vec2(0.0, 30.0))).clicked() { d.mood = m.clone(); }
                    }
                });
            });
            // 목록
            let list_h = (max_h - 330.0).clamp(220.0, 600.0);
            egui::ScrollArea::vertical().id_salt("bgm-lib-list").max_height(list_h).min_scrolled_height(list_h).auto_shrink([false, false]).show(ui, |ui| {
                egui::Frame::new().inner_margin(egui::Margin { left: 14, right: 14, top: 0, bottom: 10 }).show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 6.0;
                    if list.is_empty() { ui.vertical_centered(|ui| { ui.add_space(30.0); ui.label(style::muted("이 분위기의 음악이 아직 없습니다.")); ui.add_space(30.0); }); }
                    for t in &list {
                        let is_sel = sel.as_deref() == Some(t.id.as_str());
                        let (loading, on) = self.listening(&t.id);
                        egui::Frame::new().fill(if is_sel { style::PRIMARY_SOFT } else { style::PANEL }).stroke(Stroke::new(1.0, if is_sel { Color32::from_rgb(0x3b, 0x82, 0xf6) } else { style::BORDER })).corner_radius(CornerRadius::same(16)).inner_margin(egui::Margin::symmetric(14, 12)).show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            ui.horizontal(|ui| {
                                ui.spacing_mut().item_spacing.x = 12.0;
                                let (r, resp) = ui.allocate_exact_size(egui::vec2(36.0, 36.0), egui::Sense::click());
                                ui.painter().circle(r.center(), 18.0, if on { style::PRIMARY } else { Color32::WHITE }, Stroke::new(1.0, if on { style::PRIMARY } else { style::BORDER_STRONG }));
                                if loading { ui.put(egui::Rect::from_center_size(r.center(), egui::vec2(16.0, 16.0)), egui::Spinner::new().size(14.0).color(style::PRIMARY)); }
                                else { icons::img(if on { "pause" } else { "play" }, 15.0, if on { Color32::WHITE } else { style::TEXT }).paint_at(ui, egui::Rect::from_center_size(r.center(), egui::vec2(15.0, 15.0))); }
                                if resp.on_hover_text(if loading { "불러오는 중…" } else { "듣기 / 일시정지" }).clicked() { play = Some(t.id.clone()); }
                                let right_w = 150.0 + if t.custom { 34.0 } else { 0.0 } + 90.0;
                                ui.vertical(|ui| {
                                    ui.set_width((ui.available_width() - right_w).max(80.0));
                                    ui.spacing_mut().item_spacing.y = 1.0;
                                    ui.add(egui::Label::new(RichText::new(&t.title).size(13.5).family(style::bold()).color(style::TEXT)).truncate());
                                    ui.label(RichText::new(&t.artist).size(12.0).color(style::MUTED));
                                    if !t.tags.is_empty() { ui.horizontal(|ui| { ui.spacing_mut().item_spacing.x = 4.0; for tag in t.tags.iter().take(3) { egui::Frame::new().fill(style::PANEL3).corner_radius(CornerRadius::same(255)).inner_margin(egui::Margin::symmetric(7, 1)).show(ui, |ui| ui.label(RichText::new(tag).size(10.5).color(Color32::from_rgb(0x47, 0x55, 0x69)))); } }); }
                                });
                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                    ui.spacing_mut().item_spacing.x = 8.0;
                                    if t.custom && style::icon_btn(ui, "trash-2", 14.0, style::MUTED, "내 음악 목록에서 빼기").clicked() { del_id = Some(t.id.clone()); }
                                    if sm_btn(ui, None, if is_sel { "쓰는 중" } else { "이 음악 쓰기" }, !is_sel).clicked() { use_id = Some(t.id.clone()); }
                                    lic_pill(ui, &t.license, &t.license_quote);
                                    ui.label(RichText::new(bgm::fmt(t.duration_sec)).size(12.0).color(style::TEXT2));
                                });
                            });
                            // 듣는 곡: 재생 위치 바 (눌러서·끌어서 옮기기)
                            if let Some(l) = self.bgm.listen.as_ref().filter(|l| l.id == t.id && (l.loading || l.player.playing() || l.player.src_now() > 0.05)) {
                                let d2 = if l.player.probe.duration > 0.0 { l.player.probe.duration } else { t.duration_sec.max(1.0) };
                                let x = l.player.src_now();
                                ui.horizontal(|ui| {
                                    ui.add_space(48.0);
                                    ui.label(RichText::new(bgm::fmt(x)).size(11.5).color(style::TEXT2));
                                    let (r, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width() - 50.0, 14.0), egui::Sense::click_and_drag());
                                    let tr = egui::Rect::from_min_max(egui::pos2(r.left(), r.center().y - 2.0), egui::pos2(r.right(), r.center().y + 2.0));
                                    ui.painter().rect_filled(tr, CornerRadius::same(2), style::BORDER);
                                    let fx = tr.left() + tr.width() * (x / d2).clamp(0.0, 1.0) as f32;
                                    ui.painter().rect_filled(egui::Rect::from_min_max(tr.min, egui::pos2(fx, tr.bottom())), CornerRadius::same(2), style::PRIMARY);
                                    ui.painter().circle_filled(egui::pos2(fx, tr.center().y), 6.0, style::PRIMARY);
                                    if let Some(pp) = resp.interact_pointer_pos() { if resp.clicked() || resp.drag_stopped() { seek = Some((t.id.clone(), (((pp.x - tr.left()) / tr.width()).clamp(0.0, 1.0) as f64) * d2)); } }
                                    ui.label(RichText::new(bgm::fmt(d2)).size(11.5).color(style::TEXT2));
                                });
                            }
                        });
                    }
                });
            });
            let r = ui.cursor();
            ui.painter().hline(r.x_range(), r.top(), Stroke::new(1.0, style::BORDER));
            egui::Frame::new().inner_margin(egui::Margin { left: 22, right: 22, top: 10, bottom: 16 }).show(ui, |ui| {
                ui.add(egui::Label::new(RichText::new("CC BY 곡은 영상 설명란에 출처를 적어야 합니다 (유튜브로 바로 올리면 자동으로 넣습니다). 같은 곡을 쓴 다른 영상 때문에 유튜브 저작권 알림이 드물게 올 수 있습니다.").size(11.5).color(style::MUTED)).wrap());
            });
        });
        if mr.backdrop_response.clicked() && !busy { close = true; }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) { close = true; }
        if close { self.stop_listen(); return; }
        if pick_file {
            if let Some(src) = rfd::FileDialog::new().set_title("배경음악 파일 고르기").add_filter("음악 파일", &bgm::AUDIO_EXT).add_filter("모든 파일", &["*"]).pick_file() {
                d.msg = ("음악 파일을 넣는 중…".into(), 0);
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::spawn(move || { let _ = tx.send(bgm::import_file(&src)); });
                d.importing = Some(rx);
            } else { d.msg = ("취소했습니다.".into(), 0); }
        }
        if pick_yt && !busy {
            let url = d.yt_url.trim().to_string();
            if url.is_empty() { d.msg = ("유튜브 링크를 붙여 넣어 주세요.".into(), -1); }
            else {
                d.msg = ("유튜브에서 소리만 받는 중…".into(), 0);
                *d.prog.lock().unwrap() = 0.0;
                let (tx, rx) = std::sync::mpsc::channel();
                let prog = d.prog.clone();
                std::thread::spawn(move || { let _ = tx.send(bgm::import_youtube(&url, &|p| { *prog.lock().unwrap() = p; })); });
                d.importing = Some(rx);
                d.yt_url.clear();
            }
        }
        if let Some(id) = play {
            let (loading, on) = self.listening(&id);
            if loading { self.stop_listen(); }
            else if let Some(l) = self.bgm.listen.as_mut().filter(|l| l.id == id) { if on { l.player.stop(); } else { l.player.play(); } }
            else if let Some(t) = self.bgm_track(&id) { self.listen_track(&t, 0.0, None); }
        }
        if let Some((id, x)) = seek {
            if let Some(l) = self.bgm.listen.as_mut().filter(|l| l.id == id && !l.loading) { l.player.seek(x); if !l.player.playing() { l.player.play(); } }
            else if let Some(t) = self.bgm_track(&id) { self.listen_track(&t, x, None); }
        }
        if let Some(id) = del_id {
            if sel.as_deref() == Some(id.as_str()) { self.toast("지금 쓰는 음악은 뺄 수 없습니다. 다른 음악으로 바꾼 뒤 빼 주세요."); }
            else {
                let title = self.bgm_track(&id).map(|t| t.title).unwrap_or(id.clone());
                let yes = std::env::var("SS_TEST_YES").is_ok() || crate::style::confirm("배경음악", format!("\"{title}\"을(를) 내 음악 목록에서 뺄까요?"));
                if yes { bgm::remove_custom(&id); self.reload_custom(); }
            }
        }
        if open_mgr { self.open_bgm_manager(); return; }
        self.bgm.lib = Some(d);
        if let Some(id) = use_id { self.use_bgm(&id); }
    }
}

impl App {
    /// 시험용: 구간 시작·맞추기·크기 바꾸기
    pub(crate) fn change_bgm_test(&mut self, start: f64, align: &str, vol: f64) { let a = align.to_string(); self.change_bgm(|b| { b.track_start = start; b.align = a; b.volume = vol; }, true); }
}

// ================================================================ 배경음악 관리 창 (기존 bgm-manager.js)

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum QState { Wait, Busy, Done, Err }
#[derive(Clone, Debug)]
pub(crate) struct QItem { pub key: u64, pub url: String, pub title: String, pub state: QState, pub pct: f64, pub msg: String, pub existed: bool }
#[derive(Default)]
pub(crate) struct MgrShared { pub queue: Arc<Mutex<Vec<QItem>>>, pub running: Arc<std::sync::atomic::AtomicBool>, pub changed: Arc<std::sync::atomic::AtomicBool>, next_key: u64 }
pub(crate) struct Mgr { urls: String, q: String, mood: String, rename: Option<(String, String, bool)>, info: (PathBuf, PathBuf, bool), adding: Option<Receiver<Result<(Track, bool), String>>> }

fn ko_date(ms: f64) -> String { let (y, m, d, _, _, _) = sermon_shorts::autosave::local_parts(ms); format!("{y}. {m}. {d}.") }
fn is_yt(u: &str) -> bool { regex::Regex::new(r"(?i)^https?://([\w-]+\.)?(youtube\.com|youtu\.be)/").unwrap().is_match(u) }
fn is_list(u: &str) -> bool { regex::Regex::new(r"[?&]list=").unwrap().is_match(u) && !regex::Regex::new(r"[?&]v=|youtu\.be/|shorts/").unwrap().is_match(u) }
fn seek_bar(ui: &mut egui::Ui, x: f64, d2: f64, indent: f32) -> Option<f64> {
    let mut out = None;
    ui.horizontal(|ui| {
        ui.add_space(indent);
        ui.label(RichText::new(bgm::fmt(x)).size(11.5).color(style::TEXT2));
        let (r, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width() - 50.0, 14.0), egui::Sense::click_and_drag());
        let tr = egui::Rect::from_min_max(egui::pos2(r.left(), r.center().y - 2.0), egui::pos2(r.right(), r.center().y + 2.0));
        ui.painter().rect_filled(tr, CornerRadius::same(2), style::BORDER);
        let fx = tr.left() + tr.width() * (x / d2).clamp(0.0, 1.0) as f32;
        ui.painter().rect_filled(egui::Rect::from_min_max(tr.min, egui::pos2(fx, tr.bottom())), CornerRadius::same(2), style::PRIMARY);
        ui.painter().circle_filled(egui::pos2(fx, tr.center().y), 6.0, style::PRIMARY);
        if let Some(pp) = resp.interact_pointer_pos() { if resp.clicked() || resp.drag_stopped() { out = Some((((pp.x - tr.left()) / tr.width()).clamp(0.0, 1.0) as f64) * d2); } }
        ui.label(RichText::new(bgm::fmt(d2)).size(11.5).color(style::TEXT2));
    });
    out
}

impl App {
    pub(crate) fn open_bgm_manager(&mut self) {
        self.bgm.lib = None; self.stop_listen();
        self.reload_custom();
        self.bgm.mgr = Some(Box::new(Mgr { urls: String::new(), q: String::new(), mood: "전체".into(), rename: None, info: bgm::library_info(), adding: None }));
        if self.bgm.mgr.as_ref().is_some_and(|m| m.info.2) && !self.bgm.warned_fallback { self.bgm.warned_fallback = true; self.toast("문서 폴더에 쓸 수 없어(Windows 보안) 배경음악을 앱 데이터 폴더에 보관합니다."); }
    }
    /// 받기 목록을 차례로 (한 번에 하나)
    fn mgr_run(&mut self) {
        use std::sync::atomic::Ordering;
        let s = &self.bgm.shared;
        if s.running.load(Ordering::SeqCst) || !s.queue.lock().unwrap().iter().any(|x| x.state == QState::Wait) { return; }
        s.running.store(true, Ordering::SeqCst);
        let (q, running, changed) = (s.queue.clone(), s.running.clone(), s.changed.clone());
        std::thread::spawn(move || {
            loop {
                let item = { let mut g = q.lock().unwrap(); match g.iter_mut().find(|x| x.state == QState::Wait) { Some(x) => { x.state = QState::Busy; x.pct = 0.0; x.clone() } None => break } };
                let q2 = q.clone(); let key = item.key;
                let r = bgm::import_youtube(&item.url, &move |p| { if let Some(x) = q2.lock().unwrap().iter_mut().find(|x| x.key == key) { x.pct = p; } });
                let mut g = q.lock().unwrap();
                if let Some(x) = g.iter_mut().find(|x| x.key == key) {
                    match r { Ok((t, existed)) => { x.state = QState::Done; x.title = t.title; x.pct = 100.0; x.existed = existed; } Err(e) => { x.state = QState::Err; x.msg = e; } }
                }
                changed.store(true, Ordering::SeqCst);
            }
            running.store(false, Ordering::SeqCst);
        });
    }
    /// 받아서 저장: 줄마다 한 곡, 재생목록은 펼쳐서 차례로
    pub(crate) fn mgr_add_urls(&mut self, text: &str) -> bool {
        let lines: Vec<String> = text.split_whitespace().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        if lines.is_empty() { self.toast("유튜브 주소를 넣어 주세요."); return false; }
        if let Some(bad) = lines.iter().find(|u| !is_yt(u)) { self.toast(format!("유튜브 주소가 아닌 줄이 있습니다: {bad}")); return false; }
        let s = &mut self.bgm.shared;
        for u in lines.iter().filter(|u| !is_list(u)) { s.next_key += 1; s.queue.lock().unwrap().push(QItem { key: s.next_key, url: u.clone(), title: u.clone(), state: QState::Wait, pct: 0.0, msg: String::new(), existed: false }); }
        for u in lines.iter().filter(|u| is_list(u)) {
            s.next_key += 1;
            let key = s.next_key;
            s.queue.lock().unwrap().push(QItem { key, url: u.clone(), title: "재생목록 펼치는 중…".into(), state: QState::Busy, pct: 0.0, msg: String::new(), existed: false });
            let (q, u2, base) = (s.queue.clone(), u.clone(), key * 1000);
            std::thread::spawn(move || {
                let r = sermon_shorts::youtube::list_playlist(&u2, 50);
                let mut g = q.lock().unwrap();
                let Some(i) = g.iter().position(|x| x.key == key) else { return };
                match r {
                    Ok(items) => { g.remove(i); for (k, (url, title, _)) in items.into_iter().enumerate() { g.push(QItem { key: base + k as u64 + 1, title: if title.is_empty() { url.clone() } else { title }, url, state: QState::Wait, pct: 0.0, msg: String::new(), existed: false }); } }
                    Err(e) => { g[i].state = QState::Err; g[i].msg = e; }
                }
            });
        }
        self.mgr_run();
        true
    }

    pub(crate) fn bgm_mgr_ui(&mut self, ctx: &egui::Context) {
        use std::sync::atomic::Ordering;
        if self.bgm.shared.changed.swap(false, Ordering::SeqCst) { self.reload_custom(); }
        if self.bgm.shared.queue.lock().unwrap().iter().any(|x| x.state == QState::Wait) { self.mgr_run(); }
        let Some(mut m) = self.bgm.mgr.take() else { return };
        if let Some(rx) = &m.adding { if let Ok(r) = rx.try_recv() { m.adding = None; match r { Ok((t, _)) => { self.toast(format!("\"{}\"을(를) 보관함에 넣었습니다.", t.title)); self.reload_custom(); } Err(e) => self.toast(format!("넣지 못했습니다: {e}")) } } }
        let busy_q = self.bgm.shared.queue.lock().unwrap().iter().any(|x| matches!(x.state, QState::Wait | QState::Busy));
        if busy_q || m.adding.is_some() { ctx.request_repaint_after(std::time::Duration::from_millis(250)); }
        let moods: Vec<String> = std::iter::once("내 음악".to_string()).chain(bgm::catalog().moods.iter().cloned()).collect();
        let all = self.bgm.custom.clone();
        let q = m.q.to_lowercase();
        let list: Vec<Track> = all.iter().filter(|t| (m.mood == "전체" || t.mood == m.mood) && (q.is_empty() || format!("{} {}", t.title, t.artist).to_lowercase().contains(&q))).cloned().collect();
        let sel = self.bgm_cur().map(|b| b.id);
        let queue = self.bgm.shared.queue.lock().unwrap().clone();
        let (mut close, mut get, mut add_file, mut clear_q) = (false, false, false, false);
        let (mut play, mut use_id, mut reveal, mut del): (Option<String>, Option<String>, Option<String>, Option<String>) = (None, None, None, None);
        let (mut set_mood, mut rename_done, mut seek): (Option<(String, String)>, Option<(String, String)>, Option<(String, f64)>) = (None, None, None);
        let frame = egui::Frame::new().fill(style::PANEL).corner_radius(CornerRadius::same(24)).inner_margin(egui::Margin::ZERO);
        let mr = egui::Modal::new(egui::Id::unique("bgm-mgr")).frame(frame).show(ctx, |ui| {
            ui.set_width(820.0);
            let max_h = ctx.content_rect().height() * 0.9;
            egui::Frame::new().inner_margin(egui::Margin { left: 22, right: 22, top: 20, bottom: 10 }).show(ui, |ui| {
                ui.horizontal_top(|ui| {
                    ui.vertical(|ui| {
                        ui.set_width(820.0 - 44.0 - 40.0);
                        ui.label(RichText::new("배경음악 관리").size(18.0).family(style::bold()).color(style::TEXT));
                        ui.add_space(4.0);
                        ui.label(RichText::new("유튜브 주소나 내 파일로 음악을 받아 보관함에 모아 둡니다. 쇼츠의 배경음악으로 바로 쓸 수 있습니다.").size(12.5).color(style::TEXT2));
                        ui.horizontal(|ui| {
                            ui.add(icons::img("folder", 13.0, style::MUTED));
                            let tip = if m.info.2 { format!("Windows 보안(제어된 폴더 액세스)이 {} 쓰기를 막아 이 앱 데이터 폴더에 보관합니다. Windows 보안 → 바이러스 및 위협 방지 → 랜섬웨어 방지 → 제어된 폴더 액세스를 통해 앱 허용에 SermonShorts 를 추가하면 문서 폴더를 씁니다.", m.info.1.display()) } else { m.info.0.display().to_string() };
                            ui.label(RichText::new(m.info.0.to_string_lossy()).size(11.5).color(if m.info.2 { WARN } else { style::MUTED })).on_hover_text(tip);
                            if ui.link(RichText::new("폴더 열기").size(11.5).color(style::PRIMARY)).clicked() { sermon_shorts::open_folder(std::path::Path::new(&m.info.0)); }
                        });
                    });
                    if style::icon_btn(ui, "x", 18.0, style::MUTED, "닫기 (Esc)").clicked() { close = true; }
                });
            });
            // 받기
            egui::Frame::new().inner_margin(egui::Margin { left: 22, right: 22, top: 0, bottom: 6 }).show(ui, |ui| {
                ui.horizontal_top(|ui| {
                    let r = ui.add(egui::TextEdit::multiline(&mut m.urls).desired_rows(3).desired_width(ui.available_width() - 130.0).hint_text("유튜브 주소를 한 줄에 하나씩 붙여 넣으세요. 재생목록 주소도 됩니다(최대 50곡).\n예: https://youtu.be/xxxxxxxxxxx").font(egui::FontId::proportional(12.5)));
                    if r.has_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter) && i.modifiers.command) { get = true; }
                    ui.vertical(|ui| {
                        if sm_btn(ui, Some("download"), "받아서 저장", true).clicked() { get = true; }
                        ui.add_enabled_ui(m.adding.is_none(), |ui| { if sm_btn(ui, Some("upload"), "내 파일 추가", false).clicked() { add_file = true; } });
                    });
                });
                ui.add(egui::Label::new(RichText::new("유튜브 음악은 대부분 저작권이 있습니다. 저작권이 공개된 곡(퍼블릭 도메인·CC)이나 사용 허락을 받은 곡만 쇼츠에 쓰세요.").size(11.5).color(WARN)).wrap());
            });
            // 받기 목록
            if !queue.is_empty() {
                egui::Frame::new().outer_margin(egui::Margin { left: 22, right: 22, top: 0, bottom: 8 }).inner_margin(egui::Margin::symmetric(12, 8)).fill(style::PANEL2).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(12)).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    let left = queue.iter().filter(|x| matches!(x.state, QState::Wait | QState::Busy)).count();
                    ui.horizontal(|ui| {
                        ui.label(RichText::new("받기 목록").size(12.5).family(style::bold()));
                        ui.label(RichText::new(if left > 0 { format!("{left}곡 남음") } else { "모두 끝남".into() }).size(12.0).color(style::MUTED));
                        if left == 0 && ui.link(RichText::new("목록 지우기").size(12.0).color(style::PRIMARY)).clicked() { clear_q = true; }
                    });
                    egui::ScrollArea::vertical().id_salt("bm-queue").max_height(120.0).show(ui, |ui| {
                        for x in &queue {
                            ui.horizontal(|ui| {
                                let st = match x.state { QState::Wait => "대기".to_string(), QState::Busy => if x.pct > 0.0 { format!("{}%", x.pct.round() as i64) } else { "받는 중".into() }, QState::Done => if x.existed { "이미 있음".into() } else { "완료".into() }, QState::Err => "실패".into() };
                                let col = match x.state { QState::Done => style::OK, QState::Err => ERR, QState::Busy => style::PRIMARY, _ => style::MUTED };
                                ui.allocate_ui_with_layout(egui::vec2(64.0, 18.0), egui::Layout::left_to_right(egui::Align::Center), |ui| ui.label(RichText::new(st).size(11.5).family(style::semi()).color(col)));
                                ui.add(egui::Label::new(RichText::new(&x.title).size(12.0).color(style::TEXT2)).truncate());
                                if x.state == QState::Busy { let (r, _) = ui.allocate_exact_size(egui::vec2(80.0, 5.0), egui::Sense::hover()); ui.painter().rect_filled(r, CornerRadius::same(255), style::BORDER); ui.painter().rect_filled(egui::Rect::from_min_size(r.min, egui::vec2(r.width() * (x.pct.max(4.0) / 100.0) as f32, 5.0)), CornerRadius::same(255), style::PRIMARY); }
                                if x.state == QState::Err { ui.label(RichText::new(&x.msg).size(11.0).color(ERR)); }
                            });
                        }
                    });
                });
            }
            // 찾기·분위기
            egui::Frame::new().inner_margin(egui::Margin { left: 22, right: 22, top: 2, bottom: 8 }).show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.add(egui::TextEdit::singleline(&mut m.q).hint_text("제목·채널 검색").desired_width(240.0).font(egui::FontId::proportional(12.5)));
                    egui::ComboBox::from_id_salt("bm-mood").width(130.0).selected_text(RichText::new(&m.mood).size(12.5)).show_ui(ui, |ui| { for x in std::iter::once("전체".to_string()).chain(moods.iter().cloned()) { if ui.selectable_label(m.mood == x, &x).clicked() { m.mood = x; } } });
                    if !all.is_empty() { ui.label(RichText::new(format!("{} / {}곡", list.len(), all.len())).size(12.0).color(style::MUTED)); }
                });
            });
            // 목록
            let list_h = (max_h - 360.0).clamp(220.0, 520.0);
            egui::ScrollArea::vertical().id_salt("bm-list").max_height(list_h).min_scrolled_height(list_h).auto_shrink([false, false]).show(ui, |ui| {
                egui::Frame::new().inner_margin(egui::Margin { left: 14, right: 14, top: 0, bottom: 14 }).show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 6.0;
                    if all.is_empty() { ui.vertical_centered(|ui| { ui.add_space(24.0); ui.label(RichText::new("보관함이 비어 있습니다").size(14.0).family(style::bold()).color(style::TEXT2)); ui.label(style::muted("위에 유튜브 주소를 넣거나 내 파일을 추가하세요.")); ui.add_space(24.0); }); }
                    else if list.is_empty() { ui.vertical_centered(|ui| { ui.add_space(24.0); ui.label(style::muted("찾는 곡이 없습니다.")); ui.add_space(24.0); }); }
                    for t in &list {
                        let is_sel = sel.as_deref() == Some(t.id.as_str());
                        let (_, on) = self.listening(&t.id);
                        egui::Frame::new().fill(if is_sel { style::PRIMARY_SOFT } else { style::PANEL }).stroke(Stroke::new(1.0, if is_sel { Color32::from_rgb(0x3b, 0x82, 0xf6) } else { style::BORDER })).corner_radius(CornerRadius::same(14)).inner_margin(egui::Margin::symmetric(12, 10)).show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            ui.horizontal(|ui| {
                                let (r, resp) = ui.allocate_exact_size(egui::vec2(32.0, 32.0), egui::Sense::click());
                                ui.painter().circle(r.center(), 16.0, if on { style::PRIMARY } else { Color32::WHITE }, Stroke::new(1.0, if on { style::PRIMARY } else { style::BORDER_STRONG }));
                                icons::img(if on { "pause" } else { "play" }, 14.0, if on { Color32::WHITE } else if t.missing { style::FAINT } else { style::TEXT }).paint_at(ui, egui::Rect::from_center_size(r.center(), egui::vec2(14.0, 14.0)));
                                if resp.on_hover_text("미리 듣기").clicked() && !t.missing { play = Some(t.id.clone()); }
                                ui.vertical(|ui| {
                                    ui.set_width((ui.available_width() - 330.0).max(120.0));
                                    ui.spacing_mut().item_spacing.y = 1.0;
                                    let renaming = m.rename.as_ref().is_some_and(|(id, _, _)| *id == t.id);
                                    if renaming {
                                        let (_, buf, focus) = m.rename.as_mut().unwrap();
                                        let r = ui.add(egui::TextEdit::singleline(buf).char_limit(120).desired_width(f32::INFINITY).font(egui::FontId::proportional(13.0)));
                                        if *focus { r.request_focus(); *focus = false; }
                                        if ui.input(|i| i.key_pressed(egui::Key::Escape)) { m.rename = None; }
                                        else if r.lost_focus() { rename_done = Some((t.id.clone(), buf.clone())); }
                                    } else if ui.add(egui::Label::new(RichText::new(&t.title).size(13.0).family(style::bold()).color(style::TEXT)).truncate().sense(egui::Sense::click())).on_hover_text("눌러서 이름 바꾸기").clicked() { m.rename = Some((t.id.clone(), t.title.clone(), true)); }
                                    ui.horizontal(|ui| {
                                        ui.spacing_mut().item_spacing.x = 3.0;
                                        let meta = |s: String| RichText::new(s).size(11.5).color(style::MUTED);
                                        if !t.artist.is_empty() && t.artist != "유튜브" && t.artist != "내 파일" { ui.label(meta(format!("{} ·", t.artist))); }
                                        if t.kind == "youtube" { if ui.link(RichText::new("유튜브").size(11.5).color(style::PRIMARY)).clicked() { sermon_shorts::ytupload::open_url(&t.source); } } else { ui.label(meta("내 파일".into())); }
                                        ui.label(meta(format!("· {}", ko_date(t.added_at))));
                                        if t.missing { ui.label(RichText::new("· 파일 없음").size(11.5).family(style::bold()).color(ERR)); }
                                    });
                                });
                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                    ui.spacing_mut().item_spacing.x = 6.0;
                                    if style::icon_btn(ui, "trash-2", 14.0, style::MUTED, "보관함에서 지우기").clicked() { del = Some(t.id.clone()); }
                                    if style::icon_btn(ui, "folder-open", 14.0, style::MUTED, "폴더에서 보기").clicked() { reveal = Some(t.id.clone()); }
                                    ui.add_enabled_ui(!t.missing, |ui| { if sm_btn(ui, None, if is_sel { "쓰는 중" } else { "쓰기" }, !is_sel).clicked() { use_id = Some(t.id.clone()); } });
                                    let mut md = t.mood.clone();
                                    egui::ComboBox::from_id_salt(("bm-row-mood", &t.id)).width(110.0).selected_text(RichText::new(&md).size(12.0)).show_ui(ui, |ui| { for x in &moods { if ui.selectable_value(&mut md, x.clone(), x).clicked() { set_mood = Some((t.id.clone(), x.clone())); } } });
                                    ui.label(RichText::new(bgm::fmt(t.duration_sec)).size(12.0).color(style::TEXT2));
                                });
                            });
                            if let Some(l) = self.bgm.listen.as_ref().filter(|l| l.id == t.id && (l.loading || l.player.playing() || l.player.src_now() > 0.05)) {
                                let d2 = if l.player.probe.duration > 0.0 { l.player.probe.duration } else { t.duration_sec.max(1.0) };
                                if let Some(x) = seek_bar(ui, l.player.src_now(), d2, 44.0) { seek = Some((t.id.clone(), x)); }
                            }
                        });
                    }
                });
            });
        });
        if mr.backdrop_response.clicked() { close = true; }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) && m.rename.is_none() { close = true; }
        if close { self.stop_listen(); return; }
        if get { let text = m.urls.clone(); if self.mgr_add_urls(&text) { m.urls.clear(); } }
        if add_file {
            if let Some(src) = rfd::FileDialog::new().set_title("배경음악 파일 고르기").add_filter("음악 파일", &bgm::AUDIO_EXT).add_filter("모든 파일", &["*"]).pick_file() {
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::spawn(move || { let _ = tx.send(bgm::import_file(&src)); });
                m.adding = Some(rx);
            }
        }
        if clear_q { self.bgm.shared.queue.lock().unwrap().clear(); }
        if let Some((id, title)) = rename_done { m.rename = None; let title = title.trim().to_string(); if !title.is_empty() { if let Err(e) = bgm::update_custom(&id, Some(&title), None) { self.toast(format!("이름을 바꾸지 못했습니다: {e}")); } self.reload_custom(); } }
        if let Some((id, md)) = set_mood { if let Err(e) = bgm::update_custom(&id, None, Some(&md)) { self.toast(format!("바꾸지 못했습니다: {e}")); } self.reload_custom(); }
        if let Some(id) = reveal { match bgm::custom_track(&id).and_then(|t| t.file).filter(|f| f.exists()) { Some(f) => sermon_shorts::reveal_file(&f), None => sermon_shorts::open_folder(&bgm::library_dir()), } }
        if let Some(id) = del {
            if sel.as_deref() == Some(id.as_str()) { self.toast("지금 쓰는 음악은 지울 수 없습니다. 다른 음악으로 바꾼 뒤 지워 주세요."); }
            else {
                let title = self.bgm_track(&id).map(|t| t.title).unwrap_or(id.clone());
                let yes = std::env::var("SS_TEST_YES").is_ok() || crate::style::confirm("배경음악 관리", format!("\"{title}\"을(를) 보관함에서 지울까요? 보관함 폴더의 음악 파일도 함께 지워집니다."));
                if yes { if self.bgm.listen.as_ref().is_some_and(|l| l.id == id) { self.stop_listen(); } bgm::remove_custom(&id); self.reload_custom(); }
            }
        }
        if let Some(id) = play {
            let (loading, on) = self.listening(&id);
            if loading { self.stop_listen(); }
            else if let Some(l) = self.bgm.listen.as_mut().filter(|l| l.id == id) { if on { l.player.stop(); } else { l.player.play(); } }
            else if let Some(t) = self.bgm_track(&id) { self.listen_track(&t, 0.0, None); }
        }
        if let Some((id, x)) = seek {
            if let Some(l) = self.bgm.listen.as_mut().filter(|l| l.id == id && !l.loading) { l.player.seek(x); if !l.player.playing() { l.player.play(); } }
            else if let Some(t) = self.bgm_track(&id) { self.listen_track(&t, x, None); }
        }
        if let Some(id) = use_id { self.stop_listen(); self.use_bgm(&id); self.page = Page::Editor; return; }
        self.bgm.mgr = Some(m);
    }
}
