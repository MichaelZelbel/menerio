import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: () => ({}) }));
const writeFact = vi.fn();
vi.mock("../fact-store.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../fact-store.ts")>()),
  writeFact: (...args: unknown[]) => writeFact(...args),
}));

const { prepareForInsert } = await import("../moment-profile-extraction.ts");

// Facts found in a timeline moment go through the one write path, as ai_moment
// with the moment as their source.
const db = { from: () => { throw new Error("no table access expected"); } } as any;
const prefs = { mode: "auto", sensitivity: "balanced", autoAddSensitive: false };
const suggestion = (over: Record<string, unknown> = {}) => ({
  user_id: "fixture-user", source_note_id: null, suggestion_type: "add_profile_entry", title: "t", description: "d",
  status: "pending_review", confidence_score: 1,
  payload: { contact_id: "fixture-contact", category_slug: "location", category_id: null, label: "Current city", value: "Lisbon",
    evidence_quote: "Sarah moved to Lisbon", moment_id: "fixture-moment", ...over },
});

describe("moment facts", () => {
  beforeEach(() => writeFact.mockReset());

  it("are written through writeFact as ai_moment with the quote and the moment as source", async () => {
    writeFact.mockResolvedValue({ ok: true, facts: [{ attribute: "current-city", outcome: "inserted", claimId: "claim-1" }] });
    const result = await prepareForInsert(db, suggestion(), prefs);
    expect(writeFact).toHaveBeenCalledTimes(1);
    const [, userId, input, opts] = writeFact.mock.calls[0];
    expect(userId).toBe("fixture-user");
    expect(input).toMatchObject({
      subject: { type: "contact", id: "fixture-contact" }, label: "Current city", value: "Lisbon",
      origin: "ai_moment", evidenceQuote: "Sarah moved to Lisbon", sourceType: "moment", sourceId: "fixture-moment",
    });
    expect(opts).toEqual({ isHuman: false });
    expect(result).toMatchObject({ status: "auto_applied_unreviewed", target_entity_type: "claim", target_entity_id: "claim-1" });
  });

  it("need no section row to be written", async () => {
    writeFact.mockResolvedValue({ ok: true, facts: [{ attribute: "current-city", outcome: "inserted", claimId: "claim-1" }] });
    expect((await prepareForInsert(db, suggestion({ category_id: null }), prefs)).status).toBe("auto_applied_unreviewed");
  });

  it("already known values are dropped, refused ones go to review", async () => {
    writeFact.mockResolvedValue({ ok: true, facts: [{ attribute: "current-city", outcome: "already_recorded", claimId: "c" }] });
    expect((await prepareForInsert(db, suggestion(), prefs)).status).toBe("removed");
    writeFact.mockResolvedValue({ ok: false, facts: [{ attribute: null, outcome: "rejected", reason: "contact_not_found" }] });
    expect((await prepareForInsert(db, suggestion(), prefs)).status).toBe("pending_review");
  });

  it("a short quote never reaches the store", async () => {
    const result = await prepareForInsert(db, suggestion({ evidence_quote: "Lisbon" }), prefs);
    expect(result.status).toBe("pending_review");
    expect(writeFact).not.toHaveBeenCalled();
  });
});
