// Web Worker protocol, without a browser: the generator's parallel hook receives "tasks" (a start + optional
// approximate swaps, then converge). A helper thread runs each one as generateDamageBuild({ task }) with a fresh
// context. Results must be identical to computing everything in one thread - otherwise a build would depend on the
// number of threads. Payloads go through structuredClone like postMessage.
import { describe, it, expect } from "vitest";
import { E, makeScenario } from "./harness/scenarios.js";

const names = (b) => b.slots.map((s) => (s.item ? `${s.item.name}${s.item.powders ? `+${s.item.powders.element}` : ""}` : "-")).join(" | ");

describe("worker tasks = one thread", () => {
  for (const [playerClass, archetype, level, ehpPct, cycle] of [
    ["Mage", "Riftwalker", 80, 25],
    ["Archer", "Trapper", 45, 30, [3, 3, 4, 2]],
  ]) {
    it(`${playerClass}/${archetype} L${level}`, async () => {
      const scenario = makeScenario({ playerClass, archetype, level, ehpPct, cycle });
      const local = await E.generateDamageBuild({ ...scenario.params, onProgress: () => {} });
      let tasks = 0;
      const caches = { evalCache: new Map(), exactCache: new Map() };
      const parallel = async (batch) => {
        const out = [];
        for (const task of structuredClone(batch)) {
          tasks += 1;
          out.push(structuredClone((await E.generateDamageBuild({ ...structuredClone(scenario.params), task, caches })).task));
        }
        return out;
      };
      const threaded = await E.generateDamageBuild({ ...scenario.params, parallel, onProgress: () => {} });
      expect(tasks).toBeGreaterThan(0);
      expect(names(threaded)).toBe(names(local));
      expect(threaded.metrics.damage).toBe(local.metrics.damage);
      // the build itself survives postMessage (no functions inside)
      expect(() => structuredClone(threaded)).not.toThrow();
    });
  }
});
