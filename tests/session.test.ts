import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { hasRequiredAssertions, parseProcessInfo, SessionManager } from "../src/session";

const exec = promisify(execFile);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const assertionsFor = (pid: number) => `
   pid ${pid}(caffeinate): [0x1234] 00:00:01 PreventUserIdleSystemSleep named: "caffeinate command-line tool"
   pid ${pid}(caffeinate): [0x1235] 00:00:01 PreventUserIdleDisplaySleep named: "caffeinate command-line tool"
`;

test("parses process identity without substring-PID matching", () => {
  assert.deepEqual(parseProcessInfo("  123 42 /bin/bash /a path/session.sh 123abc\n"), {
    pid: 123,
    parentPid: 42,
    command: "/bin/bash /a path/session.sh 123abc",
  });
  assert.equal(parseProcessInfo(""), null);
});

test("On requires this process's actual intended assertion types", () => {
  assert.equal(hasRequiredAssertions(assertionsFor(123), 123, true), true);
  assert.equal(
    hasRequiredAssertions(assertionsFor(123).replaceAll("Sleep named:", "Sleep (timed out) named:"), 123, true),
    false,
  );
  assert.equal(
    hasRequiredAssertions(assertionsFor(123).replaceAll("Sleep named:", "Sleep (Suspended) named:"), 123, true),
    false,
  );
  assert.equal(hasRequiredAssertions(assertionsFor(1234), 123, true), false);
  assert.equal(hasRequiredAssertions(assertionsFor(123).replaceAll("caffeinate", "another-app"), 123, true), false);
  const onlySystem = assertionsFor(123)
    .split("\n")
    .filter((line) => !line.includes("DisplaySleep"))
    .join("\n");
  assert.equal(hasRequiredAssertions(onlySystem, 123, false), true);
  assert.equal(hasRequiredAssertions(onlySystem, 123, true), false);
});

test("refuses to run on a non-Mac", async () => {
  const manager = new SessionManager({ supportPath: "/unused", scriptPath: "/unused", platform: "linux" });
  await assert.rejects(manager.status(), /only runs on macOS/);
  await assert.rejects(manager.start(5, true), /only runs on macOS/);
  await assert.rejects(manager.stop(), /only runs on macOS/);
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dream-eater-test-"));
  const root = path.join(directory, "support with spaces");
  const fake = path.join(directory, "fake-caffeinate");
  const script = path.join(directory, "session.sh");
  const productionScript = await fs.readFile(path.resolve("assets/session.sh"), "utf8");
  await fs.writeFile(script, productionScript.replace("/usr/bin/caffeinate", `"${fake}"`));
  // This test double never creates a power assertion or modifies macOS.
  await fs.writeFile(
    fake,
    `#!/bin/bash\nwatched=0\nseconds=0\nwhile [ $# -gt 0 ]; do\n case "$1" in -w) watched=$2; shift ;; -t) seconds=$2; shift ;; esac\n shift\ndone\nend=$(( $(date +%s) + seconds ))\nwhile kill -0 "$watched" 2>/dev/null; do\n case "$(ps -p "$watched" -o stat=)" in Z*|'') exit 0 ;; esac\n [ "$seconds" -eq 0 ] || [ "$(date +%s)" -lt "$end" ] || exit 0\n sleep 0.05\ndone\n`,
    { mode: 0o700 },
  );
  const inspect = async (pid: number) => {
    try {
      const { stdout } = await exec("/bin/ps", ["-p", String(pid), "-o", "pid=", "-o", "ppid=", "-o", "command="]);
      const result = parseProcessInfo(stdout);
      if (result) result.command = result.command.replace(`/bin/bash ${fake}`, "/usr/bin/caffeinate");
      return result;
    } catch (error) {
      if ((error as { code?: number }).code === 1) return null;
      throw error;
    }
  };
  const assertions = async () => {
    let text = "";
    for (const id of await fs.readdir(path.join(root, "sessions")).catch(() => [])) {
      try {
        const pid = Number((await fs.readFile(path.join(root, "sessions", id, "ready"), "utf8")).trim());
        if ((await inspect(pid))?.command.startsWith("/usr/bin/caffeinate ")) text += assertionsFor(pid);
      } catch {
        /* An uncommitted session may have no ready file. */
      }
    }
    return text;
  };
  const manager = new SessionManager({
    supportPath: root,
    scriptPath: script,
    platform: "darwin",
    inspect,
    assertions,
  });
  const cleanup = async () => {
    // Stop markers wake each test helper; remove the active pointer as an extra
    // fallback for any concurrent launch that is no longer the current session.
    for (const id of await fs.readdir(path.join(root, "sessions")).catch(() => [])) {
      await fs.writeFile(path.join(root, "sessions", id, "stop"), "stop\n");
      const fifo = path.join(root, "sessions", id, "control");
      try {
        const { constants } = await import("node:fs");
        const handle = await fs.open(fifo, constants.O_RDWR | constants.O_NONBLOCK);
        await handle.write(`${id}\n`);
        await handle.close();
      } catch {
        /* A failed launch may not have a FIFO. */
      }
    }
    await delay(200);
    await fs.rm(directory, { recursive: true, force: true });
  };
  return { manager, root, script, inspect, assertions, cleanup };
}

test("owned lifecycle survives reopening and disables without process signals", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.manager.status()).state, "off");
    const started = await f.manager.start(null, true);
    assert.equal(started.state, "on");
    const reopened = new SessionManager({
      supportPath: f.root,
      scriptPath: f.script,
      platform: "darwin",
      inspect: f.inspect,
      assertions: f.assertions,
    });
    assert.equal((await reopened.status()).state, "on");
    assert.equal((await reopened.stop()).state, "off");
    assert.equal((await f.manager.stop()).state, "off");
  } finally {
    await f.cleanup();
  }
});

test("timed session expires even without further manager calls", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.manager.start(1, false)).state, "on");
    await delay(2300);
    assert.equal((await f.manager.status()).state, "off");
  } finally {
    await f.cleanup();
  }
});

test("a replacement cancels the old helper and uses the new timer", async () => {
  const f = await fixture();
  try {
    const first = await f.manager.start(null, false);
    const second = await f.manager.start(60, true);
    assert.equal(first.state, "on");
    assert.equal(second.state, "on");
    assert.notEqual(first.session.id, second.session.id);
    await delay(200);
    assert.equal((await f.inspect(first.session.guardianPid))?.command.includes(first.session.id) ?? false, false);
    assert.equal(second.session.keepDisplayAwake, true);
    assert.equal((await f.manager.stop()).state, "off");
  } finally {
    await f.cleanup();
  }
});

test("concurrent starts settle on one owned session", async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.manager.start(60, true), f.manager.start(90, false)]);
    assert.ok(results.some((result) => result.status === "fulfilled"));
    assert.equal((await f.manager.status()).state, "on");
    assert.equal((await f.manager.stop()).state, "off");
  } finally {
    await f.cleanup();
  }
});

test("reused guardian PID never reports someone else's process as On", async () => {
  const f = await fixture();
  try {
    const started = await f.manager.start(60, true);
    assert.notEqual(started.state, "off");
    if (started.state === "off") return;
    const changed = { ...started.session, guardianPid: process.pid };
    await fs.writeFile(path.join(f.root, "sessions", changed.id, "session.json"), JSON.stringify(changed));
    assert.equal((await f.manager.status()).state, "off");
    await f.manager.stop();
    // If the manager had sent a signal to the stale/reused PID, this test
    // runner would have been terminated. It only writes session stop files.
    assert.equal(process.kill(process.pid, 0), true);
  } finally {
    await f.cleanup();
  }
});

test("malformed active state is an error, not a false Off", async () => {
  const f = await fixture();
  try {
    await fs.mkdir(f.root, { recursive: true });
    await fs.writeFile(path.join(f.root, "active"), "../../elsewhere\n");
    await assert.rejects(f.manager.status(), /damaged/);
  } finally {
    await f.cleanup();
  }
});

test("delayed concurrent commit cannot report Off while an older assertion remains", async () => {
  const f = await fixture();
  try {
    const late = new SessionManager({
      supportPath: f.root,
      scriptPath: f.script,
      platform: "darwin",
      inspect: f.inspect,
      assertions: f.assertions,
    });
    // Controlled interleaving: B captures an empty previous pointer, then A
    // commits, then B commits. This reproduced a false-Off bug during review.
    const seam = late as unknown as { currentId: () => Promise<string | null> };
    const originalRead = seam.currentId.bind(late);
    let release!: () => void;
    let captured!: () => void;
    const ready = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    seam.currentId = async () => {
      const value = await originalRead();
      if (first) {
        first = false;
        captured();
        await gate;
      }
      return value;
    };
    const pending = late.start(60, true);
    await ready;
    const early = await f.manager.start(60, true);
    assert.equal(early.state, "on");
    const earlyPid = early.assertionPid!;
    release();
    assert.equal((await pending).state, "on");
    assert.equal((await late.stop()).state, "off");
    assert.equal((await f.inspect(earlyPid))?.command.startsWith("/usr/bin/caffeinate ") ?? false, false);
  } finally {
    await f.cleanup();
  }
});
