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
export const OFFLINE_CORE =
  import.meta.env.VITE_OFFLINE_CORE === "true" ||
  (typeof localStorage !== "undefined" &&
    localStorage.getItem("menerio:offline-core") === "true");
