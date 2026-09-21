// Pobiera bazę przedmiotów Wynnbuildera i zapisuje ją jako src/wynncraft-items.json (tylko pola używane przez aplikację).
// Użycie:
//   node scripts/update-items.mjs              -> najnowsza wersja danych z repozytorium Wynnbuildera
//   node scripts/update-items.mjs 2.2.4.0      -> konkretna wersja danych
//   node scripts/update-items.mjs ./items.json -> lokalny plik items.json
import fs from "node:fs";

const REPO = "wynnbuilder/wynnbuilder.github.io";
const OUTPUT = new URL("../src/wynncraft-items.json", import.meta.url);
// Pola Wynnbuildera, których aplikacja nie potrzebuje (opisy, dane o dropie, wewnętrzne ID).
const SKIP = new Set([
  "lore", "dropInfo", "emblem", "id", "category", "sets", "classReq",
  "allowCraftsman", "persistent", "remapID", "armourMaterial", "icon",
]);

// dropInfo (obiekt albo lista) -> [{ type, name, event, coords }], bez pustych pól.
function compactDropInfo(dropInfo) {
  const list = Array.isArray(dropInfo) ? dropInfo : dropInfo ? [dropInfo] : [];
  return list
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const out = { type: entry.type };
      if (entry.name) out.name = entry.name;
      if (entry.event) out.event = entry.event;
      if (Array.isArray(entry.coordinates)) out.coords = entry.coordinates.slice(0, 3);
      return out;
    });
}

// "leggings.pale_diamond" -> "pale_diamond", "ring.fire2" -> "fire", "wand.basicGold" -> "basicGold"
function iconTheme(icon) {
  const name = icon && icon.value && typeof icon.value === "object" ? icon.value.name : null;
  if (!name) return null;
  return name.split(".").slice(1).join(".").replace(/\d+$/, "") || null;
}

function compareVersions(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  }
  return 0;
}

async function latestVersion() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/contents/data`);
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  const versions = (await response.json())
    .filter((entry) => entry.type === "dir" && /^\d+(\.\d+)+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersions);
  if (versions.length === 0) throw new Error("No data versions found in the Wynnbuilder repository");
  return versions[versions.length - 1];
}

function compactItem(item) {
  if (!item.type || item.lvl === undefined || item.lvl === null) return null;
  const compact = {};
  // Identyfikacje zapisane jako { static: true, raw } (np. tier szybkości ataku) nie rollują się: trafiają do staticIds.
  const staticIds = [];
  Object.entries(item).forEach(([key, rawValue]) => {
    if (SKIP.has(key)) return;
    let value = rawValue;
    if (value === undefined || value === null || value === 0 || value === "") return;
    if (key === "displayName" && value === item.name) return;
    if (key === "fixID") {
      if (value === true) compact.fixID = true;
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return;
    } else if (typeof value === "object") {
      if (value.static) staticIds.push(key);
      value = value.raw || 0;
    }
    if (key.endsWith("Dam") && value === "0-0") return;
    if (value === 0) return;
    compact[key] = value;
  });
  if (staticIds.length > 0) compact.staticIds = staticIds;
  const theme = iconTheme(item.icon);
  if (theme) compact.icon = theme;
  const sources = compactDropInfo(item.dropInfo);
  if (sources.length > 0) compact.sources = sources;
  return compact;
}

const argument = process.argv[2];
let raw;
let version;
let source;
if (argument && fs.existsSync(argument)) {
  raw = JSON.parse(fs.readFileSync(argument, "utf8"));
  version = argument.match(/\d+(\.\d+)+/)?.[0] || "local";
  source = version === "local" ? argument : `https://raw.githubusercontent.com/${REPO}/master/data/${version}/items.json`;
} else {
  version = argument || (await latestVersion());
  source = `https://raw.githubusercontent.com/${REPO}/master/data/${version}/items.json`;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${source}`);
  raw = await response.json();
}

const items = (Array.isArray(raw) ? raw : raw.items).map(compactItem).filter(Boolean);
fs.writeFileSync(OUTPUT, JSON.stringify({ version, source, items }));
console.log(`Saved ${items.length} items (Wynnbuilder data ${version}) to ${OUTPUT.pathname}`);
