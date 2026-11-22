//! 단어별 조정의 조각 도구 (나누기 · 지우기 · 공백 없애기) → 단어·미세 조정 값·구간·자막 줄이 기대대로 바뀌는지
use sermon_shorts::{blocks, edl, model::{CaptionMerge, EditSettings, Overrides, Word}, project::Project, word_trim};

fn w(id: i64, text: &str, start: f64, end: f64, del: bool) -> Word { Word { id, text: text.into(), start, end, del, stt_text: Some(text.into()), ..Default::default() } }
fn st() -> EditSettings { EditSettings { pad_before: 0.1, pad_after: 0.15, ..Default::default() } }
fn segs(ws: &[Word], ov: &Overrides) -> Vec<(f64, f64)> { edl::build_segments(ws, &st(), ov, Some(100.0), None).iter().map(|s| (s.start, s.end)).collect() }
fn near(a: f64, b: f64) -> bool { (a - b).abs() < 1e-9 }
fn same(a: &[(f64, f64)], b: &[(f64, f64)]) -> bool { a.len() == b.len() && a.iter().zip(b).all(|(x, y)| near(x.0, y.0) && near(x.1, y.1)) }

/// 가 [1.0,1.5] · 그래서 [1.5,3.0] (앞 0.9초는 실제로는 잡음) · 나 [3.0,3.5] · 다 [4.2,4.7]
fn four() -> Vec<Word> { vec![w(0, "가", 1.0, 1.5, false), w(1, "그래서", 1.5, 3.0, false), w(2, "나", 3.0, 3.5, false), w(3, "다", 4.2, 4.7, false)] }

#[test]
fn split_makes_blank_piece_and_renumbers() {
    let mut ws = four();
    ws[1].br = true;
    ws[3].caption_merges = Some(vec![CaptionMerge { start_id: 2, start_offset: None, end_id: 3, end_offset: None }]);
    let mut ov = Overrides::new();
    ov.insert("s:1".into(), 1.45); ov.insert("e:1".into(), 3.05); ov.insert("s:3".into(), 4.0); ov.insert("e:2".into(), 3.6);
    let mut order = Some(vec![2i64, 0]);
    // 2.4초에서 나눔, 글자는 뒤 조각에
    let map = word_trim::split(&mut ws, &mut ov, &mut order, 1, 2.4, false).expect("나누기");
    assert_eq!(ws.len(), 5);
    assert_eq!(ws.iter().map(|x| x.id).collect::<Vec<_>>(), vec![0, 1, 2, 3, 4], "번호는 0부터 차례로");
    assert!(word_trim::blank(&ws[1]) && ws[1].stt_text.as_deref() == Some("") && near(ws[1].start, 1.5) && near(ws[1].end, 2.4));
    assert!(ws[2].text == "그래서" && near(ws[2].start, 2.4) && near(ws[2].end, 3.0));
    assert!(!ws[1].br && ws[2].br, "줄 바꿈 표시는 뒤 조각으로");
    assert_eq!(map.get(&2), Some(&3)); assert_eq!(map.get(&3), Some(&4)); assert_eq!(map.get(&1), Some(&1));
    // 미세 조정 값: 시작은 앞 조각, 끝은 뒤 조각, 뒤 단어들은 번호가 하나씩 밀림
    assert_eq!(ov.get("s:1"), Some(&1.45)); assert_eq!(ov.get("e:2"), Some(&3.05)); assert_eq!(ov.get("e:3"), Some(&3.6)); assert_eq!(ov.get("s:4"), Some(&4.0));
    assert_eq!(ov.len(), 4);
    assert_eq!(order, Some(vec![3, 0]));
    let m = &ws[4].caption_merges.as_ref().unwrap()[0];
    assert_eq!((m.start_id, m.end_id), (3, 4));
    // 나눈 것만으로는 편집 결과 구간이 달라지지 않는다
    let (a, b) = (four(), Overrides::new());
    let mut ws2 = four(); let mut ov2 = Overrides::new(); let mut o2 = None;
    word_trim::split(&mut ws2, &mut ov2, &mut o2, 1, 2.4, true).unwrap();
    assert!(same(&segs(&ws2, &ov2), &segs(&a, &b)));
    assert!(ws2[1].text == "그래서" && word_trim::blank(&ws2[2]));
}

#[test]
fn split_rejects_edges_and_keeps_stt_memo() {
    let (mut ws, mut ov, mut order) = (four(), Overrides::new(), None);
    assert!(word_trim::split(&mut ws, &mut ov, &mut order, 1, 1.5, true).is_none());
    assert!(word_trim::split(&mut ws, &mut ov, &mut order, 1, 3.0, true).is_none());
    assert!(word_trim::split(&mut ws, &mut ov, &mut order, 9, 2.0, true).is_none());
    assert_eq!(ws.len(), 4);
    // 손으로 고친 단어: 시작 기록은 앞 조각, 끝 기록은 뒤 조각에 남는다
    word_trim::set_edge(&mut ws, &mut ov, &st(), 3, 'S', 4.0);
    word_trim::set_edge(&mut ws, &mut ov, &st(), 3, 'E', 4.9);
    word_trim::split(&mut ws, &mut ov, &mut order, 3, 4.5, true).unwrap();
    assert_eq!(word_trim::original(&ws[3]), (4.2, 4.5));
    assert_eq!(word_trim::original(&ws[4]), (4.5, 4.7));
    assert!(word_trim::edited(&ws[3]) && word_trim::edited(&ws[4]));
}

#[test]
fn deleting_blank_piece_cuts_exactly_at_split() {
    let (mut ws, mut ov, mut order) = (four(), Overrides::new(), None);
    word_trim::split(&mut ws, &mut ov, &mut order, 1, 2.4, false).unwrap();
    // 빈 조각 [1.5,2.4] 을 지운다: 앞 말은 1.5 에서 끝나고 뒤 말은 2.4 에서 시작 (여유가 지운 소리 안으로 새지 않음)
    word_trim::set_del(&mut ws, &mut ov, &st(), 1, true);
    assert!(same(&segs(&ws, &ov), &[(0.9, 1.5), (2.4, 4.85)]), "{:?}", segs(&ws, &ov));
    // 자막에는 글자 있는 조각만
    let sg = edl::build_segments(&ws, &st(), &ov, Some(100.0), None);
    let lines = edl::build_lines(&ws, &sg, &st());
    let text: Vec<String> = lines.iter().map(|l| l.text.clone()).collect();
    assert_eq!(text.join(" "), "가 그래서 나 다");
    // 되살리면 처음 구간으로
    word_trim::set_del(&mut ws, &mut ov, &st(), 1, false);
    assert!(ov.is_empty(), "{ov:?}");
    assert!(same(&segs(&ws, &ov), &segs(&four(), &Overrides::new())));
}

#[test]
fn kept_blank_piece_stays_in_caption_block() {
    let (mut ws, mut ov, mut order) = (four(), Overrides::new(), None);
    // 마지막 단어 '다' 를 나눠 뒤쪽을 빈 조각으로: 남겨 두면 소리는 나오고 자막 칸에 같이 묶인다
    word_trim::split(&mut ws, &mut ov, &mut order, 3, 4.5, true).unwrap();
    let sg = edl::build_segments(&ws, &st(), &ov, Some(100.0), None);
    let lines = edl::build_lines(&ws, &sg, &st());
    let bl = blocks::build(&ws, &lines, 14);
    assert!(bl.iter().all(|b| b.line.is_some()), "빈 조각만 든 칸이 따로 생기면 안 됨: {bl:?}");
    assert_eq!(bl.last().unwrap().to, 5);
    assert!(near(edl::segments_duration(&sg), edl::segments_duration(&edl::build_segments(&four(), &st(), &Overrides::new(), Some(100.0), None))));
}

#[test]
fn cut_gap_between_kept_words() {
    let (mut ws, mut ov) = (four(), Overrides::new());
    // 나 [3.0,3.5] 와 다 [4.2,4.7] 사이 0.7초: 양끝 0.03초만 남기고 자른다
    assert!(word_trim::cut_gap(&mut ws, &mut ov, 2, 3, 0.1));
    assert!(ws[3].cut_before && ws[3].extra.get("gapCut").and_then(|v| v.as_bool()) == Some(true));
    assert!(same(&segs(&ws, &ov), &[(0.9, 3.53), (4.17, 4.85)]), "{:?}", segs(&ws, &ov));
    // 한 번 더 누르면 바뀌는 것이 없다
    assert!(!word_trim::cut_gap(&mut ws, &mut ov, 2, 3, 0.1));
    // 붙어 있는 단어 사이·너무 짧은 공백은 그대로
    assert!(!word_trim::cut_gap(&mut ws, &mut ov, 0, 1, 0.1));
    ws[1].end = 2.95;
    assert!(!word_trim::cut_gap(&mut ws, &mut ov, 1, 2, 0.1), "0.05초는 '모두' 에서는 안 자름");
    assert!(word_trim::cut_gap(&mut ws, &mut ov, 1, 2, 0.0), "한 곳을 골라 누르면 자름");
    assert!(near(ov["e:1"], 2.9625) && near(ov["s:2"], 2.9875), "{ov:?}");
    // 단어 끝을 옮기면 컷도 같이 따라간다
    let e = ov["e:2"];
    word_trim::set_edge(&mut ws, &mut ov, &st(), 2, 'E', 3.4);
    assert!(near(ov["e:2"], e - 0.1));
}

#[test]
fn cut_gap_next_to_deleted_word_and_save_reload() {
    let (mut ws, mut ov, mut order) = (four(), Overrides::new(), None);
    ws[2].del = true;
    ws[2].start = 3.2;   // 그래서 [1.5,3.0] · (공백 0.2) · 지운 '나' [3.2,3.5] · (공백 0.7) · 다
    assert!(same(&segs(&ws, &ov), &[(0.9, 3.15), (4.1, 4.85)]));
    assert!(word_trim::cut_gap(&mut ws, &mut ov, 1, 2, 0.1));
    assert!(word_trim::cut_gap(&mut ws, &mut ov, 2, 3, 0.1));
    assert!(!ws[3].cut_before, "지운 말 옆은 컷 표시를 새로 만들지 않는다");
    assert!(same(&segs(&ws, &ov), &[(0.9, 3.03), (4.17, 4.85)]), "{:?}", segs(&ws, &ov));
    // 나눈 뒤 저장 → 다시 열기: 단어·미세 조정 값·구간이 같다
    word_trim::split(&mut ws, &mut ov, &mut order, 1, 2.4, false).unwrap();
    word_trim::set_del(&mut ws, &mut ov, &st(), 1, true);
    let p = Project { source_path: "x.mp4".into(), words: ws.clone(), overrides: ov.clone(), order: None, settings: st(), ..Default::default() };
    let p2 = Project::from_json(p.to_json()).expect("다시 열기");
    assert_eq!(p2.words.len(), 5);
    assert_eq!(p2.overrides, ov);
    assert!(word_trim::blank(&p2.words[1]) && p2.words[1].del);
    assert!(same(&segs(&p2.words, &p2.overrides), &segs(&ws, &ov)));
}
