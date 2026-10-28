// ----------------------------------------------------------------
// LabNexus admin server (Express)
// Serves: dashboard, REST API, SSE events, discovery responder.
// ----------------------------------------------------------------

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const os = require("os");
const fs = require("fs");

// --------------------------- optional .env ---------------------------
// The owner's AI key (and any other secret) can live in a plain .env file
// in the project root next to the dashboard, or in admin/.env. No parse
// dependency: only KEY=VALUE lines, and real environment variables always
// win over the file.
for (const envPath of [path.join(__dirname, "..", ".env"), path.join(__dirname, ".env")]) {
  try {
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue;
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch (_) {
    // no .env in this location - that is fine, secrets can come from the env
  }
}

const state = require("./state");
const extract = require("./extract");
const wol = require("./wol");
const { startDiscoveryResponder } = require("./discovery");
const { attachSse, broadcast } = require("./sse");
const engine = require("./engine");
const schedule = require("./schedule");

const envPort = Number(process.env.PORT);
const PORT = envPort > 0 ? envPort : 8000;

state.load();

const app = express();
app.use(cors());
app.use(express.json());

// --------------------------- helpers ---------------------------

function broadcastState() {
  broadcast("state", snapshot());
}

function snapshot() {
  const now = Date.now();
  const computers = state.allComputers().map((pc) => {
    state.computeObserved(pc, now);
    const grant = state.activeGrant(pc, now);
    const agentFresh = now - pc.lastSeen < state.AGENT_TIMEOUT_MS && pc.lastSeen > 0;
    const waking = pc.wakeVerifyUntil && now < pc.wakeVerifyUntil && !agentFresh;
    return {
      id: pc.id,
      name: pc.name,
      group: pc.group,
      hostname: pc.hostname,
      ip: pc.reportedIp,
      mac: pc.reportedMac,
      agentVersion: pc.agentVersion,
      state: waking ? "WAKING" : pc.state,
      desired: pc.desired,
      lastStateReason: pc.lastStateReason,
      lastSeen: pc.lastSeen,
      fresh: now - pc.lastSeen < state.AGENT_TIMEOUT_MS,
      osUser: pc.osUser,
      idleSeconds: pc.idleSeconds,
      canSleep: pc.canSleep,
      grant: grant
        ? {
            id: grant.id,
            holder: grant.holder,
            rollNo: grant.rollNo,
            endAt: grant.endAt,
            grantedBy: grant.grantedBy,
          }
        : null,
      lastMessage: pc.lastMessage,
    };
  });

  return {
    now,
    computers,
    counts: {
      total: computers.length,
      online: computers.filter((c) => c.fresh).length,
      locked: computers.filter((c) => c.state === "LOCKED").length,
      unlocked: computers.filter((c) => c.state.startsWith("UNLOCKED")).length,
      unknown: computers.filter((c) => c.state === "UNKNOWN").length,
    },
  };
}

function auditAndBroadcast(action, detail) {
  state.audit(action, detail);
  broadcastState();
}

// --------------------------- auth ---------------------------

function requireAdmin(req, res, next) {
  const cookie = req.headers.cookie || "";
  const token = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("ln_session="))?.slice(11);
  if (!token || !state.sessionValid(token)) {
    return res.status(401).json({ error: "Not authorized. Log in first." });
  }
  next();
}

app.post("/api/auth/login", (req, res) => {
  const { password } = req.body || {};
  const token = state.login(password);
  if (!token) {
    state.audit("LOGIN_FAILED", { ip: req.ip });
    return res.status(401).json({ error: "Wrong password" });
  }
  state.audit("LOGIN_OK", { ip: req.ip });
  res.setHeader("Set-Cookie", `ln_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`);
  res.json({ ok: true });
});

app.post("/api/auth/logout", requireAdmin, (req, res) => {
  const token = (req.headers.cookie || "").split("ln_session=")[1]?.split(";")[0];
  state.logout(token);
  state.audit("LOGOUT");
  res.setHeader("Set-Cookie", "ln_session=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// --------------------------- dashboard ---------------------------

app.use(express.static(path.join(__dirname, "web")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "web", "index.html")));

// malformed JSON and other body errors -> clean JSON, no stack leak
app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "request body is not valid JSON" });
  }
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "internal server error" });
});

// --------------------------- health ---------------------------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "LabNexus", time: new Date().toISOString() });
});

// --------------------------- dashboard API (admin only) ---------------------------

app.get("/api/state", requireAdmin, (_req, res) => res.json(snapshot()));

app.get("/api/audit", requireAdmin, (_req, res) => res.json(state.getState().audit.slice(0, 200)));

// --------------------------- agent API ---------------------------

// Agent endpoints: strict per-PC token check (X-PC-Token header).
function requireAgent(req, res, pcId) {
  const token = req.headers["x-pc-token"] || "";
  if (!state.agentTokenValid(pcId, token)) {
    state.audit("AGENT_AUTH_FAILED", { pcId, ip: req.ip });
    res.status(401).json({ error: "invalid agent token" });
    return false;
  }
  return true;
}

// Enrollment: a laptop with no identity of its own asks for one. This is the
// whole "new PC" flow - install the agent, start it, done. The token binds that
// seat to that machine from then on. Matching MAC reclaims an existing seat so a
// wiped/reinstalled PC does not leave a ghost behind. Trust model: this is a
// lab LAN, same trust boundary as the agent port itself.
app.post("/api/agent/enroll", (req, res) => {
  const { name, hostname, ip, mac, agentVersion, canSleep, agentStartedAt } = req.body || {};
  const macKey = mac ? String(mac).toLowerCase() : null;

  const existing = macKey
    ? state.allComputers().find(
        (c) => c.reportedMac && String(c.reportedMac).toLowerCase() === macKey
      )
    : null;

  const seatsBefore = state.allComputers().length;

  if (existing) {
    state.reportHeartbeat({
      pcId: existing.id, hostname, ip, mac, agentVersion, canSleep, enforced: null, agentStartedAt,
    });
    auditAndBroadcast("AGENT_ENROLLED", { pcId: existing.id, ip, name: existing.name, reclaimed: true });
    return res.json({
      ok: true,
      pcId: existing.id,
      name: existing.name,
      token: existing.token,
      desired: existing.desired,
      reclaimed: true,
      seatsBefore,
      totalSeats: seatsBefore,
    });
  }

  const token = `lnx-${crypto.randomBytes(18).toString("hex")}`;
  // The seat is numbered by the server (PC-N), not named after the hostname,
  // so the dashboard reads as a sequence: 1, 2, 3, ...
  const rec = state.enrollComputer({ token, hostname, ip, mac });
  if (!rec) return res.status(507).json({ error: "no free seat ids left" });

  state.reportHeartbeat({
    pcId: rec.id, hostname, ip, mac, agentVersion, canSleep, enforced: null, agentStartedAt,
  });
  auditAndBroadcast("AGENT_ENROLLED", { pcId: rec.id, ip, name: rec.name, reclaimed: false });
  console.log(`Enrolled ${rec.name} (${rec.hostname || hostname || "unknown host"}) as seat ${rec.id} - ${seatsBefore} already registered`);
  res.json({
    ok: true,
    pcId: rec.id,
    name: rec.name,
    token,
    desired: rec.desired,
    reclaimed: false,
    seatsBefore,
    totalSeats: seatsBefore + 1,
  });
});

app.post("/api/agent/register", (req, res) => {
  const { pcId, name, hostname, ip, mac, agentVersion, canSleep, agentStartedAt } = req.body || {};
  // agents send the token in the X-PC-Token header; also accept body for tests
  const token = req.headers["x-pc-token"] || req.body?.token;
  const pcIdNum = Number(pcId);
  if (!pcId || !Number.isInteger(pcIdNum) || pcIdNum < 1 || pcIdNum > 10000) {
    return res.status(400).json({ error: "pcId must be an integer between 1 and 10000" });
  }

  const existing = state.getComputer(pcIdNum);
  const macKey = mac ? String(mac).toLowerCase() : null;
  const hostKey = hostname ? String(hostname).toLowerCase() : null;
  const existingMac = existing?.reportedMac ? String(existing.reportedMac).toLowerCase() : null;
  const existingHost = existing?.hostname ? String(existing.hostname).toLowerCase() : null;

  // A copied config.json carries the SAME token, so a token check alone cannot
  // see the second laptop - both look like "PC-1 restarting". Compare the
  // machine fingerprint too: a different MAC *and* hostname is a different
  // laptop, while a restart or rename keeps at least one of them.
  const differentMachine =
    !!(existingMac && macKey && existingMac !== macKey && existingHost && hostKey && existingHost !== hostKey);

  if (existing && existing.token && (token !== existing.token || differentMachine)) {
    // Refuse loudly instead of letting one machine hijack another's seat. The
    // agent answers this by enrolling a seat of its own, so no manual fix-up.
    state.audit("AGENT_ID_CONFLICT", {
      pcId: pcIdNum, ip: req.ip, claimedName: name || null, differentMachine,
    });
    return res.status(409).json({
      error: "pcId already registered by another machine",
      code: "PC_ID_TAKEN",
      hint:
        `PC-${pcIdNum} already belongs to another machine. This PC will enroll its own seat.`,
    });
  }

  // A fresh registration means the agent just booted: whatever we recorded about
  // its overlay before is stale until the first heartbeat proves otherwise.
  if (existing) existing.enforced = null;

  const upserted = state.upsertComputer({ id: pcIdNum, name, token: existing?.token || token || `demo-agent-${pcIdNum}` });
  state.reportHeartbeat({ pcId: pcIdNum, hostname, ip, mac, agentVersion, canSleep, enforced: null, agentStartedAt });
  console.log(`Registered PC-${pcIdNum} (${name || upserted.name}) from ${ip || "unknown IP"}`);
  auditAndBroadcast("AGENT_REGISTERED", { pcId: pcIdNum, ip, name: name || null });
  res.json({ ok: true, pcId: pcIdNum, desired: upserted.desired });
});

app.post("/api/agent/heartbeat", (req, res) => {
  const pcId = Number(req.body?.pcId);
  const { enforced, osUser, idleSeconds, canSleep, agentStartedAt } = req.body || {};
  if (!Number.isInteger(pcId)) return res.status(400).json({ error: "pcId must be an integer" });
  const pc = state.getComputer(pcId);
  if (!pc) return res.status(404).json({ error: "not registered - register first" });
  if (!requireAgent(req, res, pcId)) return;

  state.reportHeartbeat({ pcId, enforced, osUser, idleSeconds, canSleep, agentStartedAt });

  // deliver one queued command per poll
  const cmd = engine.popCommand(pcId);
  res.json({ ok: true, desired: pc.desired, command: cmd, grant: activeGrantView(pc) });
});

function activeGrantView(pc) {
  const g = state.activeGrant(pc);
  return g ? { id: g.id, holder: g.holder, endAt: g.endAt } : null;
}

// --------------------------- admin actions ---------------------------

function adminAction(pcId, desired, reason, extra = {}) {
  const pc = state.getComputer(pcId);
  if (!pc) return { error: "PC not found", status: 404 };

  state.setDesired(pcId, desired, reason);
  queueAndBroadcast(pcId, { command: desired, ...extra }, reason);
  return { ok: true };
}

function queueAndBroadcast(pcId, payload, reason) {
  const cmd = state.queueCommand(pcId, payload.command, payload.params || {}, "admin"); // audits itself
  engine.pushCommand(pcId, cmd);
  broadcastState();
}

app.post("/api/pc/:id/lock", requireAdmin, (req, res) => {
  const id = +req.params.id;
  const pc = state.getComputer(id);
  if (!pc) return res.status(404).json({ error: "PC not found" });
  const revoked = state.revokeAllGrantsFor(id, "admin", req.body?.reason || "manual lock");
  const r = adminAction(id, "LOCKED", req.body?.reason || "manual lock");
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true, revokedGrants: revoked });
});

app.post("/api/pc/:id/unlock", requireAdmin, (req, res) => {
  const id = +req.params.id;
  const minutes = Math.floor(Number(req.body?.minutes ?? 30));
  const holder = String(req.body?.holder || "student").slice(0, 80);
  const pc = state.getComputer(id);
  if (!pc) return res.status(404).json({ error: "PC not found" });
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
    return res.status(400).json({ error: "minutes must be between 1 and 1440" });
  }

  state.createGrant({ pcId: id, holder, durationMinutes: minutes, grantedBy: "admin", reason: req.body?.reason });
  adminAction(id, "UNLOCKED", `grant ${minutes}m for ${holder}`);
  res.json({ ok: true, minutes, holder });
});

app.post("/api/pc/:id/sleep", requireAdmin, (req, res) => {
  const id = +req.params.id;
  const pc = state.getComputer(id);
  if (!pc) return res.status(404).json({ error: "PC not found" });
  state.revokeAllGrantsFor(id, "admin", "sleep"); // sleeping PC cannot honour a grant
  const r = adminAction(id, "SLEEPING", req.body?.reason || "manual sleep");
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

app.post("/api/pc/:id/wake", requireAdmin, async (req, res) => {
  const pc = state.getComputer(+req.params.id);
  if (!pc) return res.status(404).json({ error: "PC not found" });
  if (!pc.reportedMac || pc.reportedMac === "00:00:00:00:00:00") {
    return res.status(409).json({
      error: "No MAC known for this PC - wake it once with the agent running so it registers its MAC, then WOL will work.",
    });
  }

  const send = wol.sendWol(pc.reportedMac);
  const summary = await send.summary();
  state.setDesired(pc.id, "LOCKED", "wake requested via WOL (locked on arrival)");
  auditAndBroadcast("WAKE_REQUESTED", {
    pcId: pc.id,
    mac: pc.reportedMac,
    packetsSent: summary.sent,
    packetsFailed: summary.failed,
    targets: summary.targets.join(","),
  });

  // Verification: we do NOT claim the PC woke. We flip to a waking window and
  // only the agent's next heartbeat (fresh evidence) proves it actually woke.
  pc.wakeVerifyUntil = Date.now() + 45000;
  state.persist();

  res.json({
    ok: summary.sent > 0,
    packetsSent: summary.sent,
    packetsFailed: summary.failed,
    note:
      "Magic packets sent. The machine is awake only when its heartbeat reappears within 45s - watch the seat turn fresh. If it stays UNKNOWN, WOL is likely disabled in BIOS/OS (see README).",
  });
});

app.post("/api/pc/:id/message", requireAdmin, (req, res) => {
  const pc = state.getComputer(+req.params.id);
  if (!pc) return res.status(404).json({ error: "PC not found" });
  // strip anything that could be interpreted as markup by any client;
  // keep it plain text and short
  pc.lastMessage = String(req.body?.text || "")
    .replace(/[<>]/g, "")
    .slice(0, 200);
  state.persist();
  queueAndBroadcast(pc.id, { command: "MESSAGE", params: { text: pc.lastMessage } }, "admin message");
  res.json({ ok: true });
});

// Remove a seat from the dashboard (decommissioned / renumbered laptop).
app.post("/api/pc/:id/forget", requireAdmin, (req, res) => {
  const id = +req.params.id;
  const pc = state.getComputer(id);
  if (!pc) return res.status(404).json({ error: "PC not found" });
  const lastSeenSecondsAgo = pc.lastSeen ? Math.round((Date.now() - pc.lastSeen) / 1000) : null;
  const forgotten = state.forgetComputer(id, "admin", req.body?.reason || "removed from dashboard");
  broadcastState();
  res.json({
    ok: true,
    forgotten: { id: forgotten.id, name: forgotten.name, lastSeenSecondsAgo },
    note:
      "Seat removed. If that laptop's agent is still running it will re-register " +
      "within a few seconds - stop the agent on the PC first if that is not what you want.",
  });
});

app.post("/api/pc/:id/reboot", requireAdmin, (req, res) => {
  const r = adminAction(+req.params.id, "LOCKED", "reboot requested");
  if (r.error) return res.status(r.status).json({ error: r.error });
  queueAndBroadcast(+req.params.id, { command: "REBOOT", params: { delaySec: 10 } }, "admin reboot");
  res.json({ ok: true });
});

// --------------------------- timetable ---------------------------

// One reference picture of the official timetable. Stored on disk, not in the
// state file, and served only to a logged-in admin.
app.post(
  "/api/schedule/image",
  requireAdmin,
  express.raw({ type: ["image/png", "image/jpeg", "image/webp", "image/gif"], limit: "8mb" }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: "Send the image file as the raw request body (PNG, JPG, WEBP or GIF)." });
    }
    let name = "timetable";
    try {
      name = decodeURIComponent(req.headers["x-file-name"] || "timetable") || "timetable";
    } catch (_) {
      name = String(req.headers["x-file-name"] || "timetable").slice(0, 120);
    }
    const r = schedule.saveImage({
      buffer: req.body,
      mime: String(req.headers["content-type"] || "").split(";")[0].trim(),
      name,
    });
    if (r.error) return res.status(r.status).json({ error: r.error });
    broadcastState();
    res.json({
      ok: true,
      image: r.image,
      images: r.images,
      note: "Keep this picture as the reference; the confirmed grid is what the lab actually follows.",
    });
  }
);

// One picture per class: `?id=` serves a specific one, no id serves the first.
app.get("/api/schedule/image", requireAdmin, (req, res) => {
  const img = schedule.imageFile(req.query.id);
  if (!img) return res.status(404).json({ error: "No timetable image uploaded yet." });
  res.setHeader("Content-Type", img.mime);
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(img.path);
});

app.get("/api/schedule/images", requireAdmin, (_req, res) => {
  res.json({ images: schedule.listImages() });
});

// Rename a picture to the class it belongs to (feeds the extraction prompt).
app.put("/api/schedule/image/:id", requireAdmin, (req, res) => {
  const r = schedule.renameImage(req.params.id, req.body?.name);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

app.delete("/api/schedule/image", requireAdmin, (req, res) => {
  const r = schedule.removeImage(req.query.id);
  broadcastState();
  res.json(r);
});

// The confirmed weekly grid + the plan the app derived from it + live status.
app.get("/api/schedule", requireAdmin, (_req, res) => {
  res.json({ ...schedule.getSchedule(), status: schedule.status(), plan: schedule.buildPlan({ days: 7 }) });
});

app.put("/api/schedule", requireAdmin, (req, res) => {
  const r = schedule.saveSlots(req.body?.slots, "admin", req.body?.department);
  if (r.error) return res.status(r.status).json(r);
  broadcastState();
  res.json({
    ok: true,
    slots: r.slots,
    department: r.department,
    view: schedule.status(),
    plan: schedule.buildPlan({ days: 7 }),
  });
});

// Read the timetable picture with a vision model and PROPOSE lab periods.
// Nothing is saved here: the wizard previews the result and the admin
// applies it through the normal confirmed-grid save path.
app.post("/api/schedule/extract", requireAdmin, async (req, res) => {
  const r = await extract.extractFromImage(req.body?.image);
  if (r.setup) return res.status(503).json({ setup: true, error: r.error, setupUrl: r.setupUrl });
  if (r.error) return res.status(r.status).json({ error: r.error, hint: r.hint });
  state.audit("SCHEDULE_EXTRACT", {
    model: r.model,
    image: r.image?.id || null,
    periodCount: r.slots.length,
    notes: r.notes.length,
  });
  res.json({ ok: true, slots: r.slots, notes: r.notes, image: r.image, model: r.model });
});

// Guided analyser: what is running, what starts next, and every section that
// shares the lab in the same window. Reads the confirmed grid, never the picture.
app.get("/api/schedule/analysis", requireAdmin, (req, res) => {
  const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));
  res.json(schedule.analyse({ days }));
});

// Attendance: one seat per student present, never more.
app.post("/api/schedule/present", requireAdmin, (req, res) => {
  const r = schedule.allocate({
    count: req.body?.count,
    names: req.body?.names,
    stayMinutes: req.body?.stayMinutes,
  });
  if (r.error) return res.status(r.status).json(r);
  broadcastState();
  res.json(r);
});

// Manual override: pause the timetable for a while (open lab outside lab hours).
app.post("/api/schedule/override", requireAdmin, (req, res) => {
  const r = schedule.setOverride({ minutes: req.body?.minutes, reason: req.body?.reason });
  if (r.error) return res.status(r.status).json(r);
  broadcastState();
  res.json({ ok: true, override: r.override, view: schedule.status() });
});

app.delete("/api/schedule/override", requireAdmin, (_req, res) => {
  schedule.clearOverride();
  broadcastState();
  res.json({ ok: true, view: schedule.status() });
});

app.get("/api/schedule/plan", requireAdmin, (req, res) => {
  const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));
  res.json({ plan: schedule.buildPlan({ days }), status: schedule.status() });
});

// --------------------------- SSE ---------------------------

attachSse(app);
engine.startTicking(() => {
  // The follower runs first: a period change re-locks or opens the room, then
  // the normal reconcile pass reports the result to the dashboard.
  const changed = schedule.tick();
  engine.evaluateAndDispatch();
  if (changed) broadcastState();
}, broadcastState);

// --------------------------- global error handling ---------------------------

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "request body is not valid JSON" });
  }
  console.error("Unhandled server error:", err.message);
  res.status(500).json({ error: "internal server error" });
});

// --------------------------- start ---------------------------

const ifs = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i.address);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("==========================================");
  console.log(" LabNexus Admin Server");
  console.log("==========================================");
  console.log(` Dashboard : http://localhost:${PORT}`);
  console.log(` LAN IPs   : ${ifs.length ? ifs.join(", ") : "none found"}`);
  console.log(" Agents    : auto-discover this server via UDP broadcast");
  console.log("==========================================");
  console.log("");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("");
    console.error(`Port ${PORT} is already in use.`);
    console.error("Most likely another LabNexus server is still running.");
    console.error("Close that window, or run on another port:");
    console.error(`   set PORT=8001 && npm start`);
    console.error("");
    process.exit(1);
  }
  console.error("Server error:", err.message);
  process.exit(1);
});

startDiscoveryResponder(41888, PORT);
