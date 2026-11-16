//! 실제로 유튜브 구간 받기·음성 인식이 되는지 (짧게)
use std::sync::{atomic::AtomicBool, Arc};
fn main() {
    let t0 = std::time::Instant::now();
    match sermon_shorts::youtube::fetch_part("https://www.youtube.com/watch?v=jNQXAC9IVRw", 2.0, 12.0, 8.0, &|p, s| { if (p as i64) % 25 == 0 { eprintln!("  받기 {s} {p:.0}%"); } }) {
        Ok(f) => {
            let d = sermon_shorts::media::probe(&f.path).map(|p| p.duration).unwrap_or(0.0);
            println!("구간 받기: {} ({:.1}초 걸림) 방법 {} offset {:.3} 파일 길이 {:.2}초", f.path.display(), t0.elapsed().as_secs_f64(), f.method, f.offset, d);
        }
        Err(e) => println!("구간 받기 실패: {e}"),
    }
    let t1 = std::time::Instant::now();
    let src = std::path::Path::new("F:/aside/sermon-shorts-app/cache/yt/uSE5pZB3gtQ/part_4955_5100.mp4");
    let cancel = Arc::new(AtomicBool::new(false));
    match sermon_shorts::stt::transcribe(src, Some(0.0), Some(20.0), "", &|st, p, m| { if !m.is_empty() { eprintln!("  알림 {m}"); } else if (p as i64) % 20 == 0 { eprintln!("  인식 {st} {p:.0}%"); } }, cancel) {
        Ok(v) => { let w = v["words"].as_array().map(|a| a.len()).unwrap_or(0); let txt: Vec<&str> = v["words"].as_array().unwrap().iter().take(12).filter_map(|x| x["text"].as_str()).collect(); println!("음성 인식: 단어 {w}개 ({:.1}초) 언어 {} · {}", t1.elapsed().as_secs_f64(), v["language"], txt.join(" ")); }
        Err(e) => println!("음성 인식 실패: {e}"),
    }
}
