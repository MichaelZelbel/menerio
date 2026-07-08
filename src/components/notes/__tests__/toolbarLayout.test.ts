import { describe, expect, it } from "vitest";
import {
  COLLAPSE_ORDER,
  DISPLAY_ORDER,
  GROUP_SEPARATOR,
  OVERFLOW_TRIGGER,
  SLACK,
  computeCollapsedGroups,
  getGroupWidth,
  type ToolbarGroupId,
  type ToolbarLayoutContext,
} from "../toolbarLayout";

const baseCtx: ToolbarLayoutContext = { hasWikilink: false, hasRemoveLink: false };

/** Width at which every group fits exactly (collapse threshold boundary). */
function fullWidth(ctx: ToolbarLayoutContext): number {
  const total = DISPLAY_ORDER.reduce(
    (sum, id) => sum + getGroupWidth(id, ctx) + GROUP_SEPARATOR,
    0,
  );
  return total + SLACK;
}

function expectPrefixOfCollapseOrder(collapsed: Set<ToolbarGroupId>) {
  const prefix = COLLAPSE_ORDER.slice(0, collapsed.size);
  expect([...collapsed].sort()).toEqual([...prefix].sort());
}

describe("computeCollapsedGroups", () => {
  it("collapses nothing before the first measurement (null width)", () => {
    expect(computeCollapsedGroups(null, baseCtx).size).toBe(0);
  });

  it("collapses nothing on a huge width", () => {
    expect(computeCollapsedGroups(10_000, baseCtx).size).toBe(0);
  });

  it("collapses nothing at the exact-fit boundary", () => {
    expect(computeCollapsedGroups(fullWidth(baseCtx), baseCtx).size).toBe(0);
  });

  it("starts collapsing one pixel below the boundary, beginning with COLLAPSE_ORDER[0]", () => {
    const collapsed = computeCollapsedGroups(fullWidth(baseCtx) - 1, baseCtx);
    expect(collapsed.size).toBeGreaterThan(0);
    expect(collapsed.has(COLLAPSE_ORDER[0])).toBe(true);
    expectPrefixOfCollapseOrder(collapsed);
  });

  it("reserves room for the overflow trigger once anything collapses", () => {
    // One pixel under the boundary must free up the first group's width AND
    // the trigger's width — so more than COLLAPSE_ORDER[0] alone may collapse.
    const collapsed = computeCollapsedGroups(fullWidth(baseCtx) - 1, baseCtx);
    const freed = [...collapsed].reduce(
      (sum, id) => sum + getGroupWidth(id, baseCtx) + GROUP_SEPARATOR,
      0,
    );
    expect(freed).toBeGreaterThanOrEqual(OVERFLOW_TRIGGER + 1);
  });

  it("collapses everything at width 0", () => {
    const collapsed = computeCollapsedGroups(0, baseCtx);
    expect(collapsed.size).toBe(DISPLAY_ORDER.length);
  });

  it("always returns a prefix of COLLAPSE_ORDER across sampled widths", () => {
    for (let width = 0; width <= fullWidth(baseCtx) + 50; width += 7) {
      expectPrefixOfCollapseOrder(computeCollapsedGroups(width, baseCtx));
    }
  });

  it("is monotonic: narrower widths never collapse fewer groups", () => {
    let prev = Infinity;
    for (let width = 0; width <= fullWidth(baseCtx) + 50; width += 7) {
      const size = computeCollapsedGroups(width, baseCtx).size;
      expect(size).toBeLessThanOrEqual(prev);
      prev = size;
    }
  });

  it("context flags widen the insert group and can flip a boundary", () => {
    const wide: ToolbarLayoutContext = { hasWikilink: true, hasRemoveLink: true };
    expect(getGroupWidth("insert", wide)).toBeGreaterThan(getGroupWidth("insert", baseCtx));
    // Exactly fitting without the flags no longer fits with them.
    const width = fullWidth(baseCtx);
    expect(computeCollapsedGroups(width, baseCtx).size).toBe(0);
    expect(computeCollapsedGroups(width, wide).size).toBeGreaterThan(0);
  });

  it("keeps lists and blockType visible longest", () => {
    // Find a width where exactly 8 groups are collapsed: the survivors must be
    // the two highest-priority groups.
    for (let width = fullWidth(baseCtx); width >= 0; width -= 1) {
      const collapsed = computeCollapsedGroups(width, baseCtx);
      if (collapsed.size === DISPLAY_ORDER.length - 2) {
        expect(collapsed.has("lists")).toBe(false);
        expect(collapsed.has("blockType")).toBe(false);
        return;
      }
    }
    throw new Error("never reached an 8-collapsed state");
  });
});
