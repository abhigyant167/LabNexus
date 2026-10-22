# LabNexus (Node v1)

LAN lab-control system: one **admin laptop** runs the server + dashboard; each **lab PC** runs a small outbound agent. No hardcoded IPs — PCs auto-discover the server via UDP broadcast, so it keeps working even when the admin laptop's IP changes after a restart.

```
┌────────────────────────┐         UDP broadcast discovery          ┌────────────────────┐
│  admin/  (your laptop) │◄─────────────────────────────────────────│ pc-agent/ (lab PC) │
│  Express server :8000  │                                          │  Node agent        │
│  Dashboard (web)       │   ◄──────── HTTP :8000 ────────────────  │  Outbound only     │
│  UDP responder :41888  │     heartbeat + command pickup           │  Lock overlay      │
└────────────────────────┘                                          └────────────────────┘
```

## Folder layout

```
admin/            ← run on the ADMIN laptop only
├── server.js     Express API + static dashboard + SSE
├── state.js      computers, grants, commands, audit (JSON file persistence)
├── engine.js     2s reconcile loop: states, grant expiry, command dispatch
├── sse.js        live push to the dashboard
├── discovery.js  UDP responder (agents find the server automatically)
├── web/          dashboard (plain HTML/CSS/JS)
└── data/         labnexus-state.json (auto-created)

pc-agent/         ← copy to EVERY lab computer
├── agent.js      discovers server, polls every 3s, executes commands
├── overlay.js    lock screen (console v1; Electron upgrade optional)
├── provision.js  optional: pre-provision a folder with a fixed pcId + token
├── NEW-LAPTOP.bat  double-click wrapper for the above
├── data/identity.json  written on first run: this machine's enrolled pcId + token
├── ready/        generated per-laptop folders (ready/PC-5, ready/PC-6…)
├── data/         provisioned.json - what this laptop has already handed out
└── config.json   pcId, token, optional serverUrl override, poll interval

tools/            ← developer tools
├── integration-test.js  boots a throwaway server + N fake agents, 150 checks
├── hod-review.js        walks the timetable API like a Head of Department and prints what it says
├── sim-agents.js        enroll N fake lab PCs on a running server and keep them online
└── sim-agent.js         pretend to be one lab PC against a running server

_old/             ← previous Express prototype (kept for reference, not used)
```

## 1. Admin laptop setup

```bat
cd admin
npm install
npm start
```

- Dashboard: **http://localhost:8000**
- The server binds `0.0.0.0` so lab PCs can reach it.
- Allow it through the firewall **once**, as administrator. Windows labels home/college WiFi as "Public" or "Private" unpredictably — the rules below cover **all profiles** so it works either way:

```bat
netsh advfirewall firewall add rule name="LabNexus TCP" dir=in action=allow protocol=TCP localport=8000 profile=any
netsh advfirewall firewall add rule name="LabNexus Discovery UDP" dir=in action=allow protocol=UDP localport=41888 profile=any
```

Check which profile your WiFi is on with `netsh advfirewall show allprofiles` — if "Public" says connected, the old `profile=private` rules were silently not applying.

These are the only two inbound rules ever needed — on the admin laptop only. Lab PCs need **no** inbound rules (agents poll outbound).

## 2. Lab PC setup

### The easy way — nothing to edit, ever

1. Copy the whole `pc-agent/` folder to the lab PC (same folder, every PC).
2. Install Node.js ≥ 18 (no `npm install` needed — stdlib only).
3. Double-click `START-AGENT.bat`.

On its first run the agent **enrolls with the server**: it is handed its own `pcId` and a
random token, which it saves to `pc-agent/data/identity.json` on that machine. Copy the
same folder to ten laptops and each one gets its own seat — no `config.json` editing, no
reused ids, no restart dance.

**Seats are numbered in arrival order.** The server counts the systems already recorded
and gives the new machine the next number: `PC-1`, `PC-2`, `PC-3`… The agent prints the
count it was told (`3 system(s) already registered - this machine is PC-4`) and the
dashboard labels the seat with that number; the hostname stays visible underneath. A
retired number is not reused while the roster exists — `reset-lab.js` clears the roster
and starts again at `PC-1`.

The identity is bound to that machine (hostname + MAC). A folder copied from a PC that
already enrolled is detected as a different machine and enrolls fresh, so cloning the
folder can never make two laptops fight over one seat. Reinstalling the agent on the same
PC reclaims its old seat instead of leaving a ghost behind.

If a legacy `config.json` still claims a `pcId` that another laptop already owns, the
agent does not get stuck: it enrolls itself a new seat and carries on (audited as
`AGENT_ENROLLED`).

`NEW-LAPTOP.bat` / `provision.js` still exist for pre-provisioning offline
(`ready/PC-<n>/` folders with pinned identities), but they are optional now.

| Command (in `pc-agent/`) | What it does |
|---|---|
| `node provision.js --next` | pre-provision a folder with a fixed pcId + random token (offline) |
| `node provision.js --next --server-url http://<admin-ip>:8000 --password <admin pw>` | also skips pcIds that are already live on the running server |
| `node provision.js --next --pin http://<admin-ip>:8000` | hard-code the server address (skips discovery on that laptop) |
| `node provision.js --id 7 --name "PC-7"` | fully explicit identity |
| `node provision.js --list` | everything this laptop has already handed out |

### Clearing the roster

Replaced machines or a drifted seat list? Stop the admin server, then:

```bat
node tools\reset-lab.js
```

It removes every registered seat and grant (and the audit history; `--keep-audit` keeps
it) so the dashboard starts empty. Agents that are still running re-enroll on their next
start — each with a fresh, unique seat.

### The manual way (if you would rather see every field)

1. Copy the whole `pc-agent/` folder to the lab PC.
2. Node.js ≥ 18 must be installed (no npm install needed — stdlib only).
3. Edit `config.json` so each PC is unique (optional now — leave it alone and the agent enrolls):

```json
{
  "pcId": 1,
  "token": "demo-agent-1",
  "serverUrl": "",
  "pollMs": 3000
}
```

| Field | Meaning |
|---|---|
| `pcId` | optional. Set it only to pin a machine to a seat; otherwise the server assigns one (saved in `data/identity.json`). **Never reuse one.** |
| `token` | that PC's secret. The server binds it on first registration/enrollment. Ignored when a saved identity exists |
| `serverUrl` | leave empty to auto-discover; or e.g. `http://172.31.10.44:8000` to pin |
| `pollMs` | heartbeat/poll interval (3000 ms default) |

4. Start the agent — **double-click `START-AGENT.bat`** (or `cd pc-agent && node agent.js`):

It prints `Found server at http://<ip>:8000` when discovery succeeds, then locks the screen. If you see `Cannot find module ...\agent.js`, you are in the wrong folder — the agent is inside the `pc-agent` subfolder.

### If the agent can't find the server

Run the built-in diagnostic on the **lab PC**:

```bat
node diagnose.js
```

It checks your interfaces, tries UDP discovery, then falls back to a TCP sweep of the whole subnet, and prints exactly what to fix. Optional: `node diagnose.js 192.168.1.20` to probe a specific admin-laptop IP.

### If auto-discovery fails

Some Wi-Fi routers block UDP broadcast ("AP isolation"). Then either:
- set `serverUrl` in `config.json` to the admin laptop's current IP (`ipconfig` on the admin laptop), or
- keep discovery and add a UDP firewall allow rule on the admin laptop (§1 above covers it).

## 3. What the dashboard does

- **Seat grid** with live state: `LOCKED`, `UNLOCKED_IN_USE`, `UNLOCKED_IDLE`, `SLEEPING`, `UNKNOWN`
- Counts row: total / online / locked / unlocked / unknown
- Per-PC actions: **Grant (unlock 15/30/60/120 min)**, Lock, Sleep, Wake (real WOL since v1.1), Message, Reboot (10 s, confirmed), **Forget**
- **Timetable** panel: keep one picture of the official timetable, confirm the weekly grid, and the lab follows its own timetable — see §5e
- **Forget** removes a seat entirely — use it when a laptop is decommissioned or renumbered. Stop the agent on that PC first, or it re-registers within seconds.
- **Audit log** of every action, state transition, grant, command
- Live updates via SSE, reconnects automatically

## 4. States and safety model

- A PC is `UNKNOWN` — never `OFF` — when its heartbeat goes missing. Missing evidence is not proof of anything.
- `desired` (what admin wants) is stored separately from `observed` (what the agent reports). A queued command is not treated as a completed transition.
- **Fail closed:** if the server becomes unreachable, the agent stays locked and keeps retrying discovery every 10 s. It never silently unlocks.
- Grants expire server-side; the agent re-locks automatically at expiry (checks on every poll). The agent also refuses to stay open without a live grant, so a missed command cannot leave a seat open.
- **A restart is visible.** The agent sends its process start time; when it changes, the server audits `AGENT_RESTARTED` and stops trusting what it previously believed about that PC's overlay until the next heartbeat proves it again.
- **Evidence is never invented.** A fresh heartbeat with no enforcement report reads `UNKNOWN`, not the previous `LOCKED`. An agent that reports "not enforcing" while the admin wants `LOCKED` is shown as open *with* `desired: LOCKED` — the mismatch is the message.
- **One pcId, one laptop.** A second machine claiming an existing pcId with a different token is refused (`409 PC_ID_TAKEN`, audited as `AGENT_ID_CONFLICT`) — it never silently shares the seat. The agent then enrolls itself its own seat automatically instead of waiting for an admin.

### Agent self-healing (why a lab PC needs no babysitting)

- Cannot find the server? It retries broadcast discovery, then a subnet sweep, forever — locked the whole time.
- Server still booting when the PC starts? Registration backs off and retries instead of exiting (`process.exit(1)` used to kill the agent on a wifi hiccup).
- Server rebooted with an empty state file? A heartbeat returns `404`, so the agent re-registers itself.
- Wrong token or a taken pcId? It enrolls a seat of its own and keeps running — no `config.json` editing, no restart.

## 5. Admin login (dashboard)

The dashboard now requires a password. Default: **`admin123`** - change it in `admin/state.js` → `settings.adminPassword` (top of the file). Sessions last 12h; every login attempt is audited.

Agents authenticate with their per-PC token (`X-PC-Token` header). A registered PC rejects any other token; wrong-token attempts appear in the audit log as `AGENT_AUTH_FAILED`. Registration is bootstrap-only: the first agent to claim an ID sets its token, later mismatches are rejected.

## 5b. Wake-on-LAN: prerequisites and honest behavior

Clicking **Wake** on the dashboard sends real magic packets (6×FF + MAC×16, UDP 9/7, to all local broadcast addresses, 3 attempts per port).

**The packet is only the request.** The seat shows `WAKING` for 45 s; only a fresh agent heartbeat flips it back to a real state. If nothing happens, WOL is blocked somewhere - check, on the lab PC:

1. **BIOS/UEFI**: enable "Wake on LAN" / "Power On by PCI-E" (name varies).
2. **NIC driver**: Device Manager → network adapter → Advanced → "Wake on Magic Packet" = Enabled; Power Management tab → "Allow this device to wake the computer" ✓.
3. **Fast startup must be OFF** (it puts the NIC in a state that swallows magic packets after shutdown). `setup-pc.ps1` disables it.
4. **Sleep vs shutdown**: WOL from **sleep (S3)** works on most laptops when the above hold. From full shutdown it only works with "Wake on LAN from S5" support + fast startup off. From **hibernate**, results vary.
5. Some laptops only WOL on AC power, not battery.

Run once as administrator on each lab PC:

```powershell
powershell -ExecutionPolicy Bypass -File setup-pc.ps1
```

It enables the NIC wake flags, disables fast startup, registers a logon autostart task for the agent, and stops the PC auto-sleeping on its own (sleep is the admin's call now). Rollback notes are printed at the end.

## 5c. Lock enforcement model

- Locked machines show a **fullscreen topmost overlay** (PowerShell/WPF) with no close button. If a student closes it with Alt+F4, the agent's **watchdog re-spawns it within ~1 s** as long as the server says the PC is locked.
- Unlock happens **only** from the dashboard (admin password required) or when an active grant exists. When the grant expires, the agent re-locks itself on its next poll.
- Server unreachable → agent stays/stays locked (fail closed), keeps retrying discovery.
- **Honest limits:** a local admin can kill `node.exe` or the whole agent - the server will then show the PC as stale/UNKNOWN rather than pretend it is enforcing. The overlay is a strong helper, not an OS security boundary. For a hardened setup, run the agent as a Windows service (planned) and use a standard (non-admin) student account.

## 5d. Verifying the system (dev tools)

No test framework, no installs — plain Node. Run from the project root:

```bat
node tools\integration-test.js
```

It boots its own server on a random port with a throwaway state file, then drives the
full protocol with simulated laptops and checks 150 things: registration, token
rejection, duplicate-pcId refusal, lock/unlock, grants, self-expiry, a restarting agent,
a silent seat, malformed input, the timetable (validation, shared windows, the analysis,
attendance, overrides) and the honesty rules (no heartbeat -> `UNKNOWN`).
Exit code 0 means everything passed.

```bat
node tools\sim-agent.js --id 5 --token lnx-5-…   --enforced false
```

When the dashboard says the lab is open but no seat moves, put fake PCs on it instead of
opening laptops:

```bat
node tools\sim-agents.js http://localhost:8000 6 --minutes=20
```

To review the timetable the way an admin would (validation messages, shared windows,
attendance, override, editing the grid mid-period), point the review harness at a running
server and read its output:

```bat
node tools\hod-review.js http://localhost:8000
```

`sim-agent` pretends to be one lab PC against a **running** server, so you can demo or
rehearse the dashboard alone (no student laptop needed). Keys: `u` report unlocked,
`l` report locked, `q` quit. `--once` sends a single heartbeat.

### Tuning knobs (environment variables, all optional)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | 8000 | admin server port |
| `LABNEXUS_DATA_DIR` | `admin/data` | where the state file lives (tests use a temp dir) |
| `LABNEXUS_AGENT_TIMEOUT_MS` | 12000 | how long without a heartbeat before a seat is no longer "fresh" |
| `LABNEXUS_TIME_SCALE` | 1 | demo clock: `60` makes a 30-minute grant really last 30 seconds |

```bat
rem show grant expiry live, without waiting half an hour
set LABNEXUS_TIME_SCALE=60 && cd admin && npm start
```

## 5e. Timetable: the lab follows its own timetable

**Why there is a confirmation step:** reading a *photo* of a timetable reliably needs OCR, and OCR
gets grid times wrong often enough that trusting it would be worse than useless — the lab would
lock at the wrong minute. So the picture is kept as the reference and the **confirmed grid is what
the lab actually follows**. You copy lab hours out of the picture once; the app does everything
after that on its own.

**Setting it up (dashboard → Timetable tab, right edge)**

Everything happens in one guided sidebar, one step at a time. Each step only offers the one action
that makes sense next, so nothing has to be explained to the admin.

0. **The live strip above the PC grid** already says what the timetable is doing: *no lab hours yet*,
   *next class in 2h 15m*, or *in period — 2 sections in the room together*. It is the first thing on
   the page, so the timetable is never a hidden feature.
1. **Picture** — drop the official timetable picture (PNG/JPG/WEBP/GIF, ≤ 8 MB, stored at
   `admin/data/timetable.*`, served only to a logged-in admin). It is optional, and it stays
   openable at full size from every later step, so you can copy hours from it without leaving the page.
2. **Department** — pick the department that owns the lab (CSE, CSD, CSM, CSO, IT, AIDS, ECE, EEE,
   MECH, CIVIL, OTHER). Sections from other departments can still use the lab; you just name them in
   the lab hours.
3. **Lab hours** — one row per lab period: day, from, to, name. Two sections in the room at the same
   time are added with the **⧉** button on the row, which copies the day and hours and asks only for
   the second name. Rows are checked as you type (a backwards time, an overlap or a duplicate is
   marked on the row and the **Analyse** button explains what to fix), and valid rows are saved as you
   go — closing the drawer or refreshing the page does not lose the grid.
4. **Review** — a short processing animation, then exactly what an admin needs: the period **running
   now** (with minutes left), the **next class** (with a countdown), the **shared lab windows** with
   every section named, the next 7 days with real dates, and any checks the app wants you to see. The
   panel refreshes itself every 30 seconds while it is open.

**What it does by itself, with no further clicks**

| Moment | What happens |
|---|---|
| A period starts | The period is announced as running and every seat goes back to locked — a clean room, ready for attendance |
| During the period | The lab is **open**, but **no seat is handed out automatically** |
| You take attendance | One seat per student present, and **not one more** — the rest stay locked |
| The period ends | Every seat re-locks and every grant is revoked, automatically |
| No period running | The whole lab is locked |

**Taking attendance** (Timetable → *During a period*)

- **Head count:** type how many students are present. **Roll numbers:** paste one per line, and each
  seat is labelled with the roll number that got it. Then **Take attendance**.
- The controls say which state you are in (*In period until 11:00*, *Override until 11:20*, or *No
  period running — attendance opens when one starts*), and are disabled outside a period instead of
  letting you press a button that can only fail.
- Seats are chosen from PCs that are **actually online**, lowest `pcId` first, so it is
  deterministic and explainable — the same students get the same machines every session.
- A seat's grant can never outlive the period: it expires when the period ends.
- If fewer seats are online than students present, the panel says exactly that —
  "Only 2 seat(s) were online - 5 student(s) have no machine" — instead of quietly short-changing you.
- The allocation is audited (`ATTENDANCE_ALLOCATED`) with the period, the count and the seat numbers.
  With no seat reporting at all nothing is recorded: you get one clear sentence telling you to start
  the agents, not an empty allocation in the history.

**Override** — for a lab outside lab hours, **Override 30 min** pauses the timetable. Attendance
works during an override, and **End override** immediately re-locks whatever it opened (inside a
period it simply hands control back to the timetable, because the session is still running).

**Honest notes**

- Overlapping periods on the same day are rejected rather than silently resolved, a period whose end
  is before its start is rejected too, and an exact duplicate row is refused (it would otherwise be
  reported as "2 sections share this lab" with the same name twice). Overnight periods are not
  supported.
- A period is identified by its day and hours, not by its row number. Saving the grid while a period
  runs — even reordering rows — never re-locks the room or revokes the seats handed out in it. Only a
  real change to that window (different day or hours) closes the old period and opens the new one.
- Period names are cleaned on the way in: pasted markup (`<b>Sec A</b>`) and control characters are
  stripped rather than stored, so the dashboard and the audit log never show boxes or tags.
- Allocation needs online seats: a PC whose agent is not reporting is never allocated, because a
  student cannot use a machine the server cannot reach.
- The picture is **not** read automatically. If you want OCR of the photo as a convenience, that is a
  deliberate future add-on; the confirmed grid remains the source of truth either way.

## 6. Honest limitations

This is a **lab management tool**, not a security boundary:

- A local administrator on the PC can kill the agent process or bypass the overlay. The console overlay is a helper, not an OS shell.
- Software cannot prevent long-press power-off, mains removal, external boot, disk replacement, or firmware changes. Those need BIOS passwords, boot-order locks, case locks and supervision.
- The token shipped in the example `config.json` (`demo-agent-1`…) proves nothing about identity. Any PC that enrolls gets a random server-issued token saved to `pc-agent/data/identity.json` — which is what every real rollout uses, so no shared secret is ever reused across machines.
- Sleep uses `rundll32 powrprof.dll,SetSuspendState` on Windows, which follows the OS power settings. Wake sends real magic packets, but the packet is only a request — if WOL is disabled in BIOS or fast startup is on, nothing happens and the seat stays `UNKNOWN` (see §5b).
- Do not run the admin server on an untrusted network: the dashboard needs a login, but the agent API is only as strong as the per-PC token, and v1 speaks plain HTTP. Anyone who can sniff the LAN can replay a token. HTTPS and per-PC token rotation are the next security milestones.

## 7. Roadmap (from the master prompt, next milestones)

- A1: access requests from the lock screen, alerts panel, kill switch
- A2: ~~attendance + deterministic seat allocation~~ ✅ done (§5e), students/sections rosters, named per-student history
- A3: ~~timetable slots + scheduler~~ ✅ done (§5e), energy estimates (demo clock ✅ done — `LABNEXUS_TIME_SCALE`), optional OCR of the timetable picture
- B: ~~real Wake-on-LAN + verification~~ ✅ done, cached offline authorization, agent-as-Windows-service
- C: hardening profiles with rollback (per-control status vocabulary)
- D: ~~multi-PC provisioning~~ ✅ done (`pc-agent/provision.js`), ~~integration test~~ ✅ done (`tools/integration-test.js`), seat removal ✅ done (`Forget`), self-healing agent (retries discovery and registration forever, re-registers if the server forgets it) ✅ done
