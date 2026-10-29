; 설치 마지막 단계: 자막 엔진(Python 3.12 + PyTorch + Whisper 모델)을 함께 설치할지 묻는다.
; 조용한 설치(/S)에서는 건너뛴다. 이미 엔진이 있으면 묻지 않는다.
!macro customInstall
  ; 예전 한글 이름 바로가기 정리 (프로그램 이름을 SermonShorts 로 바꿈)
  Delete "$DESKTOP\설교쇼츠편집기.lnk"
  Delete "$SMPROGRAMS\설교쇼츠편집기.lnk"
  IfFileExists "$APPDATA\SermonShorts\runtime\engine\.venv\Scripts\python.exe" ss_engine_done 0
  MessageBox MB_YESNO|MB_ICONQUESTION "자막 엔진도 지금 설치할까요? (선택)$\r$\n$\r$\n유튜브 주소를 넣고 AI 와 대화로 만드는 방식에는 필요 없습니다. 모르시면 [아니요]를 누르세요.$\r$\n컴퓨터에 있는 영상 파일에 자막을 새로 만들 때만 필요합니다.$\r$\nPython 3.12(없으면 python.org에서 설치), PyTorch, 음성 인식 라이브러리와 Whisper 모델을 내려받습니다.$\r$\n$\r$\n· 약 5~6GB, 인터넷 속도에 따라 10~30분$\r$\n· 진행 상황은 검은 창에 표시되며, 끝나면 아무 키나 누르세요$\r$\n$\r$\n[아니요]를 눌러도 나중에 앱의 [점검] 창에서 설치할 수 있습니다." /SD IDNO IDNO ss_engine_done
    DetailPrint "자막 엔진 설치 중... (검은 창을 닫지 마세요)"
    ExecWait '"$SYSDIR\cmd.exe" /c ""$INSTDIR\Setup-Subtitle-Engine.cmd" -InstallPython -DownloadModel"'
  ss_engine_done:
!macroend
