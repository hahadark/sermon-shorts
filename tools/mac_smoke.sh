#!/bin/bash
# 맥 실행 시험: 빈 사용자 자료로 창을 띄워 화면 그림을 찍고, 작은 시험 영상을 내보낸다
set -uo pipefail
APP="$1"; OUT="$2"; mkdir -p "$OUT"
EXE="$APP/Contents/MacOS/SermonShorts"
export SS_USER_DATA_DIR="$(mktemp -d)" SS_TEST_MUTE=1 SS_TEST_YTFAKE=1
run() { # run <제한 초> 인자…
  local lim="$1"; shift
  "$EXE" "$@" & local pid=$!
  for i in $(seq 1 "$lim"); do sleep 1; kill -0 $pid 2>/dev/null || { wait $pid; return $?; }; done
  kill $pid; echo "시간 초과"; return 124
}
run 90 --test shot --report "$OUT/empty.png"; echo "빈 화면 끝: $?"
[ -s "$OUT/empty.png" ] || { echo "화면 그림 없음"; exit 1; }
# 시험 영상(색 막대 + 소리 8초)과 자막 단어로 프로젝트를 만들어 내보내기
FF="$APP/Contents/Resources/bin/ffmpeg"
"$FF" -hide_banner -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 8 -c:v libx264 -pix_fmt yuv420p -c:a aac "$OUT/src.mp4"
python3 - "$OUT" <<'PY'
import json, sys, os
out = sys.argv[1]
ws = [{"id": i, "text": t, "start": 0.5 + i * 0.9, "end": 1.2 + i * 0.9} for i, t in enumerate("하나님 은혜 가운데 오늘도 기도 합니다 아멘".split())]
p = {"version": 1, "source": {"path": os.path.join(out, "src.mp4"), "offset": 0}, "words": ws, "overrides": {}, "settings": {"padBefore": 0.1, "padAfter": 0.15, "fadeMs": 10, "maxLineChars": 14}, "meta": {"title": "맥 시험"}}
json.dump(p, open(os.path.join(out, "p.sshorts"), "w"), ensure_ascii=False)
PY
run 240 --project "$OUT/p.sshorts" --test exportflow --report "$OUT/export.json"; echo "내보내기 끝: $?"
cat "$OUT/export.json" || true
grep -q '"exported": true' "$OUT/export.json" && grep -q '"srt": true' "$OUT/export.json" || { echo "내보내기 실패"; exit 1; }
echo "맥 실행 시험 통과"