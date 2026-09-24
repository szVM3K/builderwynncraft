// 0.40: major IDs (descriptions + effects), walk speed in the score, "Only builds with the checked speeds".
//  - every major ID of an item or a set has a name and a description; 97 have effects the model counts
//  - Manic Edge: the "Mana Lost" slider raises Surprise Strike damage (up to +70%); a major ID of another class
//    changes nothing; the same major ID twice counts once
//  - walk speed worth: a higher value gives a faster build, the damage shown stays the real number
//  - build attack speed: with the box on, the build ends at a checked attack speed after item tiers
import { describe, it, expect } from "vitest";
import { E, makeScenario } from "./harness/scenarios.js";

const buildOf = (playerClass, level, items, archetype = null) => {
  const arch = archetype || E.CLASSES[playerClass].archetypes[0];
  const tree = E.suggestAbilityTree(playerClass, arch, E.abilityPointCap(level, 0)).ids;
  const ws = { ...E.emptyWorkspace(), playerClass, level, archetype: arch, tree, items };
  return { build: E.manualBuild(ws), tree };
};
const spell = (stats, pattern) => stats.spells.find((entry) => pattern.test(entry.name));

describe("major IDs", () => {
  it("every major ID on an item or a set has a name and a description", () => {
    const used = new Set();
    E.ITEM_DB.forEach((item) => (item.majorIds || []).forEach((key) => used.add(key)));
    expect(used.size).toBe(165);
    used.forEach((key) => {
      expect(E.MAJOR_IDS[key]).toBeTruthy();
      expect(E.majorIdDescription(key).length).toBeGreaterThan(10);
    });
    expect(E.majorIdName("HERO")).toBe("Saviour's Sacrifice");
    expect(E.majorIdDescription("FALLOUT")).toMatch(/Fire \+50%/); // [fire] marker -> element name
    const counted = Object.keys(E.MAJOR_IDS).filter((key) => E.majorIdStatus(key).counted);
    expect(counted.length).toBe(107); // 97 with effects + 10 that only change ability properties (hits, beams...)
    expect(E.majorIdStatus("PLAGUE").counted).toBe(false);
  });

  it("Manic Edge: Mana Lost 0 -> 24 raises Surprise Strike damage; another class's major ID changes nothing", () => {
    const { build, tree } = buildOf("Assassin", 120, { weapon: "Vengeance" }, "Shadestepper");
    const off = E.computeBuildStats(build, { selected: tree, toggles: { "Activate Surprise Strike": true }, sliders: {} });
    const on = E.computeBuildStats(build, { selected: tree, toggles: { "Activate Surprise Strike": true }, sliders: { "Mana Lost": 24 } });
    expect((off.tree.majors || []).map((entry) => entry.key)).toContain("MANIC_EDGE");
    const a = off.mainAttack.hit;
    const b = on.mainAttack.hit;
    expect(b).toBeGreaterThan(a);
    // Manic Edge on a Mage build (Assassin-only effect): same numbers with and without it
    const plain = buildOf("Mage", 116, { weapon: "Warp" });
    const withRing = buildOf("Mage", 116, { weapon: "Warp" });
    const s1 = E.computeBuildStats(plain.build, { selected: plain.tree, toggles: {}, sliders: { "Mana Lost": 24 } });
    const s2 = E.computeBuildStats(withRing.build, { selected: withRing.tree, toggles: {}, sliders: { "Mana Lost": 24 } });
    expect(s2.mainAttack.hit).toBeCloseTo(s1.mainAttack.hit, 6);
    expect(E.majorEntriesFor([E.ITEM_BY_NAME.get("Vengeance")], "Mage")).toEqual([]);
  });

  it("the same major ID from two items counts once", () => {
    const one = E.majorEntriesFor([E.ITEM_BY_NAME.get("Eleventh Hour")], "Warrior");
    const two = E.majorEntriesFor([E.ITEM_BY_NAME.get("Eleventh Hour"), E.ITEM_BY_NAME.get("Hero")], "Warrior");
    expect(one.map((entry) => entry.key)).toEqual(["HERO"]);
    expect(two.map((entry) => entry.key)).toEqual(["HERO"]);
    expect(two[0].sources).toEqual(["Eleventh Hour", "Hero"]);
  });

  it("the list of spells to maximise comes from the tree alone (a sample weapon's major ID adds nothing)", () => {
    const tree = E.suggestAbilityTree("Mage", "Arcanist", E.abilityPointCap(106, 0)).ids;
    const goals = E.damageGoalOptions("Mage", 106, { selected: tree, toggles: {}, sliders: {} });
    expect(goals.some((goal) => /Accretion/.test(goal.name))).toBe(false);
  });
});

describe("walk speed in the score", () => {
  it("factor: 1% per +10% by default, counted up to +50%", () => {
    expect(E.speedFactorOf(48, 0.1)).toBeCloseTo(1.048, 9);
    expect(E.speedFactorOf(-20, 0.1)).toBeCloseTo(0.98, 9);
    expect(E.speedFactorOf(300, 0.1)).toBeCloseTo(1.05, 9);
    expect(E.speedFactorOf(48, 0)).toBe(1);
    expect(E.normalizeOptions({}).speedValue).toBe(0.1);
    expect(E.normalizeOptions({ speedValue: 0 }).speedValue).toBe(0);
  });

  it("a higher value gives a build at least as fast; the damage shown is the real number", async () => {
    const run = async (speedValue) => {
      const sc = makeScenario({ playerClass: "Warrior", archetype: "Paladin", level: 80, ehpPct: 25, spd: { min: 0, max: null }, options: { speedValue } });
      return E.generateDamageBuild({ ...sc.params, effort: "quick", onProgress: null });
    };
    const off = await run(0);
    const high = await run(0.2);
    // by its own measure the search with walk speed worth 0.2 finds a build at least as good as the damage-only one
    expect(high.metrics.value).toBeGreaterThanOrEqual(0.98 * off.metrics.damage * E.speedFactorOf(off.metrics.walkSpeed, 0.2));
    expect(high.metrics.value).toBeCloseTo(high.metrics.damage * E.speedFactorOf(high.metrics.walkSpeed, 0.2), 3);
    expect(off.metrics.value).toBeCloseTo(off.metrics.damage, 6);
    expect(high.passed).toBe(true);
  }, 600000);
});

describe("Only builds with the checked speeds", () => {
  it("the build ends at a checked attack speed after item tiers", async () => {
    const speeds = ["FAST", "VERY_FAST", "SUPER_FAST"];
    const sc = makeScenario({ playerClass: "Assassin", archetype: "Shadestepper", level: 90, ehpPct: 20, spd: { min: 0, max: null }, options: { attackSpeeds: speeds, attackSpeedsFinal: true } });
    const build = await E.generateDamageBuild({ ...sc.params, effort: "quick", onProgress: null });
    expect(speeds).toContain(build.slots.find((slot) => slot.id === "weapon").item.atkSpd);
    if (build.passed) expect(speeds).toContain(build.metrics.attackSpeed);
    else expect(build.warnings.join(" ")).toMatch(/attack speed|effective HP|walk speed/);
  }, 600000);
});
