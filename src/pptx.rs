//! 설교 PPT (기존 main/materials-pptx.js · pptxgenjs): 교인 자료의 '설교 PPT' 데이터 → 16:9 파워포인트(.pptx).
//! 글자는 모두 고칠 수 있는 글상자로 넣는다. 글꼴은 교회 컴퓨터에 대부분 있는 '맑은 고딕'(맥은 Apple SD 고딕 Neo 로 대체됨).
//! 라이브러리 없이 OOXML 을 직접 쓴다 (zip 은 zip 크레이트).
use serde_json::Value;
use std::io::Write;

pub struct Theme { pub bg: &'static str, pub text: &'static str, pub sub: &'static str, pub accent: &'static str }
pub fn theme(design: &str) -> Theme {
    match design {
        "paper" => Theme { bg: "F7F2E8", text: "2B2620", sub: "8A6D3B", accent: "B7791F" },
        "sky" => Theme { bg: "F4F8FF", text: "0F172A", sub: "2563EB", accent: "2563EB" },
        "scene" => Theme { bg: "111111", text: "FFFFFF", sub: "E5E7EB", accent: "FBBF24" },
        _ => Theme { bg: "13294B", text: "FFFFFF", sub: "BCD0EE", accent: "60A5FA" },
    }
}
const FONT: &str = "Malgun Gothic";
const W: f64 = 13.333;
const H: f64 = 7.5;
fn emu(inch: f64) -> i64 { (inch * 914400.0).round() as i64 }

/// 파워포인트는 한글을 글자 단위로 줄 바꿈해서 단어 가운데가 잘린다 → 긴 글은 가운데 가까운 띄어쓰기에서 미리 나눈다
pub fn balance(text: &str, max: usize) -> String {
    let t = text.trim();
    let c: Vec<char> = t.chars().collect();
    // JS 의 length 는 UTF-16 단위지만 한글·영문은 모두 1 이라 같다
    if c.len() <= max || t.contains('\n') { return t.to_string(); }
    let mid = c.len() as f64 / 2.0;
    let mut best: i64 = -1;
    for (i, ch) in c.iter().enumerate() { if *ch == ' ' && (best < 0 || (i as f64 - mid).abs() < (best as f64 - mid).abs()) { best = i as i64; } }
    if best > 0 { let b = best as usize; format!("{}\n{}", c[..b].iter().collect::<String>(), c[b + 1..].iter().collect::<String>()) } else { t.to_string() }
}
fn esc(s: &str) -> String {
    s.chars().filter(|c| !matches!(*c as u32, 0..=8 | 11 | 12 | 14..=31)).collect::<String>().replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[derive(Default, Clone)]
struct TextOpt { size: f64, bold: bool, color: String, align: &'static str, valign: &'static str, shrink: bool, bullet: bool, space_after: f64, line: f64 }

struct Slide { bg: Option<String>, scene: bool, xml: String, id: u32 }
impl Slide {
    fn new(bg: Option<String>, scene: bool) -> Slide { Slide { bg, scene, xml: String::new(), id: 2 } }
    fn next(&mut self) -> u32 { self.id += 1; self.id }
    fn xfrm(x: f64, y: f64, w: f64, h: f64) -> String { format!("<a:xfrm><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></a:xfrm>", emu(x), emu(y), emu(w), emu(h)) }
    /// 글상자: paras 는 문단들 (글 안의 줄바꿈도 문단으로 나눈다)
    fn text(&mut self, paras: &[String], x: f64, y: f64, w: f64, h: f64, o: &TextOpt) {
        let id = self.next();
        let anchor = match o.valign { "middle" => "ctr", "bottom" => "b", _ => "t" };
        let algn = match o.align { "center" => "ctr", "right" => "r", _ => "l" };
        let mut ps = String::new();
        let lines: Vec<String> = paras.iter().flat_map(|p| p.split('\n').map(String::from).collect::<Vec<_>>()).collect();
        for t in &lines {
            let mut ppr = format!("<a:pPr algn=\"{algn}\"");
            if o.bullet { ppr += &format!(" marL=\"{}\" indent=\"-{}\"", 24 * 12700, 24 * 12700); }
            ppr += ">";
            if o.line > 0.0 { ppr += &format!("<a:lnSpc><a:spcPct val=\"{}\"/></a:lnSpc>", (o.line * 100000.0).round() as i64); }
            if o.space_after > 0.0 { ppr += &format!("<a:spcAft><a:spcPts val=\"{}\"/></a:spcAft>", (o.space_after * 100.0).round() as i64); }
            ppr += if o.bullet { "<a:buSzPct val=\"100000\"/><a:buChar char=\"&#8226;\"/>" } else { "<a:buNone/>" };
            ppr += "</a:pPr>";
            let rpr = format!("<a:rPr lang=\"ko-KR\" altLang=\"en-US\" sz=\"{}\"{} dirty=\"0\"><a:solidFill><a:srgbClr val=\"{}\"/></a:solidFill><a:latin typeface=\"{FONT}\"/><a:ea typeface=\"{FONT}\"/><a:cs typeface=\"{FONT}\"/></a:rPr>", (o.size * 100.0).round() as i64, if o.bold { " b=\"1\"" } else { "" }, o.color);
            ps += &format!("<a:p>{ppr}<a:r>{rpr}<a:t>{}</a:t></a:r></a:p>", esc(t));
        }
        if lines.is_empty() { ps = "<a:p><a:endParaRPr lang=\"ko-KR\"/></a:p>".into(); }
        self.xml += &format!("<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"Text {id}\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr><p:spPr>{}<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap=\"square\" lIns=\"91440\" tIns=\"45720\" rIns=\"91440\" bIns=\"45720\" rtlCol=\"0\" anchor=\"{anchor}\">{}</a:bodyPr><a:lstStyle/>{ps}</p:txBody></p:sp>",
            Self::xfrm(x, y, w, h), if o.shrink { "<a:normAutofit/>" } else { "<a:noAutofit/>" });
    }
    fn rect(&mut self, x: f64, y: f64, w: f64, h: f64, color: &str, alpha: Option<u32>) {
        let id = self.next();
        let fill = match alpha { Some(a) => format!("<a:solidFill><a:srgbClr val=\"{color}\"><a:alpha val=\"{a}\"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln>"), None => format!("<a:solidFill><a:srgbClr val=\"{color}\"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val=\"{color}\"/></a:solidFill></a:ln>") };
        self.xml += &format!("<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"Shape {id}\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>{}<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>{fill}</p:spPr></p:sp>", Self::xfrm(x, y, w, h));
    }
    fn line(&mut self, x: f64, y: f64, w: f64, color: &str, pt: f64) {
        let id = self.next();
        self.xml += &format!("<p:cxnSp><p:nvCxnSpPr><p:cNvPr id=\"{id}\" name=\"Line {id}\"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>{}<a:prstGeom prst=\"line\"><a:avLst/></a:prstGeom><a:ln w=\"{}\"><a:solidFill><a:srgbClr val=\"{color}\"/></a:solidFill></a:ln></p:spPr></p:cxnSp>", Self::xfrm(x, y, w, 0.0), (pt * 12700.0).round() as i64);
    }
    /// 꽉 채우는 그림 (cover: 넘치는 쪽을 잘라 낸다)
    fn picture(&mut self, iw: u32, ih: u32) {
        let id = self.next();
        let (r_img, r_box) = (iw as f64 / ih as f64, W / H);
        let (mut l, mut t) = (0.0, 0.0);
        if r_img > r_box { l = (1.0 - r_box / r_img) / 2.0; } else { t = (1.0 - r_img / r_box) / 2.0; }
        let pct = |v: f64| (v * 100000.0).round() as i64;
        self.xml += &format!("<p:pic><p:nvPicPr><p:cNvPr id=\"{id}\" name=\"Picture {id}\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed=\"rId2\"/><a:srcRect l=\"{}\" t=\"{}\" r=\"{}\" b=\"{}\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>{}<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic>",
            pct(l), pct(t), pct(l), pct(t), Self::xfrm(0.0, 0.0, W, H));
    }
    fn xml(&self) -> String {
        let bg = self.bg.as_ref().map(|c| format!("<p:bg><p:bgPr><a:solidFill><a:srgbClr val=\"{c}\"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>")).unwrap_or_default();
        format!("{XML_HEAD}<p:sld {NS}><p:cSld>{bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>{}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>", self.xml)
    }
}

const XML_HEAD: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";
const NS: &str = "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"";

fn s(v: &Value) -> String { match v { Value::String(x) => x.clone(), Value::Null => String::new(), Value::Number(n) => n.to_string(), _ => String::new() } }

/// d: { title, verse, slides:[{heading, lines[], ref}], closing }, meta: { church, speaker, date, title, verse }
/// scene: 영상 장면 JPEG/PNG (design == "scene" 일 때)
pub fn build(d: &Value, meta: &Value, design: &str, scene: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let th = theme(design);
    let re = regex::Regex::new(r"\s+/\s+").unwrap();
    let raw_title = { let m = s(&meta["title"]); if m.is_empty() { let t = s(&d["title"]); if t.is_empty() { "설교".to_string() } else { t } } else { m } };
    let title = re.replace_all(&raw_title.replace('*', ""), " ").to_string();
    let verse = { let v = s(&d["verse"]); if v.is_empty() { s(&meta["verse"]) } else { v } };
    let church = s(&meta["church"]);
    let scene_img = if design == "scene" { scene.and_then(|b| image::load_from_memory(b).ok().map(|i| (i.width(), i.height(), b.to_vec()))) } else { None };
    let sub = |c: &str| TextOpt { size: 14.0, color: c.into(), ..Default::default() };
    let base = |sl: &mut Slide| {
        if let Some((w, h, _)) = &scene_img { sl.picture(*w, *h); sl.rect(0.0, 0.0, W, H, "000000", Some(62000)); }
        if !church.is_empty() { sl.text(&[church.clone()], 0.6, H - 0.65, 6.0, 0.4, &TextOpt { bold: true, ..sub(th.sub) }); }
        if !title.is_empty() { sl.text(&[title.clone()], W - 6.6, H - 0.65, 6.0, 0.4, &TextOpt { align: "right", ..sub(th.sub) }); }
    };
    let new_slide = || Slide::new(if scene_img.is_some() { None } else { Some(th.bg.to_string()) }, scene_img.is_some());
    let mut slides = vec![];
    // 1) 제목
    let mut sl = new_slide(); base(&mut sl);
    sl.rect(0.6, 2.05, 0.12, 2.2, th.accent, None);
    sl.text(&[balance(&title, 18)], 0.95, 1.9, W - 1.8, 1.6, &TextOpt { size: 48.0, bold: true, color: th.text.into(), valign: "middle", shrink: true, ..Default::default() });
    let subline: Vec<String> = [verse.clone(), s(&meta["speaker"]), s(&meta["date"])].into_iter().filter(|x| !x.is_empty()).collect();
    if !subline.is_empty() { sl.text(&[subline.join("   ·   ")], 0.95, 3.5, W - 1.8, 0.8, &TextOpt { size: 24.0, color: th.sub.into(), ..Default::default() }); }
    slides.push(sl);
    // 2) 본론
    for (i, x) in d["slides"].as_array().cloned().unwrap_or_default().iter().enumerate() {
        let mut sl = new_slide(); base(&mut sl);
        sl.text(&[format!("{:02}", i + 1)], 0.6, 0.55, 1.2, 0.7, &TextOpt { size: 26.0, bold: true, color: th.accent.into(), ..Default::default() });
        sl.text(&[balance(&s(&x["heading"]), 24)], 0.6, 1.15, W - 1.2, 1.1, &TextOpt { size: 40.0, bold: true, color: th.text.into(), shrink: true, ..Default::default() });
        sl.line(0.6, 2.35, 2.2, th.accent, 3.0);
        let lines: Vec<String> = x["lines"].as_array().map(|a| a.iter().map(s).filter(|t| !t.is_empty()).collect()).unwrap_or_default();
        if !lines.is_empty() { sl.text(&lines, 0.6, 2.65, W - 1.2, 3.4, &TextOpt { size: 30.0, color: th.text.into(), valign: "top", line: 1.15, shrink: true, bullet: true, space_after: 14.0, ..Default::default() }); }
        let r = s(&x["ref"]);
        if !r.is_empty() { sl.text(&[r], W - 5.6, H - 1.35, 5.0, 0.5, &TextOpt { size: 20.0, color: th.sub.into(), align: "right", bold: true, ..Default::default() }); }
        slides.push(sl);
    }
    // 3) 마무리
    let closing = s(&d["closing"]);
    if !closing.is_empty() {
        let mut sl = new_slide(); base(&mut sl);
        sl.text(&[balance(&closing, 20)], 1.0, 2.2, W - 2.0, 2.4, &TextOpt { size: 40.0, bold: true, color: th.text.into(), align: "center", valign: "middle", shrink: true, ..Default::default() });
        if !verse.is_empty() { sl.text(&[verse.clone()], 1.0, 4.7, W - 2.0, 0.6, &TextOpt { size: 22.0, color: th.sub.into(), align: "center", ..Default::default() }); }
        slides.push(sl);
    }
    package(&slides, &title, &church, scene_img.as_ref().map(|x| x.2.as_slice()))
}

fn package(slides: &[Slide], title: &str, author: &str, scene: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let n = slides.len();
    let ext = scene.map(|b| if b.starts_with(&[0x89, b'P', b'N', b'G']) { "png" } else { "jpeg" });
    let mut files: Vec<(String, Vec<u8>)> = vec![];
    let mut ct = format!("{XML_HEAD}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/>");
    if let Some(e) = ext { ct += &format!("<Default Extension=\"{e}\" ContentType=\"image/{e}\"/>"); }
    ct += "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/><Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/><Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/><Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/><Override PartName=\"/ppt/presProps.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presProps+xml\"/><Override PartName=\"/ppt/viewProps.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml\"/><Override PartName=\"/ppt/tableStyles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml\"/><Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/><Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>";
    for i in 1..=n { ct += &format!("<Override PartName=\"/ppt/slides/slide{i}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>"); }
    ct += "</Types>";
    files.push(("[Content_Types].xml".into(), ct.into_bytes()));
    files.push(("_rels/.rels".into(), format!("{XML_HEAD}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/><Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/></Relationships>").into_bytes()));
    let now = crate::youtube::now_iso();
    let now = now.get(..19).map(|x| format!("{x}Z")).unwrap_or_default();
    files.push(("docProps/core.xml".into(), format!("{XML_HEAD}<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"><dc:title>{}</dc:title><dc:creator>{}</dc:creator><cp:lastModifiedBy>{}</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:created xsi:type=\"dcterms:W3CDTF\">{now}</dcterms:created><dcterms:modified xsi:type=\"dcterms:W3CDTF\">{now}</dcterms:modified></cp:coreProperties>", esc(title), esc(if author.is_empty() { "SermonShorts" } else { author }), esc(if author.is_empty() { "SermonShorts" } else { author })).into_bytes()));
    files.push(("docProps/app.xml".into(), format!("{XML_HEAD}<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\"><Application>SermonShorts</Application><Slides>{n}</Slides><PresentationFormat>와이드스크린</PresentationFormat></Properties>").into_bytes()));
    // 발표 문서
    let mut ids = String::new();
    let mut rels = format!("{XML_HEAD}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"theme/theme1.xml\"/><Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps\" Target=\"presProps.xml\"/><Relationship Id=\"rId4\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps\" Target=\"viewProps.xml\"/><Relationship Id=\"rId5\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles\" Target=\"tableStyles.xml\"/>");
    for i in 1..=n { ids += &format!("<p:sldId id=\"{}\" r:id=\"rId{}\"/>", 255 + i, 5 + i); rels += &format!("<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide{i}.xml\"/>", 5 + i); }
    rels += "</Relationships>";
    files.push(("ppt/presentation.xml".into(), format!("{XML_HEAD}<p:presentation {NS} saveSubsetFonts=\"1\"><p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst><p:sldIdLst>{ids}</p:sldIdLst><p:sldSz cx=\"{}\" cy=\"{}\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/><p:defaultTextStyle><a:defPPr><a:defRPr lang=\"ko-KR\"/></a:defPPr></p:defaultTextStyle></p:presentation>", emu(W), emu(H)).into_bytes()));
    files.push(("ppt/_rels/presentation.xml.rels".into(), rels.into_bytes()));
    files.push(("ppt/presProps.xml".into(), format!("{XML_HEAD}<p:presentationPr {NS}/>").into_bytes()));
    files.push(("ppt/viewProps.xml".into(), format!("{XML_HEAD}<p:viewPr {NS}><p:normalViewPr horzBarState=\"maximized\"><p:restoredLeft sz=\"15611\"/><p:restoredTop sz=\"94610\"/></p:normalViewPr><p:gridSpacing cx=\"76200\" cy=\"76200\"/></p:viewPr>").into_bytes()));
    files.push(("ppt/tableStyles.xml".into(), format!("{XML_HEAD}<a:tblStyleLst xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" def=\"{{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}}\"/>").into_bytes()));
    let empty_tree = "<p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr></p:spTree>";
    files.push(("ppt/slideMasters/slideMaster1.xml".into(), format!("{XML_HEAD}<p:sldMaster {NS}><p:cSld><p:bg><p:bgRef idx=\"1001\"><a:schemeClr val=\"bg1\"/></p:bgRef></p:bg>{empty_tree}</p:cSld><p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/><p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz=\"4400\"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz=\"2800\"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz=\"1800\"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>").into_bytes()));
    files.push(("ppt/slideMasters/_rels/slideMaster1.xml.rels".into(), format!("{XML_HEAD}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"../theme/theme1.xml\"/></Relationships>").into_bytes()));
    files.push(("ppt/slideLayouts/slideLayout1.xml".into(), format!("{XML_HEAD}<p:sldLayout {NS} type=\"blank\" preserve=\"1\"><p:cSld name=\"빈 화면\">{empty_tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>").into_bytes()));
    files.push(("ppt/slideLayouts/_rels/slideLayout1.xml.rels".into(), format!("{XML_HEAD}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/></Relationships>").into_bytes()));
    files.push(("ppt/theme/theme1.xml".into(), theme_xml().into_bytes()));
    if let (Some(b), Some(e)) = (scene, ext) { files.push((format!("ppt/media/scene.{e}"), b.to_vec())); }
    for (i, sl) in slides.iter().enumerate() {
        files.push((format!("ppt/slides/slide{}.xml", i + 1), sl.xml().into_bytes()));
        let img = match (sl.scene, ext) { (true, Some(e)) => format!("<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/scene.{e}\"/>"), _ => String::new() };
        files.push((format!("ppt/slides/_rels/slide{}.xml.rels", i + 1), format!("{XML_HEAD}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>{img}</Relationships>").into_bytes()));
    }
    let mut out = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut out);
        let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in &files { z.start_file(name.as_str(), opt).map_err(|e| e.to_string())?; z.write_all(data).map_err(|e| e.to_string())?; }
        z.finish().map_err(|e| e.to_string())?;
    }
    Ok(out.into_inner())
}

fn theme_xml() -> String {
    let font = |tag: &str| format!("<a:{tag}><a:latin typeface=\"{FONT}\"/><a:ea typeface=\"{FONT}\"/><a:cs typeface=\"\"/></a:{tag}>");
    let solid = "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>";
    let ln = |w: u32| format!("<a:ln w=\"{w}\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\">{solid}<a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln>");
    format!("{XML_HEAD}<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"SermonShorts\"><a:themeElements><a:clrScheme name=\"Office\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1><a:dk2><a:srgbClr val=\"44546A\"/></a:dk2><a:lt2><a:srgbClr val=\"E7E6E6\"/></a:lt2><a:accent1><a:srgbClr val=\"4472C4\"/></a:accent1><a:accent2><a:srgbClr val=\"ED7D31\"/></a:accent2><a:accent3><a:srgbClr val=\"A5A5A5\"/></a:accent3><a:accent4><a:srgbClr val=\"FFC000\"/></a:accent4><a:accent5><a:srgbClr val=\"5B9BD5\"/></a:accent5><a:accent6><a:srgbClr val=\"70AD47\"/></a:accent6><a:hlink><a:srgbClr val=\"0563C1\"/></a:hlink><a:folHlink><a:srgbClr val=\"954F72\"/></a:folHlink></a:clrScheme><a:fontScheme name=\"Office\">{}{}</a:fontScheme><a:fmtScheme name=\"Office\"><a:fillStyleLst>{solid}{solid}{solid}</a:fillStyleLst><a:lnStyleLst>{}{}{}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>{solid}{solid}{solid}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>",
        font("majorFont"), font("minorFont"), ln(6350), ln(12700), ln(19050))
}
