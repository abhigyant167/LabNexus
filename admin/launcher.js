// ----------------------------------------------------------------
// LabNexus dashboard launcher
// - starts the admin server in the background (if not already up)
// - waits until it responds, then opens the dashboard in the browser
// - safe to double-click repeatedly: an already-running server is
//   reused instead of causing EADDRINUSE
// ----------------------------------------------------------------

const { spawn, exec } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8000;
const URL = `http://localhost:${PORT}`;
const here = __dirname;
const logFile = path.join(here, "data", "server-log.txt");

function probe() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/health`, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function openBrowser(url) {
  if (process.platform === "win32") exec(`start "" "${url}"`);
  else if (process.platform === "darwin") exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}

(async () => {
  if (await probe()) {
    console.log("LabNexus server is already running.");
    openBrowser(URL);
    setTimeout(() => process.exit(0), 800);
    return;
  }

  fs.mkdirSync(path.join(here, "data"), { recursive: true });
  const log = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [path.join(here, "server.js")], {
    cwd: here,
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  child.unref();
  console.log(`Starting LabNexus server (pid ${child.pid})...`);

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (await probe()) {
      console.log(`LabNexus dashboard is live: ${URL}`);
      console.log(`(server log: ${logFile})`);
      openBrowser(URL);
      setTimeout(() => process.exit(0), 800);
      return;
    }
  }
  console.error("Server did not become healthy within 15s - check server-log.txt");
  process.exit(1);
})();
