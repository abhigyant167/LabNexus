// ----------------------------------------------------------------
// LabNexus PC lock overlay v3 (Windows)
// - fullscreen, topmost, borderless dark window (PowerShell + WPF)
// - DIRECT spawn: we hold the real PowerShell PID, so unlock and
//   every re-spawn kill the exact window - none survive, none stack
// - one-window guarantee: a spawn grace period makes the watchdog
//   wait while a fresh window is still starting up
// - stray-window sweep kills any orphaned LABNEXUS windows
// - admin messages appear as a side toast (works when unlocked too)
// - non-Windows falls back to the console renderer
// NOTE: this is a strong helper, not an OS security boundary. A local
// administrator can still kill processes or bypass the overlay.
// ----------------------------------------------------------------

const { spawn, exec, execSync } = require("child_process");
const os = require("os");

let locked = false;
let lockReason = "";
let message = "";
let expiryWarned = false;
let proc = null;            // the REAL powershell overlay process (direct spawn)
let consoleTimer = null;    // console fallback renderer
let spawnGraceUntil = 0;    // during WPF startup the watchdog must wait
let sweeping = false;

const SPAWN_GRACE_MS = 4000; // WPF window takes a moment to appear

function isLocked() {
  return locked;
}

function lock(reason = "Locked by administrator") {
  locked = true;
  lockReason = reason;
  expiryWarned = false;
  message = "";
  console.log(`[overlay] LOCK: ${reason}`);
  spawnWindowsOverlay();
  startConsoleFallback();
}

function unlock() {
  locked = false;
  lockReason = "";
  message = "";
  console.log("[overlay] UNLOCK");
  killOverlay(true); // sweep strays too: nothing may survive an unlock
  stopConsoleFallback();
}

function showMessage(text) {
  message = text || "";
  console.log(`[overlay] MESSAGE: ${message}`);
  if (locked) {
    // restart overlay so the lock screen picks up the new message
    spawnWindowsOverlay();
  }
  // always: side notification, visible even when the PC is in use
  showToast(text || "Message from administrator");
}

function showCountdown(msLeft) {
  expiryWarned = true;
  const mins = Math.max(1, Math.ceil(msLeft / 60000));
  console.log(`[overlay] WARNING: session ends in ~${mins} min`);
  if (locked) {
    lockReason = `Session ends in ~${mins} min - please save your work`;
    spawnWindowsOverlay();
  }
}

function expiryWarnedState() {
  return expiryWarned;
}

// Watchdog support: is the Windows overlay process still alive?
function overlayAlive() {
  if (process.platform !== "win32") return !!consoleTimer; // console fallback is the overlay
  // during WPF startup the window briefly doesn't exist - don't double-spawn
  if (Date.now() < spawnGraceUntil) return true;
  return !!proc && !!proc.pid;
}

// ---------------- side toast (admin messages) ----------------
// Small window anchored bottom-right, auto-closes after 10s.

function xamlEscape(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function showToast(text) {
  if (process.platform !== "win32") {
    console.log(`[toast] ${text}`);
    return;
  }
  const t = xamlEscape(text).replace(/'/g, "''");
  const seat = os.hostname().toUpperCase().replace(/[^A-Z0-9-]/g, "-");
  const ps = `
Add-Type -AssemblyName PresentationFramework;
$w = New-Object System.Windows.Window;
$w.Title = 'LABNEXUS-TOAST';
$w.WindowStyle = 'None';
$w.ResizeMode = 'NoResize';
$w.Topmost = $true;
$w.ShowInTaskbar = $false;
$w.AllowsTransparency = $true;
$w.Background = [System.Windows.Media.Brushes]::Transparent;
$w.SizeToContent = 'WidthAndHeight';
$w.WindowStartupLocation = 'Manual';
$w.Left = [System.Windows.SystemParameters]::WorkArea.Width - 380;
$w.Top = [System.Windows.SystemParameters]::WorkArea.Height - 160;
$bd = New-Object System.Windows.Controls.Border;
$bd.Background = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#111827');
$bd.BorderBrush = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#3b82f6');
$bd.BorderThickness = '1';
$bd.CornerRadius = '10';
$bd.Padding = '18,12,18,14';
$bd.Margin = '8';
$sp = New-Object System.Windows.Controls.StackPanel;
$t1 = New-Object System.Windows.Controls.TextBlock;
$t1.Text = 'MESSAGE FROM ADMINISTRATOR';
$t1.FontSize = 11;
$t1.FontWeight = 'Bold';
$t1.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#93c5fd');
$t2 = New-Object System.Windows.Controls.TextBlock;
$t2.Text = '${t}';
$t2.FontSize = 15;
$t2.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#f9fafb');
$t2.TextWrapping = 'Wrap';
$t2.Margin = '0,6,0,0';
$t2.MaxWidth = 330;
$t3 = New-Object System.Windows.Controls.TextBlock;
$t3.Text = '${seat} - closes automatically';
$t3.FontSize = 10;
$t3.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#6b7280');
$t3.Margin = '0,8,0,0';
$sp.Children.Add($t1); $sp.Children.Add($t2); $sp.Children.Add($t3);
$bd.Child = $sp;
$w.Content = $bd;
$tmr = New-Object System.Windows.Threading.DispatcherTimer;
$tmr.Interval = [TimeSpan]::FromSeconds(10);
$tmr.Add_Tick({ $w.Close() });
$w.Add_Closed({ $tmr.Stop() });
$tmr.Start();
$w.ShowDialog() | Out-Null;
`.trim();
  const b64 = Buffer.from(ps, "utf16le").toString("base64");
  try {
    spawn("powershell", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", b64], {
      windowsHide: true, detached: false, stdio: "ignore",
    }).unref(); // fire and forget; window self-closes in 10s
  } catch (e) {
    console.error("[toast] failed:", e.message);
  }
}

// ---------------- Windows WPF overlay ----------------

function spawnWindowsOverlay() {
  if (process.platform !== "win32") return;
  killOverlay(false); // kill our previous window first (synchronous)
  sweepStrays(false); // ensure no orphaned LABNEXUS window can stack

  const seatName = os.hostname().toUpperCase().replace(/[^A-Z0-9-]/g, "-");
  const reason = xamlEscape(lockReason);
  const msg = message ? xamlEscape(message) : "";

  // -WindowStyle Hidden hides the powershell console flash
  const ps = `
Add-Type -AssemblyName PresentationFramework;
$w = New-Object System.Windows.Window;
$w.Title = 'LABNEXUS';
$w.WindowStyle = 'None';
$w.ResizeMode = 'NoResize';
$w.WindowState = 'Maximized';
$w.Topmost = $true;
$w.ShowInTaskbar = $false;
$w.Background = [System.Windows.Media.Brushes]::Black;
$sp = New-Object System.Windows.Controls.StackPanel;
$sp.VerticalAlignment = 'Center';
$t1 = New-Object System.Windows.Controls.TextBlock;
$t1.Text = 'LABNEXUS';
$t1.FontSize = 22; $t1.Foreground = 'Gray';
$t1.HorizontalAlignment = 'Center';
$t2 = New-Object System.Windows.Controls.TextBlock;
$t2.Text = 'This computer is LOCKED';
$t2.FontSize = 42; $t2.FontWeight = 'Bold';
$t2.Foreground = 'White';
$t2.HorizontalAlignment = 'Center'; $t2.Margin = '0,10,0,0';
$t3 = New-Object System.Windows.Controls.TextBlock;
$t3.Text = '${reason}';
$t3.FontSize = 20; $t3.Foreground = '#f59e0b';
$t3.HorizontalAlignment = 'Center'; $t3.Margin = '0,16,0,0'; $t3.TextWrapping = 'Wrap';
$sp.Children.Add($t1); $sp.Children.Add($t2); $sp.Children.Add($t3);
${msg ? `
$t4 = New-Object System.Windows.Controls.TextBlock;
$t4.Text = '${msg}';
$t4.FontSize = 18; $t4.Foreground = '#93c5fd';
$t4.HorizontalAlignment = 'Center'; $t4.Margin = '0,14,0,0'; $t4.TextWrapping = 'Wrap';
$sp.Children.Add($t4);` : ""}
$c = New-Object System.Windows.Controls.TextBlock;
$c.Text = '${seatName}';
$c.FontSize = 14; $c.Foreground = 'DimGray';
$c.HorizontalAlignment = 'Center'; $c.Margin = '0,30,0,0';
$sp.Children.Add($c);
$w.Content = $sp;
$w.ShowDialog() | Out-Null;
`.trim();

  const b64 = Buffer.from(ps, "utf16le").toString("base64");
  const p = spawn("powershell", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", b64], {
    windowsHide: true,
    stdio: "ignore",
  });
  proc = p;
  // only clear if this exact process is still the current overlay
  p.on("exit", () => { if (proc === p) proc = null; });
  p.on("error", () => { if (proc === p) proc = null; });
  spawnGraceUntil = Date.now() + SPAWN_GRACE_MS;
}

// Kill the overlay we own; optionally also sweep stray LABNEXUS windows.
// taskkill /T kills the whole tree so no window can outlive its parent.
function killOverlay(sweepStraysToo) {
  if (proc && proc.pid) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${proc.pid} 2>nul`, { stdio: "ignore", timeout: 3000 });
      } else {
        proc.kill();
      }
    } catch (_) {}
  }
  proc = null;
  if (sweepStraysToo) sweepStrays(true);
}

// Close any orphaned LABNEXUS overlay / toast windows by title.
// Synchronous so a new window is only spawned after old ones are gone
// (this is what prevents stacking). windowTitle works where
// MainWindowTitle/MainWindowHandle fail for this WPF window.
function sweepStrays(async) {
  if (process.platform !== "win32" || sweeping) return;
  sweeping = true;
  const cmd = `powershell -NoProfile -NonInteractive -Command "Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.windowTitle -eq 'LABNEXUS' -or $_.windowTitle -eq 'LABNEXUS-TOAST' } | Stop-Process -Force"`;
  if (async) {
    exec(cmd, { windowsHide: true, timeout: 8000 }, () => { sweeping = false; });
  } else {
    try { execSync(cmd, { windowsHide: true, timeout: 6000, stdio: "ignore" }); } catch (_) {}
    sweeping = false;
  }
}

// ---------------- console fallback (non-Windows / pre-spawn) ----------------

function startConsoleFallback() {
  if (process.platform === "win32") return; // WPF handles it
  if (consoleTimer) return;
  consoleTimer = setInterval(() => {
    if (!locked) return stopConsoleFallback();
    console.clear();
    console.log("==================================================");
    console.log("  LabNexus - this computer is LOCKED");
    console.log("==================================================");
    console.log(`  Reason : ${lockReason}`);
    if (message) console.log(`  Message: ${message}`);
    console.log(`  Time   : ${new Date().toLocaleTimeString()}`);
    console.log("");
    console.log("  Ask the lab administrator to grant you access.");
    console.log("==================================================");
  }, 1000);
}

function stopConsoleFallback() {
  if (consoleTimer) {
    clearInterval(consoleTimer);
    consoleTimer = null;
  }
  console.clear();
  console.log("[overlay] Session unlocked - you may use this computer.");
}

// If the agent itself exits, take every LabNexus window with it.
process.on("exit", () => { killOverlay(false); sweepStrays(false); });

// On agent startup, clear any windows orphaned by a previous agent.
if (process.platform === "win32") {
  setTimeout(() => sweepStrays(true), 2000);
}

module.exports = {
  lock,
  unlock,
  isLocked,
  showMessage,
  showCountdown,
  showToast,
  expiryWarned: expiryWarnedState,
  overlayAlive,
};
