# 설치와 실행

일반 사용자는 GitHub 릴리스의 Windows 설치 파일(또는 Mac용 ZIP)과 [캡처 사용 설명서](USER_GUIDE.md)를 사용하세요. PDF는 앱의 **사용 설명서** 버튼 또는 릴리스의 PDF 첨부 파일에서 열 수 있습니다.

## Windows 설치판
1. `SermonShorts-Setup-0.2.0-x64.exe`를 실행합니다. 코드 서명이 없는 베타이므로 릴리스 출처와 SHA256을 확인하세요.
2. 바탕 화면 **설교쇼츠편집기**를 실행합니다. 앱 실행과 영상 편집·출력에는 Node.js를 따로 설치하지 않습니다.
3. 새 음성 인식에는 자막 엔진이 필요합니다. 설치 프로그램 마지막에 **자막 엔진도 지금 설치할까요?**에서 [예]를 누르면 Python 3.12(없을 때, python.org 공식 설치 파일)·엔진·Whisper 모델을 한 번에 설치합니다(약 5~6GB, 10~30분). 건너뛰었다면 앱의 **점검** 창에서 **엔진 설치** → Whisper 모델 **지금 받기**를 누르거나, 설치 폴더의 `Setup-Subtitle-Engine.cmd -InstallPython`을 실행하세요.
4. **점검**에서 엔진을 확인한 뒤 **영상 열기 → 자막 만들기**로 시작합니다.

앱·영상 도구는 설치 폴더, 설정은 `%APPDATA%\SermonShorts`, 엔진·모델·캐시는 `%APPDATA%\SermonShorts\runtime`에 보관합니다. ZIP 압축 해제판도 같은 사용자 폴더를 사용합니다. 원본 영상은 프로젝트 파일에 포함되지 않습니다.

엔진 재설치: 설치 폴더 PowerShell에서 `& '.\Setup-Subtitle-Engine.cmd' -Force`. CPU 강제 설치는 `-Cpu`를 덧붙입니다. 설치 후 앱을 다시 열어 주세요.

## Mac (베타)
1. 내 Mac에 맞는 ZIP을 받습니다. Apple 칩(M1~M4)은 `SermonShorts-x.y.z-mac-arm64.zip`, Intel Mac은 `SermonShorts-x.y.z-mac-intel.zip`.
2. 압축을 풀고 **SermonShorts.app**을 **응용 프로그램** 폴더로 옮깁니다.
3. Apple 공증(notarization)을 받지 않은 앱이라 처음 열 때 "확인되지 않은 개발자" 경고가 나옵니다. **터미널**에서 아래 한 줄을 실행한 뒤 앱을 여세요.
   ```bash
   xattr -cr /Applications/SermonShorts.app
   ```
   또는 한 번 열기를 시도한 뒤 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**를 누릅니다.
4. 상단 **점검** 창에서 **엔진 설치**를 누르면 Python 3.12(관리자 권한 없이 앱 데이터 폴더에 설치)·음성 인식 엔진을 설치합니다. Whisper 모델은 **지금 받기** 또는 첫 자막 생성 때 받습니다.

- Mac은 CPU로 음성 인식을 합니다(medium 모델). Apple 칩에서 30분 설교에 대략 10~30분 걸립니다. 영상 내보내기는 VideoToolbox 하드웨어 인코딩을 먼저 쓰고, 안 되면 libx264로 전환합니다.
- 단축키의 `Ctrl`은 Mac에서 `⌘ Cmd`로도 동작합니다.
- 설정·엔진·캐시는 `~/Library/Application Support/SermonShorts`에 보관합니다.
- Intel Mac은 PyTorch 2.2가 마지막 지원 버전이라 엔진 설치가 실패할 수 있습니다.

## 개발용 소스 실행
```powershell
npm ci
node node_modules\electron\cli.js .
```

소스 폴더용 엔진 설치:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup_engine.ps1
```

소스 실행은 기존과 같이 프로젝트의 `engine/.venv`, `engine/models`, `cache`를 사용합니다. 설치판처럼 사용자 폴더에 설치하려면 `-DataDir "$env:APPDATA\SermonShorts\runtime"`를 지정합니다.

Mac 빌드: `npm run build:mac` (macOS 또는 Linux, Linux에서는 `rcodesign` 필요). 소스 폴더용 Mac 엔진 설치는 `bash scripts/setup_engine.sh --install-python`.

## API와 글꼴
- 기본 편집·로컬 음성 인식에는 Gemini 키가 필요하지 않습니다. AI 추천·교정·연결 확인은 별도 Google API 요금이 발생할 수 있습니다.
- 키는 설정 AI 탭에서 사용자 본인의 키를 등록합니다. 배포본에는 키나 개인 설정을 넣지 않습니다.
- 배포본에 구세군체는 포함하지 않습니다. 권한이 있는 사용자만 별도로 추가하세요. 공개 글꼴 및 영상 도구 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.
