const fs = require("fs");
const path = require("path");

// ----------------------------------------------------------------
// LabNexus v1 - shared state store (single process, JSON file DB)
// ----------------------------------------------------------------

// LABNEXUS_DATA_DIR lets tests run against a throwaway state file instead of
// the real one (LABNEXUS_DATA_DIR=/tmp/x PORT=8099 node server.js).
const DATA_DIR = process.env.LABNEXUS_DATA_DIR
  ? path.resolve(process.env.LABNEXUS_DATA_DIR)
  : path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "labnexus-state.json");

// How long without a heartbeat before a seat stops being "fresh".
// Lowered by the integration test so it does not have to wait 13 real seconds.
const AGENT_TIMEOUT_MS =
  Number(process.env.LABNEXUS_AGENT_TIMEOUT_MS) > 0
    ? Number(process.env.LABNEXUS_AGENT_TIMEOUT_MS)
    : 12000;

// Demo clock. LABNEXUS_TIME_SCALE=60 makes a 30-minute grant really last 30
// seconds, so a live demo (or the integration test) can show the grant expiring
// and the PC re-locking itself without waiting half an hour.
const TIME_SCALE =
  Number(process.env.LABNEXUS_TIME_SCALE) > 0 ? Number(process.env.LABNEXUS_TIME_SCALE) : 1;

function blankSchedule() {
  return {
    slots: [],          // the confirmed weekly grid (day 1-7, start/end in minutes)
    department: null,   // which department this timetable belongs to (CSE, CSD, ...)
    images: [],         // timetable pictures, one per class (was a single `image`)
    override: null,     // { until, minutes, reason } - pauses the follower
    activeSlotId: null, // the period the follower is currently inside
    activeWindow: null, // "day|start|end" - the identity that survives row id churn
    activeLabel: null,  // last known name of the running period
    activeGroup: null,
    activeSince: null,
    allocations: [],    // attendance -> allocated seats (newest first)
    updatedAt: null,
  };
}

let state = {
  computers: {}, // id -> computer record
  grants: {},    // grantId -> grant record
  audit: [],     // newest first
  seq: 0,
  lastPcId: 0,   // highest seat number ever handed out (never reused)
  schedule: blankSchedule(),
  settings: {
    adminPassword: "admin123", // CHANGE THIS - used for the dashboard login
  },
};

const crypto = require("crypto");

// ------------------------- auth -------------------------

const sessions = new Map(); // token -> expiresAt
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function login(password) {
  if (password !== state.settings.adminPassword) return null;
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function sessionValid(token) {
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function logout(token) {
  sessions.delete(token);
}

function agentTokenValid(pcId, token) {
  const pc = state.computers[pcId];
  if (!pc || !pc.token) return false; // unregistered PC: reject
  return token === pc.token;
}

// ------------------------- persistence -------------------------

function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("Persist failed:", err.message);
  }
}

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      state = Object.assign(state, JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
      // state files written before the timetable existed must not crash it
      state.schedule = Object.assign(blankSchedule(), state.schedule || {});
      // Older state files kept ONE timetable picture under `image`; they become
      // the first entry of the per-class picture list, untouched on disk.
      if (state.schedule.image && !state.schedule.images?.length) {
        state.schedule.images = [{ id: "main", ...state.schedule.image }];
        state.schedule.image = null;
      }
      if (!Array.isArray(state.schedule.images)) state.schedule.images = [];
      // older state files have no high-water mark: derive it from the seats
      const maxSeat = Math.max(0, ...Object.keys(state.computers).map((k) => Number(k) || 0));
      state.lastPcId = Math.max(Number(state.lastPcId) || 0, maxSeat);
      console.log(`Loaded state: ${Object.keys(state.computers).length} computers`);
    }
  } catch (err) {
    console.error("State load failed, starting fresh:", err.message);
  }
}

// ------------------------- audit -------------------------

function audit(action, detail = {}) {
  state.seq += 1;
  state.audit.unshift({
    id: state.seq,
    ts: new Date().toISOString(),
    action,
    ...detail,
  });
  if (state.audit.length > 500) state.audit = state.audit.slice(0, 500);
  persist();
  return state.seq;
}

// ------------------------- computers -------------------------

function getComputer(id) {
  return state.computers[id] || null;
}

function allComputers() {
  return Object.values(state.computers);
}

function upsertComputer({ id, name, token, group }) {
  let rec = state.computers[id];
  if (!rec) {
    rec = {
      id,
      name: name || `PC-${id}`,
      token: token || null,
      group: group || "LAB-A",
      hostname: null,
      reportedIp: null,
      reportedMac: null,
      agentVersion: null,
      agentStartedAt: null,
      state: "UNKNOWN",      // observed
      desired: "LOCKED",     // desired mode
      lastSeen: 0,
      lastEvidenceAt: 0,
      lastCommandId: null,
      lastStateReason: "never seen",
      unlockedUntil: null,
      lastMessage: null,
      osUser: null,
      idleSeconds: null,
      missed: 0,
      canSleep: false,
      canLock: true,
      canMessage: true,
      enforced: null,
    };
    state.computers[id] = rec;
    if (id > (Number(state.lastPcId) || 0)) state.lastPcId = id;
  }
  if (name !== undefined && name !== null) rec.name = name;
  if (token !== undefined && token !== null) rec.token = token;
  if (group !== undefined && group !== null) rec.group = group;
  return rec;
}

// Give a machine that has no identity of its own the next free seat. This is
// what makes a lab rollout one step: copy the agent folder to every PC, start
// it, and each machine is handed its own id + token instead of someone editing
// config.json by hand (the old way to get a second PC online).
function enrollComputer({ name, token, hostname, ip, mac } = {}) {
  // Next number after the highest one ever handed out, so a new PC is always
  // the next sequential seat (PC-1, PC-2, ...) and a removed seat's number is
  // never silently reused by a different machine.
  let id = Math.max(Number(state.lastPcId) || 0, 0) + 1;
  for (const key of Object.keys(state.computers)) {
    const n = Number(key);
    if (Number.isInteger(n) && n >= id) id = n + 1;
  }
  if (id > 10000) return null;

  const rec = upsertComputer({ id, name: name || `PC-${id}`, token: token || null });
  if (hostname) rec.hostname = hostname;
  if (ip) rec.reportedIp = ip;
  if (mac) rec.reportedMac = mac;
  persist();
  return rec;
}

function setDesired(id, mode, reason = "") {
  const pc = getComputer(id);
  if (!pc) return null;
  pc.desired = mode;
  pc.lastStateReason = reason;
  audit("DESIRE_SET", { pcId: id, mode, reason });
  return pc;
}

// Remove a seat entirely (laptop decommissioned or renumbered). The agent, if
// it is still running, will simply re-register - so stop it on the PC first.
function forgetComputer(id, by = "admin", reason = "") {
  const pc = state.computers[id];
  if (!pc) return null;
  const revoked = revokeAllGrantsFor(id, by, reason || "seat forgotten");
  delete state.computers[id];
  audit("PC_FORGOTTEN", {
    pcId: Number(id),
    name: pc.name,
    revokedGrants: revoked.length,
    by,
    reason,
  });
  return pc;
}

// ------------------------- heartbeats -------------------------

function reportHeartbeat(payload) {
  const pc = getComputer(payload.pcId);
  if (!pc) return null;

  // If the agent reports a different process start time than last time, it
  // restarted (crash, reboot, crash-loop). Anything we believed about its
  // overlay is now stale, so drop back to "unknown" until it tells us again.
  if (payload.agentStartedAt) {
    if (pc.agentStartedAt && pc.agentStartedAt !== payload.agentStartedAt) {
      pc.enforced = null;
      pc.state = "UNKNOWN";
      pc.lastStateReason = "agent restarted; waiting for fresh evidence";
      audit("AGENT_RESTARTED", { pcId: pc.id });
    }
    pc.agentStartedAt = payload.agentStartedAt;
  }

  pc.lastSeen = Date.now();
  pc.missed = 0;
  if (payload.hostname) pc.hostname = payload.hostname;
  if (payload.ip) pc.reportedIp = payload.ip;
  if (payload.mac) pc.reportedMac = payload.mac;
  if (payload.agentVersion) pc.agentVersion = payload.agentVersion;
  if (payload.osUser !== undefined) pc.osUser = payload.osUser;
  if (payload.idleSeconds !== undefined) pc.idleSeconds = payload.idleSeconds;
  if (payload.canSleep !== undefined) pc.canSleep = !!payload.canSleep;
  // only trust a real boolean; null (register-only) means "not yet known"
  if (typeof payload.enforced === "boolean") pc.enforced = payload.enforced;
  return pc;
}

// Decide observed state from desired + evidence.
// Never claims OFF from a missing heartbeat alone.
function computeObserved(pc, now = Date.now()) {
  if (pc.lastSeen === 0) {
    pc.state = "UNKNOWN";
    pc.lastStateReason = "agent never connected";
    return pc;
  }

  if (now - pc.lastSeen > AGENT_TIMEOUT_MS) {
    pc.missed += 1;
    if (pc.desired === "SLEEPING") {
      pc.state = "SLEEPING"; // sleep request pending confirmation
      pc.lastStateReason = "sleep requested; no recent evidence";
    } else {
      pc.state = "UNKNOWN";
      pc.lastStateReason = `no heartbeat for ${Math.round((now - pc.lastSeen) / 1000)}s`;
    }
    return pc;
  }

  // Agent is fresh. Trust its enforced report.
  if (pc.desired === "SLEEPING") {
    pc.state = "SLEEPING";
    pc.lastStateReason = "sleep requested";
  } else if (pc.enforced === true) {
    pc.state = "LOCKED";
    pc.lastStateReason = "agent enforcing lock";
  } else if (pc.enforced === false) {
    pc.state = hasActiveGrant(pc) ? "UNLOCKED_IN_USE" : "UNLOCKED_IDLE";
    pc.lastStateReason = hasActiveGrant(pc) ? "active grant" : "no active grant";
  } else {
    pc.state = "UNKNOWN";
    pc.lastStateReason = "agent fresh but no enforcement report";
  }
  return pc;
}

// ------------------------- grants -------------------------

function hasActiveGrant(pc, now = Date.now()) {
  for (const g of Object.values(state.grants)) {
    if (g.pcId === pc.id && g.state === "ACTIVE" && g.startAt <= now && now < g.endAt) {
      return g;
    }
  }
  return null;
}

function activeGrant(pc, now = Date.now()) {
  return hasActiveGrant(pc, now);
}

function createGrant({ pcId, holder, rollNo, durationMinutes, grantedBy, reason }) {
  const now = Date.now();
  state.seq += 1;
  const g = {
    id: state.seq,
    pcId,
    holder: holder || "unknown",
    rollNo: rollNo || null,
    startAt: now,
    endAt: now + (durationMinutes * 60000) / TIME_SCALE,
    grantedBy: grantedBy || "admin",
    reason: reason || "",
    state: "ACTIVE",
  };
  state.grants[g.id] = g;
  audit("GRANT_CREATED", {
    grantId: g.id,
    pcId,
    holder: g.holder,
    rollNo: g.rollNo,
    minutes: durationMinutes,
    by: g.grantedBy,
  });
  return g;
}

function revokeGrant(grantId, by = "admin", reason = "") {
  const g = state.grants[grantId];
  if (!g || g.state !== "ACTIVE") return null;
  g.state = "REVOKED";
  g.revokedAt = Date.now();
  g.revokedBy = by;
  g.revokeReason = reason;
  audit("GRANT_REVOKED", { grantId, pcId: g.pcId, by, reason });
  return g;
}

// Revoke every ACTIVE grant on a PC (used by admin lock / sleep)
function revokeAllGrantsFor(pcId, by = "admin", reason = "") {
  const revoked = [];
  for (const g of Object.values(state.grants)) {
    if (g.pcId === pcId && g.state === "ACTIVE") {
      if (revokeGrant(g.id, by, reason)) revoked.push(g.id);
    }
  }
  return revoked;
}

// Expire grants lazily; called on every tick
function expireGrants(now = Date.now()) {
  for (const g of Object.values(state.grants)) {
    if (g.state === "ACTIVE" && now >= g.endAt) {
      g.state = "EXPIRED";
      audit("GRANT_EXPIRED", { grantId: g.id, pcId: g.pcId });
      const pc = getComputer(g.pcId);
      if (pc && pc.desired === "UNLOCKED") {
        setDesired(g.pcId, "LOCKED", "grant expired");
      }
    }
  }
}

// ------------------------- commands -------------------------

function queueCommand(pcId, command, params = {}, by = "admin") {
  state.seq += 1;
  const cmd = {
    id: state.seq,
    pcId,
    command,
    params,
    by,
    ts: Date.now(),
    status: "QUEUED", // QUEUED -> SENT -> ACKED
  };
  const pc = getComputer(pcId);
  if (pc) pc.lastCommandId = cmd.id;
  state.audit.unshift({ id: cmd.id, ts: new Date().toISOString(), action: "COMMAND_QUEUED", pcId, command, by });
  persist();
  return cmd;
}

module.exports = {
  AGENT_TIMEOUT_MS,
  TIME_SCALE,
  getDataDir: () => DATA_DIR,
  load, persist, audit,
  getComputer, allComputers, upsertComputer, enrollComputer, setDesired, forgetComputer,
  reportHeartbeat, computeObserved,
  hasActiveGrant, activeGrant, createGrant, revokeGrant, revokeAllGrantsFor, expireGrants,
  queueCommand,
  login, sessionValid, logout, agentTokenValid,
  getState: () => state,
};
