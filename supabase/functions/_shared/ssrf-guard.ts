/**
 * Shared SSRF guard helpers.
 *
 * Any URL that originates from user-controlled data (webhook URLs, hero images,
 * imported HTML, …) must be validated before the server fetches it. Literal IPs
 * and known-internal hostnames are blocked here; DNS-rebinding (public hostname
 * resolving to a private IP) is not caught, since the Supabase edge runtime does
 * not expose reliable DNS resolution — this closes the common vectors.
 */
/**
 * Parse an IPv6 literal into its 16 bytes, or null when it is not one.
 *
 * Written out rather than pattern-matched because the previous version tested
 * string prefixes ("::1", "fe80", "fc", "fd") and a trailing dotted quad, and an
 * IPv6 address has too many spellings for that to hold: `0:0:0:0:0:0:0:1` is
 * loopback and matched none of them, and `::ffff:a9fe:a9fe` is the cloud
 * metadata endpoint written in hex instead of dotted form, which is exactly the
 * address this guard exists to refuse. Both were allowed through. Comparing
 * bytes has no spellings.
 */
function parseIPv6(text: string): Uint8Array | null {
  let head = text;
  let tail = "";
  const doubleColon = text.indexOf("::");
  if (doubleColon !== -1) {
    if (text.indexOf("::", doubleColon + 1) !== -1) return null; // only one "::" is legal
    head = text.slice(0, doubleColon);
    tail = text.slice(doubleColon + 2);
  }

  const bytes: number[] = [];
  const pushGroups = (part: string, into: number[]): boolean => {
    if (part === "") return true;
    const groups = part.split(":");
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      // A trailing dotted quad ("::ffff:127.0.0.1") stands for the last 4 bytes.
      if (group.includes(".")) {
        if (i !== groups.length - 1) return false;
        const quad = group.split(".");
        if (quad.length !== 4) return false;
        for (const octet of quad) {
          if (!/^\d{1,3}$/.test(octet)) return false;
          const value = Number(octet);
          if (value > 255) return false;
          into.push(value);
        }
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return false;
      const value = parseInt(group, 16);
      into.push(value >> 8, value & 0xff);
    }
    return true;
  };

  const headBytes: number[] = [];
  const tailBytes: number[] = [];
  if (!pushGroups(head, headBytes)) return null;
  if (!pushGroups(tail, tailBytes)) return null;

  if (doubleColon === -1) {
    if (headBytes.length !== 16) return null;
    return new Uint8Array(headBytes);
  }
  const fill = 16 - headBytes.length - tailBytes.length;
  if (fill < 0) return null;
  bytes.push(...headBytes, ...new Array(fill).fill(0), ...tailBytes);
  return new Uint8Array(bytes);
}

/** True when the four bytes name an address we refuse to fetch. */
function isBlockedIPv4Bytes(a: number, b: number, _c: number, _d: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;       // this-network, private, loopback
  if (a === 169 && b === 254) return true;                  // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;         // private
  if (a === 192 && b === 168) return true;                  // private
  if (a === 100 && b >= 64 && b <= 127) return true;        // CGNAT
  if (a === 192 && b === 0 && _c === 0) return true;         // IETF protocol assignments
  if (a >= 224) return true;                                 // multicast and reserved
  return false;
}

/** True when the 16 bytes name an IPv6 address we refuse to fetch. */
function isBlockedIPv6Bytes(ip: Uint8Array): boolean {
  const allZeroUpTo = (n: number) => ip.subarray(0, n).every((b) => b === 0);

  if (allZeroUpTo(15) && ip[15] === 1) return true; // ::1 loopback, any spelling
  if (allZeroUpTo(16)) return true;                 // :: unspecified, any spelling

  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96 both carry a v4 address
  // in the last four bytes; judge it as the v4 address it is.
  if (allZeroUpTo(10) && ip[10] === 0xff && ip[11] === 0xff) {
    return isBlockedIPv4Bytes(ip[12], ip[13], ip[14], ip[15]);
  }
  // IPv4-translated ::ffff:0:0:0/96 (RFC 2765) — same reasoning.
  if (allZeroUpTo(8) && ip[8] === 0xff && ip[9] === 0xff && ip[10] === 0 && ip[11] === 0) {
    return isBlockedIPv4Bytes(ip[12], ip[13], ip[14], ip[15]);
  }
  if (allZeroUpTo(12)) return true; // ::a.b.c.d deprecated compatible range
  // NAT64 well-known prefix 64:ff9b::/96 embeds a v4 address too.
  if (ip[0] === 0x00 && ip[1] === 0x64 && ip[2] === 0xff && ip[3] === 0x9b && allZeroUpToRange(ip, 4, 12)) {
    return isBlockedIPv4Bytes(ip[12], ip[13], ip[14], ip[15]);
  }

  if ((ip[0] & 0xfe) === 0xfc) return true;                       // fc00::/7 unique-local
  if (ip[0] === 0xfe && (ip[1] & 0xc0) === 0x80) return true;      // fe80::/10 link-local
  if (ip[0] === 0xff) return true;                                 // ff00::/8 multicast
  if (ip[0] === 0x20 && ip[1] === 0x01 && ip[2] === 0x00 && (ip[3] & 0xf0) === 0x00) return true; // 2001:0::/24 teredo/orchid
  return false;
}

function allZeroUpToRange(ip: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (ip[i] !== 0) return false;
  return true;
}

export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "metadata.google.internal" || h === "instance-data") return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
    // Not a valid dotted quad at all; nothing will resolve it, so refuse.
    if (octets.some((o) => o > 255)) return true;
    return isBlockedIPv4Bytes(octets[0], octets[1], octets[2], octets[3]);
  }
  if (h.includes(":")) {
    const ip = parseIPv6(h);
    // Contains a colon but is not a parseable IPv6 literal: refuse rather than
    // guess. A hostname cannot contain a colon, so there is nothing legitimate here.
    if (!ip) return true;
    return isBlockedIPv6Bytes(ip);
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

/**
 * GET a user- or model-supplied URL and return its body as text.
 *
 * Same protections as safeWebhookPost, plus two this caller needs: a timeout,
 * and a byte cap enforced WHILE streaming. Reading the whole body and slicing
 * afterwards lets a hostile or merely enormous page exhaust the isolate's
 * memory before the slice ever runs.
 *
 * Throws rather than returning null: the only caller turns a failure into a
 * message the model reads, and "refused" needs to be distinguishable from
 * "fetched an empty page".
 */
export async function safeFetchText(
  startUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string> {
  const { timeoutMs = 10_000, maxBytes = 2_000_000 } = opts;
  let url = startUrl;

  for (let hop = 0; hop < 3; hop++) {
    if (!isSafeOutboundUrl(url)) {
      throw new Error("refused: URL is not a public https address");
    }
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Menerio/1.0 (+https://menerio.com)" },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new Error("refused: redirect without a location");
      url = new URL(loc, url).toString(); // re-validated at the top of the next hop
      continue;
    }
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});

    const buf = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      buf.set(c, at);
      at += c.length;
    }
    return new TextDecoder().decode(buf.subarray(0, maxBytes));
  }
  throw new Error("refused: too many redirects");
}
