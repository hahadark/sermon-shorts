fn main() {
    let a: Vec<String> = std::env::args().collect();
    let data = std::fs::read(&a[1]).unwrap();
    let chars: Vec<char> = a[2].chars().collect();
    let base = ttf_parser::Face::parse(&data, 0).unwrap();
    let hmtx = base.tables().hmtx.unwrap();
    for c in &chars {
        let g = base.glyph_index(*c).unwrap();
        let raw = hmtx.advance(g).unwrap_or(0);
        let mut s = format!("[{c}] gid {} hmtx {} |", g.0, raw);
        for w in [100.0f32, 400.0, 700.0, 900.0] {
            let mut f = ttf_parser::Face::parse(&data, 0).unwrap();
            let _ = f.set_variation(ttf_parser::Tag::from_bytes(b"wght"), w);
            s += &format!(" {w}:{}", f.glyph_hor_advance(g).unwrap_or(0));
        }
        println!("{s}");
    }
    // cmap 의 서브테이블마다 공백이 어떤 글리프인지
    if let Some(cmap) = base.tables().cmap { for st in cmap.subtables { println!("cmap fmt {:?} plat {:?} enc {} space->{:?}", st.format, st.platform_id, st.encoding_id, st.glyph_index(0x20)); } }
}
