import { useEffect } from "react";

/**
 * OAuth landing page for the Google Drive App User Connector.
 *
 * The Lovable connector gateway redirects the popup here after the user
 * approves access. We hand the exchange code back to the opener window and
 * close; the opener swaps it for a server-side connection key.
 */
export default function GDriveCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code =
      params.get("code") ||
      params.get("exchange_code") ||
      params.get("app_user_exchange_code") ||
      "";
    const error = params.get("error") || params.get("error_description") || "";

    const message = { type: "gdrive-oauth", code, error };
    try {
      window.opener?.postMessage(message, window.location.origin);
    } catch {
      /* opener gone */
    }

    if (window.opener) {
      window.close();
    } else {
      // Fallback when the flow ran in the same tab.
      sessionStorage.setItem("gdrive-oauth", JSON.stringify(message));
      window.location.replace("/dashboard/settings?tab=gdrive");
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
      Finishing Google Drive connection…
    </div>
  );
}
