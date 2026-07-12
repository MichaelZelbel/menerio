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
// unreliable — skip it there.
if (!("__TAURI_INTERNALS__" in window)) {
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
}

createRoot(document.getElementById("root")!).render(<App />);
