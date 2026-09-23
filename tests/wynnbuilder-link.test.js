// "Open in Wynnbuilder": the build link must decode back to exactly what the app shows. The decoder below follows
// Wynnbuilder's ENCODING.md (binary V12) on its own, so a mistake in the encoder can't hide behind the same mistake.
// It also writes test-results/wynnbuilder-links.json (build + link) for a check in the real Wynnbuilder page.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { E, makeScenario } from "./harness/scenarios.js";

const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+-";
const ENC = E.WB_IDS.encoding;
const NAME_OF = new Map(Object.entries(E.WB_IDS.items).map(([name, id]) => [id, name]));

function reader(hash) {
  const bits = [];
  for (const char of hash) {
    const value = B64.indexOf(char);
    if (value < 0) throw new Error(`bad character ${char}`);
    for (let j = 0; j < 6; j++) bits.push((value >> j) & 1);
  }
  let at = 0;
  const read = (length) => {
    let value = 0;
    for (let i = 0; i < length; i++) value |= bits[at + i] << i;
    at += length;
    return value >>> 0;
  };
  return { read, rest: () => bits.slice(at), get at() { return at; }, length: bits.length };
}

function decodePowders(r) {
  const tiers = ENC.POWDER_TIERS;
  const count = ENC.POWDER_ELEMENTS.length;
  const out = [r.read(ENC.POWDER_ID_BITLEN)];
  for (;;) {
    const prev = out[out.length - 1];
    if (r.read(ENC.POWDER_REPEAT_OP.BITLEN) === ENC.POWDER_REPEAT_OP.REPEAT) {
      out.push(prev);
      continue;
    }
    if (r.read(ENC.POWDER_REPEAT_TIER_OP.BITLEN) === ENC.POWDER_REPEAT_TIER_OP.REPEAT_TIER) {
      const wrap = r.read(ENC.POWDER_WRAPPER_BITLEN);
      const element = (Math.floor(prev / tiers) + wrap + 1) % count;
      out.push(element * tiers + (prev % tiers));
      continue;
    }
    if (r.read(ENC.POWDER_CHANGE_OP.BITLEN) === ENC.POWDER_CHANGE_OP.NEW_POWDER) {
      out.push(r.read(ENC.POWDER_ID_BITLEN));
      continue;
    }
    return out;
  }
}

export function decodeWynnbuilderHash(hash) {
  const r = reader(hash);
  const legacy = r.read(6);
  const version = r.read(10);
  const items = [];
  const powders = [];
  for (let i = 0; i < ENC.EQUIPMENT_NUM; i++) {
    const kind = r.read(ENC.EQUIPMENT_KIND.BITLEN);
    if (kind !== ENC.EQUIPMENT_KIND.NORMAL) throw new Error(`slot ${i}: kind ${kind}`);
    const id = r.read(ENC.ITEM_ID_BITLEN);
    items.push(id === 0 ? null : NAME_OF.get(id - 1) || `#${id - 1}`);
    if ([0, 1, 2, 3, 8].includes(i)) powders.push(r.read(1) === ENC.EQUIPMENT_POWDERS_FLAG.HAS_POWDERS ? decodePowders(r) : []);
  }
  const tomes = [];
  if (r.read(1) === ENC.TOMES_FLAG.HAS_TOMES)
    for (let i = 0; i < ENC.TOME_NUM; i++) tomes.push(r.read(1) === ENC.TOME_SLOT_FLAG.USED ? r.read(ENC.TOME_ID_BITLEN) : null);
  let sp = null;
  if (r.read(1) === ENC.SP_FLAG.ASSIGNED) {
    sp = [];
    for (let i = 0; i < ENC.SP_TYPES; i++) {
      if (r.read(1) === ENC.SP_ELEMENT_FLAG.ELEMENT_ASSIGNED) {
        const shift = 32 - ENC.MAX_SP_BITLEN;
        sp.push((r.read(ENC.MAX_SP_BITLEN) << shift) >> shift);
      } else sp.push(null);
    }
  }
  const level = r.read(1) === ENC.LEVEL_FLAG.MAX ? ENC.MAX_LEVEL : r.read(ENC.LEVEL_BITLEN);
  const aspects = [];
  if (r.read(1) === ENC.ASPECTS_FLAG.HAS_ASPECTS)
    for (let i = 0; i < ENC.NUM_ASPECTS; i++) aspects.push(r.read(1) === ENC.ASPECT_SLOT_FLAG.USED ? { id: r.read(ENC.ASPECT_ID_BITLEN), tier: r.read(ENC.ASPECT_TIER_BITLEN) + 1 } : null);
  const treeBits = r.rest();
  return { legacy, version, items, powders, tomes, sp, level, aspects, treeBits };
}

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
