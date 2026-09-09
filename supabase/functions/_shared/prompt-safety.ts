/**
 * Make untrusted stored text safe to place inside an LLM prompt.
 *
 * Split out of `group-ai.ts` so it can be tested. That module imports the
 * Supabase client from esm.sh, which the Node test runner cannot resolve, so
 * nothing here had a single test — and the bug below is exactly the kind that
 * only a test finds: `sanitizePromptData` recursed into arrays WITHOUT the key,
 * so every element of a string array was treated as a trusted field and reached
 * the model raw and untruncated. `contact_interactions.action_items` is
 * `string[]`, it is selected straight into the prompt by suggest-group-next-step,
 * and its contents are whatever the user last typed.
 *
 * This is defence in depth, not a boundary. It neutralises the sequences that
 * end a fenced block or a tagged section so stored text cannot close the
 * structure the prompt puts it in, and it caps length so one long field cannot
 * push the real instructions out of the window. It is not a claim that a model
 * cannot be talked into anything by well-formed prose.
 */

/**
 * Fields whose contents are user- or contact-authored prose. Anything not named
 * here is our own structured data (ids, enums, dates) and is passed through, so
 * adding a new free-text column to a prompt means adding it here too.
 */
const UNTRUSTED_TEXT_KEYS = new Set([
  "name",
  "title",
  "summary",
  "content",
  "description",
  "purpose",
  "company",
  "role",
  "notes",
  "reasoning",
  "action_items",
]);

export function sanitizePromptText(value: unknown, maxLength = 500): string {
  return String(value ?? "")
    .replace(/```/g, "'''")
    .replace(/`/g, "'")
    .replace(/"""/g, "'''")
    // `taggedPrompt` frames each section as <tag>…</tag>, and JSON.stringify does
    // not escape angle brackets, so stored text containing `</interactions>`
    // appeared to close the section and made everything after it read as prompt
    // rather than as data. Only the closing form can do that, and `</` does not
    // occur in ordinary prose, so putting a space in it costs nothing and removes
    // the sequence. Comparisons like "x > y" are left alone.
    .replace(/<\//g, "< /")
    .slice(0, maxLength);
}

export function sanitizePromptData<T>(value: T, key = ""): T {
  if (typeof value === "string") return (UNTRUSTED_TEXT_KEYS.has(key) ? sanitizePromptText(value) : value) as T;
  // The key travels into the array: a string in `summary: [...]` is the same
  // untrusted text as a string in `summary: "..."`. See the note at the top for
  // what recursing without it let through.
  if (Array.isArray(value)) return value.map((item) => sanitizePromptData(item, key)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, sanitizePromptData(entryValue, entryKey)]),
    ) as T;
  }
  return value;
}

export function taggedPrompt(sections: Record<string, unknown>): string {
  // Compact JSON. Indentation is billed per token and no human reads this
  // string; see the note on the same change in `profile-normalization.ts`.
  return Object.entries(sections)
    .map(([tag, value]) => `<${tag}>\n${JSON.stringify(sanitizePromptData(value))}\n</${tag}>`)
    .join("\n\n");
}

export function noteText(note: { title?: string | null; content?: string | null }): string {
  return `${sanitizePromptText(note.title || "Untitled")}: ${sanitizePromptText((note.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "))}`;
}
