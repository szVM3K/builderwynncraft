# Wynncraft Build Recommender

Pick a level, class and ability-tree archetype and get a full 9-slot build (Helmet, Chestplate, Leggings, Boots,
2× Ring, Bracelet, Necklace, Weapon) chosen from every item in Wynnbuilder's database and validated against the
game's skill-point rules.

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

Useful variables (PowerShell: `$env:NAME="value"; npm run …`, cmd: `set NAME=value && npm run …`, bash:
`NAME=value npm run …`):

| Variable | Default | Meaning |
|---|---|---|
| `MATRIX_LEVELS` | `30,50,70,90,100` | levels of the matrix |
| `MATRIX_VARIANTS` | `base,second,main,lowEhp,noCycle,pinned` | runs per archetype and level |
| `MATRIX_AP_LOAN` | `0` | rank AP loan (2 = VIP+, 4 = HERO+) |
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

The script rewrites `src/wynncraft-items.json`, keeping Wynnbuilder's data layout.

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

The first visit shows a short welcome (what the site is for – levelling from about level 30 to 100 – a link to
The Ultimate Build Guide for endgame builds, and the list of sources). **I confirm** unlocks after 5 seconds and
once the text has been scrolled to the end; the page behind it doesn't scroll meanwhile. The confirmation is kept
in `localStorage` (`wbr-welcome-confirmed-v1`), so the popup doesn't come back; if the browser blocks storage it
simply shows again on the next visit.

### Generating a build

The generator asks *what is the strongest build that still survives and still pays for its spells?* (Until
0.29.0 there was also an "Old", weight-based generator; it was removed in 0.30.0.)

1. **Class** → the main panel immediately shows the class overview: its archetypes (tabs), the spells of the
   suggested tree for each archetype with their mana costs, click combos and damage, and the archetype's usual
   spell cycles – drawn as numbered steps with arrows (spell name, clicks, mana) – with how much mana per second
   they burn and how much Mana Regen *or* Mana Steal your items would need to sustain them. **Use** on a cycle puts
   it into the mana filter (and loads that archetype's tree). Before a class is chosen the page shows the five
   class portraits to pick from.
2. **Rank** and **level**, then an **ability tree** preset (or your own tree from the Ability tree tab).
3. **Maximise**: the main attack or one spell from the tree. That single number is what the search maximises.
4. **Must have** (pass/fail, never weights):
   - **Effective HP** – a slider in 5% steps of the most EHP your level can reach (`src/ehp-range.json`).
   - **Life sustain > 0** (optional) – Health Regen per second (raw × (1 + %), ÷ 4 s) plus Life Steal (÷ 3 s)
     must stay above zero, so the build doesn't drain your health.
   - **Mana: spell cycle** – spells you cast, clicks per second, Mana Steal and ability mana on/off. Income is
     `(Mana Regen + 25) / 5 + Mana Steal / 3`, the cycle lasts `3 × spells / clicks per second`. The clicks field
     can be cleared and retyped (0.5–12); leaving it empty puts the last valid value back.
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

**How the search works.** Everything is evaluated with the same damage and EHP formulas as the summary (checked
against `computeBuildStats`). The search is a beam over the whole database, one weapon at a time (candidates per
slot are pre-scored with numeric stat weights derived from your goal, then the best few get the exact evaluation
with skill points), run twice: once at your EHP and once at +20% EHP, because a set that passes a higher threshold
also passes yours and the "tankier" beam finds other combinations. The best set of *every* weapon is kept, all of
them get a short polish, the best six a full one, and the winner then gets single swaps against every item of
every slot, weapon swaps (every top weapon with its best powder) and **pair swaps** (two slots at once). Builds
found earlier in the same session with the same settings (only the EHP threshold differs) are fed back in as
starting points, so dragging the EHP slider never loses a better build you already found. A progress bar shows
the stage; a search takes about 5-10 s at level 100+.

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
- **Browse items…** opens the item browser: every weapon of your class, armour piece and accessory up to your
  level with filters for name, slot, element, rarity, level range, attack speed and minimum DPS, sorted by value
  in the current build, weapon DPS, level, health or name. Pin puts an item in its slot and re-fits the rest.
- **Identification filter** (item browser and Other picks): "+ Add identification" opens a searchable list of
  every identification in the item data; set an optional minimum for each, match all or any.
- **Weapon powders**: every weapon is compared with the best powder element for your goal in all its slots (the
  highest tier for its level, VII from level 70, VI from 55), like in game and in Wynnbuilder.
- **Set bonuses** as in Wynnbuilder (Morph, Moirai, Petal, Visceral, …); sets marked illegal (e.g. the Hive sets)
  are never combined. Quest-reward items that can't be traded are never put on both ring slots.
- **Other picks / Exclude / Unpin** on every card: the next candidates for the slot with the change in damage and
  EHP after the swap and whether they fit your skill points. Using one pins it and re-fits the rest.

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
  Life Steal, Life per hit, Walk Speed and main attack range. The spell cycle calculator (e.g. "1213" at
  9 clicks/s) shows mana use and balance.
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
  point validation, the stat weights it pre-scores candidates with (`ARCHETYPES`), and the whole UI.
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
- `scripts/update-items.mjs`: downloads and trims `items.json` from the Wynnbuilder repository.
- `scripts/update-tree-effects.mjs`: adds node effects from `atree.json` to `src/ability-trees.json`.
- `scripts/update-item-weights.mjs`: downloads the Wynnpool weights and translates them to the app's keys.
- Item and tree data come from the Wynnbuilder project (github.com/wynnbuilder/wynnbuilder.github.io, GPL-3.0).

## Sources

- Wynnbuilder – item and tree data, damage formulas: https://wynnbuilder.github.io/ (GPL-3.0)
- Build Solver (rawfish69) – the model for the Build Solver tab (targets, priorities, Advanced IDs, top N,
  "near miss"): https://rawfish69.github.io/build-solver/
- Wynncraft Wiki – weapon DPS, identification rolls, ability trees, powders: https://wynncraft.wiki.gg/
- Wynncraft forums – Stats and Identifications Guide (thread 246308), The Ultimate Build Guide (thread 320092),
  How Damage Is Calculated – Rekindled Edition (thread 320808)
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
