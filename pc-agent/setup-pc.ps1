# ================================================================
# LabNexus one-time PC setup (run AS ADMINISTRATOR on the LAB PC)
# Prepares the laptop so that:
#   1. Wake-on-LAN works (NIC allowed to wake the machine)
#   2. The agent starts automatically at boot
#   3. Sleep respects the admin's remote command
# Idempotent: safe to run repeatedly.
# Output: PASS / WARN / FAIL per check. Reversible - see README.
# ================================================================

$ErrorActionPreference = "Continue"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "=== LabNexus PC setup ===" -ForegroundColor Cyan

# --- 1. Admin check -------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "FAIL  Run this script as Administrator (right-click -> Run as administrator)." -ForegroundColor Red
    exit 1
}
Write-Host "PASS  Running as administrator"

# --- 2. Wake-on-LAN on the active NIC -------------------------------
# PowerManagement flags bitmask: bit 1 (WOL from shutdown) + bit 2 (PnP wakeup)
# Setting via WMI works on most Realtek/Intel NICs.
$adapters = Get-CimInstance -ClassName MSPower_DeviceWakeEnable -Namespace root\wmi -ErrorAction SilentlyContinue
if ($adapters) {
    foreach ($a in $adapters) {
        try {
            $a.Enable = $true
            Set-CimInstance -CimInstance $a -ErrorAction Stop
            Write-Host "PASS  WOL enable flag set for device $($a.InstanceName)"
        } catch {
            Write-Host "WARN  Could not set WOL flag for $($a.InstanceName): $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "WARN  No MSPower_DeviceWakeEnable instances found - enable 'Wake on Magic Packet' in the NIC driver's Device Manager advanced settings." -ForegroundColor Yellow
}

# Keep the NIC powered during sleep (magic packets are received in S3 only
# if the NIC stays powered)
$usb = Get-PnpDevice -Class Net -Status OK -ErrorAction SilentlyContinue | Select-Object -First 5
foreach ($dev in $usb) {
    $wake = Get-CimInstance -ClassName MSPower_DeviceWakeEnable -Namespace root\wmi -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceName -like "*$($dev.DeviceID.Substring(0,[Math]::Min(20,$dev.DeviceID.Length)))*" }
    if ($wake) { Write-Host "PASS  Wake-capable NIC present: $($dev.Name)" }
}

# --- 3. Fast startup must be OFF for clean WOL from shutdown ---------
$hib = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" -ErrorAction SilentlyContinue).HiberbootEnabled
if ($null -ne $hib) {
    Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" -Name HiberbootEnabled -Value 0
    Write-Host "PASS  Fast startup disabled (required for reliable WOL from shutdown; was $hib)"
} else {
    Write-Host "PASS  Fast startup already off"
}

# --- 4. Autostart the agent at logon (scheduled task) ----------------
$vbs = Join-Path $dir "START-AGENT-SILENT.vbs"
if (Test-Path $vbs) {
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
    try {
        Register-ScheduledTask -TaskName "LabNexusAgent" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
        Write-Host "PASS  Scheduled task 'LabNexusAgent' registered (starts agent at every logon)"
    } catch {
        Write-Host "FAIL  Could not register scheduled task: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "FAIL  START-AGENT-SILENT.vbs not found next to this script - copy the whole pc-agent folder." -ForegroundColor Red
}

# --- 5. Sleep behavior: allow system to sleep (agent triggers it) ----
powercfg /change standby-timeout-ac 0 | Out-Null   # never auto-sleep on its own; admin decides
powercfg /change monitor-timeout-ac 15 | Out-Null
Write-Host "PASS  Power plan: no auto-sleep; screen off after 15 min (admin sends sleep remotely)"

Write-Host ""
Write-Host "=== Rollback notes ===" -ForegroundColor Cyan
Write-Host "Unregister the agent autostart:  Unregister-ScheduledTask -TaskName LabNexusAgent -Confirm:`$false"
Write-Host "Re-enable fast startup:          Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value 1"
Write-Host "Restore auto-sleep:              powercfg /change standby-timeout-ac 30"
Write-Host ""
Write-Host "Setup complete. Start the agent with START-AGENT.bat or START-AGENT-SILENT.vbs" -ForegroundColor Green
