// Property test of the skill point solver on random item sets (seeded, reproducible):
//  - the exact (equip-order) assignment must pass an independent final-state verifier,
//  - it can never be below the final-state lower bound,
//  - the fast solver used during the search should not claim fewer points than the exact one (it would let the
//    search accept sets that can't be equipped) - counted and reported.
import { describe, it, expect } from "vitest";
import { E, rng } from "./harness/scenarios.js";
import { verifySkillPoints, skillPointLowerBound } from "./harness/checks.js";
import { writeJson } from "./harness/report.js";

const SETS = Number(process.env.SP_SETS || 20000);
const SEED = Number(process.env.SP_SEED || 20260923);

const bySlot = Object.fromEntries(E.SLOTS.map((slot) => [slot.id, E.ITEM_DB.filter((item) => (slot.id === "weapon" ? item.category === "weapon" : item.type === slot.type))]));
// Items with requirements or skill bonuses (incl. negative ones) are the interesting ones for the solver.
const spicy = Object.fromEntries(Object.entries(bySlot).map(([slot, items]) => [slot, items.filter((item) => E.SKILLS.some((skill) => (item.reqs[skill] || 0) > 0 || (item.stats[skill] || 0) !== 0))]));

describe("skill point solver", () => {
  it(`${SETS} random sets`, () => {
    const r = rng(SEED);
    const errors = [];
    let fastBelowExact = 0;
    let orderCost = 0;
    const examples = [];
    for (let n = 0; n < SETS; n += 1) {
      const level = r.int(1, 120);
      const items = E.SLOTS.map((slot) => {
        const pool = r.chance(0.8) ? spicy[slot.id] : bySlot[slot.id];
        const allowed = pool.filter((item) => item.level <= Math.max(level, 20));
        return allowed.length && r.chance(0.92) ? r.pick(allowed) : null;
      }).filter(Boolean);
      if (items.filter((item) => item.category === "weapon").length > 1) continue;
      const exact = E.computeSkillPoints(items, true);
      const fast = E.computeSkillPoints(items, false);
      const lower = skillPointLowerBound(items);
      const names = items.map((item) => item.name);
      const problems = verifySkillPoints(items, exact.assigned, Infinity).filter((problem) => !problem.includes("> cap"));
      if (problems.length) errors.push({ n, names, problem: problems.join("; "), assigned: exact.assigned });
      if (exact.total < lower) errors.push({ n, names, problem: `exact ${exact.total} < lower bound ${lower}` });
      if (fast.total < exact.total) {
        fastBelowExact += 1;
        if (examples.length < 10) examples.push({ names, fast: fast.total, exact: exact.total });
      }
      if (exact.total > lower) orderCost += 1;
    }
    writeJson("skillpoints.json", { sets: SETS, seed: SEED, errors, fastBelowExact, orderCost, examples });
    console.log(`skill point solver: ${SETS} sets, ${errors.length} errors, fast < exact in ${fastBelowExact}, equip order adds points in ${orderCost}`);
    examples.slice(0, 3).forEach((example) => console.log(`  fast ${example.fast} vs exact ${example.exact}: ${example.names.join(", ")}`));
    expect(errors.slice(0, 5), JSON.stringify(errors.slice(0, 5), null, 1)).toEqual([]);
  });
});
