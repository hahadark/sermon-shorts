// 배포용: 앱 묶음을 바뀐 부분만 받기용 덩어리 ZIP·파일 목록으로 나눈다
// cargo run --release --example make_delta -- <앱 폴더 또는 SermonShorts.app> <버전> <win-x64|mac-arm64|mac-intel> <출력 폴더>
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let out = sermon_shorts::delta::build(std::path::Path::new(&a[1]), &a[2], &a[3], std::path::Path::new(&a[4])).expect("나누기 실패");
    for f in out { println!("{}  {}", f.display(), std::fs::metadata(&f).map(|m| m.len()).unwrap_or(0)); }
}
