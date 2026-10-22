' LabNexus agent launcher - hides the console window.
' The agent keeps running; the lock overlay is the only visible thing.
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d """ & Replace(WScript.ScriptFullName, WScript.ScriptName, "") & """ && node agent.js", 0, False
Set WshShell = Nothing
