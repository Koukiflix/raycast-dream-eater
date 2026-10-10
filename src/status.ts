import { environment, LaunchType, showHUD, updateCommandMetadata } from "@raycast/api";
import { idleManager, closedLidManager } from "./controllers";
import type { ClosedLidStatus } from "./closed-lid";
import type { AwakeStatus } from "./session";

function describeClosed(status: ClosedLidStatus): string | null {
  if (status.state === "off" && !status.requestId) return null;
  if (status.state === "on" && status.expiresAt !== null && Number.isFinite(new Date(status.expiresAt).getTime())) {
    const end = new Date(status.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `Lid-closed setting on until ${end}`;
  }
  // Match Toggle's recovery gate: a request ID alone cannot authorize restoration.
  if (status.requestId && status.installed && status.state !== "off") {
    return `Lid-closed: ${status.state} · use Toggle to restore`;
  }
  if (status.state === "unavailable" && !status.requestId) return "Lid-closed status unavailable";
  return `Lid-closed: ${status.state} · manual review required`;
}

function describeIdle(status: AwakeStatus): string | null {
  if (status.state === "off") return null;
  if (status.state !== "on") return `Lid open ${status.state}`;
  const end =
    status.session.expiresAt === null
      ? "until disabled"
      : `until ${new Date(status.session.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return `Lid open on ${end}`;
}

export default async function CheckDreamEaterStatus() {
  // A damaged legacy session must not hide valid recovery information, or vice versa.
  const [idle, closed] = await Promise.allSettled([idleManager.status(), closedLidManager.status()]);
  const closedSummary = closed.status === "fulfilled" ? describeClosed(closed.value) : "Lid-closed status unavailable";
  const idleSummary = idle.status === "fulfilled" ? describeIdle(idle.value) : "Legacy lid-open status unavailable";
  const summary =
    [closedSummary ?? (idle.status === "rejected" ? "Lid-closed off" : null), idleSummary]
      .filter(Boolean)
      .join(" · ") || "Off";
  const checked = new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  await updateCommandMetadata({ subtitle: `Checked ${checked} · ${summary}` });
  if (environment.launchType === LaunchType.UserInitiated) await showHUD(summary);
}
