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
  registerSW({ immediate: true });
}

createRoot(document.getElementById("root")!).render(<App />);
