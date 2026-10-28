// LabNexus — guided timetable sidebar
//
// A four-step walkthrough: picture -> department -> lab hours -> review.
// Everything it saves goes through the same /api/schedule endpoints the rest of
// the dashboard uses. The picture is a reference; the confirmed grid is what the
// analyser reads.
//
//   step 1  keep the official timetable picture (optional)
//   step 2  choose the department the lab belongs to
//   step 3  confirm the weekly lab hours, one row per section
//   step 4  processing animation, then what runs now / next + attendance
//
// The panel also drives the live "lab now / next class" strip on the dashboard,
// so an admin who never opens the sidebar still sees what the timetable says.

(function () {
  const $ = (id) => document.getElementById(id);

  // Kept in sync with the server's list; the server is the authority.
  const FALLBACK_DEPARTMENTS = {
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

  const DAYS = [
    [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"],
  ];
  const REFRESH_MS = 30000;

  const S = {
    step: 1,
    slots: [],
    department: null,
    departments: FALLBACK_DEPARTMENTS,
    image: null,
    images: [],       // one timetable picture per class
    result: null,
    processing: false,
    busy: false,
    loaded: false,
    started: false,
    loggedOut: false,
    attendMode: "count",
    timer: null,
    animation: null,
    dirty: false,
    userEdited: false,
    saving: false,
    autoSaveTimer: null,
    autoSavedAt: null,
  };

  const drawer = $("tt-drawer");
  const tab = $("tt-tab");
  const scrim = $("tt-scrim");

  // ---------------- helpers ----------------

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  async function api(path, body, method) {
    // Reads are the default; anything with a body is a write.
    const verb = method || (body === undefined ? "GET" : "POST");
    try {
      const r = await fetch(path, {
        method: verb,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) S.loggedOut = true;
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: { error: `Cannot reach the server (${err.message}).` } };
    }
  }

  function parseHM(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function fmtHM(mins) {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function dayName(day) {
    return DAYS.find(([v]) => v === Number(day))?.[1] || "?";
  }

  function fmtIn(mins) {
    if (!Number.isFinite(mins) || mins <= 0) return "now";
    const d = Math.floor(mins / (60 * 24));
    const h = Math.floor((mins % (60 * 24)) / 60);
    const m = mins % 60;
    if (d) return `${d}d ${h}h`;
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  function dayStamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "wz-msg" + (kind ? " " + kind : "");
  }

  function sectionsText(session) {
    return (session.sections || []).map((x) => x.label).join(" + ");
  }

  function deptLabel() {
    if (!S.department) return "department not set";
    return S.departments[S.department] || S.department;
  }

  // ---------------- live status strip (dashboard) ----------------

  function showBanner(html) {
    const box = $("lab-status");
    box.classList.remove("hidden");
    box.dataset.kind = html.kind;
    $("ls-dot").className = "ls-dot " + html.kind;
    $("ls-kicker").textContent = html.kicker;
    $("ls-title").textContent = html.title;
    $("ls-sub").textContent = html.sub;
    $("ls-open").textContent = html.action || "Open timetable";
  }

  function hideBanner() {
    $("lab-status").classList.add("hidden");
  }

  // Reads what the server says the timetable is doing right now, and turns it
  // into one sentence an admin can act on without opening anything.
  async function refreshBanner() {
    // Do not hammer the API with 401s while the login box is up.
    if (!$("login").classList.contains("hidden")) {
      hideBanner();
      return;
    }
    const r = await api("/api/schedule");
    if (!r.ok) {
      hideBanner();
      return;
    }
    const slots = r.data.slots || [];
    const status = r.data.status || {};
    const dept = r.data.department ? ` · ${r.data.departments?.[r.data.department] || r.data.department}` : "";

    if (!slots.length) {
      showBanner({
        kind: "setup",
        kicker: "Timetable",
        title: "No lab hours yet — the lab stays locked",
        sub: "Add the official timetable and the system will open the lab during periods, by itself.",
        action: "Set up timetable",
      });
      setDot(true);
      return;
    }

    setDot(!r.data.department);

    if (status.mode === "OVERRIDE" && status.override) {
      const until = new Date(status.override.until);
      const mins = Math.max(0, Math.round((until - Date.now()) / 60000));
      showBanner({
        kind: "live",
        kicker: "Override",
        title: "Manual override — the timetable is paused",
        sub: `Seats can be handed out until ${until.toLocaleTimeString()} (${fmtIn(mins)} left).`,
        action: "Manage timetable",
      });
      return;
    }

    if (status.activeSlot) {
      const a = status.activeSlot;
      const same = slots.filter((x) => x.day === a.day && x.start === a.start && x.end === a.end);
      const shared = same.length > 1 ? ` · ${same.length} sections in the room together` : "";
      const bannerNext = status.next && !status.next.slot
        ? ""
        : status.next
          ? ` · then ${status.next.slot.label} at ${status.next.slot.start}${status.next.shared ? " (same room, take attendance again)" : " (take attendance again)"}`
          : "";
      const endsAt = parseHM(a.end);
      const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
      const left = endsAt === null ? null : endsAt - nowMins;
      showBanner({
        kind: "live",
        kicker: "In period",
        title: `${same.map((x) => x.label).join(" + ") || a.label}${dept}`,
        sub: `${a.when}${left !== null && left > 0 ? ` · ${fmtIn(left)} left` : ""}${shared}${bannerNext}`,
        action: "Take attendance",
      });
      return;
    }

    if (status.next) {
      const n = status.next;
      const same = slots.filter((x) => x.day === n.slot.day && x.start === n.slot.start && x.end === n.slot.end);
      const shared = same.length > 1 ? ` · ${same.length} sections share this lab` : "";
      showBanner({
        kind: "next",
        kicker: "Next class",
        title: `${same.map((x) => x.label).join(" + ") || n.slot.label}${dept}`,
        sub: `${n.slot.when} · starts in ${fmtIn(n.inMinutes)}${shared}`,
        action: "Open timetable",
      });
      return;
    }

    showBanner({
      kind: "next",
      kicker: "Timetable",
      title: "No periods in the next 7 days",
      sub: "The lab stays locked until the next lab period starts. Check the lab hours if that is wrong.",
      action: "Open timetable",
    });
  }

  function setDot(incomplete) {
    const dot = $("tt-tab-dot");
    if (dot) dot.hidden = !incomplete;
  }

  // ---------------- drawer ----------------

  function openDrawer() {
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    tab.setAttribute("aria-expanded", "true");
    void loadSetup();
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    tab.setAttribute("aria-expanded", "false");
    tab.focus({ preventScroll: true });
  }

  tab.onclick = openDrawer;
  $("tt-close").onclick = closeDrawer;
  scrim.onclick = closeDrawer;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("wz-extract-modal").classList.contains("hidden")) return closeExtractModal("discard");
    if (!$("wz-lightbox").classList.contains("hidden")) return closeLightbox();
    if (drawer.classList.contains("open")) closeDrawer();
  });

  $("ls-open").onclick = openDrawer;

  $("wz-auth-go").onclick = () => {
    closeDrawer();
    $("login").classList.remove("hidden");
    $("login-pass").focus();
  };

  // ---------------- load ----------------

  async function loadSetup() {
    if (S.busy) return;
    S.busy = true;
    S.loggedOut = false;
    try {
      const r = await api("/api/schedule");
      if (r.status === 401) {
        S.loggedOut = true;
        showAuth();
        return;
      }
      if (!r.ok) {
        showAuth(
          r.status === 0
            ? "The dashboard cannot reach its own server. Check that the LabNexus window is still running, then try again."
            : r.data.error || "Could not load the timetable.",
          r.status === 0 ? "Server not responding" : "Could not load the timetable"
        );
        return;
      }
      const remote = (r.data.slots || []).map((x) => ({
        day: Number(x.day), start: x.start, end: x.end, label: x.label,
      }));
      // Never throw away lab hours the admin is in the middle of typing.
      if (!(S.step === 3 && S.dirty)) S.slots = remote;
      S.department = r.data.department || null;
      S.departments = r.data.departments || FALLBACK_DEPARTMENTS;
      S.image = r.data.image || null;
      S.images = Array.isArray(r.data.images) ? r.data.images : (r.data.image ? [r.data.image] : []);
      S.loaded = true;

      renderGallery();
      renderDepartments();
      renderRows();

      if (!S.started) {
        S.started = true;
        // A returning admin wants the status panel; a new one wants step 1.
        if (!S.slots.length) go(1);
        else if (!S.department) go(2);
        else {
          go(4);
          await runAnalysis({ animate: true });
        }
      } else if (S.step === 4) {
        await runAnalysis({ animate: false });
      }
    } finally {
      S.busy = false;
      renderChrome();
    }
  }

  function showAuth(reason, heading) {
    document.querySelectorAll(".wz-step").forEach((el) => el.classList.add("hidden"));
    const auth = $("wz-auth");
    auth.classList.remove("hidden");
    auth.querySelector(".wz-h").textContent = heading || "Log in to set up the timetable";
    if (reason) auth.querySelector(".wz-p").textContent = reason;
    $("wz-next").classList.add("hidden");
    $("wz-skip").classList.add("hidden");
    $("wz-back").classList.add("hidden");
    $("tt-tab-dot").hidden = false;
  }

  // ---------------- step machine ----------------

  function go(step) {
    S.step = Math.max(1, Math.min(4, step));
    document.querySelectorAll(".wz-step").forEach((el) => {
      el.classList.toggle("hidden", Number(el.dataset.step) !== S.step);
    });
    document.querySelectorAll("#wz-stepper li").forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle("active", n === S.step);
      li.classList.toggle("done", n < S.step);
    });
    setDot(!S.slots.length || !S.department);
    renderChrome();
    $("wz-body").scrollTop = 0;
    if (S.step === 4) maybeStartAutoRefresh();
    else stopAutoRefresh();
  }

  function renderChrome() {
    const back = $("wz-back");
    const skip = $("wz-skip");
    const next = $("wz-next");

    // Signed out: the only action is the login button inside the drawer.
    if (S.loggedOut) {
      back.classList.add("hidden");
      skip.classList.add("hidden");
      next.classList.add("hidden");
      return;
    }

    back.classList.toggle("hidden", S.step === 1);
    back.textContent = S.step === 4 ? "Edit lab hours" : "Back";

    skip.classList.add("hidden");
    next.classList.remove("hidden");
    next.disabled = false;

    if (S.step === 1) {
      next.textContent = S.images.length ? "Continue" : "Continue without picture";
    } else if (S.step === 2) {
      next.textContent = "Continue";
      next.disabled = !S.department;
    } else if (S.step === 3) {
      next.textContent = "Analyse timetable";
      const issues = rowIssues();
      next.disabled = !S.slots.length || issues.length > 0;
      $("wz-empty-hint").classList.toggle("hidden", S.slots.length > 0 || issues.length > 0);
    } else {
      next.textContent = S.processing ? "Working…" : "Done";
      next.disabled = S.processing;
      if (S.result && !S.processing) {
        skip.classList.remove("hidden");
        skip.textContent = "Refresh";
      }
    }
  }

  $("wz-back").onclick = () => {
    if (S.step === 4) {
      go(3);
    } else {
      go(S.step - 1);
    }
  };

  $("wz-next").onclick = async () => {
    if (S.step === 1) return go(2);
    if (S.step === 2) return saveDepartment();
    if (S.step === 3) return analyse();
    closeDrawer();
  };

  $("wz-skip").onclick = () => {
    if (S.step === 4) runAnalysis({ animate: false });
  };

  // clicking a stepper label jumps back to that step
  document.querySelectorAll("#wz-stepper li").forEach((li) => {
    li.style.cursor = "pointer";
    li.onclick = () => {
      const n = Number(li.dataset.step);
      if (n === 4) {
        if (S.slots.length) analyse();
        else {
          go(3);
          setMsg($("wz-grid-msg"), "Add at least one lab period before the review.", "err");
        }
        return;
      }
      go(n);
    };
  });

  // ---------------- step 1: picture ----------------

  // ---------------- picture gallery (one picture per class) ----------------

  function renderGallery() {
    const box = $("wz-gallery");
    if (!S.images.length) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    box.classList.remove("hidden");
    box.innerHTML = S.images
      .map(
        (img) => `
      <div class="wz-thumb" data-id="${escapeHtml(img.id)}">
        <button type="button" class="wz-thumb-btn wz-thumb-pic" title="Open the picture full size" aria-label="Open ${escapeHtml(img.name || "timetable picture")} full size">
          <img src="/api/schedule/image?v=${img.uploadedAt || Date.now()}&id=${escapeHtml(img.id)}" alt="Timetable picture of ${escapeHtml(img.name || "the class")}">
        </button>
        <input class="wz-thumb-name" type="text" maxlength="120" placeholder="Class, e.g. CSE 3A" value="${escapeHtml(img.name || "")}" aria-label="Which class this timetable belongs to">
        <span class="wz-thumb-info">${Math.max(1, Math.round((img.size || 0) / 1024))} KB · ${new Date(img.uploadedAt || Date.now()).toLocaleDateString()}</span>
        <div class="wz-thumb-actions">
          <button type="button" class="wz-thumb-extract btn ghost" title="Read the lab periods of this class out of the picture" aria-label="Read lab periods from ${escapeHtml(img.name || "this picture")}">✨ Read periods</button>
          <button type="button" class="icon-btn wz-thumb-remove" title="Remove this picture" aria-label="Remove ${escapeHtml(img.name || "this picture")}">✕</button>
        </div>
      </div>`
      )
      .join("");

    box.querySelectorAll(".wz-thumb").forEach((thumb) => {
      const id = thumb.dataset.id;
      thumb.querySelector(".wz-thumb-pic").onclick = () => openLightbox(id);
      thumb.querySelector(".wz-thumb-extract").onclick = (e) => runExtract($("wz-upload-msg"), id, e.currentTarget);
      thumb.querySelector(".wz-thumb-remove").onclick = () => removePicture(id);
      const nameField = thumb.querySelector(".wz-thumb-name");
      nameField.onchange = () => renamePicture(id, nameField.value);
    });
  }

  async function renamePicture(id, name) {
    const clean = String(name || "").trim();
    if (!clean) return renderGallery(); // nothing typed: keep the old name
    const r = await api(`/api/schedule/image/${encodeURIComponent(id)}`, { name: clean }, "PUT");
    if (!r.ok) return setMsg($("wz-upload-msg"), r.data?.error || "Could not rename the picture.", "err");
    const img = S.images.find((x) => x.id === id);
    if (img) img.name = r.data.image?.name || clean;
    setMsg($("wz-upload-msg"), `Renamed to “${img?.name || clean}” — extracted periods will be labeled with that class.`, "ok");
  }

  async function removePicture(id) {
    const r = await api(`/api/schedule/image?id=${encodeURIComponent(id)}`, undefined, "DELETE");
    if (!r.ok) return setMsg($("wz-upload-msg"), "Could not remove the picture.", "err");
    S.images = S.images.filter((x) => x.id !== id);
    S.image = S.images[0] || null;
    renderGallery();
    setMsg($("wz-upload-msg"), "Picture removed. You can upload another one or continue.");
    renderChrome();
    refreshBanner();
  }

  async function upload(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      return setMsg($("wz-upload-msg"), "That is not a picture. Use PNG, JPG, WEBP or GIF.", "err");
    }
    if (file.size > 8 * 1024 * 1024) {
      return setMsg($("wz-upload-msg"), "That picture is larger than 8 MB. Use a smaller photo or a screenshot.", "err");
    }

    const drop = $("wz-drop");
    drop.classList.add("busy");
    setMsg($("wz-upload-msg"), `Uploading ${file.name}…`);
    try {
      const r = await fetch("/api/schedule/image", {
        method: "POST",
        headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) {
        showAuth("Your session ended. Log in again to keep setting up the timetable.");
        return;
      }
      if (!r.ok) throw new Error(data.error || r.statusText);
      S.images = Array.isArray(data.images) ? data.images : [...(S.images || [])];
      S.image = data.image || null;
      renderGallery();
      const stored = data.image;
      setMsg(
        $("wz-upload-msg"),
        `Picture stored as “${stored?.name || file.name}”. Rename it below to the class it belongs to — extracted periods are labeled with that name.`,
        "ok"
      );
      renderChrome();
      refreshBanner();
    } catch (err) {
      setMsg($("wz-upload-msg"), `Upload failed: ${err.message}. You can try again.`, "err");
    } finally {
      drop.classList.remove("busy");
      $("wz-file").value = "";
    }
  }

  const drop = $("wz-drop");
  drop.onclick = () => $("wz-file").click();
  drop.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      $("wz-file").click();
    }
  };
  $("wz-file").onchange = (e) => upload(e.target.files && e.target.files[0]);

  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("dragover");
    })
  );
  drop.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    upload(file);
  });

  // ---------------- lightbox ----------------

  function openLightbox(id) {
    const img = (S.images.length ? S.images.find((x) => x.id === id) : null) || S.image;
    if (!img) {
      setMsg($("wz-grid-msg"), "No timetable picture is stored. You can add one in step 1.", "err");
      return;
    }
    $("wz-lightbox-img").src = `/api/schedule/image?v=${img.uploadedAt || Date.now()}&id=${encodeURIComponent(img.id)}`;
    $("wz-lightbox").classList.remove("hidden");
  }

  function closeLightbox() {
    $("wz-lightbox").classList.add("hidden");
    $("wz-lightbox-img").src = "";
  }

  $("wz-peek").onclick = () => openLightbox(S.image?.id);
  $("wz-lightbox-close").onclick = closeLightbox;
  $("wz-lightbox").onclick = (e) => {
    if (e.target === $("wz-lightbox")) closeLightbox();
  };

  // ---------------- read periods from the picture (AI extract) ----------------

  // The server only PROPOSES rows; nothing is saved until the admin presses
  // one of the apply buttons, and applying still goes through the normal
  // row validation + autosave/PUT path.
  let extractRows = [];
  let extractNotes = [];
  let extractSource = null;

  function openExtractModal() {
    const byDay = new Map();
    for (const row of extractRows) {
      if (!byDay.has(row.day)) byDay.set(row.day, []);
      byDay.get(row.day).push(row);
    }
    $("wz-extract-meta").textContent =
      `${extractRows.length} lab period(s) on ${byDay.size || "?"} day(s) were read from ${extractSource ? `the “${extractSource}” picture` : "the picture"}.`;
    $("wz-extract-list").innerHTML = DAYS.filter(([d]) => byDay.has(d))
      .map(
        ([d, l]) => `
      <div class="extract-day">${l}</div>
      ${byDay
        .get(d)
        .map(
          (r) => `
        <div class="extract-row">
          <span class="er-time">${escapeHtml(r.start)}–${escapeHtml(r.end)}</span>
          <span class="er-label">${escapeHtml(r.label)}</span>
        </div>`
        )
        .join("")}`
      )
      .join("");
    $("wz-extract-notes").textContent = extractNotes.length ? `Notes: ${extractNotes.join(" · ")}` : "";
    $("wz-extract-modal").classList.remove("hidden");
  }

  function closeExtractModal(kind) {
    $("wz-extract-modal").classList.add("hidden");
    if (kind === "applied") return;
    extractRows = [];
    extractNotes = [];
  }

  function applyExtract(mode) {
    if (!extractRows.length) return closeExtractModal("discard");
    S.slots = document.querySelectorAll("#wz-rows .wz-row").length ? readRows() : S.slots;
    if (mode === "replace") {
      S.slots = extractRows.map((r) => ({ day: Number(r.day), start: r.start, end: r.end, label: r.label }));
    } else {
      const existing = new Set(S.slots.map((r) => `${r.day}|${r.start}|${r.end}|${String(r.label).trim().toLowerCase()}`));
      for (const row of extractRows) {
        const clean = { day: Number(row.day), start: row.start, end: row.end, label: row.label };
        const key = `${clean.day}|${clean.start}|${clean.end}|${clean.label.toLowerCase()}`;
        if (!existing.has(key)) {
          S.slots.push(clean);
          existing.add(key);
        }
      }
      // keep the human-friendly ordering the grid normally shows
      S.slots.sort((a, b) => Number(a.day) - Number(b.day) || parseHM(a.start) - parseHM(b.start));
    }
    closeExtractModal("applied");
    S.userEdited = true;
    if (S.step !== 3) go(3);
    renderRows();
    validateLive();
    setMsg(
      $("wz-grid-msg"),
      mode === "replace" && extractRows.length && S.slots.length
        ? `Grid filled from the picture (${extractRows.length} period(s)); check the rows, then press Analyse.`
        : "Periods added from the picture; check the rows, then press Analyse.",
      "ok"
    );
    renderChrome();
  }

  // `imageId` reads one specific class picture; no id means "the first one".
  async function runExtract(msgEl, imageId, clickedBtn) {
    const busy = clickedBtn || $("wz-extract-grid");
    const wasDisabled = busy?.disabled;
    if (busy) busy.disabled = true;
    if (clickedBtn) clickedBtn.textContent = "⏳ Reading…";
    setMsg(msgEl, "Reading the picture with the AI key… this can take up to a minute.", "");

    // Body must not be undefined: api() treats body-undefined as a GET, and this
    // endpoint is POST-only.
    const r = await api("/api/schedule/extract", imageId ? { image: imageId } : {});
    if (busy) busy.disabled = wasDisabled && !S.images.length;
    if (clickedBtn) clickedBtn.textContent = "✨ Read periods";

    if (r.status === 401) {
      showAuth("Your session ended. Log in again to keep setting up the timetable.");
      return;
    }
    if (r.data?.setup) {
      setMsg(msgEl, r.data.error, "err");
      return;
    }
    if (!r.ok) {
      const text = [r.data?.error, r.data?.hint].filter(Boolean).join(" ")
        || `Could not read the picture (server answered ${r.status || "nothing"}).`;
      setMsg(msgEl, text, "err");
      return;
    }
    extractRows = r.data.slots || [];
    extractNotes = r.data.notes || [];
    extractSource = r.data.image?.name || null;
    setMsg(msgEl, extractRows.length ? "" : "No lab periods found.", extractRows.length ? "" : "err");
    openExtractModal();
    renderChrome();
  }

  $("wz-extract-grid").onclick = (e) => runExtract($("wz-grid-msg"), null, e.currentTarget);
  $("wz-extract-replace").onclick = () => applyExtract("replace");
  $("wz-extract-add").onclick = () => applyExtract("add");
  $("wz-extract-cancel").onclick = () => closeExtractModal("discard");
  $("wz-extract-modal").onclick = (e) => {
    if (e.target === $("wz-extract-modal")) closeExtractModal("discard");
  };

  // ---------------- step 2: department ----------------

  function renderDepartments() {
    const box = $("wz-depts");
    box.innerHTML = Object.entries(S.departments)
      .map(
        ([code, label]) => `
      <button type="button" class="dept-btn${S.department === code ? " selected" : ""}" data-dept="${escapeHtml(code)}">
        <b>${escapeHtml(code)}</b><span>${escapeHtml(label)}</span>
      </button>`
      )
      .join("");
    box.querySelectorAll(".dept-btn").forEach((btn) => {
      btn.onclick = () => {
        S.department = btn.dataset.dept;
        renderDepartments();
        setMsg($("wz-dept-hint"), `${S.department} — ${S.departments[S.department]}. Continue when ready.`, "ok");
        renderChrome();
      };
    });
  }

  async function saveDepartment() {
    if (!S.department) return;
    const next = $("wz-next");
    next.disabled = true;
    // If the admin already edited rows, save those - never an older copy.
    const slots = document.querySelectorAll("#wz-rows .wz-row").length ? readRows() : S.slots;
    const r = await api("/api/schedule", { slots, department: S.department }, "PUT");
    next.disabled = false;
    if (!r.ok) {
      setMsg($("wz-dept-hint"), r.data.error || "Could not save the department.", "err");
      return;
    }
    S.slots = (r.data.slots || S.slots).map((x) => ({
      day: Number(x.day), start: x.start, end: x.end, label: x.label,
    }));
    renderRows();
    refreshBanner();
    if (typeof refresh === "function") refresh();
    go(3);
  }

  // ---------------- step 3: lab hours ----------------

  // The same checks the server makes, done while typing: the admin sees the
  // problem on the row instead of losing the grid to a 400 on the last click.
  function rowIssues(rows = S.slots) {
    const issues = [];
    const seen = new Map();
    rows.forEach((row, i) => {
      const where = `Row ${i + 1}`;
      const start = parseHM(row.start);
      const end = parseHM(row.end);
      if (!String(row.label || "").trim()) issues.push({ i, text: `${where}: give the period a name.` });
      if (start === null) issues.push({ i, text: `${where}: start time is not valid.` });
      else if (end === null) issues.push({ i, text: `${where}: end time is not valid.` });
      else if (end <= start) issues.push({ i, text: `${where}: the end time must be after the start time.` });

      const key = `${row.day}|${start}|${end}|${String(row.label || "").trim().toLowerCase()}`;
      if (seen.has(key)) issues.push({ i, text: `${where} is a copy of row ${seen.get(key) + 1} — remove one.` });
      else seen.set(key, i);

      if (start !== null && end !== null && end > start) {
        for (let j = 0; j < i; j++) {
          const o = rows[j];
          const os = parseHM(o.start);
          const oe = parseHM(o.end);
          if (os === null || oe === null) continue;
          if (Number(o.day) !== Number(row.day)) continue;
          const sameWindow = os === start && oe === end;
          if (!sameWindow && start < oe && os < end) {
            issues.push({ i, text: `${where} overlaps row ${j + 1} on ${dayName(row.day)}. Change the hours or use ⧉ to share the window.` });
          }
        }
      }
    });
    return issues;
  }

  function renderRows() {
    const box = $("wz-rows");
    if (!S.slots.length) {
      box.innerHTML = `<div class="wz-empty">No periods yet. Add the lab hours from the picture — the lab stays locked until you do.</div>`;
      renderSummary();
      return;
    }
    box.innerHTML = S.slots
      .map((slot, i) => {
        const opts = DAYS.map(
          ([v, l]) => `<option value="${v}"${v === Number(slot.day) ? " selected" : ""}>${l}</option>`
        ).join("");
        return `
        <div class="wz-row" data-i="${i}">
          <select class="wz-day" aria-label="Day">${opts}</select>
          <input class="wz-start" type="time" value="${slot.start || "09:00"}" aria-label="Start time">
          <input class="wz-end" type="time" value="${slot.end || "11:00"}" aria-label="End time">
          <input class="wz-label" type="text" maxlength="60" placeholder="DBMS Lab — CSE 3A" value="${escapeHtml(slot.label || "")}" aria-label="Period name">
          <button class="wz-clone" title="Another section at the same time" aria-label="Add another section at the same time">⧉</button>
          <button class="wz-del" title="Remove this period" aria-label="Remove this period">✕</button>
        </div>`;
      })
      .join("");

    box.querySelectorAll(".wz-row").forEach((row) => {
      row.querySelectorAll("select, input").forEach((field) => {
        field.oninput = field.onchange = () => {
          S.dirty = true;
          S.userEdited = true;
          S.slots = readRows();
          validateLive();
        };
      });
      row.querySelector(".wz-del").onclick = () => {
        const i = Number(row.dataset.i);
        S.slots = readRows();
        S.slots.splice(i, 1);
        S.userEdited = true;
        renderRows();
        validateLive();
      };
      row.querySelector(".wz-clone").onclick = () => {
        const i = Number(row.dataset.i);
        S.slots = readRows();
        const src = S.slots[i];
        const copy = { day: src.day, start: src.start, end: src.end, label: "" };
        S.slots.splice(i + 1, 0, copy);
        S.userEdited = true;
        renderRows();
        const fresh = document.querySelectorAll("#wz-rows .wz-row")[i + 1];
        fresh?.querySelector(".wz-label")?.focus();
        validateLive();
      };
    });
    renderSummary();
  }

  function renderSummary() {
    const rows = S.slots;
    if (!rows.length) {
      $("wz-summary").textContent = "";
      return;
    }
    const days = new Set(rows.map((r) => Number(r.day)));
    const windows = new Map();
    for (const r of rows) {
      const key = `${r.day}|${r.start}|${r.end}`;
      windows.set(key, (windows.get(key) || 0) + 1);
    }
    const shared = [...windows.values()].filter((n) => n > 1).length;
    $("wz-summary").textContent =
      `${rows.length} period${rows.length === 1 ? "" : "s"} · ${days.size} day${days.size === 1 ? "" : "s"}` +
      (shared ? ` · ${shared} shared window${shared === 1 ? "" : "s"}` : "");
  }

  function readRows() {
    return [...$("wz-rows").querySelectorAll(".wz-row")].map((row) => ({
      day: Number(row.querySelector(".wz-day").value),
      start: row.querySelector(".wz-start").value,
      end: row.querySelector(".wz-end").value,
      label: row.querySelector(".wz-label").value.trim(),
    }));
  }

  function validateLive() {
    S.slots = readRows();
    const issues = rowIssues();
    document.querySelectorAll("#wz-rows .wz-row").forEach((row) => row.classList.remove("bad"));
    issues.slice(0, 6).forEach((issue) => {
      document.querySelectorAll("#wz-rows .wz-row")[issue.i]?.classList.add("bad");
    });
    setMsg($("wz-grid-msg"), issues.length ? issues[0].text : "", issues.length ? "err" : "");
    $("wz-empty-hint").classList.add("hidden");
    renderSummary();
    renderChrome();
    scheduleAutoSave(issues.length);
  }

  // A long grid must survive a closed drawer or a refreshed page. As soon as the
  // rows are valid they are saved quietly; invalid rows are never sent, so a
  // half-typed period cannot wipe the live timetable.
  function scheduleAutoSave(issueCount) {
    if (S.autoSaveTimer) clearTimeout(S.autoSaveTimer);
    if (issueCount || !S.userEdited || S.saving) return;
    S.autoSaveTimer = setTimeout(async () => {
      if (S.saving) return;
      S.saving = true;
      const rows = readRows();
      const r = await api("/api/schedule", { slots: rows, department: S.department }, "PUT");
      S.saving = false;
      if (!r.ok) return; // keep the admin's rows; the next valid edit retries
      S.slots = (r.data.slots || rows).map((x) => ({
        day: Number(x.day), start: x.start, end: x.end, label: x.label,
      }));
      S.dirty = false;
      S.userEdited = false;
      S.autoSavedAt = Date.now();
      if (!S.processing) setMsg($("wz-grid-msg"), "Saved.", "ok");
      refreshBanner();
      if (typeof refresh === "function") refresh();
      renderSummary();
    }, 1100);
  }

  function nextRowDefaults() {
    const rows = S.slots;
    if (!rows.length) return { day: 1, start: "09:00", end: "11:00" };
    const last = rows[rows.length - 1];
    const startMins = parseHM(last.end);
    const day = Number(last.day) || 1;
    if (startMins === null) return { day, start: "09:00", end: "11:00" };
    const endMins = Math.min(startMins + 120, 23 * 60 + 59);
    if (endMins <= startMins) return { day, start: "09:00", end: "11:00" };
    return { day, start: fmtHM(startMins), end: fmtHM(endMins) };
  }

  $("wz-add").onclick = () => {
    S.slots = readRows();
    S.slots.push({ ...nextRowDefaults(), label: "" });
    S.userEdited = true;
    renderRows();
    const rows = document.querySelectorAll("#wz-rows .wz-row");
    rows[rows.length - 1]?.querySelector(".wz-label")?.focus();
    validateLive();
  };

  $("wz-clear").onclick = () => {
    if (!S.slots.length) return;
    const question =
      "Remove every lab period? The timetable is saved with no lab hours and the whole lab stays locked until you add periods again.";
    const run = async () => {
      const r = await api("/api/schedule", { slots: [], department: S.department }, "PUT");
      if (!r.ok) return setMsg($("wz-grid-msg"), r.data.error || "Could not clear the grid.", "err");
      S.slots = [];
      renderRows();
      refreshBanner();
      if (typeof refresh === "function") refresh();
      setMsg($("wz-grid-msg"), "All lab hours removed and saved. The lab stays locked until you add periods.", "err");
      renderChrome();
    };
    if (typeof askConfirm === "function") askConfirm("Remove all lab hours", question, run);
    else if (window.confirm(question)) run();
  };

  // ---------------- step 4: analyse ----------------

  async function analyse() {
    S.slots = readRows();
    const issues = rowIssues();
    if (!S.slots.length) {
      setMsg($("wz-grid-msg"), "Add at least one period before analysing.", "err");
      return;
    }
    if (issues.length) {
      setMsg($("wz-grid-msg"), issues[0].text, "err");
      return;
    }

    const next = $("wz-next");
    next.disabled = true;
    const saved = await api("/api/schedule", { slots: S.slots, department: S.department }, "PUT");
    next.disabled = false;

    if (!saved.ok) {
      const details = Array.isArray(saved.data.errors) ? saved.data.errors.join(" · ") : "";
      setMsg($("wz-grid-msg"), details || saved.data.error || "The lab hours could not be saved.", "err");
      go(3);
      return;
    }

    S.slots = (saved.data.slots || S.slots).map((x) => ({
      day: Number(x.day), start: x.start, end: x.end, label: x.label,
    }));
    S.dirty = false;
    setMsg($("wz-grid-msg"), "");
    refreshBanner();
    if (typeof refresh === "function") refresh();
    go(4);
    await runAnalysis({ animate: true });
  }

  async function runAnalysis({ animate }) {
    if (S.processing) return;
    S.processing = true;
    const processing = $("wz-processing");
    const result = $("wz-result");

    if (animate) {
      processing.classList.remove("hidden");
      result.classList.add("hidden");
      const steps = [
        "Opening the confirmed weekly lab hours",
        "Checking every period against the clock",
        "Grouping sections that share the lab",
        "Building the next 7 days",
      ];
      $("wz-progress").innerHTML = steps.map((t) => `<li><span class="tick">✓</span>${t}</li>`).join("");
      const items = [...$("wz-progress").children];
      S.animation = (async () => {
        for (let i = 0; i < items.length; i++) {
          items[i].classList.add("run");
          await new Promise((r) => setTimeout(r, 300));
          items[i].classList.remove("run");
          items[i].classList.add("done");
        }
      })();
    }
    renderChrome();

    const request = api("/api/schedule/analysis");
    if (animate && S.animation) await S.animation;
    const r = await request;

    S.processing = false;

    if (!r.ok || !r.data || r.data.error) {
      processing.classList.add("hidden");
      result.classList.remove("hidden");
      const reason = r.data?.error || (r.status ? `server said ${r.status}` : "the server did not answer");
      result.innerHTML = `
        <div class="result-hero empty">
          <span class="rh-label">Not analysed</span>
          <h3>The lab hours were saved, but the analysis failed</h3>
          <p>${escapeHtml(reason)}. Nothing was lost — press <b>Refresh</b> below to try again.</p>
        </div>`;
      renderChrome();
      return;
    }

    S.result = r.data;
    renderResult(S.result);
    updateLiveMode(S.result);
  }

  function renderResult(a) {
    $("wz-processing").classList.add("hidden");
    const box = $("wz-result");
    box.classList.remove("hidden");

    // "CSE lab" makes it clear this is the lab's owner, not a claim that every
    // section in the grid belongs to that department.
    const dept = a.department
      ? `<span class="pill ok">${escapeHtml(a.department)} lab</span>`
      : `<span class="pill">no department</span>`;

    let hero;
    if (a.running) {
      const ends = a.running.endsInMinutes;
      hero = `
        <div class="result-hero live">
          <span class="rh-label">In progress now</span>
          <h3>${escapeHtml(sectionsText(a.running))} ${dept}</h3>
          <p><b>${escapeHtml(a.running.when)}</b> — the lab is open until <b>${escapeHtml(a.running.end)}</b>${
            Number.isFinite(ends) && ends > 0 ? `, <span class="countdown">${fmtIn(ends)} left</span>` : ""
          }.
          ${a.override
            ? `An override is on until <b>${new Date(a.override.until).toLocaleTimeString()}</b> — every seat is open without attendance.`
            : a.running.shared
              ? `<b>${a.running.sections.length} sections</b> are in the room together — take attendance once for the whole room.`
              : "Take attendance to hand out seats."}</p>
        </div>`;
    } else if (a.next) {
      hero = `
        <div class="result-hero">
          <span class="rh-label">${a.override ? "Override now" : "Starts soon"}</span>
          <h3>${escapeHtml(sectionsText(a.next))} ${dept}</h3>
          <p><b>${escapeHtml(a.next.when)}</b> — starts <span class="countdown">in ${fmtIn(a.next.inMinutes)}</span>.
          ${a.override
            ? `An override is on until <b>${new Date(a.override.until).toLocaleTimeString()}</b>, so the lab is open right now without attendance.`
            : a.next.shared
              ? `<b>${a.next.sections.length} sections</b> share this window; the room opens for all of them at once.`
              : "One section."}</p>
        </div>`;
    } else {
      hero = `
        <div class="result-hero empty">
          <span class="rh-label">Nothing scheduled</span>
          <h3>No lab periods in the next 7 days</h3>
          <p>${a.hasTimetable
            ? "The saved lab hours have no upcoming periods in the next 7 days. Go back and check the days and times."
            : "No lab hours are saved yet. Go back and add them — until then the lab stays locked."}
          ${a.nextBeyond ? `The next lab period is <b>${escapeHtml(a.nextBeyond.when)}</b> — <span class="countdown">in ${fmtIn(a.nextBeyond.inMinutes)}</span>.` : ""}</p>
        </div>`;
    }

    // "Next up" after the running period, so a period in progress never hides
    // the one that follows it.
    const nextUp =
      a.running && a.next
        ? `<div class="result-card next-up">
             <div class="rc-top"><b>Next up · ${escapeHtml(sectionsText(a.next))}</b><span class="rc-when">${escapeHtml(a.next.when)}</span></div>
             <div class="next-up-card-note">When it starts, ${a.next.shared ? `all ${a.next.sections.length} sections open together and` : ""} you take attendance again for this class.</div>
           </div>`
        : "";

    const sharedCards = (a.shared || []).length
      ? `
        <div class="section-label"><span>Shared lab windows</span><span>${a.shared.length}</span></div>
        ${a.shared
          .map(
            (s) => `
          <div class="result-card shared">
            <div class="rc-top"><b>${s.sections.length} sections at once</b><span class="rc-when">${escapeHtml(s.when)}</span></div>
            <div class="rc-sub">${s.sections.map((x) => escapeHtml(x.label)).join(" · ")}<br>
            Attendance allocates seats once for the room, not once per section.</div>
          </div>`
          )
          .join("")}`
      : "";

    // upcoming[0] is always shown elsewhere: as the hero when nothing runs,
    // as the "Next up" card when something does. The agenda starts after it,
    // so a period never appears twice on the screen.
    const agendaItems = (a.upcoming || []).slice(1);
    let agenda = "";
    if (agendaItems.length) {
      const groups = [];
      for (const s of agendaItems) {
        const stamp = dayStamp(s.at);
        let g = groups.find((x) => x.stamp === stamp);
        if (!g) groups.push((g = { stamp, items: [] }));
        g.items.push(s);
      }
      agenda = `
        <div class="section-label"><span>Next 7 days</span><span>${agendaItems.length} period(s)</span></div>
        <div class="agenda">
          ${groups
            .map(
              (g) => `
            <div class="agenda-day">${escapeHtml(g.stamp)}</div>
            ${g.items
              .map(
                (s) => `
              <div class="agenda-item">
                <span class="ai-time">${escapeHtml(s.start)}–${escapeHtml(s.end)}</span>
                <span class="ai-body"><b>${escapeHtml(sectionsText(s))}</b>
                <span>${s.shared ? `${s.sections.length} sections share the lab` : "single section"}</span></span>
              </div>`
              )
              .join("")}`
            )
            .join("")}
        </div>`;
    }

    const issues = (a.issues || []).length
      ? `
        <div class="section-label"><span>Checks</span><span>${a.issues.length}</span></div>
        <div class="issue-list">
          ${a.issues
            .map(
              (i) => `<div class="issue ${i.level}"><span class="ic">${i.level === "warn" ? "!" : "i"}</span><span>${escapeHtml(i.text)}</span></div>`
            )
            .join("")}
        </div>`
      : "";

    box.innerHTML = `
      ${hero}
      ${nextUp}
      <p class="mini-note">${a.slotCount} period(s) saved · ${escapeHtml(a.departmentLabel || "department not set")} ·
      ${a.pictures ? `${a.pictures} timetable picture(s)` : "no picture uploaded"} · analysed ${new Date(a.generatedAt).toLocaleTimeString()}
      · updates every 30s</p>
      ${sharedCards}
      ${agenda}
      ${issues}`;
    renderChrome();
  }

  function updateLiveMode(a) {
    const el = $("wz-live-mode");
    const noPeriod = !a.running && !a.override;
    $("wz-allocate").disabled = noPeriod;
    $("wz-present").disabled = noPeriod;
    $("wz-names").disabled = noPeriod;

    if (a.running) {
      el.textContent = `In period until ${a.running.end}${a.override ? " · override on" : ""}`;
      el.className = "wz-mode live";
    } else if (a.override) {
      el.textContent = `Override until ${new Date(a.override.until).toLocaleTimeString()}`;
      el.className = "wz-mode override";
    } else {
      el.textContent = "No period running — attendance opens when one starts";
      el.className = "wz-mode";
    }
  }

  function maybeStartAutoRefresh() {
    stopAutoRefresh();
    S.timer = setInterval(() => {
      if (document.hidden) return;
      if (!drawer.classList.contains("open") || S.step !== 4 || S.processing || S.busy) return;
      runAnalysis({ animate: false });
    }, REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (S.timer) clearInterval(S.timer);
    S.timer = null;
  }

  // ---------------- in-period actions ----------------

  $("wz-mode-count").onclick = () => setAttendMode("count");
  $("wz-mode-names").onclick = () => setAttendMode("names");
  $("wz-present").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("wz-allocate").click();
  });

  function setAttendMode(mode) {
    S.attendMode = mode;
    const count = mode === "count";
    $("wz-mode-count").classList.toggle("active", count);
    $("wz-mode-names").classList.toggle("active", !count);
    $("wz-mode-count").setAttribute("aria-selected", String(count));
    $("wz-mode-names").setAttribute("aria-selected", String(!count));
    $("wz-count-box").classList.toggle("hidden", !count);
    $("wz-names-box").classList.toggle("hidden", count);
    setMsg($("wz-live-msg"), "");
  }

  $("wz-allocate").onclick = async () => {
    let body;
    if (S.attendMode === "names") {
      const names = $("wz-names")
        .value.split(/[\n,]/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!names.length) return setMsg($("wz-live-msg"), "Paste at least one roll number, one per line.", "err");
      body = { names };
    } else {
      const count = Number($("wz-present").value);
      if (!(count >= 1)) return setMsg($("wz-live-msg"), "Enter how many students are present.", "err");
      body = { count };
    }

    $("wz-allocate").disabled = true;
    const r = await api("/api/schedule/present", body);
    $("wz-allocate").disabled = false;

    if (!r.ok) {
      return setMsg($("wz-live-msg"), [r.data.error, r.data.hint].filter(Boolean).join(" "), "err");
    }
    const seats = (r.data.seats || []).map((seat) => `${seat.name} → ${seat.holder}`).join(", ");
    setMsg($("wz-live-msg"), [r.data.note, seats].filter(Boolean).join(" "), r.data.shortfall ? "err" : "ok");
    $("wz-present").value = "";
    $("wz-names").value = "";
    if (typeof refresh === "function") refresh();
    runAnalysis({ animate: false });
  };

  $("wz-override").onclick = async () => {
    const r = await api("/api/schedule/override", { minutes: 30, reason: "open lab outside lab hours" });
    if (!r.ok) return setMsg($("wz-live-msg"), r.data.error || "Could not start the override.", "err");
    const until = r.data.override?.until;
    setMsg($("wz-live-msg"), until
      ? `Override active until ${new Date(until).toLocaleTimeString()}. The timetable resumes by itself when it ends.`
      : "Override active for 30 minutes.", "ok");
    if (typeof refresh === "function") refresh();
    refreshBanner();
    runAnalysis({ animate: false });
  };

  $("wz-override-end").onclick = async () => {
    const r = await api("/api/schedule/override", undefined, "DELETE");
    if (!r.ok) return setMsg($("wz-live-msg"), r.data.error || "Could not end the override.", "err");
    // Ending an override outside a period relocks the room; inside a period the
    // session simply continues, so do not claim seats were locked.
    setMsg(
      $("wz-live-msg"),
      r.data.relocked > 0
        ? `Override ended. ${r.data.relocked} seat(s) locked again.`
        : "Override ended. The timetable is in charge again.",
      "ok"
    );
    if (typeof refresh === "function") refresh();
    refreshBanner();
    runAnalysis({ animate: false });
  };

  // ---------------- boot ----------------

  // Called by app.js once the admin password is accepted.
  window.onAdminLogin = () => {
    S.loggedOut = false;
    S.started = false;
    refreshBanner();
    if (drawer.classList.contains("open")) loadSetup();
  };

  go(1);
  refreshBanner();
  setInterval(refreshBanner, REFRESH_MS);
})();
