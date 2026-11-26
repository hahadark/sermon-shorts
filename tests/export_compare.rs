//! 내보내기 비교 검사: 같은 프로젝트를 실제로 내보낸 MP4·SRT 를 재서 기준(tests/fixtures/export_baseline.json)과 견준다.
//!
//! - 원본: ffmpeg 로 만든 12초 시험 영상 (단색 화면 + 1초마다 높이가 바뀌는 소리: 200 + 100×초 Hz).
//!   실제 설교 영상·자막이 필요 없어서 어느 PC·CI 에서도 돈다 (ffmpeg·ffprobe 만 있으면).
//! - 단어 몇 개를 지워 컷 두 곳을 만든 프로젝트를 기본 테마로 내보낸다 (libx264, 하드웨어 인코더와 무관).
//! - 잰 것: 길이·해상도·초당 프레임·소리 형식, SRT 전체, 자막마다 화면에 나온 시각(시작·끝)과 자리(글자 상자),
//!   소리(0.25초마다 높이 → 원본 몇 초의 소리가 나오는지 = 컷·싱크가 맞는지).
//! - 두 가지로 판정한다: ① 편집 계산(edl)이 정한 값과 맞는지 (자막 시각·길이·소리 위치), ② 기준 파일과 같은지 (자막 자리·SRT·형식).
//!   기준을 일부러 바꿀 때만 `SS_UPDATE_BASELINE=1 cargo test --release --test export_compare` 로 다시 쓴다.
//! - 자막 자리는 같은 프로젝트를 자막 글만 비워 한 번 더 내보내 두 영상의 차이로 잰다 (제목·꼬리말·영상은 같아서 지워진다).
//! - 예전 Electron 판과 그림 단위로 견주는 것은 tools/parity.ps1 (이 PC 의 Electron 시험 결과 필요), ffmpeg 인자 전체는 tests/export_args_parity.rs.
use serde_json::{json, Value};
use sermon_shorts::{edl, export, media, model::{EditSettings, Overrides, Word}, theme};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const SRC_SECS: f64 = 12.0;
/// 프레임을 작게 풀어 잰다 (1080×1920 의 1/4)
const SW: usize = 270;
const SH: usize = 480;
const FPS: f64 = 30.0;
const AR: usize = 8000;

fn have_ffmpeg() -> bool {
    media::command("ffmpeg").arg("-version").output().is_ok_and(|o| o.status.success()) && media::command("ffprobe").arg("-version").output().is_ok_and(|o| o.status.success())
}

/// 시험 원본: 1920×1080 30fps 단색 + 원본 n초(0부터)에는 200+100n Hz 소리
fn make_source(path: &Path) {
    let o = media::command("ffmpeg").args(["-v", "error", "-y", "-f", "lavfi", "-i", &format!("color=c=0x1e3a5f:s=1920x1080:r=30:d={SRC_SECS}"),
        "-f", "lavfi", "-i", &format!("aevalsrc=0.5*sin(2*PI*(200+100*floor(t))*t):s=48000:d={SRC_SECS}"),
        "-c:v", "libx264", "-preset", "ultrafast", "-g", "15", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest"]).arg(path).output().expect("ffmpeg");
    assert!(o.status.success(), "시험 원본 만들기 실패: {}", String::from_utf8_lossy(&o.stderr));
}

/// 0.5초에 한 단어 (24개). 3.0~5.0초, 8.0~9.5초를 지워 컷 두 곳
fn words() -> Vec<Word> {
    let t = ["오늘", "우리는", "하나님의", "말씀을", "함께", "나눕니다", "음", "어", "그러니까", "네", "기도는", "하나님과의", "대화입니다", "우리가", "말하고", "하나님이", "아", "그", "음", "들으시는", "시간입니다", "그래서", "날마다", "기도합니다"];
    t.iter().enumerate().map(|(i, s)| {
        let mut w: Word = serde_json::from_value(json!({ "id": i, "text": s, "start": i as f64 * 0.5 + 0.05, "end": i as f64 * 0.5 + 0.45 })).unwrap();
        w.del = (6..10).contains(&i) || (16..19).contains(&i);
        w.stt_text = Some(s.to_string());
        w
    }).collect()
}

fn request(source: &Path, out: PathBuf, with_captions: bool) -> (export::Request, Vec<edl::Segment>, Vec<edl::Line>) {
    let ws = words();
    let s = EditSettings::default();
    let segs = edl::build_segments(&ws, &s, &Overrides::default(), Some(SRC_SECS), None);
    let lines = edl::build_lines(&ws, &segs, &s);
    let th = theme::normalize(Some(&serde_json::from_str::<Value>(include_str!("../assets/themes/basic-blank.json")).unwrap()));
    let req = export::Request {
        source: source.to_path_buf(), out, words: ws, segs: segs.clone(), lines: if with_captions { lines.clone() } else { lines.iter().map(|l| edl::Line { text: String::new(), ..l.clone() }).collect() }, theme: th,
        crop: export::Crop::default(), fade_ms: s.fade_ms,
        meta: export::Meta { title: "오늘의 말씀 / 하나님 중심의 *기도*".into(), verse: "마태복음 6:13".into(), speaker: "설교자".into(), church: "시험교회".into() },
        encoder: export::Encoder::X264, voice: None, bgm: None, bgm_file: None, bgm_plan: None, audio_offset: 0.0,
    };
    (req, segs, lines)
}

fn ffprobe(path: &Path) -> Value {
    let o = media::command("ffprobe").args(["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,sample_rate,channels,duration", "-of", "json"]).arg(path).output().unwrap();
    serde_json::from_slice(&o.stdout).unwrap()
}

/// 영상 전체를 작게 회색으로 풀기 (프레임마다 SW×SH 바이트)
fn gray_frames(path: &Path) -> Vec<Vec<u8>> {
    let o = media::command("ffmpeg").args(["-v", "error", "-i"]).arg(path).args(["-an", "-vf", &format!("scale={SW}:{SH}:flags=area,format=gray"), "-f", "rawvideo", "-"]).output().unwrap();
    o.stdout.as_chunks::<{ SW * SH }>().0.iter().map(|c| c.to_vec()).collect()
}

fn mono_audio(path: &Path) -> Vec<f32> {
    let o = media::command("ffmpeg").args(["-v", "error", "-i"]).arg(path).args(["-vn", "-ac", "1", "-ar", &AR.to_string(), "-f", "f32le", "-"]).output().unwrap();
    o.stdout.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect()
}

/// 자막 없는 영상과 다른 픽셀 (자막 글자)
fn mask(a: &[u8], b: &[u8]) -> Vec<bool> { a.iter().zip(b).map(|(x, y)| (*x as i32 - *y as i32).abs() > 48).collect() }
fn count(m: &[bool]) -> usize { m.iter().filter(|x| **x).count() }
fn iou(a: &[bool], b: &[bool]) -> f64 {
    let (mut i, mut u) = (0usize, 0usize);
    for (x, y) in a.iter().zip(b) { i += usize::from(*x && *y); u += usize::from(*x || *y); }
    if u == 0 { 1.0 } else { i as f64 / u as f64 }
}
/// 글자 상자 (1080×1920 기준 픽셀)
fn bbox(m: &[bool]) -> Option<[i64; 4]> {
    let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0, 0);
    for (k, v) in m.iter().enumerate() { if *v { let (x, y) = (k % SW, k / SW); x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x + 1); y1 = y1.max(y + 1); } }
    (x0 != usize::MAX).then(|| [x0 as i64 * 4, y0 as i64 * 4, x1 as i64 * 4, y1 as i64 * 4])
}

/// 소리 높이 (Hz): 0 을 지나는 횟수로
fn pitch(a: &[f32], t: f64, half: f64) -> f64 {
    let (s, e) = (((t - half) * AR as f64).max(0.0) as usize, (((t + half) * AR as f64) as usize).min(a.len()));
    if e <= s + 2 { return 0.0; }
    let z = a[s..e].windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count();
    z as f64 / 2.0 / ((e - s) as f64 / AR as f64)
}

/// 출력 시각 → 원본 시각 (구간 경계 가까이면 None)
fn src_of(segs: &[edl::Segment], t: f64, guard: f64) -> Option<f64> {
    let mut o = 0.0;
    for s in segs {
        let d = s.end - s.start;
        if t < o + d { return (t - o > guard && o + d - t > guard).then_some(s.start + (t - o)); }
        o += d;
    }
    None
}

fn measure(out: &Path, bare: &Path, segs: &[edl::Segment], lines: &[edl::Line]) -> Value {
    let p = ffprobe(out);
    let streams = p["streams"].as_array().cloned().unwrap_or_default();
    let v = streams.iter().find(|s| s["codec_type"] == "video").cloned().unwrap_or(Value::Null);
    let a = streams.iter().find(|s| s["codec_type"] == "audio").cloned().unwrap_or(Value::Null);
    let num = |x: &Value| x.as_str().and_then(|s| s.parse::<f64>().ok()).or(x.as_f64()).unwrap_or(f64::NAN);
    let fr = v["r_frame_rate"].as_str().unwrap_or("0/1").split('/').map(|x| x.parse::<f64>().unwrap_or(0.0)).collect::<Vec<_>>();
    // 자막: 자막 줄 가운데 프레임의 글자 모양이 이어지는 동안을 그 자막이 나온 시간으로
    let (fa, fb) = (gray_frames(out), gray_frames(bare));
    let n = fa.len().min(fb.len());
    let masks: Vec<Vec<bool>> = (0..n).map(|i| mask(&fa[i], &fb[i])).collect();
    let mut caps = vec![];
    for l in lines {
        let mid = (((l.out_start + l.out_end) / 2.0) * FPS) as usize;
        let mid = mid.min(n.saturating_sub(1));
        let m = &masks[mid];
        let same = |i: usize| count(&masks[i]) > 0 && iou(&masks[i], m) > 0.85;
        let (mut s, mut e) = (mid, mid);
        while s > 0 && same(s - 1) { s -= 1; }
        while e + 1 < n && same(e + 1) { e += 1; }
        caps.push(json!({ "text": l.text, "start": s as f64 / FPS, "end": (e + 1) as f64 / FPS, "bbox": bbox(m), "pixels": count(m) * 16 }));
    }
    // 소리: 0.25초마다 높이
    let au = mono_audio(out);
    let total = edl::segments_duration(segs);
    let mut sound = vec![];
    let mut t = 0.125;
    while t < total - 0.1 {
        sound.push(json!({ "t": (t * 1000.0).round() / 1000.0, "hz": pitch(&au, t, 0.06).round(), "src": src_of(segs, t, 0.08).map(|x| (x * 1000.0).round() / 1000.0) }));
        t += 0.25;
    }
    json!({
        "duration": num(&p["format"]["duration"]), "videoDuration": num(&v["duration"]), "audioDuration": num(&a["duration"]),
        "width": v["width"], "height": v["height"], "fps": if fr.len() == 2 && fr[1] > 0.0 { fr[0] / fr[1] } else { 0.0 },
        "sampleRate": num(&a["sample_rate"]), "channels": a["channels"], "frames": n,
        "srt": std::fs::read_to_string(export::srt_path_of(out)).unwrap_or_default(), "captions": caps, "sound": sound,
    })
}

fn export_one(req: export::Request) -> export::Done {
    export::run(req, Arc::new(Mutex::new(export::Progress::default()))).expect("내보내기")
}

#[test]
fn export_matches_baseline() {
    if !have_ffmpeg() { eprintln!("ffmpeg·ffprobe 가 없어 내보내기 비교 검사를 건너뜁니다"); return; }
    let dir = std::env::temp_dir().join(format!("ss_export_compare_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let src = dir.join("source.mp4");
    make_source(&src);
    let (req, segs, lines) = request(&src, dir.join("out.mp4"), true);
    let (bare_req, _, _) = request(&src, dir.join("bare.mp4"), false);
    let done = export_one(req);
    export_one(bare_req);
    let got = measure(&done.out, &dir.join("bare.mp4"), &segs, &lines);
    let total = edl::segments_duration(&segs);
    let mut bad: Vec<String> = vec![];
    let mut check = |ok: bool, what: String| { if !ok { bad.push(what); } };

    // ① 편집 계산과 맞는지 ----------------------------------------------------
    check(segs.len() == 3, format!("컷 두 곳 → 구간 3개여야 함: {}", segs.len()));
    check(got["width"] == 1080 && got["height"] == 1920, format!("해상도 1080×1920: {}×{}", got["width"], got["height"]));
    check((got["fps"].as_f64().unwrap() - 30.0).abs() < 0.01, format!("30fps: {}", got["fps"]));
    check(got["sampleRate"].as_f64() == Some(48000.0), format!("소리 48kHz: {}", got["sampleRate"]));
    for k in ["videoDuration", "audioDuration", "duration"] {
        let d = got[k].as_f64().unwrap_or(f64::NAN);
        check((d - total).abs() < 0.06, format!("{k} {d:.3} ≠ 편집 길이 {total:.3}"));
    }
    check(got["srt"].as_str() == Some(edl::to_srt(&lines).as_str()), "SRT 가 편집 자막과 다름".into());
    let caps = got["captions"].as_array().unwrap();
    check(caps.len() == lines.len() && lines.len() >= 4, format!("자막 줄 수 {}", lines.len()));
    for (c, l) in caps.iter().zip(&lines) {
        let (s, e) = (c["start"].as_f64().unwrap(), c["end"].as_f64().unwrap());
        // 프레임 경계로 반올림되므로 한 프레임 반까지
        check((s - l.out_start).abs() <= 1.5 / FPS, format!("{:?} 자막 시작 {s:.3} ≠ {:.3}", l.text, l.out_start));
        check((e - l.out_end).abs() <= 1.5 / FPS || (l.out_end >= total - 0.05 && e >= total - 0.1), format!("{:?} 자막 끝 {e:.3} ≠ {:.3}", l.text, l.out_end));
        check(c["bbox"].is_array(), format!("{:?} 자막이 화면에 없음", l.text));
    }
    let sound = got["sound"].as_array().unwrap();
    let mut heard = 0;
    for x in sound {
        let Some(src) = x["src"].as_f64() else { continue };
        // 원본 초 경계 가까이는 두 높이가 섞이므로 뺀다
        if (src - src.round()).abs() < 0.08 { continue; }
        let want = 200.0 + 100.0 * src.floor();
        let hz = x["hz"].as_f64().unwrap();
        check((hz - want).abs() <= want * 0.06 + 10.0, format!("출력 {}초 소리 {hz}Hz ≠ 원본 {src}초의 {want}Hz (컷·싱크 어긋남)", x["t"]));
        heard += 1;
    }
    check(heard >= 20, format!("잰 소리 칸이 너무 적음 {heard}"));

    // ② 기준 파일과 같은지 -----------------------------------------------------
    let base_path = PathBuf::from("tests/fixtures/export_baseline.json");
    if std::env::var("SS_UPDATE_BASELINE").is_ok() || !base_path.exists() {
        std::fs::write(&base_path, serde_json::to_string_pretty(&got).unwrap() + "\n").unwrap();
        eprintln!("기준을 새로 썼습니다: {}", base_path.display());
    } else {
        let base: Value = serde_json::from_str(&std::fs::read_to_string(&base_path).unwrap()).unwrap();
        for k in ["width", "height", "channels", "frames"] { check(got[k] == base[k], format!("{k}: {} (기준 {})", got[k], base[k])); }
        for k in ["duration", "videoDuration", "audioDuration", "fps", "sampleRate"] {
            let (g, b) = (got[k].as_f64().unwrap_or(f64::NAN), base[k].as_f64().unwrap_or(f64::NAN));
            check((g - b).abs() < 0.03, format!("{k}: {g} (기준 {b})"));
        }
        check(got["srt"] == base["srt"], "SRT 가 기준과 다름".into());
        let bc = base["captions"].as_array().unwrap();
        check(bc.len() == caps.len(), format!("자막 수 {} (기준 {})", caps.len(), bc.len()));
        for (c, b) in caps.iter().zip(bc) {
            check(c["text"] == b["text"], format!("자막 글 {} (기준 {})", c["text"], b["text"]));
            for k in ["start", "end"] { check((c[k].as_f64().unwrap() - b[k].as_f64().unwrap()).abs() <= 1.01 / FPS, format!("{} {k} {} (기준 {})", c["text"], c[k], b[k])); }
            // 글자 상자: 글꼴 그리기·인코딩 차이로 몇 픽셀은 흔들릴 수 있다 (1080 기준 12px)
            let (cb, bb) = (c["bbox"].as_array(), b["bbox"].as_array());
            let near = match (cb, bb) { (Some(x), Some(y)) => x.iter().zip(y).all(|(p, q)| (p.as_i64().unwrap() - q.as_i64().unwrap()).abs() <= 12), (None, None) => true, _ => false };
            check(near, format!("{} 자막 자리 {} (기준 {})", c["text"], c["bbox"], b["bbox"]));
            let (cp, bp) = (c["pixels"].as_f64().unwrap(), b["pixels"].as_f64().unwrap());
            check((cp - bp).abs() <= bp * 0.15 + 64.0, format!("{} 글자 픽셀 {cp} (기준 {bp})", c["text"]));
        }
        let bs = base["sound"].as_array().unwrap();
        check(bs.len() == sound.len(), format!("소리 칸 수 {} (기준 {})", sound.len(), bs.len()));
        for (x, b) in sound.iter().zip(bs) {
            check(x["src"] == b["src"], format!("출력 {}초의 원본 시각 {} (기준 {})", x["t"], x["src"], b["src"]));
            let (h, bh) = (x["hz"].as_f64().unwrap(), b["hz"].as_f64().unwrap());
            check((h - bh).abs() <= bh * 0.06 + 10.0, format!("출력 {}초 소리 {h}Hz (기준 {bh}Hz)", x["t"]));
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    assert!(bad.is_empty(), "내보내기 비교 검사 실패 {}건:\n{}", bad.len(), bad.join("\n"));
}

/// 출력 자막을 모두 비워 자막 줄이 하나도 없어도 내보내기가 끝난다 (예전에는 ffmpeg 가 끝나지 않았다)
#[test]
fn export_without_any_caption_finishes() {
    if !have_ffmpeg() { return; }
    let dir = std::env::temp_dir().join(format!("ss_export_nocap_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let src = dir.join("source.mp4");
    make_source(&src);
    let (mut req, segs, _) = request(&src, dir.join("out.mp4"), true);
    req.lines.clear();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || { let _ = tx.send(export::run(req, Arc::new(Mutex::new(export::Progress::default())))); });
    let r = rx.recv_timeout(std::time::Duration::from_secs(120)).expect("자막 없는 내보내기가 2분 안에 끝나지 않음");
    let done = r.expect("내보내기");
    let d = ffprobe(&done.out)["format"]["duration"].as_str().and_then(|x| x.parse::<f64>().ok()).unwrap_or(0.0);
    assert!((d - edl::segments_duration(&segs)).abs() < 0.06, "길이 {d}");
    let _ = std::fs::remove_dir_all(&dir);
}
