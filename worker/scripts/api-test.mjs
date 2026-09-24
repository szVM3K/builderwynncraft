// End-to-end test of the API against a running `wrangler dev --local` (local D1). Usage:
//   node scripts/api-test.mjs http://127.0.0.1:8787 <user> <password>   (on an empty local database)
const [base = "http://127.0.0.1:8787", user = "tester", password = "local-test-password-123"] = process.argv.slice(2);
let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed += 1;
};
async function call(method, path, body = null, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", "User-Agent": headers.agent || "api-test", ...(headers.auth ? { Authorization: `Bearer ${headers.auth}` } : {}), ...(headers.origin ? { Origin: headers.origin } : {}), ...(headers.ip ? { "CF-Connecting-IP": headers.ip } : {}) },
    body: body === null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  return { status: response.status, data, headers: response.headers };
}
const code = (n) => `CY0akWCLCJ57IW97Cv020Mb12j6Ez2Q4C--JmMWQrF+nVtT8${n}`;

check((await call("GET", "/api/health")).data.ok, "health");
const cors = await call("OPTIONS", "/api/submit", null, { origin: "https://szvm3k.github.io" });
check(cors.status === 204 && cors.headers.get("access-control-allow-origin") === "https://szvm3k.github.io", "CORS preflight for the site");
check((await call("POST", "/api/ping", { mode: "recommender" })).data.ok, "ping");
check((await call("POST", "/api/ping", { mode: "creator" })).data.ok, "ping again (same visitor)");
check((await call("POST", "/api/ping", { mode: "library" }, { agent: "other-browser" })).data.ok, "ping from a second visitor");
const ev = await call("POST", "/api/events", { events: [{ type: "generated", cls: "Mage", arch: "Riftwalker", lvl: 106, skill: "Meteor", mode: "recommender" }, { type: "wb_export", cls: "Mage" }, { type: "nonsense" }, { type: "optimized", cls: "Hacker" }] });
check(ev.data.ok && ev.data.counted === 4, "events counted (unknown types/classes ignored)");

// submissions: validation
check((await call("POST", "/api/submit", { kind: "build", name: "", playerClass: "Mage", level: 100, code: code(1) })).status === 400, "submit: empty name refused");
check((await call("POST", "/api/submit", { kind: "build", name: "X", playerClass: "Nobody", level: 100, code: code(1) })).status === 400, "submit: unknown class refused");
check((await call("POST", "/api/submit", { kind: "build", name: "X", playerClass: "Mage", level: 100, code: "<script>" })).status === 400, "submit: bad code refused");
check((await call("POST", "/api/submit", { kind: "tree", name: "X", playerClass: "Mage", ap: 60, code: "abc123" })).status === 400, "submit: AP over 50 refused");
check((await call("POST", "/api/submit", "not json")).status === 400, "submit: bad JSON refused");
check((await call("POST", "/api/submit", { kind: "build", name: "x".repeat(40000) })).status === 413, "submit: too large refused");
const bot = await call("POST", "/api/submit", { kind: "build", name: "spam", playerClass: "Mage", level: 100, code: code(9), website: "http://spam" });
check(bot.data.ok && bot.data.id === undefined, "submit: honeypot silently dropped");

const b1 = await call("POST", "/api/submit", { kind: "build", name: "  Meteor <b>glass</b> cannon  ", author: "tuna", description: "line1\nline2\u0000", playerClass: "Mage", archetype: "Riftwalker", level: 106, mainSkill: "Meteor", code: code(1), settings: "eyJ2IjoyfQ", items: ["A", "B"] });
check(b1.data.ok && b1.data.status === "pending" && b1.data.id > 0, `submit build: pending (#${b1.data.id})`);
const dup = await call("POST", "/api/submit", { kind: "build", name: "Again", playerClass: "Mage", level: 106, code: code(1) });
check(dup.data.duplicate === true && dup.data.id === b1.data.id, "submit: the same build again = duplicate");
const t1 = await call("POST", "/api/submit", { kind: "tree", name: "Rift 45 AP", playerClass: "Mage", archetype: "Riftwalker", ap: 45, code: "AbCd+-09xyz" });
check(t1.data.ok && t1.data.status === "pending", "submit tree: pending");
check((await call("GET", "/api/library")).data.list.length === 0, "library empty before review");

// rate limit: 10 per visitor per day (2 already: build + tree)
let limited = null;
for (let i = 2; i <= 12; i += 1) {
  const r = await call("POST", "/api/submit", { kind: "build", name: `B${i}`, playerClass: "Warrior", level: 90, code: code(100 + i) }, { agent: "flooder" });
  if (r.status === 429) {
    limited = i;
    break;
  }
}
check(limited === 12, `rate limit after 10 submissions a day (hit at #${limited})`);

// sign-in
check((await call("GET", "/api/admin/overview")).status === 401, "admin: no token = 401");
check((await call("GET", "/api/admin/overview", null, { auth: "123.abc.def" })).status === 401, "admin: forged token = 401");
const bad = await call("POST", "/api/admin/login", { username: user, password: "wrong" }, { agent: "attacker", ip: "10.0.0.66" });
check(bad.status === 401, "login: wrong password = 401");
for (let i = 0; i < 4; i += 1) await call("POST", "/api/admin/login", { username: user, password: `wrong${i}` }, { agent: `attacker-${i}`, ip: "10.0.0.66" });
const locked = await call("POST", "/api/admin/login", { username: user, password }, { agent: "yet-another-browser", ip: "10.0.0.66" });
check(locked.status === 429, "login: locked for 15 min after 5 wrong tries from one address, whatever the browser (even with the right password)");
const good = await call("POST", "/api/admin/login", { username: user, password });
check(good.data.ok && typeof good.data.token === "string" && good.data.exp > Date.now() / 1000, "login: right password = token");
const auth = good.data.token;
const [exp, nonce, sig] = auth.split(".");
check((await call("GET", "/api/admin/overview", null, { auth: `${Number(exp) + 99999}.${nonce}.${sig}` })).status === 401, "admin: token with a changed expiry = 401");

const ov = await call("GET", "/api/admin/overview", null, { auth });
check(ov.data.ok && ov.data.activeNow >= 2 && ov.data.active24h >= 2, `overview: ${ov.data.activeNow} active now, ${ov.data.active24h} in 24 h`);
const total = (event) => (ov.data.totals.find((row) => row.event === event) || { total: 0 }).total;
check(total("generated") === 1 && total("wb_export") === 1 && total("optimized") === 1 && total("visitor") === 2, `overview totals: generated ${total("generated")}, wb_export ${total("wb_export")}, visitors ${total("visitor")}`);
check(ov.data.breakdown.some((row) => row.event === "generated" && row.dim === "arch:Riftwalker") && !ov.data.breakdown.some((row) => row.dim === "class:Hacker"), "overview: breakdown by archetype, no junk dims");
check(ov.data.queue.some((row) => row.kind === "build" && row.status === "pending" && row.n >= 10), "overview: review queue counts");

const pending = await call("GET", "/api/admin/submissions?kind=build&status=pending", null, { auth });
const mine = pending.data.list.find((row) => row.id === b1.data.id);
check(Boolean(mine) && mine.name === "Meteor <b>glass</b> cannon" && mine.description === "line1\nline2", "pending list: text stored as plain text, control characters removed");
check((await call("POST", "/api/admin/review", { id: b1.data.id, action: "approve", name: "Meteor glass cannon" }, { auth })).data.ok, "approve with a new name");
const lib = await call("GET", "/api/library");
check(lib.data.list.length === 1 && lib.data.list[0].name === "Meteor glass cannon" && lib.data.list[0].items.join() === "A,B" && lib.data.list[0].settings === "eyJ2IjoyfQ", "library: the approved build is public");
check(!("submitter" in lib.data.list[0]), "library: no submitter id in public data");
check((await call("POST", "/api/admin/review", { id: t1.data.id, action: "approve" }, { auth })).data.ok, "approve the tree");
const trees = await call("GET", "/api/trees");
check(trees.data.list.length === 1 && trees.data.list[0].ap === 45, "trees: the approved tree is public");
check((await call("POST", "/api/admin/review", { id: b1.data.id, action: "unpublish" }, { auth })).data.ok && (await call("GET", "/api/library")).data.list.length === 0, "unpublish takes it off the library");
const other = pending.data.list.find((row) => row.id !== b1.data.id);
check((await call("POST", "/api/admin/review", { id: other.id, action: "reject", note: "duplicate" }, { auth })).data.ok, "reject with a note");
check((await call("GET", "/api/admin/submissions?kind=build&status=rejected", null, { auth })).data.list.some((row) => row.id === other.id && row.note === "duplicate"), "rejected list has it with the note");
check((await call("POST", "/api/admin/review", { id: other.id, action: "delete" }, { auth })).data.ok, "delete");
check((await call("POST", "/api/admin/review", { id: 999999, action: "approve" }, { auth })).status === 404, "review: unknown id = 404");
const dump = await call("GET", "/api/admin/export", null, { auth });
check(dump.data.ok && dump.data.submissions.length >= 10 && dump.data.counters.length > 0, "export: all submissions and counters");
console.log(failed === 0 ? "ALL PASSED" : `${failed} FAILED`);
process.exit(failed ? 1 : 0);
