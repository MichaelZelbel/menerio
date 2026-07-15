/**
 * Shared "who is the user" assembly.
 *
 * Ports the core of the MCP server's `get_user_profile` tool
 * (open-brain-mcp/index.ts) into a reusable helper so the chat agents
 * (note-chat, conversation-chat) can inject the user's own profile and their
 * explicit agent instructions without duplicating the query logic.
 *
 * Deliberately compact: returns the user's profile categories + entries and
 * their active agent_instructions. Skips linked-note bodies and the heavy
 * note-scanning relationship derivation — those are high-token and the chat
 * agents have dedicated person tools for relationship lookups.
 */

export interface UserProfileEntry {
  label: string;
  value: string;
}

export interface UserProfileCategory {
  name: string;
  slug: string;
  entries: UserProfileEntry[];
}

export interface UserProfile {
  categories: UserProfileCategory[];
  agent_instructions: string[];
}

/**
 * Fetch the current user's own profile (never contacts', never `private`
 * scope) plus their active agent instructions. Returns empty arrays when the
 * user hasn't populated a profile yet.
 */
export async function getUserProfile(
  db: any,
  userId: string
): Promise<UserProfile> {
  const empty: UserProfile = { categories: [], agent_instructions: [] };

  // Categories: the user's own profile (contact_id IS NULL), excluding private.
  const { data: cats, error: catErr } = await db
    .from("profile_categories")
    .select("id, name, slug, visibility_scope, sort_order")
    .eq("user_id", userId)
    .is("contact_id", null)
    .neq("visibility_scope", "private")
    .order("sort_order");
  if (catErr) {
    console.warn("[user-profile] category load failed:", catErr.message);
  }

  const filteredCats = (cats || []) as any[];
  const catIds = filteredCats.map((c) => c.id);

  let entries: any[] = [];
  if (catIds.length > 0) {
    const { data: entryRows } = await db
      .from("profile_entries")
      .select("category_id, label, value, sort_order")
      .eq("user_id", userId)
      .is("contact_id", null)
      .in("category_id", catIds)
      .order("sort_order");
    entries = (entryRows || []) as any[];
  }

  // Collapse categories that share a slug; dedupe entries by (label, value).
  const slugOrder: string[] = [];
  const slugBuckets = new Map<string, { name: string; slug: string; catIds: Set<string> }>();
  for (const cat of filteredCats) {
    const slug = cat.slug || cat.id;
    if (!slugBuckets.has(slug)) {
      slugBuckets.set(slug, { name: cat.name, slug, catIds: new Set([cat.id]) });
      slugOrder.push(slug);
    } else {
      slugBuckets.get(slug)!.catIds.add(cat.id);
    }
  }

  const categories: UserProfileCategory[] = [];
  for (const slug of slugOrder) {
    const bucket = slugBuckets.get(slug)!;
    const seen = new Set<string>();
    const catEntries: UserProfileEntry[] = [];
    for (const e of entries) {
      if (!bucket.catIds.has(e.category_id)) continue;
      const key = `${String(e.label ?? "").trim().toLowerCase()}\u0000${String(e.value ?? "").trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      catEntries.push({ label: e.label, value: e.value });
    }
    if (catEntries.length > 0) {
      categories.push({ name: bucket.name, slug: bucket.slug, entries: catEntries });
    }
  }

  // Active agent instructions (never `private`).
  const { data: insts } = await db
    .from("agent_instructions")
    .select("instruction, applies_to")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("sort_order");
  const agent_instructions = ((insts || []) as any[])
    .filter((i) => i.applies_to !== "private")
    .map((i) => i.instruction)
    .filter((s) => typeof s === "string" && s.trim().length > 0);

  if (categories.length === 0 && agent_instructions.length === 0) return empty;
  return { categories, agent_instructions };
}

/**
 * Render a compact, size-capped digest of the user's profile for injection
 * into a system prompt. `agent_instructions` are always included in full
 * (high-value, low-token); profile facts are truncated to `maxFactChars`.
 * Returns "" when there's nothing worth injecting.
 */
export function formatUserProfileDigest(
  profile: UserProfile,
  maxFactChars = 2000
): string {
  if (!profile) return "";
  const parts: string[] = [];

  if (profile.agent_instructions.length > 0) {
    parts.push(
      "The user has given these standing instructions for how you should behave — follow them:\n" +
        profile.agent_instructions.map((i) => `- ${i}`).join("\n")
    );
  }

  if (profile.categories.length > 0) {
    let facts = "";
    outer: for (const cat of profile.categories) {
      const lines: string[] = [`${cat.name}:`];
      for (const e of cat.entries) {
        lines.push(`  - ${e.label}: ${e.value}`);
      }
      const block = lines.join("\n") + "\n";
      if (facts.length + block.length > maxFactChars) {
        facts += "  (…more profile facts omitted…)\n";
        break outer;
      }
      facts += block;
    }
    if (facts.trim().length > 0) {
      parts.push("What you know about the user (their profile):\n" + facts.trim());
    }
  }

  if (parts.length === 0) return "";
  return `\n\n--- ABOUT THE USER ---\n${parts.join("\n\n")}\n--- END ABOUT THE USER ---`;
}
