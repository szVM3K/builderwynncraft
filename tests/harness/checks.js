// QA checks for one generated build. Every check is a *certificate*: when it reports a problem it also carries the
// concrete evidence (the better build, the broken requirement, the two numbers that disagree), so a finding can be
// reproduced and never depends on trusting the generator's own search.
//
// Severity:
//   error - a calculation or constraint bug, or a provably suboptimal result (a better build that satisfies every
//           filter was found by an independent search)
//   warn  - likely improvement / inefficiency (e.g. unspent skill points that would add damage, slow search)
//   info  - statistics worth watching, never fails a test
import { E, rng } from "./scenarios.js";

const SLOT_TYPE = Object.fromEntries(E.SLOTS.map((slot) => [slot.id, slot.type]));
const GEAR_SLOTS = E.SLOTS.map((slot) => slot.id).filter((id) => id !== "weapon");

export const DEFAULT_LIMITS = {
  gainError: 0.005, // a swap that adds > 0.5 % to the objective while passing every filter = the search missed it
  gainWarn: 0.0005,
  metricTolerance: 0.01, // generator metrics vs the UI's computeBuildStats()
  unspentWarn: 0.01, // free skill points that would add > 1 % damage
  pairsPerSlot: 4, // 2-opt: candidates per slot (by damage, by EHP, by mana) for pair swaps
  slowMs: 15000,
};

// ---------------------------------------------------------------------------------------------------------------
// Item eligibility - the generator's filters, re-implemented from the UI options (pinned items always allowed).
export function isEligible(params, item, slotId) {
  const options = params.options;
  const pinned = options.locked && options.locked[slotId];
  if (!item) return false;
  if (pinned) return item.name === pinned;
  if (item.level > params.level) return false;
  if (slotId === "weapon") {
    if (item.type !== E.CLASSES[params.playerClass].weapon) return false;
    if (options.attackSpeeds.length && !options.attackSpeeds.includes(item.atkSpd)) return false;
  } else if (item.type !== SLOT_TYPE[slotId]) return false;
  if ((options.excluded || []).includes(item.name)) return false;
  if ((options.excludedTiers || []).includes(item.tier)) return false;
  if (params.excludeEvents && E.eventOf(item)) return false;
  if (params.tradeableOnly && E.isUntradable(item)) return false;
  if (options.avoidNegativeDefences && E.hasNegativeDefence(item)) return false;
  return true;
}

let poolCache = new Map();
// The item database at the scenario's roll (100% = the default, like Wynnbuilder; 50% = "Realistic rolls").
export function itemsOf(params) {
  return params.rollPercent && params.rollPercent < 100 ? E.rolledItems(E.ITEM_DB, params.rollPercent) : E.ITEM_DB;
}
const byNameCache = new Map();
export function itemByName(params, name) {
  const percent = params.rollPercent && params.rollPercent < 100 ? params.rollPercent : 100;
  if (percent === 100) return E.ITEM_BY_NAME.get(name);
  if (!byNameCache.has(percent)) byNameCache.set(percent, new Map(itemsOf(params).map((item) => [item.name, item])));
  return byNameCache.get(percent).get(name);
}
export function eligiblePool(params, slotId) {
  const key = JSON.stringify([slotId, params.playerClass, params.level, params.options, params.excludeEvents, params.tradeableOnly, params.rollPercent || 100]);
  if (!poolCache.has(key)) {
    if (poolCache.size > 200) poolCache = new Map();
    poolCache.set(key, itemsOf(params).filter((item) => isEligible(params, item, slotId)));
  }
  return poolCache.get(key);
}

// ---------------------------------------------------------------------------------------------------------------
// Exact evaluation of a set of picks with the same formulas as the generator and the exact (equip-order) skill
// point solver. Returns metrics + feasibility against the scenario's hard filters.
export function makeEvaluator(params) {
  const ctx = E.damageGoalContext(params.playerClass, params.level, params.treeSettings);
  const cycle = E.normalizeCycle({ ...params.cycle, cps: params.cycle.cps || 9 });
  const cache = new Map();
  // extraSkills: undefined = free skill points spent like the generator does (allocateFreeSkillPoints: first to
  // pass the filters, then for damage); an object = exactly these extra points (null/{} = none).
  const evaluate = (picks, extraSkills) => {
    const auto = extraSkills === undefined;
    const key = auto ? E.SLOTS.map((slot) => (picks[slot.id] ? `${picks[slot.id].name}${powderKey(picks[slot.id])}` : "-")).join("|") : null;
    if (key && cache.has(key)) return cache.get(key);
    const items = E.SLOTS.map((slot) => picks[slot.id]).filter(Boolean);
    const weapon = picks.weapon || null;
    const sp = E.computeSkillPoints(items, true);
    const illegal = E.activeSets(items).some((set) => set.illegal);
    const clash = picks.ring1 && picks.ring2 && picks.ring1.name === picks.ring2.name && E.singleCopy(picks.ring1);
    const spBase = sp.total <= ctx.available && sp.capOverflow === 0;
    const judge = (m, extra) => {
      const spent = sp.total + E.SKILLS.reduce((sum, skill) => sum + ((extra && extra[skill]) || 0), 0);
      const spOk = spent <= ctx.available && sp.capOverflow === 0 && E.SKILLS.every((skill) => (sp.assigned[skill] || 0) + ((extra && extra[skill]) || 0) <= E.MAX_ASSIGNED_PER_SKILL);
      const ehpOk = params.minEhp <= 0 || m.ehp >= params.minEhp;
      const manaOk = E.manaOk(m, cycle);
      // life: the 0.37 range (lifeRange) or the old minimum (minSustain); walk speed: spdRange (null = Any)
      const lifeRange = params.lifeRange !== undefined ? E.normalizeRange(params.lifeRange) : params.minSustain > 0 ? { min: params.minSustain, max: null } : null;
      const inRange = (value, range) => !range || ((range.min === null || value >= range.min - 1e-9) && (range.max === null || value <= range.max + 1e-9));
      const sustainOk = (!params.requireSustain || m.sustain > 0) && inRange(m.sustain, lifeRange);
      const speedOk = inRange(m.walkSpeed, E.normalizeRange(params.spdRange));
      return { spOk, ehpOk, manaOk, sustainOk, speedOk, feasible: spOk && !illegal && !clash && ehpOk && manaOk && sustainOk && speedOk };
    };
    let extra = auto ? null : extraSkills;
    let m;
    if (auto && spBase && weapon && sp.total < ctx.available) {
      // same allocator as the generator; rank = passes the filters first, then damage
      const rank = (metrics) => {
        const j = judge(metrics, null);
        if (j.feasible) return 1e15 + metrics.damage;
        let miss = 0;
        if (!j.ehpOk) miss += 1 - metrics.ehp / params.minEhp;
        if (!j.manaOk) {
          const range = cycle.mana;
          const floor = range && range.min !== null ? range.min : null;
          if (range && range.max !== null && metrics.manaNet > range.max) miss += Math.min(1, (metrics.manaNet - range.max) / Math.max(range.min !== null ? range.max - range.min : 5, 1));
          else miss += metrics.manaUsed > 0 && floor !== null ? Math.max(0, 1 - (metrics.manaIncome + metrics.manaGain - floor) / metrics.manaUsed) : 1;
        }
        if (!j.sustainOk) miss += 0.5;
        if (!j.speedOk) miss += 0.5;
        return -miss;
      };
      const allocated = E.allocateFreeSkillPoints(ctx, items, weapon, sp, params.goal, cycle, rank);
      m = allocated.metrics;
      if (allocated.spent > 0) extra = allocated.extra;
    } else {
      const totals = extra ? Object.fromEntries(E.SKILLS.map((skill) => [skill, (sp.totals[skill] || 0) + (extra[skill] || 0)])) : sp.totals;
      m = E.evaluateGoal(ctx, items, weapon, totals, params.goal, cycle);
    }
    delete m.stats;
    const out = { ...m, sp, extra, illegal, clash, ...judge(m, extra) };
    if (key) {
      if (cache.size > 200000) cache.clear();
      cache.set(key, out);
    }
    return out;
  };
  return { ctx, cycle, evaluate };
}

export function picksOf(build) {
  return Object.fromEntries(build.slots.map((slot) => [slot.id, slot.item]));
}

// Powdered weapons are separate objects with `powders: { element, tier, count }`.
export function powderKey(item) {
  return item && item.powders ? `+${item.powders.count}x${item.powders.element}${item.powders.tier}` : "";
}

function namesOf(picks) {
  return Object.fromEntries(Object.entries(picks).map(([slot, item]) => [slot, item ? `${item.name}${item.powders ? ` (${item.powders.count}× ${item.powders.element} ${item.powders.tier})` : ""}` : null]));
}

function weaponVariants(base) {
  const variants = [base];
  if (base.slots > 0) E.ELEMENTS.forEach((element) => variants.push(E.powderedWeapon(base, element)));
  return variants;
}

// ---------------------------------------------------------------------------------------------------------------
// Independent skill point verifier (final state, the same rules the app documents: a gear item's requirement is
// checked against the assigned points plus the skill bonuses of all *other* gear; the weapon's against assigned
// plus all gear; set bonuses and the weapon's own bonuses never help a requirement).
export function verifySkillPoints(items, assigned, available) {
  const problems = [];
  const gear = items.filter((item) => item.category !== "weapon");
  const weapon = items.find((item) => item.category === "weapon");
  const gearBonus = Object.fromEntries(E.SKILLS.map((skill) => [skill, gear.reduce((sum, item) => sum + (item.stats[skill] || 0), 0)]));
  const spent = E.SKILLS.reduce((sum, skill) => sum + (assigned[skill] || 0), 0);
  if (spent > available) problems.push(`assigned ${spent} skill points, only ${available} available`);
  E.SKILLS.forEach((skill) => {
    if ((assigned[skill] || 0) < 0) problems.push(`negative assignment in ${skill}`);
    if ((assigned[skill] || 0) > E.MAX_ASSIGNED_PER_SKILL) problems.push(`${skill} assigned ${assigned[skill]} > cap ${E.MAX_ASSIGNED_PER_SKILL}`);
  });
  gear.forEach((item) => {
    E.SKILLS.forEach((skill) => {
      const req = item.reqs[skill] || 0;
      if (req <= 0) return;
      const have = (assigned[skill] || 0) + gearBonus[skill] - (item.stats[skill] || 0);
      if (have < req) problems.push(`${item.name} needs ${req} ${skill}, has ${have}`);
    });
  });
  if (weapon) {
    E.SKILLS.forEach((skill) => {
      const req = weapon.reqs[skill] || 0;
      if (req > 0 && (assigned[skill] || 0) + gearBonus[skill] < req) problems.push(`${weapon.name} needs ${req} ${skill}, has ${(assigned[skill] || 0) + gearBonus[skill]}`);
    });
  }
  return problems;
}

// Lower bound on the skill points any valid assignment needs (final-state rules only; equip order can only add).
export function skillPointLowerBound(items) {
  const gear = items.filter((item) => item.category !== "weapon");
  const weapon = items.find((item) => item.category === "weapon");
  let total = 0;
  E.SKILLS.forEach((skill) => {
    const gearBonus = gear.reduce((sum, item) => sum + (item.stats[skill] || 0), 0);
    let need = 0;
    gear.forEach((item) => {
      if ((item.reqs[skill] || 0) > 0) need = Math.max(need, item.reqs[skill] - (gearBonus - (item.stats[skill] || 0)));
    });
    if (weapon && (weapon.reqs[skill] || 0) > 0) need = Math.max(need, weapon.reqs[skill] - gearBonus);
    total += Math.max(0, need);
  });
  return total;
}

// ---------------------------------------------------------------------------------------------------------------
// The checks.
export async function checkBuild(scenario, build, { limits = DEFAULT_LIMITS, pairs = true, elapsedMs = null } = {}) {
  const { params } = scenario;
  const findings = [];
  const add = (severity, code, message, data = {}) => findings.push({ severity, code, message, data });
  const picks = picksOf(build);
  const items = Object.values(picks).filter(Boolean);
  const { evaluate } = makeEvaluator(params);
  const base = evaluate(picks);
  const asReported = evaluate(picks, build.skillPoints.free || null);

  // 1. Every slot holds an allowed item of the right type.
  E.SLOTS.forEach((slot) => {
    const item = picks[slot.id];
    if (!item) {
      if (eligiblePool(params, slot.id).length > 0) add("warn", "EMPTY_SLOT", `${slot.id} is empty although ${eligiblePool(params, slot.id).length} items are allowed`);
      return;
    }
    const baseItem = E.ITEM_BY_NAME.get(item.name) || item;
    if (!isEligible(params, baseItem, slot.id)) add("error", "FILTER_VIOLATION", `${slot.id}: ${item.name} breaks a filter (level ${item.level}, type ${item.type}, tier ${item.tier})`);
  });
  Object.entries(params.options.locked || {}).forEach(([slotId, name]) => {
    if (!picks[slotId] || picks[slotId].name !== name)
      add("error", "PINNED_DROPPED", `${name} was pinned to ${slotId} but the build has ${picks[slotId] ? picks[slotId].name : "nothing"} there${build.warnings && build.warnings.length ? "" : " - and no warning says so"}`);
  });
  if (base.illegal) add("error", "ILLEGAL_SET", "the build combines items of a set marked illegal");
  if (base.clash) add("error", "RING_DUPLICATE", `${picks.ring1.name} can only be owned once but is on both rings`);

  // 2. Skill points: the reported assignment must pass an independent verifier and add up.
  const sp = build.skillPoints;
  const spProblems = verifySkillPoints(items, sp.assigned, sp.available);
  if (sp.valid && spProblems.length) add("error", "SP_INVALID", `skill points marked valid but: ${spProblems.join("; ")}`, { assigned: sp.assigned });
  const setSkills = E.setBonusSkills(items);
  E.SKILLS.forEach((skill, index) => {
    const expected = (sp.assigned[skill] || 0) + items.reduce((sum, item) => sum + (item.stats[skill] || 0), 0) + (setSkills[index] || 0);
    if (Math.abs(expected - (sp.totals[skill] || 0)) > 0) add("error", "SP_TOTALS", `${skill} total ${sp.totals[skill]} but assigned + bonuses = ${expected}`);
  });
  const spent = E.SKILLS.reduce((sum, skill) => sum + (sp.assigned[skill] || 0), 0);
  if (spent !== sp.required) add("error", "SP_REQUIRED", `required ${sp.required} but assigned points sum to ${spent}`);
  const lower = skillPointLowerBound(items);
  if (sp.required < lower) add("error", "SP_BELOW_BOUND", `required ${sp.required} is below the lower bound ${lower} - impossible`);
  else if (sp.required > lower) add("info", "SP_ABOVE_BOUND", `equip order costs ${sp.required - lower} skill points over the final-state bound`, { lower, required: sp.required });

  // 3. Metrics agree with the UI's computeBuildStats() (independent code path for damage, EHP and mana).
  const stats = E.computeBuildStats(build, params.treeSettings);
  const close = (a, b, tol = limits.metricTolerance) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  // One goal, or several (their sum). If the generator's objective adds poison (evaluateGoal → poisonDps), add the
  // same share to the summary's number: DPS for the main attack, poison per cast for a spell (casts/s = clicks/s ÷ 3).
  const uiGoalDamage = (id) => {
    if (id === E.DAMAGE_GOAL_CYCLE) {
      // whole cycle: every spell once per cast + every main attack hit, per second of the cycle
      const ids = params.cycle.ids || [];
      const hps = stats.mainAttack ? stats.mainAttack.hps : E.HITS_PER_SECOND.NORMAL;
      const cps = params.cycle.cps || 9;
      const casts = ids.filter((entry) => entry !== 0).length;
      const seconds = (3 * casts) / cps + (ids.length - casts) * Math.max(1 / cps, 1 / hps);
      const total = ids.reduce((sum, entry) => {
        if (entry === 0) return sum + (stats.mainAttack ? stats.mainAttack.hit : 0);
        const found = stats.spells.find((spellEntry) => spellEntry.id === entry);
        return sum + (found && found.main && found.main.type === "damage" ? found.main.amount : 0);
      }, 0);
      return seconds > 0 ? total / seconds + (params.cycle.poison && total > 0 && asReported.poisonDps ? asReported.poisonDps : 0) : 0;
    }
    const spell = id === E.DAMAGE_GOAL_MAIN ? null : stats.spells.find((entry) => entry.id === id);
    let value = id === E.DAMAGE_GOAL_MAIN ? (stats.mainAttack ? stats.mainAttack.dps : 0) : spell && spell.main ? spell.main.amount : 0;
    const damaging = id === E.DAMAGE_GOAL_MAIN ? value > 0 : Boolean(spell && spell.main && spell.main.type === "damage" && value > 0);
    if (params.cycle.poison && damaging && asReported.poisonDps) value += id === E.DAMAGE_GOAL_MAIN ? asReported.poisonDps : asReported.poisonDps / (Math.max(0.1, params.cycle.cps || 9) / 3);
    return value;
  };
  const uiDamage = (Array.isArray(params.goal) ? params.goal : [params.goal]).reduce((sum, id) => sum + uiGoalDamage(id), 0);
  if (!close(build.metrics.damage, uiDamage)) add("error", "DAMAGE_MISMATCH", `generator damage ${Math.round(build.metrics.damage)} vs summary ${Math.round(uiDamage)}`);
  if (!close(build.metrics.ehp, stats.ehp)) add("error", "EHP_MISMATCH", `generator EHP ${Math.round(build.metrics.ehp)} vs summary ${Math.round(stats.ehp)}`);
  // walk speed: the number the Walk Speed range filters (evaluateGoal) is the one in the summary (computeBuildStats)
  if (Math.abs((asReported.walkSpeed || 0) - stats.walkSpeed) > 1e-6) add("error", "WALK_SPEED_MISMATCH", `generator walk speed ${asReported.walkSpeed} vs summary ${stats.walkSpeed}`);
  if (build.metrics.walkSpeed !== undefined && Math.abs(build.metrics.walkSpeed - stats.walkSpeed) > 1e-6) add("error", "WALK_SPEED_MISMATCH", `build walk speed ${build.metrics.walkSpeed} vs summary ${stats.walkSpeed}`);
  // a build outside a range must say so (the closest build is shown with a warning)
  if (!build.passed && !(build.warnings || []).length) add("error", "FAILED_WITHOUT_WARNING", "the build fails a filter but shows no warning");
  if (!close(build.metrics.damage, asReported.damage) || !close(build.metrics.ehp, asReported.ehp))
    add("error", "EVAL_MISMATCH", `generator metrics (${Math.round(build.metrics.damage)} / ${Math.round(build.metrics.ehp)}) differ from a re-evaluation with the same skill points (${Math.round(asReported.damage)} / ${Math.round(asReported.ehp)})`);
  if (params.cycle.ids.length) {
    // Independent re-computation from the summary: a spell = 3 clicks, M = one main attack (at least one click,
    // never faster than the weapon's attacks/s); Mana Steal only from those hits (Mana Steal ÷ 3 per attack/s each).
    const castIds = params.cycle.ids.filter((id) => id !== 0);
    const spells = castIds.map((id) => stats.spells.find((spell) => spell.id === id));
    if (spells.every(Boolean)) {
      const hps = stats.mainAttack ? stats.mainAttack.hps : E.HITS_PER_SECOND.NORMAL;
      const cps = params.cycle.cps || 9;
      const melee = params.cycle.ids.length - castIds.length;
      const seconds = (3 * castIds.length) / cps + melee * Math.max(1 / cps, 1 / hps);
      const used = spells.reduce((sum, spell) => sum + (spell.cost || 0), 0) / seconds;
      const gained = params.cycle.gain !== false ? spells.reduce((sum, spell) => sum + (spell.manaGained || 0), 0) / seconds : 0;
      const steal = params.cycle.steal !== false && melee > 0 ? ((melee / seconds) * (stats.manaSteal / 3)) / hps : 0;
      const income = (stats.manaRegen + 25) / 5 + steal + Math.max(0, Number(params.cycle.buff) || 0);
      const net = income + gained - used;
      if (Math.abs(net - build.metrics.manaNet) > 0.05 + 0.02 * Math.abs(net)) add("error", "MANA_MISMATCH", `generator mana ${build.metrics.manaNet.toFixed(2)}/s vs summary ${net.toFixed(2)}/s`);
    }
  }

  // 4. "passed" must mean every hard filter holds.
  if (build.passed && !asReported.feasible)
    add("error", "PASSED_BUT_INFEASIBLE", `build says it passes, but: ${[!asReported.spOk && "skill points", !asReported.ehpOk && `EHP ${Math.round(asReported.ehp)} < ${params.minEhp}`, !asReported.manaOk && `mana ${asReported.manaNet.toFixed(2)}/s`, !asReported.sustainOk && `sustain ${asReported.sustain.toFixed(1)}`, !asReported.speedOk && `walk speed ${Math.round(asReported.walkSpeed)}%`, asReported.illegal && "illegal set", asReported.clash && "ring duplicate"].filter(Boolean).join(", ")}`);
  if (!build.passed && asReported.feasible) add("error", "FEASIBLE_BUT_FAILED", "build reports a failed filter although every filter holds");

  // 5. Local optimality: no single swap (any allowed item, any powder element on the weapon) may improve the
  //    objective while passing every filter. For a failed build: no single swap may make it pass.
  const bestSwaps = {};
  const pairCandidates = {};
  for (const slot of E.SLOTS) {
    await tick();
    const pool = eligiblePool(params, slot.id);
    const variants = slot.id === "weapon" ? pool.flatMap(weaponVariants) : pool;
    const scored = [];
    variants.forEach((candidate) => {
      if (picks[slot.id] && candidate.name === picks[slot.id].name && powderKey(candidate) === powderKey(picks[slot.id])) return;
      const trial = { ...picks, [slot.id]: candidate };
      const metrics = evaluate(trial);
      scored.push({ candidate, metrics });
      if (!metrics.feasible) return;
      const gain = build.passed ? metrics.damage / Math.max(1e-9, build.metrics.damage) - 1 : Infinity;
      if (!bestSwaps[slot.id] || gain > bestSwaps[slot.id].gain) bestSwaps[slot.id] = { gain, candidate, metrics };
    });
    if (pairs) {
      const n = limits.pairsPerSlot;
      const byDamage = [...scored].sort((a, b) => b.metrics.damage - a.metrics.damage).slice(0, n);
      const byEhp = [...scored].sort((a, b) => b.metrics.ehp - a.metrics.ehp).slice(0, Math.ceil(n / 2));
      const byMana = params.cycle.ids.length ? [...scored].sort((a, b) => b.metrics.manaNet - a.metrics.manaNet).slice(0, Math.ceil(n / 2)) : [];
      const bySp = [...scored].sort((a, b) => a.metrics.sp.total - b.metrics.sp.total).slice(0, Math.ceil(n / 2));
      pairCandidates[slot.id] = [...new Set([...byDamage, ...byEhp, ...byMana, ...bySp].map((entry) => entry.candidate))];
    }
  }
  Object.entries(bestSwaps).forEach(([slotId, swap]) => {
    if (!build.passed) {
      add("error", "FAILED_BUT_ONE_SWAP_PASSES", `build fails its filters, but swapping ${slotId} to ${swap.candidate.name} passes them (damage ${Math.round(swap.metrics.damage)})`, { slotId, item: swap.candidate.name });
    } else if (swap.gain > limits.gainError) {
      add("error", "NOT_1OPT", `swap ${slotId}: ${picks[slotId] ? picks[slotId].name + powderKey(picks[slotId]) : "-"} → ${swap.candidate.name}${powderKey(swap.candidate)} gives +${(swap.gain * 100).toFixed(2)} % and passes every filter`, { slotId, from: picks[slotId] && picks[slotId].name, to: swap.candidate.name, damage: swap.metrics.damage });
    } else if (swap.gain > limits.gainWarn) {
      add("warn", "NEAR_1OPT", `swap ${slotId} → ${swap.candidate.name} gives +${(swap.gain * 100).toFixed(3)} %`);
    }
  });

  // 6. Pair swaps (2-opt, sampled): two slots at once, e.g. a stronger item plus the one that pays for its EHP.
  if (pairs) {
    const slots = Object.keys(pairCandidates);
    let best = null;
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        await tick();
        for (const a of pairCandidates[slots[i]]) {
          for (const b of pairCandidates[slots[j]]) {
            const trial = { ...picks, [slots[i]]: a, [slots[j]]: b };
            const metrics = evaluate(trial);
            if (!metrics.feasible) continue;
            const gain = build.passed ? metrics.damage / Math.max(1e-9, build.metrics.damage) - 1 : Infinity;
            if (!best || gain > best.gain) best = { gain, swap: { [slots[i]]: a.name, [slots[j]]: b.name }, metrics };
          }
        }
      }
    }
    if (best && !build.passed) add("error", "FAILED_BUT_PAIR_PASSES", `build fails its filters, but the pair swap ${JSON.stringify(best.swap)} passes them`, best.swap);
    else if (best && best.gain > limits.gainError) add("error", "NOT_2OPT", `pair swap ${JSON.stringify(best.swap)} gives +${(best.gain * 100).toFixed(2)} % and passes every filter`, { swap: best.swap, damage: best.metrics.damage });
  }

  // 7. Unspent skill points: the game lets you put the remaining points anywhere. If they would add damage, the
  //    reported damage (and possibly the choice of items) leaves value on the table.
  const free = sp.available - sp.required;
  if (build.passed && free > 0) {
    const extra = { str: 0, dex: 0, int: 0, def: 0, agi: 0 };
    E.SKILLS.forEach((skill) => (extra[skill] = (build.skillPoints.free && build.skillPoints.free[skill]) || 0));
    const start = { ...extra };
    let left = free;
    let current = asReported;
    while (left > 0) {
      const chunk = Math.max(1, Math.ceil(left / 4));
      let bestStep = null;
      E.SKILLS.forEach((skill) => {
        const room = E.MAX_ASSIGNED_PER_SKILL - (sp.assigned[skill] || 0) - (extra[skill] - start[skill]);
        const amount = Math.min(chunk, room, left);
        if (amount <= 0) return;
        const metrics = evaluate(picks, { ...extra, [skill]: extra[skill] + amount });
        if (!metrics.feasible) return;
        if (!bestStep || metrics.damage > bestStep.metrics.damage) bestStep = { skill, amount, metrics };
      });
      if (!bestStep || bestStep.metrics.damage <= current.damage + 1e-9) break;
      extra[bestStep.skill] += bestStep.amount;
      left -= bestStep.amount;
      current = bestStep.metrics;
    }
    const gain = current.damage / Math.max(1e-9, build.metrics.damage) - 1;
    const added = Object.entries(extra).filter(([skill, value]) => value > start[skill]).map(([skill, value]) => `${value - start[skill]} ${skill}`);
    if (gain > limits.unspentWarn) add("warn", "UNSPENT_SP", `${free} free skill points would add +${(gain * 100).toFixed(1)} % (${added.join(", ")})`, { free, gain });
    else add("info", "FREE_SP", `${free} skill points unused (no damage gain)`, { free });
  }

  // 8. Guide builds (level 100+): every complete guide build of the archetype that passes the filters is a
  //    candidate the generator starts from, so the result can never be weaker than one of them.
  if (build.passed && params.level >= 100) {
    (E.GUIDE_DATA.builds || [])
      .filter((entry) => entry.class === params.playerClass && entry.archetype === params.archetype)
      .forEach((entry) => {
        const guidePicks = {};
        const complete = E.SLOTS.every((slot) => {
          const item = itemByName(params, entry.items[slot.id]);
          if (!item || !isEligible(params, item, slot.id)) return false;
          guidePicks[slot.id] = item;
          return true;
        });
        if (!complete) return;
        weaponVariants(guidePicks.weapon).forEach((weapon) => {
          const metrics = evaluate({ ...guidePicks, weapon });
          if (metrics.feasible && metrics.damage > build.metrics.damage * (1 + limits.gainError))
            add("error", "BELOW_GUIDE", `guide build "${entry.name}" passes every filter and deals ${Math.round(metrics.damage)} vs ${Math.round(build.metrics.damage)}`, { guide: entry.name });
        });
      });
  }

  if (elapsedMs !== null && elapsedMs > limits.slowMs) add("warn", "SLOW", `generation took ${(elapsedMs / 1000).toFixed(1)} s`);
  return { findings, base, picks: namesOf(picks) };
}

// Portfolio certificate: any build found by *any* run (another goal, another EHP threshold, another cycle…) is
// re-evaluated exactly under this scenario's filters. If it passes them and deals more damage, this scenario's
// result is provably suboptimal - no trust in the generator needed. Builds from the same class + level + tree are
// the useful ones (the tree changes the spells).
export function checkPortfolio(scenario, build, portfolio, limits = DEFAULT_LIMITS) {
  const findings = [];
  const { evaluate } = makeEvaluator(scenario.params);
  let best = null;
  portfolio.forEach((entry) => {
    if (entry.build === build) return;
    if (entry.scenario.params.playerClass !== scenario.params.playerClass) return;
    const picks = picksOf(entry.build);
    if (!E.SLOTS.every((slot) => !picks[slot.id] || isEligible(scenario.params, E.ITEM_BY_NAME.get(picks[slot.id].name) || picks[slot.id], slot.id))) return;
    const metrics = evaluate(picks);
    if (!metrics.feasible) return;
    if (!best || metrics.damage > best.metrics.damage) best = { entry, metrics, picks };
  });
  if (!best) return findings;
  if (!build.passed) {
    findings.push({ severity: "error", code: "FAILED_BUT_KNOWN_PASS", message: `no passing build found, but the build from "${best.entry.scenario.label}" passes these filters`, data: { from: best.entry.scenario.label, picks: namesOf(best.picks) } });
    return findings;
  }
  const gap = best.metrics.damage / Math.max(1e-9, build.metrics.damage) - 1;
  if (gap > limits.gainError)
    findings.push({
      severity: "error",
      code: "BETTER_BUILD_KNOWN",
      message: `the build from "${best.entry.scenario.label}" also passes these filters and deals ${Math.round(best.metrics.damage)} vs ${Math.round(build.metrics.damage)} (+${(gap * 100).toFixed(2)} %)`,
      data: { from: best.entry.scenario.label, picks: namesOf(best.picks), gain: gap },
    });
  return findings;
}

// Give the event loop a turn (vitest's worker RPC times out when a test blocks it for too long).
export const tick = () => new Promise((resolve) => setImmediate(resolve));

export async function generate(scenario) {
  const started = performance.now();
  // a no-op onProgress makes the generator pause between stages, like in the browser
  const build = await E.generateDamageBuild({ ...scenario.params, onProgress: () => {} });
  return { build, ms: performance.now() - started };
}

export function summarize(findings) {
  const counts = {};
  findings.forEach((finding) => {
    const key = `${finding.severity}:${finding.code}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

// ---------------------------------------------------------------------------------------------------------------
// DEEP certificate (npm run test:deep): stronger than checkBuild's sampled 2-opt.
//  - Candidate list per slot from ALL single swaps (feasible or not): best by damage, by EHP, by lowest skill point
//    cost, by mana (with a cycle), the strongest ones that break a filter on their own (they need a partner that
//    pays for them - the typical 2-opt move) and "slot empty". About 30-40 per slot.
//  - Pairs: every pair of slots (36) × every combination of their lists - exhaustive on those lists.
//  - Triples: every triple of slots (84) × the top few of each list, plus `triples` random triples from the full lists.
// Any move that passes every filter and beats the build by more than limits.gainError is an error: the generator
// provably left that much on the table. The best gains found (even tiny ones) are reported, so a run also measures
// how close the builds are to optimal within these neighbourhoods.
export async function deepCheck(scenario, build, { perSlot = 16, tripleTop = 5, triples = 5000, seed = 1, limits = DEFAULT_LIMITS } = {}) {
  const started = performance.now();
  const { params } = scenario;
  const picks = picksOf(build);
  const { evaluate } = makeEvaluator(params);
  const findings = [];
  const add = (severity, code, message, data = {}) => findings.push({ severity, code, message, data });
  const damage = build.metrics.damage;
  const gainOf = (metrics) => (build.passed ? metrics.damage / Math.max(1e-9, damage) - 1 : Infinity);
  const pinned = params.options.locked || {};
  const key = (item) => (item ? `${item.name}${powderKey(item)}` : "-");

  const lists = {};
  let singleEvals = 0;
  for (const slot of E.SLOTS) {
    await tick();
    if (pinned[slot.id]) {
      lists[slot.id] = [];
      continue;
    }
    const pool = eligiblePool(params, slot.id);
    const variants = slot.id === "weapon" ? pool.flatMap(weaponVariants) : pool;
    const scored = [];
    variants.forEach((candidate) => {
      if (key(candidate) === key(picks[slot.id])) return;
      scored.push({ candidate, metrics: evaluate({ ...picks, [slot.id]: candidate }) });
      singleEvals += 1;
    });
    const top = (list, score, count) => [...list].sort((a, b) => score(b) - score(a)).slice(0, count).map((entry) => entry.candidate);
    const chosen = [
      ...top(scored, (entry) => entry.metrics.damage, perSlot),
      ...top(scored, (entry) => entry.metrics.ehp, Math.ceil(perSlot / 2)),
      ...top(scored, (entry) => -entry.metrics.sp.total, Math.ceil(perSlot / 2)),
      ...(params.cycle.ids.length ? top(scored, (entry) => entry.metrics.manaNet, Math.ceil(perSlot / 2)) : []),
      ...top(scored.filter((entry) => !entry.metrics.feasible), (entry) => entry.metrics.damage, Math.ceil(perSlot / 2)),
    ];
    const unique = [...new Map(chosen.map((item) => [key(item), item])).values()];
    lists[slot.id] = slot.id === "weapon" ? unique : [...unique, null];
  }

  // Pairs - exhaustive over the lists
  const slots = E.SLOTS.map((slot) => slot.id).filter((id) => lists[id].length > 0);
  let bestPair = null;
  let pairEvals = 0;
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      await tick();
      for (const a of lists[slots[i]]) {
        for (const b of lists[slots[j]]) {
          if (!a && slots[i] === "weapon") continue;
          const trial = { ...picks, [slots[i]]: a, [slots[j]]: b };
          const metrics = evaluate(trial);
          pairEvals += 1;
          if (!metrics.feasible) continue;
          const gain = gainOf(metrics);
          if (!bestPair || gain > bestPair.gain) bestPair = { gain, move: { [slots[i]]: key(a), [slots[j]]: key(b) }, damage: metrics.damage };
        }
      }
    }
  }

  // Triples - systematic on the top of each list, then random over the full lists
  let bestTriple = null;
  let tripleEvals = 0;
  const tryTriple = (s1, a, s2, b, s3, c) => {
    const trial = { ...picks, [s1]: a, [s2]: b, [s3]: c };
    const metrics = evaluate(trial);
    tripleEvals += 1;
    if (!metrics.feasible) return;
    const gain = gainOf(metrics);
    if (!bestTriple || gain > bestTriple.gain) bestTriple = { gain, move: { [s1]: key(a), [s2]: key(b), [s3]: key(c) }, damage: metrics.damage };
  };
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      await tick();
      for (let k = j + 1; k < slots.length; k += 1) {
        for (const a of lists[slots[i]].slice(0, tripleTop)) for (const b of lists[slots[j]].slice(0, tripleTop)) for (const c of lists[slots[k]].slice(0, tripleTop)) tryTriple(slots[i], a, slots[j], b, slots[k], c);
      }
    }
  }
  const random = rng(seed);
  for (let n = 0; n < triples && slots.length >= 3; n += 1) {
    if (n % 500 === 0) await tick();
    const chosen = [];
    while (chosen.length < 3) {
      const slotId = random.pick(slots);
      if (!chosen.includes(slotId)) chosen.push(slotId);
    }
    const [s1, s2, s3] = chosen;
    const a = random.pick(lists[s1]);
    const b = random.pick(lists[s2]);
    const c = random.pick(lists[s3]);
    if ((!a && s1 === "weapon") || (!b && s2 === "weapon") || (!c && s3 === "weapon")) continue;
    tryTriple(s1, a, s2, b, s3, c);
  }

  for (const [code, best, label] of [
    ["NOT_2OPT_DEEP", bestPair, "pair"],
    ["NOT_3OPT", bestTriple, "triple"],
  ]) {
    if (!best) continue;
    if (!build.passed) add("error", `FAILED_BUT_${label.toUpperCase()}_PASSES`, `build fails its filters, but the ${label} ${JSON.stringify(best.move)} passes them`, best);
    else if (best.gain > limits.gainError) add("error", code, `${label} ${JSON.stringify(best.move)} gives +${(best.gain * 100).toFixed(2)} % and passes every filter`, best);
    else if (best.gain > limits.gainWarn) add("warn", `NEAR_${code}`, `${label} ${JSON.stringify(best.move)} gives +${(best.gain * 100).toFixed(3)} %`, best);
  }
  const stats = {
    listSizes: Object.fromEntries(slots.map((id) => [id, lists[id].length])),
    singleEvals,
    pairEvals,
    tripleEvals,
    bestPairGain: bestPair ? bestPair.gain : null,
    bestTripleGain: bestTriple ? bestTriple.gain : null,
    ms: Math.round(performance.now() - started),
  };
  return { findings, stats };
}
