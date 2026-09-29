// Reading facts (docs/plans/one-fact-store.md, 3.3 and 3.6).
//
// A fact is a claim. Two views read them:
//   - profile_facts: everything the owner may see, current and history;
//   - agent_facts: only what may leave the owner's view. No private section,
//     no hidden or sensitive person, no hidden or sensitive entity.
//
// One visibility rule: everything that leaves the owner's view (assistants,
// chats, search, Godspeed, LLM prompts) reads agent_facts. Only the owner's
// own exports (the private people vault) read profile_facts.
//
// The views filter nothing by user. Every caller here runs as the service
// role, which bypasses RLS, so every query below carries an explicit
// `.eq("user_id", userId)`. Nothing here puts a fact's value into an error
// message or a log line.
//
// Pure TypeScript with no Deno APIs, so the Node test runner imports it.

import { selectAllRows } from "./paged-select.ts";
import { CATEGORY_DISPLAY } from "./fact-placement.ts";

export type FactView = "agent_facts" | "profile_facts";

/** Every column both views have. */
export const FACT_COLUMNS =
  "claim_id, user_id, subject_type, subject_id, contact_id, attribute, value, valid_from, valid_to, is_current, " +
  "confidence, cardinality, origin, rank, evidence_quote, source_type, source_id, review_by, created_at, updated_at, " +
  "slot_id, label, category_slug, category_name, visibility_scope, is_pinned, show_to_agent, has_conflict";

export interface FactRow {
  claim_id: string;
  user_id: string;
  subject_type: "self" | "contact" | "entity";
  subject_id: string | null;
  contact_id: string | null;
  attribute: string;
  value: string;
  valid_from: string | null;
  valid_to: string | null;
  is_current: boolean | null;
  confidence: string | null;
  cardinality: string | null;
  origin: string | null;
  rank: string | null;
  evidence_quote: string | null;
  source_type: string | null;
  source_id: string | null;
  review_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  slot_id: string | null;
  label: string | null;
  category_slug: string | null;
  category_name: string | null;
  visibility_scope: string | null;
  is_pinned: boolean | null;
  show_to_agent: boolean | null;
  has_conflict: boolean | null;
}

export interface FactQuery {
  /** agent_facts unless the reader is the owner's own export. */
  view?: FactView;
  subjectType?: "self" | "contact" | "entity";
  /** Contact or entity ids. An empty list reads nothing. */
  subjectIds?: string[];
  /** true = current and history. Default: current rows only. */
  history?: boolean;
  /** true = only the facts the owner flagged to reach assistants unasked. */
  curated?: boolean;
  attribute?: string;
  categorySlugs?: string[];
  visibilityScopes?: string[];
  /** YYYY-MM-DD: facts that started or ended on or after this day. */
  changedSince?: string;
  /** Row cap. Without one every matching row is read, page by page. */
  limit?: number;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CHUNK = 200;
/** PostgREST's row cap per response on Supabase. */
const SERVER_ROW_CAP = 1000;

/** Read facts. Throws when the read fails: a reader that swallowed the error would answer "nothing recorded". */
export async function readFacts(db: any, userId: string, q: FactQuery = {}): Promise<FactRow[]> {
  if (!userId) throw new Error("readFacts: no user");
  const view: FactView = q.view ?? "agent_facts";
  if (q.subjectIds && q.subjectIds.length === 0) return [];
  if (q.changedSince && !ISO_DAY.test(q.changedSince)) throw new Error("changed_since must be a date in YYYY-MM-DD form");

  const build = (ids?: string[]) => {
    let b = db.from(view).select(FACT_COLUMNS).eq("user_id", userId);
    if (q.subjectType) b = b.eq("subject_type", q.subjectType);
    if (q.subjectType === "self") b = b.is("subject_id", null);
    if (ids) b = ids.length === 1 ? b.eq("subject_id", ids[0]) : b.in("subject_id", ids);
    if (!q.history) b = b.eq("is_current", true);
    if (q.curated) b = b.eq("show_to_agent", true);
    if (q.attribute) b = b.eq("attribute", q.attribute);
    if (q.categorySlugs?.length) b = b.in("category_slug", q.categorySlugs);
    if (q.visibilityScopes?.length) b = b.in("visibility_scope", q.visibilityScopes);
    if (q.changedSince) b = b.or(`valid_from.gte.${q.changedSince},valid_to.gte.${q.changedSince}`);
    return b
      .order("attribute", { ascending: true })
      .order("valid_from", { ascending: false, nullsFirst: false })
      .order("claim_id", { ascending: true });
  };

  const run = async (ids?: string[]): Promise<FactRow[]> => {
    if (q.limit && q.limit <= SERVER_ROW_CAP) {
      const { data, error } = await build(ids).limit(q.limit);
      if (error) throw new Error(`Could not read facts: ${error.message ?? "error"}`);
      return (data ?? []) as FactRow[];
    }
    if (q.limit) {
      // A cap above the server's own (search_contacts asks for 2,000) was cut
      // to 1,000 without a word: read it page by page instead.
      const out: FactRow[] = [];
      while (out.length < q.limit) {
        const want = Math.min(SERVER_ROW_CAP, q.limit - out.length);
        const { data, error } = await build(ids).range(out.length, out.length + want - 1);
        if (error) throw new Error(`Could not read facts: ${error.message ?? "error"}`);
        const rows = (data ?? []) as FactRow[];
        if (rows.length === 0) break;
        out.push(...rows);
      }
      return out;
    }
    try {
      return await selectAllRows<FactRow>((from, to) => build(ids).range(from, to));
    } catch (err) {
      throw new Error(`Could not read facts: ${(err as { message?: string })?.message ?? "error"}`);
    }
  };

  if (!q.subjectIds || q.subjectIds.length <= CHUNK) {
    const rows = await run(q.subjectIds);
    return q.limit ? rows.slice(0, q.limit) : rows;
  }
  const out: FactRow[] = [];
  for (let i = 0; i < q.subjectIds.length; i += CHUNK) {
    out.push(...await run(q.subjectIds.slice(i, i + CHUNK)));
    if (q.limit && out.length >= q.limit) break;
  }
  return q.limit ? out.slice(0, q.limit) : out;
}

// ─── Sections ────────────────────────────────────────────────────────

const SECTION_ORDER = Object.keys(CATEGORY_DISPLAY);
export const OTHER_SECTION = { slug: "other", name: "Other" };

/** The section a fact is filed under: the subject's own section name, else the taxonomy's, else "Other". */
export function sectionOf(row: Pick<FactRow, "category_slug" | "category_name">): { slug: string; name: string } {
  const slug = (row.category_slug ?? "").trim();
  if (!slug) return OTHER_SECTION;
  const name = (row.category_name ?? "").trim() || CATEGORY_DISPLAY[slug]?.name ||
    slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  return { slug, name };
}

export function labelOf(row: Pick<FactRow, "label" | "attribute">): string {
  const label = (row.label ?? "").trim();
  if (label) return label;
  return String(row.attribute ?? "").replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Each claim once. The views cannot repeat a claim; a caller that merged two reads could. */
export function uniqueFacts<T extends Pick<FactRow, "claim_id">>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.claim_id) ? false : (seen.add(r.claim_id), true)));
}

function sectionRank(slug: string): number {
  if (slug === OTHER_SECTION.slug) return SECTION_ORDER.length + 1;
  const i = SECTION_ORDER.indexOf(slug);
  return i === -1 ? SECTION_ORDER.length : i;
}

export interface FactSection<T = FactRow> {
  slug: string;
  name: string;
  facts: T[];
}

/**
 * Facts grouped by section, each claim once. Sections in taxonomy order, then
 * the subject's own sections by name, then "Other". Inside a section: pinned
 * first, then by label, current before history, newest first.
 */
export function groupFactsBySection<T extends FactRow>(rows: T[]): FactSection<T>[] {
  const bySlug = new Map<string, FactSection<T>>();
  for (const row of uniqueFacts(rows)) {
    const { slug, name } = sectionOf(row);
    const section = bySlug.get(slug) ?? { slug, name, facts: [] };
    section.facts.push(row);
    bySlug.set(slug, section);
  }
  const sections = [...bySlug.values()].sort((a, b) =>
    sectionRank(a.slug) - sectionRank(b.slug) || a.name.localeCompare(b.name));
  for (const s of sections) {
    s.facts.sort((a, b) =>
      Number(!!b.is_pinned) - Number(!!a.is_pinned) ||
      labelOf(a).localeCompare(labelOf(b)) ||
      Number(!!b.is_current) - Number(!!a.is_current) ||
      String(b.valid_from ?? "").localeCompare(String(a.valid_from ?? "")));
  }
  return sections;
}

// ─── Printing ────────────────────────────────────────────────────────

export const TWO_ANSWERS_NOTE = "TWO ANSWERS: report every value, do not pick one";

/** One line per fact: label, value, dates when there are any, and the two-answers flag. */
export function factLine(row: FactRow, today?: string): string {
  let line = `- ${labelOf(row)}: ${row.value}`;
  if (row.valid_from || row.valid_to) line += ` (${row.valid_from ?? "always"} to ${row.valid_to ?? "now"})`;
  if (row.is_current === false) {
    line += row.valid_to && (!today || row.valid_to <= today) ? " [no longer true]" : " [not true yet]";
  }
  if (row.is_current !== false && today && row.review_by && row.review_by <= today) {
    line += ` [not confirmed since ${row.review_by}]`;
  }
  if (row.has_conflict && row.is_current !== false) line += ` [${TWO_ANSWERS_NOTE}]`;
  return line;
}

/**
 * Sections as Markdown lines. `max` caps the facts printed; the cut is said,
 * never silent.
 */
export function renderFactSections(rows: FactRow[], opts: { heading?: string; max?: number; today?: string } = {}): string[] {
  const heading = opts.heading ?? "##";
  const out: string[] = [];
  let printed = 0;
  const total = uniqueFacts(rows).length;
  for (const section of groupFactsBySection(rows)) {
    if (opts.max !== undefined && printed >= opts.max) break;
    out.push(`${heading} ${section.name}`);
    for (const row of section.facts) {
      if (opts.max !== undefined && printed >= opts.max) break;
      out.push(factLine(row, opts.today));
      printed++;
    }
  }
  if (printed < total) out.push(`(${total - printed} more fact(s) not shown)`);
  return out;
}

/** A fact as a JSON tool returns it. `id` is the claim id, as before. */
export function factForAgent(row: FactRow): Record<string, unknown> {
  return {
    id: row.claim_id,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    attribute: row.attribute,
    label: labelOf(row),
    section: sectionOf(row).name,
    value: row.value,
    valid_from: row.valid_from,
    valid_to: row.valid_to,
    is_current: row.is_current,
    confidence: row.confidence,
    cardinality: row.cardinality,
    rank: row.rank,
    written_by: row.origin === "user_manual" ? "human" : "machine",
    evidence_quote: row.evidence_quote,
    source_type: row.source_type,
    source_id: row.source_id,
    review_by: row.review_by,
    ...(row.has_conflict ? { two_answers: true, two_answers_note: TWO_ANSWERS_NOTE } : {}),
  };
}

// ─── People an assistant may see ─────────────────────────────────────

/**
 * Of these contacts, the ones an assistant may see: this user's, not merged
 * away, visible, not sensitive. The same rule agent_facts applies to facts,
 * for the things that are not facts (relationships). Fails closed.
 */
export async function assistantVisibleContactIds(db: any, userId: string, ids: string[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter(Boolean))];
  const ok = new Set<string>();
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const { data, error } = await db
      .from("contacts")
      .select("id")
      .eq("user_id", userId)
      .in("id", wanted.slice(i, i + CHUNK))
      .is("merged_into", null)
      .eq("ai_visibility", "visible")
      .or("is_sensitive.is.null,is_sensitive.eq.false");
    if (error) throw new Error(`Could not check who is visible: ${error.message ?? "error"}`);
    for (const c of data ?? []) ok.add(c.id);
  }
  return ok;
}

// ─── Embedding ───────────────────────────────────────────────────────

export interface EmbeddingCandidate {
  claim_id: string;
  attribute: string;
  value: string;
  evidence_quote: string | null;
}

/**
 * Claims of this user that have no embedding and that an assistant may see
 * (current or not). Embedding sends the words to the provider, so a fact in a
 * private section, or about a hidden or sensitive person or entity, is never
 * a candidate. Newest first; `total` counts every candidate, for "remaining".
 */
export async function embeddingCandidates(db: any, userId: string, max: number): Promise<{ candidates: EmbeddingCandidate[]; total: number }> {
  const unembedded = await selectAllRows<{ id: string }>((from, to) =>
    db.from("claims").select("id").eq("user_id", userId).is("embedding", null)
      .order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to));
  const order = new Map(unembedded.map((r, i) => [r.id, i]));
  const eligible: EmbeddingCandidate[] = [];
  const ids = [...order.keys()];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db
      .from("agent_facts")
      .select("claim_id, attribute, value, evidence_quote")
      .eq("user_id", userId)
      .in("claim_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`Could not read embedding candidates: ${error.message ?? "error"}`);
    eligible.push(...((data ?? []) as EmbeddingCandidate[]));
  }
  eligible.sort((a, b) => (order.get(a.claim_id) ?? 0) - (order.get(b.claim_id) ?? 0));
  return { candidates: eligible.slice(0, Math.max(0, max)), total: eligible.length };
}

/** The text a claim is embedded as: the triple, and the sentence it came from when there is one. */
export function embeddingText(c: { attribute: string; value: string; evidence_quote: string | null }): string {
  const triple = `${c.attribute}: ${c.value}`;
  return c.evidence_quote ? `${triple}\n${c.evidence_quote}` : triple;
}
