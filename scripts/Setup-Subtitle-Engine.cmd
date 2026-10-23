@echo off
chcp 65001 >nul
echo SermonShorts subtitle engine setup. Python 3.12 x64 is required (add -InstallPython to install it automatically).
echo Engine files will be installed under your Windows profile, not the app folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0resources\app\scripts\setup_engine.ps1" -DataDir "%APPDATA%\SermonShorts\runtime" -Human %*
echo.
echo Finished. Check the result above, then press a key to close.
pause >nul
