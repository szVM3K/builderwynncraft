// Odczytuje drzewka umiejętności z linków Wynnbuildera w src/guide-builds.json i zapisuje src/guide-trees.json.
// Używamy tylko drzewek AKTUALNYCH dla danych drzewek aplikacji (src/ability-trees.json):
//  - "current": link zapisany w tej samej wersji danych,
//  - "unchanged": link ze starszej wersji, ale węzły tego drzewka i wszystkie węzły jego archetypu mają w nowych
//    danych tę samą strukturę (rodzice, blokady, koszt, archetyp, wymaganie archetypu, pozycja) i całe drzewko
//    przechodzi walidację na nowych zasadach.
// Drzewka po przeróbkach (inna struktura albo nieważne na nowych danych) są odrzucane i tylko liczone.
// Źródła: dane Wynnbuildera (github.com/wynnbuilder/wynnbuilder.github.io, GPL-3.0) - encoding_consts.json i
// atree.json każdej wersji, lista wersji z js/load_item.js; format linku jak w build_encode_decode.js.
//
//   npm run update-guide-trees
import fs from "node:fs";

const REPO = "https://raw.githubusercontent.com/wynnbuilder/wynnbuilder.github.io/master";
const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+-";
const here = new URL("../src/", import.meta.url);
const guides = JSON.parse(fs.readFileSync(new URL("guide-builds.json", here), "utf8"));
// Dodatkowe buildy-wzorce (np. dla archetypów bez aktualnego guide'a) - scripts/extra-guide-links.json.
const extra = JSON.parse(fs.readFileSync(new URL("./extra-guide-links.json", import.meta.url), "utf8"));
const appTrees = JSON.parse(fs.readFileSync(new URL("ability-trees.json", here), "utf8"));
const LATEST = appTrees.version;

async function getJson(path) {
  const response = await fetch(`${REPO}/${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
const loadItemJs = await (await fetch(`${REPO}/js/load_item.js`)).text();
const versionBlock = loadItemJs.slice(loadItemJs.indexOf("const wynn_version_names = ["), loadItemJs.indexOf("];", loadItemJs.indexOf("const wynn_version_names = [")));
const VERSION_NAMES = [...versionBlock.matchAll(/'([\d.]+)'/g)].map((match) => match[1]);

const dataCache = {};
async function versionData(version) {
  if (!dataCache[version]) {
    dataCache[version] = { DEC: await getJson(`data/${version}/encoding_consts.json`), atree: await getJson(`data/${version}/atree.json`) };
  }
  return dataCache[version];
}

// Bity jak BitVector Wynnbuildera: znak Base64 = 6 bitów, najmłodszy bit pierwszy.
function reader(hash) {
  const bits = [];
  for (const char of hash) {
    const value = B64.indexOf(char);
    if (value < 0) throw new Error(`bad character ${char}`);
    for (let j = 0; j < 6; j++) bits.push((value >> j) & 1);
  }
  let pos = 0;
  return {
    bits,
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

// Zwraca wersję danych i nazwy węzłów drzewka zapisanego w linku.
async function decodeTree(url, playerClass) {
  const hash = url.split("#")[1];
  if (!hash || B64.indexOf(hash[0]) <= 11) throw new Error("not a binary Wynnbuilder link");
  const r = reader(hash);
  r.read(6);
  const version = VERSION_NAMES[r.read(10)];
  if (!version) throw new Error("unknown data version");
  const { DEC, atree } = await versionData(version);
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
  if (r.read(DEC.TOMES_FLAG.BITLEN) === DEC.TOMES_FLAG.HAS_TOMES) {
    for (let i = 0; i < DEC.TOME_NUM; i++) if (r.read(DEC.TOME_SLOT_FLAG.BITLEN) === DEC.TOME_SLOT_FLAG.USED) r.read(DEC.TOME_ID_BITLEN);
  }
  if (r.read(DEC.SP_FLAG.BITLEN) === DEC.SP_FLAG.ASSIGNED) {
    for (let i = 0; i < DEC.SP_TYPES; i++) if (r.read(DEC.SP_ELEMENT_FLAG.BITLEN) === DEC.SP_ELEMENT_FLAG.ELEMENT_ASSIGNED) r.read(DEC.MAX_SP_BITLEN);
  }
  if (r.read(DEC.LEVEL_FLAG.BITLEN) !== DEC.LEVEL_FLAG.MAX) r.read(DEC.LEVEL_BITLEN);
  if (r.read(DEC.ASPECTS_FLAG.BITLEN) === DEC.ASPECTS_FLAG.HAS_ASPECTS) {
    for (let i = 0; i < DEC.NUM_ASPECTS; i++) if (r.read(DEC.ASPECT_SLOT_FLAG.BITLEN) === DEC.ASPECT_SLOT_FLAG.USED) r.read(DEC.ASPECT_ID_BITLEN + DEC.ASPECT_TIER_BITLEN);
  }
  // Drzewko: przejście w głąb od korzenia, dzieci w kolejności z atree.json, 1 bit na odwiedzone dziecko.
  const raw = atree[playerClass];
  const children = new Map(raw.map((node) => [node.id, []]));
  raw.forEach((node) => node.parents.forEach((parent) => children.get(parent).push(node)));
  const head = raw.find((node) => node.parents.length === 0);
  const nodes = [head.display_name];
  const visited = new Set();
  const walk = (node) => {
    for (const child of children.get(node.id)) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      if (r.read(1)) {
        nodes.push(child.display_name);
        walk(child);
      }
    }
  };
  walk(head);
  const leftover = r.bits.length - r.pos;
  if (leftover < 0 || leftover > 5) throw new Error(`tree bits don't line up (${leftover})`);
  return { version, nodes };
}

// Struktura węzła do porównania wersji (bez listy dependencies - Wynnbuilder dopisuje tam zależności, które gra
// wymuszała już wcześniej przez połączenia; walidacja niżej i tak sprawdza zależności na nowych danych).
function structure(raw) {
  const names = new Map(raw.map((node) => [node.id, node.display_name]));
  return Object.fromEntries(
    raw.map((node) => [
      node.display_name,
      JSON.stringify([node.parents.map((id) => names.get(id)).sort(), (node.blockers || []).map((id) => names.get(id)).sort(), node.cost, node.archetype || null, node.archetype_req || 0, node.display.row, node.display.col]),
    ])
  );
}

// Walidacja na danych aplikacji: te same zasady co w zakładce drzewka (rodzic, zależności, blokady, archetyp).
function validOnLatest(playerClass, names) {
  const nodes = appTrees.classes[playerClass];
  const byName = new Map(nodes.map((node) => [node.name, node]));
  if (names.some((name) => !byName.has(name))) return false;
  const exclusive = new Map(nodes.map((node) => [node.id, new Set(node.blockers)]));
  nodes.forEach((node) => node.blockers.forEach((id) => exclusive.get(id).add(node.id)));
  const active = new Set();
  const counts = {};
  let pending = names.map((name) => byName.get(name));
  let changed = true;
  while (changed) {
    changed = false;
    pending = pending.filter((node) => {
      const ok =
        node.parents.length === 0 ||
        (node.deps.every((id) => active.has(id)) &&
          ![...exclusive.get(node.id)].some((id) => active.has(id)) &&
          node.parents.some((id) => active.has(id)) &&
          (!node.archReq || (counts[node.arch] || 0) >= node.archReq));
      if (!ok) return true;
      active.add(node.id);
      if (node.arch) counts[node.arch] = (counts[node.arch] || 0) + 1;
      changed = true;
      return false;
    });
  }
  return pending.length === 0;
}

const latestData = await versionData(LATEST);
const trees = [];
const excluded = {};
const allBuilds = [...guides.builds.map((build) => ({ ...build, source: "guide" })), ...extra.builds.map((build) => ({ ...build, source: "extra" }))];
for (const build of allBuilds) {
  const key = `${build.class}/${build.archetype}`;
  let decoded;
  try {
    decoded = await decodeTree(build.url, build.class);
  } catch (error) {
    console.warn(`skip ${build.name}: ${error.message}`);
    continue;
  }
  let status = "current";
  if (!validOnLatest(build.class, decoded.nodes)) status = "invalid";
  else if (decoded.version !== LATEST) {
    const before = structure((await versionData(decoded.version)).atree[build.class]);
    const now = structure(latestData.atree[build.class]);
    const archetypeNodes = (table) => Object.entries(table).filter(([, value]) => JSON.parse(value)[3] === build.archetype).map(([name]) => name);
    const relevant = new Set([...decoded.nodes, ...archetypeNodes(before), ...archetypeNodes(now)]);
    status = [...relevant].every((name) => before[name] && now[name] && before[name] === now[name]) ? "unchanged" : "outdated";
  }
  if (status === "current" || status === "unchanged") {
    trees.push({ name: build.name, class: build.class, archetype: build.archetype, source: build.source, version: decoded.version, status, nodes: decoded.nodes });
  } else {
    if (build.source === "extra") console.warn(`extra build ${build.name} is ${status} on ${LATEST}`);
    excluded[key] = excluded[key] || { outdated: 0, invalid: 0 };
    excluded[key][status] += 1;
  }
}

const out = {
  source: guides.source,
  sourceTitle: guides.sourceTitle,
  treeVersion: LATEST,
  decodedAt: new Date().toISOString().slice(0, 10),
  note: "Ability trees from the guide builds' Wynnbuilder links that are still valid on the app's tree data; reworked ones are only counted in 'excluded'.",
  trees,
  excluded,
};
fs.writeFileSync(new URL("guide-trees.json", here), JSON.stringify(out, null, 1) + "\n");
console.log(`${trees.length} current trees (tree data ${LATEST}), excluded:`, excluded);
