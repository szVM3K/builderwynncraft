// Endless randomized QA ("soak") run. Each shard (tests/soak/shard-N.soak.js) runs this loop in its own process.
// Every iteration: a random but valid scenario → generate → all checks → portfolio cross-check against every build
// this shard has seen → sometimes a relaxed variant and a determinism re-run. Findings go to
// test-results/soak-findings.jsonl with the iteration seed, so any finding can be replayed with SOAK_REPLAY=<seed>.
import { it, expect } from "vitest";
import { E, rng, makeScenario, scenarioForLog, ALL_ARCHETYPES } from "./scenarios.js";
import { generate, checkBuild, checkPortfolio, eligiblePool, summarize } from "./checks.js";
import { appendFindings, formatFindings } from "./report.js";

const MINUTES = Number(process.env.SOAK_MINUTES || 0); // 0 = run until stopped (Ctrl+C)
const STOP_ON_ERROR = process.env.SOAK_STOP_ON_ERROR === "1";
const REPLAY = process.env.SOAK_REPLAY ? Number(process.env.SOAK_REPLAY) : null;
const [LEVEL_MIN, LEVEL_MAX] = (process.env.SOAK_LEVELS || "30-100").split("-").map(Number);
const BASE_SEED = Number(process.env.SOAK_SEED || Date.now() % 1e9);

function randomScenario(seed) {
  const r = rng(seed);
  const { playerClass, archetype } = r.pick(ALL_ARCHETYPES);
  const level = r.int(LEVEL_MIN, LEVEL_MAX);
  const options = {};
  if (r.chance(0.15)) options.attackSpeeds = [r.pick(["SUPER_SLOW", "VERY_SLOW", "SLOW", "NORMAL", "FAST", "VERY_FAST", "SUPER_FAST"])];
  if (r.chance(0.15)) options.avoidNegativeDefences = true;
  if (r.chance(0.1)) options.excludedTiers = ["Mythic"];
  if (r.chance(0.2)) {
    // pin a random item with skill requirements: forces a different skill point allocation
    const slot = r.pick(E.SLOTS.filter((entry) => entry.id !== "weapon")).id;
    const pool = eligiblePool({ playerClass, level, options: E.normalizeOptions({}), excludeEvents: true, tradeableOnly: false }, slot).filter((item) => E.SKILLS.some((skill) => (item.reqs[skill] || 0) > 0));
    if (pool.length) options.locked = { [slot]: r.pick(pool).name };
  }
  return makeScenario({
    playerClass,
    archetype,
    level,
    apLoan: r.pick([0, 0, 2, 4]),
    goal: r.chance(0.6) ? "first" : "random",
    ehpPct: r.pick([0, 5, 10, 15, 20, 25, 30, 35, 40]),
    cycle: r.pick(["none", "first", "random"]),
    cps: r.pick([1.5, 2, 2.5, 3, 4]),
    steal: r.chance(0.9),
    gain: r.chance(0.9),
    requireSustain: r.chance(0.25),
    excludeEvents: r.chance(0.8),
    tradeableOnly: r.chance(0.2),
    options,
    random: r,
  });
}

function relaxed(scenario, r) {
  const p = scenario.params;
  const choices = [];
  if (p.minEhp > 0) choices.push(["lower EHP", { minEhp: Math.round(p.minEhp * 0.8) }]);
  if (p.cycle.ids.length) choices.push(["no mana cycle", { cycle: { ...p.cycle, ids: [] } }], ["slower cycle", { cycle: { ...p.cycle, cps: Math.max(0.5, p.cycle.cps - 1) } }]);
  if (p.requireSustain) choices.push(["no sustain filter", { requireSustain: false }]);
  if (p.tradeableOnly) choices.push(["untradeable allowed", { tradeableOnly: false }]);
  if (!choices.length) return null;
  const [what, change] = r.pick(choices);
  return { what, scenario: { label: `${scenario.label} → ${what}`, params: { ...p, ...change }, meta: scenario.meta } };
}

export function defineSoakShard(shard, shards) {
  it(`soak shard ${shard}/${shards}`, async () => {
    if (shard > shards || (REPLAY !== null && shard !== 1)) return;
    const deadline = MINUTES > 0 ? Date.now() + MINUTES * 60000 : Infinity;
    const portfolio = [];
    const totals = { iterations: 0, errors: 0, warns: 0 };
    const counts = {};
    for (let i = 0; Date.now() < deadline; i += 1) {
      const seed = REPLAY ?? (BASE_SEED + i * shards + shard) >>> 0;
      const r = rng(seed ^ 0x9e3779b9);
      const scenario = randomScenario(seed);
      if (!scenario) continue;
      const runs = [];
      const { build, ms } = await generate(scenario);
      runs.push({ kind: "main", scenario, build, findings: (await checkBuild(scenario, build, { elapsedMs: ms })).findings });
      if (r.chance(0.35)) {
        const variant = relaxed(scenario, r);
        if (variant) {
          const out = await generate(variant.scenario);
          runs.push({ kind: `relaxed: ${variant.what}`, scenario: variant.scenario, build: out.build, findings: (await checkBuild(variant.scenario, out.build, { pairs: false, elapsedMs: out.ms })).findings });
        }
      }
      if (r.chance(0.05)) {
        const again = await generate(scenario);
        const a = build.slots.map((slot) => (slot.item ? slot.item.name : "-")).join("|");
        const b = again.build.slots.map((slot) => (slot.item ? slot.item.name : "-")).join("|");
        if (a !== b) runs[0].findings.push({ severity: "error", code: "NONDETERMINISTIC", message: `same inputs, different builds:\n      ${a}\n      ${b}`, data: {} });
      }
      runs.forEach((run) => portfolio.push({ scenario: run.scenario, build: run.build }));
      if (portfolio.length > 400) portfolio.splice(0, portfolio.length - 400);
      runs.forEach((run) => run.findings.push(...checkPortfolio(run.scenario, run.build, portfolio)));
      const records = runs.flatMap((run) =>
        run.findings.filter((finding) => finding.severity !== "info").map((finding) => ({ at: new Date().toISOString(), seed, shard, run: run.kind, scenario: scenarioForLog(run.scenario), build: run.build.slots.map((slot) => slot.item && slot.item.name), ...finding }))
      );
      appendFindings("soak-findings.jsonl", records);
      totals.iterations += 1;
      runs.forEach((run) =>
        run.findings.forEach((finding) => {
          if (finding.severity === "error") totals.errors += 1;
          if (finding.severity === "warn") totals.warns += 1;
        })
      );
      Object.entries(summarize(runs.flatMap((run) => run.findings))).forEach(([key, value]) => (counts[key] = (counts[key] || 0) + value));
      const text = runs.map((run) => formatFindings(run.findings)).filter(Boolean).join("\n");
      console.log(`[shard ${shard}] #${totals.iterations} seed ${seed} · ${scenario.label} · ${Math.round(build.metrics.damage)} dmg ${build.passed ? "✓" : "(filters not met)"} · ${(ms / 1000).toFixed(1)} s · total errors ${totals.errors}, warns ${totals.warns}${text ? `\n${text}` : ""}`);
      if (REPLAY !== null) break;
      if (STOP_ON_ERROR && totals.errors > 0) break;
    }
    console.log(`[shard ${shard}] done: ${JSON.stringify(totals)} ${JSON.stringify(counts)}`);
    expect(totals.errors, "see test-results/soak-findings.jsonl").toBe(0);
  });
}
