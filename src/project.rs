//! 프로젝트 파일(.sshorts). 기존 Electron 판(src/shared/project.js)과 같은 JSON.
//! 이 판이 아직 다루지 않는 항목(테마·배경음악·목소리·교인 자료 …)은 읽은 그대로 보존해서 다시 쓴다.
use crate::model::{EditSettings, Overrides, Word};
use anyhow::{Result, anyhow, bail};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default)]
pub struct Project {
    pub source_path: PathBuf,
    pub words: Vec<Word>,
    pub overrides: Overrides,
    pub order: Option<Vec<i64>>,
    pub settings: EditSettings,
    pub playhead: f64,
    pub hide_deleted: bool,
    /// 나머지 항목 (source 의 다른 값, meta, crop, activeTheme, bgm, voice, materials, uploads …)
    pub rest: Map<String, Value>,
}

impl Project {
    pub fn from_json(v: Value) -> Result<Project> {
        let Value::Object(mut m) = v else { bail!("프로젝트 형식이 올바르지 않습니다.") };
        if let Some(ver) = m.get("version") { if ver.as_i64() != Some(1) { bail!("지원하지 않는 프로젝트 버전입니다."); } }
        let path = m.get("source").and_then(|s| s["path"].as_str()).filter(|p| !p.trim().is_empty()).ok_or_else(|| anyhow!("원본 영상 경로가 없습니다."))?.to_string();
        let raw_words = m.remove("words").and_then(|w| if w.is_array() { Some(w) } else { None }).ok_or_else(|| anyhow!("자막 데이터가 없습니다."))?;
        // 단어 번호를 0부터 다시 매긴다 (예전 번호 → 새 번호: 출력 순서도 함께 옮김)
        let old_ids: Vec<Option<i64>> = raw_words.as_array().unwrap().iter().map(|w| w["id"].as_i64()).collect();
        let mut words: Vec<Word> = serde_json::from_value(raw_words)?;
        for (i, w) in words.iter_mut().enumerate() {
            if !w.timed() || w.start < 0.0 || w.end < w.start { bail!("{}번째 단어 시각이 올바르지 않습니다.", i + 1); }
            if w.stt_text.is_none() { w.stt_text = Some(w.extra.get("_oldText").and_then(|x| x.as_str()).map(str::to_string).unwrap_or_else(|| w.text.clone())); }
            w.id = i as i64;
        }
        let new_id: HashMap<i64, i64> = old_ids.iter().enumerate().filter_map(|(i, o)| o.map(|o| (o, i as i64))).collect();
        let order = m.remove("order").and_then(|o| o.as_array().cloned()).map(|a| {
            let mut seen = std::collections::HashSet::new();
            a.iter().filter_map(|x| x.as_i64()).filter_map(|x| new_id.get(&x).copied()).filter(|x| seen.insert(*x)).collect::<Vec<_>>()
        }).filter(|o| o.len() > 1);
        let mut overrides = Overrides::new();
        if let Some(Value::Object(o)) = m.remove("overrides") {
            for (k, v) in o { if let Some(x) = v.as_f64() { if x.is_finite() && (k.starts_with("s:") || k.starts_with("e:")) && k[2..].parse::<i64>().is_ok() { overrides.insert(k, x); } } }
        }
        let s = m.remove("settings").unwrap_or(json!({}));
        let num = |k: &str, d: f64, lo: f64, hi: f64| s[k].as_f64().filter(|x| x.is_finite()).unwrap_or(d).clamp(lo, hi);
        let settings = EditSettings {
            pad_before: num("padBefore", 0.1, 0.0, 5.0), pad_after: num("padAfter", 0.15, 0.0, 5.0), fade_ms: num("fadeMs", 10.0, 0.0, 1000.0),
            max_line_chars: Some(num("maxLineChars", 14.0, 1.0, 200.0).trunc()),
            split_long_words: s["splitLongWords"].as_bool() == Some(true), semantic_breaks: s["semanticBreaks"].as_bool() != Some(false),
        };
        let playhead = m.remove("playhead").and_then(|x| x.as_f64()).unwrap_or(0.0).max(0.0);
        let hide_deleted = m.remove("hideDeleted").and_then(|x| x.as_bool()).unwrap_or(false);
        m.remove("version");
        Ok(Project { source_path: PathBuf::from(path), words, overrides, order, settings, playhead, hide_deleted, rest: m })
    }

    pub fn load(path: &Path) -> Result<Project> {
        let bytes = std::fs::read(path)?;
        Project::from_json(serde_json::from_slice(&bytes)?)
    }

    pub fn to_json(&self) -> Value {
        let mut m = self.rest.clone();
        let mut src = m.remove("source").and_then(|s| if let Value::Object(o) = s { Some(o) } else { None }).unwrap_or_default();
        src.insert("path".into(), json!(self.source_path.to_string_lossy()));
        let s = &self.settings;
        let mut out = Map::new();
        out.insert("version".into(), json!(1));
        out.insert("source".into(), Value::Object(src));
        out.insert("words".into(), serde_json::to_value(&self.words).unwrap());
        out.insert("overrides".into(), serde_json::to_value(&self.overrides).unwrap());
        out.insert("order".into(), json!(self.order));
        out.insert("settings".into(), json!({ "padBefore": s.pad_before, "padAfter": s.pad_after, "fadeMs": s.fade_ms, "maxLineChars": s.max_line_chars.unwrap_or(14.0), "splitLongWords": s.split_long_words, "semanticBreaks": s.semantic_breaks }));
        out.insert("playhead".into(), json!(self.playhead));
        out.insert("hideDeleted".into(), json!(self.hide_deleted));
        for (k, v) in m { out.entry(k).or_insert(v); }
        Value::Object(out)
    }

    /// 쓰다 끊겨도 원래 파일이 깨지지 않게: 임시 파일에 쓰고 바꿔 끼운다
    pub fn save(&self, path: &Path) -> Result<()> {
        let tmp = path.with_extension("sshorts.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.to_json())?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}
