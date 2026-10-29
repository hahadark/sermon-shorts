#!/bin/bash
# Mac 앱 실행 시험 (GitHub Actions macOS 에서 사용). AI·유튜브 없이:
#  앱 안의 ffmpeg 로 시험 영상을 만들고 → 앱을 package-smoke 로 열어 자막 편집·미리보기·MP4 내보내기를 해 보고 →
#  화면을 찍고 스스로 끝나는지(종료 코드 0) 본다. 결과: smoke/ (smoke.png, validation.json, run.log)
# 사용: bash scripts/smoke_mac.sh [앱 경로, 기본 dist/mac-arm64/SermonShorts.app]
set -uo pipefail
cd "$(dirname "$0")/.."
APP="${1:-dist/mac-arm64/SermonShorts.app}"
OUT="$PWD/smoke"
rm -rf "$OUT"; mkdir -p "$OUT/ud"
FF="$APP/Contents/Resources/app/bin/ffmpeg"
[ -x "$FF" ] || { echo "앱 안에 ffmpeg 가 없습니다: $FF"; exit 1; }
"$FF" -v error -y -f lavfi -i "testsrc2=s=1280x720:r=30:d=20" -f lavfi -i "sine=f=440:d=20" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$OUT/test.mp4" || { echo "시험 영상을 만들지 못했습니다"; exit 1; }
for t in ffprobe yt-dlp; do "$APP/Contents/Resources/app/bin/$t" --version >/dev/null 2>&1 || "$APP/Contents/Resources/app/bin/$t" -version >/dev/null 2>&1 || { echo "$t 실행 실패"; exit 1; }; done

export SS_SCREENSHOT="$OUT/smoke.png" SS_USER_DATA_DIR="$OUT/ud" SS_TEST_SCRIPT=package-smoke SS_NO_UPDATE=1
"$APP/Contents/MacOS/SermonShorts" --open "$OUT/test.mp4" > "$OUT/run.log" 2>&1 &
pid=$!
for _ in $(seq 1 300); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
if kill -0 "$pid" 2>/dev/null; then echo "시간 초과 (5분)"; kill -9 "$pid"; tail -n 60 "$OUT/run.log"; exit 1; fi
wait "$pid"; code=$?
V="$OUT/ud/runtime/cache/guide/validation.json"
[ -f "$V" ] && cp "$V" "$OUT/validation.json"
tail -n 40 "$OUT/run.log"
echo "---- validation ----"; cat "$OUT/validation.json" 2>/dev/null || echo "(validation.json 없음)"
[ "$code" = "0" ] || { echo "앱 종료 코드 $code"; exit 1; }
grep -q '"success": *true' "$OUT/validation.json" || { echo "실행 시험 실패"; exit 1; }
[ -s "$OUT/smoke.png" ] || { echo "화면 캡처 없음"; exit 1; }
"$APP/Contents/Resources/app/bin/ffprobe" -v error -show_streams -of json "$OUT/ud/runtime/cache/guide/example.mp4" > "$OUT/output-probe.json" || exit 1
node - "$OUT" <<'NODE'
const fs = require('fs'), path = require('path'), out = process.argv[2];
const streams = JSON.parse(fs.readFileSync(path.join(out, 'output-probe.json'))).streams;
const video = streams.find(s => s.codec_type === 'video'), audio = streams.find(s => s.codec_type === 'audio');
if (!video || video.codec_name !== 'h264' || video.width !== 1080 || video.height !== 1920 || !audio || audio.codec_name !== 'aac') throw Error('출력 규격 오류');
if (!fs.readFileSync(path.join(out, 'ud/runtime/cache/guide/example.srt'), 'utf8').includes('-->')) throw Error('SRT 없음');
console.log('H.264 1080×1920 / AAC / SRT 확인');
NODE
[ "$?" = 0 ] || exit 1
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/SermonShorts" -p process.version || { echo "유튜브용 내장 JS 런타임 실행 실패"; exit 1; }
echo "Mac 실행 시험 통과"
