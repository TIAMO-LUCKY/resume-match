@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting local server for Resume ^<^> JD Match...
echo Keep this window open. Close it to stop the server.
echo.
start "" http://localhost:8000
"C:\Users\86156\.workbuddy\binaries\python\versions\3.13.12\python.exe" -m http.server 8000
pause
