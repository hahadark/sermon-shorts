//! 맥 Electron safeStorage 와 같은 잠금인지 (node crypto 로 만든 값과 비교)
use base64::Engine;
use sermon_shorts::secret::mac_crypt;
#[test]
fn mac_safe_storage() {
    let k = mac_crypt::derive("q8Xr2bZ1+aB/9kLmN0pQrw==");
    let b = base64::engine::general_purpose::STANDARD.decode("djEwp8o765/30mpFRdAwXY+R2wDA4E9SiLdvie+4Ld2lrjA=").unwrap();
    assert_eq!(mac_crypt::decrypt(&k, &b).unwrap(), "맥 키체인 시험 ok-1");
    assert_eq!(base64::engine::general_purpose::STANDARD.encode(mac_crypt::encrypt(&k, "맥 키체인 시험 ok-1")), "djEwp8o765/30mpFRdAwXY+R2wDA4E9SiLdvie+4Ld2lrjA=");
    assert!(mac_crypt::decrypt(&mac_crypt::derive("다른 비밀번호"), &b).is_err());
}