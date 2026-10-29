@echo off
title LabNexus PC Agent
cd /d "%~dp0"

rem Check if serverUrl is configured
node -e "
const fs = require('fs');
try {
  const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  if (!cfg.serverUrl || cfg.serverUrl.trim() === '') process.exit(1);
} catch (e) {
  process.exit(0);
}
"
if %errorlevel% neq 0 (
  echo ========================================================
  echo  LabNexus PC Agent - Server Connection Setup
  echo ========================================================
  echo.
  echo  Are you connecting to your cloud site (Render / Cloudflare)?
  echo  Paste your URL (e.g. https://your-domain.com or https://app.onrender.com)
  echo.
  echo  Or press Enter to auto-discover on local Wi-Fi LAN.
  echo.
  set /p USER_URL=" Server URL: "
  if not "%USER_URL%"=="" (
    node -e "
      const fs = require('fs');
      try {
        const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        const u = process.argv[1].trim().replace(/\/+$/, '');
        if (u) {
          cfg.serverUrl = u;
          fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2) + '\n');
          console.log('Saved serverUrl to config.json: ' + u);
        }
      } catch (e) {}
    " "%USER_URL%"
  )
  echo.
)

echo Starting LabNexus agent from %CD%
echo (auto-restarts if the agent crashes - close this window to stop it)
echo.

:loop
node agent.js
echo.
echo Agent exited (%DATE% %TIME%). Restarting in 3 seconds... Press Ctrl+C now to stop.
timeout /t 3 /nobreak >nul
goto loop
