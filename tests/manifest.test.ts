import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const lockfile = JSON.parse(readFileSync("package-lock.json", "utf8"));

test("Dream Eater exposes three compact commands without recurring background polling", () => {
  assert.equal(manifest.name, "dream-eater");
  assert.equal(manifest.title, "Dream Eater");
  assert.deepEqual(manifest.platforms, ["macOS"]);
  assert.deepEqual(
    manifest.commands.map((command: { name: string; mode: string }) => [command.name, command.mode]),
    [
      ["dream-eater", "no-view"],
      ["set-duration", "no-view"],
      ["status", "no-view"],
    ],
  );
  for (const command of manifest.commands) {
    assert.equal(command.icon, "dream-eater.png");
    assert.equal(command.interval, undefined);
  }
  assert.deepEqual(
    manifest.commands[1].arguments.map((argument: { name: string; type: string; required: boolean }) => [
      argument.name,
      argument.type,
      argument.required,
    ]),
    [
      ["hours", "text", false],
      ["minutes", "text", false],
      ["seconds", "text", false],
    ],
  );
  assert.equal(manifest.commands[0].arguments, undefined);
  assert.ok(existsSync("src/dream-eater.tsx"));
  assert.ok(existsSync("src/set-duration.tsx"));
  assert.ok(existsSync("src/status.ts"));
  assert.equal(existsSync("src/awake.tsx"), false);
});

test("lockfile, manifest and license use the verified project identity", () => {
  assert.equal(lockfile.name, "dream-eater");
  assert.equal(lockfile.packages[""].name, "dream-eater");
  assert.equal(manifest.author, "christopher_fathallah");
  assert.match(readFileSync("LICENSE", "utf8"), /Copyright \(c\) 2026 Christopher Fathallah/);
});

test("closed-lid protection is the default command behavior without mode or display preferences", () => {
  const preferences = manifest.preferences ?? [];
  assert.equal(
    preferences.some((preference: { name: string }) => preference.name === "sleepMode"),
    false,
  );
  assert.equal(
    preferences.some((preference: { name: string }) => preference.name === "keepDisplayAwake"),
    false,
  );
  assert.match(manifest.commands[0].subtitle, /1h|1 hour|one hour/i);
  for (const command of manifest.commands.slice(0, 2)) {
    assert.doesNotMatch(command.description, /Sleep Mode|extension preferences|ordinary idle-sleep/i);
    assert.doesNotMatch(command.subtitle, /no time limit|until disabled/i);
  }
});
