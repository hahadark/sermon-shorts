# Third-party software in the Windows beta

## 배경음악 (앱에 포함하지 않음)

배경음악 추천 목록(`src/shared/bgm-catalog.js`)에는 곡 이름·출처·라이선스와 원래 주소만 들어 있고 음악 파일은 설치 파일에 없습니다. 사용자가 들을 때 원래 사이트에서 스트리밍하고, 곡을 고르면 그 곡만 사용자 캐시에 받아 미리보기와 내보내기에 씁니다. `src/shared/bgm-peaks.js` 에는 파형을 그리기 위한 곡별 크기 값(1000칸, 0~255)과 길이만 들어 있고 소리는 들어 있지 않습니다.

- Kevin MacLeod (incompetech.com) — Creative Commons Attribution 4.0. 영상 설명에 곡별 출처 문구를 적어야 합니다.
- United States Air Force Band / U.S. Marine Band 녹음 (Wikimedia Commons) — 미국 연방 정부 저작물, 퍼블릭 도메인.
- "Clair de lune" (Debussy), 연주 Laurens Goedhart (Wikimedia Commons) — Creative Commons Attribution 3.0.


The application code is not granted an open-source license by this document. The repository is public for viewing only.

- **Electron**: MIT. The distribution includes Electron's LICENSE and Chromium third-party notices. Source: https://github.com/electron/electron
- **FFmpeg / ffprobe**: 8.1.2 full build from https://www.gyan.dev/ffmpeg/builds/ . The included binaries report GPL version 3 or later; see FFMPEG-GPLv3.txt and run `ffmpeg -version` / `ffmpeg -L` for the build configuration and licensing details. Unmodified upstream project source: https://ffmpeg.org/download.html and https://git.ffmpeg.org/ffmpeg.git . The binary vendor's build/source references are at https://www.gyan.dev/ffmpeg/builds/ . Preserve the notices and obtain the exact corresponding sources/build material from the vendor before redistributing these binaries publicly.
- **yt-dlp**: 2026.10.21 standalone Windows executable, including dependencies under their respective terms. Project license: YTDLP-LICENSE.txt. Source and detailed dependency/license information: https://github.com/yt-dlp/yt-dlp . Check the upstream release and THIRD_PARTY_LICENSES for the bundled Windows dependencies before onward redistribution.
- **macOS 빌드의 FFmpeg / ffprobe**: ffmpeg-static b6.1.1 정적 빌드(https://github.com/eugeneware/ffmpeg-static), GPL. 원본 소스: https://ffmpeg.org/download.html
- **macOS 빌드의 yt-dlp**: `yt-dlp_macos` 공식 릴리스 실행 파일. https://github.com/yt-dlp/yt-dlp
- **macOS 엔진의 Python**: python-build-standalone 3.12 (https://github.com/astral-sh/python-build-standalone), 앱에 포함하지 않고 엔진 설치 때 사용자 폴더로 내려받음. PSF License 등 해당 라이선스.
- **Open fonts**: Noto Sans KR, Yeon Sung, Black Han Sans, Do Hyeon, Nanum Gothic and Nanum Pen Script, under SIL Open Font License 1.1. The full license files are included in assets/fonts/OFL-*.txt.
- **Church-specific fonts and artwork** are not included. Users with their own license may add a font with the theme editor and set their own logo in the church settings.
- **Python, PyTorch, faster-whisper, transformers and downloaded models**: not bundled. They are installed/downloaded separately into the user's profile and retain their upstream licenses.

The beta installer is unsigned. This notice is not a claim that all third-party components share the application's license or that public redistribution has been cleared.

## 설교 PPT 만들기

- **PptxGenJS** 4.0.1 - MIT License, Copyright (c) 2015-present Brent Ely. https://github.com/gitbrent/PptxGenJS
- **JSZip** 3.10 (PptxGenJS 가 씀) - MIT License 로 사용 (MIT OR GPL-3.0-or-later 중 MIT 선택). https://github.com/Stuk/jszip
- **image-size** (PptxGenJS 가 씀) - MIT License. https://github.com/image-size/image-size

## 화면 디자인

- **Lucide 아이콘** (`assets/icons/*.svg`, `src/renderer/icons.css` 로 변환) - ISC License, Copyright (c) Lucide Icons and Contributors. 전문: `assets/icons/LICENSE-lucide.txt`. https://lucide.dev
- **Pretendard** (`assets/fonts/PretendardVariable.woff2`) - 화면 글꼴. SIL Open Font License 1.1, Copyright (c) 2021 Kil Hyung-jin. 전문: `assets/fonts/OFL-Pretendard.txt`. https://github.com/orioncactus/pretendard
