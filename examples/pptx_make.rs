// 설교 PPT 시험: 3가지 디자인 + 영상 장면으로 .pptx 를 만든다
use serde_json::json;
fn main() {
    let out = std::path::PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| ".".into()));
    let d = json!({ "title": "하나님 중심의 기도", "verse": "마 6:9-13", "slides": [{ "heading": "아버지라 부르는 기도는 관계에서 시작됩니다 정말로", "lines": ["관계에서 시작되는 기도", "하나님은 아버지이십니다 <&>"], "ref": "마 6:9" }, { "heading": "뜻을 먼저", "lines": [], "ref": "" }], "closing": "이번 주 주기도문으로 하루를 시작합시다 함께" });
    let meta = json!({ "church": "사랑교회", "title": "하나님 중심의 기도", "speaker": "홍길동 목사", "date": "2026년 11월 15일" });
    for design in ["navy", "paper", "sky"] { let b = sermon_shorts::pptx::build(&d, &meta, design, None).unwrap(); std::fs::write(out.join(format!("rs_{design}.pptx")), b).unwrap(); }
    let img = image::RgbImage::from_fn(640, 360, |x, y| image::Rgb([(x % 255) as u8, (y % 255) as u8, 120]));
    let mut jpg = std::io::Cursor::new(vec![]);
    image::DynamicImage::ImageRgb8(img).write_to(&mut jpg, image::ImageFormat::Jpeg).unwrap();
    let b = sermon_shorts::pptx::build(&d, &meta, "scene", Some(&jpg.into_inner())).unwrap();
    std::fs::write(out.join("rs_scene.pptx"), b).unwrap();
    println!("ok");
}
