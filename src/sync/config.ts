// PowerSync service endpoint (Menerio → Production instance, EU region,
// provisioned 2026-07-10; dashboard: dashboard.powersync.com, Michael's
// account). Hardcoded like the Supabase URL in integrations/supabase/client.ts.
// Overridable per device for testing:
//   localStorage.setItem("menerio:powersync-url", "https://<id>.powersync.journeyapps.com")
export const POWERSYNC_URL: string =
  (import.meta.env.VITE_POWERSYNC_URL as string | undefined) ??
  (typeof localStorage !== "undefined"
    ? localStorage.getItem("menerio:powersync-url")
    : null) ??
  "https://6a5158557f33bac37ef5cf80.powersync.journeyapps.com";
