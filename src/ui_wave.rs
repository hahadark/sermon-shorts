//! 파형: 원본 시각 기준. 끌면 재생선이 따라오고(놓은 자리로 이동), 위쪽 눈금·Shift·가운데 단추로 끌면 화면 이동,
//! 휠 = 확대·축소, Shift+휠 = 옆으로. 지운 곳은 회색으로, 남긴 구간은 파란 파형.
use eframe::egui::{self, Align2, Color32, CornerRadius, FontId, Pos2, Rect, Sense, Stroke, Vec2};
use sermon_shorts::{edl, peaks::Peaks};

const RULER: f32 = 20.0;
const TICKS: [f64; 19] = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0, 120.0, 300.0, 600.0, 900.0, 1800.0, 3600.0];

#[derive(Default)]
/// 누르고 있는 동안: 화면 이동(pan)인지, 누른 자리 x, 처음 보기 시작, 움직였는지
#[derive(Clone, Copy)]
struct Press { pan: bool, x0: f32, s0: f64, moved: bool }

#[derive(Default)]
pub struct Wave { pub view_start: f64, pub view_dur: f64, press: Option<Press>, pub scrubbing: bool, pub scrub_t: f64, pub rect: Option<Rect> }

/// ScrubStart = 누르는 순간(재생 중이면 멈춤), Scrub = 끄는 중, ScrubEnd = 놓음(멈췄던 재생 다시), Seek = 그냥 이동
pub enum WaveEvent { None, ScrubStart(f64), Scrub(f64), ScrubEnd(f64), Seek(f64) }

fn fmt(t: f64, step: f64) -> String {
    let m = (t / 60.0).floor();
    let s = t - m * 60.0;
    if step < 0.1 { format!("{:02}:{:05.2}", m, s) } else if step < 1.0 { format!("{:02}:{:04.1}", m, s) } else { format!("{:02}:{:02}", m, s.floor()) }
}

impl Wave {
    pub fn reset(&mut self, dur: f64) { self.view_start = 0.0; self.view_dur = dur.max(0.05); }
    fn clamp_view(&mut self, total: f64) {
        self.view_dur = self.view_dur.clamp(0.05, total.max(0.05));
        self.view_start = self.view_start.clamp(0.0, (total - self.view_dur).max(0.0));
    }

    pub fn ui(&mut self, ui: &mut egui::Ui, peaks: Option<&Peaks>, total: f64, playhead: f64, follow: bool, segs: &[edl::Segment]) -> WaveEvent {
        let size = Vec2::new(ui.available_width(), ui.available_height().max(90.0));
        let (rect, resp) = ui.allocate_exact_size(size, Sense::click_and_drag());
        self.rect = Some(rect);
        if total <= 0.0 {
            // 영상이 없으면 안내만 (기존 #waveStatus)
            let p = ui.painter_at(rect);
            p.rect_filled(rect, CornerRadius::same(6), Color32::from_rgb(251, 252, 254));
            p.text(rect.center(), Align2::CENTER_CENTER, "영상을 열면 파형이 표시됩니다", FontId::proportional(13.5), crate::style::MUTED);
            return WaveEvent::None;
        }
        if self.view_dur <= 0.0 { self.reset(total); }
        // 재생 중 화면 밖으로 나가면 따라간다
        if follow && !self.scrubbing && (playhead < self.view_start || playhead > self.view_start + self.view_dur) { self.view_start = playhead - self.view_dur * 0.1; }
        self.clamp_view(total);
        let t_at = |x: f32, s: &Wave| s.view_start + ((x - rect.left()) / rect.width()).clamp(0.0, 1.0) as f64 * s.view_dur;
        let mut ev = WaveEvent::None;

        // ---- 입력 (기존 waveform.js: 누르는 순간 그 자리로, 끄는 동안 따라가고, 놓으면 그 자리로) ----
        // 위쪽 눈금·Shift·가운데 단추로 누르면 화면 이동, 움직이지 않고 놓으면(눈금 밖) 그 자리로
        let shift = ui.input(|i| i.modifiers.shift);
        let (prim, mid, down, released, ppos) = ui.input(|i| (i.pointer.primary_pressed(), i.pointer.button_pressed(egui::PointerButton::Middle), i.pointer.any_down(), i.pointer.any_released(), i.pointer.interact_pos()));
        if (prim || mid) && self.press.is_none() && resp.hovered() {
            if let Some(p) = ppos {
                let pan = mid || shift || p.y < rect.top() + RULER;
                self.press = Some(Press { pan, x0: p.x, s0: self.view_start, moved: false });
                if !pan { self.scrubbing = true; self.scrub_t = t_at(p.x, self); ev = WaveEvent::ScrubStart(self.scrub_t); }
            }
        }
        if let (Some(mut d), true, Some(p)) = (self.press, down, ppos) {
            if !d.moved && (p.x - d.x0).abs() > 2.0 { d.moved = true; }
            if d.pan {
                if d.moved { self.view_start = d.s0 - (p.x - d.x0) as f64 / rect.width() as f64 * self.view_dur; self.clamp_view(total); }
            } else if !matches!(ev, WaveEvent::ScrubStart(_)) {
                // 가장자리에 대고 있으면 화면이 계속 따라간다
                let edge = 28.0;
                if p.x < rect.left() + edge { self.view_start -= self.view_dur * 0.02; } else if p.x > rect.right() - edge { self.view_start += self.view_dur * 0.02; }
                self.clamp_view(total);
                let nt = t_at(p.x.clamp(rect.left(), rect.right()), self);
                if (nt - self.scrub_t).abs() > 1e-6 { self.scrub_t = nt; ev = WaveEvent::Scrub(nt); }
                ui.ctx().request_repaint();
            }
            self.press = Some(d);
        }
        if let (Some(d), true) = (self.press, released || !down) {
            self.press = None;
            if !d.pan { self.scrubbing = false; ev = WaveEvent::ScrubEnd(self.scrub_t); }
            else if !d.moved { if let Some(p) = ppos { if p.y >= rect.top() + RULER && rect.contains(p) { ev = WaveEvent::Seek(t_at(p.x, self)); } } }
        }        if resp.hovered() {
            let (dy, dx) = ui.input(|i| { let d = i.smooth_scroll_delta(); (d.y, d.x) });
            if dy != 0.0 || dx != 0.0 {
                if shift || dx.abs() > dy.abs() {
                    let d = if dx != 0.0 { dx } else { dy };
                    self.view_start -= d as f64 / rect.width() as f64 * self.view_dur;
                } else if let Some(p) = resp.hover_pos() {
                    let at = t_at(p.x, self);
                    let frac = ((p.x - rect.left()) / rect.width()) as f64;
                    self.view_dur = (self.view_dur * (-(dy as f64) * 0.0015).exp()).clamp(0.05, total);
                    self.view_start = at - frac * self.view_dur;
                }
                self.clamp_view(total);
            }
        }

        // ---- 그리기 ----
        let p = ui.painter_at(rect);
        p.rect_filled(rect, CornerRadius::same(6), Color32::from_rgb(251, 252, 254));
        let ruler = Rect::from_min_size(rect.min, Vec2::new(rect.width(), RULER));
        p.rect_filled(ruler, CornerRadius::ZERO, Color32::from_rgb(241, 244, 248));
        let (vs, vd) = (self.view_start, self.view_dur);
        let px_per_sec = rect.width() as f64 / vd;
        let x_of = |t: f64| rect.left() + ((t - vs) * px_per_sec) as f32;
        let step = TICKS.iter().copied().find(|s| s * px_per_sec >= 90.0).unwrap_or(3600.0);
        let mut t = (vs / step).ceil() * step;
        while t <= vs + vd + 1e-9 {
            let x = x_of(t);
            p.line_segment([Pos2::new(x, ruler.bottom() - 6.0), Pos2::new(x, ruler.bottom())], Stroke::new(1.0, Color32::from_rgb(203, 213, 225)));
            p.line_segment([Pos2::new(x, ruler.bottom()), Pos2::new(x, rect.bottom())], Stroke::new(1.0, Color32::from_rgba_unmultiplied(15, 23, 42, 12)));
            p.text(Pos2::new(x + 4.0, ruler.center().y), Align2::LEFT_CENTER, fmt(t, step), FontId::monospace(11.0), Color32::from_rgb(100, 116, 139));
            t += step;
        }
        let top = ruler.bottom();
        let mid = (top + rect.bottom()) / 2.0;
        let amp = (rect.bottom() - top) / 2.0 - 2.0;
        // 남긴 구간 바탕
        for s in segs {
            if s.end < vs || s.start > vs + vd { continue; }
            let r = Rect::from_x_y_ranges(x_of(s.start).max(rect.left())..=x_of(s.end).min(rect.right()), top..=rect.bottom());
            p.rect_filled(r, CornerRadius::ZERO, Color32::from_rgba_unmultiplied(37, 99, 235, 16));
        }
        if let Some(pk) = peaks {
            let sec_per_px = vd / rect.width() as f64;
            let mut lv = &pk.levels[0];
            for l in &pk.levels { if l.bucket <= sec_per_px { lv = l; } else { break; } }
            let in_seg = |t: f64| segs.is_empty() || segs.iter().any(|s| t >= s.start && t < s.end);
            let w = rect.width() as usize;
            for xi in 0..w {
                let t0 = vs + xi as f64 * sec_per_px;
                let b0 = (t0 / lv.bucket).floor() as i64;
                let b1 = ((t0 + sec_per_px) / lv.bucket).floor().max(b0 as f64 + 1.0) as i64;
                if b0 >= lv.mm.len() as i64 || b1 <= 0 { continue; }
                let (b0, b1) = (b0.max(0) as usize, (b1 as usize).min(lv.mm.len()));
                let (mut lo, mut hi) = (0f32, 0f32);
                for &(a, b) in &lv.mm[b0..b1] { lo = lo.min(a); hi = hi.max(b); }
                let y0 = mid - (hi * pk.gain).min(1.0) * amp;
                let y1 = mid - (lo * pk.gain).max(-1.0) * amp;
                let col = if in_seg(t0) { Color32::from_rgb(96, 165, 250) } else { Color32::from_rgb(203, 213, 225) };
                let x = rect.left() + xi as f32 + 0.5;
                p.line_segment([Pos2::new(x, y0), Pos2::new(x, y1.max(y0 + 1.0))], Stroke::new(1.0, col));
            }
        } else {
            p.text(rect.center(), Align2::CENTER_CENTER, "파형 계산 중…", FontId::proportional(13.0), Color32::from_rgb(148, 163, 184));
        }
        // 마우스 자리 시각
        if let (Some(h), false) = (resp.hover_pos(), self.scrubbing) {
            if h.y > top {
                p.line_segment([Pos2::new(h.x, top), Pos2::new(h.x, rect.bottom())], Stroke::new(1.0, Color32::from_rgba_unmultiplied(15, 23, 42, 70)));
                p.text(Pos2::new(h.x + 6.0, top + 10.0), Align2::LEFT_CENTER, edl::format_time(t_at(h.x, self), true), FontId::monospace(11.0), Color32::from_rgb(51, 65, 85));
            }
        }
        // 재생선
        let ph = if self.scrubbing { self.scrub_t } else { playhead };
        let x = x_of(ph);
        if x >= rect.left() - 2.0 && x <= rect.right() + 2.0 {
            p.line_segment([Pos2::new(x, rect.top()), Pos2::new(x, rect.bottom())], Stroke::new(1.5, Color32::from_rgb(239, 68, 68)));
            p.add(egui::Shape::convex_polygon(vec![Pos2::new(x - 5.0, rect.top()), Pos2::new(x + 5.0, rect.top()), Pos2::new(x, rect.top() + 7.0)], Color32::from_rgb(239, 68, 68), Stroke::NONE));
            if self.scrubbing { p.text(Pos2::new(x + 6.0, top + 10.0), Align2::LEFT_CENTER, edl::format_time(ph, true), FontId::monospace(11.0), Color32::from_rgb(220, 38, 38)); }
        }
        let info = format!("보기 {} – {} ({})", fmt(vs, 1.0), fmt(vs + vd, 1.0), if vd >= 60.0 { format!("{:.1}분", vd / 60.0) } else { format!("{:.1}초", vd) });
        p.text(Pos2::new(rect.right() - 6.0, rect.bottom() - 9.0), Align2::RIGHT_CENTER, info, FontId::proportional(11.0), Color32::from_rgb(100, 116, 139));
        ev
    }
}
