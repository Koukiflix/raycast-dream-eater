import fs from "node:fs/promises";

const handle = process.argv[2];
if (!handle || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(handle) || handle === "YOUR_RAYCAST_USERNAME") {
  console.error("Usage: npm run prepare-store -- YOUR_ACTUAL_RAYCAST_HANDLE");
  console.error("Only updates the local author field. It does not publish or contact GitHub.");
  process.exitCode = 1;
} else {
  const file = new URL("../package.json", import.meta.url);
  const manifest = JSON.parse(await fs.readFile(file, "utf8"));
  manifest.author = handle;
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Local author set to ${handle}. Complete docs/STORE.md before submission.`);
}
