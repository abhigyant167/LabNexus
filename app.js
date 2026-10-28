// LabNexus admin dashboard logic

const $ = (id) => document.getElementById(id);
let pcs = [];
let selectedId = null;
let pendingConfirm = null;
let latestSnap = null;
let loggedIn = false;

// ---------------- login ----------------

async function tryLogin() {
  const pass = $("login-pass").value;
  try {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pass }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      $("login-err").textContent = j.error || "Login failed";
      return;
    }
    loggedIn = true;
    $("login").classList.add("hidden");
    refresh();
    loadAudit();
    // The timetable panel owns the live lab strip; it needs to know a session
    // just started so the strip is not stuck in its signed-out state.
    if (typeof onAdminLogin === "function") onAdminLogin();
  } catch (err) {
    $("login-err").textContent = `Cannot reach server: ${err.message}`;
  }
}

$("login-go").onclick = tryLogin;
$("login-pass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryLogin();
});

// ---------------- state loading (SSE + REST) ----------------

async function refresh() {
  if (!loggedIn) return;
  try {
    const r = await fetch("/api/state");
    if (r.status === 401) {
      loggedIn = false;
      $("login").classList.remove("hidden");
      return;
    }
    render(await r.json());
  } catch (_) {}
}

// ---------------- SSE (live updates) ----------------

let es = null;

function connectSse() {
  if (es) { try { es.close(); } catch (_) {} }
  es = new EventSource("/api/events");
  es.addEventListener("state", (e) => {
    $("connBadge").textContent = "live";
    $("connBadge").className = "badge live";
    if (loggedIn) render(JSON.parse(e.data));
  });
  es.onerror = () => {
    $("connBadge").textContent = "reconnecting…";
    $("connBadge").className = "badge down";
    // EventSource auto-reconnects; nothing else to do
  };
}

async function loadAudit() {
  if (!loggedIn) return;
  try {
    const r = await fetch("/api/audit");
    if (r.status === 401) return;
    const rows = await r.json();
    $("audit").innerHTML = rows.length
      ? rows.map(rowHtml).join("")
      : `<div class="row muted">No audit entries yet.</div>`;
  } catch (_) {}
}

function rowHtml(a) {
  const t = new Date(a.ts).toLocaleTimeString();
  const d = Object.entries(a)
    .filter(([k]) => !["id", "ts", "action"].includes(k))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
  return `<div class="row"><span class="t">${t}</span><span class="a">${a.action}</span><span class="d">${escapeHtml(d)}</span></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------- rendering ----------------

function render(snap) {
  latestSnap = snap;
  $("c-total").textContent = snap.counts.total;
  $("c-online").textContent = snap.counts.online;
  $("c-locked").textContent = snap.counts.locked;
  $("c-unlocked").textContent = snap.counts.unlocked;
  $("c-unknown").textContent = snap.counts.unknown;

  pcs = snap.computers;
  $("grid").innerHTML = pcs.length
    ? pcs.map((pc) => pcCardHtml(pc)).join("")
    : `<div class="muted">No PCs registered yet. Start the agent on a lab computer.</div>`;

  if (selectedId) {
    const pc = pcs.find((p) => p.id === selectedId);
    if (pc) renderSelected(pc);
  }
  loadAudit();
}

function pcCardHtml(pc) {
  const grant = pc.grant
    ? `${escapeHtml(pc.grant.holder)} · until ${new Date(pc.grant.endAt).toLocaleTimeString()}`
    : "no grant";
  return `
  <div class="pc ${pc.id === selectedId ? "selected" : ""}" onclick="selectPc(${pc.id})">
    <div class="top">
      <span class="name">${escapeHtml(pc.name)}</span>
      <span class="state-chip st-${pc.state}">${pc.state}</span>
    </div>
    <div class="meta">
      <span class="dot ${pc.fresh ? "fresh" : "stale"}"></span>${pc.fresh ? "agent online" : "agent stale/missing"}
      <br>host: ${escapeHtml(pc.hostname || "?")}
      <br>ip: ${escapeHtml(pc.ip || "?")}
      <br>${grant}
    </div>
  </div>`;
}

function selectPc(id) {
  selectedId = id;
  document.querySelectorAll(".pc").forEach((el) => el.classList.remove("selected"));
  if (latestSnap) render(latestSnap);
}

function renderSelected(pc) {
  $("sel-title").textContent = `${pc.name} (id ${pc.id})`;
  $("sel-state").textContent = pc.state;
  $("sel-state").className = `state-chip st-${pc.state}`;
  $("sel-info").innerHTML = `
    <b>Desired:</b> ${pc.desired} — ${escapeHtml(pc.lastStateReason || "")}<br>
    <b>Hostname:</b> ${escapeHtml(pc.hostname || "?")} ·
    <b>IP:</b> ${escapeHtml(pc.ip || "?")} ·
    <b>MAC:</b> ${escapeHtml(pc.mac || "?")}<br>
    <b>OS user:</b> ${escapeHtml(pc.osUser || "?")} ·
    <b>Idle:</b> ${pc.idleSeconds ?? "?"}s<br>
    <b>Grant:</b> ${pc.grant ? `${escapeHtml(pc.grant.holder)} until ${new Date(pc.grant.endAt).toLocaleTimeString()}` : "none"}<br>
    <b>Last message:</b> ${escapeHtml(pc.lastMessage || "—")}`;

  const unlocking = pc.state.startsWith("UNLOCKED");
  $("btn-unlock").disabled = false;
  $("btn-lock").disabled = !unlocking && pc.state !== "SLEEPING";
  $("btn-sleep").disabled = pc.state === "SLEEPING";
  $("btn-wake").disabled = pc.state !== "SLEEPING";
  $("btn-msg").disabled = !pc.fresh;
  $("btn-reboot").disabled = !pc.fresh;
  $("btn-forget").disabled = false;
}

// ---------------- actions ----------------

async function api(path, body, method = "POST") {
  try {
    const r = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  } catch (err) {
    alert(`Action failed: ${err.message}`);
    return null;
  }
}

const pcPath = () => `/api/pc/${selectedId}`;

function askConfirm(title, text, fn) {
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  $("confirm").classList.remove("hidden");
  pendingConfirm = fn;
}

$("confirm-yes").onclick = () => {
  $("confirm").classList.add("hidden");
  if (pendingConfirm) pendingConfirm();
  pendingConfirm = null;
};
$("confirm-no").onclick = () => {
  $("confirm").classList.add("hidden");
  pendingConfirm = null;
};

function openUnlockForm() {
  if (!selectedId) return;
  const pc = pcs.find((p) => p.id === selectedId);
  const html = `
    <div class="unlock-form">
      <div><label>Student name</label><input id="uf-name" type="text" placeholder="e.g. Aarav Sharma"></div>
      <div><label>Roll no (optional)</label><input id="uf-roll" type="text"></div>
      <div><label>Duration</label>
        <select id="uf-mins">
          <option value="15">15 minutes</option>
          <option value="30" selected>30 minutes</option>
          <option value="60">60 minutes</option>
          <option value="120">2 hours</option>
        </select></div>
    </div>`;
  const box = document.createElement("div");
  box.className = "modal";
  box.id = "unlock-modal";
  box.innerHTML = `<div class="modal-box"><h3>Grant access — ${pc.name}</h3>${html}
    <div class="modal-actions">
      <button class="btn ok" id="uf-go">Grant</button>
      <button class="btn" id="uf-cancel">Cancel</button>
    </div></div>`;
  document.body.appendChild(box);
  $("uf-cancel").onclick = () => box.remove();
  $("uf-go").onclick = async () => {
    const body = {
      holder: $("uf-name").value.trim() || "student",
      rollNo: $("uf-roll").value.trim() || null,
      minutes: +$("uf-mins").value,
    };
    box.remove();
    await api(`${pcPath()}/unlock`, body);
    refresh();
  };
}

$("btn-unlock").onclick = openUnlockForm;

$("btn-lock").onclick = () => askConfirm("Lock PC", "The student will be locked out immediately. Continue?", async () => {
  await api(`${pcPath()}/lock`, { reason: "manual lock from dashboard" });
  refresh();
});

$("btn-sleep").onclick = () => askConfirm("Sleep PC", "Ask this PC to go to sleep. Continue?", async () => {
  await api(`${pcPath()}/sleep`, { reason: "manual sleep" });
  refresh();
});

$("btn-wake").onclick = async () => {
  await api(`${pcPath()}/wake`);
  refresh();
};

$("btn-msg").onclick = () => $("msg-form").classList.toggle("hidden");

$("msg-send").onclick = async () => {
  const text = $("msg-text").value.trim();
  if (!text) return;
  await api(`${pcPath()}/message`, { text });
  $("msg-text").value = "";
  $("msg-form").classList.add("hidden");
};

$("btn-reboot").onclick = () =>
  askConfirm("Reboot PC", "The PC will reboot in 10 seconds. The student will lose work. Continue?", async () => {
    await api(`${pcPath()}/reboot`);
    refresh();
  });

// Forget = remove the seat from the dashboard (laptop gone or renumbered).
$("btn-forget").onclick = () =>
  askConfirm(
    "Forget this PC",
    "Removes the seat, its token and any grants. Use it when a laptop is decommissioned or renumbered. " +
      "If its agent is still running it will re-register within seconds - stop the agent on that PC first.",
    async () => {
      const r = await api(`${pcPath()}/forget`, { reason: "removed from dashboard" });
      if (!r) return;
      selectedId = null;
      $("sel-title").textContent = "Selected PC";
      $("sel-state").textContent = "—";
      $("sel-state").className = "state-chip";
      $("sel-info").textContent = "No PC selected.";
      refresh();
      loadAudit();
    }
  );

// A page reload must not ask for the password again when the session cookie is
// still good: ask the server who we are before showing the login box.
async function resumeSession() {
  try {
    const r = await fetch("/api/state");
    if (!r.ok) return; // no session: the login modal stays up
    loggedIn = true;
    $("login").classList.add("hidden");
    render(await r.json());
    loadAudit();
    if (typeof onAdminLogin === "function") onAdminLogin();
  } catch (_) {}
}

// start: open SSE immediately; REST polling begins after login
connectSse();
resumeSession();
setInterval(refresh, 5000);
