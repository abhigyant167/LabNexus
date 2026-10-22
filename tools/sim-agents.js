#!/usr/bin/env node
// ----------------------------------------------------------------
// LabNexus - fake lab PCs
//
// Enrolls N seats on a running admin server and keeps heartbeating them, so a
// demo (or a walkthrough review) can show attendance, allocation and locking
// without opening real laptops.
//
//   node tools/sim-agents.js http://localhost:8100 6
//   node tools/sim-agents.js http://localhost:8100 6 --minutes 5
// ----------------------------------------------------------------

const BASE = process.argv[2] || "http://localhost:8000";
const COUNT = Math.max(1, Math.min(40, Number(process.argv[3]) || 4));
const MINUTES = Number((process.argv.find((a) => a.startsWith("--minutes=")) || "").split("=")[1]) || 30;

const agents = [];

async function call(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["X-PC-Token"] = token;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

(async () => {
  for (let i = 1; i <= COUNT; i++) {
    const mac = `aa:bb:cc:00:${String(10 + i).padStart(2, "0")}:01`;
    const r = await call("POST", "/api/agent/enroll", {
      hostname: `sim-lab-pc-${i}`,
      ip: `10.20.0.${10 + i}`,
      mac,
      agentVersion: "sim",
      canSleep: false,
    });
    if (!r.ok) {
      console.log(`seat ${i}: enroll failed (${r.status}) ${JSON.stringify(r.data)}`);
      continue;
    }
    agents.push({ pcId: r.data.pcId, name: r.data.name, token: r.data.token, mac });
    console.log(`seat ${r.data.name} enrolled (pcId ${r.data.pcId})`);
  }

  async function beat() {
    for (const a of agents) {
      const r = await call("POST", "/api/agent/register", {
        pcId: a.pcId,
        name: a.name,
        token: a.token,
        hostname: `sim-lab-pc-${a.pcId}`,
        ip: `10.20.0.${10 + a.pcId}`,
        mac: a.mac,
        agentVersion: "sim",
        canSleep: false,
      }, a.token);
      if (!r.ok) console.log(`heartbeat ${a.name}: ${r.status} ${JSON.stringify(r.data)}`);
    }
  }

  await beat();
  const timer = setInterval(beat, 3000);
  setTimeout(() => {
    clearInterval(timer);
    console.log(`done: ${agents.length} seat(s) stopped after ${MINUTES} min`);
    process.exit(0);
  }, MINUTES * 60000);
})();
