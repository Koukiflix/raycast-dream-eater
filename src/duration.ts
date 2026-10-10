export interface DurationFields {
  hours: string;
  minutes: string;
  seconds: string;
}

export type DurationField = keyof DurationFields;
export const MAX_DURATION_SECONDS = 365 * 24 * 60 * 60;
export const EMPTY_DURATION: DurationFields = { hours: "", minutes: "", seconds: "" };

export class DurationError extends Error {
  constructor(
    message: string,
    readonly field: DurationField,
  ) {
    super(message);
    this.name = "DurationError";
  }
}

/** Blank means indefinite; an explicitly entered zero is almost certainly a mistake. */
export function parseDuration(fields: DurationFields, allowIndefinite = true): number | null {
  const multipliers: Record<DurationField, number> = { hours: 3600, minutes: 60, seconds: 1 };
  let total = 0;
  let entered: DurationField | undefined;
  for (const field of Object.keys(multipliers) as DurationField[]) {
    const raw = fields[field].trim();
    if (!raw) continue;
    entered ??= field;
    if (!/^\d+$/.test(raw)) throw new DurationError("Use a whole number, zero or greater", field);
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new DurationError("That number is too large", field);
    total += value * multipliers[field];
    if (!Number.isSafeInteger(total) || total > MAX_DURATION_SECONDS) {
      throw new DurationError("Choose a duration of 365 days or less", field);
    }
  }
  if (!entered) {
    if (!allowIndefinite) throw new DurationError("Enter a duration; use Toggle for 1 hour", "hours");
    return null;
  }
  if (total === 0)
    throw new DurationError(
      allowIndefinite ? "Enter at least 1 second, or leave all three fields blank" : "Enter at least 1 second",
      entered,
    );
  return total;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
    remainder || (!hours && !minutes) ? `${remainder}s` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function secondsRemaining(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}
