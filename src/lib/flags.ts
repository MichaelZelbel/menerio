// OFFLINE_CORE gates the local-first data path: core entities (notes, in
// Phase 1) are read from and written to a local SQLite database (PowerSync)
// that syncs with Supabase in the background. When off, hooks use the
// original direct-Supabase path.
//
// The value is fixed for the lifetime of the page, so hooks may branch on it
// without violating the rules of hooks.
//
// Enable per-device without a rebuild (for testing on production):
//   localStorage.setItem("menerio:offline-core", "true"); location.reload()
// or — usable on devices without a console (iPhone Safari) — open:
//   https://menerio.com/?offline-core=on   (or =off to revert)
const urlSwitch =
  typeof location !== "undefined"
    ? new URLSearchParams(location.search).get("offline-core")
    : null;
if (urlSwitch === "on") localStorage.setItem("menerio:offline-core", "true");
if (urlSwitch === "off") localStorage.removeItem("menerio:offline-core");

// True when running inside the Tauri desktop shell (Menerio.exe).
export const IS_DESKTOP =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// The desktop client is always local-first — that's its reason to exist.
export const OFFLINE_CORE =
  IS_DESKTOP ||
  import.meta.env.VITE_OFFLINE_CORE === "true" ||
  (typeof localStorage !== "undefined" &&
    localStorage.getItem("menerio:offline-core") === "true");
