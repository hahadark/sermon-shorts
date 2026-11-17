//! 대화형 편집 순수 함수가 Electron(src/shared/chat-plan.js)과 같은 결과를 내는지. 기대값: node tests/gen_chat.js
use serde_json::{json, Value};
use sermon_shorts::chat_plan::*;

fn cases() -> Value { serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/chat_cases.json")).unwrap()).unwrap() }
fn words(c: &Value) -> Vec<SubWord> { c["words"].as_array().unwrap().iter().map(|w| SubWord { text: w["text"].as_str().unwrap().into(), start: w["start"].as_f64().unwrap(), end: w["end"].as_f64().unwrap() }).collect() }
fn lines(c: &Value) -> Vec<SubLine> { c["lines"].as_array().unwrap().iter().map(|l| SubLine { start: l["start"].as_f64().unwrap(), from: l["from"].as_u64().unwrap() as usize, to: l["to"].as_u64().unwrap() as usize }).collect() }
fn near(a: f64, b: &Value) -> bool { (a - b.as_f64().unwrap()).abs() < 1e-9 }
fn s(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }

#[test]
fn time_and_transcript() {
    let c = cases();
    for x in c["fmtTime"].as_array().unwrap() { assert_eq!(fmt_time(x[0].as_f64().unwrap()), s(&x[1]), "fmtTime {}", x[0]); }
    let (w, l) = (words(&c), lines(&c));
    for x in c["transcript"].as_array().unwrap() {
        let r = x["range"].as_object().map(|r| (r["start"].as_f64().unwrap(), r["end"].as_f64().unwrap()));
        assert_eq!(transcript_text(&w, &l, r), s(&x["out"]));
    }
    for x in c["fmtLen"].as_array().unwrap() { assert_eq!(fmt_len(x[0].as_f64().unwrap()), s(&x[1]), "fmtLen {}", x[0]); }
    for x in c["withRo"].as_array().unwrap() { assert_eq!(with_ro(x[0].as_str().unwrap()), s(&x[1])); }
}

#[test]
fn prompts() {
    let c = cases();
    for x in c["system"].as_array().unwrap() {
        let g = |k: &str| x["ctx"][k].as_str().unwrap_or("").to_string();
        assert_eq!(build_system_prompt(&PromptCtx { church: g("church"), speaker: g("speaker"), terms: g("terms"), video_title: g("videoTitle") }), s(&x["out"]));
    }
    for x in c["user"].as_array().unwrap() {
        let cur = x["cur"].as_object().map(|o| Current {
            title: s(&o["title"]), verse: s(&o["verse"]), tighten: s(&o["tighten"]),
            segments: o["segments"].as_array().unwrap().iter().map(|g| (g["from"].as_u64().unwrap() as usize, g["to"].as_u64().unwrap() as usize, s(&g["text"]))).collect(),
            remaining_questions: o["remainingQuestions"].as_array().unwrap().iter().map(s).collect(),
        });
        assert_eq!(build_user_message(x["req"].as_str().unwrap(), cur.as_ref(), x["dur"].as_f64().unwrap()), s(&x["out"]));
    }
    for x in c["repair"].as_array().unwrap() { assert_eq!(repair_json(x[0].as_str().unwrap()), s(&x[1]), "repair {}", x[0]); }
}

#[test]
fn plans() {
    let c = cases();
    let w = words(&c);
    for x in c["plans"].as_array().unwrap() {
        let r = parse_plan(x["text"].as_str().unwrap());
        let exp = &x["plan"];
        match (&r, exp.get("ok")) {
            (Ok(p), Some(e)) => {
                assert_eq!(p.reply, s(&e["reply"]), "reply {}", x["text"]);
                assert_eq!(p.title, s(&e["title"]));
                assert_eq!(p.verse, s(&e["verse"]));
                assert_eq!(p.tighten, s(&e["tighten"]));
                assert_eq!(json!(p.segments), e["segments"]);
                assert_eq!(json!(p.candidates), e["candidates"]);
                let rs = resolve_plan(p, &w);
                let er = &x["resolved"];
                assert_eq!(json!(rs.ranges.iter().map(|r| json!({"from": r.from, "to": r.to})).collect::<Vec<_>>()), er["ranges"], "ranges {}", x["text"]);
                assert_eq!(json!(rs.corrections.iter().map(|(i, t)| json!({"id": i, "text": t})).collect::<Vec<_>>()), er["corrections"]);
                assert_eq!(json!(rs.warnings), er["warnings"]);
                let cs = resolve_candidates(&p.candidates, &w);
                let ec = x["candidates"].as_array().unwrap();
                assert_eq!(cs.len(), ec.len(), "candidates {}", x["text"]);
                for (a, b) in cs.iter().zip(ec) {
                    assert_eq!((a.no, a.from, a.to), (b["no"].as_u64().unwrap() as usize, b["from"].as_u64().unwrap() as usize, b["to"].as_u64().unwrap() as usize));
                    assert_eq!((a.title.as_str(), a.summary.as_str(), a.why.as_str(), a.excerpt.as_str()), (b["title"].as_str().unwrap(), b["summary"].as_str().unwrap(), b["why"].as_str().unwrap(), b["excerpt"].as_str().unwrap()));
                    assert!(near(a.start, &b["start"]) && near(a.end, &b["end"]) && near(a.duration_sec, &b["durationSec"]));
                }
            }
            (Err(e), None) => assert_eq!(e.msg, s(&exp["msg"]), "err {}", x["text"]),
            _ => panic!("결과가 다름: {} rust={:?} js={}", x["text"], r.as_ref().map(|p| p.reply.clone()).map_err(|e| e.msg.clone()), exp),
        }
    }
}

#[test]
fn conditions_and_actions() {
    let c = cases();
    for x in c["prefs"].as_array().unwrap() {
        let p = &x["prefs"];
        assert_eq!(build_conditions(p), s(&x["cond"]), "cond {p}");
        assert_eq!(conditions_summary(p), s(&x["sum"]), "sum {p}");
        assert_eq!(count_of(p), x["count"].as_i64().unwrap());
        for a in x["actions"].as_array().unwrap() {
            let got = action_request(a[0].as_str().unwrap(), p, &a[1]);
            let exp = &a[2];
            match got {
                None => assert!(exp.is_null(), "{} {p}", a[0]),
                Some((l, t)) => { assert_eq!(l, s(&exp["label"]), "label {} {p}", a[0]); assert_eq!(t, s(&exp["text"]), "text {} {p}", a[0]); }
            }
        }
    }
}

#[test]
fn ranges_and_whisper() {
    let c = cases();
    let w = words(&c);
    let r = &c["ranges"];
    let rg: Vec<Range> = r["ranges"].as_array().unwrap().iter().map(|x| Range { from: x["from"].as_u64().unwrap() as usize, to: x["to"].as_u64().unwrap() as usize }).collect();
    assert!(near(ranges_duration(&rg, &w), &r["dur"]));
    let d = describe_ranges(&rg, &w);
    for (a, b) in d.iter().zip(r["desc"].as_array().unwrap()) { assert_eq!(a.2, s(&b["text"])); }
    assert_eq!(json!(questions_in(&rg, &w)), r["qs"]);
    let (ww, wl) = whisper_words_to_lines(c["whisper"]["raw"].as_array().unwrap());
    let ew = c["whisper"]["out"]["words"].as_array().unwrap();
    assert_eq!(ww.len(), ew.len());
    for (a, b) in ww.iter().zip(ew) { assert_eq!(a.text, s(&b["text"])); assert!(near(a.start, &b["start"]) && near(a.end, &b["end"])); }
    let el = c["whisper"]["out"]["lines"].as_array().unwrap();
    assert_eq!(json!(wl.iter().map(|l| json!([l.from, l.to])).collect::<Vec<_>>()), json!(el.iter().map(|l| json!([l["from"], l["to"]])).collect::<Vec<_>>()));
}
