@echo off
title LabNexus Network Diagnostic
cd /d "%~dp0"
node diagnose.js
echo.
echo If nothing was found, try probing the admin laptop directly:
echo    node diagnose.js ADMIN_LAPTOP_IP
echo.
pause
