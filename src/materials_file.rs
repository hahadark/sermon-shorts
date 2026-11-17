//! 설교 원고 파일에서 글만 꺼내기 (기존 materials.js readFile · hwp.js · materials-pdf.js).
//! 한글(.hwp·.hwpx) · Word(.docx) · PDF · 글(.txt·.md) · 자막(.srt). 모두 기기 안에서만 처리한다.
use regex::Regex;
use std::io::Read;
use std::path::Path;

pub const MAX_BYTES: usize = 20 * 1024 * 1024;

/// 파일 → (글). 200,000자까지
pub fn read_text(f: &Path) -> Result<String, String> {
    let buf = std::fs::read(f).map_err(|e| format!("파일을 열 수 없습니다: {e}"))?;
    if buf.len() > MAX_BYTES { return Err("파일이 너무 큽니다 (20MB 이하).".into()); }
    let ext = f.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let text = match ext.as_str() {
        "pdf" => crate::matrender::pdf_text(f)?,
        "docx" => docx_text(&buf)?,
        "hwpx" => hwpx_text(&buf)?,
        "hwp" => hwp_text(&buf)?,
        _ => {
            let mut t = plain_text(&buf);
            if ext == "srt" { t = srt_text(&t); }
            t
        }
    };
    Ok(text.trim().chars().take(200_000).collect())
}

/// UTF-8 글 (옛 메모장 ANSI=CP949 한글이면 한 번 더 시도)
pub fn plain_text(buf: &[u8]) -> String {
    let t = String::from_utf8_lossy(buf).trim_start_matches('\u{feff}').to_string();
    if t.contains('\u{fffd}') {
        if let Some(alt) = cp949(buf) { if alt.matches('\u{fffd}').count() < t.matches('\u{fffd}').count() { return alt; } }
    }
    t
}
#[cfg(windows)]
fn cp949(buf: &[u8]) -> Option<String> {
    use windows_sys::Win32::Globalization::MultiByteToWideChar;
    if buf.is_empty() { return Some(String::new()); }
    unsafe {
        let n = MultiByteToWideChar(949, 0, buf.as_ptr(), buf.len() as i32, std::ptr::null_mut(), 0);
        if n <= 0 { return None; }
        let mut w = vec![0u16; n as usize];
        MultiByteToWideChar(949, 0, buf.as_ptr(), buf.len() as i32, w.as_mut_ptr(), n);
        Some(String::from_utf16_lossy(&w))
    }
}
#[cfg(not(windows))]
fn cp949(buf: &[u8]) -> Option<String> {
    // macOS: iconv 로 변환
    use std::io::Write;
    let mut c = std::process::Command::new("iconv").args(["-f", "CP949", "-t", "UTF-8"]).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().ok()?;
    c.stdin.take()?.write_all(buf).ok()?;
    let o = c.wait_with_output().ok()?;
    if o.status.success() { String::from_utf8(o.stdout).ok() } else { None }
}
pub fn srt_text(t: &str) -> String {
    let t = Regex::new(r"(?m)^\d+[ \t]*\r?$").unwrap().replace_all(t, "");
    let t = Regex::new(r"(?m)^[\d:,]+\s*-->\s*[\d:,]+[ \t]*\r?$").unwrap().replace_all(&t, "");
    Regex::new(r"\n{2,}").unwrap().replace_all(&t, "\n").to_string()
}

fn decode_xml(s: &str) -> String {
    let s = s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'");
    let s = Regex::new(r"&#(\d+);").unwrap().replace_all(&s, |c: &regex::Captures| c[1].parse::<u32>().ok().and_then(char::from_u32).map(String::from).unwrap_or_default());
    let s = Regex::new(r"(?i)&#x([0-9a-f]+);").unwrap().replace_all(&s, |c: &regex::Captures| u32::from_str_radix(&c[1], 16).ok().and_then(char::from_u32).map(String::from).unwrap_or_default());
    s.replace("&amp;", "&")
}
fn tidy(s: &str) -> String {
    let s = s.replace('\r', "");
    let s = Regex::new(r"[ \t]+\n").unwrap().replace_all(&s, "\n");
    Regex::new(r"\n{3,}").unwrap().replace_all(&s, "\n\n").trim().to_string()
}

fn zip_files<'a>(buf: &'a [u8], bad: &str) -> Result<zip::ZipArchive<std::io::Cursor<&'a [u8]>>, String> {
    zip::ZipArchive::new(std::io::Cursor::new(buf)).map_err(|_| bad.to_string())
}
fn zip_read<R: Read + std::io::Seek>(z: &mut zip::ZipArchive<R>, name: &str) -> Option<String> {
    let mut f = z.by_name(name).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    Some(s)
}

/// Word(.docx): word/document.xml
pub fn docx_text(buf: &[u8]) -> Result<String, String> {
    let mut z = zip_files(buf, "Word 파일을 읽지 못했습니다.")?;
    let xml = zip_read(&mut z, "word/document.xml").ok_or("Word 파일에서 글을 찾지 못했습니다.")?;
    let t = xml.replace("<w:tab/>", "\t").replace("</w:p>", "\n");
    let t = Regex::new(r"<[^>]+>").unwrap().replace_all(&t, "");
    let t = t.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&");
    Ok(Regex::new(r"\n{3,}").unwrap().replace_all(&t, "\n\n").trim().to_string())
}

/// 한글 HWPX 한 구역 XML → 글 (문단마다 줄)
pub fn xml_text(xml: &str) -> String {
    let split = Regex::new(r"<hp:p[\s>]").unwrap();
    let re = Regex::new(r"<hp:t(?:\s[^>]*)?>([\s\S]*?)</hp:t>|<hp:t\s*/>|<hp:(tab|lineBreak)\b[^>]*/?>").unwrap();
    let (tab, lb, tag) = (Regex::new(r"<hp:(tab)\b[^>]*/>").unwrap(), Regex::new(r"<hp:lineBreak\b[^>]*/>").unwrap(), Regex::new(r"<[^>]+>").unwrap());
    let mut out = vec![];
    for p in split.split(xml).skip(1) {
        let mut line = String::new();
        for m in re.captures_iter(p) {
            match m.get(2).map(|x| x.as_str()) {
                Some("tab") => line.push('\t'),
                Some("lineBreak") => line.push('\n'),
                _ => if let Some(t) = m.get(1) { let t = tab.replace_all(t.as_str(), "\t"); let t = lb.replace_all(&t, "\n"); line.push_str(&tag.replace_all(&t, "")); },
            }
        }
        out.push(decode_xml(&line));
    }
    out.join("\n")
}
pub fn hwpx_text(buf: &[u8]) -> Result<String, String> {
    let mut z = zip_files(buf, "한글(HWPX) 파일을 열 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.")?;
    let re = Regex::new(r"(?i)^Contents/section(\d+)\.xml$").unwrap();
    let mut names: Vec<(u64, String)> = z.file_names().filter_map(|n| re.captures(n).map(|c| (c[1].parse().unwrap_or(0), n.to_string()))).collect();
    if names.is_empty() { return Err("한글(HWPX) 문서에서 본문을 찾지 못했습니다.".into()); }
    names.sort();
    let mut parts = vec![];
    for (_, n) in names { parts.push(xml_text(&zip_read(&mut z, &n).unwrap_or_default())); }
    Ok(tidy(&parts.join("\n")))
}

// ---------------- HWP (CFB 복합 문서) ----------------
const ENDOFCHAIN: u32 = 0xFFFF_FFFE;
const FREESECT: u32 = 0xFFFF_FFFF;
fn u16le(b: &[u8], o: usize) -> u32 { b.get(o..o + 2).map(|x| u16::from_le_bytes([x[0], x[1]]) as u32).unwrap_or(0) }
fn u32le(b: &[u8], o: usize) -> u32 { b.get(o..o + 4).map(|x| u32::from_le_bytes([x[0], x[1], x[2], x[3]])).unwrap_or(FREESECT) }
struct Dir { name: String, ty: u8, left: u32, right: u32, child: u32, start: u32, size: u32 }
pub struct Cfb { pub files: Vec<(String, Vec<u8>)> }
pub fn read_cfb(buf: &[u8]) -> Result<Cfb, String> {
    if buf.len() < 512 || u32le(buf, 0) != 0xE011CFD0 || u32le(buf, 4) != 0xE11AB1A1 { return Err("한글(HWP) 파일 형식이 아닙니다. 한글 2002 이후 문서(.hwp)나 .hwpx 를 골라 주세요.".into()); }
    let ss = 1usize << u16le(buf, 0x1E).min(20);
    let mss = 1usize << u16le(buf, 0x20).min(20);
    let (n_fat, dir_start, cutoff) = (u32le(buf, 0x2C) as usize, u32le(buf, 0x30), u32le(buf, 0x38));
    let (mini_fat_start, difat_start, n_difat) = (u32le(buf, 0x3C), u32le(buf, 0x44), u32le(buf, 0x48));
    let sec = |n: u32| -> &[u8] { let o = (n as usize + 1) * ss; if o >= buf.len() { &[] } else { &buf[o..(o + ss).min(buf.len())] } };
    let mut fat_secs = vec![];
    for i in 0..109 { if fat_secs.len() >= n_fat { break; } let v = u32le(buf, 0x4C + i * 4); if v != FREESECT { fat_secs.push(v); } }
    let mut d = difat_start;
    let per = ss / 4 - 1;
    for _ in 0..n_difat {
        if d == ENDOFCHAIN || d == FREESECT { break; }
        let s = sec(d);
        for i in 0..per { if fat_secs.len() >= n_fat { break; } let v = u32le(s, i * 4); if v != FREESECT { fat_secs.push(v); } }
        d = u32le(s, per * 4);
    }
    let mut fat = vec![];
    for f in &fat_secs { let s = sec(*f); for i in 0..ss / 4 { fat.push(u32le(s, i * 4)); } }
    let chain = |start: u32, table: &[u32]| -> Vec<u32> { let mut out = vec![]; let mut n = start; let mut g = 0; while n != ENDOFCHAIN && n != FREESECT && (n as usize) < table.len() && g < 1_000_000 { out.push(n); n = table[n as usize]; g += 1; } out };
    let read_chain = |start: u32| -> Vec<u8> { chain(start, &fat).into_iter().flat_map(|n| sec(n).to_vec()).collect() };
    let dir_buf = read_chain(dir_start);
    let mut dirs = vec![];
    let mut o = 0;
    while o + 128 <= dir_buf.len() {
        let nl = u16le(&dir_buf, o + 64) as usize;
        let units: Vec<u16> = dir_buf[o..o + nl.saturating_sub(2).min(64)].chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        dirs.push(Dir { name: String::from_utf16_lossy(&units), ty: dir_buf[o + 66], left: u32le(&dir_buf, o + 68), right: u32le(&dir_buf, o + 72), child: u32le(&dir_buf, o + 76), start: u32le(&dir_buf, o + 116), size: u32le(&dir_buf, o + 120) });
        o += 128;
    }
    let Some(root) = dirs.first() else { return Err("한글(HWP) 파일이 손상되었습니다.".into()) };
    let mini_stream = if root.ty == 5 { read_chain(root.start) } else { vec![] };
    let mut mini_fat = vec![];
    if mini_fat_start != ENDOFCHAIN { let mf = read_chain(mini_fat_start); for i in (0..mf.len() / 4 * 4).step_by(4) { mini_fat.push(u32le(&mf, i)); } }
    let read_stream = |e: &Dir| -> Vec<u8> {
        let mut v: Vec<u8> = if e.size < cutoff { chain(e.start, &mini_fat).into_iter().flat_map(|n| { let a = n as usize * mss; mini_stream.get(a..(a + mss).min(mini_stream.len())).unwrap_or(&[]).to_vec() }).collect() } else { read_chain(e.start) };
        v.truncate(e.size as usize);
        v
    };
    let mut files = vec![];
    fn walk(dirs: &[Dir], id: u32, prefix: &str, depth: usize, out: &mut Vec<(String, usize)>) {
        if id == FREESECT || id as usize >= dirs.len() || depth > 64 { return; }
        let e = &dirs[id as usize];
        walk(dirs, e.left, prefix, depth + 1, out);
        walk(dirs, e.right, prefix, depth + 1, out);
        let p = if prefix.is_empty() { e.name.clone() } else { format!("{prefix}/{}", e.name) };
        if e.ty == 2 { out.push((p, id as usize)); } else if e.ty == 1 { walk(dirs, e.child, &p, depth + 1, out); }
    }
    let mut ids = vec![];
    walk(&dirs, root.child, "", 0, &mut ids);
    for (p, i) in ids { files.push((p, read_stream(&dirs[i]))); }
    Ok(Cfb { files })
}
impl Cfb { pub fn read(&self, p: &str) -> Option<&[u8]> { self.files.iter().find(|f| f.0 == p).map(|f| f.1.as_slice()) } }

/// 문단 글 레코드(태그 67)의 UTF-16 글 → 사람이 읽는 글 (조절 문자 건너뛰기)
pub fn para_text(b: &[u8]) -> String {
    let mut s = vec![];
    let mut i = 0;
    while i + 1 < b.len() {
        let c = u16::from_le_bytes([b[i], b[i + 1]]);
        if c >= 32 { s.push(c); }
        else if c == 13 || c == 10 { s.push(10); }
        else if c == 9 { s.push(9); i += 14; }
        else if c == 30 || c == 31 { s.push(32); }
        else if c == 24 { s.push(b'-' as u16); }
        else if (1..=8).contains(&c) || c == 11 || c == 12 || (14..=23).contains(&c) { i += 14; }
        i += 2;
    }
    String::from_utf16_lossy(&s)
}
pub fn hwp_text(buf: &[u8]) -> Result<String, String> {
    let cfb = read_cfb(buf)?;
    let head = cfb.read("FileHeader").filter(|h| h.len() >= 40 && &h[..17] == b"HWP Document File").ok_or("한글(HWP) 문서가 아닙니다.")?;
    let flags = u32le(head, 36);
    if flags & 2 != 0 { return Err("암호가 걸린 한글 문서입니다. 한글에서 암호를 풀고 저장한 뒤 다시 불러와 주세요.".into()); }
    if flags & 4 != 0 { return Err("배포용 한글 문서라 글을 꺼낼 수 없습니다. 한글에서 일반 문서로 저장한 뒤 다시 불러와 주세요.".into()); }
    let compressed = flags & 1 != 0;
    let re = Regex::new(r"^BodyText/Section(\d+)$").unwrap();
    let mut secs: Vec<(u64, &str)> = cfb.files.iter().filter_map(|(p, _)| re.captures(p).map(|c| (c[1].parse().unwrap_or(0), p.as_str()))).collect();
    if secs.is_empty() { return Err("한글(HWP) 문서에서 본문을 찾지 못했습니다.".into()); }
    secs.sort();
    let mut out = String::new();
    for (_, p) in secs {
        let raw = cfb.read(p).unwrap_or(&[]);
        let s: Vec<u8> = if compressed {
            let mut v = vec![];
            if flate2::read::DeflateDecoder::new(raw).read_to_end(&mut v).is_err() { v.clear(); let _ = flate2::read::ZlibDecoder::new(raw).read_to_end(&mut v); }
            v
        } else { raw.to_vec() };
        let mut o = 0;
        while o + 4 <= s.len() {
            let h = u32le(&s, o); o += 4;
            let tag = h & 0x3FF;
            let mut size = (h >> 20) as usize;
            if size == 0xFFF { size = u32le(&s, o) as usize; o += 4; }
            if tag == 67 { out.push_str(&para_text(&s[o.min(s.len())..(o + size).min(s.len())])); }
            o += size;
        }
    }
    Ok(tidy(&out))
}
