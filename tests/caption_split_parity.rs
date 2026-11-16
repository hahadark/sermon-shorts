//! 자막 나누기·합치기가 Electron caption-edit.js 와 같은지 (tests/gen_caption_split.js)
use serde_json::{json, Value};
use sermon_shorts::{caption_edit, edl, model::{EditSettings, Overrides, Word}};

fn pick(ws: &[Word]) -> Value {
    Value::Array(ws.iter().map(|w| json!({ "id": w.id, "text": w.text, "br": w.br,
        "captionSplits": w.caption_splits.as_ref().map(|v| v.iter().map(|x| *x as i64).collect::<Vec<_>>()),
        "captionMerges": w.caption_merges.as_ref().map(|v| v.iter().map(|m| json!({ "startId": m.start_id, "startOffset": m.start_offset.map(|x| x as i64), "endId": m.end_id, "endOffset": m.end_offset.map(|x| x as i64) })).collect::<Vec<_>>()) })).collect())
}
fn norm(v: &Value) -> Value {
    // JS 쪽 null·숫자 모양 맞추기 (captionMerges 의 endOffset 없음 = null)
    let mut v = v.clone();
    if let Some(a) = v.as_array_mut() { for w in a { if let Some(ms) = w.get_mut("captionMerges").and_then(|m| m.as_array_mut()) { for m in ms { for k in ["startOffset", "endOffset"] { if m.get(k).is_none() { m[k] = Value::Null; } } } } } }
    v
}

#[test]
fn split_merge_match() {
    let f: Value = serde_json::from_str(&std::fs::read_to_string("tests/fixtures/caption_split_cases.json").unwrap()).unwrap();
    let raw: Value = serde_json::from_str(&std::fs::read_to_string("F:/aside/sermon-shorts-app/cache/theme_check/words_4955.json").unwrap()).unwrap();
    let arr = if raw.is_array() { raw } else { raw["words"].clone() };
    let mut words0: Vec<Word> = serde_json::from_value(arr).unwrap();
    for (i, w) in words0.iter_mut().enumerate() { w.id = i as i64; w.del = false; }
    let st = EditSettings { pad_before: 0.1, pad_after: 0.15, fade_ms: 10.0, max_line_chars: Some(14.0), split_long_words: true, semantic_breaks: true };
    let lines = |ws: &[Word]| edl::build_lines(ws, &edl::build_segments(ws, &st, &Overrides::default(), Some(156.0), None), &st);
    let l0 = lines(&words0);
    let mut n = 0;
    for c in f["cases"].as_array().unwrap() {
        let li = c["li"].as_u64().unwrap() as usize;
        if c["kind"] == "split" {
            let caret = c["caret"].as_u64().unwrap() as usize;
            let r = caption_edit::split(&words0, &l0[li], caret);
            assert_eq!(r.is_some(), c["ok"].as_bool().unwrap(), "split {li} @{caret} 됨/안됨");
            if let Some((ws, a)) = r {
                assert_eq!(norm(&pick(&ws)), norm(&c["words"]), "split {li} @{caret} 단어");
                assert_eq!((a.id, a.from as u64), (c["anchor"]["id"].as_i64().unwrap(), c["anchor"]["from"].as_u64().unwrap()), "split {li} @{caret} 자리");
            }
        } else {
            let r = caption_edit::merge(&words0, &l0[li - 1], &l0[li]);
            assert_eq!(r.is_some(), c["ok"].as_bool().unwrap(), "merge {li}");
            let Some((ws, text, caret, a)) = r else { continue };
            assert_eq!(norm(&pick(&ws)), norm(&c["words"]), "merge {li} 단어");
            assert_eq!(text, c["text"].as_str().unwrap()); assert_eq!(caret as u64, c["caret"].as_u64().unwrap());
            let l1 = lines(&ws);
            let merged = l1.iter().find(|l| l.parts.first().is_some_and(|p| p.id == a.id && p.from == a.from)).unwrap();
            assert_eq!(merged.text, c["mergedText"].as_str().unwrap(), "merge {li} 합친 줄");
            assert_eq!(merged.manual_merge, c["manual"].as_bool().unwrap(), "merge {li} 수동 병합 표시");
            let rs = caption_edit::split(&ws, merged, merged.text.chars().count() / 2).map(|(w, a)| json!({ "words": norm(&pick(&w)), "anchor": { "id": a.id, "from": a.from } }));
            let mut want = c["resplit"].clone(); if !want.is_null() { want["words"] = norm(&want["words"]); }
            assert_eq!(rs.unwrap_or(Value::Null), want, "merge {li} 다시 나누기");
            assert_eq!(norm(&pick(&caption_edit::unmerge(&ws, merged))), norm(&c["unmerged"]), "merge {li} 글자 수대로");
        }
        n += 1;
    }
    assert!(n > 100);
}
