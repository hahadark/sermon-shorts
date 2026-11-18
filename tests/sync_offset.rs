//! 음성 싱크 오프셋: 구간 계산, 프로젝트 저장, 내보내기 ffmpeg 인자, 미리보기 소리 길(실제 디코딩·교차상관)
use serde_json::json;
use sermon_shorts::{edl, export, player, project::Project, sync, theme};

fn close(a: f64, b: f64) -> bool { (a - b).abs() < 1e-9 }

#[test]
fn window_math() {
    // 늦춤(+): 원본 소리를 앞에서 가져온다
    let w = sync::window(10.0, 12.0, 0.3);
    assert!(close(w.lead, 0.0) && close(w.src_start, 9.7) && close(w.src_end, 11.7), "{w:?}");
    // 앞당김(−): 원본 소리를 뒤에서 가져온다
    let w = sync::window(10.0, 12.0, -0.3);
    assert!(close(w.lead, 0.0) && close(w.src_start, 10.3) && close(w.src_end, 12.3), "{w:?}");
    // 0초 근처에서 늦추면 앞부분 무음
    let w = sync::window(0.1, 1.0, 0.3);
    assert!(close(w.lead, 0.2) && close(w.src_start, 0.0) && close(w.src_end, 0.7), "{w:?}");
    assert!(close(w.lead + w.dur(), 0.9));
    // 구간 전체가 0초 앞: 전부 무음
    let w = sync::window(0.0, 0.2, 0.5);
    assert!(close(w.lead, 0.2) && close(w.dur(), 0.0), "{w:?}");
    // 0 이면 그대로
    assert_eq!(sync::window(3.0, 4.0, 0.0), sync::Window { lead: 0.0, src_start: 3.0, src_end: 4.0 });
}

#[test]
fn clamp_and_project_roundtrip() {
    assert_eq!(sync::clamp(0.12345), 0.123);
    assert_eq!(sync::clamp(-99.0), -sync::MAX);
    assert_eq!(sync::clamp(f64::NAN), 0.0);
    assert_eq!(sync::describe(0.3), "+300 ms");
    assert_eq!(sync::describe(-0.05), "-50 ms");
    let mut p = Project::load(std::path::Path::new("tests/fixtures/electron_project.sshorts")).unwrap();
    assert_eq!(sync::of(&p.rest), 0.0, "기본 0");
    assert!(p.to_json().get(sync::KEY).is_none(), "0 이면 파일에 쓰지 않음 (Electron 파일과 같음)");
    sync::set(&mut p.rest, -0.25);
    let v = p.to_json();
    assert_eq!(v[sync::KEY], json!(-0.25));
    let p2 = Project::from_json(v).unwrap();
    assert_eq!(sync::of(&p2.rest), -0.25, "다시 읽어도 값 유지");
    sync::set(&mut p.rest, 0.0);
    assert!(p.to_json().get(sync::KEY).is_none());
}

#[test]
fn preview_audio_plan() {
    let spans = player::timeline(&[(0.1, 1.0), (5.0, 6.5)]);
    let plan = player::audio_plan(&spans, 0.3);
    let r = player::RATE as usize;
    // 첫 구간: 앞 0.2초 무음, 원본 0..0.7
    assert_eq!(plan[0].0, r / 5);
    assert_eq!(plan[0].2, (0.9 * r as f64).round() as usize);
    let p0 = plan[0].1.unwrap();
    assert!(close(p0.src_start, 0.0) && close(p0.src_end, 0.7));
    // 둘째 구간: 원본 4.7..6.2
    let p1 = plan[1].1.unwrap();
    assert_eq!(plan[1].0, 0);
    assert!(close(p1.src_start, 4.7) && close(p1.src_end, 6.2));
    // 앞당김
    let plan = player::audio_plan(&spans, -0.3);
    assert!(close(plan[1].1.unwrap().src_start, 5.3) && close(plan[1].1.unwrap().src_end, 6.8));
    // 0 이면 원래 구간 그대로
    let plan = player::audio_plan(&spans, 0.0);
    for (p, s) in plan.iter().zip(&spans) { assert_eq!(p.0, 0); assert_eq!(p.1.unwrap().src_start, s.src_start); assert_eq!(p.1.unwrap().src_end, s.src_end); }
}

fn request(audio_offset: f64, bgm: bool) -> (export::Request, std::path::PathBuf) {
    let pr = Project::load(std::path::Path::new("tests/fixtures/electron_project.sshorts")).unwrap();
    let segs = edl::build_segments(&pr.words, &pr.settings, &pr.overrides, Some(156.0), pr.order.as_deref());
    let lines = edl::build_lines(&pr.words, &segs, &pr.settings);
    let temp = std::env::temp_dir().join("ss_sync_offset_args");
    std::fs::create_dir_all(&temp).unwrap();
    let th = theme::list_themes().into_iter().next().unwrap().json;
    let out_dur = edl::segments_duration(&segs);
    let b = json!({ "id": "moonstone", "duration": 255.14, "trackStart": 30, "trackEnd": 75.5, "align": "end", "fadeIn": 0, "fadeOut": 3.5, "volume": 0.35 });
    let req = export::Request {
        source: "F:/aside/sermon-shorts-app/cache/yt/uSE5pZB3gtQ/part_4955_5100.mp4".into(), out: temp.join("out.mp4"), words: pr.words.clone(), segs, lines,
        theme: theme::normalize(Some(&th)), crop: export::Crop::default(), fade_ms: pr.settings.fade_ms,
        meta: export::Meta { title: String::new(), verse: String::new(), speaker: String::new(), church: String::new() },
        encoder: export::Encoder::X264, voice: None,
        bgm_plan: if bgm { sermon_shorts::bgm::plan(&b, out_dur) } else { None }, bgm_file: bgm.then(|| temp.join("bgm.mp3")), bgm: bgm.then_some(b),
        audio_offset,
    };
    (req, temp)
}

fn count_inputs(args: &[String]) -> usize { args.iter().filter(|a| *a == "-i").count() }

#[test]
fn export_args_with_offset() {
    let (r0, temp) = request(0.0, true);
    let (a0, f0) = export::build_args(&r0, &temp, &[], r0.encoder).unwrap();
    assert!(f0.contains("[0:a]atrim="), "0 이면 영상 입력의 소리 그대로");
    for d in [0.3, -0.3] {
        let (r, _) = request(d, true);
        let (a, fg) = export::build_args(&r, &temp, &[], r.encoder).unwrap();
        // 소리 입력이 하나 늘고, 배경음악 입력 번호도 하나 뒤로
        assert_eq!(count_inputs(&a), count_inputs(&a0) + 1, "입력 하나 더 ({d})");
        assert!(!fg.contains("[0:a]"), "영상 입력의 소리는 쓰지 않음 ({d})");
        let segs = &r.segs;
        let start_t = (segs.iter().map(|s| s.start).fold(f64::MAX, f64::min) - 1.0).max(0.0);
        let end_t = segs.iter().map(|s| s.end).fold(f64::MIN, f64::max) + 1.0;
        let (ta, tb) = export::audio_input(segs, start_t, end_t, d).unwrap();
        assert!(close(ta, ((start_t - d).max(0.0) * 1000.0).round() / 1000.0));
        // 소리 입력 자리: 마지막 이미지 입력 뒤, 배경음악 앞
        let idx: Vec<usize> = a.iter().enumerate().filter(|(_, x)| *x == "-i").map(|(i, _)| i).collect();
        let ai = idx.len() - 2; // 배경음악이 마지막
        let at = idx[ai];
        assert_eq!(a[at - 4], "-ss"); assert_eq!(a[at - 3], format!("{ta:.3}"));
        assert_eq!(a[at - 2], "-to"); assert_eq!(a[at - 1], format!("{tb:.3}"));
        assert_eq!(a[at + 1], r.source.to_string_lossy());
        assert!(fg.contains(&format!("[{}:a]atrim=start=", idx.len() - 1)), "배경음악 번호가 밀림: {fg}");
        // 구간마다: 원본 [a−d, b−d) 를 소리 입력 기준으로 자르고 영상 구간 길이로 맞춘다
        for (i, s) in segs.iter().enumerate() {
            let w = sync::window(s.start, s.end, d);
            let want = format!("[{ai}:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS", (w.src_start - ta).max(0.0), (w.src_end - ta).max(0.0));
            let piece = export::audio_piece(ai as i32, s.start, s.end, start_t, ta, d);
            assert!(piece.starts_with(&want), "구간 {i}: {piece} / {want}");
            assert!(piece.contains(",apad,atrim=end="), "길이 유지 {piece}");
            assert!(fg.contains(&format!("{piece},afade=t=in:")), "구간 {i} 필터가 그래프에 있음");
        }
    }
    // 0초 근처 구간을 늦추면 앞 무음(adelay)
    let p = export::audio_piece(4, 0.1, 1.0, 0.0, 0.0, 0.3);
    assert_eq!(p, "[4:a]atrim=start=0.000:end=0.700,asetpts=PTS-STARTPTS,adelay=delays=200.000:all=1,apad,atrim=end=0.900");
    let p = export::audio_piece(4, 0.0, 0.2, 0.0, 0.0, 0.5);
    assert_eq!(p, "[4:a]atrim=start=0:end=0.200,asetpts=PTS-STARTPTS,volume=0,apad,atrim=end=0.200");
    // 끝 범위가 모자라지 않게
    let segs = vec![edl::Segment { start: 0.0, end: 2.0, ..r0.segs[0].clone() }];
    let (ta, tb) = export::audio_input(&segs, 0.0, 3.0, 5.0).unwrap();
    assert!(ta == 0.0 && tb >= 3.0);
}

/// 소리 둘(48kHz 두 채널 섞인 f32)의 지연: b 가 a 보다 몇 초 늦은지 (8kHz 모노 교차상관, ±max 초)
fn lag(a: &[f32], b: &[f32], max: f64) -> f64 {
    let mono = |x: &[f32]| -> Vec<f32> { x.chunks_exact(12).map(|c| c.iter().sum::<f32>() / 12.0).collect() };   // 6 프레임 평균 → 8kHz
    let (a, b) = (mono(a), mono(b));
    let n = a.len().min(b.len());
    let m = (max * 8000.0) as i64;
    let mut best = (f64::MIN, 0i64);
    for k in -m..=m {
        let mut s = 0f64;
        for i in 0..n as i64 { let j = i + k; if j >= 0 && (j as usize) < n { s += (a[i as usize] * b[j as usize]) as f64; } }
        if s > best.0 { best = (s, k); }
    }
    best.1 as f64 / 8000.0
}

#[test]
fn preview_audio_really_shifts() {
    let src = std::path::Path::new("F:/aside/sermon-shorts-app/cache/yt/uSE5pZB3gtQ/part_4955_5100.mp4");
    if !src.exists() { eprintln!("시험 영상 없음: 건너뜀"); return; }
    // 한 구간 6초 (원본 20~26초)
    let spans = player::timeline(&[(20.0, 26.0)]);
    let base = player::decode_preview_audio(src, &spans, 0.0, 0.0);
    assert_eq!(base.len(), 6 * player::RATE as usize * 2, "길이는 영상 구간 그대로");
    for d in [0.3, -0.3] {
        let x = player::decode_preview_audio(src, &spans, 0.0, d);
        assert_eq!(x.len(), base.len(), "길이 유지 ({d})");
        let l = lag(&base, &x, 0.5);
        println!("미리보기 오프셋 {d:+}: 잰 지연 {:+.1} ms", l * 1000.0);
        assert!((l - d).abs() <= 0.02, "미리보기 지연 {l} (원함 {d})");
    }
}
