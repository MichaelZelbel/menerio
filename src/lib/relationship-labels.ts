/**
 * Predefined relationship label pairs for perspective-aware display.
 * Each pair defines: [forward_label, inverse_label]
 * When viewing person A's profile and A→B has label "employee",
 * we show "B — employer" (the inverse).
 */

export interface LabelPair {
  forward: string;
  inverse: string;
}

export const RELATIONSHIP_LABEL_PAIRS: LabelPair[] = [
  { forward: "employee", inverse: "employer" },
  { forward: "employer", inverse: "employee" },
  { forward: "friend", inverse: "friend" },
  { forward: "brother", inverse: "sibling" },
  { forward: "sister", inverse: "sibling" },
  { forward: "sibling", inverse: "sibling" },
  { forward: "mother", inverse: "child" },
  { forward: "father", inverse: "child" },
  { forward: "parent", inverse: "child" },
  { forward: "child", inverse: "parent" },
  { forward: "son", inverse: "parent" },
  { forward: "daughter", inverse: "parent" },
  { forward: "partner", inverse: "partner" },
  { forward: "spouse", inverse: "spouse" },
  { forward: "mentor", inverse: "mentee" },
  { forward: "mentee", inverse: "mentor" },
  { forward: "manager", inverse: "report" },
  { forward: "report", inverse: "manager" },
  { forward: "co-worker", inverse: "co-worker" },
  { forward: "neighbor", inverse: "neighbor" },
  { forward: "roommate", inverse: "roommate" },
  { forward: "client", inverse: "provider" },
  { forward: "provider", inverse: "client" },
  { forward: "teacher", inverse: "student" },
  { forward: "student", inverse: "teacher" },
];

/** All unique labels for dropdown selection */
export const ALL_RELATIONSHIP_LABELS = [
  ...new Set(RELATIONSHIP_LABEL_PAIRS.map((p) => p.forward)),
].sort();

/**
 * Get the inverse label for a given label.
 * Returns the inverse from the pairs table, or the same label if symmetric/unknown.
 */
export function getInverseLabel(label: string): string {
  const pair = RELATIONSHIP_LABEL_PAIRS.find(
    (p) => p.forward.toLowerCase() === label.toLowerCase()
  );
  return pair?.inverse || label;
}

/**
 * Perspective-aware display:
 * Given a relationship record and who we're viewing, return:
 * - otherName: the name of the other person
 * - displayLabel: the label from the viewed person's perspective
 *
 * A relationship is stored as source→target with a label describing
 * "source is [label] of target". When viewing source's profile,
 * we show: "target — [label]". When viewing target's profile,
 * we show: "source — [inverse_label]".
 */
export function getRelationshipDisplay(params: {
  sourceType: string;
  sourceId: string | null;
  targetType: string;
  targetId: string | null;
  label: string;
  customLabel?: string | null;
  viewingContactId: string | null; // null = viewing "self" / my profile
  sourceName: string;
  targetName: string;
}): { otherName: string; displayLabel: string } {
  const {
    sourceType, sourceId, targetType, targetId,
    label, customLabel,
    viewingContactId, sourceName, targetName,
  } = params;

  const effectiveLabel = customLabel || label;

  // Determine if we're viewing the source or the target
  const viewingIsSource =
    (viewingContactId === null && sourceType === "self") ||
    (viewingContactId !== null && sourceType === "contact" && sourceId === viewingContactId);

  if (viewingIsSource) {
    // Viewing source's profile → show target with the forward label
    return { otherName: targetName, displayLabel: effectiveLabel };
  } else {
    // Viewing target's profile → show source with the inverse label
    const inverseLabel = customLabel ? customLabel : getInverseLabel(label);
    return { otherName: sourceName, displayLabel: inverseLabel };
  }
}
