//! 교인 자료 스튜디오 (기존 materials-ui.js · delivery-ui.js · card-visuals.js): 설교 한 편으로 소그룹·QT·퀴즈·요약·묵상카드·가정예배지·
//! 카드뉴스·리더 가이드·설교 PPT 를 만들고, 고치고, PDF·PNG·인쇄·글 복사로 나눈다. 설교 전달 점검(자막 시각, AI 없음).
//! 만든 자료는 프로젝트(.sshorts)의 materials 에 함께 저장된다 (Electron 판과 같은 모양).
use crate::*;
use serde_json::{json, Value};
use sermon_shorts::{delivery, materials as mat, matrender as mr};
use std::collections::{HashMap, VecDeque};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone, Copy, PartialEq, Default)]
pub(crate) enum MPage { #[default] Make, Results, Delivery }

/// 만들기 일꾼이 돌려주는 것
enum GenMsg { Busy(String), Checking(String), Done(String, Result<(Value, String), String>, Option<Value>), End }
enum Job { Toast(String, Option<PathBuf>), Check(String, Value) }

impl State { pub fn prev_rx_idle(&self) -> bool { self.prev_rx.is_none() } }

#[derive(Default)]
pub(crate) struct State {
    pub page: MPage,
    pub current: String,
    pub status: HashMap<String, String>,
    gen_rx: Option<Receiver<GenMsg>>,
    gen_workers: usize,
    gen_t0: Option<Instant>,
    gen_done: usize,
    gen_failed: Vec<String>,
    pub note: String,
    pub err: String,
    opt_open: bool,
    // 미리보기
    pub prev_key: u64,
    pub prev_want: u64,
    prev_at: Option<Instant>,
    prev_rx: Option<Receiver<(u64, Result<Vec<egui::ColorImage>, String>)>>,
    pub prev_tex: Vec<egui::TextureHandle>,
    pub prev_err: String,
    // 내보내기·대조
    job_rx: Option<Receiver<Job>>,
    pub busy_label: String,
    scene: String,
    // 전달 점검
    dl_src: String,
    pub dl: Option<delivery::Report>,
    dl_label: String,
    dl_ran: bool,
    pub rects: Vec<(String, egui::Rect)>,
    opened: bool,
}

fn last_sunday() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) + sermon_shorts::youtube::local_offset_secs();
    let days = now.div_euclid(86400);
    let dow = (days + 4).rem_euclid(7); // 1970-01-01 은 목요일 → 0 = 일요일
    let (y, m, d) = sermon_shorts::youtube::civil_from_days(days - dow);
    format!("{y}년 {m}월 {d}일")
}
fn type_label(id: &str) -> &'static str { mat::type_of(id).map(|t| t.label).unwrap_or("자료") }
fn s(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }
fn clean_title(t: &str) -> String { regex::Regex::new(r"\s+/\s+").unwrap().replace_all(&t.replace('*', ""), " ").to_string() }
const DESIGNS: [(&str, &str, [u8; 3]); 4] = [("navy", "새벽 남색", [0x13, 0x29, 0x4b]), ("paper", "종이", [0xf7, 0xf2, 0xe8]), ("sky", "하늘", [0xe4, 0xef, 0xff]), ("scene", "영상 장면", [0x33, 0x33, 0x33])];
const CARD_EXTRA: [(&str, &str, [u8; 3]); 2] = [("sage", "잔잔한 초록", [0xc9, 0xdd, 0xc3]), ("editorial", "잡지", [0xc2, 0x41, 0x0c])];
/// 고칠 칸 이름
fn field_label(k: &str) -> &str {
    match k {
        "title" => "제목", "verse" => "본문", "theme" => "핵심 한 문장", "points" => "대지", "heading" => "제목", "body" => "내용", "application" => "삶의 적용", "prayer" => "기도",
        "summary" => "말씀 요약", "icebreaker" => "마음 열기", "questions" => "질문", "q" => "질문", "note" => "리더 도움말", "action" => "실천", "days" => "날", "passage" => "본문",
        "meditation" => "묵상", "keyline" => "마음에 새길 한 문장", "question" => "묵상 질문", "items" => "문제", "choices" => "보기", "answer" => "정답", "explain" => "해설",
        "cards" => "카드", "headline" => "큰 글", "source" => "근거", "opening" => "찬양", "story" => "말씀 이야기", "activity" => "함께 해 보기", "blessing" => "축복",
        "subtitle" => "부제", "slides" => "장", "highlight" => "강조 구절", "closing" => "마무리", "goal" => "모임 목표", "prepare" => "미리 준비", "flow" => "진행 순서",
        "part" => "단계", "minutes" => "분", "guide" => "진행 방법", "intent" => "의도", "expected" => "예상 답", "followup" => "이어서", "tips" => "진행 팁", "lines" => "줄", "ref" => "성경 장절",
        _ => k,
    }
}
fn photo_url(path: &std::path::Path) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > 15 * 1024 * 1024 { return Err("사진은 15MB 이하로 골라 주세요.".into()); }
    let img = image::open(path).map_err(|_| "사진을 읽지 못했습니다. JPG·PNG·WebP 파일을 골라 주세요.".to_string())?;
    let (w, h) = (img.width(), img.height());
    let sc = (1600.0 / w.max(h) as f64).min(1.0);
    let img = if sc < 1.0 { img.resize((w as f64 * sc).round() as u32, (h as f64 * sc).round() as u32, image::imageops::FilterType::Triangle) } else { img };
    let mut buf = std::io::Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 86).encode_image(&img.to_rgb8()).map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(buf.into_inner())))
}

impl App {
    /// 프로젝트의 교인 자료 (기존 store(): 빠진 것은 기본값으로)
    pub(crate) fn mstore(&mut self) -> &mut Value {
        let m = self.project.rest.entry("materials".to_string()).or_insert_with(|| json!({}));
        if !m.is_object() { *m = json!({}); }
        if !m["source"].is_string() { m["source"] = json!("video"); }
        if !m["sermon"].is_string() { m["sermon"] = json!(""); }
        m["options"] = mat::norm_options(&m["options"]);
        let sel: Vec<Value> = m["selected"].as_array().map(|a| a.iter().filter(|t| t.as_str().is_some_and(|x| mat::type_of(x).is_some())).cloned().collect()).unwrap_or_else(|| ["smallgroup", "qt", "quiz", "summary", "cards"].iter().map(|x| json!(x)).collect());
        m["selected"] = json!(sel);
        if !m["results"].is_object() { m["results"] = json!({}); }
        let all: Vec<&str> = DESIGNS.iter().chain(CARD_EXTRA.iter()).map(|d| d.0).collect();
        if !m["design"].as_str().is_some_and(|d| all.contains(&d)) { m["design"] = json!("navy"); }
        if !m["meta"].is_object() { m["meta"] = json!({}); }
        m
    }
    /// 자료에 쓸 설교 정보 (기존 meta(): 고친 값이 있으면 그것, 없으면 편집기·설정에서)
    pub(crate) fn mmeta(&mut self) -> Value {
        let church = self.settings["template"]["churchName"].as_str().unwrap_or("").to_string();
        let (title, verse, speaker) = (clean_title(&self.title), self.verse.clone(), { let sp = self.speaker(); if sp.is_empty() { self.settings["defaultSpeaker"].as_str().unwrap_or("").to_string() } else { sp } });
        let m = self.mstore()["meta"].clone();
        let pick = |k: &str, d: String| m.get(k).and_then(|v| v.as_str()).map(String::from).unwrap_or(d);
        json!({ "church": pick("church", church), "title": pick("title", title), "verse": pick("verse", verse), "speaker": pick("speaker", speaker), "date": pick("date", last_sunday()) })
    }
    fn mdirty(&mut self) { if self.has_project { self.unsaved = true; } }

    /// 왼쪽 메뉴 [교인 자료] 를 열 때 (기존 open)
    fn mat_open_init(&mut self) {
        if self.mstore()["sermon"].as_str().is_some_and(|s| s.is_empty()) && self.mstore()["source"] == "video" { self.mat_source("video", false); }
        let has = self.mstore()["results"].as_object().is_some_and(|r| !r.is_empty());
        if has && self.materials.page == MPage::Make && self.materials.current.is_empty() { self.materials.page = MPage::Make; }
    }

    /// 설교 원고 고르기 (기존 setSource)
    fn mat_source(&mut self, kind: &str, user: bool) {
        match kind {
            "file" if user => {
                let Some(f) = rfd::FileDialog::new().set_title("설교 원고 불러오기").add_filter("설교 원고 (한글·워드·PDF·글)", &["hwp", "hwpx", "docx", "pdf", "txt", "md", "srt"]).pick_file() else { return };
                match sermon_shorts::materials_file::read_text(&f) {
                    Ok(t) => { let m = self.mstore(); m["source"] = json!("file"); m["sermon"] = json!(t); m["fileName"] = json!(f.file_name().unwrap_or_default().to_string_lossy()); }
                    Err(e) => { self.mstore()["sourceNote"] = json!(format!("파일을 읽지 못했습니다: {e}")); return; }
                }
            }
            "video" => {
                let (mut text, mut note) = (String::new(), String::new());
                let src = self.chat.shared.lock().unwrap().as_ref().map(|ss| {
                    let w = &ss.words;
                    let (a, b) = match ss.sermon { Some((f, t)) => (f.saturating_sub(5), (t + 5).min(w.len().saturating_sub(1))), None => (0, w.len().saturating_sub(1)) };
                    let ws: Vec<Value> = w.get(a..=b).unwrap_or(&[]).iter().map(|x| json!({ "text": x.text, "start": x.start, "end": x.end })).collect();
                    let mins = if ws.is_empty() { 0 } else { ((w[b].end - w[a].start) / 60.0).round() as i64 };
                    (ws, ss.sermon.is_none(), mins)
                });
                if let Some((ws, whole, mins)) = src.filter(|x| !x.0.is_empty()) { text = mat::sermon_text(&ws); note = format!("AI 편집 대화에서 불러온 유튜브 자막{} (약 {mins}분)", if whole { " 전체" } else { "의 설교 부분" }); }
                if text.is_empty() && !self.project.words.is_empty() {
                    let ws: Vec<Value> = self.project.words.iter().map(|w| json!({ "text": w.text, "start": w.start, "end": w.end })).collect();
                    text = mat::sermon_text(&ws);
                    let w = &self.project.words;
                    note = format!("편집 중인 영상의 자막 (약 {}분). 설교 전체로 만들려면 AI 편집 대화에 유튜브 주소를 넣거나 원고 파일을 불러오세요.", ((w[w.len() - 1].end - w[0].start) / 60.0).round().max(1.0) as i64);
                }
                if text.is_empty() { note = "불러올 설교 자막이 없습니다. 원고를 직접 넣거나 파일을 불러오세요.".into(); }
                let m = self.mstore(); m["source"] = json!("video"); m["sermon"] = json!(text); m["sourceNote"] = json!(note);
            }
            "manual" if user => { let m = self.mstore(); m["source"] = json!("manual"); m["sourceNote"] = json!(""); }
            _ => {}
        }
        if kind != "file" || self.mstore()["fileName"].is_string() { self.mstore()["source"] = json!(kind); }
    }

    fn opt_summary(&mut self, id: &str) -> String {
        let o = self.mstore()["options"].clone();
        let g = |k: &str| match &o[k] { Value::String(x) => x.clone(), v => v.to_string() };
        let a = g("audience");
        match id {
            "smallgroup" => format!("{a} · {} · 질문 5~6개", g("smallgroup")), "qt" => format!("{a} · {}일 · {} · {}", g("qtDays"), g("qtFocus"), g("qtForm")),
            "quiz" => format!("{a} · {} · 8문제", g("quiz")), "summary" => format!("{a} · {}", g("summary")), "cards" => format!("{} · {}장 · SNS 이미지", g("cardTone"), g("cardCount")),
            "family" => "부모와 자녀가 15분 · 쉬운 말".into(), "cardnews" => format!("{}장 · 표지·핵심·이번 주 실천 · 인스타", g("newsCount")),
            "leader" => format!("{a} · {}분 모임 · 질문 의도·예상 답", g("leaderTime")), "slides" => format!("{}장 · 16:9 · PPT 저장", g("slideCount")), _ => String::new(),
        }
    }

    /// 선택한 자료 만들기 (기존 generate: 셋씩 동시에)
    pub(crate) fn mat_generate(&mut self) {
        if self.materials.gen_rx.is_some() { return; }
        if self.mstore()["demoMode"] == true { self.toast("샘플 체험에서는 AI를 사용하지 않습니다. 원래 자료로 돌아간 뒤 만들어 주세요."); return; }
        self.materials.err.clear();
        let sermon = s(&self.mstore()["sermon"]);
        if sermon.chars().filter(|c| !c.is_whitespace()).count() < 200 { self.materials.err = "설교 원고가 너무 짧습니다. 설교 자막이나 원고를 넣어 주세요 (200자 이상).".into(); return; }
        if sermon_shorts::llm::active_provider(&self.settings).is_none() { self.materials.err = "AI 가 연결되어 있지 않습니다. 위의 [AI 연결 필요]를 눌러 챗GPT·클로드·제미나이 중 하나를 연결해 주세요.".into(); return; }
        let md = self.mmeta();
        let mut ctx = md.clone(); ctx["sermon"] = json!(sermon);
        let m = self.mstore().clone();
        let queue: VecDeque<String> = m["selected"].as_array().unwrap().iter().filter_map(|x| x.as_str().map(String::from)).collect();
        if queue.is_empty() { return; }
        self.materials.status = queue.iter().map(|t| (t.clone(), "wait".to_string())).collect();
        let verify = m["verify"] != false;
        let q = Arc::new(Mutex::new(queue));
        let (tx, rx) = channel::<GenMsg>();
        let workers = 3;
        for _ in 0..workers {
            let (q, tx, opts, ctx, md) = (q.clone(), tx.clone(), m["options"].clone(), ctx.clone(), md.clone());
            std::thread::spawn(move || {
                loop {
                    let Some(ty) = q.lock().unwrap().pop_front() else { break };
                    let _ = tx.send(GenMsg::Busy(ty.clone()));
                    let r = mat::generate(&ty, &opts, &ctx);
                    let mut ck = None;
                    if let (Ok((d, _)), true) = (&r, verify) {
                        let _ = tx.send(GenMsg::Checking(ty.clone()));
                        ck = Some(mat::check(&ty, d, &opts, &ctx).unwrap_or_else(|e| json!({ "error": e })));
                    }
                    let _ = md;
                    let _ = tx.send(GenMsg::Done(ty, r, ck));
                }
                let _ = tx.send(GenMsg::End);
            });
        }
        self.materials.gen_rx = Some(rx);
        self.materials.gen_workers = workers;
        self.materials.gen_t0 = Some(Instant::now());
        self.materials.gen_done = 0;
        self.materials.gen_failed.clear();
        self.materials.note = "만드는 중입니다… 자료마다 30초~1분쯤 걸립니다. 창을 닫지 마세요.".into();
        self.mstore()["meta_used"] = md;
    }

    fn mat_poll(&mut self, ctx: &egui::Context) {
        let mut msgs = vec![];
        if let Some(rx) = &self.materials.gen_rx { while let Ok(m) = rx.try_recv() { msgs.push(m); } ctx.request_repaint_after(std::time::Duration::from_millis(250)); }
        for m in msgs {
            match m {
                GenMsg::Busy(t) => { self.materials.status.insert(t, "busy".into()); }
                GenMsg::Checking(t) => { self.materials.status.insert(t, "checking".into()); }
                GenMsg::Done(t, r, ck) => match r {
                    Ok((d, provider)) => {
                        let md = self.mstore()["meta_used"].clone();
                        let opts = self.mstore()["options"].clone();
                        let mut res = json!({ "data": d, "options": opts, "meta": md, "made": sermon_shorts::youtube::now_iso(), "provider": provider });
                        if let Some(c) = ck { res["check"] = c; }
                        self.mstore()["results"][t.as_str()] = res;
                        self.materials.status.insert(t, "done".into());
                        self.materials.gen_done += 1;
                        self.mdirty();
                    }
                    Err(e) => { self.materials.status.insert(t.clone(), format!("err:{e}")); self.materials.gen_failed.push(format!("{}: {e}", type_label(&t))); }
                },
                GenMsg::End => {
                    self.materials.gen_workers = self.materials.gen_workers.saturating_sub(1);
                    if self.materials.gen_workers == 0 {
                        self.materials.gen_rx = None;
                        let secs = self.materials.gen_t0.map(|t| t.elapsed().as_secs()).unwrap_or(0);
                        self.materials.note = format!("{}개를 만들었습니다 ({secs}초).{}", self.materials.gen_done, if self.materials.gen_failed.is_empty() { "" } else { " 실패한 것은 다시 눌러 주세요." });
                        if !self.materials.gen_failed.is_empty() { self.materials.err = self.materials.gen_failed.join("\n"); }
                        if self.materials.gen_done > 0 {
                            let sel: Vec<String> = self.mstore()["selected"].as_array().unwrap().iter().filter_map(|x| x.as_str().map(String::from)).collect();
                            if let Some(c) = sel.iter().find(|t| self.mstore()["results"].get(t.as_str()).is_some()) { self.materials.current = c.clone(); }
                            self.materials.page = MPage::Results;
                            self.toast("자료를 만들었습니다. 오른쪽 칸에서 글을 고칠 수 있어요.");
                        }
                    }
                }
            }
        }
        if let Some(rx) = &self.materials.job_rx {
            if let Ok(j) = rx.try_recv() {
                self.materials.job_rx = None; self.materials.busy_label.clear();
                match j {
                    Job::Toast(m, p) => { self.toast(m); if let Some(p) = p.filter(|_| std::env::var("SS_TEST_SAVE_DIR").is_err()) { sermon_shorts::reveal_file(&p); } }
                    Job::Check(t, c) => { self.mstore()["results"][t.as_str()]["check"] = c; self.mdirty(); }
                }
            } else { ctx.request_repaint_after(std::time::Duration::from_millis(250)); }
        }
        // 미리보기 그림 받기
        if let Some(rx) = &self.materials.prev_rx {
            if let Ok((key, r)) = rx.try_recv() {
                self.materials.prev_rx = None;
                match r {
                    Ok(imgs) => { self.materials.prev_tex = imgs.into_iter().enumerate().map(|(i, im)| ctx.load_texture(format!("mat-prev-{i}"), im, egui::TextureOptions::LINEAR)).collect(); self.materials.prev_key = key; self.materials.prev_err.clear(); }
                    Err(e) => { self.materials.prev_err = e; self.materials.prev_key = key; }
                }
            } else { ctx.request_repaint_after(std::time::Duration::from_millis(200)); }
        }
    }

    /// 지금 자료를 그릴 일
    fn mat_job(&mut self, ty: &str) -> Option<(Value, usize)> {
        let m = self.mstore().clone();
        let r = m["results"].get(ty)?.clone();
        let mut md = r["meta"].clone();
        let cur = self.mmeta();
        if let (Some(a), Some(b)) = (md.as_object_mut(), cur.as_object()) { for (k, v) in b { a.insert(k.clone(), v.clone()); } }
        let kind = mat::type_of(ty)?.kind;
        let design = s(&m["design"]);
        let scene = if design == "scene" { self.materials.scene.clone() } else { String::new() };
        let d = &r["data"];
        let (k, n) = match (kind, ty) {
            ("slides", _) => ("slides", d["slides"].as_array().map(|a| a.len()).unwrap_or(0) + 1 + usize::from(!s(&d["closing"]).is_empty())),
            ("cards", "cardnews") => ("news", d["slides"].as_array().map(|a| a.len()).unwrap_or(0) + 2),
            ("cards", _) => ("cards", d["cards"].as_array().map(|a| a.len()).unwrap_or(0)),
            _ => ("page", 1),
        };
        Some((mr::job(k, ty, d, &md, &design, &scene, &m["cardVisuals"][ty]), n))
    }
    fn mat_preview(&mut self) {
        let cur = self.materials.current.clone();
        let Some((job, n)) = self.mat_job(&cur) else { return };
        let key = crate::stage::hkey(&job.to_string());
        if key != self.materials.prev_want { self.materials.prev_want = key; self.materials.prev_at = Some(Instant::now()); }
        if self.materials.prev_rx.is_some() || key == self.materials.prev_key { return; }
        // 고치는 동안은 잠깐 기다렸다가 다시 그린다
        if self.materials.prev_at.is_some_and(|t| t.elapsed().as_millis() < 700) && !self.materials.prev_tex.is_empty() { return; }
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            let r = if job["kind"] == "page" { mr::render_page(&job).map(|i| vec![i]) } else { mr::render_items(&job, n) };
            let imgs = r.map(|v| v.into_iter().map(|im| egui::ColorImage::from_rgba_unmultiplied([im.width() as usize, im.height() as usize], im.as_raw())).collect());
            let _ = tx.send((key, imgs));
        });
        self.materials.prev_rx = Some(rx);
    }

    fn mat_bg(&mut self, label: &str, f: impl FnOnce(Sender<Job>) + Send + 'static) {
        if self.materials.job_rx.is_some() { return; }
        let (tx, rx) = channel();
        std::thread::spawn(move || f(tx));
        self.materials.job_rx = Some(rx);
        self.materials.busy_label = label.into();
    }

    /// 만든 자료의 단추 (기존 act)
    fn mat_act(&mut self, what: &str, ctx: &egui::Context) {
        let cur = self.materials.current.clone();
        let Some(r) = self.mstore()["results"].get(cur.as_str()).cloned() else { return };
        let ti = mat::type_of(&cur).unwrap();
        let mut md = r["meta"].clone();
        let cm = self.mmeta();
        if let (Some(a), Some(b)) = (md.as_object_mut(), cm.as_object()) { for (k, v) in b { a.insert(k.clone(), v.clone()); } }
        let name = format!("{} - {}", ti.label, { let t = s(&md["title"]); let t = if t.is_empty() { "설교".to_string() } else { t }; t.chars().take(30).collect::<String>() });
        match what {
            "copy" => { ctx.copy_text(mat::to_text(&cur, &r["data"], &md)); self.toast("글을 복사했습니다. 카톡·문자에 붙여 넣으세요."); }
            "caption" => { let d = &r["data"]; let tags: Vec<String> = d["hashtags"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(); ctx.copy_text([s(&d["caption"]), tags.join(" ")].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join("\n\n")); self.toast("캡션과 해시태그를 복사했습니다. 인스타그램에 붙여 넣으세요."); }
            "pdf" => {
                let Some(p) = save_to("PDF 로 저장", "PDF", "pdf", &format!("{}.pdf", mr::safe_name(&name))) else { return };
                let Some((job, _)) = self.mat_job(&cur) else { return };
                self.mat_bg("PDF 만드는 중…", move |tx| { let r = mr::to_pdf(&job).and_then(|b| mr::write_friendly(&p, &b)); let _ = tx.send(match r { Ok(()) => Job::Toast("PDF 를 저장했습니다.".into(), Some(p)), Err(e) => Job::Toast(format!("실패: {e}"), None) }); });
            }
            "print" => {
                // 인쇄: PDF 를 만들어 기본 PDF 보기 프로그램으로 연다 (그곳에서 인쇄)
                let Some((job, _)) = self.mat_job(&cur) else { return };
                let p = sermon_shorts::youtube::cache_dir().join("materials_tmp").join(format!("{}.pdf", mr::safe_name(&name)));
                self.mat_bg("인쇄할 PDF 만드는 중…", move |tx| {
                    let r = mr::to_pdf(&job).and_then(|b| mr::write_friendly(&p, &b));
                    let _ = tx.send(match r { Ok(()) => { sermon_shorts::open_folder(&p); Job::Toast("PDF 를 열었습니다. 보기 프로그램의 [인쇄]를 누르세요.".into(), None) } Err(e) => Job::Toast(format!("실패: {e}"), None) });
                });
            }
            "png" => {
                let Some(folder) = pick_dir(if ti.kind == "slides" { "슬라이드 그림을 저장할 폴더" } else { "카드 그림을 저장할 폴더" }) else { return };
                let Some((job, n)) = self.mat_job(&cur) else { return };
                let what_ = if ti.kind == "slides" { "슬라이드" } else { "카드" };
                self.mat_bg("그림 만드는 중…", move |tx| {
                    let r = mr::render_items(&job, n).and_then(|imgs| {
                        let base = mr::free_base(&folder, &mr::safe_name(&name), imgs.len());
                        let mut first = None;
                        for (i, im) in imgs.iter().enumerate() { let f = folder.join(format!("{base}_{:02}.png", i + 1)); mr::write_friendly(&f, &mr::png_bytes(im)?)?; if first.is_none() { first = Some(f); } }
                        Ok((imgs.len(), first))
                    });
                    let _ = tx.send(match r { Ok((k, f)) => Job::Toast(format!("{what_} {k}장을 저장했습니다."), f), Err(e) => Job::Toast(format!("실패: {e}"), None) });
                });
            }
            "homepage" => {
                let mut mm = md.clone(); mm["service"] = json!(self.mat_service(&s(&md["date"])));
                let (fname, text) = mat::to_homepage(&r["data"], &mm);
                let Some(p) = save_to("홈페이지 말씀 요약 글로 저장", "MD", "md", &fname) else { return };
                match mr::write_friendly(&p, text.as_bytes()) { Ok(()) => { self.toast("홈페이지 글(.md)을 저장했습니다. 공개 전 확인용으로 published: false 로 저장됩니다."); if std::env::var("SS_TEST_SAVE_DIR").is_err() { sermon_shorts::reveal_file(&p); } } Err(e) => self.toast(format!("실패: {e}")) }
            }
            "again" => {
                if self.mstore()["demoMode"] == true { self.toast("샘플 체험에서는 AI를 사용하지 않습니다. 원래 자료로 돌아가세요."); return; }
                if rfd::MessageDialog::new().set_title("교인 자료").set_description(format!("{}을(를) 다시 만들까요? 지금 고친 내용은 사라집니다.", ti.label)).set_buttons(rfd::MessageButtons::YesNo).show() != rfd::MessageDialogResult::Yes { return; }
                self.mstore()["selected"] = json!([cur]);
                self.materials.page = MPage::Make;
                self.mat_generate();
            }
            "check" => {
                if self.mstore()["demoMode"] == true { self.toast("샘플 체험에서는 AI 대조를 하지 않습니다."); return; }
                let m = self.mstore().clone();
                let mut c = md.clone(); c["sermon"] = m["sermon"].clone();
                let (ty, data, opts) = (cur.clone(), r["data"].clone(), if r["options"].is_object() { r["options"].clone() } else { m["options"].clone() });
                self.mat_bg("설교와 대조하는 중… (30초쯤)", move |tx| { let ck = mat::check(&ty, &data, &opts, &c).unwrap_or_else(|e| json!({ "error": e })); let _ = tx.send(Job::Check(ty, ck)); });
            }
            "shuffle" => {
                let base = s(&self.mstore()["design"]);
                let n = r["data"]["cards"].as_array().map(|a| a.len()).or(r["data"]["slides"].as_array().map(|a| a.len() + 2)).unwrap_or(0);
                let styles: Vec<&str> = DESIGNS.iter().chain(CARD_EXTRA.iter()).map(|d| d.0).filter(|d| *d != "scene").collect();
                let mut seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7);
                let m = self.mstore();
                if !m["cardVisuals"].is_object() { m["cardVisuals"] = json!({}); }
                if !m["cardVisuals"][cur.as_str()].is_object() { m["cardVisuals"][cur.as_str()] = json!({}); }
                for i in 0..n {
                    let p = &mut m["cardVisuals"][cur.as_str()][i.to_string()];
                    if !p.is_object() { *p = json!({}); }
                    if p["photo"].is_string() && p["design"] == "scene" { continue; }
                    let now = p["design"].as_str().unwrap_or(&base).to_string();
                    let choices: Vec<&&str> = styles.iter().filter(|d| **d != now).collect();
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                    p["design"] = json!(choices[(seed >> 33) as usize % choices.len()]);
                }
                self.mdirty();
            }
            _ => {}
        }
    }
    pub(crate) fn mat_act_test(&mut self, what: &str, ctx: &egui::Context) { self.mat_act(what, ctx); }
    /// 예배 날짜의 요일 → 홈페이지 예배 종류 (수요일·금요일, 나머지는 주일)
    fn mat_service(&self, date: &str) -> &'static str {
        let iso = mat::iso_date(date);
        let p: Vec<i64> = iso.split('-').filter_map(|x| x.parse().ok()).collect();
        if p.len() != 3 { return "sunday"; }
        let days = sermon_shorts::youtube::days_from_civil(p[0], p[1], p[2]);
        match (days + 4).rem_euclid(7) { 3 => "wednesday", 5 => "friday", _ => "sunday" }
    }

    // ---------------------------------------------------------------- 화면

    /// 왼쪽 메뉴 [교인 자료] 화면
    pub(crate) fn materials_page(&mut self, ui: &mut egui::Ui) {
        if self.materials.page == MPage::Make && !self.materials.opened { self.materials.opened = true; self.mat_open_init(); }
        let mut rects = vec![];
        let full = ui.available_rect_before_wrap();
        let side = egui::Rect::from_min_size(full.min, egui::vec2(214.0, full.height()));
        let main = egui::Rect::from_min_max(egui::pos2(side.right() + 16.0, full.top()), full.max);
        ui.scope_builder(egui::UiBuilder::new().max_rect(side), |ui| {
            style::card().inner_margin(egui::Margin::same(16)).show(ui, |ui| {
                ui.set_min_size(ui.available_size());
                ui.label(RichText::new("교인 자료").size(18.0).family(style::bold()).color(style::TEXT));
                ui.label(RichText::new("스튜디오").size(12.0).color(style::MUTED));
                ui.add_space(6.0);
                let church = self.settings["template"]["churchName"].as_str().unwrap_or("우리 교회").to_string();
                ui.label(RichText::new(if church.is_empty() { "우리 교회".into() } else { church }).size(13.0).color(style::TEXT2));
                ui.add_space(12.0);
                ui.label(RichText::new("자료 만들기").size(11.5).color(style::FAINT));
                let n = self.mstore()["results"].as_object().map(|r| r.len()).unwrap_or(0);
                for (p, label, icon) in [(MPage::Make, "콘텐츠 만들기".to_string(), "wand-sparkles"), (MPage::Results, if n > 0 { format!("만든 자료  {n}") } else { "만든 자료".into() }, "book-open"), (MPage::Delivery, "설교 전달 점검".into(), "sliders-horizontal")] {
                    let on = self.materials.page == p;
                    let b = ui.add_sized([ui.available_width(), 34.0], egui::Button::image_and_text(crate::icons::img(icon, 15.0, if on { style::PRIMARY } else { style::TEXT2 }), RichText::new(label).size(13.5).color(if on { style::PRIMARY } else { style::TEXT2 })).fill(if on { style::PRIMARY_SOFT } else { Color32::TRANSPARENT }).stroke(Stroke::NONE).corner_radius(CornerRadius::same(10)));
                    rects.push((format!("nav:{}", p as u8), b.rect));
                    if b.clicked() { self.materials.page = p; }
                }
                ui.add_space(12.0);
                ui.label(RichText::new("설교에서 함께 쓰기").size(11.5).color(style::FAINT));
                if ui.add_sized([ui.available_width(), 32.0], egui::Button::image_and_text(crate::icons::img("clapperboard", 15.0, style::TEXT2), RichText::new("쇼츠 편집기").size(13.5).color(style::TEXT2)).fill(Color32::TRANSPARENT).stroke(Stroke::NONE)).clicked() { self.page = Page::Editor; }
                if ui.add_sized([ui.available_width(), 32.0], egui::Button::image_and_text(crate::icons::img("book-open", 15.0, style::TEXT2), RichText::new(if self.mstore()["demoMode"] == true { "샘플 체험 끝내기" } else { "샘플 설교 체험" }).size(13.5).color(style::TEXT2)).fill(Color32::TRANSPARENT).stroke(Stroke::NONE)).clicked() { self.mat_sample_toggle(); }
                ui.with_layout(egui::Layout::bottom_up(egui::Align::Min), |ui| {
                    if ui.add_sized([ui.available_width(), 34.0], egui::Button::image_and_text(crate::icons::img("arrow-left", 15.0, style::TEXT2), RichText::new("편집기로 돌아가기").size(13.0)).fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(10))).clicked() { self.page = Page::Editor; }
                    ui.add(egui::Label::new(RichText::new("만든 자료는 이 프로젝트를 저장할 때 함께 저장됩니다. 인쇄·PDF·이미지로 나눠 주세요.").size(11.5).color(style::MUTED)).wrap());
                });
            });
        });
        ui.scope_builder(egui::UiBuilder::new().max_rect(main), |ui| {
            style::card().inner_margin(egui::Margin::symmetric(26, 20)).show(ui, |ui| {
                ui.set_min_size(ui.available_size());
                let footer = self.materials.page == MPage::Make;
                let h = ui.available_height() - if footer { 92.0 } else { 0.0 };
                egui::ScrollArea::vertical().id_salt(("mat-main", self.materials.page as u8)).max_height(h).auto_shrink([false, false]).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    match self.materials.page {
                        MPage::Make => self.mat_make_ui(ui, &mut rects),
                        MPage::Results => self.mat_results_ui(ui, &mut rects),
                        MPage::Delivery => self.mat_delivery_ui(ui, &mut rects),
                    }
                });
                if footer { ui.separator(); self.mat_make_footer(ui, &mut rects); }
            });
        });
        self.materials.rects = rects;
        if self.materials.opt_open { self.mat_options_ui(ui.ctx()); }
    }

    fn h1(ui: &mut egui::Ui, t: &str, lead: &str) {
        ui.label(RichText::new(t).size(24.0).family(style::bold()).color(style::TEXT));
        ui.label(RichText::new(lead).size(13.5).color(style::MUTED));
        ui.add_space(12.0);
    }
    fn mcard(ui: &mut egui::Ui, f: impl FnOnce(&mut egui::Ui)) {
        egui::Frame::new().fill(Color32::WHITE).stroke(Stroke::new(1.0, style::BORDER)).corner_radius(CornerRadius::same(18)).inner_margin(egui::Margin::symmetric(22, 18)).show(ui, |ui| { ui.set_width(ui.available_width()); f(ui); });
        ui.add_space(14.0);
    }

    fn mat_make_ui(&mut self, ui: &mut egui::Ui, rects: &mut Vec<(String, egui::Rect)>) {
        Self::h1(ui, "콘텐츠 만들기", "설교 한 편으로 성도들에게 나눠 줄 자료를 한 번에 준비합니다.");
        let busy = self.materials.gen_rx.is_some();
        Self::mcard(ui, |ui| {
            ui.label(RichText::new("1. 설교 원고").size(16.0).family(style::bold()));
            ui.add_space(6.0);
            let src = s(&self.mstore()["source"]);
            let mut pick: Option<&str> = None;
            ui.horizontal(|ui| {
                for (k, l, ic) in [("video", "이 영상의 설교", "film"), ("manual", "직접 입력", "pencil-line"), ("file", "파일 불러오기", "upload")] {
                    let on = src == k;
                    let b = ui.add(egui::Button::image_and_text(crate::icons::img(ic, 14.0, if on { Color32::WHITE } else { style::TEXT2 }), RichText::new(l).size(13.0).color(if on { Color32::WHITE } else { style::TEXT2 })).fill(if on { style::NAVY } else { Color32::WHITE }).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(10)).min_size(egui::vec2(0.0, 32.0)));
                    rects.push((format!("src:{k}"), b.rect));
                    if b.clicked() && !busy { pick = Some(k); }
                }
            });
            if let Some(k) = pick { self.mat_source(k, true); }
            let m = self.mstore().clone();
            let info = match s(&m["source"]).as_str() {
                "file" => if m["fileName"].is_string() { format!("불러온 파일: {}", s(&m["fileName"])) } else { "한글(.hwp·.hwpx) · Word(.docx) · PDF · 글(.txt·.md) · 자막(.srt)을 불러옵니다. 스캔 PDF는 글자 인식이 필요합니다".into() },
                "manual" => "설교 원고를 아래에 붙여 넣거나 직접 쓰세요.".into(),
                _ => s(&m["sourceNote"]),
            };
            if !info.is_empty() { ui.add(egui::Label::new(RichText::new(info).size(12.5).color(style::MUTED)).wrap()); }
            let mut sermon = s(&m["sermon"]);
            let te = ui.add(egui::TextEdit::multiline(&mut sermon).hint_text("설교 원고를 붙여 넣으세요. 자동 자막처럼 띄어쓰기가 틀려도 괜찮습니다.").desired_rows(9).desired_width(f32::INFINITY));
            rects.push(("sermon".into(), te.rect));
            if te.changed() { self.mstore()["sermon"] = json!(sermon.clone()); self.mdirty(); }
            let n = sermon.chars().filter(|c| !c.is_whitespace()).count();
            if n > 0 { ui.label(RichText::new(format!("{}자", fmt_num(n))).size(12.0).color(style::MUTED)); }
            ui.add_space(6.0);
            let md = self.mmeta();
            ui.columns(4, |cols| {
                for (i, (k, l, hint)) in [("title", "설교 제목", ""), ("verse", "본문", "예: 로마서 1:16-17"), ("speaker", "설교자", ""), ("date", "날짜", "")].iter().enumerate() {
                    cols[i].label(RichText::new(*l).size(12.0).color(style::MUTED));
                    let mut v = s(&md[*k]);
                    if cols[i].add(style::text_field(&mut v, hint).desired_width(f32::INFINITY)).changed() { self.mstore()["meta"][*k] = json!(v); self.mdirty(); }
                }
            });
        });
        Self::mcard(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new("2. 만들 자료").size(16.0).family(style::bold()));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if style::tool(ui, "sliders-horizontal", "상세 설정").clicked() { self.materials.opt_open = true; }
                    let ok = sermon_shorts::llm::active_provider(&self.settings);
                    let (t, fill, col) = match &ok { Some(p) => (format!("AI: {}", sermon_shorts::llm::name_ko(p)), Color32::from_rgb(0xe7, 0xf8, 0xee), Color32::from_rgb(0x15, 0x80, 0x3d)), None => ("AI 연결 필요 (눌러서 연결)".into(), Color32::from_rgb(0xff, 0xf4, 0xe5), style::WARN) };
                    if style::pill_button(ui, t, fill, col, "AI 연결").clicked() && ok.is_none() { self.open_ai_connect(); }
                });
            });
            ui.add_space(8.0);
            let m = self.mstore().clone();
            let sel: Vec<String> = m["selected"].as_array().unwrap().iter().filter_map(|x| x.as_str().map(String::from)).collect();
            let w = (ui.available_width() - 20.0) / 3.0;
            let mut toggle: Option<&str> = None;
            for row in mat::TYPES.chunks(3) {
                ui.horizontal(|ui| {
                    for t in row {
                        let on = sel.iter().any(|x| x == t.id);
                        let summary = self.opt_summary(t.id);
                        let st = self.materials.status.get(t.id).cloned().unwrap_or_default();
                        let ck = &m["results"][t.id]["check"];
                        let state = match st.as_str() {
                            "busy" => "만드는 중…".to_string(), "checking" => "설교와 대조 중…".into(), "wait" => "기다리는 중".into(),
                            x if x.starts_with("err:") => "실패".into(),
                            _ if m["results"].get(t.id).is_some() => if ck.is_object() && ck["error"].is_null() && ck["ok"] == false { format!("확인할 곳 {}", ck["issues"].as_array().map(|a| a.len()).unwrap_or(0)) } else if st == "done" { "완성".into() } else { "만든 자료 있음".into() },
                            _ => String::new(),
                        };
                        let fr = egui::Frame::new().fill(if on { style::PRIMARY_SOFT } else { Color32::WHITE }).stroke(Stroke::new(if on { 2.0 } else { 1.0 }, if on { style::PRIMARY } else { style::BORDER })).corner_radius(CornerRadius::same(14)).inner_margin(egui::Margin::symmetric(14, 10)).show(ui, |ui| {
                            ui.set_width(w - 30.0); ui.set_min_height(64.0);
                            ui.vertical(|ui| {
                            ui.horizontal(|ui| {
                                ui.add(crate::icons::img(t.icon, 18.0, if on { style::PRIMARY } else { style::TEXT2 }));
                                ui.label(RichText::new(t.label).size(14.0).family(style::bold()).color(style::TEXT));
                                if on { ui.label(RichText::new("✓").size(15.0).family(style::bold()).color(style::PRIMARY)); }
                            });
                            ui.add(egui::Label::new(RichText::new(summary).size(11.5).color(style::MUTED)).truncate());
                            if !state.is_empty() { ui.label(RichText::new(state).size(11.5).family(style::semi()).color(if st.starts_with("err:") { style::DANGER } else { style::PRIMARY })); }
                            });
                        });
                        let r = fr.response.interact(egui::Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
                        rects.push((format!("tile:{}", t.id), r.rect));
                        if r.clicked() && !busy { toggle = Some(t.id); }
                    }
                });
                ui.add_space(4.0);
            }
            if let Some(id) = toggle {
                let mut sel = sel.clone();
                if let Some(i) = sel.iter().position(|x| x == id) { sel.remove(i); } else { sel.push(id.into()); }
                self.mstore()["selected"] = json!(sel);
            }
        });
    }

    /// [만들기] 아래 고정 줄: 만들기 단추·대조·알림
    fn mat_make_footer(&mut self, ui: &mut egui::Ui, rects: &mut Vec<(String, egui::Rect)>) {
        let busy = self.materials.gen_rx.is_some();
            ui.horizontal(|ui| {
                let n = self.mstore()["selected"].as_array().map(|a| a.len()).unwrap_or(0);
                let demo = self.mstore()["demoMode"] == true;
                let g = ui.add_enabled(!busy && n > 0 && !demo, egui::Button::image_and_text(crate::icons::img("wand-sparkles", 16.0, Color32::WHITE), RichText::new(format!("선택한 자료 만들기 ({n})")).size(14.0).family(style::bold()).color(Color32::WHITE)).fill(style::PRIMARY).corner_radius(CornerRadius::same(12)).min_size(egui::vec2(0.0, 40.0)));
                rects.push(("go".into(), g.rect));
                if g.clicked() { self.mat_generate(); }
                let mut v = self.mstore()["verify"] != false;
                if ui.checkbox(&mut v, RichText::new("만든 뒤 설교와 대조").size(13.0)).on_hover_text("만든 자료를 설교와 한 번 더 대조해 설교에 없는 내용·어긋난 곳을 표시합니다 (AI 를 한 번 더 씁니다)").changed() { self.mstore()["verify"] = json!(v); }
                if busy { ui.add(egui::Spinner::new()); }
            });
            let note = if self.mstore()["demoMode"] == true { "샘플은 미리 만든 예시로 체험합니다. AI로 새 자료를 만들려면 원래 자료로 돌아가세요.".to_string() } else if self.materials.note.is_empty() { "AI 가 설교에 있는 내용만으로 만듭니다. 만든 뒤 오른쪽 칸에서 글을 고칠 수 있어요.".into() } else { self.materials.note.clone() };
            ui.label(RichText::new(note).size(12.5).color(style::MUTED));
            if !self.materials.err.is_empty() { ui.add(egui::Label::new(RichText::new(&self.materials.err).size(12.5).color(style::DANGER)).wrap()); }
    }

    fn mat_options_ui(&mut self, ctx: &egui::Context) {
        let mut close = false;
        let opts = mat::options();
        egui::Modal::new(egui::Id::new("mat-options")).show(ctx, |ui| {
            ui.set_width(620.0);
            ui.horizontal(|ui| { ui.label(RichText::new("생성 옵션").size(17.0).family(style::bold())); ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| { if ui.button("닫기").clicked() { close = true; } }); });
            ui.separator();
            egui::ScrollArea::vertical().max_height(ctx.content_rect().height() * 0.7).show(ui, |ui| {
                for (title, keys) in [("공통 설정 · 대상", vec!["audience"]), ("소그룹 자료", vec!["smallgroup"]), ("QT 자료", vec!["qtDays", "qtFocus", "qtForm"]), ("성경 퀴즈", vec!["quiz"]), ("설교 요약", vec!["summary"]), ("묵상카드", vec!["cardTone", "cardCount"]), ("카드뉴스", vec!["newsCount"]), ("소그룹 리더 가이드", vec!["leaderTime"]), ("설교 PPT", vec!["slideCount"])] {
                    ui.label(RichText::new(title).size(13.0).family(style::bold()).color(style::TEXT2));
                    for k in keys {
                        let (_, _, values) = opts.iter().find(|o| o.0 == k).unwrap();
                        ui.horizontal_wrapped(|ui| {
                            for v in values {
                                let cur = self.mstore()["options"][k].clone();
                                let on = cur == *v || (cur.as_f64().is_some() && cur.as_f64() == v.as_f64());
                                let label = match v { Value::Number(n) => format!("{n}{}", match k { "cardCount" | "newsCount" | "slideCount" => "장", "leaderTime" => "분", "qtDays" => "일", _ => "" }), _ => s(v) };
                                if ui.add(egui::Button::new(RichText::new(label).size(12.5).color(if on { Color32::WHITE } else { style::TEXT2 })).fill(if on { style::PRIMARY } else { Color32::WHITE }).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(255))).clicked() { self.mstore()["options"][k] = v.clone(); }
                            }
                        });
                    }
                    ui.add_space(6.0);
                }
            });
            ui.separator();
            ui.horizontal(|ui| {
                if ui.button("기본값").clicked() { self.mstore()["options"] = mat::norm_options(&json!({})); }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| { if ui.add(egui::Button::new(RichText::new("적용").color(Color32::WHITE)).fill(style::PRIMARY)).clicked() { close = true; } });
            });
        });
        if close || ctx.input(|i| i.key_pressed(egui::Key::Escape)) { self.materials.opt_open = false; }
    }

    /// 고칠 칸들 (data 를 따라 글 칸을 만든다). 바뀌면 true
    fn mat_fields(ui: &mut egui::Ui, v: &mut Value, path: &str, label: &str, depth: usize) -> bool {
        let mut changed = false;
        match v {
            Value::String(t) => {
                if matches!(path.rsplit('.').next(), Some("type")) { return false; }
                ui.label(RichText::new(label).size(11.5).color(style::MUTED));
                let multi = t.chars().count() > 40 || t.contains('\n');
                let r = if multi { ui.add(egui::TextEdit::multiline(t).desired_rows(2).desired_width(f32::INFINITY)) } else { ui.add(egui::TextEdit::singleline(t).desired_width(f32::INFINITY)) };
                changed |= r.changed();
            }
            Value::Number(n) => {
                if matches!(path.rsplit('.').next(), Some("day")) { return false; }
                let mut x = n.as_f64().unwrap_or(0.0);
                ui.horizontal(|ui| { ui.label(RichText::new(label).size(11.5).color(style::MUTED)); changed |= ui.add(egui::DragValue::new(&mut x).speed(1.0).max_decimals(0)).changed(); });
                if changed { *v = json!(x as i64); }
            }
            Value::Array(a) => {
                if path.ends_with("hashtags") { return false; }
                for (i, x) in a.iter_mut().enumerate() {
                    let l = format!("{label} {}", i + 1);
                    if x.is_object() {
                        egui::Frame::new().fill(style::PANEL2).corner_radius(CornerRadius::same(10)).inner_margin(egui::Margin::same(8)).show(ui, |ui| {
                            ui.label(RichText::new(&l).size(12.0).family(style::bold()).color(style::TEXT2));
                            changed |= Self::mat_fields(ui, x, &format!("{path}.{i}"), &l, depth + 1);
                        });
                    } else { changed |= Self::mat_fields(ui, x, &format!("{path}.{i}"), &l, depth + 1); }
                }
            }
            Value::Object(o) => {
                // 자료의 흐름대로 (제목 → 본문 → 내용 → 적용·기도)
                const ORDER: [&str; 44] = ["title", "subtitle", "verse", "ref", "theme", "goal", "summary", "icebreaker", "prepare", "opening", "story", "day", "passage", "headline", "heading", "q", "part", "minutes", "guide", "intent", "expected", "followup", "note", "meditation", "keyline", "question", "choices", "answer", "explain", "body", "lines", "highlight", "source", "points", "questions", "days", "items", "cards", "slides", "flow", "activity", "application", "action", "prayer"];
                let rank = |k: &str| ORDER.iter().position(|x| *x == k).unwrap_or(ORDER.len());
                let mut keys: Vec<String> = o.keys().cloned().collect();
                keys.sort_by_key(|k| (rank(k), k.clone()));
                for k in keys {
                    let x = o.get_mut(&k).unwrap();
                    let k = &k;
                    if matches!(k.as_str(), "caption" | "hashtags") && depth == 0 { continue; }
                    let p = if path.is_empty() { k.clone() } else { format!("{path}.{k}") };
                    changed |= Self::mat_fields(ui, x, &p, field_label(k), depth + 1);
                }
            }
            _ => {}
        }
        changed
    }

    fn mat_results_ui(&mut self, ui: &mut egui::Ui, rects: &mut Vec<(String, egui::Rect)>) {
        Self::h1(ui, "만든 자료", "오른쪽 칸에서 글을 고치면 미리보기에 바로 반영됩니다. 다 고쳤으면 인쇄하거나 PDF·이미지로 저장하세요.");
        let m = self.mstore().clone();
        let have: Vec<&mat::TypeInfo> = mat::TYPES.iter().filter(|t| m["results"].get(t.id).is_some()).collect();
        if have.is_empty() {
            ui.add_space(40.0);
            ui.vertical_centered(|ui| { ui.label(RichText::new("아직 만든 자료가 없습니다").size(16.0).family(style::bold())); ui.label(style::muted("[콘텐츠 만들기]에서 자료를 골라 만들어 보세요.")); });
            return;
        }
        if !have.iter().any(|t| t.id == self.materials.current) { self.materials.current = have[0].id.to_string(); }
        ui.horizontal_wrapped(|ui| {
            for t in &have {
                let on = t.id == self.materials.current;
                let b = ui.add(egui::Button::image_and_text(crate::icons::img(t.icon, 14.0, if on { Color32::WHITE } else { style::TEXT2 }), RichText::new(t.label).size(13.0).color(if on { Color32::WHITE } else { style::TEXT2 })).fill(if on { style::NAVY } else { Color32::WHITE }).stroke(Stroke::new(1.0, style::BORDER_STRONG)).corner_radius(CornerRadius::same(10)));
                rects.push((format!("tab:{}", t.id), b.rect));
                if b.clicked() { self.materials.current = t.id.to_string(); self.materials.prev_tex.clear(); self.materials.prev_key = 0; }
            }
        });
        ui.add_space(8.0);
        let cur = self.materials.current.clone();
        let ti = mat::type_of(&cur).unwrap();
        let r = m["results"][cur.as_str()].clone();
        let (is_cards, is_slides) = (ti.kind == "cards", ti.kind == "slides");
        let mut act: Option<&str> = None;
        ui.horizontal_wrapped(|ui| {
            if is_cards || is_slides {
                let list: Vec<(&str, &str, [u8; 3])> = if is_slides { DESIGNS.to_vec() } else { DESIGNS.iter().chain(CARD_EXTRA.iter()).cloned().collect() };
                for (id, label, c) in list {
                    let on = m["design"] == id;
                    let b = ui.add(egui::Button::new("").fill(Color32::from_rgb(c[0], c[1], c[2])).stroke(Stroke::new(if on { 3.0 } else { 1.0 }, if on { style::PRIMARY } else { style::BORDER_STRONG })).corner_radius(CornerRadius::same(255)).min_size(egui::vec2(26.0, 26.0))).on_hover_text(label);
                    if b.clicked() {
                        self.mstore()["design"] = json!(id);
                        if is_cards { if let Some(o) = self.mstore()["cardVisuals"][cur.as_str()].as_object_mut() { for (_, p) in o.iter_mut() { p["design"] = json!(id); } } }
                        if id == "scene" { self.mat_grab_scene(); }
                        self.mdirty();
                    }
                }
                ui.add_space(8.0);
            }
            let btn = |ui: &mut egui::Ui, icon: &str, t: &str, primary: bool| -> egui::Response {
                if primary { style::primary(ui, Some(icon), t) } else { style::tool(ui, icon, t) }
            };
            if is_slides {
                if btn(ui, "presentation", "PPT 로 저장", true).clicked() { act = Some("pptx"); }
                if btn(ui, "image-down", "이미지로 저장 (PNG)", false).clicked() { act = Some("png"); }
            } else if is_cards {
                let b = btn(ui, "image-down", "전체 이미지 저장 (PNG)", true); rects.push(("act:png".into(), b.rect)); if b.clicked() { act = Some("png"); }
                if btn(ui, "refresh-cw", "디자인 다시 섞기", false).clicked() { act = Some("shuffle"); }
            } else {
                let b = btn(ui, "file-down", "PDF 로 저장", true); rects.push(("act:pdf".into(), b.rect)); if b.clicked() { act = Some("pdf"); }
                if btn(ui, "printer", "인쇄", false).clicked() { act = Some("print"); }
                if cur == "summary" && btn(ui, "globe", "홈페이지 글 저장", false).on_hover_text("교회 홈페이지(말씀 요약)에 올릴 글 파일(.md)로 저장합니다").clicked() { act = Some("homepage"); }
            }
            if (cur == "summary" || cur == "qt") && btn(ui, "volume-2", "음성으로 듣기", false).clicked() { act = Some("listen"); }
            let c = btn(ui, "copy", "글 복사 (카톡용)", false); rects.push(("act:copy".into(), c.rect)); if c.clicked() { act = Some("copy"); }
            if btn(ui, "globe", "홈페이지 묶음 보내기", false).on_hover_text("교회 홈페이지로 보낼 묶음(공개 쇼츠 주소·나눔지 PDF·카드 문장)을 만듭니다").clicked() { act = Some("bundle"); }
            if btn(ui, "refresh-cw", "다시 만들기", false).clicked() { act = Some("again"); }
        });
        let made = s(&r["made"]);
        ui.label(RichText::new(format!("{}{}", if r["provider"].is_string() { format!("AI: {} · ", sermon_shorts::llm::name_ko(&s(&r["provider"]))) } else { String::new() }, made.get(..16).unwrap_or(&made).replace('T', " "))).size(11.5).color(style::FAINT));
        if !self.materials.busy_label.is_empty() { ui.horizontal(|ui| { ui.add(egui::Spinner::new()); ui.label(RichText::new(&self.materials.busy_label).size(12.5).color(style::MUTED)); }); }
        // 설교와 대조 결과
        let ck = &r["check"];
        egui::Frame::new().fill(if ck["ok"] == false && ck["error"].is_null() && ck.is_object() { style::WARN_SOFT } else { style::PANEL2 }).corner_radius(CornerRadius::same(12)).inner_margin(egui::Margin::symmetric(12, 8)).show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal_wrapped(|ui| {
                let (t, again) = if m["demoMode"] == true { ("체험용으로 미리 만든 예시입니다. 샘플 체험에서는 AI를 호출하지 않습니다.".to_string(), "") }
                    else if !ck.is_object() { ("설교와 대조하지 않은 자료입니다.".into(), "설교와 대조하기") }
                    else if ck["error"].is_string() { (format!("설교와 대조하지 못했습니다: {}", s(&ck["error"])), "다시 대조") }
                    else if ck["ok"] == true { ("설교와 대조했습니다 · 설교에 없는 내용이나 어긋난 곳을 찾지 못했습니다.".into(), "다시 대조") }
                    else { (format!("설교와 대조: 확인할 곳 {} — 오른쪽 칸에서 고치거나 그대로 두셔도 됩니다.", ck["issues"].as_array().map(|a| a.len()).unwrap_or(0)), "다시 대조") };
                ui.label(RichText::new(t).size(12.5).color(style::TEXT2));
                if !again.is_empty() && ui.small_button(again).clicked() { act = Some("check"); }
            });
            if let Some(iss) = ck["issues"].as_array() { for (i, it) in iss.iter().enumerate() { ui.add(egui::Label::new(RichText::new(format!("{}. “{}” — {}{}", i + 1, s(&it["quote"]), s(&it["problem"]), if s(&it["fix"]).is_empty() { String::new() } else { format!(" (제안: {})", s(&it["fix"])) })).size(12.0).color(style::TEXT2)).wrap()); } }
        });
        ui.add_space(8.0);
        // 미리보기 | 고칠 칸
        self.mat_preview();
        let avail = ui.available_width();
        let pw = (avail * 0.56).min(620.0);
        ui.horizontal_top(|ui| {
            ui.vertical(|ui| {
                ui.set_width(pw);
                if !self.materials.prev_err.is_empty() { ui.add(egui::Label::new(RichText::new(&self.materials.prev_err).size(12.5).color(style::DANGER)).wrap()); }
                if self.materials.prev_tex.is_empty() { ui.horizontal(|ui| { ui.add(egui::Spinner::new()); ui.label(style::muted("미리보기를 그리는 중… (처음엔 몇 초)")); }); }
                let n = self.materials.prev_tex.len();
                for (i, t) in self.materials.prev_tex.clone().iter().enumerate() {
                    let sz = t.size_vec2();
                    let w = if is_cards && n > 1 { (pw - 10.0) / 2.0 } else { pw };
                    let h = sz.y * w / sz.x;
                    if is_cards && n > 1 && i % 2 == 1 { continue; }
                    if is_cards && n > 1 {
                        ui.horizontal(|ui| {
                            ui.add(egui::Image::new((t.id(), egui::vec2(w, h))).corner_radius(CornerRadius::same(8)));
                            if let Some(t2) = self.materials.prev_tex.get(i + 1) { ui.add(egui::Image::new((t2.id(), egui::vec2(w, h))).corner_radius(CornerRadius::same(8))); }
                        });
                        if ti.id != "slides" { self.mat_card_tools(ui, &cur, i, i + 1 < n); }
                    } else {
                        let im = ui.add(egui::Image::new((t.id(), egui::vec2(w, h))).corner_radius(CornerRadius::same(6)));
                        rects.push((format!("prev:{i}"), im.rect));
                    }
                    ui.add_space(6.0);
                }
            });
            ui.add_space(14.0);
            ui.vertical(|ui| {
                ui.set_width(ui.available_width());
                ui.label(RichText::new("글 고치기").size(14.0).family(style::bold()).color(style::TEXT));
                let mut data = self.mstore()["results"][cur.as_str()]["data"].clone();
                let ch = ui.scope(|ui| { ui.spacing_mut().item_spacing.y = 4.0; Self::mat_fields(ui, &mut data, "", "", 0) }).inner;
                if is_cards {
                    ui.add_space(8.0);
                    ui.label(RichText::new("인스타그램 캡션").size(13.0).family(style::bold()));
                    let mut cap = s(&data["caption"]);
                    let c1 = ui.add(egui::TextEdit::multiline(&mut cap).desired_rows(3).desired_width(f32::INFINITY)).changed();
                    let mut tg = data["hashtags"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect::<Vec<_>>().join(" ")).unwrap_or_default();
                    let c2 = ui.add(egui::TextEdit::singleline(&mut tg).desired_width(f32::INFINITY)).lost_focus();
                    if c1 { data["caption"] = json!(cap); }
                    if c2 { data["hashtags"] = json!(mat::tags(&json!(tg))); }
                    if ui.small_button("캡션 전체 복사").clicked() { act = Some("caption"); }
                    if c1 || c2 { self.mstore()["results"][cur.as_str()]["data"] = data.clone(); self.mdirty(); }
                }
                if ch { self.mstore()["results"][cur.as_str()]["data"] = data; self.mdirty(); }
            });
        });
        if let Some(a) = act {
            let ctx = ui.ctx().clone();
            match a {
                "pptx" => self.mat_pptx(),
                "listen" => self.mat_listen(),
                "bundle" => self.mat_bundle(),
                _ => self.mat_act(a, &ctx),
            }
        }
    }

    /// 카드 아래 장마다 디자인·사진 (기존 card-visuals.js)
    fn mat_card_tools(&mut self, ui: &mut egui::Ui, ty: &str, i: usize, pair: bool) {
        ui.horizontal(|ui| {
            for k in [i, i + 1] {
                if k > i && !pair { break; }
                let p = self.mstore()["cardVisuals"][ty][k.to_string()].clone();
                let cur = p["design"].as_str().map(String::from).unwrap_or_else(|| if p["photo"].is_string() { "scene".into() } else { s(&self.mstore()["design"]) });
                ui.label(RichText::new(format!("{}장", k + 1)).size(11.5).color(style::MUTED));
                let mut pick: Option<String> = None;
                egui::ComboBox::from_id_salt(("card-design", ty, k)).width(92.0).selected_text(DESIGNS.iter().chain(CARD_EXTRA.iter()).find(|d| d.0 == cur).map(|d| if d.0 == "scene" { "사진·영상" } else { d.1 }).unwrap_or("기본")).show_ui(ui, |ui| {
                    for d in DESIGNS.iter().chain(CARD_EXTRA.iter()) { if ui.selectable_label(cur == d.0, if d.0 == "scene" { "사진·영상" } else { d.1 }).clicked() { pick = Some(d.0.into()); } }
                });
                let mut photo: Option<Option<String>> = None;
                if ui.small_button("사진").on_hover_text("사진 바꾸기 (사용 권한이 있는 내 사진)").clicked() {
                    if let Some(f) = rfd::FileDialog::new().set_title("카드 배경 사진 (사용 권한이 있는 내 사진)").add_filter("사진", &["jpg", "jpeg", "png", "webp"]).pick_file() {
                        match photo_url(&f) { Ok(u) => photo = Some(Some(u)), Err(e) => self.toast(e) }
                    }
                }
                if ui.small_button("장면").on_hover_text("지금 영상 장면").clicked() {
                    self.mat_grab_scene();
                    if self.materials.scene.is_empty() { self.toast("먼저 영상을 열고 쓸 장면에서 멈춰 주세요."); } else { photo = Some(Some(self.materials.scene.clone())); }
                }
                if p["photo"].is_string() && ui.small_button("빼기").clicked() { photo = Some(None); }
                if pick.is_some() || photo.is_some() {
                    let m = self.mstore();
                    let base = s(&m["design"]).replace("scene", "navy");
                    if !m["cardVisuals"].is_object() { m["cardVisuals"] = json!({}); }
                    if !m["cardVisuals"][ty].is_object() { m["cardVisuals"][ty] = json!({}); }
                    let e = &mut m["cardVisuals"][ty][k.to_string()];
                    if !e.is_object() { *e = json!({}); }
                    if let Some(d) = pick { e["design"] = json!(d); }
                    match photo { Some(Some(u)) => { e["photo"] = json!(u); e["design"] = json!("scene"); } Some(None) => { if let Some(o) = e.as_object_mut() { o.remove("photo"); } e["design"] = json!(base); } None => {} }
                    self.mdirty();
                }
                ui.add_space(12.0);
            }
        });
    }

    fn mat_grab_scene(&mut self) {
        self.materials.scene = self.player.frame.as_ref().and_then(|f| mr::scene_url(&f.rgba, f.w, f.h)).unwrap_or_default();
    }

    // ---------------- 설교 전달 점검 ----------------
    fn mat_delivery_ui(&mut self, ui: &mut egui::Ui, rects: &mut Vec<(String, egui::Rect)>) {
        Self::h1(ui, "설교 전달 점검", "시간이 있는 자막으로 말의 속도와 다시 들어 볼 곳을 살펴봅니다. AI 호출이나 추가 요금이 없습니다.");
        if self.materials.dl_src.is_empty() { self.materials.dl_src = "local".into(); }
        Self::mcard(ui, |ui| {
            ui.label(RichText::new("분석할 자막").size(16.0).family(style::bold()));
            ui.horizontal(|ui| {
                let label = if self.materials.dl_src == "youtube" { "AI 대화에서 불러온 유튜브 설교" } else { "편집 중인 원본 자막" };
                egui::ComboBox::from_id_salt("dl-src").width(240.0).selected_text(label).show_ui(ui, |ui| {
                    if ui.selectable_label(self.materials.dl_src == "local", "편집 중인 원본 자막").clicked() { self.materials.dl_src = "local".into(); }
                    if ui.selectable_label(self.materials.dl_src == "youtube", "AI 대화에서 불러온 유튜브 설교").clicked() { self.materials.dl_src = "youtube".into(); }
                });
                let b = style::primary(ui, None, "점검하기");
                rects.push(("dl-run".into(), b.rect));
                if b.clicked() { self.mat_delivery_run(); }
                if self.materials.dl.is_some() && style::tool(ui, "copy", "결과 복사").clicked() { ui.ctx().copy_text(delivery::to_text(self.materials.dl.as_ref(), &self.materials.dl_label)); self.toast("설교 점검 결과를 복사했습니다."); }
            });
            ui.add(egui::Label::new(RichText::new("지운 단어도 포함한 원본 전달을 분석합니다. 한글은 음절 수, 영문·숫자는 글자 수로 세며, 빠름·느림을 등급으로 매기지 않습니다. 대지·적용 비율·신학은 평가하지 않습니다.").size(12.0).color(style::MUTED)).wrap());
        });
        if self.materials.dl_ran && self.materials.dl.is_none() { Self::mcard(ui, |ui| { ui.add(egui::Label::new("시간 정보가 있는 자막이 없습니다. 영상을 열어 자막을 만들거나 AI 대화에서 유튜브 설교를 먼저 불러오세요. 글 원고만으로 말 빠르기를 계산하지 않습니다.").wrap()); }); return; }
        let Some(r) = self.materials.dl.clone() else { return };
        let t = delivery::time;
        ui.label(RichText::new(format!("{} · {} ~ {} · 자막 {}개", self.materials.dl_label, t(r.start), t(r.end), fmt_num(r.word_count))).size(12.5).color(style::MUTED));
        ui.horizontal(|ui| {
            for (n, d) in [(format!("{}자", r.cpm), "분당 평균 (쉼 포함)"), (format!("{}곳", r.pauses.len()), "2초 이상 자막 공백"), (format!("{}곳", r.fillers.len()), "군말 후보"), (format!("{}곳", r.repeats.len()), "연속 반복 후보")] {
                egui::Frame::new().fill(style::PANEL2).corner_radius(CornerRadius::same(14)).inner_margin(egui::Margin::symmetric(16, 10)).show(ui, |ui| { ui.vertical(|ui| { ui.label(RichText::new(n).size(20.0).family(style::bold()).color(style::TEXT)); ui.label(RichText::new(d).size(12.0).color(style::MUTED)); }); });
            }
        });
        ui.add_space(8.0);
        Self::mcard(ui, |ui| {
            ui.label(RichText::new("1분 구간별 말 빠르기").size(15.0).family(style::bold()));
            ui.label(RichText::new("분당 글자 수입니다. 마지막 구간은 실제 길이로 환산합니다. 자동 자막 누락·시간 오차의 영향을 받습니다.").size(12.0).color(style::MUTED));
            let max = r.bins.iter().map(|b| b.cpm).max().unwrap_or(1).max(1) as f32;
            for b in &r.bins {
                ui.horizontal(|ui| {
                    ui.add_sized([110.0, 18.0], egui::Label::new(RichText::new(format!("{} ~ {}", t(b.start), t(b.end))).size(11.5).color(style::MUTED)));
                    let (rect, _) = ui.allocate_exact_size(egui::vec2(ui.available_width() - 80.0, 10.0), egui::Sense::hover());
                    ui.painter().rect_filled(rect, CornerRadius::same(255), style::PANEL3);
                    let w = rect.width() * (b.cpm as f32 / max).max(0.01);
                    ui.painter().rect_filled(egui::Rect::from_min_size(rect.min, egui::vec2(w, rect.height())), CornerRadius::same(255), style::PRIMARY);
                    ui.label(RichText::new(format!("{}자/분", b.cpm)).size(12.0).family(style::bold()));
                });
            }
        });
        let local = self.materials.dl_src == "local" && self.player.path.is_some();
        let mut seek: Option<f64> = None;
        for (title, items, desc) in [("긴 쉼 후보", &r.pauses, "자막 사이 공백입니다. 실제 무음이 아닐 수 있으며 찬양·기도·회중 응답일 수 있습니다."), ("군더더기 말 후보", &r.fillers, "자동 자막에 남은 음·어 등을 찾았습니다. 자막이 군말을 생략할 수 있고, 문맥을 듣고 판단해야 합니다."), ("연속 반복 후보", &r.repeats, "같은 말이 이어진 곳입니다. 강조나 인용일 수 있으므로 지울 부분이라고 단정하지 않습니다.")] {
            Self::mcard(ui, |ui| {
                ui.label(RichText::new(format!("{title}  {}곳", items.len())).size(15.0).family(style::bold()));
                ui.label(RichText::new(desc).size(12.0).color(style::MUTED));
                if items.is_empty() { ui.label(style::muted("찾은 후보가 없습니다.")); }
                for p in items.iter().take(100) {
                    ui.horizontal(|ui| {
                        ui.add_sized([110.0, 20.0], egui::Label::new(RichText::new(format!("{}{}", t(p.start), if p.seconds > 0.0 { format!(" · {:.1}초", p.seconds) } else { String::new() })).size(12.0).color(style::MUTED)));
                        ui.add(egui::Label::new(RichText::new(&p.text).size(12.5)).truncate());
                        if local { ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| { if ui.small_button("영상에서 확인").clicked() { seek = Some(p.start); } }); }
                    });
                }
                if items.len() > 100 { ui.label(style::muted("앞 100곳만 표시합니다. 결과 복사에는 전체가 들어갑니다.")); }
            });
        }
        if let Some(t) = seek { self.page = Page::Editor; self.player.seek_src(t); }
    }
    pub(crate) fn mat_delivery_run(&mut self) {
        self.materials.dl_ran = true;
        let words: Vec<(String, f64, f64)> = if self.materials.dl_src == "youtube" {
            let g = self.chat.shared.lock().unwrap();
            match g.as_ref() {
                Some(ss) => {
                    let (a, b) = match ss.sermon { Some((f, t)) => (f.saturating_sub(5), (t + 5).min(ss.words.len().saturating_sub(1))), None => (0, ss.words.len().saturating_sub(1)) };
                    self.materials.dl_label = format!("{} · {}", if ss.sermon.is_none() { "유튜브 전체 자막 (설교 범위 미확인)" } else { "AI가 찾은 설교 범위" }, ss.title);
                    ss.words.get(a..=b).unwrap_or(&[]).iter().map(|w| (w.text.clone(), w.start, w.end)).collect()
                }
                None => { self.materials.dl_label.clear(); vec![] }
            }
        } else {
            self.materials.dl_label = "편집 중인 원본 자막".into();
            self.project.words.iter().map(|w| (w.text.clone(), w.start, w.end)).collect()
        };
        self.materials.dl = delivery::analyze(&words);
    }

    // ---------------- 나머지 (다음 단계에서 채움) ----------------
    /// 설교 PPT 로 저장 (글자를 고칠 수 있는 .pptx)
    fn mat_pptx(&mut self) {
        let cur = self.materials.current.clone();
        let Some(r) = self.mstore()["results"].get(cur.as_str()).cloned() else { return };
        let mut md = r["meta"].clone();
        let cm = self.mmeta();
        if let (Some(a), Some(b)) = (md.as_object_mut(), cm.as_object()) { for (k, v) in b { a.insert(k.clone(), v.clone()); } }
        let design = s(&self.mstore()["design"]);
        if design == "scene" && self.materials.scene.is_empty() { self.mat_grab_scene(); }
        let scene: Option<Vec<u8>> = if design == "scene" { self.materials.scene.split_once("base64,").and_then(|(_, b)| { use base64::Engine; base64::engine::general_purpose::STANDARD.decode(b).ok() }) } else { None };
        let t = s(&md["title"]);
        let name = format!("설교 PPT - {}", if t.is_empty() { "설교".to_string() } else { t.chars().take(30).collect() });
        let Some(p) = save_to("설교 PPT 로 저장", "PowerPoint", "pptx", &format!("{}.pptx", mr::safe_name(&name))) else { return };
        let data = r["data"].clone();
        self.mat_bg("PPT 만드는 중…", move |tx| {
            let r = sermon_shorts::pptx::build(&data, &md, &design, scene.as_deref()).and_then(|b| mr::write_friendly(&p, &b));
            let _ = tx.send(match r { Ok(()) => Job::Toast("PPT 를 저장했습니다. 파워포인트에서 글자를 고칠 수 있습니다.".into(), Some(p)), Err(e) => Job::Toast(format!("실패: {e}"), None) });
        });
    }
    fn mat_listen(&mut self) { self.toast("음성으로 듣기는 곧 됩니다."); }
    fn mat_bundle(&mut self) { self.toast("홈페이지 묶음 보내기는 곧 됩니다."); }
    fn mat_sample_toggle(&mut self) { self.toast("샘플 설교 체험은 곧 됩니다."); }

    /// 매 화면: 만들기·내보내기 진행
    pub(crate) fn materials_ui(&mut self, ctx: &egui::Context) {
        self.mat_poll(ctx);
        if self.page != Page::Materials { self.materials.opened = false; }
    }
}

/// 저장할 곳 (시험: SS_TEST_SAVE_DIR)
fn save_to(title: &str, kind: &str, ext: &str, name: &str) -> Option<PathBuf> {
    if let Ok(d) = std::env::var("SS_TEST_SAVE_DIR") { return Some(PathBuf::from(d).join(name)); }
    rfd::FileDialog::new().set_title(title).add_filter(kind, &[ext]).set_file_name(name).save_file()
}
fn pick_dir(title: &str) -> Option<PathBuf> {
    if let Ok(d) = std::env::var("SS_TEST_SAVE_DIR") { return Some(PathBuf::from(d)); }
    rfd::FileDialog::new().set_title(title).pick_folder()
}
pub(crate) fn fmt_num(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() { if i > 0 && (s.len() - i) % 3 == 0 { out.push(','); } out.push(ch); }
    out
}
