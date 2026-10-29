# LP and chain feedback · v0.5.6

LP gains, damage and paid costs now appear in a dedicated central panel with a signed amount, recipient, before/after totals, effect source and resolving chain link when applicable. The recipient's LP badge pulses and counts monotonically to the actual total. Each core LP event is retained: damage followed by recovery in one chain does not disappear into a zero net change. Battle presentation still precedes its LP change.

The native adapter emits presentation metadata for chain additions, resolution, negation and completion. The central lane follows those events in order, including single-link chains. It distinguishes a negated link from one that resolved. A persistent Current/Last chain control opens the public link list in resolution order; the response sheet also offers this viewer and names the exact next activation link. Returning from inspection preserves the current legal decision.

`feedback.js` consumes public events and changes DOM presentation only. The core remains the sole authority on Spell Speed, costs, legal chaining, targeting, same-name restrictions, damage and resolution. Passive continuous effects do not create invented chain links. No card script or AI policy is changed in this release.

The adapter keeps a private LP event cursor because field queries can already contain a later result from the same core batch. Structured LP notices therefore record the correct intermediate totals even when a field query occurs between effects. The authoritative queried LP is still used for the resulting game state and replay checkpoint. Existing save/checkpoint formats remain compatible.

With Card motion disabled, a short nonblocking receipt keeps every LP event visible. Reduced-motion mode retains static central cues and avoids animated transforms. Navigation, rotation, visibility changes and cancellation release pending presentation work and reconcile the LP badges with the committed result. The new module is in the offline service-worker shell.

## Verification

Twenty regression cases exercise native rules, replay checkpoints, presentation and the production controller:

- Four-link chains resolve 4→3→2→1 for both player mappings. Chain Strike at Link 2 inflicts 800 even when the chain ultimately has four links.
- Two Chain Strikes can share a chain when legal; each uses its own multiplier, and a third is unavailable after duplicate names already exist. Duplicate Jar of Greed links also block the cards that disallow existing duplicate names.
- Chain Healing and Chain Detonation at Links 1, 2, 3 and 4 apply 500 LP and go respectively to the Graveyard, Deck, Deck and hand.
- Mystical Wind Typhoon becomes legal at Link 3 and resolves its target; Miraculous Rebirth becomes legal at Link 4 and summons its graveyard target.
- Seven Tools of the Bandit records its 1,000-LP cost and negates recovery. Vanity's Call pays half LP and produces negation cues for all three earlier links.
- A native loss followed by recovery at zero net change preserves both intermediate totals. Counter direction, cancellation, static receipts, response inspection and completed-chain history are checked.

The Chromium layout suite additionally checks the response/chain viewer, central loss/recovery/resolving panels and their geometry in all eight supported viewport fixtures, including rotated phones. Its card-image responses are mocked for layout QA; native regression outcomes use the real pinned rules pack.

The full local regression suite passes 507 tests. The static PWA builds, and 120 runtime create/destroy cycles retain zero callbacks. A 200-duel native soak completed 25,471 actions and 20 saved-replay checks with no failures or timeouts. It used AI deck sizes 30/40/60 and encountered 429 effect names. No new all-card script sweep was necessary because this release changes event accounting and presentation, leaving the pinned card scripts intact.

Reproduce with `npm test`, `npm run build`, `npm run test:memory`, and `npm run test:ui`. The soak uses `DUEL_CARD_SNAPSHOT=<cards.json> DUEL_SET_SNAPSHOT=<sets.json> AUDIT_SWEEP=0 AUDIT_GAMES=200 AUDIT_OUT=<output> node scripts/audit-duels.mjs` with the same frozen snapshots as the v0.5.5 audit.
