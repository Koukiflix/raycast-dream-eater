import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  ClosedLidManager,
  INSTALLED_CLOSED_LID_HELPER,
  type ClosedLidStatus,
  type ClosedLidManagerOptions,
  type CommandRunner,
} from "../src/closed-lid";

const base: ClosedLidStatus = {
  state: "off",
  message: "Normal sleep is enabled",
  expiresAt: null,
  sleepDisabled: 0,
  acPower: true,
  requestId: null,
  installed: false,
};
const trusted = async () => ({ regular: true, symbolicLink: false, uid: 0, mode: 0o100755 });
const fixture = (
  initial: Partial<ClosedLidStatus> = {},
  authorize?: (args: readonly string[]) => void | Promise<void>,
  host: ClosedLidManagerOptions["host"] = { platform: "darwin", architecture: "arm64", kernelRelease: "25.0.0" },
) => {
  let current = { ...base, ...initial };
  const calls: { file: string; args: readonly string[] }[] = [];
  const run: CommandRunner = async (file, args) => {
    calls.push({ file, args });
    if (file === "/usr/bin/osascript") {
      await authorize?.(args);
      const match = args[args.length - 1]?.match(/'([a-f0-9]{32})'$/);
      const stopping = /'stop' '[a-f0-9]{32}'$/.test(args.at(-1) ?? "");
      current = {
        ...current,
        state: stopping ? "off" : "on",
        requestId: stopping ? null : (match?.[1] ?? null),
        expiresAt: stopping ? null : 61000,
        sleepDisabled: stopping ? 0 : 1,
        installed: true,
      };
      return { stdout: "", stderr: "" };
    }
    return { stdout: JSON.stringify(current), stderr: "" };
  };
  const manager = new ClosedLidManager({
    helperPath: "/tmp/Dream Eater's helper",
    run,
    stat: trusted,
    uid: 501,
    now: () => 1000,
    readHelper: async () => Buffer.from("reviewed helper bytes"),
    host,
  });
  return {
    manager,
    calls,
    set: (next: Partial<ClosedLidStatus>) => {
      current = { ...current, ...next };
    },
  };
};

test("closed-lid mode requires explicit exclusive-use acknowledgement and a finite timer", async () => {
  const f = fixture();
  await assert.rejects(f.manager.start(60, false), /exclusive/i);
  for (const duration of [0, -1, Infinity, 1.5, 86401])
    await assert.rejects(f.manager.start(duration, true), /duration|24 hours/i);
  assert.equal(f.calls.length, 0);
});

test("unsupported hosts reject starts before inspection or administrator authorization", async () => {
  for (const host of [
    { platform: "linux", architecture: "arm64", kernelRelease: "25.0.0" },
    { platform: "darwin", architecture: "x64", kernelRelease: "25.0.0" },
    { platform: "darwin", architecture: "arm64", kernelRelease: "24.6.0" },
    { platform: "darwin", architecture: "arm64", kernelRelease: "unknown" },
  ]) {
    const f = fixture({}, undefined, host);
    await assert.rejects(f.manager.start(60, true), /Apple Silicon.*macOS 26/i);
    assert.deepEqual(f.calls, [], JSON.stringify(host));
  }
});

test("unsupported hosts retain inspection and owned recovery", async () => {
  const f = fixture(
    { state: "on", requestId: "a".repeat(32), expiresAt: 61000, sleepDisabled: 1, installed: true },
    undefined,
    { platform: "darwin", architecture: "x64", kernelRelease: "24.6.0" },
  );
  assert.equal((await f.manager.status()).state, "on");
  assert.equal((await f.manager.stop()).state, "off");
  assert.equal(f.calls.filter((c) => c.file === "/usr/bin/osascript").length, 1);
});

test("pre-existing global sleep disable is never adopted or switched off", async () => {
  const f = fixture({ state: "conflict", sleepDisabled: 1, message: "Other owner" });
  await assert.rejects(f.manager.start(60, true), /Other owner|already disabled/i);
  await assert.rejects(f.manager.stop(), /owned|Dream Eater/i);
  assert.equal(f.calls.filter((c) => c.file === "/usr/bin/osascript").length, 0);
});

test("new sessions work on battery and do not gate on unavailable power-source diagnostics", async () => {
  for (const acPower of [false, null]) {
    const f = fixture({ acPower });
    assert.equal((await f.manager.start(60, true)).state, "on");
    assert.equal(f.calls.filter((c) => c.file === "/usr/bin/osascript").length, 1);
  }
});

test("battery or unknown power-source diagnostics do not invalidate an owned verified active session", async () => {
  for (const acPower of [false, null]) {
    const f = fixture({
      acPower,
      state: "on",
      requestId: "a".repeat(32),
      expiresAt: 61000,
      sleepDisabled: 1,
      installed: true,
    });
    assert.equal((await f.manager.status()).state, "on");
    assert.equal((await f.manager.stop()).state, "off");
  }
});

test("an expired active record is recovery-required, never On", async () => {
  const f = fixture({ state: "on", requestId: "a".repeat(32), expiresAt: 999, sleepDisabled: 1, installed: true });
  assert.equal((await f.manager.status()).state, "recovery-required");
});

test("malformed observations remain unavailable rather than becoming Off", async () => {
  const manager = new ClosedLidManager({
    helperPath: "/tmp/helper",
    stat: trusted,
    run: async () => ({ stdout: "broken", stderr: "" }),
  });
  assert.equal((await manager.status()).state, "unavailable");
});

test("starting quotes the helper path as one shell word and verifies committed status", async () => {
  const f = fixture();
  const result = await f.manager.start(60, true);
  assert.equal(result.state, "on");
  assert.match(result.requestId ?? "", /^[a-f0-9]{32}$/);
  const command = f.calls.find((c) => c.file === "/usr/bin/osascript")?.args.at(-1) ?? "";
  assert.match(command, /Dream Eater'"'"'s helper/);
  assert.match(command, /'install-start' '60' '501' '[a-f0-9]{32}'$/);
});

test("failed authorization cannot report successful start", async () => {
  const f = fixture({}, () => {
    throw new Error("User canceled (-128)");
  });
  await assert.rejects(f.manager.start(60, true), /canceled|confirmed/i);
  assert.equal((await f.manager.status()).state, "off");
});

test("a verified idle installed helper can start a new session", async () => {
  const f = fixture({ installed: true });
  assert.equal((await f.manager.start(60, true)).state, "on");
});

test("concurrent starts serialize and cannot silently replace a committed timer", async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.manager.start(60, true), f.manager.start(60, true)]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(f.calls.filter((c) => c.file === "/usr/bin/osascript").length, 1);
});

test("stop requires the matching root-installed helper and leaves untrusted files alone", async () => {
  const f = fixture({ state: "on", requestId: "a".repeat(32), expiresAt: 61000, sleepDisabled: 1, installed: true });
  const manager = new ClosedLidManager({
    helperPath: "/tmp/helper",
    uid: 501,
    now: () => 1000,
    run: async () => ({ stdout: JSON.stringify(await f.manager.status()), stderr: "" }),
    stat: async (path) => ({
      regular: true,
      symbolicLink: false,
      uid: path.startsWith("/Library/") ? 501 : 0,
      mode: 0o100755,
    }),
  });
  await assert.rejects(manager.stop(), /trusted|root-owned/i);
});

test("successful stop verifies dual-zero status while retaining the inactive installation", async () => {
  const f = fixture({ state: "on", requestId: "a".repeat(32), expiresAt: 61000, sleepDisabled: 1, installed: true });
  const result = await f.manager.stop();
  assert.equal(result.state, "off");
  assert.equal(result.sleepDisabled, 0);
  assert.equal(result.requestId, null);
  assert.equal(result.installed, true);
  assert.match(
    f.calls.find((c) => c.file === "/usr/bin/osascript")?.args.at(-1) ?? "",
    /'stop' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'$/,
  );
});

test("uncertain observed power state preserves the owned recovery stop action", async () => {
  const f = fixture({
    state: "recovery-required",
    requestId: "b".repeat(32),
    expiresAt: 61000,
    sleepDisabled: null,
    installed: true,
  });
  assert.equal((await f.manager.stop()).state, "off");
});

test("authorization failure after commit is reconciled against the durable request", async () => {
  const f = fixture({}, (args) => {
    const requestId = args.at(-1)?.match(/'([a-f0-9]{32})'$/)?.[1] ?? null;
    f.set({ state: "on", requestId, expiresAt: 61000, sleepDisabled: 1, installed: true });
    throw new Error("Authorization client timed out after commit");
  });
  assert.equal((await f.manager.start(60, true)).state, "on");
});

test("helper hash mismatch cannot be mistaken for a committed start", async () => {
  const f = fixture({}, () => {
    throw new Error("Dream Eater helper changed during authorization; nothing was installed.");
  });
  await assert.rejects(f.manager.start(60, true), /helper changed/);
  assert.equal((await f.manager.status()).state, "off");
});

test("a deleted bundled asset uses the installed helper for inspection and owned recovery", async () => {
  let current: ClosedLidStatus = {
    ...base,
    state: "on",
    requestId: "c".repeat(32),
    expiresAt: 61000,
    sleepDisabled: 1,
    installed: true,
  };
  const calls: string[] = [];
  const manager = new ClosedLidManager({
    helperPath: "/missing/bundled/helper",
    now: () => 1000,
    stat: async (file) => (file === INSTALLED_CLOSED_LID_HELPER ? trusted() : null),
    run: async (file) => {
      calls.push(file);
      if (file === "/usr/bin/osascript") current = { ...base, installed: true };
      return { stdout: JSON.stringify(current), stderr: "" };
    },
  });
  assert.equal((await manager.status()).state, "on");
  assert.equal((await manager.stop()).state, "off");
  assert.equal(calls[0], "/bin/sh");
  assert.ok(calls.includes(INSTALLED_CLOSED_LID_HELPER));
  assert.ok(calls.includes("/usr/bin/osascript"));
});

test("an installed helper is inspected before a corrupt bundled asset can run", async () => {
  const calls: string[] = [];
  const manager = new ClosedLidManager({
    helperPath: "/broken/asset",
    stat: trusted,
    run: async (file) => {
      calls.push(file);
      if (file === "/broken/asset") throw new Error("Invalid executable");
      return { stdout: JSON.stringify(base), stderr: "" };
    },
  });
  assert.equal((await manager.status()).state, "off");
  assert.ok(!calls.includes("/broken/asset"));
});

test("an installed helper under an ACL-writable path is never executed", async () => {
  const calls: string[] = [];
  const manager = new ClosedLidManager({
    helperPath: "/tmp/helper",
    stat: trusted,
    run: async (file) => {
      calls.push(file);
      if (file === "/bin/sh") throw new Error("Dream Eater refuses an extended ACL on a trusted path");
      return { stdout: JSON.stringify(base), stderr: "" };
    },
  });
  assert.equal((await manager.status()).state, "unavailable");
  assert.deepEqual(calls, ["/bin/sh"]);
});

test(
  "privileged bootstrap is valid shell and rejects ACLs before staging or execution",
  { skip: process.platform !== "darwin" },
  async () => {
    const f = fixture();
    await f.manager.start(60, true);
    const command = f.calls.find((c) => c.file === "/usr/bin/osascript")?.args.at(-1) ?? "";
    assert.equal(spawnSync("/bin/sh", ["-n"], { input: command }).status, 0);
    const preamble = command.slice(0, command.indexOf("\nstaged="));
    const fakeACL =
      "mock_ls() { /usr/bin/printf '%s\\n' 'drwxr-xr-x+ root wheel trusted' ' 0: user:attacker allow add_file'; }\n";
    const rejected = spawnSync("/bin/sh", ["-c", fakeACL + preamble.replaceAll("/bin/ls", "mock_ls")], {
      encoding: "utf8",
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /extended ACL/);
    // This ran only the read-only trust checks, never the staging/install suffix.
  },
);
