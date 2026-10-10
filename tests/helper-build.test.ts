import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const script = path.resolve("scripts/build-closed-lid-helper.mjs");
const output = path.resolve("assets/closed-lid-helper");
const original = Buffer.from("previous shipped asset");
const compiled = Buffer.from("new locally compiled asset");
const identity = "com.dreameater.closedlid";

interface BuildOptions {
  nonce?: string;
  platform?: string;
  swift?: string;
  sdk?: string;
  architecture?: string;
  signingIdentifier?: string;
  fail?: "compile" | "sign" | "verify" | "self-test";
}

/** Interpret the actual build script with inert subprocess and filesystem
 * boundaries. No native compiler, signature operation or helper is executed. */
function fixture(options: BuildOptions = {}) {
  const calls: { executable: string; args: string[]; env: Record<string, string> }[] = [];
  const events: string[] = [];
  const files = new Map([[output, original]]);
  const cleaned: string[] = [];
  const tools: Record<string, string> = Object.fromEntries(
    ["swiftc", "codesign", "lipo", "vtool"].map((tool) => [tool, `/Selected Xcode.app/usr/bin/${tool}`]),
  );
  const sdkPath = "/Selected Xcode.app/SDKs/MacOSX.sdk";
  const result = (stdout = "", stderr = "", status = 0) => ({ stdout, stderr, status });
  const operation = (name: string) => {
    events.push(name);
    return name === options.fail ? result("", `simulated ${name} failure`, 1) : result();
  };
  const modules: Record<string, unknown> = {
    "node:child_process": {
      spawnSync: (executable: string, args: string[], settings: { env: Record<string, string> }) => {
        calls.push({ executable, args, env: settings.env });
        if (executable === "/usr/bin/xcrun") {
          if (args.includes("--find")) return result(`${tools[args.at(-1)!]}\n`);
          if (args.includes("--show-sdk-path")) return result(`${sdkPath}\n`);
          if (args.includes("--show-sdk-version")) return result(`${options.sdk ?? "27.0"}\n`);
        }
        if (executable === tools.swiftc) {
          if (args.includes("--version")) return result(`Apple Swift version ${options.swift ?? "6.4"}\n`);
          if (args.includes("-print-target-info")) {
            return result(JSON.stringify({ target: { triple: "arm64-apple-macosx13.0" } }));
          }
          const status = operation("compile");
          if (status.status === 0) files.set(args[args.indexOf("-o") + 1]!, compiled);
          return status;
        }
        if (executable === tools.codesign) {
          if (args.includes("--force")) return operation("sign");
          if (args.includes("--verify")) return operation("verify");
          if (args.includes("--display")) {
            return result("", `Identifier=${options.signingIdentifier ?? identity}\nSignature=adhoc\n`);
          }
        }
        if (executable === tools.lipo) return result(`${options.architecture ?? "arm64"}\n`);
        if (executable === tools.vtool) return result("platform MACOS\n    minos 13.0\n      sdk 27.0\n");
        if (files.has(executable) && args.length === 1 && args[0] === "--self-test") return operation("self-test");
        throw new Error(`Unexpected unmocked subprocess ${executable}: ${JSON.stringify(args)}`);
      },
    },
    "node:crypto": { createHash },
    "node:fs": {
      chmodSync: () => undefined,
      mkdirSync: () => undefined,
      mkdtempSync: (prefix: string) => `${prefix}${options.nonce ?? "random-A"}`,
      readFileSync: (file: string) => {
        assert.ok(files.has(file), `Unexpected file read: ${file}`);
        return files.get(file);
      },
      renameSync: (from: string, to: string) => {
        events.push("promote");
        assert.ok(files.has(from));
        files.set(to, files.get(from)!);
        files.delete(from);
      },
      rmSync: (file: string) => {
        cleaned.push(file);
        for (const existing of files.keys())
          if (existing === file || existing.startsWith(`${file}/`)) files.delete(existing);
      },
    },
    "node:os": { tmpdir: () => "/tmp/dream-eater-inert-build" },
    "node:path": path,
    "node:url": { fileURLToPath },
  };
  return {
    calls,
    events,
    files,
    cleaned,
    run() {
      const source = readFileSync(script, "utf8").replaceAll(
        "import.meta.url",
        JSON.stringify(pathToFileURL(script).href),
      );
      const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText;
      new Function("require", "exports", "process", "console", code)(
        (name: string) => {
          assert.ok(Object.hasOwn(modules, name), `Unexpected unmocked import: ${name}`);
          return modules[name];
        },
        {},
        {
          platform: options.platform ?? "darwin",
          // Even on an Intel build host, never select an x86_64 release target.
          arch: "x64",
          pid: options.nonce === "random-B" ? 999 : 123,
          argv: ["node", script, "--self-test"],
          env: { DEVELOPER_DIR: "/Selected Xcode.app" },
        },
        { log: () => undefined },
      );
    },
  };
}

test("selected tools build a fixed arm64 recovery target with stable module and signing identities", () => {
  for (const nonce of ["random-A", "random-B"]) {
    const f = fixture({ nonce });
    f.run();
    const compiler = f.calls.find((call) => call.args.includes("-o"))!;
    assert.equal(compiler.executable, "/Selected Xcode.app/usr/bin/swiftc");
    assert.equal(compiler.args[compiler.args.indexOf("-target") + 1], "arm64-apple-macosx13.0");
    assert.equal(compiler.args[compiler.args.indexOf("-module-name") + 1], "DreamEaterClosedLidHelper");
    assert.equal(path.basename(compiler.args[compiler.args.indexOf("-o") + 1]!), "closed-lid-helper");
    assert.equal(compiler.env.DEVELOPER_DIR, "/Selected Xcode.app");
    const sign = f.calls.find((call) => call.args.includes("--sign"))!;
    assert.equal(sign.args[sign.args.indexOf("--identifier") + 1], identity);
    assert.equal(sign.args[sign.args.indexOf("--sign") + 1], "-");
    assert.ok(sign.args.includes("--timestamp=none"));
    assert.deepEqual(f.events, ["compile", "sign", "verify", "self-test", "promote"]);
    assert.deepEqual(f.files.get(output), compiled);
    assert.equal(f.cleaned.length, 2);
  }
});

for (const fail of ["compile", "sign", "verify", "self-test"] as const) {
  test(`failed ${fail} keeps the shipped asset and cleans temporary files`, () => {
    const f = fixture({ fail });
    assert.throws(() => f.run(), new RegExp(`simulated ${fail} failure`));
    assert.deepEqual(f.files.get(output), original);
    assert.equal(f.events.includes("promote"), false);
    assert.equal(f.cleaned.length, 2);
  });
}

for (const options of [{ swift: "6.1" }, { sdk: "25.0" }, { platform: "linux" }]) {
  test(`unsupported build environment fails before compiling: ${JSON.stringify(options)}`, () => {
    const f = fixture(options);
    assert.throws(() => f.run(), /Swift 6\.2|macOS 26 SDK|built on macOS/);
    assert.deepEqual(f.files.get(output), original);
    assert.deepEqual(f.events, []);
  });
}

for (const options of [
  { architecture: "x86_64" },
  { architecture: "arm64 x86_64" },
  { signingIdentifier: "pid.tmp" },
]) {
  test(`unexpected artifact identity cannot replace the shipped asset: ${JSON.stringify(options)}`, () => {
    const f = fixture(options);
    assert.throws(() => f.run(), /only arm64|signing identity/);
    assert.deepEqual(f.files.get(output), original);
    assert.equal(f.events.includes("promote"), false);
  });
}
