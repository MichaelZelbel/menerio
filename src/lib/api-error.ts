import { showToast } from "@/lib/toast";

const DEFAULT_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;

interface ApiErrorOptions {
  /** Number of retry attempts for transient errors (default: 2) */
  retries?: number;
  /** Custom error message shown to the user */
  errorMessage?: string;
  /** Show toast on error (default: true) */
  showToastOnError?: boolean;
}

function isTransient(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wraps a Supabase query or async function with retry logic and user-friendly error handling.
 *
 * Usage:
 * ```ts
 * const data = await apiCall(
 *   () => supabase.from("items").select("*"),
 *   { retries: 2, errorMessage: "Could not load items" }
 * );
 * ```
 */
export async function apiCall<T>(
  fn: () => Promise<{ data: T | null; error: any; status?: number }>,
  options: ApiErrorOptions = {}
): Promise<T | null> {
  const {
    retries = DEFAULT_RETRY_ATTEMPTS,
    errorMessage = "Something went wrong. Please try again.",
    showToastOnError = true,
  } = options;

  let lastError: any = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();

      if (result.error) {
        lastError = result.error;
        const status = result.status ?? result.error?.status ?? 0;

        if (isTransient(status) && attempt < retries) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        console.error("[apiCall]", result.error);
        if (showToastOnError) showToast.error(errorMessage);
        return null;
      }

      return result.data;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
    }
  }

  console.error("[apiCall] All retries exhausted", lastError);
  if (showToastOnError) showToast.error(errorMessage);
  return null;
}
