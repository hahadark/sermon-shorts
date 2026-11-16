//! 자동 정리·말 사이 공백 없애기 (기존 tidy.js · chat-ui.js removeGaps · SS.restoreGap · SS.cutPause)
use crate::*;
use sermon_shorts::tidy::{self, GapPlan};

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum TidyKind { Tidy, Gaps }

pub(crate) struct TidyJob {
    pub kind: TidyKind,
    pub rx: Receiver<(GapPlan, &'static str)>,
    pub fillers: usize,
    pub dups: usize,
    pub before: f64,
}

impl App {
    /// 자동 정리: 군말·되풀이한 말 지우고, 말 사이 공백은 실제 소리에서 무음을 찾아 자른다 (한 번의 Ctrl+Z 로 전체 되돌리기)
    pub(crate) fn cmd_tidy(&mut self) { self.start_tidy(TidyKind::Tidy); }
    /// 말 사이 공백 없애기 (소리 기준, 더 촘촘하게)
    pub(crate) fn cmd_gaps(&mut self) { self.start_tidy(TidyKind::Gaps); }

    fn start_tidy(&mut self, kind: TidyKind) {
        if self.tidy.is_some() { self.toast("정리 중입니다. 잠시만 기다려 주세요."); return; }
        if self.project.words.is_empty() { self.toast("먼저 편집할 영상과 자막을 열어 주세요."); return; }
        self.cap_buf.clear();
        let (mut fillers, mut dups) = (0, 0);
        if kind == TidyKind::Tidy {
            for w in self.project.words.iter_mut() { if !w.del && tidy::is_filler(&w.text) { w.del = true; fillers += 1; } }
            // 바로 되풀이한 같은 말 (1초 안): 앞의 것을 지운다
            let mut prev: Option<usize> = None;
            for i in 0..self.project.words.len() {
                if self.project.words[i].del { continue; }
                if let Some(p) = prev {
                    let (a, b) = (tidy::core(&self.project.words[p].text), tidy::core(&self.project.words[i].text));
                    if !a.is_empty() && a == b && self.project.words[i].start - self.project.words[p].end < 1.0 { self.project.words[p].del = true; dups += 1; }
                }
                prev = Some(i);
            }
        }
        self.recompute();
        let before = edl::segments_duration(&self.segs);
        if self.segs.is_empty() || self.player.path.is_none() {
            if fillers + dups > 0 { self.commit(); }
            self.tidy_done(kind, fillers, dups, before, GapPlan::default(), "none");
            return;
        }
        let (words, segs, src) = (self.project.words.clone(), self.segs.clone(), self.project.source_path.clone());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (s0, s1) = ((segs[0].start - 0.5).max(0.0), segs[segs.len() - 1].end + 0.5);
            let r = match kind {
                TidyKind::Tidy => match tidy::detect_silences(&src, s0, Some(s1), 0.3) {
                    Ok(f) => (tidy::plan_gap_cuts(&words, &segs, &f.silences, 0.08, 0.12, 0.15), "audio"),
                    Err(_) => (tidy::gap_cuts_by_timing(&words, &segs, 0.3, 0.08, 0.12), "timing"),
                },
                TidyKind::Gaps => match tidy::detect_silences(&src, s0, Some(s1), 0.15) {
                    Ok(f) => (tidy::plan_gap_cuts(&words, &segs, &f.silences, 0.05, 0.07, 0.08), "audio"),
                    Err(_) => (GapPlan::default(), "error"),
                },
            };
            let _ = tx.send(r);
        });
        self.tidy = Some(TidyJob { kind, rx, fillers, dups, before });
    }

    pub(crate) fn poll_tidy(&mut self) {
        let Some(job) = &self.tidy else { return };
        let Ok((plan, how)) = job.rx.try_recv() else { return };
        let (kind, fillers, dups, before) = (job.kind, job.fillers, job.dups, job.before);
        self.tidy = None;
        self.tidy_done(kind, fillers, dups, before, plan, how);
    }

    fn tidy_done(&mut self, kind: TidyKind, fillers: usize, dups: usize, before: f64, plan: GapPlan, how: &str) {
        let n = self.project.words.len();
        for &i in &plan.cut_before { if i < n { self.project.words[i].cut_before = true; self.project.words[i].extra.insert("gapCut".into(), json!(true)); } }
        for (k, v) in &plan.overrides { self.project.overrides.insert(k.clone(), *v); }
        if fillers + dups + plan.cuts > 0 { self.commit(); self.recompute(); }
        match kind {
            TidyKind::Tidy => {
                let mut parts = vec![];
                if fillers > 0 { parts.push(format!("군말 {fillers}개")); }
                if dups > 0 { parts.push(format!("되풀이한 말 {dups}개")); }
                if plan.cuts > 0 { parts.push(format!("말 사이 공백 {}곳({:.1}초)", plan.cuts, plan.saved_sec)); }
                if parts.is_empty() { self.toast("지울 군말·공백이 없습니다"); }
                else { self.toast(format!("{}을 지웠습니다. 자막 편집의 노란 표시를 누르면 되살립니다 (전체 취소 Ctrl+Z){}", parts.join(" · "), if how == "timing" { " · 소리를 못 읽어 단어 시각으로 잘랐습니다" } else { "" })); }
            }
            TidyKind::Gaps => {
                if how == "error" { self.toast("공백 없애기: 소리를 읽지 못했습니다"); }
                else if plan.cuts > 0 { let after = edl::segments_duration(&self.segs); self.toast(format!("말 사이 공백 {}곳을 줄였습니다 ({:.1}초 짧아짐, Ctrl+Z 되돌리기)", plan.cuts, before - after)); }
                else { self.toast("더 줄일 말 사이 공백이 없습니다"); }
            }
        }
    }

    fn prev_live(&self, i: usize) -> Option<usize> { (0..i).rev().find(|&k| !self.project.words[k].del) }

    /// 잘라 낸 공백 되살리기 (i: 뒤 단어 번호)
    pub(crate) fn restore_gap(&mut self, i: usize) {
        let Some(w) = self.project.words.get(i) else { return };
        let id = w.id;
        let p = self.prev_live(i).map(|p| self.project.words[p].id);
        let w = &mut self.project.words[i];
        w.cut_before = false; w.extra.remove("gapCut");
        self.project.overrides.remove(&format!("s:{id}"));
        if let Some(pid) = p { self.project.overrides.remove(&format!("e:{pid}")); }
        self.commit();
    }

    /// 남겨 둔 긴 쉼 잘라 내기 (i: 쉼 뒤 단어 번호). 말 끝 0.12초·다시 시작 앞 0.08초는 남긴다
    pub(crate) fn cut_pause(&mut self, i: usize) {
        let Some(p) = self.prev_live(i) else { return };
        let (a_id, a_end) = (self.project.words[p].id, self.project.words[p].end);
        let (w_id, w_start) = (self.project.words[i].id, self.project.words[i].start);
        let (e0, s1) = (a_end + 0.12, w_start - 0.08);
        if !(s1 - e0 > 0.05) { return; }
        let w = &mut self.project.words[i];
        w.cut_before = true; w.extra.insert("gapCut".into(), json!(true));
        self.project.overrides.insert(format!("e:{a_id}"), e0);
        self.project.overrides.insert(format!("s:{w_id}"), s1);
        self.commit();
    }
}
