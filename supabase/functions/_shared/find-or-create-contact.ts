// One door for "this note mentions a person who is not in People yet".
//
// Every path that used to turn a name into a contact row inserted blindly:
// the bulk keep, the auto-apply in process-note, the single keep in the review
// queue and the event dialog. Two notes captured on 2026-09-04 each proposed
// the same twelve authors, one bulk keep created one row per suggestion, and
// twelve people existed twice in the owner's hub. Older pairs (April, July,
// August) had come the same way. The fix is not a unique index, because two
// different people can share a name; it is that creating a person first looks
// for the person, the way the MCP server's resolveOrCreateContactsByName
// always did.

export type ContactCandidate = {
  id: string;
  name: string;
  aliases: string[] | null;
  merged_into: string | null;
  created_at: string;
};

export function normalizePersonName(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function sameName(a: string, b: string): boolean {
  const x = normalizePersonName(a);
  const y = normalizePersonName(b);
  return x.length > 0 && x === y;
}

function oldest(rows: ContactCandidate[]): ContactCandidate | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || "")) || a.id.localeCompare(b.id)
  )[0];
}

/** The live contact that already carries this name, by name first and by alias
 *  second, oldest first when several exist so a third twin is never made. */
export function pickExistingContact(name: string, candidates: ContactCandidate[]): ContactCandidate | null {
  const live = candidates.filter((c) => !c.merged_into);
  const byName = live.filter((c) => sameName(c.name, name));
  const byAlias = live.filter((c) => !sameName(c.name, name) && (c.aliases || []).some((a) => sameName(a, name)));
  return oldest(byName) ?? oldest(byAlias);
}

const SELECT = "id, name, aliases, merged_into, created_at";

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => "\\" + ch);
}

/** Find the person by name or alias, and only create one when nobody carries
 *  the name. `created` says which happened, so a caller can word its outcome. */
// deno-lint-ignore no-explicit-any
export async function findOrCreateContact(db: any, userId: string, name: string): Promise<{ id: string; created: boolean }> {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("a person needs a name");

  const { data: byName, error: nameError } = await db
    .from("contacts")
    .select(SELECT)
    .eq("user_id", userId)
    .is("merged_into", null)
    .ilike("name", escapeLike(clean));
  if (nameError) throw nameError;

  // `contains` on a text[] is exact-spelling; pickExistingContact re-checks
  // case-insensitively, so this only narrows what is fetched.
  const { data: byAlias, error: aliasError } = await db
    .from("contacts")
    .select(SELECT)
    .eq("user_id", userId)
    .is("merged_into", null)
    .contains("aliases", [clean]);
  if (aliasError) throw aliasError;

  const hit = pickExistingContact(clean, [...(byName || []), ...(byAlias || [])]);
  if (hit) return { id: hit.id, created: false };

  const { data, error } = await db
    .from("contacts")
    .insert({ user_id: userId, name: clean })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, created: true };
}
