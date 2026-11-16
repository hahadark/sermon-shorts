//! AI 연결 창 (기존 chat-ui.js openConnect·renderCards·act_) · 대화 칸 머리의 연결 표시 · AI 용어 교정·쇼츠 추천 자리
use crate::*;
use sermon_shorts::llm::{self, Status};
use std::sync::mpsc::{channel, Receiver};

/// 연결 창에서 한 일의 결과: 알림 글 + 새 상태
pub(crate) struct JobOut { pub msg: Option<String>, pub status: Status }

#[derive(Default)]
pub(crate) struct State {
    /// 마지막으로 확인한 연결 상태 (대화 칸 머리 표시에도 쓴다)
    pub status: Option<Status>,
    status_rx: Option<Receiver<Status>>,
    started: bool,
    /// 연결 창이 열려 있는지
    pub open: bool,
    pub msg: String,
    gem_key: String,
    or_key: String,
    /// 지금 하는 일 (단추 막기) 과 결과 받기
    pub busy: Option<&'static str>,
    job: Option<Receiver<JobOut>>,
    /// 시험용: 지난 화면의 단추 자리 (이름, 자리)
    pub rects: Vec<(String, egui::Rect)>,
}

const LINE: f32 = 20.8; // 13px × 1.6

/// 굵은 글씨가 섞인 문단 (기존 <p>…<b>…</b>…</p>)
fn rich(ui: &mut egui::Ui, parts: &[(&str, bool)], size: f32, color: Color32) {
    let mut job = egui::text::LayoutJob::default();
    for (t, b) in parts {
        job.append(t, 0.0, egui::TextFormat { font_id: egui::FontId::new(size, if *b { style::bold() } else { egui::FontFamily::Proportional }), color, line_height: Some(size * 1.6), ..Default::default() });
    }
    job.wrap.max_width = ui.available_width();
    job.wrap.break_anywhere = true;
    ui.label(job);
}
/// 번호 목록 한 줄 (흐리게: 이미 끝난 단계)
fn li(ui: &mut egui::Ui, n: usize, parts: &[(&str, bool)], dim: bool) {
    let col = if dim { Color32::from_rgba_unmultiplied(0x33, 0x41, 0x55, 140) } else { style::TEXT2 };
    ui.horizontal_top(|ui| {
        ui.add_space(4.0);
        ui.add_sized([14.0, LINE], egui::Label::new(RichText::new(format!("{n}.")).size(13.0).color(col)));
        ui.vertical(|ui| rich(ui, parts, 13.0, col));
    });
}
fn btn(ui: &mut egui::Ui, text: &str, primary: bool, enabled: bool) -> egui::Response {
    let (fill, color, stroke) = if primary { (style::PRIMARY, Color32::WHITE, Stroke::new(1.0, style::PRIMARY)) } else { (Color32::WHITE, style::TEXT, Stroke::new(1.0, style::BORDER_STRONG)) };
    ui.add_enabled(enabled, egui::Button::new(RichText::new(text).size(13.0).family(style::semi()).color(color)).fill(fill).stroke(stroke).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(0.0, 34.0)))
}
fn state_pill(ui: &mut egui::Ui, text: &str, ok: bool) {
    let (fill, col) = if ok { (Color32::from_rgb(0xe7, 0xf8, 0xee), Color32::from_rgb(0x15, 0x80, 0x3d)) } else { (style::PANEL3, style::MUTED) };
    egui::Frame::new().fill(fill).corner_radius(CornerRadius::same(255)).inner_margin(egui::Margin::symmetric(10, 3))
        .show(ui, |ui| ui.label(RichText::new(text).size(12.0).family(style::bold()).color(col)));
}
fn note(ui: &mut egui::Ui, t: &str) { rich(ui, &[(t, false)], 12.0, style::MUTED); }

impl App {
    /// 왼쪽 [AI 연결]·메뉴 [AI 연결]·대화 칸 머리 표시 → 연결 창 (기존 SS.openAiConnect)
    pub(crate) fn open_ai_connect(&mut self) {
        self.ai.open = true;
        self.ai.msg.clear();
        self.ai.gem_key.clear();
        self.ai.or_key.clear();
        self.refresh_ai_status();
    }
    /// 연결 상태 다시 묻기 (클로드 프로그램을 물어보느라 몇 초 걸려 화면 밖에서)
    pub(crate) fn refresh_ai_status(&mut self) {
        if self.ai.status_rx.is_some() { return; }
        let (tx, rx) = channel();
        std::thread::spawn(move || { let _ = tx.send(llm::status()); });
        self.ai.status_rx = Some(rx);
        self.ai.started = true;
    }
    /// 대화 칸 머리 표시: (글, 연결됨?)
    pub(crate) fn ai_chip(&self) -> (String, bool) {
        self.ai.status.as_ref().map(|s| s.chip()).unwrap_or_else(|| ("AI 연결 필요".into(), false))
    }

    /// 왼쪽 메뉴 [AI 연결] 화면 (기존: 페이지가 아니라 연결 창을 연다)
    pub(crate) fn ai_page(&mut self, _ui: &mut egui::Ui) { self.page = Page::Editor; self.open_ai_connect(); }
    /// 자막 도구 [용어 교정] 을 쓸 수 있는지
    pub(crate) fn ai_can_correct(&self) -> bool { false }
    /// 자막 → AI 용어 교정
    pub(crate) fn cmd_ai_correct(&mut self) { self.toast("AI 용어 교정: Rust 판으로 옮기는 중입니다"); }
    /// AI → AI 쇼츠 추천
    pub(crate) fn cmd_ai_recommend(&mut self) { self.toast("AI 쇼츠 추천: Rust 판으로 옮기는 중입니다"); }

    /// 연결 창의 단추 하나 (기존 act_): 화면 밖에서 하고, 끝나면 상태를 다시 묻고 하나만 준비됐으면 그것을 고른다
    fn ai_act(&mut self, what: &'static str) {
        if self.ai.job.is_some() { return; }
        let prev = self.ai.status.as_ref().and_then(|s| s.active.clone());
        let (gk, ok_) = (self.ai.gem_key.trim().to_string(), self.ai.or_key.trim().to_string());
        // 키 모양 먼저 (기존: 짧거나 띄어쓰기가 있으면 저장하지 않음)
        let bad_key = |k: &str| k.is_empty() || k.chars().any(char::is_whitespace) || k.chars().count() < 20;
        if (what == "gmSave" && bad_key(&gk)) || (what == "orSave" && bad_key(&ok_)) {
            self.ai.msg = "키가 너무 짧거나 띄어쓰기가 들어 있습니다. 복사한 키 전체를 그대로 붙여 넣어 주세요.".into();
            return;
        }
        self.ai.msg = match what {
            "gptIn" => "브라우저에서 챗GPT 로그인을 마쳐 주세요… (5분 안에)".into(),
            "gmSave" => "저장했습니다. 연결을 확인하는 중…".into(),
            "orSave" => "저장했습니다. 연결을 확인하는 중… (무료 모델은 30초쯤 걸릴 수 있습니다)".into(),
            _ => self.ai.msg.clone(),
        };
        if what == "gmSave" || what == "orSave" {
            let field = if what == "gmSave" { "geminiApiKey" } else { "openrouterApiKey" };
            match sermon_shorts::settings::save(&json!({ field: if what == "gmSave" { &gk } else { &ok_ } })) {
                Ok(s) => { self.settings = s; self.ai.gem_key.clear(); self.ai.or_key.clear(); }
                Err(er) => { self.ai.msg = er.to_string(); return; }
            }
        }
        self.ai.busy = Some(what);
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            let use_name = what.strip_prefix("use:");
            let mut msg: Option<String> = None;
            let r: Result<(), String> = (|| {
                match what {
                    "gptIn" => {
                        let st = llm::chatgpt::sign_in().map_err(|er| er.msg)?;
                        let _ = llm::set_active(Some("chatgpt"));
                        msg = Some(if st.plan_enabled { "챗GPT 가 연결되었습니다. 이제 요금제 사용량으로 대화합니다.".into() } else { "로그인은 되었지만 \"요금제 사용\"이 허용되지 않았습니다. [다시 연결]에서 허용해 주세요.".into() });
                    }
                    "gptOut" => {
                        llm::chatgpt::sign_out().map_err(|er| er.msg)?;
                        msg = Some("챗GPT 연결을 끊었습니다.".into());
                        if prev.as_deref() == Some("chatgpt") { let _ = llm::set_active(None); }
                    }
                    "clInstall" => { llm::claude::open_install()?; msg = Some("설치 창이 열렸습니다. 설치가 끝나면 [클로드 로그인]으로 넘어가세요. (화면이 바뀌지 않으면 [다시 확인])".into()); }
                    "clLogin" => { llm::claude::open_login()?; msg = Some("로그인 창이 열렸습니다. 브라우저에서 로그인을 마친 뒤 [다시 확인]을 누르세요.".into()); }
                    "gmSave" | "orSave" => {
                        let (name, label) = if what == "gmSave" { ("gemini", "제미나이") } else { ("openrouter", "오픈라우터") };
                        let (ok, text) = llm::test(name);
                        msg = Some(if ok { format!("{label}가 연결되었습니다.") } else { format!("키를 저장했지만 연결 확인에 실패했습니다: {text}") });
                        if ok { let _ = llm::set_active(Some(name)); }
                    }
                    _ => { if let Some(n) = use_name { llm::set_active(Some(n))?; } }
                }
                Ok(())
            })();
            if let Err(er) = r { msg = Some(er); }
            let mut st = llm::status();
            // 하나만 준비된 경우 자동으로 고른다
            if st.active.as_ref().is_none_or(|a| !st.is_ready(a)) {
                let ready: Vec<&str> = llm::PROVIDERS.iter().copied().filter(|p| st.is_ready(p)).collect();
                if ready.len() == 1 && Some(ready[0]) != prev.as_deref() && llm::set_active(Some(ready[0])).is_ok() { st.active = Some(ready[0].into()); }
            }
            let _ = tx.send(JobOut { msg, status: st });
        });
        self.ai.job = Some(rx);
    }

    /// 매 화면: 상태·일 받기, 연결 창 그리기
    pub(crate) fn ai_ui(&mut self, ctx: &egui::Context) {
        if !self.ai.started && self.test.is_none() { self.refresh_ai_status(); }
        if let Some(rx) = &self.ai.status_rx { if let Ok(s) = rx.try_recv() { self.ai.status = Some(s); self.ai.status_rx = None; } }
        if let Some(rx) = &self.ai.job {
            if let Ok(o) = rx.try_recv() {
                self.ai.job = None; self.ai.busy = None;
                if let Some(m) = o.msg { self.ai.msg = m; }
                self.ai.status = Some(o.status);
                self.settings = sermon_shorts::settings::load();
            }
        }
        if self.ai.status_rx.is_some() || self.ai.job.is_some() { ctx.request_repaint_after(std::time::Duration::from_millis(200)); }
        if !self.ai.open { return; }
        let mut close = false;
        let mut act: Option<&'static str> = None;
        let mut link: Option<&'static str> = None;
        let frame = egui::Frame::new().fill(style::PANEL).corner_radius(CornerRadius::same(24)).inner_margin(egui::Margin::symmetric(28, 26))
            .shadow(egui::epaint::Shadow { offset: [0, 30], blur: 80, spread: 0, color: Color32::from_rgba_unmultiplied(15, 23, 42, 71) });
        let busy = self.ai.busy;
        let mut rects: Vec<(String, egui::Rect)> = vec![];
        let mr = egui::Modal::new(egui::Id::new("ai-connect")).frame(frame).backdrop_color(Color32::from_rgba_unmultiplied(15, 23, 42, 97)).show(ctx, |ui| {
            ui.set_width(760.0 - 56.0);
            ui.label(RichText::new("AI 연결").size(20.8).family(style::bold()).color(style::TEXT));
            ui.add_space(14.0);
            let max_h = ctx.content_rect().height() * 0.86 - 52.0 - 34.0 - 40.0;
            let so = egui::ScrollArea::vertical().max_height(max_h).min_scrolled_height(max_h).auto_shrink([false, true]).show(ui, |ui| {
                let Some(s) = self.ai.status.clone() else {
                    ui.label(RichText::new("상태를 확인하는 중…").size(14.0).color(style::MUTED));
                    return;
                };
                let active = s.active.clone();
                rich(ui, &[("넷 중 ", false), ("하나만", true), (" 연결하면 됩니다. 이미 쓰고 있는 AI 가 있다면 그것을 고르세요.", false)], 13.0, style::MUTED);
                ui.add_space(12.0);
                let card = |ui: &mut egui::Ui, name: &str, body: &mut dyn FnMut(&mut egui::Ui)| {
                    let on = active.as_deref() == Some(name);
                    let (fill, stroke) = if on { (style::PRIMARY_SOFT, Stroke::new(1.5, Color32::from_rgb(0x3b, 0x82, 0xf6))) } else { (style::PANEL2, Stroke::new(1.0, style::BORDER)) };
                    egui::Frame::new().fill(fill).stroke(stroke).corner_radius(CornerRadius::same(18)).inner_margin(egui::Margin::symmetric(18, 16)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.spacing_mut().item_spacing.y = 6.0;
                        body(ui);
                    });
                    ui.add_space(12.0);
                };
                // 이 AI 로 대화하기 / 대화에 사용 중
                let use_btn = |ui: &mut egui::Ui, name: &'static str, act: &mut Option<&'static str>, rects: &mut Vec<(String, egui::Rect)>| {
                    if !s.is_ready(name) { return; }
                    if active.as_deref() == Some(name) { state_pill(ui, "대화에 사용 중", true); }
                    else if { let r = btn(ui, "이 AI 로 대화하기", true, busy.is_none()); rects.push((format!("use:{name}"), r.rect)); r.clicked() } { *act = Some(match name { "chatgpt" => "use:chatgpt", "claude" => "use:claude", "gemini" => "use:gemini", _ => "use:openrouter" }); }
                };
                let head = |ui: &mut egui::Ui, title: &str, st: &str, ok: bool| {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(title).size(15.0).family(style::bold()).color(style::TEXT));
                        ui.add_space(2.0);
                        state_pill(ui, st, ok);
                    });
                };
                // ---- 챗GPT
                let g = &s.chatgpt;
                card(ui, "chatgpt", &mut |ui| {
                    let st = if g.connected { if g.plan_enabled { format!("연결됨 · {}", g.email) } else { "요금제 사용 허용 필요".into() } } else { "연결 안 됨".into() };
                    head(ui, "챗GPT", &st, g.connected && g.plan_enabled);
                    rich(ui, &[("챗GPT 계정으로 로그인합니다. ", false), ("Plus·Go·Pro 요금제", true), ("가 있으면 그 사용량 안에서 쓰고, 따로 돈이 들지 않습니다.", false)], 13.0, style::TEXT2);
                    li(ui, 1, &[("[ChatGPT로 계속하기]를 누르면 브라우저가 열립니다.", false)], false);
                    li(ui, 2, &[("챗GPT에 로그인하고 ", false), ("\"Use your ChatGPT plan(요금제 사용)\"을 허용", true), ("합니다.", false)], false);
                    li(ui, 3, &[("\"로그인이 끝났습니다\" 화면이 나오면 이 창으로 돌아옵니다.", false)], false);
                    ui.horizontal_wrapped(|ui| {
                        ui.spacing_mut().item_spacing.x = 8.0;
                        if g.connected {
                            if btn(ui, "연결 끊기", false, busy.is_none()).clicked() { act = Some("gptOut"); }
                            if btn(ui, "사용량 관리", false, true).clicked() { link = Some("chatgptUsage"); }
                            if !g.plan_enabled && btn(ui, "다시 연결 (요금제 허용)", true, busy.is_none()).clicked() { act = Some("gptIn"); }
                        } else if btn(ui, if busy == Some("gptIn") { "브라우저에서 로그인하는 중…" } else { "ChatGPT로 계속하기" }, true, busy.is_none()).clicked() { act = Some("gptIn"); }
                        use_btn(ui, "chatgpt", &mut act, &mut rects);
                    });
                });
                // ---- 클로드
                let c = &s.claude;
                card(ui, "claude", &mut |ui| {
                    head(ui, "클로드", if c.logged_in { "연결됨" } else if c.installed { "로그인 필요" } else { "설치 필요" }, c.logged_in);
                    rich(ui, &[("클로드는 Anthropic 공식 프로그램 ", false), ("Claude Code", true), ("를 통해 연결합니다. 로그인은 Anthropic 공식 화면에서만 하고, 이 앱은 계정 정보를 받지 않습니다. ", false),
                        ("클로드 Pro 이상 요금제", true), ("가 필요합니다(무료 요금제는 Claude Code 를 쓸 수 없습니다).", false)], 13.0, style::TEXT2);
                    li(ui, 1, &[("[Claude Code 설치]를 누르면 검은 창이 열려 설치합니다. 끝날 때까지 기다립니다(1~2분).", false)], c.installed);
                    li(ui, 2, &[("[클로드 로그인]을 누르고, 열리는 브라우저에서 클로드 계정으로 로그인합니다.", false)], c.logged_in);
                    li(ui, 3, &[("끝나면 [다시 확인]을 누릅니다.", false)], false);
                    ui.horizontal_wrapped(|ui| {
                        ui.spacing_mut().item_spacing.x = 8.0;
                        if !c.installed && btn(ui, "Claude Code 설치", true, busy.is_none()).clicked() { act = Some("clInstall"); }
                        if c.installed && !c.logged_in && btn(ui, "클로드 로그인", true, busy.is_none()).clicked() { act = Some("clLogin"); }
                        if btn(ui, if busy == Some("refresh") { "확인하는 중…" } else { "다시 확인" }, false, busy.is_none()).clicked() { act = Some("refresh"); }
                        if btn(ui, "설치 안내 페이지", false, true).clicked() { link = Some("claudeSetup"); }
                        use_btn(ui, "claude", &mut act, &mut rects);
                    });
                    note(ui, "요금은 사용자의 클로드 요금제 사용량에서 차감됩니다. Anthropic 정책이 바뀌면 이 방식이 막힐 수 있습니다.");
                });
                // ---- 제미나이
                let m = &s.gemini;
                let gem_key = &mut self.ai.gem_key;
                card(ui, "gemini", &mut |ui| {
                    head(ui, "제미나이", &if m.has_key { format!("키 저장됨 (…{})", m.suffix) } else { "키 필요".into() }, m.has_key);
                    rich(ui, &[("유료 구독이 없어도 구글 계정만 있으면 ", false), ("무료 키", true), ("로 쓸 수 있습니다.", false)], 13.0, style::TEXT2);
                    li(ui, 1, &[("[키 발급 페이지 열기] → 구글 계정으로 로그인합니다.", false)], false);
                    li(ui, 2, &[("Create API key", true), ("(API 키 만들기)를 눌러 나온 키를 복사합니다.", false)], false);
                    li(ui, 3, &[("아래 칸에 붙여 넣고 [저장]을 누릅니다.", false)], false);
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 8.0;
                        if btn(ui, "키 발급 페이지 열기", false, true).clicked() { link = Some("geminiKey"); }
                        let w = (ui.available_width() - 70.0 - if s.is_ready("gemini") { 130.0 } else { 0.0 }).max(220.0);
                        let kr = ui.add(style::text_field(gem_key, "복사한 API 키 전체를 붙여 넣으세요").password(true).desired_width(w));
                        rects.push(("gemKey".into(), kr.rect));
                        let sb = btn(ui, if busy == Some("gmSave") { "확인 중…" } else { "저장" }, true, busy.is_none());
                        rects.push(("gmSave".into(), sb.rect));
                        if sb.clicked() { act = Some("gmSave"); }
                        use_btn(ui, "gemini", &mut act, &mut rects);
                    });
                    note(ui, "키는 이 컴퓨터에 암호화되어 저장됩니다. 무료 사용량을 넘으면 잠시 쉬었다가 다시 쓰면 됩니다.");
                });
                // ---- 오픈라우터
                let o = &s.openrouter;
                let or_key = &mut self.ai.or_key;
                card(ui, "openrouter", &mut |ui| {
                    head(ui, "오픈라우터", &if o.has_key { format!("키 저장됨 (…{})", o.suffix) } else { "키 필요".into() }, o.has_key);
                    rich(ui, &[("openrouter.ai 의 ", false), ("무료 모델", true), ("을 씁니다. 결제 정보 없이 가입만 하면 됩니다. 그때 쓸 수 있는 무료 모델을 오픈라우터가 골라 주고, 붐비면 다른 무료 모델로 바꿔 다시 해 봅니다.", false)], 13.0, style::TEXT2);
                    li(ui, 1, &[("[키 발급 페이지 열기] → 구글 계정 등으로 가입·로그인합니다.", false)], false);
                    li(ui, 2, &[("Create API Key", true), ("(키 만들기)를 눌러 나온 키(sk-or-…)를 복사합니다.", false)], false);
                    li(ui, 3, &[("아래 칸에 붙여 넣고 [저장]을 누릅니다.", false)], false);
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 8.0;
                        if btn(ui, "키 발급 페이지 열기", false, true).clicked() { link = Some("openrouterKey"); }
                        let w = (ui.available_width() - 70.0 - if s.is_ready("openrouter") { 130.0 } else { 0.0 }).max(220.0);
                        ui.add(style::text_field(or_key, "sk-or- 로 시작하는 키를 붙여 넣으세요").password(true).desired_width(w));
                        if btn(ui, if busy == Some("orSave") { "확인 중…" } else { "저장" }, true, busy.is_none()).clicked() { act = Some("orSave"); }
                        use_btn(ui, "openrouter", &mut act, &mut rects);
                    });
                    note(ui, "무료 모델은 하루 쓸 수 있는 횟수가 정해져 있고, 다른 AI 보다 편집 품질이 들쭉날쭉할 수 있습니다. 대화 내용이 무료 모델 제공 회사의 학습에 쓰일 수 있습니다.");
                });
                ui.allocate_ui(egui::vec2(ui.available_width(), 18.0), |ui| note(ui, &self.ai.msg));
            });
            rects.push(("clip".into(), so.inner_rect));
            ui.add_space(6.0);
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| { let r = btn(ui, "닫기", false, true); rects.push(("close".into(), r.rect)); if r.clicked() { close = true; } });
        });
        self.ai.rects = rects;
        if mr.backdrop_response.clicked() { close = true; }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) && !ctx.egui_wants_keyboard_input() { close = true; }
        if let Some(k) = link { if let Err(er) = llm::open_link(k) { self.ai.msg = er; } }
        if let Some(a) = act { self.ai_act(a); }
        if close { self.ai.open = false; self.refresh_ai_status(); }
    }
}
