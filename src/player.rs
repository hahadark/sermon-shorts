//! 미리보기 재생기: 원본의 여러 구간(편집 결과)을 하나의 시간 줄로 이어서 끊김 없이 튼다.
//!  - 화면: 구간마다 ffmpeg 가 작은 크기 RGBA 로 풀어 준다. 지금 구간을 트는 동안 다음 구간을 미리 시작해 둔다(시크 시간 숨김).
//!  - 소리: 같은 방식으로 PCM(48kHz 스테레오)을 받아 이어 붙여 스피커로. 구간 이음매는 5ms 짧게 줄였다 키워 딸깍 소리를 막는다.
//!  - 시계: 소리가 실제로 나간 양 (소리가 없으면 벽시계). 화면은 이 시계에 맞춰 보인다.
use crate::media;
use anyhow::{Result, anyhow};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};
use std::collections::VecDeque;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, sync_channel};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub const RATE: u32 = 48_000;
const CH: usize = 2;
const PREVIEW_FPS: f64 = 30.0;
const FADE: usize = (RATE as usize) * 5 / 1000;

/// 출력 시간 줄의 한 조각: 원본 [src_start, src_end) 가 출력 out_start 부터
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Span { pub src_start: f64, pub src_end: f64, pub out_start: f64 }
impl Span { pub fn dur(&self) -> f64 { self.src_end - self.src_start } }

/// 원본 구간 목록 → 출력 시간 줄
pub fn timeline(ranges: &[(f64, f64)]) -> Vec<Span> {
    let mut out = 0.0;
    ranges.iter().filter(|r| r.1 > r.0).map(|&(a, b)| { let s = Span { src_start: a, src_end: b, out_start: out }; out += b - a; s }).collect()
}
pub fn total(spans: &[Span]) -> f64 { spans.last().map(|s| s.out_start + s.dur()).unwrap_or(0.0) }
/// 출력 시각 → (조각 번호, 원본 시각)
pub fn locate(spans: &[Span], out_t: f64) -> Option<(usize, f64)> {
    for (i, s) in spans.iter().enumerate() {
        if out_t < s.out_start + s.dur() || i + 1 == spans.len() { return Some((i, s.src_start + (out_t - s.out_start).clamp(0.0, s.dur()))); }
    }
    None
}

pub struct Frame { pub out_t: f64, pub w: usize, pub h: usize, pub rgba: Vec<u8> }

/// 미리보기에 섞을 배경음악: 48kHz 두 채널로 풀어 둔 곡 + 배치 (bgm::plan)
#[derive(Clone)]
pub struct BgmMix { pub id: String, pub pcm: Arc<Vec<f32>>, pub plan: crate::bgm::Plan }

struct Killer(Arc<Mutex<Vec<Child>>>);
impl Killer {
    fn add(&self, c: Child) { self.0.lock().unwrap().push(c); }
    fn kill_all(&self) { for mut c in self.0.lock().unwrap().drain(..) { let _ = c.kill(); let _ = c.wait(); } }
}

/// 한 번 재생(재생 버튼 ~ 멈춤/위치 이동)에 쓰는 일꾼들. 버리면 모두 멈춘다.
struct Run {
    stop: Arc<AtomicBool>,
    frames: Receiver<Frame>,
    played: Arc<AtomicU64>,      // 스피커로 나간 프레임 수 (48kHz)
    underruns: Arc<AtomicU64>,   // 소리가 모자라 빈 소리를 낸 횟수 (재생 중)
    _stream: Option<cpal::Stream>,
    children: Killer,
    started: Instant,
    out_from: f64,
    audio: bool,
    done_audio: Arc<AtomicBool>,
    /// 이 재생에 쓴 음성 싱크 오프셋 (초)
    offset: f64,
    /// 잠시 멈춤: 소리 장치만 세워 둔다 (풀던 ffmpeg 는 버퍼가 차면 기다린다). 다시 들으면 그 자리에서 바로 이어진다
    paused: bool,
}
impl Drop for Run {
    fn drop(&mut self) { self.stop.store(true, Ordering::SeqCst); self.children.kill_all(); }
}

pub struct Player {
    pub path: Option<PathBuf>,
    pub probe: media::Probe,
    pub spans: Vec<Span>,
    pub out_t: f64,
    pub frame: Option<Frame>,
    preview_w: usize,
    preview_h: usize,
    run: Option<Run>,
    pending: Option<Frame>,
    pub stats: Stats,
    /// 목소리 크기 (미리보기 소리 길) · 미터: 재생 중에도 바로 바뀐다
    pub fx: Arc<Mutex<crate::vox_dsp::Fx>>,
    pub meter: Arc<Mutex<crate::vox_dsp::Meter>>,
    /// 배경음악 (편집 결과로 재생할 때만): 풀어 둔 곡 소리와 배치
    pub bgm: Arc<Mutex<Option<BgmMix>>>,
    still_rx: Option<Receiver<Frame>>,
    last_underruns: u64,
    /// 음성 싱크 오프셋 (초, + 는 소리를 늦춤): 구간마다 원본 소리를 src − offset 부터 (sync::window)
    audio_offset: f64,
}

#[derive(Default, Clone, Debug)]
pub struct Stats { pub shown: u64, pub late: u64, pub underruns: u64 }

impl Default for Player { fn default() -> Self { Self { path: None, probe: Default::default(), spans: vec![], out_t: 0.0, frame: None, preview_w: 0, preview_h: 0, run: None, pending: None, stats: Stats::default(), still_rx: None, last_underruns: 0, fx: Default::default(), meter: Default::default(), bgm: Default::default(), audio_offset: 0.0 } } }

impl Player {
    pub fn open(&mut self, path: &Path) -> Result<()> {
        let p = media::probe(path)?;
        self.open_probed(path, p);
        Ok(())
    }
    /// 정보를 미리 읽어 둔 영상 열기 (인터넷 주소처럼 ffprobe 가 느린 것은 뒤에서 읽고 부른다)
    pub fn open_probed(&mut self, path: &Path, p: media::Probe) {
        self.stop();
        // 미리보기 크기: 긴 변 960 이하, 짝수
        let (w, h) = (p.width.max(2) as f64, p.height.max(2) as f64);
        let k = (960.0 / w.max(h)).min(1.0);
        self.preview_w = (((w * k) / 2.0).round() * 2.0) as usize;
        self.preview_h = (((h * k) / 2.0).round() * 2.0) as usize;
        self.spans = timeline(&[(0.0, p.duration)]);
        self.probe = p;
        self.path = Some(path.to_path_buf());
        self.out_t = 0.0;
        self.frame = None;
        self.show_still();
    }
    /// 같은 길이·같은 시각의 다른 파일(미리보기용 영상)로 바꾸기: 길이·fps·크기 정보와 편집 구간·재생 위치는 그대로 둔다
    pub fn swap_media(&mut self, path: &Path) -> Result<()> {
        if !path.exists() { anyhow::bail!("파일이 없습니다"); }
        self.stop();
        self.path = Some(path.to_path_buf());
        self.frame = None;
        self.show_still();
        Ok(())
    }
    pub fn duration(&self) -> f64 { total(&self.spans) }
    pub fn playing(&self) -> bool { self.run.as_ref().is_some_and(|r| !r.paused) }
    /// 잠시 멈춤 (소리가 있는 재생만: 풀던 것을 끊지 않아 resume 이 바로 된다. 인터넷 주소의 곡 듣기용). 소리가 없으면 stop
    pub fn pause(&mut self) {
        let Some(r) = self.run.as_mut() else { return };
        if r.paused { return; }
        if r.audio && r._stream.as_ref().is_some_and(|s| s.pause().is_ok()) { r.paused = true; self.out_t = clock(r).min(total(&self.spans)); }
        else { self.stop(); }
    }
    pub fn paused(&self) -> bool { self.run.as_ref().is_some_and(|r| r.paused) }
    /// 재생을 시작한 뒤 소리가 실제로 나오기 시작했는지 (인터넷 주소는 처음 몇 초 받는 중일 수 있다)
    pub fn sounding(&self) -> bool { self.run.as_ref().is_some_and(|r| !r.audio || r.played.load(Ordering::SeqCst) > 0) }
    pub fn preview_size(&self) -> (usize, usize) { (self.preview_w, self.preview_h) }

    /// 틀 구간 바꾸기 (편집 결과로 재생 / 원본). 지금 출력 시각은 새 줄에서 가장 가까운 자리로
    pub fn set_ranges(&mut self, ranges: &[(f64, f64)]) {
        let src = locate(&self.spans, self.out_t).map(|x| x.1).unwrap_or(0.0);
        let new = timeline(ranges);
        if new == self.spans { return; }
        let was = self.playing();
        self.stop();
        self.spans = new;
        self.out_t = out_of_src(&self.spans, src);
        if was { self.play(); } else { self.show_still(); }
    }

    pub fn play(&mut self) {
        // 잠시 멈춘 것은 그 자리에서 이어서
        if let Some(r) = self.run.as_mut().filter(|r| r.paused) {
            if r._stream.as_ref().is_some_and(|s| s.play().is_ok()) { r.paused = false; return; }
            self.stop();
        }
        let Some(path) = self.path.clone() else { return };
        if self.spans.is_empty() { return; }
        if self.out_t >= self.duration() - 0.02 { self.out_t = 0.0; }
        self.run = Some(start_run(&path, &self.spans, self.out_t, self.preview_w, self.preview_h, self.probe.has_video, self.probe.has_audio, self.fx.clone(), self.meter.clone(), self.bgm.clone(), self.audio_offset));
        self.pending = None;
    }
    /// 음성 싱크 오프셋 (초)
    pub fn audio_offset(&self) -> f64 { self.audio_offset }
    /// 지금 재생에 실제로 쓰고 있는 오프셋 (멈춰 있으면 None)
    pub fn running_offset(&self) -> Option<f64> { self.run.as_ref().map(|r| r.offset) }
    /// 오프셋 바꾸기: 재생 중이면 지금 자리에서 다시 시작해 바로 들린다
    pub fn set_audio_offset(&mut self, d: f64) {
        let d = crate::sync::clamp(d);
        if (d - self.audio_offset).abs() < 1e-9 { return; }
        self.audio_offset = d;
        if self.playing() { self.stop(); self.play(); }
    }
    pub fn stop(&mut self) {
        if let Some(r) = self.run.take() { self.out_t = clock(&r).min(self.duration()); self.last_underruns = r.underruns.load(Ordering::SeqCst); }
        self.pending = None;
    }
    pub fn underruns(&self) -> u64 { self.run.as_ref().map(|r| r.underruns.load(Ordering::SeqCst)).unwrap_or(self.last_underruns) }
    /// 지금 자리의 원본 시각
    pub fn src_now(&self) -> f64 { locate(&self.spans, self.out_t).map(|x| x.1).unwrap_or(0.0) }
    /// 원본 시각으로 옮기기 (편집 결과로 재생 중이면 그 시각을 품은, 없으면 바로 다음 남은 자리)
    pub fn seek_src(&mut self, src: f64) { let o = out_of_src(&self.spans, src); self.seek(o); }
    pub fn toggle(&mut self) { if self.playing() { self.stop(); self.show_still(); } else { self.play(); } }
    pub fn seek(&mut self, out_t: f64) {
        let was = self.playing();
        self.stop();
        self.out_t = out_t.clamp(0.0, self.duration());
        if was { self.play(); } else { self.show_still(); }
    }

    /// 멈춘 상태에서 지금 자리의 한 장면
    fn show_still(&mut self) {
        // 소리만 듣는 것(배경음악 듣기)은 장면을 풀지 않는다 (인터넷 주소를 쓸데없이 한 번 더 열지 않게)
        if !self.probe.has_video { return; }
        let Some(path) = self.path.clone() else { return };
        let Some((_, src)) = locate(&self.spans, self.out_t) else { return };
        let (w, h) = (self.preview_w, self.preview_h);
        let (tx, rx) = sync_channel(1);
        let out_t = self.out_t;
        thread::spawn(move || {
            let out = media::command("ffmpeg").args(["-v", "error", "-ss", &format!("{src:.3}")]).arg("-i").arg(&path)
                .args(["-frames:v", "1", "-an", "-vf", &format!("scale={w}:{h}:flags=bilinear"), "-pix_fmt", "rgba", "-f", "rawvideo", "-"]).output();
            if let Ok(o) = out { if o.stdout.len() >= w * h * 4 { let _ = tx.send(Frame { out_t, w, h, rgba: o.stdout[..w * h * 4].to_vec() }); } }
        });
        self.still_rx = Some(rx);
    }

    /// 화면마다 부른다. 새 장면이 있으면 true
    pub fn tick(&mut self) -> bool {
        let mut changed = false;
        if let Some(rx) = &self.still_rx { if let Ok(f) = rx.try_recv() { self.frame = Some(f); self.still_rx = None; changed = true; } }
        let Some(run) = &self.run else { return changed };
        if run.paused { return changed; }
        let now = clock(run);
        self.out_t = now.min(self.duration());
        // 시계보다 늦지 않은 장면 중 가장 새것
        let mut newest: Option<Frame> = None;
        loop {
            let f = match self.pending.take() { Some(f) => f, None => match run.frames.try_recv() { Ok(f) => f, Err(_) => break } };
            if f.out_t <= now + 0.5 / PREVIEW_FPS {
                if newest.is_some() { self.stats.late += 1; }
                newest = Some(f);
            } else { self.pending = Some(f); break; }
        }
        if let Some(f) = newest { self.frame = Some(f); self.stats.shown += 1; changed = true; }
        let ended = now >= self.duration() - 0.001 && (!run.audio || run.done_audio.load(Ordering::SeqCst));
        if ended { self.run = None; self.out_t = self.duration(); }
        changed
    }
}

fn out_of_src(spans: &[Span], src: f64) -> f64 {
    for s in spans { if src < s.src_end { return s.out_start + (src - s.src_start).max(0.0); } }
    total(spans)
}

fn clock(r: &Run) -> f64 {
    if r.audio { r.out_from + r.played.load(Ordering::SeqCst) as f64 / RATE as f64 } else { r.out_from + r.started.elapsed().as_secs_f64() }
}

/// 출력 시각 from 부터 남은 조각들 (원본 시작, 원본 끝, 출력 시작)
fn spans_from(spans: &[Span], from: f64) -> Vec<Span> {
    let mut v = vec![];
    for s in spans {
        let end = s.out_start + s.dur();
        if end <= from + 1e-6 { continue; }
        let cut = (from - s.out_start).max(0.0);
        v.push(Span { src_start: s.src_start + cut, src_end: s.src_end, out_start: s.out_start + cut });
    }
    v
}

fn start_run(path: &Path, spans: &[Span], from: f64, w: usize, h: usize, has_video: bool, has_audio: bool, fx: Arc<Mutex<crate::vox_dsp::Fx>>, meter: Arc<Mutex<crate::vox_dsp::Meter>>, bgm: Arc<Mutex<Option<BgmMix>>>, offset: f64) -> Run {
    let stop = Arc::new(AtomicBool::new(false));
    let children = Killer(Arc::new(Mutex::new(vec![])));
    let todo = spans_from(spans, from);
    // 화면
    let (ftx, frx) = sync_channel::<Frame>(24);
    if has_video {
        let (path, todo, stop, kids) = (path.to_path_buf(), todo.clone(), stop.clone(), Killer(children.0.clone()));
        thread::spawn(move || video_worker(&path, &todo, w, h, ftx, &stop, &kids));
    }
    // 소리
    let played = Arc::new(AtomicU64::new(0));
    let done_audio = Arc::new(AtomicBool::new(false));
    let underruns = Arc::new(AtomicU64::new(0));
    let mut stream = None;
    let mut audio = false;
    if has_audio {
        let rb = HeapRb::<f32>::new(RATE as usize * CH * 2);
        let (prod, cons) = rb.split();
        match open_output(cons, played.clone(), done_audio.clone(), underruns.clone(), fx, meter, bgm, from) {
            Ok(s) => {
                audio = true;
                stream = Some(s);
                let (path, todo, stop, kids, done) = (path.to_path_buf(), todo, stop.clone(), Killer(children.0.clone()), done_audio.clone());
                thread::spawn(move || audio_worker(&path, &todo, offset, prod, &stop, &kids, &done));
            }
            Err(e) => eprintln!("소리 장치를 열지 못했습니다: {e}"),
        }
    }
    Run { stop, frames: frx, played, underruns, _stream: stream, children, started: Instant::now(), out_from: from, audio, done_audio, offset, paused: false }
}

/// 구간마다 소리를 어떻게 낼지: (앞 무음 프레임 수, 풀 원본 구간, 이 구간 전체 프레임 수). 오프셋은 sync::window
pub fn audio_plan(todo: &[Span], offset: f64) -> Vec<(usize, Option<Span>, usize)> {
    todo.iter().map(|s| {
        let want = (s.dur() * RATE as f64).round() as usize;
        let w = crate::sync::window(s.src_start, s.src_end, offset);
        let lead = ((w.lead * RATE as f64).round() as usize).min(want);
        let piece = (w.dur() > 0.0 && lead < want).then(|| Span { src_start: w.src_start, src_end: w.src_end, out_start: s.out_start + w.lead });
        (lead, piece, want)
    }).collect()
}

/// 미리보기 소리 길을 스피커 대신 메모리로 (시험·측정용): 출력 시각 from 부터 끝까지 48kHz 두 채널
pub fn decode_preview_audio(path: &Path, spans: &[Span], from: f64, offset: f64) -> Vec<f32> {
    let rb = HeapRb::<f32>::new(RATE as usize * CH * 2);
    let (prod, mut cons) = rb.split();
    let stop = Arc::new(AtomicBool::new(false));
    let done = Arc::new(AtomicBool::new(false));
    let kids = Killer(Arc::new(Mutex::new(vec![])));
    let todo = spans_from(spans, from);
    let (p2, st2, k2, d2) = (path.to_path_buf(), stop.clone(), Killer(kids.0.clone()), done.clone());
    let h = thread::spawn(move || audio_worker(&p2, &todo, offset, prod, &st2, &k2, &d2));
    let mut out = vec![];
    let mut buf = vec![0f32; 8192];
    loop {
        let n = cons.pop_slice(&mut buf);
        out.extend_from_slice(&buf[..n]);
        if n == 0 { if done.load(Ordering::SeqCst) || h.is_finished() { let n = cons.pop_slice(&mut buf); out.extend_from_slice(&buf[..n]); if n == 0 { break; } } else { thread::sleep(Duration::from_millis(2)); } }
    }
    let _ = h.join();
    kids.kill_all();
    out
}

/// 구간 하나를 ffmpeg 로 푸는 프로세스 (stdout 을 읽는다)
fn spawn_piece(path: &Path, s: &Span, video: Option<(usize, usize)>) -> Option<Child> {
    let mut c = media::command("ffmpeg");
    c.args(["-v", "error", "-nostdin", "-ss", &format!("{:.6}", s.src_start)]).arg("-i").arg(path).args(["-t", &format!("{:.6}", s.dur())]);
    match video {
        Some((w, h)) => { c.args(["-an", "-vf", &format!("fps={PREVIEW_FPS},scale={w}:{h}:flags=bilinear"), "-pix_fmt", "rgba", "-f", "rawvideo", "-"]); }
        None => { c.args(["-vn", "-ac", "2", "-ar", &RATE.to_string(), "-f", "f32le", "-"]); }
    }
    c.stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null()).spawn().ok()
}

/// 지금 구간을 읽는 동안 다음 구간 프로세스를 미리 띄워 둔다 (시크·디코딩 준비 시간을 숨김)
fn video_worker(path: &Path, todo: &[Span], w: usize, h: usize, tx: SyncSender<Frame>, stop: &AtomicBool, kids: &Killer) {
    let size = w * h * 4;
    let mut queue: VecDeque<(Span, Option<std::process::ChildStdout>)> = VecDeque::new();
    let mut next = 0;
    let launch = |queue: &mut VecDeque<_>, next: &mut usize| {
        if *next < todo.len() {
            let s = todo[*next];
            let out = spawn_piece(path, &s, Some((w, h))).map(|mut c| { let o = c.stdout.take(); kids.add(c); o }).flatten();
            queue.push_back((s, out));
            *next += 1;
        }
    };
    launch(&mut queue, &mut next);
    while let Some((s, out)) = queue.pop_front() {
        launch(&mut queue, &mut next);   // 다음 구간 미리
        let Some(mut out) = out else { continue };
        let mut i = 0u64;
        loop {
            if stop.load(Ordering::SeqCst) { return; }
            let mut buf = vec![0u8; size];
            if out.read_exact(&mut buf).is_err() { break; }
            let t = s.out_start + i as f64 / PREVIEW_FPS;
            i += 1;
            if t >= s.out_start + s.dur() { break; }
            if tx.send(Frame { out_t: t, w, h, rgba: buf }).is_err() { return; }
        }
    }
}

fn audio_worker(path: &Path, todo: &[Span], offset: f64, mut prod: HeapProd<f32>, stop: &AtomicBool, kids: &Killer, done: &AtomicBool) {
    // 음성 싱크: 구간마다 앞 무음 + 옮긴 원본 소리 (길이는 영상 구간 그대로)
    let plan = audio_plan(todo, offset);
    let mut queue: VecDeque<((usize, usize), Option<std::process::ChildStdout>)> = VecDeque::new();
    let mut next = 0;
    let launch = |queue: &mut VecDeque<_>, next: &mut usize| {
        if *next < plan.len() {
            let (lead, piece, want) = plan[*next];
            let out = piece.and_then(|p| spawn_piece(path, &p, None)).map(|mut c| { let o = c.stdout.take(); kids.add(c); o }).flatten();
            queue.push_back(((lead, want), out));
            *next += 1;
        }
    };
    launch(&mut queue, &mut next);
    let multi = todo.len() > 1;
    // 링 버퍼에 다 넣을 때까지 (가득 차면 조금 기다림)
    let push_all = |prod: &mut HeapProd<f32>, mut data: &[f32]| -> bool {
        while !data.is_empty() {
            if stop.load(Ordering::SeqCst) { return false; }
            let n = prod.push_slice(data);
            data = &data[n..];
            if n == 0 { thread::sleep(Duration::from_millis(4)); }
        }
        true
    };
    while let Some(((lead, want), out)) = queue.pop_front() {
        launch(&mut queue, &mut next);   // 다음 구간 미리
        // 이 구간에서 낼 프레임 수(want): 시간 줄과 정확히 맞춘다 (모자라면 조용히 채우고, 넘치면 버린다)
        // 구간 처음·끝 5ms 는 줄였다 키운다 (이음매 딸깍 소리 막기)
        let last = want.saturating_sub(1);
        let gain = |fi: usize| -> f32 { if !multi { return 1.0; } let a = fi.min(last.saturating_sub(fi)); if a >= FADE { 1.0 } else { a as f32 / FADE as f32 } };
        // 소리를 늦출 때: 앞부분 무음
        if lead > 0 { let silence = vec![0f32; lead * CH]; if !push_all(&mut prod, &silence) { return; } }
        let mut fi = lead;
        let mut pend: Vec<u8> = vec![];
        if let Some(mut out) = out {
            let mut bytes = vec![0u8; 32768];
            while fi < want {
                if stop.load(Ordering::SeqCst) { return; }
                let n = match out.read(&mut bytes) { Ok(0) | Err(_) => break, Ok(n) => n };
                pend.extend_from_slice(&bytes[..n]);
                let whole = pend.len() / (4 * CH) * (4 * CH);
                let mut chunk: Vec<f32> = Vec::with_capacity(whole / 4);
                for fr in pend[..whole].chunks_exact(4 * CH) {
                    if fi >= want { break; }
                    let g = gain(fi);
                    for c in 0..CH { let b = &fr[c * 4..c * 4 + 4]; chunk.push(f32::from_le_bytes([b[0], b[1], b[2], b[3]]) * g); }
                    fi += 1;
                }
                pend.drain(..whole);
                if !push_all(&mut prod, &chunk) { return; }
            }
        }
        if fi < want { let silence = vec![0f32; (want - fi) * CH]; if !push_all(&mut prod, &silence) { return; } }
    }
    // 남은 소리가 다 나갈 때까지
    while prod.occupied_len() > 0 { if stop.load(Ordering::SeqCst) { return; } thread::sleep(Duration::from_millis(10)); }
    done.store(true, Ordering::SeqCst);
}
fn open_output(mut cons: HeapCons<f32>, played: Arc<AtomicU64>, done: Arc<AtomicBool>, underruns: Arc<AtomicU64>, fx: Arc<Mutex<crate::vox_dsp::Fx>>, meter: Arc<Mutex<crate::vox_dsp::Meter>>, bgm: Arc<Mutex<Option<BgmMix>>>, out_from: f64) -> Result<cpal::Stream> {
    let host = cpal::default_host();
    let dev = host.default_output_device().ok_or_else(|| anyhow!("소리 출력 장치가 없습니다"))?;
    let def = dev.default_output_config()?;
    let channels = def.channels() as usize;
    let cfg = cpal::StreamConfig { channels: def.channels(), sample_rate: RATE, buffer_size: cpal::BufferSize::Default };
    let mute = std::env::var_os("SS_TEST_MUTE").is_some();   // 자동 시험: 시계는 그대로, 스피커로는 내보내지 않음
    let mut tmp = vec![0f32; 0];
    let mut chain = crate::vox_dsp::Chain::new(RATE as f32);
    let mut last_fx = crate::vox_dsp::Fx::default();
    let mut acc = crate::vox_dsp::Meter::default();
    let mut last_bgm: Option<BgmMix> = None;
    let stream = dev.build_output_stream(cfg, move |data: &mut [f32], _| {
        let frames = data.len() / channels;
        tmp.resize(frames * CH, 0.0);
        let got = cons.pop_slice(&mut tmp) / CH;
        for v in tmp[got * CH..].iter_mut() { *v = 0.0; }
        // 목소리 크기: 압축기 → 크기 → 리미터 → 미터 (기존 Web Audio 길과 같은 순서)
        if let Ok(f) = fx.try_lock() { last_fx = *f; }
        chain.run(&mut tmp, frames, &last_fx, &mut acc);
        // 배경음악: 말소리(목소리 처리 뒤) 위에 얹는다 (내보내기 amix normalize=0 과 같이 더하기)
        if let Ok(b) = bgm.try_lock() { if let Some(b) = b.as_ref() { last_bgm = Some(b.clone()); } else { last_bgm = None; } }
        if let Some(b) = &last_bgm {
            let base = played.load(Ordering::SeqCst) as f64;
            for f in 0..got {
                let t = out_from + (base + f as f64) / RATE as f64;
                if let Some(tt) = crate::bgm::track_time_at(Some(&b.plan), t) {
                    let i = (tt * RATE as f64) as usize * 2;
                    if i + 1 < b.pcm.len() { let g = crate::bgm::gain_at(Some(&b.plan), t) as f32; let (l, r) = (b.pcm[i] * g, b.pcm[i + 1] * g); tmp[f * CH] += l; tmp[f * CH + 1] += r; acc.bgm_peak = acc.bgm_peak.max(l.abs()).max(r.abs()); }
                }
            }
        }
        if let Ok(mut m) = meter.try_lock() { m.peak = m.peak.max(acc.peak); m.sum += acc.sum; m.n += acc.n; m.min_gain = m.min_gain.min(acc.min_gain); m.bgm_peak = m.bgm_peak.max(acc.bgm_peak); acc = Default::default(); }
        for f in 0..frames {
            let (l, r) = (tmp[f * CH], tmp[f * CH + 1]);
            for c in 0..channels { data[f * channels + c] = if mute { 0.0 } else if c % 2 == 0 { l } else { r }; }
        }
        played.fetch_add(got as u64, Ordering::SeqCst);
        if got < frames && played.load(Ordering::SeqCst) > 0 && !done.load(Ordering::SeqCst) { underruns.fetch_add(1, Ordering::SeqCst); }
    }, |e| eprintln!("소리 출력 오류: {e}"), None)?;
    stream.play()?;
    Ok(stream)
}
