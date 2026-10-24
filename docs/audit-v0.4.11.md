# Reliability and mechanics audit · v0.4.11

The audit fixes four reproduced problems in saved decks, deck construction, duel startup and service-worker storage handling. The native card engine and Lua effects remain unchanged: the broad sweep did not reproduce another failing card effect.

## Fixes

| Reproduced issue | Result and regression coverage |
| --- | --- |
| Saving from a tab with an older deck list erased decks saved in another tab, or restored unrelated deleted decks | Save now reads the latest persisted list and replaces only the edited deck. Removed its obsolete caller-supplied list argument. Tests cover another tab's save/deletion and refuse to overwrite corrupt storage. |
| Copy limits compared card IDs, admitting more than three cards permanently treated as the same name | Harpie Lady variants and Umi variants now share the limit across Main, Extra and Side. Applies to additions, JSON/YDK imports, duel validation, random generation and pool-capacity checks. Conditional on-field/GY names and archetype-membership text remain separate. Duel validation uses current archive text. Existing over-limit saved decks stay editable and saveable, with a visible compact-footer warning; remove excess copies before playing. |
| Leaving Solo during an asynchronous start or resume left startup blocked, or allowed the old result to become the current duel after returning | Each launch/resume has a sequence token. Leaving/destroying invalidates it and permits a fresh launch. Late results are destroyed and cannot reset the current request's button/state; late errors cannot display on another screen. Native-backed UI tests delay both startup and resume, navigate away/back, and resolve the requests out of order. |
| An unavailable/evicted Cache Storage entry prevented online card art and scripts/styles from loading | Service-worker image and shell-asset requests fall back to the network if opening/reading the cache fails. Image writes remain optional and concurrent identical image requests still share a fetch. Tests simulate both cache-open and cache-read failures, quota errors, and independent response bodies. |

The shared-name rule follows the [official rulebook](https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf), plus the permanent-name clauses on [Harpie Lady 1](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=6186&ope=2&request_locale=en) and [A Legendary Ocean](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=5387&ope=2&request_locale=en). There is still no banlist in the 2004 lab.

## Validation

The [machine-readable report](audit-v0.4.11.json) records the frozen input hashes, rules revision, seeds, per-card probe contexts, prompt/message coverage, named effects and match/replay totals.

| Check | Result |
| --- | --- |
| Frozen API snapshot | 14,636 cards; 1,555 supported dated TCG cards through 2004 |
| Native synthetic probes | 2,777 across all 1,555 supported cards |
| Baseline full matches | 200 / 200 complete |
| Post-fix full matches, checked by the app's actual deck validator | 200 / 200 complete |
| Additional generation/full-match integration | 48 generation checks, 27 playable set pools, 40 / 40 matches complete |
| Total native actions in those runs | 188,045 |
| Replay/checkpoint verifications | 78 successful |
| Distinct named effects observed | 726 |
| Script/adapter failures or action-limit stops | 0 |
| Automated regression suite | 335 passing tests |
| Callback lifecycle check | 120 duels created/destroyed; 0 retained callback closures |
| Live API smoke test | 14,642 cards; search, release filters, save/reopen, JSON and YDK round trips pass |
| Static PWA build | Pass |

The live smoke test was a later API request; the larger integration audit uses the same frozen 14,636-card snapshot throughout. The baseline sweep uses the pre-fix generation policy; the final match run validates every generated deck with the corrected same-name limits. Synthetic probes intentionally use artificial hands/fields to expose legal prompts and effects; they are not ordinary constructed decks. Matches are counted separately. This covers the supported 2004 pool and sampled interactions, not every optional branch, combination or historical ruling. The app uses current text and the pinned modern rules core.

The existing eight-size Chromium menu/selection/reorder/rematch checks also run in CI before deployment; their screenshots are attached to that workflow run.

## Code cleanup

Removed the unused `releaseCutoff` and `combatBoostTarget` imports, unused set-error variable, stale difficulty argument in the native integration runner, unused instance-count calculation, and obsolete save-list parameter. The native runner now validates full-game decks and records snapshot hashes. The older JavaScript engine/catalog helpers still have live consumers in presentation, AI helpers and regression/benchmark fixtures; they were retained rather than deleting required code.

## Reproduce

Use fixed JSON responses from YGOPRODeck's `cardinfo.php?misc=yes` and `cardsets.php`. The report contains SHA-256 input hashes and full run configurations.

```sh
npm ci
npm test
# Full sweep plus a fresh match batch (same seeds as the baseline audit):
DUEL_CARD_SNAPSHOT=/path/to/cards.json DUEL_SET_SNAPSHOT=/path/to/sets.json AUDIT_OUT=audit-sweep AUDIT_SEED=42001 AUDIT_GAMES=200 npm run test:audit
# Final validated-deck match batch:
DUEL_CARD_SNAPSHOT=/path/to/cards.json DUEL_SET_SNAPSHOT=/path/to/sets.json AUDIT_OUT=audit-final AUDIT_SWEEP=0 AUDIT_SEED=52001 AUDIT_GAMES=200 npm run test:audit
DUEL_CARD_SNAPSHOT=/path/to/cards.json DUEL_SET_SNAPSHOT=/path/to/sets.json npm run test:duel-live
npm run test:memory
npm run test:live
npm run test:ui
npm run build
```

Re-running baseline seeds on v0.4.11 uses the corrected generation policy, so generated decks may differ from the recorded pre-fix baseline. Existing saved-duel replay rules and the native rules revision are unchanged.
