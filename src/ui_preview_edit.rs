//! 미리보기 직접 편집 (기존 preview-edit.js): [미리보기 편집]을 켜면 미리보기의 제목·구절·자막·교회 이름·설교자·이름표·로고·영상을
//! 끌어 옮기고, 아래 속성 칸에서 글꼴·크기·색·위치를 바꾼다. 고친 값은 이 프로젝트 테마에만 들어간다 (프로젝트 저장·내보내기가 같은 테마를 쓴다).
//! 실행 취소는 수정 전·후에 push_undo (되돌리기 기록에 테마가 함께 들어간다). 첫 수정 때 묶음 배치(로고+교회 이름+설교자)는 개별 좌표로 굳힌다.
use crate::*;
use serde_json::{json, Value};
use sermon_shorts::template::{self, Hit};
use std::time::{Duration, Instant};

const W: f64 = 1080.0;
const H: f64 = 1920.0;
const LABEL: [(&str, &str); 8] = [("title", "제목"), ("verse", "성경 구절"), ("subtitle", "자막"), ("churchName", "교회 이름"), ("speaker", "설교자"), ("badge", "이름표"), ("logo", "로고"), ("video", "영상")];
const TEXT_KEYS: [&str; 6] = ["title", "verse", "subtitle", "churchName", "speaker", "badge"];
const FOOTER: [&str; 3] = ["logo", "churchName", "speaker"];

struct Drag { key: String, start: egui::Pos2, p0: (f64, f64), ox: f64, oy: f64, started: bool }

#[derive(Default)]
pub(crate) struct PeState { pub active: bool, pub sel: Option<String>, drag: Option<Drag>, sess: bool, commit_at: Option<Instant>, guide: bool, pub stage: Option<(egui::Rect, f32)> }

fn label(k: &str) -> &str { LABEL.iter().find(|x| x.0 == k).map(|x| x.1).unwrap_or(k) }
fn num(v: &Value) -> f64 { sermon_shorts::theme::num(v).unwrap_or(0.0) }

impl App {
    /// 지금 잡을 수 있는 개체 (잠김·숨김·안 보임 제외) + 영상 상자
    pub(crate) fn pe_hits(&self) -> Vec<Hit> {
        let blocked = |k: &str| { let e = &self.theme[k]; !e.is_object() || e["locked"] == true || e["hidden"] == true || e["show"] == false };
        let mut out: Vec<Hit> = [1usize, 2].iter().filter_map(|i| self.stage.layers[*i].as_ref()).flat_map(|l| l.hits.clone()).filter(|h| !blocked(&h.key)).collect();
        let v = &self.theme["video"];
        if v["show"] != false && num(&v["width"]) > 0.0 && num(&v["height"]) > 0.0 && v["locked"] != true && v["hidden"] != true {
            out.push(Hit { key: "video".into(), x0: num(&v["x"]), y0: num(&v["y"]), x1: num(&v["x"]) + num(&v["width"]), y1: num(&v["y"]) + num(&v["height"]), mode: None });
        }
        out
    }
    fn pe_pick(&self, x: f64, y: f64) -> Option<Hit> {
        const M: f64 = 8.0;
        let mut best: Option<Hit> = None;
        let mut best_a = f64::INFINITY;
        for h in self.pe_hits() {
            if x < h.x0 - M || x > h.x1 + M || y < h.y0 - M || y > h.y1 + M { continue; }
            let a = (h.x1 - h.x0) * (h.y1 - h.y0);
            if a <= best_a { best_a = a; best = Some(h); }
        }
        best
    }

    /// 묶음 배치를 개별 좌표로 굳힌다: 보이는 모습은 그대로, 이후 각자 움직인다
    fn pe_bake_free(&mut self) {
        if !self.theme["logo"].is_object() || self.theme["logo"]["free"] == true { return; }
        let hs: Vec<Hit> = self.stage.layers[1].as_ref().map(|l| l.hits.iter().filter(|h| h.mode.is_some()).cloned().collect()).unwrap_or_default();
        if hs.is_empty() { return; }
        for h in hs {
            if h.key == "logo" { self.theme["logo"]["x"] = json!(((h.x0 + h.x1) / 2.0).round() as i64); self.theme["logo"]["y"] = json!(h.y0.round() as i64); continue; }
            let e = &mut self.theme[h.key.as_str()];
            if !e.is_object() { continue; }
            if h.mode == Some("inline") { e["align"] = json!("left"); e["x"] = json!(h.x0.round() as i64); } else { e["align"] = json!("center"); e["x"] = json!(((h.x0 + h.x1) / 2.0).round() as i64); }
            e["y"] = json!(((h.y0 + h.y1) / 2.0).round() as i64);
        }
        self.theme["logo"]["free"] = json!(true);
    }
    /// 수정 시작 (실행 취소 한 덩어리): 수정 전 기록, 프로젝트 테마로
    fn pe_begin(&mut self, k: &str) {
        if self.pe.sess { return; }
        self.push_undo();
        self.theme = sermon_shorts::theme::normalize(Some(&self.theme.clone()));
        self.project_theme = true;
        if FOOTER.contains(&k) { self.pe_bake_free(); }
        self.pe.sess = true;
    }
    pub(crate) fn pe_commit(&mut self) {
        self.pe.commit_at = None;
        if !self.pe.sess { return; }
        self.pe.sess = false;
        self.push_undo();
        if self.has_project { self.unsaved = true; }
    }
    /// 테마를 고치는 유일한 길목
    fn pe_edit(&mut self, k: &str, soon: bool, f: impl FnOnce(&mut Value)) {
        self.pe_begin(k);
        f(&mut self.theme);
        self.theme_changed();
        if soon { self.pe.commit_at = Some(Instant::now() + Duration::from_millis(600)); }
    }
    fn pe_set_pos(t: &mut Value, k: &str, x: f64, y: f64) {
        let e = &mut t[k];
        if !e.is_object() { return; }
        let (nx, ny) = if k == "video" { (x.round().clamp(0.0, (W - num(&e["width"])).max(0.0)), y.round().clamp(0.0, (H - num(&e["height"])).max(0.0))) } else { (x.round().clamp(0.0, W), y.round().clamp(0.0, H)) };
        e["x"] = json!(nx as i64); e["y"] = json!(ny as i64);
    }
    pub(crate) fn pe_move_by(&mut self, k: &str, dx: f64, dy: f64) {
        if !self.theme[k].is_object() { return; }
        let key = k.to_string();
        self.pe_edit(k, true, |t| { let (x, y) = (num(&t[key.as_str()]["x"]), num(&t[key.as_str()]["y"])); Self::pe_set_pos(t, &key, x + dx, y + dy); });
    }

    /// 디자인 탭 [미리보기 편집]: 켜고 끄기
    pub(crate) fn cmd_preview_edit(&mut self) {
        self.pe_commit();
        self.pe.active = !self.pe.active;
        if !self.pe.active { self.pe.sel = None; self.pe.drag = None; }
        self.stage.clear_subs();
        self.theme_key = crate::stage::hkey(&format!("{}|pe{}", self.theme, self.pe.active));
    }

    /// 매 화면 (단축키보다 먼저): 늦춘 기록, Esc·화살표
    pub(crate) fn pe_keys(&mut self, ctx: &egui::Context) {
        if self.pe.commit_at.is_some_and(|t| Instant::now() >= t) { self.pe_commit(); }
        if self.pe.commit_at.is_some() { ctx.request_repaint_after(Duration::from_millis(200)); }
        if !self.pe.active || self.dialog_open() || self.trim.is_some() || ctx.egui_wants_keyboard_input() { return; }
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Escape)) {
            self.pe_commit();
            if self.pe.sel.is_some() { self.pe.sel = None; } else { self.cmd_preview_edit(); }
            return;
        }
        let Some(k) = self.pe.sel.clone() else { return };
        for (key, dx, dy) in [(egui::Key::ArrowLeft, -1.0, 0.0), (egui::Key::ArrowRight, 1.0, 0.0), (egui::Key::ArrowUp, 0.0, -1.0), (egui::Key::ArrowDown, 0.0, 1.0)] {
            // Shift 를 먼저 (egui 의 맞춤은 Shift 를 무시하므로)
            if ctx.input_mut(|i| i.consume_key(egui::Modifiers::SHIFT, key)) { self.pe_move_by(&k, dx * 10.0, dy * 10.0); }
            else if ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, key)) { self.pe_move_by(&k, dx, dy); }
        }
    }

    /// 미리보기 무대 위 (무대 그리기 뒤에 불림: 무대 화면 영역과 1080 기준 배율)
    pub(crate) fn stage_overlay(&mut self, ui: &mut egui::Ui, stage: egui::Rect, k: f32) {
        if !self.pe.active { return; }
        self.pe.stage = Some((stage, k));
        let resp = ui.interact(stage, ui.id().with("pe-overlay"), egui::Sense::click_and_drag());
        let to_c = |p: egui::Pos2| (((p.x - stage.left()) / k) as f64, ((p.y - stage.top()) / k) as f64);
        let to_s = |x: f64, y: f64| egui::pos2(stage.left() + x as f32 * k, stage.top() + y as f32 * k);
        // 누르기: 고르기 (빈 곳이면 선택 해제)
        if resp.drag_started() || resp.clicked() {
            let p = ui.input(|i| i.pointer.press_origin()).or(resp.interact_pointer_pos());
            if let Some(p) = p {
                let (x, y) = to_c(p);
                match self.pe_pick(x, y) {
                    None => { self.pe_commit(); self.pe.sel = None; }
                    Some(h) => {
                        self.pe.sel = Some(h.key.clone());
                        if resp.drag_started() { let e = &self.theme[h.key.as_str()]; self.pe.drag = Some(Drag { key: h.key.clone(), start: p, p0: (x, y), ox: num(&e["x"]), oy: num(&e["y"]), started: false }); }
                    }
                }
            }
        }
        if resp.dragged() {
            if let (Some(d), Some(p)) = (self.pe.drag.as_mut().map(|d| (d.key.clone(), d.p0, d.started, d.start)), resp.interact_pointer_pos()) {
                let (key, p0, started, _start) = d;
                let (x, y) = to_c(p);
                let (mut dx, mut dy) = (x - p0.0, y - p0.1);
                let (shift, alt) = ui.input(|i| (i.modifiers.shift, i.modifiers.alt));
                if shift { if dx.abs() > dy.abs() { dy = 0.0; } else { dx = 0.0; } }
                if !started {
                    self.pe_begin(&key);
                    // 묶음을 굳히면 좌표가 바뀌므로 시작점을 다시 읽는다
                    let e = &self.theme[key.as_str()];
                    let (ox, oy) = (num(&e["x"]), num(&e["y"]));
                    if let Some(dd) = self.pe.drag.as_mut() { dd.started = true; dd.ox = ox; dd.oy = oy; }
                }
                let (ox, oy) = self.pe.drag.as_ref().map(|d| (d.ox, d.oy)).unwrap_or((0.0, 0.0));
                let mut nx = ox + dx;
                let e2 = &self.theme[key.as_str()];
                let mut snap = false;
                if !alt && key != "video" && e2["align"].as_str().unwrap_or("center") == "center" && (nx - W / 2.0).abs() < 8.0 { nx = W / 2.0; snap = true; }
                self.pe.guide = snap;
                Self::pe_set_pos(&mut self.theme, &key, nx, oy + dy);
                self.theme_changed();
            }
        }
        if resp.drag_stopped() { if let Some(d) = self.pe.drag.take() { self.pe.guide = false; if d.started { self.pe_commit(); } } }
        if let Some(h) = resp.hover_pos().and_then(|p| { let (x, y) = to_c(p); self.pe_pick(x, y) }) { let _ = h; ui.ctx().set_cursor_icon(egui::CursorIcon::Move); }
        // 선택 테두리·가운데 선
        let painter = ui.painter_at(stage);
        if self.pe.guide { painter.vline(stage.center().x, stage.y_range(), Stroke::new(1.0, Color32::from_rgb(0xff, 0x4d, 0xd2))); }
        if let Some(sel) = &self.pe.sel {
            if let Some(h) = self.pe_hits().into_iter().find(|h| &h.key == sel) {
                let r = egui::Rect::from_min_max(to_s(h.x0, h.y0), to_s(h.x1, h.y1));
                let col = Color32::from_rgb(0xf5, 0x9e, 0x0b);
                painter.rect_stroke(r, 2.0, Stroke::new(2.0, col), egui::StrokeKind::Outside);
                let g = painter.layout_no_wrap(label(sel).into(), egui::FontId::proportional(11.0), Color32::WHITE);
                let lr = egui::Rect::from_min_size(r.left_top() - egui::vec2(2.0, g.size().y + 4.0), g.size() + egui::vec2(8.0, 4.0));
                painter.rect_filled(lr, 2.0, col); painter.galley(lr.min + egui::vec2(4.0, 2.0), g, Color32::WHITE);
            } else if self.pe.drag.is_none() { /* 그사이 사라진 개체 */ }
        }
        painter.rect_stroke(stage.shrink(1.0), 22.0, Stroke::new(2.0, Color32::from_rgba_unmultiplied(0xf5, 0x9e, 0x0b, 140)), egui::StrokeKind::Inside);
    }

    /// 무대 아래 속성 칸 (기존 #pePanel)
    pub(crate) fn pe_panel(&mut self, ui: &mut egui::Ui) {
        if !self.pe.active { return; }
        let fonts = template::FontBook::global().families();
        egui::Frame::new().fill(style::PANEL2).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(12)).inner_margin(egui::Margin::symmetric(12, 8)).show(ui, |ui| {
            ui.set_width(ui.available_width());
            let Some(k) = self.pe.sel.clone() else {
                ui.label(RichText::new("개체를 눌러 고르세요 (빈 곳 클릭·Esc 로 선택 해제)").size(12.5).color(style::MUTED));
                return;
            };
            ui.label(RichText::new(label(&k)).size(13.0).family(style::bold()).color(style::TEXT));
            let is_text = TEXT_KEYS.contains(&k.as_str());
            let is_logo = k == "logo";
            let e = self.theme[k.as_str()].clone();
            if is_text {
                let cur = e["font"].as_str().unwrap_or("").to_string();
                let mut pick: Option<String> = None;
                ui.horizontal(|ui| {
                    ui.label(RichText::new("글꼴").size(12.0).color(style::MUTED));
                    egui::ComboBox::from_id_salt("pe-font").width(180.0).selected_text(&cur).show_ui(ui, |ui| { for f in &fonts { if ui.selectable_label(*f == cur, f).clicked() { pick = Some(f.clone()); } } });
                });
                if let Some(f) = pick { let kk = k.clone(); self.pe_edit(&k, false, |t| t[kk.as_str()]["font"] = json!(f)); self.pe_commit(); }
            }
            if is_text || is_logo {
                let prop = if is_logo { "height" } else { "size" };
                let mut v = num(&e[prop]);
                let before = v;
                ui.horizontal(|ui| {
                    ui.label(RichText::new(if is_logo { "높이" } else { "크기" }).size(12.0).color(style::MUTED));
                    ui.add(egui::DragValue::new(&mut v).range(1.0..=600.0).speed(1.0));
                    ui.scope(|ui| {
                        ui.spacing_mut().slider_rail_height = 6.0;
                        let w = &mut ui.visuals_mut().widgets;
                        w.inactive.bg_fill = style::BORDER_STRONG; w.hovered.bg_fill = style::BORDER_STRONG; w.active.bg_fill = style::BORDER_STRONG;
                        ui.visuals_mut().selection.bg_fill = style::PRIMARY;
                        ui.add(egui::Slider::new(&mut v, 10.0..=240.0).show_value(false).trailing_fill(true));
                    });
                });
                if v != before { let kk = k.clone(); self.pe_edit(&k, true, |t| t[kk.as_str()][prop] = json!(v.round() as i64)); }
            }
            if is_text {
                let cur = e["color"].as_str().unwrap_or("#FFFFFF").to_string();
                let h = cur.strip_prefix('#').unwrap_or("");
                let px = |i: usize| u8::from_str_radix(h.get(i..i + 2).unwrap_or("ff"), 16).unwrap_or(255);
                let mut c = Color32::from_rgb(px(0), px(2), px(4));
                let changed = ui.horizontal(|ui| {
                    ui.label(RichText::new("색").size(12.0).color(style::MUTED));
                    let r = egui::color_picker::color_edit_button_srgba(ui, &mut c, egui::color_picker::Alpha::Opaque);
                    ui.label(RichText::new(&cur).size(12.0).color(style::TEXT2));
                    r.changed()
                }).inner;
                if changed {
                    // 투명도는 그대로 두고, 줄마다 다른 색이 새 색을 덮지 않게 끈다
                    let alpha = if cur.len() == 9 { cur[7..].to_string() } else { String::new() };
                    let [r, g, b, _] = c.to_array();
                    let kk = k.clone();
                    self.pe_edit(&k, true, |t| { t[kk.as_str()]["color"] = json!(format!("#{r:02X}{g:02X}{b:02X}{alpha}")); if !t[kk.as_str()]["lineColors"].is_null() { t[kk.as_str()]["lineColors"] = Value::Null; } });
                }
            }
            let (mut x, mut y) = (num(&e["x"]), num(&e["y"]));
            let (bx, by) = (x, y);
            ui.horizontal(|ui| {
                ui.label(RichText::new("위치").size(12.0).color(style::MUTED));
                ui.label("X"); ui.add(egui::DragValue::new(&mut x).speed(1.0));
                ui.label("Y"); ui.add(egui::DragValue::new(&mut y).speed(1.0));
            });
            if x != bx || y != by { let kk = k.clone(); self.pe_edit(&k, true, |t| Self::pe_set_pos(t, &kk, x, y)); }
            ui.label(RichText::new("끌어서 이동 · 화살표 1px(Shift 10px) · Shift 끌기 한 방향 · Alt 끌기 가운데 붙임 끄기 · Ctrl+Z 되돌리기").size(11.0).color(style::MUTED));
        });
    }
}
