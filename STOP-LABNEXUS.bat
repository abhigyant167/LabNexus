@echo off
rem LabNexus - stop the admin server and any PC agent on this machine
title LabNexus - Stop
echo Stopping LabNexus server and agent...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server\.js|agent\.js|launcher\.js' } | ForEach-Object { Write-Output ('  stopping node ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"
echo Done. Ports 8000 / 41888 are released.
pause
