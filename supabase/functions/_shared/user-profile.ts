/**
 * Shared "who is the user" assembly.
 *
 * Ports the core of the MCP server's `get_user_profile` tool
 * (menerio-mcp/index.ts) into a reusable helper so the chat agents
 * (note-chat, conversation-chat) can inject the user's own profile and their
 * explicit agent instructions without duplicating the query logic.
 *
 * Deliberately compact: returns the user's current facts, by section (from
 * agent_facts), and their active agent_instructions. Skips linked-note bodies and the heavy
 * note-scanning relationship derivation — those are high-token and the chat
 * agents have dedicated person tools for relationship lookups.
 */

import { groupFactsBySection, labelOf, readFacts, type FactRow } from "./agent-facts.ts";

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
 * Fetch the current user's own current facts (never contacts', never a
 * `private` section) plus their active agent instructions. Returns empty arrays when the
 * user hasn't populated a profile yet.
 */
export async function getUserProfile(
  db: any,
  userId: string
): Promise<UserProfile> {
  const empty: UserProfile = { categories: [], agent_instructions: [] };

  // The user's own current facts, from agent_facts: never a private section,
  // never a contact's fact, never history. This goes into a chat prompt, so
  // it follows the assistants' rule. Grouped by section, each fact once.
  let rows: FactRow[] = [];
  try {
    rows = await readFacts(db, userId, { subjectType: "self" });
  } catch (err) {
    console.warn("[user-profile] fact load failed:", (err as Error).message);
  }
  const categories: UserProfileCategory[] = groupFactsBySection(rows).map((section) => ({
    name: section.name,
    slug: section.slug,
    entries: section.facts.map((f) => ({ label: labelOf(f), value: f.value })),
  }));

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
