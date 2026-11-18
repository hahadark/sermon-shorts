# Windows 배포 파일 만들기: 압축본(zip) + 설치 프로그램(Setup.exe)
#   powershell -File tools\win_package.ps1 -Dist F:\aside\sermon-shorts-rs-dist [-BinFrom <ffmpeg·yt-dlp 가 든 이전 패키지 폴더>]
# 결과: SermonShorts-Rust-<버전>-win-x64.zip, SermonShorts-Rust-Setup-<버전>-x64.exe
param([string]$Dist = 'F:\aside\sermon-shorts-rs-dist', [string]$BinFrom = '', [string]$MakeNsis = "$env:LOCALAPPDATA\electron-builder\Cache\nsis\nsis-3.0.4.1\makensis.exe")
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$ver = (Select-String Cargo.toml -Pattern '^version = "([^"]+)"').Matches[0].Groups[1].Value
$name = "SermonShorts-Rust-$ver-win-x64"
$pkg = Join-Path $Dist $name
if (-not $BinFrom) { $BinFrom = Get-ChildItem $Dist -Directory | Where-Object { $_.Name -like 'SermonShorts-Rust-*-win-x64' -and $_.Name -ne $name -and (Test-Path (Join-Path $_.FullName 'bin\ffmpeg.exe')) } | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName }
if (-not $BinFrom) { throw 'ffmpeg 가 든 이전 패키지 폴더를 -BinFrom 으로 알려 주세요' }
if (Test-Path $pkg) { Remove-Item $pkg -Recurse -Force }
New-Item -ItemType Directory $pkg | Out-Null
Copy-Item (Join-Path $BinFrom 'bin') (Join-Path $pkg 'bin') -Recurse
Copy-Item (Join-Path $BinFrom 'LICENSE.txt') $pkg
Copy-Item target\release\sermon_shorts.exe (Join-Path $pkg 'SermonShorts.exe')
robocopy assets (Join-Path $pkg 'assets') /E /XF google-client.json /NFL /NDL /NJH /NJS /NP | Out-Null
if (Test-Path (Join-Path $BinFrom 'assets\bin')) { robocopy (Join-Path $BinFrom 'assets\bin') (Join-Path $pkg 'assets\bin') /E /NFL /NDL /NJH /NJS /NP | Out-Null }
if (Test-Path (Join-Path $pkg 'assets\google-client.json')) { throw '비밀 파일이 들어갔습니다' }
$readme = Join-Path $BinFrom '읽어보세요.txt'
(Get-Content $readme -Raw) -replace '\d+\.\d+\.\d+(-beta\.\d+)?', $ver | Set-Content (Join-Path $pkg '읽어보세요.txt') -Encoding utf8
$zip = Join-Path $Dist "$name.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $pkg -DestinationPath $zip -CompressionLevel Optimal
$setup = Join-Path $Dist "SermonShorts-Rust-Setup-$ver-x64.exe"
& $MakeNsis /V2 /INPUTCHARSET UTF8 "/DVERSION=$ver" "/DSRC=$pkg" "/DOUT=$setup" "/DICON=$((Resolve-Path res\app.ico).Path)" installer\sermon_shorts.nsi
if ($LASTEXITCODE -ne 0) { throw '설치 프로그램을 만들지 못했습니다' }
# 바뀐 부분만 받는 업데이트용: 덩어리 ZIP(core·assets·tools)과 파일 목록
cargo build --release --offline --example make_delta | Out-Null
& .\target\release\examples\make_delta.exe $pkg $ver win-x64 $Dist | Out-Null
if ($LASTEXITCODE -ne 0) { throw '덩어리 나누기 실패' }
Get-Item $zip, $setup, (Join-Path $Dist "SermonShorts-Rust-$ver-win-x64-files.json") | ForEach-Object { '{0}  {1:N1} MB' -f $_.Name, ($_.Length / 1MB) }
Get-ChildItem $Dist -Filter "SermonShorts-Rust-$ver-win-x64-*.zip" | ForEach-Object { '{0}  {1:N1} MB' -f $_.Name, ($_.Length / 1MB) }
