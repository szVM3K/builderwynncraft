// Deterministic QA matrix for one class: every archetype × level, several variants of the same constraints.
// Used by tests/matrix/<class>.test.js (one file per class so vitest runs the classes in parallel).
import { describe, it, expect, afterAll } from "vitest";
import { E, makeScenario, scenarioForLog } from "./scenarios.js";
import { generate, checkBuild, checkPortfolio, eligiblePool, summarize } from "./checks.js";
import { appendFindings, writeJson, formatFindings } from "./report.js";

const LEVELS = (process.env.MATRIX_LEVELS || "30,50,70,90,100").split(",").map((value) => Number(value.trim())).filter(Boolean);
const AP_LOAN = Number(process.env.MATRIX_AP_LOAN || 0);
const VARIANTS = (process.env.MATRIX_VARIANTS || "base,second,main,lowEhp,noCycle,pinned").split(",").map((value) => value.trim());

// The item with the heaviest skill point requirements a player of this level could wear in `slotId` - pinning it
// forces an unusual skill point allocation (the "different skill point allocations" axis).
function heavyItem(playerClass, level, slotId) {
  const params = { playerClass, level, options: E.normalizeOptions({}), excludeEvents: true, tradeableOnly: false };
  const pool = eligiblePool(params, slotId).filter((item) => item.level >= level - 20);
  const budget = E.availableSkillPoints(level) * 0.5; // heavy, but a build around it must still be possible
  let best = null;
  pool.forEach((item) => {
    const weight = E.SKILLS.reduce((sum, skill) => sum + Math.max(0, (item.reqs[skill] || 0) - Math.max(0, item.stats[skill] || 0)), 0);
    if (weight > budget) return;
    if (!best || weight > best.weight) best = { item, weight };
  });
  return best ? best.item : null;
}

export function defineClassMatrix(playerClass) {
  const portfolio = [];
  const results = [];
  describe(`${playerClass} generator matrix`, () => {
    E.CLASSES[playerClass].archetypes.forEach((archetype) => {
      LEVELS.forEach((level) => {
        it(`${archetype} L${level}`, async () => {
          const common = { playerClass, archetype, level, apLoan: AP_LOAN };
          const base = makeScenario({ ...common, goal: "first", ehpPct: 25, cycle: "first", cps: 3 });
          if (!base) return; // no weapon / no spells at this level
          const goals = base.meta.goals;
          const second = goals.find((goal) => goal.kind === "spell" && goal.id !== base.params.goal);
          const heavy = heavyItem(playerClass, level, "helmet");
          const variants = {
            base: base,
            second: second ? makeScenario({ ...common, goal: second.id, ehpPct: 25, cycle: "first", cps: 3 }) : null,
            main: makeScenario({ ...common, goal: "main", ehpPct: 25, cycle: "first", cps: 3 }),
            lowEhp: makeScenario({ ...common, goal: "first", ehpPct: 15, cycle: "first", cps: 3 }),
            noCycle: makeScenario({ ...common, goal: "first", ehpPct: 25, cycle: "none" }),
            pinned: heavy ? makeScenario({ ...common, goal: "first", ehpPct: 25, cycle: "first", cps: 3, options: { locked: { helmet: heavy.name } } }) : null,
          };
          const runs = [];
          for (const name of VARIANTS) {
            const scenario = variants[name];
            if (!scenario) continue;
            const { build, ms } = await generate(scenario);
            const { findings } = await checkBuild(scenario, build, { pairs: name === "base" || name === "pinned", elapsedMs: ms });
            runs.push({ name, scenario, build, ms, findings });
            portfolio.push({ scenario, build });
          }
          // cross-check every run against every build found so far for this class (all levels, goals, variants)
          runs.forEach((run) => run.findings.push(...checkPortfolio(run.scenario, run.build, portfolio)));
          const records = runs.flatMap((run) =>
            run.findings.filter((finding) => finding.severity !== "info").map((finding) => ({ at: new Date().toISOString(), variant: run.name, scenario: scenarioForLog(run.scenario), build: run.build.slots.map((slot) => slot.item && slot.item.name), ...finding }))
          );
          appendFindings("matrix-findings.jsonl", records);
          runs.forEach((run) => {
            results.push({ label: run.scenario.label, variant: run.name, ms: Math.round(run.ms), passed: run.build.passed, damage: Math.round(run.build.metrics.damage), ehp: Math.round(run.build.metrics.ehp), counts: summarize(run.findings) });
            const text = formatFindings(run.findings);
            console.log(`${run.build.passed ? "✓" : "·"} ${run.scenario.label} [${run.name}] ${Math.round(run.build.metrics.damage)} dmg, ${(run.ms / 1000).toFixed(1)} s${text ? `\n${text}` : ""}`);
          });
          const errors = runs.flatMap((run) => run.findings.filter((finding) => finding.severity === "error").map((finding) => `[${run.name}] ${finding.code}: ${finding.message}`));
          expect(errors, errors.join("\n")).toEqual([]);
        });
      });
    });
  });
  afterAll(() => {
    writeJson(`matrix-${playerClass}.json`, results);
  });
}
