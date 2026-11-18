#!/bin/bash
# 맥 앱 묶음 만들기 (GitHub 맥 서버에서): dist/SermonShorts.app → ZIP·DMG
#   Contents/MacOS/SermonShorts, Contents/Resources/{assets,bin}. ffmpeg·ffprobe 는 Electron판과 같은 ffmpeg-static b6.1.1.
#   Apple 칩은 서명 없는 코드를 실행하지 않으므로 ad-hoc 서명한다.
set -euo pipefail
cd "$(dirname "$0")/.."
ARCH="$1"; LABEL="$2"
VER="$(grep -m1 '^version' Cargo.toml | cut -d'"' -f2)"
APP="dist/SermonShorts.app"
rm -rf dist; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/bin"
cp target/release/sermon_shorts "$APP/Contents/MacOS/SermonShorts"
rsync -a --exclude google-client.json assets "$APP/Contents/Resources/"
for t in ffmpeg ffprobe; do
  curl -fsSL "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/$t-darwin-$ARCH.gz" | gunzip > "$APP/Contents/Resources/bin/$t"
done
# 맥 내장 받아쓰기 도우미 (tools/mac_stt, macOS 26 이상에서 동작). 만들려면 macOS 26 SDK 가 있어야 한다: 없으면 빼고 만든다(그 앱은 위스퍼만 쓴다)
SDKV="$(xcrun --show-sdk-version 2>/dev/null || echo 0)"
if [ "${SDKV%%.*}" -ge 26 ] 2>/dev/null; then
  if [ "$ARCH" = x64 ]; then STT_T=x86_64; else STT_T=arm64; fi
  if swiftc -O -parse-as-library -target "$STT_T-apple-macos11.0" tools/mac_stt/main.swift -o "$APP/Contents/Resources/bin/ss-stt-apple"; then echo "맥 받아쓰기 도우미 넣음 (SDK $SDKV)"; else echo "맥 받아쓰기 도우미를 만들지 못해 빼고 만듦"; rm -f "$APP/Contents/Resources/bin/ss-stt-apple"; fi
else
  echo "SDK $SDKV: 맥 받아쓰기 도우미 빼고 만듦 (macOS 26 SDK 필요)"
fi
# yt-dlp 는 묶지 않는다(36MB): 앱이 처음 유튜브를 쓸 때 공식 최신판을 사용자 자료(runtime/bin)에 받아 두고 스스로 업데이트한다
rm -rf "$APP/Contents/Resources/assets/bin"
# 디버그 기호 빼기 (약 5MB)
strip -x "$APP/Contents/MacOS/SermonShorts"
chmod +x "$APP/Contents/MacOS/SermonShorts" "$APP/Contents/Resources/bin/"*
# 아이콘
ICON="$(mktemp -d)/icon.iconset"; mkdir -p "$ICON"
for s in 16 32 128 256 512; do
  sips -z $s $s assets/images/app-icon.png --out "$ICON/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) assets/images/app-icon.png --out "$ICON/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICON" -o "$APP/Contents/Resources/icon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>SermonShorts</string>
  <key>CFBundleDisplayName</key><string>설교 쇼츠 편집기 (Rust 베타)</string>
  <key>CFBundleIdentifier</key><string>com.hahadark.sermonshorts.rust</string>
  <key>CFBundleExecutable</key><string>SermonShorts</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VER}</string>
  <key>CFBundleVersion</key><string>${VER}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.video</string>
</dict></plist>
PLIST
# 서명: 늘 같은 인증서(MAC_SIGN_HASH, 워크플로가 넣음)로 서명해야 맥이 업데이트한 앱을 같은 앱으로 알아본다
# (폴더 접근·키체인 허락을 업데이트마다 다시 묻지 않게). 인증서가 없으면 임시 서명(-)
SIGN="${MAC_SIGN_HASH:--}"
KCARG=(); if [ -n "${MAC_SIGN_KEYCHAIN:-}" ]; then KCARG=(--keychain "$MAC_SIGN_KEYCHAIN"); fi
codesign --force --timestamp=none ${KCARG[@]+"${KCARG[@]}"} --sign "$SIGN" "$APP/Contents/Resources/bin/"*
codesign --force --timestamp=none ${KCARG[@]+"${KCARG[@]}"} --sign "$SIGN" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -d -r- "$APP" 2>&1 | sed -n 's/^designated => /서명 요구 조건: /p'
NAME="SermonShorts-Rust-$VER-mac-$LABEL"
ditto -c -k --sequesterRsrc --keepParent "$APP" "dist/$NAME.zip"
STAGE="$(mktemp -d)"; ditto "$APP" "$STAGE/SermonShorts.app"; ln -s /Applications "$STAGE/Applications"
ok=0
for try in 1 2 3 4 5; do
  if hdiutil create -volname "SermonShorts $VER" -srcfolder "$STAGE" -ov -format UDZO "dist/$NAME.dmg" >/dev/null; then ok=1; break; fi
  echo "hdiutil 실패 ($try/5)"; sleep $((try * 5))
done
[ "$ok" = 1 ] || { echo "DMG 를 만들지 못했습니다" >&2; exit 1; }
ls -la dist