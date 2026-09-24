// The site's small API (Cloudflare Worker + D1): Build Library and community ability trees (player submissions,
// published after review), anonymous usage counters and the number of people on the site.
//
// Public:   POST /api/ping, POST /api/events, POST /api/submit, GET /api/library, GET /api/trees, GET /api/health
// Reviewer: POST /api/admin/login, GET /api/admin/overview, GET /api/admin/submissions, POST /api/admin/review,
//           GET /api/admin/export
//
// Secrets (wrangler secret put ...): ADMIN_USER, ADMIN_PASSWORD_HASH ("pbkdf2-sha256$<iterations>$<salt>$<hash>",
// base64; made by scripts/hash-password.mjs - the password itself is never stored anywhere), SESSION_SECRET.
// Optional variable ALLOWED_ORIGINS: comma-separated origins allowed to call the API (empty = any).

const CLASSES = {
  Archer: ["Boltslinger", "Sharpshooter", "Trapper"],
  Warrior: ["Fallen", "Battle Monk", "Paladin"],
  Mage: ["Riftwalker", "Light Bender", "Arcanist"],
  Assassin: ["Shadestepper", "Trickster", "Acrobat"],
  Shaman: ["Summoner", "Ritualist", "Acolyte"],
};
const EVENTS = new Set(["generated", "recommended", "optimized", "created", "wb_export", "wb_import", "shared", "library_view"]);
const MODES = new Set(["recommender", "optimizer", "creator", "library", "solver"]);
const DAY = 86400;
const ACTIVE_WINDOW = 300; // "on the site now" = a ping in the last 5 minutes (the page pings every 2 minutes)
const SESSION_HOURS = 12;
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW = 15 * 60;
const SUBMISSIONS_PER_DAY = 10; // per visitor
const MAX_PENDING = 2000;
const MAX_BODY = 32 * 1024;

const now = () => Math.floor(Date.now() / 1000);
const dayOf = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);
const encoder = new TextEncoder();

function b64(bytes) {
  let binary = "";
  new Uint8Array(bytes).forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}
function unb64(text) {
  const binary = atob(String(text));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function b64url(bytes) {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(text) {
  const plain = String(text).replace(/-/g, "+").replace(/_/g, "/");
  return unb64(plain + "===".slice((plain.length + 3) % 4));
}
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
// constant-time comparison of two byte arrays / strings
function sameBytes(a, b) {
  const x = typeof a === "string" ? encoder.encode(a) : a;
  const y = typeof b === "string" ? encoder.encode(b) : b;
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
async function checkPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored || "").split("$");
  if (scheme !== "pbkdf2-sha256" || !(Number(iterations) > 0) || !salt || !hash) return false;
  const derived = await pbkdf2(String(password), unb64(salt), Number(iterations));
  return sameBytes(derived, unb64(hash));
}
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}
async function makeToken(env) {
  const exp = now() + SESSION_HOURS * 3600;
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const body = `${exp}.${nonce}`;
  return { token: `${body}.${b64url(await hmac(env.SESSION_SECRET, `admin.${body}`))}`, exp };
}
async function checkToken(env, request) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [exp, nonce, signature] = token.split(".");
  if (!exp || !nonce || !signature || !env.SESSION_SECRET) return false;
  if (!(Number(exp) > now())) return false;
  const expected = await hmac(env.SESSION_SECRET, `admin.${exp}.${nonce}`);
  let given;
  try {
    given = unb64url(signature);
  } catch (error) {
    return false;
  }
  return sameBytes(expected, given);
}

// ---- HTTP helpers ----
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allow = allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
function json(request, env, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...corsHeaders(request, env), ...extra },
  });
}
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY) throw new HttpError(413, "Too large.");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "Too large.");
  try {
    const data = JSON.parse(text || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
    return data;
  } catch (error) {
    throw new HttpError(400, "Bad JSON.");
  }
}
// plain text: no control characters, trimmed, at most max characters
function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
}
function levelBucket(level) {
  const value = Number(level);
  if (!(value >= 1)) return "";
  if (value >= 106) return "106+";
  if (value >= 100) return "100-105";
  const low = Math.floor((value - 1) / 20) * 20 + 1;
  return `${low}-${Math.min(low + 19, 99)}`;
}

// ---- anonymous visitor id: hash of (salt of the day, IP, browser); the salt is deleted after two days ----
async function saltOf(env, day) {
  const row = await env.DB.prepare("SELECT salt FROM salts WHERE day = ?").bind(day).first();
  if (row) return row.salt;
  const salt = b64(crypto.getRandomValues(new Uint8Array(24)));
  await env.DB.prepare("INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)").bind(day, salt).run();
  const again = await env.DB.prepare("SELECT salt FROM salts WHERE day = ?").bind(day).first();
  return again ? again.salt : salt;
}
async function visitorOf(request, env, withAgent = true) {
  const day = dayOf(now());
  const salt = await saltOf(env, day);
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "local";
  const agent = withAgent ? request.headers.get("User-Agent") || "" : "";
  return (await sha256Hex(`${salt}|${ip}|${agent}`)).slice(0, 32);
}
function bump(env, day, event, dims) {
  return [...new Set(["", ...dims.filter(Boolean)])].map((dim) =>
    env.DB.prepare("INSERT INTO counters (day, event, dim, n) VALUES (?, ?, ?, 1) ON CONFLICT (day, event, dim) DO UPDATE SET n = n + 1").bind(day, event, dim)
  );
}

// ---- public endpoints ----
async function ping(request, env) {
  const body = await readJson(request);
  const mode = MODES.has(body.mode) ? body.mode : "";
  const visitor = await visitorOf(request, env);
  const t = now();
  const inserted = await env.DB.prepare("INSERT INTO presence (visitor, first_seen, last_seen, mode) VALUES (?, ?, ?, ?) ON CONFLICT (visitor) DO NOTHING").bind(visitor, t, t, mode).run();
  if (inserted.meta && inserted.meta.changes > 0) await env.DB.batch(bump(env, dayOf(t), "visitor", []));
  else await env.DB.prepare("UPDATE presence SET last_seen = ?, mode = ? WHERE visitor = ?").bind(t, mode, visitor).run();
  return json(request, env, { ok: true });
}
async function events(request, env) {
  const body = await readJson(request);
  const list = Array.isArray(body.events) ? body.events.slice(0, 25) : [];
  const day = dayOf(now());
  const statements = [];
  list.forEach((entry) => {
    if (!entry || !EVENTS.has(entry.type)) return;
    const cls = CLASSES[entry.cls] ? entry.cls : "";
    const arch = cls && CLASSES[cls].includes(entry.arch) ? entry.arch : "";
    const skill = clean(entry.skill, 40);
    const mode = MODES.has(entry.mode) ? entry.mode : "";
    statements.push(...bump(env, day, entry.type, [cls && `class:${cls}`, arch && `arch:${arch}`, levelBucket(entry.lvl) && `lvl:${levelBucket(entry.lvl)}`, skill && `skill:${skill}`, mode && `mode:${mode}`]));
  });
  if (statements.length > 0) await env.DB.batch(statements.slice(0, 150));
  return json(request, env, { ok: true, counted: list.length });
}
const CODE = /^[0-9A-Za-z+-]{4,800}$/;
const SETTINGS = /^[A-Za-z0-9_-]{0,2000}$/;
async function submit(request, env) {
  const body = await readJson(request);
  // a hidden field real visitors leave empty
  if (body.website) return json(request, env, { ok: true });
  const kind = body.kind === "tree" ? "tree" : body.kind === "build" ? "build" : null;
  if (!kind) throw new HttpError(400, "Unknown kind.");
  const name = clean(body.name, 60);
  const author = clean(body.author, 24);
  const description = clean(body.description, 500);
  const playerClass = CLASSES[body.playerClass] ? body.playerClass : null;
  const archetype = playerClass && CLASSES[playerClass].includes(body.archetype) ? body.archetype : "";
  const code = String(body.code || "");
  if (!name) throw new HttpError(400, "Give it a name.");
  if (!playerClass) throw new HttpError(400, "Unknown class.");
  if (!CODE.test(code)) throw new HttpError(400, "The build or tree code is damaged.");
  const settings = SETTINGS.test(String(body.settings || "")) ? String(body.settings || "") : "";
  const level = Math.round(Number(body.level));
  const ap = Math.round(Number(body.ap));
  if (kind === "build" && !(level >= 1 && level <= 120)) throw new HttpError(400, "Level must be 1-120.");
  if (kind === "tree" && !(ap >= 1 && ap <= 50)) throw new HttpError(400, "Ability points must be 1-50.");
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 9).map((item) => clean(item, 60));
  const mainSkill = clean(body.mainSkill, 60);
  const visitor = await visitorOf(request, env);
  const t = now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE submitter = ? AND created_at > ?").bind(visitor, t - DAY).first();
  if (recent && recent.n >= SUBMISSIONS_PER_DAY) throw new HttpError(429, `At most ${SUBMISSIONS_PER_DAY} submissions a day - try again tomorrow.`);
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending'").first();
  if (pending && pending.n >= MAX_PENDING) throw new HttpError(503, "The review queue is full right now - try again later.");
  const same = await env.DB.prepare("SELECT id, status FROM submissions WHERE kind = ? AND code = ? AND status != 'rejected' LIMIT 1").bind(kind, code).first();
  if (same) return json(request, env, { ok: true, id: same.id, duplicate: true, status: same.status });
  const result = await env.DB.prepare(
    "INSERT INTO submissions (kind, status, created_at, name, author, description, player_class, archetype, level, main_skill, ap, code, settings, items, submitter) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(kind, t, name, author, description, playerClass, archetype, kind === "build" ? level : null, mainSkill, kind === "tree" ? ap : null, code, settings, JSON.stringify(items), visitor)
    .run();
  await env.DB.batch(bump(env, dayOf(t), kind === "build" ? "submitted_build" : "submitted_tree", [`class:${playerClass}`, archetype && `arch:${archetype}`]));
  return json(request, env, { ok: true, id: result.meta ? result.meta.last_row_id : null, status: "pending" });
}
function publicRow(row) {
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    description: row.description,
    playerClass: row.player_class,
    archetype: row.archetype,
    level: row.level,
    mainSkill: row.main_skill,
    ap: row.ap,
    code: row.code,
    settings: row.settings,
    items: safeItems(row.items),
    publishedAt: row.reviewed_at,
  };
}
function safeItems(text) {
  try {
    const list = JSON.parse(text || "[]");
    return Array.isArray(list) ? list : [];
  } catch (error) {
    return [];
  }
}
async function published(request, env, kind) {
  const rows = await env.DB.prepare("SELECT * FROM submissions WHERE kind = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1000").bind(kind).all();
  // no browser cache: a build approved a moment ago shows up on the next load
  return json(request, env, { ok: true, list: (rows.results || []).map(publicRow) });
}

// ---- reviewer ----
async function login(request, env) {
  const body = await readJson(request);
  // per address only (changing the browser name doesn't reset the count)
  const key = `login:${await visitorOf(request, env, false)}`;
  const t = now();
  const attempt = await env.DB.prepare("SELECT fails, window_start, locked_until FROM login_attempts WHERE key = ?").bind(key).first();
  if (attempt && attempt.locked_until > t) throw new HttpError(429, `Too many attempts - wait ${Math.ceil((attempt.locked_until - t) / 60)} min.`);
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) throw new HttpError(503, "Not set up yet.");
  const userOk = sameBytes(clean(body.username, 100), env.ADMIN_USER);
  const passwordOk = await checkPassword(String(body.password || "").slice(0, 200), env.ADMIN_PASSWORD_HASH);
  if (!(userOk && passwordOk)) {
    const fresh = !attempt || t - attempt.window_start > LOGIN_WINDOW;
    const fails = fresh ? 1 : attempt.fails + 1;
    const lockedUntil = fails >= LOGIN_MAX_FAILS ? t + LOGIN_WINDOW : 0;
    await env.DB.prepare("INSERT INTO login_attempts (key, fails, window_start, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start, locked_until = excluded.locked_until")
      .bind(key, fails, fresh ? t : attempt.window_start, lockedUntil)
      .run();
    throw new HttpError(401, "Wrong username or password.");
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run();
  return json(request, env, { ok: true, ...(await makeToken(env)) });
}
async function overview(request, env) {
  const t = now();
  const since30 = dayOf(t - 29 * DAY);
  const since7 = dayOf(t - 6 * DAY);
  const today = dayOf(t);
  const [activeNow, activeDay, byMode, totals, series, dims, queue] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM presence WHERE last_seen > ?").bind(t - ACTIVE_WINDOW),
    env.DB.prepare("SELECT COUNT(*) AS n FROM presence WHERE last_seen > ?").bind(t - DAY),
    env.DB.prepare("SELECT mode, COUNT(*) AS n FROM presence WHERE last_seen > ? GROUP BY mode").bind(t - ACTIVE_WINDOW),
    env.DB.prepare(
      "SELECT event, SUM(n) AS total, SUM(CASE WHEN day = ? THEN n ELSE 0 END) AS today, SUM(CASE WHEN day >= ? THEN n ELSE 0 END) AS week, SUM(CASE WHEN day >= ? THEN n ELSE 0 END) AS month FROM counters WHERE dim = '' GROUP BY event"
    ).bind(today, since7, since30),
    env.DB.prepare("SELECT day, event, n FROM counters WHERE dim = '' AND day >= ? ORDER BY day").bind(since30),
    env.DB.prepare("SELECT event, dim, SUM(n) AS n FROM counters WHERE dim != '' AND day >= ? GROUP BY event, dim ORDER BY n DESC LIMIT 600").bind(since30),
    env.DB.prepare("SELECT kind, status, COUNT(*) AS n FROM submissions GROUP BY kind, status"),
  ]);
  return json(request, env, {
    ok: true,
    at: t,
    activeNow: activeNow.results[0].n,
    active24h: activeDay.results[0].n,
    activeByMode: byMode.results,
    totals: totals.results,
    series: series.results,
    breakdown: dims.results,
    queue: queue.results,
  });
}
async function listSubmissions(request, env) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "tree" ? "tree" : "build";
  const status = ["pending", "approved", "rejected"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";
  const rows = await env.DB.prepare(`SELECT * FROM submissions WHERE kind = ? AND status = ? ORDER BY ${status === "pending" ? "created_at ASC" : "reviewed_at DESC"} LIMIT 500`).bind(kind, status).all();
  return json(request, env, {
    ok: true,
    list: (rows.results || []).map((row) => ({ ...publicRow(row), status: row.status, createdAt: row.created_at, reviewedAt: row.reviewed_at, note: row.note, submitter: row.submitter.slice(0, 8) })),
  });
}
async function review(request, env) {
  const body = await readJson(request);
  const id = Math.round(Number(body.id));
  const row = await env.DB.prepare("SELECT id, status FROM submissions WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "No such submission.");
  const t = now();
  const edits = [];
  const values = [];
  if (body.name !== undefined) {
    const name = clean(body.name, 60);
    if (!name) throw new HttpError(400, "The name can't be empty.");
    edits.push("name = ?");
    values.push(name);
  }
  if (body.author !== undefined) {
    edits.push("author = ?");
    values.push(clean(body.author, 24));
  }
  if (body.description !== undefined) {
    edits.push("description = ?");
    values.push(clean(body.description, 500));
  }
  if (body.mainSkill !== undefined) {
    edits.push("main_skill = ?");
    values.push(clean(body.mainSkill, 60));
  }
  if (body.note !== undefined) {
    edits.push("note = ?");
    values.push(clean(body.note, 300));
  }
  const action = body.action;
  if (action === "delete") {
    await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(id).run();
    return json(request, env, { ok: true, deleted: id });
  }
  if (action === "approve" || action === "reject" || action === "unpublish") {
    edits.push("status = ?", "reviewed_at = ?");
    values.push(action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending", t);
  } else if (action !== "update") throw new HttpError(400, "Unknown action.");
  if (edits.length > 0) await env.DB.prepare(`UPDATE submissions SET ${edits.join(", ")} WHERE id = ?`).bind(...values, id).run();
  if (action === "approve" && row.status !== "approved") {
    const kind = await env.DB.prepare("SELECT kind, player_class, archetype FROM submissions WHERE id = ?").bind(id).first();
    await env.DB.batch(bump(env, dayOf(t), kind.kind === "build" ? "published_build" : "published_tree", [`class:${kind.player_class}`, kind.archetype && `arch:${kind.archetype}`]));
  }
  return json(request, env, { ok: true, id, action });
}
async function exportAll(request, env) {
  const rows = await env.DB.prepare("SELECT * FROM submissions ORDER BY id").all();
  const counters = await env.DB.prepare("SELECT * FROM counters ORDER BY day, event, dim").all();
  return json(request, env, { ok: true, exportedAt: now(), submissions: rows.results || [], counters: counters.results || [] });
}

// ---- router ----
async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (method === "GET" && (path === "/api/health" || path === "/")) return json(request, env, { ok: true, service: "wbr-api" });
  if (method === "POST" && path === "/api/ping") return ping(request, env);
  if (method === "POST" && path === "/api/events") return events(request, env);
  if (method === "POST" && path === "/api/submit") return submit(request, env);
  if (method === "GET" && path === "/api/library") return published(request, env, "build");
  if (method === "GET" && path === "/api/trees") return published(request, env, "tree");
  if (method === "POST" && path === "/api/admin/login") return login(request, env);
  if (path.startsWith("/api/admin/")) {
    if (!(await checkToken(env, request))) throw new HttpError(401, "Sign in again.");
    if (method === "GET" && path === "/api/admin/overview") return overview(request, env);
    if (method === "GET" && path === "/api/admin/submissions") return listSubmissions(request, env);
    if (method === "POST" && path === "/api/admin/review") return review(request, env);
    if (method === "GET" && path === "/api/admin/export") return exportAll(request, env);
  }
  throw new HttpError(404, "Not found.");
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      return json(request, env, { ok: false, error: status === 500 ? "Server error." : error.message }, status);
    }
  },
  // once a day: forget old visitor ids and salts, old sign-in attempts
  async scheduled(event, env) {
    const t = now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM presence WHERE last_seen < ?").bind(t - 2 * DAY),
      env.DB.prepare("DELETE FROM salts WHERE day < ?").bind(dayOf(t - 2 * DAY)),
      env.DB.prepare("DELETE FROM login_attempts WHERE window_start < ? AND locked_until < ?").bind(t - DAY, t),
    ]);
  },
};
