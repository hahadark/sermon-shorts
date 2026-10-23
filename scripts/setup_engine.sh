#!/bin/bash
# SermonShorts 자막 엔진 설치 (macOS): engine/.venv (Python 3.12) + torch + faster-whisper 등
# 사용:  bash scripts/setup_engine.sh [--data-dir DIR] [--dry-run] [--force] [--install-python] [--download-model] [--human]
#   --install-python : Python 3.12가 없으면 python-build-standalone(관리자 권한 불필요)을 engine/python 에 설치
#   --download-model : 설치 후 Whisper medium 모델까지 미리 받음 (약 1.5GB, Mac은 CPU로 변환)
#   --human          : JSON 대신 사람이 읽는 문장으로 출력
# 출력: 한 줄에 하나씩 JSON  {"type":"progress|info|warn|plan|error|done", ...}  (setup_engine.ps1과 같은 형식)
set -u

DATA_DIR=""; DRY=0; FORCE=0; INSTALL_PY=0; DL_MODEL=0; HUMAN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift ;;
    --dry-run) DRY=1 ;;
    --force) FORCE=1 ;;
    --install-python) INSTALL_PY=1 ;;
    --download-model) DL_MODEL=1 ;;
    --human) HUMAN=1 ;;
  esac
  shift
done

# python-build-standalone 3.12 (https://github.com/astral-sh/python-build-standalone)
PBS_TAG="20261021"
PBS_VER="3.12.15"
PBS_SHA_arm64="a18cc33862b53bd54a148c710def5375c1b47470cccedf817a19c2d211764584"
PBS_SHA_x86_64="869e0b30959beccc616ce14907439f4d0b3170c5830a2362dade07f07b0ed3b8"

json_str() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
emit() { # emit TYPE KEY VALUE [KEY VALUE ...]
  local type="$1"; shift
  if [ $HUMAN -eq 1 ]; then
    local msg="" pct="" k
    while [ $# -gt 1 ]; do k="$1"; case "$k" in message) msg="$2" ;; pct) pct="$2" ;; python|venv|arch) echo "  $k: $2" ;; command) msg="$2" ;; esac; shift 2; done
    case "$type" in
      progress) printf '[%3s%%] %s\n' "$pct" "$msg" ;;
      warn) echo "주의: $msg" ;;
      error) echo "오류: $msg" ;;
      done) echo "완료: $msg" ;;
      plan) echo "  - $msg" ;;
    esac
    return
  fi
  local out="{\"type\":\"$type\""
  while [ $# -gt 1 ]; do
    if [ "$1" = "pct" ] || [ "$1" = "step" ]; then out="$out,\"$1\":$2"
    elif [ "$2" = "true" ] || [ "$2" = "false" ]; then out="$out,\"$1\":$2"
    else out="$out,\"$1\":\"$(json_str "$2")\""; fi
    shift 2
  done
  echo "$out}"
}
step() { emit progress pct "$1" message "$2"; }
fail() { emit error message "$1"; exit 1; }

# 다른 Python 환경 변수가 섞이면 venv가 엉뚱한 곳에 설치된다
unset PYTHONHOME PYTHONPATH PIP_PREFIX PIP_TARGET PIP_USER VIRTUAL_ENV

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -n "$DATA_DIR" ]; then mkdir -p "$DATA_DIR"; DATA_ROOT="$(cd "$DATA_DIR" && pwd)"; else DATA_ROOT="$ROOT"; fi
ENGINE_DIR="$DATA_ROOT/engine"
VENV_DIR="$ENGINE_DIR/.venv"
VENV_PY="$VENV_DIR/bin/python"
LOCAL_PY="$ENGINE_DIR/python/bin/python3.12"
ARCH="$(uname -m)"
emit info root "$ROOT" venv "$VENV_DIR" arch "$ARCH" dryRun "$([ $DRY -eq 1 ] && echo true || echo false)"

# 1. Python 3.12 찾기
find_python() {
  local c
  for c in "$LOCAL_PY" /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 \
           /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 "$(command -v python3.12 2>/dev/null)"; do
    if [ -n "$c" ] && [ -x "$c" ] && "$c" -c 'import sys; sys.exit(0 if sys.version_info[:2]==(3,12) else 1)' 2>/dev/null; then echo "$c"; return; fi
  done
}
step 2 'Python 3.12 찾는 중'
PYTHON="$(find_python)"
if [ -z "$PYTHON" ] && [ $INSTALL_PY -eq 1 ] && [ $DRY -eq 0 ]; then
  case "$ARCH" in
    arm64) PBS_ARCH=aarch64; PBS_SHA="$PBS_SHA_arm64" ;;
    x86_64) PBS_ARCH=x86_64; PBS_SHA="$PBS_SHA_x86_64" ;;
    *) fail "지원하지 않는 CPU입니다: $ARCH" ;;
  esac
  NAME="cpython-$PBS_VER+$PBS_TAG-$PBS_ARCH-apple-darwin-install_only.tar.gz"
  URL="https://github.com/astral-sh/python-build-standalone/releases/download/$PBS_TAG/$NAME"
  TMP="$(mktemp -d)"
  step 3 "Python $PBS_VER 내려받는 중"
  curl -fsSL --retry 3 -o "$TMP/py.tar.gz" "$URL" || { rm -rf "$TMP"; fail "Python을 내려받지 못했습니다: $URL"; }
  GOT="$(shasum -a 256 "$TMP/py.tar.gz" | awk '{print $1}')"
  [ "$GOT" = "$PBS_SHA" ] || { rm -rf "$TMP"; fail 'Python 파일의 SHA256이 맞지 않아 설치하지 않았습니다.'; }
  step 6 "Python $PBS_VER 설치 중 (engine/python)"
  mkdir -p "$ENGINE_DIR" && rm -rf "$ENGINE_DIR/python" && tar -xzf "$TMP/py.tar.gz" -C "$ENGINE_DIR" || { rm -rf "$TMP"; fail 'Python 압축 풀기 실패'; }
  rm -rf "$TMP"
  PYTHON="$(find_python)"
fi
if [ -z "$PYTHON" ]; then
  if [ $DRY -eq 1 ] && [ $INSTALL_PY -eq 1 ]; then PYTHON="(설치 예정) $LOCAL_PY"
  else fail 'Python 3.12을 찾을 수 없습니다. 점검 창의 [엔진 설치]를 누르거나 https://www.python.org/downloads/macos/ 에서 Python 3.12를 설치하세요.'; fi
fi
emit info python "$PYTHON"
emit warn message 'Mac은 CPU로 음성 인식을 합니다 (medium 모델, 30분 설교에 약 10~30분).'

# Intel Mac은 PyTorch 2.2가 마지막이라 numpy 1.x가 필요하다
NUMPY="numpy"; EXTRA_PIN=""
[ "$ARCH" = "x86_64" ] && { NUMPY="numpy<2"; EXTRA_PIN="numpy<2"; }
PKGS="faster-whisper transformers soundfile $NUMPY huggingface-hub"

if [ $DRY -eq 1 ]; then
  i=0
  for cmd in "\"$PYTHON\" -m venv \"$VENV_DIR\"" "\"$VENV_PY\" -m pip install --upgrade pip" \
             "\"$VENV_PY\" -m pip install torch torchaudio $EXTRA_PIN" "\"$VENV_PY\" -m pip install $PKGS"; do
    i=$((i+1)); emit plan step $i command "$cmd"
  done
  emit done ok true dryRun true message '실제 설치는 하지 않았습니다 (--dry-run)'
  exit 0
fi

# 2. venv
if [ $FORCE -eq 1 ] && [ -d "$VENV_DIR" ]; then step 5 '기존 가상환경 삭제'; rm -rf "$VENV_DIR"; fi
if [ ! -x "$VENV_PY" ]; then
  step 10 '가상환경 만드는 중 (engine/.venv)'
  "$PYTHON" -m venv "$VENV_DIR" || fail 'venv 생성 실패'
fi
step 15 'pip 업데이트'
"$VENV_PY" -m pip install --upgrade pip --disable-pip-version-check || fail 'pip 업데이트 실패'

# 3. torch
step 20 'PyTorch 설치 중 - 몇 분 걸립니다'
"$VENV_PY" -m pip install --disable-pip-version-check torch torchaudio $EXTRA_PIN || fail 'PyTorch 설치 실패'

# 4. 나머지
step 70 '음성 인식 라이브러리 설치 중'
"$VENV_PY" -m pip install --disable-pip-version-check $PKGS || fail 'faster-whisper 등 설치 실패'

# 5. 확인
step 95 '설치 확인 중'
CHECK="$("$VENV_PY" -c "import json, torch, faster_whisper, transformers, soundfile; print(json.dumps({'torch': torch.__version__, 'cuda': False}))")" || fail '설치 확인 실패: 라이브러리를 불러올 수 없습니다.'
DONE_MSG='엔진 설치 완료. Whisper 모델(약 1.5GB)은 첫 자막 생성 때 자동으로 내려받습니다.'

# 6. Whisper 모델 (transcribe.py와 같은 모델·폴더)
if [ $DL_MODEL -eq 1 ]; then
  step 97 'Whisper medium 모델 받는 중 (약 1.5GB) - 몇 분 걸립니다'
  mkdir -p "$ENGINE_DIR/models"
  HF_HOME="$ENGINE_DIR/hf-cache" "$VENV_PY" -c "import sys; from faster_whisper.utils import download_model; download_model('medium', cache_dir=sys.argv[1])" "$ENGINE_DIR/models" \
    || fail 'Whisper 모델 받기 실패. 첫 자막 생성 때 다시 받습니다.'
  DONE_MSG='엔진 설치 완료. Whisper medium 모델도 받았습니다.'
fi
emit done ok true result "$CHECK" message "$DONE_MSG"
