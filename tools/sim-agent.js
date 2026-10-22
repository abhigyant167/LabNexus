#!/usr/bin/env node
// ----------------------------------------------------------------
// LabNexus - simulated lab PC
//
// Pretends to be one lab PC so you can demo or test the dashboard
// without touching a real machine. It speaks the exact same wire
// protocol as pc-agent/agent.js.
//
//   node tools/sim-agent.js --id 5 --token lnx-5-abc...
//   node tools/sim-agent.js --id 5 --token ... --enforced false
//   node tools/sim-agent.js --id 5 --token ... --once      one heartbeat
//   node tools/sim-agent.js --list-tokens                  (reads ready/ folders)
//
// It never locks anything: it only reports what you tell it to report.
// ----------------------------------------------------------------

const http = require("http");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { args[a.slice(2)] = next; i++; }
      else args[a.slice(2)] = true;
    } else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const SERVER = (typeof args.server === "string" ? args.server : "http://127.0.0.1:8000").replace(/\/$/, "");
const PC_ID = Number(args.id);
const TOKEN = typeof args.token === "string" ? args.token : `demo-agent-${PC_ID}`;
const NAME = typeof args.name === "string" ? args.name : `SIM-PC-${PC_ID}`;
const POLL_MS = Number(args.pollMs) > 0 ? Number(args.pollMs) : 3000;
const ONCE = !!args.once;

// --enforced can be flipped at runtime: press "u" (unlocked) / "l" (locked)
let enforced = args.enforced === undefined ? true : String(args.enforced) !== "false";
const STARTED_AT = Date.now();

if (!Number.isInteger(PC_ID) || PC_ID < 1) {
  console.error("usage: node tools/sim-agent.js --id 5 [--token <token>] [--server http://127.0.0.1:8000]");
  console.error("       [--enforced true|false] [--once] [--pollMs 3000]");
  process.exit(2);
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: new URL(SERVER).hostname,
        port: new URL(SERVER).port || 80,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          "X-PC-Token": TOKEN,
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 5000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const stamp = () => new Date().toLocaleTimeString();

async function main() {
  console.log(`sim-agent: PC-${PC_ID} -> ${SERVER} (token ${TOKEN.slice(0, 10)}…)`);
  console.log(`  reporting: ${enforced ? "LOCKED (enforcing)" : "UNLOCKED"}`);

  const reg = await req("POST", "/api/agent/register", {
    pcId: PC_ID,
    name: NAME,
    token: TOKEN,
    hostname: `sim-pc-${PC_ID}`,
    ip: "127.0.0.1",
    mac: `02:00:00:00:00:${String(PC_ID).padStart(2, "0")}`,
    agentVersion: "sim-1.0.0",
    agentStartedAt: STARTED_AT,
    canSleep: true,
  });

  if (reg.status !== 200) {
    console.error(`register failed (HTTP ${reg.status}): ${reg.body.error || "unknown"}`);
    if (reg.body.hint) console.error(`  ${reg.body.hint}`);
    process.exit(1);
  }
  console.log(`  [${stamp()}] registered`);

  if (process.stdin.isTTY && !ONCE) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (key) => {
      const k = key.toString();
      if (k === "u") { enforced = false; console.log(`  reporting: UNLOCKED`); }
      else if (k === "l") { enforced = true; console.log(`  reporting: LOCKED (enforcing)`); }
      else if (k === "q" || k === "\u0003") process.exit(0);
    });
    console.log("  press u = report unlocked, l = report locked, q = quit");
  }

  const beat = async () => {
    try {
      const r = await req("POST", "/api/agent/heartbeat", {
        pcId: PC_ID,
        enforced,
        osUser: "sim",
        idleSeconds: 5,
        canSleep: true,
        agentStartedAt: STARTED_AT,
      });
      if (r.status === 404) return console.log(`  [${stamp()}] server does not know PC-${PC_ID} (forgotten?)`);
      if (r.status === 401) return console.log(`  [${stamp()}] token rejected`);
      const cmd = r.body.command;
      const g = r.body.grant;
      console.log(
        `  [${stamp()}] desired=${r.body.desired}${g ? ` grant=${g.holder} until ${new Date(g.endAt).toLocaleTimeString()}` : ""}` +
        (cmd ? `  <- COMMAND ${cmd.command}` : "")
      );
    } catch (err) {
      console.log(`  [${stamp()}] server unreachable: ${err.message}`);
    }
  };

  await beat();
  if (ONCE) return process.exit(0);

  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    await beat();
  }
}

main().catch((err) => {
  console.error(`sim-agent failed: ${err.message}`);
  process.exit(1);
});
