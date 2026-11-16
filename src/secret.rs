//! Electron safeStorage(크롬 OSCrypt)로 잠근 설정 값 풀기·잠그기.
//! 윈도: 앱 자료 폴더 `Local State` 의 os_crypt.encrypted_key(DPAPI 로 잠긴 32바이트 키) + AES-256-GCM, 앞에 'v10'.
//! 같은 방식으로 잠그므로 Electron 판과 Rust 판이 서로의 값을 읽는다. 값은 화면·기록에 내보이지 않는다.
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::sync::OnceLock;

#[cfg(windows)]
fn dpapi_unprotect(data: &[u8]) -> anyhow::Result<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out) };
    if ok == 0 || out.pbData.is_null() { anyhow::bail!("이 PC의 암호 키를 풀지 못했습니다"); }
    let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe { LocalFree(out.pbData as _); }
    Ok(v)
}
#[cfg(not(windows))]
fn dpapi_unprotect(_data: &[u8]) -> anyhow::Result<Vec<u8>> { anyhow::bail!("이 운영체제에서는 아직 지원하지 않습니다") }
#[cfg(windows)]
#[allow(dead_code)]
fn dpapi_protect(data: &[u8]) -> anyhow::Result<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe { CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out) };
    if ok == 0 || out.pbData.is_null() { anyhow::bail!("이 PC의 암호 키를 만들지 못했습니다"); }
    let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe { LocalFree(out.pbData as _); }
    Ok(v)
}
#[cfg(not(windows))]
fn dpapi_protect(_data: &[u8]) -> anyhow::Result<Vec<u8>> { anyhow::bail!("이 운영체제에서는 아직 지원하지 않습니다") }

/// Electron 이 한 번도 실행되지 않은 PC: 크롬·Electron 과 같은 모양으로 새 키를 만들어 Local State 에 넣는다
/// (나중에 Electron 판을 깔아도 같은 키를 쓴다). 이미 키가 있으면 절대 바꾸지 않는다.
#[cfg(not(target_os = "macos"))]
fn create_key(p: &std::path::Path) -> anyhow::Result<()> {
    let mut j: serde_json::Value = std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(serde_json::json!({}));
    if j["os_crypt"]["encrypted_key"].as_str().is_some_and(|s| !s.is_empty()) { return Ok(()); }
    let mut k = [0u8; 32];
    getrandom::getrandom(&mut k).map_err(|e| anyhow::anyhow!("난수 오류: {e}"))?;
    let mut blob = b"DPAPI".to_vec();
    blob.extend(dpapi_protect(&k)?);
    if !j.is_object() { j = serde_json::json!({}); }
    if !j["os_crypt"].is_object() { j["os_crypt"] = serde_json::json!({}); }
    j["os_crypt"]["encrypted_key"] = serde_json::json!(B64.encode(blob));
    if let Some(d) = p.parent() { std::fs::create_dir_all(d)?; }
    let tmp = p.with_extension("ss-tmp");
    std::fs::write(&tmp, serde_json::to_string(&j)?)?;
    std::fs::rename(&tmp, p)?;
    Ok(())
}

/// Local State 의 AES 키 (한 번 읽어 둔다)
#[cfg(not(target_os = "macos"))]
fn key() -> anyhow::Result<[u8; 32]> {
    static K: OnceLock<Result<[u8; 32], String>> = OnceLock::new();
    K.get_or_init(|| {
        (|| -> anyhow::Result<[u8; 32]> {
            let p = crate::theme::user_data_dir().join("Local State");
            let has = std::fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()).is_some_and(|j| j["os_crypt"]["encrypted_key"].is_string());
            if !has { create_key(&p)?; }
            let j: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&p)?)?;
            let enc = j["os_crypt"]["encrypted_key"].as_str().ok_or_else(|| anyhow::anyhow!("암호 키가 없습니다"))?;
            let raw = B64.decode(enc)?;
            let raw = raw.strip_prefix(b"DPAPI").ok_or_else(|| anyhow::anyhow!("암호 키 모양이 다릅니다"))?;
            let k = dpapi_unprotect(raw)?;
            k.try_into().map_err(|_| anyhow::anyhow!("암호 키 길이가 다릅니다"))
        })().map_err(|e| e.to_string())
    }).clone().map_err(|e| anyhow::anyhow!(e))
}

/// 맥 Electron safeStorage(크롬 OSCrypt 맥): 키체인 "SermonShorts Safe Storage" 비밀번호 → PBKDF2-SHA1(saltysalt, 1003번) 16바이트 →
/// AES-128-CBC(IV 공백 16개, PKCS7), 앞에 'v10'. 계산은 어느 운영체제에서나 시험할 수 있게 늘 넣어 둔다.
pub mod mac_crypt {
    use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
    const IV: [u8; 16] = [b' '; 16];
    pub fn derive(password: &str) -> [u8; 16] {
        let mut k = [0u8; 16];
        pbkdf2::pbkdf2_hmac::<sha1::Sha1>(password.as_bytes(), b"saltysalt", 1003, &mut k);
        k
    }
    pub fn encrypt(key: &[u8; 16], text: &str) -> Vec<u8> {
        let ct = cbc::Encryptor::<aes::Aes128>::new(key.into(), &IV.into()).encrypt_padded_vec_mut::<Pkcs7>(text.as_bytes());
        let mut out = b"v10".to_vec(); out.extend(ct); out
    }
    pub fn decrypt(key: &[u8; 16], data: &[u8]) -> anyhow::Result<String> {
        let rest = data.strip_prefix(b"v10").ok_or_else(|| anyhow::anyhow!("잠긴 값 모양이 다릅니다"))?;
        let plain = cbc::Decryptor::<aes::Aes128>::new(key.into(), &IV.into()).decrypt_padded_vec_mut::<Pkcs7>(rest).map_err(|_| anyhow::anyhow!("값을 풀지 못했습니다 (다른 PC·사용자에서 잠근 값)"))?;
        Ok(String::from_utf8(plain)?)
    }
}

/// 맥: 키체인 비밀번호 (없으면 크롬처럼 무작위 16바이트를 만들어 넣는다. 이미 있으면 절대 바꾸지 않는다)
#[cfg(target_os = "macos")]
fn mac_key() -> anyhow::Result<[u8; 16]> {
    static K: OnceLock<Result<[u8; 16], String>> = OnceLock::new();
    K.get_or_init(|| {
        (|| -> anyhow::Result<[u8; 16]> {
            const SERVICE: &str = "SermonShorts Safe Storage";
            const ACCOUNT: &str = "SermonShorts Key";
            let find = || std::process::Command::new("security").args(["find-generic-password", "-w", "-s", SERVICE]).output().ok()
                .filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim_end_matches(['\n', '\r']).to_string()).filter(|s| !s.is_empty());
            let pw = match find() {
                Some(p) => p,
                None => {
                    let mut r = [0u8; 16];
                    getrandom::getrandom(&mut r).map_err(|e| anyhow::anyhow!("난수 오류: {e}"))?;
                    let p = B64.encode(r);
                    let ok = std::process::Command::new("security").args(["add-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w", &p]).status().is_ok_and(|s| s.success());
                    if !ok { anyhow::bail!("키체인에 암호 키를 만들지 못했습니다"); }
                    find().unwrap_or(p)
                }
            };
            Ok(mac_crypt::derive(&pw))
        })().map_err(|e| e.to_string())
    }).clone().map_err(|e| anyhow::anyhow!(e))
}

/// 잠긴 값(base64) 풀기. 비었으면 빈 글
pub fn decrypt(enc: &str) -> anyhow::Result<String> {
    if enc.trim().is_empty() { return Ok(String::new()); }
    let bytes = B64.decode(enc.trim())?;
    #[cfg(target_os = "macos")]
    { return mac_crypt::decrypt(&mac_key()?, &bytes); }
    #[cfg(not(target_os = "macos"))]
    {
        use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};
        if let Some(rest) = bytes.strip_prefix(b"v10") {
            if rest.len() < 12 + 16 { anyhow::bail!("잠긴 값이 너무 짧습니다"); }
            let k = key()?;
            let cipher = Aes256Gcm::new_from_slice(&k).map_err(|_| anyhow::anyhow!("키 오류"))?;
            let nonce = aes_gcm::Nonce::try_from(&rest[..12]).map_err(|_| anyhow::anyhow!("nonce 오류"))?;
            let plain = cipher.decrypt(&nonce, &rest[12..]).map_err(|_| anyhow::anyhow!("값을 풀지 못했습니다 (다른 PC·사용자에서 잠근 값)"))?;
            return Ok(String::from_utf8(plain)?);
        }
        Ok(String::from_utf8(dpapi_unprotect(&bytes)?)?)
    }
}

/// 값 잠그기 (Electron safeStorage.encryptString 과 같은 모양)
pub fn encrypt(text: &str) -> anyhow::Result<String> {
    #[cfg(target_os = "macos")]
    { return Ok(B64.encode(mac_crypt::encrypt(&mac_key()?, text))); }
    #[cfg(not(target_os = "macos"))]
    {
        use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};
        let k = key()?;
        let cipher = Aes256Gcm::new_from_slice(&k).map_err(|_| anyhow::anyhow!("키 오류"))?;
        let mut n = [0u8; 12];
        getrandom::getrandom(&mut n).map_err(|e| anyhow::anyhow!("난수 오류: {e}"))?;
        let nonce = aes_gcm::Nonce::try_from(&n[..]).map_err(|_| anyhow::anyhow!("nonce 오류"))?;
        let ct = cipher.encrypt(&nonce, text.as_bytes()).map_err(|_| anyhow::anyhow!("잠그지 못했습니다"))?;
        let mut out = b"v10".to_vec();
        out.extend_from_slice(&n);
        out.extend_from_slice(&ct);
        Ok(B64.encode(out))
    }
}
/// 설정의 잠긴 키 하나 풀기 (없거나 못 풀면 빈 글)
pub fn setting(settings: &serde_json::Value, key: &str) -> String {
    settings[key].as_str().and_then(|s| decrypt(s).ok()).unwrap_or_default()
}
