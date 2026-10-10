import { Alert, confirmAlert, showHUD } from "@raycast/api";
import { idleManager, closedLidManager, refreshStatusCommand } from "./controllers";

const DEFAULT_DURATION_SECONDS = 60 * 60;

/** Enable a finite closed-lid session, or stop the session this extension owns. */
export default async function ToggleDreamEater() {
  try {
    // An unrelated damaged idle-session record must not block owned recovery.
    const closed = await closedLidManager.status();
    if (closed.requestId && closed.installed && closed.state !== "off") {
      const approved = await confirmAlert({
        title: "Disable Dream Eater?",
        message:
          "Administrator approval will ask the installed recovery helper to restore this owned lid-closed session. Recovery must be verified before Dream Eater reports Off.",
        primaryAction: { title: "Continue to Administrator Approval" },
        dismissAction: { title: "Cancel" },
      });
      if (!approved) return;
      const stopped = await closedLidManager.stop();
      await refreshStatusCommand();
      await showHUD(stopped.state === "off" ? "Dream Eater disabled · normal sleep restored" : stopped.message);
      return;
    }
    const idle = await idleManager.status();
    if (idle.state !== "off") {
      const stopped = await idleManager.stop();
      await refreshStatusCommand();
      await showHUD(stopped.state === "off" ? "Dream Eater disabled" : "Dream Eater is stopping; check Status");
      return;
    }
    closedLidManager.assertStartSupported();
    if (closed.state !== "off" || closed.sleepDisabled !== 0) throw new Error(closed.message);
    const approved = await confirmAlert({
      title: "Enable Dream Eater for 1 Hour?",
      message:
        "Keeps this Mac awake with the lid closed on charger or battery power, then restores normal sleep after one hour. Administrator approval manages a persistent recovery helper and changes a global sleep setting that can interfere with low-battery and thermal sleep. Keep the Mac on a ventilated desk, never in a bag. Do not use other sleep controls during the session. Recovery cannot protect against every failure.",
      primaryAction: { title: "Enable with Administrator Approval", style: Alert.ActionStyle.Destructive },
      dismissAction: { title: "Cancel" },
    });
    if (!approved) return;
    const started = await closedLidManager.start(DEFAULT_DURATION_SECONDS, true);
    await refreshStatusCommand();
    await showHUD(started.state === "on" ? "Dream Eater enabled · lid closed · 1 hour" : started.message);
  } catch (error) {
    await refreshStatusCommand();
    await showHUD(error instanceof Error ? error.message : "Could not confirm Dream Eater status");
  }
}
