@echo off
chcp 65001 >nul
title TelePrompter Pro
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요.
    pause
    exit /b 1
)

if not exist node_modules (
    echo 의존성 패키지를 설치하는 중...
    call npm install
    if errorlevel 1 (
        echo [오류] npm install 실패
        pause
        exit /b 1
    )
)

echo.
echo ========================================
echo   TelePrompter Pro
echo ========================================
echo   서버를 시작합니다...
echo   브라우저가 자동으로 열립니다.
echo   종료: 이 창에서 Ctrl+C
echo ========================================
echo.

call npm run dev -- --open

echo.
echo 서버가 종료되었습니다.
pause
