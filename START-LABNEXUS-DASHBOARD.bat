@echo off
rem LabNexus - open the admin dashboard (starts the server if needed)
title LabNexus Dashboard
cd /d "%~dp0admin"
node launcher.js
if errorlevel 1 (
  echo.
  echo Something went wrong - see admin\data\server-log.txt
  pause
)
