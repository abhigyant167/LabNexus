@echo off
title LabNexus - Set Server URL
cd /d "%~dp0"
echo ========================================================
echo  LabNexus - Set Server URL (Render / Cloudflare / LAN)
echo ========================================================
echo.
echo Current serverUrl:
node -e "const c = require('./config.json'); console.log('  ' + (c.serverUrl || '(empty - local Wi-Fi auto-discovery)'));"
echo.
echo Enter your Render URL or Cloudflare domain (e.g. https://your-app.onrender.com)
echo Or leave blank and press Enter to reset to local Wi-Fi auto-discovery.
echo.
set /p NEW_URL=" Server URL: "

node -e "
const fs = require('fs');
try {
  const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  const url = process.argv[1].trim().replace(/\/+$/, '');
  cfg.serverUrl = url;
  fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2) + '\n');
  console.log('Saved! config.json serverUrl is now: ' + (url || '(empty - local auto-discovery)'));
} catch (e) {
  console.error('Error:', e.message);
}
" "%NEW_URL%"

echo.
pause

