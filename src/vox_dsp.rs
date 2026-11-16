//! 미리보기 소리 처리 (기존 voice-ui.js 의 Web Audio 길): 압축기 → 크기 → 리미터 → 미터
//!  - 압축기: ffmpeg acompressor 와 같은 계산 (rms 감지, 두 채널 평균, 부드러운 무릎) → 내보내기와 같은 소리
//!  - 리미터: 기존 voice-limiter.js (5ms 앞을 내다보고 천장을 넘지 않게) 그대로
use crate::voice;

/// 지금 목소리 설정 (화면이 바꾸고, 소리 출력이 매번 읽는다)
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fx { pub on: bool, pub even: bool, pub gain: f32, pub ceil: f32 }
impl Default for Fx { fn default() -> Self { Fx { on: false, even: false, gain: 1.0, ceil: voice::db_to_lin(voice::CEIL_DB) as f32 } } }
impl Fx {
    pub fn of(v: &voice::Voice) -> Fx { Fx { on: voice::is_on(v), even: v.even, gain: voice::db_to_lin(voice::gain_db(v).unwrap_or(0.0)) as f32, ceil: voice::db_to_lin(voice::CEIL_DB) as f32 } }
}

/// 미터 (마지막으로 읽은 뒤의 최고값·제곱합·리미터 최소 이득)
#[derive(Clone, Copy, Debug)]
/// bgm_peak: 섞은 배경음악의 최고값 (시험·확인용)
pub struct Meter { pub peak: f32, pub sum: f64, pub n: u64, pub min_gain: f32, pub bgm_peak: f32 }
impl Default for Meter { fn default() -> Self { Meter { peak: 0.0, sum: 0.0, n: 0, min_gain: 1.0, bgm_peak: 0.0 } } }

/// ffmpeg af_sidechaincompress.c (acompressor) 의 계산
pub struct Compressor { slope: f64, thres: f64, ratio: f64, knee: f64, knee_start: f64, knee_stop: f64, comp_knee_stop: f64, adj_knee_start: f64, attack: f64, release: f64, makeup: f64 }
impl Compressor {
    pub fn new(rate: f64) -> Compressor {
        let c = &voice::COMP;
        // ffmpeg 에는 소수 셋째 자리로 반올림한 값이 넘어가므로 같은 값을 쓴다 (voice::comp_filter)
        let r3 = |x: f64| voice::f3(x).parse::<f64>().unwrap_or(x);
        let threshold = r3(voice::db_to_lin(c.threshold_db));
        let knee = r3(voice::db_to_lin(c.knee_db));
        let lin_knee_start = threshold / knee.sqrt();
        let lin_knee_stop = threshold * knee.sqrt();
        let thres = threshold.ln();
        let knee_stop = lin_knee_stop.ln();
        Compressor {
            slope: 0.0, thres, ratio: c.ratio, knee, knee_start: lin_knee_start.ln(), knee_stop, comp_knee_stop: (knee_stop - thres) / c.ratio + thres,
            adj_knee_start: lin_knee_start * lin_knee_start,
            attack: (1.0 / ((c.attack * 1000.0).round() * rate / 4000.0)).min(1.0), release: (1.0 / ((c.release * 1000.0).round() * rate / 4000.0)).min(1.0),
            makeup: r3(voice::db_to_lin(c.makeup_db)),
        }
    }
    fn hermite(x: f64, x0: f64, x1: f64, p0: f64, p1: f64, m0: f64, m1: f64) -> f64 {
        let width = x1 - x0;
        let t = (x - x0) / width;
        let (m0, m1) = (m0 * width, m1 * width);
        let (t2, t3) = (t * t, t * t * t);
        let ct2 = -3.0 * p0 - 2.0 * m0 + 3.0 * p1 - m1;
        let ct3 = 2.0 * p0 + m0 - 2.0 * p1 + m1;
        ct3 * t3 + ct2 * t2 + m0 * t + p0
    }
    fn output_gain(&self) -> f64 {
        let slope = self.slope.ln() * 0.5; // rms
        let delta = 1.0 / self.ratio;
        let mut gain = (slope - self.thres) / self.ratio + self.thres;
        if self.knee > 1.0 && slope < self.knee_stop { gain = Self::hermite(slope, self.knee_start, self.knee_stop, self.knee_start, self.comp_knee_stop, 1.0, delta); }
        (gain - slope).exp()
    }
    /// 한 프레임 (왼쪽, 오른쪽)
    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        let a = ((l.abs() + r.abs()) as f64) / 2.0;
        let a = a * a;
        self.slope += (a - self.slope) * if a > self.slope { self.attack } else { self.release };
        let gain = if self.slope > 0.0 && self.slope > self.adj_knee_start { self.output_gain() } else { 1.0 };
        let k = (gain * self.makeup) as f32;
        (l * k, r * k)
    }
}

/// 기존 voice-limiter.js (AudioWorklet) 그대로
pub struct Limiter { l: usize, n: usize, delay: [Vec<f32>; 2], dpos: usize, win: Vec<f32>, wpos: usize, wmin: f32, bx: Vec<f32>, bpos: usize, bsum: f32, env: f32, rel: f32, pub min_gain: f32 }
impl Limiter {
    pub fn new(rate: f32) -> Limiter {
        let l = 16usize.max((rate * 0.005).round() as usize);
        Limiter { l, n: l + 1, delay: [vec![0.0; l], vec![0.0; l]], dpos: 0, win: vec![1.0; l + 1], wpos: 0, wmin: 1.0, bx: vec![1.0; l], bpos: 0, bsum: l as f32, env: 1.0, rel: 1.0 - (-1.0 / (0.08 * rate)).exp(), min_gain: 1.0 }
    }
    #[inline]
    pub fn process(&mut self, l: f32, r: f32, ceil: f32, on: bool) -> (f32, f32) {
        let a = l.abs().max(r.abs());
        let gt = if on && a > ceil { ceil / a } else { 1.0 };
        let leaving = self.win[self.wpos];
        self.win[self.wpos] = gt;
        self.wpos = (self.wpos + 1) % self.n;
        if gt <= self.wmin { self.wmin = gt; } else if leaving <= self.wmin { self.wmin = self.win.iter().copied().fold(1.0, f32::min); }
        self.env = if self.wmin < self.env { self.wmin } else { self.env + (self.wmin - self.env) * self.rel };
        self.bsum += self.env - self.bx[self.bpos];
        self.bx[self.bpos] = self.env;
        self.bpos = (self.bpos + 1) % self.l;
        let g = (self.bsum / self.l as f32).min(1.0);
        if g < self.min_gain { self.min_gain = g; }
        let (x0, x1) = (self.delay[0][self.dpos], self.delay[1][self.dpos]);
        self.delay[0][self.dpos] = l;
        self.delay[1][self.dpos] = r;
        self.dpos = (self.dpos + 1) % self.l;
        (x0 * g, x1 * g)
    }
}

/// 출력 직전의 소리 길 전체
pub struct Chain { comp: Compressor, lim: Limiter }
impl Chain {
    pub fn new(rate: f32) -> Chain { Chain { comp: Compressor::new(rate as f64), lim: Limiter::new(rate) } }
    /// 끼워 넣은 두 채널 프레임을 그 자리에서 바꾸고 미터에 더한다
    pub fn run(&mut self, buf: &mut [f32], frames: usize, fx: &Fx, meter: &mut Meter) {
        for f in 0..frames {
            let (mut l, mut r) = (buf[f * 2], buf[f * 2 + 1]);
            if fx.on && fx.even { (l, r) = self.comp.process(l, r); }
            if fx.on { l *= fx.gain; r *= fx.gain; }
            (l, r) = self.lim.process(l, r, fx.ceil, fx.on);
            buf[f * 2] = l; buf[f * 2 + 1] = r;
            let a = l.abs().max(r.abs());
            if a > meter.peak { meter.peak = a; }
            meter.sum += ((l * l + r * r) / 2.0) as f64;
            meter.n += 1;
        }
        if self.lim.min_gain < meter.min_gain { meter.min_gain = self.lim.min_gain; }
        self.lim.min_gain = 1.0;
    }
}
