import { toast } from "sonner";

/** Convenience wrappers around sonner toast with standard messages. */

type ToastKind = "success" | "error" | "info" | "warning";

interface BatchEntry {
  count: number;
  toastId: string | number;
  timer: ReturnType<typeof setTimeout>;
}

const BATCH_WINDOW_MS = 800;
const batchRegistry = new Map<string, BatchEntry>();

/**
 * Emit a toast that consolidates rapid repeats sharing the same `key`.
 * The first call shows `formatter(1)`. Subsequent calls within
 * BATCH_WINDOW_MS update the same toast in place to `formatter(n)`.
 */
function emitBatched(
  kind: ToastKind,
  key: string,
  formatter: (count: number) => string,
) {
  const existing = batchRegistry.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    existing.count += 1;
    toast[kind](formatter(existing.count), { id: existing.toastId });
    existing.timer = setTimeout(() => batchRegistry.delete(key), BATCH_WINDOW_MS);
    return;
  }

  const toastId = toast[kind](formatter(1));
  const entry: BatchEntry = {
    count: 1,
    toastId,
    timer: setTimeout(() => batchRegistry.delete(key), BATCH_WINDOW_MS),
  };
  batchRegistry.set(key, entry);
}

export const showToast = {
  success: (message = "Changes saved successfully") =>
    toast.success(message),

  error: (message = "Failed to save changes. Please try again.") =>
    toast.error(message),

  warning: (message: string) =>
    toast.warning(message),

  info: (message: string) =>
    toast.info(message),

  loading: (message = "Loading…") =>
    toast.loading(message),

  dismiss: (id?: string | number) =>
    toast.dismiss(id),

  // ── Common preset messages ──

  saved: () => toast.success("Changes saved successfully"),
  deleted: () => toast.success("Deleted successfully"),
  copied: () => toast.success("Copied to clipboard"),
  signInRequired: () => toast.error("Please sign in to continue"),
  permissionDenied: () => toast.error("You don't have permission to do that"),
  networkError: () => toast.error("Network error. Please check your connection."),

  /**
   * Show a toast that consolidates rapid repeats. Call this from a single-item
   * action (e.g. moving one note) and pass a stable `key` plus a `formatter`
   * that produces the message for N occurrences. Within an 800ms window,
   * subsequent calls update the existing toast instead of stacking.
   *
   * Example:
   *   showToast.batched.success("note:move", (n) =>
   *     n === 1 ? "Note moved" : `${n} notes moved`,
   *   );
   */
  batched: {
    success: (key: string, formatter: (count: number) => string) =>
      emitBatched("success", key, formatter),
    error: (key: string, formatter: (count: number) => string) =>
      emitBatched("error", key, formatter),
    info: (key: string, formatter: (count: number) => string) =>
      emitBatched("info", key, formatter),
    warning: (key: string, formatter: (count: number) => string) =>
      emitBatched("warning", key, formatter),
  },

  /** Show loading → then resolve to success/error */
  promise: <T>(
    promise: Promise<T>,
    opts?: { loading?: string; success?: string; error?: string }
  ) =>
    toast.promise(promise, {
      loading: opts?.loading ?? "Loading…",
      success: opts?.success ?? "Done!",
      error: opts?.error ?? "Something went wrong",
    }),
};
