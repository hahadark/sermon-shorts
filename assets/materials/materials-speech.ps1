param(
  [Parameter(Mandatory=$true)][ValidateSet('list','synth')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$OutFile,
  [string]$TextFile = '',
  [string]$Voice = '',
  [int]$Rate = 0
)
# plain text만 합성한다 (SSML/XML 해석 없음: Speak(string)). 결과는 파일로 쓴다.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($Mode -eq 'list') {
    $lines = foreach ($v in $s.GetInstalledVoices()) {
      if ($v.Enabled) { $i = $v.VoiceInfo; "$($i.Name)`t$($i.Culture.Name)" }
    }
    [System.IO.File]::WriteAllText($OutFile, (($lines) -join "`n"), (New-Object System.Text.UTF8Encoding($false)))
  } else {
    $text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
    $s.SelectVoice($Voice)
    $s.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
    $s.SetOutputToWaveFile($OutFile)
    $s.Speak($text)
  }
} finally { $s.Dispose() }
