# AI corrections and local learning · v0.5.5

The production strategy retains the native rules core as the only authority on legal actions and effect resolution. This release corrects the reproduced decision errors and adds standalone, on-device online preference learning. It requires no AI API, model server or additional runtime dependency.

## Corrected decisions

- Public combat forecasts account for Amazoness Swords Woman's damage redirection, Amazoness Fighter, Spirit Barrier and Waboku prevention, and Des Wombat's effect-damage prevention. Reflect Bounder's effect damage is separate from battle damage. Visible negation is respected.
- Attack forecasts account for Gravity Bind, Level Limit – Area B, Swords of Revealing Light, Messenger of Peace, and The Dark Door. Spell/Trap immunity is checked before treating an attacker as restricted. A blocked Cyber-Stein/Fusion/Megamorph sequence no longer receives a winning bonus or spends 5,000 LP for the predicted attack.
- Armed Dragon LV5/LV7 removal forecasts pay the sent monster's actual strategic cost and respect its ATK threshold. The higher LV is reserved when its lower LV is present. Normal Tribute selection remains distinct from this hand-monster cost.
- Replacement LV upgrades recognize the higher named body and no longer use a generic crowded-field penalty. The core still determines whether the timing and prerequisites are met. This applies by phase/printed higher-LV relation across the families, rather than duplicating their effect scripts.
- Opening-turn Quick-Play setting no longer waits for a nonexistent Main Phase 2.
- Big Eye chooses the full legal inspection count. Deck-top ordering prioritizes useful draws; deck-bottom and opposing-Deck ordering reverse that objective appropriately. Cost and target selection retain their separate roles.
- Exact named-material Fusion forecasts cover Polymerization/Power Bond, including Machine restrictions, both materials, doubled ATK and Power Bond's delayed damage. Variable/substitute/alternative material lists remain native-only in forecasts. Hidden opposing backrow prevents a projected turn from being labeled a certain win.

Native regressions reproduce the former failures, verify the new choices for both controllers where applicable, and check the resulting saved replay checkpoints. Additional cases exercise Horus/Silent Swordsman/Wildheart immunity, crowded-field upgrades, ordinary Tribute Summons and Power Bond wins versus avoidable delayed lethal damage.

## What learns

`ai-learning.js` is a bounded online contextual preference model layered onto the corrected strategy. Its feature definitions and rules safeguards remain fixed; experience adjusts its numerical weights and observed context values. It does not generate new JavaScript/Lua, infer hidden cards from the complete replay, or promise that every subsequent duel is stronger.

The model starts without learned preferences. A decision is described using a redacted observation: action/effect intent, its own source card, permitted target information, relative board size, LP pressure, backrow/crowding, and currently public opposing threats. It stores no opponent hand/Deck identities, draw order, private logs or full duel states.

Pending activation/cost/target/response choices are grouped until resolution settles. A bounded potential based on hand/field counts and LP difference provides observed local feedback. A reveal alone does not change that potential. Only after a played duel ends is the final outcome used to train. Exits, unfinished games and surrenders do not train; an episode without meaningful AI decisions also does not train.

For each retained decision:

```
target = 0.55 × local resolution reward
       + 0.45 × duel result × 0.97^(turns until finish)
```

Local rewards and targets are clipped to [-1, 1]. Repeated instances of a context are averaged and count once per duel. This gives useful local decisions credit even in a loss, and can penalize harmful local decisions despite an eventual win. It is partial credit assignment, not knowledge of what every unplayed alternative would have done.

Context values use a running mean with a step size of `1 / min(40, sample count)`. A small regularized online update adjusts feature weights, bounded to [-2, 2]. Inference combines a general feature estimate with a sample-confidence-shrunk context value:

```
adjustment = 70 × tanh(feature dot product / 3)
           + 120 × context mean × samples / (samples + 8)
```

The total adjustment is capped at ±180 score points. It applies after at least two reviewed duels, only to comparable candidates within 180 points of the base leader. Hard rejections, forced completion, and emergency/lethal priorities cannot be overridden. It therefore learns preferences among plausible actions while preserving the fixed strategy's strong safeguards. Live play does not deliberately choose reckless moves to collect exploration data; normal close-move variety supplies limited exploration.

## Persistence and controls

- Learning is enabled by default. Match settings and the duel menu open a small learning sheet showing reviewed duels and AI wins/losses/draws.
- **Use fixed strategy** disables learning and learned adjustments without erasing experience. **Enable learning** reuses the saved model. **Reset** requires confirmation and clears the device model.
- The versioned profile uses localStorage. It retains at most 512 contexts, 256 feature weights and 512 completed episode IDs. Pending experience is capped at 256 records and saved alongside a native duel save.
- A saved episode retains its identity across resume. Repeated finishes within retained history are deduplicated. Reset changes the profile generation, preventing stale queued work from restoring the old model.
- Storage reads validate schema, keys, sizes and finite numerical values. Blocked/full storage preserves session learning without blocking play. Web Locks serialize and rebase cross-tab updates where available.
- The decision worker receives only inference parameters, not raw training episodes or completed-match IDs. Its fallback receives the same learned preferences. Leaving/rotation/stale-response checks continue to cancel invalid pending decisions.

Learning remains local to this browser/device. Clearing site data removes it. Changing incompatible feature semantics should bump the learning schema/key; numerical updates must retain the hard bounds and privacy tests.

## Validation

The full regression suite, native decision cases, real-controller post-duel training, and eight-viewport browser checks run before merge. The soak/paired-match results are finalized in the accompanying report before release.

Functional learning checks verify changed decisions on held-out seeds, positive/negative credit independent of the overall result, terminal-only updates, save/resume, duplicate finishes, corrupt/blocked storage, cross-tab rebasing/reset, bounded growth, inference payload privacy, and preservation of hard winning/rejected choices.

The development benchmark accepts a historical policy via `AI_BENCH_BASELINE_PATH`, a frozen profile via `AI_LEARNING_PROFILE`, and explicit training/output via `AI_LEARNING_TRAIN=1` / `AI_LEARNING_OUT`. The normal benchmark remains fixed-policy by default. Training seeds and held-out comparison seeds are disjoint; the held-out profile is frozen throughout comparison. Developer simulation is never run automatically in the player's app, and no pre-trained benchmark profile is shipped to players.

These are finite functional and paired-match samples. They do not establish a human Elo rating or exhaustive strategic mastery of every supported card combination. Some effects continue to use conservative generic forecasts.
