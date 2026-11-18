// 실제 GitHub 릴리스 목록에서 업데이트 고르기만 (받지 않음)
fn main() {
    let t = ureq::get("https://api.github.com/repos/hahadark/sermon-shorts/releases?per_page=30").set("User-Agent", "SermonShorts").call().unwrap().into_string().unwrap();
    let list: serde_json::Value = serde_json::from_str(&t).unwrap();
    for cur in ["0.4.0-beta.1", "0.4.0-beta.2", "0.4.0"] {
        for label in ["win-x64", "mac-arm64", "mac-intel"] {
            let r = sermon_shorts::updater::pick_release(&list, label, cur);
            println!("{cur} {label}: {:?}", r.map(|r| (r.version, r.zip_name, r.sums_url.rsplit('/').next().unwrap_or("").to_string())));
        }
    }
}
