// 빌드 때 assets/google-client.json(저장소에는 없음)이 있으면 실행 파일 안에 넣는다. 없으면 빈 글.
// Windows: 실행 파일 아이콘·버전 정보(res/app.ico)를 rc.exe 로 만들어 붙인다 (rc.exe 가 없으면 건너뜀).
fn main() {
    let src = std::path::Path::new("assets/google-client.json");
    println!("cargo:rerun-if-changed=assets/google-client.json");
    let txt = std::fs::read_to_string(src).unwrap_or_default();
    let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    std::fs::write(out_dir.join("google_client.json"), txt).unwrap();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") { win_resource(&out_dir); }
}

fn find_rc() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("RC_EXE") { return Some(p.into()); }
    let base = std::path::Path::new(r"C:\Program Files (x86)\Windows Kits\10\bin");
    let mut vers: Vec<_> = std::fs::read_dir(base).ok()?.flatten().map(|e| e.path()).filter(|p| p.join("x64").join("rc.exe").exists()).collect();
    vers.sort();
    vers.pop().map(|p| p.join("x64").join("rc.exe"))
}

fn win_resource(out_dir: &std::path::Path) {
    println!("cargo:rerun-if-changed=res/app.ico");
    let Some(rc) = find_rc() else { println!("cargo:warning=rc.exe 를 찾지 못해 실행 파일 아이콘을 넣지 않습니다"); return };
    let ver = std::env::var("CARGO_PKG_VERSION").unwrap();
    let nums: Vec<u32> = ver.split(|c| c == '.' || c == '-').filter_map(|x| x.parse().ok()).take(3).collect();
    let (a, b, c) = (nums.first().copied().unwrap_or(0), nums.get(1).copied().unwrap_or(0), nums.get(2).copied().unwrap_or(0));
    let ico = std::fs::canonicalize("res/app.ico").unwrap().to_string_lossy().replace('\\', "\\\\");
    let rc_text = format!(r#"#pragma code_page(65001)
1 ICON "{ico}"
1 VERSIONINFO
FILEVERSION {a},{b},{c},0
PRODUCTVERSION {a},{b},{c},0
FILEOS 0x40004
FILETYPE 0x1
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "041204B0"
    BEGIN
      VALUE "CompanyName", "hahadark"
      VALUE "FileDescription", "SermonShorts"
      VALUE "FileVersion", "{ver}"
      VALUE "InternalName", "SermonShorts"
      VALUE "OriginalFilename", "SermonShorts.exe"
      VALUE "ProductName", "SermonShorts"
      VALUE "ProductVersion", "{ver}"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x412, 1200
  END
END
"#);
    let rc_file = out_dir.join("app.rc");
    std::fs::write(&rc_file, rc_text).unwrap();
    let res = out_dir.join("app.res");
    let ok = std::process::Command::new(&rc).args(["/nologo", "/fo"]).arg(&res).arg(&rc_file).status().map(|s| s.success()).unwrap_or(false);
    if ok { println!("cargo:rustc-link-arg-bins={}", res.display()); } else { println!("cargo:warning=rc.exe 실행 실패: 실행 파일 아이콘을 넣지 않습니다"); }
}
