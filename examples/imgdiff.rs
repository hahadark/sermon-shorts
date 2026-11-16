//! 두 폴더의 같은 이름 PNG 를 비교한다: 평균 차이, 크게 다른 픽셀 비율, 나란히 놓은 그림(왼쪽 Electron · 가운데 Rust · 오른쪽 차이)
//! cargo run --release --example imgdiff -- <A폴더> <B폴더> <출력폴더>
use image::{Rgba, RgbaImage};
fn over(px: &Rgba<u8>, bg: [u8; 3]) -> [f32; 3] {
    let a = px[3] as f32 / 255.0;
    [0, 1, 2].map(|i| px[i] as f32 * a + bg[i] as f32 * (1.0 - a))
}
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (da, db, out) = (std::path::PathBuf::from(&a[1]), std::path::PathBuf::from(&a[2]), std::path::PathBuf::from(&a[3]));
    std::fs::create_dir_all(&out).unwrap();
    let mut names: Vec<String> = std::fs::read_dir(&da).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.ends_with(".png")).collect();
    names.sort();
    let mut rows = vec![];
    for n in names {
        let (Ok(ia), Ok(ib)) = (image::open(da.join(&n)), image::open(db.join(&n))) else { rows.push(serde_json::json!({ "name": n, "missing": true })); continue };
        let (ia, ib) = (ia.to_rgba8(), ib.to_rgba8());
        if ia.dimensions() != ib.dimensions() { rows.push(serde_json::json!({ "name": n, "size": [ia.dimensions(), ib.dimensions()] })); continue; }
        let (w, h) = ia.dimensions();
        let mut sum = 0f64; let mut big = 0u64; let mut any = 0u64; let mut maxd = 0f32;
        let mut diff = RgbaImage::new(w, h);
        for y in 0..h { for x in 0..w {
            // 회색 바탕에 얹어 비교 (투명도 차이도 색 차이로 보인다)
            let (pa, pb) = (over(ia.get_pixel(x, y), [128, 128, 128]), over(ib.get_pixel(x, y), [128, 128, 128]));
            let d = (0..3).map(|i| (pa[i] - pb[i]).abs()).fold(0f32, f32::max);
            sum += d as f64; maxd = maxd.max(d);
            if d > 8.0 { any += 1; } if d > 64.0 { big += 1; }
            let v = (d * 3.0).min(255.0) as u8;
            diff.put_pixel(x, y, Rgba([v, v, v, 255]));
        } }
        let px = (w * h) as f64;
        // 나란히: 회색 바탕 A | B | 차이 (절반 크기)
        let (sw, sh) = (w / 2, h / 2);
        let mut side = RgbaImage::from_pixel(sw * 3, sh, Rgba([128, 128, 128, 255]));
        for (k, img) in [&ia, &ib, &diff].iter().enumerate() {
            let small = image::imageops::resize(*img, sw, sh, image::imageops::FilterType::Triangle);
            for y in 0..sh { for x in 0..sw { let p = small.get_pixel(x, y); let c = if k < 2 { over(p, [128, 128, 128]) } else { [p[0] as f32; 3] }; side.put_pixel(x + sw * k as u32, y, Rgba([c[0] as u8, c[1] as u8, c[2] as u8, 255])); } }
        }
        side.save(out.join(&n)).unwrap();
        rows.push(serde_json::json!({ "name": n, "mean": (sum / px * 1000.0).round() / 1000.0, "max": maxd, "pctAbove8": (any as f64 / px * 10000.0).round() / 100.0, "pctAbove64": (big as f64 / px * 10000.0).round() / 100.0 }));
    }
    println!("{}", serde_json::to_string(&rows).unwrap());
}
