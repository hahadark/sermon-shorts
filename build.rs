// 빌드 때 assets/google-client.json(저장소에는 없음)이 있으면 실행 파일 안에 넣는다. 없으면 빈 글.
fn main() {
    let src = std::path::Path::new("assets/google-client.json");
    println!("cargo:rerun-if-changed=assets/google-client.json");
    let txt = std::fs::read_to_string(src).unwrap_or_default();
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("google_client.json");
    std::fs::write(out, txt).unwrap();
}