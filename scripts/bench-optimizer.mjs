// Benchmark pełnego przeszukania Optimizera (branch and bound) - pierwszy krok implementacji ze specyfikacji:
// 1-9 pustych slotów dla 5 klas, porównanie z obecną wiązką (tryb szybki).
// Uruchomienie: npm run bench:optimizer -- [budżet_s=60] [klasy=Warrior,Mage,Archer,Assassin,Shaman] [poziom=106] [maks. pustych=9]
// Build startowy: build z poradnika danej klasy (link Wynnbuildera), wszystkie przedmioty gracza; kolejne sloty
// zostają puste: buty, hełm, klata, spodnie, naszyjnik, bransoleta, pierścień 1, pierścień 2, broń.
// Wynik: tabela Markdown (liczba kombinacji po odrzuceniu zdominowanych, czas pełnego przeszukania albo szacunek
// z przebiegu z limitem czasu, wynik wiązki vs B&B).
import { __engine as E } from "../src/BuildRecommender.jsx";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const budgetS = Number(args[0]) || 60;
const classes = (args[1] || "Warrior,Mage,Archer,Assassin,Shaman").split(",");
const level = Number(args[2]) || 106;
const maxEmpty = Number(args[3]) || 9;
const EMPTY_ORDER = ["boots", "helmet", "chestplate", "leggings", "necklace", "bracelet", "ring1", "ring2", "weapon"];

const fmtTime = (ms) => {
  if (!Number.isFinite(ms)) return "?";
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(0)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(0)} days`;
};
const fmtCount = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} bn` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));

const rows = [];
for (const playerClass of classes) {
  const guide = E.GUIDE_DATA.builds.find((build) => build.class === playerClass && !/\(Crafted\)/.test(build.name)) || E.GUIDE_DATA.builds.find((build) => build.class === playerClass);
  const base = E.workspaceFromWynnbuilderLink(guide.url).ws;
  const start = { ...base, level, archetype: guide.archetype, freeSp: {} };
  const goals = E.damageGoalOptions(playerClass, level, E.manualBuild(start).treeSettings);
  const params = { goal: [goals[0].id], blend: 0, cycle: "", freeSp: true, noEvents: true, scope: { slots: true, tree: false, tomes: false, aspects: false, sp: true, powders: true, swaps: false } };
  for (let k = 1; k <= Math.min(maxEmpty, EMPTY_ORDER.length); k += 1) {
    const ws = { ...start, items: { ...start.items }, powders: { ...start.powders } };
    EMPTY_ORDER.slice(0, k).forEach((slotId) => {
      delete ws.items[slotId];
      delete ws.powders[slotId];
    });
    const spec = E.optimizerSpec(ws, params);
    const empty = E.optEmptySlots(spec);
    let started = Date.now();
    const opt = E.optContext(spec, spec.treeIds, empty);
    const prepMs = Date.now() - started;
    started = Date.now();
    const quick = await E.optRunTask("quick", { spec, treeIds: spec.treeIds, emptySlots: empty });
    const quickMs = Date.now() - started;
    started = Date.now();
    const result = E.optBranchAndBound(opt, { incumbent: quick.value, refPicks: quick.picks, deadline: Date.now() + budgetS * 1000 });
    const ms = Date.now() - started;
    const fraction = result.checked / opt.total;
    const etaMs = result.complete ? ms : ms / Math.max(1e-12, fraction);
    const bnbBest = Math.max(result.best, quick.value);
    const raw = Object.values(opt.rawSizes).reduce((product, size) => product * size, 1);
    const row = {
      playerClass,
      guide: guide.name,
      k,
      empty: empty.join("+"),
      raw,
      total: opt.total,
      prepMs,
      quickMs,
      quick: quick.value,
      bnb: bnbBest,
      improved: result.best > quick.value * (1 + 1e-9),
      complete: result.complete,
      ms,
      etaMs,
      evaluated: result.evaluated,
      planes: result.planes,
    };
    rows.push(row);
    console.log(
      `${playerClass.padEnd(8)} k=${k} ${empty.join("+").padEnd(70)} combos ${fmtCount(row.total).padStart(8)} (raw ${fmtCount(raw)}) | quick ${fmtTime(quickMs)} ${quick.value.toFixed(0)} | B&B ${row.complete ? `done ${fmtTime(ms)}` : `≈ ${fmtTime(etaMs)} (1 thread, ${(fraction * 100).toFixed(2)}% in ${budgetS}s)`} best ${Number.isFinite(bnbBest) ? bnbBest.toFixed(0) : "none"} ${!Number.isFinite(quick.value) ? (Number.isFinite(bnbBest) ? "(quick found nothing that fits)" : "(nothing fits)") : row.improved ? `(+${((bnbBest / quick.value - 1) * 100).toFixed(2)}% vs quick)` : "(= quick)"}`
    );
  }
}

console.log("\n| Class | Empty slots | Combinations | Quick (beam) | Full search, 1 thread | Beam vs full |");
console.log("|---|---|---|---|---|---|");
rows.forEach((row) => {
  const vs = !Number.isFinite(row.quick)
    ? Number.isFinite(row.bnb)
      ? "beam found nothing that fits"
      : "nothing fits"
    : row.improved
      ? `full +${((row.bnb / row.quick - 1) * 100).toFixed(2)}%`
      : row.complete
        ? "same (beam optimal)"
        : "same so far";
  console.log(`| ${row.playerClass} | ${row.k} | ${fmtCount(row.total)} | ${fmtTime(row.quickMs)} | ${row.complete ? fmtTime(row.ms) : `≈ ${fmtTime(row.etaMs)}`} | ${vs} |`);
});
console.log(`\nJSON ${JSON.stringify(rows)}`);
