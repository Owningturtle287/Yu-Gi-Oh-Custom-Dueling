# Mechanics and timing audit · v0.5.4

This audit covers the current **2,170 playable TCG cards through December 31, 2006**, using the pinned native core and current card scripts/text. The 2,630 native IDs/aliases also pass script initialization. This is an integration audit of scripts, adapter prompts, UI scheduling, AI continuation and replay; it does not prove every possible card combination or reproduce historical rulings.

## Confirmed fixes

- Multiple required effects no longer silently use the adapter's first-listed order. Their controller chooses the next effect; the core still decides eligibility, priority, costs, chain formation and resolution. A single required effect proceeds automatically. Dark Hole destroying Sangan and Witch of the Black Forest is checked in both orders and for both controllers, including reverse chain resolution and separate search choices.
- Required upkeep ordering also matters: at 1,000 LP, Shadowknight Archfiend and Terrorking Archfiend cannot both stay. The selected payment goes first, leaving the selected monster alive when the other payment cannot be made. Payment notices retain their actual source. The response reader identifies the source's field zone so identical copies can be distinguished.
- Battle Phase activation commands now retain their native effect labels, matching Main Phase and response commands. Strike Ninja's label, two-card banish cost, temporary banishment and End Phase return have a directed test.
- Saved matches record prompt version 2. Saves without that field replay with version 1's original automatic ordering, preserving their recorded response history and checkpoint.

No parallel JavaScript card-effect implementation was added. The native rules remain the production authority.

## Directed timing checks

New native/UI regressions cover simultaneous triggers and processing order, mandatory versus optional cost triggers (Sangan, Peten, Night Assailant), Peten's optional timing when sent as the final action versus Tributed for a cost, destroying a Spell versus negating it (MST/Magic Jammer), a revival target banished higher in the chain, Trap Hole versus Bottomless Trap Hole on Cyber Dragon's Special Summon, Sangan when its summon is negated, and Jinzo's interaction with Call of the Haunted. Replays verify the resulting states. The UI must wait for required ordering, offer no Pass/Auto-pass, and leave search targets interactive.

Existing directed tests also check Damage Step checkpoints and Flip timing; Slate Warrior; Nobleman-Eater Bug's legal targets; Twin-Headed Wolf's other-face-up-Fiend condition; Cyber Jar's public reveals and position choices; level-up families and End/Standby windows; Fusion/Ritual/Contact procedures; exact level/material sums; costs versus effect discards for Dark World; summon/revival restrictions; negation; counters; delayed effects; banishment replacement; and activation cancellation before payment.

The separate battle sweep attacks all **80 printed Flip-effect monsters** in both controller positions. Fixtures provide hand costs, a same-name copy in the Deck, a Level 3 Normal Monster and Spell/Trap in the Graveyard, and a Set opposing card. Invader of the Throne is the expected non-activation: its pinned script explicitly excludes the Battle Phase. The other 79 source effects activate in each run.

## Validation

The final controller sweeps and browser checks are in progress on the review branch. Results and the machine-readable coverage report are filled before merge.

| Check | Result |
| --- | --- |
| Local regression suite | 454 cases including final source-location UI test; rerun pending |
| Baseline whole-pool sweep | 3,959 probes; all 2,170 cards; zero failures |
| Baseline complete duels | 600/600; zero failures or stalls |
| Final whole-pool sweep | In progress, both controllers |
| Final complete duels | 600/600; 200 each with AI sizes 30, 40 and 60; zero failures or stalls |
| Battle Flip sweep | 160 probes, 80 cards on each side; zero failures |
| Runtime lifetime | 120 created/destroyed; zero retained callbacks |
| Static build | Passed |
| Browser checks | CI verifies eight landscape/rotated viewport sizes |

The sweep uses artificial fields/hands to reach prompts. Complete matches separately validate every player and AI deck against the app's actual validator, including copy caps and 30–60-card AI bounds. Invariants check legal continuation, finite signed stats, nonnegative LP, zone sizes, controller ownership and unique instance identities. Replay checkpoints must match. The runner rejects repeated staged-selection cycles, invalid core responses, script errors, action-limit stalls and unfinished card probes.

A probe passing means the card was initialized in the stated context and the duel continued; it does not imply every branch of that card's text resolved. The final JSON retains per-card hand/field/controller contexts and observed draw/play/activation/resolution flags, distinguishing those levels of coverage. Continuous effects may not create activation messages. Unobserved interactions remain possible.

## Reproduce

```sh
npm ci
npm test
npm run test:memory
npm run test:ui
npm run build

DUEL_CARD_SNAPSHOT=cards.json DUEL_SET_SNAPSHOT=sets.json \
  AUDIT_GAMES=0 AUDIT_SIDE=0 AUDIT_OUT=audit-side0 node scripts/audit-duels.mjs
DUEL_CARD_SNAPSHOT=cards.json DUEL_SET_SNAPSHOT=sets.json \
  AUDIT_GAMES=0 AUDIT_SIDE=1 AUDIT_OUT=audit-side1 node scripts/audit-duels.mjs
DUEL_CARD_SNAPSHOT=cards.json DUEL_SET_SNAPSHOT=sets.json \
  AUDIT_SWEEP=0 AUDIT_GAMES=600 AUDIT_OUT=audit-games node scripts/audit-duels.mjs
DUEL_CARD_SNAPSHOT=cards.json DUEL_SET_SNAPSHOT=sets.json \
  AUDIT_SWEEP=0 AUDIT_GAMES=0 AUDIT_FLIPS=1 AUDIT_SIDE=0 \
  AUDIT_OUT=audit-flips0 node scripts/audit-duels.mjs
# Repeat the final command with AUDIT_SIDE=1 and a separate output directory.
```

Default randomness is version 3, the current app shuffle. Full matches rotate AI deck sizes 30, 40 and 60 (override with `AUDIT_AI_SIZES`); both first-player assignments and 4,000/8,000 starting LP are sampled. All card data and sets come from frozen snapshots, with no card API requests during audit runs. The report records configurations and hashes.

Card snapshot SHA-256: `83d706a3ecf6180d5a7d98c01f55d9a015582f8d3c75c984f6d6ee294f060375`.
Set snapshot SHA-256: `ff52eb763bfc9c2b33eabd9ff0f118fefc6ace39cf19ce2de33aceea2a4d0394`.

Rules revision: `5138eb120d9f6f6caa04dbba22b64ef451302b95`. Database revision: `70e53af2dc6c5cecebd48ff4f945c560625c99a2`. Runtime: `ocgcore-wasm` 0.1.2. See the [rules provenance and licenses](../assets/rules/THIRD_PARTY_NOTICES.md), the [official rulebook](https://www.yugioh-card.com/eu/wp-content/uploads/2022/07/Rulebook_v9_en.pdf) for simultaneous effects, and the [official fast-effect timing chart](https://www.yugioh-card.com/en/play/fast-effect-timing/).
