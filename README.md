# Duel Atlas · v0.3.1

A mobile-first Yu-Gi-Oh! PWA with a full card archive, local deck workshop, and **Solo Duel · 2004 Lab**. The app is static HTML, CSS and ES-module JavaScript, with an offline synchronous WebAssembly rules runtime. It needs no custom backend, account, duel server, WebRTC, or multiplayer service.

Live app: https://Owningturtle287.github.io/Yu-Gi-Oh-Custom-Dueling/

## This functionality-testing release

- A **slim vertical phase rail on the right** gives the light landscape field more height for cards. The central five-column racks use tighter, fixed spacing sized from the actual safe-area-adjusted table, with a separate wider gutter around Field/Extra and Deck/Graveyard. The rail tiles extend to the screen’s right edge while their labels respect the camera-safe inset. Your field sits lower, separated from the AI by a slim center divider that carries the current instruction. Deck and Graveyard share one centerline, with Banished outside that stack. Both players retain all ten zones and centered hands; controls stay in the outer hand corners and the log opens on demand. Bottom-right actions are 40px tall with readable labels; Confirm gets the flexible primary column alongside compact Cards/Cancel controls rather than competing with a fourth Info button.
- **Artwork stays unobstructed.** ATK/DEF and compact, color-coded Attack/Effect/Flip shortcuts sit in their own side gutter; multiple actions open the card inspector. Narrow landscape screens put stats in a dedicated row below the art and expose all actions by tapping the card. A small gap separates Monster and Spell/Trap rows, including sideways defenders. Resizing updates the geometry without replacing retained card images.
- **Auto-pass** skips routine phase prompts for the current turn. It still asks about attacks, summons, active chains and optional triggered effects. Enchanted Javelin is offered at attack declaration and recovers LP before battle continues. This is an optional activation, not an automatic Trap play. Official text: [Enchanted Javelin](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=4992&ope=2&request_locale=en).
- **Ancient Telescope** shows the opponent’s actual top five cards in a simple numbered strip. Tap any card to enlarge just its artwork; X or Escape returns to the strip, and Done or the strip’s X ends viewing. There is no metadata side panel. Sharp art replaces the thumbnail in the same frame instead of stacking a second image below it. The adapter answers the script’s internal amount prompt with five (or the remaining Deck). Viewing pauses further decisions until explicitly finished, survives rotation, preserves Deck order and does not expose the AI’s private peek in the human UI. Other Deck confirmations use a generic reveal without claiming a top-card order. Official text: [Ancient Telescope](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=4852&ope=2&request_locale=en).
- **Cancel** remains visible for native choices that permit cancellation, including Tribute and attack-target selection after staging a card. An unconfirmed Tribute Summon leaves the cards and Normal Summon allowance intact. Once a real cost or action has committed, the interface follows the core’s legal choices and does not invent an undo.

- Solo has one **Strategic AI** policy, always at full strength. AI decision speed controls pacing independently of intelligence and animations.
- A selective turn planner looks up to three main-phase actions ahead, then estimates the resulting Battle Phase and the opponent’s visible counterattack. It compares removal/summon/boost/control/revival sequences, temporary effects, borrowed monsters, LP/discard/Tribute costs and safe stopping. It replans after every actual response. The search is bounded to 96 distinct projected states with a four-line beam; combat searches also have fixed node limits and reuse equivalent calculations.
- Structured card guidance supplements typed effect heuristics. The AI preserves available Fusion materials and combo partners, understands Cyber-Stein → Fusion → Megamorph and Exiled Force → removal → attack, and gives equip effects their own target roles. Native-core regressions execute both combinations through their real costs, targets and battle results.
- Each player has separate memory of public cards and private reveals addressed to them. Known cards can be tracked through a public move, but a hand shuffle removes slot associations and a return to the Deck forgets the draw position. Face-down estimates use an eligible-card probability pool and public evidence, never the actual opposing deck. Observed traps and known hand wipes inform caution. Hidden identities/stats, private logs, backups and draw order are excluded from worker requests.
- Reproducible, seed-based variety chooses only between similarly scored positive moves of the same kind. Lethal lines, emergency responses, required choices, targets and costs retain the highest-ranked choice. The same match/prompt remains replayable.
- Production decisions run in an ES-module Web Worker. Rotation, leaving or restarting cancels pending work; the arena validates the current prompt before applying a result. Unsupported workers, errors or a 1.4-second deadline use the bounded tactical fallback. This keeps search off the animation thread; phone performance still needs device testing.
- **The native core remains the rules authority.** This is a heuristic AI with selective projections and public-information probabilities. It does not perform exhaustive game-tree search, learn online, inspect hidden cards, call a language model or require a server. Unknown effects use conservative heuristics; it can still make mistakes.

- Mandatory effect activations proceed automatically, including multiple Archfiend Standby upkeeps, while actual targets, costs, searches and optional effects remain interactive. Native chain order/negation/timing is preserved; forced activation selections use core order, and explicit ordering prompts still ask the player.
- Effects show an enlarged card centered on the field with a short activation/result caption below it. Automatic notices need no confirmation, and AI decisions wait for their presentation. Optional responses use the same card-first layout with one bounded description, compact colored actions and timing context. There is no layered brief/full-text reader. Motion-off, reduced motion, rotation and leaving the arena clean up the notice.
- Source binding validates the native card code instead of attaching an effect to an unrelated/stale field or pile identity. Perfect Machine King’s bonus is continuous and applies only face-up in its Monster Zone; it has no banished activation. Shadowknight upkeep, protection rolls, halved damage and Pandemonium replacement have focused regressions.
- Robbin’ Zombie becomes ready when its activation resolves; it sends the opponent’s top Deck card to the Graveyard **after your monster inflicts battle damage**, not simply on flipping the Trap face-up. Its required damage trigger resolves automatically through the native chain. The result names the moved card and destination. Negated Traps do not apply their effects. Receipts also report confirmed draws, position changes and counters. Official texts: [Shadowknight Archfiend](https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=5773&request_locale=en), [Perfect Machine King](https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=5804&request_locale=en), [Robbin’ Zombie](https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=5920&request_locale=en).

- Daylight menus use ivory/white surfaces, navy type, teal actions, gold accents and compact icon cards across Home, Archive, Deck Builder, Solo setup and in-duel sheets. Card actions retain semantic colors with readable contrast. The field uses the same light direction and the log is available on demand. PWA chrome follows the app/arena context.
- Starting a duel shows an original 3D coin toss when **Goes first → Coin toss** is selected, then a centered moving **DUEL** announcement. Heads means you, tails means AI; the displayed result is the actual first player used by the core. Fixed first-player settings skip the toss. **Skip intro**, disabled animations, reduced motion, navigation and portrait rotation are handled without rerolling, reshuffling or executing a hidden phase.
- Deck Builder has **Find & add** for the two-row tray/search workspace and **Your deck** for a vertically scrollable four-column view. Search the current deck, show only Monsters/Spells/Traps, and order by type, name, ATK, DEF or Level/Rank. Display filters never remove or reorder saved cards; quantities, Main/Extra/Side and card inspection remain available.
- Deleting a saved deck updates storage before the UI, reads the latest saved list, and replaces a deleted active draft with another saved deck or a fresh draft. It cannot silently reappear as an unsaved deck. Failed writes preserve the deck and current edits; deleting a different deck preserves the active draft.

- A single gradient attack arrow appears after selecting a legal target and during the declared attack. It uses the field’s own viewport, avoiding offsets from safe areas, borders or the phase rail. Hover/focus no longer create extra paths. Strikes share the same geometry, with one arrowhead and a traveling light particle. Canceling or finishing an attack removes its targeting cue.
- Graveyard and banished sheets show the newest cards first without changing the underlying pile order or exposing hidden opposing cards.
- Damage Step response previews and the phase tracker distinguish attack declaration, start, before calculation, calculation, after calculation and end. The full strike waits until calculation responses resolve. Confirmed effect changes are logged with actual ATK/DEF values. Castle Walls, chained boosts, Flip timing, Kuriboh and Counter Traps have native-core regressions. AI waits for its face-down defender to be revealed before using Castle Walls on it.
- Lethal damage now displays **0 LP**. The native core's signed value is decoded before it reaches the arena or counter animation, preventing unsigned overflow after overkill.
- Each player's Main Deck is shuffled independently before opening draws, including saved/custom decks. The saved/editor order is preserved. New duel seeds produce new draws; a fixed seed remains reproducible for regression testing.
- The larger card inspector shows art and a scrollable description together, with actions below the text. The redundant Read description / Return to duel buttons are removed; the top-right X closes the sheet and resumes play.
- Exchange + Gaia is covered through both the native rules and arena controls: Gaia can be summoned using two Tributes if a Normal Summon/Set is available. If a summon was already performed, the inspector explains that Tribute Summons normally share that allowance; Exchange does not grant another. Card effects can permit additional summons. See the [official rulebook](https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf).
- Response cards retain timing/effect explanations and **Activate / Pass once / Pass turn**, with **Ask again** to undo turn passing. Required activations are automatic; actual costs and target/option choices remain interactive. Logs name costs, targets, chain resolution, movement and negation.

- A compact, styled duel settings panel with AI speed, motion toggle, log/rules shortcuts, deck saving, resume and surrender.
- Both players' ten zones, mirrored auxiliary piles, centered hands, POV life counters and iPhone safe areas remain in the bounded landscape arena. The phase rail and card metadata have dedicated tracks; no control covers the field card artwork.
- A full EDOPro rules core replaces the production hand-written effect subset. The pinned pack covers the playable TCG pool through December 31, 2004, including Rituals, Fusion procedures, Chaos, Spirit, Union and Toon effects, counters, tokens, chains, costs, damage-step timing and alternate victories.
- Archive dates retain both TCG and OCG metadata. Choose TCG, OCG or earliest playable release, with year context for that region. Current-year browsing includes undated cards; historical cutoffs require verified dates. An empty search offers **Search all years** while retaining the query.
- All three Egyptian God Cards remain searchable in the current archive. The API records their playable editions after 2002; collector promos and anime appearances are not used as playable release dates. Their historical exclusion is intentional, not a missing archive entry.

## Run locally

Use Node.js 22 or later:

```sh
npm ci
npm run dev
```

Open http://localhost:4173. `predev`, `pretest` and `prebuild` prepare the pinned runtime automatically. Serve over HTTP rather than opening `index.html` as a file. To serve the production output:

```sh
npm run build
node scripts/serve.mjs dist
```

Use HTTPS for installation on a phone. On iPhone, open the live link in Safari and choose **Share → Add to Home Screen**. Android Chrome offers **Install app** in its menu. The app includes standalone/maskable icons, a relative-scope manifest, service worker, viewport-fit and safe-area handling.

## Archive and deck workshop

The archive uses one complete `cardinfo.php?misc=yes` request to YGOPRODeck, caches normalized metadata in IndexedDB for a day, and retains an offline fallback. Name, archetype and text searches combine with Monster / Spell / Trap / Extra, attribute, race, Spirit and other subtypes, mechanic, date and sort filters. Results use a continuous virtualized grid with three columns on normal phone panels. The separate **Your deck** view uses four columns for cards already in the selected deck section. Official card images are requested on demand, never mass-prefetched; the service worker paces uncached image requests to eight per second.

Quick red/green quantity controls edit cards without opening them or resetting scroll. Tap the rest of a card to inspect its art, complete type line and effect. The deck workshop offers a saved-deck switcher, two-row horizontal tray, Main / Extra / Side, local names and storage, a three-copy cap, totals, JSON/YDK backups and mechanic presets. **Pre-Synchro** is a mechanic restriction, not a historical format. Saved release year and region are restored with JSON backups. Existing decks retain their cards when restrictions change and show warnings.

Release-year filters use the earliest valid API date in the chosen region, including December 31. A missing date is not invented from a reprint set. Current-year browsing includes unverified dates so OCG-only and undated entries remain discoverable; dated future releases remain excluded. Historical filters use verified dates and current card text, without past banlists. API metadata can be corrected upstream; **Refresh archive** requests a new snapshot. Old cache schemas refresh once and still fall back safely offline.

## Solo Duel · 2004 Lab

Rotate the phone to landscape. Portrait pauses play and shows the rotation prompt. The AI stays above you, with mirrored Field/Extra on each player's left, Deck/Graveyard/Banished on their right, hands along the outer edges, phases vertically on the right and compact controls in the outer hand corners. There is no side console. Only hands, card/pile/reveal lists, effect descriptions and the on-demand log scroll. The main arena never scrolls.

**Your deck / AI deck** independently select saved/custom decks, random cards or random cards from a released set. Eligibility includes TCG cutoff through 2004, monster race, attribute, subtype and Spell/Trap switches. Narrow/set pools may be incomplete; generation explains insufficient pools without relaxing filters. Saved decks are checked against canonical API records before starting. One Strategic AI policy is used in every match; decision speed changes pauses independently of animations. AI choices use its own cards, public field information and selections revealed by rules, never hidden opposing stats.

The player automatically draws and reaches Main 1. Tap a card to inspect it; legal shortcuts appear on field cards. Targets and Tributes highlight on the board; directional arrows show attack source and destination. Tribute Summon / Tribute Set are labeled explicitly. Multi-card costs show selected cards and **Confirm**; **Cards** opens a compact picker for mixed field/pile targets. Card declarations have a searchable picker. Effect ordering and counter allocations can be reset before confirming. The native core supplies legal actions and validates every actual response.

**Response cards** appear when the core offers a legal effect. Read the timing context and effect text, then activate or pass. **Pass once** declines this opportunity. **Auto-pass** skips routine phase prompts for the current turn; attacks, summons, active chains and optional triggered effects still ask. **Undo / Ask again** restores routine prompts. It resets automatically next turn. Mandatory activations do not ask for confirmation; actual mandatory target, cost, search and ordering choices still ask for input. Closing a preview returns to the field; **Review card** reopens it.

For a face-down defender, choose **Pass once** at attack declaration/start, then activate Castle Walls at **Before damage calculation**, after the defender is revealed. Its +500 DEF applies before battle comparison; Flip effects resolve after calculation. Only effects the core permits are offered at each checkpoint. Timing follows the [official Konami Damage Step guide](https://www.yugioh-card.com/eu/play/damage-step-rules/) and [fast-effect timing chart](https://www.yugioh-card.com/eu/play/fast-effect-timing/), using current card text rather than historical errata.

The log button opens chronological events with filters and a jump-to-latest control. The field has no persistent terminal. Inspection, menus and portrait rotation pause AI. Motion respects reduced-motion preferences. Small card and pile sheets retain the field behind them; card art shows an immediate thumbnail while full art decodes. The arena patches existing image nodes across phase changes.

### Coverage and limits

The audited API snapshot contains 14,607 archive records and 1,558 records with TCG dates through 2004. **1,555 playable records are supported.** The remaining records are `???` and two non-duel World Championship prize cards, **Meteo the Matchless** and **Ulevo**; they remain searchable. The offline pack contains the earlier worldwide card scripts and transitive helper dependencies, including alternate card IDs. **Solo → Rules & cards → Browse card support** shows live archive coverage.

Dueling uses the pinned upstream core/card scripts and their current errata, modern turn rules (five opening cards; first player skips the first draw and Battle Phase; six-card hand limit), separate Field zones, three copies and no banlist. **This is an early functionality-testing release, not an exact 2004 tournament emulator.** Exhaustive card-combination certification is not claimed. AI combines bounded combat planning, resource evaluation and explicit card-intent hints with conservative fallbacks; it has no exhaustive combo library or full duel-tree search. Side decking, historical text/rulings and multiplayer are not implemented. A match is kept in memory while navigating; reloading ends it. Saved decks and settings persist locally.

The old pure engine remains as a regression fixture; production Solo uses `native-engine.js`. No unsupported card is silently converted into a Normal Monster.

### Pinned runtime and source

The browser uses `ocgcore-wasm@0.1.2` in synchronous mode; it requires neither JSPI nor cross-origin isolation. npm integrity is locked. EDOPro core, Lua and Project Ignis sources, licenses, revisions and local JavaScript protocol fixes are described in [THIRD_PARTY_NOTICES.md](assets/rules/THIRD_PARTY_NOTICES.md). Those notices, original Lua sources, numeric records, runtime and all shell modules are included in the static build and offline cache.

Normal builds never fetch card scripts or SQL databases. To deliberately regenerate the rule pack, download the specified API snapshot, BabelCDB SQLite database and pinned CardScripts source archive, then run:

```sh
python scripts/update-rules.py --cards cards.json --database cards.cdb --scripts CardScripts.tar.gz --scripts-revision 5138eb120d9f6f6caa04dbba22b64ef451302b95 --database-revision 70e53af2dc6c5cecebd48ff4f945c560625c99a2
npm test
npm run build
```

Review generated changes before changing upstream revisions. The manifest records SHA-256 hashes. Keep core and scripts compatible; new scripts can require newer core APIs.

## Verify

```sh
npm test
npm run build
npm run test:live
npm run test:duel-live
```

The **251 automated tests** cover archive/filter/date/storage/import/export/menu flows, production native Solo interactions, height-based card fitting across landscape phones and safe-area reductions, aligned piles, edge-filling phase tiles with safe labels, single-card reveal zoom/back/close behavior, separate artwork/control tracks, stable image nodes, targeting, movement, hidden-card privacy, legacy terminal typing, offline shell completeness, and legacy engine regressions. AI regressions cover losing ATK/DEF comparisons, modified stats, multi-attack lethal order, safe target confirmation, hidden-information invariance, destructive/control/revival target roles, discard/Tribute economy, search playability, response timing, position prompts, Exodia preservation, numeric LP costs and tribute-burn lethal. Production-core tests verify safe battle exit, opposing-Graveyard revival and actual discard/target resolution. Earlier effect regressions cover multiple automatic Archfiend upkeeps, insufficient LP, Pandemonium, automatic protection dice, half battle damage, face-up/banished Perfect Machine King, Robbin’ Zombie activation versus damage timing and Jinzo negation, mandatory search choices, source-descriptor validation, draw receipts and display cancellation/AI pacing. Earlier checks cover active/last/non-active deck deletion, storage failures, category/query/sort combinations without saved-order mutation, four-column layout contracts, light field/menu palettes, semantic action contrast, coin/first-player agreement, opening skip/cancellation, reduced motion and navigation without extra draws. Attack regressions verify a single selected-target path, SVG viewport alignment with simulated safe-area offsets and scale, arrow orientation in both directions, original victim positions after destruction, delayed strikes and animation cleanup. Pile-sheet tests verify newest-first ordering and hidden-card privacy. Damage Step regressions cover face-down target legality, a post-reveal Castle Walls bonus and expiry, stacked boosts/chain order, Flip effects after calculation, battle destruction timing, Kuriboh prevention, Counter Trap negation, AI defense targeting and the playable response UI. Native/arena tests verify lethal battle/effect LP clamping, independent reproducible shuffles without saved-deck mutation, and both legal and blocked Exchange/Gaia summon cases. Response tests exercise automatic card previews, activation, single/turn passes, undo/reset, multiple cards, optional native triggers and mandatory-choice protection. Log tests verify Tribute to the Doomed’s cost/target/destruction and Solemn Judgment’s cost/negation. Native tests initialize every included early card, test Ritual/Fusion/Chaos/Spirit/Union/Toon/counter/token behavior, reject stale actions, preserve field identities, verify God Card/date handling and complete seeded AI games. The most recent full-catalog engine check generated 48 decks across 27 released set pools and completed 40 matches / 5,131 legal actions, exercising 62 named activations. These checks do not prove every possible card interaction.

The reproducible AI benchmark compares against the frozen **v0.2.7** policy, swapping seats for every seed, with equal constructed decks and independently generated random decks under actual native rules. Run `npm run test:ai`, or `DUEL_CARD_SNAPSHOT=cards.json npm run test:ai` offline. `AI_BENCH_SEEDS=20` runs 80 games; `AI_BENCH_SEED_START=21` selects separate seeds. `AI_BENCH_BASELINE=v026` retains the older comparison. Finite deck/opening samples do not establish universal strength. The v0.2.8 release won **99 of 160 games (61.9%)** against v0.2.7: 50/80 on seeds 1–20 and 49/80 on seeds 21–40. These matches completed 19,950 legal actions. The longest local decision was 406 ms; this is a desktop measurement, not an iPhone benchmark.

`npm run tune:ai` compares three evaluation-weight profiles offline, selects by paired win rate and checks the selected profile on disjoint seeds starting at 101. Ties retain the balanced profile. It never edits production weights; review the held-out result before making a change. Set `AI_TUNE_SEEDS` for games per pool/seat and `AI_TUNE_REPORT=report.json` for a report. No training or tournament simulation runs in the player’s app.

Optional live checks access YGOPRODeck. For a repeatable offline full-catalog run, set `DUEL_CARD_SNAPSHOT` and `DUEL_SET_SNAPSHOT` to saved API JSON files when running `test:duel-live`.

Rendered browser/device QA was unavailable in this environment. DOM/style tests cannot establish actual Safari pixels, touch feel, motion smoothness or installation behavior. Device acceptance: try 844×390 and 390×844 on iPhone 14, rotate in both directions with the notch, inspect card and pile sheets, check adjacent four-digit stats and every field row, check light menu contrast, watch/skip the opening coin toss, switch the deck overview to four columns and filter it, delete the active/last saved deck, adjust AI speed, follow attack arrows for both players, test lethal damage at low LP, Tribute Summon Gaia after Exchange, inspect a long effect beside the card art, complete a duel, open and filter the on-demand log, inspect Telescope’s numbered reveal, cancel a staged Tribute or attack target, reopen saved decks, and check installed/offline use. No main page scrolling or zone overlap should occur.

## Deploy with GitHub Pages

The existing `.github/workflows/pages.yml` (workflow filename may differ) runs tests and builds on pushes to `main`, uploads `dist/` and deploys through the official Pages actions. In repository **Settings → Pages**, choose **GitHub Actions** as the source. A custom domain/backend is unnecessary. For another static host, publish `dist/` over HTTPS.

All paths are relative for GitHub project subdirectories. Version package/core/HTML/service-worker caches together. A new worker caches the complete release before activation; viewed card images persist separately. Reload/reopen the installed app after deployment to receive the update. Browser storage stays local; export a backup before clearing site data.

## Project layout

- `src/app.js`, `core.js`, `cards.js`, `era.js`, `deck-view.js`: shell, archive, storage/backups, region/year filters.
- `src/duel/native-loader.js`, `native-engine.js`, `rules-manifest.js`: pinned rules pack, core protocol adapter and legal/AI actions.
- `src/duel/ui.js`, `field.js`, `motion.js`, `dom.js`, `terminal.js`, `card-view.js`, `responses.js`, `attack-arrows.js`, `battle-timing.js`, `intro.js`, `effects.js`, `duel.css`, `light.css`, `effects.css`: setup, board targeting, movement, stable art, reveal/choice presentation and inspection. The retained `terminal.js` component has isolated legacy tests and is not mounted in the arena.
- `src/duel/native-ai.js`, `ai-knowledge.js`, `ai-guidance.js`, `ai-memory.js`, `ai-combat.js`, `ai-turn.js`: single policy, private observation, public memory, card guidance and bounded turn/combat planning.
- `src/duel/ai-client.js`, `ai-worker.js`: redacted background decisions, cancellation and tactical fallback.
- `scripts/bench-ai.mjs`, `tune-ai.mjs`, `tests/ai-baselines/`: paired native-core comparisons, offline weight tuning and frozen prior policies.
- `src/duel/decks.js`, `catalog.js`: eligible pools, deck generation/validation and rule coverage.
- `src/duel/engine.js`, `ai.js`: retained deterministic legacy regression engine.
- `assets/rules/`: original Lua/numeric shards, manifest, licenses and source links.
- `scripts/prepare-runtime.mjs`, `update-rules.py`, `build.mjs`: pinned runtime preparation, intentional data generation and static build.
- `tests/`: storage, archive, app/arena, native/legacy engine, motion, terminal and PWA checks.

Card names, text and official images retain their respective rights holders' rights. Data/images come from YGOPRODeck. This independent fan app is unaffiliated with Konami. Branding is original; the authentic gameplay card back is credited in [assets/CREDITS.md](assets/CREDITS.md) and is not branding.
