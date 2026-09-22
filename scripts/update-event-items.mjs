// Lista przedmiotów z wydarzeń ograniczonych czasowo (festiwale Wynncrafta) -> src/event-items.json.
//
// Źródła:
//  1. Oficjalna wiki (wynncraft.wiki.gg, MediaWiki API): wszystkie kategorie "Festival of the … Items"
//     (Blizzard, Bonfire, Heroes, Spirits - każdy rok osobno) oraz "Limited Time Event Content" i "Wynnterfest 2016 Set".
//  2. API Wynncrafta (v3/item/database): przedmioty z dropMeta.type = "event".
// Zapisujemy tylko nazwy, które są w src/wynncraft-items.json (sama wiki zawiera też kosmetyki, jedzenie itd.).
//
// Użycie: node scripts/update-event-items.mjs
import fs from "node:fs";

const WIKI = "https://wynncraft.wiki.gg/api.php";
const API = "https://api.wynncraft.com/v3/item/database?fullResult";
const OUTPUT = new URL("../src/event-items.json", import.meta.url);
const ITEMS = new URL("../src/wynncraft-items.json", import.meta.url);
const EXTRA_CATEGORIES = ["Limited Time Event Content", "Wynnterfest 2016 Set"];
const EVENT_NAMES = { bonfire: "Festival of the Bonfire", heroes: "Festival of the Heroes", blizzard: "Festival of the Blizzard", spirits: "Festival of the Spirits" };

async function wiki(params) {
  const url = `${WIKI}?${new URLSearchParams({ ...params, format: "json" })}`;
  const response = await fetch(url, { headers: { "User-Agent": "wynncraft-build-recommender (github)" } });
  if (!response.ok) throw new Error(`Wiki API returned HTTP ${response.status}`);
  return response.json();
}

async function categoryMembers(category) {
  const titles = [];
  let cont = null;
  do {
    const data = await wiki({ action: "query", list: "categorymembers", cmtitle: `Category:${category}`, cmlimit: "500", ...(cont ? { cmcontinue: cont } : {}) });
    data.query.categorymembers.forEach((member) => {
      if (!member.title.includes(":")) titles.push(member.title);
    });
    cont = data.continue ? data.continue.cmcontinue : null;
  } while (cont);
  return titles;
}

async function main() {
  const known = new Set(JSON.parse(fs.readFileSync(ITEMS, "utf8")).items.map((item) => item.name));
  const found = new Map();
  const add = (name, event) => {
    if (!known.has(name)) return;
    const list = found.get(name) || new Set();
    list.add(event);
    found.set(name, list);
  };

  const categories = [];
  for (const prefix of ["Festival of the"]) {
    const data = await wiki({ action: "query", list: "allcategories", acprefix: prefix, aclimit: "500" });
    data.query.allcategories.forEach((entry) => {
      if (/ Items$/.test(entry["*"])) categories.push(entry["*"]);
    });
  }
  for (const category of [...categories, ...EXTRA_CATEGORIES]) {
    const event = category.replace(/ \d{4} Items$/, "").replace(/ Items$/, "").replace("Limited Time Event Content", "Limited-time event");
    (await categoryMembers(category)).forEach((title) => add(title, event));
  }

  try {
    const response = await fetch(API);
    if (response.ok) {
      const data = await response.json();
      Object.values(data.results || data).forEach((item) => {
        const meta = item.dropMeta;
        if (!meta) return;
        const types = Array.isArray(meta.type) ? meta.type : [meta.type];
        if (types.includes("event") || meta.event) add(item.internalName || item.displayName, EVENT_NAMES[meta.event] || "Limited-time event");
      });
    } else console.warn(`Wynncraft API returned HTTP ${response.status}; using the wiki only`);
  } catch (error) {
    console.warn(`Wynncraft API unavailable (${error.message}); using the wiki only`);
  }

  const items = Object.fromEntries(
    [...found.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, events]) => {
        const specific = [...events].filter((event) => event !== "Limited-time event");
        return [name, (specific.length > 0 ? specific : [...events]).join(" / ")];
      })
  );
  const data = { source: "wynncraft.wiki.gg (Category:Festival of the … Items, Limited Time Event Content, Wynnterfest 2016 Set) + Wynncraft API dropMeta event", fetchedAt: new Date().toISOString().slice(0, 10), items };
  fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 0));
  console.log(`Saved ${Object.keys(items).length} limited-time event items to src/event-items.json`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
