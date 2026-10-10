import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { release } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const CLOSED_LID_MAX_SECONDS = 24 * 60 * 60;
export const INSTALLED_CLOSED_LID_HELPER = "/Library/PrivilegedHelperTools/com.dreameater.closedlid";
const REQUEST_ID = /^[a-f0-9]{32}$/;
const STATES = new Set(["off", "on", "starting", "stopping", "conflict", "recovery-required", "unavailable"]);

export interface ClosedLidStatus {
  state: "off" | "on" | "starting" | "stopping" | "conflict" | "recovery-required" | "unavailable";
  message: string;
  expiresAt: number | null;
  sleepDisabled: 0 | 1 | null;
  acPower: boolean | null;
  requestId: string | null;
  installed: boolean;
}

interface FileInformation {
  regular: boolean;
  symbolicLink: boolean;
  uid: number;
  mode: number;
}

export type CommandRunner = (
  executable: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface ClosedLidManagerOptions {
  helperPath: string;
  run?: CommandRunner;
  stat?: (file: string) => Promise<FileInformation | null>;
  uid?: number;
  now?: () => number;
  readHelper?: () => Promise<Uint8Array>;
  host?: { platform: string; architecture: string; kernelRelease: string };
}

function unavailable(message: string): ClosedLidStatus {
  return {
    state: "unavailable",
    message,
    expiresAt: null,
    sleepDisabled: null,
    acPower: null,
    requestId: null,
    installed: false,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shellWord(value: string): string {
  if (value.includes("\0")) throw new Error("Invalid helper path");
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** ls -e prints one extra line per ACL entry; every path here is a fixed path
 * without newlines. Reject every ACL before privileged code can be loaded. */
function trustedRootPreamble(includeExecutable: boolean): string {
  return `set -eu
checkTrustedPath() {
  trustedPath=$1
  [ ! -L "$trustedPath" ] && [ "$(/usr/bin/stat -f '%u' "$trustedPath")" = 0 ] || exit 1
  mode=$(/usr/bin/stat -f '%Lp' "$trustedPath")
  [ $((0$mode & 0022)) -eq 0 ] || exit 1
  aclListing=$(/bin/ls -lde "$trustedPath") || exit 1
  case "$aclListing" in *'
'*) /bin/echo 'Dream Eater refuses an extended ACL on a trusted path.' >&2; exit 1;; esac
}
for trustedPath in '/' '/Library'; do
  [ -d "$trustedPath" ] || exit 1
  checkTrustedPath "$trustedPath"
done
${
  includeExecutable
    ? ""
    : `# Only the administrator-authorized start may create this fixed directory.
if [ ! -e /Library/PrivilegedHelperTools ] && [ ! -L /Library/PrivilegedHelperTools ]; then
  /bin/mkdir -m 0755 /Library/PrivilegedHelperTools || {
    # A concurrent creator is acceptable only after the same trust checks.
    [ -d /Library/PrivilegedHelperTools ] && [ ! -L /Library/PrivilegedHelperTools ] || exit 1
  }
fi`
}
[ -d /Library/PrivilegedHelperTools ] || exit 1
checkTrustedPath '/Library/PrivilegedHelperTools'
${
  includeExecutable
    ? `checkTrustedPath ${shellWord(INSTALLED_CLOSED_LID_HELPER)}
[ -f ${shellWord(INSTALLED_CLOSED_LID_HELPER)} ] && [ "$(/usr/bin/stat -f '%l' ${shellWord(INSTALLED_CLOSED_LID_HELPER)})" = 1 ] || exit 1`
    : ""
}`;
}

function parseStatus(stdout: string, now: number): ClosedLidStatus {
  const value: unknown = JSON.parse(stdout);
  if (!value || typeof value !== "object") throw new Error("The helper returned invalid status");
  const s = value as Partial<ClosedLidStatus>;
  if (
    !STATES.has(s.state ?? "") ||
    typeof s.message !== "string" ||
    !(s.expiresAt === null || (Number.isSafeInteger(s.expiresAt) && s.expiresAt! > 0)) ||
    ![0, 1, null].includes(s.sleepDisabled as number | null) ||
    !(s.acPower === null || typeof s.acPower === "boolean") ||
    !(s.requestId === null || (typeof s.requestId === "string" && REQUEST_ID.test(s.requestId))) ||
    typeof s.installed !== "boolean"
  )
    throw new Error("The helper returned incomplete status; sleep state is unknown");
  const status = s as ClosedLidStatus;
  if (
    status.state === "on" &&
    (status.sleepDisabled !== 1 ||
      !status.installed ||
      !status.requestId ||
      status.expiresAt === null ||
      status.expiresAt <= now)
  )
    return {
      ...status,
      state: "recovery-required",
      message: "Closed-lid protection or its timer could not be verified. Open the lid and restore the session.",
    };
  if (status.state === "off" && status.sleepDisabled !== 0) {
    return {
      ...status,
      state: status.sleepDisabled === 1 ? "conflict" : "unavailable",
      message: "Normal sleep has not been verified. Dream Eater will not change an unowned setting.",
    };
  }
  return status;
}

/**
 * Read-only inspection is the default. Only explicit start/stop calls request
 * administrator authorization. Root-side serialization and ownership checks
 * remain authoritative across Raycast processes and crashes.
 */
export class ClosedLidManager {
  private readonly helper: string;
  private readonly run: CommandRunner;
  private readonly stat: (file: string) => Promise<FileInformation | null>;
  private readonly uid: number;
  private readonly now: () => number;
  private readonly readHelper: () => Promise<Uint8Array>;
  private readonly host: NonNullable<ClosedLidManagerOptions["host"]>;
  private operations: Promise<unknown> = Promise.resolve();

  constructor(options: ClosedLidManagerOptions) {
    this.helper = options.helperPath;
    this.uid = options.uid ?? process.getuid?.() ?? -1;
    this.now = options.now ?? Date.now;
    this.readHelper = options.readHelper ?? (() => readFile(this.helper));
    this.host = options.host ?? { platform: process.platform, architecture: process.arch, kernelRelease: release() };
    this.run = options.run ?? (async (file, args, limits) => execFileAsync(file, [...args], limits));
    this.stat =
      options.stat ??
      (async (file) => {
        try {
          const info = await lstat(file);
          return { regular: info.isFile(), symbolicLink: info.isSymbolicLink(), uid: info.uid, mode: info.mode };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      });
  }

  /** Gate new starts only; inspection and owned recovery never use this gate.
   * macOS 26 is Darwin 25. The root helper independently verifies hardware/OS. */
  assertStartSupported(): void {
    const kernel = /^(\d+)\.\d+\.\d+(?:[.-].*)?$/.exec(this.host.kernelRelease);
    if (this.host.platform !== "darwin" || this.host.architecture !== "arm64" || !kernel || Number(kernel[1]) < 25) {
      throw new Error(
        "New Dream Eater sessions require an Apple Silicon Mac running macOS 26 or later. Existing owned sessions can still be restored.",
      );
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(operation, operation);
    this.operations = next.catch(() => undefined);
    return next;
  }

  async status(): Promise<ClosedLidStatus> {
    try {
      // Prefer installed recovery code: a damaged or deleted bundled asset must
      // not remove access to an already-owned session.
      const installed = await this.stat(INSTALLED_CLOSED_LID_HELPER);
      if (installed) {
        if (!installed.regular || installed.symbolicLink || installed.uid !== 0 || (installed.mode & 0o022) !== 0) {
          return unavailable("The installed closed-lid helper is not a trusted root-owned executable.");
        }
        // Read-only trust check before loading even the unprivileged inspector.
        await this.run("/bin/sh", ["-c", trustedRootPreamble(true)], { timeout: 5000, maxBuffer: 32 * 1024 });
        const { stdout } = await this.run(INSTALLED_CLOSED_LID_HELPER, ["inspect"], {
          timeout: 10000,
          maxBuffer: 128 * 1024,
        });
        return parseStatus(stdout, this.now());
      }
      const info = await this.stat(this.helper);
      if (!info?.regular || info.symbolicLink)
        return unavailable("Neither the built closed-lid helper nor an installed recovery helper is available.");
      const { stdout } = await this.run(this.helper, ["inspect"], { timeout: 10000, maxBuffer: 128 * 1024 });
      return parseStatus(stdout, this.now());
    } catch (error) {
      return unavailable(`Closed-lid status is unavailable: ${errorText(error)}`);
    }
  }

  private async authorize(command: string): Promise<void> {
    const script = `on run argv
      do shell script (item 1 of argv) with prompt "Dream Eater needs administrator permission to manage its persistent closed-lid recovery helper." with administrator privileges
    end run`;
    await this.run("/usr/bin/osascript", ["-e", script, command], { timeout: 180000, maxBuffer: 128 * 1024 });
  }

  private async installationCommand(args: readonly string[]): Promise<string> {
    const digest = createHash("sha256")
      .update(await this.readHelper())
      .digest("hex");
    // The authorized shell executes only Apple tools until it has copied and
    // verified the exact reviewed helper bytes inside a root-controlled folder.
    // A source-file swap while the administrator prompt is open fails the hash.
    return `${trustedRootPreamble(false)}
staged=$(/usr/bin/mktemp /Library/PrivilegedHelperTools/.com.dreameater.closedlid-stage.XXXXXXXX)
trap '/bin/rm -f "$staged"' EXIT
trap 'exit 130' HUP INT TERM
/bin/cat ${shellWord(this.helper)} > "$staged"
/bin/chmod 0700 "$staged"
actual=$(/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C /usr/bin/shasum -a 256 "$staged")
[ "\${actual%% *}" = ${shellWord(digest)} ] || { /bin/echo 'Dream Eater helper changed during authorization; nothing was installed.' >&2; exit 1; }
/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=/var/root LC_ALL=C "$staged" ${args.map(shellWord).join(" ")}`;
  }

  async start(durationSeconds: number, exclusiveUseAcknowledged: boolean): Promise<ClosedLidStatus> {
    this.assertStartSupported();
    if (!exclusiveUseAcknowledged)
      throw new Error("Acknowledge exclusive use: do not use another sleep-setting app during this session.");
    if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > CLOSED_LID_MAX_SECONDS) {
      throw new Error("Closed-lid mode requires a finite duration from 1 second to 24 hours.");
    }
    if (!Number.isSafeInteger(this.uid) || this.uid <= 0) throw new Error("The current user could not be identified");
    return this.serialized(async () => {
      const before = await this.status();
      if (before.state !== "off" || before.sleepDisabled !== 0 || before.requestId !== null) {
        throw new Error(before.message || "Restore the existing session before starting closed-lid mode");
      }
      const requestId = randomBytes(16).toString("hex");
      const command = await this.installationCommand([
        "install-start",
        String(durationSeconds),
        String(this.uid),
        requestId,
      ]);
      let failure: unknown;
      try {
        await this.authorize(command);
      } catch (error) {
        failure = error;
      }
      // Authorization can time out after a privileged operation has committed.
      // Inspect the durable request before deciding what happened.
      const after = await this.status();
      if (after.requestId === requestId && after.state === "on") return after;
      if (failure) throw new Error(`No successful start was confirmed: ${errorText(failure)}. ${after.message}`);
      throw new Error(`Closed-lid mode was not confirmed active. ${after.message}`);
    });
  }

  async stop(): Promise<ClosedLidStatus> {
    return this.serialized(async () => {
      const before = await this.status();
      if (before.state === "unavailable" && !before.requestId) throw new Error(before.message);
      if (!before.requestId || !before.installed)
        throw new Error("No owned Dream Eater closed-lid session was found. The global setting was left unchanged.");
      const installed = await this.stat(INSTALLED_CLOSED_LID_HELPER);
      if (!installed?.regular || installed.symbolicLink || installed.uid !== 0 || (installed.mode & 0o022) !== 0) {
        throw new Error(
          "The trusted root-owned recovery helper is missing or unsafe. Open the lid and use the documented recovery procedure.",
        );
      }
      let failure: unknown;
      try {
        await this.authorize(
          `${trustedRootPreamble(true)}
exec /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=/var/root LC_ALL=C ${[INSTALLED_CLOSED_LID_HELPER, "stop", before.requestId].map(shellWord).join(" ")}`,
        );
      } catch (error) {
        failure = error;
      }
      const after = await this.status();
      if (after.state === "off" && after.sleepDisabled === 0 && after.requestId === null) return after;
      if (failure) throw new Error(`Restoration was not confirmed: ${errorText(failure)}. ${after.message}`);
      throw new Error(`Restoration was not confirmed. ${after.message}`);
    });
  }
}
