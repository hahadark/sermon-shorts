//! 한글 글꼴: 프로그램에 넣은 Pretendard (SIL OFL 1.1). 굵은 글씨는 별도 글꼴 이름으로 쓴다.
use eframe::egui;
use std::sync::Arc;

pub const BOLD: &str = "PretendardBold";
pub const SEMIBOLD: &str = "PretendardSemiBold";

pub fn install(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    let add = |fonts: &mut egui::FontDefinitions, name: &str, bytes: &'static [u8]| {
        fonts.font_data.insert(name.to_owned(), Arc::new(egui::FontData::from_static(bytes)));
    };
    add(&mut fonts, "Pretendard", include_bytes!("../assets/fonts/Pretendard-Regular.otf"));
    add(&mut fonts, SEMIBOLD, include_bytes!("../assets/fonts/Pretendard-SemiBold.otf"));
    add(&mut fonts, BOLD, include_bytes!("../assets/fonts/Pretendard-Bold.otf"));
    // 기본 글꼴 맨 앞에 Pretendard (영문·한글 모두)
    fonts.families.entry(egui::FontFamily::Proportional).or_default().insert(0, "Pretendard".to_owned());
    fonts.families.entry(egui::FontFamily::Monospace).or_default().push("Pretendard".to_owned());
    fonts.families.insert(egui::FontFamily::Name(BOLD.into()), vec![BOLD.to_owned(), "Pretendard".to_owned()]);
    fonts.families.insert(egui::FontFamily::Name(SEMIBOLD.into()), vec![SEMIBOLD.to_owned(), "Pretendard".to_owned()]);
    ctx.set_fonts(fonts);
}
