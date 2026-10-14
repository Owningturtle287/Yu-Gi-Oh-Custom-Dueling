# Duel Atlas · v0.0.1

A mobile-first Yu-Gi-Oh! companion built for early functionality testing. Plain HTML, CSS, and ES-module JavaScript; no framework, custom backend, or runtime dependencies.

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
- Decks live in this browser’s localStorage, not a GitHub account or cloud service. Use backups when moving devices or clearing browser data. Quota/private-mode failures show messages and leave the current draft usable for JSON export.
- A first-time archive request needs the network. Loading/error/empty states and retry are visible. Cached browsing is never replaced by a tiny sample list.

## Phone layout and accessibility

The application shell occupies `100dvh`; the page and main region cannot scroll. The bottom navigation is fixed by the viewport-sized flex layout. Only archive results, deck contents, saved-deck results, and long effect text have scroll containers. Forms and primary controls stay outside those containers.

Portrait styles cover narrow phones, with shorter-height adjustments and a landscape two-panel layout. Controls have accessible names, visible keyboard focus, and 44px tap targets; native dialogs provide focus containment. The phone keyboard may reduce the usable area, so try names/search and dialogs as part of device testing.

## Verification record and manual acceptance

Initial automated verification passed all 20 tests. A live API run loaded **14,607 cards** and passed search, Spell/Link/Xyz filters, local save/reopen, and JSON/YDK round trips. The static build completed successfully. Source-level layout checks verify viewport containment, safe areas, and the four allowed scroll regions.

**Rendered browser/device QA was unavailable in the build environment.** DOM tests do not establish pixel layout, actual installability, real touch behavior, or offline behavior on Safari/Chrome. Before using this as a daily companion, test on a phone:

1. At 320×568 and 390×844 portrait, confirm Home and navigation fit without page scrolling.
2. Open Archive; verify loading/empty/error states; search by name and effect text, combine filters, and browse far down the continuous results.
3. Inspect a monster, Spell, Link, and Xyz card. Confirm only long effect text scrolls in the detail dialog.
4. Create/rename a deck; add to Main, Extra, and Side; try a fourth copy; save, reload, and reopen.
5. Export and import both JSON and YDK. Change to Pre-Synchro and confirm the restriction message on a blocked mechanic.
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
