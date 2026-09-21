// Dopisuje efekty węzłów drzewka (effects, properties, base_abil) z atree.json Wynnbuildera do src/ability-trees.json.
// Aplikacja liczy z nich bonusy do statystyk, przełączniki, suwaki i obrażenia czarów w podsumowaniu buildu.
// Użycie:
//   node scripts/update-tree-effects.mjs               -> atree.json z wersji zapisanej w ability-trees.json
//   node scripts/update-tree-effects.mjs 2.2.4.0       -> konkretna wersja danych
//   node scripts/update-tree-effects.mjs ./atree.json  -> lokalny plik
// Dane: Wynnbuilder (github.com/wynnbuilder/wynnbuilder.github.io, GPL-3.0), same dane gry, bez kodu.
import fs from "node:fs";

const REPO = "wynnbuilder/wynnbuilder.github.io";
const OUTPUT = new URL("../src/ability-trees.json", import.meta.url);
const trees = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));

const argument = process.argv[2];
let atree;
let source;
if (argument && fs.existsSync(argument)) {
  atree = JSON.parse(fs.readFileSync(argument, "utf8"));
  source = argument;
} else {
  const version = argument || trees.version;
  source = `https://raw.githubusercontent.com/${REPO}/master/data/${version}/atree.json`;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${source}`);
  atree = await response.json();
}

let updated = 0;
let missing = 0;
Object.entries(trees.classes).forEach(([playerClass, nodes]) => {
  const byId = new Map((atree[playerClass] || []).map((node) => [node.id, node]));
  nodes.forEach((node) => {
    const raw = byId.get(node.id);
    delete node.base;
    delete node.props;
    delete node.effects;
    if (!raw) {
      missing += 1;
      return;
    }
    if (raw.base_abil !== undefined) node.base = raw.base_abil;
    if (raw.properties && Object.keys(raw.properties).length > 0) node.props = raw.properties;
    if (Array.isArray(raw.effects) && raw.effects.length > 0) node.effects = raw.effects;
    updated += 1;
  });
});
trees.effectsSource = source.startsWith("http") ? source : `local file ${source}`;
fs.writeFileSync(OUTPUT, JSON.stringify(trees));
console.log(`Added effects to ${updated} nodes (${missing} nodes not found in atree.json) -> ${OUTPUT.pathname}`);
