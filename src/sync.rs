//! 음성 싱크 오프셋: 원본의 소리가 화면보다 빠르거나 늦을 때 소리를 앞당기거나 늦춘다.
//! 값은 프로젝트마다 `"audioOffset": 초` (+ 는 소리를 늦춤, − 는 소리를 앞당김). 기본 0.
//! 화면(영상)과 자막 시각은 그대로 두고 소리만 옮긴다: 출력 구간 [a, b) 에는 원본 소리 [a − d, b − d) 를 쓴다.
//! 원본 0초보다 앞은 무음(lead), 원본 끝보다 뒤도 무음으로 채워 구간 길이는 영상 기준으로 유지한다.
//! 미리보기(player)와 내보내기(export)가 같은 계산(window)을 쓴다.
use serde_json::{Map, Value};

/// 프로젝트 파일 항목 이름
pub const KEY: &str = "audioOffset";
/// 조절 범위 (초)
pub const MAX: f64 = 5.0;

/// ms 단위로 반올림하고 범위 안으로
pub fn clamp(x: f64) -> f64 {
    if !x.is_finite() { return 0.0; }
    let v = (x.clamp(-MAX, MAX) * 1000.0).round() / 1000.0;
    if v == 0.0 { 0.0 } else { v }
}

/// 프로젝트 rest 에서 읽기 (없거나 이상하면 0)
pub fn of(rest: &Map<String, Value>) -> f64 { rest.get(KEY).and_then(|v| v.as_f64()).map(clamp).unwrap_or(0.0) }

/// 프로젝트 rest 에 쓰기 (0 이면 항목을 지워 예전 파일과 똑같이)
pub fn set(rest: &mut Map<String, Value>, d: f64) {
    let d = clamp(d);
    if d == 0.0 { rest.remove(KEY); } else { rest.insert(KEY.into(), serde_json::json!(d)); }
}

/// 구간 하나에 쓸 소리: 앞에 lead 초 무음 뒤 원본 [src_start, src_end)
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Window { pub lead: f64, pub src_start: f64, pub src_end: f64 }
impl Window {
    pub fn dur(&self) -> f64 { (self.src_end - self.src_start).max(0.0) }
}

/// 원본 영상 구간 [a, b) 에 맞출 소리 (d: 오프셋 초, + 는 늦춤)
pub fn window(a: f64, b: f64, d: f64) -> Window {
    let (s, e) = (a - d, b - d);
    let s0 = s.max(0.0);
    let lead = (s0 - s).clamp(0.0, (b - a).max(0.0));
    Window { lead, src_start: s0, src_end: e.max(s0) }
}

/// 사람이 읽는 값 ("+120 ms", "0 ms")
pub fn describe(d: f64) -> String {
    let ms = (d * 1000.0).round() as i64;
    if ms > 0 { format!("+{ms} ms") } else { format!("{ms} ms") }
}
