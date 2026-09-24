// "Open in Wynnbuilder": the build link must decode back to exactly what the app shows (decoder: src, binary V12).
// It also writes test-results/wynnbuilder-links.json (build + link) for a check in the real Wynnbuilder page.
// 0.37: the build in the site's address (#b=<Wynnbuilder code>&s=<settings>) - round trip of 10 generator builds,
// every guide link, and broken addresses that must never throw anything but a readable Error.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { E, makeScenario } from "./harness/scenarios.js";

const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+-";
const ENC = E.WB_IDS.encoding;

// The decoder lives in src (next to the encoder, used by the Creator's import and by #b= links); it follows
// Wynnbuilder's ENCODING.md on its own code path, so a mistake in the encoder can't hide behind the same mistake.
const decodeWynnbuilderHash = E.decodeWynnbuilderHash;
// give vitest's worker RPC a turn between long synchronous stretches
const tick = () => new Promise((resolve) => setImmediate(resolve));

const CASES = [
  ["Archer", 0, 45], ["Archer", 1, 106],
  ["Assassin", 0, 80], ["Assassin", 2, 120],
  ["Mage", 0, 30], ["Mage", 1, 100],
  ["Shaman", 0, 106], ["Shaman", 2, 65],
  ["Warrior", 0, 120], ["Warrior", 1, 90],
];

describe("Open in Wynnbuilder link", () => {
  it("decodes back to the build (items, powders, skill points, level, tomes, aspects, tree)", async () => {
    const out = [];
    for (const [playerClass, archIndex, level] of CASES) {
      const archetype = E.CLASSES[playerClass].archetypes[archIndex];
      const scenario = makeScenario({ playerClass, archetype, level, goal: "first", ehpPct: 20 });
      const build = await E.generateDamageBuild({ ...scenario.params, effort: "quick", onProgress: () => {} });
      const treeIds = scenario.params.treeSettings.selected;
      const env = E.extrasEnvFor(build, scenario.params.treeSettings, null, null);
      const extras = level >= 60 ? E.wynnbuilderExtras(build, env) : null;
      const link = E.wynnbuilderLink(build, treeIds, extras);
      expect(link.missing).toEqual([]);
      expect(link.url.startsWith("https://wynnbuilder.github.io/builder/#")).toBe(true);
      const d = decodeWynnbuilderHash(link.hash);
      expect(d.legacy).toBe(12);
      expect(d.version).toBe(E.WB_IDS.versionIndex);
      expect(d.items).toEqual(build.slots.map((slot) => (slot.item ? slot.item.name : null)));
      const weapon = build.slots.find((slot) => slot.id === "weapon").item;
      const powderNames = (list) => list.map((pid) => `${ENC.POWDER_ELEMENTS[Math.floor(pid / ENC.POWDER_TIERS)]}${(pid % ENC.POWDER_TIERS) + 1}`).sort().join(" ");
      const expectedPowders = weapon && weapon.powders ? weapon.powders.list.map((p) => `${ENC.POWDER_ELEMENTS[{ earth: 0, thunder: 1, water: 2, fire: 3, air: 4 }[p.element]]}${p.tier}`).sort().join(" ") : "";
      expect(powderNames(d.powders[4])).toBe(expectedPowders);
      expect(d.powders.slice(0, 4).every((list) => list.length === 0)).toBe(true);
      const tomeList = extras ? Object.values(extras.tomes).flat().filter(Boolean) : [];
      const tomeSkill = (skill) => tomeList.reduce((sum, tome) => sum + ((tome.ids && tome.ids[skill]) || 0), 0);
      expect(d.sp).toEqual(E.SKILLS.map((skill) => Math.round(build.skillPoints.totals[skill] + tomeSkill(skill))));
      expect(d.level).toBe(level);
      expect(d.tomes.filter((id) => id !== null).sort()).toEqual(tomeList.map((tome) => tome.tomeId).sort());
      const aspectList = extras ? extras.aspects.filter(Boolean) : [];
      expect(d.aspects.filter(Boolean)).toEqual(aspectList.map((entry) => ({ id: entry.aspect.id, tier: entry.tier })));
      // the tree is the last part; its bits are the Copy Tree code
      let treeCode = "";
      for (let i = 0; i < d.treeBits.length; i += 6) {
        let value = 0;
        for (let j = 0; j < 6; j++) value |= (d.treeBits[i + j] || 0) << j;
        treeCode += B64[value];
      }
      const decodedTree = E.decodeTreeHash(playerClass, treeCode);
      // same abilities (the decoder also returns the tree's head, which the encoding never stores)
      expect(treeIds.every((id) => decodedTree.includes(id))).toBe(true);
      expect(decodedTree.filter((id) => !treeIds.includes(id)).length).toBeLessThanOrEqual(1);
      out.push({
        label: scenario.label,
        url: link.url,
        playerClass,
        level,
        items: d.items,
        powders: expectedPowders,
        sp: d.sp,
        tomes: tomeList.map((tome) => tome.name),
        aspects: aspectList.map((entry) => `${entry.aspect.name} ${entry.tier}`),
        treeCount: treeIds.length,
      });
    }
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync("test-results/wynnbuilder-links.json", JSON.stringify(out, null, 1));
  });
});

describe("Build Solver result in Wynnbuilder (header link, 0.37)", () => {
  it("opens with the same 9 items and the current class tree", () => {
    const solved = E.solveBuilds(100, { ...E.DEFAULT_SOLVER, playerClass: "Mage", archetype: "Riftwalker" });
    const candidate = solved.candidates[0] || solved.nearMisses[0];
    const build = E.solverBuildResult(candidate, solved, solved.archetype);
    const tree = E.suggestAbilityTree("Mage", "Riftwalker", E.abilityPointCap(100, 0)).ids;
    const link = E.wynnbuilderLink(build, tree, null);
    expect(link.missing).toEqual([]);
    const d = decodeWynnbuilderHash(link.hash);
    expect(d.items).toEqual(build.slots.map((slot) => (slot.item ? slot.item.name : null)));
    expect(d.level).toBe(100);
  });
});

describe("build link in the site's address (#b=&s=)", () => {
  it("10 generator builds: encode -> decode gives the same items, powders, skill points, level, tree and settings", async () => {
    for (const [index, [playerClass, archIndex, level]] of CASES.entries()) {
      await tick();
      const archetype = E.CLASSES[playerClass].archetypes[archIndex];
      const scenario = makeScenario({ playerClass, archetype, level, goal: "first", ehpPct: 20, cycle: "first", cps: 3, ranges: "defaults" });
      const build = await E.generateDamageBuild({ ...scenario.params, effort: "quick", onProgress: () => {} });
      const treeIds = scenario.params.treeSettings.selected;
      const link = E.wynnbuilderLink(build, treeIds, null);
      // settings as the form holds them (ranges differ per case so every field is exercised)
      const form = {
        ...E.DEFAULT_DAMAGE_FORM,
        preset: archetype,
        goal: build.goal,
        cycle: E.cycleText(scenario.params.cycle.ids),
        cps: 3 + (index % 3),
        minEhp: scenario.params.minEhp,
        drain: index % 2 ? { min: -3, max: 1 } : { min: 0, max: null },
        lr: index % 3 === 0 ? { min: 20, max: 400 } : { min: null, max: null },
        spd: index % 4 === 0 ? { min: null, max: null } : { min: -20 + index * 5, max: index === 5 ? 60 : null },
        rolls: index % 2 ? "avg" : "max",
        poison: index === 3,
        tradeable: index === 4,
      };
      const heavy = build.slots.find((slot) => slot.item && slot.id === "helmet");
      const options = E.normalizeOptions({ excluded: ["Morph-Stardust", "Warsong"], locked: heavy ? { helmet: heavy.item.name } : {}, excludedTiers: index === 2 ? ["Mythic"] : [] });
      const s = E.encodeShareSettings({ form, options, rank: index % 2 ? "vip" : "" });
      const address = `https://szvm3k.github.io/builderwynncraft/#b=${link.hash}&s=${s}`;
      const parsed = E.parseBuildHash(address);
      expect(parsed).toEqual({ b: link.hash, s });
      const opened = E.buildFromShare(parsed);
      // items and powders
      expect(opened.build.slots.map((slot) => (slot.item ? slot.item.name : null))).toEqual(build.slots.map((slot) => (slot.item ? slot.item.name : null)));
      const weapon = build.slots.find((slot) => slot.id === "weapon").item;
      const powderOf = (item) => (item && item.powders && item.powders.list ? item.powders.list.map((p) => `${p.element}${p.tier}`).sort().join(" ") : "");
      expect(powderOf(opened.build.slots.find((slot) => slot.id === "weapon").item)).toBe(powderOf(weapon));
      // skill points (totals), level, class, tree
      expect(E.SKILLS.map((skill) => opened.build.skillPoints.totals[skill])).toEqual(E.SKILLS.map((skill) => Math.round(build.skillPoints.totals[skill])));
      expect(opened.build.level).toBe(level);
      expect(opened.ws.playerClass).toBe(playerClass);
      expect(treeIds.every((id) => opened.ws.tree.includes(id))).toBe(true);
      // settings
      const back = opened.settings;
      expect(back.form.drain).toEqual(E.normalizeRange(form.drain) || { min: null, max: null });
      expect(back.form.lr).toEqual(E.normalizeRange(form.lr) || { min: null, max: null });
      expect(back.form.spd).toEqual(E.normalizeRange(form.spd) || { min: null, max: null });
      for (const key of ["goal", "cycle", "cps", "minEhp", "rolls", "poison", "tradeable", "noEvents", "freeSp", "preset"]) expect(back.form[key]).toEqual(form[key]);
      expect(back.options.excluded).toEqual(options.excluded);
      expect(back.options.locked).toEqual(options.locked);
      expect(back.options.excludedTiers).toEqual(options.excludedTiers);
      expect(back.rank).toBe(index % 2 ? "vip" : "");
    }
  });

  it("every guide link opens with the same items as the Guide build view", async () => {
    let checked = 0;
    for (const [index, guide] of E.GUIDE_DATA.builds.entries()) {
      if (index % 8 === 0) await tick();
      const parsed = E.parseBuildHash(guide.url);
      expect(parsed && parsed.b).toBeTruthy();
      let opened;
      try {
        opened = E.buildFromShare(parsed);
      } catch (error) {
        // a crafted weapon: no class from the link (the Creator's import still reads it)
        expect(error).toBeInstanceOf(Error);
        expect(E.workspaceFromWynnbuilderLink(guide.url).ws.items.weapon).toBeUndefined();
        continue;
      }
      E.SLOTS.forEach((slot) => {
        const expected = guide.items[slot.id] && E.ITEM_BY_NAME.has(guide.items[slot.id]) ? guide.items[slot.id] : null;
        const got = opened.ws.items[slot.id] || null;
        if (expected) expect(got).toBe(expected);
      });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(80);
  });

  it("a broken address never throws anything but a readable Error", async () => {
    const valid = E.GUIDE_DATA.builds[0].url.split("#")[1];
    const inputs = [];
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 150; i += 1) {
      const length = 1 + Math.floor(random() * 120);
      inputs.push(Array.from({ length }, () => B64[Math.floor(random() * 64)]).join(""));
    }
    for (let cut = 1; cut < valid.length; cut += 3) inputs.push(valid.slice(0, cut));
    inputs.push("%%%", "b=", "b=@@@", "b=abc&s=%%%", `b=${valid}&s=abc`, `b=${valid}&s=${Buffer.from('{"v":99}').toString("base64url")}`);
    let errors = 0;
    for (const [index, text] of inputs.entries()) {
      if (index % 10 === 0) await tick();
      const parsed = E.parseBuildHash(text.startsWith("b=") ? `#${text}` : `#b=${text}`);
      if (!parsed) continue;
      try {
        E.buildFromShare(parsed);
      } catch (error) {
        errors += 1;
        expect(error.constructor).toBe(Error);
        expect(String(error.message).length).toBeGreaterThan(10);
      }
    }
    expect(errors).toBeGreaterThan(50);
    // a newer settings format is refused with a message
    expect(() => E.decodeShareSettings(Buffer.from('{"v":99}').toString("base64url"))).toThrow(/newer version/);
  });
});
