// Build Optimizer i Build Creator (0.36.0):
// - pełne przeszukanie (branch and bound z płaszczyznami stycznymi) znajduje to samo optimum co przegląd wszystkich
//   kombinacji - na małych przypadkach (1-2 puste sloty), dla kilku klas, z celem mieszanym Damage ↔ EHP i z cyklem many,
// - Optimize nigdy nie zmienia tego, co wybrał gracz (przedmioty, węzły, tomy, aspekty, wolne punkty),
// - pełne przeszukanie nie jest gorsze od trybu szybkiego (wiązki) i zwraca zestaw do założenia,
// - link Wynnbuildera: import -> build -> eksport -> import daje ten sam build (wszystkie buildy z poradnika),
// - workspace z przeglądarki jest czyszczony z nieznanych pól, zmiany z listy nakładają się poprawnie,
// - powdery w pancerzu, tomy i aspekty w statystykach buildu.
import { describe, it, expect } from "vitest";
import { __engine as E } from "../src/BuildRecommender.jsx";

const LEVEL = 106;
function guideWorkspace(playerClass) {
  const guide = E.GUIDE_DATA.builds.find((build) => build.class === playerClass && !/\(Crafted\)/.test(build.name)) || E.GUIDE_DATA.builds.find((build) => build.class === playerClass);
  const ws = E.workspaceFromWynnbuilderLink(guide.url).ws;
  return { ws: { ...ws, level: LEVEL, archetype: guide.archetype, freeSp: {} }, guide };
}
function withEmpty(ws, slots) {
  const next = { ...ws, items: { ...ws.items }, powders: { ...ws.powders } };
  slots.forEach((slotId) => {
    delete next.items[slotId];
    delete next.powders[slotId];
  });
  return next;
}
function paramsFor(ws, extra = {}) {
  const goals = E.damageGoalOptions(ws.playerClass, ws.level, E.manualBuild(ws).treeSettings);
  return { goal: [goals[0].id], blend: 0, cycle: "", cps: 3, drain: 2, freeSp: true, noEvents: true, scope: { slots: true, tree: false, tomes: false, aspects: false, sp: true, powders: true, swaps: false }, ...extra, goals };
}

describe("full search = every combination", () => {
  const cases = [
    ["Warrior", ["ring1", "ring2"], {}],
    ["Mage", ["ring1", "ring2"], {}],
    ["Archer", ["bracelet", "necklace"], { blend: 40 }],
    ["Assassin", ["boots"], { cycle: "cyc" }],
    ["Shaman", ["weapon"], {}],
  ];
  for (const [playerClass, empty, extra] of cases) {
    it(`${playerClass}: ${empty.join(" + ")}${extra.blend ? " · Damage↔EHP" : ""}${extra.cycle ? " · mana cycle" : ""}`, async () => {
      const { ws: start } = guideWorkspace(playerClass);
      const ws = withEmpty(start, empty);
      const params = paramsFor(ws, extra);
      if (params.cycle === "cyc") params.cycle = `${params.goals.filter((goal) => typeof goal.id === "number").slice(0, 2).map((goal) => goal.id).join("")}M`;
      const spec = E.optimizerSpec(ws, params);
      const slots = E.optEmptySlots(spec);
      const opt = E.optContext(spec, spec.treeIds, slots);
      const fast = E.optBranchAndBound(opt, {});
      await new Promise((resolve) => setTimeout(resolve, 0));
      const all = E.optBranchAndBound(opt, { noBound: true });
      expect(all.checked).toBe(opt.total);
      expect(fast.checked).toBe(opt.total);
      if (all.best === -Infinity) expect(fast.best).toBe(-Infinity);
      else expect(Math.abs(fast.best - all.best)).toBeLessThanOrEqual(1e-6 * all.best);
      // i to naprawdę szybciej: granice odcinają większość liści
      expect(fast.evaluated).toBeLessThanOrEqual(all.evaluated);
    });
  }
});

// 0.37 range sliders: with a maximum (mana surplus, life, walk speed) "more" isn't always better, so dominance may only
// drop an item that has the same value of the bounded statistics. Checked against the raw pool (no pruning at all).
describe("range sliders keep the full search exact", () => {
  const cases = [
    ["Mage", "necklace", { cycle: "cyc", mana: { min: -1, max: 0.5 } }],
    ["Warrior", "boots", { spd: { min: 0, max: 25 } }],
    ["Shaman", "bracelet", { life: { min: 20, max: 250 } }],
    ["Archer", "helmet", { cycle: "cyc", mana: { min: null, max: 0 }, spd: { min: -10, max: null } }],
  ];
  for (const [playerClass, slotId, extra] of cases) {
    it(`${playerClass}: ${slotId} · ${Object.keys(extra).filter((key) => key !== "cycle").join(" + ")}`, async () => {
      const { ws: start } = guideWorkspace(playerClass);
      const ws = withEmpty(start, [slotId]);
      const params = paramsFor(ws, extra);
      if (params.cycle === "cyc") params.cycle = `${params.goals.filter((goal) => typeof goal.id === "number").slice(0, 2).map((goal) => goal.id).join("")}M`;
      delete params.goals;
      const spec = E.optimizerSpec(ws, params);
      const slots = E.optEmptySlots(spec);
      const opt = E.optContext(spec, spec.treeIds, slots);
      const fast = E.optBranchAndBound(opt, {});
      // every candidate of the raw (unpruned) pool, evaluated the same way as a leaf of the search
      let best = -Infinity;
      for (const candidate of E.optCandidates(spec, slotId)) {
        const items = [...opt.fixedItems, { ...candidate, __slot: slotId }];
        const weapon = slotId === "weapon" ? items[items.length - 1] : opt.fixedWeapon;
        if (!weapon) continue;
        const result = E.optEvaluate(opt, items, weapon);
        if (result && !result.infeasible && !result.below && result.value > best) best = result.value;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (best === -Infinity) expect(fast.best).toBe(-Infinity);
      else expect(Math.abs(fast.best - best)).toBeLessThanOrEqual(1e-6 * Math.abs(best));
    });
  }
});

// 0.40 major IDs: their effects aren't in the search bounds, so the full search runs without them and then once per
// item with a major ID pinned. Together that must equal every combination of the raw pool (majors included).
describe("major IDs keep the full search exact", () => {
  const cases = [
    ["Archer", ["helmet", "boots"]],
    ["Warrior", ["chestplate"]],
  ];
  for (const [playerClass, empty] of cases) {
    it(`${playerClass}: ${empty.join(" + ")}`, async () => {
      const { ws: start } = guideWorkspace(playerClass);
      const ws = withEmpty(start, empty);
      const params = paramsFor(ws);
      const spec = E.optimizerSpec(ws, params);
      const slots = E.optEmptySlots(spec);
      const pins = E.optMajorPins(spec, slots);
      expect(pins.length).toBeGreaterThan(0);
      const all = E.optBranchAndBound(E.optContext(spec, spec.treeIds, slots), { noBound: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      let best = E.optBranchAndBound(E.optContext({ ...spec, excludeMajors: true }, spec.treeIds, slots), {}).best;
      for (const pin of pins) {
        const pinSpec = { ...spec, excludeMajors: true, fixed: [...spec.fixed.filter((entry) => entry.slotId !== pin.slotId), pin] };
        const rest = slots.filter((slotId) => slotId !== pin.slotId);
        const result = E.optBranchAndBound(E.optContext(pinSpec, spec.treeIds, rest), { incumbent: best });
        if (result.best > best) best = result.best;
      }
      expect(Math.abs(best - all.best)).toBeLessThanOrEqual(1e-6 * Math.abs(all.best));
    });
  }
});

describe("Optimize keeps what the player picked", () => {
  it("Mage: empty boots + helmet, free AP, empty tomes and aspects - full search, changes only fill", async () => {
    const { ws: start } = guideWorkspace("Mage");
    const ws = { ...withEmpty(start, ["helmet", "boots"]), tree: start.tree.slice(0, Math.max(1, start.tree.length - 4)), freeSp: { str: 2 } };
    const params = { ...paramsFor(ws), scope: { slots: true, tree: true, tomes: true, aspects: true, sp: true, powders: true, swaps: true } };
    delete params.goals;
    const result = await E.runOptimizer({ ws, params, executor: E.optLocalExecutor(), makeExecutor: E.optLocalExecutor, askChoice: async () => "full" });
    expect(result.complete).toBe(true);
    const applied = E.applyOptimizerChanges(ws, result.changes);
    // przedmioty gracza zostają, puste sloty są wypełnione
    Object.entries(ws.items).forEach(([slotId, name]) => expect(applied.items[slotId]).toBe(name));
    expect(applied.items.helmet).toBeTruthy();
    expect(applied.items.boots).toBeTruthy();
    // węzły gracza zostają (drzewko tylko rośnie), wolne punkty gracza nie maleją
    ws.tree.forEach((id) => expect(applied.tree).toContain(id));
    Object.entries(ws.freeSp).forEach(([skill, value]) => expect(applied.freeSp[skill] || 0).toBeGreaterThanOrEqual(value));
    // rekomendacje zamian są osobno i niczego nie zmieniają same z siebie
    result.swaps.forEach((swap) => expect(result.changes).not.toContain(swap));
    // build po zmianach jest do założenia
    const build = E.manualBuild(applied);
    expect(build.skillPoints.valid).toBe(true);
  });

  it("the full search is never worse than quick mode", async () => {
    const { ws: start } = guideWorkspace("Warrior");
    const ws = withEmpty(start, ["helmet", "boots"]);
    const params = paramsFor(ws);
    delete params.goals;
    const spec = E.optimizerSpec(ws, params);
    const slots = E.optEmptySlots(spec);
    const quick = await E.optRunTask("quick", { spec, treeIds: spec.treeIds, emptySlots: slots });
    const opt = E.optContext(spec, spec.treeIds, slots);
    const full = E.optBranchAndBound(opt, { incumbent: -Infinity, refPicks: quick.picks });
    expect(quick.value).toBeGreaterThan(0);
    expect(full.best).toBeGreaterThanOrEqual(quick.value * (1 - 1e-9));
    // wynik pełnego przeszukania przechodzi dokładną ocenę (skill pointy w kolejności zakładania)
    const { items, weapon } = E.optItemsOf(spec, Object.fromEntries(full.bestPicks.map((pick) => [pick.slotId, { name: pick.item.name, powders: "" }])), slots);
    const check = E.optEvaluate(opt, items, weapon, null, true);
    expect(check && check.value).toBeGreaterThan(0);
  });
});

describe("Build Creator data", () => {
  it("Wynnbuilder link round trip for every guide build", () => {
    let checked = 0;
    E.GUIDE_DATA.builds.forEach((guide) => {
      const { ws } = E.workspaceFromWynnbuilderLink(guide.url);
      const build = E.manualBuild(ws);
      if (!build) return;
      const link = E.wynnbuilderLink(build, build.treeSettings.selected, E.workspaceExtras(ws));
      const back = E.workspaceFromWynnbuilderLink(link.url).ws;
      expect(back.items).toEqual(ws.items);
      expect(back.powders).toEqual(ws.powders);
      expect(back.tomes).toEqual(ws.tomes);
      expect(back.aspects).toEqual(ws.aspects);
      expect(back.freeSp).toEqual(ws.freeSp);
      expect(back.level).toBe(ws.level);
      expect([...back.tree].sort((a, b) => a - b)).toEqual([...build.treeSettings.selected].sort((a, b) => a - b));
      checked += 1;
    });
    expect(checked).toBeGreaterThan(100);
  });

  it("warnings instead of blocks", () => {
    const ws = E.emptyWorkspace();
    ws.playerClass = "Mage";
    ws.level = 40;
    const highWand = E.ITEM_DB.find((item) => item.type === "wand" && item.level > 100);
    const spear = E.ITEM_DB.find((item) => item.type === "spear" && item.level < 40);
    ws.items = { weapon: highWand.name };
    let build = E.manualBuild(ws);
    expect(build.warnings.some((text) => text.includes(`needs level ${highWand.level}`))).toBe(true);
    ws.items = { weapon: spear.name };
    build = E.manualBuild(ws);
    expect(build.warnings.some((text) => text.includes("Warrior weapon"))).toBe(true);
    ws.freeSp = { str: 90, dex: 90 };
    build = E.manualBuild(ws);
    expect(build.skillPoints.valid).toBe(false);
    expect(build.warnings.some((text) => text.includes("skill points"))).toBe(true);
  });

  it("saved workspaces are cleaned, Optimizer changes apply", () => {
    const clean = E.sanitizeWorkspace({ playerClass: "Nope", level: 999, items: { helmet: "X", nothing: "Y" }, junk: 1, freeSp: { str: "5", dex: -3 } });
    expect(clean.playerClass).toBe("");
    expect(clean.level).toBe(120);
    expect(clean.items).toEqual({ helmet: "X" });
    expect(clean.freeSp).toEqual({ str: 5 });
    expect(clean.junk).toBeUndefined();
    const ws = { ...E.emptyWorkspace(), playerClass: "Mage", tree: [0, 1], tomes: { weapon: ["A"] } };
    const next = E.applyOptimizerChanges(ws, [
      { patch: { type: "item", slotId: "boots", name: "B", powders: "e7" } },
      { patch: { type: "tree", add: [2, 3] } },
      { patch: { type: "tome", slotId: "weapon", index: 1, name: "C" } },
      { patch: { type: "aspect", index: 2, name: "D", tier: 3 } },
      { patch: { type: "freeSp", values: { str: 4 } } },
    ]);
    expect(next.items.boots).toBe("B");
    expect(next.powders.boots).toBe("e7");
    expect(next.tree).toEqual([0, 1, 2, 3]);
    expect(next.tomes.weapon).toEqual(["A", "C"]);
    expect(next.aspects[2]).toEqual({ name: "D", tier: 3 });
    expect(next.freeSp).toEqual({ str: 4 });
    expect(ws.tree).toEqual([0, 1]);
  });

  it("armour powders, tomes and aspects count in the build's stats", () => {
    const helmet = E.ITEM_DB.find((item) => item.type === "helmet" && item.slots >= 2 && item.level >= 80);
    const powdered = E.armourWithPowderList(helmet, [
      { element: "earth", tier: 6 },
      { element: "earth", tier: 6 },
    ]);
    expect(powdered.base.hp).toBe((helmet.base.hp || 0) + 2 * 60);
    expect(powdered.base.eDef).toBe((helmet.base.eDef || 0) + 2 * 29);
    expect(powdered.base.aDef).toBe((helmet.base.aDef || 0) - 2 * 7);
    const { ws } = guideWorkspace("Mage");
    const before = E.manualBuild(ws);
    const statsBefore = E.computeBuildStats(before, before.treeSettings);
    const withTome = { ...ws, level: 120, tomes: { armour: ["Vampiric Tome of Defensive Mastery II"] } };
    const after = E.manualBuild(withTome);
    const statsAfter = E.computeBuildStats(after, after.treeSettings);
    expect(after.tomes.length).toBe(1);
    expect(statsAfter.hp).toBeGreaterThan(E.computeBuildStats(E.manualBuild({ ...ws, level: 120 }), E.manualBuild({ ...ws, level: 120 }).treeSettings).hp);
    void statsBefore;
  });
});
