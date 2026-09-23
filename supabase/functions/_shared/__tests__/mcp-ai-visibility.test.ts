// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyVisibility, enterVisibilityScope, getSensitivePersonIds } from "../../menerio-mcp/_ai_visibility";
import type { Row } from "./memory-db";

/**
 * The MCP server's visibility gate. Two things it got wrong:
 *  - action_items keeps its person in contact_id, not person_id, and a filter
 *    on the missing column failed every get_action_items call for anyone with
 *    a sensitive person;
 *  - a failed read of the sensitive list was treated as "nobody is sensitive".
 */
const USER = "00000000-0000-4000-8000-000000000001";
const SENSITIVE = "00000000-0000-4000-8000-0000000000aa";

/** A client that answers the two settings reads, or fails them. */
function settingsClient(fail = false): Row {
  const answer = (data: unknown) => (fail ? { data: null, error: { message: "statement timeout" } } : { data, error: null });
  return {
    from(table: string) {
      const data = table === "contacts" ? [{ id: SENSITIVE }] : { hide_sensitive_from_ai: true };
      const q: Row = {
        select: () => q, eq: () => q, is: () => q, maybeSingle: () => q,
        then: (ok: (v: unknown) => unknown) => Promise.resolve(ok(answer(data))),
      };
      return q;
    },
  };
}

/** Records the filters a tool query was given. */
function recordingQuery() {
  const calls: string[] = [];
  const q: Row = {
    eq: (k: string, v: unknown) => { calls.push(`eq ${k}=${v}`); return q; },
    or: (f: string) => { calls.push(`or ${f}`); return q; },
  };
  return { q, calls };
}

describe("applyVisibility", () => {
  it("filters action items on contact_id, the column they have", async () => {
    const { q, calls } = recordingQuery();
    await enterVisibilityScope(() => applyVisibility(q, "action_items", settingsClient(), USER));
    expect(calls).toEqual(["eq ai_visibility=visible", `or contact_id.is.null,contact_id.not.in.(${SENSITIVE})`]);
  });

  it("still filters moments on person_id", async () => {
    const { q, calls } = recordingQuery();
    await enterVisibilityScope(() => applyVisibility(q, "moments", settingsClient(), USER));
    expect(calls).toContain(`or person_id.is.null,person_id.not.in.(${SENSITIVE})`);
  });

  it("fails closed when the sensitive list cannot be read", async () => {
    await expect(
      enterVisibilityScope(() => getSensitivePersonIds(settingsClient(true), USER)),
    ).rejects.toThrow(/Could not load AI visibility settings/);
    const { q } = recordingQuery();
    await expect(
      enterVisibilityScope(() => applyVisibility(q, "moments", settingsClient(true), USER)),
    ).rejects.toThrow();
  });
});
