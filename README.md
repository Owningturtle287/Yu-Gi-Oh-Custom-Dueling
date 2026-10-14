# Duel Atlas · v0.0.3

A mobile-first Yu-Gi-Oh! companion built for early functionality testing. Plain HTML, CSS, and ES-module JavaScript; no framework, custom backend, or runtime dependencies.

## v0.0.3 · Compact cards and release-year pools

- Search results fit three columns on portrait phone panels at least 270px wide. Narrow landscape panels adapt to two columns; wider screens show more.
- Card +/− controls are now 30px instead of 44px, with separate red/green actions and a larger card inspection surface. The two-row deck tray is shorter and fits more entries across.
- Filters have Card filters and Release year panels. Spirit is available in the Monster subtype selector, alongside Flip, Gemini, Ritual, Toon, Tuner, and Union. Subtype, race, attribute, search, and mechanic filters combine.
- The release-year pool uses the API’s **first TCG release date**, requested with `misc=yes`. Selecting 2013 includes dates through **December 31, 2013**. The default follows the device’s current year and includes releases through today, excluding scheduled future and undated cards.
- The selected year is saved per deck, retained by JSON backups, and enforced on new card additions. Existing decks are kept intact; cards outside a changed cutoff or lacking dates are flagged for review. YDK has no year-setting field and imports using the current-year default.
- The year selector shows a short list of types, mechanics, and archetypes first represented that year in the dated API archive. These are data-derived highlights, not a manually maintained historical timeline. Historical banlists, original effect text, and rules are not recreated.
- Old metadata caches refresh once to add dates. If offline during that upgrade, saved decks remain available and search asks for a release-date refresh. Updated caches and JSON card snapshots retain first-release dates for offline use.
- Existing v1 deck storage remains compatible. Missing dates in old snapshots are enriched from the archive without changing card quantities or deleting decks.

## v0.0.2 · Faster deck building

- Saved-deck selector, New, Save, and deck options sit directly below the app header. Clean decks swap immediately; unsaved changes are protected.
- The current deck stays visible in a horizontal, two-row card tray while searching the full archive below it. Main / Extra / Side switches change both the visible section and eligible search results. Search terms and filters are retained.
- Every archive/result card and tray entry has separate green + and red − buttons in its bottom-right corner. Tapping the image/name still opens card details. Quantity badges and section totals update immediately; the three-copy and mechanic restrictions still apply.
- Quick edits and Save retain search, result scroll position, and tray scroll position. Successful quick edits use quantity feedback and a screen-reader announcement instead of covering the cards with a toast.
- Bottom navigation is 54px high (52px on shorter screens), plus device safe-area padding, compared with 74px / 65px before. Navigation and primary controls retain 44px targets; v0.0.3 intentionally uses compact 30px card quantity buttons.
- Navy panels now contrast with jade, warmer gold, violet, and rose accents. Red/green controls have distinct accessible labels in addition to their colors.
- The card-list container no longer draws a focus border. Card/button focus stays inside tile boundaries, archive scrolling is vertical only, and the deck tray is the only horizontal scrolling surface. Mobile search/select fields use 16px text to avoid automatic iPhone input zoom.

## What this release does

- Four bottom tabs: Home, Card Archive, Deck Builder, and Multiplayer.
- Solo Duel is accessible from Home, the top-right app menu, and the PWA shortcut. Both duel screens are explicit coming-soon previews.
- Full available [YGOPRODeck archive](https://ygoprodeck.com/api-guide/), searchable by card name, archetype, and effect text. Filter by category, attribute, type/race, or summoning mechanic; sort by name, ATK, or level/rank/Link rating.
- Continuous virtual card grid: the entire filtered archive shares one scroll range. No result pagination or bundled sample archive.
- Card detail dialog with official API image, card text, stats, level/rank/Link arrows where applicable, and an Add to Deck control.
- Named local decks; create, rename, save, open, delete, and edit quantities in Main, Extra, and Side sections.
- Maximum three copies across all sections, section capacities of 60 / 15 / 15, and basic section placement. Decks below 40 Main Deck cards can be saved while building. No banlist enforcement.
- Fusion, Synchro, Xyz, Pendulum, and Link mechanic toggles. “Pre-Synchro” enables Fusion only. **These are mechanic restrictions, not historical card-release formats.** Changing restrictions keeps existing cards and shows a review message.
- JSON and YDK import/export. JSON retains mechanic settings and offline card snapshots. YDK retains IDs/sections/quantities, needs the loaded archive to import, and imports with All mechanics. Alternate artwork IDs resolve to the primary card ID.
- App settings can export all saved decks as one JSON backup; Import / Export can restore that backup as new copies. Imports validate completely before changing the draft or storage.
- PWA manifest, service worker, original 180/192/512px icons, maskable icon, safe-area padding, and installation help.

**There is no dueling engine, card-effect execution, AI, rules enforcement, animation system, WebRTC, matchmaking, multiplayer connection, or dedicated game server in this release.**

## Run locally

Use Node.js 22 or newer:

```sh
npm ci
npm run dev
```

Open `http://localhost:4173`. Opening `index.html` directly as a `file:` URL will not work reliably with modules, fetch, or a service worker. Runtime files can also be served by any static HTTP server, without installing npm dependencies.

```sh
npm test          # deterministic unit, DOM interaction, and PWA contract tests
npm run test:live # one full API request; search and backup/storage round trips
npm run build    # static deployment output in dist/
```

`npm test` uses Happy DOM as a development-only dependency. The installed web app has no package dependencies. The live API test is separate from CI so an API outage does not block routine source checks.

## Deploy to GitHub Pages

The `Test and deploy Duel Atlas` workflow tests and builds pushes to `main`, uploads `dist/`, and deploys through the official Pages actions. Pull requests run tests/build without publishing.

For a new repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. Then push a commit to `main`, or run the workflow from the Actions tab. Pages must be enabled in the repository; this setting is not created by a normal repository commit.

Expected URL after successful deployment:

`https://Owningturtle287.github.io/Yu-Gi-Oh-Custom-Dueling/`

The manifest, service-worker registration, CSS, module imports, and image assets all use relative paths. The app works under the GitHub project subdirectory or another static HTTPS host. You can also deploy `dist/` through any GitHub-connected static hosting service. HTTPS (or localhost during development) is needed for the service worker and installation.

## Install and offline use

- iPhone/iPad: open the HTTPS app in Safari → Share → Add to Home Screen.
- Android: open in Chrome → browser menu → Install app or Add to Home screen. Where supported, the in-app Install help also offers the native install prompt.
- Open the app and archive online once before trying airplane mode. The app shell is cached by the service worker. Card metadata is saved in IndexedDB for 24 hours and is reused if a refresh fails. Images are loaded only as viewed and cached separately on the device; uncached images need a connection.
- The service worker spaces uncached image requests to at most eight per second per client worker and deduplicates in-flight requests. No bulk image download occurs. Card searching/filtering never calls the API. Manual refreshes share any request already in progress.
- Decks live in this browser’s localStorage, not a GitHub account or cloud service. Release-year settings are stored with each deck. Use backups when moving devices or clearing browser data. Quota/private-mode failures show messages and leave the current draft usable for JSON export.
- A first-time archive request needs the network. Loading/error/empty states and retry are visible. Cached browsing is never replaced by a tiny sample list.

## Phone layout and accessibility

The application shell occupies `100dvh`; the page and main region cannot scroll. The bottom navigation is fixed by the viewport-sized flex layout. Only archive results, the horizontal two-row deck tray, saved-deck results, and long effect text have scroll containers. The page itself cannot move horizontally. Forms and primary controls stay outside those containers.

Portrait styles cover narrow phones, with shorter-height adjustments and a landscape two-panel layout. Controls have accessible names, visible keyboard focus, and 44px primary/navigation targets, plus compact 30px card quantity buttons; native dialogs provide focus containment. The phone keyboard may reduce the usable area, so try names/search and dialogs as part of device testing.

## Verification record and manual acceptance

The v0.0.3 automated suite contains 39 tests, including release-date boundaries, Spirit filtering, cache migration, legacy deck compatibility, three-column geometry, and year-setting persistence. It also covers quick edits, safe deck switching, section-aware search, retained scroll positions, builder loading, and overflow/focus contracts. The initial release passed all 20 original tests. A live API run loaded **14,607 cards** and passed search, Spell/Link/Xyz filters, local save/reopen, and JSON/YDK round trips. The v0.0.3 live run also verified 5,865 cards and 23 Spirit monsters through 2013, including Aratama in 2013 and excluding it in 2012. The static build completed successfully. Source-level layout checks verify viewport containment, safe areas, and the four allowed scroll regions.

**Rendered browser/device QA was unavailable in the build environment.** DOM tests do not establish pixel layout, actual installability, real touch behavior, or offline behavior on Safari/Chrome. Before using this as a daily companion, test on a phone:

1. At 320×568 and 390×844 portrait, confirm Home and navigation fit without page scrolling.
2. Open Archive; verify loading/empty/error states; search by name and effect text, combine filters, and browse far down the continuous results.
3. Use red/green card controls without opening details, then tap the card image/name to inspect a monster, Spell, Link, and Xyz card. Confirm only long effect text scrolls in the detail dialog.
4. Create/rename a deck; add to Main, Extra, and Side; try a fourth copy; save, reload, and reopen. Swap decks with the top selector, inspect both tray rows, and confirm only the tray moves horizontally. Check that quick edits retain your search and scroll positions.
5. Export and import both JSON and YDK. Choose Filters → Release year → 2013; confirm Aratama is found with Spirit selected, Link monsters stay out, and the year survives Save/reopen/JSON export. Change to Pre-Synchro and confirm the mechanic restriction message.
6. Rotate the device; try the top-right menus and name/search keyboard. Confirm important controls stay visible.
7. Install the PWA, view some images online, close/reopen it in airplane mode, and confirm cached archive, saved decks, and viewed images remain accessible.
8. Confirm Solo Duel and Multiplayer only show their coming-soon interfaces.

## Project layout

```text
index.html             App shell and four-tab navigation
styles.css             Responsive layout and original visual system
src/app.js             Screens, dialogs, navigation, and user actions
src/core.js            Pure card filters, deck validation, storage, backups
src/cards.js           API loading and IndexedDB archive cache
src/era.js             TCG date cutoffs, snapshot enrichment, and year context
src/layout.js          Responsive continuous-grid geometry
src/icons.js           Original inline vector control icons
assets/                Original emblem and generated PWA icon sizes
sw.js                  App-shell and viewed-card-image caching
manifest.webmanifest   Relative PWA scope and shortcuts
tests/                 Unit, DOM interaction, and PWA contract tests
scripts/               Local server, static build, optional live API check
```

Future releases should bump the version in `package.json`, `src/core.js`, and the `sw.js` shell-cache suffix. Do not reuse a shell-cache release key after changing assets.

## Credits

Card data and official card images come from YGOPRODeck; Yu-Gi-Oh! card names, text, and images belong to their respective rights holders. This is an independent fan companion, unaffiliated with Konami. Branding and navigation icons are original geometric artwork, with no copyrighted card art used as branding.
