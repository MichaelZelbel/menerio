// The one way a fact is added (docs/plans/one-fact-store.md, 3.5).
//
// A fact is a claim. Adding one is the only operation that needs shared
// logic: clean the label, split a bag into single facts, refuse what the user
// said is wrong, find or make the slot that shows the attribute, and decide
// what a new value does to the current one. Everything else (end, correct,
// retract, re-file) is a plain row write guarded by RLS and the claim triggers.
//
// planFacts() decides and is pure. writeFact() reads what planFacts needs,
// applies its plan and reports what happened. Nothing here puts a fact's value
// into an error message or a log line.
//
// Human or machine is decided by the client: writeFact() called with a client
// built from the user's JWT is a human (auth.uid() is set, the words guard
// treats the write as theirs); called with the service role it is a machine.

import { gateStoredValue } from "./profile-fact-gate.ts";
import { cleanIncomingFact } from "./fact-input.ts";
import { isReservedAttribute, normalizeAttribute, reviewByFor } from "./claims.ts";
import { placeClaim } from "./fact-placement.ts";
import { isListValuedLabel } from "./profile-canonical-schema.ts";
import { selectAllRows } from "./paged-select.ts";

export type SubjectType = "self" | "contact" | "entity";
export type FactOrigin =
  | "user_manual" | "ai_note" | "ai_moment" | "ai_lexicon" | "review_queue" | "import" | "mcp" | "api" | "normalizer";
export type FactSourceType = "note" | "moment" | "manual" | "ai" | "lexicon";

export interface FactSubject {
  type: SubjectType;
  /** NULL for self. */
  id: string | null;
}

export interface FactInput {
  subject: FactSubject;
  /** What the user or the extractor called it, e.g. "Favourite foods". */
  label: string;
  /**
   * The attribute key, when the caller already knows it ("It changed" on an
   * existing slot). Then the label is not re-derived into a key, and the value
   * is not split: an old slot keyed "languages" must not become "language".
   */
  attribute?: string | null;
  value: string;
  origin: FactOrigin;
  /** The section the caller suggests; the slot keeps its own once it exists. */
  categorySlug?: string | null;
  evidenceQuote?: string | null;
  sourceType?: FactSourceType | null;
  sourceId?: string | null;
  /** "It changed on …": the new value starts here and the old one ends here. */
  validFrom?: string | null;
  confidence?: "certain" | "likely" | "unsure";
  isPinned?: boolean;
}

export interface ExistingClaim {
  id: string;
  attribute: string;
  value: string;
  valid_from: string | null;
  valid_to: string | null;
  rank: "preferred" | "normal";
}

export interface ExistingSlot {
  attribute: string;
  cardinality: "one" | "many" | null;
  category_slug?: string | null;
}

export interface PlanContext {
  /** Every claim of the subject for the attributes involved, current and history. */
  claims: ExistingClaim[];
  slots: ExistingSlot[];
  /** attribute_rules: attribute → cardinality. */
  rules: Record<string, "one" | "many">;
  /** Suppression keys of this user for suggestion_type 'claim'. */
  suppressed: Set<string>;
  isHuman: boolean;
  /** The user's today, YYYY-MM-DD. */
  today: string;
}

export type PieceOutcome =
  | {
    kind: "insert"; attribute: string; label: string; categorySlug: string; value: string; cardinality: "one" | "many";
    close: string[]; closeOn: string;
    /** The first day of the next value already on file: the new one ends there (null: open-ended). */
    endsOn: string | null;
    conflict: boolean;
  }
  | { kind: "already_recorded"; attribute: string; claimId: string }
  | { kind: "history_not_revived"; attribute: string; claimId: string }
  | { kind: "suppressed"; attribute: string }
  | { kind: "rejected"; attribute: string | null; reason: string };

const AUTOMATED: ReadonlySet<FactOrigin> = new Set(["ai_note", "ai_moment", "ai_lexicon", "mcp", "api", "import", "normalizer"]);

export const norm = (value: string) => String(value ?? "").trim().toLowerCase();

export function suppressionKey(subject: FactSubject, attribute: string, value: string): string {
  return `${subject.type}:${subject.id ?? ""}:${attribute}:${norm(value)}`;
}

/**
 * Whether a suggested fact is already on file for its subject, or was called
 * wrong. For suggestion lists built by a model that was shown agent_facts
 * only: it never saw a fact in a private section, so it suggested that value
 * again, into a public section, where accepting it handed it to every
 * assistant. `known` is the subject's current rows from profile_facts (the
 * owner's view, private included). A private value is matched under any
 * label, since the model names attributes its own way; any other value under
 * the same attribute. Pure.
 */
export function suggestionAlreadyKnown(
  subject: FactSubject,
  suggestion: { label: string; value: string },
  known: Array<{ attribute: string; value: string; visibility_scope?: string | null }>,
  suppressed: ReadonlySet<string>,
): boolean {
  const value = norm(suggestion.value).replace(/\s+/g, " ");
  if (!value) return false;
  const attribute = normalizeAttribute(suggestion.label);
  if (suppressed.has(suppressionKey(subject, attribute, suggestion.value))) return true;
  return known.some((k) => {
    if (norm(k.value).replace(/\s+/g, " ") !== value) return false;
    return k.visibility_scope === "private" || k.attribute === attribute;
  });
}

/** The single facts a value holds, each with the label and section it belongs under. */
export function piecesOf(input: FactInput): Array<{ label: string; categorySlug: string; value: string }> | { reason: string } {
  if (input.attribute) {
    const value = String(input.value ?? "").trim();
    if (!value) return { reason: "empty_after_guards" };
    return [{ label: input.label, categorySlug: input.categorySlug ?? "", value }];
  }
  const clean = cleanIncomingFact(input.categorySlug ?? "", input.label, input.value);
  if (!clean.ok) return { reason: clean.reason };
  const { fact } = clean;
  const routed = gateStoredValue({ label: fact.label, categorySlug: fact.categorySlug, value: fact.value });
  const pieces: Array<{ label: string; categorySlug: string; value: string }> = [];
  for (const r of routed) {
    if (r.accepted) pieces.push({ label: r.label, categorySlug: r.categorySlug, value: r.value });
    // A human's own words are kept even when the splitter cannot file them;
    // a machine's unfileable fragment is dropped (it would be a guess).
    else if (input.origin === "user_manual" && r.value.trim()) pieces.push({ label: fact.label, categorySlug: fact.categorySlug, value: r.value.trim() });
  }
  if (pieces.length === 0) return { reason: "nothing_fileable" };
  return pieces;
}

/**
 * Decide what adding this fact does. Pure.
 *
 * - The same value already current: nothing (already_recorded).
 * - A value the user said is wrong: refused (suppressed).
 * - A machine never brings back a value that is already history.
 * - One value per attribute ('one', from the slot, else attribute_rules, else
 *   'one'): the new value closes the current ones at validFrom or today. A
 *   machine never closes a human's value; it is added alongside and shows as
 *   two answers until someone decides. A value on file that starts later (a
 *   later change, or one planned for a future day) ends the new one on its
 *   first day, so an old note read again goes into history instead of
 *   standing beside today's value as a second answer.
 * - Several values ('many'): added.
 */
export function planFacts(input: FactInput, ctx: PlanContext): PieceOutcome[] {
  // Counted in code points, as the database's length() counts them.
  if (AUTOMATED.has(input.origin) && [...norm(input.evidenceQuote ?? "")].length < 10) {
    return [{ kind: "rejected", attribute: null, reason: "evidence_required" }];
  }
  if (input.validFrom && !/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom)) {
    return [{ kind: "rejected", attribute: null, reason: "bad_date" }];
  }
  const pieces = piecesOf(input);
  if (!Array.isArray(pieces)) return [{ kind: "rejected", attribute: null, reason: pieces.reason }];

  const out: PieceOutcome[] = [];
  const planned = new Map<string, string[]>(); // attribute → values planned in this call
  for (const piece of pieces) {
    const attribute = input.attribute ? input.attribute : normalizeAttribute(piece.label);
    if (!attribute) { out.push({ kind: "rejected", attribute: null, reason: "empty_attribute" }); continue; }
    if (isReservedAttribute(attribute)) { out.push({ kind: "rejected", attribute, reason: "relationships_are_links" }); continue; }
    // "Do not suggest again" binds machines. A person typing the value is not a suggestion.
    if (!ctx.isHuman && ctx.suppressed.has(suppressionKey(input.subject, attribute, piece.value))) { out.push({ kind: "suppressed", attribute }); continue; }

    const mine = ctx.claims.filter((c) => c.attribute === attribute);
    const same = mine.filter((c) => norm(c.value) === norm(piece.value));
    const sameCurrent = same.find((c) => c.valid_to === null);
    if (sameCurrent) { out.push({ kind: "already_recorded", attribute, claimId: sameCurrent.id }); continue; }
    if (!ctx.isHuman && same.length > 0) {
      // Re-processing an old note must not put "Berlin" back and close "London".
      out.push({ kind: "history_not_revived", attribute, claimId: same[0].id });
      continue;
    }
    const alsoPlanned = planned.get(attribute) ?? [];
    if (alsoPlanned.includes(norm(piece.value))) continue;

    const slot = ctx.slots.find((s) => s.attribute === attribute);
    // Several pieces of one bag under one attribute mean the attribute holds several.
    // attribute_rules is keyed by the plural ("languages") while the canonical
    // label is singular ("Language"), so the canonical list-valued labels count too.
    const cardinality = slot?.cardinality ?? ctx.rules[attribute] ??
      (isListValuedLabel(piece.label) || pieces.filter((p) => normalizeAttribute(p.label) === attribute).length > 1 ? "many" : "one");
    const closeOn = input.validFrom ?? ctx.today;
    let close: string[] = [];
    let conflict = false;
    let endsOn: string | null = null;
    if (cardinality === "one") {
      // The live values that started on or before the new one's day (a value that
      // starts later is left alone). "On": a second change the same day replaces
      // the first, which otherwise stayed current beside it (eleventh review).
      const current = mine.filter((c) => c.valid_to === null && (c.valid_from === null || c.valid_from <= closeOn));
      const closable = current.filter((c) => ctx.isHuman || c.rank !== "preferred");
      close = closable.map((c) => c.id);
      conflict = closable.length < current.length || alsoPlanned.length > 0;
      // A value that starts later is left alone, and it ends this one on its
      // first day. Without the end both were current once that day came, and
      // an old note read again ("moved to London in 2019" beside "Berlin since
      // 2021") stood as a second answer that no caller was told about.
      endsOn = mine
        .map((c) => c.valid_from)
        .filter((d): d is string => d !== null && d > closeOn)
        .sort()[0] ?? null;
    }
    alsoPlanned.push(norm(piece.value));
    planned.set(attribute, alsoPlanned);
    out.push({ kind: "insert", attribute, label: piece.label, categorySlug: piece.categorySlug, value: piece.value, cardinality, close, closeOn, endsOn, conflict });
  }
  return out;
}

export interface WriteResult {
  ok: boolean;
  /** One entry per single fact the value held. */
  facts: Array<{
    attribute: string | null; outcome: PieceOutcome["kind"] | "inserted"; claimId?: string; closed?: number;
    /** Set when a later value on file ends the new one: it went in as history, or as current until then. */
    validTo?: string;
    conflict?: boolean; reason?: string;
  }>;
}

export class FactWritesPaused extends Error {
  constructor() {
    super("fact_writes_paused");
  }
}

/** True while the go-live has paused every fact writer (plan B1). */
export async function factWritesPaused(db: any): Promise<boolean> {
  const { data, error } = await db.rpc("fact_writes_paused");
  // Before the pause migration the function does not exist: nothing is paused.
  // Any other error counts as paused: a writer that cannot tell must not write.
  if (error) return !["PGRST202", "42883"].includes(String((error as any).code ?? ""));
  return data === true;
}

/**
 * Add a fact. `db` decides who writes: a client with the user's JWT for a
 * human, the service role for a job. `userId` is always checked explicitly,
 * because the service role bypasses RLS.
 */
export async function writeFact(db: any, userId: string, input: FactInput, opts: { isHuman: boolean }): Promise<WriteResult> {
  if (await factWritesPaused(db)) throw new FactWritesPaused();
  if ((input.subject.type === "self") !== (input.subject.id === null)) {
    return { ok: false, facts: [{ attribute: null, outcome: "rejected", reason: "bad_subject" }] };
  }
  if (input.subject.type === "contact") {
    const { data } = await db.from("contacts").select("id").eq("id", input.subject.id).eq("user_id", userId).is("merged_into", null).maybeSingle();
    if (!data?.id) return { ok: false, facts: [{ attribute: null, outcome: "rejected", reason: "contact_not_found" }] };
  } else if (input.subject.type === "entity") {
    const { data } = await db.from("entities").select("id").eq("id", input.subject.id).eq("user_id", userId).maybeSingle();
    if (!data?.id) return { ok: false, facts: [{ attribute: null, outcome: "rejected", reason: "entity_not_found" }] };
  }

  const pieces = piecesOf(input);
  const attributes = Array.isArray(pieces)
    ? [...new Set(pieces.map((p) => input.attribute || normalizeAttribute(p.label)).filter(Boolean))]
    : [];
  const subjectFilter = (q: any) => {
    q = q.eq("user_id", userId).eq("subject_type", input.subject.type);
    return input.subject.id === null ? q.is("subject_id", null) : q.eq("subject_id", input.subject.id);
  };

  let claims: ExistingClaim[] = [];
  let slots: ExistingSlot[] = [];
  let rules: Record<string, "one" | "many"> = {};
  const suppressed = new Set<string>();
  const privateSlugs = new Set<string>();
  if (attributes.length > 0) {
    const sections = input.subject.type === "entity" ? null : db.from("profile_categories").select("slug").eq("user_id", userId)
      .eq("visibility_scope", "private");
    const [c, s, r, sup, k] = await Promise.all([
      subjectFilter(db.from("claims").select("id, attribute, value, valid_from, valid_to, rank")).in("attribute", attributes),
      subjectFilter(db.from("fact_slots").select("attribute, cardinality, category_slug")).in("attribute", attributes),
      db.from("attribute_rules").select("attribute, cardinality").in("attribute", attributes),
      // Paged: every Revert and "Was wrong" adds a key, and past the server's
      // 1,000-row cap the rest went unread, so a machine could write a value
      // back that the user had called wrong.
      selectAllRows<{ suppression_key: string }>((from, to) =>
        db.from("ai_suggestion_suppressions").select("suppression_key").eq("user_id", userId).eq("suggestion_type", "claim")
          .like("suppression_key", `${input.subject.type}:${input.subject.id ?? ""}:%`)
          .order("suppression_key", { ascending: true }).range(from, to))
        .then((data) => ({ data, error: null }), (error) => ({ data: null, error: error ?? { message: "error" } })),
      sections === null ? { data: [], error: null }
        : input.subject.id === null ? sections.is("contact_id", null) : sections.eq("contact_id", input.subject.id),
    ]);
    for (const res of [c, s, r, sup, k]) if (res.error) throw new Error(`fact-store read: ${res.error.message}`);
    for (const x of k.data ?? []) privateSlugs.add(x.slug);
    claims = c.data ?? [];
    slots = s.data ?? [];
    rules = Object.fromEntries((r.data ?? []).map((x: any) => [x.attribute, x.cardinality]));
    for (const x of sup.data ?? []) suppressed.add(x.suppression_key);
  }
  const { data: today, error: todayError } = await db.rpc("fact_today", { p_user_id: userId });
  if (todayError || !today) throw new Error("fact-store: could not read the user's today");

  const plan = planFacts(input, { claims, slots, rules, suppressed, isHuman: opts.isHuman, today });
  const result: WriteResult = { ok: true, facts: [] };

  for (const step of plan) {
    if (step.kind !== "insert") {
      result.facts.push({ attribute: step.attribute, outcome: step.kind, claimId: "claimId" in step ? step.claimId : undefined, reason: "reason" in step ? step.reason : undefined });
      if (step.kind === "rejected") result.ok = false;
      continue;
    }

    // The slot first: a new value inherits the section, label and pin of the attribute.
    // A fact filed in a private section stays private: the splitter's own filing
    // (an email under Communication) and an existing public slot both give way,
    // the most private placement winning, as in the switch and the merge.
    const intoPrivate = input.categorySlug && privateSlugs.has(input.categorySlug) ? input.categorySlug : null;
    const existing = slots.find((s) => s.attribute === step.attribute);
    if (existing && intoPrivate && !privateSlugs.has(existing.category_slug ?? "")) {
      const { error } = await subjectFilter(db.from("fact_slots").update({ category_slug: intoPrivate })).eq("attribute", step.attribute);
      if (error) throw new Error(`fact-store slot: ${error.message}`);
      existing.category_slug = intoPrivate;
    }
    // A list the splitter found holds several values: the slot says so, or the
    // next single value (slot, then rules, then 'one') would end every piece
    // (eleventh review). A slot the owner set to 'one' is never changed here.
    if (existing && step.cardinality === "many" && !existing.cardinality) {
      const { error } = await subjectFilter(db.from("fact_slots").update({ cardinality: "many" })).eq("attribute", step.attribute).is("cardinality", null);
      if (error) throw new Error(`fact-store slot: ${error.message}`);
      existing.cardinality = "many";
    }
    if (!existing) {
      const placed = intoPrivate ? { label: step.label, categorySlug: intoPrivate }
        : input.categorySlug ? { label: step.label, categorySlug: step.categorySlug } : placeClaim(step.attribute);
      const { error } = await db.from("fact_slots").insert({
        user_id: userId,
        subject_type: input.subject.type,
        subject_id: input.subject.id,
        attribute: step.attribute,
        label: step.label || placed.label,
        category_slug: input.subject.type === "entity" ? null : placed.categorySlug,
        cardinality: step.cardinality === "many" ? "many" : null,
        is_pinned: input.isPinned ?? false,
      });
      if (error && error.code !== "23505") throw new Error(`fact-store slot: ${error.message}`);
      slots.push({ attribute: step.attribute, cardinality: step.cardinality === "many" ? "many" : null, category_slug: placed.categorySlug });
    }

    // Insert first, close after: if the database refuses the new value (quality
    // or origin guard), the old one must still be current.
    const { data: inserted, error } = await db.from("claims").insert({
      user_id: userId,
      subject_type: input.subject.type,
      subject_id: input.subject.id,
      attribute: step.attribute,
      value: step.value,
      valid_from: input.validFrom ?? null,
      valid_to: step.endsOn,
      confidence: input.confidence ?? (input.origin === "user_manual" ? "certain" : "likely"),
      cardinality: step.cardinality,
      source_type: input.sourceType ?? (input.origin === "user_manual" ? "manual" : "ai"),
      source_id: input.sourceId ?? null,
      evidence_quote: input.evidenceQuote ?? null,
      review_by: reviewByFor(step.attribute, input.validFrom ?? null),
      origin: input.origin,
    }).select("id").maybeSingle();
    if (error) {
      // The unique live-value index: someone recorded it a moment ago. Its
      // error detail carries a hash of the value, so it is never passed on.
      if (error.code === "23505") { result.facts.push({ attribute: step.attribute, outcome: "already_recorded" }); continue; }
      if (error.code === "23514") { result.ok = false; result.facts.push({ attribute: step.attribute, outcome: "rejected", reason: String(error.message).split(":")[0] }); continue; }
      throw new Error(`fact-store insert: ${error.code ?? "error"}`);
    }
    if (step.close.length > 0) {
      const { error: closeError } = await db.from("claims").update({ valid_to: step.closeOn }).in("id", step.close).eq("user_id", userId).is("valid_to", null);
      if (closeError) throw new Error(`fact-store close: ${closeError.message}`);
    }
    result.facts.push({
      attribute: step.attribute, outcome: "inserted", claimId: inserted?.id, closed: step.close.length,
      ...(step.endsOn ? { validTo: step.endsOn } : {}), conflict: step.conflict,
    });
  }
  return result;
}
