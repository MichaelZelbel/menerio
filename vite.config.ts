import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { brandForId } from "./src/brands";
import { brandIndexHtml, brandStatics } from "./vite.brand";
import { GATE_SCRIPT } from "./src/lib/consent";

// The consent gate (src/lib/consent.ts) must run before every other script,
// including the analytics script the host injects, so it goes inline straight
// after <meta charset> (which has to stay within the first 1024 bytes).
function consentGate(): Plugin {
  return {
    name: "consent-gate",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const tag = `<script>${GATE_SCRIPT}</script>`;
        const charset = /<meta\s+charset=[^>]*>/i;
        if (!charset.test(html)) throw new Error("consent-gate: no <meta charset> in index.html");
        return html.replace(charset, (m) => `${m}\n    ${tag}`);
      },
    },
  };
}

// Icon chunks that only ProfileIcon's by-name lookup can reach. They are kept
// out of the service-worker precache: there are ~1,500 of them and each one
// imports the main chunk, so every deploy would re-download all of them on
// every installed client. An icon chunk some other chunk imports statically
// stays in the precache, or that route would break offline.
const lazyOnlyIconFiles = new Set<string>();
const LUCIDE_ICON_MODULE = /[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/]/;
function lazyOnlyIcons(): Plugin {
  return {
    name: "lazy-only-icons",
    apply: "build",
    generateBundle(_options, bundle) {
      lazyOnlyIconFiles.clear();
      const staticallyImported = new Set<string>();
      for (const out of Object.values(bundle)) {
        if (out.type === "chunk") out.imports.forEach((f) => staticallyImported.add(f));
      }
      for (const out of Object.values(bundle)) {
        if (
          out.type === "chunk" &&
          !out.isEntry &&
          out.facadeModuleId &&
          LUCIDE_ICON_MODULE.test(out.facadeModuleId) &&
          !staticallyImported.has(out.fileName)
        ) {
          lazyOnlyIconFiles.add(out.fileName);
        }
      }
    },
  };
}

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
    consentGate(),
    lazyOnlyIcons(),
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
        manifestTransforms: [
          async (entries) => ({
            manifest: entries.filter((e) => !lazyOnlyIconFiles.has(e.url)),
            warnings: [],
          }),
        ],
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
          // lucide-react is deliberately NOT a manual chunk. ProfileIcon reaches
          // every icon through lucide's dynamicIconImports, so naming the
          // package here merged all ~1,500 icons into one 850 kB chunk that
          // index.html modulepreloaded on every page. Unnamed, Rollup keeps
          // the icons the app imports next to their users and gives each
          // name-only icon its own small lazy chunk (see lazyOnlyIcons).
          motion: ["framer-motion"],
          dates: ["date-fns"],
        },
      },
    },
  },
}));
