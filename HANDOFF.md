# LabNexus — Handoff (written 2026-10-22, end of session)

Read this first if you are a new session continuing this project. Everything below was
verified working unless marked ✅NOT.

---

## 1. What the project is

Lab PC control system in `C:\Users\shomu\Labsystem`, plain Node.js (no build step):

- **Dashboard** — `admin/` (Express server on port **8100**, web UI in `admin/web/`,
  state in `admin/data/labnexus-state.json`). Login: `admin123` (password stored in the
  state file, changeable).
- **PC agent** — `pc-agent/agent.js`, runs on each lab laptop, registers via UDP
  discovery (port 41888), heartbeats, gets LOCKED / UNLOCKED / MESSAGE / REBOOT commands.
  Enforces the lab lock with a fullscreen overlay (`pc-agent/overlay.js`).
- **Timetable engine** — `admin/schedule.js`. Admin enters weekly lab periods (day,
  start/end minutes, label, group). When a period starts: every seat's grants are
  revoked and all PCs get LOCKED ("seats stay locked until attendance is taken").
  Admin takes attendance → seats are allocated one grant per present student until
  the period ends. When the period ends (`tick()` every 2 s in `admin/engine.js`),
  `closeSlot` re-locks everything; the next period immediately re-opens the cycle.
  This automatic lock-at-period-end **already works** and now has a regression test.
- Parallel integration tests: `tools/integration-test.js` (spins up its own server on
  a throwaway port with a temp data dir; mocked AI server included). Run:
  `node tools/integration-test.js`.

⚠️ IMPORTANT environment facts:
- The **user's real production server is running on port 8100** right now, with real
  agents registered from the LAN (PC-1 172.31.3.143, PC-2 172.31.4.247). Never kill
  processes by name pattern (`pkill -f node`) — use the PID.
- Windows host; commands run through Git Bash. Backgrounding a server inside a SYNC
  terminal call makes the call time out — start servers in a separate call or via nohup
  pattern, then poll.
- `LABNEXUS_DATA_DIR` env var redirects the data dir (used by tests).

---

## 2. Work done in this and the previous sessions

### A. AI timetable auto-extraction (done, verified)
- `admin/extract.js` (new): sends a stored picture to a vision model using the
  owner's own key, parses the JSON answer (tolerates markdown fences/prose), maps day
  names, collapses duplicates, cleans junk rows, sanitizes labels the same way the
  manual grid does.
- `admin/server.js`: `POST /api/schedule/extract` (auth required, JSON body may carry
  `imageId`), plus a dependency-free `.env` loader (project root or `admin/`).
- Key: `OPENAI_API_KEY` in `.env` (project root or admin/). Never exposed to the
  browser or logs. Get key at https://freebuff.com/account/api. `.gitignore` covers
  `.env` now.
- Wizard UI (`admin/web/wizard.js` + `index.html` + `style.css`): "✨ Read lab periods
  from the picture" buttons in steps 1 and 3, a review modal grouping proposals by
  day, and two apply modes — **Replace my grid** / **Add to my grid** — both flowing
  through normal row validation + autosave. Server only *proposes*; admin confirms.

### B. One picture per class — multi-picture timetable (done this session, mostly verified)
- Storage: from a single `schedule.image` to `schedule.images[]`, each picture with an
  `id`, kept on disk in the data dir, **max 8** (oldest dropped automatically).
  Legacy single-image state migrates into `images[]` on load (`admin/state.js`).
- Endpoints (`admin/server.js`):
  - `POST /api/schedule/image` — raw body upload (express.raw), name via
    `X-File-Name` header.
  - `GET /api/schedule/image?id=<id>` — serve one (no id = first).
  - `GET /api/schedule/images` — list metadata.
  - `PUT /api/schedule/image/:id` — rename (the name is the class, e.g. "CSE 3A",
    and feeds the extraction prompt as a hint).
  - `DELETE /api/schedule/image?id=<id>` — remove one (no id = remove all).
- `admin/extract.js`: takes `imageId` and uses the picture's name as a class-name hint
  so labels come out per class ("Sie Lab CSD-C" style).
- Wizard step 1 is now a **gallery**: upload / rename / remove several pictures, open
  each full size in the lightbox, and run extract per picture, merging into the grid.
- Status payload (`schedule.status()`): `runningAll` lists all concurrent periods,
  `next` + `nextBeyond` — so the banner can show the next class after the ongoing one.

### C. Bugs found and fixed (all fixed, fixes verified)
1. **Wizard extract call was sent as GET** (`api()` with no body) → POST-only endpoint
   404 and an empty error string. Fixed in `wizard.js` — posts correctly now.
2. **`saveImage` never wrote the file to disk** — the multi-image refactor dropped the
   `fs.writeFileSync`. Upload returned ok, state listed the picture, but every GET
   served 404 ("No timetable image uploaded yet."). Re-added the write before
   `persist()` in `admin/schedule.js`. Manually verified byte-for-byte round-trip
   (upload → serve identical bytes, content-type image/png) against a throwaway
   server with `LABNEXUS_DATA_DIR=/tmp/lnr-dbg`.

### D. Verification status (all done this session)
- Integration suite: **202/202 checks pass.** Covers per-picture extract (class-name
  prompt, imageId), gallery/list endpoints, legacy migration, byte-for-byte image
  upload→serve, and the back-to-back re-lock-at-the-boundary cycle.
- Browser walkthrough done against a disposable instance (port 8199, temp data dir,
  login admin123): gallery shows one card per picture with rename box + "✨ Read
  periods" + remove; rename persisted ("CSE 3A"); per-picture extract without a key
  shows the friendly setup message; per-picture lightbox opens the right image;
  remove updates DOM and server. Production (8100) untouched.
- **✅NOT: real-photo extraction accuracy** — needs the user's actual
  `OPENAI_API_KEY` and a real timetable photo. The user already uploaded a real
  201 KB timetable.png on the production server but no extraction was run on it.
- **✅NOT: production restart** — the running 8100 server still has the
  pre-edit code. The user should restart the dashboard during a quiet moment
  (agents re-register automatically; no lab period was active at handoff time).

---

## 3. What remains to be done

1. User: set `OPENAI_API_KEY` in `.env`, restart the dashboard (important — the
   running 8100 process has pre-edit code), and test extraction on real pictures.
4. Optionally: per-day banner polish for "next class after this one" if the current
   `runningAll`/`next` display in `admin/web/app.js` isn't clear enough.
5. Google Play packaging (blocked on user decisions, not code):
   - Developer account $25 at play.google.com/console; post-Nov 2023 personal
     accounts need a closed test: 12 testers, 14 continuous days, before production.
   - Dashboard must be reachable at a public HTTPS URL + icons (192/512) +
     `.well-known/assetlinks.json`; PWABuilder or Bubblewrap → TWA AAB; target
     Android 16 (API 36) from Aug 2026; privacy policy + Data safety form; reviewers
     need working credentials.
   - When the user has an account + hosting chosen, packaging artifacts can be
     prepared (about an afternoon of work).

---

## 4. Key files map

| File | Role |
|---|---|
| `admin/server.js` | Express routes (PC control, attendance, schedule, images, extract, SSE) |
| `admin/schedule.js` | Timetable logic: slots/window/status/allocation/pictures |
| `admin/state.js` | State load/persist/migration/audit |
| `admin/engine.js` | 2 s tick: evaluateAndDispatch, grant expiry, command queue |
| `admin/extract.js` | Vision-model extraction + prompt + parsing |
| `admin/web/wizard.js` / `index.html` / `style.css` / `app.js` | Dashboard frontend |
| `pc-agent/agent.js` / `overlay.js` | Lab laptop agent + lock overlay |
| `tools/integration-test.js` | Full mock-server integration suite |
| `START-LABNEXUS-DASHBOARD.bat` / `STOP-LABNEXUS.bat` | User's server scripts |
