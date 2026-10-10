# Dream Eater Changelog

## AC and battery operation — native verification pending

- Permit new sessions on AC or battery; unplugging alone no longer requests restoration
- Preserve the one-hour Toggle default, 1-second–24-hour timer range, ownership checks, durable recovery and ProcessInfo serious/critical thermal guard
- Add no battery-percentage cutoff, critical-battery-specific guard or shorter battery cap
- Document interference with low-battery/thermal sleep and the need for supervised battery validation; native battery behavior remains unverified
- Pass 154 JavaScript tests, strict TypeScript/ESLint and the Raycast build; produce two identical native builds with 102 in-memory cases each and zero power commands
- Pass final strict Raycast lint and the complete source check; keep prior candidate `09f81` results historical and native battery operation unverified

## Historical AC-only release preparation (`09f81`)

- Credit Christopher Fathallah, with verified Raycast handle `christopher_fathallah`
- Set the product baseline to native Apple Silicon on macOS 26+; only macOS 27.0.1 has recorded native observations
- Retain the helper’s macOS 13 binary deployment minimum for installed Stop and recovery after OS rollback, without enabling new starts on unsupported systems
- Prepare a private submission draft and phased native release checklist; no Store submission or public release is authorized by this preparation
- Keep prior 73-test, 51-case simulation and 29-second physical observations historical
- Produce two warning-free, byte-identical candidate arm64 helper builds, each passing 88 in-memory cases with zero power commands; pass all 153 JavaScript tests (including 11 build-script tests), strict TypeScript, ESLint, Prettier and strict Raycast lint on Node 24.21.0 / npm 10.9.2
- Pass the final Raycast build for all three entry points, type generation and compilation
- Record fresh screenshots as blocked and candidate privileged installation/activation as unapproved and unperformed
- Preserve the selected transparent PNG and its documented dark-background contrast limitation
- Document that an entirely absent persisted global settings dictionary remains unknown, so some untouched Macs can refuse activation even with missing-helper-directory support

## Generated PNG icon

- Replaced the current supplied image with a user-selected AI-generated transparent PNG at `assets/dream-eater.png`
- Resampled the selected master to 512×512 with macOS `sips`, without redrawing or intentional color changes
- Recorded verified PNG dimensions, alpha channel and SHA-256 in the artwork notice
- Removed the previous asset from the current source tree; historical Git commits remain unchanged
- Passed three relevant manifest tests, TypeScript, Raycast build and strict icon validation; preserved historical full-suite and power-control test boundaries
- Recorded clear light-background AppKit previews and weak dark purple contrast at small sizes; all three icons rendered in native light-theme Raycast root search without invoking commands
- Passed strict icon, skills, ESLint and Prettier validation; only the placeholder author lookup failed. Confirmation-icon rendering remains untested

## Closed-lid protection in normal commands - 2026-10-10

- Toggle now enables closed-lid protection for one hour or restores normal sleep
- Inline H/M/S starts the same reviewed helper for 1 second to 24 hours; no mode preference is needed
- Preserved charger checks, administrator authorization, recovery helper and the then-current logo
- Passed 73 automated tests and native command confirmation/cancellation checks
- Recorded about 29 seconds of closed-lid execution in the approved helper test, with normal sleep restored afterward

## Native inline duration inputs - 2026-10-07

- Replaced the duration form with Hours, Minutes and Seconds in root search
- Made all three commands no-view; moved Sleep Mode to extension preferences
- Tested real inline timers and ordinary Toggle start/stop
- Fixed recovery access with damaged ordinary-session metadata; 47 automated tests pass

## Compact commands and staged closed-lid mode - 2026-10-07

- Added Toggle, Set Duration and dated Status commands with no recurring Raycast refresh
- Integrated the then-current user-supplied logo unchanged and verified the duration form fits without scrolling
- Confirmed the reported failure was lid closure: the original idle assertions did not cover it
- Built an optional administrator-authorized native recovery helper with finite closed-lid sessions; privileged installation and physical behavior remain untested and require approval
- Passed 45 automated tests, 51 native in-memory checks, the extension build and independent source review

## Native Mac verification and compact form - 2026-10-07

- Reduced the form to status, hours/minutes/seconds and one short hint; all controls fit without scrolling
- Added explicit command icon metadata
- Suppressed unchanged status renders and stopped the one-second clock when no timed session is running
- Verified real macOS assertions, expiry, replacement, concurrent calls and native Raycast controls
- Initially kept the reported sleep failure unclassified until the user clarified lid closure

## Dream Eater Rename - 2026-10-07

- Renamed the extension, its single command, package identifier, source entry point, documentation and source bundle to Dream Eater
- Added safe update instructions for anyone who installed the earlier prototype
- Kept enable/disable, status, optional hours/minutes/seconds and lid-open behavior unchanged

## Initial Prototype - 2026-10-07

- One screen for status, enable, disable and an optional hours/minutes/seconds timer
- Verified owned-session status and live countdown while the command is open
- Durable cancellation without global process termination or persistent power-setting changes
- Automated tests and a manual macOS/Raycast verification checklist
- Store-submission preparation, with author identity and native validation still required
