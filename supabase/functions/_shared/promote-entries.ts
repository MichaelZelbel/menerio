/**
 * Promoting a profile entry into a dated claim.
 *
 * WHY THIS EXISTS. `profile_entries` stopped being a fact store on
 * 2026-09-01 (migration 093000) and became a display layer over `claims`.
 * Nothing implemented the word "over". There were 272 profile entries and 20
 * claims, and every one of those 20 had been moved by hand. A display layer
 * with nothing behind it is just the old store with a new name.
 *
 * This is the pure half: it takes rows and returns a plan. No database, no
 * network, no model. The script counts, the agent judges — so nothing here
 * guesses what a fact means, and every case it cannot decide becomes a skip
 * with a reason rather than a write.
 *
 * THE FOUR RULES IT ENFORCES, all from world/menerio-bridge.md and SPEC.md:
 *
 *   1. A hand-typed value keeps its words. An entry whose origin is
 *      `user_manual` is copied verbatim into the claim and the entry row is
 *      never edited except for the link back. The claim carries the SAME
 *      origin, which is what stops the promotion from quietly demoting a
 *      human's fact to a machine's — see `claims.origin`, migration 098000.
 *   2. A collision is a question for Michael, never a merge. Two live answers
 *      to one single-valued question are both left alone and reported.
 *   3. A superseded claim gets a valid_to, never a delete. This plan closes
 *      nothing at all: it only ever inserts, or skips.
 *   4. A subset may never hide its superset. An entry is linked to a claim
 *      only when the claim holds the entry's value in full.
 */

import {
  cardinalityFor,
  isReservedAttribute,
  normalizeAttribute,
  reviewByFor,
  type ClaimCardinality,
} from "./claims.ts";

/** A profile_entries row, as the promotion reads it. */
export interface EntryRow {
  id: string;
  contact_id: string | null;
  label: string;
  value: string;
  origin: string | null;
  evidence_quote: string | null;
  linked_note_id: string | null;
  derived_from_claim_id: string | null;
  created_at: string;
}

/** A claims row, enough of it to decide whether an entry may be promoted. */
export interface ExistingClaim {
  id: string;
  subject_type: string;
  subject_id: string | null;
  attribute: string;
  value: string;
  valid_to: string | null;
}

/** Contacts whose facts must never reach the claim store. */
export interface ContactVisibility {
  id: string;
  is_sensitive: boolean;
  ai_visibility: string | null;
}

export type SkipReason =
  | "already-promoted"
  | "reserved-attribute"
  | "empty"
  | "contact-hidden-from-ai"
  | "collision-needs-michael";

export interface PlannedClaim {
  /** Every entry this one claim will display. Usually one. */
  entry_ids: string[];
  subject_type: "self" | "contact";
  subject_id: string | null;
  attribute: string;
  value: string;
  valid_from: string;
  confidence: "likely";
  cardinality: ClaimCardinality;
  evidence_quote: string | null;
  review_by: string | null;
  source_type: "note" | "manual" | "ai";
  source_id: string | null;
  origin: string;
}

/** An entry that already has a claim holding its value — link, do not insert. */
export interface PlannedLink {
  entry_id: string;
  claim_id: string;
  label: string;
}

export interface SkippedEntry {
  entry_id: string;
  label: string;
  reason: SkipReason;
  detail: string;
}

export interface PromotionPlan {
  promote: PlannedClaim[];
  link: PlannedLink[];
  skip: SkippedEntry[];
}

/** The live half of `attribute_rules`, passed in so the DB stays the registry. */
export type AttributeRules = Record<string, { cardinality?: string | null }>;

function cardinality(attribute: string, rules: AttributeRules): ClaimCardinality {
  const fromDb = rules[attribute]?.cardinality;
  if (fromDb === "one" || fromDb === "many") return fromDb;
  return cardinalityFor(attribute);
}

/** YYYY-MM-DD out of a timestamptz, which is what a date column wants. */
export function dayOf(timestamp: string): string {
  return String(timestamp || "").slice(0, 10);
}

const norm = (s: string) => String(s ?? "").trim().toLowerCase();

/** self + null, or contact + id. The grouping key for "one question". */
function subjectKey(e: EntryRow): string {
  return e.contact_id ? `contact:${e.contact_id}` : "self:";
}

/**
 * Does this claim hold this entry's value in full?
 *
 * Containment in ONE direction only, and the direction matters. The Email
 * entry holds two addresses while its claim held one; a rule that accepted
 * containment either way would have let that one-value claim hide the
 * two-value entry and the second address would have vanished from the mirror
 * with nothing reporting it. A subset may never hide its superset.
 */
export function claimCovers(claimValue: string, entryValue: string): boolean {
  const c = norm(claimValue);
  const e = norm(entryValue);
  return e.length > 0 && c.includes(e);
}

export function planPromotions(
  entries: EntryRow[],
  claims: ExistingClaim[],
  contacts: ContactVisibility[],
  rules: AttributeRules = {},
): PromotionPlan {
  const plan: PromotionPlan = { promote: [], link: [], skip: [] };

  const contactById = new Map(contacts.map((c) => [c.id, c]));

  // Live claims only. A closed claim is history and must not block a new fact.
  const liveByQuestion = new Map<string, ExistingClaim[]>();
  for (const c of claims) {
    if (c.valid_to !== null) continue;
    const key = `${c.subject_type === "self" ? "self:" : `contact:${c.subject_id}`}|${norm(c.attribute)}`;
    const bucket = liveByQuestion.get(key);
    if (bucket) bucket.push(c);
    else liveByQuestion.set(key, [c]);
  }

  // Group this run's entries by the question they answer, so two entries that
  // disagree are seen as a disagreement rather than promoted one after the
  // other into an accidental supersede.
  const groups = new Map<string, EntryRow[]>();
  const order: string[] = [];

  for (const e of entries) {
    const label = String(e.label ?? "").trim();
    const value = String(e.value ?? "").trim();
    const attribute = normalizeAttribute(label);

    if (e.derived_from_claim_id) {
      plan.skip.push({ entry_id: e.id, label, reason: "already-promoted", detail: `already displays claim ${e.derived_from_claim_id}` });
      continue;
    }
    if (!attribute || !value) {
      plan.skip.push({ entry_id: e.id, label, reason: "empty", detail: "no label or no value to carry" });
      continue;
    }
    if (isReservedAttribute(attribute)) {
      // Relationships live in contact_relationships with their own canonical
      // labels, inverses and rejection ledger. add_claim already refuses them.
      plan.skip.push({ entry_id: e.id, label, reason: "reserved-attribute", detail: "relationships are not claims" });
      continue;
    }
    if (e.contact_id) {
      const c = contactById.get(e.contact_id);
      if (!c || c.is_sensitive || (c.ai_visibility ?? "visible") !== "visible") {
        // Claims are searchable and match_claims gates them on the contact's
        // flags (migration 099000). Promoting a hidden contact's fact would
        // still be routing a value the user hid around the control they set.
        plan.skip.push({ entry_id: e.id, label, reason: "contact-hidden-from-ai", detail: "the contact is marked sensitive or hidden from AI" });
        continue;
      }
    }

    const key = `${subjectKey(e)}|${attribute}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else {
      groups.set(key, [e]);
      order.push(key);
    }
  }

  for (const key of order) {
    const bucket = groups.get(key)!;
    const attribute = key.slice(key.indexOf("|") + 1);
    const card = cardinality(attribute, rules);
    const live = liveByQuestion.get(key) ?? [];

    // An entry a live claim already holds in full is LINKED, never inserted
    // again. That is what stops the mirror carrying one fact twice.
    const unlinked: EntryRow[] = [];
    for (const e of bucket) {
      const covering = live.find((c) => claimCovers(c.value, e.value));
      if (covering) plan.link.push({ entry_id: e.id, claim_id: covering.id, label: String(e.label).trim() });
      else unlinked.push(e);
    }
    if (unlinked.length === 0) continue;

    // Distinct values still wanting a claim, in the order they were seen.
    const byValue = new Map<string, EntryRow[]>();
    const valueOrder: string[] = [];
    for (const e of unlinked) {
      const v = norm(e.value);
      const b = byValue.get(v);
      if (b) b.push(e);
      else {
        byValue.set(v, [e]);
        valueOrder.push(v);
      }
    }

    if (card === "one") {
      // One question, one live answer. Anything that would make a second is a
      // question for Michael: "manager" held both a line manager and a manager
      // in a project, two different people, both correct, and a merge would
      // have destroyed one of them.
      const wouldBeLive = live.length + valueOrder.length;
      if (wouldBeLive > 1) {
        const others = [
          ...live.map((c) => `claim "${c.value}"`),
          ...valueOrder.map((v) => `entry "${byValue.get(v)![0].value.trim()}"`),
        ];
        for (const e of unlinked) {
          plan.skip.push({
            entry_id: e.id,
            label: String(e.label).trim(),
            reason: "collision-needs-michael",
            detail: `"${attribute}" would have ${wouldBeLive} live answers: ${others.join(" vs ")}. The attribute name probably covers two different facts.`,
          });
        }
        continue;
      }
    }

    for (const v of valueOrder) {
      const rows = byValue.get(v)!;
      const first = rows[0];
      const validFrom = dayOf(first.created_at);
      plan.promote.push({
        entry_ids: rows.map((r) => r.id),
        subject_type: first.contact_id ? "contact" : "self",
        subject_id: first.contact_id,
        attribute,
        value: String(first.value).trim(),
        // The day the fact went on record. It is a lower bound on when it was
        // believed, never a guess at when it became true, and it is what makes
        // review_by computable at all: migration 092000 refuses to invent a
        // review date without an anchor, and an undated fact with a confident
        // review date is worse than an undated fact.
        valid_from: validFrom,
        confidence: "likely",
        cardinality: card,
        evidence_quote: first.evidence_quote?.trim() || null,
        review_by: reviewByFor(attribute, validFrom),
        source_type: first.linked_note_id ? "note" : norm(first.origin) === "user_manual" ? "manual" : "ai",
        source_id: first.linked_note_id,
        // Carried, not reset. A machine may re-file a hand-edited fact; it may
        // not demote it. Losing `user_manual` here is what would have let a
        // later job overwrite a value Michael typed.
        origin: String(first.origin ?? "unverified").trim() || "unverified",
      });
    }
  }

  return plan;
}
