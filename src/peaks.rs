//! 파형 개요: 10ms 칸마다 [최소, 최대]. 넓게 볼 때 쓰는 4배씩 줄인 단계(mip)도 함께 만든다.
use crate::media;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;

pub const BUCKET: f64 = 0.01;
const RATE: usize = 8000;
const PER: usize = 80; // 10ms

pub struct Level { pub bucket: f64, pub mm: Vec<(f32, f32)> }
pub struct Peaks { pub levels: Vec<Level>, pub gain: f32 }

pub fn compute(path: &Path) -> anyhow::Result<Peaks> {
    let mut child = media::command("ffmpeg").args(["-v", "error", "-nostdin"]).arg("-i").arg(path)
        .args(["-vn", "-ac", "1", "-ar", &RATE.to_string(), "-f", "s16le", "-"]).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?;
    let mut out = child.stdout.take().unwrap();
    let mut buf = vec![0u8; 64 * 1024];
    let mut pend: Vec<u8> = vec![];
    let mut mm: Vec<(f32, f32)> = vec![];
    let (mut lo, mut hi, mut n) = (0f32, 0f32, 0usize);
    loop {
        let k = out.read(&mut buf)?;
        if k == 0 { break; }
        pend.extend_from_slice(&buf[..k]);
        let whole = pend.len() / 2 * 2;
        for c in pend[..whole].chunks_exact(2) {
            let v = i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0;
            if v < lo { lo = v; } if v > hi { hi = v; }
            n += 1;
            if n == PER { mm.push((lo, hi)); lo = 0.0; hi = 0.0; n = 0; }
        }
        pend.drain(..whole);
    }
    if n > 0 { mm.push((lo, hi)); }
    let _ = child.wait();
    let mut levels = vec![Level { bucket: BUCKET, mm }];
    while levels.last().unwrap().mm.len() > 4096 {
        let prev = levels.last().unwrap();
        let next: Vec<(f32, f32)> = prev.mm.chunks(4).map(|c| c.iter().fold((0f32, 0f32), |a, b| (a.0.min(b.0), a.1.max(b.1)))).collect();
        let b = prev.bucket * 4.0;
        levels.push(Level { bucket: b, mm: next });
    }
    let mx = levels.last().unwrap().mm.iter().fold(0f32, |a, b| a.max(b.0.abs()).max(b.1.abs()));
    Ok(Peaks { levels, gain: 0.95 / mx.clamp(0.02, 1.0) })
}
