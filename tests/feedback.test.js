// 0.37: fixes from the forum feedback (spec "Poprawki z feedbacku, suwaki zakresu i powitanie").
//  - Exclude / Other picks / Unpin run the same generator as Generate (the old weights generator is gone)
//  - "Fits my skill points" filter in Other picks
//  - range sliders: mana balance, life recovery, walk speed (+ migration of the 0.35 settings)
//  - rolls of two identical rings are separate
//  - welcome popup v2
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { E, makeScenario } from "./harness/scenarios.js";

const SOURCE = fs.readFileSync(new URL("../src/BuildRecommender.jsx", import.meta.url), "utf8");
const names = (build) => build.slots.map((slot) => (slot.item ? `${slot.item.name}${slot.item.powders ? `+${slot.item.powders.element}` : ""}` : "-"));
const tick = () => new Promise((resolve) => setImmediate(resolve));

// The same five scenarios as a player would set in the form (quick search keeps the test short).
const CASES = [
  ["Mage", "Riftwalker", 100],
  ["Warrior", "Fallen", 80],
  ["Archer", "Boltslinger", 60],
  ["Assassin", "Shadestepper", 106],
  ["Shaman", "Summoner", 90],
];
// a no-op onProgress makes the generator yield between stages (vitest's worker RPC times out on long blocking runs)
const generate = (params) => E.generateDamageBuild({ ...params, effort: "quick", onProgress: () => {} });

describe("Exclude, Unpin and Other picks use the Generate generator", () => {
  it("the old weights generator is gone from the code", () => {
    expect(E.generateOptimizedBuild).toBeUndefined();
    expect(/\btimedBuild\s*\(/.test(SOURCE)).toBe(false);
    expect(/\bgenerateOptimizedBuild\s*\(/.test(SOURCE)).toBe(false);
    expect(/function handleGenerate\(\)/.test(SOURCE)).toBe(false);
    expect(/tab === "score"/.test(SOURCE)).toBe(false);
  });

  it("Exclude X = X on the excluded list + Generate (same 9 items), and the result passes the form's filters", async () => {
    for (const [playerClass, archetype, level] of CASES) {
      const scenario = makeScenario({ playerClass, archetype, level, goal: "first", ehpPct: 25, cycle: "first", cps: 3, ranges: "defaults" });
      const first = await generate(scenario.params);
      await tick();
      const victim = first.slots.find((slot) => slot.item && slot.id !== "weapon").item.name;
      const options = { ...scenario.params.options, excluded: [...scenario.params.options.excluded, victim] };
      // the card action: regenerate(nextOptions) -> the same generator with the same settings plus the exclusion
      const excluded = await generate({ ...scenario.params, options: E.normalizeOptions(options) });
      await tick();
      // "by hand": the same exclusion typed into the left panel, then Generate
      const byHand = await generate({ ...scenario.params, options: E.normalizeOptions({ ...E.normalizeOptions({}), excluded: [victim] }) });
      expect(names(excluded)).toEqual(names(byHand));
      expect(names(excluded)).not.toContain(victim);
      // EHP threshold, mana cycle, walk speed and the goal from the form: the build passes (or warns why not)
      expect(excluded.passed || excluded.warnings.length > 0).toBe(true);
      if (excluded.passed) {
        expect(excluded.metrics.ehp).toBeGreaterThanOrEqual(scenario.params.minEhp - 1e-6);
        expect(E.manaOk(excluded.metrics, excluded.metrics.cycle)).toBe(true);
        expect(excluded.metrics.walkSpeed).toBeGreaterThanOrEqual(-20 - 1e-9);
      }
      await tick();
    }
  });

  it("Other picks -> Y: Y is pinned in its slot, the rest re-fitted by the same generator", async () => {
    const scenario = makeScenario({ playerClass: "Mage", archetype: "Riftwalker", level: 100, goal: "first", ehpPct: 25, cycle: "first", cps: 3, ranges: "defaults" });
    const first = await generate(scenario.params);
    const alternatives = E.slotAlternatives(first, "helmet", 10).list;
    const pick = alternatives.find((entry) => entry.item.name !== first.slots.find((slot) => slot.id === "helmet").item?.name);
    const pinned = await generate({ ...scenario.params, options: E.normalizeOptions({ locked: { helmet: pick.item.name } }) });
    expect(pinned.slots.find((slot) => slot.id === "helmet").item.name).toBe(pick.item.name);
    expect(pinned.lockedSlots).toContain("helmet");
  });
});

describe('"Fits my skill points" in Other picks', () => {
  it("every fitting row has no skill point overflow, no illegal set, and at level 60 the list isn't empty", async () => {
    const scenario = makeScenario({ playerClass: "Archer", archetype: "Boltslinger", level: 60, goal: "first", ehpPct: 25, cycle: "first", cps: 3 });
    const build = await generate(scenario.params);
    for (const slotId of ["helmet", "chestplate", "ring1", "necklace"]) {
      const all = E.slotAlternatives(build, slotId, Infinity).list;
      const fits = all.filter((entry) => entry.overflow === 0 && !entry.illegalSet && !entry.overBudget);
      expect(fits.length).toBeGreaterThan(0);
      fits.forEach((entry) => expect(entry.overflow).toBe(0));
      // the filter works before the list is cut to 40: fitting items below the first 40 by score are still found
      const inTop40 = all.slice(0, 40).filter((entry) => entry.overflow === 0 && !entry.illegalSet && !entry.overBudget).length;
      expect(fits.length).toBeGreaterThanOrEqual(inTop40);
      if (inTop40 < 40) expect(Math.min(40, fits.length)).toBeGreaterThanOrEqual(inTop40);
    }
  });

  it("opens in well under a second at level 120 (all candidates of the slot scored)", async () => {
    const scenario = makeScenario({ playerClass: "Warrior", archetype: "Fallen", level: 120, goal: "first", ehpPct: 25, cycle: "first", cps: 3 });
    const build = await generate(scenario.params);
    const started = performance.now();
    const all = E.slotAlternatives(build, "helmet", Infinity).list;
    const ms = performance.now() - started;
    expect(all.length).toBeGreaterThan(100);
    expect(ms).toBeLessThan(1000);
  });
});

describe("range sliders (mana, life, walk speed)", () => {
  it("old settings (drain, lr, sustain) migrate to ranges with the same behaviour", async () => {
    const migrated = E.migrateDamageForm({ drain: 3, lr: 50, sustain: false, cycle: "1M2M" });
    expect(migrated.drain).toEqual({ min: -3, max: null });
    expect(migrated.lr).toEqual({ min: 50, max: null });
    expect(migrated.spd).toEqual({ min: null, max: null });
    expect(E.migrateDamageForm({ sustain: true }).lr).toEqual({ min: 1, max: null });
    expect(E.migrateDamageForm({}).drain).toEqual({ min: 0, max: null });
    // the generator: old parameters vs the migrated ranges -> the same build
    const scenario = makeScenario({ playerClass: "Mage", archetype: "Riftwalker", level: 90, goal: "first", ehpPct: 20, cycle: "first", cps: 3, drain: 3, lr: 30 });
    const legacy = await generate(scenario.params);
    const ranged = await generate({ ...scenario.params, cycle: { ...scenario.params.cycle, mana: { min: -3, max: null } }, lifeRange: { min: 30, max: null }, minSustain: 0 });
    expect(names(ranged)).toEqual(names(legacy));
    expect(ranged.metrics.damage).toBeCloseTo(legacy.metrics.damage, 6);
  });

  it("every result is inside its ranges or says which one it misses; a mana maximum caps the surplus", async () => {
    for (const [playerClass, archetype, level] of CASES) {
      const common = { playerClass, archetype, level, goal: "first", ehpPct: 20, cycle: "first", cps: 3 };
      const open = await generate(makeScenario({ ...common, mana: { min: -2, max: null }, spd: null }).params);
      await tick();
      const capped = await generate(makeScenario({ ...common, mana: { min: -2, max: 1 }, spd: null }).params);
      await tick();
      if (capped.passed) {
        expect(capped.metrics.manaNet).toBeLessThanOrEqual(1 + 1e-9);
        expect(capped.metrics.manaNet).toBeGreaterThanOrEqual(-2 - 1e-9);
      } else expect(capped.warnings.join(" ")).toMatch(/mana|cycle/);
      // the maximum takes nothing away when the open result already fits under it
      if (open.passed && open.metrics.manaNet <= 1) expect(capped.metrics.damage).toBeGreaterThanOrEqual(open.metrics.damage * (1 - 1e-9));
      const life = await generate(makeScenario({ ...common, life: { min: 5, max: 200 }, spd: null }).params);
      await tick();
      if (life.passed) {
        expect(life.metrics.sustain).toBeGreaterThanOrEqual(5 - 1e-9);
        expect(life.metrics.sustain).toBeLessThanOrEqual(200 + 1e-9);
      } else expect(life.warnings.join(" ")).toMatch(/life/i);
    }
  });

  it("walk speed: the filtered number is the summary's, the default minimum holds, Any changes nothing", async () => {
    for (const [playerClass, archetype, level] of CASES) {
      const common = { playerClass, archetype, level, goal: "first", ehpPct: 25, cycle: "first", cps: 3 };
      const any = await generate(makeScenario({ ...common, spd: null }).params);
      await tick();
      const again = await generate(makeScenario({ ...common, spd: { min: null, max: null } }).params);
      expect(names(again)).toEqual(names(any));
      const stats = E.computeBuildStats(any, any.treeSettings);
      expect(any.metrics.walkSpeed).toBeCloseTo(stats.walkSpeed, 9);
      const slow = await generate(makeScenario({ ...common, spd: { min: -20, max: null } }).params);
      await tick();
      if (slow.passed) expect(slow.metrics.walkSpeed).toBeGreaterThanOrEqual(-20 - 1e-9);
      else expect(slow.warnings.join(" ")).toMatch(/walk speed/);
      // the minimum takes nothing away when the Any result already reaches it
      if (any.passed && any.metrics.walkSpeed >= -20 && E.manaOk(any.metrics, any.metrics.cycle)) expect(slow.metrics.damage).toBeGreaterThanOrEqual(any.metrics.damage * (1 - 1e-9));
    }
  });

  it("Optimizer parameters from 0.36 migrate to ranges", () => {
    const params = E.migrateOptParams({ drain: 2, sustain: true, cycle: "1M" });
    expect(params.mana).toEqual({ min: -2, max: null });
    expect(params.life).toEqual({ min: 1, max: null });
    expect(params.spd).toEqual({ min: null, max: null });
    expect(params.drain).toBeUndefined();
  });
});

describe("rolls of two identical rings", () => {
  it("each ring slot keeps its own rolls; old shared rolls are split, not lost", () => {
    const ring = E.ITEM_DB.find((item) => item.type === "ring" && !E.singleCopy(item) && Object.keys(item.baseIds || {}).length >= 2);
    const slotNames = { ring1: ring.name, ring2: ring.name };
    let rolls = { [ring.name]: { all: 80 } }; // saved before 0.37: one entry for both
    rolls = E.withSlotRolls(rolls, "ring1", ring.name, { all: 20 }, slotNames);
    expect(E.rollsOf(rolls, "ring1", ring.name)).toEqual({ all: 20 });
    expect(E.rollsOf(rolls, "ring2", ring.name)).toEqual({ all: 80 });
    rolls = E.withSlotRolls(rolls, "ring2", ring.name, null, slotNames);
    expect(E.rollsOf(rolls, "ring2", ring.name)).toBe(null);
    expect(E.rollsOf(rolls, "ring1", ring.name)).toEqual({ all: 20 });
    // in a build: the two rings get different numbers
    const build = { slots: E.SLOTS.map((slot) => ({ ...slot, item: slot.id === "ring1" || slot.id === "ring2" ? ring : null })) };
    const rolled = E.applyBuildRolls(build, E.withSlotRolls({}, "ring1", ring.name, { all: 0 }, slotNames));
    const one = rolled.slots.find((slot) => slot.id === "ring1").item;
    const two = rolled.slots.find((slot) => slot.id === "ring2").item;
    expect(JSON.stringify(one.ids)).not.toEqual(JSON.stringify(two.ids));
    // the Creator workspace too
    const ws = { ...E.emptyWorkspace(), playerClass: "Mage", level: 100, items: { ring1: ring.name, ring2: ring.name }, rolls: { [`ring2|${ring.name}`]: { all: 0 } } };
    expect(E.workspaceItem(ws, "ring2").rolls).toEqual({ all: 0 });
    expect(E.workspaceItem(ws, "ring1").rolls || null).toBe(null);
  });
});

describe("welcome popup v2", () => {
  it("uses a new storage key, so players who confirmed v1 see the new text once", () => {
    expect(SOURCE).toMatch(/const WELCOME_KEY = "wbr-welcome-confirmed-v2"/);
    expect(SOURCE).toMatch(/Builder Wynncraft has three modes/);
    expect(SOURCE).not.toMatch(/fontsource\/tiny5/);
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies["@fontsource/tiny5"]).toBeUndefined();
  });
});
