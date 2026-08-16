/**
 * Is the sync service still there?
 *
 * WHY THIS EXISTS. `db.connect()` cannot answer that question. PowerSync's
 * connect starts a background stream that retries on its own schedule and never
 * rejects, so a service that has been deleted looks exactly like one that is
 * about to come back: the promise resolves, nothing throws, and the app goes on
 * rendering a local database that will never receive another row.
 *
 * That is not hypothetical. Menerio's PowerSync Cloud instance was provisioned
 * on 2026-07-10 and later disappeared; its hostname now returns NXDOMAIN. Every
 * device on the local-first path silently froze at whatever it had last
 * downloaded, and kept looking perfectly healthy for weeks.
 *
 * `mode: "no-cors"` is deliberate. We never read the response, only ask whether
 * the host resolves and answers, so an opaque reply is a pass and so is any 404
 * or 500. Only DNS failure, a refused connection, or a timeout reject, and those
 * are exactly the cases where sync is genuinely gone.
 */
export type ReachabilityOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function isSyncServiceReachable(
  url: string,
  { fetchImpl, timeoutMs = 6_000 }: ReachabilityOptions = {},
): Promise<boolean> {
  if (!url) return false;

  // An AbortController rather than AbortSignal.timeout, which jsdom does not
  // provide, so this stays testable without a browser.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const doFetch = fetchImpl ?? fetch;

  try {
    await doFetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Host only, for a message a person can act on without reading a URL. */
export function serviceHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
