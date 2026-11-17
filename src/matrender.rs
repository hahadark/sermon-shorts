//! 교인 자료 그리기·내보내기 (기존 main/materials.js 의 writeDoc·toPdf·toPng): Electron 판 materials-doc.js 를 그대로 실은 HTML 을
//! 이 PC 의 Edge/Chrome(헤드리스)으로 PDF·PNG 로 만든다. 그래서 화면 미리보기·PDF·PNG 가 Electron 판과 같은 모양이다.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Edge·Chrome 찾기 (윈도우는 Edge 가 늘 있다). 시험용 SS_BROWSER
pub fn browser() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("SS_BROWSER") { return Some(PathBuf::from(p)).filter(|p| p.exists()); }
    let mut c: Vec<PathBuf> = vec![];
    if cfg!(windows) {
        for base in [std::env::var("ProgramFiles(x86)").ok(), std::env::var("ProgramFiles").ok(), std::env::var("LOCALAPPDATA").ok()].into_iter().flatten() {
            c.push(Path::new(&base).join("Microsoft").join("Edge").join("Application").join("msedge.exe"));
            c.push(Path::new(&base).join("Google").join("Chrome").join("Application").join("chrome.exe"));
        }
    } else if cfg!(target_os = "macos") {
        for app in ["Google Chrome.app/Contents/MacOS/Google Chrome", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Chromium.app/Contents/MacOS/Chromium", "Brave Browser.app/Contents/MacOS/Brave Browser"] {
            c.push(Path::new("/Applications").join(app));
            c.push(crate::home_dir().join("Applications").join(app));
        }
    } else {
        for p in ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"] { c.push(PathBuf::from(p)); }
    }
    c.into_iter().find(|p| p.exists())
}
pub const NO_BROWSER: &str = "PDF·이미지를 만들려면 Chrome 또는 Edge 가 필요합니다. 설치한 뒤 다시 해 주세요.";

fn tmp_dir() -> PathBuf { let d = crate::youtube::cache_dir().join("materials_tmp"); let _ = std::fs::create_dir_all(&d); d }
fn file_url(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    let enc: String = s.chars().map(|c| match c { ' ' => "%20".to_string(), '#' => "%23".into(), '%' => "%25".into(), '?' => "%3F".into(), _ => c.to_string() }).collect();
    if enc.starts_with('/') { format!("file://{enc}") } else { format!("file:///{enc}") }
}
fn uniq() -> String { format!("{}_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0), std::process::id()) }

/// 그릴 일 (harness.js 의 window.__JOB)
pub fn job(kind: &str, ty: &str, d: &Value, m: &Value, design: &str, scene: &str, visuals: &Value) -> Value {
    json!({ "kind": kind, "type": ty, "d": d, "m": m, "design": design, "scene": scene, "visuals": visuals })
}

/// 완전한 HTML 파일로 (글꼴은 앱 안의 Pretendard)
pub fn write_html(job: &Value, width: Option<u32>) -> Result<PathBuf, String> {
    let assets = crate::assets_dir();
    let font = assets.join("fonts").join("PretendardVariable.woff2");
    let mut j = job.clone();
    j["fontCss"] = json!(format!("@font-face{{font-family:'Pretendard';src:url('{}') format('woff2');font-weight:45 920;font-display:block}}", file_url(&font)));
    let doc = assets.join("materials").join("materials-doc.js");
    let harness = assets.join("materials").join("harness.js");
    if !doc.exists() || !harness.exists() { return Err("자료 그리기 파일(assets/materials)이 없습니다.".into()); }
    // </script> 가 글 안에 있어도 깨지지 않게
    let data = j.to_string().replace("</", "<\\/");
    let html = format!("<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><style>body{{margin:0}}</style></head><body{}><script>window.SS={{}};window.__JOB={data};</script><script src=\"{}\"></script><script src=\"{}\"></script></body></html>",
        width.map(|w| format!(" style=\"width:{w}px\"")).unwrap_or_default(), file_url(&doc), file_url(&harness));
    let f = tmp_dir().join(format!("doc_{}.html", uniq()));
    std::fs::write(&f, html).map_err(|e| e.to_string())?;
    Ok(f)
}

fn run_browser(args: &[String], html: &Path) -> Result<(), String> {
    let b = browser().ok_or(NO_BROWSER)?;
    let prof = tmp_dir().join(format!("prof_{}", uniq()));
    let mut c = Command::new(&b);
    c.args(["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--allow-file-access-from-files", "--virtual-time-budget=4000"]);
    c.arg(format!("--user-data-dir={}", prof.to_string_lossy()));
    c.args(args).arg(file_url(html));
    c.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); }
    let out = c.output().map_err(|e| format!("브라우저를 실행하지 못했습니다: {e}"));
    let _ = std::fs::remove_dir_all(&prof);
    let out = out?;
    if !out.status.success() { return Err(format!("브라우저 오류: {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or(""))); }
    Ok(())
}

/// A4 자료 → PDF (기존 toPdf: 여백 없이, 배경 색까지)
pub fn to_pdf(job: &Value) -> Result<Vec<u8>, String> {
    let html = write_html(job, None)?;
    let out = tmp_dir().join(format!("out_{}.pdf", uniq()));
    let r = run_browser(&["--no-pdf-header-footer".into(), "--print-to-pdf-no-header".into(), format!("--print-to-pdf={}", out.to_string_lossy())], &html);
    let _ = std::fs::remove_file(&html);
    r?;
    let b = std::fs::read(&out).map_err(|_| "PDF 를 만들지 못했습니다.".to_string());
    let _ = std::fs::remove_file(&out);
    b
}

/// 한 번 찍기 (가로 w, 세로 h)
fn screenshot(job: &Value, w: u32, h: u32) -> Result<image::RgbaImage, String> {
    let html = write_html(job, Some(w))?;
    let out = tmp_dir().join(format!("shot_{}.png", uniq()));
    let r = run_browser(&["--hide-scrollbars".into(), "--force-device-scale-factor=1".into(), format!("--window-size={w},{h}"), format!("--screenshot={}", out.to_string_lossy())], &html);
    let _ = std::fs::remove_file(&html);
    r?;
    let img = image::open(&out).map_err(|e| format!("그림을 읽지 못했습니다: {e}"))?.to_rgba8();
    let _ = std::fs::remove_file(&out);
    Ok(img)
}

/// 카드(1080×1350)·슬라이드(1920×1080) 여러 장 → 장마다 그림 (한 번에 찍어 자른다)
pub fn render_items(job: &Value, count: usize) -> Result<Vec<image::RgbaImage>, String> {
    let wide = job["kind"] == "slides";
    let (w, h) = if wide { (1920u32, 1080u32) } else { (1080, 1350) };
    if count == 0 { return Ok(vec![]); }
    let all = screenshot(job, w, h * count as u32)?;
    Ok((0..count as u32).map(|i| image::imageops::crop_imm(&all, 0, i * h, w, h).to_image()).collect())
}

/// A4 자료 한 장 미리보기 (길면 아래로 늘어난다: 흰 여백을 잘라 낸다)
pub fn render_page(job: &Value) -> Result<image::RgbaImage, String> {
    let img = screenshot(job, 794, 6000)?;
    let (w, h) = img.dimensions();
    let mut last = 0;
    for y in (0..h).rev() {
        if (0..w).step_by(3).any(|x| { let p = img.get_pixel(x, y).0; p[0] < 250 || p[1] < 250 || p[2] < 250 }) { last = y; break; }
    }
    let height = (last + 30).clamp(1123, h);
    Ok(image::imageops::crop_imm(&img, 0, 0, w, height).to_image())
}

pub fn png_bytes(img: &image::RgbaImage) -> Result<Vec<u8>, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(buf.into_inner())
}

/// 지금 영상 장면 → 1080×1350 가운데 잘라 낸 JPEG data URL (기존 grabScene)
pub fn scene_url(rgba: &[u8], w: usize, h: usize) -> Option<String> {
    let src = image::RgbaImage::from_raw(w as u32, h as u32, rgba.to_vec())?;
    let s = (1080.0 / w as f64).max(1350.0 / h as f64);
    let (nw, nh) = ((w as f64 * s).round() as u32, (h as f64 * s).round() as u32);
    let big = image::imageops::resize(&src, nw.max(1080), nh.max(1350), image::imageops::FilterType::Triangle);
    let crop = image::imageops::crop_imm(&big, (big.width() - 1080) / 2, (big.height() - 1350) / 2, 1080, 1350).to_image();
    let rgb = image::DynamicImage::ImageRgba8(crop).to_rgb8();
    let mut buf = std::io::Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 86).encode_image(&rgb).ok()?;
    use base64::Engine;
    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(buf.into_inner())))
}

/// 저장 실패를 알아보기 쉬운 말로 (기존 writeFileFriendly)
pub fn write_friendly(p: &Path, data: &[u8]) -> Result<(), String> {
    std::fs::write(p, data).map_err(|e| {
        let why = match e.kind() {
            std::io::ErrorKind::PermissionDenied => "같은 이름의 파일이 다른 프로그램에서 열려 있거나 쓸 수 없는 곳입니다. 파일을 닫거나 다른 이름으로 저장해 주세요.".to_string(),
            std::io::ErrorKind::NotFound if p.parent().is_some_and(|d| d.exists()) => "이 폴더에 쓸 수 없습니다. Windows 보안의 \"제어된 폴더 액세스\"가 막았을 수 있습니다. 다른 폴더를 고르거나 Windows 보안에서 SermonShorts 를 허용해 주세요.".into(),
            _ => e.to_string(),
        };
        format!("저장하지 못했습니다. {why}")
    })
}
pub fn safe_name(s: &str) -> String {
    let t: String = s.chars().filter(|c| !"\\/:*?\"<>|".contains(*c)).collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    let t: String = t.chars().take(60).collect();
    if t.is_empty() { "자료".into() } else { t }
}
/// 이미 있는 파일을 덮어쓰지 않게 '이름 (2)'
pub fn free_base(folder: &Path, base: &str, count: usize) -> String {
    let has = |b: &str| (1..=count).any(|i| folder.join(format!("{b}_{i:02}.png")).exists());
    if !has(base) { return base.into(); }
    for n in 2..100 { let b = format!("{base} ({n})"); if !has(&b) { return b; } }
    format!("{base} {}", uniq())
}
