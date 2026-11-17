//! 군말·공백 정리 (기존 src/shared/disfluency.js · src/shared/gaps.js · src/main/silence.js)
use crate::edl::Segment;
use crate::model::{Overrides, Word};
use regex::Regex;
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

fn filler_re() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new(r"^(음+|으+음*|으+|어+|아+|에+|엄+|흠+|어음|음음|으흠|에헴|저기|어어+|아아+|에에+|엉)$").unwrap()) }
fn drag_re() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| Regex::new(r"^(그|이|저|뭐)$").unwrap()) }

/// 문장부호·공백을 뺀 알맹이
pub fn core(text: &str) -> String {
    text.trim().chars().filter(|c| !(c.is_whitespace() || ".,?!~…·。？！、\"'”’「」『』()[]-".contains(*c))).collect()
}

/// 혼자 쓰인 '음, 어, 아…' ('그…'처럼 말을 끄는 것도)
pub fn is_filler(text: &str) -> bool {
    let raw = text.trim();
    let c = core(raw);
    if c.is_empty() { return false; }
    if filler_re().is_match(&c) { return true; }
    drag_re().is_match(&c) && (raw.ends_with("...") || raw.ends_with('…') || raw.ends_with('~'))
}

fn seg_ranges(words: &[Word], segs: &[Segment]) -> Vec<(usize, usize)> {
    let idx: HashMap<i64, usize> = words.iter().enumerate().map(|(i, w)| (w.id, i)).collect();
    segs.iter().filter_map(|s| Some((*idx.get(&s.first_word_id)?, *idx.get(&s.last_word_id)?))).collect()
}

#[derive(Clone, Debug, PartialEq)]
pub struct Pause { pub i: usize, pub prev: usize, pub gap: f64 }

/// 같은 구간 안에서 이웃한 남은 단어 사이 쉼 (min 초 이상)
pub fn pauses(words: &[Word], segs: &[Segment], min: f64) -> Vec<Pause> {
    let mut out = vec![];
    for (a, b) in seg_ranges(words, segs) {
        let mut prev: Option<usize> = None;
        for i in a..=b {
            let w = &words[i];
            if w.del || !w.timed() { continue; }
            if let Some(p) = prev { if i == p + 1 { let gap = w.start - words[p].end; if gap >= min { out.push(Pause { i, prev: p, gap }); } } }
            prev = Some(i);
        }
    }
    out
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct GapPlan { pub cut_before: Vec<usize>, pub overrides: Overrides, pub cuts: usize, pub saved_sec: f64 }

/// 단어 시각만으로 공백 자르기 계획 (소리 분석이 안 될 때)
pub fn gap_cuts_by_timing(words: &[Word], segs: &[Segment], min_gap: f64, pad_before: f64, pad_after: f64) -> GapPlan {
    let mut out = GapPlan::default();
    for p in pauses(words, segs, min_gap) {
        let (a, b) = (&words[p.prev], &words[p.i]);
        let (e0, s1) = (a.end + pad_after, b.start - pad_before);
        if s1 - e0 < 0.08 { continue; }
        out.cut_before.push(p.i);
        out.overrides.insert(format!("e:{}", a.id), e0);
        out.overrides.insert(format!("s:{}", b.id), s1);
        out.cuts += 1; out.saved_sec += s1 - e0;
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Silence { pub start: f64, pub end: f64 }

/// 실제 소리에서 찾은 무음을 지금 구간에 맞춰 자를 곳 정하기 (gaps.js planGapCuts)
pub fn plan_gap_cuts(words: &[Word], segs: &[Segment], silences: &[Silence], pad_before: f64, pad_after: f64, min_cut: f64) -> GapPlan {
    let mut out = GapPlan::default();
    let idx: HashMap<i64, usize> = words.iter().enumerate().map(|(i, w)| (w.id, i)).collect();
    let mut sil: Vec<Silence> = silences.iter().copied().filter(|s| s.start.is_finite() && s.end.is_finite() && s.end > s.start).collect();
    sil.sort_by(|a, b| a.start.total_cmp(&b.start));
    for sg in segs {
        let (Some(&a), Some(&b)) = (idx.get(&sg.first_word_id), idx.get(&sg.last_word_id)) else { continue };
        if !(sg.end > sg.start) { continue; }
        let kept: Vec<usize> = (a..=b).filter(|&j| !words[j].del && words[j].timed()).collect();
        if kept.is_empty() { continue; }
        // 무음 가운데가 몇 번째 단어 시작 앞인지 → 그 자리(k). 같은 자리에 여럿이면 가장 긴 것 (Map 넣은 순서 유지)
        let mut by_gap: Vec<(usize, Silence)> = vec![];
        for s in &sil {
            let (s0, s1) = (s.start.max(sg.start), s.end.min(sg.end));
            if !(s1 > s0) { continue; }
            let mid = (s0 + s1) / 2.0;
            let mut k = 0;
            while k < kept.len() && words[kept[k]].start < mid { k += 1; }
            if k == 0 { if s0 > sg.start + 0.01 { continue; } }
            else if k == kept.len() { if s1 < sg.end - 0.01 { continue; } }
            let item = Silence { start: s0, end: s1 };
            match by_gap.iter_mut().find(|(kk, _)| *kk == k) {
                Some((_, g)) => { if item.end - item.start > g.end - g.start { *g = item; } }
                None => by_gap.push((k, item)),
            }
        }
        let (mut new_start, mut new_end) = (sg.start, sg.end);
        for (k, s) in by_gap {
            if k == 0 {
                let ns = s.end - pad_before;
                if ns - new_start >= min_cut { out.saved_sec += ns - new_start; new_start = ns; out.cuts += 1; }
            } else if k == kept.len() {
                let ne = s.start + pad_after;
                if new_end - ne >= min_cut { out.saved_sec += new_end - ne; new_end = ne; out.cuts += 1; }
            } else {
                let (e0, s1) = (s.start + pad_after, s.end - pad_before);
                if s1 - e0 < min_cut { continue; }
                let (wa, wb) = (&words[kept[k - 1]], &words[kept[k]]);
                out.cut_before.push(kept[k]);
                out.overrides.insert(format!("e:{}", wa.id), e0);
                out.overrides.insert(format!("s:{}", wb.id), s1);
                out.saved_sec += s1 - e0;
                out.cuts += 1;
            }
        }
        if new_start != sg.start { out.overrides.insert(format!("s:{}", sg.first_word_id), new_start); }
        if new_end != sg.end { out.overrides.insert(format!("e:{}", sg.last_word_id), new_end); }
    }
    out.cut_before.sort();
    out
}

// ---------------------------------------------------------------- 소리에서 무음 찾기 (ffmpeg)

/// ffmpeg silencedetect 로그 → 무음들 (offset 만큼 더함, 끝나지 않은 무음은 duration 까지)
pub fn parse_silences(text: &str, offset: f64, duration: Option<f64>) -> Vec<Silence> {
    let re_s = Regex::new(r"silence_start:\s*(-?[\d.]+)").unwrap();
    let re_e = Regex::new(r"silence_end:\s*(-?[\d.]+)").unwrap();
    let mut out = vec![];
    let mut cur: Option<f64> = None;
    for line in text.lines() {
        if let Some(m) = re_s.captures(line) { cur = Some(m[1].parse::<f64>().unwrap_or(0.0).max(0.0) + offset); continue; }
        if let (Some(m), Some(st)) = (re_e.captures(line), cur) {
            let end = m[1].parse::<f64>().unwrap_or(0.0) + offset;
            if end > st { out.push(Silence { start: st, end }); }
            cur = None;
        }
    }
    if let (Some(st), Some(d)) = (cur, duration) { if d + offset > st { out.push(Silence { start: st, end: d + offset }); } }
    out
}

pub fn parse_mean_volume(text: &str) -> Option<f64> {
    Regex::new(r"mean_volume:\s*(-?[\d.]+)\s*dB").unwrap().captures(text).and_then(|m| m[1].parse().ok())
}

/// 무음 기준: 평균 음량보다 14dB 낮게 (-50 ~ -28 dB). 모르면 -35 dB
pub fn noise_floor_for(mean_db: Option<f64>) -> f64 {
    match mean_db { Some(m) if m.is_finite() => (m - 14.0).round().clamp(-50.0, -28.0), _ => -35.0 }
}

fn run_ffmpeg(args: &[String]) -> anyhow::Result<String> {
    let out = crate::media::command("ffmpeg").args(args).stdin(std::process::Stdio::null()).output()?;
    let err = String::from_utf8_lossy(&out.stderr).to_string();
    if out.status.success() { Ok(err) } else { anyhow::bail!("ffmpeg 오류: {}", err.lines().filter(|l| !l.trim().is_empty()).rev().take(2).collect::<Vec<_>>().join(" / ")) }
}

pub struct Found { pub noise_db: f64, pub mean_db: Option<f64>, pub silences: Vec<Silence> }

/// 파일의 [start, end] 범위에서 무음 찾기 (파일 시각)
pub fn detect_silences(file: &Path, start: f64, end: Option<f64>, min_dur: f64) -> anyhow::Result<Found> {
    let start = if start.is_finite() && start > 0.0 { start } else { 0.0 };
    let end = end.filter(|e| e.is_finite() && *e > start);
    let min_dur = if min_dur > 0.0 { min_dur } else { 0.15 };
    let mut base: Vec<String> = vec!["-hide_banner".into(), "-nostats".into(), "-ss".into(), format!("{start:.3}")];
    if let Some(e) = end { base.push("-to".into()); base.push(format!("{e:.3}")); }
    base.extend(["-i".to_string(), file.to_string_lossy().to_string(), "-map".into(), "0:a:0".into(), "-vn".into(), "-sn".into()]);
    let mut a1 = base.clone(); a1.extend(["-af".to_string(), "volumedetect".into(), "-f".into(), "null".into(), "-".into()]);
    let mean = parse_mean_volume(&run_ffmpeg(&a1)?);
    let noise = noise_floor_for(mean);
    let mut a2 = base; a2.extend(["-af".to_string(), format!("silencedetect=noise={noise}dB:d={min_dur}"), "-f".into(), "null".into(), "-".into()]);
    let log = run_ffmpeg(&a2)?;
    Ok(Found { noise_db: noise, mean_db: mean, silences: parse_silences(&log, start, end.map(|e| e - start)) })
}

/// 지운 군말 수 / 말 사이 공백을 잘라 낸 곳 수·초
pub fn summary(words: &[Word], segs: &[Segment]) -> (usize, usize, f64) {
    let fillers = words.iter().filter(|w| w.del && is_filler(&w.text)).count();
    let idx: HashMap<i64, usize> = words.iter().enumerate().map(|(i, w)| (w.id, i)).collect();
    let (mut gaps, mut sec) = (0, 0.0);
    for k in 0..segs.len().saturating_sub(1) {
        if let (Some(&a), Some(&b)) = (idx.get(&segs[k].last_word_id), idx.get(&segs[k + 1].first_word_id)) { if b == a + 1 { gaps += 1; sec += (segs[k + 1].start - segs[k].end).max(0.0); } }
    }
    (fillers, gaps, sec)
}

/// 군말·바로 되풀이한 말 지우기 + 긴 틈에 컷 (기존 edl.js autoClean). fillers 가 None 이면 기본 군말
pub fn auto_clean(words: &mut [Word], max_gap: f64, fillers: Option<&[&str]>) {
    const DEF: [&str; 6] = ["어", "음", "아", "으", "에", "엄"];
    let fl: &[&str] = fillers.unwrap_or(&DEF);
    let strip = |t: &str| -> String { t.chars().filter(|c| !".?!。？！,、\"'”’」』)\\".contains(*c)).collect::<String>().trim().to_string() };
    for w in words.iter_mut() { if !w.del && fl.contains(&strip(&w.text).as_str()) { w.del = true; } }
    let mut prev: Option<usize> = None;
    for i in 0..words.len() {
        if words[i].del { continue; }
        if let Some(p) = prev {
            let (a, b) = (strip(&words[i].text), strip(&words[p].text));
            if a == b && !a.is_empty() { words[p].del = true; prev = Some(i); continue; }
            if words[i].start - words[p].end > max_gap { words[i].cut_before = true; }
        }
        prev = Some(i);
    }
}