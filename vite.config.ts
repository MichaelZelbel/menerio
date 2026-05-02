import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
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
  plugins: [react()],
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
