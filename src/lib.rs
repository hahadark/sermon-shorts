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
        if let Some(d) = exe.parent() {
            let a = d.join("assets"); if a.join("fonts").exists() { return a; }
            // 맥 앱 묶음: Contents/MacOS/실행 파일 → Contents/Resources/assets
            let r = d.join("..").join("Resources").join("assets"); if r.join("fonts").exists() { return r; }
        }
    }
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets")
}
pub mod chat_plan;
pub mod chat;
pub mod ai;
pub mod source_fetch;
pub mod autosave;
pub mod settings;
pub mod voice;
pub mod vox_dsp;
pub mod bgm;
pub mod llm;
pub mod syscheck;

/// 사용자 홈 폴더 (Windows: USERPROFILE, 맥: HOME)
pub fn home_dir() -> std::path::PathBuf {
    let v = if cfg!(windows) { std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) } else { std::env::var("HOME") };
    v.map(std::path::PathBuf::from).unwrap_or_default()
}
/// 문서 폴더
pub fn documents_dir() -> std::path::PathBuf { home_dir().join("Documents") }
/// 탐색기·Finder 로 폴더 열기
pub fn open_folder(p: &std::path::Path) {
    let _ = std::fs::create_dir_all(p);
    #[cfg(windows)] { let _ = std::process::Command::new("explorer.exe").arg(p).spawn(); }
    #[cfg(target_os = "macos")] { let _ = std::process::Command::new("open").arg(p).spawn(); }
    #[cfg(all(not(windows), not(target_os = "macos")))] { let _ = std::process::Command::new("xdg-open").arg(p).spawn(); }
}
/// 파일을 고른 채로 폴더 보이기
pub fn reveal_file(p: &std::path::Path) {
    #[cfg(windows)] { let _ = std::process::Command::new("explorer.exe").arg(format!("/select,{}", p.display())).spawn(); }
    #[cfg(target_os = "macos")] { let _ = std::process::Command::new("open").arg("-R").arg(p).spawn(); }
    #[cfg(all(not(windows), not(target_os = "macos")))] { if let Some(d) = p.parent() { open_folder(d); } }
}
