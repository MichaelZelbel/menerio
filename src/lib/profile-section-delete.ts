/**
 * Delete one profile section (docs/plans/one-fact-store.md 3.2: "deleting a
 * section no longer deletes facts; they fall back to Other").
 *
 * A fact's section lives on its slot as a slug, so the slots of that subject
 * are moved to "Other" first. Otherwise the page rebuilds a nameless section
 * from the old slug that cannot be deleted, and a new section with the same
 * slug later (possibly a private one) silently takes those facts in.
 *
 * A private section is left to the database: while facts sit in it, its guard
 * refuses the delete (moving them to "Other" would show them to assistants).
 */
export async function deleteProfileSection(db: any, id: string): Promise<void> {
  const { data: section, error: readError } = await db.from("profile_categories")
    .select("id, user_id, contact_id, slug, visibility_scope").eq("id", id).maybeSingle();
  if (readError) throw readError;
  if (section && section.visibility_scope !== "private" && section.slug) {
    let slots = db.from("fact_slots").update({ category_slug: null })
      .eq("user_id", section.user_id).eq("category_slug", section.slug)
      .eq("subject_type", section.contact_id ? "contact" : "self");
    slots = section.contact_id ? slots.eq("subject_id", section.contact_id) : slots.is("subject_id", null);
    const { error } = await slots;
    if (error) throw error;
  }
  const { error } = await db.from("profile_categories").delete().eq("id", id);
  if (error) {
    // The guard's own text ("private_section_not_empty: ...") is not a sentence.
    if (String(error.message ?? "").startsWith("private_section_not_empty")) {
      throw new Error("A private section that still holds facts cannot be deleted. Move or remove its facts first.");
    }
    throw error;
  }
}
