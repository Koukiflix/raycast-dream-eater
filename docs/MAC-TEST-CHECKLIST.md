# Native Mac / Raycast acceptance checklist

This checklist applies to the AC-and-battery revision. No candidate installation or activation has been performed. Earlier `09f81` build/test passes and older AC-only native observations are historical; see [verification](VERIFICATION.md). Coordinate tests before touching an existing user session.

The baseline remains native Apple Silicon/macOS 26+; only macOS 27.0.1 has historical native observations. The lower helper deployment target exists for recovery compatibility, not older-system starts.

## Fresh source and build checks

- [x] Pass 154 JavaScript tests with zero skipped, strict TypeScript/ESLint and the Raycast build.
- [x] Pass final strict `npm run lint` and the complete `npm run check`, including 154 tests with zero skipped, strict TypeScript, ESLint and Prettier.
- [x] Build the native asset twice without warnings; verify identical bytes and 102 in-memory cases per build with zero power commands. Exact source/helper hashes are recorded in verification.
- [ ] Verify both client and helper allow AC or battery starts while retaining platform, ownership, finite-duration and thermal checks.
- [ ] Verify unplugging alone does not restore, extend or restart a session.
- [ ] Verify unsupported starts cannot block installed inspection, Stop or recovery.
- [ ] Verify absent-key defaults separately from an entirely absent persisted global settings dictionary; unknown settings must remain ineligible.

## UI without activation

- [ ] Verify three no-view root commands and the selected PNG; Hours/Minutes/Seconds remain inline without a form or scrolling.
- [ ] Verify one-hour Toggle and inline duration confirmation text accurately describes AC/battery behavior, administrator authorization and thermal/battery limitations.
- [ ] Cancel confirmations, then separately test administrator-prompt cancellation and inspect actual state.
- [ ] Run read-only dated Status and reopen the Raycast window. Treat full app restart as a separate check.
- [ ] Check removed mode/display preferences, relevant error messages and icon rendering. Prior capture failed; no fresh candidate UI pass is claimed.

## Supervised battery sessions

Use healthy charge with the lid open on a ventilated desk, never in a bag. No battery-percentage cutoff or critical-battery-specific guard exists; the global override can interfere with normal low-battery and thermal sleep. Do not induce depletion or heat.

- [ ] Coordinate candidate installation from verified normal saved/live settings and no owned journal.
- [ ] Start Toggle on battery; verify owned On, installed candidate identity and a one-hour deadline.
- [ ] Check active Status/window reopen and original deadline, then Stop well before expiry; verify saved/live zero and journal retirement.
- [ ] In a separate short inline session on battery, observe expiry without requesting Stop; verify final zero and record delay.
- [ ] In another supervised session, connect/disconnect AC and verify the same finite session continues. Finish with explicit Stop and verified zero.
- [ ] If coordinated, test a short physical battery lid closure with the intended workload; record continuity and configuration, then verify restoration. Native battery behavior remains unverified until this occurs.

## Ownership and recovery

- [ ] Reject starts when global settings are unknown or enabled without owned state; require restoration before changing an active timer.
- [ ] Verify repeated/simultaneous commands preserve authorization, ownership and recovery.
- [ ] Verify legacy ordinary sessions remain readable/stoppable and damaged legacy metadata cannot block owned privileged recovery.
- [ ] Verify finite boundaries and invalid input; no indefinite start or shorter battery-specific cap is introduced.
- [ ] Verify action-triggered Status refresh remains read-only and dated.
- [ ] Test guard interruption, full Raycast restart and reboot separately with coordinated recovery/readback.
- [ ] Test controlled ProcessInfo serious/critical thermal notification handling without unsafe heat; retain the distinction between simulation and native behavior.
- [ ] Verify uncertain rollback retains recovery state, and external conflicts stop further writes rather than falsely reporting Off.
- [ ] Verify long-duration expiry, clock/command delays and uninstall refusal/removal behavior separately.

## Release boundary

The icon is unchanged; prior PNG properties, hash and light-theme root rendering remain historical asset evidence. Dark-background purple contrast is weak at small sizes, and confirmation rendering remains untested.

Complete the phased [release handoff](RELEASE-CHECKLIST.md), review exact proposed contents for private data, and obtain separate authorization for any submission. This checklist does not represent a Store submission or public release.
