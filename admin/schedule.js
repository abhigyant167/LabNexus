// ----------------------------------------------------------------
// LabNexus - timetable
//
// The admin keeps ONE picture of the official timetable in the dashboard
// and confirms it as a weekly grid. From that grid this module derives the
// lab's own operating timetable:
//
//   * outside every slot        -> the whole lab is locked
//   * inside a slot             -> the lab is OPEN for that period, but
//                                  seats stay locked until the admin takes
//                                  ATTENDANCE, which allocates exactly as
//                                  many seats as students are present
//   * the slot ends              -> every seat re-locks by itself
//
// Nothing here trusts the picture: the grid the admin confirms is the only
// thing that drives real lock/unlock decisions.
// ----------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const state = require("./state");
const engine = require("./engine");

// ISO day numbers: 1 = Monday … 7 = Sunday
const DAY_NAMES = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };
const MAX_SLOTS = 80;

// Departments the wizard offers. Codes are stored; labels are shown to the admin.
const DEPARTMENTS = {
  CSE: "Computer Science & Engineering",
  CSD: "Computer Science & Design",
  CSM: "Computer Science & Machine Learning",
  CSO: "Computer Science & Cybersecurity",
  IT: "Information Technology",
  AIDS: "AI & Data Science",
  ECE: "Electronics & Communication",
  EEE: "Electrical & Electronics",
  MECH: "Mechanical Engineering",
  CIVIL: "Civil Engineering",
  OTHER: "Other / common lab",
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

function isoDay(date) {
  return ((date.getDay() + 6) % 7) + 1;
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseHM(value) {
  const m = /^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i.exec(String(value ?? "").trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  const mer = (m[3] || "").toLowerCase();
  if (mer === "pm" && h < 12) h += 12;
  else if (mer === "am" && h === 12) h = 0;
  if (h > 23) return null;
  return h * 60 + min;
}

function fmtHM(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function humanSlot(slot) {
  return `${DAY_NAMES[slot.day]} ${fmtHM(slot.start)}-${fmtHM(slot.end)}`;
}

// Two rows for the same day and the same hours are ONE lab window with two
// sections in it. Identity is the window, never the row id: saving the grid
// renumbers ids, and a renumbered id must not look like a different period.
function windowKey(slot) {
  return `${slot.day}|${slot.start}|${slot.end}`;
}

// Slots are stored as minutes-of-day (fast to compare) but always travel to the
// dashboard as "HH:MM" so the browser never has to know the internal shape.
function viewSlot(slot) {
  return {
    id: slot.id,
    day: slot.day,
    start: fmtHM(slot.start),
    end: fmtHM(slot.end),
    label: slot.label,
    group: slot.group,
    enabled: slot.enabled !== false,
    when: humanSlot(slot),
  };
}

// ------------------------- validation -------------------------

// Turn whatever the dashboard sent into slots we are willing to act on.
// Rejects rather than guesses: a broken slot must never silently close a lab.
function normaliseSlots(raw) {
  const errors = [];
  if (!Array.isArray(raw)) return { ok: false, errors: ["slots must be an array"] };
  if (raw.length > MAX_SLOTS) return { ok: false, errors: [`too many slots (max ${MAX_SLOTS})`] };

  const slots = [];
  const seenRows = new Map();
  raw.forEach((s, i) => {
    const where = `row ${i + 1}`;
    const day = Number(s?.day);
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      errors.push(`${where}: day must be 1 (Mon) to 7 (Sun)`);
      return;
    }
    const start = parseHM(s?.start);
    const end = parseHM(s?.end);
    if (start === null) return errors.push(`${where}: start must look like 09:00`);
    if (end === null) return errors.push(`${where}: end must look like 11:00`);
    if (end <= start) return errors.push(`${where}: end time must be after the start time (overnight periods are not supported)`);

    // Strip markup first, then any stray angle bracket: a pasted label like
    // "<b>Sec A</b>" must become "Sec A", never "bSec A/b".
    const label = String(s?.label ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/[<>]/g, "")
      // control characters and undecodable bytes would render as boxes/� in
      // the dashboard and in the audit log
      .replace(/[\u0000-\u001F\u007F\uFFFD]/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 60)
      .trim();
    if (!label) return errors.push(`${where}: give the period a name (e.g. "DBMS Lab - Sec A")`);

    // The same section twice is always a data-entry slip: it would be reported
    // as "2 sections share this lab" with the same name listed twice.
    const twin = `${day}|${start}|${end}|${label.toLowerCase()}`;
    if (seenRows.has(twin)) {
      return errors.push(`${where}: identical to row ${seenRows.get(twin)} - remove one of them`);
    }
    seenRows.set(twin, i + 1);

    const group = String(s?.group ?? "all").replace(/[<>]/g, "").slice(0, 30).trim() || "all";
    slots.push({
      id: Number.isInteger(s?.id) ? s.id : i + 1,
      day,
      start,
      end,
      label,
      group,
      enabled: s?.enabled !== false,
    });
  });

  // An empty grid is a legitimate state ("lab always locked"), which is what
  // Clear all produces - so it is allowed, just never treated as open hours.
  if (errors.length) return { ok: false, errors };

  // Overlaps are a data-entry mistake, not a feature: they make "which period
  // is this?" ambiguous, so we refuse them instead of picking one silently.
  const byDay = {};
  for (const s of slots) {
    for (const other of byDay[s.day] || []) {
      if (!s.enabled || !other.enabled) continue;
      // Two sections sharing the SAME window is a normal lab situation (both
      // sections in the room at once), so it is allowed. A partial overlap means
      // one period starts or ends inside another - that is a data-entry mistake
      // and stays rejected, because "which period is this?" would be ambiguous.
      const sameWindow = s.start === other.start && s.end === other.end;
      if (!sameWindow && s.start < other.end && other.start < s.end) {
        errors.push(`overlapping periods on ${DAY_NAMES[s.day]}: "${other.label}" and "${s.label}"`);
      }
    }
    (byDay[s.day] = byDay[s.day] || []).push(s);
  }

  return { ok: errors.length === 0, slots, errors };
}

// ------------------------- queries -------------------------

function slotsFor(schedule) {
  return (schedule?.slots || []).filter((s) => s.enabled !== false);
}

function slotAt(date, schedule = state.getState().schedule) {
  const day = isoDay(date);
  const mins = minutesOfDay(date);
  return slotsFor(schedule).find((s) => s.day === day && mins >= s.start && mins < s.end) || null;
}

function nextStart(date = new Date(), schedule = state.getState().schedule) {
  const nowMins = minutesOfDay(date);
  // ahead 7 is the same weekday next week: a lab that meets once a week must
  // still report its next class after today's period is over.
  for (let ahead = 0; ahead <= 7; ahead++) {
    const probe = new Date(date.getTime() + ahead * 86400000);
    const day = isoDay(probe);
    const todays = slotsFor(schedule)
      .filter((s) => s.day === day && (ahead > 0 || s.start > nowMins))
      .sort((a, b) => a.start - b.start);
    if (todays.length) {
      const at = new Date(probe);
      at.setHours(Math.floor(todays[0].start / 60), todays[0].start % 60, 0, 0);
      return { slot: todays[0], at };
    }
  }
  return null;
}

function groupMatches(pc, group) {
  if (!group || group === "all") return true;
  return pc.group === group;
}

// ------------------------- the "day plan" -------------------------
// The timetable the app has MADE for itself: a concrete list of what it will
// do and when, derived from the confirmed grid (this is what the dashboard
// shows so the admin can check it before trusting it).
function buildPlan({ days = 7, from = new Date() } = {}) {
  const schedule = state.getState().schedule;
  const events = [];
  for (let ahead = 0; ahead < days; ahead++) {
    const probe = new Date(from.getTime() + ahead * 86400000);
    const day = isoDay(probe);
    for (const slot of slotsFor(schedule).filter((s) => s.day === day)) {
      // setHours(hours, minutes, seconds, ms) - the hour goes FIRST.
      const open = new Date(probe);
      open.setHours(Math.floor(slot.start / 60), slot.start % 60, 0, 0);
      const close = new Date(probe);
      close.setHours(Math.floor(slot.end / 60), slot.end % 60, 0, 0);
      if (close <= from) continue;
      events.push({ at: open.toISOString(), kind: "OPEN", slotId: slot.id, label: slot.label, when: humanSlot(slot) });
      events.push({ at: close.toISOString(), kind: "CLOSE", slotId: slot.id, label: slot.label, when: humanSlot(slot) });
    }
  }
  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
}

// ------------------------- guided analysis -------------------------
// Groups periods that share the same window, so the dashboard can name every
// section that is in the room at that time instead of listing duplicates.
function groupSessions({ days = 7, from = new Date() } = {}) {
  const schedule = state.getState().schedule;
  const sessions = [];
  for (let ahead = 0; ahead < days; ahead++) {
    const probe = new Date(from.getTime() + ahead * 86400000);
    const day = isoDay(probe);
    const windows = new Map();
    for (const slot of slotsFor(schedule).filter((s) => s.day === day)) {
      const key = `${slot.start}-${slot.end}`;
      if (!windows.has(key)) windows.set(key, []);
      windows.get(key).push(slot);
    }
    for (const [key, slots] of windows) {
      const [start, end] = key.split("-").map(Number);
      const at = new Date(probe);
      at.setHours(Math.floor(start / 60), start % 60, 0, 0);
      const endsAt = new Date(probe);
      endsAt.setHours(Math.floor(end / 60), end % 60, 0, 0);
      if (endsAt <= from) continue;
      sessions.push({
        at: at.toISOString(),
        endsAt: endsAt.toISOString(),
        atMs: at.getTime(),
        endMs: endsAt.getTime(),
        day,
        when: `${DAY_NAMES[day]} ${fmtHM(start)}-${fmtHM(end)}`,
        start: fmtHM(start),
        end: fmtHM(end),
        sections: slots.map((s) => ({ id: s.id, label: s.label, group: s.group })),
        shared: slots.length > 1,
        running: from >= at && from < endsAt,
        inMinutes: Math.max(0, Math.round((at - from) / 60000)),
      });
    }
  }
  return sessions.sort((a, b) => a.atMs - b.atMs);
}

// What the admin needs after choosing a department and confirming the grid:
// what runs now, what starts next, which sections share the room, and what to
// fix. The picture stays a reference - this reads the confirmed grid only.
function analyse({ days = 7, now = new Date() } = {}) {
  const schedule = state.getState().schedule;
  const enabled = slotsFor(schedule);
  const sessions = groupSessions({ days, from: now });

  const running = sessions.filter((s) => s.running).map((s) => ({
    ...s,
    endsInMinutes: Math.max(0, Math.round((s.endMs - now.getTime()) / 60000)),
  }));
  const upcoming = sessions.filter((s) => !s.running && s.atMs > now.getTime());
  const next = upcoming[0] || null;

  // One warning per weekly lab window, not one per day it happens to fall on:
  // a Mon-to-Fri shared lab must not fill the checks list with five copies.
  const sharedWindows = new Map();
  for (const s of sessions.filter((x) => x.shared)) {
    // The same window on two different days is only "the same lab" when the
    // exact same sections are in it. Thu's Project Lab must not be merged with
    // Mon's DBMS + Networks just because both run 09:00-11:00.
    const key = `${s.start}-${s.end}|${s.sections.map((x) => x.label).sort().join("|").toLowerCase()}`;
    const seen = sharedWindows.get(key);
    if (seen) {
      seen.days.push(s.day);
      seen.occurrences += 1;
    } else {
      sharedWindows.set(key, { ...s, days: [s.day], occurrences: 1 });
    }
  }
  const shared = [...sharedWindows.values()].map((s) => {
    // "Tue-Mon" reads as a mistake, so name the days instead of spanning them.
    const names = s.days.map((d) => DAY_NAMES[d]);
    const dayText = names.length === 7 ? "Every day" : names.join(", ");
    return {
      ...s,
      when: s.occurrences > 1 ? `${dayText} ${s.start}-${s.end}` : s.when,
    };
  });

  const coverage = {};
  for (const s of enabled) coverage[DAY_NAMES[s.day]] = (coverage[DAY_NAMES[s.day]] || 0) + 1;

  const issues = [];
  if (!enabled.length) {
    issues.push({ level: "info", text: "No periods yet. Add the lab hours to the weekly grid - without them the lab stays locked." });
  }
  if (!schedule.department) {
    issues.push({ level: "info", text: "Department not chosen yet - pick one so this timetable is filed correctly." });
  }
  if (!images(schedule).length) {
    issues.push({ level: "info", text: "No timetable picture is stored. Keep the official picture here as a reference for the admin." });
  }
  for (const s of shared) {
    issues.push({
      level: "warn",
      text: `${s.when}: ${s.sections.length} sections share the lab (${s.sections.map((x) => x.label).join(", ")}). Attendance allocates seats once for the room, not once per section.`,
    });
  }

  // The override is part of "what is the lab doing right now" for the panel,
  // so the attendance controls can say why they are open or closed.
  const live = status(now);

  // A weekly lab can sit entirely outside the 7-day window while the dashboard
  // strip still says "next class next Monday". Say the same thing here instead
  // of claiming nothing is scheduled at all.
  const beyond = !upcoming.length ? nextStart(now, schedule) : null;

  return {
    generatedAt: now.toISOString(),
    mode: live.mode,
    override: live.override,
    department: schedule.department || null,
    departmentLabel: schedule.department
      ? DEPARTMENTS[schedule.department] || schedule.department
      : null,
    hasTimetable: enabled.length > 0,
    slotCount: enabled.length,
    picture: (() => {
      const all = images(schedule);
      return all.length ? { name: all[0].name, uploadedAt: all[0].uploadedAt } : null;
    })(),
    pictures: images(schedule).length,
    running: running[0] || null,
    runningAll: running,
    next,
    nextBeyond: beyond
      ? {
          when: humanSlot(beyond.slot),
          at: beyond.at.toISOString(),
          inMinutes: Math.max(0, Math.round((beyond.at - now.getTime()) / 60000)),
          label: beyond.slot.label,
        }
      : null,
    // Everything in the window, not a silent slice: the panel promises "next 7
    // days" and must show every period in it.
    upcoming: upcoming.slice(0, 60),
    upcomingCount: upcoming.length,
    shared: shared.slice(0, 10),
    coverage,
    issues,
  };
}

function status(now = new Date()) {
  const schedule = state.getState().schedule;
  const activeSlot = slotAt(now, schedule);
  const overriding = (schedule.override?.until || 0) > now.getTime();
  const next = nextStart(now, schedule);

  return {
    hasTimetable: slotsFor(schedule).length > 0,
    slotCount: slotsFor(schedule).length,
    activeSlot: activeSlot ? viewSlot(activeSlot) : null,
    // An override opens the lab even outside lab hours, and keeps it open if it
    // is applied while a period is already running.
    labOpen: !!activeSlot || overriding,
    mode: overriding ? "OVERRIDE" : activeSlot ? "OPEN" : "CLOSED",
    overriding,
    override: overriding ? schedule.override : null,
    next: next
      ? {
          slot: viewSlot(next.slot),
          at: next.at.toISOString(),
          inMinutes: Math.max(0, Math.round((next.at - now) / 60000)),
        }
      : null,
    images: images(schedule).length,
    updatedAt: schedule.updatedAt || null,
    lastAllocation: (schedule.allocations || [])[0] || null,
  };
}

// ------------------------- acting -------------------------

function lockSeats(pcs, reason, by) {
  const locked = [];
  for (const pc of pcs) {
    // Seats that are already locked with no grant need nothing: skipping them
    // keeps the audit readable instead of logging 40 no-op locks per period.
    if (pc.desired === "LOCKED" && !state.hasActiveGrant(pc)) continue;
    state.revokeAllGrantsFor(pc.id, by, reason);
    state.setDesired(pc.id, "LOCKED", reason);
    const cmd = state.queueCommand(pc.id, "LOCKED", { reason }, by);
    engine.pushCommand(pc.id, cmd);
    locked.push(pc.id);
  }
  return locked;
}

function seatsInGroup(group) {
  return state.allComputers().filter((pc) => groupMatches(pc, group));
}

// A period started: clean the room. We deliberately do NOT unlock anything -
// seats are only handed out after attendance, one per student present.
function openSlot(slot, now) {
  const seats = seatsInGroup(slot.group);
  const locked = lockSeats(seats, `lab period started: ${slot.label}`, "timetable");
  state.audit("SCHEDULE_SLOT_OPEN", {
    slotId: slot.id,
    label: slot.label,
    when: humanSlot(slot),
    group: slot.group,
    seatsLocked: locked.length,
    note: "seats stay locked until attendance is taken",
  });
}

function closeSlot(previous) {
  const schedule = state.getState().schedule;
  // `previous` may be null when the period was removed from the grid while it
  // was running: fall back to what the follower remembered.
  const slot = previous || {
    id: schedule.activeSlotId ?? null,
    label: schedule.activeLabel || "lab period over",
    group: schedule.activeGroup || "all",
  };
  const seats = seatsInGroup(slot.group);
  const open = seats.filter((pc) => pc.desired === "UNLOCKED").map((pc) => pc.id);
  const locked = lockSeats(seats, slot.id ? `lab period over: ${slot.label}` : "lab period over", "timetable");
  state.audit("SCHEDULE_SLOT_CLOSE", {
    slotId: slot.id,
    label: slot.label,
    seatsRelocked: locked.length,
    seatsThatHadBeenOpen: open,
  });
  schedule.allocations = (schedule.allocations || []).map((a) =>
    a.slotId === slot.id && a.state === "ACTIVE" ? { ...a, state: "CLOSED", closedAt: Date.now() } : a
  );
}

// Runs every tick. Only acts when the period CHANGES, so it never fights the
// admin (or the grant machinery) while a period is in progress.
function tick(nowMs = Date.now()) {
  const schedule = state.getState().schedule;
  const now = new Date(nowMs);

  if ((schedule.override?.until || 0) > nowMs) return false;

  const active = slotAt(now, schedule);
  const activeKey = active ? windowKey(active) : null;
  const previousKey = schedule.activeWindow || null;

  if (activeKey === previousKey) {
    // Same window, possibly with fresh row ids after the admin saved the grid.
    // Keep the pointer current without touching a single seat.
    if (active && (schedule.activeSlotId !== active.id || schedule.activeLabel !== active.label)) {
      schedule.activeSlotId = active.id;
      schedule.activeLabel = active.label;
      state.persist();
    }
    return false;
  }

  // Find the slot object for the window that is ending, even if the admin has
  // already removed or re-timed that row.
  const endingFallback = {
    id: schedule.activeSlotId ?? null,
    label: schedule.activeLabel || "lab period over",
    group: schedule.activeGroup || "all",
  };
  const previous = previousKey
    ? slotsFor(schedule).find((s) => windowKey(s) === previousKey) || endingFallback
    : null;

  schedule.activeWindow = activeKey;
  schedule.activeSlotId = active ? active.id : null;
  schedule.activeLabel = active ? active.label : null;
  schedule.activeGroup = active ? active.group : null;
  schedule.activeSince = active ? nowMs : null;
  state.persist();

  if (previous) closeSlot(previous); // audits the end even in a back-to-back shift
  if (active) openSlot(active, now);
  return true;
}

// ------------------------- attendance -> allocation -------------------------

// The admin's rule: allocate one seat per student present, and nothing more.
function allocate({ count, names, stayMinutes, by = "admin" } = {}) {
  const schedule = state.getState().schedule;
  const now = new Date();
  const active = slotAt(now, schedule);
  const overriding = (schedule.override?.until || 0) > now.getTime();

  if (!active && !overriding) {
    return {
      status: 409,
      error: "No lab period is running right now.",
      hint: "Attendance is only taken during a period from your timetable. Use Override if you need the lab outside lab hours.",
      status_info: status(now),
    };
  }

  const present = Array.isArray(names) && names.length ? names.map((n) => String(n).slice(0, 40).trim()).filter(Boolean) : null;
  const wanted = present ? present.length : Math.floor(Number(count));
  if (!Number.isFinite(wanted) || wanted < 1) {
    return { status: 400, error: "Give the number of students present (or a list of names)." };
  }

  const seats = seatsInGroup(active?.group);
  const online = seats
    .filter((pc) => pc.lastSeen > 0 && now.getTime() - pc.lastSeen < state.AGENT_TIMEOUT_MS)
    .sort((a, b) => a.id - b.id);

  const taken = online.slice(0, Math.min(wanted, online.length));

  // Minutes left in the period (or the override), so a grant can never outlive
  // the session it belongs to. An override without a period uses its own minutes.
  const minsLeftInSlot = active ? active.end - minutesOfDay(now) : null;
  const minsLeftInOverride = overriding ? Math.ceil((schedule.override.until - now.getTime()) / 60000) : null;
  const minutes = Math.max(
    1,
    Math.min(
      [minsLeftInSlot, minsLeftInOverride, Number(stayMinutes) || Infinity].filter((n) => Number.isFinite(n) && n > 0).reduce((a, b) => Math.min(a, b), Infinity)
    )
  );

  // Everyone NOT allocated goes back to locked - a leftover manual grant must
  // not keep a seat open after attendance says otherwise.
  const leftovers = seats.filter((pc) => !taken.includes(pc));
  const relocked = lockSeats(leftovers, "not allocated at attendance", by).length;

  const allocated = taken.map((pc, i) => {
    const holder = present?.[i] || `present student ${i + 1}`;
    state.createGrant({
      pcId: pc.id,
      holder,
      durationMinutes: minutes,
      grantedBy: by,
      reason: `attendance for ${active?.label || "lab override"}`,
    });
    state.setDesired(pc.id, "UNLOCKED", `allocated at attendance (${minutes}m left)`);
    const cmd = state.queueCommand(pc.id, "UNLOCKED", { minutes, holder }, by);
    engine.pushCommand(pc.id, cmd);
    return { pcId: pc.id, name: pc.name, holder, until: Date.now() + minutes * 60000 };
  });

  const shortfall = Math.max(0, wanted - taken.length);

  // Nothing was allocated (no seat reporting in): do not record an empty
  // allocation, it would show up as "last allocation" with zero seats.
  if (!allocated.length) {
    state.audit("ATTENDANCE_NO_SEATS", { label: active?.label ?? "override", present: wanted, onlineSeats: 0 });
    return {
      status: 200,
      ok: true,
      allocated: 0,
      seats: [],
      relocked,
      shortfall,
      onlineSeats: 0,
      minutes,
      note: "No seat is reporting in right now, so nothing could be allocated. Start the agent on the lab PCs (START-AGENT.bat) and check the seats marked UNKNOWN.",
    };
  }

  const record = {
    at: Date.now(),
    slotId: active?.id ?? null,
    label: active?.label ?? "override",
    present: wanted,
    allocated: allocated.length,
    minutes,
    relocked,
    seats: allocated,
    state: "ACTIVE",
  };
  schedule.allocations = [record, ...(schedule.allocations || [])].slice(0, 20);
  state.persist();

  state.audit("ATTENDANCE_ALLOCATED", {
    slotId: active?.id ?? null,
    label: record.label,
    present: wanted,
    allocatedSeats: allocated.length,
    shortfall,
    minutes,
    seats: allocated.map((a) => a.pcId),
  });

  return {
    status: 200,
    ok: true,
    allocated: allocated.length,
    seats: allocated,
    relocked,
    shortfall,
    onlineSeats: online.length,
    minutes,
    endsAt: Date.now() + minutes * 60000,
    note: !online.length
      ? "No seat is reporting in right now, so nothing could be allocated. Check the lab PCs (START-AGENT.bat) and the seats marked UNKNOWN."
      : shortfall
        ? `Only ${online.length} seat(s) were online - ${shortfall} student(s) have no machine. Check the PCs marked UNKNOWN.`
        : `Allocated ${allocated.length} seat(s) until ${new Date(Date.now() + minutes * 60000).toLocaleTimeString()}.`,
  };
}

// ------------------------- admin override -------------------------

function setOverride({ minutes, reason, by = "admin" } = {}) {
  const mins = Math.floor(Number(minutes));
  if (!Number.isFinite(mins) || mins < 1 || mins > 24 * 60) {
    return { status: 400, error: "minutes must be between 1 and 1440" };
  }
  const schedule = state.getState().schedule;
  schedule.override = {
    until: Date.now() + mins * 60000,
    minutes: mins,
    reason: String(reason || "manual override").slice(0, 120),
    by,
    at: Date.now(),
  };
  state.persist();
  state.audit("SCHEDULE_OVERRIDE", { minutes: mins, reason: schedule.override.reason, by });
  return { status: 200, ok: true, override: schedule.override };
}

function clearOverride(by = "admin") {
  const schedule = state.getState().schedule;
  const had = schedule.override;
  schedule.override = null;

  // Return to the timetable immediately rather than at the next transition: if
  // no period is running, whatever the override opened goes back to locked now.
  const now = new Date();
  const active = slotAt(now, schedule);
  schedule.activeSlotId = active ? active.id : null;
  // Re-arm the follower so its next tick does not think it just entered a new
  // window and re-lock a room the admin is working in.
  schedule.activeWindow = active ? windowKey(active) : null;
  schedule.activeLabel = active ? active.label : null;

  let relocked = 0;
  if (!active) {
    const open = seatsInGroup("all").filter((pc) => pc.desired === "UNLOCKED" || state.hasActiveGrant(pc));
    relocked = lockSeats(open, "override ended; no lab period running", by).length;
  }
  state.persist();
  state.audit("SCHEDULE_OVERRIDE_CLEARED", { by, had: had || null, seatsRelocked: relocked });
  return { status: 200, ok: true, relocked };
}

// ------------------------- timetable edits -------------------------

function getSchedule() {
  const schedule = state.getState().schedule;
  const all = images(schedule);
  return {
    slots: (schedule.slots || []).map(viewSlot),
    department: schedule.department || null,
    departments: DEPARTMENTS,
    image: all[0] || null, // kept for older callers: the first picture
    images: all,
    updatedAt: schedule.updatedAt || null,
  };
}

function saveSlots(raw, by = "admin", department) {
  const norm = normaliseSlots(raw);
  if (!norm.ok) return { status: 400, error: norm.errors[0], errors: norm.errors };

  const schedule = state.getState().schedule;

  if (department !== undefined) {
    const code = department === null ? "" : String(department).trim().toUpperCase();
    if (!code) {
      schedule.department = null;
    } else if (!DEPARTMENTS[code]) {
      return {
        status: 400,
        error: `unknown department "${department}"`,
        field: { department: `Choose one of: ${Object.keys(DEPARTMENTS).join(", ")}` },
      };
    } else {
      schedule.department = code;
    }
  }

  schedule.slots = norm.slots;
  schedule.updatedAt = Date.now();
  // Note: activeSlotId is deliberately NOT touched here. The follower decides
  // what to do about the change on its next tick - editing the grid mid-period
  // closes the old period and opens the new one, it never silently carries a
  // period's state across an edit.
  state.persist();

  state.audit("SCHEDULE_SAVED", {
    by,
    department: schedule.department,
    slotCount: norm.slots.length,
    periods: norm.slots.map((s) => `${DAY_NAMES[s.day]} ${fmtHM(s.start)}-${fmtHM(s.end)} ${s.label}`),
  });
  // Handed back in the same shape it was sent (HH:MM), so the dashboard can
  // re-render straight from the response.
  return { ok: true, slots: norm.slots.map(viewSlot), department: schedule.department, view: status() };
}

// Every picture gets an id so the admin can keep ONE PICTURE PER CLASS: the
// extract step reads a specific class's timetable and labels its periods with
// that class, and the confirmed grid merges them. MAX_IMAGES caps the folder.
const MAX_IMAGES = 8;

function images(schedule) {
  return Array.isArray(schedule.images) ? schedule.images : [];
}

function saveImage({ buffer, mime, name, by = "admin" }) {
  if (!IMAGE_TYPES[mime]) {
    return { status: 400, error: `Unsupported image type. Use PNG, JPG, WEBP or GIF.` };
  }
  if (!buffer || !buffer.length) return { status: 400, error: "The uploaded image was empty." };
  if (buffer.length > MAX_IMAGE_BYTES) return { status: 413, error: "Image is larger than 8 MB." };

  const schedule = state.getState().schedule;
  const dir = state.getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const img = {
    id: crypto.randomUUID().slice(0, 12),
    file: `timetable-${crypto.randomUUID().slice(0, 8)}.${IMAGE_TYPES[mime]}`,
    mime,
    name: String(name || "timetable").slice(0, 120),
    size: buffer.length,
    uploadedAt: Date.now(),
    uploadedBy: by,
  };
  fs.writeFileSync(path.join(dir, img.file), buffer);
  const all = images(schedule);
  all.push(img);
  // The folder must not grow forever: oldest pictures fall out when over cap.
  while (all.length > MAX_IMAGES) {
    const dropped = all.shift();
    try { fs.unlinkSync(path.join(dir, dropped.file)); } catch (_) {}
    state.audit("SCHEDULE_IMAGE_DROPPED", { file: dropped.file, by });
  }
  schedule.images = all;
  schedule.image = null; // legacy single-picture field is gone
  state.persist();
  state.audit("SCHEDULE_IMAGE_UPLOADED", { id: img.id, file: img.file, name: img.name, bytes: buffer.length, by });
  return { status: 200, ok: true, image: img, images: all };
}

function imageFile(id) {
  const schedule = state.getState().schedule;
  const all = images(schedule);
  // An explicit id that is gone must be refused (400 + hint), never silently
  // falls back to another class's picture. Only the no-id call may fall back.
  const img = id ? all.find((x) => x.id === String(id)) || null : all[0] || null;
  if (!img) return null;
  const safeName = path.basename(img.file);
  const full = path.join(state.getDataDir(), safeName);
  if (!fs.existsSync(full)) return null;
  return { path: full, mime: img.mime, meta: img };
}

function renameImage(id, name, by = "admin") {
  const schedule = state.getState().schedule;
  const img = images(schedule).find((x) => x.id === String(id));
  if (!img) return { status: 404, error: "No such picture." };
  const clean = String(name ?? "").replace(/[<>\u0000-\u001F]/g, " ").replace(/\s+/g, " ").slice(0, 120).trim();
  if (!clean) return { status: 400, error: "Give the picture a name (the class it belongs to, e.g. CSE 3A)." };
  img.name = clean;
  state.persist();
  state.audit("SCHEDULE_IMAGE_RENAMED", { id: img.id, name: clean, by });
  return { status: 200, ok: true, image: img };
}

function listImages() {
  return images(state.getState().schedule).map((x) => ({ ...x }));
}

function removeImage(id, by = "admin") {
  const schedule = state.getState().schedule;
  const dir = state.getDataDir();
  const all = images(schedule);
  // No id: remove every picture (the "Remove all" path).
  const doomed = id ? all.filter((x) => x.id === String(id)) : all.slice();
  for (const img of doomed) {
    try { fs.unlinkSync(path.join(dir, path.basename(img.file))); } catch (_) {}
  }
  schedule.images = id ? all.filter((x) => x.id !== String(id)) : [];
  if (doomed.length) {
    state.persist();
    state.audit("SCHEDULE_IMAGE_REMOVED", { ids: doomed.map((x) => x.id), by });
  }
  return { status: 200, ok: true, removed: doomed.length };
}

module.exports = {
  DAY_NAMES,
  isoDay, parseHM, fmtHM, humanSlot,
  normaliseSlots, slotAt, nextStart, buildPlan, status,
  groupSessions, analyse, DEPARTMENTS,
  tick, allocate, setOverride, clearOverride,
  getSchedule, saveSlots, saveImage, imageFile, removeImage, renameImage, listImages,
};
