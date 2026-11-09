// 0.42: zakresy statystyk całego buildu (feedback z Discorda, 3 punkty):
//  1. "Avoid negative defences" = żadna SUMA obrony żywiołu buildu nie jest ujemna (przedmiot z -100 Thunder jest OK,
//     gdy reszta zestawu daje dość Thunder), zamiast wyrzucania każdego przedmiotu z ujemną obroną
//  2. Total Mana jako zakres (Arcanist bez cyklu dostawał build z 78 many)
//  3. Custom stats: dowolny stat z min/max i "optimize" (np. zestaw XP na levelowanie)
import { describe, it, expect } from "vitest";
import { E, makeScenario } from "./harness/scenarios.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const generate = (params) => E.generateDamageBuild({ ...params, effort: "quick", onProgress: () => {} });
const items = (build) => build.slots.filter((slot) => slot.item).map((slot) => slot.item);
const statsOf = (build) => E.computeBuildStats(build).stats;
const value = (build, key) => E.rangeStatValue(statsOf(build), key);
const DEF_KEYS = ["eDefTotal", "tDefTotal", "wDefTotal", "fDefTotal", "aDefTotal"];
const negativeItems = (build) => items(build).filter((item) => E.hasNegativeDefence(item));

describe("Stat range helpers", () => {
  it("Avoid negative defences becomes five 'total defence ≥ 0' ranges", () => {
    const list = E.combineStatRanges([], true);
    expect(list.map((range) => range.key).sort()).toEqual([...DEF_KEYS].sort());
    list.forEach((range) => expect(range.min).toBe(0));
  });
  it("a player's own defence range keeps its maximum, its minimum is never below 0", () => {
    const list = E.combineStatRanges([{ key: "tDefTotal", min: -50, max: 300 }], true);
    const thunder = list.find((range) => range.key === "tDefTotal");
    expect(thunder).toMatchObject({ min: 0, max: 300 });
  });
  it("unknown stats and empty rows are dropped, min > max is swapped", () => {
    const list = E.normalizeStatRanges([{ key: "nope", min: 1 }, { key: "xpb" }, { key: "lb", min: 50, max: 10 }]);
    expect(list).toEqual([{ key: "lb", min: 10, max: 50, optimize: false, weight: 1 }]);
  });
  it("total defence follows the summary formula: base + |base| × %", () => {
    expect(E.rangeStatValue({ tDef: -100, tDefPct: 50, rDefPct: 0 }, "tDefTotal")).toBe(-50);
    expect(E.rangeStatValue({ tDef: 200, tDefPct: 10, rDefPct: 10 }, "tDefTotal")).toBe(240);
  });
  it("Total Mana = 100 + Max Mana + Intelligence bonus (as in the Damage panel)", () => {
    expect(E.rangeStatValue({ maxMana: -22, int: 0 }, "totalMana")).toBe(78);
    expect(E.rangeStatValue({ maxMana: 0, int: 50 }, "totalMana")).toBeGreaterThan(100);
  });
});

describe("Feedback 1: negative defences are judged on the whole build", () => {
  it("with the box checked every total defence is ≥ 0, and items with a negative defence are still allowed", async () => {
    let sawNegativeItem = false;
    for (const [playerClass, archetype, level] of [["Mage", "Riftwalker", 100], ["Warrior", "Fallen", 90], ["Assassin", "Shadestepper", 104], ["Archer", "Boltslinger", 80]]) {
      const scenario = makeScenario({ playerClass, archetype, level, goal: "first", ehpPct: 20, cycle: [], ranges: "none" });
      const options = E.normalizeOptions({ ...scenario.params.options, avoidNegativeDefences: true });
      const build = await generate({ ...scenario.params, options });
      await tick();
      expect(build.passed || build.warnings.length > 0).toBe(true);
      if (build.passed) DEF_KEYS.forEach((key) => expect(value(build, key)).toBeGreaterThanOrEqual(-1e-9));
      if (negativeItems(build).length > 0) sawNegativeItem = true;
    }
    // ten sam powód co w feedbacku: wcześniej żaden z tych buildów nie mógł mieć przedmiotu z ujemną obroną
    expect(sawNegativeItem).toBe(true);
  });
});

describe("Feedback 2: Total Mana range", () => {
  it("a minimum Total Mana is met (or the warning says why)", async () => {
    const scenario = makeScenario({ playerClass: "Mage", archetype: "Arcanist", level: 100, goal: "first", ehpPct: 0, cycle: [], ranges: "none" });
    const free = await generate(scenario.params);
    await tick();
    const target = Math.round(value(free, "totalMana")) + 60;
    const build = await generate({ ...scenario.params, statRanges: [{ key: "totalMana", min: target, max: null }] });
    expect(build.passed || build.warnings.some((text) => text.includes("Total Mana"))).toBe(true);
    if (build.passed) expect(value(build, "totalMana")).toBeGreaterThanOrEqual(target - 1e-9);
    expect(build.metrics.statRanges.some((range) => range.key === "totalMana" && range.min === target)).toBe(true);
  });
});

describe("Feedback 3: Custom stats (min/max and optimize)", () => {
  it("an XP set: optimize XP Bonus gives much more XP than the damage build", async () => {
    const scenario = makeScenario({ playerClass: "Warrior", archetype: "Fallen", level: 70, goal: "first", ehpPct: 0, cycle: [], ranges: "none" });
    const damage = await generate(scenario.params);
    await tick();
    const xp = await generate({ ...scenario.params, statRanges: [{ key: "xpb", min: null, max: null, optimize: true }] });
    expect(xp.passed).toBe(true);
    expect(value(xp, "xpb")).toBeGreaterThan(value(damage, "xpb") + 20);
    // pokazywane obrażenia to prawdziwe obrażenia, nie wartość celu "optimize"
    expect(xp.metrics.damage).toBeGreaterThan(0);
    expect(xp.metrics.customObjective).toBe(true);
  });
  it("a max keeps the stat under the limit, a min above it", async () => {
    const scenario = makeScenario({ playerClass: "Shaman", archetype: "Summoner", level: 90, goal: "first", ehpPct: 0, cycle: [], ranges: "none" });
    const free = await generate(scenario.params);
    await tick();
    const spd = value(free, "spd");
    const capped = await generate({ ...scenario.params, statRanges: [{ key: "spd", min: null, max: Math.min(0, spd - 5) }] });
    await tick();
    if (capped.passed) expect(value(capped, "spd")).toBeLessThanOrEqual(Math.min(0, spd - 5) + 1e-9);
    else expect(capped.warnings.some((text) => text.includes("Walk Speed"))).toBe(true);
    const loot = await generate({ ...scenario.params, statRanges: [{ key: "lb", min: 30, max: null }] });
    if (loot.passed) expect(value(loot, "lb")).toBeGreaterThanOrEqual(30 - 1e-9);
    else expect(loot.warnings.some((text) => text.includes("Loot Bonus"))).toBe(true);
  });
});

// Optimizer (pełne przeszukanie): odrzucanie zdominowanych przedmiotów musi znać zakresy statystyk, inaczej
// mógłby wyrzucić jedyny przedmiot, który spełnia np. "obrona ≥ 0" albo maksimum. Wynik = przegląd całej puli.
describe("Custom stats and negative defences keep the Optimizer's full search exact", () => {
  const LEVEL = 106;
  const guideWorkspace = (playerClass) => {
    const guide = E.GUIDE_DATA.builds.find((build) => build.class === playerClass && !/\(Crafted\)/.test(build.name)) || E.GUIDE_DATA.builds.find((build) => build.class === playerClass);
    const ws = E.workspaceFromWynnbuilderLink(guide.url).ws;
    return { ...ws, level: LEVEL, archetype: guide.archetype, freeSp: {} };
  };
  const cases = [
    ["Warrior", "boots", { negDef: true }],
    ["Mage", "necklace", { negDef: true, stats: [{ key: "totalMana", min: 120, max: null }] }],
    ["Shaman", "helmet", { stats: [{ key: "spd", min: null, max: 10 }, { key: "health", min: 9000, max: null }] }],
    ["Archer", "ring1", { stats: [{ key: "tDefTotal", min: 0, max: 150 }] }],
  ];
  for (const [playerClass, slotId, extra] of cases) {
    it(`${playerClass}: ${slotId} · ${JSON.stringify(extra)}`, async () => {
      const start = guideWorkspace(playerClass);
      const ws = { ...start, items: { ...start.items }, powders: { ...start.powders } };
      delete ws.items[slotId];
      delete ws.powders[slotId];
      const goals = E.damageGoalOptions(ws.playerClass, ws.level, E.manualBuild(ws).treeSettings);
      const params = { goal: [goals[0].id], blend: 0, cycle: "", cps: 3, drain: 2, freeSp: true, noEvents: true, scope: { slots: true, tree: false, tomes: false, aspects: false, sp: true, powders: true, swaps: false }, ...extra };
      const spec = E.optimizerSpec(ws, params);
      expect(spec.statRanges.length).toBeGreaterThan(0);
      const slots = E.optEmptySlots(spec);
      const opt = E.optContext(spec, spec.treeIds, slots);
      const fast = E.optBranchAndBound(opt, {});
      let best = -Infinity;
      for (const candidate of E.optCandidates(spec, slotId)) {
        const items = [...opt.fixedItems, { ...candidate, __slot: slotId }];
        const weapon = slotId === "weapon" ? items[items.length - 1] : opt.fixedWeapon;
        if (!weapon) continue;
        const result = E.optEvaluate(opt, items, weapon);
        if (result && !result.infeasible && !result.below && result.value > best) best = result.value;
      }
      await tick();
      if (best === -Infinity) expect(fast.best).toBe(-Infinity);
      else expect(Math.abs(fast.best - best)).toBeLessThanOrEqual(1e-6 * Math.abs(best));
    });
  }
});

describe("Custom stats survive the share link and saved settings", () => {
  it("share link: encode -> decode keeps the rows", () => {
    const form = { ...E.DEFAULT_DAMAGE_FORM, stats: [{ key: "xpb", min: 20, max: null, optimize: true }, { key: "totalMana", min: 150, max: 300, optimize: false }] };
    const code = E.encodeShareSettings({ form, options: E.normalizeOptions({}), rank: "" });
    const back = E.decodeShareSettings(code);
    expect(back.form.stats).toEqual(form.stats);
  });
  it("old links without Custom stats decode to an empty list", () => {
    const code = E.encodeShareSettings({ form: E.DEFAULT_DAMAGE_FORM, options: E.normalizeOptions({}), rank: "" });
    expect(E.decodeShareSettings(code).form.stats).toEqual([]);
  });
  it("Optimizer settings: unknown stats are dropped, optimize is off", () => {
    const params = E.migrateOptParams({ stats: [{ key: "lb", min: 10, optimize: true }, { key: "made-up", min: 1 }] });
    expect(params.stats).toEqual([{ key: "lb", min: 10, max: null, optimize: false }]);
  });
});
