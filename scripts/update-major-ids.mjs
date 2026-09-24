// Pobiera opisy i efekty major ID z Wynnbuildera (data/<wersja>/majid.json) i zapisuje src/major-ids.json:
//  - tylko major ID używane przez przedmioty albo bonusy setów z src/wynncraft-items.json (ta sama wersja danych),
//  - pola: displayName (nazwa jak w grze), description (opis jak w grze), abilities (efekty w formacie węzłów
//    drzewka: class, base_abil, dependencies, properties, effects - aplikacja dokleja je do drzewka jak aspekty).
// Kończy się błędem, gdy jakiś major ID z przedmiotów nie ma opisu - wtedy dane przedmiotów i major ID się rozjechały.
// Źródło: dane Wynnbuildera (github.com/wynnbuilder/wynnbuilder.github.io, GPL-3.0), js/load_item.js load_major_id_data.
//
//   npm run update-major-ids            (wersja = wersja src/wynncraft-items.json)
//   npm run update-major-ids 2.2.4.0
import fs from "node:fs";

const REPO = "https://raw.githubusercontent.com/wynnbuilder/wynnbuilder.github.io/master";
const here = new URL("../src/", import.meta.url);
const OUTPUT = new URL("major-ids.json", here);
const itemsData = JSON.parse(fs.readFileSync(new URL("wynncraft-items.json", here), "utf8"));
const VERSION = process.argv[2] || itemsData.version;

const response = await fetch(`${REPO}/data/${VERSION}/majid.json`);
if (!response.ok) throw new Error(`majid.json ${VERSION}: HTTP ${response.status}`);
const all = await response.json();

// major ID z przedmiotów i z bonusów setów (np. Relic: Major ID na pełnym secie)
const used = new Map();
const note = (key, where) => {
  if (!used.has(key)) used.set(key, []);
  used.get(key).push(where);
};
(itemsData.items || []).forEach((item) => (item.majorIds || []).forEach((key) => note(key, item.name)));
Object.entries(itemsData.sets || {}).forEach(([name, set]) =>
  (set.bonuses || []).forEach((bonus, index) => ((bonus && bonus.majorIds) || []).forEach((key) => note(key, `${name} set (${index + 1} pieces)`)))
);

const missing = [...used.keys()].filter((key) => !all[key] || typeof all[key].description !== "string" || !all[key].description.trim());
if (missing.length > 0) {
  console.error(`No description in majid.json ${VERSION} for: ${missing.map((key) => `${key} (${used.get(key).slice(0, 3).join(", ")})`).join("; ")}`);
  process.exit(1);
}

const majorIds = {};
[...used.keys()].sort().forEach((key) => {
  const entry = all[key];
  majorIds[key] = {
    displayName: entry.displayName || key,
    description: entry.description.trim(),
    abilities: (entry.abilities || []).map((ability) => {
      const out = { class: ability.class || "Any" };
      if (ability.base_abil !== undefined) out.base_abil = ability.base_abil;
      if (ability.dependencies && ability.dependencies.length > 0) out.dependencies = ability.dependencies;
      if (ability.properties && Object.keys(ability.properties).length > 0) out.properties = ability.properties;
      out.effects = ability.effects || [];
      return out;
    }),
    ...(entry.hidden ? { hidden: true } : {}),
  };
});

const withEffects = Object.values(majorIds).filter((entry) => entry.abilities.some((ability) => ability.effects.length > 0)).length;
fs.writeFileSync(
  OUTPUT,
  `${JSON.stringify({ version: VERSION, source: `${REPO}/data/${VERSION}/majid.json`, license: "GPL-3.0 (Wynnbuilder)", count: Object.keys(majorIds).length, majorIds })}\n`
);
console.log(`src/major-ids.json: ${Object.keys(majorIds).length} major IDs (${withEffects} with effects, ${Object.keys(majorIds).length - withEffects} description only) of ${Object.keys(all).length} in majid.json ${VERSION}`);
