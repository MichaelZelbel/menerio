/**
 * Real-time awareness block for the chat agents.
 *
 * Injects the current date/time so the model isn't stuck at its training
 * cutoff. Tiny by design (a few tokens). `timezone` is an IANA name (e.g.
 * "Europe/Berlin") passed from the browser; falls back to UTC.
 */
export function buildAwarenessContext(timezone?: string): string {
  const tz = timezone && timezone.trim() ? timezone.trim() : "UTC";
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date());
  } catch {
    // Invalid timezone string — fall back to UTC.
    formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date());
  }
  return `\n\n--- CURRENT DATE & TIME ---\nRight now it is ${formatted} (timezone: ${tz}). Use this for any question about "today", "now", recent events, ages, or deadlines.\n--- END DATE & TIME ---`;
}
