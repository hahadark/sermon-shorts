//! 음성 싱크 실제 확인: 시험 프로젝트를 오프셋 0 / +300ms / −300ms 로 내보내고,
//! 결과 MP4 의 소리를 PCM 으로 뽑아 교차상관으로 지연을 잰다 (원본 소리 · 오프셋 0 결과와 비교).
//! cargo run --release --offline --example sync_measure -- [출력 폴더]
use sermon_shorts::{edl, export, project::Project, theme};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const SR: usize = 8000;

fn pcm(path: &Path, ss: Option<(f64, f64)>) -> Vec<f32> {
    let mut c = sermon_shorts::media::command("ffmpeg");
    c.args(["-v", "error", "-nostdin"]);
    if let Some((a, d)) = ss { c.args(["-ss", &format!("{a:.3}"), "-t", &format!("{d:.3}")]); }
    let o = c.arg("-i").arg(path).args(["-vn", "-ac", "1", "-ar", &SR.to_string(), "-f", "f32le", "-"]).output().expect("ffmpeg");
    o.stdout.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
}

/// b 가 a 보다 몇 초 늦은지 (±max 초, 정규화 교차상관)
fn lag(a: &[f32], b: &[f32], max: f64) -> (f64, f64) {
    let n = a.len().min(b.len());
    let m = (max * SR as f64) as i64;
    let (ea, eb): (f64, f64) = (a[..n].iter().map(|x| (*x as f64).powi(2)).sum(), b[..n].iter().map(|x| (*x as f64).powi(2)).sum());
    let mut best = (f64::MIN, 0i64);
    for k in -m..=m {
        let (i0, i1) = ((-k).max(0) as usize, (n as i64 - k.max(0)) as usize);
        let mut s = 0f64;
        for i in i0..i1 { s += (a[i] * b[(i as i64 + k) as usize]) as f64; }
        if s > best.0 { best = (s, k); }
    }
    (best.1 as f64 / SR as f64, best.0 / (ea * eb).sqrt().max(1e-12))
}

fn main() {
    let out_dir = PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| std::env::temp_dir().join("ss_sync_measure").to_string_lossy().into()));
    std::fs::create_dir_all(&out_dir).unwrap();
    let src = PathBuf::from("F:/aside/sermon-shorts-app/cache/yt/uSE5pZB3gtQ/part_4955_5100.mp4");
    let mut pr = Project::load(Path::new("tests/fixtures/electron_project.sshorts")).unwrap();
    let dur = sermon_shorts::media::probe(&src).map(|p| p.duration).unwrap_or(156.0);
    // cuts: 컷이 많은 편집 (앞 45초만, 단어 8개마다 하나씩 지움)
    let cuts = std::env::args().nth(2).as_deref() == Some("cuts");
    if cuts { for (i, w) in pr.words.iter_mut().enumerate() { if w.start > 45.0 || i % 8 == 7 { w.del = true; } } }
    let segs = edl::build_segments(&pr.words, &pr.settings, &pr.overrides, Some(dur), pr.order.as_deref());
    let lines = edl::build_lines(&pr.words, &segs, &pr.settings);
    let th = theme::list_themes().into_iter().next().unwrap().json;
    println!("구간 {}개, 출력 길이 {:.2}초", segs.len(), edl::segments_duration(&segs));
    let mut outs = vec![];
    for (name, d) in [("zero", 0.0), ("plus300", 0.3), ("minus300", -0.3)] {
        let out = out_dir.join(format!("sync_{name}.mp4"));
        let _ = std::fs::remove_file(&out);
        let req = export::Request {
            source: src.clone(), out: out.clone(), words: pr.words.clone(), segs: segs.clone(), lines: lines.clone(),
            theme: theme::normalize(Some(&th)), crop: export::Crop::default(), fade_ms: pr.settings.fade_ms,
            meta: export::Meta { title: "싱크 시험".into(), verse: String::new(), speaker: String::new(), church: String::new() },
            encoder: export::Encoder::Nvenc, voice: None, bgm: None, bgm_file: None, bgm_plan: None, audio_offset: d,
        };
        let t0 = std::time::Instant::now();
        let r = export::run(req, Arc::new(Mutex::new(export::Progress::default())));
        match &r { Ok(x) => println!("{name}: 내보냄 {:.2}초 길이, {:.1}초 걸림", x.duration, t0.elapsed().as_secs_f64()), Err(e) => { println!("{name}: 실패 {e}"); std::process::exit(1); } }
        let p = sermon_shorts::media::probe(&out).unwrap();
        println!("  파일 길이 {:.3}초, 소리 {}", p.duration, p.has_audio);
        outs.push((name, d, out));
    }
    let zero = pcm(&outs[0].2, None);
    // 원본 대비: 첫 구간 (구간 시작 0.5초 뒤부터 경계 영향 없이)
    let s0 = &segs[0];
    let seg_len = (s0.end - s0.start).min(20.0);
    let orig = pcm(&src, Some((s0.start, seg_len)));
    let mut ok = true;
    let mut report = vec![];
    for (name, d, out) in &outs {
        let x = pcm(out, None);
        let head = &x[..((seg_len * SR as f64) as usize).min(x.len())];
        let (l_src, c_src) = lag(&orig, head, 0.6);
        let (l_zero, c_zero) = if *d == 0.0 { (0.0, 1.0) } else { lag(&zero, &x, 0.6) };
        let good = (l_src - d).abs() <= 0.02 && (l_zero - d).abs() <= 0.02;
        ok &= good;
        println!("{name} (오프셋 {:+} ms): 원본 첫 구간 대비 {:+.1} ms (상관 {:.2}), 오프셋0 결과 대비 전체 {:+.1} ms (상관 {:.2}) → {}", d * 1000.0, l_src * 1000.0, c_src, l_zero * 1000.0, c_zero, if good { "통과" } else { "실패" });
        report.push(serde_json::json!({ "name": name, "offsetMs": d * 1000.0, "vsSourceMs": l_src * 1000.0, "vsZeroMs": l_zero * 1000.0, "pass": good }));
    }
    std::fs::write(out_dir.join("sync_measure.json"), serde_json::to_string_pretty(&serde_json::json!({ "pass": ok, "results": report })).unwrap()).unwrap();
    println!("전체: {}", if ok { "통과" } else { "실패" });
    if !ok { std::process::exit(1); }
}
