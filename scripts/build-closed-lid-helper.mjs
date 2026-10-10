import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Build an arm64 asset only; never install it or invoke a power operation.
// macOS 13 remains the loader minimum so existing recovery can run after an
// OS rollback. Both native and TypeScript start guards require macOS 26+.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--self-test")) {
  throw new Error("Usage: node scripts/build-closed-lid-helper.mjs [--self-test]");
}
if (process.platform !== "darwin") throw new Error("The helper must be built on macOS.");

const target = "arm64-apple-macosx13.0";
const moduleName = "DreamEaterClosedLidHelper";
const signingIdentifier = "com.dreameater.closedlid";
const xcrun = "/usr/bin/xcrun";
const output = path.join(root, "assets", "closed-lid-helper");

function run(executable, arguments_, timeout = 10000) {
  const result = spawnSync(executable, arguments_, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Could not run ${executable}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${executable} failed (${result.status}):\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function selectedTool(name) {
  const selected = run(xcrun, ["--sdk", "macosx", "--find", name]).stdout.trim();
  if (!path.isAbsolute(selected)) throw new Error(`xcrun did not find an absolute path for ${name}`);
  return selected;
}

// Respect the active Xcode/Command Line Tools selection, including DEVELOPER_DIR.
// Do not switch xcode-select, install a toolchain, or silently use another SDK.
const compiler = selectedTool("swiftc");
const signer = selectedTool("codesign");
const lipo = selectedTool("lipo");
const vtool = selectedTool("vtool");
const swiftVersion = run(compiler, ["--version"]).stdout.trim();
const swift = swiftVersion.match(/Apple Swift version (\d+)\.(\d+)/);
if (!swift || Number(swift[1]) < 6 || (Number(swift[1]) === 6 && Number(swift[2]) < 2)) {
  throw new Error("Select an Apple Swift 6.2 or newer toolchain with xcode-select or DEVELOPER_DIR.");
}
const sdk = run(xcrun, ["--sdk", "macosx", "--show-sdk-path"]).stdout.trim();
const sdkVersion = run(xcrun, ["--sdk", "macosx", "--show-sdk-version"]).stdout.trim();
if (!path.isAbsolute(sdk) || !/^\d+(?:\.\d+)*$/.test(sdkVersion) || Number(sdkVersion.split(".")[0]) < 26) {
  throw new Error("The selected toolchain must provide the macOS 26 SDK or newer.");
}
const targetInfo = JSON.parse(run(compiler, ["-print-target-info", "-sdk", sdk, "-target", target]).stdout);
if (!/^arm64-apple-macosx13\.0(?:\.0)?$/.test(targetInfo.target?.triple ?? "")) {
  throw new Error("The selected Swift toolchain did not resolve the required arm64 macOS target.");
}

mkdirSync(path.dirname(output), { recursive: true });
// A stable basename and Swift module prevent random temporary-directory names
// or the builder PID from becoming linker/module/signing identities.
const staging = mkdtempSync(path.join(path.dirname(output), ".closed-lid-build-"));
let cache;
try {
  cache = mkdtempSync(path.join(tmpdir(), "dream-eater-swift-"));
  const temporary = path.join(staging, "closed-lid-helper");
  const build = run(
    compiler,
    [
      "-swift-version",
      "5",
      "-O",
      "-whole-module-optimization",
      "-module-name",
      moduleName,
      "-sdk",
      sdk,
      "-target",
      target,
      "-file-prefix-map",
      `${root}=.`,
      "-module-cache-path",
      cache,
      "-framework",
      "IOKit",
      "native/ClosedLidHelper.swift",
      "-o",
      temporary,
    ],
    120000,
  );
  if (build.stdout || build.stderr) console.log(`${build.stdout}${build.stderr}`.trim());
  chmodSync(temporary, 0o755);
  // Ad-hoc signing uses no certificate, account, keychain or timestamp service.
  run(signer, ["--force", "--sign", "-", "--identifier", signingIdentifier, "--timestamp=none", temporary]);
  run(signer, ["--verify", "--strict", temporary]);
  const signature = run(signer, ["--display", "--verbose=4", temporary]);
  const signatureText = `${signature.stdout}${signature.stderr}`;
  if (!signatureText.includes(`Identifier=${signingIdentifier}\n`) || !/^Signature=adhoc$/m.test(signatureText)) {
    throw new Error("The helper does not have the required deterministic ad-hoc signing identity.");
  }
  const architecture = run(lipo, ["-archs", temporary]).stdout.trim();
  const buildVersion = run(vtool, ["-show-build", temporary]).stdout;
  if (
    architecture !== "arm64" ||
    !/\bplatform MACOS\b/.test(buildVersion) ||
    !/\bminos 13\.0(?:\.0)?\s/.test(buildVersion)
  ) {
    throw new Error("The built helper must contain only arm64 and retain the macOS 13 recovery loader minimum.");
  }
  if (args.includes("--self-test")) {
    // This entry point uses an in-memory simulation, never installed state.
    const test = run(temporary, ["--self-test"], 30000);
    console.log(`${test.stdout}${test.stderr}`.trim());
  }
  const sha256 = createHash("sha256").update(readFileSync(temporary)).digest("hex");
  // Keep the previous asset until compilation, signing, inspection and any
  // requested simulation checks have all succeeded. Same-directory rename is atomic.
  renameSync(temporary, output);
  console.log(
    JSON.stringify(
      { output, sha256, architecture, target, moduleName, signingIdentifier, compiler, swiftVersion, sdk, sdkVersion },
      null,
      2,
    ),
  );
  console.log("Compiled local asset. Nothing was installed or enabled; new starts require macOS 26+.");
} finally {
  rmSync(staging, { recursive: true, force: true });
  if (cache) rmSync(cache, { recursive: true, force: true });
}
