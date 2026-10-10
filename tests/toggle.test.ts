import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { CLOSED_LID_MAX_SECONDS, type ClosedLidStatus } from "../src/closed-lid";
import * as duration from "../src/duration";

const off: ClosedLidStatus = {
  state: "off",
  message: "Normal sleep is enabled",
  expiresAt: null,
  sleepDisabled: 0,
  acPower: true,
  requestId: null,
  installed: false,
};

interface FixtureOptions {
  closed?: Partial<ClosedLidStatus>;
  idle?: "off" | "on" | Error;
  approved?: boolean;
  startError?: Error;
  stopped?: Partial<ClosedLidStatus>;
  unsupported?: boolean;
}

/** Execute the actual command entry point with every external boundary inert.
 * Unlisted imports fail instead of loading Raycast, controllers or native code. */
function fixture(options: FixtureOptions = {}) {
  const calls: string[] = [];
  const messages: string[] = [];
  const alerts: { title: string; message: string }[] = [];
  const starts: { seconds: number; acknowledged: boolean }[] = [];
  let preferenceReads = 0;
  let ordinaryStarts = 0;
  const modules: Record<string, unknown> = {
    "@raycast/api": {
      Alert: { ActionStyle: { Destructive: "destructive" } },
      confirmAlert: async (alert: { title: string; message: string }) => {
        calls.push("confirm");
        alerts.push(alert);
        return options.approved ?? true;
      },
      getPreferenceValues: () => {
        preferenceReads++;
        throw new Error("Preferences must not select an ordinary idle-sleep fallback");
      },
      showHUD: async (message: string) => {
        calls.push("hud");
        messages.push(message);
      },
    },
    "./duration": duration,
    "./closed-lid": { CLOSED_LID_MAX_SECONDS },
    "./controllers": {
      idleManager: {
        status: async () => {
          calls.push("idle.status");
          if (options.idle instanceof Error) throw options.idle;
          return { state: options.idle ?? "off" };
        },
        start: async () => {
          ordinaryStarts++;
          throw new Error("Ordinary idle-sleep start is no longer a command path");
        },
        stop: async () => {
          calls.push("idle.stop");
          return { state: "off" };
        },
      },
      closedLidManager: {
        assertStartSupported: () => {
          if (options.unsupported) throw new Error("New sessions require Apple Silicon and macOS 26 or later");
        },
        status: async () => {
          calls.push("closed.status");
          return { ...off, ...options.closed };
        },
        start: async (seconds: number, acknowledged: boolean) => {
          calls.push("closed.start");
          starts.push({ seconds, acknowledged });
          if (options.startError) throw options.startError;
          return { ...off, state: "on", message: "Closed-lid setting verified" };
        },
        stop: async () => {
          calls.push("closed.stop");
          return { ...off, ...options.stopped };
        },
      },
      refreshStatusCommand: async () => {
        calls.push("refresh");
      },
    },
  };
  return {
    calls,
    messages,
    alerts,
    starts,
    async invoke(command: "dream-eater" | "set-duration", fields: Partial<duration.DurationFields> = {}) {
      const code = ts.transpileModule(readFileSync(`src/${command}.tsx`, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const exported = {} as { default: (props: { arguments: Partial<duration.DurationFields> }) => Promise<void> };
      new Function("require", "exports", code)((name: string) => {
        assert.ok(Object.hasOwn(modules, name), `Unexpected unstubbed import: ${name}`);
        return modules[name];
      }, exported);
      await exported.default({ arguments: fields });
      assert.equal(preferenceReads, 0, "Command behavior must not depend on removed preferences");
      assert.equal(ordinaryStarts, 0, "Commands must never fall back to ordinary idle-sleep protection");
    },
  };
}

test("Toggle enables closed-lid protection for one hour after confirmation by default", async () => {
  const f = fixture();
  await f.invoke("dream-eater");
  assert.deepEqual(f.starts, [{ seconds: 3600, acknowledged: true }]);
  assert.equal(f.alerts.length, 1);
  assert.match(f.alerts[0]!.title, /1h|1 hour|one hour/i);
  assert.ok(f.calls.indexOf("confirm") < f.calls.indexOf("closed.start"));
  assert.ok(f.calls.indexOf("closed.start") < f.calls.indexOf("refresh"));
  assert.match(f.messages.at(-1)!, /(?:on|enabled).*1\s*h/i);
  assert.equal(f.calls.includes("idle.stop"), false);
});

for (const state of ["on", "starting", "stopping", "recovery-required"] as const) {
  test(`owned closed-lid ${state} recovery precedes damaged idle-state inspection`, async () => {
    const f = fixture({
      closed: { state, requestId: "a".repeat(32), installed: true, sleepDisabled: null },
      idle: new Error("Session state is damaged"),
    });
    await f.invoke("dream-eater");
    assert.deepEqual(f.calls, ["closed.status", "confirm", "closed.stop", "refresh", "hud"]);
    assert.deepEqual(f.starts, []);
    assert.deepEqual(f.messages, ["Dream Eater disabled · normal sleep restored"]);
  });
}

test("cancelling owned recovery leaves the current session alone", async () => {
  const f = fixture({ closed: { state: "on", requestId: "a".repeat(32), installed: true }, approved: false });
  await f.invoke("dream-eater");
  assert.deepEqual(f.calls, ["closed.status", "confirm"]);
  assert.deepEqual(f.starts, []);
  assert.deepEqual(f.messages, []);
});

test("owned recovery cannot claim disabled before restoration is verified", async () => {
  const f = fixture({
    closed: { state: "on", requestId: "a".repeat(32), installed: true },
    stopped: { state: "recovery-required", message: "Restoration is not yet verified" },
  });
  await f.invoke("dream-eater");
  assert.ok(f.calls.includes("closed.stop"));
  assert.deepEqual(f.starts, []);
  assert.deepEqual(f.messages, ["Restoration is not yet verified"]);
});

test("Toggle cleans up a legacy idle session without also enabling closed-lid mode", async () => {
  const f = fixture({ idle: "on" });
  await f.invoke("dream-eater");
  assert.ok(f.calls.includes("idle.stop"));
  assert.deepEqual(f.starts, []);
  assert.equal(f.alerts.length, 0);
  assert.deepEqual(f.messages, ["Dream Eater disabled"]);
});

for (const command of ["dream-eater", "set-duration"] as const) {
  test(`${command} rejects unsupported new starts before confirmation`, async () => {
    const f = fixture({ unsupported: true });
    await f.invoke(command, { seconds: "10" });
    assert.deepEqual(f.starts, []);
    assert.deepEqual(f.alerts, []);
    assert.match(f.messages.at(-1)!, /Apple Silicon.*macOS 26/i);
  });

  for (const acPower of [false, null]) {
    test(`${command} permits battery or unknown power-source diagnostics (${acPower}) with normal confirmation`, async () => {
      const f = fixture({ closed: { acPower } });
      await f.invoke(command, { minutes: "5" });
      assert.deepEqual(f.starts, [{ seconds: command === "dream-eater" ? 3600 : 300, acknowledged: true }]);
      assert.equal(f.alerts.length, 1);
      assert.match(f.messages.at(-1)!, /enabled/i);
      assert.match(f.alerts[0]!.message, /charger or battery power/);
    });
  }

  test(`${command} cancellation never starts either session type`, async () => {
    const f = fixture({ approved: false });
    await f.invoke(command, { seconds: "10" });
    assert.equal(f.alerts.length, 1);
    assert.deepEqual(f.starts, []);
    assert.deepEqual(f.messages, []);
  });

  test(`${command} reports canceled administrator authorization without claiming success`, async () => {
    const f = fixture({ startError: new Error("No successful start was confirmed: User canceled (-128)") });
    await f.invoke(command, { seconds: "10" });
    assert.equal(f.starts.length, 1);
    assert.deepEqual(f.messages, ["No successful start was confirmed: User canceled (-128)"]);
    assert.ok(f.calls.indexOf("closed.start") < f.calls.indexOf("refresh"));
  });

  test(`${command} leaves an unowned global sleep setting unchanged`, async () => {
    const f = fixture({ closed: { state: "conflict", sleepDisabled: 1, message: "Another app owns the setting" } });
    await f.invoke(command, { seconds: "10" });
    assert.deepEqual(f.starts, []);
    assert.equal(f.calls.includes("closed.stop"), false);
    assert.equal(f.alerts.length, 0);
    assert.deepEqual(f.messages, ["Another app owns the setting"]);
  });
}

test("Toggle preserves owned recovery on unsupported hosts", async () => {
  const f = fixture({
    unsupported: true,
    closed: { state: "recovery-required", requestId: "a".repeat(32), installed: true },
  });
  await f.invoke("dream-eater");
  assert.ok(f.calls.includes("closed.stop"));
  assert.deepEqual(f.starts, []);
  assert.deepEqual(f.messages, ["Dream Eater disabled · normal sleep restored"]);
});

test("Toggle preserves legacy cleanup on unsupported hosts", async () => {
  const f = fixture({ unsupported: true, idle: "on" });
  await f.invoke("dream-eater");
  assert.ok(f.calls.includes("idle.stop"));
  assert.deepEqual(f.starts, []);
  assert.deepEqual(f.alerts, []);
  assert.deepEqual(f.messages, ["Dream Eater disabled"]);
});

for (const [fields, seconds] of [
  [{ hours: "1", minutes: "2", seconds: "3" }, 3723],
  [{ seconds: "1" }, 1],
  [{ hours: "24" }, 86400],
] as const) {
  test(`inline duration enables closed-lid mode for ${seconds} seconds`, async () => {
    const f = fixture();
    await f.invoke("set-duration", fields);
    assert.deepEqual(f.starts, [{ seconds, acknowledged: true }]);
    assert.equal(f.alerts.length, 1);
    assert.ok(f.calls.indexOf("confirm") < f.calls.indexOf("closed.start"));
    assert.match(f.messages.at(-1)!, /on|enabled/i);
  });
}

for (const fields of [{}, { seconds: "0" }, { hours: "24", seconds: "1" }]) {
  test(`inline duration refuses blank, zero or over-24-hour input: ${JSON.stringify(fields)}`, async () => {
    const f = fixture();
    await f.invoke("set-duration", fields);
    assert.deepEqual(f.starts, []);
    assert.equal(f.alerts.length, 0);
    assert.match(f.messages.at(-1)!, /duration|1 second|24 hours/i);
    assert.doesNotMatch(f.messages.at(-1)!, /no time limit|until disabled/i);
  });
}

test("inline duration cannot replace an owned closed-lid session", async () => {
  const f = fixture({ closed: { state: "on", requestId: "a".repeat(32), installed: true, sleepDisabled: 1 } });
  await f.invoke("set-duration", { minutes: "5" });
  assert.deepEqual(f.starts, []);
  assert.equal(f.alerts.length, 0);
  assert.match(f.messages.at(-1)!, /Toggle.*restore/i);
});

test("inline duration cannot overlap a legacy idle session", async () => {
  const f = fixture({ idle: "on" });
  await f.invoke("set-duration", { minutes: "5" });
  assert.deepEqual(f.starts, []);
  assert.equal(f.alerts.length, 0);
  assert.match(f.messages.at(-1)!, /Toggle.*stop/i);
});
