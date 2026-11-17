// 대화 불러오기만: cargo run --release --example chat_load -- <주소>
fn main() {
    let url = std::env::args().nth(1).expect("주소");
    let shared: sermon_shorts::chat::Shared = std::sync::Arc::new(std::sync::Mutex::new(None));
    let t = std::time::Instant::now();
    println!("{:.1}초: {:?}", t.elapsed().as_secs_f64(), sermon_shorts::chat::load_video(&shared, &url));
}
