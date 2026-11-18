//! 단어별 시작·끝 고치기 (word_trim) → 편집 결과 구간(edl::build_segments)이 기대대로 바뀌는지
use sermon_shorts::{edl, model::{EditSettings, Overrides, Word}, word_trim};

fn w(id: i64, text: &str, start: f64, end: f64, del: bool) -> Word { Word { id, text: text.into(), start, end, del, ..Default::default() } }
fn st() -> EditSettings { EditSettings { pad_before: 0.1, pad_after: 0.15, ..Default::default() } }
fn segs(ws: &[Word], ov: &Overrides) -> Vec<(f64, f64)> { edl::build_segments(ws, &st(), ov, Some(100.0), None).iter().map(|s| (s.start, s.end)).collect() }
fn near(a: f64, b: f64) -> bool { (a - b).abs() < 1e-9 }
fn same(a: &[(f64, f64)], b: &[(f64, f64)]) -> bool { a.len() == b.len() && a.iter().zip(b).all(|(x, y)| near(x.0, y.0) && near(x.1, y.1)) }

/// 남김 [1.0,1.5] · 지움 [1.5,2.0] · 남김 [2.0,2.5]
fn three() -> Vec<Word> { vec![w(0, "가", 1.0, 1.5, false), w(1, "음", 1.5, 2.0, true), w(2, "나", 2.0, 2.5, false)] }

#[test]
fn baseline_pads_into_deleted_word() {
    let ws = three();
    // 원래는 여유 때문에 지운 말 앞 0.15초·뒤 0.1초가 남는다
    assert!(same(&segs(&ws, &Overrides::new()), &[(0.9, 1.65), (1.9, 2.65)]));
}

#[test]
fn deleted_word_start_earlier_cuts_previous_segment() {
    let (mut ws, mut ov) = (three(), Overrides::new());
    // 지운 말이 실제로는 1.3초에 시작: 앞 단어 끝을 밀고, 앞 구간은 지운 말 시작에서 끝난다
    let v = word_trim::set_edge(&mut ws, &mut ov, &st(), 1, 'S', 1.3);
    assert!(near(v, 1.3));
    assert!(near(ws[1].start, 1.3) && near(ws[0].end, 1.3), "겹치지 않게 앞 단어 끝을 밀어야 함");
    assert!(same(&segs(&ws, &ov), &[(0.9, 1.3), (1.9, 2.65)]), "{:?}", segs(&ws, &ov));
    // 인식 원래 값은 남아 있다
    assert_eq!(word_trim::original(&ws[1]), (1.5, 2.0));
    assert_eq!(word_trim::original(&ws[0]), (1.0, 1.5));
    assert!(word_trim::edited(&ws[0]) && word_trim::edited(&ws[1]) && !word_trim::edited(&ws[2]));
}

#[test]
fn deleted_word_end_later_moves_next_segment_start() {
    let (mut ws, mut ov) = (three(), Overrides::new());
    word_trim::set_edge(&mut ws, &mut ov, &st(), 1, 'E', 2.2);
    assert!(near(ws[2].start, 2.2));
    assert!(same(&segs(&ws, &ov), &[(0.9, 1.65), (2.2, 2.65)]), "{:?}", segs(&ws, &ov));
    // 다시 조금 앞으로 (끄는 중처럼 여러 번): 구간이 따라온다
    word_trim::set_edge(&mut ws, &mut ov, &st(), 1, 'E', 2.1);
    assert!(near(ws[1].end, 2.1) && near(ws[2].start, 2.2), "이웃은 밀기만 하고 당기지 않음");
    assert!(same(&segs(&ws, &ov), &[(0.9, 1.65), (2.1, 2.65)]), "{:?}", segs(&ws, &ov));
}

#[test]
fn kept_word_end_later_is_not_cut_and_stops_at_deleted_word() {
    let (mut ws, mut ov) = (three(), Overrides::new());
    // 남긴 말 끝이 잘림: 끝을 1.7초로 늘리면 지운 말 시작을 밀고, 구간은 정확히 1.7초까지
    word_trim::set_edge(&mut ws, &mut ov, &st(), 0, 'E', 1.7);
    assert!(near(ws[0].end, 1.7) && near(ws[1].start, 1.7));
    assert!(same(&segs(&ws, &ov), &[(0.9, 1.7), (1.9, 2.65)]), "{:?}", segs(&ws, &ov));
    // 남긴 말 시작이 잘림: 다음 남긴 말 시작을 1.8초로 당기면 지운 말 끝을 밀고 구간도 1.8초부터
    word_trim::set_edge(&mut ws, &mut ov, &st(), 2, 'S', 1.8);
    assert!(near(ws[1].end, 1.8));
    assert!(same(&segs(&ws, &ov), &[(0.9, 1.7), (1.8, 2.65)]), "{:?}", segs(&ws, &ov));
}

#[test]
fn gap_before_deleted_word_keeps_pad() {
    // 남김 [1.0,1.2] · (쉼) · 지움 [1.6,2.0]: 끝을 1.3초로 옮겨도 여유 0.15초가 지운 말에 닿지 않으면 미세 조정 값 없이 따라온다
    let mut ws = vec![w(0, "가", 1.0, 1.2, false), w(1, "음", 1.6, 2.0, true)];
    let mut ov = Overrides::new();
    word_trim::set_edge(&mut ws, &mut ov, &st(), 0, 'E', 1.3);
    assert!(ov.is_empty(), "{ov:?}");
    assert!(same(&segs(&ws, &ov), &[(0.9, 1.45)]));
    // 1.55초까지 늘리면 여유가 지운 말(1.6초)에서 멈춘다
    word_trim::set_edge(&mut ws, &mut ov, &st(), 0, 'E', 1.55);
    assert!(same(&segs(&ws, &ov), &[(0.9, 1.6)]), "{:?}", segs(&ws, &ov));
}

#[test]
fn joined_kept_words_keep_one_segment() {
    let mut ws = vec![w(0, "가", 1.0, 1.5, false), w(1, "나", 1.5, 2.0, false)];
    let mut ov = Overrides::new();
    word_trim::set_edge(&mut ws, &mut ov, &st(), 0, 'E', 1.3);
    assert!(near(ws[1].start, 1.5), "벌어지는 쪽은 이웃을 당기지 않음");
    assert!(ov.is_empty());
    assert!(same(&segs(&ws, &ov), &[(0.9, 2.15)]));
    // 맨 끝 단어 끝을 늘리면 구간 끝도 따라간다
    word_trim::set_edge(&mut ws, &mut ov, &st(), 1, 'E', 2.4);
    assert!(same(&segs(&ws, &ov), &[(0.9, 2.55)]));
}

#[test]
fn cut_between_kept_words_moves_existing_override() {
    // 공백 컷: 미세 조정 값이 있으면 단어가 움직인 만큼 같이 옮긴다
    let mut ws = vec![w(0, "가", 1.0, 1.5, false), w(1, "나", 2.0, 2.5, false)];
    ws[1].cut_before = true;
    let mut ov = Overrides::new();
    ov.insert("e:0".into(), 1.6); ov.insert("s:1".into(), 1.9);
    assert!(same(&segs(&ws, &ov), &[(0.9, 1.6), (1.9, 2.65)]));
    word_trim::set_edge(&mut ws, &mut ov, &st(), 0, 'E', 1.4);
    assert!(near(ov["e:0"], 1.5));
    word_trim::set_edge(&mut ws, &mut ov, &st(), 1, 'S', 2.1);
    assert!(near(ov["s:1"], 2.0));
    assert!(same(&segs(&ws, &ov), &[(0.9, 1.5), (2.0, 2.65)]), "{:?}", segs(&ws, &ov));
}

#[test]
fn limits_no_overlap_and_min_length() {
    let (mut ws, mut ov) = (three(), Overrides::new());
    // 시작을 끝 뒤로: 끝 - 0.02 까지만
    let v = word_trim::set_edge(&mut ws, &mut ov, &st(), 1, 'S', 5.0);
    assert!(near(v, 2.0 - word_trim::MIN_LEN));
    // 시작을 앞 단어 시작 앞으로: 앞 단어가 0.02초는 남게
    let v = word_trim::set_edge(&mut ws, &mut ov, &st(), 1, 'S', 0.0);
    assert!(near(v, 1.0 + word_trim::MIN_LEN) && near(ws[0].end, v));
    // 어느 단어도 겹치지 않음
    for k in 1..ws.len() { assert!(ws[k - 1].end <= ws[k].start + 1e-12); }
    // 맨 앞 단어 시작은 0 아래로 가지 않음
    let v = word_trim::set_edge(&mut ws, &mut ov, &st(), 0, 'S', -3.0);
    assert!(near(v, 0.0));
}

#[test]
fn reset_restores_words_and_cut() {
    let (mut ws, mut ov) = (three(), Overrides::new());
    let before = segs(&ws, &ov);
    word_trim::set_edge(&mut ws, &mut ov, &st(), 1, 'S', 1.3);
    word_trim::set_edge(&mut ws, &mut ov, &st(), 1, 'E', 2.2);
    assert!(!same(&segs(&ws, &ov), &before));
    word_trim::reset(&mut ws, &mut ov, &st(), 1);
    word_trim::reset(&mut ws, &mut ov, &st(), 0);
    word_trim::reset(&mut ws, &mut ov, &st(), 2);
    assert!(ws.iter().all(|w| !word_trim::edited(w) && !w.extra.contains_key("sttStart")), "{ws:?}");
    assert!(ov.is_empty(), "{ov:?}");
    assert!(same(&segs(&ws, &ov), &before));
}

#[test]
fn edited_times_survive_json_roundtrip() {
    // 프로젝트 파일(JSON)에 고친 시각과 인식 원래 값이 그대로 (Electron 판은 모르는 단어 필드를 보존)
    let (mut ws, mut ov) = (three(), Overrides::new());
    word_trim::set_edge(&mut ws, &mut ov, &st(), 1, 'S', 1.3);
    let j = serde_json::to_string(&ws).unwrap();
    let back: Vec<Word> = serde_json::from_str(&j).unwrap();
    assert!(near(back[1].start, 1.3) && near(back[0].end, 1.3));
    assert_eq!(word_trim::original(&back[1]), (1.5, 2.0));
    assert!(j.contains("\"sttStart\":1.5"));
    // 미세 조정 값 키는 Electron 이 읽는 모양("s:"/"e:" + 숫자)만
    assert!(ov.keys().all(|k| (k.starts_with("s:") || k.starts_with("e:")) && k[2..].parse::<i64>().is_ok()));
}
