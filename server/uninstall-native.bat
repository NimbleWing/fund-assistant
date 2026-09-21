@echo off
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fund.assistant" /f >nul 2>&1
del "%~dp0com.fund.assistant.json" >nul 2>&1
echo Native messaging host uninstalled.
pause
