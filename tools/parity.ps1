# Electron 'themes' 시험 결과(기준)와 Rust 내보내기를 비교한다: SRT, 길이, 그림(글자·제목·꼬리말)
param([string]$Only = '')
Set-Location $PSScriptRoot\..
$env:SS_USER_DATA_DIR = 'F:\aside\sermon-shorts-app\cache\reg_themes\ud'
$out = 'target\parity'
$ids = 'basic-blank','black-headline','bold-title-color','card-badge','channel-header-blur','dark-band-handwriting','full-bleed-caption','meditation-card','pill-karaoke','question-handwriting','wide-karaoke'
if ($Only) { $ids = $Only.Split(',') }
Remove-Item -Recurse -Force $out, 'target\parity_diff' -ErrorAction SilentlyContinue
& .\target\release\examples\parity.exe 'F:\aside\sermon-shorts-app\cache\yt\uSE5pZB3gtQ\part_4955_5100.mp4' 'F:\aside\sermon-shorts-app\cache\theme_check\words_4955.json' $out ($ids -join ',') | Out-Null
$st = [datetime]'2026-11-12T16:12:40'; $en = [datetime]'2026-11-12T16:14:10'
$all = 'basic-blank','black-headline','bold-title-color','card-badge','channel-header-blur','dark-band-handwriting','full-bleed-caption','meditation-card','pill-karaoke','question-handwriting','wide-karaoke'
$edirs = Get-ChildItem F:\aside\sermon-shorts-app\cache -Directory -Filter 'export_*' | ? { $_.CreationTime -ge $st -and $_.CreationTime -le $en } | Sort-Object CreationTime
$ffprobe = Join-Path (Split-Path (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source -ErrorAction SilentlyContinue) 'ffprobe.exe'
if (-not (Test-Path $ffprobe)) { $ffprobe = 'ffprobe' }
$tot = 0; $n = 0
foreach ($id in $ids) {
  $edir = $edirs[[array]::IndexOf($all, $id)].FullName
  $srt = if ((Get-Content "F:\aside\sermon-shorts-app\cache\theme_check\export_$id.srt" -Raw) -eq (Get-Content "$out\export_$id.srt" -Raw)) { 'SRT같음' } else { 'SRT다름' }
  $de = & $ffprobe -v error -show_entries format=duration -of csv=p=0 "F:\aside\sermon-shorts-app\cache\theme_check\export_$id.mp4"
  $dr = & $ffprobe -v error -show_entries format=duration -of csv=p=0 "$out\export_$id.mp4"
  $j = & .\target\release\examples\imgdiff.exe $edir "$out\$id" "target\parity_diff\$id" | ConvertFrom-Json
  $ok = $j | ? { -not $_.missing -and $_.mean -ne $null }
  $worst = $ok | Sort-Object pctAbove64 -Descending | Select-Object -First 3 | % { "$($_.name):$($_.mean)/$($_.pctAbove64)%" }
  $ok | % { $tot += $_.pctAbove64; $n++ }
  "{0,-22} {1} 길이 {2}/{3} | {4}" -f $id, $srt, $de, $dr, ($worst -join ' ')
}
"평균 큰차이 픽셀 {0:N3}% (그림 {1}장)" -f ($tot / [math]::Max(1, $n)), $n
