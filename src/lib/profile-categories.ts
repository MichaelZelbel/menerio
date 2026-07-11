import { supabase } from "@/integrations/supabase/client";
import { taxonomyBySlug, taxonomyOrder } from "@/lib/profile-taxonomy";

/**
 * Resolve (or create) a `profile_categories` row for (userId, contactId,
 * slug), returning its id. Client-side mirror of `resolveCategoryId` in
 * `supabase/functions/_shared/profile-normalization.ts` — same
 * select-then-insert-then-reselect-on-23505 race pattern, but seeded from
 * the local taxonomy's name/icon/order (falling back to a slug-derived
 * name for a non-taxonomy slug) instead of a generic "folder" fallback.
 *
 * Not yet called from any UI in this phase — CompactCategorySection only
 * renders for categories that already have entries (and therefore already
 * exist as rows), so there is no manual-add path that needs it today. It is
 * prepared here for Phase 4's AI quick-add box, which will create entries in
 * categories that may not be materialized yet.
 *
 * `(supabase as any)` casts below mirror the pattern already used in
 * `src/hooks/usePeople.ts` for columns the generated `types.ts` hasn't
 * caught up with (`profile_categories` here has no such gap today, but the
 * cast keeps this function consistent with its server-side counterpart,
 * which also treats the client as untyped `any`).
 */
export async function ensureProfileCategory(
  userId: string,
  contactId: string,
  slug: string,
): Promise<string> {
  const client = supabase as any;

  const selectExisting = () =>
    client
      .from("profile_categories")
      .select("id")
      .eq("user_id", userId)
      .eq("contact_id", contactId)
      .eq("slug", slug)
      .maybeSingle();

  const existing = await selectExisting();
  if (existing.error) throw existing.error;
  if (existing.data?.id) return existing.data.id as string;

  const meta = taxonomyBySlug[slug];
  const { data: created, error: insertError } = await client
    .from("profile_categories")
    .insert({
      user_id: userId,
      contact_id: contactId,
      slug,
      name: meta?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1),
      icon: meta?.icon ?? "folder",
      is_default: false,
      sort_order: taxonomyOrder(slug) === Number.MAX_SAFE_INTEGER ? 99 : taxonomyOrder(slug),
      visibility_scope: "all",
    })
    .select("id")
    .maybeSingle();
  if (created?.id) return created.id as string;

  // 23505 = unique_violation: another request created the same
  // (user_id, contact_id, slug) row concurrently. Any other error is real.
  if (insertError && (insertError as { code?: string }).code !== "23505") {
    throw insertError;
  }

  const raced = await selectExisting();
  if (raced.error) throw raced.error;
  if (raced.data?.id) return raced.data.id as string;

  throw new Error(`Failed to resolve profile category for slug "${slug}"`);
}
