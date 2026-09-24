// Web Worker protocol, without a browser: the generator's parallel hook receives "tasks" (a start + optional
// approximate swaps, then converge). A helper thread runs each one as generateDamageBuild({ task }) with a fresh
// context. Results must be identical to computing everything in one thread - otherwise a build would depend on the
// number of threads. Payloads go through structuredClone like postMessage.
import { describe, it, expect } from "vitest";
import { E, makeScenario } from "./harness/scenarios.js";

const names = (b) => b.slots.map((s) => (s.item ? `${s.item.name}${s.item.powders ? `+${s.item.powders.element}` : ""}` : "-")).join(" | ");

describe("worker tasks = one thread", () => {
  for (const [playerClass, archetype, level, ehpPct, cycle, ranges] of [
    ["Mage", "Riftwalker", 80, 25],
    ["Archer", "Trapper", 45, 30, [3, 3, 4, 2]],
    // 0.37 range sliders: the first search runs without the mana maximum, so its tasks carry their own settings
    ["Warrior", "Fallen", 90, 25, "first", { mana: { min: 0, max: 0.3 }, spd: { min: -20, max: null } }],
  ]) {
    it(`${playerClass}/${archetype} L${level}${ranges ? " · ranges" : ""}`, async () => {
      const scenario = makeScenario({ playerClass, archetype, level, ehpPct, cycle, cps: 3, ...(ranges || {}) });
      const local = await E.generateDamageBuild({ ...scenario.params, onProgress: () => {} });
      let tasks = 0;
      // like startEngineWorker: a task runs with the job's parameters plus its own override, memory per override
      const cachesByOverride = new Map();
      const parallel = async (batch) => {
        const out = [];
        for (const task of structuredClone(batch)) {
          tasks += 1;
          const key = JSON.stringify(task.override || null);
          if (!cachesByOverride.has(key)) cachesByOverride.set(key, { evalCache: new Map(), exactCache: new Map() });
          out.push(structuredClone((await E.generateDamageBuild({ ...structuredClone(scenario.params), ...(task.override || {}), task, caches: cachesByOverride.get(key) })).task));
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
