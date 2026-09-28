// The MCP tools' fact logic (docs/plans/one-fact-store.md, 2.3 "MCP tools").
//
// Every read here goes through agent_facts: the MCP server answers an outside
// assistant, so it may only see what leaves the owner's view. No tool reads
// the claims table for facts, and nothing reads the retired entries table.
//
// The one write, add_claim, goes through writeFact like every other writer.
//
// Kept out of index.ts so the Node test runner can import it: index.ts pulls
// in Hono, the MCP transport and Deno globals.

import {
  factForAgent,
  factLine,
  groupFactsBySection,
  labelOf,
  readFacts,
  renderFactSections,
  type FactRow,
} from "../_shared/agent-facts.ts";
import { FactWritesPaused, writeFact, type FactSubject, type WriteResult } from "../_shared/fact-store.ts";
import { isReservedAttribute, normalizeAttribute } from "../_shared/claims.ts";

const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// ─── Entities by name ────────────────────────────────────────────────

export type EntityMatch = { entity: { id: string; name: string } } | { error: string };

/**
 * One entity by name or alias. An exact name or alias (case-insensitive) wins;
 * otherwise a single partial match is used; several are refused with their
 * ids, the way contacts are refused. "Acme" must not quietly mean "Acme Labs".
 */
export async function resolveEntityByName(db: any, userId: string, name: string): Promise<EntityMatch> {
  const needle = name.trim().toLowerCase();
  if (!needle) return { error: "subject_name is empty." };
  const { data, error } = await db.from("entities").select("id, name, aliases").eq("user_id", userId);
  if (error) return { error: `Could not load entities: ${error.message ?? "error"}` };
  const rows = (data ?? []) as Array<{ id: string; name: string; aliases?: string[] | null }>;
  const exact = rows.filter((e) =>
    String(e.name ?? "").trim().toLowerCase() === needle ||
    (Array.isArray(e.aliases) && e.aliases.some((a) => String(a ?? "").trim().toLowerCase() === needle)));
  const pool = exact.length ? exact : rows.filter((e) => String(e.name ?? "").toLowerCase().includes(needle));
  if (pool.length === 1) return { entity: { id: pool[0].id, name: pool[0].name } };
  if (pool.length === 0) return { error: `No entity found matching "${name.trim()}". Check the spelling with search_entities, or create it with create_entity.` };
  const listed = pool.slice(0, 5).map((e) => `${e.name} (id ${e.id})`).join("; ");
  return { error: `"${name.trim()}" matches more than one entity: ${listed}${pool.length > 5 ? "; and more" : ""}. Call again with subject_id.` };
}

// ─── get_claims ──────────────────────────────────────────────────────

export interface GetClaimsArgs {
  mode: "current" | "history" | "changed_since";
  since?: string;
  subjectType?: "self" | "contact" | "entity";
  /** Already resolved and checked by the caller. */
  subjectId?: string | null;
  attribute?: string;
  limit: number;
}

/** get_claims in every mode, from agent_facts. */
export async function getClaims(db: any, userId: string, args: GetClaimsArgs): Promise<Record<string, unknown>> {
  if (args.mode === "changed_since" && !(args.since && ISO_DAY.test(args.since))) {
    return { error: "mode 'changed_since' requires a `since` date (YYYY-MM-DD)." };
  }
  const rows = await readFacts(db, userId, {
    subjectType: args.subjectType,
    subjectIds: args.subjectId ? [args.subjectId] : undefined,
    attribute: args.attribute ? normalizeAttribute(args.attribute) : undefined,
    history: args.mode !== "current",
    changedSince: args.mode === "changed_since" ? args.since : undefined,
    limit: args.limit,
  });
  return { tool: "get_claims", mode: args.mode, count: rows.length, claims: rows.map(factForAgent) };
}

// ─── get_entity_context ──────────────────────────────────────────────

/** An entity's facts from agent_facts: a sensitive or hidden entity has none there. */
export async function entityFacts(db: any, userId: string, entityId: string, includeHistory: boolean) {
  const rows = await readFacts(db, userId, { subjectType: "entity", subjectIds: [entityId], history: includeHistory });
  const current = rows.filter((r) => r.is_current);
  const history = rows.filter((r) => !r.is_current);
  return {
    facts: current.map(factForAgent),
    history: includeHistory ? history.map(factForAgent) : undefined,
  };
}

// ─── get_contact_profile ─────────────────────────────────────────────

export interface ContactProfileArgs {
  contact: { id: string; name: string };
  detail: "curated" | "full";
  includeHistory: boolean;
  topicsSection?: string;
  today?: string;
}

/**
 * A contact's facts from agent_facts, grouped by section. One source, so every
 * fact prints once. 'curated' = the facts flagged to reach assistants; when
 * none is flagged the whole record comes back, and the answer says so.
 */
export async function contactProfileText(db: any, userId: string, args: ContactProfileArgs): Promise<string> {
  const { contact } = args;
  const read = (curated: boolean) =>
    readFacts(db, userId, { subjectType: "contact", subjectIds: [contact.id], curated, history: args.includeHistory });

  let curationApplied = args.detail === "curated";
  let rows: FactRow[] = await read(curationApplied);
  if (curationApplied && !rows.some((r) => r.is_current)) {
    curationApplied = false;
    rows = await read(false);
  }
  const current = rows.filter((r) => r.is_current);
  const notCurrent = rows.filter((r) => !r.is_current);

  const out: string[] = [`# ${contact.name} — Profile`];
  if (args.topicsSection) out.push(args.topicsSection);
  if (current.length === 0 && notCurrent.length === 0) {
    out.push("No facts recorded yet.");
    return out.join("\n");
  }
  for (const line of renderFactSections(current, { heading: "\n##", today: args.today })) out.push(line);
  if (current.some((r) => r.has_conflict)) {
    out.push(`\nA fact marked ${"TWO ANSWERS"} has more than one current value. Report every value; never pick one.`);
  }
  if (args.includeHistory && notCurrent.length) {
    out.push("\n## History (no longer true, or not true yet)");
    for (const row of groupFactsBySection(notCurrent).flatMap((s) => s.facts)) out.push(factLine(row, args.today));
  }
  if (args.detail === "curated" && !curationApplied) {
    out.push(`\n(No fact on ${contact.name} is flagged for agents yet, so this is the whole record.)`);
  } else if (curationApplied) {
    out.push(`\n(Curated view. Ask again with detail:"full" for every fact.)`);
  }
  if (!args.includeHistory) out.push(`(Current facts only. Ask again with include_history:true for what used to be true.)`);
  return out.join("\n");
}

// ─── get_contact_context and search_contacts ─────────────────────────

/** The profile block of get_contact_context: current facts, by section, capped. */
export async function contactContextLines(db: any, userId: string, contactId: string, max = 40, today?: string): Promise<string[]> {
  const rows = await readFacts(db, userId, { subjectType: "contact", subjectIds: [contactId] });
  if (!rows.length) return [];
  return ["", "## Profile", ...renderFactSections(rows, { heading: "###", max, today })];
}

/** Facts worth a line in a contact search hit. Matched on the label and on the attribute key. */
export const HIGHLIGHT_KEYS = new Set([
  "date of birth", "birthday", "nickname", "aliases", "ethnicity", "current city", "job title", "employer",
  "date-of-birth", "current-city", "job-title",
]);

/** Up to four highlight facts per contact, pinned ones first. */
export async function contactHighlights(db: any, userId: string, contactIds: string[], perContact = 4): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!contactIds.length) return out;
  const rows = await readFacts(db, userId, { subjectType: "contact", subjectIds: contactIds, limit: 2000 });
  const sorted = [...rows].sort((a, b) => Number(!!b.is_pinned) - Number(!!a.is_pinned));
  for (const r of sorted) {
    const label = labelOf(r);
    const hit = r.is_pinned || HIGHLIGHT_KEYS.has(label.trim().toLowerCase()) || HIGHLIGHT_KEYS.has(r.attribute);
    if (!hit || !r.subject_id) continue;
    const list = out.get(r.subject_id) ?? [];
    if (list.length >= perContact) continue;
    const line = `${label}: ${r.value}`;
    if (!list.includes(line)) list.push(line);
    out.set(r.subject_id, list);
  }
  return out;
}

// ─── get_user_profile ────────────────────────────────────────────────

export interface UserProfileArgs {
  scope?: string;
  categorySlugs?: string[];
  detail: "curated" | "full";
}

export interface UserProfileFacts {
  categories: Array<{ name: string; slug: string; entries: Array<Record<string, unknown>> }>;
  curationApplied: boolean;
  /** Note ids the facts came from, for include_notes. */
  noteIds: string[];
}

/** The user's own current facts from agent_facts, grouped by section. */
export async function userProfileFacts(db: any, userId: string, args: UserProfileArgs): Promise<UserProfileFacts> {
  const read = (curated: boolean) => readFacts(db, userId, {
    subjectType: "self",
    curated,
    categorySlugs: args.categorySlugs?.length ? args.categorySlugs : undefined,
    visibilityScopes: args.scope ? ["all", args.scope] : undefined,
  });
  let curationApplied = args.detail === "curated";
  let rows = await read(curationApplied);
  if (curationApplied && rows.length === 0) {
    curationApplied = false;
    rows = await read(false);
  }
  const categories = groupFactsBySection(rows).map((s) => ({
    name: s.name,
    slug: s.slug,
    entries: s.facts.map((r) => ({
      label: labelOf(r),
      value: r.value,
      has_linked_note: r.source_type === "note" && !!r.source_id,
      ...(r.source_type === "note" && r.source_id ? { linked_note_id: r.source_id } : {}),
      ...(r.valid_from ? { valid_from: r.valid_from } : {}),
      ...(r.has_conflict ? { two_answers: true } : {}),
    })),
  }));
  const noteIds = [...new Set(rows.filter((r) => r.source_type === "note" && r.source_id).map((r) => r.source_id as string))];
  return { categories, curationApplied, noteIds };
}

// ─── add_claim ───────────────────────────────────────────────────────

export interface AddClaimArgs {
  subject: FactSubject;
  attribute: string;
  value: string;
  evidenceQuote?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  confidence?: "certain" | "likely" | "unsure";
  sourceNoteId?: string | null;
}

const OUTCOME_TEXT: Record<string, string> = {
  inserted: "recorded",
  already_recorded: "already recorded; nothing changed",
  history_not_revived: "this value is already history for this subject; nothing changed",
  suppressed: "the user marked this value as wrong; not recorded",
  rejected: "refused",
};

/** The checks add_claim makes before it writes. Null when the call may go on. */
export function addClaimRefusal(args: Pick<AddClaimArgs, "attribute" | "value" | "evidenceQuote" | "validFrom" | "validTo">): string | null {
  if (isReservedAttribute(args.attribute)) {
    return "Relationships between people are not claims. Use the relationship path so canonical labels, inverses and the rejection ledger stay authoritative.";
  }
  if (!normalizeAttribute(args.attribute)) return "attribute is required.";
  if (!String(args.value ?? "").trim()) return "value is required.";
  if (String(args.evidenceQuote ?? "").trim().length < 10) {
    return "evidence_quote is required: the exact sentence this fact came from (at least 10 characters). Nothing was written.";
  }
  if (args.validFrom && !ISO_DAY.test(args.validFrom)) return "valid_from must be a date in YYYY-MM-DD form.";
  if (args.validTo) {
    return "add_claim records what is true now (optionally since valid_from). A fact that has already ended cannot be added here; nothing was written.";
  }
  return null;
}

/** add_claim: the checks, then writeFact as origin 'mcp'. Never throws for an expected refusal. */
export async function addClaim(db: any, userId: string, args: AddClaimArgs): Promise<Record<string, unknown>> {
  const refusal = addClaimRefusal(args);
  if (refusal) return { error: refusal };
  if (args.sourceNoteId) {
    if (!ID_SHAPE.test(args.sourceNoteId)) return { error: "source_note_id is not a note id." };
    const { data: note, error } = await db.from("notes").select("id").eq("user_id", userId).eq("id", args.sourceNoteId).maybeSingle();
    if (error) return { error: "Could not check the source note." };
    if (!note) return { error: "No note with that source_note_id in this account." };
  }
  let result: WriteResult;
  try {
    result = await writeFact(db, userId, {
      subject: args.subject,
      label: args.attribute,
      value: String(args.value).trim(),
      origin: "mcp",
      evidenceQuote: String(args.evidenceQuote).trim(),
      sourceType: args.sourceNoteId ? "note" : "ai",
      sourceId: args.sourceNoteId ?? null,
      validFrom: args.validFrom ?? null,
      confidence: args.confidence ?? "likely",
    }, { isHuman: false });
  } catch (err) {
    if (err instanceof FactWritesPaused) return { error: "Menerio is switching its fact store right now. Nothing was written; try again in a few minutes." };
    throw err;
  }
  const facts = result.facts.map((f) => ({
    attribute: f.attribute,
    outcome: OUTCOME_TEXT[f.outcome] ?? f.outcome,
    ...(f.claimId ? { claim_id: f.claimId } : {}),
    ...(f.closed ? { closed_previous: f.closed } : {}),
    ...(f.conflict ? { two_answers: "A current value this writer may not close stays alongside; both are shown until the user decides." } : {}),
    ...(f.reason ? { reason: f.reason } : {}),
  }));
  const recorded = result.facts.filter((f) => f.outcome === "inserted").length;
  const unchanged = result.facts.filter((f) => f.outcome === "already_recorded" || f.outcome === "history_not_revived").length;
  if (!result.ok && recorded === 0) {
    return { error: `Not recorded: ${result.facts.map((f) => f.reason ?? f.outcome).join(", ")}.`, facts };
  }
  return { tool: "add_claim", recorded, unchanged, facts };
}
