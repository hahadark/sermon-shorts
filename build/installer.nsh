; 설치 마지막 단계: 자막 엔진(Python 3.12 + PyTorch + Whisper 모델)을 함께 설치할지 묻는다.
; 조용한 설치(/S)에서는 건너뛴다. 이미 엔진이 있으면 묻지 않는다.
!macro customInstall
  IfFileExists "$APPDATA\SermonShorts\runtime\engine\.venv\Scripts\python.exe" ss_engine_done 0
  MessageBox MB_YESNO|MB_ICONQUESTION "자막 엔진도 지금 설치할까요?$\r$\n$\r$\n새 영상의 음성 인식(자막 만들기)에 필요합니다.$\r$\nPython 3.12(없으면 python.org에서 설치), PyTorch, 음성 인식 라이브러리와 Whisper 모델을 내려받습니다.$\r$\n$\r$\n· 약 5~6GB, 인터넷 속도에 따라 10~30분$\r$\n· 진행 상황은 검은 창에 표시되며, 끝나면 아무 키나 누르세요$\r$\n$\r$\n[아니요]를 눌러도 나중에 앱의 [점검] 창에서 설치할 수 있습니다." /SD IDNO IDNO ss_engine_done
    DetailPrint "자막 엔진 설치 중... (검은 창을 닫지 마세요)"
    ExecWait '"$SYSDIR\cmd.exe" /c ""$INSTDIR\Setup-Subtitle-Engine.cmd" -InstallPython -DownloadModel"'
  ss_engine_done:
!macroend
