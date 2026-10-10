# Private submission draft

**Draft for private review only. Not submitted.** This document does not authorize Store publication, a public pull request or a repository visibility change. The rebuilt helper still needs coordinated native validation before a release claim can be made.

## Proposed listing

- **Name:** Dream Eater
- **Maintainer:** Christopher Fathallah
- **Raycast author:** `christopher_fathallah`
- **Platform:** Apple Silicon Macs running macOS 26 or newer; native arm64 execution required for new sessions
- **Summary:** Temporarily prevent system sleep with a one-hour toggle or an inline hours/minutes/seconds timer, and check verified status from Raycast.

## Proposed description

Dream Eater keeps an eligible Mac awake for a finite session with the lid open or closed. Toggle requests one hour; Dream Eater for… accepts a whole-number duration from 1 second to 24 hours through inline Hours, Minutes and Seconds fields. Dream Eater Status reads actual state and records when it was checked. There is no form to scroll, background Raycast refresh, mode preference or indefinite start.

The current design permits starts on AC or battery with the same finite limits. Starting requires confirmation, exclusive use of the global sleep setting and macOS administrator authorization. Dream Eater installs a native privileged helper and a LaunchDaemon. They supervise an owned recovery journal and remain installed after the session ends. Current starts change the global `SleepDisabled` setting; they do not launch `caffeinate` or independently keep the display lit or unlocked.

The guard requests restoration at expiry, on Stop and when interruption or ProcessInfo serious/critical thermal conditions are detected. Disconnecting or reconnecting power alone does not restore or restart the session. There is no battery-percentage cutoff or critical-battery-specific guard, and the global override can interfere with low-battery or thermal sleep. Off is reported only after the saved and live settings both verify normal sleep. These are best-effort software recovery paths; they cannot guarantee recovery when hardware, storage or the operating system cannot execute them. Use on a ventilated desk, never in a bag, and avoid other writers to the same global setting.

Restore an active session before removing the extension. The documented helper uninstall procedure requires verified Off and no unresolved journal. The helper's lower binary deployment minimum preserves inspection and recovery after an OS rollback; it does not allow new starts below the supported macOS baseline.

## Reviewer disclosures

- The persistent privileged helper, its Swift source, build script and exact compiled asset are included for review. Installation is administrator-authorized; this is not an administrator-free feature or a separately notarized installer.
- Global `SleepDisabled` is broader than an idle assertion and can affect demand sleep paths. It has no owner identifier or atomic compare-and-swap operation, so exclusive use is required.
- Legacy owned ordinary sessions remain readable and stoppable; the normal commands do not start them.
- Some untouched Macs may refuse activation because an entirely absent persisted global power-settings dictionary is treated as unknown. Supporting a missing helper installation directory does not establish compatibility with every clean Mac.
- The selected AI-generated transparent PNG is excluded from the software MIT license. Its provenance is documented without claims of exclusive rights, trademark clearance, affiliation or Store approval. Small purple features have weak dark-background contrast, particularly at 16 and 24 pixels.
- No private account screenshots, email address, device/boot/session identifiers or raw local logs are included.

## Validation note to complete before sending

The supported baseline remains Apple Silicon/macOS 26+; native observations cover macOS 27.0.1 only. The battery-capable revision has not been installed or activated, and native battery behavior is unverified. Fresh checks passed 154 JavaScript tests with zero skipped, strict TypeScript and ESLint; two byte-identical native builds each passed 102 in-memory cases with zero power commands, and the Raycast build passed. Final strict lint and the complete `npm run check` passed. Previous AC-only candidate `09f81` results and the older short physical AC test are historical; they cannot validate this revision. See [VERIFICATION.md](VERIFICATION.md).

Complete the supervised battery and independent expiry phases in the [release checklist](RELEASE-CHECKLIST.md), review the final candidate and seek separate submission authorization. The draft remains private until then.
