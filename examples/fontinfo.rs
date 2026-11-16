fn main() {
    let a: Vec<String> = std::env::args().collect();
    let data = std::fs::read(&a[1]).unwrap();
    let mut f = ttf_parser::Face::parse(&data, 0).unwrap();
    let os2 = f.tables().os2.unwrap();
    let hhea = f.tables().hhea;
    println!("upem {} typo {}/{} gap {} win {}/{} hhea {}/{} useTypo {}", f.units_per_em(), os2.typographic_ascender(), os2.typographic_descender(), os2.typographic_line_gap(), os2.windows_ascender(), os2.windows_descender(), hhea.ascender, hhea.descender, os2.use_typographic_metrics());
    for ax in f.variation_axes() { println!("axis {:?} {}..{} def {}", ax.tag, ax.min_value, ax.max_value, ax.def_value); }
    println!("hvar {}", f.tables().hvar.is_some());
    for w in [400.0f32, 700.0, 800.0, 900.0] {
        let _ = f.set_variation(ttf_parser::Tag::from_bytes(b"wght"), w);
        let mut s = format!("wght {w}:");
        for c in ['영', ' ', '.', '?', 'A'] {
            let g = f.glyph_index(c).unwrap();
            let bb = f.glyph_bounding_box(g);
            s += &format!(" [{c}] adv {} bbox {:?}", f.glyph_hor_advance(g).unwrap_or(0), bb.map(|b| (b.x_min, b.x_max)));
        }
        println!("{s}");
    }
}
