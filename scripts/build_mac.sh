#!/bin/bash
# macOS 빌드 (macOS 또는 Linux에서 실행). 결과: dist/SermonShorts-<버전>-mac-{arm64,intel}.zip
#  1) bin-mac/{arm64,x64}/ 에 ffmpeg·ffprobe(ffmpeg-static b6.1.1)와 yt-dlp_macos를 받는다
#  2) electron-builder로 .app 을 만들고
#  3) Apple Silicon은 서명 없는 코드를 실행하지 않으므로 ad-hoc 서명한다 (macOS: codesign, Linux: rcodesign)
#  4) 심볼릭 링크를 유지해 ZIP으로 묶는다
set -euo pipefail
cd "$(dirname "$0")/.."
VER="$(node -p "require('./package.json').version")"
FF_TAG="b6.1.1"
for a in arm64 x64; do
  mkdir -p "bin-mac/$a"
  for t in ffmpeg ffprobe; do
    [ -x "bin-mac/$a/$t" ] || curl -fsSL "https://github.com/eugeneware/ffmpeg-static/releases/download/$FF_TAG/$t-darwin-$a.gz" | gunzip > "bin-mac/$a/$t"
  done
  [ -x "bin-mac/$a/yt-dlp" ] || curl -fsSL -o "bin-mac/$a/yt-dlp" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos
  chmod +x "bin-mac/$a/"*
done

node node_modules/electron-builder/cli.js --mac dir --arm64 --x64 --publish never

sign() {
  if command -v codesign >/dev/null 2>&1; then codesign --force --deep --sign - "$1"
  elif command -v rcodesign >/dev/null 2>&1; then rcodesign sign "$1"
  else echo "codesign 또는 rcodesign이 필요합니다 (https://github.com/indygreg/apple-platform-rs)" >&2; exit 1; fi
}
pack() { # pack <앱 폴더> <이름>
  sign "$1/SermonShorts.app"
  rm -f "dist/SermonShorts-$VER-mac-$2.zip"
  (cd "$1" && zip -qry --symlinks "../SermonShorts-$VER-mac-$2.zip" SermonShorts.app)
  echo "dist/SermonShorts-$VER-mac-$2.zip"
}
pack dist/mac-arm64 arm64
pack dist/mac intel
