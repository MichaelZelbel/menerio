import menerioLogo from "@/assets/logo.png";
import cherishlyLogo from "@/assets/brands/cherishly/cherishly-logo.png";
import { BRAND } from "@/lib/brand";

// Image assets keyed by brand. Kept separate from src/brands/* because those
// files must stay importable by vite.config.ts (no Vite asset imports there).
const logos: Record<string, string> = {
  menerio: menerioLogo,
  cherishly: cherishlyLogo,
};

export const brandLogo = logos[BRAND.id] ?? menerioLogo;
