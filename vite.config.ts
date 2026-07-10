import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Kill-switch: if a deployed service worker ever breaks production,
      // flip this to true and redeploy — the next SW unregisters itself
      // and takes the broken one down with it.
      selfDestroying: false,
      includeAssets: ["favicon.png", "apple-touch-icon.png", "robots.txt"],
      manifest: {
        name: "Menerio — AI-Powered Knowledge System",
        short_name: "Menerio",
        description:
          "Menerio turns your notes into a shared knowledge system for AI.",
        theme_color: "#0e121b",
        background_color: "#0e121b",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell only. Data requests go to Supabase
        // (cross-origin) and are never intercepted by the service worker —
        // the TanStack Query IndexedDB persister owns data caching.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Strip console.log/debugger from production bundles to reduce
  // main-thread overhead. Dev keeps them for debugging.
  esbuild: mode === "production" ? { drop: ["console", "debugger"] } : undefined,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          ui: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-tabs",
          ],
          query: ["@tanstack/react-query"],
          icons: ["lucide-react"],
          motion: ["framer-motion"],
          dates: ["date-fns"],
        },
      },
    },
  },
}));
