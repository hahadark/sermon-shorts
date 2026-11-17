//! 자막 시각으로 보는 설교 전달 점검 (기존 src/shared/delivery.js). 실제 음성 판정이나 신학 평가는 하지 않는다. AI 호출 없음.
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct Bin { pub start: f64, pub end: f64, pub chars: f64, pub cpm: i64 }
#[derive(Clone, Debug, Serialize)]
pub struct Spot { pub start: f64, pub end: f64, pub seconds: f64, pub text: String }
#[derive(Clone, Debug, Serialize)]
pub struct Report { pub start: f64, pub end: f64, pub duration: f64, pub total_chars: usize, pub cpm: i64, pub word_count: usize, pub coverage: f64, pub bins: Vec<Bin>, pub pauses: Vec<Spot>, pub fillers: Vec<Spot>, pub repeats: Vec<Spot> }

fn ok_char(c: char) -> bool { ('가'..='힣').contains(&c) || c.is_ascii_alphanumeric() }
fn plain(s: &str) -> String { s.chars().filter(|c| ok_char(*c)).collect() }
fn chars(s: &str) -> usize { s.chars().filter(|c| ok_char(*c)).count() }
fn js_round(x: f64) -> f64 { (x + 0.5).floor() }

/// words: (글, 시작, 끝)
pub fn analyze(input: &[(String, f64, f64)]) -> Option<Report> {
    let mut words: Vec<(String, f64, f64)> = input.iter().filter(|w| w.1.is_finite() && w.2.is_finite() && w.1 >= 0.0 && w.2 > w.1 && !w.0.trim().is_empty()).cloned().collect();
    if words.is_empty() { return None; }
    words.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap().then(a.2.partial_cmp(&b.2).unwrap()));
    let start = words[0].1;
    let end = words.iter().fold(start, |m, w| m.max(w.2));
    let duration = end - start;
    let total_chars: usize = words.iter().map(|w| chars(&w.0)).sum();
    let mut bins: Vec<Bin> = vec![];
    let mut t = start;
    while t < end { bins.push(Bin { start: t, end: (t + 60.0).min(end), chars: 0.0, cpm: 0 }); t += 60.0; }
    let (mut pauses, mut fillers, mut repeats) = (vec![], vec![], vec![]);
    let (mut covered_end, mut covered) = (words[0].2, words[0].2 - start);
    let re_fill = regex::Regex::new(r"^(음+|으음+|어+|엄+|흠+|어음)$").unwrap();
    let re_short = regex::Regex::new(r"^(그|이|저|뭐)$").unwrap();
    let re_trail = regex::Regex::new(r"(…|\.\.\.|~)$").unwrap();
    for i in 0..words.len() {
        let (text, ws, we) = (&words[i].0, words[i].1, words[i].2);
        // 한 자막이 구간 경계를 넘으면 시간 비율로 나눈다
        let n = chars(text) as f64;
        let mut b = ((ws - start) / 60.0).floor().max(0.0) as usize;
        while b < bins.len() && bins[b].start < we {
            let over = (bins[b].end.min(we) - bins[b].start.max(ws)).max(0.0);
            bins[b].chars += n * over / (we - ws);
            b += 1;
        }
        let c = plain(text);
        if re_fill.is_match(&c) || (re_short.is_match(&c) && re_trail.is_match(text.trim())) { fillers.push(Spot { start: ws, end: we, seconds: 0.0, text: text.clone() }); }
        if i > 0 {
            let p = &words[i - 1];
            if c.chars().count() >= 2 && c == plain(&p.0) && ws - p.2 >= -0.1 && ws - p.2 <= 1.2 { repeats.push(Spot { start: p.1, end: we, seconds: 0.0, text: format!("{} {}", p.0, text) }); }
            if ws - covered_end >= 2.0 { pauses.push(Spot { start: covered_end, end: ws, seconds: ws - covered_end, text: format!("{} → {}", p.0, text) }); }
            covered += (we - ws.max(covered_end)).max(0.0);
            covered_end = covered_end.max(we);
        }
    }
    for b in bins.iter_mut() { b.chars = js_round(b.chars * 10.0) / 10.0; b.cpm = js_round(b.chars / ((b.end - b.start) / 60.0)) as i64; }
    Some(Report { start, end, duration, total_chars, cpm: js_round(total_chars as f64 / (duration / 60.0)) as i64, word_count: words.len(), coverage: (covered / duration).min(1.0), bins, pauses, fillers, repeats })
}

pub fn time(n: f64) -> String {
    let n = n.max(0.0).floor() as i64;
    format!("{}{:02}:{:02}", if n >= 3600 { format!("{}:", n / 3600) } else { String::new() }, (n / 60) % 60, n % 60)
}

/// 결과를 글로 (결과 복사)
pub fn to_text(r: Option<&Report>, label: &str) -> String {
    let Some(r) = r else { return "시간 정보가 있는 자막이 없습니다.".into() };
    let mut l: Vec<String> = vec!["설교 전달 점검".into(), label.into(), format!("분석 범위: {} ~ {}", time(r.start), time(r.end)), format!("평균: 분당 {}자 (한글 음절·영문 글자·숫자, 공백 제외)", r.cpm),
        format!("2초 이상 자막 사이 공백: {}곳", r.pauses.len()), format!("군더더기 말 후보: {}곳", r.fillers.len()), format!("연속 반복 후보: {}곳", r.repeats.len()), String::new(),
        "자동 자막 기준 참고 자료입니다. 공백은 실제 무음이 아닐 수 있고, 반복과 쉼은 강조·기도·회중 응답일 수 있습니다. 자막 누락·시각 오차가 결과에 영향을 줍니다.".into()];
    l.extend(r.bins.iter().map(|b| format!("{} ~ {}: 분당 {}자", time(b.start), time(b.end), b.cpm)));
    l.push(String::new());
    l.extend(r.pauses.iter().map(|p| format!("{} 공백 {:.1}초 · {}", time(p.start), p.seconds, p.text)));
    l.extend(r.fillers.iter().map(|p| format!("{} 군말 후보 · {}", time(p.start), p.text)));
    l.extend(r.repeats.iter().map(|p| format!("{} 반복 후보 · {}", time(p.start), p.text)));
    l.join("\n")
}
