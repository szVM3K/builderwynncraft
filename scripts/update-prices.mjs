// Pobiera ceny z Trade Marketu Wynncrafta (WynnVentory API v2, https://wynnventory.com) i dzisiejsze oferty
// (czy przedmiot jest teraz na rynku) i zapisuje src/item-prices.json.
// Klucz API: zmienna środowiskowa WYNNVENTORY_KEY (darmowy klucz: https://wynnventory.com/developer/api-key).
// Na GitHubie klucz trzymaj w Settings › Secrets and variables › Actions jako WYNNVENTORY_KEY - workflow Pages
// pobiera ceny przy każdym buildzie i raz dziennie. Klucz nigdy nie trafia do kodu strony.
// Użycie:
//   WYNNVENTORY_KEY=... node scripts/update-prices.mjs        -> ostatnie 7 zarchiwizowanych dni (domyślne API)
//   WYNNVENTORY_KEY=... node scripts/update-prices.mjs 14     -> ostatnie 14 dni
import fs from "node:fs";

const API = "https://wynnventory.com/api/v2";
const OUTPUT = new URL("../src/item-prices.json", import.meta.url);
const ITEMS = new URL("../src/wynncraft-items.json", import.meta.url);
const key = process.env.WYNNVENTORY_KEY;
if (!key) {
  console.log("WYNNVENTORY_KEY is not set - keeping the current src/item-prices.json.");
  process.exit(0);
}
const days = Math.max(1, Math.min(60, Number(process.argv[2]) || 7));
const end = new Date();
end.setUTCDate(end.getUTCDate() - 1);
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - (days - 1));
const isoDay = (date) => date.toISOString().slice(0, 10);

const known = new Set(JSON.parse(fs.readFileSync(ITEMS, "utf8")).items.map((item) => item.displayName || item.name));
const items = {};
let page = 1;
let rows = 0;
for (;;) {
  const url = `${API}/market/rankings?page=${page}&page_size=200&start_date=${isoDay(start)}&end_date=${isoDay(end)}`;
  const response = await fetch(url, { headers: { "X-API-Key": key, Accept: "application/json" } });
  if (!response.ok) throw new Error(`WynnVentory returned HTTP ${response.status} for ${url}`);
  const body = await response.json();
  const data = Array.isArray(body.data) ? body.data : [];
  data.forEach((row) => {
    rows += 1;
    if (!row || !known.has(row.name) || (row.tier !== null && row.tier !== undefined)) return;
    // Średnia środkowych 80% ofert (bez skrajnie tanich/drogich), zidentyfikowane; w razie braku - niezidentyfikowane.
    const price = row.average_mid_80_percent_price ?? row.unidentified_average_mid_80_percent_price ?? row.average_price;
    if (!(price > 0) || items[row.name]) return;
    items[row.name] = {
      price: Math.round(price),
      low: row.lowest_price ? Math.round(row.lowest_price) : null,
      unid: row.unidentified_average_mid_80_percent_price ? Math.round(row.unidentified_average_mid_80_percent_price) : null,
      count: row.total_count || 0,
    };
  });
  const pagination = body.pagination || {};
  const last = data.length === 0 || (pagination.total_pages && page >= pagination.total_pages) || (pagination.has_next === false);
  if (last) break;
  page += 1;
  if (page > 500) break;
}
// Oferty widziane dziś na Trade Markecie (WynnVentory: /market/listings trzyma oferty od ostatniej nocnej archiwizacji).
// Per przedmiot: liczba ofert, najniższa cena, kiedy ostatnio widziana. Błąd tu nie psuje cen z rankingu.
const live = {};
let listingRows = 0;
let liveAt = null;
try {
  for (let listingPage = 1; listingPage <= 400; listingPage += 1) {
    const url = `${API}/market/listings?item_type=gear&sort=timestamp_desc&page=${listingPage}&page_size=200`;
    const response = await fetch(url, { headers: { "X-API-Key": key, Accept: "application/json" } });
    if (!response.ok) throw new Error(`WynnVentory returned HTTP ${response.status} for ${url}`);
    const body = await response.json();
    const data = Array.isArray(body.data) ? body.data : [];
    data.forEach((row) => {
      listingRows += 1;
      if (!row || !known.has(row.name)) return;
      const entry = live[row.name] || (live[row.name] = { n: 0, low: null, at: null, unid: 0 });
      entry.n += Math.max(1, Number(row.amount) || 1);
      if (row.listing_price > 0 && (entry.low === null || row.listing_price < entry.low)) entry.low = Math.round(row.listing_price);
      if (row.timestamp && (!entry.at || row.timestamp > entry.at)) entry.at = row.timestamp;
      if (row.unidentified) entry.unid += 1;
    });
    const pagination = body.pagination || {};
    if (data.length === 0 || (pagination.total_pages && listingPage >= pagination.total_pages)) break;
  }
  liveAt = new Date().toISOString();
} catch (error) {
  console.warn(`Live listings skipped: ${error.message}`);
}

fs.writeFileSync(
  OUTPUT,
  JSON.stringify({
    source: "WynnVentory (wynnventory.com) - average of the middle 80% of Trade Market listings",
    fetchedAt: new Date().toISOString(),
    days,
    range: { start: isoDay(start), end: isoDay(end) },
    items,
    liveAt,
    live,
  })
);
console.log(`Saved prices for ${Object.keys(items).length} items (${rows} ranking rows, ${isoDay(start)}..${isoDay(end)}) and today's listings for ${Object.keys(live).length} items (${listingRows} listings) to ${OUTPUT.pathname}`);
