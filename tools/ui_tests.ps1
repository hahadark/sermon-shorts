# Rust 편집기 화면 시험 묶음: 편집 흐름·칸 순서·자동 정리·재생 끊김
param([string[]]$Only = @())
Set-Location $PSScriptRoot\..
$tmp = Join-Path $PSScriptRoot '..\target\uitests'; New-Item -ItemType Directory -Force $tmp | Out-Null
$env:SS_TEST_MUTE = '1'
$env:SS_TEST_YTFAKE = '1'   # 업로드는 언제나 가짜로 (실제 채널에 올리지 않음)
$cases = @(@('editflow','electron_order'), @('reorder','electron_project'), @('tidyflow','electron_project'), @('splitflow','electron_project'), @('trimflow','electron_project'), @('skipgap',''), @('exportflow','electron_project'), @('ytimport','-'), @('recoverflow','-'), @('autosaveflow','electron_project'), @('prefsflow','-'), @('voiceflow','electron_project'), @('bgmflow','electron_project'), @('bgmmgr','-'), @('clickflow','electron_project'), @('followflow','electron_project'), @('waveflow','electron_project'), @('backdropflow','electron_project'), @('menuflow','electron_project'), @('aiflow','electron_project'), @('sysflow','-'), @('chatflow','electron_project'), @('recflow','-'), @('updflow','-'), @('themeflow','-'), @('peflow','electron_project'))
foreach ($tc in $cases) {
  if ($Only.Count -and -not ($Only -contains $tc[0])) { continue }
  $rep = Join-Path $tmp "$($tc[0]).json"; Remove-Item $rep -ErrorAction SilentlyContinue
  if ($tc[1] -eq '-') { $a = @() }
  elseif ($tc[1]) { Copy-Item "tests\fixtures\$($tc[1]).sshorts" "target\t_$($tc[0]).sshorts" -Force; $a = @('--project', (Resolve-Path "target\t_$($tc[0]).sshorts").Path) }
  else { $a = @('--open', 'F:\aside\sermon-shorts-app\cache\yt\uSE5pZB3gtQ\part_4955_5100.mp4', '--transcript', 'F:\aside\sermon-shorts-app\cache\theme_check\words_4955.json') }
  if ($tc[0] -in @('autosaveflow','prefsflow')) { $ud = Join-Path $tmp 'ud_asv'; Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $ud | Out-Null; $env:SS_USER_DATA_DIR = $ud } else { Remove-Item Env:SS_USER_DATA_DIR -ErrorAction SilentlyContinue }
  # AI 연결: 진짜 설정·로그인 파일·잠금 키를 임시 폴더로 복사해서 (사용자 설정은 건드리지 않음). 돈 드는 호출 없음
  if ($tc[0] -eq 'aiflow') { $ud = Join-Path $tmp 'ud_ai'; Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory "$ud\llm" -Force | Out-Null; $real = Join-Path $env:APPDATA 'SermonShorts'; Copy-Item "$real\settings.json", "$real\Local State" $ud; if (Test-Path "$real\llm\chatgpt.json") { Copy-Item "$real\llm\chatgpt.json" "$ud\llm\" }; $env:SS_USER_DATA_DIR = $ud }
  # 시스템 점검: 빈 런타임 폴더 + 실제 설치 스크립트를 -DryRun 으로 감싼 것 (아무것도 설치하지 않음)
  if ($tc[0] -eq 'sysflow') { $rt = Join-Path $tmp 'rt_sys'; Remove-Item $rt -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $rt | Out-Null; $env:SS_RUNTIME_DIR = $rt; $env:SS_SETUP_SCRIPT = (Resolve-Path 'tools\fake_setup_dryrun.ps1').Path; $env:SS_TEST_YES = '1' } else { Remove-Item Env:SS_RUNTIME_DIR, Env:SS_SETUP_SCRIPT -ErrorAction SilentlyContinue }
  # AI 편집 대화: 임시 사용자 폴더(AI 이름만 정함) + 가짜 AI 답 (돈 드는 호출 없음)
  if ($tc[0] -eq 'chatflow') { $ud = Join-Path $tmp 'ud_chat'; Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $ud | Out-Null; Set-Content (Join-Path $ud 'settings.json') '{"aiProvider":"gemini"}' -Encoding utf8; $env:SS_USER_DATA_DIR = $ud; $env:SS_TEST_LLM_ANSWERS = (Resolve-Path 'tests\fixtures\chat_answers.json').Path; Get-ChildItem (Join-Path ([IO.Path]::GetTempPath()) 'ss_llm_sent*') -ErrorAction SilentlyContinue | Remove-Item; $env:SS_TEST_YES = '1' } else { Remove-Item Env:SS_TEST_LLM_ANSWERS -ErrorAction SilentlyContinue }
  # AI 쇼츠 추천: 임시 사용자 폴더 + 실제 런타임(받아 둔 영상·자막) + 가짜 제미나이 답
  if ($tc[0] -eq 'recflow') { $ud = Join-Path $tmp 'ud_rec'; Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $ud | Out-Null; $env:SS_USER_DATA_DIR = $ud; $env:SS_RUNTIME_DIR = Join-Path $env:APPDATA 'SermonShorts\runtime'; $env:SS_TEST_GEMINI_ANSWERS = (Resolve-Path 'tests\fixtures\gemini_answers.json').Path; Get-ChildItem (Join-Path ([IO.Path]::GetTempPath()) 'ss_gemini_sent*') -ErrorAction SilentlyContinue | Remove-Item } else { Remove-Item Env:SS_TEST_GEMINI_ANSWERS -ErrorAction SilentlyContinue; if ($tc[0] -ne 'sysflow') { Remove-Item Env:SS_RUNTIME_DIR -ErrorAction SilentlyContinue } }
  # 자동 업데이트: 로컬 가짜 릴리스(9.9.9)와 가짜 설치 폴더. 앱이 닫힌 뒤 바꿔 끼웠는지 아래에서 확인
  if ($tc[0] -eq 'updflow') { powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'update_e2e.ps1') -PrepareOnly | Out-Null; $ur = Join-Path $env:TEMP 'ss_upd'; $env:SS_UPDATE_FORCE = '1'; $env:SS_UPDATE_FEED = "$ur\feed.json"; $env:SS_UPDATE_DEST = "$ur\install"; $env:SS_USER_DATA_DIR = "$ur\ud" } else { Remove-Item Env:SS_UPDATE_FORCE, Env:SS_UPDATE_FEED, Env:SS_UPDATE_DEST -ErrorAction SilentlyContinue }
  # 테마 편집기: 임시 사용자 폴더 (사용자 테마·설정을 건드리지 않음)
  if ($tc[0] -eq 'themeflow') { $ud = Join-Path $tmp 'ud_theme'; Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $ud | Out-Null; $env:SS_USER_DATA_DIR = $ud; $env:SS_TEST_YES = '1' }
  if ($tc[0] -eq 'bgmmgr') { $lib = Join-Path $tmp 'bgmlib'; Remove-Item $lib -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $lib | Out-Null; $env:SS_BGM_LIBRARY = $lib } else { Remove-Item Env:SS_BGM_LIBRARY -ErrorAction SilentlyContinue }
  $p = Start-Process target\release\sermon_shorts.exe -ArgumentList ($a + @('--test', $tc[0], '--report', $rep)) -PassThru
  if (-not $p.WaitForExit(300000)) { $p | Stop-Process -Force; "$($tc[0]): 시간 초과"; continue }
  $j = Get-Content $rep -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  if ($tc[0] -eq 'skipgap') { "skipgap: fps $($j.fps) 보통 $([math]::Round($j.frameGapMs.median))ms p95 $([math]::Round($j.frameGapMs.p95))ms 최대 $([math]::Round($j.frameGapMs.max))ms 소리끊김 $($j.underruns)" }
  elseif ($tc[0] -eq 'tidyflow') { "tidyflow: pass=$($j.pass) 길이 $([math]::Round($j.durBefore,2))→$([math]::Round($j.durAfter,2))초 공백컷 $($j.gapCuts) 군말 $($j.fillers) 구간 $($j.segsBefore)→ 되돌리기 $($j.undo) ($([math]::Round($j.secs,1))초)" }
  elseif ($tc[0] -eq 'updflow') { $ur = Join-Path $env:TEMP 'ss_upd'; for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; if (Test-Path "$ur\ud\rust-update\last-swap") { break } }; $sw = (Get-Content "$ur\ud\rust-update\last-swap" -ErrorAction SilentlyContinue) -join ''; "updflow: pass=$($j.pass -and $sw -eq '1' -and (Test-Path "$ur\install\NEW.txt")) (알림 $($j.status), 닫은 뒤 바꿔 끼우기 ok=$sw)" }
  else { "$($tc[0]): pass=$($j.pass)" }
}
