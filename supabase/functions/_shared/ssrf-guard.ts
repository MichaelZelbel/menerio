/**
 * Shared SSRF guard helpers.
 *
 * Any URL that originates from user-controlled data (webhook URLs, hero images,
 * imported HTML, …) must be validated before the server fetches it. Literal IPs
 * and known-internal hostnames are blocked here; DNS-rebinding (public hostname
 * resolving to a private IP) is not caught, since the Supabase edge runtime does
 * not expose reliable DNS resolution — this closes the common vectors.
 */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "metadata.google.internal" || h === "instance-data") return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true;
    const mapped = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); // IPv4-mapped IPv6
    if (mapped) return isBlockedHost(mapped[1]);
    return false;
  }
  return false; // ordinary public hostname
}

/** True when the URL is https and points at a non-internal host. */
export function isSafeOutboundUrl(raw: string, opts: { requireHttps?: boolean } = {}): boolean {
  const { requireHttps = true } = opts;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (requireHttps ? parsed.protocol !== "https:" : parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  return !isBlockedHost(parsed.hostname);
}

/**
 * POST to a user-supplied webhook with SSRF protection: https only, blocked
 * hosts rejected, redirects followed manually and re-validated per hop.
 */
export async function safeWebhookPost(
  startUrl: string,
  body: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<Response | null> {
  const { timeoutMs = 10_000, headers = {} } = opts;
  let url = startUrl;
  for (let hop = 0; hop < 3; hop++) {
    if (!isSafeOutboundUrl(url)) {
      console.warn("[ssrf-guard] blocked outbound webhook request");
      return null;
    }
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) return null;
      url = new URL(loc, url).toString();
      continue;
    }
    return res;
  }
  return null; // too many redirects
}
