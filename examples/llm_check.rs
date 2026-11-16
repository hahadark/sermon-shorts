//! AI 연결 점검: 챗GPT 로그인 파일을 풀 수 있는지 (값은 찍지 않는다) · 클로드 상태
fn main() {
    let f = sermon_shorts::theme::user_data_dir().join("llm").join("chatgpt.json");
    let raw = std::fs::read_to_string(&f).unwrap_or_default();
    match sermon_shorts::secret::decrypt(raw.trim()) {
        Ok(t) => {
            let v: serde_json::Value = serde_json::from_str(&t).unwrap_or_default();
            let keys: Vec<String> = v.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
            println!("chatgpt 풀기 성공: 항목 {:?}", keys);
            println!("planEnabled={} access 남은 초={} refresh 있음={} model={:?}", v["planEnabled"], v["expires_at"].as_i64().unwrap_or(0) - now, v["refresh_token"].as_str().is_some_and(|s| !s.is_empty()), v["model"]);
        }
        Err(e) => println!("chatgpt 풀기 실패: {e}"),
    }
}
