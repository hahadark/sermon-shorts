<div align="center">

# 설교쇼츠편집기 · SermonShorts

**설교 영상을 1분 쇼츠로. 자막을 고치듯 영상을 자릅니다.**

음성 인식 자막을 글처럼 편집하면 영상이 따라 잘리고,<br>
교회 로고·설교자·성경 구절이 들어간 세로 영상(1080×1920)과 SRT 자막이 한 번에 나옵니다.

[**⬇ 내려받기 (Windows · Mac)**](https://github.com/hahadark/sermon-shorts/releases/latest) · [사용 설명서](docs/USER_GUIDE.md) · [설치 안내](docs/INSTALL.md) · [단축키](docs/SHORTCUTS.md)

![설교쇼츠편집기 편집 화면: 왼쪽 쇼츠 미리보기, 오른쪽 자막 블록, 아래 파형](docs/images/01-overview.png)

</div>

## 이런 분께

- 주일 설교 영상을 **유튜브 쇼츠·릴스**로 나누어 올리고 싶은 교회 미디어 담당자
- 영상 편집 프로그램은 어렵지만 **문서 편집은 할 수 있는** 사역자·봉사자
- 자막 오타를 하나하나 타이밍 맞춰 고치느라 시간이 많이 드는 분

## 무엇이 다른가요

| | 일반 영상 편집기 | 설교쇼츠편집기 |
|---|---|---|
| 자르기 | 타임라인에서 구간을 찾아 자름 | **자막에서 문장을 지우면 영상도 잘림** |
| 자막 | 직접 타이핑하고 시간 맞춤 | **음성 인식 자막이 자동으로 붙고**, 틀린 글자만 고침 |
| 디자인 | 매번 제목·로고 배치 | **교회 테마 한 번 저장** 후 계속 사용 |
| 결과 | 영상만 | **MP4 + 수정된 SRT** 함께 |

## 주요 기능

### 원문과 출력 자막을 따로
음성 인식 결과(STT 원문)는 그대로 두고, 실제로 영상에 나갈 **출력 자막**만 고칩니다. 오타를 고쳐도 영상 시간은 바뀌지 않습니다.

![같은 블록 안의 STT 원문과 출력 자막](docs/images/11-caption-detail.png)

### 여러 구간을 체크해서 한 번에 삭제
필요 없는 부분의 체크박스를 고르고 **선택 구간 삭제**. 잘못 지웠다면 `Ctrl+Z` 한 번으로 되돌립니다.

![두 구간을 선택해 한꺼번에 삭제](docs/images/02-bulk-delete.png)

### 14자 자막, Backspace로 행 합치기
한 줄 최대 글자 수(기본 14자)에 맞춰 자막을 나누고, 출력 자막 맨 앞에서 `Backspace`를 누르면 위 줄과 합칩니다.

![수동으로 합친 행](docs/images/03-merge.png)

### 파형을 보며 1ms 단위 정밀 트림
컷 경계가 어색하면 파형에서 앞뒤 손잡이를 끌거나 프레임·10ms·1ms 단위로 옮기고, 이음새를 반복해서 들어 봅니다.

![A 끝과 B 시작을 조절하는 트림 패널](docs/images/04-trim.png)

### 우리 교회 테마
교회 이름·로고·설교자 목록을 저장하고, 제목·성경 구절·영상·자막 위치와 글꼴·색을 테마로 만들어 둡니다. 기본 테마 6종이 들어 있습니다.

![테마 편집기](docs/images/05-theme-editor.png)

### 유튜브 설교에서 바로
생중계·설교 영상 주소를 넣으면 앱 안에서 미리 보고, **필요한 구간만** 고화질로 받아옵니다.

![유튜브 주소 입력](docs/images/08-youtube.png)

### (선택) AI 쇼츠 추천
본인의 Gemini API 키를 넣으면 설교 전체를 분석해 쇼츠로 만들 만한 구간 후보를 추천합니다. 기본 편집과 음성 인식은 키 없이, 인터넷 비용 없이 PC에서 동작합니다.

![AI 추천 조건](docs/images/09-ai-options.png)

## 3분 만에 시작하기

1. **설치** — [Releases](https://github.com/hahadark/sermon-shorts/releases/latest)에서 `SermonShorts-Setup-x.y.z-x64.exe`를 받아 실행합니다. (Mac은 [Mac 설치 안내](docs/INSTALL.md#mac-베타) 참고)
2. **자막 엔진** — 설치 마지막에 *"자막 엔진도 지금 설치할까요?"* → **예**. Python 3.12·음성 인식 엔진·모델을 자동으로 설치합니다(약 5~6GB, 10~30분).
   건너뛰었다면 앱 상단 **점검** 창의 **엔진 설치** 버튼으로 언제든 설치할 수 있습니다.
3. **편집** — **영상 열기** → **자막 만들기** → 필요 없는 구간 삭제 → 출력 자막 오타 수정 → **내보내기**(`Ctrl+E`).

![시스템 점검 창: 필요한 도구 상태와 설치 버튼](docs/images/10-system-check.png)

자세한 사용법은 [사용 설명서](docs/USER_GUIDE.md)(캡처 포함)를 참고하세요.

## 자주 쓰는 키

| 키 | 동작 |
|---|---|
| `Space` | 재생 / 정지 |
| `Backspace` / `Delete` (원문 줄) | 커서 앞/뒤 단어와 그 영상 구간 삭제 |
| `R` | 지운 부분 되살리기 |
| `T` | 가까운 컷 정밀 트림 열기 |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 실행 취소 / 다시 실행 |
| `Ctrl+S` / `Ctrl+O` / `Ctrl+E` | 저장 / 프로젝트 열기 / 내보내기 |
| `F1` | 전체 단축키 도움말 |

## 필요 환경

- **Windows 10/11 64비트**, 여유 공간 10GB 이상 권장
- **macOS (베타)** — Apple 칩(M1 이상) 권장, Intel Mac도 빌드 제공
- NVIDIA GPU가 있으면 음성 인식·출력이 빠릅니다. 없거나 Mac이면 CPU로 동작합니다(느림).
- 설치 파일에 포함: 앱, ffmpeg·ffprobe, yt-dlp, 공개 라이선스 글꼴
- 별도 설치(설치 중 자동): Python 3.12, PyTorch, faster-whisper, Whisper 모델

## 알아 두세요

- **베타 버전**입니다. 코드 서명이 없어 Windows SmartScreen 경고가 나오면 *추가 정보 → 실행*을 누르세요. Mac은 [처음 여는 방법](docs/INSTALL.md#mac-베타)을 참고하세요. 릴리스 페이지의 SHA256으로 파일을 확인할 수 있습니다.
- 프로젝트 파일(`.sshorts`)에는 **원본 영상이 들어가지 않습니다.** 원본을 함께 보관하세요.
- 본인 교회의 영상이나 **사용 허가를 받은 설교**만 사용하세요.
- AI 추천·교정은 Google Gemini API를 사용하며 요금이 발생할 수 있습니다.

## 개발자용

```powershell
npm ci
npm start          # 소스 실행
npm test           # 오프라인 테스트
npm run build:win  # bin/ffmpeg.exe, ffprobe.exe, yt-dlp.exe 준비 후 dist/ 에 설치 파일·ZIP 생성
npm run build:mac  # Mac용 ZIP (arm64·intel), ffmpeg·yt-dlp 자동 다운로드
```

릴리스: `package.json`의 버전을 올리고 같은 이름의 태그(예: `v0.2.1`)를 푸시하면 GitHub Actions가 Windows·Mac에서 빌드해 [Releases](https://github.com/hahadark/sermon-shorts/releases)에 자동으로 올립니다.

[설계](docs/ARCHITECTURE.md) · [편집 규칙](docs/EDITING.md) · [회귀 검증](docs/TESTING.md) · [서드파티 고지](docs/THIRD_PARTY_NOTICES.md)

## 라이선스

Copyright © 2026 hahadark. 앱 코드와 교회 이미지는 별도의 오픈소스 라이선스로 배포되지 않습니다([LICENSE](LICENSE)). ffmpeg, yt-dlp, Electron, 공개 글꼴 등은 각자의 라이선스를 따릅니다([서드파티 고지](docs/THIRD_PARTY_NOTICES.md)).
