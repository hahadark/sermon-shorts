//! 대화형 AI 편집의 순수 함수 (기존 src/shared/chat-plan.js). 지금은 유튜브 자동 자막(json3) → 단어 목록만.
use serde_json::Value;

/// 설교 말 속도: 한 글자(음절)에 걸리는 대략 시간(초)
pub const SYL: f64 = 0.17;

pub fn syllables(t: &str) -> usize {
    let n = t.chars().filter(|&c| ('\u{AC00}'..='\u{D7A3}').contains(&c) || c.is_ascii_alphanumeric()).count();
    n.max(1)
}

#[derive(Clone, Debug, PartialEq)]
pub struct SubWord { pub text: String, pub start: f64, pub end: f64 }
#[derive(Clone, Debug, PartialEq)]
pub struct SubLine { pub start: f64, pub from: usize, pub to: usize }

fn js_space(c: char) -> bool { c.is_whitespace() || c == '\u{feff}' }
fn num(v: &Value) -> f64 { v.as_f64().filter(|x| *x != 0.0).unwrap_or(0.0) }

/// json3 → (단어, 줄). 시간은 원본 영상 기준 초
pub fn words_from_json3(data: &Value) -> (Vec<SubWord>, Vec<SubLine>) {
    let mut words: Vec<(SubWord, f64)> = vec![];
    let mut lines = vec![];
    for ev in data["events"].as_array().into_iter().flatten() {
        let Some(segs) = ev["segs"].as_array() else { continue };
        let t0 = num(&ev["tStartMs"]) / 1000.0;
        let ev_end = t0 + num(&ev["dDurationMs"]) / 1000.0;
        let from = words.len();
        for s in segs {
            let raw = match &s["utf8"] { Value::String(x) => x.clone(), Value::Null => String::new(), v => v.to_string() };
            let text = raw.split(js_space).filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ");
            if text.is_empty() { continue; }
            let st = t0 + num(&s["tOffsetMs"]) / 1000.0;
            let mut q = 0.0;
            for p in text.split(' ') {
                if p.is_empty() || p == ">>" { continue; }
                words.push((SubWord { text: p.to_string(), start: st + q * 0.05, end: 0.0 }, ev_end));
                q += 1.0;
            }
        }
        if words.len() > from { lines.push(SubLine { start: words[from].0.start, from, to: words.len() - 1 }); }
    }
    // 단어 끝: 다음 단어 시작 전, 글자 수로 어림한 길이만큼
    let n = words.len();
    for i in 0..n {
        let next = if i + 1 < n { words[i + 1].0.start } else { words[i].1 };
        let ev_end = words[i].1;
        let w = &mut words[i].0;
        let est = w.start + syllables(&w.text) as f64 * SYL + 0.08;
        w.end = (w.start + 0.12).max((next - 0.02).min(est).min(ev_end.max(w.start + 0.12)));
        if w.end <= w.start { w.end = w.start + 0.12; }
    }
    (words.into_iter().map(|x| x.0).collect(), lines)
}
