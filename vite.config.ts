import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { brandForId } from "./src/brands";
import { brandIndexHtml, brandStatics } from "./vite.brand";

// White-label brand for this build (docs/BRANDING.md). Defaults to menerio;
// the Cherishly deployment sets VITE_BRAND=cherishly in its build env.
const brand = brandForId(process.env.VITE_BRAND);

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
    brandIndexHtml(brand),
    brandStatics(brand, __dirname),
    VitePWA({
      registerType: "autoUpdate",
      // Kill-switch: if a deployed service worker ever breaks production,
      // flip this to true and redeploy — the next SW unregisters itself
      // and takes the broken one down with it.
      selfDestroying: false,
      includeAssets: ["favicon.png", "apple-touch-icon.png", "robots.txt"],
      manifest: {
        name: brand.pwa.name,
        short_name: brand.pwa.shortName,
        description: brand.pwa.description,
        theme_color: brand.pwa.themeColor,
        background_color: brand.pwa.backgroundColor,
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
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,wasm}"],
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
    // One copy of each of these, whatever the build machine resolves.
    // React Query and React hand out state through module-level React
    // contexts, so a second copy is a second context: the provider mounted
    // from one copy is invisible to a hook imported from the other, and the
    // app dies at render with "No QueryClient set". This is not theoretical.
    // The production build on 2026-08-16 shipped @tanstack/react-query in BOTH
    // the query chunk and the powersync chunk, and every local-first session
    // crashed on the notes screen while local builds from the same source were
    // fine, because only the build environment's resolution differed.
    dedupe: ["@tanstack/react-query", "react", "react-dom"],
  },
  // Strip console.log/debugger from production bundles to reduce
  // main-thread overhead. Dev keeps them for debugging.
  esbuild: mode === "production" ? { drop: ["console", "debugger"] } : undefined,
  // @powersync/web ships its own web workers + wasm; pre-bundling breaks them.
  optimizeDeps: {
    exclude: ["@powersync/web", "@journeyapps/wa-sqlite"],
  },
  worker: {
    format: "es",
  },
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
          // @powersync/tanstack-react-query sits WITH react-query on purpose.
          // Splitting a library from the context provider it consumes is what
          // lets a bundler give each chunk its own copy; sharing one chunk
          // makes a second copy impossible rather than merely unlikely.
          query: ["@tanstack/react-query", "@powersync/tanstack-react-query"],
          powersync: ["@powersync/web", "@powersync/react"],
          icons: ["lucide-react"],
          motion: ["framer-motion"],
          dates: ["date-fns"],
        },
      },
    },
  },
}));
