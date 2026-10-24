@echo off
title Mureka Song Downloader - OTA Auto-Updater
color 0B
cls
set PYTHONDONTWRITEBYTECODE=1
echo =====================================================================
echo    ⚡ MUREKA SONG DOWNLOADER - ONE-CLICK OTA UPDATE SYSTEM
echo =====================================================================
echo.
echo Fetching latest code and updates directly from GitHub...
echo.

python -B ota_updater.py --apply
if %ERRORLEVEL% EQU 0 (
    echo.
    echo =====================================================================
    echo   [SUCCESS] Update applied successfully!
    echo   All files have been updated.
    echo   Chrome will now load the updated extension automatically.
    echo =====================================================================
) else (
    echo.
    echo [ERROR] Update failed. Please check your internet connection or GitHub status.
)

echo.
pause
