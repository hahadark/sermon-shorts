# 자동 업데이트 끝까지 시험: 가짜 설치 폴더(베타 2) ← 가짜 새 릴리스(9.9.9, 로컬 파일). 성공과 실패(파일 잠김 → 되돌리기) 둘 다
param([switch]$Fail, [switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP 'ss_upd'; Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $root | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
# 1) 설치 폴더 = 베타 2 묶음
[IO.Compression.ZipFile]::ExtractToDirectory('F:\aside\sermon-shorts-rs-dist\SermonShorts-Rust-0.4.0-beta.2-win-x64.zip', "$root\x")
$inst = "$root\install"; Move-Item "$root\x\SermonShorts-Rust-0.4.0-beta.2-win-x64" $inst
Set-Content "$inst\사용자파일.txt" '설치 폴더의 다른 파일은 그대로 남아야 함'
$oldHash = (Get-FileHash "$inst\SermonShorts.exe").Hash
# 2) 새 릴리스 묶음
$pkg = "$root\pkg\SermonShorts-Rust-9.9.9-win-x64"; New-Item -ItemType Directory "$pkg\assets" -Force | Out-Null
Copy-Item (Resolve-Path 'target\release\sermon_shorts.exe') "$pkg\SermonShorts.exe"
Set-Content "$pkg\NEW.txt" 'new'; Set-Content "$pkg\assets\new_asset.txt" 'asset'
$zip = "$root\SermonShorts-Rust-9.9.9-win-x64.zip"
[IO.Compression.ZipFile]::CreateFromDirectory("$root\pkg", $zip)
$h = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
Set-Content "$root\SHA256SUMS-rust.txt" "$h  SermonShorts-Rust-9.9.9-win-x64.zip"
$feed = @(@{ tag_name = 'rust-v9.9.9'; prerelease = $false; draft = $false; html_url = 'https://example/r'; assets = @(@{ name = 'SermonShorts-Rust-9.9.9-win-x64.zip'; browser_download_url = $zip; size = (Get-Item $zip).Length }, @{ name = 'SHA256SUMS-rust.txt'; browser_download_url = "$root\SHA256SUMS-rust.txt"; size = 1 }) })
ConvertTo-Json -InputObject $feed -Depth 5 | Set-Content "$root\feed.json" -Encoding utf8
$newHash = (Get-FileHash "$pkg\SermonShorts.exe").Hash
# 3) 실패 시험: 설치 폴더의 assets 안 파일을 잠가 폴더를 옮기지 못하게 한다
$lock = $null
if ($Fail) { $lock = [IO.File]::Open("$inst\assets\bgm\catalog.json", 'Open', 'Read', 'None') }
if ($PrepareOnly) { exit 0 }
$env:SS_UPDATE_FEED = "$root\feed.json"; $env:SS_UPDATE_DEST = $inst; $env:SS_USER_DATA_DIR = "$root\ud"; $env:SS_UPDATE_FORCE = '1'
& .\target\release\examples\update_e2e.exe
# 4) 스크립트가 끝나기를 기다린다
$log = "$root\ud\rust-update\swap.log"
for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Milliseconds 500; if ((Test-Path $log) -and (Select-String -Path $log -Pattern '결과 ok=' -Quiet)) { break } }
if ($lock) { $lock.Close() }
Get-Content $log -Encoding utf8
$exeHash = (Get-FileHash "$inst\SermonShorts.exe").Hash
"exe: $(if ($exeHash -eq $newHash) { '새 것' } elseif ($exeHash -eq $oldHash) { '예전 것' } else { '?' }) · NEW.txt: $(Test-Path "$inst\NEW.txt") · new_asset: $(Test-Path "$inst\assets\new_asset.txt") · 예전 assets/bgm: $(Test-Path "$inst\assets\bgm\catalog.json") · 사용자파일: $(Test-Path "$inst\사용자파일.txt") · 남은 백업: $((Get-ChildItem $inst -Force -Filter '.ss-old-*').Count) · last-swap: $(Get-Content "$root\ud\rust-update\last-swap" -ErrorAction SilentlyContinue)"