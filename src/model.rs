//! 편집 데이터: 단어(STT 원문·출력 자막·시각·지움 표시)와 편집 설정.
//! 프로젝트 파일(.sshorts, JSON)은 기존 Electron 판과 같은 모양을 쓴다. 모르는 필드는 그대로 보존한다.
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

fn num_or_nan<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.and_then(|v| v.as_f64()).unwrap_or(f64::NAN))
}

/// 손으로 합친 자막 줄 기록 (출력 자막 칸에서 Backspace/Delete 로 합친 것)
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaptionMerge {
    pub start_id: i64,
    #[serde(default)]
    pub start_offset: Option<f64>,
    pub end_id: i64,
    #[serde(default)]
    pub end_offset: Option<f64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub id: i64,
    #[serde(default)]
    pub text: String,
    #[serde(default = "nan", deserialize_with = "num_or_nan")]
    pub start: f64,
    #[serde(default = "nan", deserialize_with = "num_or_nan")]
    pub end: f64,
    #[serde(default, skip_serializing_if = "is_false")]
    pub del: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub br: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub cut_before: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption_splits: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption_merges: Option<Vec<CaptionMerge>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_text: Option<String>,
    /// 그 밖의 필드 (score, gapCut, _oldText …) — 읽은 그대로 다시 쓴다
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}
fn nan() -> f64 { f64::NAN }
fn is_false(b: &bool) -> bool { !*b }

impl Word {
    pub fn timed(&self) -> bool { self.start.is_finite() && self.end.is_finite() }
}

/// 컷 여유·자막 줄 설정 (state.settings)
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditSettings {
    #[serde(default)]
    pub pad_before: f64,
    #[serde(default)]
    pub pad_after: f64,
    #[serde(default = "d_fade")]
    pub fade_ms: f64,
    #[serde(default)]
    pub max_line_chars: Option<f64>,
    #[serde(default)]
    pub split_long_words: bool,
    #[serde(default)]
    pub semantic_breaks: bool,
}
fn d_fade() -> f64 { 10.0 }
impl Default for EditSettings {
    fn default() -> Self {
        Self { pad_before: 0.1, pad_after: 0.15, fade_ms: 10.0, max_line_chars: Some(14.0), split_long_words: true, semantic_breaks: true }
    }
}

/// 미세 조정 값: "s:<단어 id>" = 구간 시작, "e:<단어 id>" = 구간 끝 (원본 초)
pub type Overrides = HashMap<String, f64>;
