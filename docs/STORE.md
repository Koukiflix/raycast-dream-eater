# Raycast Store preparation

This is a **private source repository being prepared for review**. No Store submission, public pull request, public release, repository visibility change or collaborator addition is part of this preparation. Local import and a passing build do not establish Store acceptance.

The maintainer is **Christopher Fathallah**, with verified Raycast handle **`christopher_fathallah`**. No account screenshots or email address are needed in this repository. The [private submission draft](SUBMISSION-DRAFT.md) contains proposed copy and disclosures; it has not been sent.

## Product and installation scope

Dream Eater provides three no-view commands: a one-hour Toggle, an inline H/M/S timer accepting 1 second to 24 hours, and read-only dated Status. New starts require **native Apple Silicon, macOS 26+, exclusive use of the global sleep setting, explicit confirmation and administrator authorization**. The revised design permits AC or battery starts with the same finite limits; unplugging alone does not restore or restart a session. Native battery behavior remains unverified. There is no mode preference or indefinite start. Native observations recorded so far cover macOS 27.0.1 only.

The native helper changes persistent, global `SleepDisabled` with the lid open or closed. Current starts do not launch `caffeinate` and do not create a separate display-awake assertion. Earlier owned ordinary sessions remain inspectable and stoppable. The helper and LaunchDaemon remain installed after a timer ends; removing the extension does not restore an active owned session. See the [installation and recovery specification](CLOSED-LID-APPROVAL.md).

The helper is arm64. Its macOS 13 binary deployment minimum is intended to keep installed inspection, Stop and recovery executable after OS rollback; it is not support for starting sessions below macOS 26 or on Intel/translated execution. New-start guards must preserve access to recovery. Native rollback compatibility remains unverified.

## Clean-machine limitation

Some untouched Macs may refuse activation when the entire persisted global power-settings dictionary is absent. This state remains unknown; Dream Eater does not create a normal baseline with a power-setting write. Missing-directory support for `/Library/PrivilegedHelperTools` addresses installation only and does not promise activation on every clean Mac. This compatibility boundary must remain visible in any proposed release description.

## Candidate verification status

The AC-and-battery revision passed all 154 JavaScript tests with zero skipped, the complete `npm run check`, strict Raycast lint and the Raycast build. Two warning-free native builds were byte-identical and each passed 102 in-memory cases with zero power commands. Candidate installation and power-changing tests have not been performed; native battery behavior remains unverified. Fresh UI capture was previously blocked. The compact [verification record](VERIFICATION.md) contains current hashes and keeps previous candidate `09f81` results historical.

There is no battery-percentage cutoff or critical-battery-specific guard. ProcessInfo serious/critical thermal restoration is retained, but the global override can interfere with low-battery and thermal sleep. Use on a ventilated desk, never in a bag; do not present these guards as emergency protection. The [release checklist](RELEASE-CHECKLIST.md) begins battery validation with healthy charge, supervised early Stop, then a separate expiry run.

## Artwork and metadata

The user-selected AI-generated `assets/dream-eater.png` is a transparent 512×512 PNG, resampled with macOS `sips` without redrawing or intentional color changes. Its properties and hash are recorded in [the artwork notice](../THIRD_PARTY_NOTICES.md). The icon is outside the software MIT license. AI provenance establishes neither exclusive rights nor trademark clearance.

The icon-only revision passed strict icon validation, three manifest tests, TypeScript and the Raycast build. All three command icons rendered in native light-theme Raycast 2.7.3 root search without command invocation. Confirmation-icon rendering remains untested. AppKit previews showed weaker purple contrast on dark backgrounds, especially at 16 and 24 pixels; the selected artwork is preserved without redesign. The old lint failure for a placeholder author is historical, not a current candidate result or a reason to skip final validation.

The retained `prepare-store` script edits local author metadata only. It does not publish or submit. Final validation uses the verified handle rather than a placeholder.

## Before a separately authorized submission

- Freeze and review the exact source, arm64 helper bytes, platform guards, metadata, artwork notice and authorization text.
- Complete the applicable [release and native checks](RELEASE-CHECKLIST.md), preserving failed and untested results.
- Run `npm ci`, `npm run check`, `npm run build` and strict `npm run lint` with the supported Node toolchain and final metadata.
- Include genuine screenshots of the candidate, with personal data removed, and state whether they show search, confirmation or actual activation.
- Review the proposed contents for private paths, device/session identifiers, raw logs, recovery state, credentials, dependency folders and unintended generated files.
- Recheck the official [Store preparation guide](https://developers.raycast.com/basics/prepare-an-extension-for-store), [technical guidelines](https://developers.raycast.com/information/developer-guidelines), [Extension Guidelines](https://manual.raycast.com/extensions-guidelines) and [publishing guide](https://developers.raycast.com/basics/publish-an-extension). No acceptance claim is made for the privileged helper design.
- Obtain separate authorization for the concrete submission after the draft and validation record are ready for review.

The repository has no submission script. Its `prepublishOnly` guard rejects npm publication. Release preparation does not authorize Store submission, a public pull request or another distribution action.
