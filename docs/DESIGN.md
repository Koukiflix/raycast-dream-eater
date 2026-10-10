# Research and design

This document explains the private `raycast-dream-eater` source repository. Platform references and Store rules can change; native results are bounded by [verification](VERIFICATION.md).

## Implementation boundary

The normal command path is Raycast command → unprivileged TypeScript client → administrator-authorized native helper → macOS global sleep setting. It does not start `caffeinate`. The retained ordinary backend exists for earlier owned sessions and regression tests. The software is original project code; its MIT license excludes the icon identified in the artwork notice.

## Supported starts and retained recovery

The product baseline is Apple Silicon and macOS 26+. New starts require native arm64 execution and are checked by both the TypeScript client and native helper. The binary retains a macOS 13 deployment minimum only to keep installed inspection, Stop and recovery executable after OS rollback; this is not support for starting sessions on older systems. New-start eligibility must not block recovery of an existing owned session. Only macOS 27.0.1 has native observations in this record. The rebuilt candidate needs its own native validation.

## Three root commands

All commands use `no-view`: **Toggle Dream Eater**, **Dream Eater for…**, and **Dream Eater Status**. The duration command takes native root-search text arguments named `hours`, `minutes`, `seconds`, with Hours/Minutes/Seconds placeholders. There is no React form or view polling.

The [Raycast arguments API](https://developers.raycast.com/information/lifecycle/arguments) permits three inline arguments. Dream Eater uses async no-view handlers directly, with no React form. New Toggle and duration starts always use the closed-lid helper. Sleep Mode and Keep display awake preferences have been removed.

Duration parsing rejects blank, zero, negative, noninteger, overflowing and greater-than-24-hour input before starting a session. Toggle starts a one-hour closed-lid session from Off; the duration command accepts a total of 1 second to 24 hours. No command starts an indefinite session. New starts target AC and battery use with identical finite limits. They retain exclusive-use, ownership, confirmation and administrator checks; unplugging alone does not restore or restart a session. Restore an active closed-lid session before requesting another timer. Toggle prioritizes an actually owned closed-lid recovery before reading possibly damaged ordinary metadata. Legacy ordinary sessions remain readable and stoppable, but no normal command creates them.

The [command API](https://developers.raycast.com/api-reference/command) changes only the current command's subtitle, which persists. Status is explicitly a dated snapshot, with absolute end times and unknown/unavailable errors. There is no recurring refresh, menu-bar item, or schedule. Action-triggered background Status is read-only, with no HUD or administrator prompt.

Before the helper rebuild and icon replacement, an earlier command revision passed all 73 tests, TypeScript, ESLint, Prettier and the Raycast build. Native pixels confirm the inline fields and both normal-command confirmations after real closed-lid preflight. Both confirmations were canceled before administrator authorization; read-only Status and final saved/live zero were verified. Separately, the previous helper build was installed with administrator authorization and a direct client test recorded about 29 seconds of closed-lid heartbeat continuity on AC, followed by saved/live zero restoration. These historical AC observations do not validate the battery-capable revision. Authorized activation, early Stop, separate expiry, crash, reboot and thermal recovery remain unverified for its new bytes. See [verification](VERIFICATION.md).

## macOS boundary

Apple documents [`caffeinate`](https://github.com/apple-oss-distributions/PowerManagement/blob/main/caffeinate/caffeinate.8) and [its implementation](https://github.com/apple-oss-distributions/PowerManagement/blob/main/caffeinate/caffeinate.c). In the retained legacy ordinary backend, `-i` prevents idle system sleep; `-d` prevents display sleep; `-t` bounds assertion lifetime; `-w` releases it when the watched process exits. It does not use the AC-only `-s` flag.

Apple's [idle-sleep assertion documentation](https://developer.apple.com/documentation/iokit/kiopmassertiontypepreventuseridlesystemsleep) excludes lid-close, explicit menu sleep, and low-battery sleep. Those limits apply to ordinary mode even when its assertion has been verified.

The default backend sets the global `SleepDisabled` preference with the lid open or closed; it does not switch mechanisms at lid closure. Apple's [pmset implementation](https://github.com/apple-oss-distributions/PowerManagement/blob/main/pmset/pmset.m) persists that setting, so it is not an assertion tied to a Raycast command's lifetime. This blocks system sleep paths but creates no separate display-awake assertion. Screen dimming, display sleep and locking remain separate concerns.

The current design has no battery-percentage cutoff or critical-battery-specific guard. It retains ProcessInfo serious/critical thermal restoration, finite deadlines, owned Stop and interrupted-operation recovery. The global override can interfere with normal low-battery and thermal sleep; these software guards cannot guarantee emergency protection. Native battery operation remains unverified.

The privileged helper remains installed after a session. The previous helper build’s short native test established installation, active readback, continued process execution during the observed closure, and final restored readback. It does not establish unrestricted duration or all recovery cases. [Installation and recovery](CLOSED-LID-APPROVAL.md) owns the architecture and authorization details. The [README component map](../README.md#repository-components) identifies the implementation files and their responsibilities.

## Missing settings and first installation

A successfully read saved global dictionary can omit `SleepDisabled`; that missing key means the default false value. A successful live root-domain snapshot can also omit the property and imply false. An entirely absent persisted global settings dictionary, failed reads or malformed data remain unknown, so some untouched Macs may refuse a new start. The helper does not write a default merely to qualify that Mac for activation.

The authorized bootstrap supports creating and validating a missing `/Library/PrivilegedHelperTools` directory. That path support is independent of power-state eligibility and does not prove compatibility with all clean Macs. Native candidate validation of these cases remains pending.

## Retained ordinary process ownership and cancellation

This backend supports recovery of earlier sessions and historical regression tests. Current commands do not create new ordinary sessions.

Raycast [unloads commands](https://developers.raycast.com/information/lifecycle). An in-memory timer or child attached to a command cannot own a session that survives that unload. A small macOS Bash 3.2-compatible guardian is detached with ignored streams and no inherited shell configuration. It supervises exactly one caffeinate process with `-w`.

Each ordinary launch gets a cryptographically random session identifier, private session files, and a named FIFO. The extension persists recovery metadata before atomically replacing the active-session pointer. That rename is the commit boundary:

- Before commit, the guardian self-exits without creating an assertion.
- After commit, surviving a Raycast exit is intentional and the session remains discoverable.
- A caught launch failure leaves a durable stop request for that session.
- Concurrent commits use last-writer-wins; superseded guardians exit.

The guardian checks the absolute deadline and ownership at most every 30 seconds while active. The native timeout independently bounds a timed assertion. A durable stop marker is authoritative; FIFO data wakes the blocked guardian promptly. This avoids a lost-cancel race around Bash's read timeout.

The ordinary manager verifies the guardian's full command line including the random session ID, the child identity/parent, and the child's actual power assertions. It never terminates a numeric PID. A recycled PID cannot make ordinary Disable kill an unrelated process. After guardian exit, the child may briefly be reparented, so status remains Stopping while its expected assertion is present.

The ordinary backend reads its own support files and standard process/power status. It makes no network requests, collects no telemetry, stores no credentials, and does not change privilege configuration. The default privileged backend's broader installation and file access are described separately in [the approval document](CLOSED-LID-APPROVAL.md).

## Generated project icon

`assets/dream-eater.png` is the user-selected AI-generated icon, resized from its transparent master with macOS `sips`. Integration applied resampling only, without redrawing or intentional color changes. The exported file is PNG, 512×512 pixels, with an alpha channel. SHA-256: `a7f5b1c4d98110fa42d2b4f79659ce4c50b77f8abedf454bb82bf61ae63f62a7`.

The icon is excluded from the software MIT license. [Artwork and dependency notices](../THIRD_PARTY_NOTICES.md) record its provenance without asserting exclusive rights or trademark clearance. The earlier supplied artwork is absent from the current source tree but remains in historical Git commits.

Raycast's [manifest documentation](https://developers.raycast.com/information/manifest) and [Store preparation guide](https://developers.raycast.com/basics/prepare-an-extension-for-store) require a 512×512 PNG icon. The exported image has those file properties and passed strict icon validation; three relevant manifest tests, TypeScript and the Raycast build also passed. AppKit previews showed weaker purple contrast on dark backgrounds, especially at 16 and 24 pixels, and clearer light-background rendering. Native root-search rendering passed for all three icons in light-theme Raycast 2.7.3 without invoking a command; confirmation rendering remains untested. The historical icon-only network-enabled lint run passed icon, skills, ESLint and Prettier checks and failed only the then-placeholder author lookup with a 404. Final candidate metadata validation is recorded separately in [verification](VERIFICATION.md). Earlier rendering results apply only to the previous icon. File properties do not establish Store approval.
