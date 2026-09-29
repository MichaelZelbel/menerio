/**
 * Copy text for a copy button, and say whether it worked.
 *
 * `navigator.clipboard.writeText` is refused often enough to matter: Safari
 * outside the click's own tick, a denied permission, an insecure origin, an
 * embedded frame. Buttons that did not await it said "Copied" either way, and
 * ones that did await it failed silently, which for a key shown only once
 * meant the person left without it.
 */
export const COPY_FAILED_MESSAGE = "Could not copy. Select the text and copy it by hand.";

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
