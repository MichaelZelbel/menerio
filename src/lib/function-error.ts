/**
 * Plain-language messages for failed backend calls.
 *
 * `supabase.functions.invoke` answers every non-2xx response with `data: null`
 * and an error whose message is always "Edge Function returned a non-2xx status
 * code". The function's own answer (`{ error, code }`) sits unread in
 * `error.context`, a Response. Screens that showed `error.message` therefore
 * told people nothing, and branches that tested `data.error` (out of credits,
 * wrong password) could never run, because `data` is null on exactly those
 * answers. Database errors are no better: "violates check constraint ..." or
 * "JWT expired" means nothing to the person who pressed the button.
 */

export const OUT_OF_CREDITS_MESSAGE =
  "You have used up your AI credits for this period. Top up or wait for the next period.";
export const OFFLINE_MESSAGE = "Could not reach the server. Check your connection and try again.";

export interface FunctionErrorDetails {
  /** HTTP status of the function's answer, or null when there was no answer. */
  status: number | null;
  /** Machine code the function sent (e.g. INSUFFICIENT_CREDITS), if any. */
  code: string | null;
  /** The function's own `error` text, if it sent one. */
  message: string | null;
  /** True when the request never got an answer (offline, DNS, CORS, aborted). */
  network: boolean;
}

const NETWORK_TEXT = /failed to fetch|failed to send|fetch failed|networkerror|network request failed|load failed|timeout|timed out/i;

/** True for failures where the request never reached the server or never got an answer back. */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: string; message?: string };
  if (e.name === "FunctionsFetchError" || e.name === "FunctionsRelayError") return true;
  return NETWORK_TEXT.test(String(e.message ?? error));
}

/** Read the status, code and message a function sent with a non-2xx answer. */
export async function readFunctionError(error: unknown): Promise<FunctionErrorDetails> {
  const details: FunctionErrorDetails = { status: null, code: null, message: null, network: isNetworkError(error) };
  const ctx = (error as { context?: unknown } | null)?.context as
    | { status?: number; clone?: () => Response; json?: () => Promise<unknown>; text?: () => Promise<string> }
    | undefined;
  if (!ctx || typeof ctx !== "object") return details;
  if (typeof ctx.status === "number") details.status = ctx.status;
  try {
    // Clone so a caller that reads the body afterwards still can.
    const res = typeof ctx.clone === "function" ? ctx.clone() : ctx;
    const text = typeof res.text === "function" ? await res.text() : "";
    if (text) {
      try {
        const body = JSON.parse(text) as { error?: unknown; code?: unknown; message?: unknown };
        const msg = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : null;
        details.message = msg;
        details.code = typeof body.code === "string" ? body.code : null;
      } catch {
        details.message = null;
      }
    }
  } catch {
    /* the body was already read or is not text */
  }
  return details;
}

/** True when the answer means the account is out of AI credits. */
export function isOutOfCredits(details: Pick<FunctionErrorDetails, "status" | "code" | "message">): boolean {
  return (
    details.status === 402 ||
    details.code === "INSUFFICIENT_CREDITS" ||
    details.message === "Insufficient AI credits"
  );
}

// A function's own error text is shown only when it reads like a sentence for
// people: short, and free of the markers of database or runtime internals.
const TECHNICAL_TEXT =
  /violates|constraint|duplicate key|relation "|column "|syntax error|jwt|pgrst|postgrest|stack|undefined|null value|typeerror|referenceerror|non-2xx|edge function|status code|\bat \w+ \(|https?:\/\//i;

function presentable(message: string | null | undefined): string | null {
  const text = (message ?? "").trim();
  if (!text || text.length > 200 || TECHNICAL_TEXT.test(text)) return null;
  return text;
}

/**
 * The sentence to show for a failed `supabase.functions.invoke`. Out of credits
 * and offline get their own message; otherwise the function's own error text
 * when it is meant for people, else `fallback`.
 */
export async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const details = await readFunctionError(error);
  if (isOutOfCredits(details)) return OUT_OF_CREDITS_MESSAGE;
  if (details.network && details.status === null) return OFFLINE_MESSAGE;
  return presentable(details.message) ?? fallback;
}

/**
 * The sentence to show for a failed database call (PostgREST, storage, RPC).
 * Offline gets its own message; the database's own text never reaches the
 * screen, because it is written for developers.
 */
export function dbErrorMessage(error: unknown, fallback: string): string {
  if (isNetworkError(error)) return OFFLINE_MESSAGE;
  return fallback;
}
