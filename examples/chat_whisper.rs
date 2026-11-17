// 위스퍼로 대화 자막 만들기: cargo run --release --example chat_whisper -- <주소>
use std::sync::{Arc, Mutex, atomic::AtomicBool};
fn main() {
    let url = std::env::args().nth(1).expect("주소");
    let shared: sermon_shorts::chat::Shared = Arc::new(Mutex::new(None));
    let t = std::time::Instant::now();
    let last = Arc::new(Mutex::new(String::new()));
    let l2 = last.clone();
    let on: Arc<dyn Fn(&str, Option<f64>) + Send + Sync> = Arc::new(move |s: &str, p: Option<f64>| { let k = format!("{s} {:?}", p.map(|x| (x / 10.0).floor() * 10.0)); let mut g = l2.lock().unwrap(); if *g != k { println!("  {k}"); *g = k; } });
    let r = sermon_shorts::chat::load_video_whisper(&shared, &url, on, Arc::new(AtomicBool::new(false)));
    println!("{:.1}초: {:?}", t.elapsed().as_secs_f64(), r);
    if let Some(s) = shared.lock().unwrap().as_ref() { println!("줄 {}개, 첫 줄: {}", s.lines.len(), s.lines.first().map(|l| (l.from..=l.to).map(|k| s.words[k].text.clone()).collect::<Vec<_>>().join(" ")).unwrap_or_default()); }
}
