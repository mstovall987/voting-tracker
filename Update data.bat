@echo off
rem Double-click to download the latest votes and bills and rebuild the website data.
cd /d "%~dp0"
title Voting Tracker - updating data
where python >nul 2>nul
if %errorlevel%==0 (
  python -m pipeline update
) else (
  py -3 -m pipeline update
)
echo.
pause
