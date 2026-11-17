// 원고 파일 읽기 시험: 파일마다 글을 꺼내 <out>/<이름>.txt 로 쓴다
fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let out = std::path::PathBuf::from(&a[0]);
    for f in &a[1..] {
        let p = std::path::Path::new(f);
        let t = std::time::Instant::now();
        match sermon_shorts::materials_file::read_text(p) {
            Ok(s) => { std::fs::write(out.join(format!("{}.rs.txt", p.file_name().unwrap().to_string_lossy())), &s).unwrap(); println!("OK {} {}자 {:.1}초", p.display(), s.chars().count(), t.elapsed().as_secs_f64()); }
            Err(e) => println!("ERR {} {e}", p.display()),
        }
    }
}
