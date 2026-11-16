//! AI 연결 순수 로직이 Electron(chatgpt-core·gemini·openrouter·ai.testConnection)과 같은지 (tests/gen_llm.js 로 만든 자료)
use serde_json::{json, Value};
use sermon_shorts::llm::{self, chatgpt, gemini, openrouter, Msg};

fn cases() -> Value { serde_json::from_str(&std::fs::read_to_string("tests/fixtures/llm_cases.json").unwrap()).unwrap() }
fn msgs(v: &Value) -> Vec<Msg> { v.as_array().unwrap().iter().map(|m| Msg { role: m["role"].as_str().unwrap().into(), content: m["content"].as_str().unwrap().into() }).collect() }
fn s<'a>(v: &'a Value) -> Option<&'a str> { v.as_str() }

#[test]
fn authorize_url() {
    for c in cases()["authorize"].as_array().unwrap() {
        let a = &c["args"];
        let r = chatgpt::build_authorize_url(&chatgpt::AuthorizeArgs {
            client_id: s(&a["clientId"]), host_id: a["hostId"].as_str().unwrap(), redirect_uri: a["redirectUri"].as_str().unwrap(), state: a["state"].as_str().unwrap(),
            nonce: a["nonce"].as_str().unwrap(), code_challenge: a["codeChallenge"].as_str().unwrap(), id_token_hint: s(&a["idTokenHint"]), login_hint: s(&a["loginHint"]), is_new: a["isNew"].as_bool().unwrap(),
        });
        match (&c["out"]["ok"], r) {
            (Value::String(want), Ok(got)) => assert_eq!(&got, want),
            (Value::Null, Err(m)) => assert_eq!(m, c["out"]["msg"].as_str().unwrap()),
            (w, g) => panic!("다름: {w:?} / {g:?}"),
        }
    }
}

#[test]
fn callback() {
    for c in cases()["callback"].as_array().unwrap() {
        let p = &c["pending"];
        let r = chatgpt::parse_callback(c["url"].as_str().unwrap(), p["state"].as_str().unwrap(), p["isNew"].as_bool().unwrap(), s(&p["clientId"]));
        match (&c["out"]["ok"], r) {
            (Value::Object(w), Ok((code, cid, scope))) => assert_eq!((code.as_str(), cid.as_str(), scope.as_str()), (w["code"].as_str().unwrap(), w["clientId"].as_str().unwrap(), w["scope"].as_str().unwrap()), "{}", c["url"]),
            (Value::Null, Err(er)) => { assert_eq!(er.code, c["out"]["err"].as_str().unwrap(), "{}", c["url"]); assert_eq!(er.msg, c["out"]["msg"].as_str().unwrap()); }
            (w, g) => panic!("{} 다름: {w:?} / {g:?}", c["url"]),
        }
    }
}

#[test]
fn forms_and_scopes() {
    let c = cases();
    assert_eq!(chatgpt::token_form("c i", "x/y+z", "v~v", "http://127.0.0.1:1455/auth/callback"), c["forms"]["token"].as_str().unwrap());
    assert_eq!(chatgpt::refresh_form("cid", "r.t-_*!"), c["forms"]["refresh"].as_str().unwrap());
    assert_eq!(chatgpt::revoke_form("cid", "rt=1&2"), c["forms"]["revoke"].as_str().unwrap());
    for x in c["scopes"].as_array().unwrap() {
        assert_eq!(json!(chatgpt::parse_scopes(&x["in"])), x["out"], "{}", x["in"]);
        assert_eq!(json!(chatgpt::has_plan_scope(&x["in"])), x["plan"]);
    }
}

#[test]
fn id_token() {
    let c = cases();
    for x in c["jwt"].as_array().unwrap() {
        let r = chatgpt::verify_jwt(x["token"].as_str().unwrap(), &x["jwks"]);
        match (&x["out"]["ok"], r) {
            (Value::Object(_), Ok(p)) => assert_eq!(&p, &x["out"]["ok"], "{}", x["name"]),
            (Value::Null, Err(er)) => { assert_eq!(er.code, "id_token", "{}", x["name"]); assert_eq!(er.msg, x["out"]["msg"].as_str().unwrap(), "{}", x["name"]); }
            (w, g) => panic!("{} 다름: {w:?} / {g:?}", x["name"]),
        }
    }
    for x in c["validate"].as_array().unwrap() {
        let r = chatgpt::validate_id_token(&x["claims"], x["audience"].as_str().unwrap(), s(&x["nonce"]), 1900000000);
        match (&x["out"]["ok"], r) {
            (Value::Object(w), Ok((sub, email, name))) => assert_eq!(json!({ "sub": sub, "email": email, "name": name }), Value::Object(w.clone())),
            (Value::Null, Err(er)) => assert_eq!(er.msg, x["out"]["msg"].as_str().unwrap(), "{}", x["claims"]),
            (w, g) => panic!("{} 다름: {w:?} / {g:?}", x["claims"]),
        }
    }
}

#[test]
fn responses_and_sse() {
    let c = cases();
    for x in c["responses"].as_array().unwrap() {
        let a = &x["args"];
        let r = chatgpt::responses_body(a["model"].as_str().unwrap(), a["instructions"].as_str().unwrap(), &msgs(&a["messages"]));
        match (&x["out"]["ok"], r) {
            (Value::Object(_), Ok(b)) => assert_eq!(&b, &x["out"]["ok"]),
            (Value::Null, Err(m)) => assert_eq!(m, x["out"]["msg"].as_str().unwrap()),
            (w, g) => panic!("다름: {w:?} / {g:?}"),
        }
    }
    for x in c["sse"].as_array().unwrap() {
        let mut p = chatgpt::SseParser::default();
        for ch in x["chunks"].as_array().unwrap() { p.feed(ch.as_str().unwrap()); }
        let st = p.end();
        let w = &x["out"];
        assert_eq!(st.text, w["text"].as_str().unwrap(), "{:?}", x["chunks"]);
        assert_eq!(st.completed, w["completed"].as_bool().unwrap());
        assert_eq!(st.events as u64, w["events"].as_u64().unwrap(), "{:?}", x["chunks"]);
        assert_eq!(st.failed.map(|(c, m)| json!({ "code": c, "message": m })).unwrap_or(Value::Null), w["failed"]);
        assert_eq!(st.incomplete.map(|r| json!({ "reason": r })).unwrap_or(Value::Null), w["incomplete"]);
    }
    for x in c["models"].as_array().unwrap() {
        let got: Vec<Value> = chatgpt::pick_listed_models(&x["in"]).into_iter().map(|(s, d)| json!({ "slug": s, "display_name": d })).collect();
        assert_eq!(json!(got), x["out"]);
    }
    for x in c["usage"].as_array().unwrap() { assert_eq!(json!(chatgpt::is_usage_limit_code(x["in"].as_str().unwrap())), x["out"]); }
}

#[test]
fn gemini_openrouter() {
    let c = cases();
    for x in c["gemini"].as_array().unwrap() {
        let m = msgs(&json!([{ "role": "user", "content": "첫 질문" }, { "role": "assistant", "content": "{\"a\":1}" }, { "role": "user", "content": "둘째" }]));
        assert_eq!(gemini::body(x["system"].as_str().unwrap(), &m), x["body"], "본문 {}", x["status"]);
        assert_eq!(x["url"].as_str().unwrap(), format!("{}:generateContent", gemini::DEFAULT_MODEL));
        let st = x["status"].as_u64().unwrap() as u16;
        if (200..300).contains(&st) { assert_eq!(gemini::text_of(&x["json"]), x["out"]["ok"].as_str().unwrap()); }
        else { let er = gemini::error_of(st, &x["json"]); assert_eq!(er.code, x["out"]["err"].as_str().unwrap()); assert_eq!(er.msg, x["out"]["msg"].as_str().unwrap()); }
    }
    for x in c["geminiTest"].as_array().unwrap() {
        let (ok, m) = gemini::test_result(x["status"].as_u64().unwrap() as u16, &x["json"], "gemini-test-model", 0);
        assert_eq!(json!(ok), x["ok"]);
        assert_eq!(m, x["message"].as_str().unwrap());
        assert_eq!(x["body"], json!({ "contents": [{ "role": "user", "parts": [{ "text": "확인. \"OK\"라고만 답해." }] }], "generationConfig": { "maxOutputTokens": 5, "thinkingConfig": { "thinkingLevel": "minimal" } } }));
    }
    for x in c["openrouterBody"].as_array().unwrap() {
        assert_eq!(openrouter::body(x["model"].as_str().unwrap(), x["system"].as_str().unwrap(), &msgs(&x["messages"])), x["body"]);
        assert_eq!(x["headers"]["X-Title"], "SermonShorts");
    }
    for x in c["openrouterErr"].as_array().unwrap() {
        let st = x["status"].as_u64().unwrap() as u16;
        let (er, _, _) = openrouter::error_of((200..300).contains(&st), st, &x["json"]);
        assert_eq!(er.msg, x["out"]["msg"].as_str().unwrap(), "{}", x["json"]);
    }
    assert_eq!(json!(openrouter::pick_free(&c["freeModels"]["in"])), c["freeModels"]["out"]);
    assert_eq!(llm::claude::convo(&msgs(&c["claudeConvo"]["messages"])), c["claudeConvo"]["out"].as_str().unwrap());
}

#[test]
fn form_round_trip() {
    for t in ["a b+c", "목사@교회.kr", "x/y=z&w", "~!*()'"] {
        let enc = llm::form_encode(&[("k", t)]);
        assert_eq!(llm::form_decode(&enc[2..]), t);
    }
}
