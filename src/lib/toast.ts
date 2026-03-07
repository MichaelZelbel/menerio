import { toast } from "sonner";

/** Convenience wrappers around sonner toast with standard messages. */

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
