# Layout audit · v0.4.9

The startup menu previously chose landscape dimensions only after `src/app.js` set `data-app-rotated`. Before that module executed, a portrait launch used portrait dimensions. The canvas now uses CSS min/max viewport units and an orientation media query from the first stylesheet render. The old menu rotation flag and resize listener are removed. The shell is fixed to the viewport with no inherited centered width cap; safe-area padding remains inside it. Text inflation is held at 100%, while pinch zoom remains available.

## Removed competing code

- `styles.css`: superseded horizontal two-row deck tray, workspace caption, named-row card layout, old landscape grid placement and their media overrides. Shared archive, modal, card-quantity and format/filter styles remain.
- `light.css`: obsolete Balanced/Deck-focus show/hide and four-column rules, old deck query/tool styling, designer banner placement, dead deck-total badge and unused 3D coin-face styles. The current coin renderer is SVG (`src/duel/intro.js`).
- `duel.css`: unused designer-banner rules. Solo deck editing now uses the normal toolbar’s Save & return action.
- `src/app.js`: workspace-mode state, mode buttons and action handler, duplicate toolbar, and delayed menu orientation flag. App menu access is retained inside Deck options.
- `workshop.css`: prior named-row and workspace-mode overrides replaced by one card-tile layout for the builder. Duel choice/reveal/order styles remain.

This audit targets shipped layout code and selectors that compete with the current menus. The legacy engine and AI helpers remain because active fallbacks and regression tests still import them; they were not treated as dead code merely because they are older.

Shared app/deck-option sheets now use the logical short-landscape breakpoint in physically portrait windows too; the old physical-orientation condition could leave their last actions clipped.

The virtual archive now measures its inner grid width rather than the outer scroll panel, so padding and a scrollbar cannot clip the last card column.

## Verification

`npm test` exercises deck edits, filters, saved-deck switching/deletion, imports/exports, Solo Save & return, shared modal styles, PWA shell files, and native game behavior. The builder grid test verifies its tile dimensions reserve most of each tile for artwork.

`npm run test:ui` checks the shell before releasing a deliberately delayed app module, after boot, through portrait/landscape resize and a restored-page event. Eight phone/desktop sizes check header removal, accessible controls, at least three fully visible cards in each pane, artwork proportions, compact quantity controls, app-menu access, preserved searches and direct rematches. Existing native reorder/type/reveal checks remain in that browser flow. CI uploads screenshots before deployment.
