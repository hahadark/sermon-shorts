//! 두 투명 PNG 의 글자 위치 비교: 불투명(알파>128) 영역의 상자, 가장 잘 맞는 이동량
//! cargo run --release --example bbox -- <A.png> <B.png>
fn bbox(img: &image::RgbaImage) -> Option<(u32, u32, u32, u32)> {
    let (w, h) = img.dimensions();
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0, 0);
    for y in 0..h { for x in 0..w { if img.get_pixel(x, y)[3] > 128 { x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y); } } }
    if x1 < x0 { None } else { Some((x0, y0, x1, y1)) }
}
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let ia = image::open(&a[1]).unwrap().to_rgba8();
    let ib = image::open(&a[2]).unwrap().to_rgba8();
    let (ba, bb) = (bbox(&ia), bbox(&ib));
    println!("A {:?}  B {:?}", ba, bb);
    let (Some(ba), Some(bb)) = (ba, bb) else { return };
    let (x0, y0, x1, y1) = (ba.0.min(bb.0).saturating_sub(8), ba.1.min(bb.1).saturating_sub(8), (ba.2.max(bb.2) + 8).min(ia.width() - 1), (ba.3.max(bb.3) + 8).min(ia.height() - 1));
    let mut best = (f64::MAX, 0i32, 0i32);
    for dy in -6..=6 { for dx in -6..=6 {
        let mut s = 0f64; let mut n = 0f64;
        for y in y0..=y1 { for x in x0..=x1 {
            let (xb, yb) = (x as i32 + dx, y as i32 + dy);
            if xb < 0 || yb < 0 || xb >= ib.width() as i32 || yb >= ib.height() as i32 { continue; }
            let pa = ia.get_pixel(x, y); let pb = ib.get_pixel(xb as u32, yb as u32);
            s += (pa[3] as f64 - pb[3] as f64).abs(); n += 1.0;
        } }
        let m = s / n; if m < best.0 { best = (m, dx, dy); }
    } }
    let mut s0 = 0f64; let mut n0 = 0f64;
    for y in y0..=y1 { for x in x0..=x1 { s0 += (ia.get_pixel(x, y)[3] as f64 - ib.get_pixel(x, y)[3] as f64).abs(); n0 += 1.0; } }
    println!("이동 없이 평균 {:.2} / 가장 잘 맞는 이동 B 를 ({}, {}) 만큼: 평균 {:.2}", s0 / n0, best.1, best.2, best.0);
}
