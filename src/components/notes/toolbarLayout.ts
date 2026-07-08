/**
 * Pure layout math for the Priority+ editor toolbar.
 *
 * The toolbar never wraps: when the formatting region is too narrow to show
 * every group, whole groups collapse (in COLLAPSE_ORDER) into a "more
 * formatting" popover. Group widths are static because every control is a
 * fixed-size 28px icon button — the one variable-width control (the block-type
 * trigger) is given a fixed width by the toolbar for exactly this reason.
 */

export type ToolbarGroupId =
  | "history"
  | "blockType"
  | "coreMarks"
  | "extendedMarks"
  | "color"
  | "lists"
  | "blockFormat"
  | "align"
  | "insert"
  | "clear";

export interface ToolbarLayoutContext {
  /** "Link to note" button present (only when the host passes onInsertWikilink). */
  hasWikilink: boolean;
  /** "Remove link" button present (only while the caret is on a link). */
  hasRemoveLink: boolean;
}

/** Left-to-right visual order of the formatting groups. */
export const DISPLAY_ORDER: ToolbarGroupId[] = [
  "history",
  "blockType",
  "coreMarks",
  "extendedMarks",
  "color",
  "lists",
  "blockFormat",
  "align",
  "insert",
  "clear",
];

/**
 * First-to-collapse → last-to-collapse. Lists and the block-type dropdown are
 * the most-used structural controls, so they survive the longest.
 */
export const COLLAPSE_ORDER: ToolbarGroupId[] = [
  "clear",
  "extendedMarks",
  "align",
  "blockFormat",
  "color",
  "insert",
  "history",
  "coreMarks",
  "lists",
  "blockType",
];

const BUTTON = 28; // h-7 w-7 icon button
const GAP = 2; // gap-0.5 between buttons in a group
const CONDITIONAL_BUTTON = BUTTON + GAP;

/** Width of a group of n fixed-size buttons. */
const buttons = (n: number) => n * BUTTON + (n - 1) * GAP;

/** Separator (1px) + mx-1 (8px) + flex gaps on both sides (2×2px), charged per group. */
export const GROUP_SEPARATOR = 13;
/** The "more formatting" trigger button + its separator, reserved once when anything collapses. */
export const OVERFLOW_TRIGGER = BUTTON + GROUP_SEPARATOR;
/** Safety margin for font rendering / zoom drift. */
export const SLACK = 16;

export function getGroupWidth(id: ToolbarGroupId, ctx: ToolbarLayoutContext): number {
  switch (id) {
    case "history":
      return buttons(2); // undo, redo
    case "blockType":
      return 112; // fixed w-28 dropdown trigger
    case "coreMarks":
      return buttons(4); // bold, italic, underline, strike
    case "extendedMarks":
      return buttons(4); // code, highlight, superscript, subscript
    case "color":
      return buttons(1);
    case "lists":
      return buttons(3); // bullet, numbered, checklist
    case "blockFormat":
      return buttons(3); // quote, hr, code block
    case "align":
      return buttons(4);
    case "insert":
      return (
        buttons(3) + // link, table, embed
        (ctx.hasRemoveLink ? CONDITIONAL_BUTTON : 0) +
        (ctx.hasWikilink ? CONDITIONAL_BUTTON : 0)
      );
    case "clear":
      return buttons(1);
  }
}

/**
 * Given the measured width of the formatting region, decide which groups
 * collapse into the overflow popover. Returns a set that is always a prefix of
 * COLLAPSE_ORDER; `null` width (pre-measure first render) collapses nothing.
 */
export function computeCollapsedGroups(
  availableWidth: number | null,
  ctx: ToolbarLayoutContext,
): Set<ToolbarGroupId> {
  const collapsed = new Set<ToolbarGroupId>();
  if (availableWidth === null) return collapsed;

  const budget = availableWidth - SLACK;
  let total = DISPLAY_ORDER.reduce(
    (sum, id) => sum + getGroupWidth(id, ctx) + GROUP_SEPARATOR,
    0,
  );
  if (total <= budget) return collapsed;

  // Something must collapse, so the trigger button needs room too.
  const remaining = budget - OVERFLOW_TRIGGER;
  for (const id of COLLAPSE_ORDER) {
    if (total <= remaining) break;
    total -= getGroupWidth(id, ctx) + GROUP_SEPARATOR;
    collapsed.add(id);
  }
  return collapsed;
}
