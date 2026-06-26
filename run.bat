@echo off
chcp 65001 >nul
title TelePrompter Pro
cd /d "%~dp0"

set "PAGES_URL=https://battlecruse.github.io/TelePrompter/"

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

if /i "%~1"=="deploy" goto deploy
if /i "%~1"=="dev" goto dev

echo.
echo ========================================
echo   TelePrompter Pro
echo ========================================
echo   [1] 로컬에서 실행 (개발 모드)
echo   [2] GitHub에 배포 (빌드 + 업로드)
echo ========================================
echo.
set /p choice="선택 (1 또는 2): "

if "%choice%"=="2" goto deploy
if "%choice%"=="1" goto dev
if "%choice%"=="" goto dev

echo [오류] 1 또는 2를 입력해 주세요.
pause
exit /b 1

:dev
echo.
echo ========================================
echo   로컬 개발 서버 시작
echo ========================================
echo   브라우저가 자동으로 열립니다.
echo   종료: 이 창에서 Ctrl+C
echo ========================================
echo.
call npm run dev -- --open
echo.
echo 서버가 종료되었습니다.
pause
exit /b 0

:deploy
where git >nul 2>&1
if errorlevel 1 (
    echo [오류] Git이 설치되어 있지 않습니다.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   GitHub 배포
echo ========================================
echo   1. 빌드 검사
echo   2. 변경사항 업로드 (git push)
echo   3. GitHub Pages 자동 배포
echo ========================================
echo.

echo [1/3] 빌드 검사 중...
call npm run build
if errorlevel 1 (
    echo [오류] 빌드 실패 — 배포를 중단합니다.
    pause
    exit /b 1
)
echo 빌드 성공!
echo.

echo [2/3] GitHub에 업로드 중...
git add .
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Deploy: update TelePrompter Pro"
    if errorlevel 1 (
        echo [오류] git commit 실패
        pause
        exit /b 1
    )
    git push
    if errorlevel 1 (
        echo [오류] git push 실패
        echo GitHub 로그인 또는 이메일 설정을 확인해 주세요.
        pause
        exit /b 1
    )
    echo 업로드 완료!
) else (
    echo 변경된 파일이 없습니다. 이미 최신 상태입니다.
)
echo.

echo [3/3] GitHub Pages 배포 중...
echo GitHub Actions가 자동으로 사이트를 배포합니다.
echo 보통 1~2분 정도 소요됩니다.
echo.
echo 배포 주소: %PAGES_URL%
echo Actions 확인: https://github.com/battlecruse/TelePrompter/actions
echo.
start "" "%PAGES_URL%"
start "" "https://github.com/battlecruse/TelePrompter/actions"
echo.
pause
exit /b 0
