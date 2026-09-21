@echo off
cd /d %~dp0
echo ================================================
echo  Fund assistant server  http://127.0.0.1:17521
echo  Close this window or press Ctrl+C to stop.
echo ================================================
node --no-warnings src/server.ts
pause
