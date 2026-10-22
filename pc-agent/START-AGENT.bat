@echo off
title LabNexus PC Agent
cd /d "%~dp0"
echo Starting LabNexus agent from %CD%
echo (auto-restarts if the agent crashes - close this window to stop it)
echo.

:loop
node agent.js
echo.
echo Agent exited (%DATE% %TIME%). Restarting in 3 seconds... Press Ctrl+C now to stop.
timeout /t 3 /nobreak >nul
goto loop
