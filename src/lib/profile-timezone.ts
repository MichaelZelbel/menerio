/**
 * profiles.timezone decides what "today" is for every dated fact
 * (public.user_today, fact_today, the person pages). Its default is 'UTC' and
 * nothing in the app ever set it, so on 2026-09-29 twelve of thirteen accounts
 * were on UTC: for a person in Berlin a change dated "today" between midnight
 * and two in the morning landed on yesterday.
 *
 * The browser knows the zone. It is adopted once, while the profile still has
 * the default. A zone that is already set is never replaced, so travelling
 * does not move anyone's dates.
 */
export function timeZoneToAdopt(stored: string | null | undefined, browser: string | null | undefined): string | null {
  if (stored && stored !== "UTC") return null;
  if (!browser || browser === "UTC" || browser === "Etc/UTC") return null;
  try {
    // Only a name the platform recognises; Postgres raises on an unknown one.
    new Intl.DateTimeFormat("en", { timeZone: browser });
  } catch {
    return null;
  }
  return browser;
}

export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}
