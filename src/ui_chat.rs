//! 오른쪽 칸: AI 편집 대화 (기존 chat-ui.js). 유튜브 주소 → 자막(없으면 위스퍼) → AI 에게 말로 부탁 → 편집기에 반영.
//! 편집 조건 버튼, 구간 추천 카드, 진행 카드(멈추기), [새로](편집 자동 저장·다시 열기), 대화 기록(다시 켜도 남음).
use crate::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sermon_shorts::chat::{self, Loaded, Reply, Shared};
use sermon_shorts::chat_plan::{self as cp, Range};
use sermon_shorts::source_fetch::{Piece, Span};
use sermon_shorts::youtube as yt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// 굵은 글씨가 섞인 한 문단 (기존 <p><b>1.</b> … <b>AI 연결</b> …</p>)
fn rich_par(ui: &mut egui::Ui, parts: &[(&str, bool)]) {
    let mut job = egui::text::LayoutJob::default();
    for (t, b) in parts {
        let fam = if *b { style::bold() } else { egui::FontFamily::Proportional };
        job.append(t, 0.0, egui::TextFormat { font_id: egui::FontId::new(13.5, fam), color: style::TEXT2, line_height: Some(21.0), ..Default::default() });
    }
    job.wrap.max_width = ui.available_width();
    job.wrap.break_anywhere = true;
    ui.label(job);
}

// ---------------------------------------------------------------- 자료

/// 후보 카드에 남겨 둘 것 (지난 기록에서 다시 누를 때 쓴다)
#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct CandData { pub no: usize, pub from: usize, pub to: usize, pub title: String, #[serde(default)] pub summary: String, #[serde(default)] pub why: String, pub start: f64, pub end: f64, pub dur: f64, #[serde(default)] pub excerpt: String }

/// 편집 반영 정보 ([이 편집 다시 적용]: AI 없이 같은 구간·자막 교정·제목으로 바로 되돌린다)
#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct ApplyPlan { pub url: String, pub vtitle: String, pub ranges: Vec<(usize, usize)>, #[serde(default)] pub corrections: Vec<(usize, String)>, #[serde(default)] pub tighten: String, #[serde(default)] pub title: String, #[serde(default)] pub verse: String, #[serde(default)] pub duration_sec: f64 }

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "k")]
pub enum M {
    User { t: String },
    Ai { t: String, #[serde(default)] meta: String },
    Err { t: String },
    Sys { t: String },
    /// [AI 연결] 열기
    Fix,
    Cand { c: CandData, url: String, vtitle: String },
    CandNote,
    Divider { t: String, #[serde(default)] reopen: Option<String>, #[serde(default)] mark: bool },
    Replay { t: String, plan: ApplyPlan },
    UseEditor { t: String },
    Fit { t: String, target: f64 },
}

#[derive(Clone, Debug, Default)]
pub(crate) struct VideoUi { pub url: String, pub title: String, pub words: usize, pub edited: bool, pub from_editor: bool }
#[derive(Clone, Debug)]
struct LastFetch { url: String, path: PathBuf, map: Vec<Piece> }

#[derive(Clone, Copy, PartialEq, Debug)]
enum Hint { Load, Whisper, Send, Clips, Gaps }

/// 진행 카드 (기존 progressCard): 단계·지난 시간·안내·멈추기
pub(crate) struct Card { pub title: String, steps: Vec<(String, String)>, on: Option<usize>, subs: Vec<String>, pct: Option<f64>, t0: Instant, hint: Hint, stoppable: bool, pub stopping: bool, last_sig: Instant, last_stage: String }
impl Card {
    fn new(title: &str, steps: &[(&str, String)], hint: Hint, stoppable: bool) -> Card {
        Card { title: title.into(), steps: steps.iter().map(|(k, l)| (k.to_string(), l.clone())).collect(), on: None, subs: vec![String::new(); steps.len()], pct: None, t0: Instant::now(), hint, stoppable, stopping: false, last_sig: Instant::now(), last_stage: "prepare".into() }
    }
    fn step(&mut self, k: &str, title: Option<String>, sub: Option<String>) {
        if self.stopping { return; }
        let Some(i) = self.steps.iter().position(|s| s.0 == k) else { return };
        self.on = Some(i);
        if let Some(t) = title { self.title = t; }
        if let Some(s) = sub { self.subs[i] = s; }
    }
    fn sub(&mut self, k: &str, t: &str) { if let Some(i) = self.steps.iter().position(|s| s.0 == k) { self.subs[i] = t.into(); } }
    fn secs(&self) -> u64 { self.t0.elapsed().as_secs() }
}

/// 다른 스레드가 알려 주는 진행
#[derive(Default, Clone)]
struct Prog { stage: String, pct: Option<f64>, n: u64 }

enum Out { Load(Result<Loaded, String>), Whisper(Result<Loaded, String>), Send(Result<Reply, String>), Clips(Result<yt::Clips, String>), Gaps(Result<sermon_shorts::tidy::GapPlan, String>) }

/// 다음에 할 일 (영상 받기·공백 찾기가 끝난 뒤)
enum Next { None, Apply { plan: ApplyPlan, replay: bool, first: bool }, Finish { plan: ApplyPlan, replay: bool, first: bool }, GapsNow }

struct Job { rx: Receiver<Out>, cancel: Arc<AtomicBool>, prog: Arc<Mutex<Prog>>, seen: u64, card: Card, next: Next }

/// 불러온 뒤 이어서 할 일 (지난 기록의 [이 구간으로 만들기]·[이 편집 다시 적용])
enum After { Pick(CandData), Replay(ApplyPlan) }

pub(crate) struct ChatState {
    pub shared: Shared,
    pub msgs: Vec<M>,
    /// msgs[..archived] 는 지난 대화 (다시 할 수 있는 단추만 살아 있다)
    pub archived: usize,
    pub video: Option<VideoUi>,
    last_video: Option<VideoUi>,
    pub url: String,
    pub prefs: Value,
    pub cond_open: bool,
    last_ranges: Option<Vec<Range>>,
    last_fetch: Option<LastFetch>,
    job: Option<Job>,
    after: Option<After>,
    loaded_log: bool,
    log_dirty: Option<Instant>,
    focus_text: bool,
    pub rects: Vec<(String, egui::Rect)>,
    quick_h: f32,
    /// 고른 다듬기 (여러 개 고른 뒤 [한번에 적용])
    pub picked: Vec<String>,
    scroll_cands: bool,
    flash: Option<Instant>,
}
impl Default for ChatState {
    fn default() -> Self {
        ChatState { shared: Arc::new(Mutex::new(None)), msgs: vec![], archived: 0, video: None, last_video: None, url: String::new(), prefs: load_prefs(), cond_open: true,
            last_ranges: None, last_fetch: None, job: None, after: None, loaded_log: false, log_dirty: None, focus_text: false, rects: vec![], quick_h: 0.0, picked: vec![], scroll_cands: false, flash: None }
    }
}

// ---------------------------------------------------------------- 편집 조건·기록 저장

fn default_prefs() -> Value { json!({ "length": 120, "tight": true, "filler": true, "questions": true, "notices": true, "gaps": true, "ending": true, "contents": [], "audience": "all", "intensity": 0, "count": 3 }) }
fn prefs_file() -> PathBuf { sermon_shorts::theme::user_data_dir().join("chat_prefs.json") }
fn load_prefs() -> Value {
    let mut p = default_prefs();
    if let Ok(t) = std::fs::read_to_string(prefs_file()) { if let Ok(Value::Object(o)) = serde_json::from_str::<Value>(&t) { for (k, v) in o { p[k] = v; } } }
    p
}
fn log_file() -> PathBuf { sermon_shorts::theme::user_data_dir().join("chat_log.json") }
const TIPS: [(&str, &str); 6] = [
    ("tight", "되풀이하는 말, 늘어지는 예화·설명을 빼고 핵심만 힘 있게"), ("filler", "\"그…\", \"어…\" 말 끄는 소리와 더듬기, 같은 말 반복 빼기"),
    ("questions", "회중에게 묻는 말과 그 대답 빼기"), ("notices", "\"마무리하겠습니다\" 같은 예배 진행 안내 빼기"),
    ("gaps", "말 사이 조용한 부분을 실제 소리로 찾아 자동으로 줄이기"), ("ending", "마지막을 결론이나 축복의 말로 끝내기"),
];
const INTENSITIES: [(i64, &str); 6] = [(0, "상관없음"), (1, "1 잔잔"), (2, "2"), (3, "3"), (4, "4"), (5, "5 강하게")];

fn clock(s: f64) -> String { let s = s.max(0.0).floor() as i64; let (h, m, x) = (s / 3600, (s % 3600) / 60, s % 60); if h > 0 { format!("{h}:{m:02}:{x:02}") } else { format!("{m}:{x:02}") } }
fn clock_of(s: u64) -> String { format!("{}:{:02}", s / 60, s % 60) }
/// 받침 있으면 '이', 없으면 '가'
fn iga(w: &str) -> &'static str { let c = w.chars().last().map(|c| c as u32).unwrap_or(0); if (0xac00..=0xd7a3).contains(&c) && (c - 0xac00) % 28 != 0 { "이" } else { "가" } }
fn yt_id(u: &str) -> Option<String> { yt::video_id_of(u) }
fn yes(title: &str, text: &str) -> bool {
    std::env::var("SS_TEST_YES").is_ok() || crate::style::confirm(title, text)
}
fn same_ranges(a: &Option<Vec<Range>>, b: &[Range]) -> bool { a.as_ref().is_some_and(|a| a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x == y)) }
fn src_to_file(map: &[Piece], t: f64) -> Option<f64> { map.iter().find(|m| t >= m.src0 - 0.001 && t <= m.src1 + 0.001).map(|m| m.file0 + (t - m.src0)) }

/// 기다리는 동안 안내 글 (기존 aiHint). 이 판의 AI 는 답을 다 쓴 뒤 한 번에 보낸다
fn ai_hint(s: u64) -> (&'static str, bool) {
    if s >= 300 { return ("많이 늦어지고 있어요. 조금 더 기다리거나 [멈추기]를 누른 뒤 다시 보내 보세요. (6분이 지나면 저절로 멈춥니다)", true); }
    if s < 20 { return ("설교 전체를 읽고 고르느라 보통 1~3분 걸립니다. 문제가 생기면 바로 알려 드려요.", false); }
    if s < 180 { return ("이 AI 는 답을 다 쓴 뒤 한 번에 보내서 중간 진행이 안 보입니다. 오류가 나면 바로 알려 드려요.", false); }
    ("조금 오래 걸리고 있어요. AI 가 붐비면 3~4분 걸리기도 합니다. 계속 그대로면 [멈추기]를 누른 뒤 다시 보내 보세요.", true)
}
fn hint_of(c: &Card) -> (&'static str, bool) {
    let s = c.secs();
    match c.hint {
        Hint::Send => ai_hint(s),
        Hint::Load => if s < 20 { ("보통 5~20초 걸립니다.", false) } else { ("유튜브 응답이 늦어지고 있어요. 조금만 더 기다려 주세요.", true) },
        Hint::Whisper => if s < 60 { ("영상이 길면 시간이 걸립니다. 다른 일을 하셔도 됩니다.", false) } else { ("아직 만드는 중입니다. 끝나면 이 대화에 알려 드립니다.", false) },
        Hint::Clips => if s < 30 { ("받을 영상이 길면 조금 걸립니다.", false) } else { ("영상을 받고 있어요. 인터넷이 느리면 1~2분 걸리기도 합니다.", false) },
        Hint::Gaps => ("영상 소리를 살펴봅니다. 보통 몇 초면 끝납니다.", false),
    }
}

/// 화면에서 누른 것
enum Act { Load(String), Send(String, Option<String>), Do(String, Value), Pick(CandData, String, String), Yt(String), Reopen(String), Replay(ApplyPlan), UseEditor, Fit(f64), Fix, Stop, New, Clear, Fold, Export, Len(u32), Tog(&'static str), Content(&'static str), Aud(&'static str), Int(i64), Count(u32), CondFold, PickTrim(String), ApplyPicked, ClearPicked }
/// 여러 개 골라 [한번에 적용]하는 다듬기 (적용 순서)
const PICKABLE: [&str; 9] = ["tight", "filler", "questions", "notices", "shorter", "longer", "ending", "title", "typos"];

// ---------------------------------------------------------------- 그리기 도구

fn cq_btn(ui: &mut egui::Ui, text: &str, on: bool, primary: bool, act: bool, enabled: bool) -> egui::Response {
    let (fill, stroke, col) = if primary { (style::PRIMARY, style::PRIMARY, Color32::WHITE) } else if on { (style::PRIMARY_SOFT, Color32::from_rgb(0x93, 0xb4, 0xf5), Color32::from_rgb(0x1d, 0x4e, 0xd8)) } else { (Color32::WHITE, style::BORDER_STRONG, style::TEXT2) };
    let fam = if primary { style::bold() } else { style::semi() };
    ui.add_enabled(enabled, egui::Button::new(RichText::new(text).size(12.0).family(fam).color(col)).fill(fill).stroke(Stroke::new(1.0, stroke)).corner_radius(CornerRadius::same(if act { 10 } else { 255 })).min_size(egui::vec2(0.0, 26.0)))
}

/// 말풍선. kind 0 = 내 말, 1 = AI, 2 = 오류
fn bubble(ui: &mut egui::Ui, text: &str, meta: &str, kind: u8) {
    let full = ui.available_width();
    let maxw = (full * 0.92 - 28.0).max(60.0);
    let col = match kind { 0 => Color32::WHITE, 2 => Color32::from_rgb(0xb9, 0x1c, 0x1c), _ => style::TEXT };
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = maxw;
    job.append(text, 0.0, egui::TextFormat { font_id: egui::FontId::proportional(13.5), color: col, line_height: Some(21.6), ..Default::default() });
    if !meta.is_empty() { job.append(&format!("\n{meta}"), 0.0, egui::TextFormat { font_id: egui::FontId::proportional(11.5), color: if kind == 0 { Color32::from_rgba_unmultiplied(255, 255, 255, 200) } else { style::MUTED }, line_height: Some(24.0), ..Default::default() }); }
    let g = ui.painter().layout_job(job);
    let size = g.size() + egui::vec2(28.0, 20.0);
    let (rect, _) = ui.allocate_exact_size(egui::vec2(full, size.y), egui::Sense::hover());
    let x0 = if kind == 0 { rect.right() - size.x } else { rect.left() };
    let b = egui::Rect::from_min_size(egui::pos2(x0, rect.top()), size);
    let (fill, stroke, cr) = match kind {
        0 => (style::PRIMARY, Stroke::NONE, CornerRadius { nw: 16, ne: 16, sw: 16, se: 5 }),
        2 => (Color32::from_rgb(0xfe, 0xf2, 0xf2), Stroke::new(1.0, Color32::from_rgb(0xf5, 0xc2, 0xc2)), CornerRadius { nw: 16, ne: 16, sw: 5, se: 16 }),
        _ => (Color32::WHITE, Stroke::new(1.0, style::BORDER), CornerRadius { nw: 16, ne: 16, sw: 5, se: 16 }),
    };
    ui.painter().rect(b, cr, fill, stroke, egui::StrokeKind::Inside);
    ui.painter().galley(b.min + egui::vec2(14.0, 10.0), g, col);
}

fn sys_text(ui: &mut egui::Ui, t: &str, dim: bool) {
    ui.vertical_centered(|ui| {
        ui.set_max_width(ui.available_width() * 0.94);
        ui.add(egui::Label::new(RichText::new(t).size(12.5).color(if dim { style::FAINT } else { style::MUTED }).line_height(Some(19.0))).wrap());
    });
}

fn divider(ui: &mut egui::Ui, t: &str) -> egui::Rect {
    let w = ui.available_width();
    let r = ui.horizontal(|ui| {
        let g = ui.painter().layout_no_wrap(t.into(), egui::FontId::proportional(11.5), style::MUTED);
        let side = ((w - g.size().x - 16.0) / 2.0).max(10.0);
        let (a, _) = ui.allocate_exact_size(egui::vec2(side, 16.0), egui::Sense::hover());
        dashed(ui, a);
        ui.label(RichText::new(t).size(11.5).color(style::MUTED));
        let (b, _) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 16.0), egui::Sense::hover());
        dashed(ui, b);
    });
    r.response.rect
}
fn dashed(ui: &egui::Ui, r: egui::Rect) {
    let y = r.center().y;
    let mut x = r.left();
    while x < r.right() { ui.painter().line_segment([egui::pos2(x, y), egui::pos2((x + 4.0).min(r.right()), y)], Stroke::new(1.0, style::BORDER_STRONG)); x += 7.0; }
}

/// 진행 카드 그리기. 멈추기를 누르면 true
fn draw_card(ui: &mut egui::Ui, c: &Card, rects: &mut Vec<(String, egui::Rect)>) -> bool {
    let mut stop = false;
    let fr = egui::Frame::new().fill(Color32::WHITE).stroke(Stroke::new(1.0, Color32::from_rgb(0xcd, 0xdc, 0xfb))).corner_radius(CornerRadius { nw: 16, ne: 16, sw: 5, se: 16 }).inner_margin(egui::Margin::symmetric(14, 12));
    fr.show(ui, |ui| {
        ui.set_width(ui.available_width());
        ui.horizontal(|ui| {
            ui.label(RichText::new(&c.title).size(13.5).family(style::bold()).color(style::TEXT));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                egui::Frame::new().fill(style::BG).corner_radius(CornerRadius::same(255)).inner_margin(egui::Margin::symmetric(8, 1)).show(ui, |ui| ui.label(RichText::new(clock_of(c.secs())).size(12.0).family(style::semi()).color(style::MUTED)));
            });
        });
        ui.add_space(4.0);
        // 막대: 몇 % 인지 알면 그만큼, 모르면 오가는 띠
        let (bar, _) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 5.0), egui::Sense::hover());
        let p = ui.painter();
        p.rect_filled(bar, CornerRadius::same(255), Color32::from_rgb(0xe6, 0xeb, 0xf2));
        match c.pct {
            Some(v) => { let w = bar.width() * (v.clamp(0.0, 100.0) as f32 / 100.0); p.rect_filled(egui::Rect::from_min_size(bar.min, egui::vec2(w, bar.height())), CornerRadius::same(255), style::PRIMARY); }
            None => {
                let t = (c.t0.elapsed().as_secs_f32() / 1.5).fract();
                let seg = bar.width() * 0.4;
                let x0 = bar.left() - seg + t * (bar.width() + seg);
                let r = egui::Rect::from_min_max(egui::pos2(x0.max(bar.left()), bar.top()), egui::pos2((x0 + seg).min(bar.right()), bar.bottom()));
                if r.width() > 0.0 { p.rect_filled(r, CornerRadius::same(255), style::PRIMARY); }
            }
        }
        ui.add_space(4.0);
        for (i, (_, label)) in c.steps.iter().enumerate() {
            let (done, on) = match c.on { Some(k) => (i < k, i == k), None => (false, false) };
            ui.horizontal(|ui| {
                let (r, _) = ui.allocate_exact_size(egui::vec2(14.0, 14.0), egui::Sense::hover());
                let p = ui.painter();
                if done {
                    p.circle_filled(r.center(), 7.0, style::OK);
                    let c0 = r.center();
                    p.line_segment([c0 + egui::vec2(-3.0, 0.0), c0 + egui::vec2(-1.0, 2.5)], Stroke::new(1.7, Color32::WHITE));
                    p.line_segment([c0 + egui::vec2(-1.0, 2.5), c0 + egui::vec2(3.5, -2.5)], Stroke::new(1.7, Color32::WHITE));
                } else if on {
                    let a0 = c.t0.elapsed().as_secs_f32() * std::f32::consts::TAU / 0.8;
                    let pts: Vec<egui::Pos2> = (0..=20).map(|k| { let a = a0 + k as f32 / 20.0 * std::f32::consts::TAU * 0.75; r.center() + egui::vec2(a.cos(), a.sin()) * 6.0 }).collect();
                    p.add(egui::Shape::line(pts, Stroke::new(2.0, style::PRIMARY)));
                } else { p.circle_stroke(r.center(), 6.3, Stroke::new(1.5, Color32::from_rgb(0xcb, 0xd5, 0xe1))); }
                let col = if on { style::TEXT } else if done { Color32::from_rgb(0x47, 0x55, 0x69) } else { style::FAINT };
                ui.label(RichText::new(label).size(12.5).color(col).family(if on { style::semi() } else { egui::FontFamily::Proportional }));
                if !c.subs[i].is_empty() { ui.label(RichText::new(format!("· {}", c.subs[i])).size(12.5).color(style::MUTED)); }
            });
        }
        if !c.stopping {
            let (h, slow) = hint_of(c);
            ui.add_space(4.0);
            ui.add(egui::Label::new(RichText::new(h).size(12.0).color(if slow { style::WARN } else { style::MUTED })).wrap());
        }
        if c.stoppable {
            ui.add_space(2.0);
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let b = cq_btn(ui, if c.stopping { "멈추는 중…" } else { "멈추기" }, false, false, false, !c.stopping);
                rects.push(("stop".into(), b.rect));
                if b.clicked() { stop = true; }
            });
        }
    });
    stop
}

// ---------------------------------------------------------------- 동작

impl App {
    pub(crate) fn chat_busy(&self) -> bool { self.chat.job.is_some() }
    fn chat_push(&mut self, m: M) { self.chat.msgs.push(m); self.chat.log_dirty = Some(Instant::now()); }
    fn chat_sys(&mut self, t: impl Into<String>) { self.chat_push(M::Sys { t: t.into() }); }

    fn start_job(&mut self, card: Card, next: Next, f: impl FnOnce(Arc<Mutex<Prog>>, Arc<AtomicBool>) -> Out + Send + 'static) {
        let (tx, rx) = channel();
        let prog = Arc::new(Mutex::new(Prog::default()));
        let cancel = Arc::new(AtomicBool::new(false));
        let (p2, c2) = (prog.clone(), cancel.clone());
        std::thread::spawn(move || { let _ = tx.send(f(p2, c2)); });
        self.chat.job = Some(Job { rx, cancel, prog, seen: 0, card, next });
    }

    /// 유튜브 주소로 영상 불러오기 (기존 loadVideo)
    pub(crate) fn chat_load(&mut self, url: String) -> bool {
        let url = url.trim().to_string();
        if self.chat_busy() { return false; }
        if url.is_empty() { self.toast("유튜브 주소를 넣어 주세요"); return false; }
        if !url.contains("youtu") { self.toast("유튜브 주소가 아닌 것 같습니다"); return false; }
        let mut card = Card::new("유튜브 자막 불러오는 중", &[("load", "영상 정보와 자막 받기".into())], Hint::Load, false);
        card.step("load", None, None);
        let shared = self.chat.shared.clone();
        self.start_job(card, Next::None, move |_, _| Out::Load(chat::load_video(&shared, &url)));
        true
    }

    /// 유튜브 자막이 없을 때: 위스퍼로 만들지 묻는다 (기존 whisperFallback)
    fn chat_whisper_fallback(&mut self, url: String, title: String, duration: f64, live: bool, engine_ready: bool) {
        let name = if title.is_empty() { "이 영상".to_string() } else { format!("「{title}」") };
        if live { self.chat_sys(format!("{name}은(는) 라이브가 아직 진행 중이라 자막을 만들 수 없습니다. 방송이 끝난 뒤 다시 불러와 주세요.")); return; }
        if !engine_ready { self.chat_sys(format!("{name}에는 유튜브 자막이 없습니다. 위스퍼(자막 엔진)가 설치되어 있지 않아 자막을 만들 수 없습니다. 도움말 → 시스템 점검에서 [엔진 설치]를 한 뒤 다시 불러와 주세요.")); return; }
        let mins = (duration / 60.0).round() as i64;
        let len = if mins >= 60 { format!("{}시간 {}분", mins / 60, mins % 60) } else { format!("{mins}분") };
        let ok = yes("AI 편집 대화", &format!("{name}에는 유튜브 자막이 아직 없습니다.\n\n이 PC에 설치된 위스퍼(음성 인식)로 자막을 만들어 이어서 편집할까요?\n\n· 영상 길이 {}: 소리 전체를 받아 자막을 만듭니다.\n· 컴퓨터 성능에 따라 몇 분에서 수십 분 걸릴 수 있습니다(그래픽카드가 있으면 빠릅니다).\n· 한 번 만들면 다음부터는 이 영상을 바로 불러옵니다.", if mins > 0 { len } else { "알 수 없음".into() }));
        if !ok { self.chat_sys(format!("{name}에는 유튜브 자막이 없어 불러오지 않았습니다. 나중에 다시 불러오면 위스퍼로 만들 수 있습니다.")); return; }
        let mut card = Card::new("위스퍼로 자막 만드는 중", &[("download", "영상 소리 받기".into()), ("transcribe", "위스퍼로 자막 만들기".into())], Hint::Whisper, true);
        card.step("download", None, Some("0%".into())); card.pct = Some(0.0);
        let shared = self.chat.shared.clone();
        self.start_job(card, Next::None, move |prog, cancel| {
            let p = prog.clone();
            let on: Arc<dyn Fn(&str, Option<f64>) + Send + Sync> = Arc::new(move |stage: &str, pct: Option<f64>| { let mut g = p.lock().unwrap(); g.stage = stage.into(); g.pct = pct; g.n += 1; });
            Out::Whisper(chat::load_video_whisper(&shared, &url, on, cancel))
        });
    }

    fn chat_ready(&mut self, l: Loaded) {
        let Loaded::Ready { url, title, words, resumed, has_plan, whisper, from_editor, .. } = l else { return };
        let prev = self.chat.last_video.clone();
        let resumed = resumed && prev.as_ref().is_some_and(|p| p.url == url);
        let edited = resumed && (prev.as_ref().is_some_and(|p| p.edited) || has_plan);
        self.chat.video = Some(VideoUi { url: url.clone(), title: title.clone(), words, edited, from_editor });
        if !resumed { self.chat.last_ranges = None; }
        if !from_editor { if let Ok(s) = yt::recent_add(&url, &title) { self.settings = s; } }
        let name = if title.is_empty() { "설교 영상".to_string() } else { title.clone() };
        if resumed { self.chat_sys(format!("「{name}」 이어서 편집합니다. AI 가 앞의 대화를 기억합니다.")); }
        else {
            self.chat_sys(format!("「{name}」 자막 {}단어를 불러왔습니다.{}", fmt_n(words), if whisper { " (유튜브 자막이 없어 위스퍼로 만든 자막)" } else { "" }));
            self.chat_push(M::Ai { t: "어떤 쇼츠를 만들까요? 아래 버튼으로 길이와 다듬기 조건을 고른 뒤 [보내기](또는 [구간 3곳 추천받기])를 누르거나, 원하는 내용을 말씀해 주세요.\n예: \"결론 부분으로\", \"기도에 대한 부분으로\"".into(), meta: String::new() });
            if sermon_shorts::llm::active_provider(&self.settings).is_none() { self.chat_sys("먼저 위의 [AI 연결]을 눌러 AI 를 연결해 주세요."); }
        }
        self.chat.focus_text = true;
        match self.chat.after.take() {
            Some(After::Pick(c)) => self.chat_do("pick", json!({ "no": c.no, "from": c.from, "to": c.to, "title": c.title })),
            Some(After::Replay(p)) => self.chat_replay(p),
            None => {}
        }
    }

    /// 편집기의 지금 영상·자막으로 대화 시작 (파일 → 유튜브에서 가져오기로 연 영상, 기존 useEditorVideo)
    pub(crate) fn chat_use_editor_video(&mut self) -> bool {
        let src = self.project.rest.get("source").cloned().unwrap_or(json!({}));
        let (url, path) = (src["url"].as_str().unwrap_or("").to_string(), src["path"].as_str().unwrap_or("").to_string());
        if url.is_empty() || path.is_empty() || self.project.words.is_empty() { return false; }
        let off = src["offset"].as_f64().unwrap_or(0.0);
        let raw: Vec<Value> = self.project.words.iter().map(|w| json!({ "text": w.stt_text.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| w.text.clone()), "start": w.start + off, "end": w.end + off })).collect();
        let last_end = self.project.words.iter().map(|w| w.end + off).fold(0.0, f64::max);
        let pd = self.player.probe.duration;
        let file_dur = if pd.is_finite() && pd > 0.0 { pd } else { last_end - off + 1.0 };
        let title = src["title"].as_str().unwrap_or("").to_string();
        match chat::use_words(&self.chat.shared, &url, &title, src["duration"].as_f64().unwrap_or(0.0), &raw) {
            Ok(Loaded::Ready { words, .. }) => {
                self.chat.video = Some(VideoUi { url: url.clone(), title: title.clone(), words, edited: false, from_editor: true });
                self.chat.last_ranges = None;
                self.chat.last_fetch = Some(LastFetch { url: url.clone(), path: PathBuf::from(&path), map: vec![Piece { src0: off, src1: off + file_dur, file0: 0.0 }] });
                let r = match (src["range"]["start"].as_f64(), src["range"]["end"].as_f64()) { (Some(a), Some(b)) => format!(" ({} ~ {})", edl::format_time(a, false), edl::format_time(b, false)), _ => String::new() };
                self.chat_sys(format!("편집기에 불러온 「{}」{r} 자막 {}단어로 AI 대화를 합니다. 받아 둔 구간 안에서 편집합니다.", if title.is_empty() { "설교 영상" } else { &title }, fmt_n(words)));
                self.chat_push(M::Ai { t: "어떤 쇼츠를 만들까요? 아래 버튼으로 길이와 다듬기 조건을 고른 뒤 [보내기](또는 [구간 3곳 추천받기])를 누르거나, 원하는 내용을 말씀해 주세요.".into(), meta: String::new() });
                if sermon_shorts::llm::active_provider(&self.settings).is_none() { self.chat_sys("먼저 위의 [AI 연결]을 눌러 AI 를 연결해 주세요."); }
                true
            }
            Ok(_) => false,
            Err(e) => { self.toast(format!("대화에 불러오지 못했습니다: {e}")); false }
        }
    }
    /// 편집기에 유튜브 영상 자막이 들어왔을 때 (기존 ss:transcript-ready)
    pub(crate) fn chat_on_transcript(&mut self) {
        let src = self.project.rest.get("source").cloned().unwrap_or(json!({}));
        let url = src["url"].as_str().unwrap_or("").to_string();
        if url.is_empty() || self.chat_busy() { return; }
        if self.chat.video.as_ref().is_some_and(|v| v.url == url) { return; }
        if self.chat.video.is_none() { self.chat_use_editor_video(); return; }
        let t = src["title"].as_str().filter(|s| !s.is_empty()).unwrap_or("새 영상").to_string();
        self.chat_push(M::UseEditor { t: format!("편집기에 「{t}」을(를) 불러왔습니다. ") });
    }

    /// 보내기. label = 말풍선 글, ai_text = AI 에게 실제로 보낼 글(버튼). 직접 쓴 첫 요청에는 편집 조건을 붙인다
    pub(crate) fn chat_send(&mut self, label: String, ai_text: Option<String>) {
        let label = label.trim().to_string();
        if label.is_empty() || self.chat_busy() { return; }
        let Some(v) = self.chat.video.clone() else { return };
        let Some(provider) = sermon_shorts::llm::active_provider(&self.settings) else { self.open_ai_connect(); return; };
        let from_button = ai_text.is_some();
        let text = ai_text.unwrap_or_else(|| { let c = if v.edited { String::new() } else { cp::build_conditions(&self.chat.prefs) }; if c.is_empty() { label.clone() } else { format!("{c}\n\n{label}") } });
        if !from_button && self.chat.cond_open { self.chat.cond_open = false; }
        self.chat_push(M::User { t: label });
        let who = sermon_shorts::llm::name_ko(&provider).to_string();
        let ga = iga(&who);
        let mut card = Card::new(&format!("{who}에게 보내는 중"), &[("prepare", "설교 자막과 요청 보내기".into()), ("think", format!("{who}{ga} 설교를 읽고 생각하기")), ("write", "답 쓰기".into()), ("check", "답 확인하고 구간 찾기".into())], Hint::Send, true);
        card.step("prepare", None, Some(format!("{}단어", fmt_n(v.words))));
        let shared = self.chat.shared.clone();
        self.start_job(card, Next::None, move |prog, cancel| {
            let p = prog.clone();
            let stage = move |s: &str| { let mut g = p.lock().unwrap(); g.stage = s.into(); g.n += 1; };
            Out::Send(chat::send(&shared, &text, &stage, cancel))
        });
    }

    /// 다듬기 버튼 고르기·풀기 (더 짧게·더 길게는 둘 중 하나만)
    fn chat_pick(&mut self, key: &str) {
        let p = &mut self.chat.picked;
        if let Some(i) = p.iter().position(|x| x == key) { p.remove(i); return; }
        if key == "shorter" { p.retain(|x| x != "longer"); }
        if key == "longer" { p.retain(|x| x != "shorter"); }
        p.push(key.to_string());
    }
    /// 고른 다듬기를 한 번의 요청으로 (기존 버튼 요청 글을 차례로 이어서)
    pub(crate) fn chat_apply_picked(&mut self) {
        if self.chat_busy() || self.chat.video.is_none() || self.chat.picked.is_empty() { return; }
        let keys: Vec<String> = PICKABLE.iter().filter(|k| self.chat.picked.iter().any(|x| x == *k)).map(|k| k.to_string()).collect();
        let reqs: Vec<(String, String)> = keys.iter().filter_map(|k| cp::action_request(k, &self.chat.prefs, &Value::Null)).collect();
        self.chat.picked.clear();
        if reqs.is_empty() { return; }
        if reqs.len() == 1 { let (l, t) = reqs.into_iter().next().unwrap(); self.chat_send(l, Some(t)); return; }
        // 구간을 바꾸는 요청이 섞이면 제목·오타의 "구간은 그대로 둡니다"는 뺀다
        let moves = keys.iter().any(|k| !matches!(k.as_str(), "title" | "typos"));
        let label = reqs.iter().map(|r| r.0.clone()).collect::<Vec<_>>().join(" + ");
        let body = reqs.iter().enumerate().map(|(i, r)| { let t = if moves { r.1.replace(" 구간은 그대로 둡니다.", "") } else { r.1.clone() }; format!("{}. {}", i + 1, t) }).collect::<Vec<_>>().join("\n");
        self.chat_send(label, Some(format!("아래 {}가지를 한 번에 모두 반영해 줘.\n{body}", reqs.len())));
    }

    fn chat_do(&mut self, key: &str, arg: Value) {
        if self.chat_busy() || self.chat.video.is_none() { return; }
        match key {
            "gaps-now" => { self.chat_gaps(None); return; }
            "cands" => { if self.chat.msgs.iter().any(|m| matches!(m, M::Cand { .. })) { self.chat.scroll_cands = true; self.chat.flash = Some(Instant::now()); } else { self.toast("앞서 추천받은 후보가 없습니다."); } return; }
            _ => {}
        }
        let Some((label, text)) = cp::action_request(key, &self.chat.prefs, &arg) else { return };
        if self.chat.cond_open && matches!(key, "recommend" | "make" | "pick" | "again") { self.chat.cond_open = false; }
        self.chat_send(label, Some(text));
    }

    fn chat_reply(&mut self, r: Reply) {
        if !r.candidates.is_empty() && r.ranges.is_empty() {
            // 구간 추천: 후보 카드만 보여 주고 지금 편집은 그대로
            self.chat_push(M::Ai { t: r.reply.clone(), meta: String::new() });
            let (url, vt) = self.chat.video.as_ref().map(|v| (v.url.clone(), v.title.clone())).unwrap_or_default();
            for c in &r.candidates {
                self.chat_push(M::Cand { c: CandData { no: c.no, from: c.from, to: c.to, title: c.title.clone(), summary: c.summary.clone(), why: c.why.clone(), start: c.start, end: c.end, dur: c.duration_sec, excerpt: c.excerpt.clone() }, url: url.clone(), vtitle: vt.clone() });
            }
            self.chat_push(M::CandNote);
            return;
        }
        let meta = format!("{}개 구간 · 남긴 길이 약 {}{}", r.ranges.len(), cp::fmt_len(r.duration_sec.round()), if r.title.is_empty() { String::new() } else { format!(" · 제목: {}", r.title.replace('\n', " / ")) });
        self.chat_push(M::Ai { t: r.reply.clone(), meta });
        if !r.questions.is_empty() { self.chat_sys(format!("물음표로 끝나는 문장이 {}개 남아 있어요: “{}”{}. [질문·대답 빼기]를 눌러 보세요.", r.questions.len(), r.questions[0], if r.questions.len() > 1 { " 등" } else { "" })); }
        if r.ranges.is_empty() { return; }
        let v = self.chat.video.clone().unwrap_or_default();
        if v.edited && same_ranges(&self.chat.last_ranges, &r.ranges) && r.corrections.is_empty() {
            // 구간이 그대로면 다시 반영하지 않는다 (공백 없애기 등 손본 것을 지키기)
            self.chat_meta(&r.title, &r.verse);
            self.chat_sys("구간은 그대로 두고 제목·본문만 반영했습니다.");
            return;
        }
        let plan = ApplyPlan { url: v.url.clone(), vtitle: v.title.clone(), ranges: r.ranges.iter().map(|g| (g.from, g.to)).collect(), corrections: r.corrections.clone(), tighten: r.tighten.clone(), title: r.title.clone(), verse: r.verse.clone(), duration_sec: r.duration_sec };
        self.chat_apply(plan, false, !v.edited);
    }

    /// AI 답의 제목·본문을 입력칸에 (두 줄 제목은 ' / ' 로)
    fn chat_meta(&mut self, title: &str, verse: &str) {
        let re = regex::Regex::new(r"\s*\n\s*").unwrap();
        if !title.is_empty() { self.title = re.replace_all(title, " / ").trim().to_string(); }
        if !verse.is_empty() { self.verse = verse.to_string(); }
        if self.has_project { self.unsaved = true; }
    }

    /// 편집기에 반영 (기존 applyPlan): 필요한 영상 부분 받기 → 자막·구간 넣기 → (공백 줄이기)
    fn chat_apply(&mut self, plan: ApplyPlan, replay: bool, first: bool) {
        let words = { let g = self.chat.shared.lock().unwrap(); match g.as_ref() { Some(s) => s.words.clone(), None => return } };
        if plan.ranges.iter().any(|g| g.1 >= words.len()) { self.chat_sys("유튜브 자막이 그사이 바뀌어 이 편집을 그대로 적용할 수 없습니다. 후보를 다시 고르거나 새로 부탁해 주세요."); return; }
        let spans: Vec<Span> = plan.ranges.iter().map(|g| Span { start: words[g.0].start, end: words[g.1].end }).collect();
        let gaps = self.chat.prefs["gaps"].as_bool().unwrap_or(false) || plan.tighten == "strong";
        let mut steps: Vec<(&str, String)> = vec![("clips", "필요한 영상 부분 받기".into()), ("apply", "자막·구간을 편집기에 넣기".into())];
        if gaps { steps.push(("gaps", "말 사이 공백 줄이기".into())); }
        let mut card = Card::new("편집기에 반영하는 중", &steps, Hint::Clips, false);
        // 필요한 구간이 모두 이미 받은 영상 안에 있으면 다시 받지 않는다
        let covered = self.chat.last_fetch.as_ref().is_some_and(|f| f.url == plan.url && f.path.exists() && spans.iter().all(|s| src_to_file(&f.map, s.start - 0.5).is_some() && src_to_file(&f.map, s.end + 0.5).is_some()));
        if covered {
            card.sub("clips", "이미 받아 둠");
            self.chat_finish_apply(plan, replay, first, card);
            return;
        }
        card.step("clips", Some("필요한 영상 부분만 받는 중".into()), Some("0%".into())); card.pct = Some(0.0);
        let url = plan.url.clone();
        self.start_job(card, Next::Apply { plan, replay, first }, move |prog, _| {
            let p = prog.clone();
            Out::Clips(yt::fetch_clips(&url, &spans, &move |pct: f64| { let mut g = p.lock().unwrap(); g.stage = "clips".into(); g.pct = Some(pct); g.n += 1; }))
        });
    }

    fn chat_finish_apply(&mut self, plan: ApplyPlan, replay: bool, first: bool, mut card: Card) {
        let Some(lf) = self.chat.last_fetch.clone() else { self.chat_push(M::Err { t: "영상을 열지 못했습니다".into() }); return };
        card.step("apply", Some("편집기에 넣는 중".into()), None); card.pct = None;
        let (words, breaks) = { let g = self.chat.shared.lock().unwrap(); g.as_ref().map(|s| (s.words.clone(), s.breaks.clone())).unwrap_or_default() };
        let n = words.len();
        let (mut kept, mut starts) = (vec![false; n], vec![false; n]);
        for &(f, t) in &plan.ranges { if f < n { starts[f] = true; } for k in f..=t.min(n.saturating_sub(1)) { kept[k] = true; } }
        let corr: std::collections::HashMap<usize, String> = plan.corrections.iter().cloned().collect();
        let mut ew: Vec<Value> = vec![];
        let mut prev: Option<(f64, f64)> = None; // (파일 시작, 원본 시작)
        for (i, w) in words.iter().enumerate() {
            let (Some(fs0), Some(fe0)) = (src_to_file(&lf.map, w.start), src_to_file(&lf.map, w.end)) else { continue };
            // 조각이 바뀌는 곳에서는 항상 컷
            let jump = prev.is_some_and(|(pf, ps)| ((fs0 - pf) - (w.start - ps)).abs() > 0.5);
            ew.push(json!({ "id": ew.len(), "text": corr.get(&i).cloned().unwrap_or_else(|| w.text.clone()), "sttText": w.text, "start": fs0, "end": fe0.max(fs0 + 0.05), "score": 1, "del": !kept[i], "br": breaks.get(i).copied().unwrap_or(false), "cutBefore": starts[i] || jump }));
            prev = Some((fs0, w.start));
        }
        let mut wv: Vec<Word> = match serde_json::from_value(Value::Array(ew)) { Ok(w) => w, Err(e) => { self.chat_push(M::Err { t: format!("다시 적용하지 못했습니다: {e}") }); return; } };
        for (i, w) in wv.iter_mut().enumerate() { w.id = i as i64; }
        self.apply_edit_defaults();
        self.set_words(wv);
        // 설정 [편집]의 컷 여백
        let ed = self.settings["editDefaults"].clone();
        self.project.settings.pad_before = ed["padBefore"].as_f64().unwrap_or(0.1);
        self.project.settings.pad_after = ed["padAfter"].as_f64().unwrap_or(0.15);
        // 군말(어·음)과 바로 되풀이한 단어 지우기
        if self.chat.prefs["filler"].as_bool().unwrap_or(false) { sermon_shorts::tidy::auto_clean(&mut self.project.words, 1e9, None); }
        // 공백 없애기를 끄고 AI 가 '보통'으로 줄이자고 하면 눈에 띄는 긴 틈만 자른다
        if !self.chat.prefs["gaps"].as_bool().unwrap_or(false) && plan.tighten == "normal" { sermon_shorts::tidy::auto_clean(&mut self.project.words, 0.45, Some(&[])); }
        self.chat_meta(&plan.title, &plan.verse);
        if self.speaker().is_empty() {
            let sp = self.settings["defaultSpeaker"].as_str().filter(|s| !s.is_empty()).map(String::from).or_else(|| self.speakers().first().cloned()).unwrap_or_default();
            if !sp.is_empty() { self.speaker_pick = sp; }
        }
        self.history.clear(); self.hist_at = 0; self.push_undo();
        self.recompute();
        self.unsaved = true;
        let gaps = self.chat.prefs["gaps"].as_bool().unwrap_or(false) || plan.tighten == "strong";
        if gaps { card.hint = Hint::Gaps; self.chat_gaps(Some((card, Next::Finish { plan, replay, first }))); }
        else { self.chat_complete(plan, replay, first, String::new()); }
    }

    fn chat_complete(&mut self, plan: ApplyPlan, replay: bool, first: bool, gap_note: String) {
        if let Some(t) = self.project.words.iter().find(|w| !w.del).map(|w| w.start) { self.player.seek_src(t); }
        self.recompute();
        let done = format!("편집기에 반영했습니다. 완성 길이 약 {}.{gap_note} 왼쪽 화면에서 [재생]으로 확인해 보세요.", cp::fmt_len(edl::segments_duration(&self.segs)));
        let t = if replay { format!("앞의 편집을 다시 적용했습니다. {done}") } else { done };
        self.chat.last_ranges = Some(plan.ranges.iter().map(|g| Range { from: g.0, to: g.1 }).collect());
        self.chat_push(M::Replay { t, plan });
        if let Some(v) = self.chat.video.as_mut() { v.edited = true; }
        if first { self.chat.cond_open = false; }
        self.chat_check_length();
    }

    /// 목표 길이와 15초 넘게 다르면 알려 주고 맞추기 버튼
    fn chat_check_length(&mut self) {
        let target = cp::js_num(self.chat.prefs.get("length"));
        let d = edl::segments_duration(&self.segs);
        if !(target > 0.0) || !(d > 0.0) || (d - target).abs() <= 15.0 { return; }
        self.chat_push(M::Fit { t: format!("완성 길이 약 {} (목표 {}) ", cp::fmt_len(d), cp::fmt_len(target)), target });
    }

    /// 말 사이 공백 없애기 (실제 소리에서 무음 찾기, 기존 removeGaps). with = 반영 중인 카드
    fn chat_gaps(&mut self, with: Option<(Card, Next)>) {
        self.recompute();
        let (mut card, next) = with.unwrap_or_else(|| (Card::new("말 사이 공백을 찾는 중", &[("gaps", "실제 소리에서 조용한 부분 찾기".into())], Hint::Gaps, false), Next::GapsNow));
        card.step("gaps", Some("말 사이 공백을 찾는 중".into()), None); card.pct = None;
        let (words, segs, src) = (self.project.words.clone(), self.segs.clone(), self.project.source_path.clone());
        self.start_job(card, next, move |_, _| {
            if segs.is_empty() { return Out::Gaps(Err("남은 영상 구간이 없습니다.".into())); }
            let (s0, s1) = ((segs[0].start - 0.5).max(0.0), segs[segs.len() - 1].end + 0.5);
            Out::Gaps(match sermon_shorts::tidy::detect_silences(&src, s0, Some(s1), 0.15) {
                Ok(f) => Ok(sermon_shorts::tidy::plan_gap_cuts(&words, &segs, &f.silences, 0.05, 0.07, 0.08)),
                Err(e) => Err(e.to_string()),
            })
        });
    }
    /// 공백 계획을 편집에 넣는다 → (줄인 곳, 전, 후)
    fn chat_apply_gaps(&mut self, plan: &sermon_shorts::tidy::GapPlan) -> (usize, f64, f64) {
        self.recompute();
        let before = edl::segments_duration(&self.segs);
        if plan.cuts == 0 { return (0, before, before); }
        self.push_undo();
        let n = self.project.words.len();
        for &i in &plan.cut_before { if i < n { self.project.words[i].cut_before = true; self.project.words[i].extra.insert("gapCut".into(), json!(true)); } }
        for (k, v) in &plan.overrides { self.project.overrides.insert(k.clone(), *v); }
        self.recompute();
        self.unsaved = true;
        (plan.cuts, before, edl::segments_duration(&self.segs))
    }

    /// [새로]: 지금 대화는 지우지 않고 위에 남긴다. 편집은 자동 저장하고 [이 편집 다시 열기]를 둔다
    pub(crate) fn chat_reset(&mut self) {
        if self.chat_busy() { return; }
        let title = self.chat.video.as_ref().map(|v| if !self.title.trim().is_empty() { self.title.clone() } else if !v.title.is_empty() { v.title.clone() } else { "설교 영상".into() }).unwrap_or_default();
        let saved = if self.chat.video.as_ref().is_some_and(|v| v.edited) { self.chat_autosave() } else { None };
        if let Some(v) = self.chat.video.take() { self.chat.last_video = Some(v); }
        self.chat.archived = self.chat.msgs.len();
        if !title.is_empty() { let t = regex::Regex::new(r"\s*/\s*").unwrap().replace_all(&title, " ").to_string(); self.chat_push(M::Divider { t: format!("여기까지 「{t}」"), reopen: saved, mark: false }); self.chat.archived = self.chat.msgs.len(); }
        if let Some(lv) = &self.chat.last_video { self.chat.url = lv.url.clone(); }
    }
    /// 지금 편집을 cache/chat_history 에 프로젝트로 자동 저장
    fn chat_autosave(&mut self) -> Option<String> {
        if !self.has_project || !self.project.words.iter().any(|w| !w.del) { return None; }
        let dir = yt::cache_dir().join("chat_history");
        std::fs::create_dir_all(&dir).ok()?;
        let name: String = { let t = if self.title.trim().is_empty() { self.chat.video.as_ref().map(|v| v.title.clone()).unwrap_or_default() } else { self.title.clone() };
            let t = regex::Regex::new(r"\s*/\s*").unwrap().replace_all(&t, " ").to_string();
            let t: String = t.chars().filter(|c| !"\\/:*?\"<>|".contains(*c)).collect();
            let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
            let t: String = t.chars().take(40).collect(); if t.is_empty() { "편집".into() } else { t } };
        let stamp = chrono_stamp();
        let p = dir.join(format!("{stamp} {name}.sshorts"));
        self.project.playhead = self.player.src_now();
        self.write_project_design();
        self.project.save(&p).ok()?;
        Some(p.to_string_lossy().to_string())
    }
    fn chat_clear(&mut self) {
        if self.chat_busy() { return; }
        if !yes("AI 편집 대화", "AI 편집 대화 기록을 모두 지울까요?\n(편집기에 열린 영상과 자동 저장한 편집 파일은 그대로 둡니다)") { return; }
        let _ = std::fs::remove_file(log_file());
        self.chat.msgs.clear(); self.chat.archived = 0;
        if self.chat.video.is_some() { self.chat_sys("대화 기록을 지웠습니다. 지금 영상은 계속 편집할 수 있습니다."); }
        self.chat.log_dirty = None;
    }

    /// 그 영상이 대화에 불러와져 있게 (다른 영상이면 지금 대화를 위에 남기고 바꾼다). 불러오는 중이면 false (after 로 이어 한다)
    fn chat_ensure(&mut self, url: &str, title: &str, after: After) {
        if self.chat.video.as_ref().is_some_and(|v| v.url == url) {
            match after { After::Pick(c) => self.chat_do("pick", json!({ "no": c.no, "from": c.from, "to": c.to, "title": c.title })), After::Replay(p) => self.chat_replay(p) }
            return;
        }
        if self.chat.video.is_some() {
            if !yes("AI 편집 대화", &format!("「{}」을(를) 다시 불러와 이어서 작업할까요?\n지금 대화는 위에 남고, 편집 중인 것은 자동 저장됩니다.", if title.is_empty() { "그 영상" } else { title })) { return; }
            self.chat_reset();
        }
        self.chat.after = Some(after);
        if !self.chat_load(url.to_string()) { self.chat.after = None; }
    }
    fn chat_replay(&mut self, p: ApplyPlan) {
        if self.chat_busy() { return; }
        if p.ranges.is_empty() { self.toast("이 편집 정보를 읽지 못했습니다."); return; }
        if !self.chat.video.as_ref().is_some_and(|v| v.url == p.url) { let (u, t) = (p.url.clone(), p.vtitle.clone()); self.chat_ensure(&u, &t, After::Replay(p)); return; }
        self.chat_apply(p, true, false);
    }

    pub(crate) fn chat_save_prefs(&mut self) { let _ = std::fs::write(prefs_file(), serde_json::to_string_pretty(&self.chat.prefs).unwrap_or_default()); }

    /// 매 화면: 일 받기·기록 저장 (대화 칸이 접혀 있어도)
    pub(crate) fn chat_poll(&mut self, ctx: &egui::Context) {
        let no_log = self.test.as_ref().is_some_and(|t| t.name != "chatflow"); // 시험 중에는 사용자의 대화 기록을 읽거나 쓰지 않는다
        if no_log { self.chat.loaded_log = true; self.chat.log_dirty = None; }
        if !self.chat.loaded_log {
            self.chat.loaded_log = true;
            if let Ok(t) = std::fs::read_to_string(log_file()) {
                if let Ok(mut v) = serde_json::from_str::<Vec<M>>(&t) {
                    v.retain(|m| !matches!(m, M::Divider { mark: true, .. }) && !matches!(m, M::Divider { t, reopen: None, .. } if t == "지난 기록"));
                    if !v.is_empty() { self.chat.msgs = v; self.chat.archived = self.chat.msgs.len(); self.chat.msgs.push(M::Divider { t: "지난 기록".into(), reopen: None, mark: true }); self.chat.archived = self.chat.msgs.len(); }
                }
            }
        }
        if let Some(t) = self.chat.log_dirty { if t.elapsed().as_millis() > 500 {
            self.chat.log_dirty = None;
            let keep: Vec<&M> = self.chat.msgs.iter().filter(|m| !matches!(m, M::Divider { mark: true, .. })).collect();
            let keep = &keep[keep.len().saturating_sub(600)..];
            let _ = std::fs::write(log_file(), serde_json::to_string(keep).unwrap_or_default());
        } else { ctx.request_repaint_after(std::time::Duration::from_millis(520)); } }
        let Some(job) = self.chat.job.as_mut() else { return };
        ctx.request_repaint_after(std::time::Duration::from_millis(100));
        // 진행 글을 카드에
        let p = job.prog.lock().unwrap().clone();
        if p.n != job.seen {
            job.seen = p.n;
            let c = &mut job.card;
            c.last_sig = Instant::now();
            match c.hint {
                Hint::Whisper => {
                    let pct = p.pct.map(|x| x.round());
                    if p.stage == "download" { c.step("download", None, None); c.sub("download", &pct.map(|x| format!("{x}%")).unwrap_or_default()); c.pct = pct; }
                    else if p.stage == "transcribe" { c.step("transcribe", None, None); c.sub("download", "받음"); c.sub("transcribe", &pct.map(|x| format!("{x}%")).unwrap_or_default()); c.pct = pct; }
                }
                Hint::Send => {
                    c.last_stage = p.stage.clone();
                    let who = c.steps.get(1).map(|s| s.1.split(' ').next().unwrap_or("AI").to_string()).unwrap_or_default();
                    let who = who.trim_end_matches(['이', '가']).to_string();
                    let ga = iga(&who);
                    match p.stage.as_str() {
                        "ask" => c.step("think", Some(format!("{who}{ga} 생각하는 중")), Some("다 쓰면 한 번에 옵니다".into())),
                        "check" => c.step("check", Some("답을 확인하는 중".into()), None),
                        "retry" => c.step("write", Some("답 형식이 어긋나 다시 받는 중".into()), Some("다시 받는 중".into())),
                        _ => {}
                    }
                }
                Hint::Clips => { if let Some(x) = p.pct { let x = x.round(); c.sub("clips", &format!("{x}%")); c.pct = Some(x); } }
                _ => {}
            }
        }
        let Ok(out) = job.rx.try_recv() else { return };
        let job = self.chat.job.take().unwrap();
        let stopped = job.cancel.load(Ordering::Relaxed);
        match out {
            Out::Load(r) => match r {
                Err(e) => self.toast(format!("불러오기 실패: {e}")),
                Ok(Loaded::NoSubs { url, title, duration, live, engine_ready }) => self.chat_whisper_fallback(url, title, duration, live, engine_ready),
                Ok(l) => self.chat_ready(l),
            },
            Out::Whisper(r) => match r {
                Ok(l) => self.chat_ready(l),
                Err(e) => { self.chat.after = None; self.chat_sys(if stopped { "자막 만들기를 멈췄습니다.".into() } else { format!("위스퍼로 자막을 만들지 못했습니다: {e}") }); }
            },
            Out::Send(r) => match r {
                Ok(rep) => self.chat_reply(rep),
                Err(e) => {
                    if stopped || e == chat::CANCELLED { self.chat_sys("요청을 멈췄습니다. 다시 보내면 처음부터 합니다."); }
                    else {
                        let fix = regex::Regex::new("연결|로그인|키|설치").unwrap().is_match(&e);
                        self.chat_push(M::Err { t: e });
                        if fix { self.chat_push(M::Fix); }
                    }
                }
            },
            Out::Clips(r) => {
                let Next::Apply { plan, replay, first } = job.next else { return };
                match r {
                    Err(e) => self.chat_push(M::Err { t: if replay { format!("다시 적용하지 못했습니다: {e}") } else { e } }),
                    Ok(res) => {
                        let spans: Vec<Value> = { let g = self.chat.shared.lock().unwrap(); let w = g.as_ref().map(|s| s.words.clone()).unwrap_or_default(); plan.ranges.iter().filter(|r| r.1 < w.len()).map(|r| json!({ "start": w[r.0].start, "end": w[r.1].end })).collect() };
                        let map = sermon_shorts::source_fetch::map_json(&res.map);
                        let opts = json!({ "offset": 0, "url": plan.url, "title": plan.vtitle, "duration": res.duration, "fetch": { "kind": "clips", "spans": spans, "map": map } });
                        if !self.open_video_with(res.path.clone(), opts) { self.chat_push(M::Err { t: "영상을 열지 못했습니다".into() }); return; }
                        self.chat.last_fetch = Some(LastFetch { url: plan.url.clone(), path: res.path.clone(), map: res.map.clone() });
                        self.chat_finish_apply(plan, replay, first, job.card);
                    }
                }
            }
            Out::Gaps(r) => match job.next {
                Next::Finish { plan, replay, first } => {
                    let note = match r {
                        Ok(gp) => { let (cuts, b, a) = self.chat_apply_gaps(&gp); if cuts > 0 { format!(" 말 사이 공백 {cuts}곳을 줄여 {:.1}초 짧아졌습니다.", b - a) } else { String::new() } }
                        Err(_) => {
                            // 소리를 못 읽으면 자막 시각으로 긴 틈만 자른다
                            self.push_undo();
                            sermon_shorts::tidy::auto_clean(&mut self.project.words, 0.25, Some(&[]));
                            self.project.settings.pad_before = 0.06; self.project.settings.pad_after = 0.08;
                            self.recompute(); String::new()
                        }
                    };
                    self.chat_complete(plan, replay, first, note);
                }
                _ => {
                    let t = match r {
                        Ok(gp) => { let (cuts, b, a) = self.chat_apply_gaps(&gp); if cuts > 0 { format!("말 사이 공백 {cuts}곳을 줄였습니다. {} → {} ({:.1}초 짧아짐). 되돌리려면 Ctrl+Z.", cp::fmt_len(b), cp::fmt_len(a), b - a) } else { "더 줄일 말 사이 공백이 없습니다.".into() } }
                        Err(e) => format!("공백 없애기 실패: {e}"),
                    };
                    self.chat_sys(t);
                }
            },
        }
    }

    fn chat_act(&mut self, a: Act) {
        match a {
            Act::Load(u) => { self.chat_load(u); }
            Act::Send(l, t) => self.chat_send(l, t),
            Act::Do(k, arg) => self.chat_do(&k, arg),
            Act::PickTrim(k) => self.chat_pick(&k),
            Act::ApplyPicked => self.chat_apply_picked(),
            Act::ClearPicked => self.chat.picked.clear(),
            Act::Pick(c, url, vt) => {
                if self.chat_busy() { return; }
                if url.is_empty() { self.toast("예전 기록이라 이 후보의 영상 주소를 알 수 없습니다. 영상을 먼저 불러온 뒤 눌러 주세요."); return; }
                self.chat_ensure(&url, &vt, After::Pick(c));
            }
            Act::Yt(u) => sermon_shorts::ytupload::open_url(&u),
            Act::Reopen(p) => { if !self.chat_busy() { self.open_project(PathBuf::from(p)); } }
            Act::Replay(p) => self.chat_replay(p),
            Act::UseEditor => { if !self.chat_busy() { if self.chat.video.is_some() { self.chat_reset(); } self.chat_use_editor_video(); } }
            Act::Fit(t) => self.chat_do("length", json!(t)),
            Act::Fix => self.open_ai_connect(),
            Act::Stop => { if let Some(j) = self.chat.job.as_mut() { j.cancel.store(true, Ordering::Relaxed); j.card.stopping = true; j.card.title = "멈추는 중…".into(); } }
            Act::New => self.chat_reset(),
            Act::Clear => self.chat_clear(),
            Act::Fold => self.chat_open = false,
            Act::Export => { if self.has_project { self.start_export(); } else { self.toast("먼저 편집을 만들어 주세요"); } }
            Act::Len(s) => { self.chat.prefs["length"] = json!(s); self.chat_save_prefs(); if self.chat.video.as_ref().is_some_and(|v| v.edited) { self.chat_do("length", json!(s)); } }
            Act::Tog(k) => { let v = self.chat.prefs[k].as_bool().unwrap_or(false); self.chat.prefs[k] = json!(!v); self.chat_save_prefs(); }
            Act::Content(k) => {
                let mut cs: Vec<String> = self.chat.prefs["contents"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                if cs.iter().any(|x| x == k) { cs.retain(|x| x != k); } else { cs.push(k.into()); }
                self.chat.prefs["contents"] = json!(cs); self.chat_save_prefs();
            }
            Act::Aud(k) => { self.chat.prefs["audience"] = json!(k); self.chat_save_prefs(); }
            Act::Int(n) => { self.chat.prefs["intensity"] = json!(n); self.chat_save_prefs(); }
            Act::Count(n) => { self.chat.prefs["count"] = json!(n); self.chat_save_prefs(); }
            Act::CondFold => self.chat.cond_open = !self.chat.cond_open,
        }
    }

    // ---------------------------------------------------------------- 화면

    /// 연결 상태 표시 (누르면 AI 연결 창, 기존 #chatProvider)
    fn chat_chip(&mut self, ui: &mut egui::Ui) {
        let (chip, ok) = self.ai_chip();
        let (fill, col) = if ok { (Color32::from_rgb(0xe7, 0xf8, 0xee), Color32::from_rgb(0x15, 0x80, 0x3d)) } else { (Color32::from_rgb(0xff, 0xf4, 0xe5), Color32::from_rgb(0xb4, 0x53, 0x09)) };
        let r = egui::Frame::new().fill(fill).corner_radius(CornerRadius::same(255)).inner_margin(egui::Margin::symmetric(10, 4))
            .show(ui, |ui| ui.label(RichText::new(&chip).size(12.0).family(style::bold()).color(col))).response.interact(egui::Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
        if r.clicked() { self.open_ai_connect(); }
    }

    fn chat_messages(&mut self, ui: &mut egui::Ui, acts: &mut Vec<Act>, rects: &mut Vec<(String, egui::Rect)>) {
        let busy = self.chat_busy();
        let flash = self.chat.flash.is_some_and(|t| t.elapsed().as_secs_f32() < 1.6);
        let mut first_cand_rect: Option<egui::Rect> = None;
        let last_cand_group = self.chat.msgs.iter().rposition(|m| matches!(m, M::Cand { .. }));
        let mut group_start = None;
        if let Some(l) = last_cand_group { let mut k = l; while k > 0 && matches!(self.chat.msgs[k - 1], M::Cand { .. }) { k -= 1; } group_start = Some(k); }
        for (i, m) in self.chat.msgs.iter().enumerate() {
            let old = i < self.chat.archived;
            match m {
                M::User { t } => bubble(ui, t, "", 0),
                M::Ai { t, meta } => bubble(ui, t, meta, 1),
                M::Err { t } => bubble(ui, t, "", 2),
                M::Sys { t } => sys_text(ui, t, false),
                M::CandNote => sys_text(ui, "마음에 드는 후보의 [이 구간으로 만들기]를 누르세요. 길이·다듬기 조건도 함께 적용됩니다.", false),
                M::Fix => { ui.vertical_centered(|ui| { if ui.add_enabled(!old, egui::Link::new(RichText::new("[AI 연결] 열기").size(12.5))).clicked() { acts.push(Act::Fix); } }); }
                M::UseEditor { t } => {
                    sys_text(ui, t, false);
                    ui.vertical_centered(|ui| { let b = cq_btn(ui, "이 영상으로 대화하기", false, false, true, !old && !busy); rects.push((format!("use-editor:{i}"), b.rect)); if b.clicked() { acts.push(Act::UseEditor); } });
                }
                M::Fit { t, target } => {
                    sys_text(ui, t, false);
                    ui.vertical_centered(|ui| { if cq_btn(ui, &format!("{} 맞추기", cp::with_ro(&cp::fmt_len(*target))), false, false, true, !old && !busy).clicked() { acts.push(Act::Fit(*target)); } });
                }
                M::Replay { t, plan } => {
                    sys_text(ui, t, false);
                    ui.vertical_centered(|ui| {
                        let b = cq_btn(ui, "이 편집 다시 적용", false, false, true, !busy).on_hover_text("나중에 다른 구간으로 바꾼 뒤에도, 프로그램을 다시 켠 뒤에도 이 편집으로 바로 되돌립니다 (AI 를 다시 부르지 않음)");
                        rects.push((format!("replay:{i}"), b.rect));
                        if b.clicked() { acts.push(Act::Replay(plan.clone())); }
                    });
                }
                M::Divider { t, reopen, .. } => {
                    divider(ui, t);
                    if let Some(p) = reopen { ui.vertical_centered(|ui| { let b = cq_btn(ui, "이 편집 다시 열기", false, false, true, !busy).on_hover_text("자동 저장한 편집을 편집기에 다시 엽니다"); rects.push((format!("reopen:{i}"), b.rect)); if b.clicked() { acts.push(Act::Reopen(p.clone())); } }); }
                }
                M::Cand { c, url, vtitle } => {
                    let fl = flash && group_start.is_some_and(|g| i >= g);
                    let fr = egui::Frame::new().fill(Color32::WHITE).stroke(Stroke::new(if fl { 2.0 } else { 1.0 }, if fl { style::PRIMARY } else { style::BORDER })).corner_radius(CornerRadius::same(18)).inner_margin(egui::Margin::symmetric(16, 14));
                    let r = fr.show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.horizontal_wrapped(|ui| {
                            egui::Frame::new().fill(style::PRIMARY_SOFT).corner_radius(CornerRadius::same(255)).inner_margin(egui::Margin::symmetric(8, 3)).show(ui, |ui| ui.label(RichText::new(format!("후보 {}", c.no)).size(12.0).family(style::bold()).color(style::PRIMARY)));
                            ui.label(RichText::new(format!("{} ~ {} · 약 {}", clock(c.start), clock(c.end), cp::fmt_len(c.dur))).size(12.0).color(style::MUTED));
                        });
                        if !c.title.is_empty() { ui.add(egui::Label::new(RichText::new(format!("「{}」", c.title)).size(15.5).family(style::bold()).color(style::TEXT)).wrap()); }
                        if !c.summary.is_empty() { ui.add(egui::Label::new(RichText::new(&c.summary).size(12.5).color(style::TEXT)).wrap()); }
                        if !c.why.is_empty() { ui.add(egui::Label::new(RichText::new(&c.why).size(12.5).color(Color32::from_rgb(0x47, 0x55, 0x69))).wrap()); }
                        if !c.excerpt.is_empty() {
                            egui::CollapsingHeader::new(RichText::new("자막 보기").size(12.0).color(style::MUTED)).id_salt(("cand-text", i)).show(ui, |ui| { ui.add(egui::Label::new(RichText::new(&c.excerpt).size(12.0).color(Color32::from_rgb(0x47, 0x55, 0x69))).wrap()); });
                        }
                        ui.add_space(4.0);
                        ui.horizontal_wrapped(|ui| {
                            let b = cq_btn(ui, "이 구간으로 만들기", false, true, true, !busy).on_hover_text("이 후보 구간으로 쇼츠를 만듭니다 (지난 기록에서도 누를 수 있음)");
                            rects.push((format!("pick:{}", c.no), b.rect));
                            if b.clicked() { acts.push(Act::Pick(c.clone(), url.clone(), vtitle.clone())); }
                            if let Some(id) = yt_id(url) { if cq_btn(ui, "유튜브에서 보기", false, false, true, true).on_hover_text("웹 브라우저에서 그 시각부터 재생").clicked() { acts.push(Act::Yt(format!("https://youtu.be/{id}?t={}", c.start.floor() as i64))); } }
                        });
                    });
                    if group_start == Some(i) { first_cand_rect = Some(r.response.rect); }
                }
            }
        }
        if std::mem::take(&mut self.chat.scroll_cands) { if let Some(r) = first_cand_rect { ui.scroll_to_rect(r, Some(egui::Align::TOP)); } }
        if let Some(job) = &self.chat.job { if draw_card(ui, &job.card, rects) { acts.push(Act::Stop); } }
    }

    fn chat_start_box(&mut self, ui: &mut egui::Ui, acts: &mut Vec<Act>, rects: &mut Vec<(String, egui::Rect)>) {
        // 기록이 있으면 설명 없이 주소 칸만
        if self.chat.msgs.is_empty() {
            rich_par(ui, &[("1.", true), (" 오른쪽 위 ", false), ("AI 연결", true), ("에서 챗GPT·클로드·제미나이·오픈라우터 중 하나를 연결합니다. (처음 한 번)", false)]);
            rich_par(ui, &[("2.", true), (" 유튜브에 올린 ", false), ("설교 영상 주소", true), ("를 넣고 [불러오기]를 누릅니다.", false)]);
            rich_par(ui, &[("3.", true), (" \"결론 위주로 2분 정도\"처럼 말로 부탁하고, 화면에서 재생해 보며 계속 고쳐 달라고 하면 됩니다.", false)]);
            ui.add_space(2.0);
        }
        let busy = self.chat_busy();
        let url = ui.add(style::text_field(&mut self.chat.url, "https://youtube.com/live/... 또는 https://youtu.be/...").desired_width(f32::INFINITY));
        rects.push(("url".into(), url.rect));
        if std::mem::take(&mut self.focus_chat_url) { url.request_focus(); }
        let enter = url.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
        let w = ui.available_width();
        let lb = ui.add_enabled_ui(!busy, |ui| ui.add_sized([w, 40.0], egui::Button::new(RichText::new(if busy { "자막 불러오는 중…" } else { "불러오기" }).color(Color32::WHITE).family(style::bold()).size(15.0)).fill(style::PRIMARY).corner_radius(CornerRadius::same(12)))).inner;
        rects.push(("load".into(), lb.rect));
        if (lb.clicked() || enter) && !busy { acts.push(Act::Load(self.chat.url.clone())); }
        // 최근 작업한 영상: 누르면 바로 불러온다
        let rec = yt::recent_list(&self.settings);
        if !rec.is_empty() {
            ui.add_space(2.0);
            ui.label(RichText::new("최근 영상").size(11.5).color(style::MUTED));
            for (u, t, _) in rec {
                let r = ui.add_enabled(!busy, egui::Button::new(RichText::new(if t.is_empty() { u.clone() } else { t.clone() }).size(12.5).color(style::TEXT2)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(w, 30.0)).truncate()).on_hover_text(&u);
                if r.clicked() { self.chat.url = u.clone(); acts.push(Act::Load(u)); }
            }
        }
    }

    fn chat_quick(&mut self, ui: &mut egui::Ui, acts: &mut Vec<Act>, rects: &mut Vec<(String, egui::Rect)>) {
        let Some(v) = self.chat.video.clone() else { return };
        let busy = self.chat_busy();
        let p = self.chat.prefs.clone();
        let n = cp::count_of(&p);
        ui.horizontal(|ui| {
            let f = ui.add(egui::Button::new(RichText::new(format!("{} 편집 조건", if self.chat.cond_open { "▾" } else { "▸" })).size(13.0).family(style::bold()).color(style::TEXT)).frame(false)).on_hover_text("길이·다듬기 조건 열기/접기");
            if f.clicked() { acts.push(Act::CondFold); }
            ui.add(egui::Label::new(RichText::new(cp::conditions_summary(&p)).size(11.5).color(style::MUTED)).truncate());
        });
        let row = |ui: &mut egui::Ui, label: &str, f: &mut dyn FnMut(&mut egui::Ui)| {
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = egui::vec2(5.0, 5.0);
                ui.add_sized([38.0, 26.0], egui::Label::new(RichText::new(label).size(11.5).color(style::MUTED)));
                f(ui);
            });
        };
        if self.chat.cond_open {
            row(ui, "길이", &mut |ui| for (s, l) in cp::LENGTHS { let on = cp::js_num(p.get("length")) == s as f64; let b = cq_btn(ui, l, on, false, false, !busy); rects.push((format!("len:{s}"), b.rect)); if b.clicked() { acts.push(Act::Len(s)); } });
            row(ui, "다듬기", &mut |ui| for (k, l, _) in cp::STYLES { let on = p[k].as_bool().unwrap_or(false); let tip = TIPS.iter().find(|t| t.0 == k).map(|t| t.1).unwrap_or(""); let b = cq_btn(ui, &if on { format!("✓ {l}") } else { l.to_string() }, on, false, false, !busy).on_hover_text(tip); rects.push((format!("tog:{k}"), b.rect)); if b.clicked() { acts.push(Act::Tog(k)); } });
            row(ui, "내용", &mut |ui| for (k, l) in cp::CONTENTS { let on = p["contents"].as_array().is_some_and(|a| a.iter().any(|x| x == k)); if cq_btn(ui, &if on { format!("✓ {l}") } else { l.to_string() }, on, false, false, !busy).on_hover_text("여러 개 고를 수 있습니다. 안 고르면 상관없음").clicked() { acts.push(Act::Content(k)); } });
            row(ui, "대상", &mut |ui| for (k, l) in cp::AUDIENCES { let on = p["audience"].as_str().unwrap_or("all") == k; if cq_btn(ui, l, on, false, false, !busy).clicked() { acts.push(Act::Aud(k)); } });
            row(ui, "강도", &mut |ui| for (k, l) in INTENSITIES { let on = cp::js_num(p.get("intensity")) as i64 == k; if cq_btn(ui, l, on, false, false, !busy).on_hover_text("1 = 잔잔한 위로, 5 = 강한 도전").clicked() { acts.push(Act::Int(k)); } });
            row(ui, "후보", &mut |ui| for c in cp::COUNTS { if cq_btn(ui, &format!("{c}곳"), n == c as i64, false, false, !busy).clicked() { acts.push(Act::Count(c)); } });
        }
        let has_cands = self.chat.msgs.iter().any(|m| matches!(m, M::Cand { .. }));
        let list: Vec<(String, String, bool)> = if v.edited {
            let mut l: Vec<(String, String, bool)> = [("gaps-now", "공백 없애기", true), ("tight", "늘어지지 않게", false), ("filler", "군말·반복 빼기", false), ("questions", "질문·대답 빼기", false), ("notices", "진행 안내 빼기", false), ("shorter", "더 짧게", false), ("longer", "더 길게", false), ("ending", "결론으로 끝내기", false), ("title", "제목 다시", false), ("typos", "자막 오타 고치기", false)]
                .iter().map(|(k, l, p)| (k.to_string(), l.to_string(), *p)).collect();
            l.push(("again".into(), format!("다른 구간 {n}곳 추천"), false));
            if has_cands { l.push(("cands".into(), "앞 후보 보기".into(), false)); }
            l
        } else { vec![("recommend".into(), format!("① 구간 {n}곳 추천받기"), true), ("make".into(), "바로 만들기".into(), false)] };
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = egui::vec2(5.0, 5.0);
            for (k, l, pri) in list {
                let tip = match k.as_str() {
                    "gaps-now" => "지금 편집에서 말 사이 조용한 부분을 실제 소리로 찾아 줄입니다 (AI 안 씀, Ctrl+Z 로 되돌리기)".to_string(),
                    "cands" => "앞서 추천받은 후보 카드로 이동합니다. 다른 후보의 [이 구간으로 만들기]를 누르면 그 구간으로 다시 만듭니다.".into(),
                    "recommend" | "again" => "바로 만들지 않고 후보 3곳을 먼저 보여 줍니다. 마음에 드는 후보를 고르면 그 안에서 만듭니다.".into(),
                    "make" => "편집 조건대로 결론·적용 중심으로 바로 만듭니다".into(),
                    _ => cp::action_request(&k, &p, &Value::Null).map(|r| regex::Regex::new(r"(?s)^\[편집 조건\].*?\n\n").unwrap().replace(&r.1, "").to_string()).unwrap_or_default(),
                };
                // 다듬기 버튼은 여러 개 골라 두었다가 [한번에 적용] (공백 없애기·추천·후보 보기는 바로)
                let pickable = PICKABLE.contains(&k.as_str());
                let on = pickable && self.chat.picked.contains(&k);
                let shown = if on { format!("✓ {l}") } else { l.clone() };
                let tip = if pickable { format!("{tip}\n(눌러서 여러 개 고른 뒤 [한번에 적용])") } else { tip };
                let b = cq_btn(ui, &shown, on, pri, !on, !busy).on_hover_text(tip);
                rects.push((format!("act:{k}"), b.rect));
                if b.clicked() { acts.push(if pickable { Act::PickTrim(k) } else { Act::Do(k, Value::Null) }); }
            }
        });
        if !self.chat.picked.is_empty() {
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = egui::vec2(6.0, 5.0);
                let n = self.chat.picked.len();
                let b = cq_btn(ui, &format!("선택한 {n}개 한번에 적용"), false, true, true, !busy).on_hover_text("고른 다듬기를 한 번의 요청으로 모두 반영합니다");
                rects.push(("act:apply-picked".into(), b.rect));
                if b.clicked() { acts.push(Act::ApplyPicked); }
                if cq_btn(ui, "고른 것 지우기", false, false, true, !busy).clicked() { acts.push(Act::ClearPicked); }
            });
        }
    }

    pub(crate) fn right_column(&mut self, ui: &mut egui::Ui) {
        let mut acts: Vec<Act> = vec![];
        let mut rects: Vec<(String, egui::Rect)> = vec![];
        style::card().inner_margin(egui::Margin::same(0)).show(ui, |ui| {
            ui.set_min_size(ui.available_size());
            let full = ui.available_rect_before_wrap();
            // 머리: 제목 · AI 연결 상태 · [새로] · 기록 지우기 · 접기
            egui::Frame::new().inner_margin(egui::Margin { left: 18, right: 14, top: 14, bottom: 12 }).show(ui, |ui| {
                let narrow = ui.available_width() < 336.0;
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = if narrow { 5.0 } else { 8.0 };
                    ui.add(crate::icons::img("message-square", 19.0, style::TEXT2));
                    ui.label(RichText::new("AI 편집 대화").size(if narrow { 15.5 } else { 18.0 }).family(style::bold()).color(style::TEXT));
                    if !narrow { self.chat_chip(ui); }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.spacing_mut().item_spacing.x = 4.0;
                        { let fb = style::icon_btn(ui, "panel-right-close", 17.0, style::MUTED, "대화 창 접기"); rects.push(("fold".into(), fb.rect)); if fb.clicked() { acts.push(Act::Fold); } }
                        let tr = style::icon_btn(ui, "trash-2", 17.0, style::MUTED, "대화 기록 지우기");
                        rects.push(("clear".into(), tr.rect));
                        if tr.clicked() { acts.push(Act::Clear); }
                        let b = egui::Button::image_and_text(crate::icons::img("plus", 14.0, style::TEXT2), RichText::new(if narrow { "" } else { "새로" }).size(12.0).color(style::TEXT2).family(style::semi()))
                            .fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(9)).min_size(egui::vec2(0.0, 28.0));
                        let nb = ui.add(b).on_hover_text("다른 영상으로 새로 시작 (지금 대화와 편집은 위에 남고, 편집은 자동 저장됩니다)");
                        rects.push(("new".into(), nb.rect));
                        if nb.clicked() { acts.push(Act::New); }
                    });
                });
                if narrow { ui.add_space(6.0); ui.horizontal(|ui| self.chat_chip(ui)); }
            });
            let (r, _) = ui.allocate_exact_size(egui::vec2(full.width(), 1.0), egui::Sense::hover());
            ui.painter().rect_filled(r, 0.0, style::BORDER);
            // 아래: 입력 칸(고정) + 그 위 편집 조건 버튼(지난 화면 높이) + 남은 곳에 대화 본문
            let compose_h = 142.0;
            let quick_h = if self.chat.video.is_some() { self.chat.quick_h } else { 0.0 };
            let top = ui.cursor().top();
            let body_bottom = (full.bottom() - compose_h - quick_h).max(top + 60.0);
            let body_rect = egui::Rect::from_min_max(egui::pos2(full.left(), top), egui::pos2(full.right(), body_bottom));
            ui.painter().rect_filled(body_rect, 0.0, style::BG);
            ui.scope_builder(egui::UiBuilder::new().max_rect(body_rect), |ui| {
                ui.set_clip_rect(body_rect);
                egui::ScrollArea::vertical().id_salt("chat-body").auto_shrink([false, false]).stick_to_bottom(true).show(ui, |ui| {
                    egui::Frame::new().inner_margin(egui::Margin::same(14)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.spacing_mut().item_spacing.y = 10.0;
                        self.chat_messages(ui, &mut acts, &mut rects);
                        if self.chat.video.is_none() { self.chat_start_box(ui, &mut acts, &mut rects); }
                    });
                });
            });
            // 편집 조건·바로 하기 버튼
            if self.chat.video.is_some() {
                let qrect = egui::Rect::from_min_max(egui::pos2(full.left(), body_rect.bottom()), egui::pos2(full.right(), full.bottom() - compose_h));
                ui.painter().hline(qrect.x_range(), qrect.top(), Stroke::new(1.0, style::BORDER));
                let used = ui.scope_builder(egui::UiBuilder::new().max_rect(egui::Rect::from_min_max(qrect.min, egui::pos2(qrect.right(), full.bottom()))), |ui| {
                    egui::Frame::new().inner_margin(egui::Margin::symmetric(14, 10)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.spacing_mut().item_spacing.y = 7.0;
                        self.chat_quick(ui, &mut acts, &mut rects);
                    }).response.rect.height()
                }).inner;
                if (used - self.chat.quick_h).abs() > 0.5 { self.chat.quick_h = used; ui.ctx().request_repaint(); }
            }
            // 입력
            let crect = egui::Rect::from_min_max(egui::pos2(full.left(), full.bottom() - compose_h), full.max);
            ui.painter().rect_filled(crect, 0.0, Color32::WHITE);
            ui.painter().hline(crect.x_range(), crect.top(), Stroke::new(1.0, style::BORDER));
            let on = self.chat.video.is_some() && !self.chat_busy();
            ui.scope_builder(egui::UiBuilder::new().max_rect(crect.shrink2(egui::vec2(14.0, 12.0))), |ui| {
                let id = egui::Id::new("chat-text");
                let mut send = false;
                if on && ui.memory(|m| m.has_focus(id)) && ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Enter)) { send = true; }
                let te = ui.add_enabled(on, egui::TextEdit::multiline(&mut self.chat_input).id(id).hint_text(if self.chat.video.as_ref().is_some_and(|v| v.edited) { "예: 결론 부분으로 2분 정도 만들어 줘" } else { "예: 결론 부분으로 2분 정도 만들어 줘\n비워 두고 [보내기]를 누르면 구간 3곳을 추천받습니다" }).desired_rows(3).desired_width(f32::INFINITY).margin(egui::Margin::same(12)));
                rects.push(("text".into(), te.rect));
                if on && std::mem::take(&mut self.chat.focus_text) { te.request_focus(); }
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    let edited = self.chat.video.as_ref().is_some_and(|v| v.edited);
                    let ex = ui.add_enabled(edited, egui::Button::new(RichText::new("영상 만들기").size(13.5).family(style::semi())).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(0.0, 34.0)))
                        .on_hover_text("완성 영상(MP4)과 자막(SRT) 만들기");
                    if ex.clicked() { acts.push(Act::Export); }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let sb = ui.add_enabled(on, egui::Button::new(RichText::new("보내기 (Enter)").color(Color32::WHITE).family(style::bold())).fill(style::PRIMARY).corner_radius(CornerRadius::same(12)).min_size(egui::vec2(0.0, 36.0)))
                            .on_hover_text(if edited { "쓴 내용을 보냅니다 (비워 두면 골라 둔 다듬기를 한번에 적용)" } else { "쓴 내용으로 바로 만들기 · 비워 두면 구간 3곳 추천받기" });
                        rects.push(("send".into(), sb.rect));
                        if sb.clicked() { send = true; }
                    });
                });
                if send {
                    let t = std::mem::take(&mut self.chat_input);
                    if !t.trim().is_empty() { acts.push(Act::Send(t, None)); }
                    else {
                        self.chat_input = t;
                        // 비워 두고 보내기: 처음이면 구간 추천부터, 다듬기를 골라 두었으면 한번에 적용 (처음 쓰는 사람도 [보내기]만으로 시작)
                        let edited = self.chat.video.as_ref().is_some_and(|v| v.edited);
                        if !edited { acts.push(Act::Do("recommend".into(), Value::Null)); }
                        else if !self.chat.picked.is_empty() { acts.push(Act::ApplyPicked); }
                        else { self.toast("바꾸고 싶은 내용을 쓰거나 위의 다듬기 단추를 골라 주세요."); }
                    }
                }
            });
        });
        self.chat.rects = rects;
        for a in acts { self.chat_act(a); }
    }
}

fn fmt_n(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() { if i > 0 && (s.len() - i) % 3 == 0 { out.push(','); } out.push(ch); }
    out
}
/// 자동 저장 파일 이름용 시각 (YYYYMMDD-HHMMSS, 이 PC 시간대)
fn chrono_stamp() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) + yt::local_offset_secs();
    let (days, rem) = (now.div_euclid(86400), now.rem_euclid(86400));
    let (y, m, d) = yt::civil_from_days(days);
    format!("{y:04}{m:02}{d:02}-{:02}{:02}{:02}", rem / 3600, (rem % 3600) / 60, rem % 60)
}
