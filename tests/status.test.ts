import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import type { ClosedLidStatus } from "../src/closed-lid";
import type { AwakeStatus } from "../src/session";

const closedOff: ClosedLidStatus = {
  state: "off",
  message: "Normal sleep is enabled",
  expiresAt: null,
  sleepDisabled: 0,
  acPower: true,
  requestId: null,
  installed: false,
};

const idleOn: AwakeStatus = {
  state: "on",
  session: {
    version: 1,
    id: "b".repeat(32),
    guardianPid: 101,
    createdAt: 1000,
    expiresAt: null,
    keepDisplayAwake: true,
  },
  assertionPid: 102,
};

/** Run the real status entry point; no native command or Raycast API is loaded. */
async function invoke(
  options: {
    closed?: Partial<ClosedLidStatus> | Error;
    idle?: AwakeStatus | Error;
    background?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const subtitles: string[] = [];
  const messages: string[] = [];
  const modules: Record<string, unknown> = {
    "@raycast/api": {
      environment: { launchType: options.background ? "background" : "userInitiated" },
      LaunchType: { UserInitiated: "userInitiated", Background: "background" },
      updateCommandMetadata: async ({ subtitle }: { subtitle: string }) => {
        calls.push("metadata");
        subtitles.push(subtitle);
      },
      showHUD: async (message: string) => {
        calls.push("hud");
        messages.push(message);
      },
    },
    "./controllers": {
      idleManager: {
        status: async () => {
          calls.push("idle.status");
          if (options.idle instanceof Error) throw options.idle;
          return options.idle ?? { state: "off" };
        },
      },
      closedLidManager: {
        status: async () => {
          calls.push("closed.status");
          if (options.closed instanceof Error) throw options.closed;
          return { ...closedOff, ...options.closed };
        },
      },
    },
  };
  const code = ts.transpileModule(readFileSync("src/status.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported = {} as { default: () => Promise<void> };
  new Function("require", "exports", code)((name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected unstubbed import: ${name}`);
    return modules[name];
  }, exported);
  await exported.default();
  assert.equal(subtitles.length, 1);
  assert.match(subtitles[0]!, /^Checked .+ · /);
  assert.deepEqual(calls, ["idle.status", "closed.status", "metadata", ...(options.background ? [] : ["hud"])]);
  if (!options.background) {
    assert.equal(messages.length, 1);
    assert.ok(subtitles[0]!.endsWith(` · ${messages[0]}`));
  }
  return { subtitle: subtitles[0]!, message: messages[0], messages };
}

for (const state of ["starting", "stopping", "conflict", "recovery-required"] as const) {
  test(`damaged legacy metadata cannot hide owned ${state} recovery`, async () => {
    const result = await invoke({
      idle: new Error("Session state is damaged"),
      closed: { state, requestId: "a".repeat(32), installed: true },
    });
    assert.match(result.message!, new RegExp(`Lid-closed: ${state}`));
    assert.match(result.message!, /use Toggle to restore/);
    assert.match(result.message!, /Legacy lid-open status unavailable/);
  });
}

for (const state of ["conflict", "recovery-required"] as const) {
  test(`unowned ${state} calls for manual review rather than Toggle restoration`, async () => {
    const result = await invoke({ closed: { state, sleepDisabled: 1, installed: true } });
    assert.match(result.message!, /manual review required/);
    assert.doesNotMatch(result.message!, /Toggle|restore|^Off$/);
  });
}

test("an owned request without an installed helper cannot suggest Toggle recovery", async () => {
  const result = await invoke({ closed: { state: "recovery-required", requestId: "a".repeat(32) } });
  assert.match(result.message!, /manual review required/);
  assert.doesNotMatch(result.message!, /Toggle|restore/);
});

test("a stale request on an off setting does not suggest restoration or overall Off", async () => {
  const result = await invoke({ closed: { requestId: "a".repeat(32), installed: true } });
  assert.match(result.message!, /manual review required/);
  assert.doesNotMatch(result.message!, /Toggle|restore|^Off$/);
});

test("verified closed-lid activity remains visible when legacy inspection fails", async () => {
  const result = await invoke({
    idle: new Error("Legacy state is unreadable"),
    closed: {
      state: "on",
      expiresAt: Date.now() + 60000,
      requestId: "a".repeat(32),
      installed: true,
      sleepDisabled: 1,
    },
  });
  assert.match(result.message!, /Lid-closed setting on until/);
  assert.match(result.message!, /Legacy lid-open status unavailable/);
});

test("unreadable closed-lid state does not conceal an active legacy assertion", async () => {
  const result = await invoke({ idle: idleOn, closed: new Error("Inspection failed") });
  assert.match(result.message!, /Lid-closed status unavailable/);
  assert.match(result.message!, /Lid open on until disabled/);
});

test("closed-lid Off remains visible while failed legacy inspection prevents overall Off", async () => {
  const result = await invoke({ idle: new Error("Legacy state is unreadable") });
  assert.match(result.message!, /Lid-closed off/);
  assert.match(result.message!, /Legacy lid-open status unavailable/);
  assert.notEqual(result.message, "Off");
});

test("an unavailable result cannot become overall Off even when legacy mode is off", async () => {
  const result = await invoke({ closed: { state: "unavailable", sleepDisabled: null } });
  assert.equal(result.message, "Lid-closed status unavailable");
});

test("both read failures remain unknown and never trigger any mutation or administrator path", async () => {
  const result = await invoke({ idle: new Error("Legacy failure"), closed: new Error("Closed-lid failure") });
  assert.match(result.message!, /Lid-closed status unavailable/);
  assert.match(result.message!, /Legacy lid-open status unavailable/);
  assert.notEqual(result.message, "Off");
});

test("only two successful off observations produce overall Off", async () => {
  const result = await invoke();
  assert.equal(result.message, "Off");
});

test("background checks update dated metadata without opening a HUD", async () => {
  const result = await invoke({ background: true });
  assert.match(result.subtitle, / · Off$/);
  assert.deepEqual(result.messages, []);
});
