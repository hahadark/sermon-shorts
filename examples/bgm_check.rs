//! 배경음악 받기가 실제로 되는지 (incompetech 6갈래 · wikimedia 1갈래). SS_RUNTIME_DIR 임시 폴더에서
fn main() {
    let c = sermon_shorts::bgm::catalog();
    let pick: Vec<_> = [c.tracks.iter().find(|t| t.url.contains("incompetech")), c.tracks.iter().find(|t| t.url.contains("wikimedia"))].into_iter().flatten().cloned().collect();
    for t in pick {
        let t0 = std::time::Instant::now();
        let last = std::sync::Mutex::new((0u64, 0u64));
        match sermon_shorts::bgm::ensure(&t.id, &|g, n| { *last.lock().unwrap() = (g, n); }) {
            Ok(f) => {
                let size = std::fs::metadata(&f).map(|m| m.len()).unwrap_or(0);
                let (d, has) = sermon_shorts::bgm::probe_audio(&f);
                println!("{} ({}): {:.1}초에 {:.2}MB, 길이 {:.1}초 (목록 {:.0}초), 소리 {} · 진행 마지막 {:?}", t.id, t.url.split('/').nth(2).unwrap_or(""), t0.elapsed().as_secs_f64(), size as f64 / 1048576.0, d, t.duration_sec, has, last.lock().unwrap());
                let t1 = std::time::Instant::now();
                let again = sermon_shorts::bgm::ensure(&t.id, &|_, _| {}).is_ok();
                println!("  다시 부르면 캐시에서 {:.3}초 ({again})", t1.elapsed().as_secs_f64());
            }
            Err(e) => println!("{}: 실패 {e}", t.id),
        }
    }
}