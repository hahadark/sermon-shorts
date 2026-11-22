//! 정밀 인식: 유튜브 자막 편집(남김·지움·컷)을 인식 단어로 옮기기
use sermon_shorts::retime::{merge, SttW, SubW};

fn sub(text: &str, start: f64, kept: bool, cut: bool) -> SubW { SubW { text: text.into(), start, end: start + 0.4, kept, cut_before: cut, ..Default::default() } }
fn stt(text: &str, start: f64, end: f64) -> SttW { SttW { text: text.into(), start, end, score: 0.9 } }
fn texts(m: &sermon_shorts::retime::Merged) -> Vec<String> { m.words.iter().map(|w| format!("{}{}{}", if w.cut_before { "|" } else { "" }, if w.del { "-" } else { "" }, w.text)).collect() }

#[test]
fn keeps_edit_and_uses_recognized_times() {
    // 유튜브: "그래서 우리는 | 하나님을 사랑 합니다 아멘" 중 "우리는 하나님을 사랑 합니다" 를 남김 (시각은 0.3초쯤 밀림)
    let s = vec![sub("그래서", 1.3, false, false), sub("우리는", 1.8, true, true), sub("하나님을", 2.4, true, false), sub("사랑", 3.1, true, false), sub("합니다", 3.5, true, false), sub("아멘", 4.4, false, false)];
    // 인식: 띄어쓰기가 다르고 (사랑합니다 한 단어) 시각이 정확함
    let r = vec![stt("그래서", 1.0, 1.42), stt("우리는", 1.5, 1.95), stt("하나님을", 2.05, 2.7), stt("사랑합니다.", 2.8, 3.6), stt("아멘", 4.1, 4.4)];
    let m = merge(&s, &r).expect("짝 맞추기");
    assert_eq!(texts(&m), vec!["-그래서", "우리는", "하나님을", "사랑합니다.", "-아멘"]);
    assert!(m.matched > 0.99);
    assert_eq!((m.words[1].start, m.words[3].end), (1.5, 3.6), "시각은 인식 결과");
}

#[test]
fn fixes_misheard_subtitle_and_keeps_cut_between_ranges() {
    // 유튜브 자막이 잘못 받아 적음 (하나님의 → 하나 님에), 두 구간이 바로 붙어 있음 (컷)
    let s = vec![sub("주님의", 1.0, true, true), sub("하나", 1.5, true, false), sub("님에", 1.8, true, false), sub("나라", 2.2, true, false), sub("임하시고", 2.6, true, true), sub("뜻이", 3.2, true, false)];
    let r = vec![stt("주님의", 1.0, 1.4), stt("하나님의", 1.45, 2.0), stt("나라", 2.05, 2.4), stt("임하시고", 2.5, 3.1), stt("뜻이", 3.15, 3.5)];
    let m = merge(&s, &r).unwrap();
    assert_eq!(texts(&m), vec!["주님의", "하나님의", "나라", "|임하시고", "뜻이"]);
}

#[test]
fn unmatched_words_follow_nearest_side_and_edges_are_deleted() {
    // 유튜브가 빠뜨린 말 "음" 이 남길 구간 안에, "자" 가 맨 앞(구간 밖)에
    let s = vec![sub("오늘", 1.0, true, true), sub("말씀은", 1.5, true, false), sub("여기까지", 3.0, false, false)];
    let r = vec![stt("자", 0.2, 0.5), stt("오늘", 1.0, 1.4), stt("음", 1.45, 1.6), stt("말씀은", 1.65, 2.2), stt("여기까지", 3.0, 3.6)];
    let m = merge(&s, &r).unwrap();
    assert_eq!(texts(&m), vec!["-자", "오늘", "음", "말씀은", "-여기까지"]);
}

#[test]
fn applies_ai_correction_only_one_to_one_and_keeps_line_break() {
    let mut s = vec![sub("구세군", 1.0, true, true), sub("대구사랑", 1.6, true, false), sub("영문", 2.3, true, false)];
    s[0].corr = Some("구세군".into());
    s[2].corr = Some("영문입니다".into());
    s[1].br = true;
    // 인식이 "대구 사랑" 두 단어로: 1:1 이 아니라 AI 고침은 그 자리에 쓰지 않는다
    let r = vec![stt("구세군", 1.0, 1.5), stt("대구", 1.55, 1.9), stt("사랑", 1.9, 2.2), stt("영문", 2.25, 2.7)];
    let m = merge(&s, &r).unwrap();
    assert_eq!(texts(&m), vec!["구세군", "대구", "사랑", "영문입니다"]);
    assert_eq!(m.words.iter().map(|w| w.br).collect::<Vec<_>>(), vec![false, false, true, false], "줄 바꿈은 짝 단어들의 마지막에");
    assert_eq!(m.words[3].stt_text, "영문");
}

#[test]
fn refuses_when_recognition_is_unrelated_or_misses_a_kept_range() {
    let s = vec![sub("하나님은", 1.0, true, true), sub("사랑이십니다", 1.5, true, false), sub("아멘", 5.0, true, true), sub("할렐루야", 5.5, true, false)];
    // 다른 말
    assert!(merge(&s, &[stt("오늘은", 1.0, 1.4), stt("날씨가", 1.5, 2.0), stt("좋네요", 2.1, 2.6)]).is_none());
    // 뒤 구간을 통째로 못 알아들음 → 믿지 않음 (맞은 글자는 절반 넘어도)
    assert!(merge(&s, &[stt("하나님은", 1.0, 1.4), stt("사랑이십니다", 1.5, 2.3), stt("아", 5.0, 5.1)]).is_none());
    assert!(merge(&s, &[]).is_none());
}
