@echo off
rem Rust 편집기 시험: 순서 바꾼 Electron 프로젝트 사본을 열어 둔다 (원본 시험 파일은 그대로)
copy /Y "F:\aside\sermon-shorts-rs\tests\fixtures\electron_order.sshorts" "F:\aside\sermon-shorts-rs\target\시험프로젝트.sshorts" >nul
start "" "F:\aside\sermon-shorts-rs\target\release\sermon_shorts.exe" --project "F:\aside\sermon-shorts-rs\target\시험프로젝트.sshorts"