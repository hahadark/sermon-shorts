//! AI 연결 실제 점검 (돈이 드는 호출은 하지 않는다: 제미나이·오픈라우터는 틀린 키로 오류만, 챗GPT 는 공개 설정·서명 키만)
use sermon_shorts::llm::{self, gemini, openrouter};
fn main() {
    let t0 = std::time::Instant::now();
    let st = llm::status();
    println!("상태 ({:.1}초): 사용 중={:?}", t0.elapsed().as_secs_f64(), st.active);
    println!("  챗GPT 연결={} 요금제허용={} 메일있음={}", st.chatgpt.connected, st.chatgpt.plan_enabled, !st.chatgpt.email.is_empty());
    println!("  클로드 설치={} 로그인={} 방식={} 판={}", st.claude.installed, st.claude.logged_in, st.claude.method, st.claude.version);
    println!("  제미나이 키={} 오픈라우터 키={}", st.gemini.has_key, st.openrouter.has_key);
    println!("  칩: {:?}", st.chip());
    let (ok, m) = gemini::test_connection("AIzaInvalidKeyForTest000000000000000000", "gemini-3.5-flash");
    println!("제미나이 틀린 키 연결 확인: ok={ok} {m}");
    let r = gemini::complete("AIzaInvalidKeyForTest000000000000000000", "s", &[llm::Msg::user("hi")], None);
    println!("제미나이 틀린 키 대화: {:?}", r.err().map(|e| (e.code, e.msg)));
    let r = openrouter::complete("sk-or-v1-invalid000000000000000000000000", "", &[llm::Msg::user("hi")], None);
    println!("오픈라우터 틀린 키: {:?}", r.err().map(|e| (e.code, e.msg)));
    let free = openrouter::free_models();
    println!("오픈라우터 무료 모델 {}개 (앞 3개 {:?})", free.len(), free.iter().take(3).collect::<Vec<_>>());
    let cfg: serde_json::Value = ureq::get("https://auth.openai.com/.well-known/openid-configuration").call().ok().and_then(|r| r.into_json().ok()).unwrap_or_default();
    let jw: serde_json::Value = cfg["jwks_uri"].as_str().and_then(|u| ureq::get(u).call().ok()).and_then(|r| r.into_json().ok()).unwrap_or_default();
    println!("챗GPT 로그인 서버: issuer={} 해지주소있음={} 서명키 {}개", cfg["issuer"], cfg["revocation_endpoint"].is_string(), jw["keys"].as_array().map(|a| a.len()).unwrap_or(0));
    if std::env::var("SS_LIVE_CLAUDE").is_ok() {
        let t1 = std::time::Instant::now();
        let (ok, text) = llm::test("claude");
        println!("클로드 연결 확인 ({:.1}초): ok={ok} 답={text:?}", t1.elapsed().as_secs_f64());
    }
}
