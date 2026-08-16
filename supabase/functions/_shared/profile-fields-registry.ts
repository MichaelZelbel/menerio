// Runtime overlay for the profile field vocabulary.
//
// `profile-canonical-schema.ts` is the static system default. This module reads
// the per-user `profile_fields` registry from the database so extraction
// pipelines (process-note, etc.) know about fields the user has already
// approved, without requiring a code redeploy.

export type ProfileFieldRow = {
  id: string;
  user_id: string | null;
  category_slug: string;
  canonical_label: string;
  cardinality: "single" | "list";
  value_type: string;
  aliases: string[];
  is_system: boolean;
  is_active: boolean;
};

function normalizeKey(label: string): string {
  return String(label || "")
    .trim()
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
    .toLowerCase();
}

/**
 * Load the effective field registry for a user. System fields (user_id IS NULL)
 * are overlaid with user-specific overrides so a user can shadow a system
 * definition if they ever need to.
 */
export async function loadProfileFields(
  db: { from: (table: string) => any },
  userId: string,
): Promise<ProfileFieldRow[]> {
  const { data, error } = await db
    .from("profile_fields")
    .select("id, user_id, category_slug, canonical_label, cardinality, value_type, aliases, is_system, is_active")
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq("is_active", true);
  if (error) {
    console.error("[profile-fields-registry] load failed", error);
    return [];
  }

  // User-specific fields take precedence over system fields for the same
  // category/label pair.
  const byKey = new Map<string, ProfileFieldRow>();
  for (const row of (data || []) as ProfileFieldRow[]) {
    const key = `${row.category_slug}:${normalizeKey(row.canonical_label)}`;
    const existing = byKey.get(key);
    if (!existing || (existing.user_id !== userId && row.user_id === userId)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

export class ProfileFieldsRegistry {
  private byCategoryAlias: Map<string, Map<string, ProfileFieldRow>> = new Map();
  private globalAlias: Map<string, { slug: string; field: ProfileFieldRow }> = new Map();

  constructor(public readonly rows: ProfileFieldRow[]) {
    for (const row of rows) {
      const slug = row.category_slug;
      if (!this.byCategoryAlias.has(slug)) {
        this.byCategoryAlias.set(slug, new Map());
      }
      const catMap = this.byCategoryAlias.get(slug)!;
      const canonKey = normalizeKey(row.canonical_label);
      catMap.set(canonKey, row);
      this.globalAlias.set(canonKey, { slug, field: row });
      for (const alias of row.aliases || []) {
        const aliasKey = normalizeKey(alias);
        if (aliasKey) {
          catMap.set(aliasKey, row);
          this.globalAlias.set(aliasKey, { slug, field: row });
        }
      }
    }
  }

  isKnown(categorySlug: string, label: string): boolean {
    const key = normalizeKey(label);
    if (!key) return false;
    const catMap = this.byCategoryAlias.get(categorySlug);
    if (catMap?.has(key)) return true;
    return this.globalAlias.has(key);
  }

  /**
   * Resolve a label to its canonical form using the registry. Falls back to the
   * input label if no match is found.
   */
  canonicalize(categorySlug: string, label: string): string {
    const key = normalizeKey(label);
    if (!key) return label;
    const catMap = this.byCategoryAlias.get(categorySlug);
    const hit = catMap?.get(key);
    if (hit) return hit.canonical_label;
    const global = this.globalAlias.get(key);
    if (global) return global.field.canonical_label;
    return label;
  }

  /**
   * True if the registry knows this label in ANY structured category. Used to
   * decide whether a freeform label should be treated as a known alias.
   */
  isKnownAnywhere(label: string): boolean {
    return this.globalAlias.has(normalizeKey(label));
  }
}
