/**
 * The 17-slug profile category taxonomy: a HARD storage contract shared with
 * the server-side AI extraction pipeline (see
 * supabase/functions/_shared/profile-canonical-schema.ts and
 * profile-normalization.ts's `resolveCategoryId`). The pipeline files facts
 * into `profile_categories` rows by these exact slugs — an invalid slug is
 * dropped there, so slugs must never be renamed or removed here.
 *
 * This module is presentation-only: it supplies stable display metadata
 * (name, icon) and ordering for the contact profile UI. Names/icons mirror
 * the owner's 17-category seed list in `src/hooks/useProfile.ts`'s
 * `DEFAULT_CATEGORIES` so already-materialized categories (owner or contact)
 * render identically to before this redesign.
 */
export interface TaxonomyEntry {
  slug: string;
  name: string;
  icon: string;
}

export const PROFILE_TAXONOMY: TaxonomyEntry[] = [
  { slug: "identity", name: "Identity & Basics", icon: "user" },
  { slug: "location", name: "Location & Living", icon: "map-pin" },
  { slug: "professional", name: "Professional Life", icon: "briefcase" },
  { slug: "education", name: "Education", icon: "graduation-cap" },
  { slug: "relationships", name: "Relationships & Family", icon: "heart" },
  { slug: "communication", name: "Communication Style", icon: "message-circle" },
  { slug: "personality", name: "Personality & Values", icon: "compass" },
  { slug: "principles", name: "Principles & Operating System", icon: "book-open" },
  { slug: "health", name: "Health & Wellness", icon: "activity" },
  { slug: "hobbies", name: "Hobbies & Interests", icon: "palette" },
  { slug: "food", name: "Food & Drink", icon: "utensils" },
  { slug: "entertainment", name: "Music & Entertainment", icon: "music" },
  { slug: "travel", name: "Travel & Experiences", icon: "plane" },
  { slug: "digital", name: "Digital Life", icon: "monitor" },
  { slug: "financial", name: "Financial", icon: "wallet" },
  { slug: "goals", name: "Goals & Aspirations", icon: "target" },
  { slug: "preferences", name: "Preferences & Quirks", icon: "sliders-horizontal" },
];

export const taxonomyBySlug: Record<string, TaxonomyEntry> = Object.fromEntries(
  PROFILE_TAXONOMY.map((entry) => [entry.slug, entry]),
);

const orderBySlug: Record<string, number> = Object.fromEntries(
  PROFILE_TAXONOMY.map((entry, index) => [entry.slug, index]),
);

/** Unknown (non-taxonomy / custom) slugs sort after every known slug. */
export function taxonomyOrder(slug: string): number {
  return orderBySlug[slug] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Display comparator for category-like objects: known taxonomy slugs sort by
 * their canonical order; unknown (custom) slugs sort last, alphabetically by
 * name among themselves.
 */
export function compareCategoriesForDisplay(
  a: { slug: string; name: string },
  b: { slug: string; name: string },
): number {
  const orderDiff = taxonomyOrder(a.slug) - taxonomyOrder(b.slug);
  if (orderDiff !== 0) return orderDiff;
  return a.name.localeCompare(b.name);
}
