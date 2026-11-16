//! 미리보기 압축기(vox_dsp)가 내보내기의 ffmpeg acompressor 와 같은 소리를 내는지 (같은 신호를 둘 다에 넣어 비교)
use sermon_shorts::{media, voice, vox_dsp};
use std::io::Write;

#[test]
fn compressor_matches_ffmpeg() {
    let rate = 48000usize;
    // 작게·크게 말하는 것처럼 크기가 바뀌는 소리 (사인 + 잡음), 6초
    let mut seed = 1u32;
    let mut rnd = || { seed = seed.wrapping_mul(1103515245).wrapping_add(12345); (seed >> 8) as f32 / 16777216.0 - 0.5 };
    let n = rate * 6;
    let mut input = Vec::with_capacity(n * 2);
    for i in 0..n {
        let t = i as f32 / rate as f32;
        let env = [0.02, 0.4, 0.08, 0.9, 0.01, 0.3][(t as usize).min(5)];
        let s = (t * 2.0 * std::f32::consts::PI * 220.0).sin() * 0.7 + rnd() * 0.3;
        input.push(s * env);
        input.push((t * 2.0 * std::f32::consts::PI * 330.0).sin() * env * 0.8 + rnd() * 0.1 * env);
    }
    let mut child = media::command("ffmpeg").args(["-v", "error", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", "-", "-af", &voice::comp_filter(), "-f", "f32le", "-ar", "48000", "-ac", "2", "-"])
        .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).spawn().expect("ffmpeg");
    let bytes: Vec<u8> = input.iter().flat_map(|x| x.to_le_bytes()).collect();
    let mut stdin = child.stdin.take().unwrap();
    let w = std::thread::spawn(move || { stdin.write_all(&bytes).unwrap(); });
    let out = child.wait_with_output().unwrap();
    w.join().unwrap();
    let ff: Vec<f32> = out.stdout.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    assert_eq!(ff.len(), input.len(), "ffmpeg 출력 길이");
    let mut comp = vox_dsp::Compressor::new(rate as f64);
    let (mut max_err, mut max_ref) = (0f32, 0f32);
    for f in 0..n {
        let (l, r) = comp.process(input[f * 2], input[f * 2 + 1]);
        max_err = max_err.max((l - ff[f * 2]).abs()).max((r - ff[f * 2 + 1]).abs());
        max_ref = max_ref.max(ff[f * 2].abs());
    }
    println!("압축기: 최대 차이 {max_err:.2e} (최대 크기 {max_ref:.3})");
    assert!(max_err < 1e-4, "압축기 차이 {max_err}");
}