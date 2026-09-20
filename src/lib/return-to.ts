/**
 * Where to send someone once they have signed in, when the sign-in leaves the
 * app on the way (Google, GitHub). The provider always returns to /dashboard,
 * so the page they were actually heading for, query string included, waits in
 * this tab's session storage and ProtectedRoute picks it up on arrival.
 *
 * Signing in with a password never needs this: /auth?redirect=... carries the
 * path the whole way.
 */
const KEY = "return-to-after-sign-in";
const MAX_AGE_MS = 10 * 60 * 1000;

/** A path inside this app, or null. Never another site, never the sign-in page itself. */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value === "/auth" || value.startsWith("/auth?")) return null;
  return value;
}

export function rememberReturnTo(path: string): void {
  const safe = safeReturnPath(path);
  if (!safe) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path: safe, at: Date.now() }));
  } catch {
    /* storage unavailable: they land on the dashboard, as before */
  }
}

export function peekReturnTo(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof at !== "number" || Date.now() - at > MAX_AGE_MS) return null;
    return safeReturnPath(path);
  } catch {
    return null;
  }
}

export function clearReturnTo(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
