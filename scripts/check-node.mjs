import { pathToFileURL } from "node:url";

export const supportedNodeRange = "^22.22.2 || ^24.0.0";

export function isSupportedNode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major === 24 || (major === 22 && (minor > 22 || (minor === 22 && patch >= 2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!isSupportedNode(process.versions.node)) {
    console.error(
      `Dream Eater requires Node ${supportedNodeRange}; found ${process.versions.node}. See .node-version.`,
    );
    process.exitCode = 1;
  }
}
