# macOS sleep-control research

## Confirmed cause

Dream Eater's original `caffeinate -i -d` backend prevented idle sleep with the lid open. It did not implement closed-lid prevention. Verifying those assertions alone did not satisfy the closed-lid requirement.

## Current implementation

Dream Eater's native helper enables the global setting with `/usr/bin/pmset -a disablesleep 1` and restores it with `/usr/bin/pmset -a disablesleep 0`. It verifies both the saved preference and the live `IOPMrootDomain` property. The active setting applies with the lid open or closed. Normal commands do not run `caffeinate` or provide a display-awake assertion.

The client uses AppleScript `do shell script ... with administrator privileges` for native administrator authorization. It hashes and stages the bundled helper before execution, then reconciles the observed result. It does not change PAM, sudoers or other authentication settings. [Installation and recovery](CLOSED-LID-APPROVAL.md) describes this boundary in detail.

## Why adding a timer needs more than the toggle

Apple's implementation treats `SleepDisabled` as a non-power-source-specific system preference. It is saved and reapplied by powerd at startup. Quitting Raycast or rebooting must not be described as a reset. `-c` and `-b` do not make this particular setting charger-only or battery-only.

Apple's kernel checks this switch for idle and demand sleep before its low-battery and thermal sleep exceptions. Therefore the implementation must not promise that normal emergency sleep still protects a closed laptop. This source evidence does not establish the behavior of separate hardware shutdown protections.

`pmset` may return exit status zero after a setting-write error, so a successful process exit is insufficient. Read back both the persisted preference and the live root-domain `SleepDisabled` property when available. Unknown state and failed rollback must remain visible errors.

Sources: [pmset implementation](https://github.com/apple-oss-distributions/PowerManagement/blob/main/pmset/pmset.m), [system preference persistence](https://github.com/apple-oss-distributions/IOKitUser/blob/main/pwr_mgt.subproj/IOPMEnergyPrefs.c), [powerd settings](https://github.com/apple-oss-distributions/PowerManagement/blob/main/pmconfigd/PMSettings.m), [kernel sleep checks](https://github.com/apple-oss-distributions/xnu/blob/main/iokit/Kernel/IOPMrootDomain.cpp).

## Bounded implementation

New sessions use the closed-lid helper with a finite timer and explicit exclusive use of the global setting. Earlier ordinary sessions remain readable and stoppable. The helper refuses to adopt a setting already enabled without its own valid recovery record. Its recovery job is independent of Raycast and remains on disk so a crash or reboot can trigger restoration. Installation requires administrator approval for the documented paths and behavior.

The current design permits AC and battery starts. Disconnecting or reconnecting the charger alone does not restore or restart the session. The guard requests restoration on ProcessInfo serious/critical thermal state, expired deadline, changed boot identity or recovery after an interrupted operation. There is no battery-percentage cutoff or critical-battery-specific guard. The override can interfere with low-battery and thermal sleep; these software guards do not guarantee emergency protection.

There is no ownership token in the macOS setting. Another app writing the same value is indistinguishable from our own state. The user must stop other writers of this setting while Dream Eater owns it. Detectable external changes end or suspend the lease; uncertain ownership must remain visible as a conflict rather than trigger an unconditional write.

## Physical validation and heat

Apple's supported closed-display setup uses external power, a display, and an external keyboard/mouse. That does not establish headless battery operation. Native battery behavior is unverified. After coordinated approval, start with healthy charge on a ventilated desk and perform a short supervised battery test, then a separate expiry test. Any physical lid closure must also be supervised with workload continuity recorded and final saved/live restoration checked. Settings and assertions alone cannot establish success.

Use a stable ventilated surface, stay within Apple's operating temperatures, and restore normal sleep before placing the laptop in a bag. This mode consumes power and may block ordinary sleep safety paths.

Sources: [Apple external-display conditions](https://support.apple.com/en-us/102501), [macOS sleep guide](https://support.apple.com/guide/mac-help/put-your-mac-to-sleep-or-wake-it-mh10330/mac), [thermal guidance](https://support.apple.com/en-us/102336).

## Project icon

The current icon is `assets/dream-eater.png`, an AI-generated transparent PNG selected by the user and resized to 512×512 with macOS `sips`. This asset change does not alter the sleep-control architecture. See [the artwork notice](../THIRD_PARTY_NOTICES.md) for its hash, provenance and separate treatment from the software license.

Strict icon validation, three relevant manifest tests, TypeScript and the Raycast build passed for the replacement. Native root-search rendering passed for all three icons in light-theme Raycast 2.7.3 without invoking a command; confirmation rendering remains untested. At the historical icon-only revision, network-enabled lint passed icon, skills, ESLint and Prettier checks and failed only the then-placeholder author lookup with a 404. Final candidate checks are recorded separately in [verification](VERIFICATION.md). AppKit previews at 16, 24, 32 and 48 pixels were clear on light backgrounds but showed weak purple contrast on dark backgrounds, especially at 16 and 24 pixels; the artwork was not redesigned. Earlier icon rendering checks are historical and do not validate this replacement. No Store publication, exclusive-rights or trademark-clearance claim is made.
