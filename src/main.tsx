import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { BRAND } from "@/lib/brand";
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

  // Ghost-shell self-heal. If a service worker installs while the CDN is
  // still propagating a deploy, it can freeze a stale index.html into its
  // precache and then report "up to date" forever — the app keeps running a
  // build that no longer exists (observed live 2026-07-12: page ran a chunk
  // absent from every sw.js manifest). Signature: our own index chunk is
  // missing from the live sw.js. Remedy: drop the worker + caches and reload.
  //
  // It runs at boot, on every return to the tab and with the update poll, and
  // its loop guard is per stale chunk, not per tab. With one check at boot and
  // a guard of "1" for the whole tab session, a tab that had healed once never
  // healed again: on 2026-09-29 a window still ran the build from before the
  // fact-store switch, and Never Again on a profile fact failed with "Could
  // not find the table 'public.profile_entries'", a table that build still
  // wrote to. A stale build must not keep writing against a newer database.
  const GHOST_SHELL_KEY = "menerio:ghost-shell-healed";
  const ownChunk = [...document.querySelectorAll<HTMLScriptElement>("script[src]")]
    .map((s) => s.src)
    .map((src) => src.match(/\/assets\/(index-[\w-]+\.js)/)?.[1])
    .find(Boolean);
  const healGhostShell = async () => {
    try {
      if (!ownChunk || !("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg?.active) return;
      const res = await fetch("/sw.js", { cache: "no-store" });
      if (!res.ok) return;
      const manifest = await res.text();
      // A manifest without any index chunk is not a real sw.js (an error page).
      if (!/assets\/index-[\w-]+\.js/.test(manifest) || manifest.includes(ownChunk)) return;
      // Once per stale build: the reload may land on the same stale shell
      // while the CDN is still inconsistent, and must not loop.
      if (sessionStorage.getItem(GHOST_SHELL_KEY) === ownChunk) return;
      sessionStorage.setItem(GHOST_SHELL_KEY, ownChunk);
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const key of await caches.keys()) await caches.delete(key);
      window.location.reload();
    } catch {
      // Self-heal must never break boot.
    }
  };
  setTimeout(healGhostShell, 5000);
  setInterval(healGhostShell, SW_UPDATE_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void healGhostShell();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
