import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { BRAND } from "@/lib/brand";
import { createGhostShellHealer } from "@/lib/ghost-shell";
import "./index.css";

// Activate the brand's theme tokens before first paint. Production builds of
// non-default brands also bake this class into index.html at build time; this
// covers dev servers and the dev-only localStorage override.
if (BRAND.themeClass) document.documentElement.classList.add(BRAND.themeClass);

// The service worker is a web/PWA concern; in the Tauri desktop shell all
// assets are bundled locally and SW registration on the tauri origin is
// unreliable — skip it there. The Lovable editor preview must also never
// register a service worker: a preview iframe left open across deploys keeps
// serving a stale app shell (people-tree avatars, deleted routes, etc.)
// forever, and users can't easily clear an iframe's storage. In those
// contexts we actively evict any previously-registered worker + caches.
const host = typeof window !== "undefined" ? window.location.hostname : "";
const inTauri = "__TAURI_INTERNALS__" in window;
const inIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
const isLovablePreviewHost =
  host.startsWith("id-preview--") ||
  host.startsWith("preview--") ||
  host === "lovableproject.com" ||
  host.endsWith(".lovableproject.com") ||
  host === "lovableproject-dev.com" ||
  host.endsWith(".lovableproject-dev.com") ||
  host === "beta.lovable.dev" ||
  host.endsWith(".beta.lovable.dev");
const swDisabled =
  inTauri ||
  inIframe ||
  isLovablePreviewHost ||
  !import.meta.env.PROD ||
  new URLSearchParams(window.location.search).get("sw") === "off";

if (swDisabled) {
  // Evict any worker previously installed on this origin so the preview
  // stops serving cached HTML/JS. Runs in the background; failures are safe.
  if ("serviceWorker" in navigator) {
    void (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        if (regs.length === 0) return;
        for (const r of regs) await r.unregister();
        if ("caches" in window) {
          for (const key of await caches.keys()) await caches.delete(key);
        }
        // One reload after eviction so the fresh dev/preview bundle takes over.
        const KEY = "menerio:sw-evicted";
        if (sessionStorage.getItem(KEY) !== "1") {
          sessionStorage.setItem(KEY, "1");
          window.location.reload();
        }
      } catch {
        /* never break boot */
      }
    })();
  }
} else {
  // Without explicit checks, a browser only looks for a new service worker on
  // navigation — tabs (and installed PWA windows) left open for days keep
  // running a ghost build long after deploys. Poll every 30 minutes and on
  // every return to the tab; registerType "autoUpdate" then activates the new
  // worker and reloads controlled tabs automatically.
  const SW_UPDATE_INTERVAL_MS = 30 * 60 * 1000;
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const checkForUpdate = () => registration.update().catch(() => {});
      setInterval(checkForUpdate, SW_UPDATE_INTERVAL_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
    },
  });

  // Ghost-shell self-heal (src/lib/ghost-shell.ts has the whole story).
  const healGhostShell = createGhostShellHealer({
    ownChunk: [...document.querySelectorAll<HTMLScriptElement>("script[src]")]
      .map((s) => s.src)
      .map((src) => src.match(/\/assets\/(index-[\w-]+\.js)/)?.[1])
      .find(Boolean),
    getRegistration: async () =>
      "serviceWorker" in navigator ? navigator.serviceWorker.getRegistration() : undefined,
    fetchManifest: async () => {
      const res = await fetch("/sw.js", { cache: "no-store" });
      return res.ok ? res.text() : null;
    },
    dropWorkersAndCaches: async () => {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const key of await caches.keys()) await caches.delete(key);
    },
    reload: () => window.location.reload(),
    storage: sessionStorage,
  });
  setTimeout(() => void healGhostShell(), 5000);
  setInterval(() => void healGhostShell(), SW_UPDATE_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void healGhostShell();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
