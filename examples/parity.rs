//! Electron 'themes' 시험과 같은 조건으로 테마마다 그림·MP4·SRT 를 만든다 (비교용).
//! cargo run --release --example parity -- <영상> <단어.json> <출력폴더> [테마id,...] [--pad-before 0.1 --pad-after 0.1]
use sermon_shorts::{edl, export, media, model::{EditSettings, Overrides, Word}, theme};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let source = PathBuf::from(&a[1]);
    let out_dir = PathBuf::from(&a[3]);
    let pick: Vec<String> = a.get(4).filter(|x| !x.starts_with("--")).map(|s| s.split(',').map(String::from).collect()).unwrap_or_default();
    let mut settings = EditSettings::default();
    if let Some(i) = a.iter().position(|x| x == "--settings") { settings = serde_json::from_str(&a[i + 1]).expect("settings json"); }
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&a[2]).unwrap()).unwrap();
    let arr = if v.is_array() { v } else { v["words"].clone() };
    let mut words: Vec<Word> = serde_json::from_value(arr).unwrap();
    for (i, x) in words.iter_mut().enumerate() { x.id = i as i64; if x.stt_text.is_none() { x.stt_text = Some(x.text.clone()); } }
    let probe = media::probe(&source).unwrap();
    let first = words.iter().find(|w| w.start >= words[0].start + 1.5).unwrap_or(&words[0]).clone();
    let range = (first.start - 0.05, first.start + 8.0);
    let ws: Vec<Word> = words.iter().filter(|w| w.start >= range.0 && w.end <= range.1).cloned().collect();
    let segs = edl::build_segments(&ws, &settings, &Overrides::default(), Some(probe.duration), None);
    let lines = edl::build_lines(&ws, &segs, &settings);
    std::fs::create_dir_all(&out_dir).unwrap();
    let mut report = vec![];
    for e in theme::list_themes() {
        if !pick.is_empty() && !pick.contains(&e.id) { continue; }
        let mut t = theme::normalize(Some(&e.json));
        t["id"] = e.id.clone().into();
        let req = export::Request {
            source: source.clone(), out: out_dir.join(format!("export_{}.mp4", e.id)), words: ws.clone(), segs: segs.clone(), lines: lines.clone(), theme: t,
            crop: export::Crop::default(), fade_ms: settings.fade_ms,
            meta: export::Meta::of(&serde_json::json!({ "title": "오늘의 말씀 / 하나님 중심의 *기도*", "verse": "마태복음 6:13", "speaker": std::env::var("PARITY_SPEAKER").unwrap_or_default() }), &theme::app_settings()),
            encoder: export::Encoder::Nvenc,
            voice: None, bgm: None, bgm_file: None, bgm_plan: None, audio_offset: 0.0,
        };
        // 그림만 따로 (Electron 임시 폴더 그림과 비교)
        let img_dir = out_dir.join(&e.id);
        std::fs::create_dir_all(&img_dir).unwrap();
        let t0 = std::time::Instant::now();
        let imgs = export::render_images(&req, &img_dir, &|_| {}).unwrap();
        let img_secs = t0.elapsed().as_secs_f64();
        let (_, fg) = export::build_args(&req, &img_dir, &imgs, export::Encoder::Nvenc).unwrap();
        std::fs::write(img_dir.join("filtergraph.txt"), &fg).unwrap();
        let prog = Arc::new(Mutex::new(export::Progress::default()));
        let res = export::run(req, prog);
        println!("{} 그림 {:.2}s → {}", e.id, img_secs, match &res { Ok(d) => format!("ok {:.1}s 길이 {:.3}", d.secs, d.duration), Err(er) => format!("실패 {er}") });
        report.push(serde_json::json!({ "id": e.id, "imgSecs": img_secs, "ok": res.is_ok(), "secs": res.as_ref().map(|d| d.secs).unwrap_or(0.0), "error": res.err() }));
    }
    std::fs::write(out_dir.join("report.json"), serde_json::to_string_pretty(&report).unwrap()).unwrap();
}
