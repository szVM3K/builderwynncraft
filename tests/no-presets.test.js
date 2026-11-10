// 0.42.1: feedback graczy z Discorda - gotowe cykle spelli (ARCHETYPE_COMBOS: opisy, porady, cykle) i gotowe drzewka
// z poradnika ("Guide trees", "Add a guide tree") wprowadzały w błąd, więc strona ich nie pokazuje. Test czyta kod
// interfejsu i pilnuje, żeby nie wróciły po cichu (dane zostają w repozytorium, silnik ich nie potrzebuje do liczenia).
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/BuildRecommender.jsx", import.meta.url), "utf8");
// tylko kod, bez komentarzy (w komentarzach zostaje historia zmian)
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("No ready-made spell cycles or guide trees on the page", () => {
  it("ARCHETYPE_COMBOS is not read by any screen", () => {
    const uses = [...code.matchAll(/ARCHETYPE_COMBOS\[/g)].length;
    // jedyne zostające użycie: nazwy presetów drzewek w allTreePresets (lista, której strona już nie pokazuje)
    expect(uses).toBeLessThanOrEqual(2);
    expect(code).not.toMatch(/combo\.summary|combo\.tips|combo\.combos/);
  });
  it("no preset cycle tiles or 'Spell cycles that fit' section", () => {
    expect(code).not.toMatch(/Spell cycles that fit/);
    expect(code).not.toMatch(/Presets from other/);
    expect(code).not.toMatch(/`Presets for \$\{preset\}`/);
    expect(code).toMatch(/const cyclePresets = \[\];/);
  });
  it("no guide tree list and no 'Add a guide tree' button is rendered", () => {
    expect(code).not.toMatch(/<GuideTreePresets\b/);
    expect(code).not.toMatch(/<TreeSubmitDialog\b/);
    expect(code).not.toMatch(/＋ Add a guide tree/);
  });
});
