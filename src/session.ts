import { spawn, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { MAX_DURATION_SECONDS } from "./duration";

const execFileAsync = promisify(execFile);
const ID_PATTERN = /^[a-f0-9]{32}$/;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface Session {
  version: 1;
  id: string;
  guardianPid: number;
  createdAt: number;
  expiresAt: number | null;
  keepDisplayAwake: boolean;
}

export type AwakeStatus =
  { state: "off" } | { state: "on" | "starting" | "stopping"; session: Session; assertionPid: number | null };

interface ProcessInfo {
  pid: number;
  parentPid: number;
  command: string;
}

export function parseProcessInfo(output: string): ProcessInfo | null {
  const match = output.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) return null;
  return { pid: Number(match[1]), parentPid: Number(match[2]), command: match[3]! };
}

export function hasRequiredAssertions(output: string, pid: number, keepDisplayAwake: boolean): boolean {
  const ownLines = output
    .split("\n")
    .filter(
      (line) => new RegExp(`^\\s*pid ${pid}\\(caffeinate\\):`).test(line) && !/\((timed out|suspended)\)/i.test(line),
    );
  return (
    ownLines.some((line) => /\bPreventUserIdleSystemSleep\b/.test(line)) &&
    (!keepDisplayAwake || ownLines.some((line) => /\bPreventUserIdleDisplaySleep\b/.test(line)))
  );
}

async function inspectProcess(pid: number): Promise<ProcessInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      "/bin/ps",
      ["-p", String(pid), "-o", "pid=", "-o", "ppid=", "-o", "command="],
      {
        timeout: 3000,
        maxBuffer: 64 * 1024,
      },
    );
    return parseProcessInfo(stdout);
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return null; // ps: no such process
    throw error; // A failure to inspect is not proof that the Mac is off.
  }
}

async function readAssertions(): Promise<string> {
  const { stdout } = await execFileAsync("/usr/bin/pmset", ["-g", "assertions"], {
    timeout: 3000,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

/** Injectable observations let tests exercise lifecycle logic without changing power settings. */
export interface SessionOptions {
  supportPath: string;
  scriptPath: string;
  platform?: NodeJS.Platform;
  inspect?: (pid: number) => Promise<ProcessInfo | null>;
  assertions?: () => Promise<string>;
}

export class SessionManager {
  private readonly root: string;
  private readonly script: string;
  private readonly platform: NodeJS.Platform;
  private readonly inspect: (pid: number) => Promise<ProcessInfo | null>;
  private readonly assertions: () => Promise<string>;

  constructor(options: SessionOptions) {
    this.root = options.supportPath;
    this.script = options.scriptPath;
    this.platform = options.platform ?? process.platform;
    this.inspect = options.inspect ?? inspectProcess;
    this.assertions = options.assertions ?? readAssertions;
  }

  private assertSupported(): void {
    if (this.platform !== "darwin") throw new Error("Dream Eater only runs on macOS");
  }

  private directory(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error("Invalid session identifier");
    return path.join(this.root, "sessions", id);
  }

  private async currentId(): Promise<string | null> {
    try {
      const id = (await fs.readFile(path.join(this.root, "active"), "utf8")).trim();
      if (!ID_PATTERN.test(id)) throw new Error("Session state is damaged; no power settings were changed");
      return id;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async readSession(id: string): Promise<Session | null> {
    try {
      const s: unknown = JSON.parse(await fs.readFile(path.join(this.directory(id), "session.json"), "utf8"));
      if (!s || typeof s !== "object") throw new Error("Invalid session state");
      const value = s as Partial<Session>;
      if (
        value.version !== 1 ||
        value.id !== id ||
        !Number.isSafeInteger(value.guardianPid) ||
        value.guardianPid! <= 1 ||
        typeof value.keepDisplayAwake !== "boolean" ||
        !Number.isSafeInteger(value.createdAt) ||
        !(value.expiresAt === null || (Number.isSafeInteger(value.expiresAt) && value.expiresAt! > value.createdAt!))
      ) {
        throw new Error("Session state is damaged; no processes were stopped");
      }
      return value as Session;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private commandFor(session: Session): string {
    return [
      "/bin/bash",
      this.script,
      this.root,
      session.id,
      session.expiresAt === null ? "0" : String(Math.ceil(session.expiresAt / 1000)),
      session.keepDisplayAwake ? "display" : "system",
    ].join(" ");
  }

  private async ownsGuardian(session: Session): Promise<boolean> {
    const process = await this.inspect(session.guardianPid);
    return process?.command === this.commandFor(session);
  }

  private async assertionPid(session: Session, requireParent: boolean): Promise<number | null> {
    try {
      const raw = (await fs.readFile(path.join(this.directory(session.id), "ready"), "utf8")).trim();
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) return null;
      const pid = Number(raw);
      const process = await this.inspect(pid);
      if (!process || (requireParent && process.parentPid !== session.guardianPid)) return null;
      if (!process.command.startsWith("/usr/bin/caffeinate ") || !process.command.endsWith(`-w ${session.guardianPid}`))
        return null;
      return pid;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async allSessions(): Promise<Session[]> {
    let ids: string[];
    try {
      ids = await fs.readdir(path.join(this.root, "sessions"));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const sessions: Session[] = [];
    for (const id of ids.filter((id) => ID_PATTERN.test(id))) {
      const session = await this.readSession(id);
      if (session) sessions.push(session);
    }
    return sessions;
  }

  private async describe(session: Session): Promise<AwakeStatus> {
    const guardianAlive = await this.ownsGuardian(session);
    const assertionPid = await this.assertionPid(session, guardianAlive);
    if (!guardianAlive) {
      // The OS may briefly reparent caffeinate before releasing its assertions.
      if (assertionPid && hasRequiredAssertions(await this.assertions(), assertionPid, session.keepDisplayAwake)) {
        return { state: "stopping", session, assertionPid };
      }
      return { state: "off" };
    }
    if (await exists(path.join(this.directory(session.id), "stop")))
      return { state: "stopping", session, assertionPid };
    if (assertionPid && hasRequiredAssertions(await this.assertions(), assertionPid, session.keepDisplayAwake)) {
      return { state: "on", session, assertionPid };
    }
    return { state: "starting", session, assertionPid };
  }

  async status(): Promise<AwakeStatus> {
    this.assertSupported();
    const id = await this.currentId();
    const current = id ? await this.readSession(id) : null;
    if (current) {
      const status = await this.describe(current);
      if (status.state !== "off") return status;
    }
    // Concurrent launches can leave an older guardian briefly winding down.
    // Off means all tracked assertions are gone, not just the newest process.
    for (const session of await this.allSessions()) {
      if (session.id === id) continue;
      const status = await this.describe(session);
      if (status.state !== "off") return { ...status, state: "stopping" };
      // Only confirmed-dead inactive sessions are collected. Never remove the
      // active pointer, which a newer start may already have replaced.
      await fs.rm(this.directory(session.id), { recursive: true, force: true });
    }
    return { state: "off" };
  }

  private async wake(session: Session): Promise<void> {
    let handle: fs.FileHandle | undefined;
    try {
      const fifo = path.join(this.directory(session.id), "control");
      if (!(await fs.lstat(fifo)).isFIFO()) return;
      handle = await fs.open(fifo, constants.O_RDWR | constants.O_NONBLOCK | constants.O_NOFOLLOW);
      await handle.write(`${session.id}\n`);
    } catch (error) {
      if (!isMissing(error) && !["EAGAIN", "EPIPE", "ENXIO"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        throw error;
      }
    } finally {
      await handle?.close();
    }
  }

  private async requestStop(session: Session): Promise<void> {
    const directory = this.directory(session.id);
    if (!(await exists(directory))) return;
    try {
      await fs.writeFile(path.join(directory, "stop"), "stop\n", { mode: 0o600 });
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    // The durable stop is enough. A wake-up makes ordinary stops immediate.
    await this.wake(session);
  }

  async start(durationSeconds: number | null, keepDisplayAwake: boolean): Promise<AwakeStatus> {
    this.assertSupported();
    if (
      durationSeconds !== null &&
      (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > MAX_DURATION_SECONDS)
    ) {
      throw new Error("Duration must be between 1 second and 365 days");
    }
    const previousId = await this.currentId();
    const previous = previousId ? await this.readSession(previousId) : null;
    const id = randomBytes(16).toString("hex");
    const directory = this.directory(id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await execFileAsync("/usr/bin/mkfifo", ["-m", "600", path.join(directory, "control")], { timeout: 3000 });
    const createdAt = Date.now();
    const session: Session = {
      version: 1,
      id,
      guardianPid: 0,
      createdAt,
      expiresAt: durationSeconds === null ? null : createdAt + durationSeconds * 1000,
      keepDisplayAwake,
    };
    const args = [
      this.script,
      this.root,
      id,
      session.expiresAt === null ? "0" : String(Math.ceil(session.expiresAt / 1000)),
      keepDisplayAwake ? "display" : "system",
    ];
    const child = spawn("/bin/bash", args, {
      detached: true,
      stdio: "ignore",
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" },
    });
    // Keep an error listener even after the command unrefs the detached child.
    let spawnError: Error | undefined;
    child.on("error", (error) => {
      spawnError = error;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      if (!child.pid || spawnError) throw spawnError ?? new Error("Could not start the session helper");
      session.guardianPid = child.pid;
      child.unref();
      await atomicWrite(path.join(directory, "session.json"), JSON.stringify(session));
      // Commit only after recovery metadata exists. A newer commit wins;
      // guardians that lose ownership release their assertions automatically.
      await atomicWrite(path.join(this.root, "active"), `${id}\n`);
      // Wake every known guardian after a commit, including a concurrent
      // launch that was absent from our original previous-session snapshot.
      for (const known of await this.allSessions()) await this.wake(known);
      if (previous) await this.requestStop(previous);
      const deadline = performance.now() + 6000;
      do {
        if ((await this.currentId()) !== id) throw new Error("A newer session replaced this request");
        const status = await this.status();
        if (status.state === "on" && (await this.currentId()) === id) return status;
        if (session.expiresAt !== null && Date.now() >= session.expiresAt && status.state === "off") return status;
        if (!(await this.ownsGuardian(session))) throw new Error("The keep-awake helper exited before it was ready");
        await delay(100);
      } while (performance.now() < deadline);
      throw new Error("macOS did not confirm the keep-awake assertion; this session was stopped");
    } catch (error) {
      child.unref();
      await this.requestStop(session);
      throw error;
    }
  }

  async stop(): Promise<AwakeStatus> {
    this.assertSupported();
    await this.currentId(); // Validate state even when no session is active.
    // Snapshot all existing sessions. This also cancels a superseded helper;
    // a new launch created after this snapshot is left alone.
    const sessions = await this.allSessions();
    const ids = new Set(sessions.map((session) => session.id));
    for (const session of sessions) await this.requestStop(session);
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const status = await this.status();
      if (status.state === "off" || !ids.has(status.session.id)) return status;
      await delay(100);
    }
    // Do not claim Off when the durable stop has not yet taken effect.
    return await this.status();
  }
}
