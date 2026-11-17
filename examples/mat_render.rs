// 교인 자료 그리기 시험: 요약 A4 미리보기·PDF, 묵상카드 PNG, 설교 PPT 슬라이드
use serde_json::json;
use sermon_shorts::{materials as m, matrender as r};
fn main() {
    let out = std::path::PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| ".".into()));
    let meta = json!({ "church": "사랑교회", "title": "하나님 중심의 기도", "verse": "마태복음 6:9-13", "speaker": "홍길동 목사", "date": "2026년 11월 15일" });
    let sum = m::parse("summary", r##"{"title":"하나님 중심의 기도","verse":"마 6:9-13","theme":"기도는 하나님의 뜻을 먼저 구하는 것입니다","points":[{"heading":"아버지라 부르는 기도","body":"예수님은 하나님을 아버지라 부르라고 가르치셨습니다."},{"heading":"뜻을 먼저 구하는 기도","body":"내 필요보다 하나님의 나라와 뜻을 먼저 구합니다."}],"application":"이번 주 하루를 주기도문으로 시작해 보세요.","prayer":"아버지, 오늘도 아버지의 뜻을 먼저 구하게 하소서."}"##).unwrap();
    let t = std::time::Instant::now();
    let job = r::job("page", "summary", &sum, &meta, "navy", "", &json!(null));
    let img = r::render_page(&job).unwrap();
    std::fs::write(out.join("mat_summary.png"), r::png_bytes(&img).unwrap()).unwrap();
    println!("A4 미리보기 {}x{} {:.1}초", img.width(), img.height(), t.elapsed().as_secs_f64());
    let t = std::time::Instant::now();
    let pdf = r::to_pdf(&job).unwrap();
    std::fs::write(out.join("mat_summary.pdf"), &pdf).unwrap();
    println!("PDF {}KB {:.1}초", pdf.len() / 1024, t.elapsed().as_secs_f64());
    let cards = m::parse("cards", r##"{"cards":[{"headline":"기도는 관계입니다","body":"하나님을 아버지라 부르는 것부터","source":"마 6:9"},{"headline":"뜻을 먼저","body":"내 뜻보다 아버지의 뜻","source":"마 6:10"}],"caption":"캡션","hashtags":["#주일설교"]}"##).unwrap();
    let t = std::time::Instant::now();
    let imgs = r::render_items(&r::job("cards", "cards", &cards, &meta, "paper", "", &json!({ "1": { "design": "sky" } })), 2).unwrap();
    for (i, im) in imgs.iter().enumerate() { std::fs::write(out.join(format!("mat_card{}.png", i + 1)), r::png_bytes(im).unwrap()).unwrap(); }
    println!("카드 {}장 {:.1}초", imgs.len(), t.elapsed().as_secs_f64());
    let sl = m::parse("slides", r##"{"title":"하나님 중심의 기도","verse":"마 6:9-13","slides":[{"heading":"아버지라 부르는 기도","lines":["관계에서 시작되는 기도","하나님은 아버지이십니다"],"ref":"마 6:9"}],"closing":"이번 주 주기도문으로 하루를 시작합시다"}"##).unwrap();
    let t = std::time::Instant::now();
    let n = sl["slides"].as_array().unwrap().len() + 2;
    let imgs = r::render_items(&r::job("slides", "slides", &sl, &meta, "navy", "", &json!(null)), n).unwrap();
    std::fs::write(out.join("mat_slide2.png"), r::png_bytes(&imgs[1]).unwrap()).unwrap();
    println!("슬라이드 {}장 {:.1}초", imgs.len(), t.elapsed().as_secs_f64());
}
