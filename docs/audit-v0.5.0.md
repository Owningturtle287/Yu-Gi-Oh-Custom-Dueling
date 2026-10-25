# Through-2006 expansion · v0.5.0

Solo now admits every playable card with a first TCG release through **December 31, 2006** in the frozen YGOPRODeck snapshot: **2,170 deck cards**, up from 1,555. The 615 additions include HERO/Neos Fusions, Cyber Dragons, Dark World, Destiny HERO, Sacred Beasts and Aliens.

The 2,177 dated records also include five collector-only World Championship prizes, the `???` deck-profile placeholder and Sheep Token. Those seven records stay searchable and cannot be put into duel decks. Effect-created Tokens remain supported.

## Implementation

- Rebuilt the offline pack from the **same pinned** Project Ignis scripts and BabelCDB revisions. Its 2,053 Lua files include shared summon/effect helpers and transitive card/alias dependencies. The existing native rules engine remains the only production rules implementation. No duplicate JavaScript card-effect catalogue was introduced.
- The generated manifest owns the era end. Setup, eligibility, deck design, default AI beliefs and app copy use that shared value. Earlier year cutoffs remain available. Prior default 2004 Solo cutoffs expand once; narrower settings, selected decks and match preferences survive. New settings record their era so a deliberately selected 2004 cutoff remains selected.
- Set caches are keyed by era, preventing the otherwise-fresh old cache from hiding 2005/2006 sets. Pack generation validates dates, preserves runtime provenance and audited Lua overrides, and records the API snapshot hash plus every shard hash.
- Fixed the pinned wrapper's reversed counter type/count decoding, matching core `card.cpp`'s `QUERY_COUNTERS` layout. Public live totals appear in small field badges and in card inspection. Set/private cards do not expose them.
- Full games exposed repeated cancelled attacks. The adapter records cancelled declarations for AI planning while preserving human legal actions. Successful attacks, resolved chains and phase changes reset that record. The AI compares optional attack costs with the attack's value, cancels unprofitable restricted-target selections, and commits to a legal target when the core blocks leaving Battle for a compulsory attacker such as Berserk Gorilla.
- Directed combat fixtures explicitly choose their intended defenders, including intentionally poor attacks used to test Flip timing. They no longer depend on the AI agreeing to make those attacks.

## Validation

The committed 2005/2006 fixture contains every newly dated record, plus older controls. Directed native tests cover Cyber Dragon on both sides and three field conditions; Power Bond materials/ATK/delayed damage; HERO Fusion and revival restrictions; Neos Contact Fusion and End Phase return; Diamond Dude's delayed Spell after leaving the field; Dark World effect discards versus costs; Treeborn Frog restrictions; Macro Cosmos versus Dimensional Fissure; exact Ritual Levels and Demise's LP cost; variable Chimeratech materials; A-Counters/control changes; Clock Counters; all three Sacred Beast summon procedures; cancelled attack costs, restricted targets and compulsory attacks. Replay checkpoints accompany these cases. UI tests cover cutoff migration, persistence, deck-designer eligibility, and live counter inspection.

The [machine-readable report](audit-v0.5.0.json) records the repeated card sweep and final AI match run:

| Check | Result |
| --- | --- |
| Regression tests | 405 passed, including 35 directed expansion/UI cases |
| All-script initialization | All 2,630 worldwide IDs/aliases initialize without script errors |
| Card sweep | 3,959 probes across every one of the 2,170 playable TCG cards |
| Full validated matches | 600 / 600 complete; zero script/adapter failures or action-limit stalls |
| Accepted actions | 260,155 across the sweep and final matches |
| Verified replay checkpoints | 109 |
| Distinct effects observed | 986 |
| Runtime lifetime | 120 created/destroyed; zero retained callback closures |
| Static build | Passed |

The card sweep verifies scripts and adapter prompts. The full-match run uses the final AI handling for optional costs, restricted targets and compulsory attacks. Chromium checks cover eight viewport sizes, including rotated phones; final screenshots are verified in CI before deployment.

## Reproduce

The normal test/build uses only committed rules and the pinned npm runtime:

```sh
npm ci
npm test
npm run test:memory
npm run test:ui
npm run build
```

The large integration audit consumes frozen API snapshots rather than requesting card data during matches:

```sh
DUEL_CARD_SNAPSHOT=cards.json DUEL_SET_SNAPSHOT=sets.json \
  AUDIT_GAMES=0 AUDIT_OUT=audit-sweep node scripts/audit-duels.mjs
DUEL_CARD_SNAPSHOT=cards.json DUEL_SET_SNAPSHOT=sets.json \
  AUDIT_SWEEP=0 AUDIT_GAMES=600 AUDIT_OUT=audit-games node scripts/audit-duels.mjs
```

Card snapshot SHA-256: `83d706a3ecf6180d5a7d98c01f55d9a015582f8d3c75c984f6d6ee294f060375`.
Set snapshot SHA-256: `ff52eb763bfc9c2b33eabd9ff0f118fefc6ace39cf19ce2de33aceea2a4d0394`.

Card dates, archive text and memberships come from the [YGOPRODeck API](https://ygoprodeck.com/api-guide/). Lua source, numeric records, revisions and licenses are identified in the [rules notices](../assets/rules/THIRD_PARTY_NOTICES.md). Synthetic probes use artificial fields/hands to reach legal prompts; full matches use validated 40-card decks. This verifies individual support and sampled interactions, rather than every possible combination. The app uses current card text, the pinned modern core and no banlist; historical rulings and side decking remain outside its scope.
