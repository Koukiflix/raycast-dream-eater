import { environment, launchCommand, LaunchType } from "@raycast/api";
import path from "node:path";
import { SessionManager } from "./session";
import { ClosedLidManager } from "./closed-lid";

export const idleManager = new SessionManager({
  supportPath: environment.supportPath,
  scriptPath: path.join(environment.assetsPath, "session.sh"),
});

export const closedLidManager = new ClosedLidManager({
  helperPath: path.join(environment.assetsPath, "closed-lid-helper"),
});

/** Launching the status command never changes power settings. It reads again. */
export async function refreshStatusCommand(): Promise<void> {
  try {
    await launchCommand({ name: "status", type: LaunchType.Background });
  } catch {
    // A root-search subtitle is a dated snapshot; failure to refresh it must
    // not turn a completed power operation into a false failure.
  }
}
