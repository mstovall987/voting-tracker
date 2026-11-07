@echo off
rem Double-click to open the Voting Tracker in your web browser.
rem Keep the black window open while you use the site; close it to stop.
cd /d "%~dp0"
title Voting Tracker
where python >nul 2>nul
if %errorlevel%==0 (
  python serve.py 8000 --open
) else (
  py -3 serve.py 8000 --open
)
if errorlevel 1 pause
