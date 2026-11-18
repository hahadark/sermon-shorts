//! 부드러운 미리보기 (기존 preview-proxy-ui.js): 영상을 열면 미리보기용 영상을 뒤에서 만들고, 준비되면 미리보기만 그 영상으로 바꾼다.
//! 재생 중이면 멈출 때 바꾼다. 내보내기·자막 만들기·파형은 늘 원본(project.source_path).
use crate::*;
use sermon_shorts::proxy;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use std::path::Path;

#[derive(Default)]
pub(crate) struct ProxyState {
    pub src: Option<PathBuf>,
    rx: Option<Receiver<Result<proxy::Outcome, String>>>,
    pct: Arc<Mutex<f64>>,
    cancel: Arc<AtomicBool>,
    pub waiting: Option<PathBuf>,
    /// 화면에 보일 상태 (글, 설명, 0=준비 중 1=됨 2=못 함)
    pub status: Option<(String, String, u8)>,
    pub using: Option<PathBuf>,
}

impl App {
    /// 영상을 연 뒤 (기존 ss:video-opened → start)
    pub(crate) fn proxy_start(&mut self, src: &Path) {
        self.proxy.cancel.store(true, Ordering::SeqCst);
        self.proxy = ProxyState { src: Some(src.to_path_buf()), ..Default::default() };
        let on = self.settings["previewProxy"] != false;
        // 다른 자동 시험 중에는 바꾸지 않는다 (시험 도중 영상이 바뀌면 결과가 흔들림)
        let test_skip = self.test.as_ref().is_some_and(|t| t.name != "smoothpreview");
        if !on || test_skip { return; }
        self.proxy.status = Some(("미리보기 준비 중".into(), "건너뛸 때 끊기지 않게 미리보기용 영상을 만들고 있습니다. 그동안에도 편집할 수 있습니다.".into(), 0));
        let (tx, rx) = channel();
        let (src2, pct, cancel) = (src.to_path_buf(), self.proxy.pct.clone(), self.proxy.cancel.clone());
        std::thread::spawn(move || { let _ = tx.send(proxy::ensure(&src2, &move |p| { *pct.lock().unwrap() = p; }, cancel)); });
        self.proxy.rx = Some(rx);
    }
    pub(crate) fn proxy_cancel(&mut self) { self.proxy.cancel.store(true, Ordering::SeqCst); }

    /// 매 화면
    pub(crate) fn proxy_poll(&mut self, ctx: &egui::Context) {
        if let Some(rx) = &self.proxy.rx {
            match rx.try_recv() {
                Ok(r) => {
                    self.proxy.rx = None;
                    match r {
                        Ok(proxy::Outcome::Ready(p)) => { self.proxy.waiting = Some(p); }
                        Ok(proxy::Outcome::Skipped(_)) => { self.proxy.status = None; }
                        Err(e) if e == "취소됨" => { self.proxy.status = None; }
                        Err(e) => { self.proxy.status = Some(("미리보기 준비 못 함".into(), format!("미리보기용 영상을 만들지 못해 원본으로 미리 봅니다 (건너뛸 때 조금 끊길 수 있음). {e}"), 2)); }
                    }
                }
                Err(_) => {
                    let p = *self.proxy.pct.lock().unwrap();
                    if p > 0.0 { if let Some(s) = &mut self.proxy.status { s.0 = format!("미리보기 준비 중 {}%", p.round()); } }
                    ctx.request_repaint_after(std::time::Duration::from_millis(500));
                }
            }
        }
        // 원본이 그사이 바뀌었으면 쓰지 않는다
        if self.proxy.waiting.is_some() && self.proxy.src.as_deref() != Some(self.project.source_path.as_path()) { self.proxy.waiting = None; self.proxy.status = None; }
        if let Some(p) = self.proxy.waiting.clone() {
            if self.player.playing() {
                self.proxy.status = Some(("미리보기 준비됨 · 멈추면 바뀜".into(), "재생을 멈추면 미리보기용 영상으로 바꿉니다.".into(), 0));
            } else {
                self.proxy.waiting = None;
                match self.player.swap_media(&p) {
                    Ok(()) => { self.proxy.using = Some(p); self.proxy.status = Some(("부드러운 미리보기".into(), "지운 곳을 건너뛸 때 끊기지 않도록 미리보기용 영상(기준 화면 0.5초마다)을 씁니다. 내보내기는 원본으로 합니다.".into(), 1)); }
                    Err(_) => { self.proxy.status = None; }
                }
            }
        }
    }

    /// 부드러운 미리보기 켜기·끄기: 끄면 미리보기를 바로 원본으로 되돌리고, 켜면 지금 영상에 다시 만든다
    pub(crate) fn proxy_set_enabled(&mut self, on: bool, save: bool) {
        if save { if let Ok(s) = sermon_shorts::settings::save(&serde_json::json!({ "previewProxy": on })) { self.settings = s; } }
        if on {
            let src = self.project.source_path.clone();
            if self.player.path.is_some() && src.exists() { self.proxy_start(&src); }
            return;
        }
        self.proxy_cancel();
        let using = self.proxy.using.take();
        self.proxy = ProxyState::default();
        if using.is_some() && self.project.source_path.exists() {
            let was = self.player.playing();
            if self.player.swap_media(&self.project.source_path.clone()).is_ok() && was { self.player.play(); }
        }
    }
}