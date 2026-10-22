// ----------------------------------------------------------------
// LabNexus - read the timetable picture
//
// Optional helper: turns the STORED picture into a PROPOSED set of lab
// periods with a vision model. It never saves anything by itself - the
// result goes back to the wizard so the admin reviews and applies it.
// The confirmed grid stays the only thing that drives the lab, exactly
// like the manual grid editor.
//
// Uses the owner's own API key, server-side only (the browser never
// sees it, and it is never written to logs or the audit trail):
//   * OPENAI_API_KEY from the environment, or from a plain .env file in
//     the project root next to the dashboard (KEY=VALUE lines), or in
//     admin/.env
//   * default endpoint: https://freebuff.com/api/v1/paid (OpenAI-compatible)
//   * EXTRACT_API_BASE / EXTRACT_MODEL override both (used by tests)
// ----------------------------------------------------------------

const fs = require("fs");
const state = require("./state");
const schedule = require("./schedule");

const DEFAULT_BASE = "https://freebuff.com/api/v1/paid";
const DEFAULT_MODEL = "gpt-4o-mini";
// Tried in order (after an EXTRACT_MODEL override / the server's model
// list); the first one the endpoint accepts is used.
const MODEL_PREFS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "glm-4.5v", "glm-4v"];
// A free GEMINI_API_KEY (Google AI Studio) works out of the box through
// Google's OpenAI-compatible endpoint. Model reality (verified against a live
// free account): 2.5 models are retired for NEW accounts (":is no longer
// available"), so the list starts with the flash models that answer, and a
// busy/retired model just pushes the extractor to the next candidate.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_MODEL_PREFS = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
const MAX_SLOTS = 80;
const REQUEST_TIMEOUT_MS = 90 * 1000;

const SETUP_URL = "https://freebuff.com/account/api";

// Day words a model may invent for the same day number.
const DAY_ALIASES = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  sun: 7, sunday: 7,
};

function apiConfig() {
  const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  const baseOverride = (process.env.EXTRACT_API_BASE || "").trim();
  // An explicit OPENAI_API_KEY keeps today's behaviour; a GEMINI_API_KEY alone
  // switches to Google's endpoint automatically. An EXTRACT_API_BASE override
  // always wins over the defaults (tests and power users).
  return {
    key: openaiKey || geminiKey,
    gemini: !openaiKey && !!geminiKey,
    base: (baseOverride || (openaiKey ? DEFAULT_BASE : geminiKey ? GEMINI_BASE : DEFAULT_BASE)).replace(/\/+$/, ""),
    modelEnv: process.env.EXTRACT_MODEL || "",
  };
}

function config() {
  return apiConfig();
}

// Same label hygiene the confirmed grid applies (schedule.normaliseSlots):
// strip markup/control characters, collapse whitespace, cap the length.
function sanitizeLabel(text) {
  return String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F\u007F\uFFFD]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .trim();
}

// Pull the first JSON object out of a model reply (fences, prose, *.md
// code blocks are all tolerated) so endpoint differences do not matter.
function parseModelJson(text) {
  const s = String(text ?? "").trim();
  const unfenced = s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const candidates = [unfenced, s];
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch (_) {}
  }
  // last resort: first {...} balanced block in the raw reply
  const start = s.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") { inStr = true; continue; }
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch (_) { break; }
        }
      }
    }
  }
  return null;
}

function dayNumber(name) {
  const key = String(name ?? "").trim().toLowerCase();
  if (DAY_ALIASES[key] !== undefined) return DAY_ALIASES[key];
  const short = key.slice(0, 3);
  return DAY_ALIASES[short] !== undefined ? DAY_ALIASES[short] : null;
}

// Turn the model's `days` map into validated view-shaped slots, skipping
// anything broken and noting what was skipped.
function parseSlots(modelJson, notes) {
  if (!modelJson || typeof modelJson !== "object") {
    notes.push("The reply could not be read as a timetable.");
    return [];
  }
  if (Array.isArray(modelJson.note)) modelJson.notes = modelJson.note;
  if (Array.isArray(modelJson.notes)) notes.push(...modelJson.notes.map(String).filter(Boolean));

  const days = modelJson.days && typeof modelJson.days === "object" ? modelJson.days : null;
  if (!days) {
    // Tolerate a flat array [{day:"Mon",...}, ...] without the days map.
    if (Array.isArray(modelJson.periods) || Array.isArray(modelJson.slots)) {
      return collect(Array.isArray(modelJson.periods) ? modelJson.periods : modelJson.slots, notes);
    }
    notes.push("The reply did not contain any day columns.");
    return [];
  }
  const out = [];
  for (const [dayName, rows] of Object.entries(days)) {
    if (!Array.isArray(rows)) continue;
    const day = dayNumber(dayName);
    if (day === null) {
      notes.push(`Unrecognised day "${dayName}" was skipped.`);
      continue;
    }
    for (const row of rows) out.push({ day, ...(row || {}) });
  }
  return dedupeValidate(out, notes);
}

function collect(rows, notes) {
  const out = [];
  for (const row of rows) {
    const day = row?.day ? dayNumber(row.day) : null;
    if (day === null) continue;
    out.push({ day, ...(row || {}) });
  }
  return dedupeValidate(out, notes);
}

function dedupeValidate(rows, notes) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const start = schedule.parseHM(row?.start);
    const end = schedule.parseHM(row?.end);
    const label = sanitizeLabel(row?.label);
    if (start === null || end === null || end <= start || !label) {
      if (row?.start || row?.label) {
        notes.push(`Skipped a row that could not be read (${row?.day ?? "?"} ${row?.start ?? "?"}–${row?.end ?? "?"}).`);
      }
      continue;
    }
    const key = `${row.day}|${start}|${end}|${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ day: row.day, start, end, label });
    if (out.length >= schedule.MAX_SLOTS || out.length >= MAX_SLOTS) {
      notes.push(`Capped the extraction at ${Math.min(MAX_SLOTS, schedule.MAX_SLOTS)} periods.`);
      break;
    }
  }
  out.sort((a, b) => a.day - b.day || a.start - b.start || a.end - b.end);
  return out.map((s) => ({
    day: s.day,
    start: schedule.fmtHM(s.start),
    end: schedule.fmtHM(s.end),
    label: s.label,
    when: `${schedule.DAY_NAMES[s.day]} ${schedule.fmtHM(s.start)}-${schedule.fmtHM(s.end)}`,
  }));
}

function buildPrompt(departmentLabel, className) {
  return [
    "You read photographs of college timetables and convert them to JSON.",
    departmentLabel ? `This lab serves the ${departmentLabel} department.` : "",
    className ? `This picture is the timetable of the class "${className}".` : "",
    className
      ? `Every label you output must name that class/section, even if the cell text does not: write it as "<course> Lab - <class/section name>" (e.g. "DBMS Lab - ${className}") so periods from different classes never blur together.`
      : "",
    "From the weekly timetable picture, list ONLY periods that are LAB or PRACTICAL periods - theory/class periods do not use this lab and must be skipped.",
    "Reply with JSON exactly in this shape and nothing else:",
    '{"days":{"Mon":[{"start":"09:00","end":"11:00","label":"DBMS Lab - Sec A + OS Lab - Sec B"}]},"notes":["anything unreadable or ambiguous"]}',
    "Rules:",
    '- day keys: Mon Tue Wed Thu Fri Sat Sun (only days the lab is used)',
    "- start/end are 24-hour HH:MM taken from the period times; if the picture only shows period numbers, use the timetable's own period boundaries.",
    '- label is the course(s) and section(s) printed in the cell as plain text (e.g. "DBMS Lab - Sec A"); if a cell names two labs, join them with " + ".',
    "- A lab spanning consecutive periods becomes ONE row covering the whole span.",
    "- notes is [] when everything was readable.",
  ].filter(Boolean).join("\n");
}

async function fetchWithTimeout(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Resolve which model id the endpoint actually has. EXTRACT_MODEL wins;
// otherwise ask /models and prefer helpers, falling back sensibly.
async function resolveModel({ key, base, modelEnv, gemini }) {
  if (modelEnv) return [modelEnv];
  // Google's compat /models needs a paid key probe to be useful and lists ids
  // in `models/...` form, so for Gemini we go straight to the flash list.
  if (gemini) return GEMINI_MODEL_PREFS;
  try {
    const r = await fetchWithTimeout(`${base}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      const ids = (j.data || j.models || []).map((m) => (typeof m === "string" ? m : m.id)).filter(Boolean);
      const prefs = MODEL_PREFS.filter((p) => ids.includes(p));
      if (prefs.length) return [prefs[0], ...ids.filter((id) => !prefs.includes(id))];
      if (ids.length) return ids;
    }
  } catch (_) {
    // endpoint without /models: fall through to preference list
  }
  return MODEL_PREFS;
}

async function callOnce({ key, base }, model, dataUrl, prompt) {
  const r = await fetchWithTimeout(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Read this timetable and reply with the JSON. No commentary." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) {
    const err = new Error((j && (j.error?.message || j.error)) || `Model call failed (${r.status}).`);
    err.status = r.status;
    throw err;
  }
  const text = j.choices?.[0]?.message?.content ?? "";
  return text;
}

// ------------------------- main -------------------------

// `imageId` picks WHICH picture to read: the admin keeps one picture per
// class, and each extraction labels its periods with that class (the picture's
// name travels into the prompt). No id means "the first picture".
async function extractFromImage(imageId) {
  const { key, base, modelEnv, gemini } = apiConfig();

  if (!key) {
    return {
      status: 503,
      setup: true,
      setupUrl: SETUP_URL,
      error:
        "The AI key is not set, so the picture could not be read automatically. " +
        "Either get a free Google AI Studio key at https://aistudio.google.com/apikey and put one line " +
        "GEMINI_API_KEY=your-key-here in the .env file next to the dashboard (or in the admin folder), " +
        "or use your own paid key from " + SETUP_URL + " as OPENAI_API_KEY=your-key-here — then restart the dashboard.",
    };
  }

  const img = schedule.imageFile(imageId);
  if (!img) {
    return {
      status: 400,
      error: imageId
        ? "That picture no longer exists. It may have been removed — refresh the wizard and try again."
        : "No timetable picture uploaded yet. Add it in step 1 (Picture), then run this again.",
    };
  }

  let buffer;
  try {
    buffer = fs.readFileSync(img.path);
  } catch (err) {
    return { status: 500, error: `Could not read the stored picture (${err.message}).` };
  }
  const dataUrl = `data:${img.mime || "image/png"};base64,${buffer.toString("base64")}`;

  const schedule_ = schedule.getSchedule();
  const departmentLabel = schedule_.department && schedule.DEPARTMENTS[schedule_.department]
    ? schedule.DEPARTMENTS[schedule_.department]
    : "";

  const prompt = buildPrompt(departmentLabel, img.meta && img.meta.name);
  const candidates = modelEnv ? [modelEnv] : await resolveModel({ key, base, modelEnv, gemini });

  // Try the candidates in order. A model the endpoint does not know is a fast
  // rejection, so this costs nothing when the first candidate is right.
  let reply = null;
  let lastErr = null;
  for (const model of candidates) {
    try {
      reply = await callOnce({ key, base }, model, dataUrl, prompt);
      break;
    } catch (err) {
      lastErr = err;
      if (err.name === "AbortError") {
        return { status: 504, error: "Reading the picture took too long. Try again (a smaller, well-lit photo also helps)." };
      }
      const status = err.status || 0;
      // Auth / balance / rate problems are not model-specific: stop early.
      if (status === 401 || status === 402 || status === 403 || status === 429) break;
    }
  }

  if (reply === null) {
    return {
      status: 502,
      error: lastErr ? lastErr.message : "The AI call failed.",
      hint: "Check the key in .env, and that the machine running the dashboard has internet access.",
    };
  }

  const notes = [];
  const modelJson = parseModelJson(reply);
  const slots = parseSlots(modelJson, notes);
  if (!slots.length) {
    return {
      status: 422,
      error: "No lab periods could be read from this picture.",
      hint: notes.length ? notes.join(" ") : "Try a clearer photo, or add the periods by hand in step 3.",
    };
  }

  return {
    ok: true,
    slots,
    notes,
    image: img.meta ? { id: img.meta.id, name: img.meta.name } : null,
    model: modelEnv || candidates[0],
  };
}

module.exports = { extractFromImage, config };
