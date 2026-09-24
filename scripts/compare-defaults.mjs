// 0.37: what the new default ranges change (mana balance 0..+1 with a cycle, walk speed >= -20%) compared with
// Any (= the 0.35/0.36 behaviour). Same scenarios as the matrix harness, full search.
// Run: npx vite-node scripts/compare-defaults.mjs -- [shard=0] [shards=1] [levels=50,100]  (VERIFY=1 = always run the defaults)
import fs from "node:fs";
import { E, makeScenario } from "../tests/harness/scenarios.js";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const shard = Number(args[0]) || 0;
const shards = Number(args[1]) || 1;
const levels = (args[2] || "50,100").split(",").map(Number);
const names = (build) => build.slots.map((slot) => (slot.item ? `${slot.item.name}${slot.item.powders ? `+${slot.item.powders.element}` : ""}` : "-")).join("|");
const cases = [];
Object.entries(E.CLASSES).forEach(([playerClass, cfg]) => cfg.archetypes.forEach((archetype) => levels.forEach((level) => ["cycle", "noCycle"].forEach((variant) => cases.push({ playerClass, archetype, level, variant })))));
const rows = [];
for (const [index, c] of cases.entries()) {
  if (index % shards !== shard) continue;
  const common = { playerClass: c.playerClass, archetype: c.archetype, level: c.level, goal: "first", ehpPct: 25, cycle: c.variant === "cycle" ? "first" : "none", cps: 3 };
  const any = makeScenario({ ...common });
  if (!any) continue;
  const defaults = makeScenario({ ...common, ranges: "defaults" });
  const t0 = Date.now();
  const a = await E.generateDamageBuild({ ...any.params, onProgress: () => {} });
  const t1 = Date.now();
  const hasCycle = any.params.cycle.ids.length > 0;
  const anyFits = a.passed && a.metrics.walkSpeed >= -20 - 1e-9 && (!hasCycle || a.metrics.manaNet <= 1 + 1e-9);
  // a build from Any that already fits the default ranges is (up to search noise) what the defaults find too, so the
  // defaults run is skipped then; VERIFY=1 runs it anyway (the defaults keep mana >= 0 and walk >= -20% as minimums in
  // the first search and only relax the mana maximum)
  const d = anyFits && !process.env.VERIFY ? a : await E.generateDamageBuild({ ...defaults.params, onProgress: () => {} });
  const t2 = Date.now();
  const row = {
    label: any.label,
    hasCycle,
    anyDamage: a.metrics.damage,
    anyPassed: a.passed,
    anyWalk: a.metrics.walkSpeed,
    anyMana: hasCycle ? a.metrics.manaNet : null,
    anyFits,
    defDamage: d.metrics.damage,
    defPassed: d.passed,
    defWalk: d.metrics.walkSpeed,
    defMana: hasCycle ? d.metrics.manaNet : null,
    changed: names(a) !== names(d),
    change: d.metrics.damage / Math.max(1e-9, a.metrics.damage) - 1,
    msAny: t1 - t0,
    msDef: t2 - t1,
    warnings: d.warnings,
  };
  rows.push(row);
  console.log(`${row.changed ? "≠" : "="} ${row.label} | any ${Math.round(row.anyDamage)} walk ${Math.round(row.anyWalk)}${hasCycle ? ` mana ${row.anyMana.toFixed(2)}` : ""}${anyFits ? " (fits)" : ""} | defaults ${Math.round(row.defDamage)} walk ${Math.round(row.defWalk)}${hasCycle ? ` mana ${row.defMana.toFixed(2)}` : ""} passed=${row.defPassed} ${(row.change * 100).toFixed(2)}% | ${(row.msAny / 1000).toFixed(1)}s/${(row.msDef / 1000).toFixed(1)}s`);
}
fs.mkdirSync("test-results", { recursive: true });
fs.writeFileSync(`test-results/compare-defaults-${shard}.json`, JSON.stringify(rows, null, 1));
