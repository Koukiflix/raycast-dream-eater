# Closed-lid backend: approval and recovery

This is the default backend for new Dream Eater sessions. Building it, running
`--self-test`, or using `inspect` does not install it or change a power setting.
Installation, a short physical lid-closure interval and final saved/live zero
were observed with the previous helper build in a controlled native test. The
rebuilt release candidate has not yet received a power-changing native test. Normal command confirmation,
cancellation and read-only Status were also checked. These checks do not establish
all activation, expiry, crash, reboot or thermal recovery paths, and do not validate the new battery-capable revision. See
[verification boundaries](VERIFICATION.md).

The no-view interface uses the closed-lid helper for every new start. Toggle starts a one-hour session from Off or restores an owned active session. Dream Eater for… accepts inline H/M/S totaling 1 second to 24 hours. Both start paths target AC or battery operation and require explicit confirmation, exclusive use of the setting, and administrator authorization. A power-source change alone does not end or restart a session. Native battery behavior remains unverified. Restore an existing closed-lid session before starting another timer. There is no indefinite start or Sleep Mode preference. Legacy ordinary sessions can still be inspected and stopped.

## Supported starts and recovery after rollback

New sessions require Apple Silicon, native arm64 execution and macOS 26 or newer, in addition to the power and ownership checks below. Both client and helper enforce new-start eligibility. Only macOS 27.0.1 has been observed in the native tests recorded here.

The compiled helper deliberately retains a macOS 13 deployment minimum so installed inspection, Stop and recovery can still execute after an OS rollback. It does not make macOS 13–25 a supported start environment. A failed new-start platform check must not prevent restoration of an already owned session. This recovery compatibility still needs candidate-specific validation; the earlier physical test does not prove the rebuilt bytes.

## What administrator approval authorizes

The backend changes the system-wide `SleepDisabled` switch with the lid open or
closed. It does not launch `caffeinate` or create a display-awake assertion.
This is broader than preventing idle sleep or just handling the lid.
It can prevent demand sleep, including conditions that normally request sleep for
low battery or thermal reasons. Do not use it inside a bag or other enclosed
space. It does not guarantee uninterrupted execution or protect against hardware
shutdown, loss of power, or a broken operating system.

Each session requires a finite duration of 1 second to 24 hours and explicit
acknowledgement that Dream Eater is the only app changing this setting during the
session. AC and battery use the same limits. There is no battery-percentage cutoff
or critical-battery-specific guard; the retained ProcessInfo thermal guard reacts
to serious and critical thermal states. The root guard also checks these conditions; the UI
check is only an early rejection.

**The helper remains installed when the timer ends.** The first approved start
installs root-owned code and a LaunchDaemon; later starts reuse/update this
installation with another administrator-authorized action. The inactive daemon
exits and has no active-session polling loop. This is a persistent helper
installation, not an administrator-free feature or a temporary assertion.

| Path                                                                  | Purpose and permissions                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/Library/PrivilegedHelperTools/com.dreameater.closedlid`             | Installed native executable, root-owned, `0755`                                                     |
| `/Library/LaunchDaemons/com.dreameater.closedlid.plist`               | Root LaunchDaemon, root-owned, `0644`                                                               |
| `/Library/PrivilegedHelperTools/com.dreameater.closedlid.status.json` | Nonsecret status summary, root-owned, `0644`                                                        |
| `/private/var/db/com.dreameater.closedlid/`                           | Private state directory, root-owned, `0700`                                                         |
| `/private/var/db/com.dreameater.closedlid/journal.json`               | Durable recovery journal, root-owned, `0600`, present while a session or unresolved recovery exists |
| `/private/var/db/com.dreameater.closedlid/lock`                       | Stable serialization lock, root-owned, `0600`                                                       |

No sudoers rule, stored password, login item, kernel extension, network service,
or third-party privileged runtime is used. The native executable uses fixed
system command paths and arguments.

## Exact authorization boundary

The client calculates SHA-256 of the locally built helper before opening the
administrator dialog. The authorized shell checks that `/`, `/Library` and
`/Library/PrivilegedHelperTools` are root-owned directories without writable group
or other permissions or extended ACL entries. It creates a root-owned random file matching
`/Library/PrivilegedHelperTools/.com.dreameater.closedlid-stage.XXXXXXXX`, copies the
helper there, verifies the pinned SHA-256, and then executes that immutable copy
with a clean environment:

```text
<verified-root-staging-file> install-start <duration-seconds> <owner-uid> <32-hex-request-id>
```

The temporary staging file is removed on shell exit. A source change during the
administrator prompt fails the hash check before the copied helper executes.
The approved trust boundary is still the reviewed native helper's exact compiled
bytes plus the small static bootstrap shell. This is a local development build,
not a separately audited, notarized installer.

The helper creates the fixed paths above and loads only its named service:

```sh
/bin/launchctl bootstrap system /Library/LaunchDaemons/com.dreameater.closedlid.plist
```

It waits for the recovery guard to acknowledge readiness, then durably records
intent before issuing the only enable command:

```sh
/usr/bin/pmset -a disablesleep 1
```

`-a` does not make this setting source-specific. Apple implements `disablesleep`
as one global setting. The current design allows starts on AC or battery and does
not restore merely because the charger is disconnected. The override can interfere
with normal low-battery and thermal sleep requests; it does not provide a battery
emergency safeguard.

## Saved and live state compatibility

The parser distinguishes a missing `SleepDisabled` key from a missing saved-settings dictionary. When macOS successfully reports a recognizable global settings dictionary, an absent key has the default false value. Likewise, an absent live property in a successfully copied root-domain property snapshot uses the kernel default false. Failed reads, malformed data and an entirely absent persisted global settings dictionary remain unknown.

Consequently, some untouched Macs may refuse activation even when no app has enabled this setting. The helper does not turn unknown saved state into zero, initialize it with a power-setting write or bypass the verified-baseline requirement. Support for an absent `/Library/PrivilegedHelperTools` directory addresses only the installation path: the authorized bootstrap can create and validate that directory. It does not promise activation on every clean Mac. Candidate native behavior on these clean-state combinations remains unverified.

## Ownership and restoration

Start is refused unless both saved and live settings are unambiguously `0`.
Pre-existing `1` is never adopted as a Dream Eater session. Every privileged
state-changing operation takes the same root-owned lock; inspection is lock-free; a stop request must match the current journal's request
ID. The deadline uses continuous monotonic time and the journal records the boot
identity. A restarted guard restores an interrupted owned session instead of
restarting its timer.

For an owned session, expiry, Stop, interrupted execution or a serious/critical
thermal observation requests restoration using:

```sh
/usr/bin/pmset -a disablesleep 0
```

A command returning zero is not sufficient. Both `pmset -g` (saved preferences)
and the `SleepDisabled` property of `IOPMrootDomain` must confirm zero before the
recovery journal is retired. Failed or uncertain rollback keeps the recovery
journal and guard. It must be shown as recovery required, not Off.

An observed external change to zero relinquishes ownership. Dream Eater never
re-enables the setting or subsequently overwrites a new external one. The setting
does not expose an owner, generation number, or compare-and-swap operation:
another app writing the same `1`, or a `0 → 1` cycle between observations, cannot
be detected. **No wrapper can guarantee both automatic rollback and perfect
coexistence with uncoordinated writers.** Exclusive use is therefore a requirement,
not a claim that the code can establish ownership from a boolean.

Restart recovery cannot run before macOS starts the LaunchDaemon. It also cannot
run if the service has been administratively disabled, the executable is removed,
the journal is corrupt, storage fails, or the OS cannot run processes. Status
verification is evidence of the software setting and guard. The previous helper build’s short native
lid test demonstrates only the observed interval and configuration; it does not
establish every workload, power/display configuration, or recovery condition.

## Review and manual recovery commands

Read-only inspection (no administrator password):

```sh
./assets/closed-lid-helper inspect
/usr/bin/pmset -g
/usr/sbin/ioreg -r -c IOPMrootDomain -a
/bin/launchctl print system/com.dreameater.closedlid
```

The owned restore command, after explicit administrator approval, is:

```sh
sudo /Library/PrivilegedHelperTools/com.dreameater.closedlid stop <request-id-from-inspect>
```

This command verifies the matching private journal. It is not equivalent to
blindly writing zero. If status is uncertain, open the lid, ensure adequate charge, and inspect before
choosing an action. Retain the journal if rollback fails.

If there is no valid owned journal, an operator who has established that no other
app needs the switch can explicitly override the global setting:

```sh
sudo /usr/bin/pmset -a disablesleep 0
```

That last command is a deliberate global override, **not** an automatic Dream
Eater recovery action. Do not use `pmset restoredefaults`: it would change unrelated
power preferences.

The helper also requests restoration when macOS reports a serious or critical
thermal state. These Foundation notifications are a best-effort guard, not a
replacement for system emergency sleep protections. Thermal notifications wake
the guard; a periodic saved-setting audit uses a maximum
two-second intentional wait, shortened to the remaining lease deadline. There is
no polling loop when the installed helper has no journal.

The timer is not a real-time guarantee: each system command has a five-second
timeout, waiting for another owned operation's lock is bounded at twenty seconds,
and several verification attempts may be needed. Activation has a fifteen-second
guard handshake. OS scheduling, storage stalls, command failures, and repeated
recovery can add delay beyond the displayed deadline. The journal is retained
when restoration cannot be confirmed. A mixed saved/live value after active mode
is treated as conflicting evidence; ownership is relinquished and further writes
stop. Such a conflict needs manual review rather than an unconditional rollback.

## Uninstallation

First restore any owned session and verify the saved and live values. Unloading
the only recovery service while an owned journal remains would remove the
crash/reboot recovery mechanism. Do not delete the journal to make an error go
away.

After read-only inspection confirms trusted installed code, no remaining owned
session, and saved/live zero, the explicitly authorized uninstall command is:

```sh
sudo /Library/PrivilegedHelperTools/com.dreameater.closedlid uninstall
```

The native command takes the same stable lock as start and stop. It refuses any
remaining journal, unknown settings, or a nonzero saved/live value. It unloads
only `system/com.dreameater.closedlid`, then removes its trusted executable,
LaunchDaemon plist, and public summary. A failed unload retains the files. It
never changes a power setting. The private state directory and empty stable lock
file deliberately remain, so waiting or future authorized operations cannot
acquire a different lock inode. Do not manually remove that lock while another
operation could be waiting on it.

A simultaneous separately authorized start can run after uninstall releases the
lock and install again; serialization preserves the order of those authorized
operations. Uninstall does not revoke another administrator's authority.

## Primary sources

- [Apple's pmset implementation](https://github.com/apple-oss-distributions/PowerManagement/blob/main/pmset/pmset.m):
  `system_power_settings`, parsing `disablesleep`, and `show_system_power_settings`.
- [Apple's IOPM preference implementation](https://github.com/apple-oss-distributions/IOKitUser/blob/main/pwr_mgt.subproj/IOPMEnergyPrefs.c):
  `IOPMSetSystemPowerSetting` writes persistent host-wide preferences and requires root.
- [Apple's powerd settings application](https://github.com/apple-oss-distributions/PowerManagement/blob/main/pmconfigd/PMSettings.m):
  saved preferences are applied to `IOPMrootDomain` at initialization and on change.
- [Apple's kernel sleep checks](https://github.com/apple-oss-distributions/xnu/blob/main/iokit/Kernel/IOPMrootDomain.cpp):
  `checkSystemSleepAllowed` and `userDisabledAllSleep`.
- [Apple's LaunchDaemon lifecycle](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html).

The local macOS `pmset(1)`, `launchctl(1)`, and `launchd.plist(5)` manual pages were
also inspected. `launchctl print` is diagnostic text and should not be treated as
a stable machine-readable status API.
