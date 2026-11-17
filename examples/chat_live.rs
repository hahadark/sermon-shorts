// 실제 AI·유튜브로 대화형 편집 확인: cargo run --release --example chat_live -- <유튜브 주소>
use sermon_shorts::chat;
use std::sync::{Arc, Mutex, atomic::AtomicBool};
fn main() {
    let url = std::env::args().nth(1).expect("주소");
    let shared: chat::Shared = Arc::new(Mutex::new(None));
    let t = std::time::Instant::now();
    let l = chat::load_video(&shared, &url);
    println!("불러오기 {:.1}초: {:?}", t.elapsed().as_secs_f64(), l.as_ref().map(|x| match x { chat::Loaded::Ready { title, words, .. } => format!("{title} {words}단어"), chat::Loaded::NoSubs { title, .. } => format!("자막 없음 {title}") }));
    let prefs = serde_json::json!({ "length": 90, "tight": true, "filler": true, "questions": true, "notices": true, "gaps": true, "ending": true, "count": 3 });
    let (_, text) = sermon_shorts::chat_plan::action_request("recommend", &prefs, &serde_json::Value::Null).unwrap();
    let t = std::time::Instant::now();
    let st = |s: &str| println!("  단계 {s}");
    let r = chat::send(&shared, &text, &st, Arc::new(AtomicBool::new(false)));
    match &r {
        Ok(r) => { println!("추천 {:.1}초 ({}): {}", t.elapsed().as_secs_f64(), r.provider, r.reply); for c in &r.candidates { println!("  후보 {} #{}~#{} {:.0}초 「{}」 {}", c.no, c.from, c.to, c.duration_sec, c.title, c.why); } }
        Err(e) => { println!("오류: {e}"); return; }
    }
    let c = &r.unwrap().candidates[0];
    let (_, text) = sermon_shorts::chat_plan::action_request("pick", &prefs, &serde_json::json!({ "no": c.no, "from": c.from, "to": c.to, "title": c.title })).unwrap();
    let t = std::time::Instant::now();
    match chat::send(&shared, &text, &st, Arc::new(AtomicBool::new(false))) {
        Ok(r) => println!("만들기 {:.1}초: {} | 구간 {:?} | 길이 {:.0}초 | 제목 {:?} | 본문 {:?} | 교정 {} | 경고 {:?}", t.elapsed().as_secs_f64(), r.reply, r.ranges.iter().map(|g| (g.from, g.to)).collect::<Vec<_>>(), r.duration_sec, r.title, r.verse, r.corrections.len(), r.warnings),
        Err(e) => println!("오류: {e}"),
    }
}
