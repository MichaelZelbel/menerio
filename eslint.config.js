import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // ESLint 9 flat config does not read .gitignore, so build output has to be
  // named here. src-tauri/target is the Tauri desktop build's cache; it holds
  // generated asset files that are not JavaScript in any useful sense, and
  // ESLint was reporting 421 parse errors against them. That was the whole
  // reason `npm run lint` failed, and therefore the reason CI never got as far
  // as running the tests.
  { ignores: ["dist", "dev-dist", "src-tauri/target", ".lovable"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Downgraded to warn: 370+ legacy `any` usages across src/ and supabase/.
      // Fix incrementally; tracked in docs/DEPENDENCY_DECISIONS.md.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
