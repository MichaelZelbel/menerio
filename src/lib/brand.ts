import { brandForId, type BrandConfig } from "@/brands";

// The active brand for this build. Resolved once per page load, so components
// may reference it freely (same contract as OFFLINE_CORE in lib/flags.ts).
//
// - Build-time: VITE_BRAND=cherishly npm run build  (defaults to menerio)
// - Dev-only override without a rebuild:
//     localStorage.setItem("menerio:brand", "cherishly"); location.reload()
const devOverride =
  import.meta.env.DEV && typeof localStorage !== "undefined"
    ? localStorage.getItem("menerio:brand")
    : null;

export const BRAND: BrandConfig = brandForId(
  devOverride ?? (import.meta.env.VITE_BRAND as string | undefined),
);

/**
 * Re-brand a page title: if it ends with the legacy " — Menerio" suffix
 * (any dash variant), swap that suffix for the active brand's. Titles
 * without the suffix pass through untouched, so brand-first marketing
 * titles keep their exact wording.
 */
export function applyBrandTitle(title: string, suffix: string = BRAND.titleSuffix): string {
  const legacySuffix = /\s*[—–-]\s*Menerio\s*$/i;
  return legacySuffix.test(title) ? title.replace(legacySuffix, "") + suffix : title;
}
