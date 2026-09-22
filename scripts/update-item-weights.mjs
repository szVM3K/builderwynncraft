// Pobiera wagi przedmiotów z Wynnpoola (https://www.wynnpool.com, kod na licencji MIT:
// https://github.com/AiverAiva/Wynnpool) i zapisuje je jako src/item-weights.json.
//
// Zespół "Wynnpool Weight Team" ocenia, które identyfikacje naprawdę liczą się na danym przedmiocie. Jeden wpis to
// profil: nazwa (np. "Main", "Riftwalker", "Lootrun") i wagi identyfikacji, których wartości bezwzględne sumują się
// do 1. Aplikacja liczy z nich wynik 0-100 dokładnie tak samo jak wynnpool.com: suma(procent rolla × waga), a waga
// ujemna odwraca procent (im niższy roll, tym lepiej).
//
// Użycie:
//   node scripts/update-item-weights.mjs                  -> pobiera z API Wynnpoola
//   node scripts/update-item-weights.mjs ./weights.json    -> lokalna kopia odpowiedzi API
import fs from "node:fs";

const API = "https://api.wynnpool.com/item/weight/all";
const OUTPUT = new URL("../src/item-weights.json", import.meta.url);
const ITEMS = new URL("../src/wynncraft-items.json", import.meta.url);

// Nazwy identyfikacji z oficjalnego API Wynncrafta (tych używa Wynnpool) -> klucze Wynnbuildera, czyli te, którymi
// posługuje się cała aplikacja.
const ELEMENTS = { fire: "f", water: "w", air: "a", thunder: "t", earth: "e", neutral: "n", elemental: "r" };
const ID_MAP = {
  rawHealth: "hpBonus", healthRegen: "hprPct", healthRegenRaw: "hprRaw", manaRegen: "mr", manaSteal: "ms",
  lifeSteal: "ls", walkSpeed: "spd", sprint: "sprint", sprintRegen: "sprintReg", jumpHeight: "jh",
  lootBonus: "lb", combatExperience: "xpb", poison: "poison", reflection: "ref", exploding: "expd",
  thorns: "thorns", weakenEnemy: "weakenEnemy", slowEnemy: "slowEnemy", healingEfficiency: "healPct",
  mainAttackRange: "mainAttackRange", rawMaxMana: "maxMana", knockback: "kb", soulPointRegen: "spRegen",
  stealing: "eSteal", lootQuality: "lq", gatherXpBonus: "gXp", gatherSpeed: "gSpd",
  elementalDefence: "rDefPct", criticalDamageBonus: "critDamPct", rawAttackSpeed: "atkTier",
  strength: "str", dexterity: "dex", intelligence: "int", agility: "agi", defence: "def",
  damage: "damPct", rawDamage: "damRaw", spellDamage: "sdPct", rawSpellDamage: "sdRaw",
  mainAttackDamage: "mdPct", rawMainAttackDamage: "mdRaw",
};
const upper = (name) => name[0].toUpperCase() + name.slice(1);
for (const [element, prefix] of Object.entries(ELEMENTS)) {
  ID_MAP[`${element}Damage`] = `${prefix}DamPct`;
  ID_MAP[`raw${upper(element)}Damage`] = `${prefix}DamRaw`;
  ID_MAP[`${element}SpellDamage`] = `${prefix}SdPct`;
  ID_MAP[`raw${upper(element)}SpellDamage`] = `${prefix}SdRaw`;
  ID_MAP[`${element}MainAttackDamage`] = `${prefix}MdPct`;
  ID_MAP[`raw${upper(element)}MainAttackDamage`] = `${prefix}MdRaw`;
  if (element !== "neutral" && element !== "elemental") ID_MAP[`${element}Defence`] = `${prefix}DefPct`;
}
for (const [ordinal, index] of [["1st", "1"], ["2nd", "2"], ["3rd", "3"], ["4th", "4"]]) {
  ID_MAP[`${ordinal}SpellCost`] = `spPct${index}`;
  ID_MAP[`raw${upper(ordinal)}SpellCost`] = `spRaw${index}`;
}

async function fetchWeights(argument) {
  if (argument) return JSON.parse(fs.readFileSync(argument, "utf8"));
  const response = await fetch(API);
  if (!response.ok) throw new Error(`Wynnpool API returned HTTP ${response.status}`);
  return response.json();
}

function itemNames() {
  try {
    return new Set(JSON.parse(fs.readFileSync(ITEMS, "utf8")).items.map((item) => item.name));
  } catch {
    return null;
  }
}

async function main() {
  const raw = await fetchWeights(process.argv[2]);
  if (!Array.isArray(raw)) throw new Error("Expected an array of weights");
  const known = itemNames();
  const unknownIds = new Set();
  const missingItems = new Set();
  const weights = [];
  for (const entry of raw) {
    if (!entry || !entry.item_name || !entry.identifications) continue;
    if (known && !known.has(entry.item_name)) missingItems.add(entry.item_name);
    const ids = {};
    for (const [key, value] of Object.entries(entry.identifications)) {
      if (!value) continue; // waga 0 nie wnosi nic do wyniku
      const mapped = ID_MAP[key];
      if (!mapped) { unknownIds.add(key); continue; }
      ids[mapped] = value;
    }
    if (Object.keys(ids).length === 0) continue;
    const weight = { item: entry.item_name, name: entry.weight_name || "Main", updated: Math.round((entry.timestamp || 0) / 1000), ids };
    if (entry.description) weight.note = entry.description;
    weights.push(weight);
  }
  weights.sort((a, b) => a.item.localeCompare(b.item) || a.name.localeCompare(b.name));
  // Wagi każdego profilu powinny sumować się (co do modułu) do 1 - na tym opiera się skala 0-100.
  const offScale = weights.filter((entry) => Math.abs(Object.values(entry.ids).reduce((sum, value) => sum + Math.abs(value), 0) - 1) > 0.01);
  const data = {
    source: API,
    site: "https://www.wynnpool.com",
    credit: "Wynnpool Weight Team",
    license: "MIT (https://github.com/AiverAiva/Wynnpool)",
    fetchedAt: new Date().toISOString().slice(0, 10),
    weights,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(data));
  const items = new Set(weights.map((entry) => entry.item)).size;
  console.log(`Saved ${weights.length} weight profiles for ${items} items to src/item-weights.json`);
  if (unknownIds.size > 0) console.warn(`Unknown identification names (skipped): ${[...unknownIds].join(", ")}`);
  if (missingItems.size > 0) console.warn(`Not in the item database: ${[...missingItems].join(", ")}`);
  if (offScale.length > 0) console.warn(`Profiles whose weights do not sum to 1: ${offScale.map((entry) => `${entry.item}/${entry.name}`).join(", ")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
