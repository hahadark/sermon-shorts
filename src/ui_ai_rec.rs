//! AI 쇼츠 추천 창 (기존 renderer/ai-ui.js openAiRecommend)과 AI 용어 교정 (doAiCorrect). 제미나이 키가 필요하다.
//! 추천: 조건 고르기 → 유튜브 주소 [분석] → 설교·후보 카드 → [미리보기](구간 고르기 창) / [이 구간으로 만들기](그 구간 받기·자막 → 문장 경계로 자르기)
use crate::*;
use serde_json::{json, Value};
use sermon_shorts::ai;
use sermon_shorts::youtube as yt;
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};

const TYPE_LABELS: [(&str, &str); 8] = [("core", "핵심 메시지"), ("story", "예화·이야기"), ("exposition", "본문 해설"), ("application", "삶의 적용"), ("comfort", "위로·격려"), ("challenge", "도전·결단"), ("gospel", "복음 제시"), ("prayer", "기도·축복")];
const INTENSITY_LABELS: [&str; 6] = ["", "아주 잔잔(위로·묵상)", "잔잔", "균형", "힘 있게", "아주 강렬(선포·도전)"];
const AUDIENCES: [(&str, &str); 4] = [("all", "누구나"), ("members", "성도"), ("seekers", "새신자·전도"), ("youth", "청년")];

/// 고른 후보 (자막이 생기면 그 구간으로 자른다)
pub(crate) struct Pending { url: String, start: f64, end: f64, first: String, last: String, title: String, scripture: String }

pub(crate) struct RecState {
    pub open: bool,
    pub cond: Value,
    pub url: String,
    pub prog: Arc<Mutex<String>>,
    rx: Option<Receiver<Result<Value, String>>>,
    pub result: Option<Value>,
    cur_url: String,
    preview_rx: Option<Receiver<Result<(String, yt::Formats, f64, f64), String>>>,
    pub pending: Option<Pending>,
    correct_rx: Option<Receiver<Result<Vec<(String, String)>, String>>>,
    pub rects: Vec<(String, egui::Rect)>,
    pub last_toast: String,
}
impl Default for RecState {
    fn default() -> Self { RecState { open: false, cond: load_cond(), url: String::new(), prog: Arc::new(Mutex::new(String::new())), rx: None, result: None, cur_url: String::new(), preview_rx: None, pending: None, correct_rx: None, rects: vec![], last_toast: String::new() } }
}

fn cond_file() -> PathBuf { sermon_shorts::theme::user_data_dir().join("ai_cond.json") }
fn load_cond() -> Value {
    let mut c = json!({ "lengthRange": "60~90", "minSec": 60, "maxSec": 90, "count": 4, "intensity": 3, "intensityNone": false, "types": [], "audience": "all", "extra": "" });
    if let Ok(t) = std::fs::read_to_string(cond_file()) { if let Ok(Value::Object(o)) = serde_json::from_str::<Value>(&t) { for (k, v) in o { c[k] = v; } } }
    if !AUDIENCES.iter().any(|a| Some(a.0) == c["audience"].as_str()) { c["audience"] = json!("all"); }
    let types: Vec<Value> = c["types"].as_array().map(|a| a.iter().filter(|t| TYPE_LABELS.iter().any(|x| Some(x.0) == t.as_str())).cloned().collect()).unwrap_or_default();
    c["types"] = json!(types);
    c
}
fn fmt(t: f64) -> String { edl::format_time(t, false) }
fn chip(ui: &mut egui::Ui, text: &str, on: bool) -> egui::Response {
    let (fill, stroke, col) = if on { (style::PRIMARY_SOFT, Color32::from_rgb(0x93, 0xb4, 0xf5), Color32::from_rgb(0x1d, 0x4e, 0xd8)) } else { (Color32::WHITE, style::BORDER_STRONG, style::TEXT2) };
    ui.add(egui::Button::new(RichText::new(text).size(12.5).family(style::semi()).color(col)).fill(fill).stroke(Stroke::new(1.0, stroke)).corner_radius(CornerRadius::same(255)).min_size(egui::vec2(0.0, 28.0)))
}

impl App {
    /// 자막 도구 [용어 교정] 을 쓸 수 있는지 (영상·자막이 있을 때)
    pub(crate) fn ai_can_correct(&self) -> bool { !self.project.words.is_empty() && self.rec.correct_rx.is_none() }

    /// 자막 → AI 용어 교정 (기존 doAiCorrect): 남긴 단어의 교회 용어·고유명사·오타만 고친다
    pub(crate) fn cmd_ai_correct(&mut self) {
        if self.project.words.is_empty() || self.rec.correct_rx.is_some() { return; }
        let kept: Vec<(i64, String)> = self.project.words.iter().filter(|w| !w.del).map(|w| (w.id, w.text.clone())).collect();
        if kept.is_empty() { self.toast("교정할 단어가 없습니다."); return; }
        if kept.len() > 400 { self.toast("400단어 이내만 교정 가능합니다."); return; }
        self.toast("AI 용어 교정 중...");
        let key = sermon_shorts::llm::gemini_key(&self.settings);
        let (title, verse) = (self.title.clone(), self.verse.clone());
        let (tx, rx) = channel();
        std::thread::spawn(move || { let _ = tx.send(ai::correct_terms(&key, ai::DEFAULT_MODEL, &kept, &title, &verse)); });
        self.rec.correct_rx = Some(rx);
    }

    /// AI → AI 쇼츠 추천
    pub(crate) fn cmd_ai_recommend(&mut self) { self.rec.open = true; }

    fn rec_analyze(&mut self) {
        let url = self.rec.url.trim().to_string();
        if url.is_empty() { self.toast("URL을 입력하세요."); return; }
        if self.rec.rx.is_some() { return; }
        self.rec.cur_url = url.clone();
        // 조건 정리·저장 (기존 ss_ai_cond)
        let c = &mut self.rec.cond;
        let range = c["lengthRange"].as_str().unwrap_or("60~90").to_string();
        let (mut a, mut b): (i64, i64);
        if range == "direct" {
            a = c["minSec"].as_i64().unwrap_or(60); b = c["maxSec"].as_i64().unwrap_or(0);
            if a <= 0 { a = 60; }
            if b <= 0 { b = a + 30; }
            if b < a { std::mem::swap(&mut a, &mut b); }
            if a == b { b = a + 10; }
        } else { let p: Vec<i64> = range.split('~').filter_map(|x| x.parse().ok()).collect(); a = p.first().copied().unwrap_or(60); b = p.get(1).copied().unwrap_or(90); }
        c["minSec"] = json!(a); c["maxSec"] = json!(b);
        let mut cnt = c["count"].as_i64().unwrap_or(4);
        if cnt < 2 { cnt = if cnt > 0 { 2 } else { 4 }; }
        c["count"] = json!(cnt.min(8));
        c["extra"] = json!(c["extra"].as_str().unwrap_or("").trim());
        let _ = std::fs::write(cond_file(), c.to_string());
        let c = c.clone();
        self.rec.result = None;
        let s = self.settings.clone();
        let prog = self.rec.prog.clone();
        *prog.lock().unwrap() = "영상 정보를 불러오고 있습니다...".into();
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            let r = (|| -> Result<Value, String> {
                let info = yt::fetch_info(&url)?;
                *prog.lock().unwrap() = "자동 자막을 분석하고 있습니다...".into();
                let subs = yt::fetch_auto_subs(&url)?.unwrap_or_default();
                if subs.is_empty() { return Err("no-subs".into()); }
                *prog.lock().unwrap() = format!("AI가 설교의 핵심 구간을 찾고 있습니다… (자막 {}줄, 보통 10~30초)", subs.len());
                let tpl = &s["template"];
                let model = s["aiModel"].as_str().or(tpl["aiModel"].as_str()).unwrap_or("").to_string();
                let o = ai::RecOpts {
                    video_title: info.title.clone(), description: info.description.clone(), model,
                    church: tpl["churchName"].as_str().filter(|x| !x.is_empty()).unwrap_or("우리 교회").into(),
                    count: c["count"].as_i64().unwrap_or(4), min_sec: c["minSec"].as_i64().unwrap_or(60), max_sec: c["maxSec"].as_i64().unwrap_or(90),
                    intensity: if c["intensityNone"].as_bool().unwrap_or(false) { 0 } else { c["intensity"].as_i64().unwrap_or(3) },
                    types: c["types"].as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect()).unwrap_or_default(),
                    audience: c["audience"].as_str().unwrap_or("all").into(), extra: c["extra"].as_str().unwrap_or("").into(),
                };
                let lines: Vec<(f64, String)> = subs.iter().map(|l| (l.start, l.text.clone())).collect();
                let mut r = ai::analyze_sermon(&sermon_shorts::llm::gemini_key(&s), s["churchTerms"].as_str().unwrap_or(""), &lines, &o)?;
                r["videoTitle"] = json!(info.title); r["videoDuration"] = json!(info.duration);
                Ok(r)
            })();
            let _ = tx.send(r);
        });
        self.rec.rx = Some(rx);
    }

    fn rec_preview(&mut self, start: f64, end: f64) {
        if self.rec.cur_url.is_empty() || self.rec.preview_rx.is_some() { return; }
        let url = self.rec.cur_url.clone();
        let (tx, rx) = channel();
        std::thread::spawn(move || { let _ = tx.send(yt::resolve_formats(&url, false).map(|f| (url, f, start, end))); });
        self.rec.preview_rx = Some(rx);
    }

    /// [이 구간으로 만들기]: 그 구간을 받아 자막을 만든 뒤 문장 경계로 자른다 (기존 onSelectCandidate)
    fn rec_select(&mut self, c: &Value) {
        let res = self.rec.result.clone().unwrap_or(json!({}));
        let (start, end) = (c["start"].as_f64().unwrap_or(0.0), c["end"].as_f64().unwrap_or(0.0));
        self.rec.open = false;
        if self.import.dlg.is_some() { self.toast("가져오기 창을 먼저 닫아 주세요"); return; }
        self.rec.pending = Some(Pending { url: self.rec.cur_url.clone(), start, end, first: c["firstSentence"].as_str().unwrap_or("").into(), last: c["lastSentence"].as_str().unwrap_or("").into(),
            title: c["shortsTitle"].as_str().unwrap_or("").into(), scripture: res["sermon"]["scripture"].as_str().unwrap_or("").into() });
        let f = self.start_fetch(self.rec.cur_url.clone(), start, end, false, res["videoTitle"].as_str().unwrap_or("").into(), res["videoDuration"].as_f64().unwrap_or(0.0));
        self.import.dlg = Some(crate::ui_import::Dlg::Fetch(f));
    }

    /// 자막이 생겼을 때: 고른 후보가 있으면 그 구간만 남긴다
    pub(crate) fn rec_on_transcript(&mut self) {
        let Some(p) = self.rec.pending.take() else { return };
        let src = self.project.rest.get("source").cloned().unwrap_or(json!({}));
        if src["url"].as_str() != Some(p.url.as_str()) { return; }
        self.push_undo();
        let off = src["offset"].as_f64().unwrap_or(0.0);
        let ws: Vec<(String, f64, f64)> = self.project.words.iter().map(|w| (w.text.clone(), w.start + off, w.end + off)).collect();
        let Some((si, ei)) = ai::match_candidate(&ws, p.start, p.end, &p.first, &p.last) else { return };
        for (i, w) in self.project.words.iter_mut().enumerate() { if i < si || i > ei { w.del = true; } }
        sermon_shorts::tidy::auto_clean(&mut self.project.words, 1.0, None);
        self.title = p.title.clone();
        self.verse = p.scripture.clone();
        let sp = self.settings["defaultSpeaker"].as_str().filter(|s| !s.is_empty()).map(String::from).or_else(|| self.speakers().first().cloned()).unwrap_or_default();
        if !sp.is_empty() { if self.speakers().contains(&sp) { self.speaker_pick = sp; } else { self.speaker_pick = crate::SPEAKER_CUSTOM.into(); self.speaker_custom = sp; } }
        self.recompute();
        self.unsaved = true;
        if let Some(w) = self.project.words.get(si) { let t = w.start; self.player.seek_src(t); }
        self.toast("AI 편집 반영 완료");
    }

    /// 매 화면: 일 받기 + 창
    pub(crate) fn rec_ui(&mut self, ctx: &egui::Context) {
        if let Some(rx) = &self.rec.correct_rx {
            if let Ok(r) = rx.try_recv() {
                self.rec.correct_rx = None;
                match r {
                    Ok(list) => {
                        self.push_undo();
                        let map: std::collections::HashMap<String, String> = list.into_iter().collect();
                        let mut n = 0;
                        for w in self.project.words.iter_mut() {
                            if w.del { continue; }
                            // 제미나이는 id 를 글자로 돌려준다 (Electron 판은 숫자 id 와 비교해 하나도 못 고치던 것을 바로잡음)
                            if let Some(t) = map.get(&w.id.to_string()) { if *t != w.text { w.extra.insert("_oldText".into(), json!(w.text)); w.text = t.clone(); n += 1; } }
                        }
                        if n > 0 { self.commit(); }
                        self.recompute();
                        self.toast(format!("교정 완료 ({n} 단어 수정됨)"));
                    }
                    Err(e) => self.toast(format!("교정 오류: {e}")),
                }
            } else { ctx.request_repaint_after(std::time::Duration::from_millis(200)); }
        }
        if let Some(rx) = &self.rec.preview_rx {
            if let Ok(r) = rx.try_recv() {
                self.rec.preview_rx = None;
                match r {
                    Ok((url, info, a, b)) => { if self.import.dlg.is_none() { let pk = self.new_picker(url, info, Some((a, b))); self.import.dlg = Some(crate::ui_import::Dlg::Picker(Box::new(pk))); self.rec.open = false; } }
                    Err(e) => self.toast(format!("미리보기 오류: {e}")),
                }
            }
        }
        if let Some(rx) = &self.rec.rx {
            if let Ok(r) = rx.try_recv() {
                self.rec.rx = None;
                *self.rec.prog.lock().unwrap() = String::new();
                match r {
                    Ok(v) => self.rec.result = Some(v),
                    Err(e) if e == "no-subs" => self.toast("한국어 자동 자막이 없습니다. 영상 열기로 직접 작업하세요."),
                    Err(e) => { *self.rec.prog.lock().unwrap() = "분석 중 오류가 발생했습니다.".into(); self.toast(format!("오류: {e}")); }
                }
            } else { ctx.request_repaint_after(std::time::Duration::from_millis(200)); }
        }
        if !self.rec.open { return; }
        let busy = self.rec.rx.is_some();
        let mut close = false;
        let mut analyze = false;
        let mut select: Option<Value> = None;
        let mut preview: Option<(f64, f64)> = None;
        let mut rects: Vec<(String, egui::Rect)> = vec![];
        let frame = egui::Frame::new().fill(style::PANEL).corner_radius(CornerRadius::same(18)).inner_margin(egui::Margin::symmetric(24, 20))
            .shadow(egui::epaint::Shadow { offset: [0, 30], blur: 80, spread: 0, color: Color32::from_rgba_unmultiplied(15, 23, 42, 71) });
        let mr = egui::Modal::new(egui::Id::new("ai-recommend")).frame(frame).show(ctx, |ui| {
            ui.set_width(760.0 - 48.0);
            ui.horizontal(|ui| {
                ui.label(RichText::new("AI 쇼츠 추천").size(19.0).family(style::bold()).color(style::TEXT));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| { if style::icon_btn(ui, "x", 18.0, style::FAINT, "닫기").clicked() { close = true; } });
            });
            ui.add_space(8.0);
            let maxh = ctx.content_rect().height() * 0.72;
            egui::ScrollArea::vertical().max_height(maxh).min_scrolled_height(maxh.min(520.0)).auto_shrink([false, true]).show(ui, |ui| {
                ui.spacing_mut().item_spacing = egui::vec2(6.0, 8.0);
                let c = &mut self.rec.cond;
                let lab = |ui: &mut egui::Ui, s: &str| { ui.add_sized([72.0, 28.0], egui::Label::new(RichText::new(s).size(12.5).family(style::semi()).color(style::MUTED))); };
                ui.horizontal_wrapped(|ui| {
                    lab(ui, "길이 (초)");
                    for v in ["30~60", "60~90", "90~120", "direct"] {
                        let on = c["lengthRange"].as_str() == Some(v);
                        if chip(ui, if v == "direct" { "직접" } else { v }, on).clicked() { c["lengthRange"] = json!(v); }
                    }
                    if c["lengthRange"].as_str() == Some("direct") {
                        let (mut a, mut b) = (c["minSec"].as_i64().unwrap_or(60), c["maxSec"].as_i64().unwrap_or(90));
                        if ui.add(egui::DragValue::new(&mut a).range(10..=600)).changed() { c["minSec"] = json!(a); }
                        ui.label("~");
                        if ui.add(egui::DragValue::new(&mut b).range(10..=600)).changed() { c["maxSec"] = json!(b); }
                    }
                    ui.add_space(8.0);
                    ui.label(RichText::new("개수").size(12.5).color(style::MUTED));
                    let mut n = c["count"].as_i64().unwrap_or(4);
                    if ui.add(egui::DragValue::new(&mut n).range(2..=8)).changed() { c["count"] = json!(n); }
                    ui.add_space(8.0);
                    ui.label(RichText::new("대상").size(12.5).color(style::MUTED));
                    let cur = c["audience"].as_str().unwrap_or("all").to_string();
                    egui::ComboBox::from_id_salt("rec-aud").width(110.0).selected_text(AUDIENCES.iter().find(|a| a.0 == cur).map(|a| a.1).unwrap_or("누구나")).show_ui(ui, |ui| {
                        for (k, l) in AUDIENCES { if ui.selectable_label(cur == k, l).clicked() { c["audience"] = json!(k); } }
                    });
                });
                ui.horizontal(|ui| {
                    lab(ui, "강도");
                    let none = c["intensityNone"].as_bool().unwrap_or(false);
                    let mut v = c["intensity"].as_i64().unwrap_or(3);
                    ui.scope(|ui| {
                        ui.spacing_mut().slider_width = 220.0;
                        ui.spacing_mut().slider_rail_height = 6.0;
                        let w = &mut ui.visuals_mut().widgets;
                        w.inactive.bg_fill = style::BORDER_STRONG; w.hovered.bg_fill = style::BORDER_STRONG; w.active.bg_fill = style::BORDER_STRONG;
                        ui.visuals_mut().selection.bg_fill = style::PRIMARY;
                        if ui.add_enabled(!none, egui::Slider::new(&mut v, 1..=5).show_value(false).trailing_fill(true)).changed() { c["intensity"] = json!(v); }
                    });
                    ui.label(RichText::new(if none { "상관없음".to_string() } else { format!("{v} {}", INTENSITY_LABELS[v.clamp(1, 5) as usize]) }).size(12.5).color(if none { style::FAINT } else { style::TEXT2 }));
                    let mut nn = none;
                    if ui.checkbox(&mut nn, RichText::new("상관없음").size(12.5)).changed() { c["intensityNone"] = json!(nn); }
                });
                ui.horizontal_wrapped(|ui| {
                    lab(ui, "내용 유형");
                    for (k, l) in TYPE_LABELS {
                        let mut types: Vec<String> = c["types"].as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect()).unwrap_or_default();
                        let on = types.iter().any(|t| t == k);
                        if chip(ui, l, on).clicked() { if on { types.retain(|t| t != k); } else { types.push(k.into()); } c["types"] = json!(types); }
                    }
                });
                ui.horizontal(|ui| {
                    lab(ui, "추가 요청");
                    let mut ex = c["extra"].as_str().unwrap_or("").to_string();
                    if ui.add(style::text_field(&mut ex, "예: 우영우 이야기 부분").desired_width(f32::INFINITY)).changed() { c["extra"] = json!(ex); }
                });
                ui.horizontal(|ui| {
                    lab(ui, "유튜브 주소");
                    let w = ui.available_width() - 80.0;
                    let te = ui.add(style::text_field(&mut self.rec.url, "https://www.youtube.com/watch?v=...").desired_width(w));
                    rects.push(("url".into(), te.rect));
                    if te.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) && !busy { analyze = true; }
                    let b = ui.add_enabled(!busy, egui::Button::new(RichText::new("분석").color(Color32::WHITE).family(style::bold())).fill(style::PRIMARY).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(70.0, 32.0)));
                    rects.push(("analyze".into(), b.rect));
                    if b.clicked() { analyze = true; }
                });
                let p = self.rec.prog.lock().unwrap().clone();
                if !p.is_empty() { ui.horizontal(|ui| { if busy { ui.add(egui::Spinner::new().size(14.0)); } ui.label(RichText::new(p).size(12.5).color(style::MUTED)); }); }
                if let Some(res) = &self.rec.result {
                    ui.add_space(4.0);
                    let u = &res["usage"];
                    ui.label(RichText::new(format!("분석 모델: {} · 토큰 {}/{}", res["model"].as_str().unwrap_or("기본"), u["promptTokenCount"].as_i64().unwrap_or(0), u["candidatesTokenCount"].as_i64().unwrap_or(0))).size(11.5).color(style::FAINT));
                    let sm = &res["sermon"];
                    egui::Frame::new().fill(style::PANEL2).corner_radius(CornerRadius::same(12)).inner_margin(egui::Margin::symmetric(14, 10)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.horizontal_wrapped(|ui| {
                            ui.label(RichText::new("설교").size(13.0).family(style::bold()).color(style::PRIMARY));
                            ui.label(RichText::new(format!("{} · {} · {} ~ {}", sm["title"].as_str().unwrap_or(""), sm["scripture"].as_str().unwrap_or(""), fmt(sm["start"].as_f64().unwrap_or(0.0)), fmt(sm["end"].as_f64().unwrap_or(0.0)))).size(13.0).color(style::TEXT));
                        });
                        ui.add(egui::Label::new(RichText::new(sm["mainMessage"].as_str().unwrap_or("")).size(12.5).color(style::TEXT2)).wrap());
                    });
                    let cands = res["candidates"].as_array().cloned().unwrap_or_default();
                    ui.label(RichText::new(format!("쇼츠 추천 후보 {}개", cands.len())).size(13.0).family(style::bold()).color(style::PRIMARY));
                    for (i, c) in cands.iter().enumerate() {
                        egui::Frame::new().fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(14)).inner_margin(egui::Margin::symmetric(14, 12)).show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            ui.horizontal(|ui| {
                                egui::Frame::new().fill(style::PRIMARY).corner_radius(CornerRadius::same(255)).inner_margin(egui::Margin::symmetric(8, 2)).show(ui, |ui| ui.label(RichText::new(chat_plan_num(&c["score"])).size(12.0).family(style::bold()).color(Color32::WHITE)));
                                ui.add(egui::Label::new(RichText::new(c["shortsTitle"].as_str().unwrap_or("")).size(14.5).family(style::bold()).color(style::TEXT)).truncate());
                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                    let s = ui.add(egui::Button::new(RichText::new("이 구간으로 만들기").size(12.0).family(style::bold()).color(Color32::WHITE)).fill(style::PRIMARY).corner_radius(CornerRadius::same(9)).min_size(egui::vec2(0.0, 28.0)));
                                    rects.push((format!("select:{i}"), s.rect));
                                    if s.clicked() { select = Some(c.clone()); }
                                    let p = ui.add(egui::Button::new(RichText::new("미리보기").size(12.0).family(style::semi())).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(9)).min_size(egui::vec2(0.0, 28.0)));
                                    if p.clicked() { preview = Some((c["start"].as_f64().unwrap_or(0.0), c["end"].as_f64().unwrap_or(0.0))); }
                                });
                            });
                            ui.horizontal_wrapped(|ui| {
                                let (a, b) = (c["start"].as_f64().unwrap_or(0.0), c["end"].as_f64().unwrap_or(0.0));
                                ui.label(RichText::new(format!("{} ~ {}", fmt(a), fmt(b))).size(12.0).color(style::TEXT2));
                                ui.label(RichText::new(format!("({}초)", (b - a).round() as i64)).size(12.0).color(style::FAINT));
                                if let Some(n) = c["intensity"].as_f64().filter(|n| *n != 0.0) { ui.label(RichText::new(format!("강도 {}/5", n.round() as i64)).size(12.0).color(style::WARN)); }
                                for t in c["types"].as_array().into_iter().flatten() {
                                    let k = t.as_str().unwrap_or("");
                                    let l = TYPE_LABELS.iter().find(|x| x.0 == k).map(|x| x.1).unwrap_or(k);
                                    egui::Frame::new().fill(style::PANEL3).corner_radius(CornerRadius::same(255)).inner_margin(egui::Margin::symmetric(7, 1)).show(ui, |ui| ui.label(RichText::new(l).size(11.5).color(style::TEXT2)));
                                }
                            });
                            ui.add(egui::Label::new(RichText::new(format!("시작: {}\n끝: {}", c["firstSentence"].as_str().unwrap_or(""), c["lastSentence"].as_str().unwrap_or(""))).size(12.0).color(style::MUTED)).wrap());
                            ui.add(egui::Label::new(RichText::new(c["reason"].as_str().unwrap_or("")).size(12.5).color(style::TEXT2)).wrap());
                        });
                    }
                }
            });
            ui.add_space(10.0);
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.add(egui::Button::new(RichText::new("닫기").size(13.0)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(0.0, 34.0))).clicked() { close = true; }
            });
        });
        self.rec.rects = rects;
        if mr.backdrop_response.clicked() || ctx.input(|i| i.key_pressed(egui::Key::Escape)) { close = true; }
        if analyze { self.rec_analyze(); }
        if let Some(c) = select { self.rec_select(&c); return; }
        if let Some((a, b)) = preview { self.rec_preview(a, b); }
        if close { self.rec.open = false; }
    }
}

fn chat_plan_num(v: &Value) -> String { v.as_f64().map(|x| if x.fract() == 0.0 { format!("{}", x as i64) } else { format!("{x}") }).unwrap_or_default() }
