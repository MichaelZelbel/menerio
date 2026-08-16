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
 * or 500.
 *
 * READ THIS BEFORE TRUSTING A `true`. A pass is NOT proof that sync works, and
 * this was learned the hard way: on a machine behind a proxy, this probe
 * returned true for a host that DNS reports as NXDOMAIN, because the proxy
 * answered with its own error page and `no-cors` cannot tell that apart from a
 * real reply. The first version of the fallback gated on this probe alone, so on
 * that machine it decided sync was fine and kept serving a frozen local database
 * exactly as before the fix.
 *
 * So: a `false` here is a fast, reliable negative. A `true` means only "something
 * answered". The authority on whether sync actually works is PowerSync reporting
 * itself connected, which is what the watchdog below waits for.
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

/**
 * Declare sync dead when it has not reported a connection in time.
 *
 * This, not the probe, is the real test. It asks the only question that matters
 * ("is the stream actually up?") and it is indifferent to WHY the answer is no:
 * a deleted instance, a proxy swallowing the request, expired credentials and a
 * flat network all look the same to a user staring at stale notes, and all of
 * them must end in the same fallback.
 */
export type ConnectWatchdogOptions = {
  isConnected: () => boolean;
  onDead: () => void;
  timeoutMs?: number;
};

export function startConnectWatchdog({
  isConnected,
  onDead,
  timeoutMs = 12_000,
}: ConnectWatchdogOptions): () => void {
  const timer = setTimeout(() => {
    if (!isConnected()) onDead();
  }, timeoutMs);
  return () => clearTimeout(timer);
}

/** Host only, for a message a person can act on without reading a URL. */
export function serviceHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
