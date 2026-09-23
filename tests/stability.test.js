// "Generate" twice with the same settings must give the same build: the second click starts from the first result
// (session history), so the generator has to be converged already. Also never worse when older builds are around.
import { describe, it, expect } from "vitest";
import { E, makeScenario } from "./harness/scenarios.js";

const seedOf = (build) => ({ picks: Object.fromEntries(build.slots.filter((s) => s.item && s.id !== "weapon").map((s) => [s.id, s.item])), weapon: build.slots.find((s) => s.id === "weapon").item });
const names = (build) => build.slots.map((s) => (s.item ? `${s.item.name}${s.item.powders ? `+${s.item.powders.element}` : ""}` : "-")).join(" | ");
const CASES = [
  ["Mage", "Riftwalker", 80, 25],
  ["Warrior", "Paladin", 95, 30],
  ["Archer", "Trapper", 45, 30, [3, 3, 4, 2]],
  ["Shaman", "Acolyte", 95, 0],
  ["Assassin", "Trickster", 70, 20, "first"],
];

describe("same settings, same build", () => {
  for (const [playerClass, archetype, level, ehpPct, cycle] of CASES) {
    it(`${playerClass}/${archetype} L${level} EHP ${ehpPct}%${cycle ? " + cycle" : ""}`, async () => {
      const scenario = makeScenario({ playerClass, archetype, level, ehpPct, cycle });
      const first = await E.generateDamageBuild({ ...scenario.params, onProgress: () => {} });
      const again = await E.generateDamageBuild({ ...scenario.params, seeds: [seedOf(first)], onProgress: () => {} });
      expect(names(again)).toBe(names(first));
      expect(again.metrics.damage).toBeCloseTo(first.metrics.damage, 6);
      // a quick build for another EHP threshold in the history must not make it worse
      const other = makeScenario({ playerClass, archetype, level, ehpPct: Math.max(0, ehpPct - 20), cycle });
      const quick = await E.generateDamageBuild({ ...other.params, effort: "quick", onProgress: () => {} });
      const third = await E.generateDamageBuild({ ...scenario.params, seeds: [seedOf(quick), seedOf(first)], onProgress: () => {} });
      if (first.passed) expect(third.passed).toBe(true);
      if (first.passed) expect(third.metrics.damage).toBeGreaterThanOrEqual(first.metrics.damage * (1 - 1e-9));
    });
  }
});
