# SermonShorts 자막 엔진 설치: engine\.venv (Python 3.12) + torch + faster-whisper 등
# 사용:  powershell -ExecutionPolicy Bypass -File scripts\setup_engine.ps1 [-DryRun] [-Cpu] [-Force]
#   -DryRun : 실제로 설치하지 않고 할 일만 보여줌
#   -Cpu    : NVIDIA GPU가 있어도 CPU용 torch 설치
#   -Force  : 기존 engine\.venv 를 지우고 새로 만듦
#   -InstallPython : Python 3.12가 없으면 python.org 공식 설치 파일로 현재 사용자에게 설치
#   -DownloadModel : 설치 후 Whisper 모델까지 미리 받음 (GPU large-v3 약 3GB, CPU medium 약 1.5GB)
#   -Human  : JSON 대신 사람이 읽는 문장으로 출력 (Setup-Subtitle-Engine.cmd, 설치 프로그램용)
# 출력: 한 줄에 하나씩 JSON  {"type":"progress|info|warn|plan|error|done", ...}
param(
    [string]$DataDir,
    [switch]$DryRun,
    [switch]$Cpu,
    [switch]$Force,
    [switch]$InstallPython,
    [switch]$DownloadModel,
    [switch]$Human
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Emit([string]$type, [hashtable]$data) {
    if ($Human) {
        switch ($type) {
            'progress' { Write-Output ("[{0,3}%] {1}" -f $data.pct, $data.message) }
            'warn'     { Write-Output ("주의: " + $data.message) }
            'error'    { Write-Output ("오류: " + $data.message) }
            'done'     { Write-Output ("완료: " + $data.message) }
            'plan'     { Write-Output ("  " + $data.step + ". " + $data.command) }
            default    { foreach ($k in $data.Keys) { if ($k -in 'python', 'gpu', 'venv') { Write-Output ("  {0}: {1}" -f $k, $data[$k]) } } }
        }
        return
    }
    $o = [ordered]@{ type = $type }
    foreach ($k in $data.Keys) { $o[$k] = $data[$k] }
    Write-Output ($o | ConvertTo-Json -Compress)
}
function Step([int]$pct, [string]$msg) { Emit 'progress' @{ pct = $pct; message = $msg } }
function Fail([string]$msg) { Emit 'error' @{ message = $msg }; exit 1 }

# 다른 Python 환경 변수(Aside, Conda 등)가 섞이면 venv가 엉뚱한 곳에 설치된다
foreach ($v in 'PYTHONHOME', 'PYTHONPATH', 'PIP_PREFIX', 'PIP_TARGET', 'PIP_USER', 'VIRTUAL_ENV') {
    Remove-Item "Env:$v" -ErrorAction SilentlyContinue
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataRoot = if ($DataDir) { [System.IO.Path]::GetFullPath($DataDir) } else { $root }
$engineDir = Join-Path $dataRoot 'engine'
$venvDir = Join-Path $engineDir '.venv'
$venvPy = Join-Path $venvDir 'Scripts\python.exe'
Emit 'info' @{ root = $root; venv = $venvDir; dryRun = [bool]$DryRun }

# 1. Python 3.12 찾기 (없고 -InstallPython 이면 설치)
$PythonVersion = '3.12.10'
$PythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe"
function Find-Python {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        $out = & $py.Source -3.12 -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) { return ($out | Select-Object -Last 1).Trim() }
    }
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:ProgramFiles\Python312\python.exe",
        "${env:ProgramFiles(x86)}\Python312\python.exe",
        "C:\Python312\python.exe"
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    $p = Get-Command python -ErrorAction SilentlyContinue
    if ($p) {
        $ver = & $p.Source -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($ver -eq '3.12') { return $p.Source }
    }
    return $null
}

Step 2 'Python 3.12 찾는 중'
$python = Find-Python
if (-not $python -and $InstallPython -and -not $DryRun) {
    Step 3 "Python $PythonVersion 내려받는 중 (python.org)"
    $installer = Join-Path $env:TEMP "python-$PythonVersion-amd64.exe"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $PythonUrl -OutFile $installer -UseBasicParsing
    } catch { Fail "Python 설치 파일을 받지 못했습니다: $($_.Exception.Message)" }
    $sig = Get-AuthenticodeSignature $installer
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Python Software Foundation') {
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
        Fail 'Python 설치 파일의 서명을 확인할 수 없어 설치하지 않았습니다.'
    }
    Step 6 "Python $PythonVersion 설치 중 (현재 사용자)"
    $proc = Start-Process -FilePath $installer -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=0', 'Include_launcher=1', 'Include_test=0' -Wait -PassThru
    Remove-Item $installer -Force -ErrorAction SilentlyContinue
    if ($proc.ExitCode -ne 0) { Fail "Python 설치 실패 (코드 $($proc.ExitCode))" }
    $python = Find-Python
}
if (-not $python) {
    if ($DryRun -and $InstallPython) { $python = "(설치 예정) Python $PythonVersion" }
    else { Fail 'Python 3.12을 찾을 수 없습니다. https://www.python.org/downloads/ 에서 Python 3.12 Windows installer (64-bit)를 설치한 뒤 다시 실행하세요.' }
}
Emit 'info' @{ python = $python }

# 2. GPU 확인
$gpu = $null
if (-not $Cpu) {
    $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($smi) {
        $name = & $smi.Source --query-gpu=name --format=csv,noheader 2>$null
        if ($LASTEXITCODE -eq 0 -and $name) { $gpu = ($name | Select-Object -First 1).Trim() }
    }
}
if ($gpu) {
    $torchIndex = 'https://download.pytorch.org/whl/cu128'
    Emit 'info' @{ gpu = $gpu; torch = 'CUDA 12.8 (cu128)' }
} else {
    $torchIndex = 'https://download.pytorch.org/whl/cpu'
    Emit 'warn' @{ message = 'NVIDIA GPU 없음 → CPU용 torch 설치 (자막 생성이 느립니다)' }
}

$pkgs = @('faster-whisper', 'transformers', 'soundfile', 'numpy', 'huggingface-hub')
$pipTorch = @('-m', 'pip', 'install', 'torch', 'torchaudio', '--index-url', $torchIndex, '--disable-pip-version-check')
$pipRest = @('-m', 'pip', 'install', '--disable-pip-version-check') + $pkgs

$plan = @()
if ($Force -and (Test-Path $venvDir)) { $plan += "Remove-Item -Recurse $venvDir" }
if ($Force -or -not (Test-Path $venvPy)) { $plan += "`"$python`" -m venv `"$venvDir`"" } else { $plan += '(engine\.venv 이미 있음 → 그대로 사용)' }
$plan += "`"$venvPy`" -m pip install --upgrade pip"
$plan += "`"$venvPy`" $($pipTorch -join ' ')"
$plan += "`"$venvPy`" $($pipRest -join ' ')"
$plan += "`"$venvPy`" -c `"import torch, faster_whisper; print(torch.cuda.is_available())`""

if ($DryRun) {
    $i = 0
    foreach ($cmd in $plan) { $i++; Emit 'plan' @{ step = $i; command = $cmd } }
    Emit 'done' @{ ok = $true; dryRun = $true; message = '실제 설치는 하지 않았습니다 (-DryRun)' }
    exit 0
}

function Run([string]$exe, [string[]]$argList, [string]$what) {
    & $exe @argList
    if ($LASTEXITCODE -ne 0) { Fail "$what 실패 (코드 $LASTEXITCODE)" }
}

# 3. venv
if ($Force -and (Test-Path $venvDir)) { Step 5 '기존 가상환경 삭제'; Remove-Item -Recurse -Force $venvDir }
if (-not (Test-Path $venvPy)) {
    Step 10 '가상환경 만드는 중 (engine\.venv)'
    Run $python @('-m', 'venv', $venvDir) 'venv 생성'
}
Step 15 'pip 업데이트'
Run $venvPy @('-m', 'pip', 'install', '--upgrade', 'pip', '--disable-pip-version-check') 'pip 업데이트'

# 4. torch (약 2.5GB)
$kind = if ($gpu) { 'CUDA' } else { 'CPU' }
Step 20 "PyTorch 설치 중 ($kind) - 몇 분 걸립니다"
Run $venvPy $pipTorch 'PyTorch 설치'

# 5. 나머지
Step 70 '음성 인식 라이브러리 설치 중'
Run $venvPy $pipRest 'faster-whisper 등 설치'

# 6. 확인
Step 95 '설치 확인 중'
$check = & $venvPy -c "import json, torch, faster_whisper, transformers, soundfile; print(json.dumps({'torch': torch.__version__, 'cuda': torch.cuda.is_available(), 'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))"
if ($LASTEXITCODE -ne 0) { Fail '설치 확인 실패: 라이브러리를 불러올 수 없습니다.' }
$doneMsg = '엔진 설치 완료. Whisper 모델(약 3GB)은 첫 자막 생성 때 자동으로 내려받습니다.'

# 7. Whisper 모델 (transcribe.py와 같은 모델·폴더)
if ($DownloadModel) {
    Step 97 'Whisper 모델 받는 중 (GPU large-v3 약 3GB / CPU medium 약 1.5GB) - 몇 분 걸립니다'
    $modelDir = Join-Path $engineDir 'models'
    New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
    $env:HF_HOME = Join-Path $engineDir 'hf-cache'
    $code = "import torch`nfrom faster_whisper.utils import download_model`nname = 'large-v3' if torch.cuda.is_available() else 'medium'`nimport sys`ndownload_model(name, cache_dir=sys.argv[1])`nprint(name)"
    $m = & $venvPy -c $code $modelDir
    if ($LASTEXITCODE -ne 0) { Fail 'Whisper 모델 받기 실패. 첫 자막 생성 때 다시 받습니다.' }
    $doneMsg = "엔진 설치 완료. Whisper $(($m | Select-Object -Last 1).Trim()) 모델도 받았습니다."
}
Emit 'done' @{ ok = $true; result = ($check | Select-Object -Last 1); message = $doneMsg }
