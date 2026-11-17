//! 요약·QT 읽기 (기존 main/materials-speech.js · materials-speech.ps1): OS 내장 한국어 음성(무료)으로 WAV 를 만든다.
//! Windows: System.Speech(PowerShell), macOS: say + ffmpeg. 한국어 음성이 없으면 영어로 대체하지 않고 오류. 원고는 밖으로 보내지 않는다.
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

pub const MAX_CHARS: usize = 20000;
const PREFERRED: [&str; 1] = ["heami"];
static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq)]
pub struct Voice { pub id: String, pub name: String, pub lang: String }

pub fn is_korean(lang: &str) -> bool { let l = lang.to_lowercase(); l == "ko" || l.starts_with("ko-") || l.starts_with("ko_") }

/// `say -v ?` 출력: "Yuna                ko_KR    # 안녕하세요"
pub fn parse_say_list(out: &str) -> Vec<Voice> {
    let cut = regex::Regex::new(r"\s+#.*$").unwrap();
    let re = regex::Regex::new(r"^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]{2,4})\s*$").unwrap();
    out.lines().filter_map(|l| { let l = cut.replace(l, ""); re.captures(&l).map(|m| { let n = m[1].trim().to_string(); Voice { id: n.clone(), name: n, lang: m[2].replacen('_', "-", 1) } }) }).collect()
}
/// PowerShell 출력 "이름\tko-KR"
pub fn parse_win_list(out: &str) -> Vec<Voice> {
    out.lines().map(|l| l.split('\t').collect::<Vec<_>>()).filter(|p| p.len() >= 2 && !p[0].trim().is_empty()).map(|p| Voice { id: p[0].trim().into(), name: p[0].trim().into(), lang: p[1].trim().into() }).collect()
}
/// 한국어 음성 우선 선택. 지정 음성이 있으면 그것만(없으면 오류), 없으면 Heami 우선
pub fn pick_voice(voices: &[Voice], requested: &str) -> Result<Voice, String> {
    let ko: Vec<&Voice> = voices.iter().filter(|v| is_korean(&v.lang)).collect();
    if !requested.is_empty() {
        let Some(v) = voices.iter().find(|x| x.id == requested || x.name == requested) else { return Err(format!("요청한 음성 \"{requested}\" 을(를) 찾을 수 없습니다. 설치된 한국어 음성: {}", if ko.is_empty() { "없음".into() } else { ko.iter().map(|x| x.name.clone()).collect::<Vec<_>>().join(", ") })) };
        if !is_korean(&v.lang) { return Err(format!("\"{requested}\" 은(는) 한국어 음성이 아닙니다. 한국어 음성만 사용할 수 있습니다.")); }
        return Ok(v.clone());
    }
    if ko.is_empty() { return Err("설치된 한국어 음성이 없습니다. Windows는 설정 > 시간 및 언어 > 음성에서 한국어(Heami) 음성을, macOS는 시스템 설정 > 손쉬운 사용 > 말하기 콘텐츠에서 한국어(Yuna) 음성을 설치하세요. 영어 음성으로 대체하지 않습니다.".into()); }
    Ok((*ko.iter().find(|v| PREFERRED.iter().any(|p| v.name.to_lowercase().contains(p))).unwrap_or(&ko[0])).clone())
}
pub fn validate_text(text: &str) -> Result<String, String> {
    let t = text.replace('\u{0}', "").replace("\r\n", "\n").replace('\r', "\n").trim().to_string();
    if t.is_empty() { return Err("읽을 텍스트가 비어 있습니다.".into()); }
    let n = t.encode_utf16().count();
    if n > MAX_CHARS { return Err(format!("텍스트가 너무 깁니다 ({n}자, 최대 {MAX_CHARS}자).")); }
    Ok(t)
}
pub fn clamp_rate(r: i32) -> i32 { r.clamp(-10, 10) }

fn tmp(ext: &str) -> PathBuf {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    std::env::temp_dir().join(format!("materials-speech-{}-{n}{ext}", std::process::id()))
}
fn run(c: &mut Command, secs: u64) -> Result<(), String> {
    #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); }
    c.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped());
    let mut ch = c.spawn().map_err(|e| format!("음성 합성 실행 실패: {e}"))?;
    let t0 = std::time::Instant::now();
    loop {
        match ch.try_wait() {
            Ok(Some(st)) => {
                if st.success() { return Ok(()); }
                let mut err = String::new();
                if let Some(mut e) = ch.stderr.take() { use std::io::Read; let _ = e.read_to_string(&mut err); }
                return Err(format!("음성 합성 실행 실패: {}", err.trim().chars().take(300).collect::<String>()));
            }
            Ok(None) if t0.elapsed().as_secs() > secs => { let _ = ch.kill(); return Err("음성 합성 시간이 초과되었습니다.".into()); }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
            Err(e) => return Err(e.to_string()),
        }
    }
}
fn ps1() -> PathBuf { crate::assets_dir().join("materials").join("materials-speech.ps1") }
fn powershell(args: &[&str], extra: &[(&str, &Path)]) -> Command {
    let mut c = Command::new("powershell.exe");
    c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]).arg(ps1()).args(args);
    for (k, v) in extra { c.arg(k).arg(v); }
    c
}

pub fn list_voices() -> Result<Vec<Voice>, String> {
    if cfg!(windows) {
        let out = tmp(".txt");
        let r = run(&mut powershell(&["-Mode", "list"], &[("-OutFile", &out)]), 30);
        let t = std::fs::read_to_string(&out).unwrap_or_default();
        let _ = std::fs::remove_file(&out);
        r?;
        Ok(parse_win_list(&t))
    } else if cfg!(target_os = "macos") {
        let o = Command::new("say").args(["-v", "?"]).output().map_err(|e| format!("음성 합성 실행 실패: {e}"))?;
        Ok(parse_say_list(&String::from_utf8_lossy(&o.stdout)))
    } else { Err("이 운영체제는 지원하지 않습니다 (Windows, macOS만 가능).".into()) }
}

/// 글 → WAV 임시 파일
pub fn synthesize(text: &str, voice: &str, rate: i32) -> Result<PathBuf, String> {
    let clean = validate_text(text)?;
    let r = clamp_rate(rate);
    if BUSY.swap(true, Ordering::SeqCst) { return Err("이미 음성 합성이 진행 중입니다. 끝난 뒤 다시 시도하세요.".into()); }
    let out = tmp(".wav");
    let res = (|| -> Result<(), String> {
        let picked = pick_voice(&list_voices()?, voice)?;
        let txt = tmp(".txt");
        if cfg!(windows) {
            std::fs::write(&txt, &clean).map_err(|e| e.to_string())?;
            let rs = r.to_string();
            let x = run(&mut powershell(&["-Mode", "synth", "-Voice", &picked.id, "-Rate", &rs], &[("-TextFile", &txt), ("-OutFile", &out)]), 120);
            let _ = std::fs::remove_file(&txt);
            x?;
        } else {
            let aiff = tmp(".aiff");
            std::fs::write(&txt, clean.replace("[[", "[ [")).map_err(|e| e.to_string())?;
            let x = run(Command::new("say").args(["-v", &picked.id, "-r", &(175 + r * 15).to_string(), "-o"]).arg(&aiff).arg("-f").arg(&txt), 120)
                .and_then(|_| run(crate::media::command("ffmpeg").args(["-y", "-v", "error", "-i"]).arg(&aiff).args(["-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le"]).arg(&out), 120));
            let _ = std::fs::remove_file(&txt); let _ = std::fs::remove_file(&aiff);
            x?;
        }
        if std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0) < 100 { return Err("WAV 파일이 생성되지 않았습니다.".into()); }
        Ok(())
    })();
    BUSY.store(false, Ordering::SeqCst);
    if let Err(e) = res { let _ = std::fs::remove_file(&out); return Err(e); }
    Ok(out)
}

/// 만든 음성을 MP3·WAV 로 저장 (MP3 는 ffmpeg libmp3lame)
pub fn save_as(wav: &Path, target: &Path) -> Result<(), String> {
    let ext = target.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "wav" => crate::matrender::write_friendly(target, &std::fs::read(wav).map_err(|e| e.to_string())?),
        "mp3" => {
            let temp = target.with_extension(format!("{}.tmp.mp3", std::process::id()));
            let r = run(crate::media::command("ffmpeg").args(["-y", "-v", "error", "-i"]).arg(wav).args(["-codec:a", "libmp3lame", "-q:a", "3"]).arg(&temp), 120)
                .map_err(|e| format!("MP3 저장 실패: {e}"))
                .and_then(|_| std::fs::rename(&temp, target).map_err(|e| e.to_string()));
            let _ = std::fs::remove_file(&temp);
            r
        }
        _ => Err("MP3 또는 WAV 확장자로 저장해 주세요.".into()),
    }
}
