// PowerSync service endpoint. Empty until the cloud instance exists — the
// local database still works fully offline without it; background sync just
// stays off. Once the instance is provisioned, hardcode the URL here (same
// pattern as the Supabase URL in integrations/supabase/client.ts).
// A localStorage override allows pointing a single device at an instance
// without a rebuild:
//   localStorage.setItem("menerio:powersync-url", "https://<id>.powersync.journeyapps.com")
export const POWERSYNC_URL: string =
  (import.meta.env.VITE_POWERSYNC_URL as string | undefined) ??
  (typeof localStorage !== "undefined"
    ? (localStorage.getItem("menerio:powersync-url") ?? "")
    : "");
