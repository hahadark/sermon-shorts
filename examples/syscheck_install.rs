fn main() {
    use sermon_shorts::syscheck as sc;
    let t = std::time::Instant::now();
    let (ok, m) = sc::update_ytdlp(); println!("yt-dlp: {ok} {m} ({:.0}s)", t.elapsed().as_secs_f64());
    let t = std::time::Instant::now();
    let mut last = String::new();
    let (ok, m) = sc::install_ffmpeg(|p, m| { let s = format!("{:?} {m}", p.map(|x| x as i64)); if s != last { last = s; } });
    println!("ffmpeg: {ok} {m} ({:.0}s) 마지막 진행: {last}", t.elapsed().as_secs_f64());
    for r in sc::check_system(true).rows.iter().take(2) { println!("{} {}: {}", r.status.as_str(), r.name, r.value); }
}
