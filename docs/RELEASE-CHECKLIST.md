# Release checklist and native validation handoff

This handoff covers the new AC-and-battery revision. Previous candidate `09f81` checks are historical. No new candidate installation or activation has been performed; coordinate privileged tests with the user and preserve existing sessions until then. This document does not authorize publication.

The design permits AC or battery starts, with a one-hour Toggle and 1-second–24-hour custom timer. Unplugging alone must not restore, extend or restart a session. Ownership, administrator authorization, durable recovery and ProcessInfo serious/critical thermal restoration remain required. There is no battery-percentage cutoff or critical-battery-specific guard, and the global override can interfere with low-battery/thermal sleep.

## Freeze and check the new revision

- [ ] Record the final source revision, Swift source/helper hashes, byte size and toolchain; distinguish the bundle from the still-installed older helper.
- [x] Pass 154 JavaScript tests with zero skipped, strict TypeScript/ESLint and the Raycast build.
- [x] Pass final strict lint and the complete `npm run check`, including 154 tests with zero skipped, strict TypeScript, ESLint and Prettier.
- [x] Produce two warning-free, byte-identical 253,888-byte native builds, each passing 102 in-memory cases with zero power commands; record exact hashes in verification.
- [ ] Verify native-arm64/macOS 26+ new-start guards preserve inspection, Stop and recovery. The macOS 13 binary deployment minimum is intended for recovery after rollback, not older-system start support.
- [ ] Verify battery starts and power-source changes are not rejected or restored solely because AC is absent; retain finite deadlines, ownership and thermal checks.
- [ ] Keep absent persisted global settings unknown; test missing keys and missing helper-directory creation separately. Do not write a baseline merely to make a test pass.
- [ ] Preserve the selected PNG and its dark-background contrast limitation. Capture genuine candidate UI screenshots if available; the prior attempt produced unusable pixels.
- [ ] Review the exact tree for private data and unintended files, then freeze it for private review.

## Establish the native baseline

Agree on the test window, recovery fallback and final installation state. Begin with healthy battery charge, the lid open and the Mac on a ventilated desk, never in a bag. Have charger access available without making AC connection a session requirement. Do not induce low-battery or thermal emergencies; there is no automatic battery cutoff to rely on.

- [ ] Inspect saved/live settings, ownership and installed helper identity. Start only from verified normal saved/live state, no unresolved journal and no competing writer.
- [ ] If an existing user session is active, defer or coordinate its explicit restoration; do not silently replace its helper.
- [ ] Keep the documented [owned recovery procedure](CLOSED-LID-APPROVAL.md) available. Stop the test and review any uncertain state.

## Phase 1 — supervised battery activation and early Stop

After coordinated confirmation and administrator authorization, start Toggle while on battery with healthy charge.

- [ ] Verify candidate installation identity, owned On, saved/live enabled settings and the original one-hour deadline.
- [ ] Run Status and reopen the Raycast window; verify the same session and deadline. Window reopening is not a full app-restart test.
- [ ] If separately coordinated, perform a short supervised lid closure with the intended workload and record continuity/configuration. Do not infer long-duration behavior.
- [ ] Request Stop well before expiry; verify saved/live zero and journal retirement before the deadline.

## Phase 2 — separate battery expiry

After verified Off, authorize a separate short inline timer on battery with healthy charge.

- [ ] Verify the owned deadline and active settings, then do not request Stop.
- [ ] Observe guard-driven expiry; verify saved/live zero and journal retirement, recording any delay.
- [ ] Keep expiry evidence separate from manual Stop. A Stop after expiry is not an early-Stop pass.

## Phase 3 — AC/battery transitions

Use a separate supervised finite session with the lid open.

- [ ] Connect and disconnect the charger; verify the same owned session and original deadline continue without restoration, extension or restart solely due to the source change.
- [ ] Finish with explicit Stop and verified saved/live zero. Record AC and battery observations separately from physical lid-closure evidence.

## Phase 4 — recovery and uninstall

Coordinate disruptive cases separately and keep failures visible.

- [ ] Test guard interruption and reboot as distinct owned-session recovery cases, verifying saved/live zero and journal retirement. Do not restart the lease or equate a guard restart with reboot evidence.
- [ ] Verify controlled thermal notifications, conflicting/uncertain restoration and serialization without unsafe heating or battery depletion; simulation is not native recovery proof.
- [ ] Verify uninstall refuses active/uncertain state. After verified Off/no journal, authorize uninstall and check only documented installation files are removed; the private directory and stable lock remain.
- [ ] Record final settings and whether the helper remains installed. Reinstallation is a separate authorized start.

## Review gate

- [ ] Update [VERIFICATION.md](VERIFICATION.md) with fresh passed, failed and untested results tied to exact bytes; keep raw private evidence outside the repository.
- [ ] Review genuine screenshots, [submission draft](SUBMISSION-DRAFT.md), recovery disclosures and artwork notice.
- [ ] Recheck current Store requirements and obtain separate authorization for any concrete submission. Do not infer permission to publish, change visibility, add collaborators or rewrite history from release preparation.
