# 설교 쇼츠 편집기 Rust판 — 맥에서 이어서 개발하기

이 문서는 PC(Windows)에서 하던 Rust판 개발을 **맥에서 이어서** 하기 위한 인계 문서입니다.
이제 **Rust판만** 개발합니다(Electron판 `main` 가지는 손대지 않음). 사용자에게 하는 보고·질문은 모두 **한국어**로 합니다.

## 1. 지금 상태 (2026-11-18 기준)
- 저장소: `https://github.com/hahadark/sermon-shorts` 의 **`rust` 가지** (최신 커밋 `05730b7` 이후).
- 공개된 최신판: **Rust 0.4.1** (태그 `rust-v0.4.1`, GitHub Latest). 그 뒤 커밋은 아직 릴리즈하지 않음:
  - 바뀐 부분만 받는 업데이트(`src/delta.rs`, 릴리스마다 core·assets·tools 덩어리 ZIP + `…-files.json`)
  - AI 편집 대화 칸을 접으면 오른쪽에 다시 펼치는 띠, 입력 칸을 비워 두고 [보내기] → 처음에는 구간 3곳 추천 / 다듬기를 골라 두었으면 한번에 적용
- 사용자 보고: **"맥에서 엄청 이상해졌다"** — 무엇이 이상한지는 아직 모름. 맥에서 시작하면 **먼저 사용자에게 어떤 화면에서 무엇이 이상한지(스크린샷) 물어서** 그것부터 고친다.

## 2. 맥 개발 환경 만들기
```bash
# Rust (한 번만)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
# 개발 실행에 쓸 ffmpeg·yt-dlp (앱 묶음에는 들어 있지만 cargo run 은 PATH 에서 찾는다)
brew install ffmpeg yt-dlp
# 소스
git clone -b rust https://github.com/hahadark/sermon-shorts.git sermon-shorts-rs
cd sermon-shorts-rs
cargo build --release
cargo run --release            # 개발 실행 (assets 는 저장소의 assets/ 를 쓴다)
```
- ffmpeg 찾는 순서(`media::find_tool`): 실행 파일 옆 `bin/` → 실행 파일 옆 → `../Resources/bin/`(앱 묶음) → `PATH`.
- `assets/google-client.json`(구글 OAuth 클라이언트)은 **저장소에 없음**(비밀). 없으면 유튜브 올리기 로그인만 안 되고 나머지는 된다. 릴리즈 빌드는 GitHub Actions 가 비밀(`GOOGLE_CLIENT_JSON`)로 넣는다. 맥에서 직접 필요하면 사용자에게 받는다(PC 백업: `F:\aside\sermon-shorts-secrets\google-client.json`). 절대 커밋·출력하지 말 것.

## 3. 맥에서 실제 앱처럼 시험하기
```bash
bash tools/mac_bundle.sh arm64 arm64      # Intel 맥이면: bash tools/mac_bundle.sh x64 intel
open dist/SermonShorts.app
bash tools/mac_smoke.sh dist/SermonShorts.app smoke   # 빈 사용자 자료로 화면 찍기 + 시험 영상 내보내기
```
- `mac_bundle.sh` 는 `dist/SermonShorts.app` 과 ZIP·DMG 를 만든다. ffmpeg·ffprobe 는 ffmpeg-static b6.1.1 을 받아 넣는다.
- 서명: 환경 변수 `MAC_SIGN_HASH`(+`MAC_SIGN_KEYCHAIN`)가 있으면 그 인증서로, 없으면 임시 서명(-). **릴리즈 빌드는 GitHub Actions 가 늘 같은 인증서("SermonShorts Code Signing")로 서명**해서 업데이트해도 맥이 같은 앱으로 알아본다(폴더·키체인 허락 유지). 로컬 임시 서명 빌드는 실행할 때마다 다른 앱으로 보일 수 있으니, 키체인·폴더 허락을 묻는 문제를 시험할 때는 이 점을 감안한다. 인증서(p12)는 PC `F:\aside\sermon-shorts-secrets\mac-sign\` 에 있다(필요하면 사용자에게 받는다).
- 사용자 자료(맥): `~/Library/Application Support/SermonShorts` (설정 `settings.json`, 자동 저장, 테마, 칸 크기 `layout.json`, 업데이트 `rust-update/`). 시험할 때는 실제 자료를 건드리지 않게 `SS_USER_DATA_DIR=$(mktemp -d)` 를 쓴다.

## 4. 자동 시험
- `cargo test --release` : 계산 시험. 아래 시험은 **공개 저장소에 없는 실제 설교 자막 자료**(`.gitignore` 의 tests/fixtures/*)가 필요해 맥 새 복제본에서는 실패한다 — 정상. 맥 CI 는 공개 자료로 되는 것만 돈다:
  `cargo test --release --test bgm_parity --test llm_parity --test settings_parity --test snap_parity --test ytmeta_parity --test mac_crypt_parity --test delta`
- 화면 시험: 앱을 `--test <이름> --report <경로>` 로 띄우면 `src/ui_tests.rs` 의 단계대로 실제 입력을 넣고 결과 JSON 을 쓴다. Windows 묶음 실행기 `tools/ui_tests.ps1` 은 PC 경로(F:\…)를 써서 맥에서는 그대로 못 돈다. 맥에서는 `tools/mac_smoke.sh` 처럼 프로젝트를 만들어 개별로 돌린다.
  예: `SS_USER_DATA_DIR=$(mktemp -d) SS_TEST_YTFAKE=1 dist/SermonShorts.app/Contents/MacOS/SermonShorts --project p.sshorts --test editflow --report r.json`
  (`SS_TEST_YTFAKE=1` 은 실제 유튜브 업로드를 막는다 — **시험에서 반드시**.)
- 시험용 환경 변수: `SS_USER_DATA_DIR`, `SS_RUNTIME_DIR`, `SS_TEST_YES`(예/아니요를 늘 예), `SS_TEST_LLM_ANSWERS`(가짜 AI 답 JSON), `SS_TEST_SAVE_DIR`(저장 창 대신 이 폴더), `SS_NO_UPDATE`, `SS_UPDATE_FEED`·`SS_UPDATE_DEST`·`SS_UPDATE_FORCE`(업데이트 시험), `SS_SHOT2`/`SS_SHOT3`(시험 중 화면 찍기), `SS_BROWSER`(교인 자료 그리기용 Chrome/Edge 경로).
- 푸시하면 GitHub Actions **"Rust Mac"**(`.github/workflows/rust-mac.yml`)이 Apple 칩·Intel 맥에서 빌드·계산 시험·앱 묶음·서명·실행 시험·덩어리 만들기를 하고 결과물을 올린다.

## 5. 맥에서 알아 둘 것 (지금까지 고친 것·남은 것)
- **한글 입력(IME)**: 맥 한글 입력기는 글자를 끝내는 첫 Enter 를 앱에 넘기지 않는다. 그래서 고치는 칸은 Enter 없이 다른 곳을 눌러도 적용되게 했다(`ui_captions.rs`, 시험 `wordblur`). egui-winit 은 맥에서 조합 중 다른 곳을 누르면 아무 사건도 안 보낸다 — 조합 중 글자는 칸 안에 들어 있으므로 떠날 때 적용하면 된다.
- **단축키**: Ctrl 은 맥에서 ⌘(egui `Modifiers::COMMAND`).
- **키체인**: 비밀 값 암호 키는 `/usr/bin/security` 로 키체인 항목 `SermonShorts Safe Storage` 에서 읽는다(`src/secret.rs` 의 `mac_key`, Electron safeStorage 와 같은 방식). 사용자가 "허용"만 누르면 매번 묻고 "항상 허용"을 누르면 다시 안 묻는다.
- **업데이트**: 앱이 `.app` 을 바꿔 끼운다(`updater.rs` 의 `mac_swap_script`, 격리 표시 제거·서명 확인). DMG 안이나 격리 위치(AppTranslocation)에서 실행 중이면 바꾸지 못하고 내려받기 안내만 한다. 0.4.1 다음 판부터 바뀐 부분만 받는다.
- **예/아니요 창**: `style::confirm` (한국어 단추).
- **부드러운 미리보기**: 맥은 `h264_videotoolbox` 로 미리보기용 영상을 만든다(`src/proxy.rs`). 실제 맥에서 속도·품질 확인 안 됨.
- **교인 자료 그리기**: PC 에 있는 Chrome/Edge 를 헤드리스로 빌려 쓴다(`src/matrender.rs`). 맥에는 Chrome 이 있어야 PDF·PNG 가 된다. 음성으로 듣기는 맥 `say` + 한국어 음성(Yuna).
- **화면 크기**: 레티나(배율 2)에서 칸 너비·글자 크기, 창 최소 크기 1280×760, 칸 크기 손잡이(`ui_panes.rs`)를 확인할 것.
- 아직 실제 맥에서 확인 못 한 것: 업데이트 뒤 허락 유지, 키체인 공유, 부드러운 미리보기, 교인 자료 PDF, 음성 싱크 내보내기.

## 6. 코드 지도
- `src/main.rs` 앱 상태·창 배치, `ui_frame.rs` 위쪽 막대·메뉴, `ui_side.rs` 왼쪽(미리보기·디자인 탭), `ui_captions.rs` 자막 칸, `ui_trim.rs`·`ui_trim_words.rs` 세부 조정, `ui_chat.rs` AI 편집 대화, `ui_export.rs` 내보내기·완성 영상 창, `ui_materials.rs` 교인 자료, `ui_settings.rs` 설정, `ui_theme_editor.rs` 테마 편집기, `ui_update.rs` 업데이트 알림, `ui_panes.rs` 칸 크기, `ui_proxy.rs` 부드러운 미리보기, `ui_tests.rs` 화면 시험 단계.
- 라이브러리(`src/lib.rs`): `player.rs` 재생, `export.rs` 내보내기(ffmpeg), `edl.rs` 구간 계산, `template.rs` 화면 그리기, `youtube.rs`·`ytdlp.rs` 유튜브, `stt.rs` 음성 인식, `llm.rs`·`chat.rs` AI, `updater.rs`·`delta.rs` 업데이트, `secret.rs` 비밀 값, `sync.rs` 음성 싱크, `word_trim.rs` 단어별 조정.
- 프로젝트 파일(.sshorts)은 Electron판과 같은 JSON (`project.rs` 가 모르는 항목은 그대로 보존).

## 7. 일하는 규칙
- 커밋: `git -c user.name=hahadark -c user.email="$(git log -1 --format=%ae)" commit …`, 끝난 단위마다 커밋하고 `rust` 가지에 푸시. 푸시 전에 `git pull --rebase origin rust`(PC 에서도 올릴 수 있음).
- **릴리즈는 사용자가 "릴리즈"라고 할 때만.** 순서: `Cargo.toml` 버전 올림 → 커밋·푸시 → 맥 CI 결과물(맥 zip·dmg·덩어리·`-files.json`) 받기 → Windows 묶음은 PC 의 `tools/win_package.ps1`(zip·설치 파일·덩어리) → `SHA256SUMS-rust.txt` 에 모든 파일 → 태그 `rust-vX.Y.Z` 는 커밋이 올라간 뒤에만 → `gh release create … --latest`. 예전 Electron 사용자용 `latest.yml`·`SermonShorts-Setup-0.3.27-x64.exe`·`.blockmap` 도 계속 함께 올린다(예전 판이 새 판 안내를 받도록). **Windows 묶음은 맥에서 못 만들므로 릴리즈는 PC 와 같이 한다.**
- 비밀(구글 클라이언트, 서명 인증서, 로그인 정보)은 출력·커밋 금지. 과금 API·결제 설정은 건드리지 않는다.
- 공개 저장소에 실제 설교 영상·교회 로고·구세군체·구입한 배경음악·실제 설교 자막 시험 자료를 넣지 않는다.
- 사용자에게 수동 시험을 부탁하기보다 자동 시험·화면 찍기로 확인하고 결과와 남은 문제를 보고한다.
