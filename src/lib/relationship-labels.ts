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

/** Labels offered in the add/edit picker. Canonical, neutral forms only. */
export const ALL_RELATIONSHIP_LABELS = [
  // Personal
  "spouse",
  "partner",
  "lover",
  "parent",
  "child",
  "sibling",
  "grandparent",
  "grandchild",
  "aunt",
  "uncle",
  "niece",
  "nephew",
  "cousin",
  "relative",
  "stepparent",
  "stepchild",
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
