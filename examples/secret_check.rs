//! 잠긴 설정 값이 풀리는지만 확인 (값은 출력하지 않는다)
fn main() {
    let s = sermon_shorts::theme::app_settings();
    for k in ["ytRefreshEnc", "geminiApiKeyEnc", "openrouterApiKeyEnc", "ytClientSecretEnc"] {
        match s[k].as_str() {
            None | Some("") => println!("{k}: 없음"),
            Some(v) => match sermon_shorts::secret::decrypt(v) {
                Ok(p) => println!("{k}: 풀림 (길이 {}, 모양 {})", p.len(), if k == "ytRefreshEnc" { if p.starts_with("1//") { "구글 갱신 토큰" } else { "다름" } } else { "-" }),
                Err(e) => println!("{k}: 실패 {e}"),
            },
        }
    }
    let enc = sermon_shorts::secret::encrypt("시험 값 123").unwrap();
    println!("잠그고 다시 풀기: {}", sermon_shorts::secret::decrypt(&enc).unwrap() == "시험 값 123");
}
