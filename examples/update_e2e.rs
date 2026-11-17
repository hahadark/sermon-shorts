// 업데이트 전체 흐름(확인→받기→해시→풀기→끝난 뒤 바꿔 끼우기)을 로컬 파일로 시험: tools\update_e2e.ps1 가 부른다
fn main() {
    let mut u = sermon_shorts::updater::Updater::new(true);
    println!("처음: {:?}", u.status());
    u.check();
    let t = std::time::Instant::now();
    loop {
        std::thread::sleep(std::time::Duration::from_millis(200));
        let s = u.status();
        if !u.busy() && !matches!(s, sermon_shorts::updater::St::Idle | sermon_shorts::updater::St::Checking) { println!("상태: {s:?} ({:.1}초)", t.elapsed().as_secs_f64()); break; }
        if t.elapsed().as_secs() > 120 { println!("시간 초과: {s:?}"); return; }
    }
    println!("바꿔 끼우기 시작: {}", u.spawn_swap(false));
}
