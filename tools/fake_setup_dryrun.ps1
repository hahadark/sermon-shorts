# 시험용: 실제 설치 스크립트를 -DryRun 으로 돌린다 (아무것도 설치하지 않음). tools\ui_tests.ps1 sysflow 가 SS_SETUP_SCRIPT 로 쓴다
param([string]$DataDir, [switch]$InstallPython, [switch]$Force)
& (Join-Path $PSScriptRoot '..\assets\engine\setup_engine.ps1') -DataDir $DataDir -InstallPython -DryRun
exit $LASTEXITCODE