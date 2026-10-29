@echo off
title Reset LabNexus PC Identity
cd /d "%~dp0"
echo ========================================================
echo  LabNexus - Reset Identity to PC-1
echo ========================================================
echo.

if exist "data\identity.json" (
  del /f /q "data\identity.json"
  echo Removed saved identity file (data\identity.json).
)

node -e "
const fs = require('fs');
try {
  const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  cfg.pcId = 1;
  cfg.token = 'demo-agent-1';
  fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2) + '\n');
  console.log('Reset config.json to PC-1 (token: demo-agent-1).');
} catch (e) {
  console.error('Error updating config.json:', e.message);
}
"

echo.
echo Done! This computer will now register as PC-1.
echo.
pause

