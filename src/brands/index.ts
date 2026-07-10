import type { BrandConfig } from "./types";
import { MENERIO } from "./menerio";
import { CHERISHLY } from "./cherishly";

export const BRANDS: Record<string, BrandConfig> = {
  menerio: MENERIO,
  cherishly: CHERISHLY,
};

/** Resolve a brand id to its config; anything unknown falls back to Menerio. */
export function brandForId(id?: string | null): BrandConfig {
  return (id && BRANDS[id]) || MENERIO;
}

export type { BrandConfig };
