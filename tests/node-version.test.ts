import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// Load the small ESM guard without adding JavaScript declarations to the project.
const loadGuard = () => import(pathToFileURL(path.resolve("scripts/check-node.mjs")).href);

test("supported Node releases match the declared package engine and recommended version", async () => {
  const guard = await loadGuard();
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const recommended = (await readFile(".node-version", "utf8")).trim();
  assert.equal(manifest.engines.node, guard.supportedNodeRange);
  assert.equal(guard.isSupportedNode(recommended), true);
});

test("Node guard accepts supported LTS versions and rejects gaps, prereleases and malformed versions", async () => {
  const guard = await loadGuard();
  for (const version of ["22.22.2", "22.22.3", "22.23.0", "24.0.0", "24.21.0"])
    assert.equal(guard.isSupportedNode(version), true, version);
  for (const version of [
    "20.19.6",
    "22.22.1",
    "22.21.9",
    "23.6.0",
    "25.0.0",
    "26.0.0",
    "24.0.0-rc.1",
    "v24.0.0",
    "24",
    "",
    "NaN",
  ])
    assert.equal(guard.isSupportedNode(version), false, version);
});
