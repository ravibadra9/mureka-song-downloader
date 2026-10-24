@echo off
title Mureka Song Downloader - Companion Bridge
color 0A
cls
set PYTHONDONTWRITEBYTECODE=1

:run_bridge
echo =====================================================================
echo    🎵 MUREKA SONG DOWNLOADER - LOCAL COMPANION BRIDGE
echo =====================================================================
echo.
echo Starting bridge on http://127.0.0.1:59966...
echo.

python -B bridge.py
set RETCODE=%ERRORLEVEL%

if %RETCODE% EQU 42 (
    echo.
    echo [OTA] Update applied successfully! Restarting companion bridge...
    timeout /t 1 /nobreak >nul
    cls
    goto run_bridge
)

if %RETCODE% NEQ 0 (
    echo.
    echo [ERROR] Companion Bridge exited with code %RETCODE%.
    pause
)
