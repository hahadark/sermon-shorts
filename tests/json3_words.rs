//! 유튜브 json3 자막 → 단어 시각. 손으로 올린 자막(한 조각에 문장 통째, 낱말 시각 없음)은 자막 시간에 고르게 나눠야 한다.
//! (예전에는 0.05초 간격으로 앞에 몰려서 미리보기 자막이 말보다 먼저 나왔다 사라지고, 남긴 구간 끝 문장이 잘렸다)
use serde_json::json;
use sermon_shorts::chat_plan::words_from_json3;

#[test]
fn manual_captions_spread_over_event() {
    // 261115 추수감사주일예배 손 자막 앞부분 (구세군대구사랑교회)
    let j = json!({ "events": [
        { "tStartMs": 3887710, "dDurationMs": 3370, "segs": [{ "utf8": "이것을 보았을 때\n우리 믿음의 완성은" }] },
        { "tStartMs": 3891130, "dDurationMs": 4150, "segs": [{ "utf8": "감사가 아닐까 하는\n생각이 듭니다." }] },
        { "tStartMs": 3895330, "dDurationMs": 5590, "segs": [{ "utf8": "이들은 분명히\n믿음이 굉장히 큰 사람으로 보이지 않습니까?" }] }
    ]});
    let (w, l) = words_from_json3(&j);
    assert_eq!(w.len(), 6 + 5 + 8);
    assert_eq!(l.len(), 3);
    assert_eq!((l[0].from, l[0].to, l[1].from, l[1].to), (0, 5, 6, 10));
    // 첫 자막: 3887.71 ~ 3891.08 안에 고르게, 마지막 단어는 자막 끝 가까이
    assert!((w[0].start - 3887.71).abs() < 1e-9);
    assert!(w[5].start > 3889.5, "마지막 단어 '완성은' 이 자막 뒷부분에 있어야 함: {}", w[5].start);
    assert!(w[5].end > 3890.9 && w[5].end <= 3891.08, "'완성은' 끝: {}", w[5].end);
    // 단어는 차례대로, 겹치지 않고, 다음 자막 시작을 넘지 않음
    for i in 0..w.len() {
        assert!(w[i].end > w[i].start, "{i}");
        if i + 1 < w.len() { assert!(w[i].end <= w[i + 1].start + 1e-9, "{i} 겹침"); }
    }
    assert!(w[10].end <= 3895.33 + 1e-9);
    // 음절이 많은 단어가 더 길다
    assert!(w[4].end - w[4].start > w[2].end - w[2].start, "'믿음의'(3) > '때'(1)");
}

#[test]
fn manual_caption_longer_than_next_start_is_capped() {
    // 자막 길이가 다음 자막 시작을 넘으면 다음 자막 시작까지만
    let j = json!({ "events": [
        { "tStartMs": 1000, "dDurationMs": 9000, "segs": [{ "utf8": "하나 둘 셋 넷" }] },
        { "tStartMs": 3000, "dDurationMs": 1000, "segs": [{ "utf8": "다섯" }] }
    ]});
    let (w, _) = words_from_json3(&j);
    assert!(w[3].end <= 3.0 + 1e-9 && w[3].start > 2.0, "{:?}", w[3]);
    assert!((w[4].start - 3.0).abs() < 1e-9);
}

#[test]
fn auto_captions_unchanged() {
    // 자동 자막(ASR): 조각마다 낱말 하나 + tOffsetMs → 예전과 같은 시각
    let j = json!({ "events": [
        { "tStartMs": 10000, "dDurationMs": 4000, "wWinId": 1, "segs": [
            { "utf8": "여러분" }, { "utf8": " 감사" , "tOffsetMs": 480 }, { "utf8": " 합니다", "tOffsetMs": 900 } ] },
        { "tStartMs": 12000, "dDurationMs": 2000, "wWinId": 1, "aAppend": 1, "segs": [{ "utf8": "\n" }] },
        { "tStartMs": 12100, "dDurationMs": 3000, "wWinId": 1, "segs": [{ "utf8": "아멘" }] }
    ]});
    let (w, l) = words_from_json3(&j);
    let starts: Vec<f64> = w.iter().map(|x| x.start).collect();
    assert_eq!(starts, vec![10.0, 10.48, 10.9, 12.1]);
    // 끝: min(다음 단어 − 0.02, 음절×0.17 + 0.08)
    assert!((w[0].end - 10.46).abs() < 1e-9, "{}", w[0].end);   // 3음절 0.59 > 다음 0.46
    assert!((w[1].end - 10.88).abs() < 1e-9, "{}", w[1].end);   // 2음절 0.42 > 다음 0.40
    assert!((w[2].end - (10.9 + 3.0 * 0.17 + 0.08)).abs() < 1e-9, "{}", w[2].end);   // 마지막: 음절 어림 (다음 단어 12.1 보다 이름)
    assert_eq!(l.len(), 2);
}

#[test]
fn no_room_falls_back() {
    // 나눌 시간이 거의 없으면(길이 0) 예전처럼 0.05초 간격
    let j = json!({ "events": [ { "tStartMs": 5000, "segs": [{ "utf8": "가 나 다" }] } ]});
    let (w, _) = words_from_json3(&j);
    let starts: Vec<f64> = w.iter().map(|x| (x.start * 1000.0).round() / 1000.0).collect();
    assert_eq!(starts, vec![5.0, 5.05, 5.1]);
}

#[test]
fn manual_caption_breaks_follow_author_lines() {
    use sermon_shorts::chat_plan::json3_caption_breaks;
    let j = json!({ "events": [
        { "tStartMs": 3887710, "dDurationMs": 3370, "segs": [{ "utf8": "이것을 보았을 때\n우리 믿음의 완성은" }] },
        { "tStartMs": 3891130, "dDurationMs": 4150, "segs": [{ "utf8": "감사가 아닐까 하는\n생각이 듭니다." }] }
    ]});
    let b = json3_caption_breaks(&j);
    assert_eq!(b, vec![false, false, true, false, false, true, false, false, true, false, true]);
    // 자동 자막에는 줄 바꿈 표시가 없다
    let asr = json!({ "events": [ { "tStartMs": 0, "dDurationMs": 3000, "segs": [{ "utf8": "여러분" }, { "utf8": " 감사", "tOffsetMs": 400 }] } ]});
    assert_eq!(json3_caption_breaks(&asr), vec![false, false]);
}

#[test]
fn legacy_keeps_old_spacing() {
    use sermon_shorts::chat_plan::words_from_json3_legacy;
    let j = json!({ "events": [ { "tStartMs": 3887710, "dDurationMs": 3370, "segs": [{ "utf8": "이것을 보았을 때\n우리 믿음의 완성은" }] } ]});
    let (w, _) = words_from_json3_legacy(&j);
    let st: Vec<f64> = w.iter().map(|x| ((x.start - 3887.71) * 1000.0).round()).collect();
    assert_eq!(st, vec![0.0, 50.0, 100.0, 150.0, 200.0, 250.0]);
}
