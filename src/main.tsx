import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { BRAND } from "@/lib/brand";
import "./index.css";

// Activate the brand's theme tokens before first paint. Production builds of
// non-default brands also bake this class into index.html at build time; this
// covers dev servers and the dev-only localStorage override.
if (BRAND.themeClass) document.documentElement.classList.add(BRAND.themeClass);

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(<App />);
