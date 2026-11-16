//! 설교 쇼츠 편집기 (Rust 판). 화면은 egui, 영상·소리 처리는 ffmpeg.
//! 화면 배치는 기존 Electron 판(만나로 밝은 디자인)과 같다: 왼쪽 남색 메뉴 줄, 위 메뉴 막대,
//! 가운데 세 칸(9:16 미리보기·디자인 탭 / 자막 편집·파형 / AI 편집 대화).
#![windows_subsystem = "windows"]

mod edit_ops;
mod fonts;
mod icons;
mod stage;
mod style;
mod ui_captions;
mod ui_chat;
mod ui_export;
mod ui_ai;
mod ui_audio;
mod ui_frame;
mod ui_keys;
mod ui_import;
mod ui_autosave;
mod ui_bgm;
mod ui_materials;
mod ui_settings;
mod ui_side;
mod ui_theme_editor;
mod ui_tests;
mod ui_tidy;
mod ui_trim;
mod ui_wave;

pub(crate) use eframe::egui::{self, Color32, CornerRadius, RichText, Stroke};
pub(crate) use serde_json::{json, Value};
pub(crate) use sermon_shorts::model::{Overrides, Word};
pub(crate) use sermon_shorts::{blocks, caption_edit, edl, export, peaks, player::Player, project::Project, template, textfx, theme};
pub(crate) use std::collections::{BTreeSet, HashMap};
pub(crate) use std::path::PathBuf;
pub(crate) use std::sync::mpsc::Receiver;
pub(crate) use std::sync::Arc;
pub(crate) use std::time::Instant;

#[derive(Default, Clone)]
struct Args { open: Option<PathBuf>, transcript: Option<PathBuf>, project: Option<PathBuf>, test: Option<String>, report: Option<PathBuf> }
fn args() -> Args {
    let mut a = Args::default();
    let v: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < v.len() {
        let next = v.get(i + 1).cloned();
        match v[i].as_str() {
            "--open" => { a.open = next.map(PathBuf::from); i += 1; }
            "--transcript" => { a.transcript = next.map(PathBuf::from); i += 1; }
            "--project" => { a.project = next.map(PathBuf::from); i += 1; }
            "--test" => { a.test = next; i += 1; }
            "--report" => { a.report = next.map(PathBuf::from); i += 1; }
            s if s.ends_with(".sshorts") => a.project = Some(PathBuf::from(s)),
            _ => {}
        }
        i += 1;
    }
    a
}

fn main() -> eframe::Result<()> {
    let a = args();
    let options = eframe::NativeOptions {
        viewport: { let vb = egui::ViewportBuilder::default().with_title("설교 쇼츠 편집기"); match image::open(sermon_shorts::assets_dir().join("images").join("app-icon.png")) { Ok(im) => { let im = im.to_rgba8(); let (w, h) = im.dimensions(); vb.with_icon(std::sync::Arc::new(egui::IconData { rgba: im.into_raw(), width: w, height: h })) } Err(_) => vb } }.with_inner_size([1600.0, 980.0]).with_min_inner_size([1180.0, 720.0]),
        ..Default::default()
    };
    eframe::run_native("SermonShortsRs", options, Box::new(move |cc| {
        fonts::install(&cc.egui_ctx);
        egui_extras::install_image_loaders(&cc.egui_ctx);
        style::apply(&cc.egui_ctx);
        let mut app = App::new(&cc.egui_ctx);
        if let Some(p) = &a.project { app.open_project(p.clone()); }
        if let Some(p) = &a.open { app.open_video(p.clone()); }
        if let Some(t) = &a.transcript { app.load_words(t.clone()); }
        app.test = a.test.clone().map(|name| TestRun { name, report: a.report.clone(), step: 0, t0: Instant::now(), log: vec![] });
        Ok(Box::new(app))
    }))
}

#[derive(Clone)]
/// 되돌리기 한 칸 (기존 pushHistory: 단어·미세 조정·순서·목소리·배경음악)
pub(crate) struct Snap { words: Vec<Word>, overrides: Overrides, order: Option<Vec<i64>>, voice: Option<Value>, bgm: Option<Value> }

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub(crate) enum Page { #[default] Editor, Materials, Music, Theme, Ai, Guide, Settings }

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum DesignTab { #[default] Design, Voice, Music }

pub(crate) const SPEAKER_CUSTOM: &str = "직접 입력";

pub(crate) struct TestRun { pub name: String, pub report: Option<PathBuf>, pub step: u32, pub t0: Instant, pub log: Vec<(f64, f64)> }

pub(crate) struct App {
    pub player: Player,
    pub project: Project,
    pub project_path: Option<PathBuf>,
    pub has_project: bool,
    pub edited: bool,
    // 계산해 둔 것 (편집할 때마다 다시)
    pub dirty: bool,
    pub segs: Vec<edl::Segment>,
    pub lines: Vec<edl::Line>,
    pub blocks: Vec<blocks::Block>,
    // 되돌리기
    pub history: Vec<Snap>,
    pub hist_at: usize,
    // 영상·파형
    pub tex: Option<egui::TextureHandle>,
    pub frame_no: u64,
    pub peaks: Option<Arc<peaks::Peaks>>,
    pub peaks_rx: Option<Receiver<anyhow::Result<peaks::Peaks>>>,
    pub wave: ui_wave::Wave,
    // 자막 칸
    pub cap_buf: HashMap<usize, String>,
    pub last_block: Option<usize>,
    pub focus_from: Option<usize>,
    /// 나누기·합치기 뒤 글 칸을 다시 고를 줄 (첫 조각, 커서 자리)
    pub focus_line: Option<(caption_edit::Anchor, usize)>,
    /// 체크한 단어 id (칸 체크·전체 선택)
    pub checked: BTreeSet<i64>,
    /// STT 원문 커서·고른 범위 (단어 번호)
    pub caret: usize,
    pub sel_anchor: Option<usize>,
    pub word_drag: bool,
    /// 고른 범위 (커서 자리 a..b, 기존 state.selection) · 시작점·끝점 (I·O)
    pub selection: Option<(usize, usize)>,
    pub mark_i: Option<usize>,
    pub mark_o: Option<usize>,
    /// 사용자가 커서를 옮겼으면 재생 중에도 커서가 따라가지 않는다 (기존 manualCaret)
    pub manual_caret: bool,
    pub was_playing: bool,
    pub raw_once: bool,
    pub caret_scroll: bool,
    /// 지난 화면에 그린 단어 자리 (윗줄·아랫줄 이동용)
    pub word_rects: Vec<(usize, egui::Rect)>,
    /// 지난 화면의 출력 자막 칸 자리 (칸 첫 단어 번호, 자리) — 시험용
    pub out_rects: Vec<(usize, egui::Rect)>,
    pub find: Option<ui_keys::FindBar>,
    /// 단어 수정 (단어 번호, 글, 처음 포커스)
    pub word_edit: Option<(usize, String, bool)>,
    pub help_open: bool,
    /// 재생 중 자막 목록 따라가기 (직접 스크롤하면 멈춤, [재생 위치로]나 다시 재생하면 켜짐)
    pub follow_play: bool,
    pub follow_snap: bool,
    pub list_rect: egui::Rect,
    /// 파형을 끄는 동안 멈춘 재생을 놓을 때 다시 (기존 app.js scrubResume)
    pub scrub_resume: bool,
    /// 시험용 가짜 입력 (한 화면에 한 묶음씩: 사건, 수식키)
    pub test_input: std::collections::VecDeque<(Vec<egui::Event>, egui::Modifiers)>,
    pub tidy: Option<ui_tidy::TidyJob>,
    /// 시작·끝 미세 조정 창
    pub trim: Option<ui_trim::Trim>,
    /// 들어 보기 범위 (출력 시각 from, to, 되풀이)
    pub trim_loop: Option<(f64, f64, bool)>,
    pub hide_deleted: bool,
    pub cap_settings_open: bool,
    pub last_still: Option<Instant>,
    pub source_name: String,
    pub toast: Option<(String, Instant)>,
    pub unsaved: bool,
    pub test: Option<TestRun>,
    pub test_words: String,
    // 화면
    pub page: Page,
    pub design_tab: DesignTab,
    pub chat_open: bool,
    /// [주소 넣기]·[새로]: 대화 칸의 주소 입력칸에 커서 (기존 SS.focusChat)
    pub focus_chat_url: bool,
    pub chat_input: String,
    pub yt_url: String,
    // 디자인 (테마·제목·설교자·교회)
    pub settings: Value,
    pub themes: Vec<theme::ThemeEntry>,
    pub theme: Value,
    pub theme_key: u64,
    pub project_theme: bool,
    pub title: String,
    pub verse: String,
    pub speaker_pick: String,
    pub speaker_custom: String,
    pub church: String,
    pub church_save_at: Option<Instant>,
    pub crop: export::Crop,
    pub crop_drag: Option<(egui::Pos2, export::Crop)>,
    pub stage: stage::Stage,
    // 옮기는 중인 기능들 (각 모듈의 상태)
    pub import: ui_import::State,
    pub audio: ui_audio::State,
    pub bgm: ui_bgm::State,
    pub ai: ui_ai::State,
    pub prefs: ui_settings::State,
    pub asv: ui_autosave::State,
    pub theme_ed: ui_theme_editor::State,
    pub materials: ui_materials::State,
    // 내보내기
    pub export: Option<ui_export::Job>,
    pub export_result: Option<Result<export::Done, String>>,
    pub export_error: Option<String>,
    pub export_view: Option<ui_export::ExportView>,
    pub bg_uploads: Vec<ui_export::ExportView>,
    pub uploaded: HashMap<PathBuf, sermon_shorts::ytupload::Uploaded>,
}

impl App {
    fn new(ctx: &egui::Context) -> App {
        let settings = theme::app_settings();
        let themes = theme::list_themes();
        let theme = theme::active_theme(&settings);
        let speakers: Vec<String> = settings["speakers"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
        let def = settings["defaultSpeaker"].as_str().map(String::from).filter(|s| !s.is_empty()).or_else(|| speakers.first().cloned());
        let church = settings["template"]["churchName"].as_str().unwrap_or("").to_string();
        let mut app = App {
            player: Player::default(), project: Project::default(), project_path: None, has_project: false, edited: false,
            dirty: false, segs: vec![], lines: vec![], blocks: vec![], history: vec![], hist_at: 0,
            tex: None, frame_no: 0, peaks: None, peaks_rx: None, wave: ui_wave::Wave::default(),
            cap_buf: HashMap::new(), last_block: None, focus_from: None, focus_line: None, checked: BTreeSet::new(), caret: 0, sel_anchor: None, word_drag: false, selection: None, mark_i: None, mark_o: None, manual_caret: false, was_playing: false, raw_once: false, caret_scroll: false, word_rects: vec![], out_rects: vec![], find: None, word_edit: None, help_open: false, follow_play: true, follow_snap: false, list_rect: egui::Rect::NOTHING, scrub_resume: false, test_input: Default::default(), tidy: None, trim: None, trim_loop: None, hide_deleted: false, cap_settings_open: false,
            last_still: None, source_name: String::new(), toast: None, unsaved: false, test: None, test_words: String::new(),
            page: Page::Editor, design_tab: DesignTab::Design, chat_open: true, focus_chat_url: false, chat_input: String::new(), yt_url: String::new(),
            settings, themes, theme, theme_key: 0, project_theme: false,
            title: String::new(), verse: String::new(),
            speaker_pick: def.clone().unwrap_or_else(|| SPEAKER_CUSTOM.into()), speaker_custom: if def.is_none() { String::new() } else { String::new() },
            church, church_save_at: None, crop: export::Crop::default(), crop_drag: None, stage: stage::Stage::new(ctx),
            import: Default::default(), audio: Default::default(), bgm: Default::default(), ai: Default::default(), prefs: Default::default(), asv: Default::default(), theme_ed: Default::default(), materials: Default::default(),
            export: None, export_result: None, export_error: None, export_view: None, bg_uploads: vec![], uploaded: HashMap::new(),
        };
        app.theme_changed();
        app
    }

    pub fn toast(&mut self, s: impl Into<String>) { self.toast = Some((s.into(), Instant::now())); }

    // ---------------- 열기·저장 ----------------
    pub fn open_video(&mut self, p: PathBuf) -> bool { self.open_video_with(p, json!({})) }
    /// opts: 원본 정보 { offset, url, title, fetch … } (기존 app.js openVideo: 다른 영상이면 이전 자막·편집을 비운다)
    pub fn open_video_with(&mut self, p: PathBuf, opts: Value) -> bool {
        match self.player.open(&p) {
            Ok(()) => {
                let (has_audio, dur) = (self.player.probe.has_audio, self.player.probe.duration);
                self.source_name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                if !has_audio { self.toast("이 영상에는 소리가 없습니다"); }
                if self.project.source_path != p && !self.project.words.is_empty() {
                    self.project.words.clear(); self.project.overrides.clear(); self.project.order = None;
                    self.hide_deleted = false; self.project_path = None;
                    self.history.clear(); self.hist_at = 0; self.push_undo();
                    self.has_project = false; self.checked.clear(); self.sel_anchor = None; self.caret = 0; self.selection = None; self.mark_i = None; self.mark_o = None; self.word_edit = None;
                    self.trim = None; self.trim_loop = None;
                }
                let pr = self.player.probe.clone();
                let mut src = opts.as_object().cloned().unwrap_or_default();
                src.insert("path".into(), json!(p.to_string_lossy()));
                src.insert("offset".into(), json!(opts["offset"].as_f64().unwrap_or(0.0)));
                for k in ["url", "title"] { let v = opts[k].clone(); src.insert(k.into(), if v.as_str().is_some_and(|s| !s.is_empty()) { v } else { Value::Null }); }
                src.insert("duration".into(), json!(pr.duration)); src.insert("fps".into(), json!(pr.fps)); src.insert("width".into(), json!(pr.width)); src.insert("height".into(), json!(pr.height));
                if !opts["fetch"].is_object() { src.remove("fetch"); }
                self.project.rest.insert("source".into(), Value::Object(src));
                self.project.source_path = p.clone();
                self.wave.reset(dur);
                self.peaks = None;
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::spawn(move || { let _ = tx.send(peaks::compute(&p)); });
                self.peaks_rx = Some(rx);
                self.dirty = true;
                true
            }
            Err(e) => { self.toast(format!("영상을 열 수 없습니다: {e}")); false }
        }
    }
    pub fn set_words(&mut self, words: Vec<Word>) {
        self.project.words = words;
        self.project.overrides.clear();
        self.project.order = None;
        self.history.clear(); self.hist_at = 0;
        self.push_undo();
        self.edited = true;
        self.dirty = true;
        self.has_project = !self.project.words.is_empty();
        self.checked.clear(); self.sel_anchor = None; self.caret = 0; self.selection = None; self.mark_i = None; self.mark_o = None; self.word_edit = None;
    }
    pub fn load_words(&mut self, p: PathBuf) {
        let r: anyhow::Result<Vec<Word>> = (|| {
            let v: Value = serde_json::from_slice(&std::fs::read(&p)?)?;
            let mut arr = if v.is_array() { v } else { v["words"].clone() };
            if let Some(a) = arr.as_array_mut() { for (i, w) in a.iter_mut().enumerate() { if w.is_object() { w["id"] = json!(i); } } }
            let mut w: Vec<Word> = serde_json::from_value(arr)?;
            for (i, x) in w.iter_mut().enumerate() { x.id = i as i64; if x.stt_text.is_none() { x.stt_text = Some(x.text.clone()); } }
            Ok(w)
        })();
        match r {
            Ok(w) => { let n = w.len(); self.set_words(w); self.toast(format!("자막 단어 {n}개를 불러왔습니다")); }
            Err(e) => self.toast(format!("자막을 불러오지 못했습니다: {e}")),
        }
    }
    /// 프로젝트 열기. 원본 영상이 없으면 유튜브에서 다시 받거나 직접 찾는다 (기존 source-recover.js ensureSource)
    pub fn open_project(&mut self, p: PathBuf) {
        let raw: Value = match std::fs::read_to_string(&p).map_err(anyhow::Error::from).and_then(|t| Ok(serde_json::from_str(&t)?)) {
            Ok(v) => v,
            Err(e) => { self.toast(format!("프로젝트 열기 실패: {e}")); return; }
        };
        self.open_project_from(Some(p), raw, ui_autosave::Origin::Project, false);
    }
    /// 프로젝트 데이터 열기 (프로젝트 파일·자동 저장본). force_download: 원본이 없으면 묻지 않고 다시 받기
    pub fn open_project_from(&mut self, p: Option<PathBuf>, raw: Value, origin: ui_autosave::Origin, force_download: bool) {
        let src = &raw["source"];
        let sp = src["path"].as_str().unwrap_or("").trim().to_string();
        let has_url = src["url"].as_str().is_some_and(|u| !u.trim().is_empty());
        if (!sp.is_empty() && !std::path::Path::new(&sp).exists()) || (sp.is_empty() && has_url) { self.start_recover(p, raw, origin, force_download); return; }
        self.open_project_value(p, raw, None, &origin);
    }
    /// recovered: 원본을 "downloaded" 다시 받았거나 "located" 찾았으면
    pub fn open_project_value(&mut self, p: Option<PathBuf>, raw: Value, recovered: Option<&str>, origin: &ui_autosave::Origin) {
        let fail = |a: &mut App, e: String| a.toast(match origin { ui_autosave::Origin::Project => format!("프로젝트 열기 실패: {e}"), _ => format!("열지 못했습니다: {e}") });
        match Project::from_json(raw) {
            Ok(pr) => {
                if !pr.source_path.exists() { fail(self, "프로젝트 원본 영상을 열 수 없습니다. 파일 위치를 확인해 주세요.".into()); return; }
                let src = pr.source_path.clone();
                let playhead = pr.playhead;
                self.project = pr;
                let opts = self.project.rest.get("source").cloned().unwrap_or(json!({}));
                if !self.open_video_with(src, opts) { fail(self, "프로젝트 원본 영상을 열 수 없습니다. 파일 위치를 확인해 주세요.".into()); return; }
                self.history.clear(); self.hist_at = 0; self.push_undo();
                self.edited = true;
                self.has_project = true;
                self.project_path = p.clone();
                self.hide_deleted = self.project.hide_deleted;
                self.checked.clear(); self.sel_anchor = None; self.caret = 0; self.selection = None; self.mark_i = None; self.mark_o = None; self.word_edit = None;
                self.trim = None; self.trim_loop = None;
                self.read_project_design();
                self.recompute();
                self.player.seek_src(playhead);
                let how = |d: &str, l: &str| if recovered == Some("downloaded") { d.to_string() } else { l.to_string() };
                match origin {
                    ui_autosave::Origin::Project => {
                        self.unsaved = recovered.is_some();
                        if recovered.is_some() { self.toast(format!("원본 영상을 {} 프로젝트를 열었습니다. 저장(Ctrl+S)하면 새 원본 위치가 프로젝트에 기록됩니다", how("다시 받아", "찾아"))); }
                        else { self.toast("프로젝트를 열었습니다"); }
                    }
                    ui_autosave::Origin::Autosave { file } => {
                        self.unsaved = true;
                        self.asv_mark_clean();
                        if recovered.is_some() { self.toast(format!("원본 영상을 {} 열었습니다. 편집은 그대로 이어서 할 수 있습니다", how("유튜브에서 다시 받아", "찾아"))); }
                        else if file == "current.sshorts" { self.toast(format!("자동 저장된 작업을 열었습니다{}", if p.is_some() { " (저장하면 원래 프로젝트 파일에 저장됩니다)" } else { "" })); }
                        else { self.toast("과거 작업본을 열었습니다. 지금부터 편집하면 이 상태에서 이어서 자동 저장됩니다"); }
                    }
                }
            }
            Err(e) => fail(self, e.to_string()),
        }
    }    /// 프로젝트의 meta·crop·activeTheme 를 화면 값으로 (기존 project.js showMeta·applyCrop)
    fn read_project_design(&mut self) {
        let meta = self.project.rest.get("meta").cloned().unwrap_or(Value::Null);
        self.title = meta["title"].as_str().unwrap_or("").to_string();
        self.verse = meta["verse"].as_str().unwrap_or("").to_string();
        let sp = meta["speaker"].as_str().unwrap_or("").to_string();
        if !sp.is_empty() {
            if self.speakers().contains(&sp) { self.speaker_pick = sp; } else { self.speaker_pick = SPEAKER_CUSTOM.into(); self.speaker_custom = sp; }
        }
        self.crop = self.project.rest.get("crop").map(export::Crop::from_value).unwrap_or_default();
        if let Some(t) = self.project.rest.get("activeTheme").filter(|t| t.is_object()).cloned() {
            let mut th = theme::normalize(Some(&t));
            if let Some(id) = t["id"].as_str() { th["id"] = json!(id); }
            if let Some(n) = t["name"].as_str() { th["name"] = json!(n); }
            self.project_theme = !self.themes.iter().any(|e| Some(e.id.as_str()) == t["id"].as_str());
            self.theme = th;
            self.theme_changed();
        }
    }
    /// 화면 값 → 프로젝트 (저장·자동 저장 전에)
    pub fn write_project_design(&mut self) {
        let sp = self.speaker();
        self.project.rest.insert("meta".into(), json!({ "title": self.title, "verse": self.verse, "speaker": sp }));
        self.project.rest.insert("crop".into(), json!({ "scale": self.crop.scale, "x": self.crop.x, "y": self.crop.y }));
        self.project.rest.insert("activeTheme".into(), self.theme.clone());
        self.project.hide_deleted = self.hide_deleted;
    }
    pub fn save_project(&mut self, as_new: bool) {
        if !self.has_project { self.toast("먼저 영상과 자막을 열어 주세요"); return; }
        let path = match (&self.project_path, as_new) {
            (Some(p), false) => Some(p.clone()),
            _ => {
                let name = format!("{}.sshorts", export::default_name(&self.title).trim_end_matches(".mp4"));
                let name = if name == "쇼츠.sshorts" { "프로젝트.sshorts".to_string() } else { name };
                rfd::FileDialog::new().set_title("프로젝트 저장").add_filter("설교 쇼츠 프로젝트", &["sshorts"]).set_file_name(name).save_file()
            }
        };
        let Some(path) = path else { return };
        self.project.playhead = self.player.src_now();
        self.write_project_design();
        match self.project.save(&path) {
            Ok(()) => { self.project_path = Some(path.clone()); self.unsaved = false; self.toast(format!("저장했습니다: {}", path.file_name().unwrap_or_default().to_string_lossy())); }
            Err(e) => self.toast(format!("저장하지 못했습니다: {e}")),
        }
    }

    // ---------------- 되돌리기 ----------------
    fn snap(&self) -> Snap { Snap { words: self.project.words.clone(), overrides: self.project.overrides.clone(), order: self.project.order.clone(), voice: self.project.rest.get("voice").cloned(), bgm: self.project.rest.get("bgm").cloned() } }
    pub fn push_undo(&mut self) {
        let s = self.snap();
        self.history.truncate(self.hist_at.min(self.history.len()));
        if let Some(last) = self.history.last() { if serde_json::to_string(&last.words).ok() == serde_json::to_string(&s.words).ok() && last.overrides == s.overrides && last.order == s.order && last.voice == s.voice && last.bgm == s.bgm { return; } }
        self.history.push(s);
        self.hist_at = self.history.len();
    }
    /// 편집 하나: 바꾸기 전 상태는 이미 기록돼 있고, 바꾼 뒤를 기록한다
    pub fn commit(&mut self) { self.push_undo(); self.dirty = true; self.unsaved = true; }
    fn restore(&mut self, k: usize) {
        let s = self.history[k].clone();
        self.project.words = s.words; self.project.overrides = s.overrides; self.project.order = s.order;
        for (k, v) in [("voice", s.voice), ("bgm", s.bgm)] { match v { Some(v) => { self.project.rest.insert(k.into(), v); } None => { self.project.rest.remove(k); } } }
        self.hist_at = k + 1; self.dirty = true; self.unsaved = true; self.cap_buf.clear();
    }
    pub fn undo(&mut self) { if self.hist_at >= 2 { self.restore(self.hist_at - 2); } }
    pub fn redo(&mut self) { if self.hist_at < self.history.len() { self.restore(self.hist_at); } }

    // ---------------- 계산 ----------------
    pub fn max_chars(&self) -> usize { self.project.settings.max_line_chars.unwrap_or(14.0).max(1.0) as usize }
    pub fn recompute(&mut self) {
        let p = &self.project;
        self.segs = edl::build_segments(&p.words, &p.settings, &p.overrides, Some(self.player.probe.duration), p.order.as_deref());
        self.lines = edl::build_lines(&p.words, &self.segs, &p.settings);
        self.blocks = blocks::build(&p.words, &self.lines, self.max_chars());
        let ranges: Vec<(f64, f64)> = if self.edited && !self.segs.is_empty() { self.segs.iter().map(|s| (s.start, s.end)).collect() } else { vec![(0.0, self.player.probe.duration)] };
        if self.player.path.is_some() && self.player.probe.duration > 0.0 { self.player.set_ranges(&ranges); }
        self.dirty = false;
    }
    pub fn toggle_words(&mut self, from: usize, to: usize, del: bool) {
        for w in &mut self.project.words[from..to] { w.del = del; }
        self.commit();
    }

    // ---------------- 디자인 값 ----------------
    pub fn speakers(&self) -> Vec<String> { self.settings["speakers"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default() }
    pub fn speaker(&self) -> String { if self.speaker_pick == SPEAKER_CUSTOM { self.speaker_custom.trim().to_string() } else { self.speaker_pick.clone() } }
    /// 테마가 바뀌면 (고르기·눈 단추·프로젝트 열기) 그림 기억을 새로
    pub fn theme_changed(&mut self) {
        self.theme_key = stage::hkey(&self.theme.to_string());
        self.stage.clear_subs();
    }
    pub fn pick_theme(&mut self, id: &str) {
        let Some(e) = self.themes.iter().find(|e| e.id == id) else { return };
        let mut t = theme::normalize(Some(&e.json));
        t["id"] = json!(e.id); t["name"] = json!(e.name);
        self.theme = t;
        self.project_theme = false;
        self.theme_changed();
        let _ = theme::save_settings(&json!({ "activeThemeId": id }));
        self.settings["activeThemeId"] = json!(id);
        if self.has_project { self.unsaved = true; }
    }
    /// 미리보기·내보내기에 쓸 로고: 테마 로고 → 교회 설정 로고 → 기본 로고
    pub fn logo_path(&self) -> String {
        let t = self.theme["logo"]["path"].as_str().unwrap_or("");
        let crest = regex::Regex::new(r"(?i)^assets[\\/]images[\\/](sa-)?crest\.png$").unwrap();
        if !t.is_empty() && !crest.is_match(t) { return t.to_string(); }
        let s = self.settings["template"]["logoPath"].as_str().unwrap_or("");
        if !s.is_empty() && !crest.is_match(s) { return s.to_string(); }
        String::new()
    }
    /// 그리기 값 (자막은 따로)
    pub fn draw_params(&self) -> template::OwnedParams {
        let mut th = self.theme.clone();
        th["logo"]["path"] = json!(self.logo_path());
        let logo = template::theme_logo(&th);
        let church = if self.church.trim().is_empty() { String::new() } else { self.church.trim().to_string() };
        template::OwnedParams { title: self.title.clone(), verse: self.verse.clone(), speaker: self.speaker(), church_name: church, theme: th, logo, ..Default::default() }
    }

    /// 출력 시각 → 그 시각 자막 (가라오케면 강조 단어까지)
    pub fn caption_at(&self, out_t: Option<f64>) -> Option<(String, Option<Vec<String>>, Option<i64>)> {
        let out = out_t?;
        let line = self.lines.iter().find(|l| out >= l.out_start && out < l.out_end)?;
        if template::uses_karaoke(&self.theme) {
            let k = textfx::karaoke_of(line, &self.project.words, &self.segs);
            let idx = textfx::karaoke_index_at(&k.frames, out);
            Some((line.text.clone(), Some(k.groups), Some(idx)))
        } else { Some((line.text.clone(), None, None)) }
    }
}

impl eframe::App for App {
    /// 시험: 마우스·키 입력을 실제 입력처럼 넣는다
    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        if let Some((ev, mods)) = self.test_input.pop_front() { raw.events.push(egui::Event::ModifiersChanged(mods)); raw.events.extend(ev); }
    }
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        // 파형 계산 끝?
        if let Some(rx) = &self.peaks_rx { if let Ok(r) = rx.try_recv() { self.peaks_rx = None; match r { Ok(p) => self.peaks = Some(Arc::new(p)), Err(e) => self.toast(format!("파형을 계산하지 못했습니다: {e}")) } } }
        if self.dirty { self.recompute(); }
        if self.player.tick() {
            if let Some(f) = &self.player.frame {
                let img = egui::ColorImage::from_rgba_unmultiplied([f.w, f.h], &f.rgba);
                match &mut self.tex { Some(t) => t.set(img, stage::tex_options()), None => self.tex = Some(ctx.load_texture("video", img, stage::tex_options())) }
                self.frame_no += 1;
                if let Some(t) = &mut self.test { if self.player.playing() { t.log.push((t.t0.elapsed().as_secs_f64(), f.out_t)); } }
            }
        }
        self.stage.poll(&ctx);
        self.poll_export();
        self.poll_bg_uploads();
        self.poll_tidy();
        self.run_test(&ctx);
        self.tick_trim_loop();
        let modal = self.dialog_open();
        self.caret_follow();
        if self.page == Page::Editor && !modal { self.trim_keys(&ctx); }
        // 편집 단축키를 먼저 (Shift+Space 처럼 겹치는 키를 가져간다), 그다음 전역 단축키
        if self.page == Page::Editor && !modal { self.editor_keys(&ctx); }
        if !modal { self.shortcuts(&ctx); }
        self.flush_church();

        egui::Panel::left("rail").exact_size(88.0).resizable(false).frame(egui::Frame::new().fill(style::NAVY)).show(ui, |ui| self.rail(ui));
        egui::Panel::top("top").exact_size(64.0).resizable(false)
            .frame(egui::Frame::new().fill(style::PANEL).inner_margin(egui::Margin::symmetric(22, 0)).stroke(Stroke::new(1.0, style::BORDER)))
            .show(ui, |ui| self.top_bar(ui));
        egui::CentralPanel::default().frame(egui::Frame::new().fill(style::BG).inner_margin(egui::Margin::same(18))).show(ui, |ui| {
            match self.page {
                Page::Editor => self.editor(ui),
                Page::Materials => self.materials_page(ui),
                Page::Music => self.music_page(ui),
                Page::Theme => self.theme_page(ui),
                Page::Ai => self.ai_page(ui),
                Page::Settings => self.settings_page(ui),
                p => self.placeholder(ui, p),
            }
        });
        self.export_window(&ctx);
        self.import_ui(&ctx);
        self.audio_ui(&ctx);
        self.bgm_tick(&ctx);
        self.ai_ui(&ctx);
        self.settings_ui(&ctx);
        self.shortcuts_ui(&ctx);
        self.autosave_ui(&ctx);
        self.theme_editor_ui(&ctx);
        self.materials_ui(&ctx);
        if let Some((msg, at)) = &self.toast {
            if at.elapsed().as_secs_f32() < 4.5 {
                egui::Area::new(egui::Id::unique("toast")).anchor(egui::Align2::CENTER_BOTTOM, [0.0, -40.0]).show(&ctx, |ui| {
                    egui::Frame::new().fill(style::NAVY).corner_radius(CornerRadius::same(12)).inner_margin(egui::Margin::symmetric(18, 12)).show(ui, |ui| {
                        // 글 길이에 맞춘 폭 (최대 860, 넘으면 줄바꿈)
                        let w = ui.painter().layout_no_wrap(msg.clone(), egui::FontId::proportional(14.0), Color32::WHITE).size().x.min(860.0);
                        ui.set_width(w);
                        ui.add(egui::Label::new(RichText::new(msg).color(Color32::WHITE).size(14.0)).wrap());
                    });
                });
                ctx.request_repaint_after(std::time::Duration::from_millis(200));
            } else { self.toast = None; }
        }
        if self.player.playing() || self.test.is_some() || self.peaks_rx.is_some() || self.wave.scrubbing || self.export.is_some() || !self.bg_uploads.is_empty() || self.church_save_at.is_some() || self.tidy.is_some() || self.word_drag || self.trim.as_ref().is_some_and(|t| t.pcm.is_none() || t.dragging) { ctx.request_repaint(); }
    }
}

impl App {
    /// 세 칸 편집 화면
    pub(crate) fn editor(&mut self, ui: &mut egui::Ui) {
        let avail = ui.available_rect_before_wrap();
        let gap = 18.0;
        let left_w = (avail.width() * 0.29).clamp(360.0, 540.0);
        let right_w = if self.chat_open { (avail.width() * 0.24).clamp(300.0, 470.0) } else { 0.0 };
        let center_w = avail.width() - left_w - right_w - gap * if self.chat_open { 2.0 } else { 1.0 };
        let h = avail.height();
        let r_left = egui::Rect::from_min_size(avail.min, egui::vec2(left_w, h));
        let r_center = egui::Rect::from_min_size(avail.min + egui::vec2(left_w + gap, 0.0), egui::vec2(center_w, h));
        let r_right = egui::Rect::from_min_size(avail.min + egui::vec2(left_w + gap + center_w + gap, 0.0), egui::vec2(right_w, h));
        ui.scope_builder(egui::UiBuilder::new().max_rect(r_left), |ui| self.left_column(ui));
        ui.scope_builder(egui::UiBuilder::new().max_rect(r_center), |ui| self.center_column(ui));
        if self.chat_open { ui.scope_builder(egui::UiBuilder::new().max_rect(r_right), |ui| self.right_column(ui)); }
        ui.allocate_rect(avail, egui::Sense::hover());
    }

    /// 아직 Rust 판에 옮기지 않은 화면
    pub(crate) fn placeholder(&mut self, ui: &mut egui::Ui, p: Page) {
        let name = match p { Page::Materials => "교인 자료", Page::Music => "배경음악", Page::Theme => "테마", Page::Ai => "AI 연결", Page::Guide => "사용 설명서", Page::Settings => "설정", Page::Editor => "쇼츠 편집" };
        style::card().show(ui, |ui| {
            ui.set_min_size(ui.available_size());
            ui.vertical_centered(|ui| {
                ui.add_space(ui.available_height() * 0.35);
                ui.label(RichText::new(name).size(24.0).family(style::bold()).color(style::TEXT));
                ui.add_space(8.0);
                ui.label(style::muted("Rust 판으로 옮기는 중입니다. 지금은 Electron 판에서 쓸 수 있습니다."));
                ui.add_space(14.0);
                if style::primary(ui, Some("clapperboard"), "쇼츠 편집으로 돌아가기").clicked() { self.page = Page::Editor; }
            });
        });
    }

    /// 단축키 (글자 칸에 쓰는 중이 아닐 때)
    fn shortcuts(&mut self, ctx: &egui::Context) {
        let typing = ctx.egui_wants_keyboard_input();
        let (sp, z, y, s, ss, e, o, so, h, u) = ctx.input(|i| {
            let c = i.modifiers.command;
            (i.key_pressed(egui::Key::Space), c && i.key_pressed(egui::Key::Z) && !i.modifiers.shift, c && (i.key_pressed(egui::Key::Y) || (i.modifiers.shift && i.key_pressed(egui::Key::Z))),
             c && !i.modifiers.shift && i.key_pressed(egui::Key::S), c && i.modifiers.shift && i.key_pressed(egui::Key::S), c && i.key_pressed(egui::Key::E),
             c && !i.modifiers.shift && i.key_pressed(egui::Key::O), c && i.modifiers.shift && i.key_pressed(egui::Key::O), !c && i.key_pressed(egui::Key::H), c && i.key_pressed(egui::Key::U) && !i.modifiers.shift)
        });
        if s { self.save_project(false); }
        if ss { self.save_project(true); }
        if e { self.start_export(); }
        if o { self.cmd_open_project(); }
        if so { self.cmd_open_video(); }
        if u { self.cmd_youtube(); }
        if typing { return; }
        if sp && self.player.path.is_some() { self.player.toggle(); }
        if z { self.undo(); }
        if y { self.redo(); }
        if h { self.hide_deleted = !self.hide_deleted; }
    }

    pub fn cmd_open_video(&mut self) {
        if let Some(p) = rfd::FileDialog::new().set_title("영상 파일 열기").add_filter("영상", &["mp4", "mov", "mkv", "webm", "m4v", "avi"]).pick_file() {
            self.open_video(p);
            // 같은 이름의 자막 JSON 이 옆에 있으면 함께
        }
    }
    pub fn cmd_open_project(&mut self) {
        if let Some(p) = rfd::FileDialog::new().set_title("프로젝트 열기").add_filter("설교 쇼츠 프로젝트", &["sshorts"]).pick_file() { self.open_project(p); }
    }
    pub fn cmd_load_words(&mut self) {
        if let Some(p) = rfd::FileDialog::new().set_title("자막 단어 불러오기 (음성 인식 결과 JSON)").add_filter("JSON", &["json"]).pick_file() { self.load_words(p); }
    }

    /// 교회 이름은 입력이 멈추고 0.5초 뒤 설정에 저장 (기존 church-ui.js)
    fn flush_church(&mut self) {
        if let Some(t) = self.church_save_at { if t.elapsed().as_millis() >= 500 {
            self.church_save_at = None;
            let name = if self.church.trim().is_empty() { "우리 교회".to_string() } else { self.church.trim().to_string() };
            match theme::save_settings(&json!({ "template": { "churchName": name } })) { Ok(s) => self.settings = s, Err(e) => self.toast(format!("교회 이름 저장 실패: {e}")) }
        } }
    }
}
