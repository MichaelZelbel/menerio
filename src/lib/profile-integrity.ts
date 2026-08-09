// Frontend mirror of supabase/functions/_shared/profile-integrity.ts.
//
// The region between the BEGIN/END SHARED CORE markers is byte-identical with
// that file and is asserted by src/lib/__tests__/profile-integrity.test.ts.
// Edit both, or neither.
import {
  canonicalLabel,
  inverseLabel,
  isSymmetricLabel,
  type EntityRef,
} from "@/lib/relationship-canonical";
import { canonicalProfileLabel, isBlockedProfileLabel } from "@/lib/profile-canonical-schema";

// --- BEGIN SHARED CORE ---
const BLOCKED_RELATIONSHIP_LABELS = new Set([
  "subject of notes",
  "protector",
  "protectee",
  "admirer",
  "owner",
  "roleplay character",
  "mentioned with",
  "mentioned person",
  "person mentioned",
  "self",
]);

const PLACEHOLDER_VALUES = new Set([
  "none", "n/a", "na", "unknown", "unspecified", "-", "—", "null",
]);

export type RelationshipWriteInput = {
  userId: string;
  sourceType: "contact" | "self";
  sourceId: string | null;
  targetType: "contact" | "self";
  targetId: string | null;
  label: string;
};

export type RelationshipWriteDecision =
  | { ok: true; label: string; pairKey: string }
  | { ok: false; reason: string };

export function isBlockedRelationshipLabel(label: string | null | undefined): boolean {
  const normalized = canonicalLabel(label);
  return !normalized || BLOCKED_RELATIONSHIP_LABELS.has(normalized) || /^(subject|character|person) of notes?$/.test(normalized);
}

export function relationshipWriteDecision(input: RelationshipWriteInput): RelationshipWriteDecision {
  const label = canonicalLabel(input.label);
  if (isBlockedRelationshipLabel(label)) return { ok: false, reason: "blocked_relationship_label" };
  if (input.sourceType === input.targetType && input.sourceId && input.sourceId === input.targetId) {
    return { ok: false, reason: "self_relationship" };
  }
  if (input.sourceType === "self" && input.targetType === "self") {
    return { ok: false, reason: "self_relationship" };
  }
  const source: EntityRef = { type: input.sourceType, id: input.sourceId };
  const target: EntityRef = { type: input.targetType, id: input.targetId };
  const pairKey = isSymmetricLabel(label)
    ? `${input.userId}|sym|${label}|${[`${source.type}:${source.id || "self"}`, `${target.type}:${target.id || "self"}`].sort().join("|")}`
    : `${input.userId}|asym|${[`${source.type}:${source.id || "self"}:${label}`, `${target.type}:${target.id || "self"}:${inverseLabel(label)}`].sort().join("|")}`;
  return { ok: true, label, pairKey };
}

export function profileValueDecision(categorySlug: string, label: string, value: string) {
  const canonical = canonicalProfileLabel(categorySlug, label);
  const normalizedValue = String(value || "").trim();
  const valueKey = normalizedValue.toLowerCase();
  if (!canonical || !normalizedValue) return { ok: false as const, reason: "empty" };
  if (isBlockedProfileLabel(canonical)) return { ok: false as const, reason: "blocked_profile_label" };
  if (PLACEHOLDER_VALUES.has(valueKey) || valueKey === canonical.toLowerCase()) {
    return { ok: false as const, reason: "placeholder_or_label_value" };
  }
  if (normalizedValue.length < 2) return { ok: false as const, reason: "value_too_short" };
  return { ok: true as const, label: canonical, value: normalizedValue };
}
// --- END SHARED CORE ---
