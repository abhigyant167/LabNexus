@echo off
rem LabNexus - provision the NEXT lab laptop (run on the ADMIN laptop)
rem Creates pc-agent\ready\PC-<n>\ with a unique pcId + random token.
title LabNexus - new laptop
cd /d "%~dp0"

echo.
echo  This hands out a fresh identity (unique pcId + random token) and writes
echo  a ready-to-copy agent folder for the new laptop.
echo.
echo  Tip: logging in to the running server lets us skip pcIds that are
echo  already in use on the network.
echo.
set /p LN_PW= Admin dashboard password (Enter to skip the server check):

if "%LN_PW%"=="" (
  node provision.js --next
) else (
  node provision.js --next --server-url http://localhost:8000 --password %LN_PW%
)

echo.
pause
