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
  "child",
  "client",
  "co-worker",
  "employee",
  "employer",
  "friend",
  "lover",
  "manager",
  "mentee",
  "mentor",
  "neighbor",
  "parent",
  "partner",
  "provider",
  "report",
  "roommate",
  "sibling",
  "spouse",
  "student",
  "teacher",
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
