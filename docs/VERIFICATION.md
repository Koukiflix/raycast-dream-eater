# Verification record

This record distinguishes the current AC-and-battery revision from historical checks. It includes no private screenshots, local paths, session identifiers or raw logs. Results are past observations, not a live status report.

## Current revision — automated checks and native limits

The revised design permits starts on AC or battery and keeps the same session running when the charger is disconnected or reconnected. Toggle remains one hour; inline H/M/S accepts 1 second to 24 hours. Ownership, administrator authorization, finite deadlines, recovery and ProcessInfo serious/critical thermal restoration remain in scope.

There is no battery-percentage cutoff, critical-battery-specific guard or shorter battery cap. The global override can interfere with normal low-battery and thermal sleep. Use on a ventilated desk, never in a bag; software recovery does not guarantee emergency protection.

- Fresh JavaScript checks: **154 passed, zero skipped**. The complete `npm run check` passed, including strict TypeScript, ESLint and Prettier.
- Strict `npm run lint`: **passed** author, icon, skills, ESLint and Prettier checks.
- Native build: **two warning-free, byte-identical builds**, each passing **102 in-memory cases with zero power commands**. The arm64 helper is 253,888 bytes. Same-toolchain repeatability does not establish native battery behavior.
- Raycast build: **passed** for all three entry points and type generation/compilation. These build results are independent of the pending native activation tests.
- Current helper SHA-256: `f29a7384f0c58950ca3d26229423f7a81d66a28aed26a286fc17733b37ece35f`.
- Current Swift source SHA-256: `4292afd1f618dc16ee2f39edc8f5e1e990b593d5e0665071b09c2de965debe20`.
- Native candidate installation and activation: **not performed**; coordinated authorization remains necessary. The installed runtime and privileged helper were not replaced by the battery candidate. A final read-only observation of the older helper reported saved/live zero and no owned request; it is not validation of the new candidate.
- Native battery activation, physical closed-lid battery behavior, early Stop, independent expiry and power-source transitions: **unverified**.
- Fresh UI screenshots: **not obtained**. The prior attempt failed to capture the exact window and returned black pixels from broader capture; historical UI evidence remains private.

The platform baseline remains native Apple Silicon/macOS 26+. Only macOS 27.0.1 has historical native observations. The arm64 binary's macOS 13 deployment minimum is intended to retain installed inspection/Stop/recovery after rollback; it is not older-system start support or verified rollback compatibility.

## Historical AC-only candidate `09f81`

These results and identities belong to the previous AC-only candidate. They do not validate the new battery behavior or changed source/helper bytes.

| Check                        | Historical result                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maintainer and author        | Christopher Fathallah; `christopher_fathallah`; strict author validation passed.                                                                                        |
| JavaScript environment       | Node 24.21.0, npm 10.9.2, Raycast API 2.7.3.                                                                                                                            |
| Dependency/source checks     | `npm ci` installed 180 packages. All 153 JavaScript tests passed with zero skipped, including 11 build-script tests. Strict TypeScript, ESLint and Prettier passed.     |
| Raycast checks               | Strict lint passed, including author/icon validation. Build passed three entry points, type generation and compilation.                                                 |
| Native build inputs          | Apple Swift 6.4, selected macOS SDK 27.0.                                                                                                                               |
| Native output                | arm64-only, 253,664 bytes, macOS 13 deployment minimum; Mach-O encoded SDK 13.0, distinct from the selected SDK 27.0 input.                                             |
| Repeatability and simulation | Two warning-free builds were byte-identical; each passed 88 in-memory cases with zero power commands. This was same-toolchain repeatability, not cross-toolchain proof. |
| Unsupported Node check       | The version guard correctly exited 1 under Node 23.6.0.                                                                                                                 |
| Native activation            | Not installed or activated during this candidate's verification.                                                                                                        |

Historical identities:

- `assets/closed-lid-helper` SHA-256: `3d26cba07374595003f206c67d9c4ece22dcd9f57f90ef2b956a3b8392859d7b`.
- `native/ClosedLidHelper.swift` SHA-256: `04115e498dd9cdb0eb1bb0239087fe4b38dd5e0ed2f4ff5bb188d892c32d7fe5`.

## Earlier native and automated evidence

Before that candidate, a command revision passed 73 JavaScript tests and source/build checks; an earlier helper passed 51 in-memory cases. Earlier ordinary `caffeinate` tests covered owned assertions, short expiry, replacement, concurrency, process-exit survival and cancellation preserving an unrelated canary. Those legacy results do not validate the current privileged battery path.

The historical normal-command UI pass on macOS 27.0.1 reached one-hour Toggle and 30-second inline H/M/S confirmations after real AC preflight. Both were canceled before administrator authorization. Read-only dated Status and Raycast window close/reopen worked. No session was activated through those commands; window reopening did not test a full app restart.

A separate older direct-helper test used administrator installation and a finite ten-minute session on AC. It recorded 28 closed-lid samples across about 29 seconds, with a maximum process-heartbeat gap of 1.058 seconds. Final saved/live zero and retirement of the session were verified; the helper remained installed and the inactive daemon exited 0. Stop completed after the deadline. Journal timing was consistent with expiry, but expiry and manual Stop were not isolated. This is bounded AC evidence, not battery, long-duration, crash/reboot, thermal or uninstall validation.

## Preserved icon

The selected AI-generated `assets/dream-eater.png` remains an 88,074-byte, 512×512, 8-bit RGBA PNG with alpha values 0–255. SHA-256: `a7f5b1c4d98110fa42d2b4f79659ce4c50b77f8abedf454bb82bf61ae63f62a7`. Its transparent master was resampled with native `sips` without redrawing or intentional color changes. The prior image remains only in historical Git commits.

Historical icon-only checks passed three manifest tests, TypeScript, Raycast build and strict icon validation. Installed runtime references/hash matched, and all three icons rendered in light-theme Raycast 2.7.3 root search without invoking commands. Confirmation-icon rendering remains untested. AppKit previews at 16/24/32/48 pixels were clear on light backgrounds but showed weak purple contrast on dark backgrounds, especially 16/24. No redesign was applied. These results do not establish current candidate UI behavior, exclusive rights, trademark clearance or Store approval.

## Clean-state compatibility limit

An entirely absent persisted global power-settings dictionary remains unknown, so some untouched Macs can be refused activation. An absent `SleepDisabled` key inside a successfully recognized dictionary can mean the default false value; an absent live property also requires a successful root-domain snapshot. Failed or malformed reads do not establish a normal baseline.

Missing-`PrivilegedHelperTools` support addresses directory creation and trust only, not universal clean-Mac activation. Native checks of these combinations remain pending. No power preference should be initialized merely to turn an unknown baseline into a test pass.

## Reproduce and complete validation

Use the supported Node ranges `^22.22.2 || ^24.0.0`, preferably Node 24 LTS as recorded in `.node-version`:

```sh
npm ci
npm run check
npm run build
npm run lint
npm run build:native
```

Native rebuilding requires Apple Swift 6.2+ and macOS SDK 26+ selected for `xcrun`. Building and in-memory self-tests do not install the helper or change power settings. Record new hashes and results for changed bytes.

Follow [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) for coordinated battery testing with healthy charge, supervised early Stop, separate expiry and source transitions. Guard interruption, reboot, thermal response, conflicts, uncertain restoration, long-duration behavior and uninstall remain unverified. Do not induce unsafe battery depletion or heat.

This is private release preparation; no Store submission or public release is represented. See [installation/recovery](CLOSED-LID-APPROVAL.md) and [the detailed Mac checklist](MAC-TEST-CHECKLIST.md).
