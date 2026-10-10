import { Alert, confirmAlert, LaunchProps, showHUD } from "@raycast/api";
import { CLOSED_LID_MAX_SECONDS } from "./closed-lid";
import { DurationError, DurationFields, formatDuration, parseDuration } from "./duration";
import { idleManager, closedLidManager, refreshStatusCommand } from "./controllers";

/** Three native root-search arguments; this command never renders a form. */
export default async function DreamEaterFor(props: LaunchProps<{ arguments: Partial<DurationFields> }>) {
  try {
    const fields = {
      hours: props.arguments?.hours ?? "",
      minutes: props.arguments?.minutes ?? "",
      seconds: props.arguments?.seconds ?? "",
    };
    const duration = parseDuration(fields, false)!;
    const [idle, closed] = await Promise.all([idleManager.status(), closedLidManager.status()]);
    if (closed.requestId && closed.state !== "off")
      throw new Error("Use Toggle to restore the current lid-closed session before starting another timer");
    closedLidManager.assertStartSupported();
    if (closed.state !== "off" || closed.sleepDisabled !== 0) throw new Error(closed.message);

    if (duration > CLOSED_LID_MAX_SECONDS) throw new Error("Dream Eater timers cannot exceed 24 hours");
    if (idle.state !== "off")
      throw new Error("Use Toggle to stop the earlier lid-open session before enabling Dream Eater");
    const approved = await confirmAlert({
      title: `Enable Dream Eater for ${formatDuration(duration)}?`,
      message:
        "Keeps this Mac awake with the lid closed on charger or battery power for the selected duration. Administrator approval manages a persistent recovery helper and changes a global sleep setting that can interfere with low-battery and thermal sleep. Keep the Mac on a ventilated desk, never in a bag. Do not use other sleep controls during the session. Recovery cannot protect against every failure.",
      primaryAction: { title: "Enable with Administrator Approval", style: Alert.ActionStyle.Destructive },
      dismissAction: { title: "Cancel" },
    });
    if (!approved) return;
    const started = await closedLidManager.start(duration, true);
    await refreshStatusCommand();
    await showHUD(
      started.state === "on" ? `Dream Eater enabled · lid closed · ${formatDuration(duration)}` : started.message,
    );
  } catch (error) {
    await refreshStatusCommand();
    const message = error instanceof Error ? error.message : "Could not start Dream Eater";
    await showHUD(error instanceof DurationError ? `${error.field}: ${message}` : message);
  }
}
