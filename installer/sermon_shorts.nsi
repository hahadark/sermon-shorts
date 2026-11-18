; 설교 쇼츠 편집기 Rust판 Windows 설치 프로그램 (기존 Electron 판 NSIS 설치와 같은 흐름)
; - 사용자 계정에 설치(관리자 권한 없음), 설치 위치 바꾸기, 바탕 화면·시작 메뉴 바로가기, 설치 뒤 실행
; - 마지막에 자막 엔진(선택) 설치를 묻는다 (이미 있거나 조용한 설치 /S 면 묻지 않음)
; - 제거는 이 프로그램이 넣은 파일만 지운다 (사용자 자료 %APPDATA%\SermonShorts 는 그대로)
; makensis /DVERSION=0.4.1 /DSRC=<풀어 둔 폴더> /DOUT=<설치 파일> sermon_shorts.nsi
Unicode true
SetCompressor /SOLID lzma

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APPNAME "SermonShorts"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SermonShortsRust"

Name "설교 쇼츠 편집기 ${VERSION}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\SermonShortsRust"
InstallDirRegKey HKCU "${UNKEY}" "InstallLocation"
RequestExecutionLevel user
BrandingText "SermonShorts ${VERSION}"
Icon "${ICON}"
UninstallIcon "${ICON}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "SermonShorts"
VIAddVersionKey "FileDescription" "설교 쇼츠 편집기 설치"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "hahadark"
VIAddVersionKey "LegalCopyright" "hahadark"

!include "MUI2.nsh"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\SermonShorts.exe"
!define MUI_FINISHPAGE_RUN_TEXT "설교 쇼츠 편집기 실행"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

Section "설치"
  SetOutPath "$INSTDIR"
  ; 실행 중이면 닫아 달라고 한다 (파일을 바꿀 수 없으므로)
  retry:
  ClearErrors
  IfFileExists "$INSTDIR\SermonShorts.exe" 0 +4
    FileOpen $0 "$INSTDIR\SermonShorts.exe" a
    IfErrors 0 +2
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "설교 쇼츠 편집기가 실행 중입니다. 프로그램을 닫은 뒤 [다시 시도]를 눌러 주세요." /SD IDCANCEL IDRETRY retry IDCANCEL abort
    FileClose $0
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall SermonShorts.exe"
  !ifndef NOSYSTEM
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\SermonShorts.exe" "" "$INSTDIR\SermonShorts.exe" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\SermonShorts.exe" "" "$INSTDIR\SermonShorts.exe" 0
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "설교 쇼츠 편집기 (SermonShorts)"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "hahadark"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\SermonShorts.exe"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall SermonShorts.exe"'
  WriteRegStr HKCU "${UNKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall SermonShorts.exe" /S'
  WriteRegStr HKCU "${UNKEY}" "URLInfoAbout" "https://github.com/hahadark/sermon-shorts"
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  !endif
  ; 자막 엔진 (선택)
  IfFileExists "$APPDATA\SermonShorts\runtime\engine\.venv\Scripts\python.exe" engine_done 0
  MessageBox MB_YESNO|MB_ICONQUESTION "자막 엔진도 지금 설치할까요? (선택)$\r$\n$\r$\n유튜브 주소를 넣고 AI 와 대화로 만드는 방식에는 필요 없습니다. 모르시면 [아니요]를 누르세요.$\r$\n컴퓨터에 있는 영상 파일에 자막을 새로 만들 때만 필요합니다.$\r$\nPython 3.12(없으면 python.org에서 설치), PyTorch, 음성 인식 라이브러리와 Whisper 모델을 내려받습니다.$\r$\n$\r$\n· 약 5~6GB, 인터넷 속도에 따라 10~30분$\r$\n· 진행 상황은 검은 창에 표시되며, 끝나면 아무 키나 누르세요$\r$\n$\r$\n[아니요]를 눌러도 나중에 프로그램의 [도움말 → 시스템 점검]에서 설치할 수 있습니다." /SD IDNO IDNO engine_done
    DetailPrint "자막 엔진 설치 중... (검은 창을 닫지 마세요)"
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& $\'$INSTDIR\assets\engine\setup_engine.ps1$\' -DataDir $\'$APPDATA\SermonShorts\runtime$\' -InstallPython -DownloadModel -Human; Write-Host; Write-Host 끝났습니다. 아무 키나 누르면 닫힙니다.; [void][Console]::ReadKey($$true)"'
  engine_done:
  Return
  abort:
  Abort "설치를 그만두었습니다."
SectionEnd

Section "Uninstall"
  !ifndef NOSYSTEM
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  DeleteRegKey HKCU "${UNKEY}"
  !endif
  Delete "$INSTDIR\SermonShorts.exe"
  Delete "$INSTDIR\읽어보세요.txt"
  Delete "$INSTDIR\LICENSE.txt"
  RMDir /r "$INSTDIR\assets"
  RMDir /r "$INSTDIR\bin"
  Delete "$INSTDIR\Uninstall SermonShorts.exe"
  RMDir "$INSTDIR"
SectionEnd
