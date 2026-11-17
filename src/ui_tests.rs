//! 자동 시험 (--test 이름 --report 경로): 재생 끊김, 편집 흐름, 칸 순서, 화면 찍기
use crate::*;
use crate::ui_import::Dlg;

impl App {
    pub(crate) fn run_test(&mut self, ctx: &egui::Context) {
        let Some(mut test) = self.test.take() else { return };
        let t = &mut test;
        match (t.name.as_str(), t.step) {
            ("skipgap", 0) => {
                let mut last = self.project.words.first().map(|w| w.start).unwrap_or(0.0);
                for w in self.project.words.iter_mut() { if w.start - last > 3.0 { w.del = true; if w.end - last > 3.6 { last = w.end; } } }
                self.edited = true; self.recompute();
                self.player.seek(0.0); self.player.play();
                t.t0 = Instant::now(); t.step = 1;
            }
            ("skipgap", 1) if t.t0.elapsed().as_secs_f64() > 20.0 => {
                self.player.stop();
                let mut s: Vec<f64> = t.log.windows(2).map(|w| (w[1].0 - w[0].0) * 1000.0).collect();
                s.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let q = |p: f64| s.get(((s.len() as f64 - 1.0) * p) as usize).copied().unwrap_or(0.0);
                let r = serde_json::json!({ "segments": self.segs.len(), "fps": t.log.len() as f64 / 20.0, "frameGapMs": { "median": q(0.5), "p95": q(0.95), "max": s.last().copied().unwrap_or(0.0) }, "underruns": self.player.underruns() });
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&r).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close); t.step = 9;
            }
            // 편집 흐름: 지우기 → 되돌리기 → 다시 → 자막 고치기 → 저장 → 다시 열어 비교
            ("editflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                let mut r = serde_json::Map::new();
                let dur = |a: &App| a.segs.iter().map(|s| s.end - s.start).sum::<f64>();
                let key = |a: &App| serde_json::to_string(&a.project.words).unwrap_or_default();
                let (n0, d0, k0) = (self.lines.len(), dur(self), key(self));
                let b0 = self.blocks.iter().find(|b| b.line.is_some()).map(|b| (b.from, b.to)).unwrap();
                self.toggle_words(b0.0, b0.1, true); self.recompute();
                let (n1, d1, k1) = (self.lines.len(), dur(self), key(self));
                r.insert("delete".into(), serde_json::json!({ "linesBefore": n0, "linesAfter": n1, "durBefore": d0, "durAfter": d1, "ok": n1 + 1 == n0 && d1 < d0 }));
                self.undo(); self.recompute();
                r.insert("undo".into(), serde_json::json!({ "ok": key(self) == k0 && self.lines.len() == n0 }));
                self.redo(); self.recompute();
                r.insert("redo".into(), serde_json::json!({ "ok": key(self) == k1 }));
                self.undo(); self.recompute();
                let line = self.lines[1].clone();
                let want = format!("{} 고침", line.text);
                self.project.words = caption_edit::apply(&self.project.words, &line, &want); self.commit(); self.recompute();
                r.insert("editLine".into(), serde_json::json!({ "want": want, "got": self.lines[1].text, "ok": self.lines[1].text == want }));
                let deleted_before = self.project.words.iter().filter(|w| w.del).count();
                if let Some(rep) = &t.report {
                    let sp = std::path::Path::new(rep).with_extension("sshorts");
                    self.project_path = Some(sp.clone()); self.save_project(false);
                    match Project::load(&sp) {
                        Ok(p2) => {
                            let same = serde_json::to_string(&p2.words).ok() == serde_json::to_string(&self.project.words).ok() && p2.order == self.project.order && p2.overrides == self.project.overrides;
                            let l2 = edl::build_lines(&p2.words, &edl::build_segments(&p2.words, &p2.settings, &p2.overrides, Some(self.player.probe.duration), p2.order.as_deref()), &p2.settings);
                            r.insert("saveReload".into(), serde_json::json!({ "file": sp, "deleted": deleted_before, "ok": same && !self.unsaved && l2.len() == self.lines.len() && l2[1].text == want }));
                        }
                        Err(e) => { r.insert("saveReload".into(), serde_json::json!({ "error": e.to_string(), "ok": false })); }
                    }
                    let all = r.values().all(|v| v["ok"].as_bool() == Some(true));
                    r.insert("pass".into(), all.into());
                    let _ = std::fs::write(rep, serde_json::to_string_pretty(&serde_json::Value::Object(r)).unwrap());
                }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close); t.step = 9;
            }            // 칸 순서: 첫 칸을 한 칸 아래로 → 줄 순서 확인 → 맨 위 칸 위로(안 움직임) → 되돌리기·다시 → 저장·다시 열기
            ("reorder", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                let mut r = serde_json::Map::new();
                let texts = |a: &App| a.blocks.iter().filter_map(|b| b.line.map(|li| a.lines[li].text.clone())).collect::<Vec<_>>();
                let o0 = self.project.order.clone(); let t0 = texts(self);
                let first = self.blocks.iter().position(|b| b.line.is_some()).unwrap();
                let moved = self.step_block(first, 1);
                let t1 = texts(self);
                let mut want = t0.clone(); want.swap(0, 1);
                r.insert("down".into(), serde_json::json!({ "moved": moved, "before": &t0[..3], "after": &t1[..3], "ok": moved && t1 == want }));
                let first2 = self.blocks.iter().position(|b| b.line.is_some()).unwrap();
                r.insert("topUp".into(), serde_json::json!({ "ok": !self.step_block(first2, -1) }));
                let dur_moved: f64 = self.segs.iter().map(|s| s.end - s.start).sum();
                self.undo(); self.recompute();
                r.insert("undo".into(), serde_json::json!({ "ok": self.project.order == o0 && texts(self) == t0 }));
                self.redo(); self.recompute();
                let dur_redo: f64 = self.segs.iter().map(|s| s.end - s.start).sum();
                r.insert("redo".into(), serde_json::json!({ "ok": texts(self) == want && (dur_redo - dur_moved).abs() < 1e-6 }));
                if let Some(rep) = &t.report {
                    let sp = std::path::Path::new(rep).with_extension("sshorts");
                    self.project_path = Some(sp.clone()); self.save_project(false);
                    let ok = Project::load(&sp).map(|p2| p2.order == self.project.order).unwrap_or(false);
                    r.insert("saveReload".into(), serde_json::json!({ "order": self.project.order, "ok": ok }));
                    let all = r.values().all(|v| v["ok"].as_bool() == Some(true));
                    r.insert("pass".into(), all.into());
                    let _ = std::fs::write(rep, serde_json::to_string_pretty(&serde_json::Value::Object(r)).unwrap());
                }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close); t.step = 9;
            }
            // 디자인 화면 찍기: 제목·구절을 넣고 자막이 나오는 곳으로 → 찍기 → (SS_SHOT2 가 있으면) 설정 열고 칸 체크·단어 고르고 한 번 더
            ("uishot", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                self.title = "오늘의 말씀 / 하나님 중심의 *기도*".into();
                self.verse = "마태복음 6:13".into();
                self.player.seek_src(std::env::var("SS_SHOT_AT").ok().and_then(|v| v.parse().ok()).unwrap_or(13.0));
                t.step = 1; t.t0 = Instant::now();
            }
            ("uishot", 1) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                let second = std::env::var("SS_SHOT2").ok();
                shot(ctx, t.report.clone(), second.is_none());
                t.step = if second.is_some() { 2 } else { 9 }; t.t0 = Instant::now();
            }
            ("uishot", 2) if t.t0.elapsed().as_secs_f64() > 1.5 => {
                self.cap_settings_open = true;
                if let Some(b) = self.blocks.iter().find(|b| b.line.is_some()).cloned() { for i in b.from..b.to { let w = &self.project.words[i]; if !w.del { self.checked.insert(w.id); } } }
                if let Some(b) = self.blocks.iter().filter(|b| b.line.is_some()).nth(2).cloned() { self.sel_anchor = Some(b.from); self.caret = (b.from + 2).min(b.to); self.selection = Some((b.from, self.caret)); }
                t.step = 3; t.t0 = Instant::now();
            }
            ("uishot", 3) if t.t0.elapsed().as_secs_f64() > 2.0 => {
                shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), true);
                t.step = 9;
            }            // 자동 정리: 실제 소리로 군말·공백 정리 → 결과 확인 → Ctrl+Z 한 번에 처음대로
            ("tidyflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                t.log = vec![(edl::segments_duration(&self.segs), self.segs.len() as f64)];
                self.test_words = serde_json::to_string(&self.project.words).unwrap_or_default();
                self.cmd_tidy();
                t.step = 1; t.t0 = Instant::now();
            }
            ("tidyflow", 1) if self.tidy.is_none() => {
                let (d0, n0) = t.log[0];
                let d1 = edl::segments_duration(&self.segs);
                let gap_cuts = self.project.words.iter().filter(|w| w.extra.get("gapCut").is_some()).count();
                let fillers = self.project.words.iter().filter(|w| w.del && sermon_shorts::tidy::is_filler(&w.text)).count();
                if let Ok(p) = std::env::var("SS_TIDY_DUMP") {
                    let del: Vec<i64> = self.project.words.iter().filter(|w| w.del).map(|w| w.id).collect();
                    let cb: Vec<usize> = self.project.words.iter().enumerate().filter(|(_, w)| w.extra.get("gapCut").is_some()).map(|(i, _)| i).collect();
                    let _ = std::fs::write(p, serde_json::to_string_pretty(&json!({ "del": del, "cutBefore": cb, "overrides": self.project.overrides, "durAfter": d1, "segsAfter": self.segs.len() })).unwrap());
                }
                self.undo(); self.recompute();
                let undone = serde_json::to_string(&self.project.words).unwrap_or_default() == self.test_words;
                let r = json!({ "secs": t.t0.elapsed().as_secs_f64(), "durBefore": d0, "durAfter": d1, "segsBefore": n0, "segsAfter": edl::build_segments(&self.project.words, &self.project.settings, &self.project.overrides, Some(self.player.probe.duration), self.project.order.as_deref()).len(), "gapCuts": gap_cuts, "fillers": fillers, "undo": undone, "pass": undone && d1 < d0 && gap_cuts > 0 });
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&r).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close); t.step = 9;
            }            // 자막 나누기·합치기 (Electron caption-split 시험과 같은 순서)
            ("splitflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                let mut r = serde_json::Map::new();
                let mut ok_all = true;
                let mut chk = |name: &str, ok: bool, extra: Value| { ok_all &= ok; r.insert(name.into(), json!({ "ok": ok, "extra": extra })); };
                let n0 = self.lines.len();
                // 1) 단어 사이
                let li = self.lines.iter().position(|l| l.text.split(' ').count() >= 3).unwrap();
                let before = self.lines[li].text.clone();
                let third = before.chars().count() / 3;
                let cut = before.char_indices().map(|(i, _)| i).enumerate().filter(|(_, b)| before[*b..].starts_with(' ')).map(|(ci, _)| ci).find(|ci| *ci >= third).unwrap();
                self.split_line(li, before.clone(), cut);
                let left: String = before.chars().take(cut).collect(); let right: String = before.chars().skip(cut).collect();
                chk("자막이 하나 늘었다", self.lines.len() == n0 + 1, json!([n0, self.lines.len()]));
                chk("앞 자막", self.lines[li].text == left.trim(), json!(self.lines[li].text));
                chk("뒤 자막", self.lines[li + 1].text == right.trim(), json!(self.lines[li + 1].text));
                chk("커서가 뒤 자막 맨 앞으로", self.focus_line.is_some_and(|(a, c)| c == 0 && self.lines[li + 1].parts.first().is_some_and(|p| p.id == a.id && p.from == a.from)), json!(null));
                self.focus_line = None;
                // 2) 단어 가운데
                let li2 = self.lines.iter().position(|l| l.text.split(' ').any(|tk| tk.chars().count() >= 4)).unwrap();
                let v2 = self.lines[li2].text.clone();
                let tok = v2.split(' ').find(|tk| tk.chars().count() >= 4).unwrap().to_string();
                let at = v2[..v2.find(&tok).unwrap()].chars().count() + 2;
                let n1 = self.lines.len();
                self.split_line(li2, v2.clone(), at);
                chk("단어 가운데 앞", self.lines[li2].text == v2.chars().take(at).collect::<String>().trim(), json!(self.lines[li2].text));
                chk("단어 가운데 뒤", self.lines[li2 + 1].text == v2.chars().skip(at).collect::<String>().trim(), json!(self.lines[li2 + 1].text));
                chk("단어에 나눈 자리 기록", self.project.words.iter().any(|w| w.caption_splits.as_ref().is_some_and(|v| !v.is_empty())), json!(null));
                // 3) 맨 끝 Enter: 다음 자막으로
                let n2 = self.lines.len(); let e = self.lines[li2 + 1].text.clone();
                self.split_line(li2 + 1, e.clone(), e.chars().count());
                chk("맨 끝은 다음 칸으로", self.lines.len() == n2 && self.focus_line.is_some_and(|(a, _)| self.lines[li2 + 2].parts.first().is_some_and(|p| p.id == a.id && p.from == a.from)), json!(n1));
                self.focus_line = None;
                // 4) 되돌리기 두 번 → 처음 개수
                self.undo(); self.recompute(); self.undo(); self.recompute();
                chk("되돌리기", self.lines.len() == n0, json!([self.lines.len(), n0]));
                // 5) 다시 → SRT 에 나뉜 자막
                self.redo(); self.recompute();
                let srt = edl::to_srt(&self.lines);
                chk("SRT 에 나뉜 자막", srt.contains(&format!("\n{}\n", right.trim())), json!(null));
                // 6) 합치기 → 수동 병합 → 글자 수대로 다시
                let n3 = self.lines.len();
                self.merge_lines(li + 1, true, None);
                let merged = self.lines.iter().find(|l| l.manual_merge).cloned();
                chk("합치기", self.lines.len() == n3 - 1 && merged.as_ref().is_some_and(|m| m.text == before), json!(merged.as_ref().map(|m| m.text.clone())));
                if let Some(m) = merged { let words = sermon_shorts::caption_edit::unmerge(&self.project.words, &m); self.project.words = words; self.commit(); self.recompute(); }
                chk("글자 수대로 다시 나누기", !self.lines.iter().any(|l| l.manual_merge), json!(null));
                r.insert("pass".into(), ok_all.into());
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&Value::Object(r)).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close); t.step = 9;
            }            // 시작·끝 미세 조정: 열기 → 소리 받기 → 찍기 → 밀기·원래대로·무음 맞추기·되돌리기·다음 자막
            ("trimflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                let b = self.blocks.iter().filter(|b| b.line.is_some()).nth(2).cloned().unwrap();
                self.open_fine(b.from, b.to - 1);
                t.step = 1; t.t0 = Instant::now();
            }
            ("trimflow", 1) if self.trim.as_ref().is_some_and(|x| x.pcm.is_some()) && t.t0.elapsed().as_secs_f64() > 1.0 => {
                shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false);
                t.step = 2; t.t0 = Instant::now();
            }
            ("trimflow", 2) if t.t0.elapsed().as_secs_f64() > 1.5 => {
                let mut r = serde_json::Map::new();
                let mut all = true;
                let mut chk = |n: &str, ok: bool, v: Value| { all &= ok; r.insert(n.into(), json!({ "ok": ok, "v": v })); };
                let seg_of = |a: &App| { let id = a.project.words[a.trim.as_ref().unwrap().idx_b].id; a.segs.iter().find(|s| s.first_word_id == id).map(|s| s.start) };
                let s0 = seg_of(self);
                let words0 = serde_json::to_string(&self.project.words).unwrap();
                let ov0 = self.project.overrides.clone();
                if let Some(x) = &mut self.trim { x.active = 'B'; }
                self.nudge(0.05);
                let s1 = seg_of(self);
                chk("시작 0.05초 밀기", matches!((s0, s1), (Some(a), Some(b)) if (b - a - 0.05).abs() < 0.002) || (self.b_start() - self.trim.as_ref().unwrap().center_b - 0.05).abs() < 1e-9, json!([s0, s1, self.b_start()]));
                self.reset_trim();
                chk("원래대로", self.project.overrides == ov0, json!(self.project.overrides.len()));
                self.snap_trim("silence");
                let snapped = self.b_start();
                chk("무음에 맞추기", (snapped - self.trim.as_ref().unwrap().center_b).abs() <= 0.16, json!(snapped));
                self.undo(); self.recompute(); self.undo(); self.recompute(); self.undo(); self.recompute();
                chk("되돌리기", serde_json::to_string(&self.project.words).unwrap() == words0 && self.project.overrides == ov0, json!(null));
                let before = self.trim.as_ref().unwrap().idx_b;
                self.step_trim(1);
                chk("다음 자막", self.trim.as_ref().is_some_and(|x| x.idx_b > before), json!([before, self.trim.as_ref().map(|x| x.idx_b)]));
                r.insert("pass".into(), all.into());
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&Value::Object(r)).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close); t.step = 9;
            }            // 내보내기 → 완성 영상 창 → (가짜) 유튜브 올리기 → 업로드 기록
            ("exportflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                self.title = "오늘의 말씀 / 하나님 중심의 *기도*".into();
                let out = PathBuf::from(t.report.clone().unwrap()).with_extension("mp4");
                let _ = std::fs::remove_file(&out);
                self.export_to(out);
                t.step = 1; t.t0 = Instant::now();
            }
            ("exportflow", 1) if self.export_view.is_some() && t.t0.elapsed().as_secs_f64() > 1.0 => {
                if let Some(v) = &mut self.export_view { v.checks = [true; 3]; }
                shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false);
                t.step = 2; t.t0 = Instant::now();
            }
            ("exportflow", 2) if t.t0.elapsed().as_secs_f64() > 1.5 => {
                // 시험에서는 절대 실제로 올리지 않는다 (SS_TEST_YTFAKE 가 없으면 업로드 단계를 건너뛰고 실패로)
                if sermon_shorts::ytupload::fake() { self.start_upload(); } else if let Some(v) = &mut self.export_view { v.hint = "SS_TEST_YTFAKE 없음: 실제 업로드를 막았습니다".into(); }
                t.step = 3; t.t0 = Instant::now();
            }
            ("exportflow", 3) if self.export_view.as_ref().is_some_and(|v| v.result.is_some() || !v.hint.is_empty()) || t.t0.elapsed().as_secs_f64() > 20.0 => {
                let v = self.export_view.as_ref();
                let res = v.and_then(|v| v.result.clone());
                let mp4 = v.map(|v| v.done.out.clone());
                let srt_ok = mp4.as_ref().is_some_and(|p| export::srt_path_of(p).exists());
                let uploads = self.project.rest.get("uploads").and_then(|u| u.as_array()).map(|a| a.len()).unwrap_or(0);
                let r = json!({ "exported": mp4.as_ref().is_some_and(|p| p.exists()), "srt": srt_ok, "uploaded": res.as_ref().map(|u| json!({ "url": u.url, "title": u.title, "privacy": u.privacy })), "uploadsRecorded": uploads, "hint": v.map(|v| v.hint.clone()),
                    "pass": mp4.as_ref().is_some_and(|p| p.exists()) && srt_ok && res.as_ref().is_some_and(|u| u.title.ends_with("#Shorts") && u.url.starts_with("https://youtu.be/")) && uploads == 1 });
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&r).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close); t.step = 9;
            }
            // 유튜브 가져오기 전체 흐름 (기존 import.js ytpart 시험과 같은 영상·같은 판정)
            ("ytimport", 0) => {
                let url = std::env::var("SS_TEST_YTURL").unwrap_or_else(|_| "https://www.youtube.com/watch?v=9Tmjg3ESEyc".into());
                let (a, b) = (1415.0, std::env::var("SS_TEST_YTEND").ok().and_then(|s| s.parse().ok()).unwrap_or(1450.0));
                let st = self.test_import_step(&url, a, b);
                if let Ok(p) = std::env::var("SS_YT_TRACE") { if self.test_words != st { let _ = std::fs::OpenOptions::new().create(true).append(true).open(&p).and_then(|mut f| { use std::io::Write; writeln!(f, "{:.1}s {st}", t.t0.elapsed().as_secs_f64()) }); self.test_words = st.to_string(); } }
                if st == "picked" { if let Some(Dlg::Picker(p)) = &mut self.import.dlg { p.player.seek(a); } self.test_words = json!({ "resolveSecs": t.t0.elapsed().as_secs_f64() }).to_string(); t.step = 1; t.t0 = Instant::now(); }
                else if t.t0.elapsed().as_secs_f64() > 180.0 { if let Some(p) = &t.report { let _ = std::fs::write(p, json!({ "pass": false, "stuck": st }).to_string()); } ctx.send_viewport_cmd(egui::ViewportCommand::Close); t.step = 9; }
            }
            ("ytimport", 1) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["picker"] = self.test_import_info();
                self.test_words = info.to_string();
                shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false);
                t.step = 2; t.t0 = Instant::now();
            }
            ("ytimport", 2) if t.t0.elapsed().as_secs_f64() > 1.0 => { self.test_import_ok(); t.step = 3; t.t0 = Instant::now(); }
            ("ytimport", 3) => {
                let done = self.import.dlg.is_none() && self.tidy.is_none();
                if (done && !self.project.words.is_empty()) || t.t0.elapsed().as_secs_f64() > 600.0 || (done && t.t0.elapsed().as_secs_f64() > 5.0) {
                    let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                    let src = self.project.rest.get("source").cloned().unwrap_or(Value::Null);
                    let off = src["offset"].as_f64().unwrap_or(0.0);
                    let path = self.project.source_path.to_string_lossy().to_string();
                    let first = self.project.words.first().cloned();
                    let keep = self.project.words.iter().find(|w| !w.del).cloned();
                    let cur = self.player.src_now();
                    let ok_file = regex::Regex::new(r"part_\d+_\d+\.mp4$").unwrap().is_match(&path);
                    let ok_off = off > 1380.0 && off <= 1415.0;
                    let first_orig = first.as_ref().map(|w| w.start + off).unwrap_or(f64::NAN);
                    let ok_first = (1413.0..1425.0).contains(&first_orig);
                    let ok_seek = [first.as_ref(), keep.as_ref()].iter().flatten().any(|w| (cur - w.start).abs() < 1.0);
                    info["result"] = json!({ "file": path, "offset": off, "words": self.project.words.len(), "deleted": self.project.words.iter().filter(|w| w.del).count(), "first": first.as_ref().map(|w| w.text.clone()), "firstOrig": first_orig, "cur": cur, "duration": self.player.probe.duration, "lines": self.lines.len(), "source": src, "secs": t.t0.elapsed().as_secs_f64(), "toast": self.toast.as_ref().map(|x| x.0.clone()) });
                    info["assert"] = json!({ "file": ok_file, "offset": ok_off, "firstWord": ok_first, "seek": ok_seek });
                    info["pass"] = json!(ok_file && ok_off && ok_first && ok_seek && !self.project.words.is_empty());
                    if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                    if let Ok(p) = std::env::var("SS_SHOT3") { shot(ctx, Some(PathBuf::from(p)), true); } else { ctx.send_viewport_cmd(egui::ViewportCommand::Close); }
                    t.step = 9;
                }
            }            // 원본 되살리기: 원본이 없는 프로젝트 → 묻기 창 → 다시 받기 → 시각 옮김 확인
            ("recoverflow", 0) if t.t0.elapsed().as_secs_f64() > 1.0 => {
                let dir = sermon_shorts::youtube::yt_cache_root().join("9Tmjg3ESEyc");
                let words: Vec<Value> = (0..12).map(|i| json!({ "id": i, "text": format!("말{i}"), "start": 5.0 + i as f64, "end": 5.6 + i as f64 })).collect();
                let proj = json!({ "version": 1, "source": { "path": dir.join("part_1415_1450_gone.mp4"), "offset": 1400.0, "url": "https://www.youtube.com/watch?v=9Tmjg3ESEyc", "title": "시험 영상", "duration": 63.0, "fetch": { "kind": "part", "start": 1415.0, "end": 1450.0 } },
                    "words": words, "overrides": { "s:2": 7.1 }, "playhead": 6.0, "settings": { "padBefore": 0.1, "padAfter": 0.15, "fadeMs": 10, "maxLineChars": 14 }, "meta": { "title": "되살리기 시험" } });
                let p = PathBuf::from("target/t_recover.sshorts");
                let _ = std::fs::write(&p, serde_json::to_string_pretty(&proj).unwrap());
                self.settings["sourceMissing"] = json!("ask");
                self.open_project(std::fs::canonicalize(&p).unwrap_or(p));
                t.step = 1; t.t0 = Instant::now();
            }
            ("recoverflow", 1) if t.t0.elapsed().as_secs_f64() > 1.5 => {
                let asked = matches!(&self.import.dlg, Some(Dlg::Recover(_)));
                self.test_words = json!({ "asked": asked }).to_string();
                shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false);
                t.step = 2; t.t0 = Instant::now();
            }
            ("recoverflow", 2) if t.t0.elapsed().as_secs_f64() > 1.0 => {
                if let Some(Dlg::Recover(r)) = &mut self.import.dlg { Self::recover_download(r); }
                t.step = 3; t.t0 = Instant::now();
            }
            ("recoverflow", 3) if self.import.dlg.is_none() || t.t0.elapsed().as_secs_f64() > 180.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                let src = self.project.rest.get("source").cloned().unwrap_or(Value::Null);
                let off = src["offset"].as_f64().unwrap_or(0.0);
                let w0 = self.project.words.first().map(|w| w.start).unwrap_or(f64::NAN);
                let want = 5.0 + 1400.0 - off;
                let ov = self.project.overrides.get("s:2").copied();
                // 저장하면 새 원본 위치가 기록되는지
                let saved_ok = { self.save_project(false); std::fs::read_to_string("target/t_recover.sshorts").ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).is_some_and(|v| v["source"]["path"].as_str().is_some_and(|p| p.ends_with("part_1415_1450.mp4")) && v["source"]["fetch"]["kind"] == "part") };
                info["result"] = json!({ "source": src, "firstStart": w0, "want": want, "override": ov, "playhead": self.player.src_now(), "toast": self.toast.as_ref().map(|x| x.0.clone()), "savedPath": saved_ok, "secs": t.t0.elapsed().as_secs_f64() });
                info["pass"] = json!(info["asked"] == true && (w0 - want).abs() < 1e-6 && ov.is_some_and(|o| (o - (7.1 + 1400.0 - off)).abs() < 1e-6) && self.project.source_path.exists() && saved_ok && off > 1380.0);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                if let Ok(p) = std::env::var("SS_SHOT3") { shot(ctx, Some(PathBuf::from(p)), true); } else { ctx.send_viewport_cmd(egui::ViewportCommand::Close); }
                t.step = 9;
            }            // 자동 저장: 편집 → 4초 뒤 저장 → 작업본 → 갑자기 꺼짐 흉내 → 묻기 창 → 과거 작업본 열기 (SS_USER_DATA_DIR 임시 폴더에서)
            ("autosaveflow", 0) if t.t0.elapsed().as_secs_f64() > 2.5 => {
                let b0 = self.blocks.iter().find(|b| b.line.is_some()).map(|b| (b.from, b.to)).unwrap();
                self.test_words = json!({ "pausedAfterStart": self.asv.paused, "crashAsked": self.asv.browser.is_some() }).to_string();
                self.toggle_words(b0.0, b0.1, true); self.recompute();
                t.step = 1; t.t0 = Instant::now();
            }
            ("autosaveflow", 1) if self.asv.last_at > 0.0 || t.t0.elapsed().as_secs_f64() > 12.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["firstWriteSecs"] = json!(t.t0.elapsed().as_secs_f64());
                info["status"] = json!(self.autosave_status());
                let list = sermon_shorts::autosave::list();
                info["afterFirst"] = json!({ "entries": list.len(), "versions": list.first().map(|e| e.versions.len()), "summary": list.first().map(|e| e.summary.clone()), "title": list.first().map(|e| e.title.clone()) });
                // 두 번째 편집: 작업본은 2분이 안 지나 새로 남지 않는다
                let b1 = self.blocks.iter().filter(|b| b.line.is_some()).nth(1).map(|b| (b.from, b.to)).unwrap();
                self.toggle_words(b1.0, b1.1, true); self.recompute();
                self.test_words = info.to_string();
                t.step = 2; t.t0 = Instant::now();
            }
            ("autosaveflow", 2) if t.t0.elapsed().as_secs_f64() > 5.5 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                let v2 = sermon_shorts::autosave::list().first().map(|e| e.versions.len());
                self.asv_save_now(true);
                let e = sermon_shorts::autosave::list().into_iter().next();
                info["afterSecond"] = json!({ "versions": v2, "writes": self.asv.stats.0, "skips": self.asv.stats.1 });
                info["afterForce"] = json!({ "versions": e.as_ref().map(|e| e.versions.len()) });
                let idle = self.asv_save_now(false).is_none(); info["idleSkip"] = json!(idle);
                // 갑자기 꺼진 실행 흉내: 없는 프로세스의 실행 표시
                let key = e.as_ref().map(|e| e.key.clone()).unwrap_or_default();
                let sess = sermon_shorts::theme::user_data_dir().join("autosave").join("sessions").join("999991.json");
                let _ = std::fs::write(&sess, json!({ "pid": 999991, "startedAt": sermon_shorts::autosave::now_ms() - 60000.0, "keys": [key] }).to_string());
                if let Some(c) = &mut self.asv.core { c.crashed = sermon_shorts::autosave::scan_sessions(); }
                self.check_crash_now();
                info["crashBrowser"] = json!(self.asv.browser.as_ref().map(|b| (b.crash, b.entries.as_ref().map(|e| e.len()))));
                self.test_words = info.to_string();
                t.step = 3; t.t0 = Instant::now();
            }
            ("autosaveflow", 3) if t.t0.elapsed().as_secs_f64() > 1.5 => {
                shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false);
                t.step = 4; t.t0 = Instant::now();
            }
            ("autosaveflow", 4) if t.t0.elapsed().as_secs_f64() > 1.0 => {
                // 첫 작업본(첫 편집만 한 상태)으로 열기
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                let e = sermon_shorts::autosave::list().into_iter().next().unwrap();
                let oldest = e.versions.last().unwrap().file.clone();
                let dels_before = self.project.words.iter().filter(|w| w.del).count();
                self.open_saved(&e.key, &oldest, false);
                let dels_after = self.project.words.iter().filter(|w| w.del).count();
                let saved: Value = serde_json::from_str(&std::fs::read_to_string(sermon_shorts::theme::user_data_dir().join("autosave").join(&e.key).join(&oldest)).unwrap()).unwrap();
                let want = saved["words"].as_array().unwrap().iter().filter(|w| w["del"] == true).count();
                info["openVersion"] = json!({ "file": oldest, "delsBefore": dels_before, "delsAfter": dels_after, "want": want, "toast": self.toast.as_ref().map(|x| x.0.clone()), "browserClosed": self.asv.browser.is_none(), "paused": self.asv.paused });
                let ok = info["idleSkip"] == true && info["pausedAfterStart"] == 0 && info["crashAsked"] == false && info["afterFirst"]["entries"] == 1 && info["afterFirst"]["versions"] == 2
                    && info["afterSecond"]["versions"] == 2 && info["afterForce"]["versions"] == 3 && info["crashBrowser"][0] == true && dels_after == want && dels_after < dels_before && self.asv.browser.is_none();
                info["pass"] = json!(ok);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                t.step = 9;
            }            // 설정 창: 탭 화면 찍기 → 값 바꿔 저장 → 정리 규칙·암호문 보존 확인 (SS_USER_DATA_DIR 임시 폴더)
            ("prefsflow", 0) if t.t0.elapsed().as_secs_f64() > 2.0 => {
                let before = sermon_shorts::settings::load();
                self.test_words = json!({ "ytRefreshLen": before["ytRefreshEnc"].as_str().map(|s| s.len()), "geminiLen": before["geminiApiKeyEnc"].as_str().map(|s| s.len()) }).to_string();
                self.open_settings("general");
                t.step = 1; t.t0 = Instant::now();
            }
            // 찍은 화면은 그 프레임이 끝난 뒤 담기므로, 탭은 다음 단계에서 바꾼다
            ("prefsflow", s @ 1..=3) if t.t0.elapsed().as_secs_f64() > 1.2 => {
                let (env, tab) = match s { 1 => ("SS_SHOT_GENERAL", "general"), 2 => ("SS_SHOT_CHURCH", if std::env::var("SS_PREFS_CHAT").is_ok() { "chat" } else { "church" }), _ => ("SS_SHOT_YT", "youtube") };
                if t.log.is_empty() { self.test_prefs_tab(tab); t.log.push((0.0, 0.0)); t.t0 = Instant::now(); }
                else { shot(ctx, std::env::var(env).ok().map(PathBuf::from), false); t.log.clear(); t.step = s + 1; t.t0 = Instant::now(); }
            }
            ("prefsflow", 4) if t.t0.elapsed().as_secs_f64() > 1.0 => {
                self.test_prefs_edit();
                let saved = self.test_prefs_save();
                let after = sermon_shorts::settings::load();
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                let ok = saved && after["recentYoutubeMax"] == 3 && after["autosave"]["everyMin"] == 5 && after["editDefaults"]["maxLineChars"] == 16 && after["editDefaults"]["padBefore"] == 0.2 && after["editDefaults"]["autoTidy"] == false
                    && after["template"]["churchName"] == "시험교회" && after["defaultSpeaker"] == "시험 목사" && after["template"]["defaultSpeaker"] == "시험 목사" && after["churchTerms"] == "구역장, 셀모임, 사관"
                    && after["ytRefreshEnc"].as_str().map(|s| s.len()) == info["ytRefreshLen"].as_u64().map(|x| x as usize) && after["geminiApiKeyEnc"].as_str().map(|s| s.len()) == info["geminiLen"].as_u64().map(|x| x as usize)
                    && self.church == "시험교회" && self.prefs.open.is_none();
                info["after"] = json!({ "recentYoutubeMax": after["recentYoutubeMax"], "everyMin": after["autosave"]["everyMin"], "editDefaults": after["editDefaults"], "church": after["template"]["churchName"], "speakers": after["speakers"], "defaultSpeaker": after["defaultSpeaker"], "terms": after["churchTerms"], "ytRefreshLen": after["ytRefreshEnc"].as_str().map(|s| s.len()), "geminiLen": after["geminiApiKeyEnc"].as_str().map(|s| s.len()), "toast": self.toast.as_ref().map(|x| x.0.clone()) });
                info["pass"] = json!(ok);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                t.step = 9;
            }            // 목소리 크기: 자동 맞춤 재기 → 되돌리기 → 직접 +12dB 재생(미터·리미터) → 자동 맞춤으로 내보내 실제 크기 재기
            ("voiceflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                self.design_tab = DesignTab::Voice;
                self.change_voice(|v| v.mode = "auto".into(), true);
                t.step = 1; t.t0 = Instant::now();
            }
            ("voiceflow", 1) if (!self.voice_measuring() && self.voice().measured.is_some() && t.t0.elapsed().as_secs_f64() > 1.0) || t.t0.elapsed().as_secs_f64() > 90.0 => {
                let v = self.voice();
                let mut info = json!({ "measured": v.measured.as_ref().map(|m| json!({ "i": m.i, "tp": m.tp, "lra": m.lra, "key": m.key })), "gain": sermon_shorts::voice::gain_db(&v), "describe": sermon_shorts::voice::describe(&v), "err": self.audio.measure_err, "measureSecs": t.t0.elapsed().as_secs_f64() });
                shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false);
                self.undo(); let after_undo = self.voice().mode;
                self.redo(); let after_redo = self.voice().mode;
                info["undo"] = json!({ "afterUndo": after_undo, "afterRedo": after_redo });
                self.change_voice(|v| { v.mode = "manual".into(); v.gain_db = 12.0; }, true);
                self.audio.max_peak_db = -100.0;
                self.player.seek(0.0); self.player.play();
                self.test_words = info.to_string();
                t.step = 2; t.t0 = Instant::now();
            }
            ("voiceflow", 2) if t.t0.elapsed().as_secs_f64() > 5.0 => {
                self.player.stop();
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["manual12"] = json!({ "maxPeakDb": self.audio.max_peak_db });
                self.change_voice(|v| v.mode = "auto".into(), true);
                let out = PathBuf::from(t.report.clone().unwrap()).with_extension("mp4");
                let _ = std::fs::remove_file(&out);
                self.export_to(out);
                self.test_words = info.to_string();
                t.step = 3; t.t0 = Instant::now();
            }
            ("voiceflow", 3) if self.export_view.is_some() || self.export_error.is_some() || t.t0.elapsed().as_secs_f64() > 180.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                let out = PathBuf::from(t.report.clone().unwrap()).with_extension("mp4");
                // 내보낸 파일을 막 닫은 직후라 한 번에 못 읽을 수 있어 몇 번 다시 잰다
                let mut ln = None;
                for _ in 0..4 {
                    let o = sermon_shorts::media::command("ffmpeg").args(["-hide_banner", "-nostats", "-i"]).arg(&out).args(["-vn", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]).output();
                    ln = o.ok().and_then(|o| sermon_shorts::voice::parse_loudnorm(&String::from_utf8_lossy(&o.stderr)));
                    if ln.is_some() { break; }
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                }
                info["exported"] = json!({ "ok": out.exists(), "err": self.export_error, "i": ln.map(|x| x.0), "tp": ln.map(|x| x.1) });
                let m = info["measured"]["i"].as_f64().unwrap_or(f64::NAN);
                let pass = m.is_finite() && m < -5.0 && m > -45.0 && info["undo"]["afterUndo"] == "off" && info["undo"]["afterRedo"] == "auto"
                    && info["manual12"]["maxPeakDb"].as_f64().is_some_and(|p| p <= -1.3 && p > -12.0)
                    && ln.is_some_and(|(i, tp, _)| (i + 14.0).abs() < 2.0 && tp <= -0.9);
                info["pass"] = json!(pass);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                t.step = 9;
            }            // 배경음악: 고르기 창 → 쓰기 → 받기·풀기 → 구간·맞추기·크기 → 영상과 함께 재생(섞임) → 빼기 되돌리기 → 출처 → 내보내기
            ("bgmflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => { self.design_tab = DesignTab::Music; self.open_bgm_lib(); t.step = 1; t.t0 = Instant::now(); }
            ("bgmflow", 1) if t.t0.elapsed().as_secs_f64() > 1.5 => { shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false); t.step = 2; t.t0 = Instant::now(); }
            ("bgmflow", 2) if t.t0.elapsed().as_secs_f64() > 1.0 => { self.use_bgm("meditation-impromptu-01"); t.step = 3; t.t0 = Instant::now(); }
            ("bgmflow", 3) if self.player.bgm.lock().map(|b| b.is_some()).unwrap_or(false) || t.t0.elapsed().as_secs_f64() > 90.0 => {
                let ready = t.t0.elapsed().as_secs_f64();
                self.change_bgm_test(12.5, "end", 0.35);
                let plan = self.bgm_value().and_then(|b| sermon_shorts::bgm::plan(&b, sermon_shorts::edl::segments_duration(&self.segs)));
                self.test_words = json!({ "readySecs": ready, "mixReady": self.player.bgm.lock().map(|b| b.is_some()).unwrap_or(false), "plan": plan.map(|p| p.to_json()), "bgm": self.bgm_value() }).to_string();
                // 끝에 맞춘 음악이 나오는 곳에서 재생 (영상 끝에서 8초 전)
                let od = sermon_shorts::edl::segments_duration(&self.segs);
                self.audio.max_bgm_peak = 0.0;
                self.player.seek((od - 8.0).max(0.0)); self.player.play();
                t.step = 4; t.t0 = Instant::now();
            }
            ("bgmflow", 4) if t.t0.elapsed().as_secs_f64() > 4.0 => {
                self.player.stop();
                shot(ctx, std::env::var("SS_SHOT3").ok().map(PathBuf::from), false);
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["mixedPeak"] = json!(self.audio.max_bgm_peak);
                // 빼기 → 되돌리기
                self.push_undo(); self.project.rest.remove("bgm"); self.push_undo();
                let removed = self.bgm_value().is_none();
                self.undo();
                info["undo"] = json!({ "removed": removed, "back": self.bgm_value().map(|b| b["id"].clone()) });
                info["credit"] = json!(self.bgm_credit());
                let out = PathBuf::from(t.report.clone().unwrap()).with_extension("mp4");
                let _ = std::fs::remove_file(&out);
                self.export_to(out);
                self.test_words = info.to_string();
                t.step = 5; t.t0 = Instant::now();
            }
            ("bgmflow", 5) if self.export_view.is_some() || self.export_error.is_some() || t.t0.elapsed().as_secs_f64() > 180.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                let out = PathBuf::from(t.report.clone().unwrap()).with_extension("mp4");
                let pr = sermon_shorts::media::probe(&out).ok();
                // 내보낸 영상의 마지막 8초 소리 크기 (음악이 섞였으면 말소리만보다 크다)
                let vol = |p: &std::path::Path, ss: f64| -> Option<f64> { let o = sermon_shorts::media::command("ffmpeg").args(["-hide_banner", "-ss", &format!("{ss:.3}"), "-i"]).arg(p).args(["-vn", "-af", "volumedetect", "-f", "null", "-"]).output().ok()?; let s = String::from_utf8_lossy(&o.stderr).to_string(); s.split("mean_volume:").nth(1)?.split("dB").next()?.trim().parse().ok() };
                let od = pr.as_ref().map(|p| p.duration).unwrap_or(0.0);
                info["exported"] = json!({ "ok": out.exists(), "duration": od, "err": self.export_error, "meanTailDb": vol(&out, (od - 8.0).max(0.0)) });
                // 고른 구간(200.5초)이 영상보다 길고 끝에 맞추므로: 지연 없이 곡 끝에서 영상 길이만큼
                let plan_ok = info["plan"]["delay"].as_f64() == Some(0.0) && info["plan"]["from"].as_f64().zip(info["plan"]["length"].as_f64()).is_some_and(|(f, l)| (f + l - 213.0).abs() < 1e-6) && info["plan"]["volume"] == 0.35;
                info["pass"] = json!(info["mixReady"] == true && plan_ok && info["mixedPeak"].as_f64().is_some_and(|p| p > 0.01) && info["undo"]["removed"] == true && info["undo"]["back"] == "meditation-impromptu-01"
                    && info["credit"].as_str().is_some_and(|c| c.contains("Kevin MacLeod")) && out.exists() && od > 100.0);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                t.step = 9;
            }            // 배경음악 관리: 내 파일 넣기 → 유튜브 받기 → 이름·분위기 바꾸기 → 쓰기 → 지우기 (SS_BGM_LIBRARY 임시 보관함)
            ("bgmmgr", 0) if t.t0.elapsed().as_secs_f64() > 2.0 => {
                self.open_bgm_manager();
                let tone = std::env::temp_dir().join("ss 시험 음악.mp3");
                let _ = sermon_shorts::media::command("ffmpeg").args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=6", "-ac", "2"]).arg(&tone).output();
                let r = sermon_shorts::bgm::import_file(&tone);
                self.test_words = json!({ "file": r.as_ref().map(|(t, _)| t.title.clone()).map_err(|e| e.clone()) }).to_string();
                self.reload_custom();
                self.mgr_add_urls("https://www.youtube.com/watch?v=jNQXAC9IVRw");
                t.step = 1; t.t0 = Instant::now();
            }
            ("bgmmgr", 1) if (!self.bgm.shared.queue.lock().unwrap().iter().any(|x| matches!(x.state, crate::ui_bgm::QState::Wait | crate::ui_bgm::QState::Busy)) && t.t0.elapsed().as_secs_f64() > 1.0) || t.t0.elapsed().as_secs_f64() > 120.0 => {
                self.reload_custom();
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                let q = self.bgm.shared.queue.lock().unwrap().clone();
                info["queue"] = json!(q.iter().map(|x| json!({ "title": x.title, "state": format!("{:?}", x.state), "msg": x.msg })).collect::<Vec<_>>());
                let tracks = self.bgm.custom.clone();
                info["tracks"] = json!(tracks.iter().map(|t| json!({ "id": t.id, "title": t.title, "kind": t.kind, "dur": t.duration_sec, "file": t.file.as_ref().map(|f| f.file_name().unwrap_or_default().to_string_lossy().to_string()) })).collect::<Vec<_>>());
                // 이름·분위기 바꾸기
                if let Some(f) = tracks.iter().find(|t| t.kind == "file") {
                    let r = sermon_shorts::bgm::update_custom(&f.id, Some("새 이름 시험곡"), Some("찬송가 연주"));
                    info["renamed"] = json!(r.as_ref().map(|t| json!({ "title": t.title, "mood": t.mood, "file": t.file.as_ref().map(|x| x.file_name().unwrap_or_default().to_string_lossy().to_string()), "exists": t.file.as_ref().is_some_and(|x| x.exists()) })).map_err(|e| e.clone()));
                }
                self.reload_custom();
                t.step = 2; t.t0 = Instant::now();
                self.test_words = info.to_string();
            }
            ("bgmmgr", 2) if t.t0.elapsed().as_secs_f64() > 1.5 => { shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false); t.step = 3; t.t0 = Instant::now(); }
            ("bgmmgr", 3) if t.t0.elapsed().as_secs_f64() > 1.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                let yt = self.bgm.custom.iter().find(|t| t.kind == "youtube").cloned();
                if let Some(y) = &yt { self.use_bgm(&y.id); }
                info["used"] = json!(self.bgm_value().map(|b| b["id"].clone()));
                let f = self.bgm.custom.iter().find(|t| t.kind == "file").cloned();
                let removed = f.as_ref().map(|f| { let file = f.file.clone(); let ok = sermon_shorts::bgm::remove_custom(&f.id); (ok, file.is_some_and(|x| !x.exists())) });
                self.reload_custom();
                info["removed"] = json!(removed);
                info["after"] = json!(self.bgm.custom.len());
                let ok = info["file"]["Ok"].is_string() && info["tracks"].as_array().is_some_and(|a| a.len() == 2) && info["renamed"]["Ok"]["title"] == "새 이름 시험곡" && info["renamed"]["Ok"]["mood"] == "찬송가 연주"
                    && info["renamed"]["Ok"]["file"].as_str().is_some_and(|f| f.starts_with("새 이름 시험곡")) && info["renamed"]["Ok"]["exists"] == true
                    && yt.as_ref().is_some_and(|y| info["used"] == json!(y.id) && y.file.as_ref().is_some_and(|f| f.file_name().unwrap_or_default().to_string_lossy().starts_with("Me at the zoo"))) && info["removed"] == json!([true, true]) && info["after"] == 1;
                info["pass"] = json!(ok);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                t.step = 9;
            }            // 재생 중 목록 따라가기: 휠로 직접 움직이면 멈추고 [재생 위치로] 단추 → 누르면 다시 따라감 (기존 editor.js)
            ("followflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                self.t_key(egui::Key::Space, egui::Modifiers::NONE);
                t.step = 1; t.t0 = Instant::now();
            }
            ("followflow", 1) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 1.0 => {
                let c = self.list_rect.center();
                self.test_words = json!({ "playing": self.player.playing(), "follow0": self.follow_play }).to_string();
                self.t_queue(vec![egui::Event::PointerMoved(c)], egui::Modifiers::NONE);
                for _ in 0..3 { self.t_queue(vec![egui::Event::MouseWheel { unit: egui::MouseWheelUnit::Point, delta: egui::vec2(0.0, -400.0), phase: egui::TouchPhase::Move, source: egui::MouseWheelSource::Wheel, modifiers: egui::Modifiers::NONE }], egui::Modifiers::NONE); }
                t.step = 2; t.t0 = Instant::now();
            }
            ("followflow", 2) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.8 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["afterWheel"] = json!(self.follow_play);
                shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false);
                let w = 10.0 + 14.0 + 5.0 + 62.0 + 10.0;
                let p = egui::pos2(self.list_rect.right() - 34.0 - w / 2.0, self.list_rect.bottom() - 26.0 - 14.0);
                self.t_click(p, egui::Modifiers::NONE);
                self.test_words = info.to_string();
                t.step = 3; t.t0 = Instant::now();
            }
            ("followflow", 3) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 1.5 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["afterButton"] = json!(self.follow_play);
                // 지금 재생 중인 칸이 보이는지
                let now = self.player.src_now();
                let vis = self.word_rects.iter().filter(|(i, r)| { let w = &self.project.words[*i]; !w.del && now >= w.start - 0.3 && now <= w.end + 0.3 && self.list_rect.intersects(*r) }).count();
                info["activeVisible"] = json!(vis > 0);
                shot(ctx, std::env::var("SS_SHOT3").ok().map(PathBuf::from), false);
                self.player.stop();
                info["pass"] = json!(info["playing"] == true && info["follow0"] == true && info["afterWheel"] == false && info["afterButton"] == true && info["activeVisible"] == true);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }            // 파형: 재생 중 누르면 멈추고 그 자리로 → 끌면 따라오고 → 놓으면 다시 재생. 멈춘 채 누르면 그 자리로 (기존 waveform.js·app.js)
            ("waveflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                self.t_key(egui::Key::Space, egui::Modifiers::NONE);
                t.step = 1; t.t0 = Instant::now();
            }
            ("waveflow", 1) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.8 => {
                let r = self.wave.rect.unwrap();
                let x_of = |s: &App, tt: f64| r.left() + ((tt - s.wave.view_start) / s.wave.view_dur) as f32 * r.width();
                let y = r.center().y + 20.0;
                let (p1, p2) = (egui::pos2(x_of(self, 60.0), y), egui::pos2(x_of(self, 90.0), y));
                self.test_words = json!({ "playing0": self.player.playing(), "x1": p1.x, "x2": p2.x }).to_string();
                let n = egui::Modifiers::NONE;
                self.t_queue(vec![egui::Event::PointerMoved(p1)], n);
                self.t_queue(vec![egui::Event::PointerButton { pos: p1, button: egui::PointerButton::Primary, pressed: true, modifiers: n }], n);
                t.step = 2; t.t0 = Instant::now();
            }
            ("waveflow", 2) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.4 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["pressPaused"] = json!(!self.player.playing());
                info["pressAt"] = json!(self.player.src_now());
                let y = self.wave.rect.unwrap().center().y + 20.0;
                let x2 = info["x2"].as_f64().unwrap() as f32; let x1 = info["x1"].as_f64().unwrap() as f32;
                for k in 1..=6 { let x = x1 + (x2 - x1) * k as f32 / 6.0; self.t_queue(vec![egui::Event::PointerMoved(egui::pos2(x, y))], egui::Modifiers::NONE); }
                self.test_words = info.to_string();
                t.step = 3; t.t0 = Instant::now();
            }
            ("waveflow", 3) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.4 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["dragPaused"] = json!(!self.player.playing());
                info["dragAt"] = json!(self.wave.scrub_t);
                let p = egui::pos2(info["x2"].as_f64().unwrap() as f32, self.wave.rect.unwrap().center().y + 20.0);
                self.t_queue(vec![egui::Event::PointerButton { pos: p, button: egui::PointerButton::Primary, pressed: false, modifiers: egui::Modifiers::NONE }], egui::Modifiers::NONE);
                self.test_words = info.to_string();
                t.step = 4; t.t0 = Instant::now();
            }
            ("waveflow", 4) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.5 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["releasePlaying"] = json!(self.player.playing());
                info["releaseAt"] = json!(self.player.src_now());
                self.player.stop();
                // 멈춘 채 누르기 → 그 자리로 (재생은 안 함)
                let r = self.wave.rect.unwrap();
                let x = r.left() + ((30.0 - self.wave.view_start) / self.wave.view_dur) as f32 * r.width();
                self.t_click(egui::pos2(x, r.center().y + 20.0), egui::Modifiers::NONE);
                self.test_words = info.to_string();
                t.step = 5; t.t0 = Instant::now();
            }
            ("waveflow", 5) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.5 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["clickAt"] = json!(self.player.src_now());
                info["clickPlaying"] = json!(self.player.playing());
                let near = |k: &str, v: f64, tol: f64| info[k].as_f64().is_some_and(|x| (x - v).abs() < tol);
                let ok = info["playing0"] == true && info["pressPaused"] == true && near("pressAt", 60.0, 0.6) && info["dragPaused"] == true && near("dragAt", 90.0, 0.6)
                    && info["releasePlaying"] == true && near("releaseAt", 90.0, 1.2) && near("clickAt", 30.0, 0.6) && info["clickPlaying"] == false;
                info["pass"] = json!(ok);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }            // 창 바깥 어두운 곳을 누르면 닫힘 (창 안에서 누르고 바깥에서 놓으면 안 닫힘) — 기존 app.js
            ("backdropflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                self.t_key(egui::Key::F1, egui::Modifiers::NONE);
                t.step = 1; t.t0 = Instant::now();
            }
            ("backdropflow", 1) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.6 => {
                self.test_words = json!({ "helpOpen": self.help_open }).to_string();
                // 창 안 가운데에서 누르고 바깥(왼쪽 아래)에서 놓기
                let sr = ctx.content_rect();
                let (inside, outside) = (sr.center(), egui::pos2(sr.left() + 30.0, sr.bottom() - 30.0));
                let n = egui::Modifiers::NONE;
                self.t_queue(vec![egui::Event::PointerMoved(inside)], n);
                self.t_queue(vec![egui::Event::PointerButton { pos: inside, button: egui::PointerButton::Primary, pressed: true, modifiers: n }], n);
                self.t_queue(vec![egui::Event::PointerMoved(outside)], n);
                self.t_queue(vec![egui::Event::PointerButton { pos: outside, button: egui::PointerButton::Primary, pressed: false, modifiers: n }], n);
                self.t_queue(vec![], n);
                t.step = 2; t.t0 = Instant::now();
            }
            ("backdropflow", 2) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.6 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["afterDragOut"] = json!(self.help_open);
                let sr = ctx.content_rect();
                self.t_click(egui::pos2(sr.left() + 30.0, sr.bottom() - 30.0), egui::Modifiers::NONE);
                self.test_words = info.to_string();
                t.step = 3; t.t0 = Instant::now();
            }
            ("backdropflow", 3) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.6 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["afterBackdrop"] = json!(self.help_open);
                self.open_settings("general");
                self.test_words = info.to_string();
                t.step = 4; t.t0 = Instant::now();
            }
            ("backdropflow", 4) if t.t0.elapsed().as_secs_f64() > 0.8 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["prefsOpen"] = json!(self.prefs.open.is_some());
                let sr = ctx.content_rect();
                self.t_click(egui::pos2(sr.left() + 30.0, sr.bottom() - 30.0), egui::Modifiers::NONE);
                self.test_words = info.to_string();
                t.step = 5; t.t0 = Instant::now();
            }
            ("backdropflow", 5) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.6 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["prefsAfter"] = json!(self.prefs.open.is_some());
                self.cmd_youtube();
                self.test_words = info.to_string();
                t.step = 6; t.t0 = Instant::now();
            }
            ("backdropflow", 6) if t.t0.elapsed().as_secs_f64() > 0.8 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["urlOpen"] = json!(self.import.dlg.is_some());
                let sr = ctx.content_rect();
                self.t_click(egui::pos2(sr.left() + 30.0, sr.bottom() - 30.0), egui::Modifiers::NONE);
                self.test_words = info.to_string();
                t.step = 7; t.t0 = Instant::now();
            }
            ("backdropflow", 7) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.6 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["urlAfter"] = json!(self.import.dlg.is_some());
                info["pass"] = json!(info["helpOpen"] == true && info["afterDragOut"] == true && info["afterBackdrop"] == false && info["prefsOpen"] == true && info["prefsAfter"] == false && info["urlOpen"] == true && info["urlAfter"] == false);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }            // 메뉴: 파일을 눌러 연 뒤 편집 위로 마우스만 옮기면 편집 메뉴가 열린다 (기존 layout.js)
            ("menuflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                self.t_click(egui::pos2(237.0, 31.0), egui::Modifiers::NONE);
                t.step = 1; t.t0 = Instant::now();
            }
            ("menuflow", 1) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.6 => {
                self.test_words = json!({ "fileOpen": egui::Popup::is_any_open(ctx) }).to_string();
                shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false);
                for k in 0..6 { self.t_queue(vec![egui::Event::PointerMoved(egui::pos2(237.0 + 9.0 * (k + 1) as f32, 31.0))], egui::Modifiers::NONE); }
                t.step = 2; t.t0 = Instant::now();
            }
            ("menuflow", 2) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.6 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["afterHover"] = json!(egui::Popup::is_any_open(ctx));
                shot(ctx, std::env::var("SS_SHOT3").ok().map(PathBuf::from), false);
                info["pass"] = json!(info["fileOpen"] == true && info["afterHover"] == true);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }            // AI 연결: 왼쪽 [AI 연결] 누르기 → 상태 카드 → 제미나이에 틀린 키 저장(돈 안 드는 오류 확인) → 챗GPT [이 AI 로 대화하기] → 닫기 (임시 SS_USER_DATA_DIR 복사본)
            // 시스템 점검: 메뉴 → 점검 창 → (빈 런타임 폴더라 엔진 없음) [엔진 설치] → 실제 설치 스크립트를 -DryRun 으로 돌린 진행·완료 글 → 닫기
            ("sysflow", 0) if t.t0.elapsed().as_secs_f64() > 1.5 => {
                self.open_syscheck();
                t.step = 1; t.t0 = Instant::now();
            }
            ("sysflow", 1) if !self.sys.rows.is_empty() && self.test_words.is_empty() => { self.test_words = "rows".into(); t.t0 = Instant::now(); }
            ("sysflow", 1) if self.test_words == "rows" && self.sys.rects.iter().any(|x| x.0.ends_with(":install-engine")) && t.t0.elapsed().as_secs_f64() > 0.8 || t.step == 1 && t.t0.elapsed().as_secs_f64() > 40.0 => {
                shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false);
                let rows: Vec<Value> = self.sys.rows.iter().map(sermon_shorts::syscheck::row_json).collect();
                let mut info = json!({ "open": self.sys.open, "rows": rows, "progress": [] });
                let clip = self.sys.rects.iter().find(|x| x.0 == "clip").map(|x| x.1).unwrap_or(egui::Rect::EVERYTHING);
                match self.sys.rects.iter().find(|x| x.0.ends_with(":install-engine")).map(|x| x.1) {
                    Some(r) if !clip.contains_rect(r) && t.t0.elapsed().as_secs_f64() < 20.0 => {
                        self.t_queue(vec![egui::Event::PointerMoved(clip.center()), egui::Event::MouseWheel { unit: egui::MouseWheelUnit::Point, delta: egui::vec2(0.0, -120.0), phase: egui::TouchPhase::Move, source: egui::MouseWheelSource::Wheel, modifiers: egui::Modifiers::NONE }], egui::Modifiers::NONE);
                        self.t_queue(vec![], egui::Modifiers::NONE);
                        return self.test = Some(test);
                    }
                    Some(r) => self.t_click(r.center(), egui::Modifiers::NONE),
                    None => { info["noInstallBtn"] = json!(true); }
                }
                self.test_words = info.to_string();
                t.step = 2; t.t0 = Instant::now();
            }
            ("sysflow", 2) => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                let id = self.sys.rows.iter().find(|r| r.actions.iter().any(|a| a.contains("engine"))).map(|r| r.id.to_string()).unwrap_or_else(|| "python".into());
                if let Some((None, m)) = self.sys.results.get(&id) { let p = info["progress"].as_array_mut().unwrap(); if p.last().and_then(|x| x.as_str()) != Some(m.as_str()) { p.push(json!(m)); } }
                info["installingSeen"] = json!(info["installingSeen"].as_bool().unwrap_or(false) || self.sys.installing);
                let done = matches!(self.sys.results.get(&id), Some((Some(_), _))) && !self.sys.installing && self.sys.rx.is_none();
                if done && info["doneSeen"] != true { info["doneSeen"] = json!(true); t.t0 = Instant::now(); }
                if done && info["doneSeen"] == true && t.t0.elapsed().as_secs_f64() > 0.8 && !self.sys.rows.is_empty() || t.t0.elapsed().as_secs_f64() > 90.0 {
                    info["result"] = json!(self.sys.results.get(&id).map(|r| json!([r.0, r.1])));
                    shot(ctx, std::env::var("SS_SHOT3").ok().map(PathBuf::from), false);
                    if let Some(r) = self.sys.rects.iter().find(|x| x.0 == "close").map(|x| x.1) { self.t_click(r.center(), egui::Modifiers::NONE); }
                    t.step = 3; t.t0 = Instant::now();
                }
                self.test_words = info.to_string();
            }
            ("sysflow", 3) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.8 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["closed"] = json!(!self.sys.open);
                let eng = info["rows"].as_array().and_then(|a| a.iter().find(|r| r["actions"].as_array().is_some_and(|x| x.iter().any(|y| y == "install-engine")))).cloned().unwrap_or(json!(null));
                info["pass"] = json!(info["open"] == true && eng["status"] != "ok" && info["installingSeen"] == true
                    && info["result"][0] == true && info["result"][1].as_str().unwrap_or("").contains("DryRun")
                    && info["progress"].as_array().is_some_and(|p| !p.is_empty()) && info["closed"] == true);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
            // AI 편집 대화: 편집기 영상(유튜브 주소 있음)으로 대화 → [구간 추천] → 후보 [이 구간으로 만들기] → 편집기 반영(공백 줄이기 포함) → 같은 구간이면 제목만 → [새로](자동 저장·다시 열기). AI 답은 SS_TEST_LLM_ANSWERS 의 가짜 답
            ("chatflow", 0) if t.t0.elapsed().as_secs_f64() > 2.0 => {
                if let Some(s) = self.project.rest.get_mut("source") { s["url"] = json!("https://youtu.be/uSE5pZB3gtQ"); s["title"] = json!("시험 설교"); }
                let ok = self.chat_use_editor_video();
                self.test_words = json!({ "useEditor": ok, "words": self.chat.video.as_ref().map(|v| v.words), "total": self.project.words.len() }).to_string();
                t.step = 1; t.t0 = Instant::now();
            }
            ("chatflow", 1) if t.t0.elapsed().as_secs_f64() > 1.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                match self.chat.rects.iter().find(|x| x.0 == "act:recommend").map(|x| x.1) { Some(r) => self.t_click(r.center(), egui::Modifiers::NONE), None => { info["noRecommend"] = json!(true); } }
                self.test_words = info.to_string();
                t.step = 2; t.t0 = Instant::now();
            }
            ("chatflow", 2) if self.test_input.is_empty() && !self.chat_busy() && self.chat.rects.iter().any(|x| x.0 == "pick:1") && t.t0.elapsed().as_secs_f64() > 1.5 || t.step == 2 && t.t0.elapsed().as_secs_f64() > 30.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["cands"] = json!(self.chat.msgs.iter().filter(|m| matches!(m, crate::ui_chat::M::Cand { .. })).count());
                shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false);
                match self.t_stable_rect("pick:1") { Some(r) => self.t_click(r.center(), egui::Modifiers::NONE), None if t.t0.elapsed().as_secs_f64() < 25.0 => return self.test = Some(test), None => { info["noPick"] = json!(true); } }
                self.test_words = info.to_string();
                t.step = 3; t.t0 = Instant::now();
            }
            ("chatflow", 3) if self.test_input.is_empty() && !self.chat_busy() && self.chat.rects.iter().any(|x| x.0 == "act:title") && t.t0.elapsed().as_secs_f64() > 1.5 || t.step == 3 && t.t0.elapsed().as_secs_f64() > 90.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                let w = &self.project.words;
                info["kept"] = json!(w.iter().filter(|x| !x.del).count());
                info["outsideKept"] = json!(w.iter().enumerate().filter(|(i, x)| !x.del && !((12..=40).contains(i) || (50..=80).contains(i))).count());
                info["corr"] = json!(w.get(13).map(|x| x.text.clone()));
                info["title"] = json!(self.title); info["verse"] = json!(self.verse);
                info["gapCuts"] = json!(w.iter().filter(|x| x.extra.contains_key("gapCut")).count());
                info["dur"] = json!(edl::segments_duration(&self.segs));
                info["msgs"] = json!(self.chat.msgs.iter().map(|m| serde_json::to_value(m).ok().and_then(|v| v["k"].as_str().map(String::from)).unwrap_or_default()).collect::<Vec<_>>());
                info["replayText"] = json!(self.chat.msgs.iter().rev().find_map(|m| if let crate::ui_chat::M::Replay { t, .. } = m { Some(t.clone()) } else { None }));
                info["edited"] = json!(self.chat.video.as_ref().map(|v| v.edited));
                match self.t_stable_rect("act:title") { Some(r) => self.t_click(r.center(), egui::Modifiers::NONE), None if t.t0.elapsed().as_secs_f64() < 80.0 => return self.test = Some(test), None => { info["noTitleBtn"] = json!(true); } }
                self.test_words = info.to_string();
                t.step = 4; t.t0 = Instant::now();
            }
            ("chatflow", 4) if self.test_input.is_empty() && !self.chat_busy() && t.t0.elapsed().as_secs_f64() > 1.5 || t.step == 4 && t.t0.elapsed().as_secs_f64() > 30.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["title2"] = json!(self.title);
                info["kept2"] = json!(self.project.words.iter().filter(|x| !x.del).count());
                info["lastSys"] = json!(self.chat.msgs.iter().rev().find_map(|m| if let crate::ui_chat::M::Sys { t } = m { Some(t.clone()) } else { None }));
                shot(ctx, std::env::var("SS_SHOT3").ok().map(PathBuf::from), false);
                match self.t_stable_rect("new") { Some(r) => self.t_click(r.center(), egui::Modifiers::NONE), None if t.t0.elapsed().as_secs_f64() < 25.0 => return self.test = Some(test), None => { info["noNew"] = json!(true); } }
                self.test_words = info.to_string();
                t.step = 5; t.t0 = Instant::now();
            }
            ("chatflow", 5) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 1.5 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["videoAfterNew"] = json!(self.chat.video.is_some());
                let reopen = self.chat.msgs.iter().rev().find_map(|m| if let crate::ui_chat::M::Divider { reopen, .. } = m { reopen.clone() } else { None });
                info["reopenExists"] = json!(reopen.as_ref().is_some_and(|p| std::path::Path::new(p).exists()));
                info["logSaved"] = json!(sermon_shorts::theme::user_data_dir().join("chat_log.json").exists());
                let sent = std::fs::read_to_string(std::env::temp_dir().join("ss_llm_sent1.txt")).unwrap_or_default();
                info["pickPrompt"] = json!(sent.contains("1번 후보(#10~#90") && sent.contains("[편집 조건]") && sent.contains("[설교 자막]") && sent.contains("#0 ["));
                let kept = info["kept"].as_u64().unwrap_or(0);
                info["pass"] = json!(info["useEditor"] == true && info["cands"] == 2 && kept >= 40 && kept <= 60 && info["outsideKept"] == 0 && info["corr"] == "고침"
                    && info["title"] == "기도의 / 시작" && info["verse"] == "마태복음 6:13" && info["edited"] == true && info["replayText"].as_str().unwrap_or("").contains("편집기에 반영했습니다")
                    && info["title2"] == "새 제목" && info["kept2"] == info["kept"] && info["lastSys"].as_str().unwrap_or("").contains("구간은 그대로")
                    && info["videoAfterNew"] == false && info["reopenExists"] == true && info["logSaved"] == true && info["pickPrompt"] == true);
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
            ("aiflow", 0) if t.t0.elapsed().as_secs_f64() > 2.0 => {
                self.t_click(egui::pos2(44.0, 460.0), egui::Modifiers::NONE);
                t.step = 1; t.t0 = Instant::now();
            }
            ("aiflow", 1) if self.test_input.is_empty() && self.ai.status.is_some() && !self.ai.rects.is_empty() && t.t0.elapsed().as_secs_f64() > 1.0 => {
                let s = self.ai.status.clone().unwrap();
                if self.test_words.is_empty() { shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false); }
                self.test_words = json!({ "open": self.ai.open, "page": format!("{:?}", self.page), "chip0": self.ai_chip().0,
                    "status": { "active": s.active, "gpt": [s.chatgpt.connected, s.chatgpt.plan_enabled], "claude": [s.claude.installed, s.claude.logged_in], "gemini": s.gemini.has_key, "openrouter": s.openrouter.has_key } }).to_string();
                let r = self.ai.rects.iter().find(|x| x.0 == "gemKey").map(|x| x.1).unwrap();
                let clip = self.ai.rects.iter().find(|x| x.0 == "clip").map(|x| x.1).unwrap();
                // 제미나이 칸이 보일 때까지 창 안을 휠로 내린다
                if !clip.contains_rect(r.expand2(egui::vec2(0.0, 40.0))) {
                    self.t_queue(vec![egui::Event::PointerMoved(clip.center()), egui::Event::MouseWheel { unit: egui::MouseWheelUnit::Point, delta: egui::vec2(0.0, -120.0), phase: egui::TouchPhase::Move, source: egui::MouseWheelSource::Wheel, modifiers: egui::Modifiers::NONE }], egui::Modifiers::NONE);
                    self.t_queue(vec![], egui::Modifiers::NONE);
                    t.t0 = Instant::now(); // 부드러운 스크롤이 끝날 때까지
                    return self.test = Some(test);
                }
                self.t_click(r.center(), egui::Modifiers::NONE);
                self.t_text("AIzaInvalidKeyForTest000000000000000000");
                let sb = self.ai.rects.iter().find(|x| x.0 == "gmSave").map(|x| x.1).unwrap();
                self.t_click(sb.center(), egui::Modifiers::NONE);
                t.step = 2; t.t0 = Instant::now();
            }
            ("aiflow", 2) if self.test_input.is_empty() && self.ai.busy.is_none() && t.t0.elapsed().as_secs_f64() > 1.0 || t.step == 2 && t.t0.elapsed().as_secs_f64() > 60.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["gemMsg"] = json!(self.ai.msg);
                info["rects"] = json!(self.ai.rects.iter().map(|(n, r)| json!([n, r.left(), r.top(), r.right(), r.bottom()])).collect::<Vec<_>>());
                info["ppp"] = json!(ctx.pixels_per_point());
                info["focused"] = json!(ctx.memory(|m| m.focused().is_some()));
                let clip = self.ai.rects.iter().find(|x| x.0 == "clip").map(|x| x.1).unwrap();
                match self.ai.rects.iter().find(|x| x.0 == "use:chatgpt").map(|x| x.1) {
                    Some(r) if !clip.contains_rect(r) => {
                        self.t_queue(vec![egui::Event::PointerMoved(clip.center()), egui::Event::MouseWheel { unit: egui::MouseWheelUnit::Point, delta: egui::vec2(0.0, 120.0), phase: egui::TouchPhase::Move, source: egui::MouseWheelSource::Wheel, modifiers: egui::Modifiers::NONE }], egui::Modifiers::NONE);
                        self.t_queue(vec![], egui::Modifiers::NONE);
                        self.test_words = info.to_string();
                        t.t0 = Instant::now();
                        return self.test = Some(test);
                    }
                    Some(r) => self.t_click(r.center(), egui::Modifiers::NONE),
                    None => { info["noUseBtn"] = json!(true); }
                }
                self.test_words = info.to_string();
                t.step = 3; t.t0 = Instant::now();
            }
            ("aiflow", 3) if self.test_input.is_empty() && self.ai.busy.is_none() && t.t0.elapsed().as_secs_f64() > 1.0 || t.step == 3 && t.t0.elapsed().as_secs_f64() > 40.0 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["activeAfter"] = json!(self.ai.status.as_ref().and_then(|s| s.active.clone()));
                info["savedProvider"] = sermon_shorts::settings::load()["aiProvider"].clone();
                shot(ctx, std::env::var("SS_SHOT3").ok().map(PathBuf::from), false);
                let r = self.ai.rects.iter().find(|x| x.0 == "close").map(|x| x.1).unwrap();
                self.t_click(r.center(), egui::Modifiers::NONE);
                self.test_words = info.to_string();
                t.step = 4; t.t0 = Instant::now();
            }
            ("aiflow", 4) if self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.8 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                info["closed"] = json!(!self.ai.open);
                info["chip"] = json!(self.ai_chip().0);
                let gm = info["gemMsg"].as_str().unwrap_or("");
                info["pass"] = json!(info["open"] == true && info["page"] == "Editor" && info["status"]["gpt"] == json!([true, true])
                    && gm.contains("연결 확인에 실패") && gm.contains("제미나이 키가 올바르지 않습니다")
                    && info["activeAfter"] == "chatgpt" && info["savedProvider"] == "chatgpt" && info["closed"] == true && info["chip"] == "챗GPT 연결됨");
                if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }            // 누르기·두 번 누르기·단축키 (실제 입력과 같은 사건을 넣는다): 기존 editor.js·caption-blocks.js·keymap.js 동작
            ("clickflow", 0) if t.t0.elapsed().as_secs_f64() > 3.0 => {
                let b = self.blocks.iter().filter(|b| b.line.is_some()).nth(1).cloned().unwrap();
                let i = b.from;
                let r = self.t_word(i).unwrap();
                self.test_words = json!({ "block": [b.from, b.to], "i": i }).to_string();
                self.t_click(egui::pos2(r.left() + r.width() * 0.25, r.center().y), egui::Modifiers::NONE);
                t.step = 1; t.t0 = Instant::now();
            }
            ("clickflow", s) if (1..=13).contains(&s) && self.test_input.is_empty() && t.t0.elapsed().as_secs_f64() > 0.6 => {
                let mut info: Value = serde_json::from_str(&self.test_words).unwrap_or(json!({}));
                let i = info["i"].as_u64().unwrap() as usize;
                let (bf, bt) = (info["block"][0].as_u64().unwrap() as usize, info["block"][1].as_u64().unwrap() as usize);
                let half = |r: egui::Rect, right: bool| egui::pos2(if right { r.left() + r.width() * 0.8 } else { r.left() + r.width() * 0.2 }, r.center().y);
                let nm = egui::Modifiers::NONE;
                match s {
                    1 => { info["click"] = json!({ "caret": self.caret, "sel": self.selection.is_none(), "seek": (self.player.src_now() - self.project.words[i].start).abs() < 0.06 }); let r = self.t_word(i + 1).unwrap(); self.t_click(half(r, true), nm); }
                    2 => { info["right"] = json!(self.caret == i + 2); let r = self.t_word(i + 3).unwrap(); info["dbg2"] = json!([r.left(), r.top()]); self.t_click(half(r, true), egui::Modifiers::SHIFT); }
                    3 => { info["shift"] = json!(self.selection); info["dbg3"] = json!({ "caret": self.caret, "anchor": self.sel_anchor, "trim": self.trim.is_some(), "w3": self.t_word(i + 3).map(|r| [r.left(), r.top()]) }); let r = self.t_word(i).unwrap(); self.t_dbl(r.center()); }
                    4 => { info["dblWord"] = json!(self.trim.as_ref().map(|tr| (tr.range, tr.idx_a, tr.idx_b))); self.t_key(egui::Key::Enter, nm); }
                    5 => { info["dbg5"] = json!({ "outRect": self.out_rects.iter().find(|(f, _)| *f == bf).map(|x| [x.1.left(), x.1.top()]) }); info["enterTrim"] = json!(self.trim.is_none() && self.player.playing() && self.trim_loop.is_some()); let r = self.out_rects.iter().find(|(f, _)| *f == bf).unwrap().1; self.t_dbl(egui::pos2(r.left() + 30.0, r.center().y)); }
                    6 => {
                        info["dblOut"] = json!(self.trim.as_ref().map(|tr| (tr.range, tr.idx_a, tr.idx_b)));
                        info["outBlur"] = json!(ctx.memory(|m| m.focused()).is_none());
                        info["dbg6"] = json!({ "playing": self.player.playing(), "toast": self.toast.as_ref().map(|x| x.0.clone()), "trim": self.trim.is_some(), "outRect": self.out_rects.iter().find(|(f, _)| *f == bf).map(|x| [x.1.left(), x.1.top()]) });
                        if self.trim.is_some() { info["h0"] = json!(self.a_end() + self.b_start()); }
                        self.t_key(egui::Key::ArrowRight, nm);
                        let nb = self.blocks.iter().filter(|b| b.line.is_some()).nth(2).cloned().unwrap();
                        info["nextBlock"] = json!(nb.from);
                    }
                    7 => {
                        info["arrowNudge"] = json!(self.trim.is_some() && info["h0"].as_f64().is_some_and(|h0| (self.a_end() + self.b_start() - h0).abs() > 0.005));
                        self.t_key(egui::Key::Escape, nm);
                        let nf = info["nextBlock"].as_u64().unwrap() as usize;
                        let r = self.out_rects.iter().find(|(f, _)| *f == nf).unwrap().1;
                        self.t_click(egui::pos2(r.left() + 30.0, r.center().y), nm);
                    }
                    8 => {
                        info["escTrim"] = json!(self.trim.is_none());
                        let nf = info["nextBlock"].as_u64().unwrap() as usize;
                        let li = self.blocks.iter().find(|b| b.from == nf).and_then(|b| b.line).unwrap();
                        let want = edl::out_to_src(&self.segs, self.lines[li].out_start).map(|x| x.1).unwrap_or(0.0);
                        info["outFocus"] = json!({ "seek": (self.player.src_now() - want).abs() < 0.06, "paused": !self.player.playing() });
                        self.t_key(egui::Key::Escape, nm);
                        let r = self.t_word(i).unwrap(); self.t_click(half(r, false), nm);
                        self.t_key(egui::Key::ArrowRight, nm); self.t_key(egui::Key::ArrowRight, nm);
                    }
                    9 => { info["arrows"] = json!(self.caret == i + 2); self.t_key(egui::Key::D, nm); }
                    10 => { info["dKey"] = json!(self.project.words[i + 2].del); info["hide0"] = json!(self.hide_deleted); self.t_key(egui::Key::Z, egui::Modifiers::COMMAND); self.t_key(egui::Key::H, nm); }
                    11 => { info["undo"] = json!(!self.project.words[i + 2].del); info["hKey"] = json!(self.hide_deleted != info["hide0"].as_bool().unwrap_or(false)); self.t_key(egui::Key::H, nm); self.t_key(egui::Key::F1, nm); }
                    12 => { info["help"] = json!(self.help_open); shot(ctx, std::env::var("SS_SHOT2").ok().map(PathBuf::from), false); self.t_key(egui::Key::Escape, nm); self.t_key(egui::Key::F, egui::Modifiers::COMMAND); self.t_queue(vec![], nm); self.t_text("영광"); }
                    _ => {
                        let f = self.find.as_ref();
                        info["find"] = json!({ "open": f.is_some(), "matches": f.map(|f| f.matches.len()), "caret": self.caret, "first": f.and_then(|f| f.matches.first().copied()) });
                        info["helpClosed"] = json!(!self.help_open);
                        shot(ctx, std::env::var("SS_SHOT3").ok().map(PathBuf::from), false);
                        let ok = info["click"]["caret"] == i && info["click"]["sel"] == true && info["click"]["seek"] == true && info["right"] == true && info["shift"] == json!([i + 2, i + 4])
                            && info["dblWord"][0] == true && info["dblWord"][1] == bf && info["dblWord"][2].as_u64() == Some((bt - 1) as u64) && info["escTrim"] == true && info["enterTrim"] == true && info["hKey"] == true && info["outBlur"] == true && info["arrowNudge"] == true
                            && info["dblOut"][0] == true && info["dblOut"][1] == bf && info["outFocus"]["seek"] == true && info["arrows"] == true && info["dKey"] == true && info["undo"] == true && info["help"] == true
                            && info["find"]["open"] == true && info["find"]["matches"].as_u64().is_some_and(|n| n > 0) && info["find"]["caret"] == info["find"]["first"] && info["helpClosed"] == true;
                        info["pass"] = json!(ok);
                        if let Some(p) = &t.report { let _ = std::fs::write(p, serde_json::to_string_pretty(&info).unwrap()); }
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                }
                self.test_words = info.to_string();
                t.step = s + 1; t.t0 = Instant::now();
            }            // 화면 찍기: 다른 창에 가려져도 앱이 그린 그대로 PNG 로 (--test shot --report 경로.png)
            ("shot", 0) if t.t0.elapsed().as_secs_f64() > 5.0 => {
                let out = t.report.clone(); let c2 = ctx.clone();
                ctx.request_screenshot(move |img| {
                    if let Some(p) = out { let [w, h] = img.size; let mut buf = Vec::with_capacity(w * h * 4); for px in &img.pixels { buf.extend_from_slice(&px.to_array()); }
                        let _ = image::save_buffer(&p, &buf, w as u32, h as u32, image::ColorType::Rgba8); }
                    c2.send_viewport_cmd(egui::ViewportCommand::Close);
                });
                t.step = 1;
            }
            _ => {}
        }
        self.test = Some(test);
    }
}

/// 앱이 그린 화면을 PNG 로 (close 면 찍은 뒤 창을 닫는다)
pub(crate) fn shot(ctx: &egui::Context, out: Option<PathBuf>, close: bool) {
    let c2 = ctx.clone();
    ctx.request_screenshot(move |img| {
        if let Some(p) = out { let [w, h] = img.size; let mut buf = Vec::with_capacity(w * h * 4); for px in &img.pixels { buf.extend_from_slice(&px.to_array()); }
            let _ = image::save_buffer(&p, &buf, w as u32, h as u32, image::ColorType::Rgba8); }
        if close { c2.send_viewport_cmd(egui::ViewportCommand::Close); }
    });
}

/// 시험용 가짜 입력 (한 화면에 한 묶음씩)
impl App {
    fn t_queue(&mut self, ev: Vec<egui::Event>, mods: egui::Modifiers) { self.test_input.push_back((ev, mods)); }
    fn t_press(&mut self, p: egui::Pos2, mods: egui::Modifiers, pressed: bool) { self.t_queue(vec![egui::Event::PointerButton { pos: p, button: egui::PointerButton::Primary, pressed, modifiers: mods }], mods); }
    pub(crate) fn t_click(&mut self, p: egui::Pos2, mods: egui::Modifiers) {
        self.t_queue(vec![egui::Event::PointerMoved(p)], mods);
        self.t_press(p, mods, true); self.t_press(p, mods, false);
        self.t_queue(vec![], egui::Modifiers::NONE);
    }
    pub(crate) fn t_dbl(&mut self, p: egui::Pos2) {
        let n = egui::Modifiers::NONE;
        self.t_queue(vec![egui::Event::PointerMoved(p)], n);
        self.t_press(p, n, true); self.t_press(p, n, false); self.t_press(p, n, true); self.t_press(p, n, false);
        self.t_queue(vec![], n);
    }
    pub(crate) fn t_key(&mut self, key: egui::Key, mods: egui::Modifiers) {
        self.t_queue(vec![egui::Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers: mods }], mods);
        self.t_queue(vec![egui::Event::Key { key, physical_key: None, pressed: false, repeat: false, modifiers: mods }], egui::Modifiers::NONE);
    }
    /// 대화 칸 단추 자리가 직전 화면과 같을 때만 (스크롤·칸 높이가 바뀌는 중에는 누르지 않는다)
    pub(crate) fn t_stable_rect(&mut self, name: &str) -> Option<egui::Rect> {
        let r = self.chat.rects.iter().find(|x| x.0 == name).map(|x| x.1)?;
        let key = format!("stable:{name}");
        let prev = self.test_stable.get(&key).copied();
        self.test_stable.insert(key, r);
        (prev == Some(r)).then_some(r)
    }    pub(crate) fn t_text(&mut self, s: &str) { self.t_queue(vec![egui::Event::Text(s.into())], egui::Modifiers::NONE); }
    fn t_word(&self, i: usize) -> Option<egui::Rect> { self.word_rects.iter().find(|(j, _)| *j == i).map(|x| x.1) }
}