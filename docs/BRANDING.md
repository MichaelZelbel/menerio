# Branding / white-label support

Menerio's codebase can be built as **different brands** ("skins"): same app,
same features, same backend — different name, domain, colors, and layout
emphasis. The reference example is **Cherishly** (cherishly.app), a
people-first skin of the same app that Menerio serves notes-first.

If you self-host Menerio, you can brand your own instance the same way.

## How it works

The brand is chosen **at build time** via the `VITE_BRAND` environment
variable and defaults to `menerio`:

```sh
npm run build                      # builds Menerio (the default, unchanged)
VITE_BRAND=cherishly npm run build # builds the Cherishly skin
```

Build-time (rather than runtime hostname sniffing) because brand values are
baked into artifacts that never execute JavaScript: the PWA manifest,
`index.html` meta tags, `robots.txt`, and icons.

For local development you can preview another brand without a rebuild
(dev server only):

```js
localStorage.setItem("menerio:brand", "cherishly"); location.reload();
// remove with localStorage.removeItem("menerio:brand")
```

## Where things live

| Path | Purpose |
| --- | --- |
| `src/brands/types.ts` | The `BrandConfig` interface — every brand knob, documented |
| `src/brands/menerio.ts`, `src/brands/cherishly.ts` | Brand definitions (pure data) |
| `src/brands/index.ts` | `brandForId()` — unknown/missing ids fall back to Menerio |
| `src/lib/brand.ts` | `BRAND`, the resolved config components import |
| `src/lib/brand-assets.ts` | Logo/mascot image bindings per brand |
| `src/index.css` | Theme token overrides under the brand's CSS class (e.g. `.brand-cherishly`) |
| `brands/<id>/public/` | Static file overlay copied over `dist/` at build time (robots.txt, icons, og-image) |
| `scripts/check-brand-strings.mjs` | CI guard against hardcoded brand strings |

`src/brands/*` must stay **pure data** (no `import.meta.env`, no asset
imports) because `vite.config.ts` imports it under Node to brand the PWA
manifest and `index.html`.

## Adding your own brand

1. Copy `src/brands/cherishly.ts` to `src/brands/<yourbrand>.ts`, adjust the
   values, and register it in `src/brands/index.ts` (and the `id` union in
   `types.ts`).
2. Add a `.brand-<yourbrand>` token block in `src/index.css` (colors, radius,
   shadows — everything is HSL CSS variables; see `.brand-cherishly` as the
   template). Set `themeClass: "brand-<yourbrand>"` in your config.
3. Put your logo in `src/assets/brands/<yourbrand>/` and bind it in
   `src/lib/brand-assets.ts`.
4. Create `brands/<yourbrand>/public/` with your `robots.txt`, `sitemap.xml`,
   favicon, PWA icons, and `og-image.png` (same filenames as `public/`).
5. Build with `VITE_BRAND=<yourbrand>` and deploy the `dist/` folder anywhere
   static hosting works. Point your domain at it.
6. Supabase: if you run your own backend, add your domain to the Auth
   redirect allowlist (all in-app redirects use `window.location.origin`).

## Rules for contributors (and AI agents)

- **Never hardcode** "Menerio", "menerio.com", `support@menerio.com`, or the
  assistant persona name "Mira" in `src/`. Import `BRAND` from `@/lib/brand`
  and use `BRAND.name`, `BRAND.domain`, `BRAND.supportEmail`,
  `BRAND.personaName`. Logos come from `@/lib/brand-assets`.
- **Page titles**: keep using `<SEOHead title="Page — Menerio" />`. SEOHead
  swaps the suffix for the active brand automatically; this exact form is
  sanctioned by the CI check.
- `index.html` and `public/` are Menerio-only and safe to edit — non-default
  brand builds transform/overlay them automatically.
- Theme colors must stay CSS-variable-driven (`hsl(var(--token))`); never
  hardcode hex colors in components.
- CI runs `node scripts/check-brand-strings.mjs`. It fails when a file gains
  new hardcoded brand strings beyond its allowlisted count
  (`scripts/brand-string-allowlist.json`). After refactoring strings away,
  shrink the allowlist with `node scripts/check-brand-strings.mjs --update`
  (counts should only go down).
