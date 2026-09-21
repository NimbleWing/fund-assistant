@echo off
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-native.ps1" %*
pause
