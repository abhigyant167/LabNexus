# -*- coding: utf-8 -*-
"""
Rebuild LabNexus_Project_Documentation.docx so its FORMAT mirrors the
reference report exactly (same cover layout, certificate, declaration,
acknowledgement, abstract, ruled table of contents, figure captions,
six-chapter plan from the reference TOC, source-code appendices and the
TEAM DETAILS table).  Team names/rolls stay editable placeholders.

Approach: edit a copy of the reference document in place so all fonts,
page setup, tables, graphics and section structure are preserved; only
the paragraph texts are swapped, extra paragraphs are deleted, and new
paragraphs are cloned from existing ones (so the look stays identical).
"""
import sys, copy, os
sys.stdout.reconfigure(encoding="utf-8")

from docx import Document
from docx.oxml.ns import qn

SRC = r"C:\Users\shomu\Downloads\SIE DOCUMENTATION.docx"
HERE = os.path.dirname(os.path.abspath(__file__))

OUT_PRIMARY = os.path.join(HERE, "LabNexus_Project_Documentation_Reference_Format.docx")
OUT_FALLBACK = os.path.join(HERE, "LabNexus_Project_Documentation_Reference_Format_v2.docx")

W = qn     # shorthand

doc = Document(SRC)
body = doc.element.body
items = list(body.iterchildren())
print(f"reference body items: {len(items)}")


def is_p(el):
    return el.tag == qn("w:p")


def p_text(el):
    if el is None or not is_p(el):
        return None
    parts = []
    for t in el.iter(qn("w:t")):
        if t.text:
            parts.append(t.text)
    s = "".join(parts)
    # de-dup repetitive "TXTTXT" runs by detecting a doubled pattern
    if len(s) > 2 and len(s) % 2 == 0 and s[: len(s) // 2] == s[len(s) // 2 :]:
        s = s[: len(s) // 2]
    return s


def set_text(el, text):
    """Replace a paragraph's runs with ONE run carrying `text`,
    keeping the first run's formatting.  Removes drawings/hyperlinks."""
    runs = el.findall(qn("w:r"))
    hyprs = el.findall(qn("w:hyperlink"))
    if runs:
        first = runs[0]
        # remove every text-bearing child from first run except one w:t
        ts = first.findall(qn("w:t"))
        for t in ts[1:]:
            first.remove(t)
        if ts:
            ts[0].text = text
            ts[0].set(qn("xml:space"), "preserve")
        else:
            t = first.makeelement(qn("w:t"), {})
            t.text = text
            t.set(qn("xml:space"), "preserve")
            first.append(t)
        for r in runs[1:]:
            el.remove(r)
    else:
        # no runs: create a bare run (inherits paragraph's default font)
        r = el.makeelement(qn("w:r"), {})
        t = el.makeelement(qn("w:t"), {})
        t.text = text
        t.set(qn("xml:space"), "preserve")
        r.append(t)
        el.append(r)
    for h in hyprs:
        el.remove(h)
    # drop nested drawing/pict runs from anywhere else (e.g. inside smartTags)
    for d in list(el.iter(qn("w:drawing"))) + list(el.iter(qn("w:pict"))):
        d.getparent().remove(d)


def clone(template, text, paragraphs):
    """deep-copy a paragraph element, replace its text, return it
    (template must be a body-paragraph-element; paragraphs=working list)."""
    el = copy.deepcopy(template)
    set_text(el, text)
    return el


# ----------------------------------------------------------------
# 1. harvest templates BEFORE we mutate anything
# ----------------------------------------------------------------
tpl_cover_title = items[0]
tpl_body_center = items[1]      # centered "A report submitted..." line
tpl_bachelor = items[2]
tpl_member_line = items[4]
tpl_cert_text = items[46]       # justified body paragraph
tpl_left_line = items[51]       # plain left-aligned line
tpl_sub_item = items[220]       # ListParagraph bullet
tpl_fig_caption = items[117]    # centered "FIG .2.1.1 ..."
tpl_chapter_title = items[96]   # centered big bold (INTRODUCTION)
tpl_literature_title = items[108]
tpl_problem_title = items[215]
tpl_method_title = items[296]
tpl_impl_title = items[339]
tpl_code_line = items[392]      # plain mono-ish code line paragraph
tpl_body_just = items[98]

TEAM = ["[TEAM MEMBER 1]", "[TEAM MEMBER 2]", "[TEAM MEMBER 3]",
        "[TEAM MEMBER 4]", "[TEAM MEMBER 5]"]
ROLLS = ["[ROLL NUMBER]", "[ROLL NUMBER]", "[ROLL NUMBER]",
         "[ROLL NUMBER]", "[ROLL NUMBER]"]

# ----------------------------------------------------------------
# 2. cover page
# ----------------------------------------------------------------
set_text(items[0], "LAN LAB LABNEXUS")  # main title (red bold)
set_text(items[2], "Bachelor of Technology")
# [3] blank; insert a project-subtitle line modeled on `tpl_body_center`:
sub = clone(tpl_body_center, "LAN LAB LABNEXUS — LAN LAB-COMPUTER MANAGEMENT SYSTEM", items)
items[2].addnext(sub)
for i, (name, roll) in enumerate(zip(TEAM, ROLLS)):
    pad = " " * 55
    set_text(items[4 + i], f"{pad}{name} ({roll})")

# ----------------------------------------------------------------
# 3. certificate / declaration block
# ----------------------------------------------------------------
CERT = ("      This is to certify that the report entitled “LAN LAB LABNEXUS — LAN LAB-"
        "COMPUTER MANAGEMENT SYSTEM” is a bonafide work done by "
        "[TEAM MEMBER 1] ([ROLL NUMBER]), [TEAM MEMBER 2] ([ROLL NUMBER]), "
        "[TEAM MEMBER 3] ([ROLL NUMBER]), [TEAM MEMBER 4] ([ROLL NUMBER]) and "
        "[TEAM MEMBER 5] ([ROLL NUMBER]) of II B.Tech, in partial fulfillment of "
        "the requirements for the award of the degree of Bachelor of Technology, "
        "submitted to Centre for Engineering Education Research, CMR College of "
        "Engineering & Technology, Hyderabad during the Academic Year 2026-27.")
set_text(items[46], CERT)
set_text(items[49], "(Names of the project coordinators)       (Mr./Ms. COORDINATOR-1)")
for i, t in enumerate([
        "1. [COORDINATOR-1 NAME]",
        "2. [COORDINATOR-2 NAME]",
        "3. [COORDINATOR-3 NAME]"]):
    set_text(items[51 + i], t)

DECL = ("We, the students of II B.Tech of Centre for Engineering Education Research, "
        "CMR COLLEGE OF ENGINEERING & TECHNOLOGY, Kandlakoya, Hyderabad, hereby declare, "
        "that under the supervision of our course coordinators, we have independently "
        "carried out the project titled “LAB LAB LABNEXUS — LAN LAB-COMPUTER MANAGEMENT SYSTEM” "
        "and submitted the report in partial fulfillment of the requirement for the award of "
        "Bachelor of Technology by the Jawaharlal Nehru Technological University, Hyderabad "
        "(JNTUH) during the academic year 2026-27.")
set_text(items[58], DECL)
# note: [066] "Internal Examiner's signature ... External ..." stays as-is

# ----------------------------------------------------------------
# 4. acknowledgement / abstract
# ----------------------------------------------------------------
ACK = [
    " We are obliged and grateful to thank Mr. B. Suresh Ram, Head (CEER), CMRCET, and our project coordinators for their cooperation in all respects during the course.",
    "We would like to thank Dr. K. Srinivasa Rao, Principal, CMRCET, for his constant encouragement.",
    "Finally, we thank all our faculty members and Lab Assistants for their valid support.",
    "We own all our success to our beloved parents, whose vision, love and inspiration has made us what we are today.",
]
for i, t in enumerate(ACK):
    set_text(items[71 + i], t)

ABS = ("LabNexus is a low-cost local-area-network system for managing college computer "
       "labs. A Node.js / Express server on the lab staff’s laptop serves a browser "
       "dashboard (default port 8000); a lightweight Node.js agent on every lab PC "
       "discovers the server through UDP broadcast, enrolls once with a server-issued "
       "seat ID and token, and sends periodic authenticated heartbeats. From the "
       "dashboard the administrator sees honest seat state — fresh evidence only, "
       "UNKNOWN when evidence is stale — and can lock, unlock, grant time-limited "
       "access, message, sleep, reboot or Wake-on-LAN each seat. A validated weekly "
       "timetable is followed automatically: periods open and close at their "
       "boundaries and attendance-based allocation opens exactly the required number "
       "of online seats, with grants that expire at period end. Optional AI-assisted "
       "extraction analyses an uploaded timetable photograph through an "
       "OpenAI-compatible vision endpoint (a free Gemini key works) and only proposes "
       "periods for review. All state and images stay local by default and every "
       "login, command, grant and period transition is written to an audit log. The "
       "system was verified end-to-end with a 206-check integration suite.")
set_text(items[79], ABS)

# ----------------------------------------------------------------
# 5. table of contents (the ruled table) — LabNexus chapter plan,
#    identical row/label structure to the reference
# ----------------------------------------------------------------
toc = items[88]
toc_rows = toc.findall(qn("w:tr"))
assert len(toc_rows) == 19, f"TOC rows = {len(toc_rows)}"

TOC_DATA = [
    # CHAPTERS | (section) | DESCRIPTION
    ["", "", "Abstract"],
    ["1", "", "Introduction"],
    ["2", "", "Literature Review"],
    ["3", "", "Problem Definition"],
    ["", "3.1", "Problem Statement"],
    ["", "3.2", "Objective"],
    ["", "3.3", "Requirement Analysis"],
    ["4", "", "Methodology"],
    ["", "4.1", "Conceptual Design"],
    ["", "4.2", "Block Diagram"],
    ["", "4.3", "Design Description"],
    ["5", "", "Implementation"],
    ["", "5.1", "Results and Discussions"],
    ["", "5.2", "Conclusions"],
    ["6", "6.1", "Appendix"],
    ["", "6.2", "References"],
    ["", "6.3", "Source Code"],
    ["7", "", "Team Details"],
]
# row 0 is the header (CHAPTERS/DESCRIPTION/PAGE No): leave as is


def cell_text(tc, text):
    ps = tc.findall(qn("w:p"))
    if not ps:
        p = tc.makeelement(qn("w:p"), {})
        tc.append(p)
        ps = [p]
    set_text(ps[0], text)
    for p in ps[1:]:
        tc.remove(p)


for row_idx, data_row in enumerate(TOC_DATA, start=1):
    cells = toc_rows[row_idx].findall(qn("w:tc"))
    for ci, val in enumerate(data_row):
        cell_text(cells[ci], val)

# ----------------------------------------------------------------
# 6. chapters 1 … 6 re-interpreted for LabNexus (every chunk of the
#    reference's structure is reused: section labels, figure slots,
#    FEATURES/DISADVANTAGES lists, gaps, proposed solution, etc.)
# ----------------------------------------------------------------
REPLACEMENTS = {}

# ---- Chapter 1 -------------------------------------------------
REPLACEMENTS[95] = "CHAPTER-1"
REPLACEMENTS[96] = "INTRODUCTION"
REPLACEMENTS[98] = ("LabNexus is a local-area-network (LAN) lab-computer management system "
                    "that lets a single lab in-charge watch and control every PC in a computer "
                    "lab from one browser dashboard, with no recurring licence cost and no "
                    "dependency on the public internet.")
REPLACEMENTS[99] = ("An administrator server runs on the lab staff’s laptop; a lightweight "
                    "Node.js agent on each lab PC discovers it via UDP broadcast, registers "
                    "with a server-issued seat ID and token, then reports authenticated "
                    "heartbeats. From the dashboard the admin can lock or unlock a machine, "
                    "grant time-limited access, message a student, sleep, reboot or "
                    "Wake-on-LAN, and every action is recorded in a local audit log.")
REPLACEMENTS[100] = ("Access follows the confirmed weekly timetable: periods open and close "
                     "automatically, attendance allocates exactly as many seats as students "
                     "present, grants expire and re-lock by themselves, and a fail-closed agent "
                     "keeps a disconnected machine locked. A 206-check integration suite "
                     "verifies these workflows.")

# ---- Chapter 2 : LITERATURE REVIEW -----------------------------
REPLACEMENTS[107] = "CHAPTER-2"
REPLACEMENTS[108] = "LITERATURE REVIEW"
REPLACEMENTS[110] = "1. Manual Lab Management:"
REPLACEMENTS[111] = ("Most computer labs are managed manually: the lab in-charge walks the room, "
                     "checks each machine, signs a preparation or attendance sheet and locks "
                     "machines one by one at the end of a session.")
REPLACEMENTS[112] = ("The approach needs no new software, but it scales poorly. Turning many "
                     "machines on, locking them between periods and preparing a room for the next "
                     "class all depend on a person being present and remembering every step.")
REPLACEMENTS[113] = ("There is no central record of what happened — who opened the room, which "
                     "students attended, when a machine was unlocked — so later disputes are hard "
                     "to resolve.")
REPLACEMENTS[117] = "FIG .2.1.1: [Insert photo: manual lab attendance / preparation register]"
REPLACEMENTS[119] = "1. Zero Cost:"
REPLACEMENTS[120] = "No new software or hardware is required."
REPLACEMENTS[121] = "2. Simple:"
REPLACEMENTS[122] = "Anyone can do it with no training."
REPLACEMENTS[123] = "3. Direct Supervision:"
REPLACEMENTS[124] = "A human sees the actual condition of each machine."
REPLACEMENTS[125] = "Immediate local decisions are possible."
REPLACEMENTS[126] = "Network outages do not stop the work entirely."
REPLACEMENTS[128] = "1. Slow: Preparing a whole lab by hand takes many minutes."
REPLACEMENTS[129] = "2. Inconsistent: Different staff lock and unlock differently."
REPLACEMENTS[130] = "3. No Audit Trail: Paper is easy to lose and hard to search."
REPLACEMENTS[131] = "4. No Timetable Enforcement: Rooms stay as the last user left them."
REPLACEMENTS[132] = "5. No Remote View: Nothing is visible away from the lab."
REPLACEMENTS[133] = "6. Attendance Disconnect: Marks are maintained separately from room state."
REPLACEMENTS[134] = "7. Error-Prone: Manual steps get skipped under time pressure."
REPLACEMENTS[138] = "2. Operating-System and Group-Policy Tools:"
REPLACEMENTS[139] = ("Windows and Linux offer per-machine controls: screen-lock policies, "
                     "scheduled shutdown scripts, local accounts and, on managed domains, group "
                     "policies that enforce settings across many machines at once.")
REPLACEMENTS[140] = ("These tools can switch machines off at a fixed time or lock screens inside a "
                     "domain, but they know nothing about a specific lab period, a specific class or "
                     "which seats a particular batch is entitled to use.")
REPLACEMENTS[141] = ("Temporary changes — an extra evening batch, an extended lab period — still "
                     "require manual intervention, and nothing reports which seats are open right now.")
REPLACEMENTS[143] = "FIG 2.1.2: [Insert screenshot: OS group-policy or shutdown-script tool]"
REPLACEMENTS[149] = "1. Standard Tooling: Built into the operating system."
REPLACEMENTS[150] = "2. Policy Enforcement: Screen locks can be enforced centrally."
REPLACEMENTS[151] = "3. Scheduling: Fixed-time shutdowns and startups are possible."
REPLACEMENTS[152] = "4. Well Known: Documentation and community support are strong."
REPLACEMENTS[153] = "5. Stable: Mature, tested behaviour across machine families."
REPLACEMENTS[155] = "1. Coarse Grain: Applies to machines, not to specific lab periods."
REPLACEMENTS[156] = "2. Domain Required: Group policies need a managed domain setup."
REPLACEMENTS[157] = "3. No Attendance: Presence is not linked to access."
REPLACEMENTS[158] = "4. Static Schedule: Timetable changes need script or policy edits."
REPLACEMENTS[159] = "5. No Seat View: Nothing shows which seat is open now."
REPLACEMENTS[165] = "3. Computer-Lab Management Software Suites:"
REPLACEMENTS[166] = ("Lab-management suites connect every machine to a teacher console and offer "
                     "screen broadcast, remote control, application blocking and session timers across "
                     "the room. They solve the room-level control problem well and are widely used in "
                     "computer training centres.")
REPLACEMENTS[167] = ("Licences are priced per seat, however, and their activity focus rarely matches a "
                     "college timetable with changing batches and attendance-based seat allocation.")
REPLACEMENTS[168] = ("They also assume reliable always-on networking and dedicated administration, which "
                     "small labs may not have.")
REPLACEMENTS[171] = "FIG .2.1.3: COMMERCIAL LAB MANAGEMENT SUITE"
REPLACEMENTS[173] = "1. Room-Wide Control: Lock, unlock and message all seats at once."
REPLACEMENTS[174] = "2. Screen Broadcast: Push a demonstration to every monitor."
REPLACEMENTS[175] = "3. Timed Sessions: Exam-style sessions end automatically."
REPLACEMENTS[178] = "Attendance counters in some consoles."
REPLACEMENTS[179] = "Application and website blocking during class."
REPLACEMENTS[180] = "Usage statistics per machine and per student."
REPLACEMENTS[182] = "1. Licence Cost: Priced per seat, usually renewed yearly."
REPLACEMENTS[183] = "2. Heavy Client: Larger software installs on every machine."
REPLACEMENTS[184] = "3. Timetable Mismatch: No weekly college timetable model."
REPLACEMENTS[185] = "4. Network Dependent: Control stops when the LAN drops."
REPLACEMENTS[186] = "5. Privacy: Screen-watching features may not suit every lab."
REPLACEMENTS[194] = ("All the existing solutions have many disadvantages. The following are the major "
                     "gaps for a college lab that led us to build LabNexus:")
REPLACEMENTS[195] = "No low-cost option that works without a managed domain or paid licences."
REPLACEMENTS[196] = "No attendance-linked allocation: seats are not opened for exactly N students."
REPLACEMENTS[197] = "No weekly timetable awareness with automatic period open/close."
REPLACEMENTS[198] = "No honest evidence: tools report what was ordered, not what a seat actually shows."
REPLACEMENTS[199] = "No local audit log of who did what to which machine and when."
REPLACEMENTS[200] = "Existing suites assume stable, always-managed networks and constant support."
REPLACEMENTS[201] = "Paper-based attendance is disconnected from the state of the machines."
REPLACEMENTS[204] = ("LabNexus therefore proposes a self-hosted, zero-licence LAN system combining "
                     "room-level control with the timetable and attendance logic a college lab actually uses:")
REPLACEMENTS[206] = "A central dashboard showing every seat with fresh evidence."
REPLACEMENTS[207] = "UDP auto-discovery so new machines join without IP configuration."
REPLACEMENTS[208] = "Time-limited grants that expire by themselves and re-lock the seat."
REPLACEMENTS[209] = "A weekly timetable follower that opens and closes periods on time."
REPLACEMENTS[210] = "Attendance-based allocation that opens exactly the number of seats needed."
REPLACEMENTS[211] = "An in-built audit log of logins, grants, commands and period changes."

# ---- Chapter 3 : PROBLEM DEFINITION ----------------------------
REPLACEMENTS[216] = "3.1 Problem Statement:"
REPLACEMENTS[217] = ("Operating a college computer lab means opening many machines for one class, locking "
                     "them between periods, waking them for the next batch and accounting for every "
                     "change — all by hand today, with no record of what happened and no budget for a "
                     "commercial suite. The goal is to do all of it from one dashboard on the campus LAN "
                     "using only ordinary PCs and a staff laptop, in a way that stays safe when the "
                     "network or an agent misbehaves.")
REPLACEMENTS[220] = "Provide a single evidence-based view of the lab"
REPLACEMENTS[221] = "Open and close seats on time, automatically"
REPLACEMENTS[222] = "Improve responsiveness for staff and students"
REPLACEMENTS[223] = "Ensure security and reliability (fail-closed)"
REPLACEMENTS[224] = "Reduce repetitive manual work by the lab staff"
REPLACEMENTS[233] = "1. ADMINISTRATOR COMPUTER:"
REPLACEMENTS[235] = "FIG.3.3.1: ADMINISTRATOR COMPUTER (SERVER)"
REPLACEMENTS[236] = ("A staff laptop running Node.js 18 or later. It hosts the LabNexus server "
                     "(Express, port 8000), the UDP discovery responder (port 41888), the JSON "
                     "state file and the audit log, and is reachable over the LAN.")
REPLACEMENTS[237] = "2. LAB COMPUTER (AGENT):"
REPLACEMENTS[239] = "FIG.3.3.2: LAB COMPUTER RUNNING THE AGENT"
REPLACEMENTS[240] = ("An ordinary lab PC running the Node.js agent. It discovers the server by UDP "
                     "broadcast, enrolls once, sends authenticated heartbeats, pulls queued commands "
                     "and enforces the local seat state. On Windows it additionally runs a full-screen "
                     "lock overlay.")
REPLACEMENTS[241] = "3. LAB NETWORK (LAN):"
REPLACEMENTS[243] = "FIG.3.3.3: LOCAL-AREA NETWORK"
REPLACEMENTS[244] = ("A switched LAN that carries the HTTP API traffic, the UDP discovery broadcast and "
                     "Wake-on-LAN magic packets from the administrator machine to every lab seat. "
                     "Wi-Fi-only labs lose discovery reliability, so wired seats are preferred.")
REPLACEMENTS[245] = "4. LAB SEATS:"
REPLACEMENTS[247] = "FIG.3.3.4: LAB SEATS (WORKSTATIONS)"
REPLACEMENTS[248] = ("The physical workstations to be managed. Each receives a stable seat ID and seat "
                     "name so the dashboard, attendance allocation and audit entries always refer to the "
                     "same machine in the same place in the room.")
REPLACEMENTS[250] = "5. TIMETABLE PHOTOGRAPHS:"
REPLACEMENTS[252] = "FIG.3.3.5: UPLOADED TIMETABLE PHOTOGRAPHS"
REPLACEMENTS[253] = ("One or more photographs of the weekly timetable saved through the dashboard. They "
                     "remain local reference material; the optional AI extraction only proposes periods "
                     "for review and never changes the confirmed schedule on its own.")
REPLACEMENTS[254] = "6. AI VISION API (OPTIONAL):"
REPLACEMENTS[256] = "FIG.3.3.6: AI VISION API"
REPLACEMENTS[257] = ("An OpenAI-compatible vision endpoint. A free Gemini API key from Google AI Studio "
                     "works through its OpenAI-compatible endpoint; the key stays in the server "
                     "environment and is never seen by the browser.")
REPLACEMENTS[261] = "7. WAKE-ON-LAN ENABLED NETWORK CARDS:"
REPLACEMENTS[263] = "FIG.3.3.7: WAKE-ON-LAN ENABLED NETWORK CARDS"
REPLACEMENTS[264] = ("Wake-on-LAN must be enabled in the BIOS/UEFI and network-driver settings of each "
                     "lab PC so magic packets from the administrator machine can wake a powered-off seat.")
REPLACEMENTS[265] = "8. CONFIRMED WEEKLY TIMETABLE:"
REPLACEMENTS[267] = "FIG.3.3.8: ENTERED WEEKLY TIMETABLE"
REPLACEMENTS[268] = ("The validated weekly grid entered by the administrator: periods with start and end "
                     "times, class, day and the seats or lab involved. It is the single source the "
                     "schedule follower acts on.")
REPLACEMENTS[271] = "9. JSON STATE FILE AND AUDIT LOG:"
REPLACEMENTS[273] = "FIG.3.3.9: LOCAL STATE FILE AND AUDIT LOG"
REPLACEMENTS[274] = ("Local persistence inside the administrator machine’s data directory, holding "
                     "computers, grants, schedule, tokens, settings and the append-style audit log, "
                     "written atomically after each change.")
REPLACEMENTS[275] = "10. TRUSTED WORKSTATION FOR THE DASHBOARD:"
REPLACEMENTS[277] = "FIG.3.3.10: DASHBOARD ON A TRUSTED MACHINE"
REPLACEMENTS[278] = ("A browser on a machine the lab staff control. The dashboard presents honest seat "
                     "state and every administrative action; it never relies on client-reported state.")
REPLACEMENTS[280] = "11. SMART CARDS FOR LAB MANAGER LOGIN:"
REPLACEMENTS[282] = "FIG. 3.3.11: SMART CARDS FOR LAB MANAGER LOGIN"
REPLACEMENTS[283] = ("Lab staff open the dashboard with a per-user password via the login route; session cookies "
                     "are HttpOnly, expiring (12 hours) and SameSite-strict. The controller uses one of "
                     "these sessions to create or modify department machines.")

# ---- Chapter 4 : METHODOLOGY -----------------------------------
REPLACEMENTS[297] = ("LabNexus solves the problem of coordinating many lab PCs from one place without "
                     "buying a commercial suite or maintaining a domain, using a hub-and-agent "
                     "architecture over the existing campus LAN.")
REPLACEMENTS[299] = ("The conceptual design is deliberately simple: one administrator server owns the "
                     "truth, and every lab PC runs a small outbound-polling agent. Servers never "
                     "initiate connections into lab machines — which avoids firewall and NAT issues — and "
                     "agents never trust a command that does not arrive with the right token.")
REPLACEMENTS[301] = "FIG 4.1.1 : LABNEXUS CONCEPTUAL DESIGN (SERVER + AGENTS)"
REPLACEMENTS[302] = ("The mechanism of the solution is simple. First the server is located: the agent "
                     "broadcasts “LABNEXUS_DISCOVER_V1” on the LAN and the server answers with its "
                     "address. The agent then enrolls once and receives a unique seat ID and a random "
                     "server-issued token.")
REPLACEMENTS[303] = ("From then on the agent loop is heartbeats and polls: it sends an authenticated "
                     "heartbeat every few seconds, pulls any queued command, executes it (lock overlay, "
                     "unlock, sleep, reboot, message, wake) and reports enforcement back, while the "
                     "engine expires grants exactly on time and audits every state change.")
REPLACEMENTS[309] = "FIG 4.2.1: SYSTEM BLOCK DIAGRAM (DASHBOARD — SERVER — LAN — AGENTS)"
REPLACEMENTS[322] = ("Central to the design is the evidence model: observed seat state is computed only "
                     "from fresh, authenticated heartbeats; anything else displays as UNKNOWN rather "
                     "than a guess. That is why the dashboard is never wrong about a seat being open.")
REPLACEMENTS[323] = ("The weekly timetable module validates entered periods and follows them every day, "
                     "opening and closing periods at their boundaries in the server tick, and plays well "
                     "with back-to-back periods so a seat granted in period A is re-locked at the "
                     "boundary rather than rolling into period B.")
REPLACEMENTS[325] = ("Attendance allocation opens exactly as many seats as there are present students "
                     "(online seats only), reports a clear shortage when there are not enough fresh "
                     "seats, and expires the grants automatically at the end of the period.")
REPLACEMENTS[326] = ("Auditability is a first-class feature: logins (including failed ones), grants, "
                     "commands, schedule changes, allocation results and period transitions are all "
                     "recorded in the local audit log with timestamps.")
REPLACEMENTS[327] = ("Fail-closed behaviour: if an agent cannot reach the server the machine re-locks "
                     "locally; if evidence goes stale the seat shows UNKNOWN and a grant cannot silently "
                     "persist. Data stays local by default inside a JSON state file, and only the "
                     "optional, per-request AI extraction ever leaves the machine.")

# ---- Chapter 5 : IMPLEMENTATION --------------------------------
REPLACEMENTS[340] = "5.1 RESULTS AND DISCUSSION:"
REPLACEMENTS[341] = "Seat Locking and Command Delivery:"
REPLACEMENTS[342] = ("Seat commands (lock, unlock, message, sleep, reboot) reached fresh agents within "
                     "one poll cycle; a lock covered enqueue, poll, overlay show and enforcement report "
                     "in seconds, and every step left an audit entry.")
REPLACEMENTS[343] = ("Wake-on-LAN packets were emitted for powered-off seats; a seat was reported awake "
                     "only when a fresh heartbeat actually returned, so a NIC without Wake-on-LAN enabled "
                     "was shown honestly as still down instead of optimistically awake.")
REPLACEMENTS[344] = "Timetable and Attendance:"
REPLACEMENTS[345] = ("At period boundaries the scheduler closed the ending period and opened the next one "
                     "in the same server tick; a grant from period A never rolled into period B. After "
                     "the last period the room re-locked itself with no leftover grants.")
REPLACEMENTS[346] = ("Attendance through the schedule endpoint allocated one seat per present student "
                     "using only fresh agents, reported a clear shortage when seats were insufficient, "
                     "and expired every allocation at period end; the audit log recorded each allocation "
                     "and refusal.")
REPLACEMENTS[347] = "Health, Security and Recovery:"
REPLACEMENTS[348] = ("Security was exercised negatively too: agent endpoints rejected requests with a "
                     "missing or wrong X-PC-Token (401) and refused duplicate seat-ID registrations "
                     "(409), while admin routes without a session cookie answered 401 Unauthorized.")
REPLACEMENTS[349] = ("Failure recovery worked out of the box: a gap in the network left seats shown as "
                     "UNKNOWN rather than stale truth, and agents that went silent re-enrolled cleanly "
                     "and got their state corrected from fresh evidence when they came back.")
REPLACEMENTS[350] = "AI-Assisted Timetable Extraction:"
REPLACEMENTS[351] = ("With an OpenAI-compatible key (the free Gemini key from Google AI Studio works "
                     "through its compatible endpoint), an uploaded timetable photograph produced a "
                     "proposed set of periods; the admin reviewed and applied them, and nothing changed "
                     "when the key was missing or the image was unreadable.")
REPLACEMENTS[352] = ("In the integration tests a server configured with only a free Gemini key drove "
                     "extraction end-to-end, confirming the free-tier path works exactly like the paid "
                     "one.")
REPLACEMENTS[354] = ("LabNexus demonstrates that a college lab can be managed accurately with nothing "
                     "beyond ordinary PCs, a staff laptop and the existing LAN. Routine work — "
                     "preparation, locking, timetable boundaries, attendance-driven allocation and "
                     "Wake-on-LAN — all ran from a single dashboard, and every action was auditable with "
                     "zero licence cost. The system is a working prototype for a trusted LAN; hardening "
                     "for permanent deployment (HTTPS, token rotation, an auto-starting agent service "
                     "and multi-admin accounts) is the natural next step.")

# ---- Chapter 6 : APPENDIX / REFERENCES / SOURCE CODE -----------
REPLACEMENTS[370] = "6.1. APPENDIX:"
REPLACEMENTS[371] = "https://github.com/abhigyant167/LabNexus"
REPLACEMENTS[372] = "https://nodejs.org/docs/"
REPLACEMENTS[373] = "https://expressjs.com/"
REPLACEMENTS[374] = "https://ai.google.dev/gemini-api/docs"
REPLACEMENTS[377] = "[1] LabNexus project repository and source code: https://github.com/abhigyant167/LabNexus"
REPLACEMENTS[378] = "[2] Node.js documentation: https://nodejs.org/docs/"
REPLACEMENTS[379] = "[3] Google Gemini API documentation (used via its OpenAI-compatible endpoint): https://ai.google.dev/gemini-api/docs"
REPLACEMENTS[390] = "6.3. SOURCE CODE"

# ----------------------------------------------------------------
# 7. apply text replacements that don't need geometry changes
# ----------------------------------------------------------------
for idx, text in REPLACEMENTS.items():
    el = items[idx]
    if not is_p(el):
        raise RuntimeError(f"item {idx} is not a paragraph: <{el.tag}>")
    set_text(el, text)

# ----------------------------------------------------------------
# 8. figure slots: any chapter-range paragraph that still holds a
#    drawing becomes a clean placeholder line (logos in front matter
#    0..94 and the team-details range stay untouched)
# ----------------------------------------------------------------
def chapter_range(el_idx):
    return 95 <= el_idx <= 586


replaced_figs = 0
for i, el in enumerate(items):
    if not is_p(el):
        continue
    if not chapter_range(i):
        continue
    if el.findall(".//" + qn("w:drawing")) or el.findall(".//" + qn("w:pict")):
        # keep a centered placeholder describing what the figure should be
        cap = p_text(items[i + 1]) if (i + 1 < len(items) and is_p(items[i + 1])) else ""
        desc = cap.strip() if cap and "FIG" in cap.upper() else "[Insert figure here]"
        set_text(el, f"[Insert figure — see caption below: {desc}]")
        replaced_figs += 1
print(f"figure placeholders rewritten: {replaced_figs}")

# ----------------------------------------------------------------
# 9. source-code appendix (6.3): delete the Arduino listing and
#    insert LabNexus code excerpts cloned from `tpl_code_line`
# ----------------------------------------------------------------
CODE_START = 392   # first '#include <SoftwareSerial.h>' paragraph
CODE_END = 571     # last code paragraph in the reference
code_els = [items[i] for i in range(CODE_START, CODE_END + 1) if is_p(items[i])]
anchor = items[CODE_START]  # we insert AFTER this (then delete it and its range)

code_lines = [
    "// -------------------------------------------------------------",
    "// admin/server.js (excerpt) — authenticated admin middleware",
    "// -------------------------------------------------------------",
    "function requireAdmin(req, res, next) {",
    '  const cookie = req.headers.cookie || "";',
    '  const token = cookie.split(";").map((c) => c.trim())',
    '    .find((c) => c.startsWith("ln_session="))?.slice(11);',
    "  if (!token || !state.sessionValid(token))",
    '    return res.status(401).json({ error: "Not authorized. Log in first." });',
    "  next();",
    "}",
    "// admin/server.js (excerpt) — admin login",
    'app.post("/api/auth/login", (req, res) => {',
    "  const { password } = req.body || {};",
    "  const token = state.login(password);",
    "  if (!token) {",
    '    state.audit("LOGIN_FAILED", { ip: req.ip });',
    '    return res.status(401).json({ error: "Wrong password" });',
    "  }",
    '  state.audit("LOGIN_OK", { ip: req.ip });',
    '  res.setHeader("Set-Cookie", `ln_session=${token}; HttpOnly;`',
    "    `Path=/; SameSite=Strict; Max-Age=43200`);",
    "  res.json({ ok: true });",
    "});",
    "// -------------------------------------------------------------",
    "// admin/discovery.js (excerpt) — UDP auto-discovery responder",
    "// -------------------------------------------------------------",
    'const MAGIC = "LABNEXUS_DISCOVER_V1";',
    'sock.on("message", (msg, rinfo) => {',
    "  if (msg.toString() !== MAGIC) return;",
    '  const reply = Buffer.from(JSON.stringify({',
    "    labnexus: true, httpPort, ts: Date.now(),",
    "  }));",
    '  sock.send(reply, rinfo.port, rinfo.address, () => {});',
    "});",
    "// -------------------------------------------------------------",
    "// pc-agent/agent.js (excerpt) — registration outcome handling",
    "// -------------------------------------------------------------",
    "const { status, body } = res;",
    'if (status === 200 && body?.ok) { registerFailures = 0; registered = true;',
    '  console.log(`Registered as PC-${PC_ID} at ${SERVER_URL}`); return "ok"; }',
    'if (status === 409 || body?.code === "PC_ID_TAKEN") {',
    "  // this config was copied from another laptop: enroll afresh",
    "  await enroll(); return \"transient\";",
    "}",
    "if (status === 401) { await enroll(); return \"transient\"; }",
    "// anything else counts as transient and is retried with backoff",
    "",
    "Full sources: admin/server.js, admin/state.js, admin/engine.js,",
    "admin/discovery.js, admin/schedule.js, admin/extract.js, admin/sse.js,",
    "admin/wol.js, pc-agent/agent.js, pc-agent/overlay.js",
    "(the complete system is shipped with the report and is in the",
    "project repository).",
]

new_code = [clone(tpl_code_line, ln, items) for ln in code_lines]
for el in new_code:
    anchor.addnext(el)
    anchor = el
# code paragraphs inherit the template's paragraph style; force plain
# left alignment so long lines do not wrap awkwardly (keep 1.5 spacing)
for el in new_code:
    jc = el.find(qn("w:pPr") + "/" + qn("w:jc"))
    if jc is not None:
        jc.getparent().remove(jc)

# now delete the original Arduino code block (393…571) AFTER insertion,
# working from the END so the early elements do not shift
for i in range(CODE_END, CODE_START, -1):
    el = items[i]
    if el.getparent() is not None:
        el.getparent().remove(el)

# ----------------------------------------------------------------
# 10. team details — placeholders the team will personalise
# ----------------------------------------------------------------
set_text(items[586], "TEAM DETAILS")

# ----------------------------------------------------------------
# 11. mojibake sweep in headers/footers + core properties
# ----------------------------------------------------------------
for section in doc.sections:
    for part in (section.header, section.footer):
        if part is None:
            continue
        for t in part._element.iter(qn("w:t")):
            if t.text and "AUTO LUGGAGE" in t.text:
                t.text = t.text.replace("AUTO LUGGAGE", "LAN LAB LABNEXUS")
doc.core_properties.title = "LAN LAB LABNEXUS — LAN Lab-Computer Management System"

# ----------------------------------------------------------------
# 11.5  FINAL TEXT-MATCHING CLEANUP (immune to index drift)
# Some old-project paragraphs live at slightly shifted indices; find
# them by content on the final tree and fix/delete precisely.
# ----------------------------------------------------------------
def delete_para(p):
    el = p._element
    if el.getparent() is not None:
        el.getparent().remove(el)

final_text = ""
cleanup_log = []
for p in list(doc.paragraphs):
    t = p.text.strip()
    if not t:
        continue
    if "GPS tracking for real-time location monitoring" in t:
        set_text(p._element,
                 ("Access is enforced on the machine, not just on the server: every lab PC runs a "
                  "full-screen overlay and validates each server command against its seat token, "
                  "while the fail-closed agent re-locks a machine that loses contact with the "
                  "server. All logins, grants, commands and period transitions are recorded in a "
                  "local audit log, so every change can be traced afterwards."))
        cleanup_log.append("abstract#2 rewritten")
    elif "JUMPER WIRES" in t.upper():
        delete_para(p)
        cleanup_log.append("JUMPER title deleted")
    elif "Wires used to make connections" in t:
        delete_para(p)
        cleanup_log.append("JUMPER description deleted")
    elif "strategically mounted on the front" in t:
        set_text(p._element,
                 ("The design closes the loop around the server tick: the dashboard shows every "
                  "seat with its observed state and a one-click command bar; each two-second tick "
                  "recomputes evidence and dispatches queued commands; grants carry an expiry and "
                  "remain enforceable locally even if the server restarts; SSE pushes live updates; "
                  "Wake-on-LAN and the lock overlay plug into the same command path."))
        cleanup_log.append("4.3 luggage paragraph rewritten")
    elif "#include <SoftwareSerial.h>" in t:
        delete_para(p)
        cleanup_log.append("Arduino include deleted")
    elif "Define pins for the ultrasonic sensor" in t:
        delete_para(p)
        cleanup_log.append("Arduino comment deleted")
# team-detail tables: blank the other project's student identities
import re
ID_RE = re.compile(r"\b\d{2}H51A\d{4}\b")

def set_cell(cell, text):
    ps = cell.paragraphs
    set_text(ps[0]._element if hasattr(ps[0], "_element") else ps[0]._p, text)
    for p in ps[1:]:
        el = p._element if hasattr(p, "_element") else p._p
        if el.getparent() is not None:
            el.getparent().remove(el)

blanked = 0
for tbl in doc.tables:
    if len(tbl.rows) < 2:
        continue
    header = [c.text.strip().upper() for c in tbl.rows[0].cells]
    if not any(k in h for h in header for k in ("STUDENT NAME", "SIGNATURE", "PHOTO")):
        continue
    for row in tbl.rows[1:]:
        for cell, col in zip(row.cells, header):
            cur = cell.text.strip()
            if not cur:
                continue
            if ID_RE.search(cur):
                set_cell(cell, "[ROLL NUMBER]"); blanked += 1
            elif "ROLL" in col and ID_RE.search(cur):
                set_cell(cell, "[ROLL NUMBER]"); blanked += 1
            elif "SIGNATURE" in col:
                set_cell(cell, ""); blanked += 1
            elif "NAME" in col:
                set_cell(cell, "[NAME]"); blanked += 1
            elif "PHOTO" in col and len(cur) > 3 and not cur.startswith("["):
                set_cell(cell, "[PHOTO]"); blanked += 1
print(f"team-table identity cells blanked: {blanked}")

print("final cleanup:", cleanup_log)

# ----------------------------------------------------------------
# 12. save (fallback name if the primary is open in Word)
# ----------------------------------------------------------------
saved_to = None
for candidate in (OUT_PRIMARY, OUT_FALLBACK):
    try:
        doc.save(candidate)
        saved_to = candidate
        break
    except PermissionError:
        print(f"locked: {candidate}")
if saved_to is None:
    raise RuntimeError("Could not save: both target files are locked (close Word).")

print("saved:", saved_to)
