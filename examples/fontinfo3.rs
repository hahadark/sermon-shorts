fn main() {
    let a: Vec<String> = std::env::args().collect();
    let data = std::fs::read(&a[1]).unwrap();
    let f = ttf_parser::Face::parse(&data, 0).unwrap();
    let os2 = f.tables().os2.unwrap();
    let _ = os2; println!("numGlyphs {}", f.number_of_glyphs());
    for c in ['\u{a0}', '\u{3000}', '\u{2002}', '\u{2003}', '\u{2009}', '\u{200a}', '\u{2008}', '\u{2005}', '\u{2006}'] {
        if let Some(g) = f.glyph_index(c) { println!("U+{:04X} gid {} adv {}", c as u32, g.0, f.glyph_hor_advance(g).unwrap_or(0)); }
    }
    let hm = f.tables().hmtx.unwrap();
    let mut n = 0;
    for g in 0..f.number_of_glyphs() { if hm.advance(ttf_parser::GlyphId(g)) == Some(280) { if n < 12 { print!("gid{} ", g); } n += 1; } }
    println!("\n280 짜리 글리프 {}개", n);
}

