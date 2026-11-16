//! 설교 쇼츠 편집기 (Rust 판) 핵심 계산. 화면(main.rs)과 시험이 함께 쓴다.
pub mod edl;
pub mod linebreak;
pub mod model;
pub mod media;
pub mod player;
pub mod project;
pub mod caption_edit;
pub mod peaks;
pub mod blocks;
pub mod theme;
pub mod textfx;
pub mod template;
pub mod export;
pub mod tidy;
pub mod secret;
pub mod ytupload;
pub mod youtube;
pub mod stt;

/// 앱 자료(글꼴·테마·그림) 폴더: SS_ASSETS → 실행 파일 옆 assets → 개발 중 저장소 assets
pub fn assets_dir() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("SS_ASSETS") { return p.into(); }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() { let a = d.join("assets"); if a.join("fonts").exists() { return a; } }
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets")
}
pub mod chat_plan;
pub mod source_fetch;
pub mod autosave;
pub mod settings;
pub mod voice;
pub mod vox_dsp;
pub mod bgm;
pub mod llm;
