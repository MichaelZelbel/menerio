/**
 * Relationship label vocabulary for the picker, plus the single display
 * entry point. All directional/gender logic lives in
 * `@/lib/relationship-canonical` (`describeRelationship`) so every surface —
 * profile card, people tree, review queue, lexicon — renders the same
 * "Role: Name" string.
 */
import {
  describeRelationship,
  inverseLabel,
  type DescribeRelationshipInput,
  type RelationshipDescription,
} from "@/lib/relationship-canonical";

/**
 * Labels offered in the add/edit picker. The picker asks "who is this person
 * to the profile on screen?", so gendered wordings ("girlfriend", "wife",
 * "mother") are offered alongside the neutral ones. Storage still collapses a
 * gendered romantic label into `partner` (see `canonicalLabel`); the gendered
 * reading is preserved by recording the other person's gender fact.
 */
export const ALL_RELATIONSHIP_LABELS = [
  // Personal
  "spouse",
  "wife",
  "husband",
  "partner",
  "girlfriend",
  "boyfriend",
  "lover",
  "parent",
  "mother",
  "father",
  "child",
  "daughter",
  "son",
  "sibling",
  "sister",
  "brother",
  "grandparent",
  "grandmother",
  "grandfather",
  "grandchild",
  "granddaughter",
  "grandson",
  "aunt",
  "uncle",
  "niece",
  "nephew",
  "cousin",
  "relative",
  "stepparent",
  "stepmother",
  "stepfather",
  "stepchild",
  "stepdaughter",
  "stepson",
  "stepsibling",
  "parent-in-law",
  "child-in-law",
  "sibling-in-law",
  "godparent",
  "godchild",
  "guardian",
  "ward",
  "friend",
  "neighbor",
  "roommate",
  // Professional & service
  "co-worker",
  "manager",
  "report",
  "employer",
  "employee",
  "mentor",
  "mentee",
  "teacher",
  "student",
  "coach",
  "client",
  "provider",
  "financial advisor",
  "tax accountant",
  "lawyer",
  "doctor",
  "therapist",
  "landlord",
  "tenant",
  "business partner",
  "co-founder",
];


/** Inverse of a stored label (re-exported for callers that only need this). */
export function getInverseLabel(label: string): string {
  return inverseLabel(label);
}

/**
 * Perspective-aware display. Returns the other person's name and the role
 * THEY hold toward the person whose profile is on screen, plus the composed
 * "Role: Name" string.
 */
export function getRelationshipDisplay(
  params: DescribeRelationshipInput,
): RelationshipDescription & { displayLabel: string } {
  const described = describeRelationship(params);
  return { ...described, displayLabel: described.role };
}

/**
 * Gender implied by an explicitly gendered label choice ("girlfriend" →
 * female). Neutral labels imply nothing. Used to persist the other person's
 * gender fact so the display keeps rendering the gendered wording, even
 * though storage canonicalizes e.g. "girlfriend" to "partner".
 */
const LABEL_IMPLIED_GENDER: Record<string, "male" | "female"> = {
  wife: "female", husband: "male",
  girlfriend: "female", boyfriend: "male",
  mother: "female", father: "male",
  daughter: "female", son: "male",
  sister: "female", brother: "male",
  grandmother: "female", grandfather: "male",
  granddaughter: "female", grandson: "male",
  aunt: "female", uncle: "male",
  niece: "female", nephew: "male",
  stepmother: "female", stepfather: "male",
  stepdaughter: "female", stepson: "male",
};

export function impliedGenderFromLabel(label: string): "male" | "female" | null {
  return LABEL_IMPLIED_GENDER[String(label || "").trim().toLowerCase()] ?? null;
}
