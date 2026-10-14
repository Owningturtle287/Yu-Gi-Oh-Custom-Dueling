# Duel Atlas · v0.1.1

A mobile-first Yu-Gi-Oh! PWA with a full card archive, local deck workshop, and a playable **Solo Duel · 2002 Lab**. Plain HTML, CSS, and ES-module JavaScript; static hosting, no custom backend or runtime dependencies.

## v0.1.1 · Movement and readability

- Authentic card backs appear on Set cards, draw piles, and the AI hand. Both face-up and face-down Defense Position cards rotate sideways as one complete surface.
- Player turns advance automatically through Draw and Standby to Main Phase 1. The engine still draws exactly once, preserves the first-player draw exception, and pauses for real chains/target choices.
- AI decision speed is separate from difficulty and animation preferences: Fast (180ms), Normal (700ms), Relaxed (1.5s), or Deliberate (2.5s). Change it in Match setup or the turn menu. Empty response windows pass promptly without an artificial thinking delay.
- Card movement uses a location-based animation layer: opening deals, deck-to-hand draws/searches, summons, Sets, flips/position changes, activations, revival, control transfers, returns, Graveyard/banish moves, attack lunges/trails/impacts, and LP counters. Moves finish before the next AI decision. Navigation, resizing, reduced motion, and unavailable animation APIs settle safely without applying another game action.
- A visible **Log** button opens a larger sheet with turn groups, phase/actor labels, attack stats/results, explicit LP changes, event filters, and smooth **Jump to latest**. The last 500 events are retained. The duel pauses while the sheet is open.

## Play the 2002 Lab

Open **Solo Duel** in the bottom navigation or Home. The three setup panels keep the controls within the phone viewport:

- **Your deck / AI deck:** independently choose a saved/custom deck, random cards, or random cards from a released set. Card eligibility offers a release-year cutoff through 2002, monster type/race, attribute, subtype, and Spell/Trap switches. Filters also apply to saved decks.
- **Saved / custom deck → Design/Edit:** opens the existing deck builder with playable early cards. **Save & return to Solo** assigns the deck to that duelist. Main Decks need 40–60 cards; the Extra Deck allows supported Fusions, up to 15. Side Decks are not used in single games.
- **Random cards / sets:** generates a 40-card deck with a three-copy limit, enough low-level monsters, and some higher-level cards where available. Set generation uses real API set memberships and set release dates, intersected with the card’s first TCG date, effect support, and the selected filters. Sets with insufficient cards are disabled; filters are never silently broadened. Eligible Fusions and Polymerization can be included when their materials are present.
- **Match:** Easy, Normal, or Hard AI; independent AI decision speed; you/AI/coin-toss first; 8,000 or 4,000 LP; animations on/off. Hard changes action priorities and risk assessment. No difficulty receives opposing hidden cards or draw order for scoring.

Tap a hand or field card to inspect its text and see currently legal actions. Target and Tribute choices have explicit lists. The phase tracker follows **Draw → Standby → Main 1 → Battle → Main 2 → End**. Your Draw and Standby Phases advance automatically; use **Next** for later phases, **End turn** to skip remaining Main/Battle actions, and **Respond / Pass** when a response is available. Windows without any possible response pass automatically.

The arena has five Monster and five Spell/Trap zones per player. Field Spells, the Graveyard, banished cards, and your Extra Deck are accessible through the visible **Your piles / AI piles** controls. Deck order and opposing face-down cards stay hidden. On short portrait viewports, **Show S/T / Show monsters** switches the board layer to preserve usable targets. Taller phones show both rows; landscape puts the fields beside the hand and controls.

The always-visible **Log** button opens the expanded chronological log. The turn menu offers AI decision speed, the duel log, support/rules information, animation setting, surrender, and **Save your deck / Save AI deck** for retaining generated decks in local storage. Leaving Solo pauses the match; returning resumes it. **Reloading the page ends the current test match.** Decks and setup preferences persist.

## Engine coverage and deliberate limits

The live archive checked for this release contains **14,607 cards**, **607** with normalized TCG dates through December 31, 2002. **384** are currently admitted to duels: 243 Normal Monsters, 26 material-only Fusions, and 115 registered effect monsters, Spells, and Traps. Counts can change when the API corrects its metadata. **Solo → 2002 Lab / Rules & cards → Browse card support** shows the current status of every early card.

Implemented mechanics include Normal/Tribute/Flip/Set summons, one Normal Summon per turn, battle position restrictions, direct and monster attacks, ATK/DEF and piercing damage, multiple attacks where supported, turn-limited stat changes, Equip/Field/continuous bonuses, draw/heal/burn/destruction, revival, temporary control, registered FLIP and battle effects, named-material Fusion Summons, Spell/Trap response chains, counter speeds/costs, hand-limit discards, deck-out, LP victory, Exodia, and surrender. Tests exercise examples such as Man-Eater Bug, Mirror Force, Trap Hole, Jinzo, Waboku, Magic Jammer, Seven Tools of the Bandit, Monster Reborn, and Polymerization.

**This is an early test engine, not complete Yu-Gi-Oh! rules compatibility.** Unsupported effects and summoning procedures are rejected, never silently played as Normal Monsters. Rituals, many complex early effects, and all post-2002 cards remain outside Solo. The full archive and general deck builder retain those cards.

The engine uses current API card text and modern core turn rules: five opening cards, no first-turn draw or Battle Phase for the first player, six-card End Phase hand limit, and separate Field zones. It has a three-copy limit and **no historical banlist**. This is not an exact 2002 tournament format. Specific current simplifications:

- Response chains resolve last-in-first-out, but simultaneous mandatory trigger ordering and optional timing are simplified. Registered FLIP effects use a target prompt after damage calculation, without a separate damage-step chain.
- Main and phase transitions, summons, and attack declarations provide response windows. Full priority/timing rules between every possible action are not reconstructed.
- If a responding effect removes an attack target, that declared attack stops rather than opening a full attack-replay ruling flow.
- API set names can group later reprints of an eligible old card. Set generation filters card and set release dates, but does not reconstruct exact original pack printings.

There is **no WebRTC, matchmaking, multiplayer connection, or dedicated game server**. Multiplayer remains an explicit coming-soon preview.

## Archive and deck workshop

- Full [YGOPRODeck archive](https://ygoprodeck.com/api-guide/), with one full request, local name/archetype/effect search, category/attribute/race/subtype/mechanic filters, and sorting. Continuous virtual results; no paginated sample list.
- Normal archive release-year selection defaults to the device’s current year through today. Past years include December 31. Spirit is in the subtype filters. Data-derived year highlights identify introductions represented in the API.
- Named local Main/Extra/Side decks; top saved-deck switcher, safe handling of unsaved edits, two-row visible deck tray, separate red/green quantity controls, and card inspection. Three copies across sections, section capacities 60/15/15, and placement validation.
- Mechanic restrictions include Fusion, Synchro, Xyz, Pendulum, Link, All mechanics, and Pre-Synchro. These are mechanic switches, not historical banlists. Existing out-of-year/disabled cards are retained and flagged.
- JSON/YDK import and export, all-deck backups/restoration, and legacy snapshot/date enrichment. JSON retains card details, year, and restrictions; YDK retains IDs, sections, and quantities and needs the archive for import.
- Metadata cache schema 3 adds set memberships. Existing caches refresh once; failed requests can still fall back to older usable metadata. Deck storage remains compatible with v1.

## Run and verify locally

Use Node.js 22 or newer:

```sh
npm ci
npm run dev
```

Open `http://localhost:4173`. Use HTTP rather than a `file:` URL. Runtime files can also be served by any static server, without npm dependencies.

```sh
npm test                # deterministic model, DOM interaction, and PWA tests
npm run test:live       # full archive, search/filter, storage and backup checks
npm run test:duel-live  # full API + set dates, generators and 40 complete AI matches
npm run build           # static output in dist/
```

The optional duel check can reuse downloaded API JSON for repeatable debugging without network traffic:

```sh
DUEL_CARD_SNAPSHOT=/path/cardinfo.json DUEL_SET_SNAPSHOT=/path/cardsets.json npm run test:duel-live
```

Happy DOM is development-only. The live API checks are separate from CI, so an upstream outage does not block normal source checks.

## Deploy from GitHub

The existing **Test and deploy Duel Atlas** workflow tests and builds pushes to `main`, uploads `dist/`, and deploys with the official GitHub Pages actions. Pull requests test/build without publishing. For a new repository, select **Settings → Pages → Build and deployment → Source → GitHub Actions**.

Live app: **https://Owningturtle287.github.io/Yu-Gi-Oh-Custom-Dueling/**

All asset/module/manifest/service-worker paths are relative, so the app works under a GitHub project subdirectory or another static HTTPS host. The service worker’s `shell-v0.1.1` cache includes every Solo module and stylesheet as one complete release. Bump the package, core, HTML, and shell-cache versions when publishing changed assets.

## Install, offline use, and layout

- **iPhone/iPad:** Safari → Share → Add to Home Screen. **Android:** Chrome → menu → Install app / Add to Home screen. The top-right app menu provides installation help.
- Open the archive online once. Metadata is cached in IndexedDB, normally refreshed after 24 hours, and reused when requests fail. Set dates have a separate small local cache. Local Solo needs no network once required data and the shell are cached. Unviewed images still need a connection.
- Only viewed card images are fetched/cached, with uncached image requests spaced to at most eight per second. Search, filtering, deck generation, AI, and game rules run locally. No bulk image downloads.
- Saved decks and Solo preferences use this browser/device’s localStorage. Export backups before clearing data or moving devices. Storage failures are visible and do not silently overwrite corrupt deck data.
- The page and main screen remain bounded by `100dvh` with safe-area padding and fixed bottom navigation. Only card results, deck/hand strips, saved decks, card-choice/pile/log lists, and long text have dedicated scroll containers. The arena itself does not scroll.
- Primary controls use 44px targets, accessible names, visible focus, and native modal focus containment; deck quantity buttons intentionally use 30px. Arena animations cover summons, activations, attacks, damage, and phase changes. Reduced-motion preferences disable them.

## Verification record

The release passes **76 automated tests**. The suite covers existing archive/deck workflows plus setup filters, custom AI-deck design/return, set-load retry, starting a match, phase progression, real card actions, pause/resume, surrender, generated-deck saving, rules/effects, hidden-information invariance, card conservation, layout contracts, and complete seeded matches.

A check against the full API archive and set-date snapshot found **nine playable set pools**, performed **30 generation checks**, and completed **40 matches / 11,191 legal actions** while preserving every card instance. Another 12 seeded matches run in the deterministic test suite. Presentation tests cover automatic draws, chain/choice interruptions, AI speed persistence, hidden-image privacy, sideways backs, animation completion/cancellation, and log filtering/pause/resume. The static build and complete service-worker shell are checked before deployment.

**Rendered browser/device QA was unavailable in the build environment.** DOM and CSS contract tests do not establish actual phone pixels, touch feel, animation smoothness, installation behavior, or Safari/Chrome offline behavior. Device acceptance:

1. Test 320×568 and 390×844 portrait plus landscape. Keep the arena, phase tracker, hand, and action controls visible without page scrolling. On short phones, switch Monster / S/T layers.
2. Start random-card and random-set matches; change AI difficulty, decision speed, and eligibility; try an invalid saved deck. Confirm errors explain what to change.
3. Design and save an AI deck, return to Solo, summon/Set/Tribute, inspect targets, attack, respond, discard, and finish a game. Test generated-deck saving and a rematch.
4. Confirm opponent hand, deck order, and face-down cards stay hidden during animations too. Verify automatic Draw → Main 1, sideways Set cards, draw/summon/attack/Graveyard movement, adjustable AI pace, and the expanded log. Check reduced motion, rotation, cancellation, and pause/resume across tabs.
5. Recheck archive search, quick edits, deck switching, filters, JSON/YDK backups, installation, and airplane-mode cached use. Multiplayer must remain inactive.

## Project layout

```text
index.html / styles.css    Shared PWA shell and archive/deck layout
src/app.js                 Navigation, archive, deck workshop, Solo bridge
src/core.js / era.js        Card normalization, filters, deck storage/backups, dates
src/cards.js               Full API loader and IndexedDB cache
src/layout.js / icons.js   Grid geometry and original SVG control icons
src/duel/catalog.js        Explicit card/effect capability registry
src/duel/decks.js          Eligibility, validation, random decks, set metadata
src/duel/engine.js         Pure deterministic rules/actions and observations
src/duel/ai.js             Hidden-safe difficulty scoring
src/duel/ui.js / duel.css  Solo setup, card choices, fixed arena, expanded log
src/duel/motion.js         Hidden-safe movement plans, Web Animations, cancellation
src/duel/flow.js / log.js   Automatic opening phases, AI speed, chronological log groups
assets/                   Original emblem and PWA icon sizes
sw.js / manifest.*        Offline shell, viewed images, relative PWA scope
scripts/ / tests/         Local server, build, live checks, automated tests
```

Card data and official card images come from YGOPRODeck; Yu-Gi-Oh! names, text, and images belong to their respective rights holders. This independent fan companion is unaffiliated with Konami. Branding and navigation artwork are original. The authentic gameplay card back is sourced from https://images.ygoprodeck.com/images/cards/back_high.jpg, cached locally with attribution in assets/CREDITS.md, and is not used as branding.
