//! 내보내기 (기존 src/renderer/exporter.js + src/main/render.js).
//! 제목·꼬리말·자막 줄마다 투명 PNG 를 그리고, ffmpeg 한 번으로 구간 잇기·자르기·겹치기를 해서 1080×1920 MP4 + SRT 를 만든다.
use crate::edl::{self, Line, Segment};
use crate::model::Word;
use crate::template::{self, Params};
use crate::textfx;
use crate::theme::{self, nn, num, s};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, Debug)]
pub struct Crop { pub scale: f64, pub x: f64, pub y: f64 }
impl Default for Crop { fn default() -> Self { Crop { scale: 1.0, x: 0.5, y: 0.5 } } }
impl Crop {
    pub fn from_value(v: &Value) -> Crop {
        Crop { scale: num(&v["scale"]).filter(|x| *x > 0.0).unwrap_or(1.0), x: num(&v["x"]).unwrap_or(0.5), y: num(&v["y"]).unwrap_or(0.5) }
    }
}

#[derive(Clone)]
pub struct Meta { pub title: String, pub verse: String, pub speaker: String, pub church: String }

impl Meta {
    /// 프로젝트 meta + 앱 설정(교회 이름·기본 설교자)
    pub fn of(project_meta: &Value, settings: &Value) -> Meta {
        let speaker = project_meta["speaker"].as_str().filter(|x| !x.is_empty()).map(String::from)
            .or_else(|| settings["defaultSpeaker"].as_str().filter(|x| !x.is_empty()).map(String::from))
            .or_else(|| settings["speakers"][0].as_str().map(String::from)).unwrap_or_default();
        let church = settings["template"]["churchName"].as_str().filter(|x| !x.is_empty()).or(settings["churchName"].as_str()).unwrap_or("").to_string();
        Meta { title: s(&project_meta["title"], "").into(), verse: s(&project_meta["verse"], "").into(), speaker, church }
    }
}

pub struct Request {
    pub source: PathBuf,
    pub out: PathBuf,
    pub words: Vec<Word>,
    pub segs: Vec<Segment>,
    pub lines: Vec<Line>,
    pub theme: Value,
    pub crop: Crop,
    pub fade_ms: f64,
    pub meta: Meta,
    /// 하드웨어 인코더 먼저 (실패하면 libx264)
    pub encoder: Encoder,
    /// 목소리 크기 맞춤 (프로젝트 voice 와 같은 모양, 없으면 그대로)
    pub voice: Option<Value>,
    /// 배경음악 (프로젝트 bgm 과 같은 모양, 없으면 없음)
    pub bgm: Option<Value>,
    /// run() 이 채운다: 받아 둔 음악 파일과 배치 (렌더러가 아무 파일이나 넣지 못하게 id 로만 받는다)
    pub bgm_file: Option<PathBuf>,
    pub bgm_plan: Option<crate::bgm::Plan>,
    /// 음성 싱크 오프셋 (초, + 는 소리를 늦춤, 프로젝트 audioOffset). 0 이면 인자가 Electron 과 똑같다
    pub audio_offset: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Encoder { Nvenc, X264 }

#[derive(Default, Clone)]
pub struct Progress { pub pct: f32, pub stage: String, pub done: Option<Result<Done, String>>, /// [멈추기]를 눌렀으면 true
    pub cancel: bool }
/// 멈췄을 때의 오류 글 (화면에서 오류 창 대신 알림만)
pub const CANCELLED: &str = "내보내기를 멈췄습니다.";
#[derive(Clone, Debug)]
pub struct Done { pub out: PathBuf, pub srt: PathBuf, pub duration: f64, pub secs: f64 }

pub fn srt_path_of(out: &Path) -> PathBuf {
    let s = out.to_string_lossy();
    let base = if s.to_lowercase().ends_with(".mp4") { &s[..s.len() - 4] } else { &s[..] };
    PathBuf::from(format!("{base}.srt"))
}

/// 파일 이름에 못 쓰는 글자를 뺀 기본 이름
pub fn default_name(title: &str) -> String {
    let re = regex::Regex::new(r"\s+/\s+").unwrap();
    let t: String = re.replace_all(title, " ").chars().filter(|c| !"\\/:*?\"<>|".contains(*c)).collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("{}.mp4", if t.is_empty() { "쇼츠" } else { &t })
}

fn blur_background_filter(b: &Value) -> String {
    let amount = num(&b["amount"]).map(|x| x.max(0.0)).unwrap_or(30.0);
    let dim = num(&b["dim"]).map(|x| x.clamp(0.0, 0.95)).unwrap_or(0.55);
    let r = (((amount / 4.0 / std::f64::consts::SQRT_2 * 12f64.sqrt() - 1.0) / 2.0).round()).clamp(1.0, 60.0) as i64;
    let mut f = format!("scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=luma_radius={r}:luma_power=2:chroma_radius={}:chroma_power=2,scale=1080:1920", r.min(60));
    if dim > 0.0 { let k = format!("{:.3}", 1.0 - dim); f += &format!(",format=gbrp,colorchannelmixer=rr={k}:gg={k}:bb={k}"); }
    f
}

/// JS toFixed (반올림, 0.5 는 위로)
fn fx(x: f64, d: usize) -> String { format!("{:.*}", d, x) }

/// 자막 그림 한 장: 이름과 출력 시각
#[derive(Clone, Debug)]
pub struct LineImage { pub name: String, pub start: f64, pub end: f64 }

/// render.js buildExportArgs 와 같은 ffmpeg 인자. lines_images[i] 가 비어 있으면 line_{i}.png 한 장
pub fn build_args(r: &Request, temp: &Path, line_images: &[Vec<LineImage>], encoder: Encoder) -> Result<(Vec<String>, String), String> {
    let segs = &r.segs;
    if segs.is_empty() { return Err("남은 영상 구간이 없습니다.".into()); }
    if segs.iter().any(|s| !s.start.is_finite() || !s.end.is_finite() || s.start < 0.0 || s.end <= s.start) { return Err("영상 구간 시각이 올바르지 않습니다.".into()); }
    let t = &r.theme;
    let v = &t["video"];
    let (vx, vy, vw, vh) = (num(&v["x"]).unwrap_or(0.0), num(&v["y"]).unwrap_or(0.0), num(&v["width"]).unwrap_or(0.0), num(&v["height"]).unwrap_or(0.0));
    if !(vw > 0.0 && vh > 0.0) { return Err("테마 영상 영역이 올바르지 않습니다.".into()); }
    let fade_ms = if r.fade_ms.is_finite() { r.fade_ms.max(0.0) } else { 10.0 };
    let start_t = (segs.iter().map(|s| s.start).fold(f64::MAX, f64::min) - 1.0).max(0.0);
    let end_t = segs.iter().map(|s| s.end).fold(f64::MIN, f64::max) + 1.0;
    let ms = |x: f64| (x * 1000.0).round() as i64;
    let entry = |file: &str, a: f64, b: f64| format!("file '{file}'\nduration {}\n", fx((ms(b) - ms(a)) as f64 / 1000.0, 3));
    let mut concat = String::new();
    let mut last = 0.0;
    for (i, l) in r.lines.iter().enumerate() {
        if l.out_start > last { concat += &entry("empty.png", last, l.out_start); }
        let imgs: Vec<&LineImage> = line_images.get(i).map(|v| v.iter().filter(|im| im.end > im.start).collect()).unwrap_or_default();
        if !imgs.is_empty() {
            let mut at = l.out_start;
            for (j, im) in imgs.iter().enumerate() { let end = if j == imgs.len() - 1 { l.out_end } else { at.max(l.out_end.min(im.end)) }; concat += &entry(&im.name, at, end); at = end; }
        } else {
            concat += &entry(&format!("line_{i}.png"), l.out_start, l.out_end);
        }
        last = l.out_end;
    }
    concat += "file 'empty.png'\nduration 9999\n";
    std::fs::write(temp.join("lines.txt"), concat).map_err(|e| e.to_string())?;

    let loop_t = fx(end_t - start_t, 3);
    let p = |n: &str| temp.join(n).to_string_lossy().to_string();
    let mut args: Vec<String> = vec!["-y".into(), "-ss".into(), fx(start_t, 3), "-to".into(), fx(end_t, 3), "-i".into(), r.source.to_string_lossy().into()];
    for n in ["top.png", "footer.png"] { args.extend(["-loop".into(), "1".into(), "-t".into(), loop_t.clone(), "-i".into(), p(n)]); }
    args.extend(["-f".into(), "concat".into(), "-safe".into(), "0".into(), "-i".into(), p("lines.txt")]);
    let layers = theme::export_layers(t);
    let mut next = 4;
    let mut add_image = |args: &mut Vec<String>, name: &str| { args.extend(["-loop".into(), "1".into(), "-t".into(), loop_t.clone(), "-i".into(), p(name)]); next += 1; next - 1 };
    let bg_in = if layers.bg_image { add_image(&mut args, "bg.png") } else { -1 };
    let under_in = if layers.under { add_image(&mut args, "under.png") } else { -1 };
    let mask_in = if layers.mask { add_image(&mut args, "mask.png") } else { -1 };
    // 음성 싱크: 소리는 같은 원본을 따로 한 번 더 열어 오프셋만큼 옮긴 자리에서 가져온다 (영상·자막 시각은 그대로)
    let d = crate::sync::clamp(r.audio_offset);
    let audio = audio_input(segs, start_t, end_t, d);
    let audio_in = if let Some((ta, tb)) = audio {
        args.extend(["-ss".into(), fx(ta, 3), "-to".into(), fx(tb, 3), "-i".into(), r.source.to_string_lossy().into()]);
        next += 1; next - 1
    } else { -1 };

    let mut fg = String::new();
    for (i, seg) in segs.iter().enumerate() {
        let (s0, e0) = (fx((seg.start - start_t).max(0.0), 3), fx((seg.end - start_t).max(0.0), 3));
        let fade = (fade_ms / 1000.0).min((seg.end - seg.start) / 2.0);
        let f = fx(fade, 3);
        let fo = fx(seg.end - seg.start - fade, 3);
        fg += &format!("[0:v]trim=start={s0}:end={e0},setpts=PTS-STARTPTS[v{i}]; ");
        match audio {
            None => fg += &format!("[0:a]atrim=start={s0}:end={e0},asetpts=PTS-STARTPTS,afade=t=in:d={f},afade=t=out:st={fo}:d={f}[a{i}]; "),
            Some((ta, _)) => fg += &format!("{},afade=t=in:d={f},afade=t=out:st={fo}:d={f}[a{i}]; ", audio_piece(audio_in, seg.start, seg.end, start_t, ta, d)),
        }
    }
    let ins: String = (0..segs.len()).map(|i| format!("[v{i}][a{i}]")).collect();
    fg += &format!("{ins}concat=n={}:v=1:a=1[vcat][acat]; ", segs.len());
    let aspect = vw / vh;
    let a4 = format!("{:.4}", aspect);
    let base_w = format!("min(in_w,in_h*{a4})");
    let crop_w = format!("({base_w}/{})", js_num(r.crop.scale));
    let crop_h = format!("({crop_w}/{a4})");
    let crop_x = format!("(in_w*{}-{crop_w}/2)", js_num(r.crop.x));
    let crop_y = format!("(in_h*{}-{crop_h}/2)", js_num(r.crop.y));
    let mut vsrc = "[vcat]";
    if layers.blur { fg += "[vcat]split=2[vmain][vbgsrc]; "; vsrc = "[vmain]"; }
    fg += &format!("{vsrc}crop=w='{crop_w}':h='{crop_h}':x='{crop_x}':y='{crop_y}',scale={}:{}[vcrop]; ", js_num(vw), js_num(vh));
    let mut vlabel = "[vcrop]";
    if mask_in >= 0 { fg += &format!("[vcrop]format=rgba[vrgba]; [{mask_in}:v]scale={}:{},format=gray[vmask]; [vrgba][vmask]alphamerge[vround]; ", js_num(vw), js_num(vh)); vlabel = "[vround]"; }
    if layers.blur { fg += &format!("[vbgsrc]{}[base]; ", blur_background_filter(&t["canvas"]["blur"])); }
    else if bg_in >= 0 { fg += &format!("[{bg_in}:v]format=rgba[base]; "); }
    else { fg += &format!("color=c={}:s=1080x1920:d=1[base]; ", s(&t["canvas"]["background"], "#000000").replace('#', "0x")); }
    let mut base_label = "[base]".to_string();
    if under_in >= 0 { fg += &format!("[base][{under_in}:v]overlay=x=0:y=0[baseu]; "); base_label = "[baseu]".into(); }
    fg += &format!("{base_label}{vlabel}overlay=x={}:y={}[basev]; ", js_num(vx), js_num(vy));
    let fade_in = nn(&t["fadeInSec"], 1.0);
    let footer_filter = if fade_in > 0.0 { format!("format=rgba,fade=t=in:st=0:d={}:alpha=1", js_num(fade_in)) } else { "format=rgba".into() };
    fg += &format!("[basev][1:v]overlay=x=0:y=0:shortest=1[ovl1]; [2:v]{footer_filter}[footer]; [ovl1][footer]overlay=x=0:y=0:shortest=1[ovl2]; ");
    fg += "[ovl2][3:v]overlay=x=0:y=0:shortest=1,format=yuv420p[vout]";
    // 목소리 크기: (작은 말소리 고르게) → 키우기 → 리미터. 배경음악은 그 뒤에 얹는다
    let mut speech = "[acat]".to_string();
    if let Some(v) = &r.voice {
        let vf = crate::voice::ffmpeg_filter(&crate::voice::normalize(v), "[acat]", "[avox]");
        if !vf.is_empty() { fg += &format!("; {vf}"); speech = "[avox]".into(); }
    }
    let mut audio_out = speech.clone();
    // 배경음악: 고른 구간을 자르고 페이드·크기·시작 시각(맞춤)을 적용해 말소리 위에 얹는다
    if let (Some(f), Some(pl)) = (&r.bgm_file, &r.bgm_plan) {
        if pl.length > 0.0 {
            let bgm_in = next;
            args.extend(["-i".into(), f.to_string_lossy().into()]);
            fg += &format!("; {}", crate::bgm::ffmpeg_filter(pl, bgm_in as usize, &speech));
            audio_out = "[aout]".into();
        }
    }
    args.extend(["-filter_complex".into(), fg.clone(), "-map".into(), "[vout]".into(), "-map".into(), audio_out]);
    args.extend(["-t".into(), fx(edl::segments_duration(segs), 6)]);
    let enc: &[&str] = match encoder { Encoder::Nvenc => &["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-b:v", "0"], Encoder::X264 => &["-c:v", "libx264", "-preset", "medium", "-crf", "18"] };
    args.extend(enc.iter().map(|x| x.to_string()));
    args.extend(["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-r", "30", "-movflags", "+faststart", "-progress", "pipe:1"].iter().map(|x| x.to_string()));
    args.push(r.out.to_string_lossy().into());
    Ok((args, fg))
}

/// 음성 싱크용 소리 입력의 원본 범위 (-ss, -to). 오프셋이 0 이면 None (영상 입력의 소리를 그대로)
pub fn audio_input(segs: &[Segment], start_t: f64, end_t: f64, d: f64) -> Option<(f64, f64)> {
    if d == 0.0 { return None; }
    let ta = ((start_t - d).max(0.0) * 1000.0).round() / 1000.0;
    let longest = segs.iter().map(|s| s.end - s.start).fold(0.0, f64::max);
    // 구간 전체가 0초 앞에 떨어져도(무음 구간) 자를 소리가 있도록 끝은 넉넉히
    let tb = (end_t - d).max(ta + longest + 1.0);
    Some((ta, tb))
}

/// 음성 싱크 구간 하나의 소리 필터 (afade 앞까지): 원본 [a−d, b−d) 를 자르고, 0초 앞은 앞 무음(adelay),
/// 모자라면 뒤 무음(apad) → 영상 구간과 같은 길이(atrim end)
pub fn audio_piece(input: i32, a: f64, b: f64, start_t: f64, ta: f64, d: f64) -> String {
    // 영상 trim 과 같은 ms 반올림 길이
    let r3 = |x: f64| (x * 1000.0).round() / 1000.0;
    let len = (r3((b - start_t).max(0.0)) - r3((a - start_t).max(0.0))).max(0.0);
    let w = crate::sync::window(a, b, d);
    let mut f = if w.dur() > 0.0005 {
        format!("[{input}:a]atrim=start={}:end={},asetpts=PTS-STARTPTS", fx((w.src_start - ta).max(0.0), 3), fx((w.src_end - ta).max(0.0), 3))
    } else {
        // 구간 전체가 원본 소리 밖: 아무 소리나 자르고 끄기 (길이·형식만 맞춤)
        format!("[{input}:a]atrim=start=0:end={},asetpts=PTS-STARTPTS,volume=0", fx(len.max(0.001), 3))
    };
    if w.lead >= 0.0005 && w.dur() > 0.0005 { f += &format!(",adelay=delays={}:all=1", fx(w.lead * 1000.0, 3)); }
    f += &format!(",apad,atrim=end={}", fx(len, 3));
    f
}

/// JS 숫자 → 문자열 (정수는 소수점 없이)
fn js_num(x: f64) -> String { if x.fract() == 0.0 && x.abs() < 1e15 { format!("{}", x as i64) } else { format!("{}", x) } }

/// 그림 파일들 (exporter.js 와 같은 이름) → 줄마다 가라오케 그림 목록
pub fn render_images(r: &Request, temp: &Path, prog: &(dyn Fn(f32) + Sync)) -> Result<Vec<Vec<LineImage>>, String> {
    let t = &r.theme;
    let logo = template::theme_logo(t);
    let base = |sub: String, groups: Option<Vec<String>>, k: Option<i64>| Params { title: r.meta.title.clone(), verse: r.meta.verse.clone(), speaker: r.meta.speaker.clone(), church_name: r.meta.church.clone(), subtitle_text: sub, subtitle_groups: groups, karaoke_index: k, theme: t, logo: logo.clone() };
    let save = |name: &str, layers: &[&str], p: &Params| -> Result<(), String> {
        let mut pm = tiny_skia::Pixmap::new(template::W, template::H).unwrap();
        if !layers.is_empty() { template::draw_template(&mut pm, layers, p); }
        pm.save_png(temp.join(name)).map_err(|e| format!("{name}: {e}"))
    };
    let layers = theme::export_layers(t);
    let p0 = base(String::new(), None, None);
    if layers.bg_image { save("bg.png", &["background"], &p0)?; }
    if layers.under { save("under.png", &["under"], &p0)?; }
    if layers.mask { if let Some(m) = template::video_mask(&t["video"]) { m.save_png(temp.join("mask.png")).map_err(|e| e.to_string())?; } }
    save("top.png", &["top"], &p0)?;
    save("footer.png", &["footer"], &p0)?;
    save("empty.png", &[], &p0)?;
    // 줄 그림: 여러 스레드로 나눠 그린다
    let karaoke = template::uses_karaoke(t);
    let jobs: Vec<(usize, Option<textfx::Karaoke>)> = r.lines.iter().enumerate().map(|(i, l)| (i, if karaoke { Some(textfx::karaoke_of(l, &r.words, &r.segs)) } else { None })).collect();
    let out: Mutex<Vec<Vec<LineImage>>> = Mutex::new(vec![vec![]; r.lines.len()]);
    let err: Mutex<Option<String>> = Mutex::new(None);
    let done = std::sync::atomic::AtomicUsize::new(0);
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 8);
    let total = jobs.len().max(1);
    std::thread::scope(|sc| {
        for k in 0..threads {
            let (jobs, out, err, done, save, base) = (&jobs, &out, &err, &done, &save, &base);
            sc.spawn(move || {
                for (i, kar) in jobs.iter().skip(k).step_by(threads) {
                    let text = r.lines[*i].text.clone();
                    let res: Result<Vec<LineImage>, String> = (|| {
                        match kar {
                            Some(kk) if !kk.frames.is_empty() => {
                                let mut v = vec![];
                                for (j, f) in kk.frames.iter().enumerate() {
                                    let name = format!("line_{i}_{j}.png");
                                    save(&name, &["subtitle"], &base(text.clone(), Some(kk.groups.clone()), Some(f.index as i64)))?;
                                    v.push(LineImage { name, start: f.start, end: f.end });
                                }
                                Ok(v)
                            }
                            _ => { save(&format!("line_{i}.png"), &["subtitle"], &base(text.clone(), None, None))?; Ok(vec![]) }
                        }
                    })();
                    match res { Ok(v) => out.lock().unwrap()[*i] = v, Err(e) => { *err.lock().unwrap() = Some(e); return; } }
                    let n = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                    prog(n as f32 / total as f32);
                }
            });
        }
    });
    if let Some(e) = err.into_inner().unwrap() { return Err(e); }
    Ok(out.into_inner().unwrap())
}

fn friendly_error(raw: &str) -> String {
    if raw.contains("Error opening output") { return "저장할 폴더를 찾을 수 없습니다. 폴더가 있는지 확인하고 다시 내보내 주세요.".into(); }
    let l = raw.to_lowercase();
    if l.contains("permission denied") || l.contains("access is denied") { return "이 위치에 저장할 수 없습니다. 같은 이름의 영상이 다른 프로그램(재생기 등)에서 열려 있거나 쓰기 권한이 없습니다. 닫거나 다른 이름·폴더로 저장해 주세요.".into(); }
    if l.contains("no space left") { return "저장 공간이 부족합니다.".into(); }
    let tail: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = tail[tail.len().saturating_sub(4)..].join(" / ");
    let tail: String = { let c: Vec<char> = tail.chars().collect(); c[c.len().saturating_sub(400)..].iter().collect() };
    format!("영상 만들기에 실패했습니다. {tail}")
}

fn run_ffmpeg(args: &[String], total: f64, prog: &dyn Fn(f32), progress: &Arc<Mutex<Progress>>) -> Result<(), String> {
    let mut cmd = crate::media::command("ffmpeg");
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("ffmpeg 를 실행하지 못했습니다: {e}"))?;
    let stderr = child.stderr.take().unwrap();
    let err_thread = std::thread::spawn(move || { let mut s = String::new(); let _ = std::io::Read::read_to_string(&mut BufReader::new(stderr), &mut s); s });
    // [멈추기]: ffmpeg 를 끝낸다
    let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
    { let (f2, p2, pid) = (finished.clone(), progress.clone(), child.id());
      std::thread::spawn(move || { while !f2.load(std::sync::atomic::Ordering::SeqCst) { if p2.lock().map(|p| p.cancel).unwrap_or(false) { kill_pid(pid); break; } std::thread::sleep(std::time::Duration::from_millis(150)); } }); }
    for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
        if let Some(v) = line.strip_prefix("out_time_ms=") { if let Ok(us) = v.trim().parse::<f64>() { prog(((us / 1e6) / total).clamp(0.0, 1.0) as f32); } }
    }
    let status = child.wait().map_err(|e| e.to_string());
    finished.store(true, std::sync::atomic::Ordering::SeqCst);
    let status = status?;
    let err = err_thread.join().unwrap_or_default();
    if progress.lock().map(|p| p.cancel).unwrap_or(false) { return Err(CANCELLED.into()); }
    if status.success() { Ok(()) } else { Err(err) }
}
fn kill_pid(pid: u32) {
    #[cfg(windows)] { use std::os::windows::process::CommandExt; let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).creation_flags(0x0800_0000).stdout(Stdio::null()).stderr(Stdio::null()).status(); }
    #[cfg(not(windows))] { let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status(); }
}

/// 전체 내보내기 (다른 스레드에서 부른다). progress 에 단계·퍼센트를 쓴다
pub fn run(mut r: Request, progress: Arc<Mutex<Progress>>) -> Result<Done, String> {
    let t0 = std::time::Instant::now();
    let set = |pct: f32, stage: &str| { let mut p = progress.lock().unwrap(); p.pct = pct; p.stage = stage.into(); };
    if r.segs.is_empty() { return Err("남은 영상 구간이 없습니다. 지운 단어를 먼저 되살려 주세요.".into()); }
    // 배경음악은 목록(id)으로만 받는다: 받은 파일 경로는 여기서 정한다
    r.bgm_file = None; r.bgm_plan = None;
    if let Some(b) = r.bgm.clone().filter(|b| b["id"].as_str().is_some_and(|s| !s.is_empty())) {
        let out_dur = edl::segments_duration(&r.segs);
        let track = crate::bgm::track_of(b["id"].as_str().unwrap())?;
        let mut bb = b.clone();
        if track.duration_sec > 0.0 { bb["duration"] = serde_json::json!(track.duration_sec); }
        r.bgm_plan = crate::bgm::plan(&bb, out_dur);
        if r.bgm_plan.is_some() {
            set(0.0, "배경음악 받는 중");
            r.bgm_file = Some(crate::bgm::ensure(&track.id, &|g, n| { if n > 0 { set(0.0, &format!("배경음악 받는 중 {}%", g * 100 / n)); } })?);
        }
    }
    // 목소리 자동 맞춤: 잰 값이 지금 편집과 다르면 내보내기 전에 다시 잰다
    if let Some(v) = &r.voice {
        let mut n = crate::voice::normalize(v);
        let segs: Vec<(f64, f64)> = r.segs.iter().map(|s| (s.start, s.end)).collect();
        if n.mode == "auto" && !crate::voice::measured_fits(&n, &crate::voice::seg_key(&segs)) {
            set(0.0, "목소리 크기 재는 중");
            n.measured = Some(crate::voice::analyze(&r.source, &segs, &n)?);
        }
        r.voice = Some(n.to_json());
    }
    let temp = std::env::temp_dir().join(format!("sshorts_export_{}_{}", std::process::id(), t0.elapsed().as_nanos() ^ (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0))));
    std::fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
    let cancelled = || progress.lock().map(|p| p.cancel).unwrap_or(false);
    let result = (|| {
        if cancelled() { return Err(CANCELLED.to_string()); }
        set(0.0, "자막 그림 만드는 중");
        let imgs = render_images(&r, &temp, &|f| set(f * 10.0, "자막 그림 만드는 중"))?;
        if cancelled() { return Err(CANCELLED.to_string()); }
        let total = edl::segments_duration(&r.segs);
        let enc_prog = |f: f32| set(10.0 + f * 90.0, "영상 만드는 중");
        let (args, _) = build_args(&r, &temp, &imgs, r.encoder)?;
        let mut res = run_ffmpeg(&args, total, &enc_prog, &progress);
        if res.is_err() && r.encoder != Encoder::X264 && !cancelled() {
            set(10.0, "영상 만드는 중 (소프트웨어 인코더)");
            let (args, _) = build_args(&r, &temp, &imgs, Encoder::X264)?;
            res = run_ffmpeg(&args, total, &enc_prog, &progress);
        }
        if cancelled() { let _ = std::fs::remove_file(&r.out); return Err(CANCELLED.to_string()); }
        res.map_err(|e| friendly_error(&e))?;
        let srt = srt_path_of(&r.out);
        std::fs::write(&srt, edl::to_srt(&r.lines)).map_err(|e| format!("SRT 저장 실패: {e}"))?;
        set(100.0, "완료");
        Ok(Done { out: r.out.clone(), srt, duration: total, secs: t0.elapsed().as_secs_f64() })
    })();
    if std::env::var("SS_KEEP_EXPORT_TEMP").is_err() { let _ = std::fs::remove_dir_all(&temp); } else { eprintln!("임시 폴더: {}", temp.display()); }
    result
}
