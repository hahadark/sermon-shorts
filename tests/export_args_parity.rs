//! 내보내기 ffmpeg 인자 전체(영상·자막·목소리·배경음악)가 Electron render.js buildExportArgs 와 같은지
use serde_json::{json, Value};
use sermon_shorts::{edl, export, project::Project, theme};

#[test]
fn export_args_match_electron() {
    let pr = Project::load(std::path::Path::new("tests/fixtures/electron_project.sshorts")).unwrap();
    let segs = edl::build_segments(&pr.words, &pr.settings, &pr.overrides, Some(156.0), pr.order.as_deref());
    let lines = edl::build_lines(&pr.words, &segs, &pr.settings);
    let temp = std::env::temp_dir().join("ss_export_args_parity");
    std::fs::create_dir_all(&temp).unwrap();
    let themes = theme::list_themes();
    let voices = [Value::Null, json!({ "mode": "manual", "gainDb": 6.5, "even": true }), json!({ "mode": "auto", "even": false, "measured": { "i": -19.3, "tp": -3.7, "lra": 7.9, "key": "x", "even": false } }), json!({ "mode": "off" })];
    let bgms = [Value::Null, json!({ "id": "meditation-impromptu-01", "duration": 212.79, "trackStart": 12.5, "trackEnd": 90.25, "align": "start", "fadeIn": 1, "fadeOut": 2, "volume": 0.2 }), json!({ "id": "moonstone", "duration": 255.14, "trackStart": 30, "trackEnd": 75.5, "align": "end", "fadeIn": 0, "fadeOut": 3.5, "volume": 0.35 })];
    let mut cases = vec![];
    for (i, t) in themes.iter().enumerate() {
        let (v, b) = (&voices[i % voices.len()], &bgms[i % bgms.len()]);
        cases.push(json!({ "theme": t.json, "crop": { "scale": 1.0 + (i as f64) * 0.1, "x": 0.5, "y": 0.45 }, "encoder": if i % 2 == 0 { "nvenc" } else { "x264" }, "voice": v, "bgm": b }));
    }
    let src = "F:/aside/sermon-shorts-app/cache/yt/uSE5pZB3gtQ/part_4955_5100.mp4";
    let (out, bgm_file) = (temp.join("out.mp4"), temp.join("bgm.mp3"));
    let inp = json!({ "source": src, "out": out, "temp": temp, "fadeMs": pr.settings.fade_ms, "bgmFile": bgm_file,
        "segments": segs.iter().map(|s| json!({ "start": s.start, "end": s.end })).collect::<Vec<_>>(),
        "lines": lines.iter().map(|l| json!({ "outStart": l.out_start, "outEnd": l.out_end })).collect::<Vec<_>>(), "cases": cases });
    let inp_path = temp.join("input.json");
    std::fs::write(&inp_path, inp.to_string()).unwrap();
    let o = std::process::Command::new("node").arg("tests/export_args_js.js").arg(&inp_path).output().expect("node");
    assert!(o.status.success(), "node: {}", String::from_utf8_lossy(&o.stderr));
    let js: Vec<Value> = serde_json::from_slice(&o.stdout).unwrap();
    let out_dur = edl::segments_duration(&segs);
    for (i, c) in inp["cases"].as_array().unwrap().iter().enumerate() {
        let bgm = (!c["bgm"].is_null()).then(|| c["bgm"].clone());
        let req = export::Request {
            source: src.into(), out: out.clone(), words: pr.words.clone(), segs: segs.clone(), lines: lines.clone(), theme: theme::normalize(Some(&c["theme"])), crop: export::Crop::from_value(&c["crop"]), fade_ms: pr.settings.fade_ms,
            meta: export::Meta { title: String::new(), verse: String::new(), speaker: String::new(), church: String::new() },
            encoder: if c["encoder"] == "x264" { export::Encoder::X264 } else { export::Encoder::Nvenc },
            voice: (!c["voice"].is_null()).then(|| c["voice"].clone()), bgm_plan: bgm.as_ref().and_then(|b| sermon_shorts::bgm::plan(b, out_dur)), bgm_file: bgm.as_ref().map(|_| bgm_file.clone()), bgm, audio_offset: 0.0,
        };
        let (args, fg) = export::build_args(&req, &temp, &[], req.encoder).unwrap();
        assert_eq!(fg, js[i]["filtergraph"].as_str().unwrap(), "filtergraph {i} ({})", themes[i].id);
        let ja: Vec<String> = js[i]["args"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
        assert_eq!(args, ja, "args {i} ({})", themes[i].id);
    }
    println!("테마 {}개 × 목소리·배경음악 경우: 내보내기 인자 모두 같음", themes.len());
}