// ----------------------------------------------------------------
// LabNexus pc-agent (stdlib only, runs on lab PCs)
// - discovers the admin server automatically via UDP broadcast
// - polls outbound only; no inbound firewall rule needed on PCs
// - shows a fullscreen lock overlay when locked
// - executes lock/unlock/sleep/message/reboot commands
// ----------------------------------------------------------------

const dgram = require("dgram");
const os = require("os");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const overlay = require("./overlay");
const config = require("./config.json");

// ---------------- identity ----------------
//
// A PC may already carry a saved identity (data/identity.json), which the server
// issued on first run. That beats config.json, so copying this folder to another
// laptop never clones a seat: the saved identity belongs to one machine, and a
// machine that has none simply enrolls for its own id + token automatically.

const PC_NAME = os.hostname().toUpperCase().replace(/[^A-Z0-9-]/g, "-");
const AGENT_VERSION = "1.0.0";

const DATA_DIR = path.join(__dirname, "data");
const IDENTITY_FILE = path.join(DATA_DIR, "identity.json");

let PC_ID = 0;
let TOKEN = "";
let IDENTITY_SOURCE = "none";

// Sent on every register/heartbeat: if the server ever sees a different value it
// knows the agent restarted and that whatever it believed about the overlay is stale.
const AGENT_STARTED_AT = Date.now();

// Fingerprint of the physical machine. Stored with the identity so a folder
// copied to a different laptop is detected and enrolls fresh instead of trying
// to impersonate the machine it came from.
function machineKey() {
  return `${os.hostname().toLowerCase()}|${(mac() || "").toLowerCase()}`;
}

function loadIdentity() {
  try {
    const raw = JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf8"));
    if (!raw || !raw.pcId || !raw.token) return null;
    if (raw.machine && raw.machine !== machineKey()) {
      console.log("Saved identity belongs to another PC (copied folder) - enrolling this one fresh.");
      return null;
    }
    return raw;
  } catch (_) {
    return null;
  }
}

function saveIdentity() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      IDENTITY_FILE,
      JSON.stringify(
        { pcId: PC_ID, token: TOKEN, machine: machineKey(), savedAt: new Date().toISOString() },
        null,
        2
      ) + "\n"
    );
  } catch (err) {
    console.error(`Could not save this PC's identity (${err.message}) - it may enroll again next start.`);
  }
}

// Ask the admin server for a seat. Used on a brand-new PC, and also when this
// machine finds its configured pcId already taken by another laptop.
async function enroll() {
  const res = await request(
    "POST",
    "/api/agent/enroll",
    {
      // No display name: the server numbers the seat itself (PC-1, PC-2, ...).
      hostname: os.hostname(),
      ip: localIp(),
      mac: mac(),
      agentVersion: AGENT_VERSION,
      agentStartedAt: AGENT_STARTED_AT,
      canSleep: true,
    },
    10000
  );
  if (res.status !== 200 || !res.body?.pcId) {
    throw new Error(`enroll failed (HTTP ${res.status}${res.body?.error ? `: ${res.body.error}` : ""})`);
  }
  PC_ID = Number(res.body.pcId);
  TOKEN = res.body.token;
  IDENTITY_SOURCE = "enrolled";
  saveIdentity();

  const name = res.body.name || `PC-${PC_ID}`;
  const before = Number(res.body.seatsBefore);
  const counted = Number.isFinite(before) ? `${before} system(s) already registered - ` : "";
  console.log(
    `Enrolled as ${name}${res.body.reclaimed ? " (reclaimed this machine's old seat)" : " (new seat)"} - identity saved to data/identity.json`
  );
  console.log(`${counted}this machine is ${name}.`);
  return PC_ID;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------- discovery ----------------

const DISCOVERY_PORT = 41888;
const MAGIC = "LABNEXUS_DISCOVER_V1";

function discoverServer(timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket({ type: "udp4" });
    let settled = false;

    let iv = null;

    const stop = () => {
      if (iv) { clearInterval(iv); iv = null; }
      try { sock.close(); } catch (_) {}
    };

    sock.on("message", (msg, rinfo) => {
      try {
        const reply = JSON.parse(msg.toString());
        if (reply.labnexus && !settled) {
          settled = true;
          const addr = `http://${rinfo.address}:${reply.httpPort}`;
          stop();
          resolve(addr);
        }
      } catch (_) {}
    });

    sock.on("error", () => {}); // send errors (unreachable nets) must not crash

    sock.bind(() => {
      try { sock.setBroadcast(true); } catch (_) {}
      const pkt = Buffer.from(MAGIC);
      const targets = getBroadcastAddrs();
      console.log(`Discovering: probing ${targets.join(", ")} on UDP ${DISCOVERY_PORT}…`);

      const sendAll = () => {
        if (settled) return;
        for (const addr of targets) {
          try { sock.send(pkt, DISCOVERY_PORT, addr, () => {}); } catch (_) {}
        }
      };

      sendAll();
      iv = setInterval(sendAll, 1000); // broadcasts get lost on wifi; retry

      setTimeout(() => {
        stop();
        if (!settled) {
          reject(new Error(
            `No LabNexus server replied within ${timeoutMs / 1000}s ` +
            `(probed: ${targets.join(", ")})`
          ));
        }
      }, timeoutMs);
    });
  });
}

// Fallback for wifi networks that block UDP broadcast:
// try a plain TCP /api/health GET against each host in the local subnet,
// honouring the real netmask up to at most 4094 addresses.
function tcpSweep(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const myIp = localIp();
    if (!myIp) return reject(new Error("no IPv4 network interface"));

    const iface = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal && i.address === myIp);
    const mask = iface?.netmask || "255.255.255.0";
    const ipN = ipToInt(myIp);
    const maskN = ipToInt(mask);
    const netN = ipN & maskN;
    const hostCount = (~maskN >>> 0) + 1; // e.g. /24 -> 256, /20 -> 4096
    const scanLimit = Math.min(hostCount, 4096);

    const candidates = [];
    for (let i = 1; i < scanLimit - 1; i++) candidates.push(intToIp(netN + i));

    console.log(
      `Sweeping ${candidates.length} hosts in ${intToIp(netN)}/${maskToCidr(maskN)} for a LabNexus server…`
    );

    let found = null;
    let done = 0;

    const timer = setTimeout(() => finish(new Error("sweep timeout")), timeoutMs);

    function finish(err) {
      if (found) return resolve(found);
      clearTimeout(timer);
      reject(err);
    }

    for (const ip of candidates) {
      if (ip === myIp) { done++; continue; }
      const req = http.get(
        { host: ip, port: 8000, path: "/api/health", timeout: 700 },
        (res) => {
          let body = "";
          res.on("data", (ch) => (body += ch));
          res.on("end", () => {
            if (!found && body.includes("LabNexus")) {
              found = `http://${ip}:8000`;
              finish();
            }
          });
        }
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => { done++; if (done >= candidates.length && !found) finish(new Error("no host replied")); });
    }
  });
}

function ipToInt(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function intToIp(n) {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
}

function maskToCidr(maskN) {
  let n = maskN >>> 0;
  let cidr = 0;
  while (n & 1) { cidr++; n >>>= 1; }
  return cidr;
}

function printDiagnostics() {
  console.log("\n--- network diagnostics ---");
  console.log(`Hostname : ${os.hostname()}`);
  console.log(`My IP(s) : ${getBroadcastAddrs().join(", ")}`);
  console.log("Checklist:");
  console.log("  1. Is the admin server running on the other laptop? (npm start in admin/)");
  console.log("  2. Are both laptops on the SAME wifi network?");
  console.log("  3. Firewall: run the allow rules in README section 1 on the ADMIN laptop");
  console.log("     (check the network profile: netsh advfirewall show allprofiles)");
  console.log("  4. Some wifi routers isolate devices from each other (AP isolation) —");
  console.log("     try a phone hotspot or a different network to confirm");
  console.log("---------------------------\n");
}

function getBroadcastAddrs() {
  const out = new Set(["255.255.255.255"]);
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) {
      if (i.family === "IPv4" && !i.internal) {
        const ip = i.address;
        const mask = i.netmask;
        const [a, b, c, d] = ip.split(".").map(Number);
        const [m1, m2, m3, m4] = mask.split(".").map(Number);
        const bc = [a | (~m1 & 255), b | (~m2 & 255), c | (~m3 & 255), d | (~m4 & 255)].join(".");
        out.add(bc);
      }
    }
  }
  return [...out];
}

// ---------------- HTTP helpers ----------------

function request(method, path, data = null, timeoutMs = 5000) {
  const url = new URL(path, SERVER_URL);
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? require("https") : require("http");
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          "X-PC-Token": TOKEN,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let parsed = {};
          try {
            parsed = JSON.parse(body);
          } catch (_) {
            parsed = { raw: body.slice(0, 200) };
          }
          // status is returned so callers can tell "wrong token" (401) from
          // "someone else owns this pcId" (409) from a wifi hiccup (reject).
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// ---------------- main loop ----------------

let SERVER_URL = null;
let lastCommandId = null;
let serverWasUp = true;
let consecutiveFailures = 0;

function localIp() {
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

function mac() {
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) {
      if (i.family === "IPv4" && !i.internal && i.mac !== "00:00:00:00:00:00") return i.mac;
    }
  }
  return null;
}

// Outcome of one registration attempt:
//   "ok"           - accepted, keep polling
//   "transient"    - network/unknown problem, back off and retry
//   "conflict"     - this pcId belongs to another laptop (needs an admin fix)
//   "unauthorized" - token does not match the server's record
async function tryRegister() {
  // A delivered folder that was already enrolled on another PC has no usable
  // identity; a fresh machine has none at all. Either way, ask for a seat.
  if (!PC_ID || !TOKEN) {
    try {
      await enroll();
    } catch (err) {
      registerFailures++;
      console.log(`Could not enroll yet (${err.message}) - retrying.`);
      return "transient";
    }
  }

  let res;
  try {
    res = await request("POST", "/api/agent/register", {
      pcId: PC_ID,
      // Deliberately no `name`: the server keeps the numbered seat name (PC-N).
      token: TOKEN, // server also accepts the header; body keeps older servers working
      hostname: os.hostname(),
      ip: localIp(),
      mac: mac(),
      agentVersion: AGENT_VERSION,
      agentStartedAt: AGENT_STARTED_AT,
      canSleep: true,
    });
  } catch (err) {
    registerFailures++;
    console.log(`Registration attempt failed (${err.message}) — retrying.`);
    return "transient";
  }

  const { status, body } = res;

  if (status === 200 && body?.ok) {
    registerFailures = 0;
    registered = true;
    console.log(`Registered as PC-${PC_ID} (${PC_NAME}) at ${SERVER_URL}`);
    return "ok";
  }

  if (status === 409 || body?.code === "PC_ID_TAKEN") {
    // This config was copied from another laptop. Nothing for the admin to edit:
    // this machine simply enrolls for a seat of its own and retries.
    console.error("");
    console.error(`PC-${PC_ID} already belongs to another laptop.`);
    console.error("Enrolling this machine with its own id + token automatically...");
    console.error("");
    try {
      await enroll();
      registerFailures = 0;
      return "transient"; // next attempt registers under the new identity
    } catch (err) {
      registerFailures++;
      console.error(`Automatic enrollment failed (${err.message}) - retrying.`);
      return "transient";
    }
  }

  if (status === 401) {
    console.error(`The server rejected this PC's token (PC-${PC_ID}) - enrolling this machine again.`);
    try {
      await enroll();
      registerFailures = 0;
      return "transient";
    } catch (err) {
      registerFailures++;
      console.error(`Automatic enrollment failed (${err.message}) - retrying.`);
      return "transient";
    }
  }

  registerFailures++;
  console.log(`Unexpected registration response (HTTP ${status}) — retrying.`);
  return "transient";
}

// Keep trying until the server accepts us. A lab PC must come up by itself after
// a reboot even if the admin laptop is still booting, so transient failures back
// off and retry forever instead of exiting (the old behaviour killed the agent).
let registered = false;
let registerFailures = 0;

async function registerUntilAccepted() {
  for (;;) {
    const outcome = await tryRegister();
    if (outcome === "ok") return true;

    if (outcome === "conflict" || outcome === "unauthorized") {
      // config problem only an admin can fix: check back, but stop spamming
      await sleep(30000);
      continue;
    }
    const wait = Math.min(15000, 1000 * 2 ** Math.min(registerFailures, 4));
    await sleep(wait);
  }
}

async function pollOnce() {
  if (!SERVER_URL) return;
  try {
    const { status, body: r } = await request("POST", "/api/agent/heartbeat", {
      pcId: PC_ID,
      enforced: overlay.isLocked(),
      osUser: os.userInfo().username,
      idleSeconds: getIdleSeconds(),
      canSleep: true,
      agentStartedAt: AGENT_STARTED_AT,
    });

    if (status === 404) {
      // The admin server restarted with an empty state file, so this seat no
      // longer exists. Re-register instead of polling a seat that is not there.
      console.log("Server no longer knows this PC — re-registering.");
      registered = false;
      consecutiveFailures = 0;
      await registerUntilAccepted();
      return;
    }

    if (status === 401) {
      consecutiveFailures++;
      if (consecutiveFailures === 1 || consecutiveFailures % 20 === 0) {
        console.error(`Server rejected this PC's token (HTTP 401) - enrolling this machine again.`);
      }
      try {
        await enroll();
        registered = false;
        await registerUntilAccepted();
      } catch (_) {
        // back off; the next poll tries again
      }
      return;
    }

    if (!serverWasUp) {
      console.log("Server is back up.");
      serverWasUp = true;
    }
    consecutiveFailures = 0;

    // execute at most one command per poll
    if (r.command) handleCommand(r.command);

    // keep overlay in sync with desired state (fail-closed safety net)
    applyDesired(r.desired, r.grant);

  } catch (err) {
    consecutiveFailures++;
    if (serverWasUp) {
      console.log(`Cannot reach server: ${err.message} — remaining LOCKED (fail closed)`);
      serverWasUp = failClosed();
    }
    if (consecutiveFailures % 10 === 0) {
      console.log(`Still offline (${consecutiveFailures} failed polls). Retrying discovery…`);
      tryReDiscover();
    }
  }
}

function failClosed() {
  // never silently unlock when the server is unreachable
  overlay.lock("SERVER UNREACHABLE — locked for safety");
  return false;
}

let rediscovering = false;
async function tryReDiscover() {
  if (rediscovering) return;
  rediscovering = true;
  try {
    const addr = await discoverServer(3000);
    if (addr !== SERVER_URL) console.log(`Server moved: ${SERVER_URL} -> ${addr}`);
    SERVER_URL = addr;
  } catch (_) {
    try {
      const addr = await tcpSweep(8000);
      if (addr !== SERVER_URL) console.log(`Server found via sweep: ${addr}`);
      SERVER_URL = addr;
    } catch (_) {
      // stay on current URL; will retry
    }
  } finally {
    rediscovering = false;
  }
}

// ---------------- command handling ----------------

function handleCommand(cmd) {
  if (cmd.id === lastCommandId) return;
  lastCommandId = cmd.id;
  console.log(`Command: ${cmd.command}`, cmd.params || "");

  switch (cmd.command) {
    case "LOCKED":
      overlay.lock(cmd.params?.reason || "Locked by administrator");
      break;
    case "UNLOCKED":
      overlay.unlock();
      break;
    case "SLEEPING":
      localSleep();
      break;
    case "MESSAGE":
      if (overlay.isLocked()) overlay.showMessage(cmd.params?.text || "");
      else overlay.showToast(cmd.params?.text || "");
      break;
    case "REBOOT": {
      const delay = Math.max(0, Math.min(60, Number(cmd.params?.delaySec ?? 10)));
      console.log(`Rebooting in ${delay}s`);
      if (process.platform === "win32") {
        exec(`shutdown /r /t ${delay}`);
      } else if (process.platform === "linux") {
        exec("systemctl reboot || shutdown -r now");
      } else if (process.platform === "darwin") {
        exec("osascript -e 'tell app \"System Events\" to restart'");
      }
      break;
    }
    default:
      console.log(`Unknown command: ${cmd.command}`);
  }
}

function localSleep() {
  // Windows: standard library approach via shutdown/rundll32
  if (process.platform === "win32") {
    // rundll32 works without admin on default Windows setups
    exec("rundll32.exe powrprof.dll,SetSuspendState 0,1,0", (err) => {
      if (err) console.error("Sleep failed:", err.message);
    });
  } else if (process.platform === "linux") {
    exec("systemctl suspend", (err) => {
      if (err) console.error("Sleep failed:", err.message);
    });
  } else if (process.platform === "darwin") {
    exec("pmset sleepnow", (err) => {
      if (err) console.error("Sleep failed:", err.message);
    });
  } else {
    console.log("Sleep unsupported on this platform");
  }
}

// ---------------- desired-state sync (fail closed) ----------------

// Three rules, in this order - deliberately fail-closed:
//   1. the admin says LOCKED            -> locked, whatever else is true
//   2. there is no live grant           -> locked (expired or never granted)
//   3. a live grant is the only reason a seat may be open
function applyDesired(desired, grant) {
  const now = Date.now();
  const active = grant && now < grant.endAt ? grant : null;

  if (desired === "LOCKED") {
    if (!overlay.isLocked()) overlay.lock("Locked by administrator");
    return;
  }

  if (!active) {
    // covers desired=SLEEPING (grants are revoked on sleep) and any moment
    // where the server has not yet handed us the grant object
    if (!overlay.isLocked()) overlay.lock("Grant expired");
    return;
  }

  if (overlay.isLocked()) overlay.unlock();

  // pre-warn before expiry so there is never an abrupt cut-off
  const msLeft = active.endAt - now;
  if (msLeft > 0 && msLeft < 30000 && !overlay.expiryWarned()) {
    overlay.showCountdown(msLeft);
  }
}

// ---------------- overlay watchdog ----------------
// Students close the overlay with Alt+F4. While we are supposed to be
// locked, re-spawn it if it disappears. Runs every second.
setInterval(() => {
  if (overlay.isLocked() && !overlay.overlayAlive()) {
    console.log("[watchdog] overlay gone while locked - re-spawning");
    overlay.lock(lockReasonCache || "Locked by administrator");
  }
}, 1000);
let lockReasonCache = "Locked by administrator";
const origLock = overlay.lock;
overlay.lock = (reason) => {
  lockReasonCache = reason || lockReasonCache;
  return origLock(reason);
};

// ---------------- idle detection (best effort) ----------------

function getIdleSeconds() {
  // Best-effort: v1 uses process uptime as a stand-in.
  // A native module (e.g. GetLastInputInfo) would be needed for real idle.
  return null;
}

// ---------------- boot ----------------

// Find the admin server. Unlike v1 this never gives up: the admin laptop may
// boot minutes after the lab PCs, so we keep probing (broadcast, then sweep)
// and stay locked until we find it.
async function findServer() {
  for (let attempt = 1; ; attempt++) {
    try {
      SERVER_URL = await discoverServer(6000);
      console.log(`Found server at ${SERVER_URL}`);
      return true;
    } catch (err) {
      console.error(err.message);
      if (attempt === 1) console.log("Trying a TCP sweep of the subnet instead (slower)…");
      try {
        SERVER_URL = await tcpSweep(12000);
        console.log(`Found server at ${SERVER_URL} (via TCP sweep)`);
        return true;
      } catch (err2) {
        console.error(`TCP sweep found nothing: ${err2.message}`);
        if (attempt === 1) printDiagnostics();
        console.log("Still searching — is labnexus running on the admin laptop? Retrying in 10s.\n");
        await sleep(10000);
      }
    }
  }
}

// Identity precedence: this machine's saved identity beats the shipped
// config.json, so copies of the folder never fight over one seat. A machine
// with neither enrolls automatically once the server is found.
function resolveIdentity() {
  const saved = loadIdentity();
  if (saved) {
    PC_ID = Number(saved.pcId);
    TOKEN = saved.token;
    IDENTITY_SOURCE = "saved identity";
    return;
  }
  if (Number(config.pcId) > 0) {
    PC_ID = Number(config.pcId);
    TOKEN = config.token || `demo-agent-${PC_ID}`;
    IDENTITY_SOURCE = "config.json";
  }
}

async function main() {
  console.log("=============================================");
  console.log(" LabNexus PC Agent");
  console.log(
    ` PC: ${PC_NAME}  identity: ${IDENTITY_SOURCE}${PC_ID ? ` (PC-${PC_ID})` : " (will enroll)"}  agent v${AGENT_VERSION}`
  );
  console.log("=============================================");

  // Fail closed from the very first moment: until the admin says otherwise this
  // machine is locked and shows why.
  overlay.lock("Searching for lab server…");

  if (config.serverUrl) {
    SERVER_URL = config.serverUrl;
    console.log(`Using configured server: ${SERVER_URL}`);
  } else {
    console.log("Discovering LabNexus server on the LAN…");
    await findServer();
  }

  await registerUntilAccepted();

  overlay.lock("Locked by LabNexus");

  setInterval(pollOnce, config.pollMs || 3000);
  pollOnce();
}

resolveIdentity();
main();
