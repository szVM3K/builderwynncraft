// Pobiera tomy i aspekty Wynnbuildera i zapisuje je jako src/tomes-aspects.json:
//  - "tomes": tylko tomy, które istnieją w grze po przeróbce 2.1 (bez Weapon/Armour Mastery, Slaying, Gathering,
//    Dungeoneering i starych Lootrun Mastery - Wynnbuilder trzyma je jeszcze dla starych linków),
//  - "aspects": aspekty każdej klasy z węzłami drzewka, które wzmacniają (id z ability-trees.json),
//  - "guide": tomy i aspekty odczytane z linków Wynnbuildera buildów poradnika (src/guide-builds.json +
//    scripts/extra-guide-links.json) - wzorzec, z którym porównujemy rekomendacje w zakładkach Aspects i Tomes.
// Źródła: dane Wynnbuildera (github.com/wynnbuilder/wynnbuilder.github.io, GPL-3.0) - tomes.json, aspects.json,
// encoding_consts.json każdej wersji i lista wersji z js/load_item.js; format linku jak w build_encode_decode.js.
//
//   npm run update-tomes-aspects
import fs from "node:fs";

const REPO = "https://raw.githubusercontent.com/wynnbuilder/wynnbuilder.github.io/master";
const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+-";
const here = new URL("../src/", import.meta.url);
const OUTPUT = new URL("tomes-aspects.json", here);
const guides = JSON.parse(fs.readFileSync(new URL("guide-builds.json", here), "utf8"));
const extra = JSON.parse(fs.readFileSync(new URL("./extra-guide-links.json", import.meta.url), "utf8"));
const appTrees = JSON.parse(fs.readFileSync(new URL("ability-trees.json", here), "utf8"));
// Wersja danych = wersja drzewek aplikacji: id węzłów w aspektach muszą pasować do ability-trees.json.
const VERSION = process.argv[2] || appTrees.version;

async function getJson(path) {
  const response = await fetch(`${REPO}/${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

// Typ tomu w Wynnbuilderze -> slot w grze. Nazwy typów zostały po starych tomach XP (Wynnbuilder ich nie zmienia).
const TOME_SLOT = {
  weaponTome: "weapon",
  armorTome: "armour",
  gatherXpTome: "marathon",
  dungeonXpTome: "mysticism",
  mobXpTome: "expertise",
  lootrunTome: "lootrun",
  guildTome: "guild",
};
// Tomy usunięte w 2.1 Rekindled World (i stare Lootrun Mastery z remapID) - nie da się ich już zdobyć.
const LEGACY_TOME = /Weapon Mastery|Armour Mastery|Slaying Mastery|Gathering Mastery|Dungeoneering Mastery|Lootrun Mastery/;
const TOME_SKIP = new Set(["name", "displayName", "type", "tier", "lvl", "icon", "emblem", "restrict", "drop", "allowCraftsman", "category", "fixID", "alias", "id", "remapID"]);

function compactTome(raw) {
  const ids = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (TOME_SKIP.has(key) || typeof value !== "number" || value === 0) return;
    ids[key] = value;
  });
  return { id: raw.id, name: raw.displayName || raw.name, slot: TOME_SLOT[raw.type], tier: raw.tier, lvl: raw.lvl, ids };
}

// Opis aspektu jest w HTML Wynnbuildera ("</br>", <span>) - do aplikacji idzie czysty tekst, linia po linii.
function plainLines(description) {
  return String(description || "")
    .split(/<\/?br\s*\/?>/i)
    .map((line) => line.replace(/<[^>]+>/g, "").replace(/&[A-Za-z0-9]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// Węzły drzewka, które aspekt wzmacnia: base_abil i dependencies z danych, a gdy ich brak (część aspektów ma
// tylko opis) - węzły, których nazwa pada w opisie najwyższego tieru. Najdłuższe nazwy najpierw, żeby
// "Arrow Storm" nie łapało się jako "Arrow".
function aspectNodes(aspect, treeNodes) {
  const ids = new Set();
  aspect.tiers.forEach((tier) =>
    (tier.abilities || []).forEach((ability) => {
      if (Number.isInteger(ability.base_abil) && ability.base_abil !== 999) ids.add(ability.base_abil);
      (ability.dependencies || []).forEach((id) => ids.add(id));
    })
  );
  const known = new Set(treeNodes.map((node) => node.id));
  const valid = [...ids].filter((id) => known.has(id));
  let text = plainLines(aspect.tiers[aspect.tiers.length - 1].description).join(" ");
  [...treeNodes]
    .sort((a, b) => b.name.length - a.name.length)
    .forEach((node) => {
      if (node.name.length < 4 || !text.includes(node.name)) return;
      valid.push(node.id);
      text = text.split(node.name).join(" ");
    });
  return [...new Set(valid)].sort((a, b) => a - b);
}

// Mythic aspekty to "Embodiment" archetypu ("Riftwalker's Embodiment of ...") albo całej klasy ("Mage's ...").
function embodimentOf(name, playerClass, archetypes) {
  const owner = (name.match(/^(.+?)'s Embodiment/) || [])[1];
  if (!owner) return null;
  if (owner === playerClass) return "class";
  return archetypes.includes(owner) ? owner : null;
}

// ---------- dekodowanie linków Wynnbuildera (jak scripts/update-guide-trees.mjs) ----------
function reader(hash) {
  const bits = [];
  for (const char of hash) {
    const value = B64.indexOf(char);
    if (value < 0) throw new Error(`bad character ${char}`);
    for (let j = 0; j < 6; j++) bits.push((value >> j) & 1);
  }
  let pos = 0;
  return {
    get pos() {
      return pos;
    },
    read(n) {
      let value = 0;
      for (let k = 0; k < n; k++) value |= (bits[pos + k] || 0) << k;
      pos += n;
      return value;
    },
  };
}

const CRAFT = { versionBits: 7, ings: 6, ingBits: 12, recipeBits: 12, mats: 2, matBits: 3, atkBits: 4 };
const POWDERABLE = new Set([0, 1, 2, 3, 8]);

function skipPowders(r, DEC) {
  r.read(DEC.POWDER_ID_BITLEN);
  for (;;) {
    if (r.read(DEC.POWDER_REPEAT_OP.BITLEN) === DEC.POWDER_REPEAT_OP.REPEAT) continue;
    if (r.read(DEC.POWDER_REPEAT_TIER_OP.BITLEN) === DEC.POWDER_REPEAT_TIER_OP.REPEAT_TIER) {
      r.read(DEC.POWDER_WRAPPER_BITLEN);
      continue;
    }
    if (r.read(DEC.POWDER_CHANGE_OP.BITLEN) === DEC.POWDER_CHANGE_OP.NEW_POWDER) {
      r.read(DEC.POWDER_ID_BITLEN);
      continue;
    }
    return;
  }
}

const loadItemJs = await (await fetch(`${REPO}/js/load_item.js`)).text();
const versionBlock = loadItemJs.slice(loadItemJs.indexOf("const wynn_version_names = ["), loadItemJs.indexOf("];", loadItemJs.indexOf("const wynn_version_names = [")));
const VERSION_NAMES = [...versionBlock.matchAll(/'([\d.]+)'/g)].map((match) => match[1]);
const encodingCache = {};
async function encodingFor(version) {
  if (!encodingCache[version]) encodingCache[version] = await getJson(`data/${version}/encoding_consts.json`);
  return encodingCache[version];
}

// Zwraca { version, level, tomes: [id|null] x14, aspects: [[id, tier]|null] x5 } zapisane w linku.
async function decodeExtras(url) {
  const hash = url.split("#")[1];
  if (!hash || B64.indexOf(hash[0]) <= 11) throw new Error("not a binary Wynnbuilder link");
  const r = reader(hash);
  r.read(6);
  const version = VERSION_NAMES[r.read(10)];
  if (!version) throw new Error("unknown data version");
  const DEC = await encodingFor(version);
  for (let i = 0; i < DEC.EQUIPMENT_NUM; i++) {
    const kind = r.read(DEC.EQUIPMENT_KIND.BITLEN);
    if (kind === DEC.EQUIPMENT_KIND.NORMAL) r.read(DEC.ITEM_ID_BITLEN);
    else if (kind === DEC.EQUIPMENT_KIND.CRAFTED) {
      const start = r.pos;
      if (r.read(1)) throw new Error("legacy crafted item");
      r.read(CRAFT.versionBits + CRAFT.ings * CRAFT.ingBits + CRAFT.recipeBits + CRAFT.mats * CRAFT.matBits);
      if (i === 8) r.read(CRAFT.atkBits);
      const used = r.pos - start;
      if (used % 6) r.read(6 - (used % 6));
    } else if (kind === DEC.EQUIPMENT_KIND.CUSTOM) r.read(r.read(12) * 6);
    else throw new Error("bad equipment kind");
    if (POWDERABLE.has(i) && r.read(DEC.EQUIPMENT_POWDERS_FLAG.BITLEN) === DEC.EQUIPMENT_POWDERS_FLAG.HAS_POWDERS) skipPowders(r, DEC);
  }
  const tomes = [];
  if (r.read(DEC.TOMES_FLAG.BITLEN) === DEC.TOMES_FLAG.HAS_TOMES) {
    for (let i = 0; i < DEC.TOME_NUM; i++) tomes.push(r.read(DEC.TOME_SLOT_FLAG.BITLEN) === DEC.TOME_SLOT_FLAG.USED ? r.read(DEC.TOME_ID_BITLEN) : null);
  }
  if (r.read(DEC.SP_FLAG.BITLEN) === DEC.SP_FLAG.ASSIGNED) {
    for (let i = 0; i < DEC.SP_TYPES; i++) if (r.read(DEC.SP_ELEMENT_FLAG.BITLEN) === DEC.SP_ELEMENT_FLAG.ELEMENT_ASSIGNED) r.read(DEC.MAX_SP_BITLEN);
  }
  const level = r.read(DEC.LEVEL_FLAG.BITLEN) === DEC.LEVEL_FLAG.MAX ? DEC.MAX_LEVEL - 1 : r.read(DEC.LEVEL_BITLEN);
  const aspects = [];
  if (DEC.ASPECTS_FLAG && r.read(DEC.ASPECTS_FLAG.BITLEN) === DEC.ASPECTS_FLAG.HAS_ASPECTS) {
    for (let i = 0; i < DEC.NUM_ASPECTS; i++) {
      if (r.read(DEC.ASPECT_SLOT_FLAG.BITLEN) !== DEC.ASPECT_SLOT_FLAG.USED) {
        aspects.push(null);
        continue;
      }
      const id = r.read(DEC.ASPECT_ID_BITLEN);
      aspects.push([id, r.read(DEC.ASPECT_TIER_BITLEN) + 1]);
    }
  }
  return { version, level, tomes, aspects };
}

// ---------- zbieranie danych ----------
const rawTomes = (await getJson(`data/${VERSION}/tomes.json`)).tomes;
const rawAspects = await getJson(`data/${VERSION}/aspects.json`);
const tomeById = new Map(rawTomes.map((tome) => [tome.id, tome]));

const tomes = rawTomes
  .filter((tome) => TOME_SLOT[tome.type] && !tome.remapID && !LEGACY_TOME.test(tome.displayName || tome.name))
  .map(compactTome)
  .sort((a, b) => a.slot.localeCompare(b.slot) || a.lvl - b.lvl || a.name.localeCompare(b.name));
const currentTomeIds = new Set(tomes.map((tome) => tome.id));

const aspects = {};
const aspectById = {};
Object.entries(rawAspects).forEach(([playerClass, list]) => {
  const treeNodes = (appTrees.classes[playerClass] || []).map((node) => ({ id: node.id, name: node.name }));
  const archetypes = [...new Set((appTrees.classes[playerClass] || []).map((node) => node.arch).filter(Boolean))];
  aspectById[playerClass] = new Map(list.map((aspect) => [aspect.id, aspect]));
  aspects[playerClass] = list
    .map((aspect) => {
      const out = {
        id: aspect.id,
        name: aspect.displayName,
        tier: aspect.tier,
        nodes: aspectNodes(aspect, treeNodes),
        // Efekty tieru w formacie węzłów z ability-trees.json (base/props/effects/deps): aplikacja dokleja je do
        // zdolności drzewka tak jak Wynnbuilder (atree.js, "Apply aspects") i liczy z nimi obrażenia, EHP i manę.
        // base 999 = main attack (tak samo w Wynnbuilderze i w aplikacji, MELEE_ABILITY_ID).
        tiers: aspect.tiers.map((tier) => ({
          threshold: tier.threshold,
          text: plainLines(tier.description),
          abilities: (tier.abilities || [])
            .filter((ability) => Number.isInteger(ability.base_abil))
            .map((ability) => {
              const out = { base: ability.base_abil };
              if (ability.properties && Object.keys(ability.properties).length > 0) out.props = ability.properties;
              if (ability.effects && ability.effects.length > 0) out.effects = ability.effects;
              if (ability.dependencies && ability.dependencies.length > 0) out.deps = ability.dependencies;
              return out;
            }),
        })),
      };
      if (aspect.tiers.some((tier) => (tier.abilities || []).some((ability) => ability.base_abil === 999)) || /Your Main Attack/i.test(aspect.tiers[aspect.tiers.length - 1].description)) out.mainAttack = true;
      const embodiment = aspect.tier === "Mythic" ? embodimentOf(aspect.displayName, playerClass, archetypes) : null;
      if (embodiment) out.embodiment = embodiment;
      return out;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
});

// Buildy poradnika: tomy (po nazwie, z informacją, czy tom jeszcze istnieje) i aspekty (nazwa + tier).
const guide = [];
const skipped = [];
const allBuilds = [...guides.builds.map((build) => ({ ...build, source: "guide" })), ...extra.builds.map((build) => ({ ...build, source: "extra" }))];
for (const build of allBuilds) {
  let decoded;
  try {
    decoded = await decodeExtras(build.url);
  } catch (error) {
    skipped.push(`${build.name}: ${error.message}`);
    continue;
  }
  const tomeNames = decoded.tomes
    .filter((id) => id !== null && tomeById.has(id))
    .map((id) => ({ name: tomeById.get(id).displayName || tomeById.get(id).name, current: currentTomeIds.has(id) }));
  const byId = aspectById[build.class] || new Map();
  const aspectPicks = decoded.aspects.filter(Boolean).filter(([id]) => byId.has(id)).map(([id, tier]) => [byId.get(id).displayName, tier]);
  if (tomeNames.length === 0 && aspectPicks.length === 0) continue;
  guide.push({
    name: build.name,
    class: build.class,
    archetype: build.archetype,
    source: build.source,
    version: decoded.version,
    level: decoded.level,
    tomes: tomeNames.filter((tome) => tome.current).map((tome) => tome.name),
    legacyTomes: tomeNames.filter((tome) => !tome.current).map((tome) => tome.name),
    aspects: aspectPicks,
  });
}

const out = {
  version: VERSION,
  source: `${REPO}/data/${VERSION}/`,
  guideSource: guides.source,
  decodedAt: new Date().toISOString().slice(0, 10),
  tomes,
  aspects,
  guide,
};
fs.writeFileSync(OUTPUT, JSON.stringify(out) + "\n");
const counts = Object.fromEntries(Object.entries(aspects).map(([cls, list]) => [cls, list.length]));
console.log(`Saved ${tomes.length} current tomes, aspects ${JSON.stringify(counts)} and ${guide.length} guide builds with tomes/aspects (of ${allBuilds.length}; ${skipped.length} links unreadable) to ${OUTPUT.pathname}`);
skipped.forEach((line) => console.warn(`  skip ${line}`));
