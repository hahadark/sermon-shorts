fn main() {
    let a: Vec<String> = std::env::args().collect();
    let data = std::fs::read(&a[1]).unwrap();
    let wght: f32 = a[2].parse().unwrap();
    let size: f32 = a[3].parse().unwrap();
    let mut face = rustybuzz::Face::from_slice(&data, 0).unwrap();
    face.set_variations(&[rustybuzz::Variation { tag: rustybuzz::ttf_parser::Tag::from_bytes(b"wght"), value: wght }]);
    let upem = face.units_per_em() as f32;
    for s in a[4].split('|') {
        let mut buf = rustybuzz::UnicodeBuffer::new();
        buf.push_str(s);
        if let Ok(l) = std::env::var("LANG_TAG") { buf.set_language(l.parse().unwrap()); }
        buf.guess_segment_properties();
        let out = rustybuzz::shape(&face, &[], buf);
        let adv: i32 = out.glyph_positions().iter().map(|p| p.x_advance).sum();
        let each: Vec<i32> = out.glyph_positions().iter().map(|p| p.x_advance).collect();
        println!("[{s}] {:.3}  {:?}", adv as f32 * size / upem, each);
    }
}

