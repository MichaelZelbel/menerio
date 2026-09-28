// Give every live contact claim exactly one row on the profile.
//
// The profile page shows ONE list of facts, grouped into categories, and that
// list is profile_entries. Claims are the dated record underneath it
// (migration 093000). promote-entries.ts carries entries DOWN into claims;
// nothing carried claims written elsewhere (add_claim, the note pipeline, the
// review queue) UP into the list, so the page used to show a second, ungrouped
// "Facts" card just for them, and most of what it showed was already in the
// grouped list under another label. This is the missing direction.
//
// Pure: the caller reads rows, this decides, the caller writes. It never
// changes a claim and never changes an entry's words. The only things it asks
// for are a new entry that displays a claim, or a link on an entry that
// already shows the same value.

import { humanizeAttribute, isReservedAttribute, normalizeAttribute } from "./claims.ts";
import {
  canonicalProfileLabel,
  correctProfileCategory,
  matchProfileCategoryByLabel,
  normalizeProfileValueForDedup,
} from "./profile-canonical-schema.ts";

export interface AdoptClaim {
  id: string;
  subject_type: string;
  subject_id: string | null;
  attribute: string;
  value: string;
  valid_to: string | null;
  origin?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  evidence_quote?: string | null;
}

export interface AdoptEntry {
  id: string;
  contact_id: string | null;
  value: string;
  derived_from_claim_id: string | null;
}

export interface PlannedAdoption {
  claim_id: string;
  contact_id: string;
  category_slug: string;
  label: string;
  value: string;
  origin: string;
  evidence_quote: string | null;
  linked_note_id: string | null;
}

export interface AdoptionPlan {
  adopt: PlannedAdoption[];
  link: Array<{ entry_id: string; claim_id: string }>;
  skip: Array<{ claim_id: string; reason: "reserved-attribute" | "empty" | "same-value-shown" }>;
}

/** Section names and icons, as src/lib/profile-taxonomy.ts shows them. */
export const CATEGORY_DISPLAY: Record<string, { name: string; icon: string }> = {
  identity: { name: "Identity & Basics", icon: "user" },
  location: { name: "Location & Living", icon: "map-pin" },
  professional: { name: "Professional Life", icon: "briefcase" },
  education: { name: "Education", icon: "graduation-cap" },
  relationships: { name: "Relationships & Family", icon: "heart" },
  communication: { name: "Contact & Communication", icon: "message-circle" },
  personality: { name: "Personality & Values", icon: "compass" },
  principles: { name: "Principles & Operating System", icon: "book-open" },
  health: { name: "Health & Wellness", icon: "activity" },
  hobbies: { name: "Hobbies & Interests", icon: "palette" },
  food: { name: "Food & Drink", icon: "utensils" },
  entertainment: { name: "Music & Entertainment", icon: "music" },
  travel: { name: "Travel & Experiences", icon: "plane" },
  digital: { name: "Digital Life", icon: "monitor" },
  financial: { name: "Financial", icon: "wallet" },
  goals: { name: "Goals & Aspirations", icon: "target" },
  preferences: { name: "Preferences & Quirks", icon: "sliders-horizontal" },
};

/** Where a claim's attribute is filed when nothing more specific knows it. */
export const FALLBACK_CATEGORY = "preferences";

/** The label and category a claim's attribute is shown under. */
export function placeClaim(attribute: string): { label: string; categorySlug: string } {
  const human = humanizeAttribute(attribute);
  const known = matchProfileCategoryByLabel(human);
  if (known) return { label: known.canonicalLabel, categorySlug: known.slug };
  const label = canonicalProfileLabel("", human) || human;
  return { label, categorySlug: correctProfileCategory(label, FALLBACK_CATEGORY) };
}

/**
 * The origin the new row may honestly carry. profile_entry_require_origin
 * wants a verbatim quote (10+ characters) from every automated origin, and
 * lets a row inherit "unverified" only from a claim that is itself unverified
 * or has no quote
 * (migration 20260928121000). A quote is never invented to get past it.
 */
export function entryOriginFor(claim: Pick<AdoptClaim, "origin" | "evidence_quote">): string {
  const quoted = String(claim.evidence_quote ?? "").trim().length >= 10;
  switch (claim.origin) {
    case "user_manual":
    case "review_queue":
      return claim.origin;
    case "ai_note":
      return quoted ? "ai_note" : "unverified";
    case "menerio":
      return quoted ? "mcp" : "unverified";
    default:
      return "unverified";
  }
}

export function planAdoptions(claims: AdoptClaim[], entries: AdoptEntry[]): AdoptionPlan {
  const plan: AdoptionPlan = { adopt: [], link: [], skip: [] };
  const shown = new Set(entries.map((e) => e.derived_from_claim_id).filter(Boolean) as string[]);

  // Per contact: normalized value → the entries already showing it.
  const byValue = new Map<string, AdoptEntry[]>();
  for (const e of entries) {
    if (!e.contact_id) continue;
    const key = `${e.contact_id}\u0000${normalizeProfileValueForDedup(e.value)}`;
    const list = byValue.get(key) ?? [];
    list.push(e);
    byValue.set(key, list);
  }
  const linkedNow = new Set<string>();

  for (const c of claims) {
    if (c.subject_type !== "contact" || !c.subject_id || c.valid_to) continue;
    if (shown.has(c.id)) continue;
    const value = String(c.value ?? "").trim();
    const attribute = normalizeAttribute(c.attribute);
    if (!value || !attribute) { plan.skip.push({ claim_id: c.id, reason: "empty" }); continue; }
    // Relationships have their own card and their own table.
    if (isReservedAttribute(attribute)) { plan.skip.push({ claim_id: c.id, reason: "reserved-attribute" }); continue; }

    const same = byValue.get(`${c.subject_id}\u0000${normalizeProfileValueForDedup(value)}`) ?? [];
    const free = same.find((e) => !e.derived_from_claim_id && !linkedNow.has(e.id));
    if (free) {
      // The list already shows this value, it just was never told which claim
      // it shows. Link it; a second row would repeat the fact.
      plan.link.push({ entry_id: free.id, claim_id: c.id });
      linkedNow.add(free.id);
      continue;
    }
    if (same.length > 0) {
      // Shown already, and backed by another claim: this claim is a copy of a
      // fact the list has. Adding it would put the same value on the page twice.
      plan.skip.push({ claim_id: c.id, reason: "same-value-shown" });
      continue;
    }

    const { label, categorySlug } = placeClaim(attribute);
    plan.adopt.push({
      claim_id: c.id,
      contact_id: c.subject_id,
      category_slug: categorySlug,
      label,
      value,
      origin: entryOriginFor(c),
      evidence_quote: c.evidence_quote ?? null,
      linked_note_id: c.source_type === "note" && c.source_id ? c.source_id : null,
    });
    // A later copy of the same value must not be adopted a second time.
    byValue.set(`${c.subject_id}\u0000${normalizeProfileValueForDedup(value)}`, [
      { id: `planned:${c.id}`, contact_id: c.subject_id, value, derived_from_claim_id: c.id },
    ]);
  }
  return plan;
}
