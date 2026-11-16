//! 아이콘: 기존 앱과 같은 Lucide SVG (ISC 라이선스, assets/icons). 선 색을 흰색으로 바꿔 불러온 뒤 원하는 색으로 물들인다
use eframe::egui::{self, Color32, Vec2};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

fn bytes(name: &str) -> Arc<[u8]> {
    static CACHE: OnceLock<Mutex<HashMap<String, Arc<[u8]>>>> = OnceLock::new();
    let mut m = CACHE.get_or_init(Default::default).lock().unwrap();
    m.entry(name.to_string()).or_insert_with(|| {
        let p = sermon_shorts::assets_dir().join("icons").join(format!("{name}.svg"));
        let s = std::fs::read_to_string(&p).unwrap_or_else(|_| r#"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"></svg>"#.into());
        let s = s.replace("currentColor", "#ffffff").replace("stroke=\"#000\"", "stroke=\"#ffffff\"");
        Arc::from(s.into_bytes().into_boxed_slice())
    }).clone()
}

/// 아이콘 그림 (size 픽셀, color 로 물들임)
pub fn img(name: &str, size: f32, color: Color32) -> egui::Image<'static> {
    egui::Image::from_bytes(format!("bytes://icon/{name}.svg"), egui::load::Bytes::Shared(bytes(name))).fit_to_exact_size(Vec2::splat(size)).tint(color)
}

/// 그림 파일 (로고·앱 아이콘): 바이트를 한 번 읽어 둔다
pub fn file_img(path: &std::path::Path, size: Vec2) -> egui::Image<'static> {
    static CACHE: OnceLock<Mutex<HashMap<std::path::PathBuf, Arc<[u8]>>>> = OnceLock::new();
    let bytes = CACHE.get_or_init(Default::default).lock().unwrap().entry(path.to_path_buf()).or_insert_with(|| Arc::from(std::fs::read(path).unwrap_or_default().into_boxed_slice())).clone();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "png".into());
    egui::Image::from_bytes(format!("bytes://file/{}.{ext}", path.to_string_lossy().replace(['\\', ':'], "/")), egui::load::Bytes::Shared(bytes)).fit_to_exact_size(size)
}