# Dream Eater

Dream Eater is a macOS Raycast extension that temporarily disables system sleep while the lid is open or closed. It provides **Toggle Dream Eater**, **Dream Eater for…**, and **Dream Eater Status**. This private source repository is named `raycast-dream-eater`. It is being prepared for private release review; no public release or Raycast Store submission has been made. Maintainer: **Christopher Fathallah**, Raycast handle **`christopher_fathallah`**.

New sessions use a native privileged helper. The current design permits starts on AC or battery and requires exclusive use of the global sleep setting, explicit confirmation, and administrator authorization. Native battery behavior is unverified. Toggle starts a **one-hour** session; custom timers accept **1 second to 24 hours**. Every session has a finite deadline, and the helper remains installed after it ends.

## What stays awake

Current commands use the system-wide `SleepDisabled` setting through the native helper. They **do not launch `caffeinate`** and do not choose a different backend when the lid changes position. The setting applies immediately for the active session, whether the lid is open or closed.

| Situation                                       | Actual behavior and limits                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lid open, active session                        | The global setting blocks system sleep, including idle and demand sleep paths. There is no separate display-awake assertion: the screen may dim, turn off or lock according to macOS settings.                                                                                        |
| Lid closed, active session                      | The same setting is intended to suppress lid-triggered system sleep while the helper's ownership and recovery conditions remain satisfied. A short test of an earlier helper build observed continued process execution; the rebuilt release candidate still needs native validation. |
| Session restored or expired                     | The helper restores the saved and live global setting to zero. Normal macOS sleep rules and other apps' assertions apply again; Dream Eater does not force immediate sleep.                                                                                                           |
| Charger connected or disconnected               | A power-source change alone does not end or restart the session. The same finite deadline and owned recovery remain in force.                                                                                                                                                         |
| Serious or critical thermal state observed      | The ProcessInfo thermal guard requests restoration. It is a best-effort software check, not a guarantee against power loss, hardware shutdown or an operating system unable to execute recovery.                                                                                      |
| Legacy ordinary session from an earlier version | Its `caffeinate` assertion may still prevent idle system sleep, and may also prevent display idle sleep. It permits lid-close and explicit sleep. Current commands can inspect and stop such owned sessions, but cannot start new ones.                                               |

Dream Eater does not configure external displays, unlock the Mac or keep network connections alive independently. AC and battery are design targets; native battery activation and physical closed-lid battery behavior remain unverified. System-sleep prevention and a continuously lit or unlocked display are separate behaviors.

## Commands

| Command                | Behavior                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Toggle Dream Eater** | From Off, requests a one-hour closed-lid session. While an owned session is active, requests restoration with confirmation and administrator authorization. Reports Off only after restoration is verified. |
| **Dream Eater for…**   | Accepts Hours, Minutes and Seconds inline in root search, then requests a closed-lid session for that duration. Restore the existing session with Toggle before starting a different timer.                 |
| **Dream Eater Status** | Reads actual state without administrator authorization or power-setting changes. Its root-search subtitle is a dated snapshot; run it again to refresh.                                                     |

All three commands are `no-view`. There is no form, menu-bar item, recurring Raycast refresh or UI polling. Actions request a short read-only Status refresh after changes. The native guard runs while a session or recovery journal needs supervision; the inactive installed daemon exits.

Duration values must be nonnegative whole numbers. Minutes and seconds may exceed 59, so `90` minutes is valid. Blank, all-zero, negative, noninteger, overflowing and greater-than-24-hour totals are rejected. There is no indefinite start, Sleep Mode preference or Keep display awake preference. New starts always use the closed-lid helper.

## Install for local development

Requirements:

- **Apple Silicon, macOS 26 or newer**, and Raycast with local extension development available. New starts require native arm64 execution; Intel and translated execution are not supported start environments. Native observations recorded here cover **macOS 27.0.1 only**.
- Node.js **24 LTS** and npm are recommended; the supported Node ranges are `^22.22.2 || ^24.0.0`. The recommended version is recorded in `.node-version`. Fresh toolchain results are recorded in [verification](docs/VERIFICATION.md).
- Exclusive use of the global sleep setting and administrator authorization when starting a session. AC and battery starts use the same duration limits.
- An Apple Swift 6.2+ toolchain with the macOS 26+ SDK only if rebuilding the native helper. The script uses the active `xcrun` selection (including `DEVELOPER_DIR`); it does not change the selected developer directory. The build targets arm64 only.

The helper binary uses a macOS 13 deployment minimum so installed inspection, Stop and recovery can remain executable after an OS rollback. **That binary minimum is not a supported product baseline.** New starts still require macOS 26+ and native Apple Silicon. Eligibility checks must not block restoration of an already owned session.

Some untouched Macs may refuse activation because macOS has no persisted global power-settings dictionary yet. Dream Eater treats that entirely absent dictionary as unknown and does not enable sleep prevention without a verified normal baseline. Support for creating a missing `/Library/PrivilegedHelperTools` directory does not establish compatibility with every clean Mac. See the [saved/live state rules](docs/CLOSED-LID-APPROVAL.md#saved-and-live-state-compatibility).

Clone or download this private repository using an account with access, then work from the repository root:

```sh
npm ci
npm run check
npm run build
npm run dev
```

`npm run dev` imports the development extension into Raycast. Keep the development folder available while using that installation. Read [installation, recovery and uninstall details](docs/CLOSED-LID-APPROVAL.md) before starting a session, then use [the Mac checklist](docs/MAC-TEST-CHECKLIST.md) for a controlled local test.

The release author is `christopher_fathallah` (Christopher Fathallah). The retained `prepare-store` script edits local author metadata only; it does not submit or publish the extension. Author identity verification is separate from passing final strict Raycast validation.

To rebuild the native asset from its Swift source and run its in-memory checks:

```sh
npm run build:native
```

This compiles, ad-hoc signs and verifies the local arm64 helper, runs in-memory checks, then replaces the asset only after those steps succeed. It does not install the privileged helper or change power settings. Ad-hoc signing uses no developer certificate or timestamp service and is not notarization. The script reports compiler/SDK versions, architecture, target and SHA-256 so repeated builds with the same toolchain can be compared. A rebuilt binary must receive its own validation; previous checks of the bundled binary are not proof about changed compiled bytes.

Installing the development extension and installing the privileged helper are separate steps. Importing/building the extension does not change a power setting. The first confirmed start opens macOS administrator authorization, installs the helper and its named LaunchDaemon, and attempts a bounded session. Later starts can update/reuse that installation and still require authorization. Status inspection needs no administrator prompt. Passwords are handled by macOS rather than collected or stored by the extension.

## From a command to an active session

1. Toggle inspects existing ownership first. It offers restoration for an owned closed-lid session, or stops a remaining legacy ordinary session. Otherwise it proposes a one-hour start. The duration command parses H/M/S and refuses to overlap either existing session type.
2. For a new start, the TypeScript client checks macOS/native-architecture eligibility, normal saved/live settings, then presents the command confirmation. Continuing acknowledges exclusive use of the global setting and leads to macOS administrator authorization.
3. The client hashes the bundled helper. The authorized bootstrap copies it into a root-controlled staging file, verifies that hash, and executes the verified bytes with a clean environment. The helper checks its own eligibility and filesystem trust rather than relying only on the UI.
4. The native helper takes a stable lock, installs/reuses its recovery service, writes a durable ownership journal, waits for the guard handshake and enables the global setting. It verifies both saved preferences and the live kernel property before confirming On.
5. The independent guard supervises the continuous monotonic deadline and ProcessInfo thermal observations. Closing Raycast's window does not own or terminate this session. Stop and recovery use the same journal and lock.
6. Restoration must produce saved and live zero before the journal is retired and Off is reported. Unknown or conflicting evidence remains visible; a successful shell exit alone is insufficient.

The current command process does not implement the timer with an in-memory JavaScript timeout. The root helper owns the bounded session so that unloading a no-view Raycast command does not discard its recovery state.

Status is read-only with respect to power settings and administrator operations. Legacy inspection may clean up confirmed-dead inactive metadata in the extension's own support directory. A dated subtitle is a snapshot, not proof that the setting is unchanged later.

## Power behavior and recovery

Dream Eater changes the persistent, system-wide `SleepDisabled` setting. This is broader than an idle-sleep assertion: it can affect demand sleep, including low-battery and thermal sleep requests. Use it on a ventilated desk, never inside a bag. There is no battery-percentage cutoff or critical-battery-specific guard; the retained thermal guard responds to ProcessInfo serious/critical states. It cannot guarantee normal emergency sleep protection. Do not use another app or command that writes this setting during a session.

The helper checks normal saved/live settings before starting, records the owned session in a recovery journal, and supervises its deadline. It requests restoration on expiry, Stop, interrupted execution, and serious or critical thermal notifications. Unplugging or reconnecting power alone does not restore, extend or restart the session. These paths are implemented, but the completed native tests do not establish every recovery case. Hardware shutdown, power loss, or an operating system unable to run the helper remain outside its protection.

The finite deadline is not a real-time restoration guarantee. System-command timeouts, lock contention, scheduling and verification retries can delay confirmed Off beyond the nominal end time. An unresolved rollback keeps its recovery state rather than reporting success.

The setting has no owner identifier or atomic compare-and-swap operation. Exclusive use is required; the helper cannot guarantee safe coexistence with uncoordinated writers. Uncertain restoration keeps the recovery journal and must not be presented as Off.

**Removing the Raycast extension does not restore an owned closed-lid session.** Restore it first and verify both saved and live zero before following the [helper uninstall procedure](docs/CLOSED-LID-APPROVAL.md#uninstallation). Keep the recovery service available while an owned journal remains.

If Status reports unavailable, conflict or recovery required, open the lid, ensure adequate charge and follow the documented read-only inspection and owned recovery procedure. Do not delete the journal or use a global power-preference reset to clear an error. A reboot is not a substitute for restoration: this setting persists, and recovery depends on the installed service being able to run.

## Repository components

| Component                                            | Responsibility                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/dream-eater.tsx`                                | No-view Toggle entry point. Prioritizes owned recovery, handles legacy Stop, and requests a one-hour closed-lid start only from eligible Off state.                                                                                |
| `src/set-duration.tsx`                               | No-view timer entry point. Validates three inline inputs, enforces the 24-hour closed-lid cap and refuses overlap before confirmation.                                                                                             |
| `src/status.ts`                                      | Reads both current and legacy state, publishes a dated command subtitle and shows a HUD only for a user-initiated status check.                                                                                                    |
| `src/controllers.ts`                                 | Resolves Raycast support/assets paths, constructs the two managers and requests optional read-only Status refreshes after actions. Constructing the legacy manager does not launch a session.                                      |
| `src/closed-lid.ts`                                  | Unprivileged client for native inspection and authorized start/stop. Validates status, prefers trusted installed recovery code, hashes the bundled asset and reconciles uncertain authorization outcomes with observed state.      |
| `native/ClosedLidHelper.swift`                       | Root helper implementation: installation, trust checks, serialized ownership journal, guard lifecycle, thermal observations, deadline restoration, inspect/stop/uninstall commands and in-memory self-tests.                       |
| `assets/closed-lid-helper`                           | Compiled native executable bundled into Raycast. It becomes a privileged installation only after authorized start; the source build is provided for review and rebuilding.                                                         |
| `src/duration.ts`                                    | Shared whole-number parsing, overflow checks, formatting and legacy countdown utilities. The normal timer command applies the tighter 1-second–24-hour closed-lid range. Legacy parsing support does not expose indefinite starts. |
| `src/session.ts`                                     | Retained ordinary-session manager. Discovers/verifies old owned guardians and real assertions, and supports their cancellation and regression tests. Its launch API is not called by current normal commands.                      |
| `assets/session.sh`                                  | Retained Bash guardian for the legacy ordinary mechanism. Supervises its owned `caffeinate -w` child, handles durable Stop/FIFO wake-up and enforces legacy deadlines/ownership. Current normal starts do not execute it.          |
| `assets/dream-eater.png`                             | AI-generated transparent 512×512 PNG selected by the user; excluded from the software license. See the artwork notice.                                                                                                             |
| `tests/toggle.test.ts`                               | Stubbed command-handler checks for routing, finite defaults, confirmation/authorization failures, ownership precedence and legacy cancellation.                                                                                    |
| `tests/closed-lid.test.ts`                           | Client checks for trusted paths, hash-pinned installation, status parsing, ownership, serialized operations and uncertain outcomes.                                                                                                |
| `tests/session.test.ts`                              | Legacy ordinary-manager lifecycle and ownership regression coverage using controlled test utilities.                                                                                                                               |
| `tests/duration.test.ts`                             | Input, boundary, overflow and formatting checks.                                                                                                                                                                                   |
| `tests/bootstrap.test.ts`                            | Tests privileged bootstrap path validation and missing-directory behavior with controlled command stubs.                                                                                                                           |
| `tests/helper-build.test.ts`                         | Checks reproducible build inputs, output architecture/signature requirements and failure handling without installing the helper.                                                                                                   |
| `tests/node-version.test.ts`                         | Checks accepted Node ranges and rejection of unsupported versions.                                                                                                                                                                 |
| `tests/status.test.ts`                               | Checks dated read-only status reporting and state precedence.                                                                                                                                                                      |
| `tests/manifest.test.ts`                             | Three-command manifest, identity, no recurring refresh, and absence of the removed mode/display preferences.                                                                                                                       |
| `scripts/build-closed-lid-helper.mjs`                | Builds the arm64 native executable using the selected Xcode toolchain; optionally runs its simulation tests. Never installs or activates the helper.                                                                               |
| `scripts/check-node.mjs`, `.node-version`            | Check supported Node versions before package workflows and record the recommended local version.                                                                                                                                   |
| `scripts/prepare-store.mjs`                          | Validates a Raycast handle and edits only the local manifest author. Does not contact GitHub or publish.                                                                                                                           |
| `package.json` / `package-lock.json`                 | Raycast commands, pinned API/dependency resolution and local development/check scripts. The prepublish guard rejects npm publication.                                                                                              |
| `tsconfig.json`, `eslint.config.mjs`, Prettier files | TypeScript, lint and formatting configuration.                                                                                                                                                                                     |
| `.gitignore`                                         | Keeps dependencies, generated build files, private evidence, archives and environment files out of version control.                                                                                                                |
| `docs/`                                              | Architecture, macOS behavior research, persistent-installation/recovery details, verification boundaries, native checklist and possible future Store preparation.                                                                  |
| `LICENSE`, `THIRD_PARTY_NOTICES.md`, `CHANGELOG.md`  | Software license, separate artwork notices and recorded changes.                                                                                                                                                                   |

Documentation entry points:

- [DESIGN.md](docs/DESIGN.md): command lifecycle, platform boundary and retained ordinary ownership model.
- [CLOSED-LID-APPROVAL.md](docs/CLOSED-LID-APPROVAL.md): exact privileged installation, trust boundary, recovery commands and uninstall.
- [CLOSED-LID-RESEARCH.md](docs/CLOSED-LID-RESEARCH.md): Apple platform sources behind global-setting persistence and limitations.
- [VERIFICATION.md](docs/VERIFICATION.md): completed checks and the distinctions between automated, UI and physical results.
- [MAC-TEST-CHECKLIST.md](docs/MAC-TEST-CHECKLIST.md): reproducible checks and remaining native cases.
- [STORE.md](docs/STORE.md): release preparation and a separately authorized future Store process.
- [SUBMISSION-DRAFT.md](docs/SUBMISSION-DRAFT.md): private draft copy and reviewer disclosures, not a submission.
- [RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md): candidate-specific checks and coordinated native validation phases.

`dist/`, dependencies and Raycast-generated type declarations are local build products, not the authoritative implementation. Neither those generated files nor this component map replace review of the Swift source and exact compiled helper bytes.

## Verification status

The AC-and-battery revision has not yet been installed or activated. Its 154 JavaScript tests, strict TypeScript and ESLint passed; two byte-identical native builds each passed 102 in-memory cases with zero power commands, and the Raycast build passed. Final strict lint and the complete `npm run check` passed; native battery operation, early Stop and independent expiry remain unverified. Coordinated native testing is a separate step. No battery-specific percentage cutoff or shorter duration cap has been added.

The previous AC-only candidate `09f81` passed 153 JavaScript tests, strict source/lint/build checks and two byte-identical native builds with 88 in-memory cases each. Those results do not validate this changed revision. An older helper test observed about 29 seconds of closed-lid execution on AC and final saved/live zero; expiry and manual Stop were not isolated. Fresh UI capture was blocked. See [verification](docs/VERIFICATION.md) for exact historical identities and remaining work.

## Earlier versions

Earlier Dream Eater versions created ordinary lid-open `caffeinate` sessions. The current commands retain status and cancellation for those owned sessions, but create no new ordinary sessions. Use Toggle to stop a remaining ordinary session before starting a closed-lid timer. Stopping a legacy ordinary session does not require administrator authorization.

Disable sessions owned by a separately named older prototype before removing that extension. Dream Eater uses its own extension identifier and support directory; it does not guess another extension's files or stop its processes. A restart ends ordinary sessions, but does not replace the closed-lid recovery procedure.

## Source, artwork and Store status

The software is MIT-licensed. `assets/dream-eater.png` is an AI-generated icon created for this project and selected by the user. The transparent master was resized to 512×512 with macOS `sips`, without redrawing or intentional color changes. The icon remains outside the software license; see [the artwork notice](THIRD_PARTY_NOTICES.md) for its verified hash and provenance. No exclusive-rights or trademark-clearance claim is made.

The replacement is an 88,074-byte, 512×512, 8-bit RGBA PNG with alpha values spanning 0–255. Three relevant manifest tests, TypeScript, the Raycast build and strict icon validation passed. AppKit previews at 16, 24, 32 and 48 pixels were clear on light backgrounds; purple contrast was weak on dark backgrounds, particularly at 16 and 24 pixels. No redesign was applied. Native root-search rendering passed for all three command icons in light-theme Raycast 2.7.3 without invoking a command. Confirmation rendering was not tested. At the icon-only revision, network-enabled lint passed extension-icon, skills, ESLint and Prettier validation; only the then-placeholder author failed with a 404. That failure is historical; the prior AC-only candidate subsequently passed strict lint with the verified author. Fresh battery-revision automated results are recorded in verification; native behavior remains unverified. Fresh candidate UI capture was blocked, so no new rendering pass is claimed. Valid image properties do not establish Store acceptance.

The implementation is original project code; [design notes](docs/DESIGN.md) explain its architecture and platform boundaries. [Store preparation](docs/STORE.md) records a possible future submission workflow. This repository is not evidence of Store approval or a public release.
