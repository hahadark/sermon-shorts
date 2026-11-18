//! 설정 창 (기존 settings-ui.js): [일반] 최근 유튜브 링크·원본 없을 때·자동 저장·업데이트·폴더, [편집] 새 편집 기본값,
//! [AI] 키·모델, [교회 정보] 교회 이름·로고·설교자 목록·기본 설교자·자주 쓰는 말, [디자인], [유튜브] 업로드
use crate::*;
use sermon_shorts::{settings as st, ytupload};
use std::sync::mpsc::Receiver as Rx;

const MODELS: [(&str, &str); 2] = [("gemini-3.5-flash", "gemini-3.5-flash (빠르고 저렴, 추천)"), ("gemini-3.1-pro-preview", "gemini-3.1-pro-preview (더 정확, 느림)")];
const TABS: [(&str, &str); 7] = [("general", "일반"), ("edit", "편집"), ("chat", "AI 대화"), ("ai", "AI"), ("church", "교회 정보"), ("design", "디자인"), ("youtube", "유튜브")];
const ERR: Color32 = Color32::from_rgb(0xb9, 0x1c, 0x1c);

#[derive(Default)]
pub(crate) struct State { pub open: Option<Box<Prefs>> }

pub(crate) struct Prefs {
    pub tab: &'static str,
    // 일반
    recent_max: f64, recent: Vec<(String, String)>, source_missing: String,
    asv_on: bool, asv_every: f64, asv_versions: f64, asv_videos: f64, asv_days: f64, auto_update: bool, upd: String, bgm_dir: String,
    // 편집
    ed_max: f64, ed_semantic: bool, ed_split: bool, preview_proxy: bool, ed_pad_b: f64, ed_pad_a: f64, ed_fade: f64, ed_tidy: bool, apply_now: bool,
    // AI 대화 (편집 조건 기본값)
    chat_len: String, chat_count: String, chat_aud: String, chat_styles: Vec<bool>,
    // AI
    gemini_key: String, key_state: String, model: String, ai_msg: Option<(bool, String)>, ai_rx: Option<Rx<(bool, String)>>,
    // 교회
    pub church: String, logo_path: String, pub speakers: Vec<String>, pub default_speaker: String, terms: String, focus_speaker: Option<usize>,
    // 디자인
    theme_id: String,
    // 유튜브
    yt: ytupload::Status, yt_msg: Option<(Option<bool>, String)>, yt_rx: Option<Rx<Result<ytupload::Status, String>>>, client_id: String, client_secret: String, yt_adv: bool,
}

fn bgm_dir(s: &Value) -> String {
    if let Ok(d) = std::env::var("SS_BGM_LIBRARY") { if !d.is_empty() { return d; } }
    if let Some(d) = s["bgmLibraryDir"].as_str().filter(|d| !d.is_empty()) { return d.to_string(); }
    let docs = sermon_shorts::documents_dir();
    docs.join("SermonShorts").join("배경음악").to_string_lossy().to_string()
}
fn open_dir(p: &std::path::Path) { sermon_shorts::open_folder(p); }
/// 저장된 로고 경로 → 실제 파일 (앱 assets 또는 사용자 logos 폴더)
pub(crate) fn resolve_logo(p: &str) -> Option<PathBuf> {
    let p = if p.is_empty() { st::DEFAULT_LOGO } else { p };
    let abs = if let Some(rel) = p.strip_prefix("assets/").or_else(|| p.strip_prefix("assets\\")) { sermon_shorts::assets_dir().join(rel) } else { PathBuf::from(p) };
    abs.exists().then_some(abs)
}

/// 왼쪽 정렬, 넘치면 … (add_sized 는 가운데 정렬이라 쓰지 않는다)
fn left_label(ui: &mut egui::Ui, w: f32, text: RichText) -> egui::Response {
    ui.allocate_ui_with_layout(egui::vec2(w.max(10.0), 22.0), egui::Layout::left_to_right(egui::Align::Center), |ui| { ui.set_width(w.max(10.0)); ui.add(egui::Label::new(text).truncate()) }).inner
}
fn row_label(ui: &mut egui::Ui, s: &str) { ui.add_space(10.0); ui.label(RichText::new(s).size(13.0).family(style::semi()).color(style::TEXT)); ui.add_space(4.0); }
fn note(ui: &mut egui::Ui, s: &str) { ui.add(egui::Label::new(RichText::new(s).size(12.0).color(style::MUTED)).wrap()); }
fn check(ui: &mut egui::Ui, v: &mut bool, s: &str) -> bool { ui.checkbox(v, RichText::new(s).size(13.0).color(style::TEXT2)).changed() }
/// 기존 <input type=number> (정수 칸은 소수점 없이)
fn number(ui: &mut egui::Ui, v: &mut f64, lo: f64, hi: f64, step: f64, unit: &str, w: f32) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 4.0;
        let dec = if step >= 1.0 { 0 } else if step >= 0.1 { 1 } else { 2 };
        ui.add_sized([w, 26.0], egui::DragValue::new(v).range(lo..=hi).speed(step).max_decimals(dec).min_decimals(0));
        if !unit.is_empty() { ui.label(RichText::new(unit).size(12.0).color(style::MUTED)); }
    });
}
fn sm_btn(ui: &mut egui::Ui, s: &str) -> egui::Response {
    ui.add(egui::Button::new(RichText::new(s).size(12.0).family(style::semi()).color(style::TEXT)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(9)).min_size(egui::vec2(0.0, 28.0)))
}
fn sm_primary(ui: &mut egui::Ui, s: &str, enabled: bool) -> egui::Response {
    ui.add_enabled(enabled, egui::Button::new(RichText::new(s).size(12.0).family(style::bold()).color(Color32::WHITE)).fill(style::PRIMARY).corner_radius(CornerRadius::same(9)).min_size(egui::vec2(0.0, 28.0)))
}
fn combo(ui: &mut egui::Ui, id: &str, cur: &mut String, items: &[(String, String)], w: f32) -> bool {
    let label = items.iter().find(|(v, _)| v == cur).map(|x| x.1.clone()).unwrap_or_else(|| cur.clone());
    let mut changed = false;
    egui::ComboBox::from_id_salt(id).width(w).selected_text(RichText::new(label).size(13.0)).show_ui(ui, |ui| {
        for (v, l) in items { if ui.selectable_label(cur == v, RichText::new(l).size(13.0)).clicked() { *cur = v.clone(); changed = true; } }
    });
    changed
}

impl App {
    /// 설정 열기 (tab: general·edit·ai·church·design·youtube)
    pub(crate) fn open_settings(&mut self, tab: &str) {
        let s = st::load();
        self.settings = s.clone();
        let t = &s["template"];
        let n = |v: &Value, d: f64| v.as_f64().unwrap_or(d);
        let (asv, ed) = (&s["autosave"], &s["editDefaults"]);
        let speakers: Vec<String> = s["speakers"].as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect();
        let default_speaker = s["defaultSpeaker"].as_str().filter(|x| !x.is_empty()).map(String::from).or_else(|| speakers.first().cloned()).unwrap_or_default();
        let suffix = st::key_suffix(&s, "geminiApiKeyEnc");
        let key_state = match suffix { Some(x) => format!("저장됨 (••••{x})"), None if std::env::var("GEMINI_API_KEY").is_ok_and(|k| !k.is_empty()) => "환경변수 GEMINI_API_KEY 사용 중".into(), None => "없음".into() };
        let tab = TABS.iter().map(|x| x.0).find(|x| *x == tab).unwrap_or("general");
        self.prefs.open = Some(Box::new(Prefs {
            tab,
            recent_max: n(&s["recentYoutubeMax"], 5.0), recent: sermon_shorts::youtube::recent_list(&s).into_iter().map(|(u, t, _)| (u, t)).collect(), source_missing: s["sourceMissing"].as_str().unwrap_or("auto").into(),
            asv_on: asv["enabled"] != false, asv_every: n(&asv["everyMin"], 2.0), asv_versions: n(&asv["maxVersions"], 30.0), asv_videos: n(&asv["maxVideos"], 40.0), asv_days: n(&asv["keepDays"], 60.0),
            auto_update: s["autoUpdate"] != false, upd: crate::ui_update::status_text(&self.upd.u.status()), bgm_dir: bgm_dir(&s),
            ed_max: n(&ed["maxLineChars"], 14.0), ed_semantic: ed["semanticBreaks"] != false, ed_split: ed["splitLongWords"] != false, preview_proxy: s["previewProxy"] != false,
            ed_pad_b: n(&ed["padBefore"], 0.1), ed_pad_a: n(&ed["padAfter"], 0.15), ed_fade: n(&ed["fadeMs"], 10.0), ed_tidy: ed["autoTidy"] != false, apply_now: false,
            chat_len: (sermon_shorts::chat_plan::js_num(self.chat.prefs.get("length")) as i64).to_string(), chat_count: sermon_shorts::chat_plan::count_of(&self.chat.prefs).to_string(), chat_aud: self.chat.prefs["audience"].as_str().unwrap_or("all").into(),
            chat_styles: sermon_shorts::chat_plan::STYLES.iter().map(|s| self.chat.prefs[s.0] != false).collect(),
            gemini_key: String::new(), key_state, model: t["aiModel"].as_str().unwrap_or(MODELS[0].0).into(), ai_msg: None, ai_rx: None,
            church: t["churchName"].as_str().unwrap_or("").into(), logo_path: t["logoPath"].as_str().unwrap_or("").into(), speakers, default_speaker, terms: s["churchTerms"].as_str().unwrap_or("").into(), focus_speaker: None,
            theme_id: s["activeThemeId"].as_str().unwrap_or("").into(),
            yt: ytupload::status(), yt_msg: None, yt_rx: None, client_id: String::new(), client_secret: String::new(), yt_adv: false,
        }));
    }
    /// 왼쪽 메뉴 [설정]: 기존 판처럼 창으로 연다
    pub(crate) fn settings_page(&mut self, ui: &mut egui::Ui) {
        self.page = Page::Editor;
        self.open_settings("general");
        self.editor(ui);
    }

    pub(crate) fn settings_ui(&mut self, ctx: &egui::Context) {
        if ctx.input(|i| i.modifiers.command && i.key_pressed(egui::Key::Comma)) && self.prefs.open.is_none() { self.open_settings("general"); }
        let Some(mut p) = self.prefs.open.take() else { return };
        if let Some(rx) = &p.yt_rx {
            if let Ok(r) = rx.try_recv() {
                p.yt_rx = None;
                match r { Ok(s) => { p.yt = s; p.yt_msg = Some((Some(true), "유튜브에 로그인했습니다.".into())); } Err(e) => p.yt_msg = Some((Some(false), e)) }
            }
        }
        if p.yt_rx.is_some() { ctx.request_repaint_after(std::time::Duration::from_millis(300)); }
        let (mut close, mut save, mut edit_theme) = (false, false, false);
        let frame = egui::Frame::new().fill(style::PANEL).corner_radius(CornerRadius::same(24)).inner_margin(egui::Margin::symmetric(26, 24));
        let mr = egui::Modal::new(egui::Id::unique("settings")).frame(frame).show(ctx, |ui| {
            ui.set_width(720.0 - 52.0);
            ui.horizontal(|ui| {
                ui.label(RichText::new("설정").size(18.0).family(style::bold()).color(style::TEXT));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| { if style::icon_btn(ui, "x", 18.0, style::FAINT, "닫기").clicked() { close = true; } });
            });
            ui.add_space(12.0);
            // 탭
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                for (id, name) in TABS {
                    let on = p.tab == id;
                    let g = ui.painter().layout_no_wrap(name.to_string(), egui::FontId::new(13.5, if on { style::bold() } else { egui::FontFamily::Proportional }), if on { style::TEXT } else { style::MUTED });
                    let (r, resp) = ui.allocate_exact_size(egui::vec2(g.size().x + 26.0, 34.0), egui::Sense::click());
                    if resp.hovered() && !on { ui.painter().rect_filled(r, CornerRadius::same(8), style::PANEL2); }
                    ui.painter().galley(egui::pos2(r.center().x - g.size().x / 2.0, r.center().y - g.size().y / 2.0), g, style::TEXT);
                    if on { ui.painter().rect_filled(egui::Rect::from_min_max(egui::pos2(r.left() + 4.0, r.bottom() - 3.0), egui::pos2(r.right() - 4.0, r.bottom())), CornerRadius::same(2), style::PRIMARY); }
                    if resp.on_hover_cursor(egui::CursorIcon::PointingHand).clicked() { p.tab = id; }
                }
            });
            let r = ui.cursor();
            ui.painter().hline(r.x_range(), r.top(), Stroke::new(1.0, style::BORDER));
            ui.add_space(6.0);
            let h = (ctx.content_rect().height() - 230.0).clamp(240.0, 600.0);
            egui::ScrollArea::vertical().max_height(h).min_scrolled_height(h).auto_shrink([false, false]).show(ui, |ui| {
                ui.set_width(ui.available_width() - 8.0);
                match p.tab {
                    "general" => self.pane_general(ui, &mut p),
                    "edit" => Self::pane_edit(ui, &mut p),
            "chat" => Self::pane_chat(ui, &mut p),
                    "ai" => self.pane_ai(ui, &mut p),
                    "church" => self.pane_church(ui, &mut p),
                    "design" => { if self.pane_design(ui, &mut p) { edit_theme = true; } }
                    _ => Self::pane_youtube(ui, &mut p),
                }
                ui.add_space(8.0);
            });
            ui.add_space(14.0);
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.spacing_mut().item_spacing.x = 8.0;
                if ui.add(egui::Button::new(RichText::new("저장").size(13.0).family(style::bold()).color(Color32::WHITE)).fill(style::PRIMARY).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(52.0, 34.0))).clicked() { save = true; }
                if ui.add(egui::Button::new(RichText::new("취소").size(13.0).family(style::semi()).color(style::TEXT)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(52.0, 34.0))).clicked() { close = true; }
            });
        });
        if mr.backdrop_response.clicked() { close = true; }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) && !ctx.egui_wants_keyboard_input() { close = true; }
        if edit_theme { self.cmd_edit_theme(); return; }
        if save { if !self.save_prefs(&p) { self.prefs.open = Some(p); } return; }
        if !close { self.prefs.open = Some(p); }
    }

    fn pane_general(&mut self, ui: &mut egui::Ui, p: &mut Prefs) {
        row_label(ui, "최근 작업한 유튜브 링크");
        ui.horizontal(|ui| { ui.label(RichText::new("보존 개수").size(13.0)); number(ui, &mut p.recent_max, 0.0, 50.0, 1.0, "개 (0 = 보존 안 함)", 70.0); });
        ui.add_space(4.0);
        if p.recent.is_empty() { note(ui, "아직 보존된 링크가 없습니다."); } else {
            let mut rm: Option<Option<String>> = None;
            for (u, t) in &p.recent {
                ui.horizontal(|ui| {
                    left_label(ui, ui.available_width() - 60.0, RichText::new(if t.is_empty() { u } else { t }).size(13.0)).on_hover_text(u);
                    if ui.add(egui::Button::new(RichText::new("지우기").size(12.0).color(style::TEXT2)).frame(false)).on_hover_text("이 링크 지우기").clicked() { rm = Some(Some(u.clone())); }
                });
            }
            if sm_btn(ui, "모두 지우기").clicked() {
                let yes = std::env::var("SS_TEST_YES").is_ok() || crate::style::confirm("설정", "최근 유튜브 링크를 모두 지울까요?");
                if yes { rm = Some(None); }
            }
            if let Some(which) = rm { if let Ok(s) = st::recent_remove(which.as_deref()) { p.recent = sermon_shorts::youtube::recent_list(&s).into_iter().map(|(u, t, _)| (u, t)).collect(); self.settings = s; } }
        }
        note(ui, "AI 편집 대화의 시작 화면과 [유튜브에서 가져오기] 창에 최근 영상이 보여 바로 다시 불러올 수 있습니다.");
        row_label(ui, "원본 영상이 없을 때 (캐시를 지웠거나 파일을 옮김)");
        combo(ui, "set-src-missing", &mut p.source_missing, &[("auto".into(), "유튜브 영상이면 자동으로 다시 받기 (기본)".into()), ("ask".into(), "다시 받기 전에 묻기 (다시 받기 / 파일 찾기)".into())], ui.available_width() - 12.0);
        note(ui, "유튜브에서 받은 영상은 같은 부분을 다시 받아 자막·컷을 그대로 이어서 편집합니다. 다운로드에 실패하거나 유튜브 주소가 없으면 파일을 직접 찾을 수 있습니다.");
        row_label(ui, "자동 저장");
        check(ui, &mut p.asv_on, "편집을 자동으로 저장하기 (갑자기 꺼져도 다시 열기)");
        egui::Grid::new("asv-grid").num_columns(2).spacing([10.0, 6.0]).show(ui, |ui| {
            for (label, v, lo, hi, unit) in [("작업본 남기는 간격", &mut p.asv_every, 1.0, 60.0, "분마다"), ("영상마다 작업본", &mut p.asv_versions, 1.0, 200.0, "개까지"), ("보관할 영상", &mut p.asv_videos, 1.0, 500.0, "개까지"), ("보관 기간", &mut p.asv_days, 1.0, 3650.0, "일 지나면 지움")] {
                ui.label(RichText::new(label).size(13.0)); number(ui, v, lo, hi, 1.0, unit, 80.0); ui.end_row();
            }
        });
        ui.add_space(6.0);
        if sm_btn(ui, "자동 저장 폴더 열기").clicked() { open_dir(&sermon_shorts::autosave::root_dir()); }
        row_label(ui, "앱 업데이트");
        check(ui, &mut p.auto_update, "새 버전을 자동으로 확인하고 받아 두기");
        ui.horizontal(|ui| { ui.add_space(24.0); note(ui, "끄면 아래 [지금 확인]을 눌렀을 때만 확인합니다."); });
        ui.horizontal(|ui| { if sm_btn(ui, "지금 확인").clicked() { self.update_check_now(); } p.upd = crate::ui_update::status_text(&self.upd.u.status()); note(ui, &p.upd); });
        row_label(ui, "폴더");
        ui.horizontal(|ui| {
            ui.label(RichText::new("배경음악 보관함").size(13.0));
            left_label(ui, ui.available_width() - 110.0, RichText::new(&p.bgm_dir).size(12.0).color(style::MUTED)).on_hover_text(&p.bgm_dir);
            if sm_btn(ui, "열기").clicked() { open_dir(std::path::Path::new(&p.bgm_dir)); }
            if sm_btn(ui, "바꾸기").clicked() {
                if let Some(d) = rfd::FileDialog::new().set_title("배경음악 보관함 폴더 고르기").pick_folder() {
                    let probe = d.join(format!(".ss-write-test-{}", std::process::id()));
                    if std::fs::write(&probe, b"ok").is_ok() { let _ = std::fs::remove_file(&probe); if let Ok(s) = st::save(&json!({ "bgmLibraryDir": d.to_string_lossy() })) { self.settings = s; } p.bgm_dir = d.to_string_lossy().to_string(); }
                    else { self.toast("이 폴더에 쓸 수 없습니다. Windows 보안의 \"제어된 폴더 액세스\"가 막았거나 권한이 없을 수 있습니다. 다른 폴더를 골라 주세요."); }
                }
            }
        });
        ui.add_space(6.0);
        if sm_btn(ui, "설정·데이터 폴더 열기").clicked() { open_dir(&theme::user_data_dir()); }
    }

    /// AI 대화: 편집 조건 기본값 (대화 화면 버튼과 같은 값)
    fn pane_chat(ui: &mut egui::Ui, p: &mut Prefs) {
        use sermon_shorts::chat_plan as cp;
        ui.add_space(6.0);
        note(ui, "AI 편집 대화의 [편집 조건] 기본값입니다. 대화 화면에서 버튼으로 바꾸면 여기에도 그대로 반영됩니다.");
        row_label(ui, "쇼츠 길이");
        combo(ui, "chat-len", &mut p.chat_len, &cp::LENGTHS.iter().map(|(v, l)| (v.to_string(), l.to_string())).collect::<Vec<_>>(), 160.0);
        row_label(ui, "추천받을 후보 수");
        combo(ui, "chat-count", &mut p.chat_count, &cp::COUNTS.iter().map(|v| (v.to_string(), format!("{v}곳"))).collect::<Vec<_>>(), 160.0);
        row_label(ui, "보는 사람");
        combo(ui, "chat-aud", &mut p.chat_aud, &cp::AUDIENCES.iter().map(|(v, l)| (v.to_string(), l.to_string())).collect::<Vec<_>>(), 160.0);
        row_label(ui, "다듬기 (켜 둔 것은 매번 지킵니다)");
        for (i, (_, l, _)) in cp::STYLES.iter().enumerate() { check(ui, &mut p.chat_styles[i], l); }
    }

    fn pane_edit(ui: &mut egui::Ui, p: &mut Prefs) {
        ui.add_space(6.0);
        note(ui, "새로 자막을 만들거나 AI 대화로 편집을 시작할 때 쓰는 기본값입니다. 지금 편집만 바꾸려면 자막 편집 칸의 [설정]을 쓰세요.");
        row_label(ui, "자막 한 줄 최대 글자 수");
        number(ui, &mut p.ed_max, 1.0, 200.0, 1.0, "자 (공백 제외)", 70.0);
        check(ui, &mut p.ed_semantic, "의미 단위로 나누기");
        ui.horizontal(|ui| { ui.add_space(24.0); note(ui, "글자 수만 채워 끊지 않고 문장 끝·쉼·이음말에서 끊습니다."); });
        check(ui, &mut p.ed_split, "긴 단어도 나누기");
        check(ui, &mut p.preview_proxy, "부드러운 미리보기 (미리보기용 영상을 뒤에서 만들어 지운 곳을 건너뛸 때 끊기지 않게 · 내보내기는 원본)");
        row_label(ui, "컷 여백·페이드");
        ui.horizontal(|ui| {
            ui.label(RichText::new("앞").size(13.0)); number(ui, &mut p.ed_pad_b, 0.0, 5.0, 0.01, "초", 60.0);
            ui.add_space(8.0); ui.label(RichText::new("뒤").size(13.0)); number(ui, &mut p.ed_pad_a, 0.0, 5.0, 0.01, "초", 60.0);
            ui.add_space(8.0); ui.label(RichText::new("페이드").size(13.0)); number(ui, &mut p.ed_fade, 0.0, 1000.0, 1.0, "ms", 60.0);
        });
        note(ui, "컷 앞뒤로 남길 소리 여백과, 컷 사이 소리가 튀지 않게 하는 짧은 페이드입니다.");
        row_label(ui, "음성 인식 뒤");
        check(ui, &mut p.ed_tidy, "군말(음·어·아)·말 사이 공백을 자동으로 지우기");
        ui.horizontal(|ui| { ui.add_space(24.0); note(ui, "지운 곳은 노란 표시로 보이고 누르면 되살립니다."); });
        ui.add_space(8.0);
        check(ui, &mut p.apply_now, "지금 열린 편집에도 바로 적용하기");
    }

    fn pane_ai(&mut self, ui: &mut egui::Ui, p: &mut Prefs) {
        row_label(ui, "Gemini API 키");
        let hint = if p.key_state.starts_with("저장됨") { "새 키로 바꿀 때만 입력" } else { "복사한 API 키를 붙여넣으세요" };
        ui.add(style::text_field(&mut p.gemini_key, hint).password(true).desired_width(f32::INFINITY));
        note(ui, &format!("현재: {} · 키 만들기: https://aistudio.google.com/apikey", p.key_state));
        row_label(ui, "AI 모델");
        let mut items: Vec<(String, String)> = MODELS.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        if !items.iter().any(|x| x.0 == p.model) { items.push((p.model.clone(), p.model.clone())); }
        combo(ui, "set-ai-model", &mut p.model, &items, ui.available_width() - 12.0);
        let cur = self.settings["template"]["aiModel"].as_str().unwrap_or(MODELS[0].0).to_string();
        ui.horizontal(|ui| { ui.label(RichText::new("현재 사용 모델:").size(12.0).color(style::MUTED)); ui.label(RichText::new(cur).size(12.0).family(style::bold()).color(style::TEXT2)); });
        ui.add_space(8.0);
        // 연결 확인 결과 받기
        if let Some(rx) = &p.ai_rx { if let Ok((ok, m)) = rx.try_recv() { p.ai_rx = None; p.ai_msg = Some((ok, format!("{} {m}", if ok { "✓" } else { "✗" }))); } else { ui.ctx().request_repaint_after(std::time::Duration::from_millis(200)); } }
        ui.horizontal(|ui| {
            let busy = p.ai_rx.is_some();
            if ui.add_enabled_ui(!busy, |ui| sm_btn(ui, "연결 확인")).inner.clicked() {
                // 새로 입력한 키는 먼저 암호화해 저장한 뒤 시험한다 (기존 settings-ui.js)
                let typed = p.gemini_key.trim().to_string();
                p.ai_msg = None;
                if !typed.is_empty() {
                    match st::save(&json!({ "geminiApiKey": typed, "template": { "aiModel": p.model } })) {
                        Ok(s) => { p.key_state = st::key_suffix(&s, "geminiApiKeyEnc").map(|x| format!("저장됨 (••••{x})")).unwrap_or_else(|| "없음".into()); self.settings = s; p.gemini_key.clear(); }
                        Err(e) => p.ai_msg = Some((false, format!("✗ {e}"))),
                    }
                }
                if p.ai_msg.is_none() {
                    let (key, model) = (sermon_shorts::llm::gemini_key(&st::load()), p.model.clone());
                    let (tx, rx) = std::sync::mpsc::channel();
                    std::thread::spawn(move || { let _ = tx.send(sermon_shorts::llm::gemini::test_connection(&key, &model)); });
                    p.ai_rx = Some(rx);
                }
            }
            if p.ai_rx.is_some() { ui.label(RichText::new("확인 중...").size(12.5).color(style::MUTED)); }
            else if let Some((ok, m)) = &p.ai_msg { ui.label(RichText::new(m).size(12.5).color(if *ok { style::OK } else { ERR })); }
        });    }

    fn pane_church(&mut self, ui: &mut egui::Ui, p: &mut Prefs) {
        row_label(ui, "교회 이름 (쇼츠 아래쪽에 표시)");
        ui.add(style::text_field(&mut p.church, "예: 은혜교회").desired_width(f32::INFINITY));
        row_label(ui, "로고 이미지");
        ui.horizontal(|ui| {
            let (r, _) = ui.allocate_exact_size(egui::vec2(72.0, 72.0), egui::Sense::hover());
            ui.painter().rect(r, CornerRadius::same(12), style::PANEL2, Stroke::new(1.0, style::BORDER), egui::StrokeKind::Inside);
            if let Some(f) = resolve_logo(&p.logo_path).or_else(|| resolve_logo(st::DEFAULT_LOGO)) { icons::file_img(&f, egui::vec2(60.0, 60.0)).paint_at(ui, egui::Rect::from_center_size(r.center(), egui::vec2(60.0, 60.0))); }
            ui.vertical(|ui| {
                ui.horizontal(|ui| {
                    if sm_btn(ui, "이미지 선택").clicked() {
                        if let Some(src) = rfd::FileDialog::new().set_title("교회 로고 이미지 선택").add_filter("이미지", &["png", "jpg", "jpeg", "webp", "svg"]).pick_file() {
                            match theme::import_logo(&src) { Ok(d) => p.logo_path = d.to_string_lossy().to_string(), Err(e) => self.toast(format!("로고를 가져오지 못했습니다: {e}")) }
                        }
                    }
                    if sm_btn(ui, "기본 로고").clicked() { p.logo_path = st::DEFAULT_LOGO.into(); }
                });
                let name = p.logo_path.rsplit(['/', '\\']).next().unwrap_or("").to_string();
                note(ui, &if p.logo_path.is_empty() || p.logo_path.starts_with("assets/") || p.logo_path.starts_with("assets\\") { format!("기본 로고 ({name})") } else { name });
            });
        });
        row_label(ui, "설교자 목록 (이름 직분)");
        let mut del = None;
        for i in 0..p.speakers.len() {
            ui.horizontal(|ui| {
                let was_default = p.default_speaker == p.speakers[i];
                let r = ui.add(style::text_field(&mut p.speakers[i], "예: 홍길동 목사").desired_width(ui.available_width() - 60.0));
                if p.focus_speaker == Some(i) { r.request_focus(); p.focus_speaker = None; }
                if r.changed() && was_default { p.default_speaker = p.speakers[i].clone(); }
                if sm_btn(ui, "삭제").clicked() { del = Some(i); }
            });
        }
        if let Some(i) = del { p.speakers.remove(i); }
        if sm_btn(ui, "+ 설교자 추가").clicked() { p.speakers.push(String::new()); p.focus_speaker = Some(p.speakers.len() - 1); }
        row_label(ui, "기본 설교자");
        let names: Vec<String> = p.speakers.iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect();
        if !names.contains(&p.default_speaker) { p.default_speaker = names.first().cloned().unwrap_or_default(); }
        let items: Vec<(String, String)> = if names.is_empty() { vec![(String::new(), "(설교자를 추가하세요)".into())] } else { names.iter().map(|n| (n.clone(), n.clone())).collect() };
        combo(ui, "set-def-speaker", &mut p.default_speaker, &items, ui.available_width() - 12.0);
        row_label(ui, "우리 교회에서 자주 쓰는 말 (쉼표로 구분, 선택)");
        ui.add(style::text_field(&mut p.terms, "예: 구역장, 셀모임, 권사, 사관, 영문").desired_width(f32::INFINITY));
        note(ui, "교단 직분·교회 이름처럼 자동 자막이 자주 틀리는 말을 넣으면 음성 인식과 AI 편집이 더 정확해집니다.");
    }

    /// true: 테마 편집기 열기
    fn pane_design(&mut self, ui: &mut egui::Ui, p: &mut Prefs) -> bool {
        row_label(ui, "쇼츠 테마");
        let items: Vec<(String, String)> = self.themes.iter().map(|t| (t.id.clone(), t.name.clone())).collect();
        let mut open = false;
        ui.horizontal(|ui| {
            combo(ui, "set-theme", &mut p.theme_id, &items, ui.available_width() - 150.0);
            if sm_btn(ui, "테마 편집기 열기").clicked() { open = true; }
        });
        note(ui, "각 교회만의 디자인을 직접 편집할 수 있습니다.");
        open
    }

    /// 이 탭의 바꾼 값은 [저장]을 누르지 않아도 바로 적용된다
    fn pane_youtube(ui: &mut egui::Ui, p: &mut Prefs) {
        row_label(ui, "유튜브 계정");
        ui.horizontal(|ui| {
            let state = if !p.yt.has_client { "클라이언트 없음 (아래 고급에서 넣어 주세요)".to_string() } else if p.yt.logged_in { format!("로그인됨{}", if p.yt.channel.is_empty() { String::new() } else { format!(" · {}", p.yt.channel) }) } else { "로그인 안 됨".into() };
            left_label(ui, ui.available_width() - 120.0, RichText::new(state).size(12.5).color(style::MUTED));
            if p.yt.logged_in {
                if sm_btn(ui, "로그아웃").clicked() { p.yt = ytupload::sign_out(); p.yt_msg = Some((Some(true), "로그아웃했습니다.".into())); }
            } else if sm_primary(ui, "구글로 로그인", p.yt.has_client && p.yt_rx.is_none()).clicked() {
                p.yt_msg = Some((None, "브라우저에서 구글 로그인을 마쳐 주세요… (5분 안에)".into()));
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::spawn(move || { let _ = tx.send(ytupload::sign_in().map_err(|e| e.to_string())); });
                p.yt_rx = Some(rx);
            }
        });
        note(ui, "브라우저에서 구글 공식 화면으로 로그인합니다. 이 앱은 비밀번호를 받지 않습니다.\n지금은 시험 운영 중이라 미리 등록한 구글 계정만 로그인됩니다. 브라우저에 '액세스 차단됨'이 나오면 개발자에게 구글 이메일 등록을 요청하거나, 아래 [고급]에 우리 교회 클라이언트를 넣으세요.\n교회 채널에 올리려면 계정 선택 화면에서 그 채널(브랜드 계정)을 고르세요. 목록에 없으면 채널 소유자가 로그인해야 합니다.");
        row_label(ui, "영상을 만든 뒤");
        let mut mode = p.yt.upload_mode.clone();
        if combo(ui, "yt-mode", &mut mode, &[("review".into(), "완성 영상 창에서 점검하고 올리기 (권장)".into()), ("auto".into(), "바로 유튜브에 올리기".into()), ("off".into(), "올리지 않기 (완성 영상 창의 [유튜브에 올리기…]로만)".into())], ui.available_width() - 12.0) {
            match ytupload::set_options(None, Some(&mode), None) { Ok(s) => p.yt = s, Err(e) => p.yt_msg = Some((Some(false), e.to_string())) }
        }
        note(ui, "점검하고 올리기: 완성 영상을 보면서 점검 목록을 체크하고, 제목·설명·공개 범위를 고친 뒤 올립니다.");
        row_label(ui, "공개 범위");
        let mut pv = p.yt.privacy.clone();
        if combo(ui, "yt-privacy", &mut pv, &[("unlisted".into(), "일부공개 (링크가 있는 사람만, 확인 후 공개로 바꾸기 권장)".into()), ("private".into(), "비공개 (나만)".into()), ("public".into(), "공개".into())], ui.available_width() - 12.0) {
            match ytupload::set_options(Some(&pv), None, None) { Ok(s) => p.yt = s, Err(e) => p.yt_msg = Some((Some(false), e.to_string())) }
        }
        ui.add_space(10.0);
        let arrow = if p.yt_adv { "▾" } else { "▸" };
        if ui.add(egui::Button::new(RichText::new(format!("{arrow} 고급: 내 구글 OAuth 클라이언트 쓰기")).size(12.0).color(style::MUTED)).frame(false)).clicked() { p.yt_adv = !p.yt_adv; }
        if p.yt_adv {
            note(ui, "앱에 기본 클라이언트가 없거나, 업로드한 영상이 계속 '비공개'로 묶이면 교회 구글 계정으로 만든 클라이언트를 넣으세요. Google Cloud 에서 YouTube Data API v3 사용 설정 → 사용자 인증 정보 → OAuth 클라이언트 ID(데스크톱 앱) 만들기.");
            ui.horizontal(|ui| { if sm_btn(ui, "API 사용 설정 페이지").clicked() { ytupload::open_url(ytupload::LINK_API); } if sm_btn(ui, "사용자 인증 정보 페이지").clicked() { ytupload::open_url(ytupload::LINK_CONSOLE); } });
            let hint = if p.yt.own_client { "저장됨 (클라이언트 ID)".to_string() } else { "클라이언트 ID (….apps.googleusercontent.com)".into() };
            ui.add(style::text_field(&mut p.client_id, &hint).desired_width(f32::INFINITY));
            ui.add(style::text_field(&mut p.client_secret, "클라이언트 보안 비밀번호").password(true).desired_width(f32::INFINITY));
            if sm_btn(ui, "클라이언트 저장").clicked() {
                match ytupload::set_options(None, None, Some((&p.client_id, &p.client_secret))) {
                    Ok(s) => { p.yt = s; p.client_secret.clear(); p.yt_msg = Some((Some(true), "클라이언트를 저장했습니다. 이제 [구글로 로그인]을 누르세요.".into())); }
                    Err(e) => p.yt_msg = Some((Some(false), e.to_string())),
                }
            }
        }
        if let Some((ok, m)) = &p.yt_msg { ui.add_space(6.0); ui.label(RichText::new(m).size(12.5).color(match ok { Some(true) => style::OK, Some(false) => ERR, None => style::MUTED })); }
    }

    /// [저장] (기존 btnSetSave). false 면 창을 닫지 않는다
    pub(crate) fn save_prefs(&mut self, p: &Prefs) -> bool {
        let names: Vec<String> = p.speakers.iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect();
        let def = if names.contains(&p.default_speaker) { p.default_speaker.clone() } else { names.first().cloned().unwrap_or_default() };
        let church = if p.church.trim().is_empty() { "우리 교회".to_string() } else { p.church.trim().to_string() };
        let terms = p.terms.split([',', '，']).map(|x| x.trim()).filter(|x| !x.is_empty()).collect::<Vec<_>>().join(", ");
        let mut patch = json!({
            "template": { "aiModel": p.model, "churchName": church, "logoPath": p.logo_path },
            "speakers": names, "defaultSpeaker": def, "churchTerms": terms,
            "recentYoutubeMax": p.recent_max, "sourceMissing": p.source_missing, "autoUpdate": p.auto_update, "previewProxy": p.preview_proxy,
            "autosave": { "enabled": p.asv_on, "everyMin": p.asv_every, "maxVersions": p.asv_versions, "maxVideos": p.asv_videos, "keepDays": p.asv_days },
            "editDefaults": { "maxLineChars": p.ed_max, "semanticBreaks": p.ed_semantic, "splitLongWords": p.ed_split, "padBefore": p.ed_pad_b, "padAfter": p.ed_pad_a, "fadeMs": p.ed_fade, "autoTidy": p.ed_tidy },
        });
        if !p.gemini_key.trim().is_empty() { patch["geminiApiKey"] = json!(p.gemini_key.trim()); }
        // AI 대화 기본 조건 (이 PC 에 기억)
        self.chat.prefs["length"] = json!(p.chat_len.parse::<i64>().unwrap_or(120));
        self.chat.prefs["count"] = json!(p.chat_count.parse::<i64>().unwrap_or(3));
        self.chat.prefs["audience"] = json!(p.chat_aud);
        for (i, s) in sermon_shorts::chat_plan::STYLES.iter().enumerate() { self.chat.prefs[s.0] = json!(p.chat_styles[i]); }
        self.chat_save_prefs();
        match st::save(&patch) {
            Ok(s) => {
                let was_proxy = self.settings["previewProxy"] != false;
                self.settings = s;
                // 부드러운 미리보기를 켜고 끄면 바로 (지금 영상에도)
                let now_proxy = self.settings["previewProxy"] != false;
                if was_proxy != now_proxy { self.proxy_set_enabled(now_proxy, false); }
                // 화면의 교회 이름도 새 설정으로
                self.church = self.settings["template"]["churchName"].as_str().unwrap_or("").to_string();
                if p.apply_now { self.apply_edit_defaults(); self.recompute(); }
                self.theme_changed();
                self.toast("설정을 저장했습니다.");
                true
            }
            Err(e) => { self.toast(format!("저장 실패: {e}")); false }
        }
    }
}

impl App {
    /// 시험용: 설정 창 값 바꾸기 (prefsflow)
    pub(crate) fn test_prefs_edit(&mut self) {
        if let Some(p) = &mut self.prefs.open {
            p.recent_max = 3.0; p.asv_every = 5.0; p.ed_max = 16.0; p.ed_pad_b = 0.2; p.ed_tidy = false;
            p.church = "  시험교회 ".into(); p.speakers.push("시험 목사".into()); p.default_speaker = "시험 목사".into(); p.terms = "구역장， 셀모임,,사관".into();
        }
    }
    pub(crate) fn test_prefs_tab(&mut self, tab: &'static str) { if let Some(p) = &mut self.prefs.open { p.tab = tab; } }
    pub(crate) fn test_prefs_save(&mut self) -> bool { let Some(p) = self.prefs.open.take() else { return false }; let ok = self.save_prefs(&p); if !ok { self.prefs.open = Some(p); } ok }
}
