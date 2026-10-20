# Card and duel audit · v0.4.6

The audit covers the **1,555 supported TCG card records released by December 31, 2004**. A fresh API recheck returned **14,618 archive cards** and exactly the same early-card definitions as the offline audit snapshot. The three early non-duel/prize records remain searchable and are excluded from playable decks.

## Results

| Check | Result |
| --- | --- |
| Per-card synthetic hand/field probes | 2,777 across all 1,555 eligible cards |
| Initial sweep plus full-game batch | 400 matches; 399 finished; one recycling matchup reached the test limit |
| Final batch after the AI fix | **600 of 600 complete**; no failures or action-limit stops |
| Native actions in the two recorded batches | 280,256 (87,565 in the final 600 games) |
| Successful replay/checkpoint checks | 137 (59 in the final batch) |
| Distinct named effects observed | 762 across both batches |
| Native prompt kinds observed | 14 in the broad sweep; exact-sum and multi-holder counter prompts also have directed tests |
| Automated regression suite | **304 passing tests** |
| Runtime lifecycle check | 120 duels created/destroyed; zero retained callback closures |
| Previously limited matchup | Completes in 240 actions after the AI fix |

The [machine-readable results](audit-v0.4.6.json) include per-card coverage, named effects, event/prompt counts, the initial limited match and final batch results. A card listed as probed was inspected in a synthetic fixture; it does **not** mean every effect branch or combination has been proven correct. Complete matches are counted separately and use ordinary generated or coverage-focused 40-card decks with copy limits, alternating first players and both 4,000/8,000 LP starts. The set-based runs use the released set pools available in the supplied set snapshot.

## Fixes

| Defect | Change and verification |
| --- | --- |
| Unknown ATK/DEF overflowed to about 4.29 billion | Decode signed native stats, keep unknown values numeric-safe for the AI and show `?` in the card view. Tests cover Gradius’ Option, Gren Maju Da Eiza and Maju Garzett, plus Gren Maju’s calculated field stats. |
| Effects changed properties in the core but the UI/AI used printed data | Query live Type, Level, race and Attribute without mutating archive data. Tests cover DNA Surgery, DNA Transplant, removal/reset of their effects, Cost Down’s reduced-Level summon and expiry, and Embodiment of Apophis as a Trap Monster. |
| Revealed hand choices became hidden again after dismissing the list | Selection art/names use the viewer’s recorded legal reveal. Confiscation, The Forceful Sentry and Exchange are tested; hidden unrelated cards remain hidden. Raw action labels remain stable for saved replay. |
| Early native random outcomes repeated | Expand each seed into all four RNG words with SplitMix64. Both coin calls/results and actual dice boosts are tested. Existing saves retain the legacy RNG version. |
| Closed duels retained callbacks and archive data | Release the synchronous wrapper’s callback entries on destruction and failed creation; restore temporary stack state on every creation path. A forced-GC weak-reference test verifies release directly. |
| AI recycled small attackers instead of breaking a public defensive wall | Value legal Tribute upgrades that can beat persistent face-up defenders, excluding battle-indestructible targets. A native regression and the formerly limited seeded game verify the change. |
| Amazoness Archer used an obsolete name in AI knowledge | Recognize the current and legacy names and evaluate its two-Tribute cost and lethal damage. The native cost and win resolve in a regression test. |
| Decoder corrections could invalidate older saves | Version RNG/query presentation. Migrate only legacy unsigned stat sentinels; all other replay/checkpoint fields must still match. Corrupted checkpoints are rejected. |

No Lua card script or WebAssembly binary is changed. Rules remain owned by the native core; the patches correct its JavaScript wrapper, application metadata/presentation and AI choices.

## Inspected mechanics

The broad run exercises activation costs, discards, Tributes, Normal/Flip/Special Summons, chains and negation, attack declarations and replays, Damage Step responses, battle and effect damage, recovery, target selection, position changes, Equip/Field/Continuous cards, counters, tokens, private reveals, deck/hand/set-card shuffles, graveyard/banished movement, race/Attribute/card/number declarations and deck ordering. Directed regressions also cover exact-Level sums (Puppet Magic), ten counters paid from multiple holders (Mega Ton Magical Cannon), Graceful Dice’s actual roll and expiry, and Grave Protector’s battle-destruction shuffle. Existing regressions cover Ritual/Fusion/Chaos/Spirit/Union/Toon procedures, optional versus required triggers, Castle Walls after battle reveal, Enchanted Javelin, Robbin’ Zombie, Archfiend upkeep/protection and Perfect Machine King while banished.

Every audited state checks unique card identities, valid ownership/controllers, five fixed Monster and Spell/Trap slots, nonnegative integer LP, valid signed stats and a legal continuation. Repeated staging without confirmation is detected. Failed/limited runs retain replay data for diagnosis. The action limit belongs to the test harness and never forces a result in the app.

## Reproduce

Use full JSON responses from YGOPRODeck’s `cardinfo.php?misc=yes` and `cardsets.php` endpoints. Keep those snapshots fixed for seeded comparisons. Their SHA-256 values and the pinned rules revision are recorded in the JSON report.

```sh
npm ci
npm test
DUEL_CARD_SNAPSHOT=/path/to/cards.json DUEL_SET_SNAPSHOT=/path/to/sets.json AUDIT_OUT=audit-output AUDIT_GAMES=600 npm run test:audit
npm run test:memory
npm run test:live
npm run build
```

The audit itself makes no API requests. `AUDIT_SWEEP=0` runs only complete games; `AUDIT_GAME_START` selects a game offset; `AUDIT_SEED` changes the initial seed; `AUDIT_MAX_ACTIONS` changes the test budget. The recorded initial batch used 400 games; the final run used `AUDIT_SWEEP=0 AUDIT_GAMES=600`. The targeted recycling regression uses `AUDIT_GAME_START=129 AUDIT_GAMES=1`.

This is broad integration and regression coverage, not exhaustive verification of every card pairing, optional branch or historical ruling. The app uses modern card text and the pinned rules pack rather than recreating every 2004 erratum or banlist.
