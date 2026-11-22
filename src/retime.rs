//! 정밀 인식: 유튜브 자막으로 정한 편집(남길 말·지울 말·컷)을 위스퍼(맥은 맥 받아쓰기)가 다시 받아 적은 단어로 옮긴다.
//!
//! 유튜브 자동 자막은 단어 시작 시각만 있고 소리보다 밀려 있기 쉽다. 그래서 AI 가 구간을 고른 뒤
//! 받아 온 영상 부분만 다시 음성 인식해서, 단어 글자·시각은 인식 결과를 쓰고 남김·지움·컷·줄 바꿈은 유튜브 자막 편집을 따른다.
//!
//! 짝 맞추기: 두 쪽 글자(한글 음절·영문·숫자)를 차례대로 맞춰 (편집 거리 정렬) 인식 단어마다 가장 많이 겹친 자막 단어를 찾는다.
//! 짝이 없는 인식 단어(자막이 빠뜨린 말)는 시간이 가까운 이웃을 따른다. 맨 앞·맨 뒤에서 한쪽 이웃만 있으면 지운 말로 둔다.

/// 유튜브 자막 단어 (영상 파일 시각)
#[derive(Clone, Debug, Default)]
pub struct SubW {
    pub text: String,
    pub start: f64,
    pub end: f64,
    /// 남길 말인가
    pub kept: bool,
    /// 앞에서 컷 (구간 시작·영상 조각이 바뀌는 곳)
    pub cut_before: bool,
    /// 줄 바꿈 (손 자막의 줄 끝)
    pub br: bool,
    /// AI 가 고친 글자
    pub corr: Option<String>,
}

/// 음성 인식 단어 (영상 파일 시각)
#[derive(Clone, Debug, Default)]
pub struct SttW { pub text: String, pub start: f64, pub end: f64, pub score: f64 }

/// 옮긴 결과 단어
#[derive(Clone, Debug, PartialEq)]
pub struct OutW { pub text: String, pub stt_text: String, pub start: f64, pub end: f64, pub score: f64, pub del: bool, pub cut_before: bool, pub br: bool }

#[derive(Clone, Debug)]
pub struct Merged {
    pub words: Vec<OutW>,
    /// 자막 글자 중 인식 글자와 맞은 비율 (0~1)
    pub matched: f64,
}

/// 정렬에 쓰는 글자: 한글 음절·영문(소문자)·숫자
fn chars_of(s: &str) -> Vec<char> { s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect() }

/// 이보다 큰 정렬은 하지 않는다 (글자 수 곱). 받아 온 부분이 아주 길면 유튜브 자막 그대로 쓴다
pub const MAX_CELLS: usize = 60_000_000;

/// 유튜브 자막 편집 → 인식 단어. 짝이 너무 적거나 남길 구간이 통째로 사라지면 None (유튜브 자막 그대로 쓴다)
pub fn merge(sub: &[SubW], stt: &[SttW]) -> Option<Merged> {
    let stt: Vec<&SttW> = stt.iter().filter(|w| w.start.is_finite() && w.end.is_finite() && !w.text.trim().is_empty()).collect();
    if sub.is_empty() || stt.is_empty() { return None; }
    // 글자와 그 글자의 단어 번호
    let mut a: Vec<(char, usize)> = vec![];
    for (k, w) in sub.iter().enumerate() { for c in chars_of(&w.text) { a.push((c, k)); } }
    let mut b: Vec<(char, usize)> = vec![];
    for (k, w) in stt.iter().enumerate() { for c in chars_of(&w.text) { b.push((c, k)); } }
    let (n, m) = (a.len(), b.len());
    if n == 0 || m == 0 || (n + 1) * (m + 1) > MAX_CELLS { return None; }
    // 편집 거리 정렬 (같음 0, 다름 1, 빠짐 1). 방향: 0 대각, 1 위(a 만), 2 왼쪽(b 만)
    let w = m + 1;
    let mut dir = vec![0u8; (n + 1) * w];
    let mut prev: Vec<u32> = (0..=m as u32).collect();
    let mut cur = vec![0u32; m + 1];
    for j in 1..=m { dir[j] = 2; }
    for i in 1..=n {
        cur[0] = i as u32; dir[i * w] = 1;
        for j in 1..=m {
            let d = prev[j - 1] + if a[i - 1].0 == b[j - 1].0 { 0 } else { 1 };
            let u = prev[j] + 1;
            let l = cur[j - 1] + 1;
            let (v, t) = if d <= u && d <= l { (d, 0) } else if u <= l { (u, 1) } else { (l, 2) };
            cur[j] = v; dir[i * w + j] = t;
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    // 되짚기: 인식 단어마다 짝 자막 단어 (같은 글자 2, 다른 글자 1 점)
    let ns = stt.len();
    let mut votes: Vec<std::collections::HashMap<usize, u32>> = vec![Default::default(); ns];
    let mut same = 0usize;
    let mut same_of = vec![0usize; sub.len()];
    let (mut i, mut j) = (n, m);
    while i > 0 || j > 0 {
        let t = dir[i * w + j];
        if i > 0 && j > 0 && t == 0 {
            let eq = a[i - 1].0 == b[j - 1].0;
            if eq { same += 1; same_of[a[i - 1].1] += 1; }
            *votes[b[j - 1].1].entry(a[i - 1].1).or_default() += if eq { 2 } else { 1 };
            i -= 1; j -= 1;
        } else if i > 0 && (j == 0 || t == 1) { i -= 1; } else { j -= 1; }
    }
    let matched = same as f64 / n as f64;
    if matched < 0.5 { return None; }
    let owner: Vec<Option<usize>> = votes.iter().map(|v| v.iter().max_by(|x, y| x.1.cmp(y.1).then(y.0.cmp(x.0))).map(|(&k, _)| k)).collect();
    // 자막 단어 묶음 번호: 컷마다 하나씩 (같은 묶음 안에서는 컷을 새로 만들지 않는다)
    let mut group = vec![0usize; sub.len()];
    let mut g = 0;
    for (k, s) in sub.iter().enumerate() { if k > 0 && s.cut_before { g += 1; } group[k] = g; }
    // 짝 없는 인식 단어: 시간이 가까운 이웃의 짝을 빌린다 (한쪽 이웃만 있으면 지운 말)
    let mut eff: Vec<Option<usize>> = owner.clone();
    for k in 0..ns {
        if owner[k].is_some() { continue; }
        let p = (0..k).rev().find(|&x| owner[x].is_some());
        let q = (k + 1..ns).find(|&x| owner[x].is_some());
        eff[k] = match (p, q) {
            (Some(p), Some(q)) => {
                let (op, oq) = (owner[p].unwrap(), owner[q].unwrap());
                if sub[op].kept == sub[oq].kept && group[op] == group[oq] { Some(op) }
                else { let mid = (stt[k].start + stt[k].end) / 2.0; if mid - stt[p].end <= stt[q].start - mid { Some(op) } else { Some(oq) } }
            }
            _ => None,
        };
    }
    let mut out: Vec<OutW> = vec![];
    // 자막 단어마다 짝이 된 인식 단어 수 (1:1 이면 AI 가 고친 글자를 쓴다)
    let mut owners_of = vec![0usize; sub.len()];
    for o in owner.iter().flatten() { owners_of[*o] += 1; }
    let mut last_of = vec![None; sub.len()];
    for (k, o) in eff.iter().enumerate() { if let Some(o) = o { last_of[*o] = Some(k); } }
    let mut prev_group: Option<usize> = None;
    let mut prev_kept = false;
    for (k, s) in stt.iter().enumerate() {
        let o = eff[k];
        let kept = o.is_some_and(|o| sub[o].kept);
        let gk = o.map(|o| group[o]);
        let cut = kept && k > 0 && prev_kept && gk != prev_group;
        let only = o.is_some_and(|o| owner[k] == Some(o) && owners_of[o] == 1 && votes[k].len() == 1);
        let text = match o.and_then(|o| sub[o].corr.clone()) { Some(c) if only => c, _ => s.text.trim().to_string() };
        let br = o.is_some_and(|o| sub[o].br && last_of[o] == Some(k));
        out.push(OutW { text, stt_text: s.text.trim().to_string(), start: s.start, end: s.end.max(s.start + 0.02), score: s.score, del: !kept, cut_before: cut, br });
        prev_group = gk; prev_kept = kept;
    }
    // 남길 묶음마다 글자의 절반 넘게 알아들어야 한다 (인식이 그 부분을 놓쳤으면 믿지 않는다)
    let mut tot: std::collections::BTreeMap<usize, (usize, usize)> = Default::default();
    for (k, s) in sub.iter().enumerate() { if s.kept { let e = tot.entry(group[k]).or_default(); e.0 += chars_of(&s.text).len(); e.1 += same_of[k]; } }
    if tot.values().any(|&(c, ok)| c > 0 && (ok as f64) < c as f64 * 0.5) { return None; }
    Some(Merged { words: out, matched })
}
