// 0.38: Share (a short link to this site + a ready message with the item list) and the Effective HP range slider.
//  - the message is plain text (title, link, "> " item names) that reads well anywhere, ≤ 2000 characters,
//    and its link opens the same build
//  - a named build keeps its name through the link (n=)
//  - EHP range: 2 % steps in the form, a maximum the generator respects, and a maximum above the
//    unbounded result changes nothing (first search without it)
import { describe, it, expect } from "vitest";
import { E, makeScenario } from "./harness/scenarios.js";

const names = (build) => build.slots.map((slot) => (slot.item ? `${slot.item.name}${slot.item.powders ? `+${slot.item.powders.element}` : ""}` : "-")).join(" | ");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const generate = (params) => E.generateDamageBuild({ ...params, effort: "quick", onProgress: () => {} });
// guide builds with a weapon (their links open here as a Shared build)
const guides = () => E.GUIDE_DATA.builds.filter((guide) => E.parseBuildHash(guide.url) && E.workspaceFromWynnbuilderLink(guide.url).ws.items.weapon);

describe("Share: message with the item list", () => {
  it("every guide build: title, link, 9 item names; ≤ 2000 characters; the link opens the same items", () => {
    const list = guides();
    expect(list.length).toBeGreaterThan(50);
    for (const guide of list) {
      const parsed = E.parseBuildHash(guide.url);
      const { build } = E.buildFromShare(parsed);
      const url = E.shareUrlFor({ code: parsed.b, name: guide.name });
      const share = E.buildShareMessage({ build, url, name: guide.name, summary: E.shareSummary(build) });
      expect(share.message.length).toBeLessThanOrEqual(2000);
      const lines = share.message.split("\n");
      expect(lines.length).toBe(11);
      expect(lines[0]).toBe(share.title);
      expect(lines[1]).toBe(url);
      // just the 9 item names in slot order (no slot labels, no numbers line, no markup)
      expect(lines.slice(2).every((line) => line.startsWith("> "))).toBe(true);
      expect(/> (Helmet|Chestplate|Leggings|Boots|Ring|Bracelet|Necklace|Weapon): /.test(share.message)).toBe(false);
      expect(/\*\*|\]\(</.test(share.message)).toBe(false);
      build.slots.forEach((slot, index) => expect(share.lines[index].startsWith(slot.item ? slot.item.name : "—")).toBe(true));
      // the link opens the same build (items and powders) with the name
      const back = E.parseBuildHash(url);
      expect(back.n).toBe(guide.name.replace(/\s+/g, " ").trim().slice(0, 60));
      expect(names(E.buildFromShare(back).build)).toBe(names(build));
    }
  });

  it("powders are listed in order, grouped: [4× Earth VI] / [2× Water VI, 2× Thunder VI]", () => {
    expect(E.powderGroupsText({ list: [1, 2, 3, 4].map(() => ({ element: "earth", tier: 6 })) })).toBe("4× Earth VI");
    expect(E.powderGroupsText({ list: [{ element: "water", tier: 6 }, { element: "water", tier: 6 }, { element: "thunder", tier: 6 }, { element: "thunder", tier: 6 }] })).toBe("2× Water VI, 2× Thunder VI");
    expect(E.powderGroupsText({ list: [{ element: "fire", tier: 7 }] })).toBe("Fire VII");
  });

  it("a generated build: title, the weapon's powders last, no numbers line", async () => {
    const scenario = makeScenario({ playerClass: "Warrior", archetype: "Fallen", level: 100, goal: "first", ehpPct: 25, cycle: "none" });
    const build = await generate(scenario.params);
    const stats = E.computeBuildStats(build, build.treeSettings);
    const url = "https://szvm3k.github.io/builderwynncraft/#b=TEST";
    const share = E.buildShareMessage({ build, url, summary: E.shareSummary(build, stats) });
    expect(share.title).toBe(`${build.archetype} Warrior · level 100`);
    expect(share.summary).toMatch(/per .+ hit · [\d,]+ EHP$/);
    expect(share.message).not.toContain(share.summary);
    const weapon = build.slots.find((slot) => slot.id === "weapon").item;
    expect(share.message.split("\n").pop()).toBe(`> ${weapon.name}${weapon.powders ? ` [${E.powderGroupsText(weapon.powders)}]` : ""}`);
  });

  it("too long: the settings part of the link is dropped from the message", () => {
    const guide = guides()[0];
    const parsed = E.parseBuildHash(guide.url);
    const { build } = E.buildFromShare(parsed);
    const longUrl = `${E.shareUrlFor({ code: parsed.b })}&s=${"x".repeat(1900)}`;
    const shortUrl = E.shareUrlFor({ code: parsed.b });
    const share = E.buildShareMessage({ build, url: longUrl, shortUrl });
    expect(share.message.length).toBeLessThanOrEqual(2000);
    expect(share.message.split("\n")[1]).toBe(shortUrl);
    expect(share.url).toBe(longUrl); // "Copy link only" still copies the full address
  });

  it("Creator / Optimizer builds and saved links", () => {
    const guide = guides()[1];
    const ws = { ...E.workspaceFromWynnbuilderLink(guide.url).ws, name: "My raid *build*" };
    const share = E.workspaceShare(ws);
    expect(share.error).toBeUndefined();
    expect(share.title.startsWith("My raid *build* · ")).toBe(true);
    expect(share.message.split("\n")[0]).toBe(share.title);
    const back = E.parseBuildHash(share.url);
    expect(back.n).toBe("My raid *build*");
    // brackets in the name are encoded (a ")" at the end of an address is often cut off the link)
    const odd = E.workspaceShare({ ...ws, name: "Raid (v2) build" });
    expect(odd.url).not.toMatch(/[()]/);
    expect(E.parseBuildHash(odd.url).n).toBe("Raid (v2) build");
    // no weapon: the link couldn't tell the class
    expect(E.workspaceShare({ ...ws, items: { helmet: ws.items.helmet } }).error).toMatch(/weapon/);
    // a saved link: the default save name ("Archetype lv N · goal") isn't repeated in the title, an own name is
    const saved = E.linkShare(E.shareUrlFor({ code: E.parseBuildHash(guide.url).b }), `${E.buildFromShare(E.parseBuildHash(guide.url)).build.archetype} lv 106 · Something`);
    expect(saved.title.includes(" lv 106 · ")).toBe(false);
    expect(E.linkShare(E.shareUrlFor({ code: E.parseBuildHash(guide.url).b }), "Mine").title.startsWith("Mine · ")).toBe(true);
    expect(E.linkShare("not a link").error).toBeTruthy();
  });

  it("settings format 2: only what differs from the defaults - short links, same settings back", () => {
    const empty = E.encodeShareSettings({ form: E.DEFAULT_DAMAGE_FORM, options: E.DEFAULT_OPTIONS, rank: "" });
    expect(empty.length).toBeLessThan(12); // {"v":2}
    const form = { ...E.DEFAULT_DAMAGE_FORM, preset: "Fallen", goal: 3, minEhp: 35000, maxEhp: 50000, cycle: "2343", spd: { min: 0, max: null } };
    const options = { ...E.DEFAULT_OPTIONS, excluded: ["Sequencer"], attackSpeeds: ["FAST"] };
    const code = E.encodeShareSettings({ form, options, rank: "vipplus" });
    expect(code.length).toBeLessThan(200);
    const back = E.decodeShareSettings(code);
    expect(back.rank).toBe("vipplus");
    expect(E.migrateDamageForm(back.form)).toEqual({ ...E.migrateDamageForm(form), treePreset: null });
    expect(back.options.excluded).toEqual(["Sequencer"]);
    expect(back.options.attackSpeeds).toEqual(["FAST"]);
    // defaults come back as defaults (not as Any)
    const plain = E.decodeShareSettings(empty);
    expect(plain.form.drain).toEqual(E.DEFAULT_DAMAGE_FORM.drain);
    expect(plain.form.spd).toEqual(E.DEFAULT_DAMAGE_FORM.spd);
    // a 0.37 link (format 1, every key written out) still opens with the same settings
    const v1 = { v: 1, r: "hero", g: null, c: "", p: 3, e: 20000, m: [null, null], l: [null, null], w: [null, null], a: 0, t: [0, 0, 1, 0, 1, 1, 1], k: [], x: [], o: [[], [], 0, 0, 0, "le", "auto"], pr: "Fallen", tp: null };
    const old = E.decodeShareSettings(Buffer.from(JSON.stringify(v1)).toString("base64url"));
    expect(old.form.drain).toEqual({ min: null, max: null });
    expect(old.form.spd).toEqual({ min: null, max: null });
    expect(old.form.minEhp).toBe(20000);
    expect(old.rank).toBe("hero");
  });

  it("Share: short link by default (just the build), settings on request", () => {
    const guide = guides()[2];
    const parsed = E.parseBuildHash(guide.url);
    const s = E.encodeShareSettings({ form: { ...E.DEFAULT_DAMAGE_FORM, minEhp: 30000 }, options: E.DEFAULT_OPTIONS, rank: "vip" });
    const saved = E.shareUrlFor({ code: parsed.b, s });
    const share = E.linkShare(saved, "Mine");
    expect(share.url).not.toContain("&s=");
    expect(share.url.length).toBeLessThan(E.shareUrlFor({ code: parsed.b }).length + 20);
    expect(share.withSettings.url).toContain(`&s=${s}`);
    expect(E.decodeShareSettings(E.parseBuildHash(share.withSettings.url).s).form.minEhp).toBe(30000);
  });

  it("the settings link carries the EHP maximum (eh) and old links without it stay Any", () => {
    const form = { ...E.DEFAULT_DAMAGE_FORM, minEhp: 12000, maxEhp: 30000 };
    const code = E.encodeShareSettings({ form, options: E.DEFAULT_OPTIONS, rank: "" });
    const back = E.decodeShareSettings(code);
    expect(back.form.minEhp).toBe(12000);
    expect(back.form.maxEhp).toBe(30000);
    const old = E.decodeShareSettings(E.encodeShareSettings({ form: { ...E.DEFAULT_DAMAGE_FORM, minEhp: 12000 }, options: E.DEFAULT_OPTIONS, rank: "" }));
    expect(old.form.maxEhp).toBeNull();
  });
});

describe("Effective HP range slider", () => {
  it("2 % steps: % ↔ EHP numbers round trip, the default stays 25 %, far ends = Any", () => {
    const ehpMax = E.reachableEhp("Mage", 100);
    expect(E.ehpPctPair({ minEhp: null, maxEhp: null }, ehpMax)).toEqual({ min: 25, max: null });
    for (let pct = 2; pct <= 100; pct += 2) {
      const patch = E.ehpFormPatch({ min: pct, max: null }, ehpMax);
      expect(E.ehpPctPair(patch, ehpMax).min).toBe(pct);
      const both = E.ehpFormPatch({ min: 10, max: Math.max(10, pct) }, ehpMax);
      expect(E.ehpPctPair(both, ehpMax).max).toBe(Math.max(10, pct));
    }
    expect(E.ehpFormPatch({ min: null, max: null }, ehpMax)).toEqual({ minEhp: 0, maxEhp: null });
    expect(E.ehpPctPair({ minEhp: 0, maxEhp: null }, ehpMax)).toEqual({ min: null, max: null });
    // a maximum under the minimum is lifted to it
    expect(E.formMaxEhp({ minEhp: 20000, maxEhp: 10000 }, ehpMax)).toBe(20000);
    expect(E.ehpUi(ehpMax).step).toBe(2);
  });

  it("the generator keeps EHP under the maximum (or says why not)", async () => {
    for (const [playerClass, archetype, level, maxPct] of [
      ["Warrior", "Fallen", 90, 40],
      ["Mage", "Riftwalker", 100, 35],
      ["Archer", "Boltslinger", 70, 45],
    ]) {
      const scenario = makeScenario({ playerClass, archetype, level, goal: "first", ehpPct: 25, ehpMaxPct: maxPct, cycle: "none" });
      const build = await generate(scenario.params);
      await tick();
      expect(build.metrics.maxEhp).toBe(scenario.params.maxEhp);
      if (build.passed) {
        expect(build.metrics.ehp).toBeLessThanOrEqual(scenario.params.maxEhp + 1e-6);
        expect(build.metrics.ehp).toBeGreaterThanOrEqual(scenario.params.minEhp - 1e-6);
      } else expect(build.warnings.join(" ")).toMatch(/effective HP/);
    }
  });

  it("a maximum just under the unbounded result: second search, a build inside the range", async () => {
    const scenario = makeScenario({ playerClass: "Warrior", archetype: "Fallen", level: 90, goal: "first", ehpPct: 25, cycle: "none" });
    const free = await generate(scenario.params);
    await tick();
    const maxEhp = Math.max(scenario.params.minEhp + 200, Math.round(free.metrics.ehp * 0.995));
    const capped = await generate({ ...scenario.params, maxEhp });
    expect(capped.stats.ranges).toBe("second search with the ranges");
    expect(capped.passed).toBe(true);
    expect(capped.metrics.ehp).toBeLessThanOrEqual(maxEhp + 1e-6);
    expect(capped.metrics.ehp).toBeGreaterThanOrEqual(scenario.params.minEhp - 1e-6);
  });

  it("a maximum above the unbounded result changes nothing", async () => {
    const scenario = makeScenario({ playerClass: "Shaman", archetype: "Summoner", level: 80, goal: "first", ehpPct: 25, cycle: "none" });
    const free = await generate(scenario.params);
    await tick();
    const capped = await generate({ ...scenario.params, maxEhp: Math.ceil(free.metrics.ehp) + 1 });
    expect(names(capped)).toBe(names(free));
    expect(capped.metrics.damage).toBe(free.metrics.damage);
    expect(capped.passed).toBe(free.passed);
  });
});
