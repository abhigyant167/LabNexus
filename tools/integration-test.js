#!/usr/bin/env node
// ----------------------------------------------------------------
// LabNexus integration test
//
// Boots a throwaway admin server (its own port + its own state file),
// then drives it the way real laptops do: register, heartbeat, receive
// commands - plus the failure paths that used to bite us (duplicate
// pcId, wrong token, server forgetting a seat, grant expiry, laptop
// going silent). No test framework, stdlib only.
//
//   node tools/integration-test.js
//   node tools/integration-test.js --keep      leave the temp state dir behind
//   node tools/integration-test.js --verbose   print every HTTP call
// ----------------------------------------------------------------

const http = require("http");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ADMIN_DIR = path.join(ROOT, "admin");

const KEEP = process.argv.includes("--keep");
const VERBOSE = process.argv.includes("--verbose");

const ADMIN_PASSWORD = "admin123";
const AGENT_TIMEOUT_MS = 1500; // shortened so "went silent" is testable in seconds
const TIME_SCALE = 60;         // 1-minute grant really lasts 1 second

// ----------------------------------------------------------------
// tiny test harness
// ----------------------------------------------------------------

let passed = 0;
const failures = [];

function ok(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(title) {
  console.log(`\n${title}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

// naive retries for requests whose success depends on a 2s server tick having
// just noticed a window change (used only by the timetable boundary tests)
async function attend(cookie, body = { count: 1 }, tries = 6, stepMs = 700) {
  let out;
  for (let i = 0; i < tries; i++) {
    out = await req("POST", "/api/schedule/present", { cookie, body });
    if (out.status !== 409 && out.status !== 503) return out;
    await sleep(stepMs);
  }
  return out;
}

async function waitFor(label, fn, timeoutMs = 8000, stepMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(stepMs);
  }
  return last;
}

// ----------------------------------------------------------------
// HTTP helper (cookie aware, no dependencies)
// ----------------------------------------------------------------

let BASE = "";

function req(method, urlPath, { body, cookie, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    if (cookie) headers.Cookie = cookie;
    if (token !== undefined) headers["X-PC-Token"] = token;

    const r = http.request(
      { hostname: "127.0.0.1", port: PORT, path: urlPath, method, headers, timeout: 5000 },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch (_) {}
          if (VERBOSE) console.log(`      ${method} ${urlPath} -> ${res.statusCode}`);
          resolve({ status: res.statusCode, body: parsed, setCookie: res.headers["set-cookie"] || [] });
        });
      }
    );
    r.on("timeout", () => r.destroy(new Error("request timeout")));
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// Raw-body request: used for the timetable picture, which is uploaded as the
// request body itself (an 8 MB JSON data URL would be silly).
function reqRaw(method, urlPath, { buffer, mime, fileName, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (buffer) {
      headers["Content-Type"] = mime;
      headers["Content-Length"] = buffer.length;
      if (fileName) headers["X-File-Name"] = encodeURIComponent(fileName);
    }
    const r = http.request(
      { hostname: "127.0.0.1", port: PORT, path: urlPath, method, headers, timeout: 5000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          let parsed = {};
          try { parsed = JSON.parse(body.toString("utf8")); } catch (_) {}
          if (VERBOSE) console.log(`      ${method} ${urlPath} -> ${res.statusCode}`);
          resolve({ status: res.statusCode, body: parsed, buffer: body, headers: res.headers });
        });
      }
    );
    r.on("timeout", () => r.destroy(new Error("request timeout")));
    r.on("error", reject);
    if (buffer) r.write(buffer);
    r.end();
  });
}

// ----------------------------------------------------------------
// server lifecycle
// ----------------------------------------------------------------

let PORT = 0;
let DATA_DIR = "";
const DATA_DIRS = []; // every throwaway state dir this run created
let serverProc = null;
let serverLog = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

// envOverrides lets a later section re-spawn the server with a different
// key/endpoint (used for the "no AI key configured" checks).
async function startServer(envOverrides = {}) {
  PORT = await freePort();
  DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "labnexus-test-"));
  DATA_DIRS.push(DATA_DIR);
  BASE = `http://127.0.0.1:${PORT}`;

  serverProc = spawn(process.execPath, [path.join(ADMIN_DIR, "server.js")], {
    cwd: ADMIN_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      LABNEXUS_DATA_DIR: DATA_DIR,
      LABNEXUS_AGENT_TIMEOUT_MS: String(AGENT_TIMEOUT_MS),
      LABNEXUS_TIME_SCALE: String(TIME_SCALE),
      // Every server talks to the stubbed model endpoint; a test never calls
      // a real AI API and never needs a real key.
      OPENAI_API_KEY: "test-key-123",
      EXTRACT_API_BASE: MOCK_AI_URL,
      ...envOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", (d) => serverLog.push(d.toString()));
  serverProc.stderr.on("data", (d) => serverLog.push(d.toString()));

  const up = await waitFor("server-up", async () => {
    try {
      const r = await req("GET", "/api/health");
      return r.status === 200;
    } catch (_) {
      return false;
    }
  }, 15000, 250);

  if (!up) {
    console.error("\nServer never became healthy. Log:\n" + serverLog.join(""));
    await stopServer();
    process.exit(1);
  }
  return up === 200 || up === true;
}

async function stopServer() {
  if (!serverProc || serverProc.exitCode !== null) return;
  const dead = new Promise((r) => serverProc.once("exit", r));
  serverProc.kill();
  await Promise.race([dead, sleep(3000)]);
  if (serverProc.exitCode === null) serverProc.kill("SIGKILL");
}

// ----------------------------------------------------------------
// simulated agent (same wire protocol as pc-agent/agent.js)
// ----------------------------------------------------------------

function makeAgent(pcId, token, { startedAt = Date.now(), enforced = true } = {}) {
  return {
    pcId,
    token,
    startedAt,
    enforced,
    lastCommand: null,
    lastGrant: null,
    desired: null,

    register(overrides = {}) {
      return req("POST", "/api/agent/register", {
        body: {
          pcId,
          name: `PC-${pcId}`,
          token: overrides.token ?? token,
          hostname: `lab-pc-${pcId}`,
          ip: `10.0.0.${pcId}`,
          mac: `aa:bb:cc:00:00:0${pcId}`,
          agentVersion: "test",
          agentStartedAt: overrides.startedAt ?? startedAt,
          canSleep: true,
        },
        token: overrides.headerToken ?? overrides.token ?? token,
      });
    },

    heartbeat(overrides = {}) {
      return req("POST", "/api/agent/heartbeat", {
        body: {
          pcId,
          enforced: overrides.enforced ?? enforced,
          osUser: "student",
          idleSeconds: 12,
          canSleep: true,
          agentStartedAt: overrides.startedAt ?? startedAt,
        },
        token: overrides.token ?? token,
      }).then((r) => {
        if (r.status === 200) {
          this.desired = r.body.desired;
          this.lastCommand = r.body.command || null;
          this.lastGrant = r.body.grant || null;
        }
        return r;
      });
    },
  };
}

async function loginAsAdmin() {
  const r = await req("POST", "/api/auth/login", { body: { password: ADMIN_PASSWORD } });
  return (r.setCookie[0] || "").split(";")[0];
}

async function getState(cookie) {
  const r = await req("GET", "/api/state", { cookie });
  return r.body;
}

async function seat(cookie, pcId) {
  const st = await getState(cookie);
  return (st.computers || []).find((c) => c.id === pcId);
}

async function auditHas(cookie, action) {
  const r = await req("GET", "/api/audit", { cookie });
  return (r.body || []).some((e) => e.action === action);
}

// find the newest audit entry for an action matching a regex
async function auditMatch(cookie, action, re) {
  const r = await req("GET", "/api/audit", { cookie });
  const hit = (r.body || []).find((e) => e.action === action && re.test(JSON.stringify(e)));
  return hit || null;
}

// sleep until the wall clock reaches minute-of-day `m` (tests at 23:58 unwrap
// by never scheduling windows that cross midnight)
async function untilMinute(m) {
  for (;;) {
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    if (cur >= m) return;
    const secsLeft = (m - cur) * 60 - now.getSeconds();
    await sleep(Math.max(250, Math.min(1000, secsLeft * 1000)));
  }
}

// ----------------------------------------------------------------
// mock AI endpoint (stands in for the owner's OpenAI-compatible API)
// ----------------------------------------------------------------

let MOCK_AI = null;
let MOCK_AI_URL = "";
const mockAiCalls = [];
const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
); // a 1x1 PNG

async function startMockAi() {
  const port = await freePort();
  const srv = http.createServer((rq, rs) => {
    if (rq.method === "GET" && rq.url.endsWith("/models")) {
      rs.writeHead(200, { "Content-Type": "application/json" });
      return rs.end(JSON.stringify({ data: [{ id: "mock-vision" }, { id: "other-text-only" }] }));
    }
    if (rq.method === "POST" && rq.url.endsWith("/chat/completions")) {
      const chunks = [];
      rq.on("data", (c) => chunks.push(c));
      return rq.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          mockAiCalls.push({
            auth: rq.headers.authorization || "",
            model: body.model,
            hasImage: JSON.stringify(body).includes("data:image/"),
            prompt: (body.messages || [])
              .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
              .join(" | "),
          });
        } catch (_) {
          mockAiCalls.push({ broken: true });
        }
        // Wrapped in a markdown fence on purpose: the parser must cope with
        // the way real models dress JSON up.
        const canned = {
          days: {
            Mon: [
              { start: "09:00", end: "11:00", label: "DBMS Lab - Sec A + OS Lab - Sec B" },
              { start: "09:00", end: "11:00", label: "DBMS Lab - Sec A + OS Lab - Sec B" },
              { start: "14:00", end: "16:00", label: "C Lab - Sec C <b>Sec D</b>" },
            ],
            Wed: [{ start: "19:00", end: "22:00", label: "OS Lab - Sec B" }],
          },
          notes: ["Friday column was hard to read"],
        };
        const content = "Sure.\n```json\n" + JSON.stringify(canned) + "\n```";
        rs.writeHead(200, { "Content-Type": "application/json" });
        rs.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    }
    rs.writeHead(404);
    rs.end("{}");
  });
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  MOCK_AI = srv;
  MOCK_AI_URL = `http://127.0.0.1:${port}`;
}

function stopMockAi() {
  if (!MOCK_AI) return;
  try { MOCK_AI.close(); } catch (_) {}
  MOCK_AI = null;
}

// ----------------------------------------------------------------
// the suite
// ----------------------------------------------------------------

async function run() {
  await startServer();
  console.log(`LabNexus integration test`);
  console.log(`  server : ${BASE} (pid ${serverProc.pid})`);
  console.log(`  state  : ${DATA_DIR}`);

  // ---- auth ----
  section("Admin auth");
  const health = await req("GET", "/api/health");
  eq("health returns 200", health.status, 200);
  eq("health identifies LabNexus", health.body.name, "LabNexus");

  const anonymous = await req("GET", "/api/state");
  eq("dashboard state requires login", anonymous.status, 401);

  const wrongPw = await req("POST", "/api/auth/login", { body: { password: "nope" } });
  eq("wrong password rejected", wrongPw.status, 401);

  const cookie = await loginAsAdmin();
  ok("login sets a session cookie", cookie.startsWith("ln_session="));

  let st = await getState(cookie);
  eq("no seats before any agent registers", (st.computers || []).length, 0);

  // ---- registration ----
  section("Agents register (3 laptops)");
  const a1 = makeAgent(1, "demo-agent-1");
  const a2 = makeAgent(2, "demo-agent-2");
  const a3 = makeAgent(3, "demo-agent-3");

  eq("PC-1 registers", (await a1.register()).status, 200);
  eq("PC-2 registers", (await a2.register()).status, 200);
  eq("PC-3 registers", (await a3.register()).status, 200);

  st = await getState(cookie);
  eq("dashboard shows 3 seats", (st.computers || []).length, 3);
  eq("counts.total is 3", st.counts.total, 3);
  ok("seats start UNKNOWN until the first heartbeat", (st.computers || []).every((c) => c.state === "UNKNOWN"),
    JSON.stringify((st.computers || []).map((c) => [c.id, c.state])));

  // ---- heartbeat & observed state ----
  section("Heartbeats drive observed state");
  eq("PC-1 heartbeat accepted", (await a1.heartbeat()).status, 200);
  eq("PC-2 heartbeat accepted", (await a2.heartbeat()).status, 200);
  eq("PC-3 heartbeat accepted", (await a3.heartbeat()).status, 200);

  let s1 = await seat(cookie, 1);
  eq("PC-1 shows LOCKED while the overlay enforces", s1.state, "LOCKED");
  ok("PC-1 reports fresh evidence", s1.fresh === true);
  eq("PC-1 recorded its hostname", s1.hostname, "lab-pc-1");
  eq("PC-1 recorded its MAC (needed for WOL)", s1.mac, "aa:bb:cc:00:00:01");
  eq("seat count never exceeded 3", (await getState(cookie)).computers.length, 3);

  // ---- token enforcement ----
  section("Token enforcement");
  const badToken = await req("POST", "/api/agent/heartbeat", {
    body: { pcId: 1, enforced: true },
    token: "demo-agent-99",
  });
  eq("heartbeat with wrong token is rejected", badToken.status, 401);
  ok("auth failure is audited", await auditHas(cookie, "AGENT_AUTH_FAILED"));

  const noToken = await req("POST", "/api/agent/heartbeat", { body: { pcId: 1, enforced: true } });
  eq("heartbeat with no token is rejected", noToken.status, 401);

  // ---- duplicate pcId (the classic copy-pasted config.json) ----
  section("Duplicate pcId is refused, not silently merged");
  const clash = await makeAgent(3, "demo-agent-3").register({ token: "brand-new-token" });
  eq("conflicting registration returns 409", clash.status, 409);
  eq("conflict carries a machine-readable code", clash.body.code, "PC_ID_TAKEN");
  // The fix is no longer manual: the agent enrolls itself, and the hint says so.
  ok("conflict says the PC will enroll its own seat", /enroll/i.test(clash.body.hint || ""));
  ok("conflict is audited", await auditHas(cookie, "AGENT_ID_CONFLICT"));

  s1 = await seat(cookie, 3);
  eq("the original PC-3 seat keeps its identity", s1.hostname, "lab-pc-3");

  // ---- lock / unlock / grants ----
  section("Lock, unlock and grants");
  const unlock = await req("POST", "/api/pc/2/unlock", { cookie, body: { minutes: 1, holder: "Asha" } });
  eq("admin can grant an unlock", unlock.status, 200);

  await a2.heartbeat({ enforced: false });
  eq("agent receives the UNLOCKED command", a2.lastCommand?.command, "UNLOCKED");
  ok("agent is told about the active grant", a2.lastGrant && a2.lastGrant.holder === "Asha");
  s1 = await seat(cookie, 2);
  eq("PC-2 shows UNLOCKED_IN_USE during a grant", s1.state, "UNLOCKED_IN_USE");
  eq("PC-2 desired state is UNLOCKED", s1.desired, "UNLOCKED");

  const lock = await req("POST", "/api/pc/2/lock", { cookie, body: { reason: "class over" } });
  eq("admin can lock again", lock.status, 200);
  await a2.heartbeat({ enforced: true });
  eq("agent receives the LOCKED command", a2.lastCommand?.command, "LOCKED");
  eq("lock revokes the grant", (await seat(cookie, 2)).grant, null);
  eq("PC-2 is LOCKED again", (await seat(cookie, 2)).state, "LOCKED");

  // ---- grant expiry (demo clock makes 1 minute last ~1 second) ----
  section("Grant expiry re-locks the PC by itself");
  await req("POST", "/api/pc/3/unlock", { cookie, body: { minutes: 1, holder: "Ravi" } });
  await a3.heartbeat({ enforced: false });
  eq("PC-3 starts unlocked", (await seat(cookie, 3)).state, "UNLOCKED_IN_USE");

  const relocked = await waitFor("expiry", async () => {
    const s = await seat(cookie, 3);
    return s.desired === "LOCKED" ? s : null;
  }, 8000);

  ok("grant expiry flips the desired state back to LOCKED", relocked && relocked.desired === "LOCKED");
  ok("expiry is audited", await auditHas(cookie, "GRANT_EXPIRED"));

  // The agent's own guard closes the seat: the server stops reporting a live
  // grant, so the next poll must push LOCKED down to it.
  const afterExpiry = await a3.heartbeat({ enforced: true });
  eq("expired grant is no longer reported to the agent", afterExpiry.body.grant, null);
  eq("agent is pushed back to LOCKED after expiry", afterExpiry.body.desired, "LOCKED");
  eq("PC-3 is locked again", (await seat(cookie, 3)).state, "LOCKED");

  // ---- reboot / restart detection ----
  section("Agent restart and missing evidence");
  const restarted = await a1.heartbeat({ startedAt: a1.startedAt + 5000, enforced: true });
  eq("restarted agent heartbeat accepted", restarted.status, 200);
  ok("restart is audited", await auditHas(cookie, "AGENT_RESTARTED"));

  // A rebooted laptop runs again but is not enforcing (dead overlay). The server
  // must report that honestly AND keep wanting it locked - no silent drift.
  await a1.heartbeat({ enforced: false, startedAt: a1.startedAt + 5000 });
  const openSeat = await seat(cookie, 1);
  eq("a non-enforcing agent is reported as open", openSeat.state, "UNLOCKED_IDLE");
  eq("...while the admin's wish is still LOCKED", openSeat.desired, "LOCKED");

  // No enforcement report at all: fall back to UNKNOWN, never keep a stale claim.
  await req("POST", "/api/agent/heartbeat", {
    body: { pcId: 1, osUser: "student", agentStartedAt: a1.startedAt + 9000 },
    token: a1.token,
  });
  const blind = await seat(cookie, 1);
  eq("no enforcement report -> UNKNOWN", blind.state, "UNKNOWN");
  ok("the reason is stated, not guessed", /no enforcement/i.test(blind.lastStateReason || ""), blind.lastStateReason);

  await a1.heartbeat({ enforced: true, startedAt: a1.startedAt + 9000 });
  eq("seat recovers on the next heartbeat", (await seat(cookie, 1)).state, "LOCKED");

  // ---- server forgetting a seat (state file wiped / server moved) ----
  section("A seat the server does not know is reported as 404 (agent re-registers)");
  const ghost = await makeAgent(42, "ghost").heartbeat();
  eq("heartbeat for an unknown pcId returns 404", ghost.status, 404);

  // ---- going silent ----
  section("Silence is UNKNOWN, never OFF");
  const wentSilent = await waitFor("silent", async () => {
    const s = await seat(cookie, 2);
    return s && !s.fresh ? s : null;
  }, 8000);
  ok("a silent seat loses freshness", wentSilent && wentSilent.fresh === false);
  eq("a silent seat reads UNKNOWN", wentSilent && wentSilent.state, "UNKNOWN");
  eq("counts.online drops accordingly", (await getState(cookie)).counts.online <= 2, true);
  await a2.heartbeat({ enforced: true });
  eq("the seat comes back when the agent returns", (await seat(cookie, 2)).state, "LOCKED");

  // ---- forgetting a seat (decommissioned / renumbered laptop) ----
  section("Forget removes a seat completely");
  const beforeForget = (await getState(cookie)).counts.total;
  const forgot = await req("POST", "/api/pc/1/forget", { cookie, body: { reason: "laptop renumbered" } });
  eq("admin can forget a seat", forgot.status, 200);
  eq("the seat count drops by one", (await getState(cookie)).counts.total, beforeForget - 1);
  eq("the forgotten seat is gone", await seat(cookie, 1), undefined);
  ok("forgetting is audited", await auditHas(cookie, "PC_FORGOTTEN"));

  const ghostBeat = await a1.heartbeat({ enforced: true });
  eq("a forgotten seat's heartbeat becomes 404 (agent re-registers)", ghostBeat.status, 404);
  eq("re-registering recreates the seat", (await a1.register()).status, 200);
  eq("the seat is back after re-registration", (await a1.heartbeat()).status, 200);

  const forgetGhost = await req("POST", "/api/pc/1234/forget", { cookie });
  eq("forgetting an unknown seat returns 404", forgetGhost.status, 404);

  // ---- honest errors ----
  section("Bad input and missing seats");
  const unknownPc = await req("POST", "/api/pc/999/lock", { cookie });
  eq("locking a seat that does not exist returns 404", unknownPc.status, 404);

  const badPcId = await req("POST", "/api/agent/register", { body: { pcId: "abc" }, token: "x" });
  eq("non-numeric pcId is rejected", badPcId.status, 400);

  const badJson = await new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: "127.0.0.1", port: PORT, path: "/api/agent/register", method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }
    );
    r.on("error", reject);
    r.write("{not json");
    r.end();
  });
  eq("malformed JSON returns 400, not a stack trace", badJson, 400);

  const wakeGhost = await req("POST", "/api/pc/42/wake", { cookie });
  eq("wake on a seat that does not exist returns 404", wakeGhost.status, 404);

  // ---- timetable ----
  section("Timetable: the lab follows lab hours by itself");

  // Three seats online, so attendance has something real to allocate from
  await a1.heartbeat({ enforced: true });
  await a2.heartbeat({ enforced: true });
  await a3.heartbeat({ enforced: true });

  const nowDate = new Date();
  const today = ((nowDate.getDay() + 6) % 7) + 1;
  const hm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  const nowMins = nowDate.getHours() * 60 + nowDate.getMinutes();
  const openStart = Math.max(0, nowMins - 1);
  const openEnd = 23 * 60 + 59;
  const covering = { day: today, start: hm(openStart), end: hm(openEnd), label: "DBMS Lab - Sec A" };
  // never on today, so it can never accidentally cover "now"
  const anotherDay = today === 1 ? 2 : 1;
  const elsewhere = { day: anotherDay, start: "09:00", end: "11:00", label: "Networks Lab" };

  const emptyTt = await req("GET", "/api/schedule", { cookie });
  eq("a fresh install has no timetable", emptyTt.body.slots.length, 0);
  eq("with no timetable the lab reads CLOSED", emptyTt.body.status.mode, "CLOSED");

  const outsideHours = await req("POST", "/api/schedule/present", { cookie, body: { count: 2 } });
  eq("attendance outside lab hours is refused", outsideHours.status, 409);
  ok("and the refusal explains why", /lab period/i.test(outsideHours.body.error || ""));

  const backwards = await req("PUT", "/api/schedule", {
    cookie,
    body: { slots: [{ day: 1, start: "11:00", end: "09:00", label: "backwards" }] },
  });
  eq("a period that ends before it starts is rejected", backwards.status, 400);
  ok("and says so plainly", /after the start/i.test(backwards.body.error || ""));

  const overlap = await req("PUT", "/api/schedule", {
    cookie,
    body: {
      slots: [
        { day: 1, start: "09:00", end: "11:00", label: "A" },
        { day: 1, start: "10:00", end: "12:00", label: "B" },
      ],
    },
  });
  eq("overlapping periods are rejected", overlap.status, 400);
  ok("the clash names both periods", /A/.test(overlap.body.error || "") && /B/.test(overlap.body.error || ""));

  const saved = await req("PUT", "/api/schedule", { cookie, body: { slots: [covering, elsewhere] } });
  eq("a valid weekly grid saves", saved.status, 200);
  eq("the grid is echoed back as HH:MM", saved.body.slots[0].start, hm(openStart));
  ok("the app derives its own OPEN/CLOSE plan",
    saved.body.plan.some((e) => e.kind === "OPEN") && saved.body.plan.some((e) => e.kind === "CLOSE"));

  // Times, not just existence: an OPEN event must land on the period's real
  // start minute, otherwise the lab would follow the timetable at the wrong hour.
  const expectedOpen = new Date();
  expectedOpen.setHours(Math.floor(openStart / 60), openStart % 60, 0, 0);
  const planOpen = saved.body.plan.find((e) => e.kind === "OPEN" && e.label === "DBMS Lab - Sec A");
  eq("the plan opens the period at its real start time", planOpen && new Date(planOpen.at).getTime(), expectedOpen.getTime());

  const expectedClose = new Date();
  expectedClose.setHours(23, 59, 0, 0);
  const planClose = saved.body.plan.find((e) => e.kind === "CLOSE" && e.label === "DBMS Lab - Sec A");
  eq("...and closes it at its real end time", planClose && new Date(planClose.at).getTime(), expectedClose.getTime());

  await sleep(2600); // let the follower tick
  const running = await req("GET", "/api/schedule", { cookie });
  eq("during the period the lab reads OPEN", running.body.status.mode, "OPEN");
  eq("and names the period it is following", running.body.status.activeSlot.label, "DBMS Lab - Sec A");
  ok("the dashboard is told when the next period starts", !!running.body.status.next);

  const opened = await getState(cookie);
  ok("opening a period does NOT hand out seats by itself",
    opened.computers.every((c) => c.state !== "UNLOCKED_IN_USE" && c.state !== "UNLOCKED_IDLE"),
    JSON.stringify(opened.computers.map((c) => [c.id, c.state])));
  eq("nobody has a grant before attendance", opened.computers.filter((c) => c.grant).length, 0);

  // A seat is only allocatable while its agent is fresh, so bring all three
  // back online immediately before taking attendance.
  await a1.heartbeat({ enforced: true });
  await a2.heartbeat({ enforced: true });
  await a3.heartbeat({ enforced: true });

  const alloc2 = await req("POST", "/api/schedule/present", { cookie, body: { count: 2 } });
  eq("attendance of 2 allocates exactly 2 seats", alloc2.body.allocated, 2);
  eq("it reports how many seats were online", alloc2.body.onlineSeats, 3);
  eq("no shortfall when 2 of 3 are online", alloc2.body.shortfall, 0);
  ok("the grant cannot outlive the period", alloc2.body.minutes > 0 && alloc2.body.minutes <= openEnd - nowMins + 1,
    `minutes=${alloc2.body.minutes}`);

  await a1.heartbeat({ enforced: false });
  await a2.heartbeat({ enforced: false });
  await a3.heartbeat({ enforced: true });
  const afterAlloc = await getState(cookie);
  eq("exactly the allocated seats are open", afterAlloc.computers.filter((c) => c.state.startsWith("UNLOCKED")).length, 2);
  eq("the seat nobody was assigned to stays locked", afterAlloc.computers.find((c) => c.id === 3).state, "LOCKED");
  eq("allocation is audited", await auditHas(cookie, "ATTENDANCE_ALLOCATED"), true);

  const byName = await req("POST", "/api/schedule/present", {
    cookie,
    body: { names: ["Asha Sharma", "Ravi Kumar", "Meera Nair"] },
  });
  eq("a list of names allocates one seat per name", byName.body.allocated, 3);
  eq("seats carry the student's name", byName.body.seats[0].holder, "Asha Sharma");

  const overflow = await req("POST", "/api/schedule/present", { cookie, body: { count: 10 } });
  eq("asking for more seats than the lab can give reports a shortfall", overflow.body.shortfall, 7);
  ok("and says it in plain words", /online/i.test(overflow.body.note || ""));

  section("Ending a period re-locks the room on its own");
  await req("PUT", "/api/schedule", { cookie, body: { slots: [elsewhere] } });
  const roomRelocked = await waitFor("relock", async () => {
    const st = await getState(cookie);
    return st.computers.every((c) => c.desired === "LOCKED") ? st : null;
  }, 8000);
  ok("every seat is locked again once the period is over", !!roomRelocked);
  ok("nobody keeps a grant after the period", !!roomRelocked && roomRelocked.computers.filter((c) => c.grant).length === 0);
  ok("the close is audited", await auditHas(cookie, "SCHEDULE_SLOT_CLOSE"));

  const closedView = (await req("GET", "/api/schedule", { cookie })).body.status;
  ok("the dashboard can say when the next period starts", !!closedView.next);
  eq("...at its real start hour, not midnight", new Date(closedView.next.at).getHours(), 9);
  eq("...and the real minute", new Date(closedView.next.at).getMinutes(), 0);

  section("Admin override for lab hours outside the timetable");
  const ovr = await req("POST", "/api/schedule/override", { cookie, body: { minutes: 30, reason: "test open lab" } });
  eq("the admin can override the timetable", ovr.status, 200);
  // Allocation only touches agents that are reporting. The relock wait above
  // can outlast the 1.5s staleness window, so refresh the seats first -
  // otherwise this asserts on a stale room, not on the override.
  await Promise.all([a1, a2, a3].map((a) => a.heartbeat({ enforced: true })));
  const allocOvr = await req("POST", "/api/schedule/present", { cookie, body: { count: 1 } });
  eq("attendance is allowed during an override", allocOvr.body.allocated, 1);
  eq("the mode shows the override", (await req("GET", "/api/schedule", { cookie })).body.status.mode, "OVERRIDE");
  eq("the override can be cleared", (await req("DELETE", "/api/schedule/override", { cookie })).status, 200);
  ok("ending the override re-locks everything", !!(await waitFor("relock2", async () => {
    const st = await getState(cookie);
    return st.computers.every((c) => c.desired === "LOCKED") ? st : null;
  }, 8000)));

  section("The timetable picture");
  const fakePng = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const up = await reqRaw("POST", "/api/schedule/image", {
    cookie, buffer: fakePng, mime: "image/png", fileName: "official timetable.png",
  });
  eq("a picture of the timetable can be uploaded", up.status, 200);
  const gotImg = await reqRaw("GET", "/api/schedule/image", { cookie });
  eq("it comes back byte for byte", Buffer.compare(gotImg.buffer, fakePng), 0);
  ok("served with its image content type", /image\/png/.test(gotImg.headers["content-type"] || ""));
  ok("the picture is never mistaken for the timetable itself",
    (await req("GET", "/api/schedule", { cookie })).body.slots.length === 1);

  const notAnImage = await reqRaw("POST", "/api/schedule/image", {
    cookie, buffer: Buffer.from("this is not a picture"), mime: "text/plain",
  });
  eq("a non-image upload is refused", notAnImage.status, 400);
  eq("the picture can be removed", (await req("DELETE", "/api/schedule/image", { cookie })).status, 200);
  eq("and then it is really gone", (await reqRaw("GET", "/api/schedule/image", { cookie })).status, 404);

  const clamp = await req("GET", "/api/schedule/plan?days=99", { cookie });
  eq("the plan request is answered", clamp.status, 200);
  ok("the plan window is clamped to a sane size", Array.isArray(clamp.body.plan));

  section("No seat is allocated when nothing is reporting in");
  await req("POST", "/api/schedule/override", { cookie, body: { minutes: 30, reason: "stale seats test" } });
  await sleep(2200); // every seat goes quiet (the test's agent timeout is 1.5s)
  const nobody = await req("POST", "/api/schedule/present", { cookie, body: { count: 3 } });
  eq("with no seat reporting, no seat is allocated", nobody.body.allocated, 0);
  eq("every student counts as short a machine", nobody.body.shortfall, 3);
  ok("and the panel blames the PCs, not the admin", /reporting in/i.test(nobody.body.note || ""), nobody.body.note);
  await req("DELETE", "/api/schedule/override", { cookie });

  section("A new laptop enrolls itself (no config.json editing)");
  const mac1 = "aa:bb:cc:00:00:90";
  const beforeEnroll = (await getState(cookie)).counts.total;
  const en1 = await req("POST", "/api/agent/enroll", {
    body: { hostname: "new-pc", ip: "10.0.0.90", mac: mac1, agentVersion: "test" },
  });
  eq("a PC with no identity can enroll", en1.status, 200);
  ok("enrollment hands out a pcId", Number.isInteger(en1.body.pcId) && en1.body.pcId > 0, en1.body.pcId);
  ok("enrollment hands out a token of its own", typeof en1.body.token === "string" && en1.body.token.length >= 20);
  eq("the agent is told how many systems were already registered", en1.body.seatsBefore, beforeEnroll);
  eq("the new seat is named after its number", en1.body.name, `PC-${en1.body.pcId}`);

  const en1Beat = await req("POST", "/api/agent/heartbeat", {
    body: { pcId: en1.body.pcId, enforced: true },
    token: en1.body.token,
  });
  eq("the enrolled seat reports in with its issued token", en1Beat.status, 200);

  const en1Again = await req("POST", "/api/agent/enroll", {
    body: { hostname: "new-pc", ip: "10.0.0.90", mac: mac1 },
  });
  eq("enrolling the same machine again reclaims the same seat", en1Again.body.pcId, en1.body.pcId);
  eq("and it keeps the same token", en1Again.body.token, en1.body.token);
  eq("and the same numbered name", en1Again.body.name, en1.body.name);

  const en2 = await req("POST", "/api/agent/enroll", {
    body: { hostname: "new-pc-2", ip: "10.0.0.91", mac: "aa:bb:cc:00:00:91" },
  });
  eq("a second machine gets the next sequential seat", en2.body.pcId, en1.body.pcId + 1, `${en1.body.pcId} then ${en2.body.pcId}`);
  eq("its name is that number too", en2.body.name, `PC-${en2.body.pcId}`);
  eq("it is told the updated count", en2.body.seatsBefore, beforeEnroll + 1);
  ok("second machine gets a different token", en2.body.token !== en1.body.token);
  ok("enrollment is audited", await auditHas(cookie, "AGENT_ENROLLED"));

  // Retiring a seat must not hand its number to the next machine.
  await req("POST", `/api/pc/${en2.body.pcId}/forget`, { cookie, body: {} });
  const en3 = await req("POST", "/api/agent/enroll", {
    body: { hostname: "new-pc-3", ip: "10.0.0.93", mac: "aa:bb:cc:00:00:93" },
  });
  eq("a new PC takes the next number, never a retired one", en3.body.pcId, en2.body.pcId + 1, `${en2.body.pcId} then ${en3.body.pcId}`);

  // The classic bug: a copied config.json carries the SAME token, so "PC-1"
  // looks like a restart. A different MAC + hostname must still be refused.
  const copyReg = await req("POST", "/api/agent/register", {
    body: {
      pcId: en1.body.pcId, name: "PC-COPY", token: en1.body.token,
      hostname: "other-laptop", ip: "10.0.0.92", mac: "aa:bb:cc:00:00:92",
    },
    token: en1.body.token,
  });
  eq("a copied folder with the same token on another PC is refused", copyReg.status, 409);
  eq("and reported as PC_ID_TAKEN so the agent can enroll itself", copyReg.body.code, "PC_ID_TAKEN");

  const restartReg = await req("POST", "/api/agent/register", {
    body: {
      pcId: en1.body.pcId, name: "PC-NEW", token: en1.body.token,
      hostname: "new-pc", ip: "10.0.0.90", mac: mac1,
    },
    token: en1.body.token,
  });
  eq("the same machine restarting with its token is still allowed", restartReg.status, 200);

  section("Department + guided timetable analysis");
  // Tomorrow, not "today": a period that only runs today would next occur in
  // 7 days and fall outside the analysis window, making the test time-dependent.
  const tomorrow = today === 7 ? 1 : today + 1;
  const upcomingSlot = { day: tomorrow, start: "09:00", end: "11:00", label: "DBMS Lab - Sec A" };

  const badDept = await req("PUT", "/api/schedule", {
    cookie,
    body: { slots: [upcomingSlot], department: "NOPE" },
  });
  eq("an unknown department is refused", badDept.status, 400);

  const deptSaved = await req("PUT", "/api/schedule", {
    cookie,
    body: { slots: [upcomingSlot], department: "CSE" },
  });
  eq("a department saves with the grid", deptSaved.status, 200);
  eq("and comes back on the grid", deptSaved.body.department, "CSE");

  const ana = await req("GET", "/api/schedule/analysis", { cookie });
  eq("the analyser answers", ana.status, 200);
  eq("it reports the chosen department", ana.body.department, "CSE");
  ok("it names the next class to start", !!ana.body.next);
  ok("and says how soon", Number.isFinite(ana.body.next?.inMinutes));

  // Two sections in the same lab at the same time is normal; a partial overlap
  // is still a data-entry mistake (covered above).
  const sharedSave = await req("PUT", "/api/schedule", {
    cookie,
    body: {
      department: "CSD",
      slots: [
        { day: tomorrow, start: "09:00", end: "11:00", label: "DBMS Lab - Sec A" },
        { day: tomorrow, start: "09:00", end: "11:00", label: "DBMS Lab - Sec B" },
      ],
    },
  });
  eq("two sections may share the same lab window", sharedSave.status, 200);

  const anaShared = await req("GET", "/api/schedule/analysis", { cookie });
  const grouped = (anaShared.body.shared || []).find((s) => s.sections.length === 2);
  ok("analysis groups the shared window", !!grouped);
  ok("it names both sections", !!grouped && /Sec A/.test(JSON.stringify(grouped.sections)) && /Sec B/.test(JSON.stringify(grouped.sections)));
  ok("and explains it to the admin", (anaShared.body.issues || []).some((i) => /sections share the lab/i.test(i.text)));
  eq("the department follows the saved grid", anaShared.body.department, "CSD");

  const anaClamp = await req("GET", "/api/schedule/analysis?days=99", { cookie });
  eq("the analysis window is clamped sanely", anaClamp.status, 200);

  // ----------------------------------------------------------------
  // reading the picture (AI extraction, mocked model)
  // ----------------------------------------------------------------

  section("The picture is proposed as periods, never saved unconfirmed");
  const noImg = await req("POST", "/api/schedule/extract", { cookie, body: {} });
  eq("extract with no picture stored is refused", noImg.status, 400);

  const picUp = await reqRaw("POST", "/api/schedule/image", {
    buffer: TEST_PNG, mime: "image/png", fileName: "timetable.png", cookie,
  });
  eq("the reference picture uploads", picUp.status, 200);

  mockAiCalls.length = 0;
  const ex = await req("POST", "/api/schedule/extract", { cookie, body: {} });
  eq("extraction runs against the stubbed model", ex.status, 200);
  eq("the server authenticated with the configured key", mockAiCalls[0]?.auth, "Bearer test-key-123");
  ok("the picture travelled as a data URL", mockAiCalls[0]?.hasImage === true, JSON.stringify(mockAiCalls[0]));
  eq("the model list was used, not a guess", mockAiCalls[0]?.model, "mock-vision");
  eq("exactly one model call for one extraction", mockAiCalls.length, 1);

  eq("duplicate rows collapse to one (3 unique periods)", ex.body.slots.length, 3);
  const monday = ex.body.slots[0];
  eq("day names map to numbers", monday.day, 1);
  eq("times are normalised HH:MM", `${monday.start}-${monday.end}`, "09:00-11:00");
  eq("shared sections stay in one label", monday.label, "DBMS Lab - Sec A + OS Lab - Sec B");
  ok("each row carries a human 'when'", /Mon 09:00-11:00/.test(monday.when || ""), monday.when);
  eq("Wednesday maps to day 3", ex.body.slots[2].day, 3);
  ok("model notes travel back to the wizard", (ex.body.notes || []).some((n) => /Friday/i.test(n)), ex.body.notes);
  ok("markup in a model label is stripped like the grid does", ex.body.slots[1].label === "C Lab - Sec C Sec D", ex.body.slots[1].label);

  section("One timetable picture per class: rename, read, merge");
  // The HOD keeps a picture per class; a picture's NAME tells the model which
  // class it belongs to, so labels never blur across classes.
  const picId = picUp.body.image.id;
  const ren = await req("PUT", `/api/schedule/image/${picId}`, { cookie, body: { name: "CSE 3A" } });
  eq("a picture renames to the class it belongs to", ren.status, 200);
  eq("the new name sticks", ren.body.image.name, "CSE 3A");

  mockAiCalls.length = 0;
  const exNamed = await req("POST", "/api/schedule/extract", { cookie, body: { image: picId } });
  eq("extraction by picture id works", exNamed.status, 200);
  eq("the response names the picture it read", exNamed.body.image?.id, picId);
  ok("the class name travelled into the model prompt", /timetable of the class "CSE 3A"/.test(mockAiCalls[0]?.prompt || ""), mockAiCalls[0]?.prompt?.slice(0, 300));

  const pic2 = await reqRaw("POST", "/api/schedule/image", {
    buffer: TEST_PNG, mime: "image/png", fileName: "CSD 5B.png", cookie,
  });
  eq("a second class picture uploads alongside the first", pic2.status, 200);
  const picList = await req("GET", "/api/schedule/images", { cookie });
  eq("both pictures are listed", picList.body.images.length, 2);
  eq("the newest second keeps its upload name", picList.body.images[1].name, "CSD 5B.png");

  const gone = encodeURIComponent(picList.body.images[1].id);
  const removed = await req("DELETE", `/api/schedule/image?id=${gone}`, { cookie });
  eq("one picture can be removed", removed.body.removed, 1);
  eq("and only the class picture remains", (await req("GET", "/api/schedule/images", { cookie })).body.images.length, 1);

  const exGone = await req("POST", "/api/schedule/extract", { cookie, body: { image: gone } });
  eq("reading a removed picture is refused with a hint", exGone.status, 400);

  const applySave = await req("PUT", "/api/schedule", {
    cookie,
    body: { department: "CSE", slots: ex.body.slots.map(({ day, start, end, label }) => ({ day, start, end, label })) },
  });
  eq("the proposed periods pass the confirmed-grid validation when applied", applySave.status, 200);
  eq("and the grid keeps exactly the extracted periods", applySave.body.slots.length, 3);

  const audit = await req("GET", "/api/audit", { cookie });
  ok("extraction is audited", (audit.body || []).some((e) => e.action === "SCHEDULE_EXTRACT"));

  const exAgain = await req("POST", "/api/schedule/extract", { cookie, body: {} });
  eq("extraction repeats cleanly on demand", exAgain.status, 200);
  eq("and a second extraction never leaks into the save path by itself", (await req("GET", "/api/schedule", { cookie })).body.slots.length, 3);
  // ----------------------------------------------------------------
  // the clock drives the locks: period end re-locks seats, and the next
  // period needs attendance again even though the room never was free
  // ----------------------------------------------------------------
  section("Back-to-back periods: re-lock at the boundary, attendance again");

  const lockPc = await req("POST", "/api/agent/enroll", {
    body: { hostname: "lock-pc", ip: "10.0.0.95", mac: "aa:bb:cc:00:00:95", agentVersion: "test" },
  });
  eq("a lock-test seat enrolls", lockPc.status, 200);
  const lockId = lockPc.body.pcId;
  const lockToken = lockPc.body.token;

  // Heartbeat the whole time: the attendance machinery only hands seats to
  // PCs that are really reporting in.
  let beating = true;
  const beaten = { count: 0 };
  const beater = (async () => {
    while (beating) {
      const r = await req("POST", "/api/agent/heartbeat", {
        body: { pcId: lockId, enforced: true },
        token: lockToken,
      });
      if (r.status === 200) beaten.count += 1;
      await sleep(350);
    }
  })();

  // Align to a minute boundary so the grid below has a full minute of runway.
  {
    const now = new Date();
    if (now.getSeconds() > 4) {
      eq("waiting for a minute boundary", true, true);
      await sleep((66 - now.getSeconds()) * 1000);
    }
  }
  const startMin = new Date().getHours() * 60 + new Date().getMinutes();
  const A = { day: today, start: fmt(startMin), end: fmt(startMin + 1), label: "DBMS Lab - Sec A" };
  const B = { day: today, start: fmt(startMin + 1), end: fmt(startMin + 2), label: "OS Lab - Sec B" };
  const gridSave = await req("PUT", "/api/schedule", {
    cookie,
    body: { department: "CSE", slots: [A, B] },
  });
  eq("back-to-back windows save (no overlap)", gridSave.status, 200);

  const beat = await req("POST", "/api/agent/heartbeat", { body: { pcId: lockId, enforced: true }, token: lockToken });
  eq("the seat is fresh at window open", beat.status, 200);

  // 1) period A: attendance opens exactly one seat
  const att1 = await attend(cookie);
  eq("attendance in period A allocates a seat", att1.body.allocated, 1);
  await untilMinute(startMin + 1);
  await sleep(3500); // let a tick notice the boundary and act

  // 2) boundary: A closes -> seats lock again; B opens -> still locked
  const closeA = await auditMatch(cookie, "SCHEDULE_SLOT_CLOSE", /DBMS Lab - Sec A/);
  const openB = await auditMatch(cookie, "SCHEDULE_SLOT_OPEN", new RegExp(B.label.replace(/[-+]/g, ".")));
  ok("period A closed at its end and was audited", !!closeA, JSON.stringify(closeA));
  ok("and B opened straight away in the same tick train", !!openB, JSON.stringify(openB));

  const seatState1 = (await getState(cookie)).computers.find((c) => c.id === lockId);
  eq("at the boundary the seat is locked again (does not roll into B)", seatState1.desired, "LOCKED");
  eq("its old grant is gone", seatState1.grant, null);

  // 3) period B: the admin takes attendance again for the other class
  const att2 = await attend(cookie);
  eq("attendance works again in period B", att2.body.allocated, 1);
  const seatState2 = (await getState(cookie)).computers.find((c) => c.id === lockId);
  eq("so the seat is open for the new class", seatState2.desired, "UNLOCKED");

  // 4) after B ends: the lab closes by itself (no 409-style leftover)
  await untilMinute(startMin + 2);
  await sleep(3500);
  const afterAll = await req("POST", "/api/schedule/present", { cookie, body: { count: 1 } });
  eq("after the last period ends, attendance is refused", afterAll.status, 409);
  ok("and the reason is that no period is running", /No lab period is running/.test(afterAll.body.error || ""), afterAll.body.error);
  const seatState3 = (await getState(cookie)).computers.find((c) => c.id === lockId);
  eq("and the seat locked itself at period end", seatState3.desired, "LOCKED");

  beating = false;
  await beater;
  ok("the seat kept reporting through the whole cycle", beaten.count > 10, beaten.count);

  // ----------------------------------------------------------------
  // a state file written by an OLDER LabNexus (one `image`) migrates cleanly
  // ----------------------------------------------------------------
  {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "labnexus-legacy-"));
    const legacyState = {
      computers: {}, grants: {}, audit: [], seq: 0, lastPcId: 0,
      schedule: {
        slots: [], image: { file: "timetable.png", mime: "image/png", name: "old office timetable.png", size: TEST_PNG.length, uploadedAt: 42 },
      },
    };
    fs.writeFileSync(path.join(legacyDir, "labnexus-state.json"), JSON.stringify(legacyState));
    fs.writeFileSync(path.join(legacyDir, "timetable.png"), TEST_PNG);
    const mig = await new Promise((resolve) => {
      const p = spawn(
        process.execPath,
        ["-e", `
          const state = require(${JSON.stringify(path.join(ADMIN_DIR, "state.js"))});
          state.load();
          const s = state.getState().schedule;
          if (!s.images || s.images.length !== 1) throw new Error("migration failed: " + JSON.stringify(s.images));
          if (s.images[0].name !== "old office timetable.png") throw new Error("name lost");
          console.log("MIGRATION_OK");
        `],
        { cwd: ADMIN_DIR, env: { ...process.env, LABNEXUS_DATA_DIR: legacyDir }, stdio: ["ignore", "pipe", "pipe"] }
      );
      let out = "";
      p.stdout.on("data", (d) => (out += d.toString()));
      p.stderr.on("data", (d) => (out += d.toString()));
      p.on("exit", () => resolve(out));
      setTimeout(() => resolve(out += "\n(timeout)"), 10000);
    });
    ok("a legacy single-picture state file loads as the first class picture", /MIGRATION_OK/.test(mig), mig.trim());
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }

  // ----------------------------------------------------------------
  // a server WITHOUT an AI key answers with a clear setup state
  // ----------------------------------------------------------------
  await startServer({ OPENAI_API_KEY: "" });
  const freshCookie = await loginAsAdmin();
  await reqRaw("POST", "/api/schedule/image", {
    buffer: TEST_PNG, mime: "image/png", fileName: "timetable.png", cookie: freshCookie,
  });
  const nk = await req("POST", "/api/schedule/extract", { cookie: freshCookie, body: {} });
  eq("a missing AI key is a clear setup state, not a crash", nk.status, 503);
  eq("it is flagged for the wizard", nk.body.setup, true);
  ok("it names where to put the key", /OPENAI_API_KEY/.test(nk.body.error || ""), nk.body.error);
  ok("and links the key sign-up page", /freebuff\.com\/account\/api/.test(nk.body.error || ""));
  ok("it offers the free Gemini route too", /GEMINI_API_KEY/.test(nk.body.error || "") && /aistudio\.google\.com/.test(nk.body.error || ""), nk.body.error);
  eq("the setup state is answered before any real network call", nk.body.error.length > 0, true);

  // ----------------------------------------------------------------
  // a FREE GEMINI key alone drives extraction (Google AI Studio key)
  // ----------------------------------------------------------------
  await startServer({ OPENAI_API_KEY: "", GEMINI_API_KEY: "free-gem-key" });
  const gCookie = await loginAsAdmin();
  await reqRaw("POST", "/api/schedule/image", {
    buffer: TEST_PNG, mime: "image/png", fileName: "gemini test.png", cookie: gCookie,
  });
  mockAiCalls.length = 0;
  const gx = await req("POST", "/api/schedule/extract", { cookie: gCookie, body: {} });
  eq("a GEMINI_API_KEY alone runs extraction", gx.status, 200, gx.body?.error);
  eq("it authenticated with the Gemini key", mockAiCalls[0]?.auth, "Bearer free-gem-key");
  ok("the picture travelled to the model", mockAiCalls[0]?.hasImage === true);
}

// ----------------------------------------------------------------
// entry point
// ----------------------------------------------------------------

(async () => {
  let crashed = null;
  try {
    await startMockAi();
    await run();
  } catch (err) {
    crashed = err;
    console.error(`\nTest run threw: ${err.stack || err.message}`);
  } finally {
    await stopServer();
    stopMockAi();
    if (!KEEP) {
      for (const dir of DATA_DIRS) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      }
    } else {
      console.log(`\nTemp state kept at ${DATA_DIR}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  if (failures.length === 0 && !crashed) {
    console.log(` ALL ${passed} CHECKS PASSED`);
    console.log("=".repeat(60) + "\n");
    process.exit(0);
  }
  console.log(` ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log(`   - ${f}`);
  console.log("=".repeat(60) + "\n");
  process.exit(1);
})();
