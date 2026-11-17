// 자막 없는 영상(위스퍼로 만든 대화 자막)으로 추천 → 고르기 → 필요한 영상 부분 받기까지: cargo run --release --example chat_whisper_plan -- <주소>
use sermon_shorts::chat;
use std::sync::{Arc, Mutex, atomic::AtomicBool};
fn main() {
    let url = std::env::args().nth(1).expect("주소");
    let shared: chat::Shared = Arc::new(Mutex::new(None));
    let t = std::time::Instant::now();
    let l = chat::load_video(&shared, &url);
    println!("불러오기 {:.1}초: {}", t.elapsed().as_secs_f64(), match &l { Ok(chat::Loaded::Ready { words, .. }) => format!("자막 {words}단어"), Ok(chat::Loaded::NoSubs { .. }) => "자막 없음 → 위스퍼".into(), Err(e) => e.clone() });
    if matches!(l, Ok(chat::Loaded::NoSubs { .. })) {
        let t = std::time::Instant::now();
        let on: Arc<dyn Fn(&str, Option<f64>) + Send + Sync> = Arc::new(|_: &str, _: Option<f64>| {});
        let r = chat::load_video_whisper(&shared, &url, on, Arc::new(AtomicBool::new(false)));
        println!("위스퍼 {:.1}초: {:?}", t.elapsed().as_secs_f64(), r.map(|_| "ok"));
    }
    let prefs = serde_json::json!({ "length": 90, "tight": true, "filler": true, "questions": true, "notices": true, "gaps": true, "ending": true, "count": 3 });
    let st = |_: &str| {};
    let (_, text) = sermon_shorts::chat_plan::action_request("recommend", &prefs, &serde_json::Value::Null).unwrap();
    let t = std::time::Instant::now();
    let r = match chat::send(&shared, &text, &st, Arc::new(AtomicBool::new(false))) { Ok(r) => r, Err(e) => { println!("추천 오류: {e}"); return; } };
    println!("추천 {:.1}초 ({}): 후보 {}개", t.elapsed().as_secs_f64(), r.provider, r.candidates.len());
    for c in &r.candidates { println!("  후보 {} #{}~#{} {:.0}초 「{}」", c.no, c.from, c.to, c.duration_sec, c.title); }
    let Some(c) = r.candidates.first() else { return };
    let (_, text) = sermon_shorts::chat_plan::action_request("pick", &prefs, &serde_json::json!({ "no": c.no, "from": c.from, "to": c.to, "title": c.title })).unwrap();
    let t = std::time::Instant::now();
    let r = match chat::send(&shared, &text, &st, Arc::new(AtomicBool::new(false))) { Ok(r) => r, Err(e) => { println!("만들기 오류: {e}"); return; } };
    println!("만들기 {:.1}초: 구간 {} 개, {:.0}초, 제목 {:?}", t.elapsed().as_secs_f64(), r.ranges.len(), r.duration_sec, r.title);
    let spans: Vec<sermon_shorts::source_fetch::Span> = { let g = shared.lock().unwrap(); let w = &g.as_ref().unwrap().words; r.ranges.iter().map(|x| sermon_shorts::source_fetch::Span { start: w[x.from].start, end: w[x.to].end }).collect() };
    let t = std::time::Instant::now();
    match sermon_shorts::youtube::fetch_clips(&url, &spans, &|_| {}) {
        Ok(c) => println!("영상 부분 받기 {:.1}초: {} ({}조각, 길이 {:.0}초)", t.elapsed().as_secs_f64(), c.path.display(), c.map.len(), c.duration),
        Err(e) => println!("받기 오류: {e}"),
    }
}
