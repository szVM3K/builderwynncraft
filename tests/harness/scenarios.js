// Scenario builder: turns "class / archetype / level / settings" into the exact arguments the UI passes to
// generateDamageBuild(), using the same helpers the UI uses (suggested tree, goal list, EHP range, spell cycles).
import { __engine as E } from "../../src/BuildRecommender.jsx";

export { E };

// Small, fast, seedable PRNG (mulberry32) - every random scenario can be replayed from its seed.
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  };
}

export const ALL_ARCHETYPES = Object.entries(E.CLASSES).flatMap(([playerClass, cfg]) => cfg.archetypes.map((archetype) => ({ playerClass, archetype })));

// Spells (ids 1-4) the tree actually has at this level, with their mana cost.
export function treeSpells(playerClass, level, treeSettings) {
  const preview = E.classPreview(playerClass, level, treeSettings);
  if (!preview) return [];
  return preview.stats.spells.filter((spell) => spell.id >= 1 && spell.id <= 4 && spell.cost !== null && spell.cost !== undefined);
}

// The archetype's suggested cycles (Build info / class panel), reduced to spells the tree has.
export function archetypeCycles(playerClass, archetype, level, treeSettings) {
  const combo = E.ARCHETYPE_COMBOS[archetype];
  if (!combo) return [];
  const known = new Set(treeSpells(playerClass, level, treeSettings).map((spell) => spell.id));
  return combo.combos
    .map((entry) => ({ name: entry.name, ids: [...entry.cycle].filter((char) => "1234".includes(char)).map(Number) }))
    .filter((entry) => entry.ids.length > 0 && entry.ids.every((id) => known.has(id)));
}

/**
 * Build a scenario.
 * @param {object} s
 *   playerClass, archetype, level          required
 *   goal       "first" (strongest spell, the UI default) | "main" | "random" | "multi" (two goals, their sum) | spell id
 *   ehpPct     minimum EHP as % of the reachable maximum (the UI slider; 0 = off)
 *   cycle      "none" | "first" | "random" | array of spell ids
 *   cps, steal, gain, requireSustain, excludeEvents, tradeableOnly, options  as in the UI
 *   random     rng() for the "random" choices
 */
export function makeScenario(s) {
  const { playerClass, archetype, level } = s;
  const r = s.random || rng(1);
  const tree = E.suggestAbilityTree(playerClass, archetype, E.abilityPointCap(level, s.apLoan || 0));
  const treeSettings = { selected: tree.ids, toggles: {}, sliders: {} };
  const goals = E.damageGoalOptions(playerClass, level, treeSettings);
  if (goals.length === 0) return null;
  let goal = goals[0].id;
  if (s.goal === "main") goal = E.DAMAGE_GOAL_MAIN;
  else if (s.goal === "random") goal = r.pick(goals).id;
  else if (s.goal === "multi" && goals.length >= 2) goal = [goals[0].id, r.pick(goals.slice(1)).id];
  else if (typeof s.goal === "number" && goals.some((entry) => entry.id === s.goal)) goal = s.goal;
  const ehpMax = E.reachableEhp(playerClass, level);
  const ehpPct = s.ehpPct ?? 25;
  const step = Math.max(1, Math.round(ehpMax / 20)); // the UI slider moves in 5 % steps
  const minEhp = ehpPct > 0 ? step * Math.round(ehpPct / 5) : 0;
  let cycleIds = [];
  const cycles = archetypeCycles(playerClass, archetype, level, treeSettings);
  if (Array.isArray(s.cycle)) cycleIds = s.cycle;
  else if (s.cycle === "first" && cycles.length) cycleIds = cycles[0].ids;
  else if (s.cycle === "random" && cycles.length) cycleIds = r.pick(cycles).ids;
  const cycle = { ids: cycleIds, cps: s.cps ?? 3, steal: s.steal ?? true, gain: s.gain ?? true };
  const params = {
    playerClass,
    level,
    archetype,
    treeSettings,
    goal,
    cycle,
    minEhp,
    requireSustain: Boolean(s.requireSustain),
    excludeEvents: s.excludeEvents ?? true,
    tradeableOnly: Boolean(s.tradeableOnly),
    options: E.normalizeOptions(s.options || {}),
    powders: "auto",
  };
  const goalName = (Array.isArray(goal) ? goal : [goal]).map((id) => (goals.find((entry) => entry.id === id) || { name: String(id) }).name).join(" + ");
  const label = `${playerClass}/${archetype} L${level} ${goalName} EHP≥${ehpPct}%${cycleIds.length ? ` cycle ${cycleIds.join("")}@${cycle.cps}` : ""}${params.requireSustain ? " sustain" : ""}${params.tradeableOnly ? " tradeable" : ""}${params.excludeEvents ? "" : " +events"}${describeOptions(params.options)}`;
  return { label, params, meta: { ehpMax, ehpPct, goals, cycles, treeIds: tree.ids } };
}

function describeOptions(options) {
  const parts = [];
  if (options.attackSpeeds.length) parts.push(`speeds ${options.attackSpeeds.join("/")}`);
  if (options.avoidNegativeDefences) parts.push("no -def");
  if (options.excludedTiers.length) parts.push(`no ${options.excludedTiers.join("/")}`);
  const pinned = Object.entries(options.locked || {});
  if (pinned.length) parts.push(`pinned ${pinned.map(([slot, name]) => `${slot}=${name}`).join(",")}`);
  return parts.length ? ` [${parts.join("; ")}]` : "";
}

// JSON-safe copy of a scenario for the findings log (items by name, no functions).
export function scenarioForLog(scenario) {
  const { params } = scenario;
  return { label: scenario.label, ...params, treeSettings: { selected: params.treeSettings.selected } };
}
