# 바뀐 부분만 받는 업데이트 끝까지 시험: 설치 폴더 = 0.4.1 묶음, 새 릴리스 9.9.9 = 같은 묶음 + 새 실행 파일 + 새 assets 파일 (tools 는 그대로)
# 기대: core·assets 덩어리만 받고(tools 안 받음), 바꿔 끼운 뒤 모든 파일이 새 묶음과 같고, 설치 폴더의 다른 파일은 남는다
param([string]$Base = 'F:\aside\sermon-shorts-rs-dist\SermonShorts-Rust-0.4.1-win-x64')
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$root = Join-Path $env:TEMP 'ss_upd_delta'; Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $root | Out-Null
$inst = "$root\install"; robocopy $Base $inst /E /NFL /NDL /NJH /NJS /NP | Out-Null
Set-Content "$inst\사용자파일.txt" '설치 폴더의 다른 파일은 그대로 남아야 함'
$pkg = "$root\pkg\SermonShorts-Rust-9.9.9-win-x64"; robocopy $Base $pkg /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Resolve-Path 'target\release\sermon_shorts.exe') "$pkg\SermonShorts.exe" -Force
Set-Content "$pkg\assets\new_asset.txt" 'asset'
$rel = "$root\rel"; & .\target\release\examples\make_delta.exe $pkg 9.9.9 win-x64 $rel | Out-Null
# 전체 ZIP 은 받지 않아야 하므로 작은 가짜 파일 (크기는 진짜처럼 알린다)
$zip = "$rel\SermonShorts-Rust-9.9.9-win-x64.zip"; Set-Content $zip 'not-used'
$names = Get-ChildItem $rel -File | % Name
$sums = Get-ChildItem $rel -File | % { "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name }
[IO.File]::WriteAllText("$rel\SHA256SUMS-rust.txt", ($sums -join "`n") + "`n")
$assets = @(Get-ChildItem $rel -File | % { @{ name = $_.Name; browser_download_url = $_.FullName; size = $(if ($_.Name -like '*-win-x64.zip') { 238000000 } else { $_.Length }) } })
$feed = @(@{ tag_name = 'rust-v9.9.9'; prerelease = $false; draft = $false; html_url = 'https://example/r'; assets = $assets })
ConvertTo-Json -InputObject $feed -Depth 5 | Set-Content "$root\feed.json" -Encoding utf8
$env:SS_UPDATE_FEED = "$root\feed.json"; $env:SS_UPDATE_DEST = $inst; $env:SS_USER_DATA_DIR = "$root\ud"; $env:SS_UPDATE_FORCE = '1'
$sw = [Diagnostics.Stopwatch]::StartNew()
& .\target\release\examples\update_e2e.exe
$log = "$root\ud\rust-update\swap.log"
for ($i = 0; $i -lt 120; $i++) { Start-Sleep -Milliseconds 500; if ((Test-Path $log) -and (Select-String -Path $log -Pattern '결과 ok=' -Quiet)) { break } }
"걸린 시간: $([math]::Round($sw.Elapsed.TotalSeconds,1))초"
$d = Get-Content "$root\ud\rust-update\9.9.9\delta.json" -Raw -ErrorAction SilentlyContinue; "delta: $d"
$err = Get-Content "$root\ud\rust-update\9.9.9\delta-error.txt" -Raw -ErrorAction SilentlyContinue; if ($err) { "delta 오류: $err" }
# 비교: 새 묶음의 모든 파일이 설치 폴더에 같은 해시로
$bad = 0; $n = 0
Get-ChildItem $pkg -Recurse -File | % { $n++; $r = $_.FullName.Substring($pkg.Length + 1); $t = Join-Path $inst $r; if (-not (Test-Path $t) -or (Get-FileHash $t).Hash -ne (Get-FileHash $_.FullName).Hash) { $bad++; if ($bad -le 5) { "다름: $r" } } }
"파일 $n 개 중 다름 $bad · 사용자파일: $(Test-Path "$inst\사용자파일.txt") · 남은 백업: $((Get-ChildItem $inst -Force -Filter '.ss-old-*').Count) · last-swap: $(Get-Content "$root\ud\rust-update\last-swap" -ErrorAction SilentlyContinue)"
