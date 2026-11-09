// Odtwarza układ drzewek umiejętności (węzły, pozycje, koszty, wymagania, archetypy) w src/ability-trees.json
// z atree.json Wynnbuildera dla podanej wersji danych gry. update-tree-effects.mjs dopisuje tylko efekty do węzłów,
// które już są w pliku - po zmianie drzewek w grze (np. Shaman i Mage w 2.2.5) potrzebny jest ten skrypt.
// Użycie:
//   node scripts/update-trees.mjs 2.2.5.0       -> atree.json z repozytorium Wynnbuildera
//   node scripts/update-trees.mjs ./atree.json  -> lokalny plik (wersja z drugiego argumentu, np. 2.2.5.0)
// Zawsze bierzemy świeże dane: Wynnbuilder poprawia też starsze wersje w miejscu (np. 2.2.4.0: koszt Blood Pact,
// Malediction, przeróbka Ritualista - poprawki z września i października 2026), więc różnica względem pliku to zwykle
// poprawka u źródła, a nie ręczna zmiana do zachowania.
// Pola węzła w aplikacji: id, name, desc, parents, deps, blockers, cost, arch, archReq, row, col, icon, base (gdy jest
// base_abil), props, effects. apByLevel i reszta nagłówka zostają bez zmian.
// Dane: Wynnbuilder (github.com/wynnbuilder/wynnbuilder.github.io, GPL-3.0), same dane gry, bez kodu.
import fs from "node:fs";

const REPO = "wynnbuilder/wynnbuilder.github.io";
const OUTPUT = new URL("../src/ability-trees.json", import.meta.url);
const trees = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));

const argument = process.argv[2];
if (!argument) throw new Error("Give the data version, e.g. node scripts/update-trees.mjs 2.2.5.0");
let atree;
let version = argument;
let source;
if (fs.existsSync(argument)) {
  atree = JSON.parse(fs.readFileSync(argument, "utf8"));
  version = process.argv[3] || trees.version;
  source = argument;
} else {
  source = `https://raw.githubusercontent.com/${REPO}/master/data/${version}/atree.json`;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${source}`);
  atree = await response.json();
}

const convert = (node) => {
  const out = {
    id: node.id,
    name: node.display_name,
    desc: node.desc,
    parents: node.parents || [],
    deps: node.dependencies || [],
    blockers: node.blockers || [],
    cost: node.cost,
    arch: node.archetype || null,
    archReq: node.archetype_req || 0,
    row: node.display.row,
    col: node.display.col,
    icon: node.display.icon,
  };
  if (node.base_abil !== undefined) out.base = node.base_abil;
  if (node.properties && Object.keys(node.properties).length > 0) out.props = node.properties;
  if (node.effects && node.effects.length > 0) out.effects = node.effects;
  return out;
};

const report = {};
Object.keys(trees.classes).forEach((playerClass) => {
  const nodes = atree[playerClass];
  if (!Array.isArray(nodes)) throw new Error(`atree.json has no tree for ${playerClass}`);
  const before = new Set(trees.classes[playerClass].map((node) => node.name));
  const next = nodes
    .map(convert)
    .sort((a, b) => a.id - b.id);
  const after = new Set(next.map((node) => node.name));
  report[playerClass] = {
    nodes: next.length,
    added: [...after].filter((name) => !before.has(name)),
    removed: [...before].filter((name) => !after.has(name)),
  };
  trees.classes[playerClass] = next;
});
trees.version = version;
trees.source = `Wynnbuilder data/${version}/atree.json (game data), checked against wynncraft.wiki.gg class pages`;
trees.effectsSource = `https://raw.githubusercontent.com/${REPO}/master/data/${version}/atree.json`;
fs.writeFileSync(OUTPUT, `${JSON.stringify(trees)}\n`);
console.log(`Ability trees ${version} from ${source}:`);
Object.entries(report).forEach(([playerClass, entry]) => {
  console.log(`  ${playerClass}: ${entry.nodes} nodes${entry.added.length ? `, new: ${entry.added.join(", ")}` : ""}${entry.removed.length ? `, removed: ${entry.removed.join(", ")}` : ""}`);
});
