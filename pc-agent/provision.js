#!/usr/bin/env node
// ----------------------------------------------------------------
// LabNexus - new laptop provisioner
//
// Every lab PC needs its OWN pcId + token. Copy-pasting the same
// config.json onto two laptops is the #1 cause of "the seat keeps
// flickering between two machines", so this tool exists to make the
// correct thing the easy thing.
//
//   node provision.js --next                  allocate the next free pcId
//   node provision.js --next --server-url http://172.31.10.44:8000 --password admin123
//                                             (checks the live server for used ids)
//   node provision.js --id 7 --name PC-7      explicit identity
//   node provision.js --next --pin http://172.31.10.44:8000
//                                             (skip discovery on that laptop)
//   node provision.js --list                  what this laptop already handed out
//
// Run this ON THE ADMIN LAPTOP. It writes:
//   ready/PC-<id>/       a self-contained agent folder to copy to the new laptop
//   data/provisioned.json  the local allocation registry
// ----------------------------------------------------------------

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const http = require("http");

const HERE = __dirname;
const READY_DIR = path.join(HERE, "ready");
const DATA_DIR = path.join(HERE, "data");
const REGISTRY_FILE = path.join(DATA_DIR, "provisioned.json");

// Things that must never be copied to a student laptop
const COPY_EXCLUDE = new Set([
  "ready",
  "data",
  "node_modules",
  "provision.js",
  "NEW-LAPTOP.bat",
  "config.json", // replaced with the generated per-PC identity
]);

// ----------------------------------------------------------------
// args
// ----------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// ----------------------------------------------------------------
// registry (lives on the admin laptop)
// ----------------------------------------------------------------

function loadRegistry() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
      if (Array.isArray(parsed.entries)) return parsed;
    }
  } catch (err) {
    console.error(`Registry unreadable (${err.message}) - starting a new one.`);
  }
  return { entries: [] };
}

function saveRegistry(reg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2));
}

// ----------------------------------------------------------------
// optional: ask the running server which pcIds are already in use
// ----------------------------------------------------------------

function httpJson(method, url, { cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 4000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, body: parsed, setCookie: res.headers["set-cookie"] });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function serverUsedIds(serverUrl, password) {
  try {
    const login = await httpJson("POST", `${serverUrl}/api/auth/login`, { body: { password } });
    if (login.status !== 200) {
      console.error(`Could not log in to ${serverUrl} (HTTP ${login.status}) - ignoring server state.`);
      return { ids: new Set(), reachable: true };
    }
    const cookie = (login.setCookie || []).map((c) => c.split(";")[0]).join("; ");
    const st = await httpJson("GET", `${serverUrl}/api/state`, { cookie });
    if (st.status !== 200) return { ids: new Set(), reachable: true };
    return { ids: new Set((st.body.computers || []).map((c) => Number(c.id))), reachable: true };
  } catch (err) {
    console.error(`Server ${serverUrl} not reachable (${err.message}) - using the local registry only.`);
    return { ids: new Set(), reachable: false };
  }
}

// ----------------------------------------------------------------
// helpers
// ----------------------------------------------------------------

function localIps() {
  const out = [];
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}

function newToken(pcId) {
  // Random per-PC token: the server binds it to the seat on first registration.
  return `lnx-${pcId}-${crypto.randomBytes(12).toString("hex")}`;
}

function copyAgentFolder(destDir, config) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(HERE, { withFileTypes: true })) {
    if (COPY_EXCLUDE.has(entry.name)) continue;
    const src = path.join(HERE, entry.name);
    const dst = path.join(destDir, entry.name);
    if (entry.isDirectory()) fs.cpSync(src, dst, { recursive: true });
    else fs.copyFileSync(src, dst);
  }
  fs.writeFileSync(path.join(destDir, "config.json"), JSON.stringify(config, null, 2) + "\n");
}

function banner(title) {
  console.log("");
  console.log("=".repeat(60));
  console.log(` ${title}`);
  console.log("=".repeat(60));
}

// ----------------------------------------------------------------
// main
// ----------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reg = loadRegistry();

  if (args.list) {
    banner("LabNexus - provisioned identities (this laptop)");
    if (reg.entries.length === 0) {
      console.log(" None yet. Run:  node provision.js --next");
    } else {
      for (const e of reg.entries) {
        console.log(` PC-${String(e.pcId).padStart(3, " ")}  ${e.name.padEnd(18)} created ${e.createdAt.slice(0, 16)}  ->  ${e.folder}`);
      }
    }
    console.log("");
    const ips = localIps();
    console.log(` Admin laptop IPs: ${ips.length ? ips.join(", ") : "none found"}`);
    console.log("");
    return 0;
  }

  // --server-url + --password describe where to LOOK for already-used pcIds.
  // --pin is the separate, deliberate act of hard-coding a server address into
  // the generated config (discovery stays on unless you ask for this).
  const lookupUrl = typeof args["server-url"] === "string" ? args["server-url"].replace(/\/$/, "") : null;
  let pinnedUrl = "";
  if (typeof args.pin === "string") pinnedUrl = args.pin.replace(/\/$/, "");
  else if (args.pin === true && lookupUrl) pinnedUrl = lookupUrl;

  let usedOnServer = new Set();
  if (lookupUrl && typeof args.password === "string") {
    const r = await serverUsedIds(lookupUrl, args.password);
    usedOnServer = r.ids;
  } else if (lookupUrl) {
    console.log("Note: --server-url without --password can only be used for --pin.");
  }

  const usedLocally = new Set(reg.entries.map((e) => Number(e.pcId)));

  // The folder's own config.json ships claiming pcId 1 (this machine's agent).
  // Allocating 1 to some other laptop would make the two indistinguishable, so
  // treat it as taken unless the caller is explicit.
  try {
    const shipped = JSON.parse(fs.readFileSync(path.join(HERE, "config.json"), "utf8"));
    if (Number(shipped.pcId) > 0) usedLocally.add(Number(shipped.pcId));
  } catch (_) {}

  let pcId;
  if (args.id !== undefined && args.id !== true) {
    pcId = Number(args.id);
    if (!Number.isInteger(pcId) || pcId < 1 || pcId > 10000) {
      console.error("--id must be an integer between 1 and 10000");
      return 2;
    }
    if (usedLocally.has(pcId) && !args.force) {
      console.error(`PC-${pcId} already provisioned from this laptop (see: node provision.js --list).`);
      console.error("Pick another id, or pass --force to hand out a new token for the same seat.");
      return 2;
    }
  } else {
    // --next: first free id, counting both local allocations and live seats
    pcId = 1;
    while (usedLocally.has(pcId) || usedOnServer.has(pcId)) pcId++;
  }

  const name = typeof args.name === "string" ? args.name : `PC-${pcId}`;
  const token = typeof args.token === "string" ? args.token : newToken(pcId);
  const config = {
    pcId,
    token,
    serverUrl: pinnedUrl,
    pollMs: 3000,
  };

  const folder = path.join(READY_DIR, `PC-${pcId}`);
  copyAgentFolder(folder, config);

  // keep the shipped example config honest about pcId 1
  reg.entries = reg.entries.filter((e) => Number(e.pcId) !== pcId);
  reg.entries.push({
    pcId,
    name,
    token,
    createdAt: new Date().toISOString(),
    folder: path.relative(HERE, folder),
  });
  reg.entries.sort((a, b) => Number(a.pcId) - Number(b.pcId));
  saveRegistry(reg);

  banner(`LabNexus - ready: ${name}`);
  console.log(` pcId       : ${pcId}      (unique per laptop - never reuse it)`);
  console.log(` token      : ${token}`);
  console.log(` serverUrl  : ${config.serverUrl || "(empty - auto-discovery)"}`);
  console.log(` lookup     : ${lookupUrl && typeof args.password === "string" ? `checked ${usedOnServer.size} live seats on ${lookupUrl}` : "local registry only"}`);
  console.log(` folder     : ${folder}`);
  console.log("");
  console.log(" On the new laptop:");
  console.log("   1. Copy that folder across (USB stick or cloud link - email may");
  console.log("      block or strip .bat files inside archives).");
  console.log("   2. Install Node.js 18+ if it is missing (nodejs.org).");
  console.log("   3. Double-click START-AGENT.bat.");
  console.log("");
  const ips = localIps();
  console.log(` Admin laptop IPs: ${ips.length ? ips.join(", ") : "none found"}`);
  console.log(" If discovery fails, put one of those in config.json as");
  console.log(' "serverUrl": "http://<that-ip>:8000" and restart the agent.');
  console.log("");
  return 0;
}

main().then(
  (code) => process.exit(code || 0),
  (err) => {
    console.error(`provision failed: ${err.message}`);
    process.exit(1);
  }
);
