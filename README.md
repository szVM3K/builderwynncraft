# Wynncraft Build Recommender

Pick a level, class and ability-tree archetype and get a full 9-slot build (Helmet, Chestplate, Leggings, Boots,
2× Ring, Bracelet, Necklace, Weapon) chosen from every item in Wynnbuilder's database and validated against the
game's skill-point rules. Four more modes share the page: the **Build Optimizer** fills in a build you started (and
never changes what you picked), the **Build Creator** is a manual editor like Wynnbuilder, the **Build Library**
lists builds players published and the **Build Solver** finds item sets for stat targets. Every build has its
own address (`#b=<Wynnbuilder code>&s=<settings>`), so it can be shared, saved in the browser and compared in tabs;
**Share** copies a short link to the build and a ready message with the item list.

## Live site (GitHub Pages)

Every push to `main` runs `.github/workflows/pages.yml`: `npm ci`, `npm run build` and a deploy of `dist/` to
GitHub Pages (the workflow enables Pages on the repository by itself). In a `<user>.github.io` repository the site
lives at `https://<user>.github.io/`, in any other repository at `https://<user>.github.io/<repo>/` (Vite is built
with `base: "./"`, so both work unchanged). Watch the first run in the Actions tab; afterwards every change on
`main` is live after 1–2 minutes.

## Running locally

```bash
npm install
npm run dev        # development server
npm run build      # production build in dist/
```

## Testing the generator (QA)

`npm test` checks the generator the way a QA engineer would, without trusting its own search. Every check is a
*certificate*: when it reports a problem it also carries the evidence (the better build, the broken requirement,
the two numbers that disagree), written to `test-results/`.

```bash
npm install          # once (installs vitest)
npm test             # matrix (5 classes × 3 archetypes × levels 30/50/70/90/100) + skill point solver, ~15-40 min
npm run test:sp      # skill point solver only: 20,000 random item sets, a few seconds
npm run test:wynnbuilder  # "Open in Wynnbuilder" links: 10 builds encoded and decoded back, ~1 min
npm run test:stable  # same settings twice = same build (5 scenarios), a few minutes
npm run test:workers # Web Worker tasks give the same build as one thread (2 scenarios), a few minutes
npm run test:discord # Discord feedback fixes: rolls, Mana/Life Steal from M hits, poison, drain, life recovery, whole cycle, guide tree presets
npm run test:optimizer # Optimizer/Creator: full search = every combination, your picks stay, full >= quick, Wynnbuilder import/export round trip, ~2-3 min
npm run test:feedback  # 0.37 fixes: Exclude = Generate, Fits my skill points, range sliders (mana, life, walk speed), migration, ring rolls, welcome v2
npm run test:share     # 0.38: Share (short link + message with the item list), short settings links, Effective HP range
npx vite-node scripts/compare-defaults.mjs -- 0 1 50,80,106  # what the new default ranges change vs Any (0.35 behaviour)
npm run bench:optimizer -- 45 Warrior,Mage 106  # full-search benchmark: 1-9 empty slots per class vs the beam (seconds per run, classes, level)
npm run test:deep    # deep optimality certificate: exhaustive pair swaps + triples for 8 builds, ~15-20 min
npm run test:matrix  # the matrix only
npm run test:soak    # endless random scenarios in parallel shards until Ctrl+C
```

What is checked for each generated build (`tests/harness/checks.js`):

- **Calculation errors** (error): damage, EHP and mana of the generator agree with the summary panel's
  `computeBuildStats()`; `passed` means every hard filter really holds; the skill point assignment passes an
  independent verifier and is never below the theoretical lower bound; totals add up; filters (level, class weapon,
  events, tradeable, attack speed, negative defences, rarities, pinned items, illegal sets, single-copy rings).
- **Suboptimal builds** (error): no single item swap (every allowed item, every powder element on the weapon) and
  no sampled pair swap may give more than +0.5 % while passing every filter; no complete guide build (level 100+)
  may beat the result; and the **portfolio** check re-evaluates every build found by any other run of the same class
  (other goals, EHP thresholds, cycles, levels) under this run's filters - if one passes and deals more damage, the
  result is provably not the best. A failed build that one swap would fix is an error too.
- **Inefficiencies** (warn): free skill points that would add > 1 % damage, empty slots, searches over 15 s.

**Deep certificate** (`npm run test:deep`, `deepCheck` in `tests/harness/checks.js`, `tests/deep/*.deep.js`): for
8 full-effort builds (all classes, levels 60-120, with EHP thresholds and a mana cycle) the candidate list of every
slot is built from *all* single swaps - the best ~16 by damage, 8 by EHP, 8 cheapest in skill points, 8 for mana
(with a cycle), 8 strongest that break a filter on their own (they need a partner) and "slot empty", about 30-40
per slot - and then **every pair of slots × every pair from those lists** is evaluated exactly (~30-50 thousand pair
builds per build), plus every triple of slots over the top 5 of each list and 5,000 random triples. Any move that
passes the filters and beats the build by more than 0.5 % fails the test; smaller gains are reported. The first run
found two builds with a better pair (Warrior Paladin L95 +3.4 %: chestplate + ring; Archer Boltslinger L60
+1.1 %: necklace + powdered weapon) - both fixed by the exact pair stage below; triples never beat pairs. Now all 8
pass; the largest remaining gain is +0.09 %. `DEEP_PER_SLOT` / `DEEP_TRIPLES` change the size.

Useful variables (PowerShell: `$env:NAME="value"; npm run …`, cmd: `set NAME=value && npm run …`, bash:
`NAME=value npm run …`):

| Variable | Default | Meaning |
|---|---|---|
| `MATRIX_LEVELS` | `30,50,70,90,100` | levels of the matrix |
| `MATRIX_VARIANTS` | `base,second,main,lowEhp,noCycle,pinned` | runs per archetype and level |
| `MATRIX_AP_LOAN` | `0` | rank AP loan (2 = VIP+, 4 = HERO+) |
| `MATRIX_RANGES` | – (Any) | `defaults` = the UI's default ranges in every scenario (mana balance 0 to +1 with a cycle, walk speed ≥ −20 %) |
| `SP_SETS` / `SP_SEED` | `20000` / fixed | random sets for the skill point test |
| `SOAK_MINUTES` | `0` (forever) | stop the soak run after N minutes |
| `SOAK_SHARDS` | CPU cores − 1 (max 4) | parallel soak processes |
| `SOAK_LEVELS` | `30-100` | level range of random scenarios |
| `SOAK_STOP_ON_ERROR` | off | `1` = stop at the first error |
| `SOAK_SEED` | time | base seed (runs are reproducible from it) |
| `SOAK_REPLAY` | – | re-run one iteration by the `seed` printed next to a finding |

Findings are appended to `test-results/matrix-findings.jsonl` and `test-results/soak-findings.jsonl` (one JSON
line each, with the scenario and the build); `test-results/matrix-<class>.json` has every run's damage, EHP and
time. The tests import the generator through the `__engine` export at the end of `src/BuildRecommender.jsx`.

## Updating the item data after a Wynncraft patch

```bash
npm run update-items             # latest Wynnbuilder data
npm run update-items -- 2.2.4.0  # a specific version
```

The script rewrites `src/wynncraft-items.json`, keeping Wynnbuilder's data layout, and
`src/wynnbuilder-ids.json` (Wynnbuilder's item numbers, the data version number and the link encoding constants of
that version, used by "Open in Wynnbuilder").

Ability-tree node effects (bonuses, toggles, sliders, spells) for a new data version:

```bash
npm run update-tree-effects             # atree.json for the version recorded in src/ability-trees.json
npm run update-tree-effects -- 2.2.4.0  # a specific version
npm run update-guide-trees               # re-check the guide builds' trees against the new tree data
npm run update-item-weights              # re-fetch the Wynnpool item weights
npm run update-event-items               # re-fetch the list of limited-time event items (wiki + Wynncraft API)
npm run update-tomes-aspects             # tomes, aspects and the guide builds' tomes/aspects for the tree data version
```

## Trade Market prices (budget)

The **Budget** field (Items → Pin items · rarities · budget) uses Trade Market prices from
[WynnVentory](https://wynnventory.com) (API v2, `/market/rankings`: the average of the middle 80 % of listings
over the last 7 archived days). Their API needs a free key, so the prices are fetched when the site is built,
never in the browser:

1. Create a key at https://wynnventory.com/developer/api-key (read-only).
2. On GitHub: repository → Settings → Secrets and variables → Actions → New repository secret, name
   `WYNNVENTORY_KEY`, value = the key. Don't commit the key or paste it anywhere else.
3. Re-run the "Deploy to GitHub Pages" workflow (Actions tab). From then on every deploy and a scheduled run
   every 2 hours (at :23) fetch fresh data into `src/item-prices.json` before building.

The same run also reads `/market/listings` (gear listings WynnVentory users have seen on the Trade Market since
the last nightly archive) and stores, per item, how many listings were seen and the lowest listing price. The app
shows this as **● N on market** (green) or **○ not on market** (grey) on item cards, in Other picks, in the item
browser and in the "build around an item" search, plus a **● Listed today** filter chip in the browser. It is a
snapshot from the last build (the time is in the tooltip) – a listing may have sold in the meantime.

Locally: `WYNNVENTORY_KEY=... npm run update-prices` (optionally `-- 14` for 14 days). Without prices the budget
field is disabled and everything else works as before.

## Features

### Welcome popup

The first visit shows a short welcome: the three modes (Recommender - a whole build from a few answers, best for
levelling from about level 30 to 100; Optimizer - fills what you left empty and suggests swaps, nothing changes
until you accept; Creator - a manual editor like Wynnbuilder), a link to The Ultimate Build Guide for endgame
builds, a reminder that results are suggestions, and the list of sources. **I confirm** unlocks after 5 seconds and
once the text has been scrolled to the end; the page behind it doesn't scroll meanwhile. The confirmation is kept
in `localStorage` (`wbr-welcome-confirmed-v2` since 0.37, so players who confirmed the old text see the new one
once); if the browser blocks storage it simply shows again on the next visit. Each mode also has its own short popup
on the first visit.

### Info button

**ⓘ Info** in the bottom-right corner (always there) opens a guide: how to use the Build Recommender step by step,
what goes into the math (damage, rolls, skill points, EHP, mana and life formulas, and what is *not* counted -
poison unless turned on, powder specials, tomes and aspects, spell durations, crafted items, enemies' resistances
and team buffs) and how the search works. It starts and ends with the reminder that every build and number is a
suggestion, a recommendation from a model of the game - not a guarantee.

### Three modes: Recommender, Optimizer, Creator (0.36.0)

A bar under the header switches between three modes. Each mode keeps **its own build** (the Optimizer and Creator
builds are saved in the browser: `wbr-ws-optimizer-v1`, `wbr-ws-creator-v1`), so switching never loses anything.
**Edit in Creator** (under a Recommender build and in the Optimizer) and **Send to Optimizer** (in the Creator)
*copy* the build to the other mode; the build that was there can be brought back with **Undo**. The sub-tabs (Build,
Ability tree, Aspects, Tomes, Guide builds, Build info) are the same in all three modes (since 0.39 the Build Solver
and the Build Library are modes of their own, see 0.39.0). The first
visit to the Optimizer and to the Creator opens a short popup (what the mode is, how it works in four steps, how it
differs from the other two; remembered as `wbr-intro-optimizer-v1` / `wbr-intro-creator-v1`), and the **?** next to
the mode's name opens it again.

| Mode | Who builds | What it does |
| --- | --- | --- |
| Build Recommender | the generator | the whole build from scratch (everything below) |
| Build Optimizer | you + the generator | you pick part of the build, Optimize fills the rest and lists the changes for you to accept |
| Build Creator | only you | a manual editor like Wynnbuilder, no automation |

**Build Creator.** Setup: class (or pick a weapon first - its class becomes yours), rank, level (empty = 120) and,
optionally, the archetype (Build info and guide builds). Nine slots with a chooser over the whole database (5,414
items) and filters: slot, level (the maximum can go above your level - the build then shows a warning), rarity,
**requirements** (only items that need nothing outside the checked skills, and at most N in each), name and
identifications. Rolls are max by default (like Wynnbuilder) and can be set per identification (Rolls). Powders
per item in any order and mix, **armour too** (each powder adds its element's defence and health and lowers the
opposite element's defence - the numbers of the Powders panel). Ability tree, tomes (the slots your level opens,
tomes up to your level) and aspects (the slots your level opens, one of each, tier I-IV) by hand. Required skill
points are calculated in the game's equip order like Wynnbuilder (Guild tomes' points count as bonuses); the free
points are yours to spread with + / −. Damage, Survivability (EHP, defences), tree effects, skill points and totals
update live, with tomes and aspects in the numbers. Problems are **warnings, never blocks**: items above your level,
a weapon of another class, too many skill points, more than 100 assigned in a skill, two copies of a ring that can
be worn once, set pieces that can't be worn together, a tree above your AP (trimmed, the full tree is kept),
disconnected abilities, tomes/aspects above what the level opens, two Mythic aspects. **Open in Wynnbuilder** exports
the build (items with every powder, tomes, aspects, skill points, level, tree); **Import from Wynnbuilder** reads a
builder link back (the binary format 12 - crafted and custom items are skipped with a note and their slot stays
empty; more powders than the item has slots today are cut, with a note). All 126 guide links decode, and every one
survives import → export → import unchanged. Builds can be **saved in the browser** under your own names
(`wbr-creator-saved-v1`), and the Guide builds and Build Solver tabs load a build into the editor.

**Build Optimizer.** The rule: *Optimize never changes what you picked.* Setup in the order class → archetype → rank
→ level → ability tree (rank and level decide the AP, the tree may be incomplete), then any items. Every place it can
fill says so ("Free AP: 12. Optimize will fill them for your goal, without touching your nodes."; empty slots, free
skill points, empty tome and aspect slots, a weapon without powders). **Optimize** opens the parameters: damage goal
(spells and / or main attack, several = their sum; spells that are not in your tree yet are marked +), damage
element focus (the picked weapon deals it; powders use it), **Damage ↔ EHP** (0-100 %: the goal becomes
damage^(1-b) × EHP^b), mana (cycle, clicks per second, allowed drain; Mana Steal only from M hits), life sustain,
avoid negative defences, Trade Market listed today, attack speed (only for an empty weapon slot), spend free skill
points, no untradeable / no limited-time items (only for the items it picks), and **what it may change**: empty item
slots, free AP, tomes, aspects, skill points, weapon powders, swap recommendations (all on by default). The search
runs in Web Workers (CPU cores − 1, up to 8) with a progress bar through the stages **Tree → Items → Tomes → Aspects →
Check**, a "checked / all combinations" counter, the estimated time and **Stop** (the result then comes from the best
build found so far, marked as not a full search).

- Tree: your nodes stay; the free AP go to the paths that raise the goal most (the damage model with your items,
  plus how often guide trees take them). After the items, a second pass with the finished items (Check).
- Items: **full search** - every item that fits an empty slot (slot type, class weapon, level, filters) is a
  candidate, the two rings as pairs without repeats; see below. Before the full search starts you see the
  estimate; **over 2 minutes** you choose *Continue full search* or *Quick mode* (the Recommender's beam around your
  items: seconds, no guarantee).
- Tomes and aspects: only empty slots (the tomes' and aspects' own evaluation, with yours already in).
- Check: the second tree pass, free skill points (on top of the ones you assigned), and for every item of yours the
  best swap with the rest of the build as it is.

The result is a **list of changes**, not a new build: rows per area (Items: "Boots: empty → Landscour", Ability
tree: "+6 abilities: …", Tomes, Aspects, Skill points, Powders) each with a short *why* (how much of the goal and EHP
it adds), and a Stats row (goal, EHP, mana/s, life/s before → after). Every row can be unchecked; the cards and all
panels show the build with the checked rows while you decide. **You could also swap** lists better items for your
own - unchecked by default; checking one and pressing **Accept changes** is the only way an item of yours is
replaced. **Discard** goes back to the build before Optimize. With nothing changed since the last run (items, tree,
level, parameters - a fingerprint of the inputs) Optimize shows a lock: "Change the build or the parameters to
optimize again". If nothing can be improved: "Your build is already the best for these parameters".

**How the full search works** (`optContext`, `optBranchAndBound` in `src/BuildRecommender.jsx`):

1. **Dominated items out.** An item is dropped when another item of the same slot is at least as good in every
   statistic the model uses for this goal (directions probed on the build), has no higher requirements and no
   lower skill point bonuses (sets and major IDs are never dropped; a ring only when two others beat it). Swapping
   for a dominating item never makes a build worse, so nothing better is lost. Typically 45-75 % stay.
2. **Start from the beam.** The Recommender's search with your items pinned gives a strong first record in a
   second or two, so branches are cut from the start.
3. **Branch and bound.** Slots one by one (weapon first, rings last as a pair). A branch is skipped when even its
   best case can't beat the record. The best case comes from **tangent planes**: with attack speed and Crit Damage
   held at their highest possible values, the logarithm of the goal is concave in the summed item statistics and in
   the Str/Dex/Int (and Def/Agi without EHP in the goal) points, so a plane touching it at one point lies above it
   everywhere. Under the plane every slot contributes on its own (the best g·x of its pool), and the skill points
   become a small linear program (every skill at least its minimum, the rest of the level's budget where the plane
   rises fastest); with two or more slots left, a Lagrangian version prices each candidate's own requirements and
   negative bonuses. Planes are anchored at the root and the first level (with the skill ceiling and speeds of that
   branch) and have 1 % slack for the numeric slopes. A simpler bound ("ideal item": the best value of every
   statistic in each remaining pool) is the fallback.
4. **Fast last slot.** Candidates of the last slot are scanned in order of g·x with a two-line bound each (no damage
   formula); the scan stops when the bound falls under the record, and only the survivors get the full evaluation
   (exact skill points in the game's equip order, the goal, the mana and life filters, free points).
5. **Workers.** The candidates of the first slot are split into chunks run on all threads, each with the current
   record.

Checked against exhaustive search (every combination evaluated): 75 cases (5 classes × 5 slot sets of 1-2 empty
slots × pure damage, Damage↔EHP 40 % and a mana cycle) - the same best build every time
(`npm run test:optimizer` keeps five of them).

**Benchmark** (`npm run bench:optimizer`): each class's guide build at level 106, slots emptied in the order boots,
helmet, chestplate, leggings, necklace, bracelet, ring 1, ring 2, weapon; goal = the strongest spell, max rolls, one
thread (the site uses CPU cores − 1, up to 8, so divide by about 4-6); a run was stopped after 45 s and the time
extrapolated from the share of combinations it had covered.

| Empty slots | Combinations (after dropping dominated / all) | Quick mode (beam) | Full search, 1 thread | Full search vs beam (5 classes) |
| --- | --- | --- | --- | --- |
| 1 (boots) | 270 / 405 | 0.4-2.2 s | < 0.1 s | same in 4, +0.17 % in 1 |
| 2 (+ helmet) | 81 thousand / 193 thousand | 0.5-1.2 s | 0.1-0.8 s | same in 1; +1.2 % and +2.7 %; in 2 the beam found nothing that fits the skill points, the full search did |
| 3 (+ chestplate) | 25 million / 88 million | 0.3-1.7 s | 6 s - about 2 min | +0.4 % and +2.5 % in 2 |
| 4 (+ leggings) | 7.4 billion / 35 billion | 0.7-2.6 s | about 17 min - 7 h (estimated) | nothing better in the first 45 s |
| 5 (+ necklace) | 980 billion / 8 trillion | 1.2-2.6 s | about 5 h - 38 days (estimated) | +0.3 % in 1 within 45 s |
| 6-9 (+ bracelet, rings, weapon) | 10^14 - 10^21 | 0.7-7.4 s | years and more | - |

The estimates for 4+ slots extrapolate the first 45 s; the start of the search (the strongest candidates first)
is the slowest part, so they are on the high side. The one-minute target holds up to **3 empty slots** (a few to about 30 s on 4-8 threads); 4 empty
slots are minutes to hours, 5 or more are far beyond any practical time (every slot multiplies the combinations by
about 300). That is what the **2-minute limit** is for: above it the Optimizer asks whether to continue the full
search or use quick mode, which the table shows is usually as good or within a few % (but can miss builds that fit
the skill points). With 1-3 empty slots (15 cases) the full search found a better build than the beam in 5, and
in 2 more a build that fits where the beam found none.

### Feedback fixes, range sliders and build links (0.37.0)

Eight changes from the forum feedback and two additions to the Optimizer/Creator spec.

**Exclude uses the generator from Generate.** Exclude, Unpin, Other picks and Pin from the item browser used to call
the old weights generator (removed from the UI in 0.30), so after Exclude a completely different build appeared -
without the goal, the EHP threshold, the mana cycle and the tree. Now each of them runs `handleGenerateDamage()` with
the current settings plus the change from the card (the options are passed as an argument, because React's state
isn't updated yet right after `setOptions`). The progress bar and Stop work as for Generate. The old generator
(`generateOptimizedBuild`, `timedBuild`, `handleGenerate`, the hidden "Score calculation" tab) is gone from the code;
the archetype weights stay for Other picks, the Build Solver and guide builds.

**Wynnbuilder link always visible.** The build header (next to the archetype and level) has **Wynnbuilder ↗**,
**Copy link**, **Share** (0.38; in 0.37 *Share link*) and **Save**, also for Build Solver results (with the tree of the current class, like
the Tomes and Aspects tabs); on a phone they wrap under the title. The block under the cards stays; both use the same
link (`useWynnbuilderLink`), also with *With the recommended tomes and aspects* checked.

**Range sliders** (Generate and Optimize): three sliders with two handles (minimum and maximum; the far ends are
*Any* = no limit on that side), with presets above them.

| Slider | Unit | Default | Presets |
| --- | --- | --- | --- |
| Mana balance (needs a spell cycle) | the cycle's mana per second: negative = drain, positive = surplus | 0 to +1 (full sustain, nothing wasted) | Full sustain, Raid buffs (−3 to +1), Burst (≥ −8), Any |
| Life recovery | HP/s: Health Regen ÷ 4 + Life Steal from the cycle's M hits | Any | Any, Light, Strong sustain (10 % / 40 % of the slider's range) |
| Walk Speed | % of the whole build (the number in the summary) | at least −20 % | Any, Default, No slowdown (≥ 0), Mobile (≥ +20), Fast (≥ +40) |

The maximum keeps the search from "completely oversustaining": stats above the mana or life you need go to damage or
EHP instead. The generator treats a range like the EHP threshold: soft penalties while it searches, a hard cut at the
end; when nothing fits, the closest build is shown with a warning that names the range (and the one furthest off if
several fail). The *Life sustain > 0* switch is gone - the same is Life recovery with a minimum of 1 HP/s. *Suggest
mana drain & life recovery* now sets both ends: the minimum as before and the maximum at the suggested build's
value + 20 %. Old settings migrate with the same behaviour: `drain: d` → `{ min: −d, max: null }`, `lr: x` →
`{ min: x, max: null }`, no walk speed → Any (`migrateDamageForm`, `migrateOptParams`).

*How the upper limits are searched.* A hard maximum inside the approximate search (beam, single and pair swaps)
pushed the polishing into the first set under the limit and lost better ones (−5 to −7 % in tests, even when the
result without the limit already had a surplus under +1). So the approximate stages keep only the lower limits hard
(like EHP) and see the maxima as a mild penalty; the exact stage (every item in every slot, exact pairs, free skill
points) enforces both ends. Free skill points only raise the mana surplus (INT makes spells cheaper), so for the
maxima the shortcut "all free points everywhere" is checked on the build without them. Walk speed below the minimum
gives the slot's fastest items a place among the candidates (the beam would drop them before the filter sees them).
With at least one maximum set, `generateDamageBuild` first searches with the minimums only (walk speed minimum
included). If that build already fits every maximum, it is the result, so a maximum never makes a build weaker than
the same settings without it. Only when it goes over a maximum does a second search run with both ends, starting
from the first result and skipping the "with EHP to spare" and "other spells" passes the first search already did
(the progress bar says *Fitting the ranges*). That second search costs time (numbers below).
Parallel helper threads get the settings of the search they belong to (`task.override`).
In the Optimizer the full search stays exact: with a maximum, an item dominates another only with the same value of
the bounded statistics (and of INT for a mana maximum).

**Build in the address, saved builds, comparing.** After every Generate, Exclude or Other picks the address becomes
`…/#b=<Wynnbuilder code>&s=<settings>` (`history.replaceState`, no new history entry): `b` is exactly the "Open in
Wynnbuilder" code (items with powders, skill points, level, tomes, aspects, tree), `s` the generator settings (format
version, rank, goal, cycle, clicks/s, EHP threshold, the three ranges, the switches, pinned and excluded items as
Wynnbuilder numbers) as short-key JSON in base64url. Class comes from the weapon, archetype from the tree. Opening such
an address - or pasting a Wynnbuilder link into **Import** - shows the build as **Shared build** (cards, summary, the
link's tomes and aspects in their tabs) and puts the settings into the form; **Regenerate with these settings** runs
the generator (the result can differ if the item data or the generator changed). A crafted item or one missing from
this data version stays an empty slot with a note; a broken link or a settings format from a newer version shows a
message and changes nothing. **Saved builds** (bottom of the left panel): Save in the build header stores the name
(default "Archetype lv N · goal"), the address and the damage / EHP / mana at that moment in `localStorage`
(`wbr-saved-builds-v1`, up to 50); click opens, **Open in new tab** (or a middle click) opens it next to the current
one to compare, ✕ deletes, **Export** copies every link, one per line, for another computer. The link decoder
(`decodeWynnbuilderHash`) moved from the tests into `src/` next to the encoder; the Creator's import uses it too.

**Rolls of two identical rings** (feedback during the release): rolls were stored by item name, so the same ring on
both ring slots shared them. Ring slots now keep their own rolls (`rollKey`: `ring2|Warsong`); rolls saved before
are split between the two rings on the first change, so nothing is lost.

**Welcome and sources.** The welcome describes the three modes (see *Welcome popup*); the sources list adds what
0.34-0.37 started using (Wynnbuilder tomes/aspects data, powder and damage calculations and the link format; wiki
pages on skill points, tomes, aspects, raid and dungeon levels; forum threads on spell costs, Mana Steal and attack
speed) and lists The Ultimate Build Guide on its own. The unused `@fontsource/tiny5` dependency is removed.

**What the new defaults change** (`VERIFY=1 npx vite-node scripts/compare-defaults.mjs -- <shard> 2 100`: the 15
archetypes at level 100, EHP ≥ 25 %, the goal's first cycle and no cycle, full search; *Any* = the 0.35/0.36
behaviour). All 30 default builds pass, with no warnings.

| | Any already fits | Changed | Damage vs Any (median) | Range | Worse by > 2 % | Better by > 2 % |
| --- | --- | --- | --- | --- | --- | --- |
| With a cycle (mana 0 to +1, walk ≥ −20 %) | 2 / 15 | 14 | −5.7 % | −40.9 % to +6.2 % | 9 | 2 |
| No cycle (walk ≥ −20 %) | 4 / 15 | 13 | −0.6 % | −10.2 % to +8.2 % | 6 | 5 |

- **Walk speed.** 23 of the 30 *Any* builds walk slower than −20 % (down to −146 %). Without a cycle the cost of
  the minimum is small on average (median −0.6 %); the gains come from the search taking another path, and they
  show how much the heuristic search varies (±8 %).
- **Mana maximum.** With a cycle, 5 of 15 *Any* builds have more than +1 mana/s left over. Where the surplus comes
  from items it costs little: Sharpshooter +0.7 %, Acolyte −5.1 %, Fallen −7.7 %. Where it comes from the tree (Mage
  Arcanist with 3-3-4-1: +18.7 mana/s from the tree's mana gain), the only way under +1 is to drop items that give
  mana or make spells cheaper, and the build loses 40.9 %. A maximum can only take damage away from a
  damage-first search; what is left over is left over because it was free.
- **Time.** When the *Any* build doesn't fit, the default run takes a median 1.2-1.3× as long (0.6-4.7× on a
  2-core machine running both shards at once).

### Build Library, Build Solver mode and community trees (0.39.0)

**Build Solver** moved from the Recommender's tabs to the mode bar (Recommender · Optimizer · Creator · Build Library ·
Build Solver). It has its own level field; *Show build* opens the chosen set in the Recommender (with *Back to solver
results*), and *Edit in Creator* takes it from there.

**Build Library** (mode between Creator and Solver): builds players published. Filters: search (name, author, item),
class, archetype, a level range slider (presets 1-50, 51-99, 100-105, 106+) and main skill; sorted by newest, level or
name. Each card shows the author, description and the nine items (read from the build's Wynnbuilder code), with
**Open** (the Shared build view, name in the title), **Wynnbuilder ↗**, **Edit in Creator ✎** and **Share**.
Publishing: **Save** a build (Recommender header, or Save in the Creator), then **Publish to Build Library…** (also
*Publish* in both Saved builds lists): name, your name (optional, remembered), main skill and a description go out
for a check; the build shows in the Library once it is approved. The same build twice is recognised.

**Add a guide tree** (setup guide, step 4 *Ability tree*): share the tree picked above or paste a Wynnbuilder link /
tree code, with the ability points it is for (1-50, at least what the tree uses), a name, the archetype, your name
and a description. After a check it appears for everyone in the guide tree lists as a *Community tree*.

**Choose main skills**: the left panel's *Maximise* is now *Choose main skills*; the setup guide step is *Main skills*.

**The server behind it** (`worker/`): a Cloudflare Worker with a D1 (SQLite) database - submissions, published
builds and trees, and anonymous daily counts of what the site is used for. Its address goes into
`src/api-config.json` (`"base"`); while it is empty the Library shows "not connected yet" and the Publish / Add a
guide tree buttons are hidden, so the site works exactly as before. Counting is anonymous: no cookies, no accounts;
the server keeps a hash of (salt of the day, IP, browser) instead of the address and deletes the salt after two days,
so a visitor can't be followed across days. Submissions are plain text (length-limited, control characters removed,
shown as text), at most 10 a day per visitor, with a hidden field that catches bots. `worker/scripts/api-test.mjs`
tests the API against `wrangler dev --local`; `app/ui_library.mjs`-style UI tests run the site against it
(`window.WBR_API` overrides the address).

### Share, Effective HP range and section headings (0.38.0)

**Share.** The build header (Recommender, Build Solver results, shared builds, Creator and Optimizer) has **Share**,
and so does every row of both *Saved builds* lists. It opens a panel with a preview of the message and:

- **Copy message** – plain text that reads well anywhere (chats, forum posts, notes): the build's title, the short
  link, then the nine item names in slot order, each on its own line after `> ` (powders in brackets, e.g.
  `> Tisaun's Proof [2× Earth VII]`; `—` for an empty slot). Where `>` makes a quote (Discord, Slack, WhatsApp) the
  list gets the grey bar known from the preview under a Wynnbuilder link; elsewhere it is just a list. No slot names,
  no numbers line, no markup; at most 2000 characters (the lowest limit of the common chats).
- **Copy link only** – the address of this build on this site, and **Send…** on phones (the system share menu).
- **Include my generator settings** – off by default: the link is then just the build (`#b=<Wynnbuilder code>`,
  about 95 characters, like a Wynnbuilder link). With it the link also has `&s=…`, so the other person can press
  *Regenerate with these settings*.

Why a message and not a link preview: the site is static (GitHub Pages) and the part after `#` never reaches a
server, so a chat's link preview can't know which items a link holds; Wynnbuilder's page has no preview tags either.
A build-specific preview would need a small server (for example a Cloudflare Worker) that reads the build from the
address and answers with the item list.

A build from the Creator (or a saved Creator build) gets its name into the link (`&n=<name>`, brackets encoded so
a chat doesn't cut them off the link); a shared link shows that name in its title. **Edit in Creator ✎** on a shared build
copies it into the Build Creator (your previous Creator build can be restored with Undo). Sharing needs a weapon:
the link takes the class from it.

**Shorter addresses.** The settings part `s=` is now format 2: only what differs from the default form (format 1
wrote every setting, about 330 characters; a typical address is now about 130 in total). Missing keys mean the
default; format 1 links (0.37) still open with the same settings.

**Effective HP range.** Effective HP is a two-handle range slider like mana, life and walk speed: the minimum and an
optional maximum, in 2% steps of the most EHP the level can reach (the left end = no minimum, the right end = no
maximum; presets Any, Light 20%, Balanced 25% = the default, Sturdy 35%, Tank 50%). The form keeps EHP numbers
(`minEhp`, `maxEhp`), so saved settings, links (`e`, `eh`) and the list of builds for every EHP step work as before.
The maximum is handled like the other maximums: the first search runs without it; if its build is already under
it, that is the result (a maximum never makes a build weaker than the same settings without it); otherwise a second
search with both ends starts from it. Free skill points only raise EHP (Defence, Agility), so the shortcut "all free
points" checks the maximum on the build without them. The setup guide's *Effective HP* step has the same slider
and the named quick picks (Glass cannon … Wall) for the minimum.

**Section headings.** In the left panel every section (Ability tree, Maximise, Must have, Mana: spell cycle, Items)
is separated by a bar a little darker than the panel (`SectionBar`, class `wbr-sep`), and every subsection
(Effective HP, Life recovery, Walk Speed, Mana balance, Items › Filters, How builds are counted, Weapon attack
speed, Weapon powders) has a yellow heading like *ITEMS* (`SUB_HEAD`, class `wbr-sub`). Items is split into
*Filters* and *How builds are counted*, like the setup guide. In the setup guide the sections (Filters, How builds
are counted, Walk Speed, Weapon attack speed; Clicks per second, Mana balance, Life recovery, Spell cycle, Presets)
have yellow uppercase headings like the step title and the same bars (`SECTION_HEAD`); the doubled "Walk speed /
Walk Speed" label is gone. Both themes: the light theme uses a darker gold and a grey bar.

### Generating a build

The generator asks *what is the strongest build that still survives and still pays for its spells?* (Until
0.29.0 there was also an "Old", weight-based generator; it was removed in 0.30.0.)

1. **Class** → the main panel immediately shows the class overview: its archetypes (tabs), the spells of the
   suggested tree for each archetype with their mana costs, click combos and damage, and the archetype's usual
   spell cycles – drawn as numbered steps with arrows (spell name, clicks, mana) – with how much mana per second
   they burn and how much Mana Regen *or* Mana Steal your items would need to sustain them. **Use** on a cycle puts
   it into the mana filter (and loads that archetype's tree). Before a class is chosen the page shows the five
   class portraits to pick from.
2. **Rank** and **level**, then an **ability tree**: an archetype (the suggested tree for your AP), a **guide tree**
   (below), or your own tree from the Ability tree tab.
3. **Maximise**: the main attack or one spell from the tree - or several at once (click more tiles in the setup
   guide, or tap the spell chips under the Maximise list in the left panel - each tap adds or removes one): then the search maximises their sum (one cast of each; the main attack counts its damage per second).
   With a spell cycle set there is also **Whole cycle** (e.g. `Whole cycle 4311MM`): every spell of the cycle once
   per cast plus every main attack hit (M), divided by the time the cycle takes - the compromise players suggested
   for spells that deal their damage over time (Multihit, Arrow Storm, totems): maximise the total spell damage of
   the cycle at an acceptable mana drain.
4. **Must have** (pass/fail, never weights):
   - **Effective HP** – a range slider (minimum and optional maximum) in 2% steps of the most EHP your level can
     reach (`src/ehp-range.json`); see *Share, Effective HP range and section headings (0.38.0)*.
   - **Life recovery** and **Walk Speed** – range sliders (0.37).
   - **Mana: spell cycle** – spells (1-4) and main attacks (**M**) you do in a loop, clicks per second, Mana Steal
     and ability mana on/off. A spell is 3 clicks; M is one main attack, never faster than the weapon's attacks per
     second (after attack speed tiers). Income is `(Mana Regen + 25) / 5` plus Mana Steal **only from the cycle's M
     hits**: each hit gives `Mana Steal / 3 / attacks per second` (Wynnbuilder's "mana per hit"), so a cycle
     without M gets no Mana Steal and slow weapons get more per hit. The clicks field can be cleared and retyped
     (0.5–12); leaving it empty puts the last valid value back.
   - **Allowed drain** (0-20 mana/s; setup guide: Full sustain / Slight / Heavy / Burst) – the cycle may lose this
     much mana per second: the filter is `mana balance ≥ −drain` instead of `≥ 0`. The hint shows how long 100
     mana last.
   - **Life recovery** (0 = any) – minimum `Health Regen / 4 s + Life Steal` in HP per second. Life Steal, like
     Mana Steal, comes from main attack hits: with a cycle only from its M hits (`Life Steal / 3 / attacks per
     second` each), without a cycle from constant main attacks (`Life Steal / 3`).
   - **✦ Suggest mana drain & life recovery** (under the two sliders): quick searches at your EHP threshold with the
     drain allowed at 0, 1, 3, 6 mana/s, at your current drain (the generated build is reused for it) and without a
     limit, shown as a table (drain limit, EHP, damage, mana and life per second; click a row to see the build). The suggestion is the smallest drain that keeps at least 97% of the
     strongest build with a limited drain, and the life recovery that build has on its own - so **Use these limits**
     doesn't cost damage: that build still passes them. The row without a limit is only for comparison (a build
     losing 27 mana/s can't keep the cycle going); the line under the table says how long its mana would last.
5. **Items** (pinned items always stay):
   - *No limited-time event items* (on by default) skips the items you can only get during a festival (74 in the
     current `src/event-items.json`).
   - *Tradeable only* keeps only items that can be bought and sold on the Trade Market (no untradable or quest items).
   - *Weapon attack speed*: the weapon is picked only among the checked base speeds (none checked = any). The
     main attack line in the summary shows the speed *after* attack speed tier IDs, which can differ.
   - *Avoid negative defences* skips armour, accessories and weapons with any negative elemental defence.
   - *Live on the Trade Market*: only items listed on the Trade Market right now (needs the `WYNNVENTORY_KEY`
     secret, see above; disabled without data).
   - *Pin items · rarities · budget* (folded): pin an item to its slot (the rest is fitted around it), allowed
     rarities, and the emerald budget when prices are available.
   - *Realistic rolls (50%)* (off): identifications count at their **max roll by default, like Wynnbuilder**, so the
     numbers match the exported build. On: every rolled ID at 50% (positive = 80% of base) - items with fixed IDs
     (mostly quest rewards) then get an edge, and the result says so.
   - *Count poison in the goal* (off): adds Poison per second to the goal (spread over the casts for a spell). Off
     by default - how poison stacks and works on bosses isn't known, and counting it made the search pick
     poison-only items (Tarred Gem, Nightlock). The Poison DPS row in the Damage panel is always shown.

**Advanced** (folded, at the very bottom of the left panel): **Raid mana buff** - mana per second your raid team's
buffs give, added to the cycle's mana income (mana filter, drain suggestion, list of builds, Why this build?). Off
(0) by default: there is no single value for every raid and team.

**Setup guide**: after picking a class the main panel walks through the rest the same way. While it is open the left
panel is hidden and the guide uses the whole width; the panel comes back as soon as a build is generated. Big clickable tiles for
the rank, the level, the ability tree (an archetype - the guide stays on this step and shows the loaded tree below
the tiles, so you can compare archetypes and click abilities to adjust it, then **Use this tree ›**; a **guide
tree**; or **Your own tree**: it opens the Ability tree tab, where a "Back to the setup guide" button returns with
the tree you clicked together), what to maximise (one or several spells) (every spell of the tree and the main attack,
with its damage using the best weapon for your level), how tanky (every 5% step from 0% to 100% of the reachable
EHP, with the numbers; the named steps Glass cannon, Fragile, Light, Balanced, Sturdy, Tank and Wall are labelled),
the mana cycle (clicks per second typed in, 0.5-12; Mana Steal / ability mana on or off; allowed drain tiles, the
Life recovery slider and "Maximise the whole cycle"; then **Your own cycle** first - type the spell numbers or click
the spells to add them, M adds a main attack, with the steps and the Mana Regen / Mana Steal it needs shown live -
and below it the presets: no filter, the archetype's suggested cycles, a "spam" loop for every damage spell of the
tree and - folded - the cycles of the class's other archetypes) and extras (filters: life sustain, event items,
tradeable only, negative defences; how builds are counted: free skill points, realistic rolls, poison; weapon attack
speed), then a summary with Generate. **‹ Previous**, **Generate now** and **Next ›** sit at the top of the guide
(Previous on the rank step returns to the class choice). A row of steps on top shows what is chosen and jumps back to any step; the left panel shows
the same settings. On a phone the guide comes before the form.

**Guide trees** (setup guide's tree step, and "Guide trees" under the archetype buttons in the left panel): every
current tree from The Ultimate Build Guide (`src/guide-trees.json`) as a preset, named the way players name the
variant - *Generalist*, *Upperbash*, *Bash Upper*, *Bolt Hybrid*, *Spell*, *Heavy Melee* (the guide build's label
without the archetype) - with the weapons the guide plays it with, its masteries, AP and the matching cycle.
Identical trees of several guide builds (Crafted / Non Crafted, different weapons) are one preset with all their
names ("Bolt Hybrid · also: Hybrid" for Stratiformis, Divzer and Eschaton). The search box finds presets by those
names, weapons or archetypes ("generalist", "bolt hybrid", "divzer"). A tree laid out for 50 AP is trimmed to your AP
(the full tree comes back when you level up). Archetypes whose guide trees are from an older game version have none.

**Tree tip: swap Mastery** (under the result): after generating, every swap of one active elemental Mastery for
another (e.g. Air → Thunder when the weapon deals Thunder, like Divzer in a bolt hybrid) is checked on the same
items and skill points; if the tree stays valid within your AP and the goal gains more than 0.5%, the best swap is
shown with **Swap & regenerate**.

**List of builds for every EHP step** (at the bottom of the left panel, after a build is generated): one build for
every step of the Effective HP slider, 0% to 100%, as a comparison table sorted by damage (strongest first): the
step, the build's EHP, the goal's damage, **mana/s** after steal (`(Mana Regen + 25) / 5` + Mana Steal from the
cycle's M hits + ability mana; the balance with the cycle is in the row's tooltip) and **life/s** after steal
(Health Regen / 4 s + Life Steal from main attack hits). Every column is coloured from red (worst in the list) to
green (best), so you see what each extra step of EHP costs in damage, mana and life. The rows are computed in the background with a quick version of the
search (no +20% EHP beam, no beams for other spells, fewer candidates polished; about 2-4 s per step at level
100); a build that already passes the next step is also the answer for it and isn't searched twice, a build found for
a higher step that deals more replaces the lower steps' builds (so the list only goes down), and once a step finds
nothing that passes, the higher ones are marked as not reached. The step you generated shows the full
search result. Clicking a row shows that build and moves the slider there.

**Open in Wynnbuilder ↗** (under the item cards) opens the same build in wynnbuilder.github.io/builder in a new tab:
the 9 items, the weapon powders, the skill points (including the free ones you get as (+X)), the level and your
ability tree; tick "With the recommended tomes and aspects" to add what the Tomes and Aspects tabs pick (level 60+).
**Copy link** copies the same link. The link uses Wynnbuilder's own binary format (`ENCODING.md` in their
repository, V12): items by Wynnbuilder's item numbers, skill points as the totals in its Strength…Agility fields.
Checked by opening generated links in Wynnbuilder's builder page: items, powders, skill points (all assigned, 0
left), level, tomes, aspects and ability tree load as in the app.

**Why this build?** (large button under the item cards) opens a window that explains the result with the numbers
behind it: what was asked (goal and filters), the goal's value with its damage split by element and why that
element (the weapon's base damage and powders decide it; masteries only multiply what is there), the skill point
bonuses and item totals that multiply it, the Effective HP, mana and life sustain formulas with this build's
values, and for every slot what the build loses without the item, the strongest item that would deal more and
which filter it breaks, and the next best item that passes. It ends with how the search was done.

**How the search works.** Everything is evaluated with the same damage and EHP formulas as the summary (checked
against `computeBuildStats`). The search is a beam over the whole database, one weapon at a time (candidates per
slot are pre-scored with numeric stat weights derived from your goal, then the best few get the exact evaluation
with skill points), run twice: once at your EHP and once at +20% EHP, because a set that passes a higher threshold
also passes yours and the "tankier" beam finds other combinations. Short extra beams are then steered by the
damage of the tree's **other** spells (two best weapons each), because a set built for Uproot is sometimes stronger
in Blood Sorrow than the set built for Blood Sorrow itself - the linear weights of one goal on an empty set don't
always predict what pays off. All candidates then compete on your goal: the best set of *every* weapon gets a
short polish, the best six a full one, and the winner gets single swaps against every item of every slot, weapon
swaps and **pair swaps** (two slots at once).

The last step is an **exact check**: skill points in the game's equip order (the search uses a faster
approximation), every item of every slot and every weapon of the class with every powder element, until no single
swap improves the result. **Free skill points** are spent here too: when the set needs fewer points than your level
gives, the rest go where they raise the goal most (first where they get the build over the EHP / mana / sustain
filters). The Skill points panel and the summary show them in brackets: `Strength 46 (+12)`, `Skill points 146 (+12) / 158`.
**Spend free skill points** (Items, on by default) turns this off - the rest then stays unspent, as in a fresh
Wynnbuilder build.

**Weapon and powder screening.** A weapon's damage on its own is a poor predictor of the best build: at level 100
with a Battle Monk cycle, Infused Hive Spear is 44th by its bare damage, but a set built around it with **fire**
powders (the element that is *weakest* for the bare weapon - fire damage and Defence items make it) beats the best
Thrundacrack set by 16%. So besides the 5 weapons with the most bare damage, the search now also takes the 2 with the
most *potential* (bare damage with the level's free skill points spent on the goal, best powder element), and
screens the 8 weapons with the most potential with **every** powder element through a narrow beam (3 wide); the 2
best weapon + element pairs join the full search. Their sets get their own places in every later stage (short and
full polish, strong starts), so they can only add to the result, never push out a set that would have won
before. Measured on 10 scenarios at levels 90-120 (cycles, EHP 20-35%): 3 builds stronger (+0.5%, +10%, +17%), none
weaker, about 1.6 times the time. The Battle Monk case itself is still missed (the QA matrix reports it as
BETTER_BUILD_KNOWN: a Fallen build passes the same filters with +7%); a search pinned to Infused Hive Spear with
fire powders finds +16%, so the weapon + element choice is the next thing to improve.

**Exact pair swaps.** The winner of every pass then gets the same pair check as the deep test, inside the search:
candidate lists per slot (best by damage, EHP, skill point cost, mana, strongest that break a filter alone, empty
slot, every weapon with every powder element), every pair of slots × every pair from the lists, exact skill points
with free points. To keep it affordable a pair is only fully evaluated when, without free points or with a coarse
2-step split of them, it already reaches 90 % of the current result (measured on the pairs that really win: the
coarse split is 3-7 % below the full one); free points are skipped entirely when an optimistic bound (every skill
gets all free points at once) can't pass the filters or beat the result. After an improvement the build goes back
through single swaps and restarts. When nothing passes the filters, the lists are short "repair" lists (EHP, skill
point cost, mana).

**The first result is final.** The search doesn't stop at the first answer: it restarts from its own result
(approximate swaps, then the exact check again) until nothing improves, does the same from the three next-best
candidates of the polishing step (other weapons and sets - local optima differ), and then runs whole extra
**passes**, each starting from the best build so far, until a pass finds nothing better. That is exactly what a
second click on Generate used to do, so generating again with the same settings now gives the same build (checked
by `npm run test:stable`). The build header shows "final after N passes". On 30 test scenarios the first result
became +2.4% stronger on average (up to +19.5%, never weaker) and 29 of 30 came back identical on a second and
third click (before: 24, and four got weaker); the one exception had nothing passing the filters and is fixed by
the tie-break on damage. The price is time: about 2-3 times longer than before, typically 5-30 s, up to ~1.5 min
for level 100+ builds with a high EHP threshold and a mana cycle.

Earlier builds of the session are not used as starting points (the option "Start from my earlier builds" was
removed in 0.35.1): results depended on what you had generated before ("roulette builds"), and the converged search
doesn't need it. A progress bar shows the stage and pass.

**Background thread (Web Worker).** The search runs in a Web Worker, so the page never freezes while it works
(before: frames froze for up to ~0.7 s at a time) and **Stop** (next to the progress bar) ends it at once and keeps
the previous build. The List of builds runs there too. The GitHub Pages build starts the worker from
`src/engine-worker.js` (Vite bundles it as a separate file); the single-file version starts it from its own
`<script id="wbr-app">` through a Blob URL. If workers can't start (old browser, blocked), the search runs on the
page as before - the result is the same, only the page is busier. The build comes back as plain data and its items
are swapped for this page's item objects (`rehydrateBuild`); live market prices stay on the page, so searches with
a budget or "listed only" and live prices run on the page.

The generator can also hand the "converge" starts (the winner + 3 other strong candidates) to helper threads -
`generateDamageBuild({ task })` computes one start, and `tests/workers.test.js` checks the result equals the
single-thread one. It is **off by default**: helpers start without the main thread's memory of evaluated sets, and
measured on 4 scenarios that made 4 cores only 0.89-1.24x as fast (slower on 2 cores). `window.WBR_WORKER_COUNT = 4`
turns it on for experiments.

- **Guide builds at level 100+**: from level 100 the generator treats the Wynnbuilder guide builds as the
  reference for that class — at high level nothing in the database beats them. Their weapons join the weapon list
  (with the powder element that suits the goal), and every complete guide build that passes your item filters is
  evaluated as a finished candidate, so the result is never worse than the guide it starts from.

### Item tools

- **Budget** in emeralds (E / EB / LE / STX; 1 LE = 64 EB = 4,096 E): the build's total Trade Market price stays
  under it. Pinned items don't count (you have them), untradable/quest items cost nothing, Fabled and Mythic
  items without listings are skipped when a budget is set.
- **Trade Market availability**: the dot next to the slot name (● N on market / ○ not on market) says whether the
  item was listed on the Trade Market today; the expanded card shows the listing count and the lowest price, and
  the item browser has a **● Listed today** filter.
- **Pin or exclude an item** (left panel, *Pin items · rarities*): type a name; every result has **Pin** (always in
  its slot) and **Exclude** (never used; an excluded item that was pinned is unpinned). Like other form settings
  this doesn't run the search by itself - the build gets the "Settings changed: regenerate" mark.
- **Browse items…** opens the item browser: every weapon of your class, armour piece and accessory up to your
  level with filters for name, slot, element, rarity, level range, attack speed and minimum DPS, sorted by value
  in the current build, weapon DPS, level, health or name. Pin puts an item in its slot and re-fits the rest;
  Exclude takes it out of the pool.
- **Identification filter** (item browser and Other picks): "+ Add identification" opens a searchable list of
  every identification in the item data; set an optional minimum for each, match all or any.
- **Weapon powders**: every weapon is compared with the best powder element for your goal in all its slots (the
  highest tier for its level, VII from level 70, VI from 55), like in game and in Wynnbuilder.
- **Set bonuses** as in Wynnbuilder (Morph, Moirai, Petal, Visceral, …); sets marked illegal (e.g. the Hive sets)
  are never combined. Quest-reward items that can't be traded are never put on both ring slots.
- **Other picks / Exclude / Unpin** on every card: the next candidates for the slot with the change in damage and
  EHP after the swap and whether they fit your skill points. Using one pins it and re-fits the rest - with the
  **same generator and settings as Generate** (0.37; before, these buttons used the old weights generator and gave a
  build without the goal, EHP threshold, mana cycle and tree). While it runs, the previous build stays with
  "Recalculating without X…"; Stop keeps it, and the exclusion or pin stays in your settings.
- **✓ Fits my skill points** (Other picks and Browse items, with a build): only items that can replace the current
  one without changing the other slots (no skill point shortage, no illegal set, within the budget). The filter runs
  before the list is cut to 40, so fitting items further down the ranking show up; "N of M fit your skill points"
  above the list. Remembered until the page is reloaded; off by default.

### Wynnpool item weights

[Wynnpool](https://www.wynnpool.com) (MIT, [github.com/AiverAiva/Wynnpool](https://github.com/AiverAiva/Wynnpool))
keeps a community rating of **which identifications actually matter on a given item**. Each profile — "Main",
"Riftwalker", "Lootrun", "Spellsteal"… — is a set of weights whose absolute values sum to 1, and the score is
`sum(roll percentage × weight)` on a 0-100 scale, exactly the number wynnpool.com shows (a negative weight wants a
*low* roll, e.g. Bloodbath "Low HP"). 135 profiles for 84 items ship in `src/item-weights.json`.

- **Item card**: `WP nn` next to the item name is the best profile's score for the rolls currently set. Hover for
  the profile name and its top weights.
- **Rolls dialog**: a Wynnpool panel lists every profile for that item with a live score bar and a **Best roll**
  button that maxes the weighted identifications (and minimises the negatively weighted ones). Each identification
  row shows its weight (`WP 45%`), so you can see at a glance which rolls are worth rerolling for.
- **Item browser**: a **Rated items** filter and a **Wynnpool score** sort.

### Item cards

- Cards start collapsed: name, level, the skill point requirements as small chips (only the skills the item
  needs, ✓ when met), base health, the item's four strongest identifications and its worst negative one, and the
  Other picks / Rolls / Exclude buttons. The ▼ Details arrow opens the full tooltip; "Expand all" / "Collapse all"
  above the cards switches every card.
- A requirement is ✓ whenever the build can be equipped: an item may need more of a skill than the build's final
  total when another item with negative skill points goes on after it (the game equips in order), so the check
  follows the equip order, not just the totals.
- Cards are the in-game tooltip (Wynncraft 2.1 layout) and stay dark in both themes, with a 3 px rarity border:
  icon in a frame, name in the rarity colour with the average roll "[50.0%]", rarity and type
  badges, elements, powder slots in the corner, big DPS with attack speed (hits/s) and per-element damage ranges,
  or big health with defences; five skill diamonds with check boxes, Class Type
  and Combat Level, identifications in groups (skill points, damage, health/mana/defences, misc, spell costs with
  the class's spell names) with roll tags, Major IDs. The dots at the bottom switch the card's pages: item,
  how to get it (source, Trade Market, wiki link), damage breakdown.
- **Identification rolls**: every ID is shown and scored at its 50 % roll (positive = 80 % of base, negative = base)
  with a [xx%] tag like in game; the **Rolls** button sets the roll of the whole item or of each ID separately
  (0–100 %). Rules as in the game / Wynnbuilder: 30–130 % of base for positive IDs, 130–70 % for negative ones,
  spell costs reversed; skill points, static IDs (e.g. attack speed tier) and fixed-ID items don't roll. Archetype
  weights are calibrated on 50 % values.
- **Average DPS** on a weapon card is the number from the in-game tooltip: average base damage × hits per second
  (Normal = 2.05/s). It includes the weapon's powders (see Weapon powders) but no IDs, skill points or tree – those are in the build's "Main attack DPS".
- The powder slots on cards show the symbol of the recommended powder element; on a powdered weapon they are filled
  with the powders counted in its damage.

### Summary

- On wide screens the summary (Damage, Survivability, ability tree effects, Skill points, Build totals, Powders)
  sits in a right-hand column next to the cards.
- **Damage** and **Survivability**: main attack DPS (per hit × hits/s, with crits), spells from the tree (average
  damage or heal and mana cost), Strength bonus, crit chance, Effective HP (with and without Agility), HP, Defence
  reduction, tree resistances, regen, life steal and elemental defences. No powders or tomes.
- **Spell DPS**: the best spell in the tree as damage × casts per second that mana can sustain
  ((Mana Regen + 25)/5 per second plus the spell's mana return; at most 3 casts/s at 9 clicks/s), next to the
  "spam" figure without a mana limit; every spell has its own value and the spell cycle calculator gives the
  cycle's DPS and its sustainable rate.
- **Wynnbuilder-style breakdowns**: the main attack and every spell from the tree expand into their parts
  (per-element multipliers, average with crits, non-crit and crit ranges per element, healing), followed by
  Mana Regen with the base (+25/5s), Mana Steal per hit, Total Mana (100 + Max Mana + Intelligence), Effective
  Life Steal, Life per hit, Walk Speed and main attack range. The spell cycle calculator (e.g. "1213" or "4MMM"
  at 9 clicks/s; it starts with the generated build's cycle) shows mana use and balance, Mana Steal only from the M
  hits, and **Spell timing** (folded): every damage spell with its damage per cast and how long it deals it
  (Arrow Storm's arrows, Phantom Ray's beam, totems, Smoke Bomb... - base values from the ability tree data) plus
  what players report about recasting (Multihit for Acrobat, Fireworks).
- **Effective health gain** (Survivability): life recovery × EHP ÷ HP - how much effective health the sustain
  gives back per second (defences and Agility make every healed point worth more). Also in Why this build?.
- **Powder special** (Damage panel): when the weapon has two tier IV+ powders of one element, its special - Quake,
  Chain Lightning and Courage with their damage per hit (percent of the weapon's damage as that element, main
  attack scaling, crits), Curse (+damage taken), Wind Prison (next hit bonus) - with the level from the powders'
  average tier (4 … 7) and the radius / chains. Values as on the wiki and in Wynnbuilder. Shown for reference; the
  generator doesn't count it (how often it fires isn't known).
- **Effective Health (game)** is computed as on the in-game Combat Information screen:
  HP ÷ (1 − Defence %) ÷ (1 − Agility %) without the class multiplier, next to Wynnbuilder's EHP. The
  "[100%] Spell Damage" and "[100%] Main Attack Damage" blocks show the per-element ranges and the total bonus
  from equipment, as in game.
- **Build totals** also lists HP and elemental defences (base defences + percentage bonuses).
- **Recommended powders** (summary panel and Build info): weapon – the element the build gains most from
  (% bonuses, skill, focus), with neutral-damage conversion and the weapon special; armour – the element of the
  build's weakest defence (defence, health, the weakened opposite defence, armour special) or the attack element
  for its special. Data from the wiki (Powders, tier VI).
- **Skill points as in game**: items are equipped one after another (an item's skill point bonuses count once it
  is on, the weapon last) and at the end nothing may "fall off" (requirements are checked against the bonuses of
  all other items, including negative ones). The game equips in a fixed order (boots, leggings, chestplate,
  helmet, rings, bracelet, necklace) and puts an item on as soon as it can, so e.g. Broken Balance (−7 to every
  skill, no requirements) can't be "saved for last". A fast search (dynamic programming over subsets) is checked
  against that order; when a build has an item with negative skill points, or the fast result can't be equipped
  in that order, the assignment comes from a port of Wynnbuilder's `calculate_skillpoints` – the same points as
  Wynnbuilder. Set bonus skill points are added at the end (they don't help meet requirements).

### Discord feedback, 0.35.0

Players on Discord said the builds at level 105+ were weak and listed why. What was wrong in the code and what
changed:

| Complaint | Cause | Now |
| --- | --- | --- |
| "Why is Tarred Gem even a pick" | poison added to the spell goal (~42k poison per 3 s in one build) | poison off the goal by default, *Count poison in the goal* to turn it on |
| Intensity, Diamond Hydro/Static, Discharge… everywhere | IDs at 50% rolls, while 1005 items with fixed IDs always count 100% | max rolls by default, like Wynnbuilder; *Realistic rolls (50%)* optional |
| "Assumes 20 cps and can cycle melees between spells" | full Mana Steal with no main attack in the cycle | Mana (and Life) Steal only from M hits in the cycle, per hit from attack speed |
| "Can only build for 0 sustain or 0 drain" | mana filter was `≥ 0` | Allowed drain slider, Life recovery slider and a suggestion for both |
| "Roulette builds" | every earlier build seeded the next search | removed (0.35.1) |
| "Trained on the build guide" | +15-30% for guide items, "Meta" label on the sliders | bonus off by default, label now says the marker is only where guide builds sit |
| "Ability trees should be presets", "generalist" | trees only from weights | guide trees as named presets with search, Mastery swap tip |
| "Multihit says total damage…" | no timing | Whole cycle goal, Spell timing table |
| "Doesn't know what chain lightning is" | powder specials not shown | Powder special in the Damage panel |

**Checked at level 105+** (every archetype at level 120 and 106, 25% EHP, strongest spell, no cycle; the same run
before and after, harness evaluator): poison items in the 30 builds went from 51 to 6 (the Shadestepper and
Ritualist builds were made only of poison items), items with fixed IDs from 130 to 64, and every level-120 build
with a complete guide build to compare beats the best one of its archetype under the same filters (10 of 10,
×1.26 to ×2.23 on the goal). The same 30 scenarios with the archetype's first suggested cycle at 3 clicks/s (e.g.
`4311`, `MMM3M`, `413MMM`): all 30 pass the mana filter, Mana Steal only counts in the cycles with M (and slow
weapons get more per hit), 3 poison items and 43 fixed-ID items in total, and every level-120 build with a guide
build to compare beats it (6 of 6, ×1.14 to ×2.23).

### Verified against Wynnbuilder

Our own code, compared with Wynnbuilder's code and data 2.2.4.0 (scripts in the development workspace, not part
of the site):

- Item data: all 5,414 items – every identification's min/max roll, requirements, skill points; for all 2,390
  weapons damage ranges, attack speed, base DPS and the damage with 1–5 powders of every element (11,035
  variants): 960,241 values, 0 differences.
- Damage: every weapon of every class swapped into generated builds of every archetype at levels 65 and 106 with
  an ability tree (9,312 builds, 84,763 numbers: main attack per hit and DPS, every spell, health): 0 differences
  larger than 0.5 % (largest 0.000 %), skill points identical in all of them.
- Set bonuses: all 79 sets, 1 to all pieces worn (332 builds, 29,548 numbers): 0 differences.

### Ability tree

- **Ability tree** tab: the trees of all five classes (game data 2.2.4.0: node positions, costs, requirements,
  blockers, archetype thresholds, level-dependent AP cap), checked against the Wynncraft wiki. Clicking unlocks
  nodes as in game, and the tree's dominant archetype can be applied to the build with one click.
- The tree is drawn like Wynnbuilder's: the game's node icons (upgrade, ability, major ability, archetype ability
  and core, class spell) and pixel connectors on the 9-column grid, from Wynnbuilder's `media/atree` sprite
  sheets. An unlocked node gets the blue frame and the connectors between two unlocked nodes light up; nodes you
  can't reach yet are dimmed. A small coloured dot marks the archetype a node belongs to.
- **Ability tree effects** (below the summary and in the tree tab): selected nodes enter the calculations.
  Flat bonuses (e.g. Earth Mastery), buff toggles (e.g. Mask of the Lunatic, Activate Backstab) and stack/hit
  sliders (e.g. Corrupted, Focus) change stats, damage multipliers, resistances and spells. Own implementation
  of the semantics of Wynnbuilder's atree.json; results checked against Wynnbuilder's code (1,271 comparisons
  over 75 scenarios, matching within 0.5 %).
- **Copy tree / Paste tree**: the same tree code as Wynnbuilder's "Copy Tree" / "Paste Tree" buttons (Ability Tree
  tab on wynnbuilder.github.io/builder), so a tree can be moved either way; if the browser blocks the clipboard, a
  text box takes the code. Verified against Wynnbuilder's encodeAtree/decodeAtree.
- **Suggest a tree** (one button per archetype): replaces the tree with one for that archetype that fits the AP of
  the chosen level (and the rank's loan), always valid under the tree rules; Undo brings the previous tree back.
  Only the newest tree data is used (2.2.4.0 – Wynncraft 2.2.4, which reworked Ritualist). Each ability is scored
  from the tree data (archetype abilities, class spells, the archetype's ultimate, cheaper spells, masteries of the
  archetype's elements) and by how often **up-to-date** guide builds take it: the trees inside The Ultimate Build
  Guide's Wynnbuilder links are decoded (`src/guide-trees.json`, `npm run update-guide-trees`), and a guide tree is
  only used if its link is from the same data version, or from an older one where that archetype's abilities and
  the tree's abilities have exactly the same structure and the whole tree is still valid. After the latest
  reworks that leaves 64 of 126 guide trees; Shaman, Arcanist and Light Bender have none, so their suggestions
  come from the tree data alone, except Acolyte, which also follows an extra 2.2.4 reference build
  (`scripts/extra-guide-links.json`, counted like two guide trees; add more links there). An ability's value grows
  with its AP cost, and the tree is picked greedily by value per AP, together with the cheapest path of abilities
  leading to each pick. Checked for every class, archetype, level 1–120 and rank:
  always valid, never over the AP limit, no AP left while an ability still fits; at 50 AP the suggestions share
  82–97 % of their abilities with the current reference trees (Jaccard similarity).
- The player's tree (nodes, toggles, sliders, per class) is remembered in the browser, like the rank.
- **Rank** at the top of the form (No rank, VIP, VIP+, HERO, HERO+, CHAMPION): VIP+ borrows 2 AP, HERO and above
  4 AP (Wynncraft wiki), 50 AP at most. The choice is remembered in the browser.

### Aspects and Tomes

Two tabs that pick aspects and Mastery Tomes for the build on screen (generated, guide or solver build). They are
locked below level 60: both are raid rewards (The Worm Holes, a level 54 quest, opens the first raid) and the first
tomes need level 60, so one threshold covers both tabs.

- **Tomes**: 14 slots (Weapon 2, Armour 4, Mysticism 2, Expertise 2, Marathon 2, Lootrun 1, Guild 1), each opening
  at its level (wynncraft.wiki.gg/wiki/Mastery_Tomes). A tome is an item with only identifications (50% rolls, like
  the gear), so every slot gets the tome that adds most to the build together with the tomes already picked, in the
  generator's own model (`evaluateGoal`: goal damage, effective HP, mana against the spell cycle, life sustain,
  with the same EHP/sustain thresholds). The same tome twice is allowed, as in game. Stats the model doesn't count
  (walk speed, thorns, loot bonus) break ties in Marathon, Expertise and Lootrun. Guild tomes add skill points.
- **Aspects**: 4 slots from level 60, 5 from 80 (the 5th also needs Sentinel III, assumed). Each aspect's effects
  are merged into the ability tree the way Wynnbuilder does (`mergeTreeAbilities`, only for active abilities with
  their `deps` active) and the build is recalculated; aspects that only change area, range, cooldowns or durations
  score by the active abilities they improve (counted per ability, more for the goal spell and the tree's main
  archetype). At most one mythic; the max tier is shown.
- Both tabs list the guide builds whose Wynnbuilder links save tomes or aspects, with ✓ on the ones we pick too.
  Only 8 of the 127 links save any: aspect picks match 14 of 25 guide aspects (4 of 5 mythics), tome picks match
  all 7 guide tomes by family (6 exactly; one guide uses tier II where III exists).

### Other tabs

- **Build info**: the class's spells with click combos and the costs from your tree, the archetype's ultimate,
  "what each spell becomes" for the archetype (from the 2.2.4.0 tree node descriptions – which nodes change which
  spell), typical spell cycles (digits for the cycle calculator, with mana cost and how far your Mana Regen
  carries them), what to stack, plus the recommended powders.
- **Build Solver**: own class and archetype choice (the "Archetype fit" slider adds the archetype's weights to the
  targets), modelled on rawfish69's Build Solver – minimum targets (DPS, spell hit, EHP, HP, mana, regen, life
  steal, speed, SP budget), priorities, allowed tiers, minimum item level and "Advanced IDs" (ranges of any
  identifications in order of importance). A beam search with an exact summary of every state returns several
  sets that meet the targets, or the closest ones with a list of what's missing; each can be shown in the grid.
- **Guide builds**: 126 builds from The Ultimate Build Guide (forums.wynncraft.com, thread 320092), decoded from
  Wynnbuilder links, viewable in the grid. The archetype weights were calibrated on these builds.

### UI

- Hints under the controls are a few words each; hover them for the full explanation.
- The whole interface follows the game's GUI: the **Minecraft font** (the one the game uses – clear digits, 5 ≠ S,
  3 ≠ 8; characters it lacks such as · – ✓ come from Pixelify Sans) with a Minecraft-style drop shadow, bevelled
  panels and buttons like the Wynncraft menus, gold titles, black text fields, XP-bar-style bars (`mc-*` classes in
  `MC_STYLES` in `BuildRecommender.jsx`).
- A banner header with the class portraits, and the views (Build, Ability tree, Guide builds, Build Solver, Build
  info) as large folder tabs; on a phone the tab row scrolls sideways.
- Dialogs fade the page behind them and pop in; folded sections slide open; drop-down lists use the browser's
  customisable `<select>` (`appearance: base-select`, Chrome/Edge 135+) with a pixel-style list, and fall back to
  the native list elsewhere. All animations are off with "reduce motion".
- **Dark / Light** switch in the top right corner. The choice is remembered in the browser; without one the site
  follows the system setting. Light mode is a light, inventory-like version of the same GUI: the `mc-*` classes have
  light overrides under `.wbr-mc[data-theme=light]`, and every inline style goes through `ts()`, which swaps the
  game's bright chat colours for darker ones readable on light panels (`LIGHT_COLOR_MAP`); white text (Air,
  Agility, Normal items) stays white with a dark 1 px outline. Item cards keep the dark tooltip look
  (`GameCardContext`). Item icons and the ability tree sprites look the same in both modes.

## Where things are

- `src/BuildRecommender.jsx`: data normalisation, the damage-first generator (`generateDamageBuild()`) with skill
  point validation, the stat weights it pre-scores candidates with (`ARCHETYPES`), and the whole UI. The Creator and
  Optimizer parts: `manualBuild()` (a player's workspace → a build in the generator's shape, with the warnings),
  `workspaceFromWynnbuilderLink()` (link import), `optimizerSpec()` / `runOptimizer()` (the Optimize stages),
  `optContext()` / `optBranchAndBound()` / `optPlane()` (the full search), `ManualWorkspace`, `OptimizeDialog`,
  `OptimizeResult`, `ModeBar`. 0.37: the range sliders (`normalizeRange`, `RangeControl`, `McRangePair`), the build
  link in the address (`encodeShareSettings`, `decodeShareSettings`, `parseBuildHash`, `buildFromShare`,
  `decodeWynnbuilderHash`), `SavedBuildsPanel`, `BuildLinkBar`.
- `src/api-config.json`: the address of the site's server (empty = its features off).
- `worker/`: the site's server (Cloudflare Worker + D1): `src/index.js`, `schema.sql`, `wrangler.toml`,
  `scripts/api-test.mjs` (API test against `wrangler dev --local`).
- `scripts/compare-defaults.mjs`: the new default ranges vs Any on the matrix scenarios.
- `scripts/bench-optimizer.mjs`: the full-search benchmark (`npm run bench:optimizer`).
- `src/wynncraft-items.json`: 5,414 items (Wynnbuilder data 2.2.4.0) with `fixID`, the list of static IDs and the
  item's set, plus the 79 sets with their bonuses.
- `src/guide-builds.json`: the guide builds (items, tomes, authors, Wynnbuilder links).
- `src/tomes-aspects.json`: the tomes that still exist after 2.1 (88), every class's aspects with the tree nodes
  they improve and their effects in the tree-node format, and the tomes/aspects decoded from the guide builds'
  links (written by `scripts/update-tomes-aspects.mjs` from Wynnbuilder's tomes.json and aspects.json).
- `src/guide-trees.json`: the ability trees decoded from those links that still match the current tree data
  (written by `scripts/update-guide-trees.mjs`; outdated ones are only counted).
- `src/item-weights.json`: Wynnpool item weights (135 profiles for 84 items) written by
  `scripts/update-item-weights.mjs`; the script maps the official API's identification names onto the
  Wynnbuilder keys the app uses and checks that every weighted identification exists on the item.
- `src/ehp-range.json`: the highest effective HP reachable per class and level, used for the New generator's EHP
  slider range.
- `src/event-items.json`: items obtainable only during limited-time festivals (written by
  `scripts/update-event-items.mjs` from the wiki's "Festival of the … Items" categories and the Wynncraft API).
- `src/game-icons.js`: class portraits (Wynncraft wiki) and the 16×16 item-type sprites (Wynnbuilder), embedded as
  data URIs.
- `src/item-prices.json`: Trade Market prices (`items`) and today's listings (`live`, `liveAt`) written by
  `scripts/update-prices.mjs` (empty in the repository; filled by the Pages workflow when the `WYNNVENTORY_KEY`
  secret exists).
- `src/ability-trees.json`: the ability trees (from Wynnbuilder's atree.json for 2.2.4.0), the AP-per-level table
  and the node effects (`effects`, `props`, `base`) from the same file.
- `scripts/update-items.mjs`: downloads and trims `items.json` from the Wynnbuilder repository and writes
  `src/wynnbuilder-ids.json` for the Wynnbuilder links.
- `scripts/update-tree-effects.mjs`: adds node effects from `atree.json` to `src/ability-trees.json`.
- `scripts/update-item-weights.mjs`: downloads the Wynnpool weights and translates them to the app's keys.
- Item and tree data come from the Wynnbuilder project (github.com/wynnbuilder/wynnbuilder.github.io, GPL-3.0).

## Sources

- Wynnbuilder – item and tree data, damage formulas, tomes and aspects data (2.2.4.0), powder and damage
  calculations, the build link format for import and export (`wynnbuilderLink`, `decodeWynnbuilderHash`):
  https://wynnbuilder.github.io/ (GPL-3.0)
- Build Solver (rawfish69) – the model for the Build Solver tab (targets, priorities, Advanced IDs, top N,
  "near miss"): https://rawfish69.github.io/build-solver/
- Wynncraft Wiki – weapon DPS, identification rolls, ability trees, powders, skill points, tomes, aspects, raid and
  dungeon levels, version history: https://wynncraft.wiki.gg/
- Wynncraft forums – Stats and Identifications Guide (thread 246308), The Ultimate Build Guide (thread 320092),
  How Damage Is Calculated – Rekindled Edition (thread 320808), threads on spell costs and Mana Steal in 2.0 and on
  Attack Speed and spell damage
- The Ultimate Build Guide – the guide builds, their ability trees, tomes and aspects (starting points and presets):
  https://forums.wynncraft.com/threads/the-ultimate-build-guide.320092/
- Wynnguides (afeenah): https://afeenah.github.io/wynnguides/
- WynnVentory – Trade Market prices for the budget and today's listings: https://wynnventory.com
- Official Wynncraft Wiki (wynncraft.wiki.gg) – class portraits (Archer/Warrior/Mage/Assassin/Shaman.png) and the
  festival item categories; © Wynncraft, used as in other fan-made tools
- Wynnbuilder `media/items/old.png` – the 16×16 item-type sprites (GPL-3.0)
- Wynnpool – community item weights (which identifications matter on an item): https://www.wynnpool.com
  (code and data MIT, https://github.com/AiverAiva/Wynnpool)
- Fonts: "Minecraft" by Pwnage_Block (FontStruct, fontstruct.com/fontstructions/show/432966, CC BY-SA 3.0,
  `src/fonts/minecraft.woff2`, from the `typeface-minecraft` npm package); Pixelify Sans (@fontsource, OFL) for
  the characters it lacks.
- Ability tree sprites (`icons.png`, `connectors.png`, embedded in `BuildRecommender.jsx`): Wynncraft's ability tree
  textures as shipped in Wynnbuilder's `media/atree`; © Wynncraft, used here as in other fan-made tools.
