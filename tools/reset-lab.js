#!/usr/bin/env node
// ----------------------------------------------------------------
// LabNexus - clear the lab roster
//
// Removes every registered seat and every grant from the admin state
// file, so the dashboard starts clean. Used when old machines have
// been replaced or the roster drifted from the physical room.
//
//   node tools/reset-lab.js               clear seats + grants + audit
//   node tools/reset-lab.js --keep-audit  clear seats + grants, keep history
//
// Stop the admin server first: it keeps state in memory and would
// write the old roster back over this change.
// ----------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "admin", "data", "labnexus-state.json");
const KEEP_AUDIT = process.argv.includes("--keep-audit");

if (!fs.existsSync(FILE)) {
  console.error(`No state file at ${FILE} - nothing to reset.`);
  process.exit(1);
}

let state;
try {
  state = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (err) {
  console.error(`State file is not valid JSON (${err.message}) - refusing to touch it.`);
  process.exit(1);
}

const seats = Object.values(state.computers || {});
const grants = Object.values(state.grants || {});

state.computers = {};
state.grants = {};
// A full reset starts the numbering over: the next PC to enroll is PC-1.
state.lastPcId = 0;

const now = new Date().toISOString();
if (!KEEP_AUDIT) {
  state.seq = (Number(state.seq) || 0) + 1;
  state.audit = [
    { id: state.seq, ts: now, action: "LAB_RESET", removedSeats: seats.length, removedGrants: grants.length },
  ];
} else {
  state.seq = (Number(state.seq) || 0) + 1;
  state.audit = [
    { id: state.seq, ts: now, action: "LAB_RESET", removedSeats: seats.length, removedGrants: grants.length },
    ...(state.audit || []),
  ].slice(0, 500);
}

fs.writeFileSync(FILE, JSON.stringify(state, null, 2));

console.log(`Cleared ${seats.length} seat(s) and ${grants.length} grant(s).`);
for (const pc of seats) {
  console.log(`  removed  PC-${pc.id}  ${pc.name}${pc.hostname ? ` (${pc.hostname})` : ""}`);
}
console.log(KEEP_AUDIT ? "Audit history kept." : "Audit history cleared.");
console.log("Start the admin server again to see an empty lab floor.");
