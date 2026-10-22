#!/usr/bin/env node
// ----------------------------------------------------------------
// LabNexus - HOD review harness
//
// Walks the dashboard the way a Head of Department would, against a
// server that is already running, and prints what the system actually
// says at every step. It is a review aid, not a pass/fail unit test:
// every line is something an admin would read on screen.
//
//   node tools/hod-review.js http://localhost:8100
// ----------------------------------------------------------------

const BASE = process.argv[2] || "http://localhost:8000";
const PASSWORD = "admin123";

let cookie = "";

async function call(method, path, body, raw) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (raw) {
    Object.assign(headers, raw.headers || {});
    payload = raw.body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text.slice(0, 120);
  }
  return { status: res.status, ok: res.ok, data };
}

const pad = (s) => String(s).padEnd(44);
function line(label, value) {
  console.log(`  ${pad(label)} ${value}`);
}
function head(title) {
  console.log(`\n=== ${title} ===`);
}

function hhmm(offsetMinutes) {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function isoDay(d = new Date()) {
  return ((d.getDay() + 6) % 7) + 1;
}

// A 1x1 PNG is enough: the upload path only checks type and size.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

(async () => {
  head("0. before login");
  let r = await call("GET", "/api/schedule");
  line("GET /api/schedule", `${r.status} ${JSON.stringify(r.data).slice(0, 90)}`);

  head("1. login");
  r = await call("POST", "/api/auth/login", { password: PASSWORD });
  line("login", r.status);

  head("2. first look at an untouched timetable");
  r = await call("GET", "/api/schedule");
  line("slots", (r.data.slots || []).length);
  line("department", String(r.data.department));
  line("status.mode", r.data.status?.mode);
  line("status.next", JSON.stringify(r.data.status?.next));
  line("plan events", (r.data.plan || []).length);

  r = await call("GET", "/api/schedule/analysis");
  line("analysis.hasTimetable", r.data.hasTimetable);
  line("analysis.issues", JSON.stringify(r.data.issues));
  line("analysis.running", String(r.data.running));
  line("analysis.next", String(r.data.next));

  head("3. upload the reference picture");
  r = await call("POST", "/api/schedule/image", undefined, {
    headers: { "Content-Type": "image/png", "X-File-Name": encodeURIComponent("cse-timetable.png") },
    body: PNG,
  });
  line("upload png", `${r.status} ${JSON.stringify(r.data.image || r.data.error)}`);
  r = await call("POST", "/api/schedule/image", undefined, {
    headers: { "Content-Type": "application/pdf", "X-File-Name": "timetable.pdf" },
    body: PNG,
  });
  line("upload PDF (should be refused)", `${r.status} ${JSON.stringify(r.data.error)}`);
  r = await call("POST", "/api/schedule/image", undefined, {
    headers: { "Content-Type": "image/png" },
    body: Buffer.alloc(0),
  });
  line("upload empty body", `${r.status} ${JSON.stringify(r.data.error)}`);

  head("4. choose a department");
  r = await call("PUT", "/api/schedule", { slots: [], department: "CSE" });
  line("save dept CSE", `${r.status} ${JSON.stringify(r.data.department || r.data.error)}`);
  r = await call("PUT", "/api/schedule", { slots: [], department: "cse" });
  line("save dept 'cse' (lowercase)", `${r.status} ${JSON.stringify(r.data.department || r.data.error)}`);
  r = await call("PUT", "/api/schedule", { slots: [], department: "MECHANICAL" });
  line("save dept 'MECHANICAL'", `${r.status} ${JSON.stringify(r.data.error)}`);

  head("5. grid validation - what an HOD would get wrong");
  const bad = [
    ["end before start", [{ day: 1, start: "11:00", end: "09:00", label: "DBMS Lab" }]],
    ["no label", [{ day: 1, start: "09:00", end: "11:00", label: "   " }]],
    ["half overlap", [
      { day: 1, start: "09:00", end: "11:00", label: "Sec A" },
      { day: 1, start: "10:00", end: "12:00", label: "Sec B" },
    ]],
    ["exact duplicate rows", [
      { day: 1, start: "09:00", end: "11:00", label: "Sec A" },
      { day: 1, start: "09:00", end: "11:00", label: "Sec A" },
    ]],
    ["bad day", [{ day: 8, start: "09:00", end: "11:00", label: "x" }]],
    ["bad time", [{ day: 1, start: "9am", end: "11:00", label: "x" }]],
    ["label with markup", [{ day: 1, start: "09:00", end: "11:00", label: "<b>Sec A</b>" }]],
  ];
  for (const [name, slots] of bad) {
    r = await call("PUT", "/api/schedule", { slots, department: "CSE" });
    line(name, `${r.status} ${JSON.stringify(r.data.error || (r.data.slots || []).map((s) => s.label))}`);
  }

  head("6. a realistic Monday: two sections share the lab");
  const tomorrow = new Date(Date.now() + 86400000);
  const day = isoDay(tomorrow);
  const grid = [
    { day, start: "09:00", end: "11:00", label: "DBMS Lab - Sec A" },
    { day, start: "09:00", end: "11:00", label: "OS Lab - Sec B" },
    { day, start: "11:15", end: "13:15", label: "Networks Lab - Sec A" },
  ];
  r = await call("PUT", "/api/schedule", { slots: grid, department: "CSE" });
  line("save grid", `${r.status} ${(r.data.slots || []).map((s) => s.label).join(" | ") || JSON.stringify(r.data.error)}`);
  line("ids after save", JSON.stringify((r.data.slots || []).map((s) => s.id)));

  r = await call("GET", "/api/schedule/analysis");
  const a = r.data;
  line("next", a.next ? `${a.next.when} ${a.next.sections.map((s) => s.label).join(" + ")} in ${a.next.inMinutes}m` : "none");
  line("shared windows", (a.shared || []).map((s) => `${s.when}:${s.sections.length}`).join(", ") || "none");
  line("issues", (a.issues || []).map((i) => i.text.slice(0, 70)).join(" || "));
  line("upcoming count", (a.upcoming || []).length);
  line("coverage", JSON.stringify(a.coverage));

  head("7. a period that is running right now + two sections in it");
  const nowDay = isoDay();
  const grid2 = [
    { day: nowDay, start: hhmm(-20), end: hhmm(+40), label: "DBMS Lab - Sec A" },
    { day: nowDay, start: hhmm(-20), end: hhmm(+40), label: "OS Lab - Sec B" },
  ];
  r = await call("PUT", "/api/schedule", { slots: grid2, department: "CSE" });
  line("save running grid", r.status);
  await new Promise((res) => setTimeout(res, 1200)); // let the follower tick
  r = await call("GET", "/api/schedule/analysis");
  line("running", r.data.running ? `${r.data.running.when} ${r.data.running.sections.length} sections` : "none");
  line("next while running", r.data.next ? `${r.data.next.when} in ${r.data.next.inMinutes}m` : "none");
  line("upcoming[0]", r.data.upcoming?.[0]?.when || "none");
  line("shared cards", (r.data.shared || []).length);
  line("status.mode", (await call("GET", "/api/schedule")).data.status?.mode);

  head("8. attendance with no seats reporting in");
  r = await call("POST", "/api/schedule/present", { count: 3 });
  line("present=3", `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  r = await call("POST", "/api/schedule/present", { count: 0 });
  line("present=0", `${r.status} ${JSON.stringify(r.data.error || r.data).slice(0, 80)}`);
  r = await call("POST", "/api/schedule/present", { names: ["23CS001", "23CS002"] });
  line("names", `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

  head("9. override");
  r = await call("POST", "/api/schedule/override", { minutes: 30, reason: "open lab" });
  line("start override", `${r.status} ${JSON.stringify(r.data.override || r.data.error)}`);
  r = await call("POST", "/api/schedule/override", { minutes: 0 });
  line("override 0 min", `${r.status} ${JSON.stringify(r.data.error || r.data.override)}`);
  r = await call("POST", "/api/schedule/override", { minutes: 5000 });
  line("override 5000 min", `${r.status} ${JSON.stringify(r.data.error || r.data.override)}`);
  r = await call("DELETE", "/api/schedule/override");
  line("end override", `${r.status} ${JSON.stringify(r.data)}`);

  head("10. editing the grid while a period is running");
  const before = (await call("GET", "/api/schedule")).data.status;
  r = await call("PUT", "/api/schedule", { slots: grid2.concat([{ day: nowDay, start: "20:00", end: "21:00", label: "Extra Lab" }]) });
  line("save extra row", r.status);
  await new Promise((res) => setTimeout(res, 1200));
  const after = (await call("GET", "/api/schedule")).data.status;
  line("running slot before/after", `${before.activeSlot?.label} -> ${after.activeSlot?.label}`);
  line("mode before/after", `${before.mode} -> ${after.mode}`);

  head("11. an empty grid (admin cleared everything mid-period)");
  r = await call("PUT", "/api/schedule", { slots: [], department: "CSE" });
  line("save empty", `${r.status} ${JSON.stringify(r.data.slots)}`);
  await new Promise((res) => setTimeout(res, 1200));
  const emp = (await call("GET", "/api/schedule")).data;
  line("mode after clear", emp.status.mode);
  line("next after clear", String(emp.status.next));
  const an = (await call("GET", "/api/schedule/analysis")).data;
  line("analysis hero text", an.hasTimetable ? "?" : "no timetable");
  line("analysis issues", JSON.stringify((an.issues || []).map((i) => i.level)));

  head("12. wrong department later (typo / changed mind)");
  r = await call("PUT", "/api/schedule", { slots: grid, department: "CIVIL" });
  line("switch to CIVIL", `${r.status} ${r.data.department}`);
  line("analysis dept label", (await call("GET", "/api/schedule/analysis")).data.departmentLabel);

  head("13. 7 days of one window - repetition check");
  const week = [];
  for (let d = 1; d <= 7; d++) {
    week.push({ day: d, start: "09:00", end: "11:00", label: "DBMS Lab - Sec A" });
    week.push({ day: d, start: "09:00", end: "11:00", label: "OS Lab - Sec B" });
  }
  await call("PUT", "/api/schedule", { slots: week, department: "CSE" });
  const weekA = (await call("GET", "/api/schedule/analysis")).data;
  line("slots", weekA.slotCount);
  line("shared returned", (weekA.shared || []).length);
  line("upcoming returned", (weekA.upcoming || []).length);
  line("issues", (weekA.issues || []).length);

  console.log("");
})();
