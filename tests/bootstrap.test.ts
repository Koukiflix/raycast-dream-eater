import test, { before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ClosedLidManager, INSTALLED_CLOSED_LID_HELPER, type ClosedLidStatus } from "../src/closed-lid";

type Operation = "start" | "inspect" | "stop";
type Fault = "symlink" | "dangling-symlink" | "file" | "group-writable" | "world-writable" | "non-root" | "acl";
const faults: Fault[] = ["symlink", "dangling-symlink", "file", "group-writable", "world-writable", "non-root", "acl"];
const shellWord = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
let preambles: Record<Operation, string>;

// Every Manager dependency is inert. Only the extracted trust preambles below
// are executed, with protected paths replaced by user-owned temporary fixtures.
before(async () => {
  const bundled = "/inert/bundled-helper";
  const authorized: string[] = [];
  const inspected: string[] = [];
  const off: ClosedLidStatus = {
    state: "off",
    message: "Normal sleep is enabled",
    expiresAt: null,
    sleepDisabled: 0,
    acPower: true,
    requestId: null,
    installed: false,
  };
  let current = off;
  const manager = new ClosedLidManager({
    helperPath: bundled,
    uid: 501,
    now: () => 1000,
    host: { platform: "darwin", architecture: "arm64", kernelRelease: "25.0.0" },
    readHelper: async () => Buffer.from("inert fixture, never executed"),
    stat: async (path) => {
      assert.ok(path === bundled || path === INSTALLED_CLOSED_LID_HELPER);
      return path === INSTALLED_CLOSED_LID_HELPER && !current.installed
        ? null
        : { regular: true, symbolicLink: false, uid: 0, mode: 0o100755 };
    },
    run: async (file, args) => {
      if (file === "/usr/bin/osascript") {
        const command = args.at(-1)!;
        authorized.push(command);
        const match = command.match(/'install-start' '60' '501' '([a-f0-9]{32})'$/);
        if (match) {
          assert.ok(match[1]);
          current = { ...off, state: "on", expiresAt: 61000, sleepDisabled: 1, requestId: match[1], installed: true };
        } else {
          assert.ok(current.requestId);
          assert.ok(command.endsWith(`'stop' '${current.requestId}'`));
          current = { ...off, installed: true };
        }
      } else if (file === "/bin/sh") {
        assert.equal(args.length, 2);
        assert.equal(args[0], "-c");
        assert.ok(args[1]);
        inspected.push(args[1]);
      } else {
        assert.ok(file === bundled || file === INSTALLED_CLOSED_LID_HELPER);
        assert.deepEqual(args, ["inspect"]);
      }
      return { stdout: JSON.stringify(current), stderr: "" };
    },
  });
  assert.equal((await manager.start(60, true)).state, "on");
  assert.equal((await manager.stop()).state, "off");
  assert.equal(authorized.length, 2);
  assert.ok(inspected.length > 0);
  assert.ok(inspected.every((preamble) => preamble === inspected[0]));
  const [startCommand, stopCommand] = authorized;
  const inspectCommand = inspected[0];
  assert.ok(startCommand && stopCommand && inspectCommand);
  const startBoundary = startCommand.indexOf("\nstaged=");
  const stopBoundary = stopCommand.indexOf("\nexec /usr/bin/env");
  assert.ok(startBoundary > 0 && stopBoundary > 0, "execution suffixes must be found before extraction");
  preambles = {
    start: startCommand.slice(0, startBoundary),
    inspect: inspectCommand,
    stop: stopCommand.slice(0, stopBoundary),
  };
  for (const preamble of Object.values(preambles)) {
    assert.doesNotMatch(preamble, /\bstaged=|\/usr\/bin\/env|\/usr\/bin\/osascript|\bpmset\b/);
    assert.equal(preamble.match(/'\/'/g)?.length, 1);
    assert.ok(preamble.includes("/Library/PrivilegedHelperTools"));
  }
});

interface Fixture {
  base: string;
  root: string;
  library: string;
  directory: string;
  helper: string;
  trace: string;
  nonRootPath?: string;
  aclPath?: string;
}

function fixture(t: TestContext, installed = false): Fixture {
  const base = mkdtempSync("/tmp/dream-eater-bootstrap-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root");
  const library = join(root, "Library");
  const directory = join(library, "PrivilegedHelperTools");
  const helper = join(directory, "com.dreameater.closedlid");
  for (const path of [root, library, ...(installed ? [directory] : [])]) {
    mkdirSync(path, { mode: 0o755 });
    chmodSync(path, 0o755);
  }
  if (installed) writeFileSync(helper, "inert helper: never execute", { mode: 0o755 });
  return { base, root, library, directory, helper, trace: join(base, "trace") };
}

function applyFault(f: Fixture, path: string, fault: Fault): void {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o755 });
  if (fault === "symlink") {
    renameSync(path, `${path}-target`);
    symlinkSync(`${path}-target`, path);
  } else if (fault === "dangling-symlink") {
    rmSync(path, { recursive: true });
    symlinkSync(`${path}-missing`, path);
  } else if (fault === "file") {
    rmSync(path, { recursive: true });
    writeFileSync(path, "not a directory");
  } else if (fault === "group-writable" || fault === "world-writable") {
    chmodSync(path, fault === "group-writable" ? 0o775 : 0o757);
  } else if (fault === "non-root") {
    f.nonRootPath = path;
  } else {
    f.aclPath = path;
  }
}

function runPreamble(
  f: Fixture,
  operation: Operation,
  options: { mkdirAction?: string; statFailure?: "%u" | "%Lp" | "%l"; lsFailure?: boolean } = {},
) {
  const source = preambles[operation];
  const mapped = source.replaceAll("/Library", f.library).replace("'/'", shellWord(f.root));
  // Reject any unrewritten absolute protected path before spawning a shell.
  assert.doesNotMatch(mapped, /(?:[\s'"])\/Library(?:\/|[\s'"]|$)|'\/'/);
  assert.ok(mapped.includes(shellWord(f.root)) && mapped.includes(shellWord(f.library)));
  const preamble = mapped
    .replaceAll("/usr/bin/stat", "fixture_stat")
    .replaceAll("/bin/ls", "fixture_ls")
    .replaceAll("/bin/mkdir", "fixture_mkdir");
  const allowedPaths = [f.root, f.library, f.directory, f.helper].map(shellWord).join("|");
  const mocks = `
fixture_stat() {
  [ "$#" -eq 3 ] && [ "$1" = '-f' ] || exit 89
  case "$2" in '%u'|'%Lp'|'%l') ;; *) exit 89;; esac
  case "$3" in ${allowedPaths}) ;; *) exit 89;; esac
  /usr/bin/printf 'stat:%s:%s\n' "$2" "$3" >> ${shellWord(f.trace)}
  if [ "$2" = ${shellWord(options.statFailure ?? "")} ]; then return 1; fi
  if [ "$2" = '%u' ]; then
    if [ "$3" = ${shellWord(f.nonRootPath ?? "")} ]; then /usr/bin/printf '501\n'; else /usr/bin/printf '0\n'; fi
  else /usr/bin/stat "$@"; fi
}
fixture_ls() {
  [ "$#" -eq 2 ] && [ "$1" = '-lde' ] || exit 89
  case "$2" in ${allowedPaths}) ;; *) exit 89;; esac
  /usr/bin/printf 'acl:%s\n' "$2" >> ${shellWord(f.trace)}
  ${options.lsFailure ? "return 1" : ""}
  if [ "$2" = ${shellWord(f.aclPath ?? "")} ]; then
    /usr/bin/printf '%s\n' 'drwxr-xr-x+ root wheel fixture' ' 0: user:fixture allow add_file'
  else /bin/ls "$@"; fi
}
fixture_mkdir() {
  /usr/bin/printf 'mkdir:%s\n' "$3" >> ${shellWord(f.trace)}
  [ "$#" -eq 3 ] && [ "$1" = '-m' ] && [ "$2" = '0755' ] && [ "$3" = ${shellWord(f.directory)} ] || exit 89
  ${options.mkdirAction ?? '/bin/mkdir "$@"'}
}
`;
  const result = spawnSync(
    "/bin/sh",
    ["-c", `${mocks}\numask 077\n${preamble}\n/usr/bin/printf 'trusted-preamble-complete\n'`],
    {
      encoding: "utf8",
      timeout: 5000,
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
    },
  );
  assert.ifError(result.error);
  const calls = existsSync(f.trace) ? readFileSync(f.trace, "utf8").trim().split("\n") : [];
  return { ...result, calls };
}

function assertAccepted(result: ReturnType<typeof runPreamble>): void {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "trusted-preamble-complete\n");
}

function assertRejected(result: ReturnType<typeof runPreamble>): void {
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /trusted-preamble-complete/);
}

const nativeShell = { skip: process.platform !== "darwin" };

test(
  "authorized start creates only the missing fixed directory after both parents pass trust checks",
  nativeShell,
  (t) => {
    const f = fixture(t);
    const result = runPreamble(f, "start");
    assertAccepted(result);
    assert.equal(statSync(f.directory).mode & 0o777, 0o755);
    assert.equal(statSync(f.directory).uid, process.getuid?.());
    assert.equal(existsSync(f.helper), false);
    assert.deepEqual(result.calls, [
      `stat:%u:${f.root}`,
      `stat:%Lp:${f.root}`,
      `acl:${f.root}`,
      `stat:%u:${f.library}`,
      `stat:%Lp:${f.library}`,
      `acl:${f.library}`,
      `mkdir:${f.directory}`,
      `stat:%u:${f.directory}`,
      `stat:%Lp:${f.directory}`,
      `acl:${f.directory}`,
    ]);
  },
);

test("a preexisting trusted helper directory and its contents are unchanged", nativeShell, (t) => {
  const f = fixture(t, true);
  const before = statSync(f.directory);
  const helper = readFileSync(f.helper, "utf8");
  assertAccepted(runPreamble(f, "start"));
  const after = statSync(f.directory);
  assert.deepEqual(
    [after.ino, after.mode, after.uid, after.mtimeMs],
    [before.ino, before.mode, before.uid, before.mtimeMs],
  );
  assert.equal(readFileSync(f.helper, "utf8"), helper);
  assert.doesNotMatch(readFileSync(f.trace, "utf8"), /^mkdir:/m);
});

for (const location of ["root", "library", "directory"] as const) {
  for (const fault of faults) {
    test(`start rejects ${fault} on ${location} before attempting mkdir`, nativeShell, (t) => {
      const f = fixture(t);
      applyFault(f, f[location], fault);
      const before = lstatSync(f[location]);
      const result = runPreamble(f, "start");
      assertRejected(result);
      assert.ok(result.calls.every((call) => !call.startsWith("mkdir:")));
      const after = lstatSync(f[location]);
      assert.deepEqual([after.ino, after.mode], [before.ino, before.mode]);
      if (location !== "directory") assert.equal(existsSync(f.directory), false);
    });
  }
}

test("a failed mkdir with no concurrent directory fails closed", nativeShell, (t) => {
  const f = fixture(t);
  const result = runPreamble(f, "start", { mkdirAction: "return 1" });
  assertRejected(result);
  assert.equal(existsSync(f.directory), false);
  assert.equal(result.calls.filter((call) => call.startsWith("mkdir:")).length, 1);
});

test("mkdir failure accepts a concurrent trusted directory only after revalidating it", nativeShell, (t) => {
  const f = fixture(t);
  const result = runPreamble(f, "start", { mkdirAction: '/bin/mkdir "$@"; return 1' });
  assertAccepted(result);
  assert.deepEqual(result.calls.slice(-4), [
    `mkdir:${f.directory}`,
    `stat:%u:${f.directory}`,
    `stat:%Lp:${f.directory}`,
    `acl:${f.directory}`,
  ]);
});

for (const fault of faults) {
  test(`mkdir failure rejects a concurrent ${fault} directory`, nativeShell, (t) => {
    const f = fixture(t);
    const destination = shellWord(f.directory);
    let action = `/bin/mkdir -m 0755 ${destination}`;
    if (fault === "symlink") action = `/bin/ln -s ${shellWord(f.library)} ${destination}`;
    if (fault === "dangling-symlink") action = `/bin/ln -s ${shellWord(join(f.base, "missing"))} ${destination}`;
    if (fault === "file") action = `/usr/bin/printf 'not a directory' > ${destination}`;
    if (fault === "group-writable") action += `; /bin/chmod 0775 ${destination}`;
    if (fault === "world-writable") action += `; /bin/chmod 0757 ${destination}`;
    if (fault === "non-root") f.nonRootPath = f.directory;
    if (fault === "acl") f.aclPath = f.directory;
    assertRejected(runPreamble(f, "start", { mkdirAction: `${action}; return 1` }));
  });
}

for (const outcome of ["missing", "writable", "acl"] as const) {
  test(`a successful mkdir still requires post-creation checks: ${outcome}`, nativeShell, (t) => {
    const f = fixture(t);
    if (outcome === "acl") f.aclPath = f.directory;
    const mkdirAction =
      outcome === "missing"
        ? "return 0"
        : `/bin/mkdir "$@"; ${outcome === "writable" ? `/bin/chmod 0777 ${shellWord(f.directory)};` : ""} return 0`;
    assertRejected(runPreamble(f, "start", { mkdirAction }));
  });
}

for (const failure of ["%u", "%Lp", "acl"] as const) {
  test(`failed ${failure} observation aborts before the missing directory can be created`, nativeShell, (t) => {
    const f = fixture(t);
    const result = runPreamble(f, "start", failure === "acl" ? { lsFailure: true } : { statFailure: failure });
    assertRejected(result);
    assert.equal(existsSync(f.directory), false);
    assert.ok(result.calls.every((call) => !call.startsWith("mkdir:")));
  });
}

for (const operation of ["inspect", "stop"] as const) {
  test(`${operation} never creates a missing helper directory`, nativeShell, (t) => {
    const f = fixture(t);
    const result = runPreamble(f, operation);
    assertRejected(result);
    assert.equal(existsSync(f.directory), false);
    assert.ok(result.calls.every((call) => !call.startsWith("mkdir:")));
    assert.doesNotMatch(preambles[operation], /\/bin\/mkdir/);
  });

  test(`${operation} validates an existing installed helper without changing it`, nativeShell, (t) => {
    const f = fixture(t, true);
    const before = statSync(f.helper);
    const result = runPreamble(f, operation);
    assertAccepted(result);
    const after = statSync(f.helper);
    assert.deepEqual([after.ino, after.mode, after.mtimeMs], [before.ino, before.mode, before.mtimeMs]);
    assert.ok(result.calls.includes(`stat:%l:${f.helper}`));
    assert.ok(result.calls.every((call) => !call.startsWith("mkdir:")));
  });

  test(`${operation} rejects a hard-linked installed helper`, nativeShell, (t) => {
    const f = fixture(t, true);
    linkSync(f.helper, join(f.base, "second-helper-link"));
    assert.equal(statSync(f.helper).nlink, 2);
    assertRejected(runPreamble(f, operation));
  });

  test(`${operation} rejects an unreadable helper link count`, nativeShell, (t) => {
    const f = fixture(t, true);
    assertRejected(runPreamble(f, operation, { statFailure: "%l" }));
  });
}
