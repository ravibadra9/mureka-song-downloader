@echo off
title Mureka All-Workspaces Song Downloader
color 0B
cls
set PYTHONDONTWRITEBYTECODE=1
echo =====================================================================
echo    🎵 MUREKA ALL-WORKSPACES SONG DOWNLOADER (DESKTOP STUDIO)
echo =====================================================================
echo.
echo Launching Mureka Desktop Downloader GUI...
echo.
python -B mureka_downloader.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Failed to run mureka_downloader.py. Please verify Python is installed.
    pause
)

