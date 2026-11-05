# Audit fixes · v0.5.9

The November 5, 2026 audit identified storage/recovery defects, unstable card-copy identities, and a combat forecast error. This release addresses all confirmed code defects from that audit and the related reliability risks. It does not add historical banlists, multiplayer or exhaustive AI combo search.

| Audit item | Result |
| --- | --- |
| A01 · Cross-tab bulk import | Import merges with the latest persisted deck list rather than the tab's stale snapshot. |
| A02 · Lost live duels | Internal navigation retains the native match; automatic checkpoints recover interrupted matches after reload. Unload warns while a live match exists. Explicit Exit discards its checkpoint. |
| A03 · Duplicate identities | Native MOVE/DRAW/SWAP events track individual copies and controller changes. Hidden shuffles retire identities instead of assigning known copies to secret slots. Legacy replay identity behavior is versioned. |
| A04 · Spirit Barrier forecast | Every combat-search node uses its projected remaining monsters and LP. The last blocker can be cleared before a lethal direct attack. |
| A05 · Ultimate Offering text | Activation labels correctly say Normal Summon/Set. Each legal activation still costs 500 LP and can be repeated. |
| A06 · Malformed Solo config | Nested settings are validated before generating decks or rendering controls. Invalid fields fall back individually. |
| A07 · Damaged duel saves | Unreadable root data is preserved and blocks destructive writes; malformed individual entries remain available in a recovery export. |
| A08 · Damaged deck records | Valid sibling decks remain usable. Rejected records are preserved through saves, deletions, bulk imports and full backups. |
| A09 · Archive cache retries | A failed/blocked IndexedDB open can retry; version changes close the old handle. |
| A10 · Test dependency | happy-dom is updated to the patched 21.0.4 release. |
| A11 · Filter reset | Resetting the release region marks the draft dirty. |
| R01 · Mid-session updates | New service workers wait for open clients to close before activation. |
| R02 · AI retry loop | Two failed decisions pause play with visible Retry and Save & exit controls. |
| R03 · Replay compatibility | New saves record the database, script-file and generated runtime fingerprint. Mismatches fail before replay; legacy saves retain their compatibility path. |
| R04 · Artwork cache growth | Cached artwork is capped at 800 entries, with eviction and one retry after a quota failure. |
| R05 · Partially advanced core | Response errors invalidate the failed runtime. The controller restores a verified pre-action checkpoint and pauses; it never blindly resends into the advanced core. |

Recovery uses separate per-match keys so active tabs do not overwrite one another's checkpoints. Resuming an interrupted match creates a fresh checkpoint identity. Manual saves retain their five-slot limit. Browser storage failure is visible; automatic recovery cannot survive unavailable or cleared storage. Recovery backups preserve raw bytes for diagnosis; they are not a general cross-device restore format.

Regression coverage includes full controller reload with a staged Tribute choice, same-code summon/draw/control moves, the Spirit Barrier lethal sequence, repeated Ultimate Offering activations, damaged data preservation, cross-tab imports, archive-cache retry, bounded AI failures and injected post-response native failures. Existing hand-return tests now check the returned cards and counts across hidden hand shuffles, where old slot identities are intentionally retired.

Validation results will be recorded after the full card sweeps and pull-request browser checks complete.
