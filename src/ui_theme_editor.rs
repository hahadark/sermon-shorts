//! 테마 편집기 (기존 theme-editor.js · main/theme-storage.js): 요소 목록·속성 칸·1080×1920 미리보기(끌어 옮기기, 화살표, 가운데 맞춤),
//! 실행 취소, 새 테마·복제·이름 변경·가져오기·내보내기·글꼴 추가·삭제, 저장, 이 테마 사용.
use crate::*;
use serde_json::{json, Value};
use sermon_shorts::template;
use sermon_shorts::theme;
use std::sync::mpsc::{channel, Receiver};

const ELEMENTS: [(&str, &str); 9] = [("canvas", "배경"), ("title", "제목"), ("verse", "성경 구절"), ("video", "영상"), ("subtitle", "자막"), ("badge", "이름표"), ("churchName", "교회 이름"), ("speaker", "설교자"), ("logo", "로고")];
const ALIGN_OPTS: [(&str, &str); 3] = [("left", "왼쪽"), ("center", "가운데"), ("right", "오른쪽")];
const MODE_OPTS: [(&str, &str); 3] = [("solid", "단색"), ("gradient", "그라데이션"), ("blur", "흐린 영상")];
const ANCHOR_OPTS: [(&str, &str); 3] = [("center", "가운데 기준"), ("top", "위 기준 (아래로 늘어남)"), ("bottom", "아래 기준 (위로 늘어남)")];
const KARAOKE_OPTS: [(&str, &str); 3] = [("none", "끄기"), ("current", "말하는 단어만"), ("progressive", "읽은 단어까지")];
const BOXMODE_OPTS: [(&str, &str); 2] = [("line", "줄마다"), ("block", "한 덩어리")];
const TEXT_KEYS: [&str; 3] = ["title", "verse", "subtitle"];

#[derive(Clone, Copy, PartialEq)]
enum Ask { New, Clone { then_save: bool }, Rename }

pub(crate) struct Ed {
    pub theme: Value,
    pub sel: &'static str,
    pub dirty: bool,
    hist: Vec<Value>,
    hist_at: usize,
    hist_pending: bool,
    tex: Option<egui::TextureHandle>,
    rx: Option<Receiver<egui::ColorImage>>,
    need_render: bool,
    safe: bool,
    drag: Option<((f64, f64), (f64, f64))>,
    guide_x: bool,
    ask: Option<(Ask, String)>,
    fonts: Vec<String>,
    pub rects: Vec<(String, egui::Rect)>,
    pub rendered: bool,
}
impl Ed {
    pub fn ask_open(&self) -> bool { self.ask.is_some() }
    /// 시험용: 테마와 단추 자리만 복사
    pub fn clone_view(&self) -> EdView { EdView { theme: self.theme.clone(), rects: self.rects.clone() } }
    fn new(t: Value) -> Ed {
        Ed { hist: vec![t.clone()], hist_at: 0, theme: t, sel: "title", dirty: false, hist_pending: false, tex: None, rx: None, need_render: true, safe: true, drag: None, guide_x: false, ask: None, fonts: template::FontBook::global().families(), rects: vec![], rendered: false }
    }
}

#[derive(Default)]
pub(crate) struct State { pub ed: Option<Box<Ed>>, /// 기본 테마에서 [이 테마 사용] → 복제 이름을 받은 뒤 저장하고 적용까지
    pub apply_after_clone: bool }
pub(crate) struct EdView { pub theme: Value, pub rects: Vec<(String, egui::Rect)> }

fn num(v: &Value) -> f64 { theme::num(v).unwrap_or(0.0) }
fn is_user(t: &Value) -> bool { t["id"].as_str().unwrap_or("").starts_with("user-") || t["userPreset"].as_bool() == Some(true) }
fn now_ms() -> u128 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0) }
fn themes_dir() -> PathBuf { theme::user_data_dir().join("themes") }
fn fonts_dir() -> PathBuf { theme::user_data_dir().join("fonts") }
/// 테마 id 를 파일 이름으로 쓰므로 폴더를 벗어나는 id 는 받지 않는다
fn theme_file(id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.starts_with('.') || id.contains(['/', '\\', ':']) { return Err(format!("테마 id가 올바르지 않습니다: {id}")); }
    Ok(themes_dir().join(format!("{id}.json")))
}
fn yes(text: &str) -> bool { std::env::var("SS_TEST_YES").is_ok() || crate::style::confirm("테마 편집기", text) }

/// 편집기 미리보기 그림 (기존 render: 배경·밑 층 → 영상 자리 → 위 층·자막·아래)
fn render_theme(t: &Value) -> egui::ColorImage {
    let two = t["title"]["lineColors"].is_array();
    let p = template::OwnedParams {
        title: if two { "오늘의 말씀 / 하나님 중심의 기도".into() } else { "하나님 중심의 기도".into() },
        verse: "마태복음 6:13".into(), speaker: "설교자 이름".into(), church_name: "교회 이름".into(),
        subtitle_text: "나라와 권세와 *영광이* 아버지께".into(), karaoke_index: if template::uses_karaoke(t) { Some(1) } else { None },
        theme: t.clone(), logo: template::theme_logo(t), subtitle_groups: None,
    };
    let mut pm = tiny_skia::Pixmap::new(1080, 1920).unwrap();
    if t["canvas"]["mode"].as_str() == Some("blur") { pm.fill(tiny_skia::Color::from_rgba8(0x2a, 0x2f, 0x3a, 255)); }
    template::draw_template(&mut pm, &["background", "under"], &p.as_params());
    let v = &t["video"];
    if theme::truthy(&v["show"]) {
        if let Some(path) = template::round_rect(num(&v["x"]) as f32, num(&v["y"]) as f32, num(&v["width"]) as f32, num(&v["height"]) as f32, theme::or(&v["radius"], 0.0) as f32) {
            let mut paint = tiny_skia::Paint::default(); paint.set_color_rgba8(0x66, 0x66, 0x66, 255);
            pm.fill_path(&path, &paint, tiny_skia::FillRule::Winding, tiny_skia::Transform::identity(), None);
        }
    }
    template::draw_template(&mut pm, &["top", "subtitle", "footer"], &p.as_params());
    egui::ColorImage::from_rgba_premultiplied([1080, 1920], pm.data())
}

/// 고르기·끌기에 쓰는 요소 상자 (기존 updateSelectionOutline·onMouseDown)
fn el_box(key: &str, el: &Value) -> Option<(f64, f64, f64, f64)> {
    if !el.is_object() || !theme::truthy(&el["show"]) { return None; }
    let (mut x, mut y, w) = (num(&el["x"]), num(&el["y"]), num(&el["width"]));
    let h = if key == "logo" || key == "video" { num(&el["height"]) } else { theme::num(&el["size"]).filter(|s| *s != 0.0).unwrap_or(num(&el["height"])) };
    match el["align"].as_str() { Some("center") => x -= w / 2.0, Some("right") => x -= w, _ => {} }
    if key != "video" && key != "logo" { y -= h / 2.0; }
    Some((x, y, w, h))
}

/// '#RRGGBB' / '#RRGGBBAA' ↔ egui 색
fn hex_to_color(s: &str) -> Option<Color32> {
    let h = s.strip_prefix('#')?;
    let b = |i: usize| u8::from_str_radix(h.get(i..i + 2)?, 16).ok();
    match h.len() { 6 => Some(Color32::from_rgb(b(0)?, b(2)?, b(4)?)), 8 => Some(Color32::from_rgba_unmultiplied(b(0)?, b(2)?, b(4)?, b(6)?)), _ => None }
}
fn color_to_hex(c: Color32) -> String {
    let [r, g, b, a] = c.to_srgba_unmultiplied();
    if a == 255 { format!("#{r:02X}{g:02X}{b:02X}") } else { format!("#{r:02X}{g:02X}{b:02X}{a:02X}") }
}

/// 속성 칸 줄들 (기존 addPropNum·Check·Color·Select·Text)
struct Props<'a> { ui: &'a mut egui::Ui, changed: bool }
impl Props<'_> {
    fn row(&mut self, label: &str, f: impl FnOnce(&mut egui::Ui) -> bool) {
        let ch = self.ui.horizontal(|ui| {
            ui.allocate_ui_with_layout(egui::vec2(104.0, 24.0), egui::Layout::left_to_right(egui::Align::Center), |ui| { ui.set_min_width(104.0); ui.add(egui::Label::new(RichText::new(label).size(12.0).color(style::MUTED)).truncate()); });
            f(ui)
        }).inner;
        if ch { self.changed = true; }
    }
    fn hint(&mut self, t: &str) { self.ui.add(egui::Label::new(RichText::new(t).size(11.0).color(style::MUTED)).wrap()); }
    fn num(&mut self, label: &str, v: &mut Value, step: f64) {
        let mut x = num(v);
        let before = x;
        self.row(label, |ui| ui.add(egui::DragValue::new(&mut x).speed(step).max_decimals(if step < 1.0 { 2 } else { 0 })).changed());
        if x != before { *v = if step >= 1.0 && x.fract() == 0.0 { json!(x as i64) } else { json!(x) }; }
    }
    fn check(&mut self, label: &str, on: bool) -> Option<bool> {
        let mut b = on;
        self.row(label, |ui| ui.checkbox(&mut b, "").changed());
        (b != on).then_some(b)
    }
    fn color(&mut self, label: &str, v: &mut Value, fallback: &str) {
        let cur = v.as_str().unwrap_or(fallback).to_string();
        let mut c = hex_to_color(&cur).unwrap_or(Color32::BLACK);
        let id = egui::Id::new(("te-color-text", label));
        let mut txt = self.ui.data(|d| d.get_temp::<(String, String)>(id)).filter(|(src, _)| *src == cur).map(|x| x.1).unwrap_or(cur.clone());
        let mut out: Option<String> = None;
        self.row(label, |ui| {
            let mut ch = false;
            let cb = egui::Frame::new().stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(4)).inner_margin(egui::Margin::same(1)).show(ui, |ui| egui::color_picker::color_edit_button_srgba(ui, &mut c, egui::color_picker::Alpha::OnlyBlend)).inner;
            if cb.changed() { out = Some(color_to_hex(c)); ch = true; }
            let r = ui.add(egui::TextEdit::singleline(&mut txt).desired_width(96.0));
            if r.lost_focus() && txt != cur && regex::Regex::new(r"^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$").unwrap().is_match(&txt) { out = Some(txt.to_uppercase()); ch = true; }
            ch
        });
        self.ui.data_mut(|d| d.insert_temp(id, (cur.clone(), txt)));
        if let Some(o) = out { *v = json!(o); }
    }
    fn select(&mut self, label: &str, v: &mut Value, opts: &[(String, String)]) {
        let cur = match v { Value::String(s) => s.clone(), Value::Number(n) => n.to_string(), _ => String::new() };
        let mut pick: Option<String> = None;
        let shown = opts.iter().find(|o| o.0 == cur).map(|o| o.1.clone()).unwrap_or(cur.clone());
        self.row(label, |ui| {
            egui::ComboBox::from_id_salt(("te-sel", label)).width(170.0).selected_text(shown).show_ui(ui, |ui| { for (k, l) in opts { if ui.selectable_label(*k == cur, l).clicked() { pick = Some(k.clone()); } } });
            pick.is_some()
        });
        if let Some(p) = pick { *v = if v.is_number() { p.parse::<i64>().map(|n| json!(n)).unwrap_or(json!(p)) } else { json!(p) }; }
    }
    fn text(&mut self, label: &str, v: &mut Value) {
        let cur = v.as_str().unwrap_or("").to_string();
        let id = egui::Id::new(("te-text", label));
        let mut t = self.ui.data(|d| d.get_temp::<(String, String)>(id)).filter(|(src, _)| *src == cur).map(|x| x.1).unwrap_or(cur.clone());
        let mut done = false;
        self.row(label, |ui| { let r = ui.add(egui::TextEdit::singleline(&mut t).desired_width(170.0)); done = r.lost_focus() && t != cur; done });
        self.ui.data_mut(|d| d.insert_temp(id, (cur.clone(), t.clone())));
        if done { *v = json!(t); }
    }
}
fn o(list: &[(&str, &str)]) -> Vec<(String, String)> { list.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect() }

impl App {
    /// 디자인 탭 [편집] · 왼쪽 메뉴 [테마]: 지금 테마로 편집기 열기
    pub(crate) fn cmd_edit_theme(&mut self) {
        let id = self.theme["id"].as_str().unwrap_or("").to_string();
        let list = theme::list_themes();
        let e = list.iter().find(|e| e.id == id).or(list.first());
        let mut t = theme::normalize(e.map(|e| &e.json));
        if let Some(e) = e { t["id"] = json!(e.id); t["name"] = json!(e.name); }
        self.theme_ed.ed = Some(Box::new(Ed::new(t)));
    }
    fn te_open_first(&mut self) {
        let list = theme::list_themes();
        let Some(e) = list.first() else { return };
        let mut t = theme::normalize(Some(&e.json));
        t["id"] = json!(e.id); t["name"] = json!(e.name);
        self.theme_ed.ed = Some(Box::new(Ed::new(t)));
    }
    /// 왼쪽 메뉴 [테마] 화면 (기존: 편집기를 연다)
    pub(crate) fn theme_page(&mut self, _ui: &mut egui::Ui) { self.page = Page::Editor; self.cmd_edit_theme(); }

    fn te_push(&mut self) {
        let Some(e) = self.theme_ed.ed.as_mut() else { return };
        e.hist.truncate(e.hist_at + 1);
        e.hist.push(e.theme.clone());
        e.hist_at = e.hist.len() - 1;
        e.dirty = true;
        e.hist_pending = false;
    }
    fn te_undo(&mut self, redo: bool) {
        let Some(e) = self.theme_ed.ed.as_mut() else { return };
        if redo { if e.hist_at + 1 < e.hist.len() { e.hist_at += 1; } else { return; } } else if e.hist_at > 0 { e.hist_at -= 1; } else { return; }
        e.theme = e.hist[e.hist_at].clone();
        e.need_render = true;
    }
    fn te_close(&mut self) {
        if self.theme_ed.ed.as_ref().is_some_and(|e| e.dirty) && !yes("변경사항이 저장되지 않았습니다. 닫으시겠습니까?") { return; }
        self.theme_ed.ed = None;
        self.themes = theme::list_themes();
    }
    /// 저장 (기본 테마면 복제해서): 성공하면 true
    pub(crate) fn te_save(&mut self, quiet: bool) -> bool {
        let Some(e) = self.theme_ed.ed.as_mut() else { return false };
        if !is_user(&e.theme) {
            if yes("기본 테마는 수정할 수 없습니다. 복제해서 편집하시겠습니까?") { let n = format!("{} (복사본)", e.theme["name"].as_str().unwrap_or("테마")); e.ask = Some((Ask::Clone { then_save: true }, n)); }
            return false;
        }
        let mut t = theme::normalize(Some(&e.theme));
        if t["id"].as_str().unwrap_or("").is_empty() { t["id"] = json!(format!("user-{}", now_ms())); }
        let r = theme_file(t["id"].as_str().unwrap_or("")).and_then(|p| { std::fs::create_dir_all(themes_dir()).map_err(|x| x.to_string())?; std::fs::write(p, serde_json::to_string_pretty(&t).unwrap_or_default()).map_err(|x| x.to_string()) });
        match r {
            Ok(()) => { e.dirty = false; self.themes = theme::list_themes(); if !quiet { self.toast("저장되었습니다."); } true }
            Err(x) => { self.toast(format!("저장하지 못했습니다: {x}")); false }
        }
    }
    pub(crate) fn te_apply(&mut self) {
        let need = self.theme_ed.ed.as_ref().is_some_and(|e| e.dirty || (is_user(&e.theme) && !theme_file(e.theme["id"].as_str().unwrap_or("")).map(|p| p.exists()).unwrap_or(false)));
        if need && !self.te_save(true) {
            // 기본 테마라 복제 이름을 묻는 중이면, 이름을 받아 저장한 뒤 이어서 적용한다
            if self.theme_ed.ed.as_ref().is_some_and(|e| matches!(e.ask, Some((Ask::Clone { then_save: true }, _)))) { self.theme_ed.apply_after_clone = true; }
            return;
        }
        let Some(e) = self.theme_ed.ed.as_ref() else { return };
        let id = e.theme["id"].as_str().unwrap_or("").to_string();
        self.themes = theme::list_themes();
        self.pick_theme(&id);
        self.toast("테마가 적용되었습니다.");
    }
    pub(crate) fn te_ask_done(&mut self, kind_new: bool, rename: bool, name: &str) {
        let k = if kind_new { Ask::New } else if rename { Ask::Rename } else { Ask::Clone { then_save: false } };
        self.te_named(k, name.to_string());
    }
    fn te_named(&mut self, kind: Ask, name: String) {
        let name = name.trim().to_string();
        if name.is_empty() { return; }
        let Some(e) = self.theme_ed.ed.as_mut() else { return };
        match kind {
            Ask::New => { let mut t = theme::normalize(Some(&json!({ "name": name }))); t["id"] = json!(format!("user-{}", now_ms())); t["name"] = json!(name); e.theme = t; }
            Ask::Clone { .. } => { e.theme["name"] = json!(name); e.theme["id"] = json!(format!("user-{}", now_ms())); if let Some(m) = e.theme.as_object_mut() { m.remove("userPreset"); } }
            Ask::Rename => { e.theme["name"] = json!(name); }
        }
        e.need_render = true;
        self.te_push();
        if let Ask::Clone { then_save: true } = kind {
            let ok = self.te_save(self.theme_ed.apply_after_clone);
            if ok && std::mem::take(&mut self.theme_ed.apply_after_clone) { self.te_apply(); }
        }
    }
    fn te_more(&mut self, what: &str) {
        let Some(e) = self.theme_ed.ed.as_mut() else { return };
        match what {
            "rename" => { e.ask = Some((Ask::Rename, e.theme["name"].as_str().unwrap_or("").to_string())); }
            "import" => {
                let Some(p) = rfd::FileDialog::new().set_title("테마 가져오기").add_filter("JSON 파일", &["json"]).pick_file() else { return };
                match std::fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok()) {
                    Some(j) => { let mut t = theme::normalize(Some(&j)); t["id"] = json!(format!("user-{}", now_ms())); if !t["name"].is_string() { t["name"] = json!("가져온 테마"); } e.theme = t; e.need_render = true; self.te_push(); }
                    None => self.toast("테마 파일을 읽지 못했습니다"),
                }
            }
            "export" => {
                let name = format!("theme_{}.json", e.theme["id"].as_str().unwrap_or("export"));
                if let Some(p) = rfd::FileDialog::new().set_title("테마 내보내기").add_filter("JSON 파일", &["json"]).set_file_name(name).save_file() {
                    let ok = std::fs::write(&p, serde_json::to_string_pretty(&e.theme).unwrap_or_default()).is_ok();
                    self.toast(if ok { "테마를 내보냈습니다" } else { "내보내지 못했습니다" });
                }
            }
            "font" => {
                let Some(src) = rfd::FileDialog::new().set_title("글꼴 추가").add_filter("글꼴 파일", &["ttf", "otf"]).pick_file() else { return };
                let name = src.file_name().unwrap_or_default().to_owned();
                let _ = std::fs::create_dir_all(fonts_dir());
                match std::fs::copy(&src, fonts_dir().join(&name)) {
                    Ok(_) => {
                        template::FontBook::reload();
                        e.fonts = template::FontBook::global().families();
                        let fam = std::path::Path::new(&name).file_stem().unwrap_or_default().to_string_lossy().to_string();
                        self.toast(format!("글꼴 '{fam}'가 추가되었습니다."));
                    }
                    Err(x) => self.toast(format!("글꼴을 넣지 못했습니다: {x}")),
                }
            }
            "delete" => {
                if !is_user(&e.theme) { self.toast("기본 테마는 삭제할 수 없습니다."); return; }
                if !yes("정말 삭제하시겠습니까?") { return; }
                if let Ok(p) = theme_file(e.theme["id"].as_str().unwrap_or("")) { let _ = std::fs::remove_file(p); }
                self.themes = theme::list_themes();
                self.te_open_first();
            }
            _ => {}
        }
    }

    /// 속성 칸 (기존 renderProps). 바뀌었으면 true
    fn te_props(ui: &mut egui::Ui, ed: &mut Ed) -> bool {
        let key = ed.sel;
        let fonts: Vec<(String, String)> = ed.fonts.iter().map(|f| (f.clone(), f.clone())).collect();
        let t = &mut ed.theme;
        let mut p = Props { ui, changed: false };
        if key == "canvas" {
            let c = &mut t["canvas"];
            if !c["mode"].is_string() { c["mode"] = json!("solid"); }
            p.select("배경 방식", &mut c["mode"], &o(&MODE_OPTS));
            match c["mode"].as_str().unwrap_or("solid") {
                "gradient" => {
                    if !c["gradient"].is_object() { c["gradient"] = json!({ "from": "#1B2A4A", "to": "#05070C", "angle": 180 }); }
                    p.color("시작 색", &mut c["gradient"]["from"], "#1B2A4A");
                    p.color("끝 색", &mut c["gradient"]["to"], "#05070C");
                    if c["gradient"]["angle"].is_null() { c["gradient"]["angle"] = json!(180); }
                    p.num("방향 (도)", &mut c["gradient"]["angle"], 15.0);
                    p.hint("180도 = 위에서 아래로, 90도 = 왼쪽에서 오른쪽으로");
                }
                "blur" => {
                    if !c["blur"].is_object() { c["blur"] = json!({ "amount": 30, "dim": 0.55, "tint": null }); }
                    p.num("흐림 정도", &mut c["blur"]["amount"], 5.0);
                    let a = num(&c["blur"]["amount"]).clamp(0.0, 120.0); c["blur"]["amount"] = json!(a);
                    p.num("어둡게 (0~0.9)", &mut c["blur"]["dim"], 0.05);
                    let d = num(&c["blur"]["dim"]).clamp(0.0, 0.9); c["blur"]["dim"] = json!(d);
                    if let Some(on) = p.check("색 덮기", c["blur"]["tint"].is_string()) { c["blur"]["tint"] = if on { json!("#1B2A4A66") } else { Value::Null }; }
                    if c["blur"]["tint"].is_string() { p.color("덮는 색", &mut c["blur"]["tint"], "#1B2A4A66"); }
                    p.hint("영상 화면을 크게 키워 흐리게 깐 배경입니다. 영상을 열면 실제 화면으로 보입니다.");
                }
                _ => p.color("배경색", &mut c["background"], "#000000"),
            }
            return p.changed;
        }
        let el = &mut t[key];
        if !el.is_object() { return false; }
        if let Some(v) = p.check("표시", theme::truthy(&el["show"])) { el["show"] = json!(v); }
        for (k, l) in [("x", "X"), ("y", "Y"), ("width", "너비"), ("height", "높이")] { if !el[k].is_null() { p.num(l, &mut el[k], 1.0); } }
        if !el["align"].is_null() { p.select("정렬", &mut el["align"], &o(&ALIGN_OPTS)); }
        if !el["font"].is_null() { p.select("글꼴", &mut el["font"], &fonts); }
        if !el["weight"].is_null() { let w: Vec<(String, String)> = (1..=9).map(|i| ((i * 100).to_string(), (i * 100).to_string())).collect(); p.select("굵기", &mut el["weight"], &w); }
        if !el["size"].is_null() { p.num("크기", &mut el["size"], 1.0); }
        if !el["color"].is_null() { p.color("색", &mut el["color"], "#FFFFFF"); }
        if !el["stroke"].is_null() { p.num("외곽선 두께", &mut el["stroke"], 1.0); if el["strokeColor"].is_null() { el["strokeColor"] = json!("#000000"); } p.color("외곽선 색", &mut el["strokeColor"], "#000000"); }
        if el.get("shadow").is_some() && key != "video" {
            if !el["shadow"].is_object() { el["shadow"] = json!({ "color": "#000000", "blur": 0, "offsetX": 0, "offsetY": 0 }); }
            p.color("그림자 색", &mut el["shadow"]["color"], "#000000");
            p.num("그림자 흐림", &mut el["shadow"]["blur"], 1.0);
            p.num("그림자 X", &mut el["shadow"]["offsetX"], 1.0);
            p.num("그림자 Y", &mut el["shadow"]["offsetY"], 1.0);
        }
        if TEXT_KEYS.contains(&key) {
            if el["maxLines"].is_null() { el["maxLines"] = json!(1); }
            p.num("최대 줄 수", &mut el["maxLines"], 1.0);
            el["maxLines"] = json!((num(&el["maxLines"]).round() as i64).clamp(1, 4));
            if el["lineGap"].is_null() { el["lineGap"] = json!(1.2); }
            p.num("줄 간격", &mut el["lineGap"], 0.05);
            if el["anchor"].is_null() { el["anchor"] = json!("center"); }
            p.select("여러 줄일 때", &mut el["anchor"], &o(&ANCHOR_OPTS));
            if let Some(v) = p.check("기울임", theme::truthy(&el["italic"])) { el["italic"] = json!(v); }
            if let Some(v) = p.check("영문 대문자로", el["transform"].as_str() == Some("uppercase")) { el["transform"] = if v { json!("uppercase") } else { Value::Null }; }
            if let Some(v) = p.check("줄마다 다른 색", el["lineColors"].is_array()) { el["lineColors"] = if v { json!([el["color"].as_str().unwrap_or("#FFFFFF"), "#FFFFFF"]) } else { Value::Null }; }
            if el["lineColors"].is_array() { let c0 = el["color"].as_str().unwrap_or("#FFFFFF").to_string(); p.color("첫 줄 색", &mut el["lineColors"][0], &c0); p.color("둘째 줄 색", &mut el["lineColors"][1], &c0); }
            if let Some(v) = p.check("*강조* 색", el["highlightColor"].is_string()) { el["highlightColor"] = if v { json!("#FFE14D") } else { Value::Null }; }
            if el["highlightColor"].is_string() { p.color("강조 색", &mut el["highlightColor"], "#FFE14D"); p.hint("강조할 말을 *별표*로 감싸세요. 예: 나라와 *권세와* 영광이"); }
            if let Some(v) = p.check("글자 상자", el["box"].is_object()) { el["box"] = if v { json!({ "color": "#000000AA", "radius": 8, "padding": 12, "mode": "line" }) } else { Value::Null }; }
            if el["box"].is_object() {
                if el["box"]["mode"].is_null() { el["box"]["mode"] = json!("line"); }
                p.select("상자 모양", &mut el["box"]["mode"], &o(&BOXMODE_OPTS));
                p.color("상자 색", &mut el["box"]["color"], "#000000AA");
                p.num("상자 모서리", &mut el["box"]["radius"], 1.0);
                if el["box"]["padding"].is_null() { el["box"]["padding"] = json!(10); }
                let before = el["box"]["padding"].clone();
                p.num("상자 여백", &mut el["box"]["padding"], 1.0);
                if el["box"]["padding"] != before { if let Some(m) = el["box"].as_object_mut() { m.remove("padX"); m.remove("padY"); } }
            }
            if let Some(v) = p.check("가로 띠", el["band"].is_object()) { el["band"] = if v { json!({ "color": "#000000", "paddingY": 10 }) } else { Value::Null }; }
            if el["band"].is_object() { p.color("띠 색", &mut el["band"]["color"], "#000000"); if el["band"]["paddingY"].is_null() { el["band"]["paddingY"] = json!(10); } p.num("띠 여백", &mut el["band"]["paddingY"], 1.0); }
        }
        match key {
            "subtitle" => {
                if el["letterSpacing"].is_null() { el["letterSpacing"] = json!(0); }
                p.num("자간", &mut el["letterSpacing"], 0.01);
                p.num("최대 글자수", &mut el["maxChars"], 1.0);
                let mut mode = json!(el["karaoke"]["mode"].as_str().unwrap_or("none"));
                let before = mode.clone();
                p.select("단어 강조", &mut mode, &o(&KARAOKE_OPTS));
                if mode != before { el["karaoke"] = if mode == "none" { Value::Null } else { let mut k = if el["karaoke"].is_object() { el["karaoke"].clone() } else { json!({ "color": "#FFE14D" }) }; k["mode"] = mode; k }; }
                if el["karaoke"].is_object() { p.color("강조 단어 색", &mut el["karaoke"]["color"], "#FFE14D"); p.hint("말하는 단어의 색이 바뀝니다. 단어 시각은 자막의 단어 시각을 따릅니다."); }
            }
            "badge" => {
                p.text("글", &mut el["text"]);
                p.hint("{speaker} = 설교자, {church} = 교회 이름, {verse} = 성경 구절");
                p.color("바탕 색", &mut el["bg"], "#00000000");
                if el["radius"].is_null() { el["radius"] = json!(999); }
                p.num("모서리", &mut el["radius"], 1.0);
                if el["padX"].is_null() { el["padX"] = json!(20); }
                p.num("좌우 여백", &mut el["padX"], 1.0);
                if el["padY"].is_null() { el["padY"] = json!(8); }
                p.num("위아래 여백", &mut el["padY"], 1.0);
            }
            "video" => {
                p.select("Fit", &mut el["fit"], &o(&[("cover", "cover"), ("contain", "contain")]));
                p.num("모서리 둥글기", &mut el["radius"], 1.0);
                if let Some(v) = p.check("그림자", el["shadow"].is_object()) { el["shadow"] = if v { json!({ "color": "#000000AA", "blur": 40, "offsetX": 0, "offsetY": 16 }) } else { Value::Null }; }
                if el["shadow"].is_object() { p.color("그림자 색", &mut el["shadow"]["color"], "#000000AA"); p.num("그림자 흐림", &mut el["shadow"]["blur"], 1.0); p.num("그림자 Y", &mut el["shadow"]["offsetY"], 1.0); }
                if let Some(v) = p.check("테두리", el["border"].is_object()) { el["border"] = if v { json!({ "color": "#FFFFFF", "width": 1 }) } else { Value::Null }; }
                if el["border"].is_object() { p.color("테두리 색", &mut el["border"]["color"], "#FFFFFF"); p.num("테두리 두께", &mut el["border"]["width"], 1.0); }
                if let Some(v) = p.check("가장자리 페이드", el["fade"].is_object()) { el["fade"] = if v { json!({ "edge": "bottom", "length": 100, "toColor": "#000000" }) } else { Value::Null }; }
                if el["fade"].is_object() { p.select("페이드 방향", &mut el["fade"]["edge"], &o(&[("top", "위"), ("bottom", "아래")])); p.num("페이드 길이", &mut el["fade"]["length"], 1.0); p.color("페이드 색", &mut el["fade"]["toColor"], "#000000"); }
            }
            "logo" => {
                if let Some(v) = p.check("교회 이름·설교자를 로고 옆에", theme::truthy(&el["inline"])) { el["inline"] = json!(v); }
                if theme::truthy(&el["inline"]) { p.hint("로고의 X·Y가 왼쪽 위 구석이 되고, 글자는 로고 오른쪽에 붙습니다."); }
                p.text("경로", &mut el["path"]);
                if p.ui.button("이미지 선택").clicked() {
                    if let Some(f) = rfd::FileDialog::new().set_title("로고 그림 고르기").add_filter("그림", &["png", "jpg", "jpeg", "webp"]).pick_file() {
                        if let Ok(d) = theme::import_logo(&f) { el["path"] = json!(d.to_string_lossy()); p.changed = true; }
                    }
                }
            }
            "speaker" => p.text("포맷", &mut el["format"]),
            "churchName" => { if el["letterSpacing"].is_null() { el["letterSpacing"] = json!(0); } p.num("자간", &mut el["letterSpacing"], 0.01); }
            _ => {}
        }
        p.changed
    }

    /// 매 화면: 편집기 창
    pub(crate) fn theme_editor_ui(&mut self, ctx: &egui::Context) {
        let Some(mut ed) = self.theme_ed.ed.take() else { return };
        // 미리보기 그림 받기·다시 그리기 (한 번에 하나)
        if let Some(rx) = &ed.rx { if let Ok(img) = rx.try_recv() { ed.rx = None; ed.rendered = true; match &mut ed.tex { Some(t) => t.set(img, egui::TextureOptions::LINEAR), None => ed.tex = Some(ctx.load_texture("te-canvas", img, egui::TextureOptions::LINEAR)) } } }
        if ed.need_render && ed.rx.is_none() {
            ed.need_render = false;
            let t = ed.theme.clone();
            let (tx, rx) = channel();
            std::thread::spawn(move || { let _ = tx.send(render_theme(&t)); });
            ed.rx = Some(rx);
        }
        if ed.rx.is_some() { ctx.request_repaint_after(std::time::Duration::from_millis(30)); }
        let mut act: Option<&'static str> = None;
        let mut close = false;
        let mut rects: Vec<(String, egui::Rect)> = vec![];
        let screen = ctx.content_rect();
        let (w, h) = ((screen.width() - 60.0).clamp(760.0, 1180.0), (screen.height() - 60.0).clamp(560.0, 900.0));
        let frame = egui::Frame::new().fill(style::PANEL).corner_radius(CornerRadius::same(16)).inner_margin(egui::Margin::symmetric(18, 14));
        let mut changed = false;
        let mr = egui::Modal::new(egui::Id::new("theme-editor")).frame(frame).show(ctx, |ui| {
            ui.set_width(w - 36.0); ui.set_height(h - 28.0);
            ui.horizontal(|ui| {
                ui.add(crate::icons::img("palette", 20.0, style::TEXT2));
                ui.label(RichText::new("테마 편집기").size(17.0).family(style::bold()).color(style::TEXT));
                ui.label(RichText::new(format!("{} ({})", ed.theme["name"].as_str().unwrap_or(""), ed.theme["id"].as_str().unwrap_or(""))).size(12.5).color(style::MUTED));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if style::icon_btn(ui, "x", 18.0, style::FAINT, "닫기 (Esc)").clicked() { close = true; }
                    ui.add_space(6.0);
                    let sb = ui.add(egui::Button::new(RichText::new("세이프 존").size(12.0)).fill(if ed.safe { style::PRIMARY_SOFT } else { Color32::WHITE }).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(8))).on_hover_text("유튜브 화면에 가려지는 자리 보기·숨기기");
                    if sb.clicked() { ed.safe = !ed.safe; }
                    if style::icon_btn(ui, "redo-2", 17.0, style::MUTED, "다시 실행 (Ctrl+Y)").clicked() { act = Some("redo"); }
                    if style::icon_btn(ui, "undo-2", 17.0, style::MUTED, "실행 취소 (Ctrl+Z)").clicked() { act = Some("undo"); }
                });
            });
            ui.separator();
            let body_h = ui.available_height() - 48.0;
            ui.horizontal_top(|ui| {
                // 왼쪽: 미리보기 (1080×1920 을 맞춰 줄임)
                let cw = ((body_h - 8.0) * 1080.0 / 1920.0).min(ui.available_width() - 330.0).max(200.0);
                let chh = cw * 1920.0 / 1080.0;
                let (rect, resp) = ui.allocate_exact_size(egui::vec2(cw, chh), egui::Sense::click_and_drag());
                rects.push(("canvas".into(), rect));
                let s = cw as f64 / 1080.0;
                let p = ui.painter_at(rect);
                p.rect_filled(rect, 0.0, Color32::from_rgb(0x11, 0x14, 0x1b));
                if let Some(t) = &ed.tex { p.image(t.id(), rect, egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), Color32::WHITE); }
                let to_screen = |x: f64, y: f64| egui::pos2(rect.left() + (x * s) as f32, rect.top() + (y * s) as f32);
                let v = &ed.theme["video"];
                if theme::truthy(&v["show"]) { p.text(to_screen(num(&v["x"]) + num(&v["width"]) / 2.0, num(&v["y"]) + num(&v["height"]) / 2.0), egui::Align2::CENTER_CENTER, "영상 영역", egui::FontId::proportional((40.0 * s) as f32), Color32::from_rgb(0x99, 0x99, 0x99)); }
                if ed.safe {
                    let b = egui::Rect::from_min_max(to_screen(0.0, 1920.0 * (1.0 - 0.21875)), rect.max);
                    p.rect_filled(b, 0.0, Color32::from_rgba_unmultiplied(255, 80, 80, 40));
                    p.text(b.center(), egui::Align2::CENTER_CENTER, "유튜브 UI에 가려질 수 있음", egui::FontId::proportional(11.0), Color32::from_rgb(0xff, 0xb4, 0xb4));
                    let r = egui::Rect::from_min_max(to_screen(1080.0 * (1.0 - 0.148148), 0.0), egui::pos2(rect.right(), b.top()));
                    p.rect_filled(r, 0.0, Color32::from_rgba_unmultiplied(255, 80, 80, 30));
                    p.text(r.center(), egui::Align2::CENTER_CENTER, "유튜브 UI", egui::FontId::proportional(11.0), Color32::from_rgb(0xff, 0xb4, 0xb4));
                }
                if ed.guide_x { p.vline(rect.center().x, rect.y_range(), Stroke::new(1.0, Color32::from_rgb(0xff, 0x4d, 0xd2))); }
                if ed.sel != "canvas" { if let Some((x, y, bw, bh)) = el_box(ed.sel, &ed.theme[ed.sel]) {
                    let r = egui::Rect::from_min_max(to_screen(x, y), to_screen(x + bw, y + bh));
                    let col = Color32::from_rgb(0xf5, 0x9e, 0x0b);
                    p.extend(egui::Shape::dashed_line(&[r.left_top(), r.right_top(), r.right_bottom(), r.left_bottom(), r.left_top()], Stroke::new(2.0, col), 6.0, 4.0));
                    let lab = ELEMENTS.iter().find(|e| e.0 == ed.sel).map(|e| e.1).unwrap_or(ed.sel);
                    let g = p.layout_no_wrap(lab.into(), egui::FontId::proportional(11.0), Color32::WHITE);
                    let lr = egui::Rect::from_min_size(r.left_top() - egui::vec2(1.0, g.size().y + 4.0), g.size() + egui::vec2(8.0, 4.0));
                    p.rect_filled(lr, 0.0, col); p.galley(lr.min + egui::vec2(4.0, 2.0), g, Color32::WHITE);
                } }
                // 누르기·끌기 (기존 onMouseDown·Move·Up)
                let pos = resp.interact_pointer_pos().map(|q| (((q.x - rect.left()) as f64) / s, ((q.y - rect.top()) as f64) / s));
                if resp.drag_started() || resp.clicked() {
                    // 끌기는 몇 픽셀 움직인 뒤에 시작되므로, 누른 자리를 시작점으로 (기존 mousedown 과 같게)
                    let start = ui.input(|i| i.pointer.press_origin()).map(|q| (((q.x - rect.left()) as f64) / s, ((q.y - rect.top()) as f64) / s)).or(pos);
                    if let Some((mx, my)) = start {
                        let hit = ELEMENTS.iter().rev().filter(|e| e.0 != "canvas").find(|e| el_box(e.0, &ed.theme[e.0]).is_some_and(|(x, y, bw, bh)| mx >= x && mx <= x + bw && my >= y && my <= y + bh)).map(|e| e.0);
                        if let Some(k) = hit { ed.sel = k; if resp.drag_started() { ed.drag = Some(((mx, my), (num(&ed.theme[k]["x"]), num(&ed.theme[k]["y"])))); } }
                    }
                }
                if resp.dragged() { if let (Some(((sx, sy), (ex, ey))), Some((mx, my))) = (ed.drag, pos) {
                    let (mut dx, mut dy) = (mx - sx, my - sy);
                    if ui.input(|i| i.modifiers.shift) { if dx.abs() > dy.abs() { dy = 0.0; } else { dx = 0.0; } }
                    let sel = ed.sel;
                    let el = &mut ed.theme[sel];
                    let mut nx = (ex + dx).round();
                    ed.guide_x = el["align"].as_str() == Some("center") && (nx - 540.0).abs() < 10.0;
                    if ed.guide_x { nx = 540.0; }
                    el["x"] = json!(nx as i64); el["y"] = json!((ey + dy).round() as i64);
                    ed.need_render = true;
                } }
                if resp.drag_stopped() && ed.drag.take().is_some() { ed.guide_x = false; act = Some("push"); }
                ui.add_space(10.0);
                // 오른쪽: 요소 목록 + 속성
                ui.vertical(|ui| {
                    ui.set_width(ui.available_width());
                    ui.label(RichText::new("요소 목록").size(12.5).family(style::bold()).color(style::TEXT2));
                    ui.horizontal_wrapped(|ui| {
                        for (k, l) in ELEMENTS {
                            let on = ed.sel == k;
                            let b = ui.add(egui::Button::new(RichText::new(l).size(12.5).color(if on { Color32::WHITE } else { style::TEXT2 })).fill(if on { style::PRIMARY } else { Color32::WHITE }).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(8)));
                            rects.push((format!("el:{k}"), b.rect));
                            if b.clicked() { ed.sel = k; }
                        }
                    });
                    ui.add_space(6.0);
                    ui.label(RichText::new("속성").size(12.5).family(style::bold()).color(style::TEXT2));
                    egui::ScrollArea::vertical().id_salt("te-props").max_height(body_h - 120.0).auto_shrink([false, false]).show(ui, |ui| {
                        ui.spacing_mut().item_spacing.y = 4.0;
                        if Self::te_props(ui, &mut ed) { changed = true; }
                    });
                });
            });
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                if style::tool(ui, "plus", "새 테마").clicked() { act = Some("new"); }
                if style::tool(ui, "layout-template", "복제").on_hover_text("지금 테마를 복사해서 고칩니다 (원래 테마는 그대로)").clicked() { act = Some("clone"); }
                ui.menu_button(RichText::new("더보기 ▾").size(13.0), |ui| {
                    if ui.button("이름 변경").clicked() { ui.close(); act = Some("rename"); }
                    if ui.button("테마 가져오기 (JSON)").clicked() { ui.close(); act = Some("import"); }
                    if ui.button("테마 내보내기 (JSON)").clicked() { ui.close(); act = Some("export"); }
                    if ui.button("글꼴 추가").clicked() { ui.close(); act = Some("font"); }
                    ui.separator();
                    if ui.button(RichText::new("테마 삭제").color(style::DANGER)).clicked() { ui.close(); act = Some("delete"); }
                });
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let a = style::primary(ui, Some("check"), "이 테마 사용");
                    rects.push(("apply".into(), a.rect));
                    if a.clicked() { act = Some("apply"); }
                    let sv = style::tool(ui, "save", "저장");
                    rects.push(("save".into(), sv.rect));
                    if sv.clicked() { act = Some("save"); }
                });
            });
        });
        // 이름 묻기 (기존 prompt)
        let mut named: Option<(Ask, String)> = None;
        if let Some((kind, name)) = ed.ask.as_mut() {
            let title = match kind { Ask::New => "새 테마 이름:", Ask::Clone { .. } => "복제된 테마 이름:", Ask::Rename => "테마 이름 변경:" };
            let mut keep = true;
            egui::Modal::new(egui::Id::new("te-ask")).show(ctx, |ui| {
                ui.set_width(320.0);
                ui.label(RichText::new(title).size(14.0).family(style::semi()));
                ui.add(egui::TextEdit::singleline(name).desired_width(f32::INFINITY)).request_focus();
                let enter = ui.input(|i| i.key_pressed(egui::Key::Enter));
                ui.horizontal(|ui| {
                    if ui.button("확인").clicked() || enter { named = Some((*kind, name.clone())); keep = false; }
                    if ui.button("취소").clicked() || ui.input(|i| i.key_pressed(egui::Key::Escape)) { keep = false; }
                });
            });
            if !keep { ed.ask = None; }
        }
        // 단축키 (글자 칸에 있을 때는 빼고)
        let typing = ctx.memory(|m| m.focused().is_some());
        if ed.ask.is_none() && named.is_none() {
            if ctx.input(|i| i.key_pressed(egui::Key::Escape)) || mr.backdrop_response.clicked() { close = true; }
            if !typing {
                let (z, y, shift) = ctx.input(|i| (i.modifiers.command && i.key_pressed(egui::Key::Z), i.modifiers.command && i.key_pressed(egui::Key::Y), i.modifiers.shift));
                if z { act = Some(if shift { "redo" } else { "undo" }); }
                if y { act = Some("redo"); }
                if ed.sel != "canvas" {
                    let step = if shift { 10 } else { 1 };
                    let (l, r, u, d) = ctx.input(|i| (i.key_pressed(egui::Key::ArrowLeft), i.key_pressed(egui::Key::ArrowRight), i.key_pressed(egui::Key::ArrowUp), i.key_pressed(egui::Key::ArrowDown)));
                    let sel = ed.sel;
                    let el = &mut ed.theme[sel];
                    if el.is_object() && (l || r || u || d) {
                        let (x, yy) = (num(&el["x"]) as i64, num(&el["y"]) as i64);
                        el["x"] = json!(x + if r { step } else if l { -step } else { 0 });
                        el["y"] = json!(yy + if d { step } else if u { -step } else { 0 });
                        ed.need_render = true; ed.hist_pending = true;
                    }
                }
            }
        }
        if changed { ed.need_render = true; ed.hist_pending = true; }
        // 끌기·글자 입력이 끝나면 한 번에 실행 취소 기록
        if ed.hist_pending && !ctx.input(|i| i.pointer.any_down()) && !typing && act.is_none() { act = Some("push"); }
        ed.rects = rects;
        self.theme_ed.ed = Some(ed);
        if let Some((k, n)) = named { self.te_named(k, n); }
        match act {
            Some("push") => self.te_push(),
            Some("undo") => self.te_undo(false),
            Some("redo") => self.te_undo(true),
            Some("new") => { if let Some(e) = self.theme_ed.ed.as_mut() { e.ask = Some((Ask::New, "새 테마".into())); } }
            Some("clone") => { if let Some(e) = self.theme_ed.ed.as_mut() { let n = format!("{} (복사본)", e.theme["name"].as_str().unwrap_or("")); e.ask = Some((Ask::Clone { then_save: false }, n)); } }
            Some("save") => { self.te_save(false); }
            Some("apply") => self.te_apply(),
            Some(wh) => self.te_more(wh),
            None => {}
        }
        if close { self.te_close(); }
        // 묻는 창(이름)이 떠 있으면 바로 그린다 (맥에서 시스템 대화 상자를 닫은 뒤 마우스를 움직이기 전까지 그리지 않던 것)
        if self.theme_ed.ed.as_ref().is_some_and(|e| e.ask.is_some()) { ctx.request_repaint(); }
    }
}
