// Deep certificate suite (npm run test:deep): a handful of full-effort builds, each checked with deepCheck
// (exhaustive pairs over ~35 candidates per slot, systematic + random triples). Slow on purpose: minutes per build.
// DEEP_PER_SLOT, DEEP_TRIPLES tune the size. Results: test-results/deep-<name>.json.
import { describe, it, expect, afterAll } from "vitest";
import { makeScenario, scenarioForLog } from "./scenarios.js";
import { generate, deepCheck } from "./checks.js";
import { writeJson, formatFindings } from "./report.js";

const PER_SLOT = Number(process.env.DEEP_PER_SLOT || 16);
const TRIPLES = Number(process.env.DEEP_TRIPLES || 5000);

export function defineDeepSuite(name, cases) {
  const rows = [];
  describe(`deep certificate (${name})`, () => {
    cases.forEach(([playerClass, archetype, level, ehpPct, cycle], index) => {
      it(`${playerClass}/${archetype} L${level} EHP ${ehpPct}%${cycle ? " + cycle" : ""}`, async () => {
        const scenario = makeScenario({ playerClass, archetype, level, ehpPct, cycle, cps: 3 });
        const { build, ms } = await generate(scenario);
        const { findings, stats } = await deepCheck(scenario, build, { perSlot: PER_SLOT, triples: TRIPLES, seed: 1000 + index });
        rows.push({ label: scenario.label, generationMs: ms, damage: build.metrics.damage, passed: build.passed, ...stats, findings, scenario: scenarioForLog(scenario) });
        const text = formatFindings(findings);
        console.log(
          `${scenario.label}: ${Math.round(build.metrics.damage)} dmg (generated in ${(ms / 1000).toFixed(1)} s) · pairs ${stats.pairEvals} (best ${stats.bestPairGain === null ? "-" : (stats.bestPairGain * 100).toFixed(3) + " %"}) · triples ${stats.tripleEvals} (best ${stats.bestTripleGain === null ? "-" : (stats.bestTripleGain * 100).toFixed(3) + " %"}) · ${(stats.ms / 1000).toFixed(0)} s${text ? "\n" + text : ""}`
        );
        expect(findings.filter((finding) => finding.severity === "error")).toEqual([]);
      });
    });
    afterAll(() => writeJson(`deep-${name}.json`, rows));
  });
}
