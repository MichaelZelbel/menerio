// Shared helpers for compute-connections / recompute-all-connections.
// Keeps person-matching alias-aware and topic-matching less noisy.

export type Contact = { id: string; name: string; aliases: string[] | null };

/** Generic topic strings that, on their own, should NOT trigger a shared_topic edge. */
export const GENERIC_TOPIC_STOPWORDS = new Set([
  "health",
  "work",
  "employment",
  "general",
  "notes",
  "personal",
  "life",
  "misc",
  "miscellaneous",
  "other",
  "travel",
  "daily",
  "thoughts",
  "ideas",
  "todo",
  "task",
  "tasks",
  "meeting",
  "meetings",
  "project",
  "projects",
  "people",
  "person",
]);

/** Build a map: lowercase alias/name -> canonical contact id. */
export function buildAliasMap(contacts: Contact[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of contacts) {
    const variants = [c.name, ...((c.aliases || []) as string[])].filter(Boolean);
    for (const v of variants) {
      const key = String(v).trim().toLowerCase();
      if (!key) continue;
      if (!map.has(key)) map.set(key, c.id);
    }
  }
  return map;
}

/**
 * Resolve a list of free-form people strings to a set of canonical identifiers.
 * Unknown names fall back to their lowercase form so historical behaviour still works.
 */
export function resolvePeople(people: string[] | undefined | null, aliasMap: Map<string, string>): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(people)) return out;
  for (const p of people) {
    const key = String(p || "").trim().toLowerCase();
    if (!key) continue;
    out.add(aliasMap.get(key) ?? `name:${key}`);
  }
  return out;
}

/** Returns the intersection size of two sets. */
export function intersectSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const v of a) if (b.has(v)) n++;
  return n;
}

/**
 * Decide whether two topic lists should form a shared_topic edge.
 * Rules:
 *   - >=3 shared (any) topics  -> strength 0.6
 *   - >=2 shared topics with at least one non-generic -> strength 0.4
 *   - 1 shared non-generic topic + caller-provided semanticAbove05 flag -> strength 0.3
 *   - otherwise no edge
 */
export function scoreSharedTopics(
  topicsA: string[],
  topicsB: string[],
  semanticAbove05: boolean,
): { strength: number; shared: string[] } | null {
  const setB = new Set(topicsB.map((t) => t.toLowerCase()));
  const shared = topicsA.filter((t) => setB.has(t.toLowerCase()));
  if (shared.length === 0) return null;

  const nonGeneric = shared.filter((t) => !GENERIC_TOPIC_STOPWORDS.has(t.toLowerCase()));

  if (shared.length >= 3) return { strength: 0.6, shared };
  if (shared.length >= 2 && nonGeneric.length >= 1) return { strength: 0.4, shared };
  if (shared.length >= 1 && nonGeneric.length >= 1 && semanticAbove05) {
    return { strength: 0.3, shared };
  }
  return null;
}
