//! 템플릿 그리기 (기존 src/renderer/template.js 의 drawTemplate). 브라우저 캔버스 대신 tiny-skia 로 그리고,
//! 글자는 ttf-parser 로 글꼴 윤곽을 읽어 직접 칠한다. 크롬 캔버스와 같은 규칙을 따른다:
//! textBaseline=middle(윈도 글꼴 높이의 가운데), letterSpacing(글자마다 뒤에 더함), 굵기가 없는 글꼴의 가짜 굵게·기울임,
//! shadowBlur(표준편차 = blur/2), 외곽선(lineJoin round, 너비 = stroke×2).
use crate::textfx::{self, Token};
use crate::theme::{nn, num, or, s, truthy};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tiny_skia::{Color, FillRule, GradientStop, LineJoin, LinearGradient, Paint, PathBuilder, Pixmap, Point, Rect, SpreadMode, Stroke, Transform};

pub const W: u32 = 1080;
pub const H: u32 = 1920;

// ---------------------------------------------------------------- 글꼴

struct FaceFile { family: String, data: &'static [u8], variable: bool }

pub struct FontBook { faces: Vec<FaceFile> }
static BOOK: std::sync::atomic::AtomicPtr<FontBook> = std::sync::atomic::AtomicPtr::new(std::ptr::null_mut());

/// 기존 앱 theme-storage.js 의 이름표 (그 밖에는 파일 이름이 글꼴 이름)
fn known_family(file: &str) -> Option<&'static str> {
    Some(match file {
        "YeonSung-Regular_fixed.ttf" | "YeonSung-Regular.ttf" => "Yeon Sung",
        "NotoSansKR-Variable.ttf" => "Noto Sans KR",
        "BlackHanSans-Regular.ttf" => "Black Han Sans",
        "DoHyeon-Regular.ttf" => "Do Hyeon",
        "NanumPenScript-Regular.ttf" => "Nanum Pen Script",
        _ => return None,
    })
}

impl FontBook {
    /// 앱 글꼴(assets/fonts) + 사용자가 넣은 글꼴(기존 앱 자료 폴더 fonts)
    pub fn load() -> FontBook {
        let mut faces = vec![];
        for dir in [crate::assets_dir().join("fonts"), crate::theme::user_data_dir().join("fonts")] {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            let mut files: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().map(|e| { let e = e.to_string_lossy().to_lowercase(); e == "ttf" || e == "otf" }).unwrap_or(false)).collect();
            files.sort();
            for p in files {
                let name = p.file_name().unwrap().to_string_lossy().to_string();
                let Ok(bytes) = std::fs::read(&p) else { continue };
                let data: &'static [u8] = Box::leak(bytes.into_boxed_slice());
                let Ok(face) = ttf_parser::Face::parse(data, 0) else { continue };
                let variable = face.variation_axes().into_iter().any(|a| a.tag == ttf_parser::Tag::from_bytes(b"wght"));
                let family = known_family(&name).map(String::from).unwrap_or_else(|| p.file_stem().unwrap().to_string_lossy().to_string());
                // 같은 이름이면 나중 파일이 이긴다 (기존 앱 fontMap 과 같게)
                faces.retain(|f: &FaceFile| f.family != family);
                faces.push(FaceFile { family, data, variable });
            }
        }
        FontBook { faces }
    }
    /// 지금 글꼴 목록. reload() 뒤에는 새 목록 (앞 목록도 그대로 살아 있어 이미 받아 간 참조는 안전하다)
    pub fn global() -> &'static FontBook {
        use std::sync::atomic::Ordering;
        let p = BOOK.load(Ordering::Acquire);
        if !p.is_null() { return unsafe { &*p }; }
        let fresh = Box::into_raw(Box::new(FontBook::load()));
        match BOOK.compare_exchange(std::ptr::null_mut(), fresh, Ordering::AcqRel, Ordering::Acquire) { Ok(_) => unsafe { &*fresh }, Err(cur) => unsafe { &*cur } }
    }
    /// 글꼴을 더한 뒤 다시 읽기 (테마 편집기 [글꼴 추가])
    pub fn reload() { BOOK.store(Box::into_raw(Box::new(FontBook::load())), std::sync::atomic::Ordering::Release); }
    pub fn families(&self) -> Vec<String> { self.faces.iter().map(|f| f.family.clone()).collect() }
    fn find(&self, family: &str) -> Option<&FaceFile> { self.faces.iter().find(|f| f.family == family) }
}

/// 크기·굵기가 정해진 글꼴 하나 (rustybuzz = 크롬이 쓰는 HarfBuzz 의 Rust 판으로 글자를 배치한다)
struct Sized {
    face: rustybuzz::Face<'static>,
    scale: f32,
    /// 가짜 굵게: 윤곽을 이만큼 두껍게 (0 이면 없음)
    bold: f32,
    italic: bool,
    /// textBaseline=middle 일 때 기준선이 글자 가운데에서 아래로 내려가는 거리 (크롬 NormalizedTypoAscentAndDescent)
    middle: f32,
}

impl Sized {
    fn new(ff: &FaceFile, size: f32, weight: f32, italic: bool) -> Option<Sized> {
        let mut face = rustybuzz::Face::from_slice(ff.data, 0)?;
        let face_w = if ff.variable { face.set_variations(&[rustybuzz::Variation { tag: ttf_parser::Tag::from_bytes(b"wght"), value: weight.clamp(100.0, 900.0) }]); 900.0 } else { 400.0 };
        let upem = face.units_per_em() as f32;
        let scale = size / upem;
        // 크롬(Skia) 가짜 굵게: 글자 크기 9px 에서 1/24, 36px 이상 1/32
        let bold = if weight >= 600.0 && face_w < 600.0 { let r = if size <= 9.0 { 1.0 / 24.0 } else if size >= 36.0 { 1.0 / 32.0 } else { 1.0 / 24.0 + (size - 9.0) / 27.0 * (1.0 / 32.0 - 1.0 / 24.0) }; size * r } else { 0.0 };
        // 크롬: OS/2 sTypoAscender·Descender 를 글자 크기에 맞게 나누고 1/64 px 로 반올림, 가운데 = (위 - 아래) / 2
        let lu = |x: f32| (x * 64.0).round() / 64.0;
        let norm = |a: f32, d: f32| { let h = a + d; if h > 0.0 && a >= 0.0 && a <= h { Some((lu(size * a / h), lu(size * d / h))) } else { None } };
        let typo = face.tables().os2.and_then(|o| norm(o.typographic_ascender() as f32, -(o.typographic_descender() as f32)));
        let (na, nd) = typo.or_else(|| {
            let (a, d) = match face.tables().os2 { Some(o) => (o.windows_ascender() as f32, (o.windows_descender() as f32).abs()), None => (face.ascender() as f32, -(face.descender() as f32)) };
            norm((a * scale).round(), (d * scale).round())
        }).unwrap_or((size * 0.8, size * 0.2));
        Some(Sized { face, scale, bold, italic, middle: (na - nd) / 2.0 })
    }
    fn has(&self, c: char) -> bool { self.face.glyph_index(c).map(|g| g.0 != 0).unwrap_or(false) }
}

/// 글자 묶음 하나를 배치한 결과: 글꼴 번호, 글리프, 위치(px, 기준선 기준)
struct Placed { font: usize, glyph: ttf_parser::GlyphId, x: f32, y: f32 }

/// 문자 종류 (같은 종류끼리 한 번에 배치. 공통 문자는 앞 글자를 따른다)
#[derive(Clone, Copy, PartialEq)]
enum Sc { Hangul, Latin, Han, Kana, Common }
fn script_of(c: char) -> Sc {
    let u = c as u32;
    match u {
        0xAC00..=0xD7A3 | 0x1100..=0x11FF | 0x3130..=0x318F | 0xA960..=0xA97F | 0xD7B0..=0xD7FF => Sc::Hangul,
        0x3040..=0x30FF | 0x31F0..=0x31FF => Sc::Kana,
        0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF => Sc::Han,
        _ if c.is_alphabetic() && u < 0x2000 => Sc::Latin,
        _ => Sc::Common,
    }
}

/// 글자 그리기용 글꼴 묶음 (주 글꼴 + 대체 글꼴)
pub struct Font { list: Vec<Sized>, pub size: f32, pub spacing: f32 }

impl Font {
    pub fn new(book: &FontBook, el: &Value, theme: &Value) -> Font {
        let size = or(&el["size"], 16.0) as f32;
        let weight = or(&el["weight"], 400.0) as f32;
        let italic = truthy(&el["italic"]);
        let fb = s(&theme["fallbackFont"], "Noto Sans KR");
        let primary = s(&el["font"], fb);
        let mut list = vec![];
        let mut seen: Vec<&str> = vec![];
        for fam in [primary, fb, "Noto Sans KR"] {
            if seen.contains(&fam) { continue; }
            seen.push(fam);
            if let Some(ff) = book.find(fam) { if let Some(sz) = Sized::new(ff, size, weight, italic) { list.push(sz); } }
        }
        if list.is_empty() { if let Some(ff) = book.faces.first() { if let Some(sz) = Sized::new(ff, size, weight, italic) { list.push(sz); } } }
        let spacing = if truthy(&el["letterSpacing"]) { size * num(&el["letterSpacing"]).unwrap_or(0.0) as f32 } else { 0.0 };
        Font { list, size, spacing }
    }
    /// 글을 배치한다: 글꼴(그 글자가 있는 첫 글꼴)·문자 종류가 같은 묶음마다 한국어 규칙으로 HarfBuzz 배치
    fn layout(&self, text: &str) -> (Vec<Placed>, f32) {
        let chars: Vec<char> = text.chars().collect();
        let mut out = vec![];
        let mut pen = 0.0f32;
        if self.list.is_empty() || chars.is_empty() { return (out, 0.0); }
        // 글자마다 글꼴·종류
        let mut runs: Vec<(usize, Sc, String)> = vec![];
        for &c in &chars {
            let sc = script_of(c);
            let fi = if c.is_whitespace() { runs.last().map(|r| r.0).unwrap_or(0) } else { self.list.iter().position(|f| f.has(c)).unwrap_or(0) };
            match runs.last_mut() {
                Some(r) if r.0 == fi && (sc == Sc::Common || r.1 == sc || r.1 == Sc::Common) => { if r.1 == Sc::Common { r.1 = sc; } r.2.push(c); }
                _ => runs.push((fi, sc, c.to_string())),
            }
        }
        for (fi, sc, s) in runs {
            let f = &self.list[fi];
            let mut buf = rustybuzz::UnicodeBuffer::new();
            buf.push_str(&s);
            buf.set_direction(rustybuzz::Direction::LeftToRight);
            buf.set_language("ko".parse().unwrap());
            buf.set_script(match sc { Sc::Latin => rustybuzz::script::LATIN, Sc::Han => rustybuzz::script::HAN, Sc::Kana => rustybuzz::script::KATAKANA, _ => rustybuzz::script::HANGUL });
            let gb = rustybuzz::shape(&f.face, &[], buf);
            let (infos, pos) = (gb.glyph_infos(), gb.glyph_positions());
            for i in 0..infos.len() {
                out.push(Placed { font: fi, glyph: ttf_parser::GlyphId(infos[i].glyph_id as u16), x: pen + pos[i].x_offset as f32 * f.scale, y: -(pos[i].y_offset as f32) * f.scale });
                pen += pos[i].x_advance as f32 * f.scale;
                // 크롬 letterSpacing: 글자(묶음)마다 뒤에 더한다
                if i + 1 == infos.len() || infos[i + 1].cluster != infos[i].cluster { pen += self.spacing; }
            }
        }
        (out, pen)
    }
    /// 크롬 measureText 와 같은 너비
    pub fn measure(&self, text: &str) -> f64 { self.layout(text).1 as f64 }
    /// middle 기준선에서 글자 기준선까지 (아래로 +)
    pub fn middle_offset(&self) -> f32 { self.list.first().map(|f| f.middle).unwrap_or(0.0) }
    /// 글을 윤곽 경로로 (x, 기준선 y). 가짜 굵게 두께도 돌려준다
    fn path(&self, text: &str, x: f32, baseline: f32) -> (Option<tiny_skia::Path>, f32) {
        let mut pb = PathBuilder::new();
        let mut bold = 0.0f32;
        for p in self.layout(text).0 {
            let f = &self.list[p.font];
            bold = bold.max(f.bold);
            let mut ob = Outline { pb: &mut pb, x: x + p.x, y: baseline + p.y, s: f.scale, skew: if f.italic { 0.25 } else { 0.0 } };
            f.face.outline_glyph(p.glyph, &mut ob);
        }
        (pb.finish(), bold)
    }
}
struct Outline<'a> { pb: &'a mut PathBuilder, x: f32, y: f32, s: f32, skew: f32 }
impl Outline<'_> {
    fn p(&self, x: f32, y: f32) -> (f32, f32) { let yy = -y * self.s; (self.x + x * self.s - yy * self.skew, self.y + yy) }
}
impl ttf_parser::OutlineBuilder for Outline<'_> {
    fn move_to(&mut self, x: f32, y: f32) { let (a, b) = self.p(x, y); self.pb.move_to(a, b); }
    fn line_to(&mut self, x: f32, y: f32) { let (a, b) = self.p(x, y); self.pb.line_to(a, b); }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) { let (a, b) = self.p(x1, y1); let (c, d) = self.p(x, y); self.pb.quad_to(a, b, c, d); }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) { let (a, b) = self.p(x1, y1); let (c, d) = self.p(x2, y2); let (e, f) = self.p(x, y); self.pb.cubic_to(a, b, c, d, e, f); }
    fn close(&mut self) { self.pb.close(); }
}

// ---------------------------------------------------------------- 색·도형

/// CSS 색: #RGB #RGBA #RRGGBB #RRGGBBAA rgb() rgba() 몇 가지 이름
pub fn parse_color(c: &str) -> Color {
    let c = c.trim();
    let hx = |s: &str| u8::from_str_radix(s, 16).unwrap_or(0);
    if let Some(h) = c.strip_prefix('#') {
        let d: Vec<char> = h.chars().collect();
        let two = |i: usize| hx(&format!("{}{}", d[i], d[i + 1]));
        let one = |i: usize| hx(&format!("{}{}", d[i], d[i]));
        return match d.len() {
            3 => Color::from_rgba8(one(0), one(1), one(2), 255),
            4 => Color::from_rgba8(one(0), one(1), one(2), one(3)),
            6 => Color::from_rgba8(two(0), two(2), two(4), 255),
            8 => Color::from_rgba8(two(0), two(2), two(4), two(6)),
            _ => Color::BLACK,
        };
    }
    let lc = c.to_lowercase();
    if let Some(inner) = lc.strip_prefix("rgba(").or_else(|| lc.strip_prefix("rgb(")) {
        let v: Vec<f32> = inner.trim_end_matches(')').split(',').filter_map(|x| x.trim().parse().ok()).collect();
        if v.len() >= 3 { return Color::from_rgba8(v[0] as u8, v[1] as u8, v[2] as u8, (v.get(3).copied().unwrap_or(1.0).clamp(0.0, 1.0) * 255.0).round() as u8); }
    }
    match lc.as_str() { "white" => Color::WHITE, "transparent" => Color::TRANSPARENT, _ => Color::BLACK }
}

fn paint(c: Color) -> Paint<'static> { let mut p = Paint::default(); p.set_color(c); p.anti_alias = true; p }

/// canvas roundRect(arcTo) 와 같은 둥근 사각형
pub fn round_rect(x: f32, y: f32, w: f32, h: f32, r: f32) -> Option<tiny_skia::Path> {
    let r = r.max(0.0).min(w / 2.0).min(h / 2.0);
    let mut pb = PathBuilder::new();
    if r <= 0.0 { return Rect::from_xywh(x, y, w, h).map(PathBuilder::from_rect); }
    let k = 0.552_284_8 * r;
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    pb.close();
    pb.finish()
}

fn fill_rect(pm: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, c: Color) {
    if let Some(r) = Rect::from_xywh(x, y, w, h) { pm.fill_rect(r, &paint(c), Transform::identity(), None); }
}

// ---------------------------------------------------------------- 그림자 (흐린 그림 위에 원래 그림)

#[derive(Clone, Copy)]
struct ShadowSpec { color: Color, blur: f32, dx: f32, dy: f32 }

/// 상자 흐림 3번 (가우스 흐림 근사, 표준편차 sigma)
fn blur_alpha(a: &mut [f32], w: usize, h: usize, sigma: f32) {
    if sigma < 0.3 { return; }
    let n = 3.0f32;
    let wl = ((12.0 * sigma * sigma / n + 1.0).sqrt()).floor() as i32;
    let wl = if wl % 2 == 0 { wl - 1 } else { wl };
    let wu = wl + 2;
    let m = ((12.0 * sigma * sigma - n * (wl * wl) as f32 - 4.0 * n * wl as f32 - 3.0 * n) / (-4.0 * wl as f32 - 4.0)).round() as i32;
    let mut tmp = vec![0f32; a.len()];
    for i in 0..3 {
        let r = (if i < m { wl } else { wu } - 1) / 2;
        if r <= 0 { continue; }
        box_pass(a, &mut tmp, w, h, r as usize, true);
        box_pass(&tmp, a, w, h, r as usize, false);
    }
}
fn box_pass(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize, horiz: bool) {
    let (outer, inner) = if horiz { (h, w) } else { (w, h) };
    let idx = |o: usize, i: usize| if horiz { o * w + i } else { i * w + o };
    let d = (2 * r + 1) as f32;
    for o in 0..outer {
        let mut acc = 0.0f32;
        for i in 0..=r.min(inner - 1) { acc += src[idx(o, i)]; }
        for i in 0..inner {
            dst[idx(o, i)] = acc / d;
            if i + r + 1 < inner { acc += src[idx(o, i + r + 1)]; }
            if i >= r { acc -= src[idx(o, i - r)]; }
        }
    }
}

/// draw 로 그린 것에 그림자를 붙여 pm 에 얹는다. 그림자가 없으면 바로 그린다. 흐림은 그린 영역(+여유)만 계산한다
fn with_shadow(pm: &mut Pixmap, shadow: Option<ShadowSpec>, draw: &mut dyn FnMut(&mut Pixmap)) {
    let Some(sh) = shadow.filter(|s| s.color.alpha() > 0.0) else { draw(pm); return };
    let (w, h) = (pm.width() as i64, pm.height() as i64);
    let mut layer = Pixmap::new(w as u32, h as u32).unwrap();
    draw(&mut layer);
    let src = layer.data();
    // 그린 영역
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, -1i64, -1i64);
    for y in 0..h { let row = &src[(y * w * 4) as usize..((y + 1) * w * 4) as usize]; let mut any = false; for x in 0..w { if row[(x * 4 + 3) as usize] != 0 { any = true; x0 = x0.min(x); x1 = x1.max(x); } } if any { y0 = y0.min(y); y1 = y1.max(y); } }
    if x1 < 0 { return; }
    let sigma = sh.blur / 2.0;
    let (dx, dy) = (sh.dx.round() as i64, sh.dy.round() as i64);
    let m = (sigma * 3.0).ceil() as i64 + 2;
    let (rx0, ry0) = ((x0 + dx - m).max(0), (y0 + dy - m).max(0));
    let (rx1, ry1) = ((x1 + dx + m).min(w - 1), (y1 + dy + m).min(h - 1));
    if rx1 >= rx0 && ry1 >= ry0 {
        let (rw, rh) = ((rx1 - rx0 + 1) as usize, (ry1 - ry0 + 1) as usize);
        let mut a: Vec<f32> = vec![0.0; rw * rh];
        for yy in 0..rh as i64 {
            let sy = ry0 + yy - dy;
            if sy < 0 || sy >= h { continue; }
            for xx in 0..rw as i64 {
                let sx = rx0 + xx - dx;
                if sx < 0 || sx >= w { continue; }
                a[(yy as usize) * rw + xx as usize] = src[((sy * w + sx) * 4 + 3) as usize] as f32 / 255.0;
            }
        }
        blur_alpha(&mut a, rw, rh, sigma);
        let c = sh.color;
        let mut shp = Pixmap::new(rw as u32, rh as u32).unwrap();
        {
            let d = shp.data_mut();
            for (i, &v) in a.iter().enumerate() {
                let al = (v * c.alpha()).clamp(0.0, 1.0);
                if al <= 0.0 { continue; }
                d[i * 4] = (c.red() * al * 255.0).round() as u8;
                d[i * 4 + 1] = (c.green() * al * 255.0).round() as u8;
                d[i * 4 + 2] = (c.blue() * al * 255.0).round() as u8;
                d[i * 4 + 3] = (al * 255.0).round() as u8;
            }
        }
        pm.draw_pixmap(rx0 as i32, ry0 as i32, shp.as_ref(), &tiny_skia::PixmapPaint::default(), Transform::identity(), None);
    }
    pm.draw_pixmap(0, 0, layer.as_ref(), &tiny_skia::PixmapPaint::default(), Transform::identity(), None);
}
fn shadow_of(v: &Value, default_blur: f32, default_dy: f32, default_color: &str) -> ShadowSpec {
    ShadowSpec { color: parse_color(s(&v["color"], default_color)), blur: nn(&v["blur"], default_blur as f64) as f32, dx: or(&v["offsetX"], 0.0) as f32, dy: nn(&v["offsetY"], default_dy as f64) as f32 }
}

// ---------------------------------------------------------------- 그림 (로고)

pub fn load_image(p: &Path) -> Option<Arc<Pixmap>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<Arc<Pixmap>>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(v) = cache.lock().unwrap().get(p) { return v.clone(); }
    let img = image::open(p).ok().map(|i| {
        let rgba = i.to_rgba8();
        let (w, h) = rgba.dimensions();
        let mut pm = Pixmap::new(w, h).unwrap();
        for (o, px) in pm.pixels_mut().iter_mut().zip(rgba.pixels()) {
            *o = tiny_skia::ColorU8::from_rgba(px[0], px[1], px[2], px[3]).premultiply();
        }
        Arc::new(pm)
    });
    cache.lock().unwrap().insert(p.to_path_buf(), img.clone());
    img
}

fn draw_image(pm: &mut Pixmap, img: &Pixmap, x: f32, y: f32, w: f32, h: f32) {
    let Some(r) = Rect::from_xywh(x, y, w, h) else { return };
    let sx = w / img.width() as f32;
    let sy = h / img.height() as f32;
    let shader = tiny_skia::Pattern::new(img.as_ref(), SpreadMode::Pad, tiny_skia::FilterQuality::Bicubic, 1.0, Transform::from_row(sx, 0.0, 0.0, sy, x, y));
    let mut p = Paint::default();
    p.shader = shader; p.anti_alias = true;
    pm.fill_rect(r, &p, Transform::identity(), None);
}

// ---------------------------------------------------------------- 글자 블록

struct LaidLine { toks: Vec<Token>, widths: Vec<f64>, w: f64, scale: f64 }

fn layout(font: &Font, el: &Value, text: &str, groups: Option<&[String]>) -> (Vec<LaidLine>, f64) {
    let max_w = or(&el["width"], 1080.0);
    let max_lines = num(&el["maxLines"]).filter(|m| *m > 0.0).map(|m| m as i64).unwrap_or(1);
    let gap = font.measure(" ");
    let mut measure = |t: &str| font.measure(t);
    let nowrap = el["wrap"] == Value::Bool(false);
    let mut lines: Vec<Vec<Token>> = vec![];
    if let Some(g) = groups.filter(|g| !g.is_empty()) {
        let gs: Vec<String> = g.iter().map(|x| textfx::transform_text(x, &el["transform"])).collect();
        let mut toks = textfx::tokenize("", Some(&gs));
        for t in toks.iter_mut() { t.k = t.group; }
        lines = if nowrap { vec![toks] } else { textfx::wrap_tokens(&toks, &mut measure, max_w, gap, max_lines) };
    } else {
        let tt = textfx::transform_text(text, &el["transform"]);
        let paras: Vec<&str> = tt.split('\n').collect();
        let mut k = 0;
        for (pi, p) in paras.iter().enumerate() {
            let mut toks = textfx::tokenize(p, None);
            for t in toks.iter_mut() { t.k = k; k += 1; }
            if toks.is_empty() { continue; }
            if lines.len() as i64 >= max_lines { lines.last_mut().unwrap().extend(toks); continue; }
            let left = (max_lines - lines.len() as i64 - (paras.len() - pi - 1) as i64).max(1);
            let wrapped = if nowrap { vec![toks] } else { textfx::wrap_tokens(&toks, &mut measure, max_w, gap, left) };
            lines.extend(wrapped);
        }
    }
    let out = lines.into_iter().filter(|l| !l.is_empty()).map(|toks| {
        let widths: Vec<f64> = toks.iter().map(|t| font.measure(&t.text)).collect();
        let w = widths.iter().sum::<f64>() + gap * (toks.len().saturating_sub(1)) as f64;
        LaidLine { toks, widths, w, scale: if w > max_w { max_w / w } else { 1.0 } }
    }).collect();
    (out, gap)
}

#[derive(Clone, Copy, PartialEq)]
enum Part { All, Bg, Fg }

struct TextOpts<'a> { groups: Option<&'a [String]>, karaoke: Option<i64>, part: Part }

/// 글자 블록 그리기 → 그린 영역 (top, bottom, left, right)
fn draw_text(pm: &mut Pixmap, book: &FontBook, el: &Value, text: &str, theme: &Value, o: &TextOpts) -> Option<(f64, f64, f64, f64)> {
    if text.is_empty() || !truthy(el) || !truthy(&el["show"]) { return None; }
    let font = Font::new(book, el, theme);
    let (lines, gap) = layout(&font, el, text, o.groups);
    if lines.is_empty() { return None; }
    let size = or(&el["size"], 16.0);
    let line_h = size * or(&el["lineGap"], 1.2);
    let n = lines.len() as f64;
    let (ex, ey) = (num(&el["x"]).unwrap_or(0.0), num(&el["y"]).unwrap_or(0.0));
    let first_y = match s(&el["anchor"], "center") { "top" => ey, "bottom" => ey - (n - 1.0) * line_h, _ => ey - (n - 1.0) * line_h / 2.0 };
    let align = s(&el["align"], "center").to_string();
    let start_x = |ln: &LaidLine| { let w = ln.w * ln.scale; match align.as_str() { "left" => ex, "right" => ex - w, _ => ex - w / 2.0 } };
    let top = first_y - size / 2.0;
    let bottom = first_y + (n - 1.0) * line_h + size / 2.0;
    let w_max = lines.iter().map(|l| l.w * l.scale).fold(f64::MIN, f64::max);
    let left = match align.as_str() { "left" => ex, "right" => ex - w_max, _ => ex - w_max / 2.0 };
    let do_bg = o.part != Part::Fg;
    let do_fg = o.part != Part::Bg;

    if do_bg && truthy(&el["band"]) {
        let b = &el["band"];
        let py = nn(&b["paddingY"], 10.0);
        fill_rect(pm, 0.0, (top - py) as f32, 1080.0, (bottom - top + py * 2.0) as f32, parse_color(s(&b["color"], "#000000")));
    }
    if do_bg && truthy(&el["box"]) {
        let b = &el["box"];
        let pad = |k: &str| if !b[k].is_null() { nn(&b[k], 10.0) } else { nn(&b["padding"], 10.0) };
        let (pad_x, pad_y) = (pad("padX"), pad("padY"));
        let pt = paint(parse_color(s(&b["color"], "#000000AA")));
        let rad = or(&b["radius"], 0.0) as f32;
        if b["mode"].as_str() == Some("block") {
            let x0 = match align.as_str() { "left" => ex, "right" => ex - w_max, _ => ex - w_max / 2.0 };
            if let Some(p) = round_rect((x0 - pad_x) as f32, (top - pad_y) as f32, (w_max + pad_x * 2.0) as f32, (bottom - top + pad_y * 2.0) as f32, rad) { pm.fill_path(&p, &pt, FillRule::Winding, Transform::identity(), None); }
        } else {
            for (i, ln) in lines.iter().enumerate() {
                let cy = first_y + i as f64 * line_h;
                if let Some(p) = round_rect((start_x(ln) - pad_x) as f32, (cy - size / 2.0 - pad_y) as f32, (ln.w * ln.scale + pad_x * 2.0) as f32, (size + pad_y * 2.0) as f32, rad) { pm.fill_path(&p, &pt, FillRule::Winding, Transform::identity(), None); }
            }
        }
    }
    if !do_fg { return Some((top, bottom, left, left + w_max)); }

    let mid = font.middle_offset();
    let sh = &el["shadow"];
    let shadow = if truthy(sh) && (or(&sh["blur"], 0.0) != 0.0 || or(&sh["offsetX"], 0.0) != 0.0 || or(&sh["offsetY"], 0.0) != 0.0) {
        Some(ShadowSpec { color: parse_color(s(&sh["color"], "#000000")), blur: or(&sh["blur"], 0.0) as f32, dx: or(&sh["offsetX"], 0.0) as f32, dy: or(&sh["offsetY"], 0.0) as f32 })
    } else { None };
    // 줄마다: 옮기고(가로로 좁힘) 토큰을 그린다
    let tf = |li: usize| { let ln = &lines[li]; Transform::from_row(ln.scale as f32, 0.0, 0.0, 1.0, start_x(ln) as f32, (first_y + li as f64 * line_h) as f32) };
    let stroke_w = or(&el["stroke"], 0.0);
    if stroke_w > 0.0 {
        let c = parse_color(s(&el["strokeColor"], "#000000"));
        with_shadow(pm, shadow, &mut |pm| {
            for (li, ln) in lines.iter().enumerate() {
                let mut x = 0.0f64;
                for (ti, tok) in ln.toks.iter().enumerate() {
                    let (p, bold) = font.path(&tok.text, x as f32, mid);
                    if let Some(p) = p {
                        let st = Stroke { width: (stroke_w * 2.0) as f32 + bold, line_join: LineJoin::Round, ..Default::default() };
                        pm.stroke_path(&p, &paint(c), &st, tf(li), None);
                    }
                    x += ln.widths[ti] + gap;
                }
            }
        });
    }
    let fill_shadow = if stroke_w > 0.0 { None } else { shadow };
    with_shadow(pm, fill_shadow, &mut |pm| {
        for (li, ln) in lines.iter().enumerate() {
            let mut x = 0.0f64;
            for (ti, tok) in ln.toks.iter().enumerate() {
                let pieces: Vec<(String, bool)> = match &tok.parts { Some(ps) => ps.iter().map(|p| (p.text.clone(), p.hl)).collect(), None => vec![(tok.text.clone(), tok.hl)] };
                let mut px = x;
                for (t, hl) in pieces {
                    let c = parse_color(&textfx::token_color(hl, tok.k, el, li, o.karaoke));
                    let (p, bold) = font.path(&t, px as f32, mid);
                    if let Some(p) = p {
                        pm.fill_path(&p, &paint(c), FillRule::Winding, tf(li), None);
                        if bold > 0.0 { pm.stroke_path(&p, &paint(c), &Stroke { width: bold, ..Default::default() }, tf(li), None); }
                    }
                    px += font.measure(&t);
                }
                x += ln.widths[ti] + gap;
            }
        }
    });
    Some((top, bottom, left, left + w_max))
}

fn draw_badge(pm: &mut Pixmap, book: &FontBook, b: &Value, vals: &HashMap<&str, String>, theme: &Value) {
    if !truthy(b) || !truthy(&b["show"]) { return; }
    let text = textfx::fill_format(s(&b["text"], ""), vals);
    if text.is_empty() { return; }
    let font = Font::new(book, b, theme);
    let w = font.measure(&text);
    let (pad_x, pad_y) = (nn(&b["padX"], 20.0), nn(&b["padY"], 8.0));
    let size = or(&b["size"], 16.0);
    let (bw, bh) = (w + pad_x * 2.0, size + pad_y * 2.0);
    let (bx, by) = (num(&b["x"]).unwrap_or(0.0), num(&b["y"]).unwrap_or(0.0));
    let x0 = match s(&b["align"], "center") { "left" => bx, "right" => bx - bw, _ => bx - bw / 2.0 };
    if truthy(&b["bg"]) {
        if let Some(p) = round_rect(x0 as f32, (by - bh / 2.0) as f32, bw as f32, bh as f32, nn(&b["radius"], bh / 2.0) as f32) { pm.fill_path(&p, &paint(parse_color(s(&b["bg"], "#000"))), FillRule::Winding, Transform::identity(), None); }
    }
    add_hit("badge", (x0, by - bh / 2.0, x0 + bw, by + bh / 2.0), None);
    let c = parse_color(s(&b["color"], "#FFFFFF"));
    let (p, bold) = font.path(&text, (x0 + pad_x) as f32, by as f32 + font.middle_offset());
    if let Some(p) = p {
        pm.fill_path(&p, &paint(c), FillRule::Winding, Transform::identity(), None);
        if bold > 0.0 { pm.stroke_path(&p, &paint(c), &Stroke { width: bold, ..Default::default() }, Transform::identity(), None); }
    }
}

// ---------------------------------------------------------------- 미리보기 직접 편집용 요소 상자 (기존 addHit·SS.previewHits)

#[derive(Clone, Debug, PartialEq)]
pub struct Hit { pub key: String, pub x0: f64, pub y0: f64, pub x1: f64, pub y1: f64, pub mode: Option<&'static str> }
thread_local! { static SINK: std::cell::RefCell<Option<Vec<Hit>>> = const { std::cell::RefCell::new(None) }; }
fn add_hit(key: &str, r: (f64, f64, f64, f64), mode: Option<&'static str>) {
    SINK.with(|s| if let Some(v) = s.borrow_mut().as_mut() { v.push(Hit { key: key.into(), x0: r.0, y0: r.1, x1: r.2, y1: r.3, mode }) });
}
/// draw_text 의 (top, bottom, left, right) → (x0, y0, x1, y1)
fn tb(r: (f64, f64, f64, f64)) -> (f64, f64, f64, f64) { (r.2, r.0, r.3, r.1) }
/// 층을 그리면서 요소 상자도 모은다
pub fn render_hits(layers: &[&str], p: &OwnedParams) -> (Pixmap, Vec<Hit>) {
    SINK.with(|s| *s.borrow_mut() = Some(vec![]));
    let pm = render(layers, p);
    let hits = SINK.with(|s| s.borrow_mut().take().unwrap_or_default());
    (pm, hits)
}

// ---------------------------------------------------------------- 층 그리기

pub struct Params<'a> {
    pub title: String,
    pub verse: String,
    pub speaker: String,
    pub church_name: String,
    pub subtitle_text: String,
    pub subtitle_groups: Option<Vec<String>>,
    pub karaoke_index: Option<i64>,
    pub theme: &'a Value,
    pub logo: Option<Arc<Pixmap>>,
}

pub fn draw_background(pm: &mut Pixmap, t: &Value) {
    let c = &t["canvas"];
    match c["mode"].as_str() {
        Some("gradient") => {
            let g = &c["gradient"];
            let a = ((nn(&g["angle"], 180.0) - 90.0) * std::f64::consts::PI / 180.0) as f32;
            let (dx, dy) = (a.cos() * 960.0, a.sin() * 960.0);
            if let Some(sh) = LinearGradient::new(Point::from_xy(540.0 - dx, 960.0 - dy), Point::from_xy(540.0 + dx, 960.0 + dy), vec![GradientStop::new(0.0, parse_color(s(&g["from"], "#1B2A4A"))), GradientStop::new(1.0, parse_color(s(&g["to"], "#05070C")))], SpreadMode::Pad, Transform::identity()) {
                let mut p = Paint::default(); p.shader = sh;
                pm.fill_rect(Rect::from_xywh(0.0, 0.0, 1080.0, 1920.0).unwrap(), &p, Transform::identity(), None);
            }
        }
        Some("blur") => {}
        _ => fill_rect(pm, 0.0, 0.0, 1080.0, 1920.0, parse_color(s(&c["background"], "#000000"))),
    }
}

/// layers: background · under · top · subtitle · footer
pub fn draw_template(pm: &mut Pixmap, layers: &[&str], p: &Params) {
    let book = FontBook::global();
    let t = p.theme;
    let has = |k: &str| layers.contains(&"all") || layers.contains(&k);
    let v = &t["video"];
    let church = if !p.church_name.is_empty() { p.church_name.clone() } else { s(&t["churchName"]["text"], "").to_string() };
    let title_text = { let re = regex::Regex::new(r"\s+/\s+").unwrap(); re.replace_all(&p.title, "\n").to_string() };
    let mut vals: HashMap<&str, String> = HashMap::new();
    vals.insert("speaker", if !p.speaker.is_empty() { p.speaker.clone() } else { s(&t["speaker"]["text"], "").to_string() });
    vals.insert("church", church.clone());
    vals.insert("title", title_text.replace('\n', " ").replace('*', ""));
    vals.insert("verse", p.verse.clone());
    let vx = num(&v["x"]).unwrap_or(0.0) as f32; let vy = num(&v["y"]).unwrap_or(0.0) as f32;
    let vw = num(&v["width"]).unwrap_or(0.0) as f32; let vh = num(&v["height"]).unwrap_or(0.0) as f32;
    let vr = or(&v["radius"], 0.0) as f32;

    if has("background") { draw_background(pm, t); }
    if has("under") {
        let c = &t["canvas"];
        if c["mode"].as_str() == Some("blur") && truthy(&c["blur"]) && truthy(&c["blur"]["tint"]) { fill_rect(pm, 0.0, 0.0, 1080.0, 1920.0, parse_color(s(&c["blur"]["tint"], "#0000"))); }
        if truthy(&v["show"]) && truthy(&v["shadow"]) {
            let sh = shadow_of(&v["shadow"], 30.0, 12.0, "#00000099");
            with_shadow(pm, Some(sh), &mut |pm| { if let Some(path) = round_rect(vx, vy, vw, vh, vr) { pm.fill_path(&path, &paint(Color::BLACK), FillRule::Winding, Transform::identity(), None); } });
        }
    }
    if has("top") {
        if truthy(&v["show"]) && truthy(&v["border"]) {
            let b = &v["border"];
            if let Some(path) = round_rect(vx, vy, vw, vh, vr) { pm.stroke_path(&path, &paint(parse_color(s(&b["color"], "#FFFFFF"))), &Stroke { width: or(&b["width"], 1.0) as f32, miter_limit: 10.0, ..Default::default() }, Transform::identity(), None); }
        }
        if truthy(&v["show"]) && truthy(&v["fade"]) {
            let f = &v["fade"];
            let len = num(&f["length"]).unwrap_or(0.0) as f32;
            let to_s = s(&f["toColor"], s(&t["canvas"]["background"], "#000000")).to_string();
            let to = parse_color(&to_s);
            let mut from = parse_color(&to_s.chars().take(7).collect::<String>()); from.set_alpha(0.0);
            let (p0, p1, ry) = match f["edge"].as_str() { Some("bottom") => (vy + vh - len, vy + vh, vy + vh - len), Some("top") => (vy + len, vy, vy), _ => (0.0, 0.0, -1.0) };
            if ry >= 0.0 {
                if let Some(sh) = LinearGradient::new(Point::from_xy(0.0, p0), Point::from_xy(0.0, p1), vec![GradientStop::new(0.0, from), GradientStop::new(1.0, to)], SpreadMode::Pad, Transform::identity()) {
                    let mut pt = Paint::default(); pt.shader = sh;
                    if let Some(r) = Rect::from_xywh(vx, ry, vw, len) { pm.fill_rect(r, &pt, Transform::identity(), None); }
                }
            }
        }
        let bg = TextOpts { groups: None, karaoke: None, part: Part::Bg };
        let fg = TextOpts { groups: None, karaoke: None, part: Part::Fg };
        if !title_text.is_empty() { draw_text(pm, book, &t["title"], &title_text, t, &bg); }
        if !p.verse.is_empty() { draw_text(pm, book, &t["verse"], &p.verse, t, &bg); }
        if !title_text.is_empty() { if let Some(r) = draw_text(pm, book, &t["title"], &title_text, t, &fg) { add_hit("title", tb(r), None); } }
        if !p.verse.is_empty() { if let Some(r) = draw_text(pm, book, &t["verse"], &p.verse, t, &fg) { add_hit("verse", tb(r), None); } }
        draw_badge(pm, book, &t["badge"], &vals, t);
    }
    if has("subtitle") && !p.subtitle_text.is_empty() && truthy(&t["subtitle"]) && truthy(&t["subtitle"]["show"]) {
        if let Some(r) = draw_text(pm, book, &t["subtitle"], &p.subtitle_text, t, &TextOpts { groups: p.subtitle_groups.as_deref(), karaoke: p.karaoke_index, part: Part::All }) { add_hit("subtitle", tb(r), None); }
    }
    if has("footer") {
        let (cn, sp, lg) = (&t["churchName"], &t["speaker"], &t["logo"]);
        let spk_text = if truthy(&sp["format"]) { textfx::fill_format(s(&sp["format"], ""), &vals) } else { vals["speaker"].clone() };
        let logo = p.logo.as_ref().filter(|_| truthy(&lg["show"])).filter(|l| l.height() > 0);
        let has_church = truthy(&cn["show"]) && !church.is_empty();
        let has_speaker = truthy(&sp["show"]) && !spk_text.is_empty();
        let with = |el: &Value, kv: Value| { let mut e = el.clone(); if let (Some(o), Some(k)) = (e.as_object_mut(), kv.as_object()) { for (a, b) in k { o.insert(a.clone(), b.clone()); } } e };
        let all = TextOpts { groups: None, karaoke: None, part: Part::All };
        let (lx, ly, lh) = (num(&lg["x"]).unwrap_or(0.0), num(&lg["y"]).unwrap_or(0.0), num(&lg["height"]).unwrap_or(0.0));
        if !truthy(&lg["free"]) && s(&cn["align"], "") == "center" && s(&sp["align"], "") == "center" && logo.is_some() {
            let img = logo.unwrap();
            let crest_w = lh * img.width() as f64 / img.height() as f64;
            let church_w = if has_church { Font::new(book, cn, t).measure(&church) } else { 0.0 };
            let speaker_w = if has_speaker { Font::new(book, sp, t).measure(&spk_text) } else { 0.0 };
            let cw = or(&cn["width"], church_w); let sw = or(&sp["width"], speaker_w);
            let block_w = church_w.min(cw).max(speaker_w.min(sw));
            let gap = if block_w > 0.0 { 30.0 } else { 0.0 };
            let total = crest_w + gap + block_w;
            let start_x = (lx - total / 2.0).min(1050.0 - total).max(30.0);
            draw_image(pm, img, start_x as f32, ly as f32, crest_w as f32, lh as f32);
            add_hit("logo", (start_x, ly, start_x + crest_w, ly + lh), Some("group"));
            let cx = start_x + crest_w + gap + block_w / 2.0;
            if has_church { if let Some(r) = draw_text(pm, book, &with(cn, json!({ "x": cx, "y": ly + or(&cn["size"], 16.0) / 2.0 + 5.0, "maxLines": 1, "wrap": false })), &church, t, &all) { add_hit("churchName", tb(r), Some("group")); } }
            if has_speaker { if let Some(r) = draw_text(pm, book, &with(sp, json!({ "x": cx, "y": ly + lh - or(&sp["size"], 16.0) / 2.0, "maxLines": 1, "wrap": false })), &spk_text, t, &all) { add_hit("speaker", tb(r), Some("group")); } }
        } else if !truthy(&lg["free"]) && logo.is_some() && truthy(&lg["inline"]) {
            let img = logo.unwrap();
            let w = lh * img.width() as f64 / img.height() as f64;
            draw_image(pm, img, lx as f32, ly as f32, w as f32, lh as f32);
            add_hit("logo", (lx, ly, lx + w, ly + lh), Some("inline"));
            let tx = lx + w + 18.0;
            if has_church { if let Some(r) = draw_text(pm, book, &with(cn, json!({ "align": "left", "x": tx, "y": if has_speaker { ly + lh * 0.3 } else { ly + lh / 2.0 }, "maxLines": 1, "wrap": false })), &church, t, &all) { add_hit("churchName", tb(r), Some("inline")); } }
            if has_speaker { if let Some(r) = draw_text(pm, book, &with(sp, json!({ "align": "left", "x": tx, "y": if has_church { ly + lh * 0.76 } else { ly + lh / 2.0 }, "maxLines": 1, "wrap": false })), &spk_text, t, &all) { add_hit("speaker", tb(r), Some("inline")); } }
        } else {
            if let Some(img) = logo { let w = lh * img.width() as f64 / img.height() as f64; draw_image(pm, img, (lx - w / 2.0) as f32, ly as f32, w as f32, lh as f32); add_hit("logo", (lx - w / 2.0, ly, lx + w / 2.0, ly + lh), None); }
            if has_church { if let Some(r) = draw_text(pm, book, &with(cn, json!({ "maxLines": 1, "wrap": false })), &church, t, &all) { add_hit("churchName", tb(r), None); } }
            if has_speaker { if let Some(r) = draw_text(pm, book, &with(sp, json!({ "maxLines": 1, "wrap": false })), &spk_text, t, &all) { add_hit("speaker", tb(r), None); } }
        }
    }
}

/// 영상 상자의 둥근 모서리 마스크 (흰색 = 보임)
pub fn video_mask(v: &Value) -> Option<Pixmap> {
    let (w, h) = (num(&v["width"])? as u32, num(&v["height"])? as u32);
    let mut pm = Pixmap::new(w, h)?;
    pm.fill(Color::BLACK);
    if let Some(p) = round_rect(0.0, 0.0, w as f32, h as f32, or(&v["radius"], 0.0) as f32) { pm.fill_path(&p, &paint(Color::WHITE), FillRule::Winding, Transform::identity(), None); }
    Some(pm)
}

pub fn uses_karaoke(theme: &Value) -> bool {
    let st = &theme["subtitle"];
    let k = &st["karaoke"];
    truthy(st) && truthy(&st["show"]) && truthy(k) && k["mode"].as_str().map(|m| !m.is_empty() && m != "none").unwrap_or(false)
}

/// 테마 로고 경로 → 그림. 비었거나 예전 기본 로고면 앱 기본 로고
pub fn theme_logo(theme: &Value) -> Option<Arc<Pixmap>> {
    let p = s(&theme["logo"]["path"], "");
    let re = regex::Regex::new(r"(?i)^assets[\\/]images[\\/](sa-)?crest\.png$").unwrap();
    let path = if p.is_empty() || re.is_match(p) { crate::assets_dir().join("images").join("logo-default.png") }
        else if p.starts_with("assets/") || p.starts_with("assets\\") { crate::assets_dir().join(&p[7..]) } else { PathBuf::from(p) };
    load_image(&path).or_else(|| load_image(&crate::assets_dir().join("images").join("logo-default.png")))
}

/// 다른 스레드로 넘길 수 있는 그리기 값 (미리보기 일꾼용)
#[derive(Clone, Default)]
pub struct OwnedParams {
    pub title: String,
    pub verse: String,
    pub speaker: String,
    pub church_name: String,
    pub subtitle_text: String,
    pub subtitle_groups: Option<Vec<String>>,
    pub karaoke_index: Option<i64>,
    pub theme: Value,
    pub logo: Option<Arc<Pixmap>>,
}

impl OwnedParams {
    pub fn as_params(&self) -> Params<'_> {
        Params { title: self.title.clone(), verse: self.verse.clone(), speaker: self.speaker.clone(), church_name: self.church_name.clone(), subtitle_text: self.subtitle_text.clone(), subtitle_groups: self.subtitle_groups.clone(), karaoke_index: self.karaoke_index, theme: &self.theme, logo: self.logo.clone() }
    }
}

/// 층을 1080×1920 투명 그림으로
pub fn render(layers: &[&str], p: &OwnedParams) -> Pixmap {
    let mut pm = Pixmap::new(W, H).unwrap();
    draw_template(&mut pm, layers, &p.as_params());
    pm
}

/// 그림에서 불투명한 부분의 상자 (x0, y0, x1, y1 포함). 다 투명하면 None
pub fn alpha_bbox(pm: &Pixmap) -> Option<(u32, u32, u32, u32)> {
    let (w, h) = (pm.width(), pm.height());
    let d = pm.data();
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0u32, 0u32);
    let mut any = false;
    for y in 0..h {
        let row = &d[(y * w * 4) as usize..((y + 1) * w * 4) as usize];
        let mut rx0 = None; let mut rx1 = 0;
        for x in 0..w { if row[(x * 4 + 3) as usize] != 0 { if rx0.is_none() { rx0 = Some(x); } rx1 = x; } }
        if let Some(r0) = rx0 { any = true; x0 = x0.min(r0); x1 = x1.max(rx1); y0 = y0.min(y); y1 = y1.max(y); }
    }
    if any { Some((x0, y0, x1, y1)) } else { None }
}

/// 크롬 crop.js placement: 원본 화면을 영상 상자에 덮기(cover)·맞추기(contain) + 확대·위치
pub fn placement(src_w: f64, src_h: f64, box_w: f64, box_h: f64, contain: bool, scale: f64, cx: f64, cy: f64) -> Option<(f64, f64, f64, f64)> {
    if !(src_w > 0.0 && src_h > 0.0 && box_w > 0.0 && box_h > 0.0) { return None; }
    let zoom = if scale.is_finite() { scale.max(1.0) } else { 1.0 };
    let s = if contain { (box_w / src_w).min(box_h / src_h) } else { (box_w / src_w).max(box_h / src_h) } * zoom;
    let (w, h) = (src_w * s, src_h * s);
    let x = if cx.is_finite() { cx.clamp(0.0, 1.0) } else { 0.5 };
    let y = if cy.is_finite() { cy.clamp(0.0, 1.0) } else { 0.5 };
    let axis = |size: f64, full: f64, center: f64| if full <= size { (size - full) / 2.0 } else { (size - full).max((size / 2.0 - full * center).min(0.0)) };
    Some((w, h, axis(box_w, w, x), axis(box_h, h, y)))
}