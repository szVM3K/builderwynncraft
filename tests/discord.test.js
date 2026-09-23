// Poprawki z feedbacku z Discorda (0.35.0): domyślne rolle 100%, poison poza celem, Mana/Life Steal tylko z trafień M,
// dopuszczalny dren i minimum życia, cel "Whole cycle", presety drzewek z nazwami graczy.
import { describe, it, expect } from "vitest";
import { E, makeScenario } from "./harness/scenarios.js";
import { checkBuild, makeEvaluator } from "./harness/checks.js";

const errorsOf = async (scenario, build) => (await checkBuild(scenario, build, { pairs: false })).findings.filter((f) => f.severity === "error").map((f) => `${f.code}: ${f.message}`);

describe("Discord feedback fixes", () => {
  it("items count at their max roll by default; Realistic rolls = 50%", () => {
    const item = E.ITEM_DB.find((entry) => entry.name === "Intensity") || E.ITEM_DB.find((entry) => !entry.fixed && Object.keys(entry.baseIds).length > 2);
    const rolled = E.rolledItems(E.ITEM_DB, 50).find((entry) => entry.name === item.name);
    const key = Object.keys(item.ids).find((id) => item.ids[id] > 0 && rolled.ids[id] !== item.ids[id]);
    if (item.fixed) expect(rolled.ids).toEqual(item.ids);
    else expect(rolled.ids[key]).toBeLessThan(item.ids[key]);
  });

  it("Mana Steal only from M hits, per hit = steal / 3 / attacks per second", () => {
    const hps = E.HITS_PER_SECOND.SLOW;
    const noMelee = E.cycleTiming([1, 3, 1], 3, hps);
    expect(E.stealPerSecond(30, noMelee, hps)).toBe(0);
    const withMelee = E.cycleTiming([1, 0, 0], 3, hps);
    expect(withMelee.seconds).toBeCloseTo(1 + 2 * Math.max(1 / 3, 1 / hps), 9);
    expect(E.stealPerSecond(30, withMelee, hps)).toBeCloseTo(((2 / withMelee.seconds) * 10) / hps, 9);
    expect(E.manaOk({ cycleOk: true, manaNet: -1.5 }, { ids: [1], drain: 2 })).toBe(true);
    expect(E.manaOk({ cycleOk: true, manaNet: -2.5 }, { ids: [1], drain: 2 })).toBe(false);
  });

  it("poison counts in the goal only when asked", () => {
    const sc = makeScenario({ playerClass: "Assassin", archetype: "Shadestepper", level: 90, ehpPct: 0 });
    const ctx = E.damageGoalContext(sc.params.playerClass, sc.params.level, sc.params.treeSettings);
    const weapon = E.ITEM_DB.find((item) => item.type === "dagger" && item.level <= 90 && item.slots > 0);
    const poisonItem = E.ITEM_DB.find((item) => item.type === "helmet" && (item.stats.poison || 0) > 2000 && item.level <= 90);
    const items = [poisonItem, weapon];
    const sp = E.computeSkillPoints(items, true);
    const off = E.evaluateGoal(ctx, items, weapon, sp.totals, sc.params.goal, { ids: [], cps: 3 });
    const on = E.evaluateGoal(ctx, items, weapon, sp.totals, sc.params.goal, { ids: [], cps: 3, poison: true });
    expect(off.poisonDps).toBeGreaterThan(0);
    expect(on.damage).toBeGreaterThan(off.damage);
  });

  it("whole-cycle goal, allowed drain and life recovery pass the QA checks", async () => {
    const sc = makeScenario({ playerClass: "Warrior", archetype: "Fallen", level: 70, ehpPct: 20, cycle: [4, 3, 1, 0, 0], goal: "cycle", cps: 4, drain: 1, lr: 15 });
    const build = await E.generateDamageBuild({ ...sc.params, effort: "quick" });
    expect(build.goal).toBe(E.DAMAGE_GOAL_CYCLE);
    expect(build.passed).toBe(true);
    expect(build.metrics.manaNet).toBeGreaterThanOrEqual(-1 - 1e-9);
    expect(build.metrics.sustain).toBeGreaterThanOrEqual(15 - 1e-9);
    expect(await errorsOf(sc, build)).toEqual([]);
    const { evaluate } = makeEvaluator(sc.params);
    const picks = Object.fromEntries(build.slots.filter((slot) => slot.item).map((slot) => [slot.id, slot.item]));
    expect(evaluate(picks).feasible).toBe(true);
  }, 300000);

  it("guide trees are presets with the players' names", () => {
    const presets = E.allTreePresets();
    expect(presets.length).toBeGreaterThan(10);
    expect(presets.some((preset) => E.presetMatches(preset, "bolt hybrid"))).toBe(true);
    expect(presets.some((preset) => E.presetMatches(preset, "generalist") && preset.archetype === "Fallen")).toBe(true);
    presets.forEach((preset) => expect(preset.ids.length).toBeGreaterThan(0));
  });
});
