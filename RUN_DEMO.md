# LabNexus — two-laptop demo (10 minutes)

One admin laptop + one lab PC on the same Wi-Fi/LAN. Everything is Node.js.

## Prep (once)

1. Both laptops: install Node.js ≥ 18.
2. Admin laptop: allow the two firewall rules from README §1 (run once as administrator).
3. Lab PC: copy the `pc-agent/` folder over (USB / shared drive / `git clone`).
   - **Nothing to edit.** On first run the agent enrolls with the server and is handed its
     own pcId + token, saved on that machine in `pc-agent/data/identity.json`.
   - Copy the same folder to every other PC the same way — each one enrolls its own seat.
     Press **Forget** on any seat you retire.

## Demo sequence

**On the admin laptop**

1. ```bat
   cd admin
   npm install
   npm start
   ```
2. Open **http://localhost:8000** — the grid says "No PCs registered yet."

**On the lab PC**

3. `config.json` can stay exactly as shipped (`"serverUrl": ""`) — no id to edit.
4. ```bat
   cd pc-agent
   node agent.js
   ```
5. Expected output (ids are assigned by the server, so yours may differ):
   ```
   Found server at http://<admin-ip>:8000
   Enrolled as PC-1 (new seat) - identity saved to data/identity.json
   0 system(s) already registered - this machine is PC-1.
   Registered as PC-1 (LAB-PCNAME) at http://<admin-ip>:8000
   [overlay] LOCK: Locked by LabNexus
   ```
   The next PC to start enrolls as PC-2, then PC-3, and so on — the server numbers each
   seat in arrival order and the agent prints how many systems were already recorded.

**Watch it work**

6. Back on the dashboard: **PC-1 appears** with a green agent dot, state `LOCKED`. The lab PC console shows the lock screen.
7. Click PC-1 → **Grant** → enter a name, 30 minutes → **Grant**.
8. Within ~3 s the lab PC console prints `[overlay] UNLOCK` and shows "you may use this computer". Dashboard state flips to `UNLOCKED_IN_USE` with the holder + expiry.
9. Click **Lock** → confirm. Within ~3 s the overlay returns on the lab PC.
10. Click **Message**, type a note, send — it appears on the lock screen.
11. Click **Sleep** (confirm) — the lab PC goes to sleep via `rundll32` (OS power settings apply). Click **Wake** — real Magic Packets go out and the seat shows `WAKING` for 45 s. If nothing happens, that is WOL being blocked on the PC (BIOS / NIC / fast startup — README §5b), not the dashboard pretending. Wake it by hand and it re-registers on its own.
12. **Fail-closed test:** stop the admin server (Ctrl+C). The lab PC prints `Cannot reach server — remaining LOCKED (fail closed)` and re-searches every 10 s. It never unlocks while offline.
13. **Self-healing test:** start the lab PC's agent **before** the admin server. It stays locked, keeps probing, and registers by itself once the server appears — then re-registers again if you delete `admin/data/labnexus-state.json` and restart the server. No babysitting, no reconfiguration.

**The timetable (this is the headline feature — spend time here)**

14. Notice the strip at the top of the dashboard: **“No lab hours yet — the lab stays locked”**.
    This is the hook: the timetable is not a hidden tab, it tells the admin what is happening.
15. Click **Set up timetable** (or the **Timetable** tab on the right edge). Step 1 asks for a photo
    or screenshot of the college timetable (any PNG/JPG). Point out why the picture is kept as the
    reference and not read by a machine: OCR on a timetable photo gets times wrong, and a lab that
    locks at the wrong minute is worse than no automation. Click the thumbnail to show it full size.
16. **Continue** → step 2 asks which department owns the lab (**CSE**, **CSD**, **CSM**, **CIVIL**, …).
    Pick one; **Continue** stays disabled until you do, with the hint right there.
17. Step 3 is the lab hours. Click **+ Add period** and type the day, from, to and name you can read
    on the picture (e.g. `Thu 09:00–11:00 DBMS Lab — CSE 3A`). Use **👁 Timetable picture** to
    reopen the picture without losing the form. For a second section in the room at the same time,
    press **⧉** on that row: it copies the day and hours and asks only for the second name. Point at
    the counter (`8 periods · 4 days · 2 shared windows`) and at the fact that valid rows save
    themselves — close the drawer and reopen it if you want to prove it.
18. Press **Analyse timetable**. The processing animation runs (this is the “processing data”
    moment), then the review shows **In progress now** with minutes left, **Next up** with a
    countdown, **Shared lab windows** naming every section, and the next 7 days with real dates.
19. Make sure a period **covers right now** (edit the hours if needed). Watch the top strip flip to
    **In period**, naming every section in the room, and the PC grid stay **LOCKED**: the period is
    open, but no seat is handed out by itself.
20. In *During a period*, type how many students are present (say 2) and press **Take attendance**.
    Exactly two seats unlock — the rest stay locked. Try 10 while only 2 PCs are online: it refuses
    to invent seats and says so. Switch to **Roll numbers** and paste a list to label each seat with
    the student who got it.
21. **End the period** (set the hours to a minute ago) and save. Every seat re-locks by itself, and
    the audit log shows the period closing. The top strip moves on to the next class by itself.
22. Click **Override 30 min** — the lab opens outside its timetable for the same attendance flow.
    **End override** puts everything straight back to locked (or back to the running period).
23. **Second laptop (the easy demo):** copy the same `pc-agent` folder to a second laptop and start it. It enrolls its own seat automatically (`AGENT_ENROLLED`) and the two PCs never fight — no config editing. Even a folder that still carries a saved identity from another machine is detected (hostname + MAC) and enrolls fresh.
24. **Reload the dashboard** (F5). It comes back signed in and the top strip is already showing the live state — the admin never has to remember where the timetable lives.

## What to point out

- **No IPs configured anywhere** on the agent — it found the server by UDP broadcast, so restarting the admin laptop (new DHCP IP) changes nothing on the PCs.
- **Fail closed:** cutting the network locks the lab PC, it does not free it.
- **Every action is audited** — see the Audit log panel after the demo.
- Expiry: grant a 1-minute grant from the API to watch auto re-lock:
  ```bat
  curl -X POST http://localhost:8000/api/pc/1/unlock -H "Content-Type: application/json" -d "{\"holder\":\"demo\",\"minutes\":1}"
  ```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server: `EADDRINUSE port 8000` | Another LabNexus server is still running. Close that window, or find it with `netstat -ano | findstr :8000` then `taskkill /F /PID <pid>`, or use another port: `set PORT=8001 && npm start` |
| Agent: "No LabNexus server found" | Start the admin server; check both on same network; set `serverUrl` in config.json as fallback |
| Agent finds server but register fails | Firewall blocking TCP 8000 on admin laptop — see README §1 |
| Agent can't reach server but dashboard works (localhost) | Router AP-isolation — set `serverUrl` manually |
| Lock screen is console text instead of a fullscreen overlay | The agent falls back to console when PowerShell/WPF cannot start on that PC. It still enforces lock/unlock — only the presentation differs |
| Two laptops fight over one dashboard seat | Both have the same `pcId`. The server refuses the second one (`409 PC_ID_TAKEN`) and that agent enrolls its own seat automatically — nothing to fix by hand |
| Attendance button is greyed out | The chip next to *During a period* says why: no period covers the current time. Add a period that covers now, or press **Override 30 min** |
| Timetable: allocation says 0 seats / shortfall | Those PCs are not reporting online. Start `START-AGENT.bat` on them; the dashboard shows them as UNKNOWN until they do |
| A lab-hours row is outlined in red | The message under the grid names the row: a backwards time, an overlap, a duplicate or a missing name. Fix it and the **Analyse** button re-enables itself |
| Top strip is missing | It only appears after login. Reload the page — a valid session comes back without the password prompt |
| Wake does nothing | WOL disabled in BIOS/NIC, or Windows fast startup is on — run `setup-pc.ps1` as administrator (README §5b) |
