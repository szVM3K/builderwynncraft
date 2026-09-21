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
```
 
## Features
 
### Generating a build
 
- **Custom stats** in the form: damage focus (Neutral/Earth/Thunder/Water/Fire/Air) as a preference, weapon attack
  speed checkboxes (the weapon is picked among the checked speeds), preferring items from guide builds, extra
  stat priorities (e.g. Mana Regen, Life Steal), defence focus (chosen elemental defences count toward the score;
  "Avoid negative defences" penalises negative ones).
- **Build focus**: three 0–100 % sliders – Main attack DPS, Spell DPS and EHP & sustain. X % means X % of the
  group's full weight (0 % ignores the group, 100 % is full priority); the "meta" mark is the archetype's position
  derived from the calibrated weights (an untouched slider reproduces the calibration exactly). Above meta the
  main attack is scored as the real DPS of the whole set during the search (attack-speed tiers add up, raw × hits
  per second, Strength, crits), with a wider candidate pool and a second pass tuned to the chosen weapon.
- **Item level** window: "Prefer items within 10 levels" (default) lowers the score of items older than the window
  by 4 % per level outside it (never more than half), so an old item wins only when nothing newer comes close;
  also "within 20", "Any item level" or "Only …" (hard cut-off). Pinned items always stay. The solver has its own
  minimum-level field (empty = level − 10).
- **Other picks / Exclude / Unpin** on every card: the next candidates for the slot (score, whether they fit the
  skill points, and the change in the summary – DPS, spell hit, EHP, HP, mana, regen, speed – after the swap).
  Using one pins it and re-fits the rest of the build around it; Exclude removes an item from the pool. Pinned and
  excluded items are listed in Custom stats.
- The score shown on a card and in Other picks is the item's value **in this build**: its identification points,
  its share of the set's real main attack DPS (with the main attack slider above meta), minus the value of the
  skill points the set has to spend because of it and the health-deficit penalty – exactly what the search
  optimises.
- **Score ×10** everywhere in the UI; "How is the score calculated?" above the cards explains the rules
  (value ÷ unit × weight × 10, weapon, penalties, bonuses) on an item from the current build.
- **Score calculation** tab: every stat weight and build-level term (weapon DPS weight, guide-item bonus,
  off-archetype skill point penalty, health deficit, free skill point value, level window) the generator uses
  right now for the chosen archetype and settings, each of them editable (empty field = calculated value).
  Overrides (`options.scoring`) are saved in the browser and apply to the search, Other picks and the Build
  Solver's archetype fit.
- Weapons without base damage (e.g. The Specialist, which only deals powder damage) are not recommended because
  the app doesn't model powders. Builds whose items take away health in total get a penalty.
- "Elemental …" and per-element damage identifications (e.g. Elemental Spell Damage, Water Main Attack Damage)
  count toward the score.
### Item cards
 
- Cards are the in-game tooltip (Wynncraft 2.1 layout) in Pixelify Sans (the closest open font to the game's
  tooltip font): icon in a frame, name in the rarity colour with the average roll "[50.0%]", rarity and type
  badges, elements, powder slots in the corner, big DPS with attack speed (hits/s) and per-element damage ranges,
  or big health with defences; five skill diamonds with check boxes (met by the build's skill points), Class Type
  and Combat Level, identifications in groups (skill points, damage, health/mana/defences, misc, spell costs with
  the class's spell names) with roll tags, Major IDs. The dots at the bottom switch the card's pages: item,
  how to get it (source, Trade Market, wiki link), score breakdown.
- **Identification rolls**: every ID is shown and scored at its 50 % roll (positive = 80 % of base, negative = base)
  with a [xx%] tag like in game; the **Rolls** button sets the roll of the whole item or of each ID separately
  (0–100 %). Rules as in the game / Wynnbuilder: 30–130 % of base for positive IDs, 130–70 % for negative ones,
  spell costs reversed; skill points, static IDs (e.g. attack speed tier) and fixed-ID items don't roll. Archetype
  weights are calibrated on 50 % values.
- **Average DPS** on a weapon card is the number from the in-game tooltip: average base damage × hits per second
  (Normal = 2.05/s). It includes no IDs, skill points, powders or tree – those are in the build's "Main attack DPS".
- The powder slots on cards show the symbol of the recommended powder element.
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
  all other items, including negative ones). The algorithm finds the order with the smallest total (dynamic
  programming over subsets). Checked against Wynnbuilder's `calculate_skillpoints` on 94 builds: 93 identical,
  one 3 SP lower (a valid order Wynnbuilder skips).
### Ability tree
 
- **Ability tree** tab: the trees of all five classes (game data 2.2.4.0: node positions, costs, requirements,
  blockers, archetype thresholds, level-dependent AP cap), checked against the Wynncraft wiki. Clicking unlocks
  nodes as in game, and the tree's dominant archetype can be applied to the build with one click.
- **Ability tree effects** (below the summary and in the tree tab): selected nodes enter the calculations.
  Flat bonuses (e.g. Earth Mastery), buff toggles (e.g. Mask of the Lunatic, Activate Backstab) and stack/hit
  sliders (e.g. Corrupted, Focus) change stats, damage multipliers, resistances and spells. Own implementation
  of the semantics of Wynnbuilder's atree.json; results checked against Wynnbuilder's code (1,271 comparisons
  over 75 scenarios, matching within 0.5 %).
- The player's tree (nodes, toggles, sliders, per class) is remembered in the browser, like the rank.
- **Rank** at the top of the form (No rank, VIP, VIP+, HERO, HERO+, CHAMPION): VIP+ borrows 2 AP, HERO and above
  4 AP (Wynncraft wiki), 50 AP at most. The choice is remembered in the browser.
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
 
- The whole interface follows the game's GUI: the Tiny5 pixel font with a Minecraft-style outline, bevelled panels
  and buttons like the Wynncraft menus, gold titles, black text fields, XP-bar-style bars (`mc-*` classes in
  `MC_STYLES` in `BuildRecommender.jsx`).
## Where things are
 
- `src/BuildRecommender.jsx`: archetype weights (`ARCHETYPES`), personalisation options (`DAMAGE_FOCUS_OPTIONS`,
  `ATTACK_SPEEDS`, `STAT_BOOSTS`), data normalisation, the `generateOptimizedBuild()` algorithm with skill point
  validation, and the whole UI. The weight system is described in the comment at the top of the file.
- `src/wynncraft-items.json`: 5,414 items (Wynnbuilder data 2.2.4.0) with `fixID` and the list of static IDs.
- `src/guide-builds.json`: the guide builds (items, tomes, authors, Wynnbuilder links).
- `src/ability-trees.json`: the ability trees (from Wynnbuilder's atree.json for 2.2.4.0), the AP-per-level table
  and the node effects (`effects`, `props`, `base`) from the same file.
- `scripts/update-items.mjs`: downloads and trims `items.json` from the Wynnbuilder repository.
- `scripts/update-tree-effects.mjs`: adds node effects from `atree.json` to `src/ability-trees.json`.
- Item and tree data come from the Wynnbuilder project (github.com/wynnbuilder/wynnbuilder.github.io, GPL-3.0).
## Sources
 
- Wynnbuilder – item and tree data, damage formulas: https://wynnbuilder.github.io/ (GPL-3.0)
- Build Solver (rawfish69) – the model for the Build Solver tab (targets, priorities, Advanced IDs, top N,
  "near miss"): https://rawfish69.github.io/build-solver/
- Wynncraft Wiki – weapon DPS, identification rolls, ability trees, powders: https://wynncraft.wiki.gg/
- Wynncraft forums – Stats and Identifications Guide (thread 246308), The Ultimate Build Guide (thread 320092),
  How Damage Is Calculated – Rekindled Edition (thread 320808)
- Wynnguides (afeenah): https://afeenah.github.io/wynnguides/
- Fonts: Tiny5 and Pixelify Sans (@fontsource, OFL licence).
